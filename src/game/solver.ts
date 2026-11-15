/**
 * 方阵和 —— 回溯求解器
 */

import type { Puzzle, SolveResult } from '../core/types'
import { initialGrid, isValidSolution, propagate, solveByRules } from './rules.ts'
import { BLACK, EMPTY, WHITE, type KakurasuPuzzle, type KakurasuState } from './types.ts'

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function search(
  rowTargets: number[],
  colTargets: number[],
  size: number,
  w: number,
  h: number,
  limit: number,
  maxNodes: number,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  const grid = initialGrid(size)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false
  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!propagate(grid, rowTargets, colTargets, w, h)) return
    let choice = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        choice = i
        break
      }
    }
    if (choice < 0) {
      if (isValidSolution(grid, rowTargets, colTargets, w, h)) solutions.push(Array.from(grid))
      return
    }
    const backup = Array.from(grid)
    for (const value of [BLACK, WHITE] as const) {
      if (solutions.length >= limit || timedOut) return
      grid[choice] = value
      dfs()
      for (let i = 0; i < size; i++) grid[i] = backup[i]!
    }
  }
  dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  rowTargets: number[],
  colTargets: number[],
  size: number,
  w: number,
  h: number,
  limit = 2,
  maxNodes = 300_000,
): CountOutcome {
  const out = search(rowTargets, colTargets, size, w, h, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = puzzle as KakurasuPuzzle
  const size = p.width * p.height
  if (!p.rowTargets || !p.colTargets) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const byRules = solveByRules(p.rowTargets, p.colTargets, size, p.width, p.height, true, 240)
  if (byRules.ok && byRules.solution) {
    return { solved: true, solution: makeState(p, byRules.solution), nodes: 0, timedOut: false }
  }
  if (byRules.contradiction) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const out = search(p.rowTargets, p.colTargets, size, p.width, p.height, 1, maxNodes)
  const solution = out.solutions[0]
  return {
    solved: !!solution,
    solution: solution ? makeState(p, solution) : null,
    nodes: out.nodes,
    timedOut: out.timedOut,
  }
}

export function makeState(puzzle: KakurasuPuzzle, cells: number[]): KakurasuState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: new Array<number>(puzzle.width * puzzle.height).fill(EMPTY),
  }
}
