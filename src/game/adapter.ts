/**
 * ════════════════════════════════════════════════════════════════════
 *  方阵和（Kakurasu）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态用 0/1/2：0 = 未定，1 = 黑，2 = 白。
 */

import { playDrop, playPluck } from '../core/audio'
import type {
  CustomSupport,
  GameAdapter,
  ImportSupport,
  Move,
  Puzzle,
  SolveResult,
} from '../core/types'
import { mountImageImport } from './image-import-panel'
import { mountTextImport } from './text-import-panel'
import { solveByRules } from './rules'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { countSolutions, solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  BLACK,
  decodeBoard,
  encodeBoard,
  type ImportCheckResult,
  type KakurasuPuzzle,
} from './types'

const meta = {
  title: '方阵和',
  tagline: '按位置权重涂黑 —— 让每行每列的加权和正好等于数字',
  footerNote:
    '规则：第 1 列/行权重为 1，第 2 列为 2，依此类推。每行右侧数字 = 该行黑格的列权重和；每列下方数字 = 该列黑格的行权重和。',
  storageKeyPrefix: 'kakurasu',
  customIdPrefix: 'kakurasu-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 20,
  customMaxH: 20,
  targetKind: 'cell' as const,
  interactionHint:
    '<kbd>左键</kbd> 空格/标点 ⇄ 黑格 · <kbd>右键</kbd> 空格/黑格 ⇄ 标点',
}

function readTargetList(
  id: string,
  count: number,
  max: number,
  fallback: number[],
): number[] {
  const el = document.getElementById(id) as HTMLTextAreaElement | null
  const raw = el?.value.trim() ?? ''
  const vals = raw ? raw.split(/[\s,，]+/).filter(Boolean).map(Number) : []
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const n = Number.isFinite(vals[i]) ? vals[i]! : fallback[i] ?? 0
    out.push(Math.max(0, Math.min(max, Math.round(n))))
  }
  return out
}

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: [null],
  keyForDigit: () => undefined,
  cellLabel: () => '',
  hint: '在下方输入行目标与列目标（空格或逗号分隔）；网格本身不用涂写。',

  extras: {
    html: () => `
      <div class="custom-extras-grid">
        <label>行目标（从上到下，共 h 个）
          <textarea id="custom-row-targets" rows="2" spellcheck="false"></textarea>
        </label>
        <label>列目标（从左到右，共 w 个）
          <textarea id="custom-col-targets" rows="2" spellcheck="false"></textarea>
        </label>
        <div class="custom-hint">行目标范围 0..w(w+1)/2，列目标范围 0..h(h+1)/2；数值会被截断到合法范围。</div>
      </div>`,
    mount: () => undefined,
    reset: () => {
      const r = document.getElementById('custom-row-targets') as HTMLTextAreaElement | null
      const c = document.getElementById('custom-col-targets') as HTMLTextAreaElement | null
      if (r) r.value = ''
      if (c) c.value = ''
    },
    load: (p) => {
      const kp = p as KakurasuPuzzle
      const r = document.getElementById('custom-row-targets') as HTMLTextAreaElement | null
      const c = document.getElementById('custom-col-targets') as HTMLTextAreaElement | null
      if (r) r.value = (kp.rowTargets ?? []).join(' ')
      if (c) c.value = (kp.colTargets ?? []).join(' ')
    },
  },

  toGrid: (p) => ({
    width: p.width,
    height: p.height,
    grid: new Array<number | null>(p.width * p.height).fill(null),
  }),

  makePuzzle: (w, h, _grid, existingId) => {
    const rowTargets = readTargetList('custom-row-targets', h, (w * (w + 1)) / 2, [])
    const colTargets = readTargetList('custom-col-targets', w, (h * (h + 1)) / 2, [])
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      rowTargets,
      colTargets,
    } satisfies KakurasuPuzzle
  },

  encodePuzzle: (p) => {
    const kp = p as KakurasuPuzzle
    return { board: encodeBoard(kp.rowTargets ?? [], kp.colTargets ?? []) }
  },

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    if (typeof record.board !== 'string') return null
    const decoded = decodeBoard(record.board, w, h)
    if (!decoded) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      rowTargets: decoded.rowTargets,
      colTargets: decoded.colTargets,
    } satisfies KakurasuPuzzle
  },

  audit: (p) => {
    const kp = p as KakurasuPuzzle
    const w = kp.width
    const h = kp.height
    if (w * h > 144) return { ok: true, message: '大盘面跳过唯一解校验。' }
    const out = countSolutions(kp.rowTargets ?? [], kp.colTargets ?? [], w * h, w, h, 2, 300_000)
    if (out.timedOut) return { ok: true, message: '唯一解校验超时，仍可保存。' }
    if (out.count === 0) return { ok: false, message: '当前目标和无解。' }
    if (out.count > 1) return { ok: true, message: '注意：当前目标和存在多个解。' }
    return { ok: true, message: '唯一解 ✓。' }
  },
}


function playForMove(move: Move, streak: number): void {
  if (move.to === BLACK) playDrop(streak)
  else playPluck(streak)
}

/** 导入上限：20×20（与自定义题板元数据保持一致） */
const IMPORT_MAX_SIZE = 20

/** 回溯确认有解的最大盘面：再大回溯成本不可控，只做规则引擎校验 */
const IMPORT_SEARCH_MAX_SIZE = 12

/** 回溯确认有解时允许的搜索节点数 */
const IMPORT_SEARCH_MAX_NODES = 300_000

/** 用规则引擎检查一份手动/识别来的题面 */
function checkImported(
  rowTargets: number[],
  colTargets: number[],
  width: number,
  height: number,
): ImportCheckResult {
  const fail = (error: string): ImportCheckResult => ({ error, warning: null })
  if (rowTargets.length !== height) return fail(`行目标应有 ${height} 个，实际 ${rowTargets.length} 个。`)
  if (colTargets.length !== width) return fail(`列目标应有 ${width} 个，实际 ${colTargets.length} 个。`)
  const maxRow = (width * (width + 1)) / 2
  const maxCol = (height * (height + 1)) / 2
  for (let y = 0; y < height; y++) {
    const v = rowTargets[y]!
    if (!Number.isInteger(v) || v < 0 || v > maxRow) {
      return fail(`第 ${y + 1} 行目标 ${v} 不合法（应在 0..${maxRow}）。`)
    }
  }
  for (let x = 0; x < width; x++) {
    const v = colTargets[x]!
    if (!Number.isInteger(v) || v < 0 || v > maxCol) {
      return fail(`第 ${x + 1} 列目标 ${v} 不合法（应在 0..${maxCol}）。`)
    }
  }
  const result = solveByRules(rowTargets, colTargets, width * height, width, height, true, 240)
  if (result.contradiction) return fail('这组数字互相矛盾，没有解。请核对数值。')
  if (result.ok) return { error: null, warning: null }

  // 规则推不满：小盘面再用回溯确认至少存在一个解；大盘面回溯不可控，改为提示由用户核对
  const size = Math.max(width, height)
  if (size <= IMPORT_SEARCH_MAX_SIZE) {
    const out = countSolutions(
      rowTargets,
      colTargets,
      width * height,
      width,
      height,
      1,
      IMPORT_SEARCH_MAX_NODES,
    )
    if (out.count > 0) {
      return {
        error: null,
        warning: '这组数字有解，但规则引擎不能唯一推出（可能有多解或需要回溯），确认后仍可导入。',
      }
    }
    if (!out.timedOut) return fail('这组数字没有解，可能是抄错了；请核对后再保存。')
    return {
      error: null,
      warning: '题面校验超时，未能确认唯一解；请核对数字，确认后仍可导入。',
    }
  }
  return {
    error: null,
    warning: `尺寸 ${width}×${height} 较大，只校验了数值合法性，未验证解；请核对数字，确认后仍可导入。`,
  }
}

const textImport: ImportSupport = {
  label: '文本导入',
  open: (panel, host) =>
    mountTextImport(panel, host, { maxSize: IMPORT_MAX_SIZE, check: checkImported }),
}

const imageImport: ImportSupport = {
  label: '图片导入',
  open: (panel, host) =>
    mountImageImport(panel, host, { check: checkImported, maxSize: IMPORT_MAX_SIZE }),
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  textImport,
  imageImport,
  playForMove,
}
