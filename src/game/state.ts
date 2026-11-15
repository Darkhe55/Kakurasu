/**
 * 方阵和 —— 棋盘状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asKakPuzzle,
  asKakState,
  BLACK,
  decodeCells,
  EMPTY,
  encodeCells,
  WHITE,
  type KakurasuState,
} from './types'

export function createEmptyState(puzzle: Puzzle): KakurasuState {
  const p = asKakPuzzle(puzzle)
  const size = p.width * p.height
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    cells: new Array<number>(size).fill(EMPTY),
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function cloneState(state: GameState): KakurasuState {
  const s = asKakState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: s.cells.slice(),
    givens: s.givens.slice(),
  }
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asKakState(state)
  return s.cells[target.index] === BLACK ? EMPTY : BLACK
}

export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asKakState(state)
  return s.cells[target.index] === WHITE ? EMPTY : WHITE
}

export function applyMove(state: GameState, move: Move): void {
  const s = asKakState(state)
  if (move.index < 0 || move.index >= s.cells.length) return
  s.cells[move.index] = move.to === BLACK || move.to === WHITE ? move.to : EMPTY
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asKakState(state).cells[index] ?? EMPTY
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asKakState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
  }
}

function readCells(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (n !== EMPTY && n !== BLACK && n !== WHITE) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): KakurasuState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width
  const h = data.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  const size = w * h
  const cells = readCells(data.cells, size)
  if (!cells) return null
  return {
    puzzleId: data.puzzleId,
    width: w,
    height: h,
    cells,
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asKakState(state)
  const sol = asKakState(solution)
  const size = Math.min(s.cells.length, sol.cells.length)
  for (let i = 0; i < size; i++) {
    if (s.cells[i] === EMPTY && sol.cells[i] !== EMPTY) {
      return { index: i, from: EMPTY, to: sol.cells[i]! }
    }
  }
  for (let i = 0; i < size; i++) {
    if (s.cells[i] !== sol.cells[i]) {
      return { index: i, from: s.cells[i]!, to: sol.cells[i]! }
    }
  }
  return null
}
