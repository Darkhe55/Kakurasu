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
  customMaxW: 25,
  customMaxH: 25,
  targetKind: 'cell' as const,
  interactionHint:
    '<kbd>左键</kbd> 空格/标点 ⇄ 黑格 · <kbd>右键</kbd> 空格/黑格 ⇄ 标点',
}

const VALUE_CYCLE: Array<number | null> = [null, BLACK, 2]

const custom: CustomSupport = {
  mode: 'none',
  valueCycle: VALUE_CYCLE,
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit === BLACK) return BLACK
    return undefined
  },
  cellLabel: (v) => (v === BLACK ? '黑' : v === 2 ? '白' : ''),
  cellClass: (v) => (v === BLACK ? 'v-black' : ''),
  hint: '本游戏暂不支持自定义题板。',
  makePuzzle: (w, h, _grid, existingId) => ({
    id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    rowTargets: new Array<number>(h).fill(0),
    colTargets: new Array<number>(w).fill(0),
  }),
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
}

function playForMove(move: Move, streak: number): void {
  if (move.to === BLACK) playDrop(streak)
  else playPluck(streak)
}

/** 导入上限：25×25（与自定义题板元数据保持一致） */
const IMPORT_MAX_SIZE = 25

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
