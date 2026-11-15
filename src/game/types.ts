/**
 * 方阵和（Kakurasu）—— 游戏专用类型
 *
 * 规则：
 *   - 每行右侧数字 = 该行黑格所在列的权重之和（第 1 列权重 1，第 2 列权重 2…）；
 *   - 每列下方数字 = 该列黑格所在行的权重之和（第 1 行权重 1，第 2 行权重 2…）。
 *
 * 状态：0 = 未定，1 = 黑，2 = 白。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export type CellValue = 0 | 1 | 2

export interface KakurasuPuzzle extends Puzzle {
  rowTargets: number[]
  colTargets: number[]
  /** 参考解：1 黑 / 2 白 */
  solution?: number[]
}

export interface KakurasuState extends GameState {
  cells: number[]
  givens: number[]
}

export interface LineIssue {
  orientation: 'row' | 'col'
  index: number
  value: number
  target: number
}

/** 导入校验结果：error 会拒绝入库，warning 只提示、确认后可继续 */
export interface ImportCheckResult {
  error: string | null
  warning: string | null
}

export type ImportCheck = (
  rowTargets: number[],
  colTargets: number[],
  width: number,
  height: number,
) => ImportCheckResult

export interface KakurasuResult extends ValidationResult {
  empty: number
  complete: boolean
  blackCount: number
  lineIssues: LineIssue[]
  badCells: number[]
}

export function asKakPuzzle(p: Puzzle): KakurasuPuzzle {
  return p as KakurasuPuzzle
}

export function asKakState(s: GameState): KakurasuState {
  return s as KakurasuState
}

export function encodeBoard(rowTargets: number[], colTargets: number[]): string {
  return `${rowTargets.join(',')}|${colTargets.join(',')}`
}

export function decodeBoard(
  text: string,
  w: number,
  h: number,
): { rowTargets: number[]; colTargets: number[] } | null {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 2) return null
  const parse = (s: string, len: number): number[] | null => {
    const out: number[] = []
    for (const part of s.split(',')) {
      const n = Number(part)
      if (!Number.isInteger(n) || n < 0) return null
      out.push(n)
    }
    return out.length === len ? out : null
  }
  const rowTargets = parse(parts[0]!, h)
  const colTargets = parse(parts[1]!, w)
  if (!rowTargets || !colTargets) return null
  return { rowTargets, colTargets }
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'B' || ch === 'b' || ch === '#') out[i] = BLACK
    else if (ch === '2' || ch === 'W' || ch === 'w' || ch === 'o' || ch === 'O') out[i] = WHITE
    else return null
  }
  return out
}
