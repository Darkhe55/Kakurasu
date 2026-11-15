/**
 * 方阵和 —— 规则引擎
 *
 * 规则 1（sum）：行/列加权和的两端点检查
 *   - remaining < 0 或 remaining > unknownSum → 矛盾
 *   - remaining === 0        → 剩余空格全部标白
 *   - remaining === unknownSum → 剩余空格全部标黑
 *   remaining = target - 已知黑格加权和
 *
 * 规则 2（subset）：子集和可达性（纯确定性推理，不分支）
 *   设未知权重集合 S、总量 T = ΣS：
 *   - 权重序列「稠密」（排序后满足 w[0] === 1 且 w[i] ≤ 1 + Σw[<i]）时，
 *     0..T 全部可达，逐格判定退化为两条极值规则：
 *       w > remaining        → 该格必白（任何含它的子集都超重）
 *       T - w < remaining    → 该格必黑（去掉它就不够）
 *     后一条即「白和视角」：whiteSum = T - remaining，w 超过 whiteSum 就必须黑。
 *   - 序列有洞时，建子集和可达表，逐格精确判定：
 *       remaining ∉ Reach(S \ {x})        → 不能白，x 必黑
 *       remaining - w ∉ Reach(S \ {x})    → 不能黑，x 必白
 *   - remaining 本身不可达 → 整行/列矛盾（区间判断漏掉的中间空洞）
 */

import { BLACK, EMPTY, WHITE } from './types.ts'

export type RuleKind = 'sum' | 'subset'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

export function initialGrid(size: number): number[] {
  return new Array<number>(size).fill(EMPTY)
}

/**
 * 权重序列是否「稠密」：升序（本文件里权重天然升序）且 w[i] ≤ 1 + 前缀和，
 * 此时 0..Σw 全部可达，无需建表。
 */
function isDense(weights: number[]): boolean {
  let covered = 0
  for (let k = 0; k < weights.length; k++) {
    const wt = weights[k]!
    if (wt > covered + 1) return false
    covered += wt
  }
  return covered > 0
}

/**
 * 子集和可达表缓存。
 * 一行的未知权重集合只能是 1..w 的子集，种类有限，按「权重掩码 + 被排除的权重」缓存。
 */
const reachCache = new Map<number, Uint8Array>()

/**
 * 子集和可达表：reach[s] === 1 表示存在子集和恰为 s。
 * 行/列的未知权重互不相同，skipWt 为要排除的那个权重（0 表示不排除）。
 */
function reachTable(weights: number[], skipWt: number): Uint8Array {
  let mask = 0
  for (const wt of weights) mask |= 1 << wt
  const key = (mask << 5) | skipWt

  const cached = reachCache.get(key)
  if (cached) return cached

  let maxSum = 0
  for (const wt of weights) if (wt !== skipWt) maxSum += wt
  const reach = new Uint8Array(maxSum + 1)
  reach[0] = 1
  for (const wt of weights) {
    if (wt === skipWt) continue
    for (let s = maxSum; s >= wt; s--) if (reach[s - wt] === 1) reach[s] = 1
  }

  if (reachCache.size < 16384) reachCache.set(key, reach)
  return reach
}

interface Deduction {
  /** 在该行/列 weights 数组里的下标 */
  k: number
  value: number
  rule: RuleKind
}

interface LineOutcome {
  ok: boolean
  forced: Deduction[]
}

/**
 * 单行/单列求解：weights 是未知格权重，remaining 是还需凑出的加权和。
 * 所有结论都基于同一份快照推导，彼此一致。
 */
function resolveLine(weights: number[], remaining: number): LineOutcome {
  const n = weights.length
  const forced: Deduction[] = []
  let total = 0
  for (let k = 0; k < n; k++) total += weights[k]!

  if (remaining < 0 || remaining > total) return { ok: false, forced }
  if (remaining === 0) {
    for (let k = 0; k < n; k++) forced.push({ k, value: WHITE, rule: 'sum' })
    return { ok: true, forced }
  }
  if (remaining === total) {
    for (let k = 0; k < n; k++) forced.push({ k, value: BLACK, rule: 'sum' })
    return { ok: true, forced }
  }

  if (isDense(weights)) {
    for (let k = 0; k < n; k++) {
      const wt = weights[k]!
      if (wt > remaining) forced.push({ k, value: WHITE, rule: 'subset' })
      else if (total - wt < remaining) forced.push({ k, value: BLACK, rule: 'subset' })
    }
    return { ok: true, forced }
  }

  const full = reachTable(weights, 0)
  if (full[remaining] !== 1) return { ok: false, forced }

  for (let k = 0; k < n; k++) {
    const wt = weights[k]!
    if (wt > remaining) {
      forced.push({ k, value: WHITE, rule: 'subset' })
      continue
    }
    if (total - wt < remaining) {
      forced.push({ k, value: BLACK, rule: 'subset' })
      continue
    }
    const restTotal = total - wt
    const rest = reachTable(weights, wt)
    const canWhite = remaining <= restTotal && rest[remaining] === 1
    const canBlack = remaining - wt >= 0 && remaining - wt <= restTotal && rest[remaining - wt] === 1
    if (!canWhite && !canBlack) return { ok: false, forced }
    if (!canWhite) forced.push({ k, value: BLACK, rule: 'subset' })
    else if (!canBlack) forced.push({ k, value: WHITE, rule: 'subset' })
  }
  return { ok: true, forced }
}

export function propagate(
  cells: Int8Array | number[],
  rowTargets: number[],
  colTargets: number[],
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  let changed = true
  const set = (i: number, value: number, rule: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, rule)
    changed = true
    return true
  }

  const applyLine = (indices: number[], weights: number[], remaining: number): boolean => {
    const outcome = resolveLine(weights, remaining)
    if (!outcome.ok) return false
    for (const d of outcome.forced) {
      if (!set(indices[d.k]!, d.value, d.rule)) return false
    }
    return true
  }

  while (changed) {
    changed = false

    for (let y = 0; y < h; y++) {
      const target = rowTargets[y] ?? 0
      let blackSum = 0
      const weights: number[] = []
      const indices: number[] = []
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cells[i] === BLACK) blackSum += x + 1
        else if (cells[i] === EMPTY) {
          weights.push(x + 1)
          indices.push(i)
        }
      }
      if (!applyLine(indices, weights, target - blackSum)) return false
    }

    for (let x = 0; x < w; x++) {
      const target = colTargets[x] ?? 0
      let blackSum = 0
      const weights: number[] = []
      const indices: number[] = []
      for (let y = 0; y < h; y++) {
        const i = y * w + x
        if (cells[i] === BLACK) blackSum += y + 1
        else if (cells[i] === EMPTY) {
          weights.push(y + 1)
          indices.push(i)
        }
      }
      if (!applyLine(indices, weights, target - blackSum)) return false
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  rowTargets: number[],
  colTargets: number[],
  w: number,
  h: number,
): boolean {
  for (let i = 0; i < w * h; i++) {
    if (cells[i] !== BLACK && cells[i] !== WHITE) return false
  }
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = 0; x < w; x++) if (cells[y * w + x] === BLACK) sum += x + 1
    if (sum !== (rowTargets[y] ?? 0)) return false
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y < h; y++) if (cells[y * w + x] === BLACK) sum += y + 1
    if (sum !== (colTargets[x] ?? 0)) return false
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  rowTargets: number[],
  colTargets: number[],
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = initialGrid(size)
  let usedProbing = false
  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, rowTargets, colTargets, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, rowTargets, colTargets, w, h)
      return { ok, solution: ok ? solution : null, contradiction: false, saturated: ok, usedProbing }
    }
    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let blackImpossible = false
      let whiteImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = BLACK
        if (!propagate(trial, rowTargets, colTargets, w, h)) blackImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = WHITE
        if (!propagate(trial, rowTargets, colTargets, w, h)) whiteImpossible = true
      }
      if (blackImpossible && whiteImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (blackImpossible !== whiteImpossible) {
        forced.push({ index: i, value: blackImpossible ? WHITE : BLACK })
      }
    }
    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }
  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
