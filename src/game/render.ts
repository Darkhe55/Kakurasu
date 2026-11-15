/**
 * 方阵和 —— SVG 渲染与命中
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import { cellAtPoint, cellCenter, squareMetrics } from '../core/board'
import {
  asKakPuzzle,
  asKakState,
  BLACK,
  EMPTY,
  WHITE,
  type KakurasuResult,
} from './types'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  return squareMetrics(puzzle.width, puzzle.height, {
    cell: 46,
    padLeft: 38,
    padTop: 38,
    padRight: 58,
    padBottom: 54,
    targetKind: 'cell',
  })
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asKakPuzzle(puzzle)
  const s = asKakState(state)
  const r = result as KakurasuResult
  const w = puzzle.width
  const h = puzzle.height
  const rowTargets = p.rowTargets ?? []
  const colTargets = p.colTargets ?? []
  const bad = new Set<number>(r.badCells ?? [])
  const badRows = new Set<number>()
  const badCols = new Set<number>()
  for (const issue of r.lineIssues ?? []) {
    if (issue.orientation === 'row') badRows.add(issue.index)
    else badCols.add(issue.index)
  }

  const cell = m.cell
  const ox = m.originX ?? m.pad
  const oy = m.originY ?? m.pad
  const gap = Math.max(1, cell * 0.04)
  const inner = cell - gap
  const parts: string[] = []

  parts.push(
    `<rect class="kk-board-bg" x="${ox - 10}" y="${oy - 10}" width="${w * cell + 20}" height="${h * cell + 20}" rx="${(cell * 0.18).toFixed(2)}" />`,
  )

  for (let i = 0; i < w * h; i++) {
    const x = ox + (i % w) * cell + gap / 2
    const y = oy + Math.floor(i / w) * cell + gap / 2
    const v = s.cells[i] ?? EMPTY

    let cls = 'kk-cell'
    if (v === BLACK) cls += ' black'
    else if (v === WHITE) cls += ' white'
    else cls += ' empty'
    if (bad.has(i)) cls += ' bad'

    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${(cell * 0.12).toFixed(2)}" />`
    if (v === WHITE) {
      content += `<circle class="kk-white-dot" cx="${(x + inner / 2).toFixed(2)}" cy="${(y + inner / 2).toFixed(2)}" r="${(inner * 0.16).toFixed(2)}" />`
    }
    if (bad.has(i)) {
      content += `<rect class="kk-error" x="${(x + 1.1).toFixed(2)}" y="${(y + 1.1).toFixed(2)}" width="${(inner - 2.2).toFixed(2)}" height="${(inner - 2.2).toFixed(2)}" rx="${(cell * 0.1).toFixed(2)}" />`
    }
    parts.push(`<g data-index="${i}">${content}</g>`)
  }

  const labels: string[] = []
  // 列权重（上方）
  for (let x = 0; x < w; x++) {
    const c = cellCenter(m, x)
    labels.push(
      `<text class="kk-weight" x="${c.x.toFixed(2)}" y="${(c.y - cell / 2 - 10).toFixed(2)}" style="font-size:${(cell * 0.24).toFixed(2)}px">${x + 1}</text>`,
    )
  }
  // 行权重（左侧）
  for (let y = 0; y < h; y++) {
    const c = cellCenter(m, y * w)
    labels.push(
      `<text class="kk-weight" x="${(c.x - cell / 2 - 10).toFixed(2)}" y="${c.y.toFixed(2)}" style="font-size:${(cell * 0.24).toFixed(2)}px">${y + 1}</text>`,
    )
  }
  // 行目标（右侧）
  for (let y = 0; y < h; y++) {
    const c = cellCenter(m, y * w + (w - 1))
    labels.push(
      `<text class="kk-target${badRows.has(y) ? ' issue' : ''}" x="${(c.x + cell / 2 + 12).toFixed(2)}" y="${c.y.toFixed(2)}" style="font-size:${(cell * 0.3).toFixed(2)}px">${rowTargets[y] ?? 0}</text>`,
    )
  }
  // 列目标（下方）
  for (let x = 0; x < w; x++) {
    const c = cellCenter(m, (h - 1) * w + x)
    labels.push(
      `<text class="kk-target col${badCols.has(x) ? ' issue' : ''}" x="${c.x.toFixed(2)}" y="${(c.y + cell / 2 + 14).toFixed(2)}" style="font-size:${(cell * 0.3).toFixed(2)}px">${colTargets[x] ?? 0}</text>`,
    )
  }
  parts.push(`<g class="kk-labels">${labels.join('')}</g>`)

  for (let i = 0; i < w * h; i++) {
    const x = ox + (i % w) * cell
    const y = oy + Math.floor(i / w) * cell
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg kk-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  _puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const index = cellAtPoint(m, x, y)
  return index == null ? null : { index }
}
