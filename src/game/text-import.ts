/**
 * 方阵和 —— 从文本导入题目
 *
 * 沿用模板的题面编码习惯：题面就是 `puzzles-data.ts` 里 board 字段的格式，
 * 即 encodeBoard 的输出 —— 行目标在前、列目标在后，用 `|` 分隔，逗号分隔数字：
 *
 *   39,70,62,71,53,51|52,76,39,34,59,75
 *
 * 为方便从各种来源粘贴，额外容忍：
 *   - 换行 / 制表符代替逗号，逗号两侧空格
 *   - 省略 `|`，按「宽高」自动切分（行数 = 高，其余为列）
 *   - 直接粘贴题库条目 JSON（含 board 字段）
 *   - `#` 开头的注释行、空行
 */

import type { Puzzle } from '../core/types'
import { decodeBoard } from './types'

export interface ParsedImport {
  width: number
  height: number
  rowTargets: number[]
  colTargets: number[]
  /** 解析失败时的说明 */
  error?: string
}

export interface ParseOptions {
  /** 省略 `|` 时按此宽高切分 */
  width?: number
  height?: number
  maxSize?: number
}

/** 从 JSON 条目里抽出 board 字段 */
function boardFromJson(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      if (typeof record.board === 'string') return record.board
    }
  } catch {
    return null
  }
  return null
}

function numbersOf(text: string): number[] | null {
  const cleaned = text.replace(/#[^\n]*/g, ' ')
  const tokens = cleaned.split(/[^0-9]+/).filter((t) => t.length > 0)
  if (!tokens.length) return null
  const out: number[] = []
  for (const token of tokens) {
    const n = Number(token)
    if (!Number.isInteger(n) || n < 0) return null
    out.push(n)
  }
  return out
}

/**
 * 解析用户输入。成功时返回行/列目标，失败时带 error。
 */
export function parseImport(text: string, opts: ParseOptions = {}): ParsedImport {
  const maxSize = opts.maxSize ?? 30
  const fail = (error: string): ParsedImport => ({
    width: 0,
    height: 0,
    rowTargets: [],
    colTargets: [],
    error,
  })

  const raw = text.trim()
  if (!raw) return fail('还没有输入内容。')

  const board = boardFromJson(raw) ?? raw

  // 有分隔符：直接按 行|列 解析
  if (board.includes('|')) {
    const parts = board.split('|')
    if (parts.length !== 2) return fail('题面里只能有一个「|」，它分隔行目标与列目标。')
    const rows = numbersOf(parts[0]!)
    const cols = numbersOf(parts[1]!)
    if (!rows || !cols) return fail('数字格式不对，只能包含非负整数。')
    if (!rows.length || !cols.length) return fail('行或列目标为空。')
    if (rows.length > maxSize || cols.length > maxSize) {
      return fail(`最多支持 ${maxSize}×${maxSize}，当前 ${cols.length}×${rows.length}。`)
    }
    return { width: cols.length, height: rows.length, rowTargets: rows, colTargets: cols }
  }

  // 没有分隔符：需要宽高才能切分
  const values = numbersOf(board)
  if (!values) return fail('数字格式不对，只能包含非负整数。')

  const width = opts.width ?? 0
  const height = opts.height ?? 0
  if (width > 0 && height > 0) {
    if (values.length !== width + height) {
      return fail(
        `共 ${values.length} 个数字，但 ${width}×${height} 需要 ${width + height} 个（${height} 行 + ${width} 列）。`,
      )
    }
    return {
      width,
      height,
      rowTargets: values.slice(0, height),
      colTargets: values.slice(height),
    }
  }

  // 没有宽高也没有分隔符：尝试按方阵切分（行数 = 列数）
  const n = values.length
  if (n % 2 === 0 && n / 2 > 0) {
    const half = n / 2
    if (half <= maxSize) {
      return {
        width: half,
        height: half,
        rowTargets: values.slice(0, half),
        colTargets: values.slice(half),
      }
    }
  }
  return fail('缺少「|」且无法推断宽高，请先填好宽高。')
}

/** 把行/列目标转成模板的标准题面串（与 puzzles-data.ts 的 board 字段一致） */
export function encodeImport(rowTargets: number[], colTargets: number[]): string {
  return `${rowTargets.join(',')}|${colTargets.join(',')}`
}

/** 校验一份题面是否自洽（宽高、数值范围） */
export function validateImport(parsed: ParsedImport, maxSize = 30): string | null {
  if (parsed.error) return parsed.error
  const { width, height, rowTargets, colTargets } = parsed
  if (width < 2 || height < 2) return '宽高至少为 2。'
  if (width > maxSize || height > maxSize) return `最多支持 ${maxSize}×${maxSize}。`
  if (rowTargets.length !== height) return `行目标应有 ${height} 个，实际 ${rowTargets.length} 个。`
  if (colTargets.length !== width) return `列目标应有 ${width} 个，实际 ${colTargets.length} 个。`
  const maxRow = (width * (width + 1)) / 2
  const maxCol = (height * (height + 1)) / 2
  for (let y = 0; y < height; y++) {
    const v = rowTargets[y]!
    if (v > maxRow) return `第 ${y + 1} 行目标 ${v} 超过上限 ${maxRow}。`
  }
  for (let x = 0; x < width; x++) {
    const v = colTargets[x]!
    if (v > maxCol) return `第 ${x + 1} 列目标 ${v} 超过上限 ${maxCol}。`
  }
  return null
}

/** 解析出的题面能否解码回目标（复用 puzzles-data 的同一套编解码） */
export function roundTrip(parsed: ParsedImport): boolean {
  if (parsed.error) return false
  const decoded = decodeBoard(encodeImport(parsed.rowTargets, parsed.colTargets), parsed.width, parsed.height)
  if (!decoded) return false
  return (
    decoded.rowTargets.every((v, i) => v === parsed.rowTargets[i]) &&
    decoded.colTargets.every((v, i) => v === parsed.colTargets[i])
  )
}

/** 构造题面对象 */
export function toPuzzle(parsed: ParsedImport, name: string, id: string): Puzzle | null {
  if (parsed.error) return null
  return {
    id,
    name,
    width: parsed.width,
    height: parsed.height,
    difficulty: 'custom',
    rowTargets: parsed.rowTargets.slice(),
    colTargets: parsed.colTargets.slice(),
  } as Puzzle
}
