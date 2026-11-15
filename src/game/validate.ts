/**
 * 方阵和 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { isValidSolution } from './rules'
import {
  asKakPuzzle,
  asKakState,
  BLACK,
  EMPTY,
  WHITE,
  type KakurasuResult,
  type LineIssue,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): KakurasuResult {
  const s = asKakState(state)
  const p = asKakPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const rowTargets = p.rowTargets ?? []
  const colTargets = p.colTargets ?? []

  let empty = 0
  let blackCount = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    else if (cells[i] === BLACK) blackCount++
  }

  const bad = new Set<number>()
  const lineIssues: LineIssue[] = []

  for (let y = 0; y < h; y++) {
    const target = rowTargets[y] ?? 0
    let blackSum = 0
    let unknownSum = 0
    let unknown = 0
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x]
      if (v === BLACK) blackSum += x + 1
      else if (v === EMPTY) {
        unknownSum += x + 1
        unknown++
      }
    }
    const impossible = blackSum + unknownSum < target
    if (blackSum > target || impossible || (unknown === 0 && blackSum !== target)) {
      lineIssues.push({ orientation: 'row', index: y, value: blackSum, target })
      if (impossible || unknown === 0) for (let x = 0; x < w; x++) bad.add(y * w + x)
    }
  }
  for (let x = 0; x < w; x++) {
    const target = colTargets[x] ?? 0
    let blackSum = 0
    let unknownSum = 0
    let unknown = 0
    for (let y = 0; y < h; y++) {
      const v = cells[y * w + x]
      if (v === BLACK) blackSum += y + 1
      else if (v === EMPTY) {
        unknownSum += y + 1
        unknown++
      }
    }
    const impossible = blackSum + unknownSum < target
    if (blackSum > target || impossible || (unknown === 0 && blackSum !== target)) {
      lineIssues.push({ orientation: 'col', index: x, value: blackSum, target })
      if (impossible || unknown === 0) for (let y = 0; y < h; y++) bad.add(y * w + x)
    }
  }

  const normalized = cells.map((v) => (v === BLACK ? BLACK : WHITE))
  const solved = lineIssues.length === 0 && isValidSolution(normalized, rowTargets, colTargets, w, h)

  return {
    solved,
    empty,
    complete: empty === 0,
    blackCount,
    lineIssues,
    badCells: Array.from(bad),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as KakurasuResult
  if (r.solved) return ['完成']
  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.lineIssues.length > 0) {
    const rows = r.lineIssues.filter((x) => x.orientation === 'row').length
    const cols = r.lineIssues.length - rows
    if (rows > 0) bits.push(`${rows} 行数字不满足`)
    if (cols > 0) bits.push(`${cols} 列数字不满足`)
  }
  if (bits.length === 0) bits.push('继续涂黑')
  return bits
}
