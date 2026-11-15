/**
 * 方阵和题库生成器
 *
 * 1. 随机生成黑白图案；
 * 2. 计算每行的列权重和、每列的行权重和；
 * 3. 用行/列加权和传播 + 回溯验证唯一解。
 */

import type { Difficulty } from '../core/types'
import { BLACK, WHITE, encodeBoard, encodeCells } from './types.ts'
import { solveByRules } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  density: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  attempts: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface AttemptStats {
  notUnique: number
  timeout: number
  trivial: number
}

function attemptPuzzle(
  spec: GenSpec,
  rng: () => number,
  stats: AttemptStats,
): { rowTargets: number[]; colTargets: number[]; solution: number[] } | null {
  const { w, h } = spec
  const size = w * h
  const solution = new Array<number>(size).fill(WHITE)
  let black = 0
  for (let i = 0; i < size; i++) {
    if (rng() < spec.density) {
      solution[i] = BLACK
      black++
    }
  }
  if (black === 0 || black === size) {
    stats.trivial++
    return null
  }

  const rowTargets = new Array<number>(h).fill(0)
  const colTargets = new Array<number>(w).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solution[y * w + x] === BLACK) {
        rowTargets[y]! += x + 1
        colTargets[x]! += y + 1
      }
    }
  }

  const counted = countSolutions(rowTargets, colTargets, size, w, h, 2, spec.maxNodes)
  if (counted.timedOut) {
    stats.timeout++
    return null
  }
  if (counted.count !== 1) {
    stats.notUnique++
    return null
  }

  if (spec.requireLogic) {
    solveByRules(rowTargets, colTargets, size, w, h, true, 240)
  }

  return { rowTargets, colTargets, solution }
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    density: 0.5,
    seed: 0x4b414b01,
    difficulty: 'easy',
    name: '初识方阵',
    series: '入门',
    attempts: 600,
    maxNodes: 80_000,
    requireLogic: true,
  },
  {
    w: 7,
    h: 7,
    density: 0.5,
    seed: 0x4b414b02,
    difficulty: 'easy',
    name: '七阶权值',
    series: '入门',
    attempts: 800,
    maxNodes: 100_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    density: 0.45,
    seed: 0x4b414b03,
    difficulty: 'medium',
    name: '方阵回廊',
    series: '进阶',
    attempts: 1000,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    density: 0.5,
    seed: 0x4b414b04,
    difficulty: 'medium',
    name: '权重迷阵',
    series: '进阶',
    attempts: 1200,
    maxNodes: 130_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    density: 0.55,
    seed: 0x4b414b05,
    difficulty: 'hard',
    name: '方阵之影',
    series: '挑战',
    attempts: 1400,
    maxNodes: 150_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    density: 0.6,
    seed: 0x4b414b06,
    difficulty: 'hard',
    name: '方阵终局',
    series: '挑战',
    attempts: 1600,
    maxNodes: 160_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const stats: AttemptStats = { notUnique: 0, timeout: 0, trivial: 0 }
    let made: { rowTargets: number[]; colTargets: number[]; solution: number[] } | null = null
    const t0 = Date.now()
    for (let attempt = 0; attempt < spec.attempts; attempt++) {
      made = attemptPuzzle(spec, rng, stats)
      if (made) break
    }
    if (!made) {
      console.error(`[方阵和 gen] ${spec.name} 失败统计：`, stats)
      throw new Error(`[方阵和 gen] ${spec.name} 在 ${spec.attempts} 次尝试内没有生成合法题`)
    }
    const black = made.solution.filter((v) => v === BLACK).length
    console.log(
      `[方阵和 gen] ${spec.name} ${spec.w}×${spec.h}：黑格 ${black}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `kakurasu-${spec.w}x${spec.h}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeBoard(made.rowTargets, made.colTargets),
      solution: encodeCells(made.solution),
    })
  }
  return out
}
