/**
 * 方阵和 —— 从图片识别题目
 *
 * 输入：一张题目截图。方阵和题面里没有可填线索，全部信息都在网格外侧的
 * 「行目标」（右侧一列）和「列目标」（底部一行）里。
 *
 * 识别步骤：
 *   1. 深色像素投影出贯穿全图的水平/竖直线，取等距的那一串作为网格线，
 *      从而得到 width × height 与单元格尺寸（坐标标签的零星墨迹会被排除）。
 *   2. 蓝色像素做连通块，得到每个数字的字形；位于网格右侧的归属行目标，
 *      位于网格下方的归属列目标。
 *   3. 用多种系统字体渲染 0-9 作为模板，按归一化墨迹网格做最近邻匹配；
 *      再按「整行/整列读数是否落在合法区间」给每种字体投票，取最可信的一组。
 *
 * 识别只给出候选值，最终是否入库由用户确认（导入面板里可手改）。
 */

import type { Puzzle } from '../core/types'

export interface RecognizedPuzzle {
  width: number
  height: number
  rowTargets: number[]
  colTargets: number[]
  /** 识别置信度 0..1（字形成本越低越高） */
  confidence: number
  /** 每个目标数字被识别时使用的字体 */
  font: string
  /** 识别失败的说明 */
  error?: string
  /** 网格线的像素位置，供预览叠加 */
  grid: { left: number; top: number; cellW: number; cellH: number }
}

interface Glyph {
  minX: number
  maxX: number
  minY: number
  maxY: number
  w: number
  h: number
  area: number
  /** 归一化墨迹密度（GW × GH） */
  grid: Float32Array
}

const GW = 12
const GH = 18

/** 候选字体：优先使用无衬线数字，且覆盖 Windows / macOS 常见字体 */
const FONTS = [
  'Verdana',
  'Tahoma',
  'Calibri',
  'Consolas',
  'Courier New',
  'Trebuchet MS',
  'Segoe UI',
  'Arial',
  'Helvetica',
  'DejaVu Sans',
]

function groupLines(scores: Int32Array, minCount: number): number[] {
  const out: number[] = []
  let run: number[] = []
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! >= minCount) run.push(i)
    else if (run.length) {
      out.push(run.reduce((a, b) => a + b, 0) / run.length)
      run = []
    }
  }
  if (run.length) out.push(run.reduce((a, b) => a + b, 0) / run.length)
  return out
}

/**
 * 从候选线里挑出最长的一段等距线。
 * 图片外框、坐标轴等孤立线不会被选进来。
 */
function longestEvenRun(lines: number[]): { first: number; step: number; count: number } | null {
  let best: { first: number; step: number; count: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const step = (lines[j]! - lines[i]!) / (j - i)
      if (step < 8) continue
      let count = j - i + 1
      let expected = lines[j]!
      let k = j + 1
      while (k < lines.length && Math.abs(lines[k]! - expected - step) <= step * 0.25) {
        count++
        expected += step
        k++
      }
      if (!best || count > best.count) best = { first: lines[i]!, step, count }
    }
  }
  return best
}

/** 把连通块归一化成 GW × GH 的墨迹密度网格 */
function buildGlyph(
  blue: Uint8Array,
  w: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  area: number,
): Glyph {
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const grid = new Float32Array(GW * GH)
  for (let gy = 0; gy < GH; gy++) {
    const y0 = minY + Math.floor((gy * bh) / GH)
    const y1 = Math.max(y0, minY + Math.floor(((gy + 1) * bh) / GH) - 1)
    for (let gx = 0; gx < GW; gx++) {
      const x0 = minX + Math.floor((gx * bw) / GW)
      const x1 = Math.max(x0, minX + Math.floor(((gx + 1) * bw) / GW) - 1)
      let ink = 0
      let total = 0
      for (let y = y0; y <= y1; y++) {
        const base = y * w
        for (let x = x0; x <= x1; x++) {
          total++
          if (blue[base + x]) ink++
        }
      }
      grid[gy * GW + gx] = total ? ink / total : 0
    }
  }
  return { minX, maxX, minY, maxY, w: bw, h: bh, area, grid }
}

/** 收集蓝色像素的连通块，返回字形 */
function findGlyphs(blue: Uint8Array, w: number, h: number): Glyph[] {
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const out: Glyph[] = []
  for (let start = 0; start < w * h; start++) {
    if (!blue[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    let area = 0
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    while (stack.length) {
      const cur = stack.pop()!
      const x = cur % w
      const y = (cur / w) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && blue[cur - 1] && !seen[cur - 1]) {
        seen[cur - 1] = 1
        stack.push(cur - 1)
      }
      if (x + 1 < w && blue[cur + 1] && !seen[cur + 1]) {
        seen[cur + 1] = 1
        stack.push(cur + 1)
      }
      if (y > 0 && blue[cur - w] && !seen[cur - w]) {
        seen[cur - w] = 1
        stack.push(cur - w)
      }
      if (y + 1 < h && blue[cur + w] && !seen[cur + w]) {
        seen[cur + w] = 1
        stack.push(cur + w)
      }
    }
    // 过滤噪点
    if (area < 12) continue
    out.push(buildGlyph(blue, w, minX, minY, maxX, maxY, area))
  }
  return out
}

/** 用某个字体把 0-9 渲染成模板 */
function buildTemplates(font: string): Glyph[] | null {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 160
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const templates: Glyph[] = []
  for (let d = 0; d <= 9; d++) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 160, 160)
    ctx.fillStyle = '#000'
    ctx.font = `bold 96px "${font}"`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(String(d), 12, 128)
    const data = ctx.getImageData(0, 0, 160, 160).data
    let minX = 160
    let minY = 160
    let maxX = -1
    let maxY = -1
    let area = 0
    for (let i = 0; i < 160 * 160; i++) {
      const p = i * 4
      const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
      if (lum >= 128) continue
      const x = i % 160
      const y = (i / 160) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (area === 0) return null

    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const grid = new Float32Array(GW * GH)
    for (let gy = 0; gy < GH; gy++) {
      const y0 = minY + Math.floor((gy * bh) / GH)
      const y1 = Math.max(y0, minY + Math.floor(((gy + 1) * bh) / GH) - 1)
      for (let gx = 0; gx < GW; gx++) {
        const x0 = minX + Math.floor((gx * bw) / GW)
        const x1 = Math.max(x0, minX + Math.floor(((gx + 1) * bw) / GW) - 1)
        let ink = 0
        let total = 0
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            total++
            const p = (y * 160 + x) * 4
            const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
            if (lum < 128) ink++
          }
        }
        grid[gy * GW + gx] = total ? ink / total : 0
      }
    }
    templates.push({ minX, maxX, minY, maxY, w: bw, h: bh, area, grid })
  }
  return templates
}

function glyphDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!
    sum += d * d
  }
  return Math.sqrt(sum / a.length)
}

interface Classified {
  digit: number
  score: number
}

function classify(glyph: Glyph, templates: Glyph[]): Classified {
  let best = 0
  let bestScore = Infinity
  for (let d = 0; d < templates.length; d++) {
    const t = templates[d]!
    const aspect = glyph.w / glyph.h
    const tAspect = t.w / t.h
    const score = glyphDistance(glyph.grid, t.grid) + Math.abs(aspect - tAspect) * 0.25
    if (score < bestScore) {
      bestScore = score
      best = d
    }
  }
  return { digit: best, score: bestScore }
}

/** 同一行/同一列的字形按位置聚成数字 */
function groupDigits(glyphs: Glyph[], axis: 'row' | 'col'): Glyph[][] {
  if (!glyphs.length) return []
  const sorted = [...glyphs].sort((a, b) =>
    axis === 'row' ? a.minY - b.minY || a.minX - b.minX : a.minX - b.minX || a.minY - b.minY,
  )
  const medianW = [...glyphs].sort((a, b) => a.w - b.w)[Math.floor(glyphs.length / 2)]!.w
  const groups: Glyph[][] = []
  for (const glyph of sorted) {
    const last = groups[groups.length - 1]
    if (!last) {
      groups.push([glyph])
      continue
    }
    if (axis === 'row') {
      // 行目标：纵向中心接近同一行，横向相邻则属于同一个数字
      const prev = last[last.length - 1]!
      const sameRow = Math.abs(glyph.minY - prev.minY) <= Math.max(prev.h, glyph.h) * 0.4
      if (sameRow && glyph.minX - prev.maxX <= medianW * 0.6) {
        last.push(glyph)
      } else if (sameRow) {
        groups.push([glyph])
      } else {
        groups.push([glyph])
      }
    } else {
      const prev = last[last.length - 1]!
      if (glyph.minX - prev.maxX <= medianW * 0.6) last.push(glyph)
      else groups.push([glyph])
    }
  }
  return groups
}

export interface RecognizeOptions {
  /** 识别上限，超出则报错（默认 12） */
  maxSize?: number
}

/**
 * 主入口：把图片识别成方阵和题面。
 * 需要在浏览器环境里跑（用 canvas 取像素）。
 */
export async function recognizePuzzle(
  file: Blob,
  opts: RecognizeOptions = {},
): Promise<RecognizedPuzzle> {
  const maxSize = opts.maxSize ?? 12
  const fail = (error: string): RecognizedPuzzle => ({
    width: 0,
    height: 0,
    rowTargets: [],
    colTargets: [],
    confidence: 0,
    font: '',
    error,
    grid: { left: 0, top: 0, cellW: 0, cellH: 0 },
  })

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return fail('图片读取失败，请换一张 PNG/JPG 截图。')

  // 统一缩放到便于分析的大小（保留原始长宽比）
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const W = Math.max(1, Math.round(bitmap.width * scale))
  const H = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fail('浏览器不支持 canvas 绘图。')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(bitmap, 0, 0, W, H)
  bitmap.close?.()
  const data = ctx.getImageData(0, 0, W, H).data

  const dark = new Uint8Array(W * H)
  const blue = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const p = i * 4
    const r = data[p]!
    const g = data[p + 1]!
    const b = data[p + 2]!
    dark[i] = 0.299 * r + 0.587 * g + 0.114 * b < 120 ? 1 : 0
    blue[i] = b > 110 && b > r + 55 && b > g + 35 ? 1 : 0
  }

  // —— 定位网格线 ——
  const rowScore = new Int32Array(H)
  const colScore = new Int32Array(W)
  for (let y = 0; y < H; y++) {
    const base = y * W
    for (let x = 0; x < W; x++) if (dark[base + x]) rowScore[y]++
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (dark[y * W + x]) colScore[x]++
  }
  const hLines = groupLines(rowScore, W * 0.5)
  const vLines = groupLines(colScore, H * 0.5)
  const hEven = longestEvenRun(hLines)
  const vEven = longestEvenRun(vLines)
  if (!hEven || !vEven) {
    return fail('没有找到完整的网格线，请确认截图包含整个题面。')
  }

  const width = vEven.count - 1
  const height = hEven.count - 1
  if (width < 2 || height < 2) return fail(`识别到 ${width}×${height} 网格，尺寸过小。`)
  if (width > maxSize || height > maxSize) {
    return fail(`识别到 ${width}×${height}，最大支持 ${maxSize}×${maxSize}。`)
  }

  const cellW = vEven.step
  const cellH = hEven.step
  const gridLeft = vEven.first
  const gridTop = hEven.first
  const gridRight = gridLeft + width * cellW
  const gridBottom = gridTop + height * cellH

  // —— 字形分组 ——
  // 行目标在网格右侧（整块都在右边界之外），列目标在网格下方（整块都在下边界之下）。
  // 用「整块在外侧」而不是「部分相交」，避免把左下角的行号标签 12 误算进列目标区。
  const glyphs = findGlyphs(blue, W, H)
  const rowGlyphs = glyphs.filter((g) => g.minX >= gridRight - cellW * 0.15)
  const colGlyphs = glyphs.filter((g) => g.minY >= gridBottom - cellH * 0.15)

  if (rowGlyphs.length < height || colGlyphs.length < width) {
    return fail(
      `数字没有识别全（行目标 ${rowGlyphs.length}/${height}，列目标 ${colGlyphs.length}/${width}）。` +
        '请使用带蓝色数字的原题截图。',
    )
  }

  const rowGroups = groupDigits(rowGlyphs, 'row')
  const colGroups = groupDigits(colGlyphs, 'col').sort(
    (a, b) => a[0]!.minX - b[0]!.minX,
  )

  // —— 多字体识别并投票 ——
  interface Candidate {
    font: string
    rows: number[]
    cols: number[]
    score: number
    valid: boolean
  }
  const candidates: Candidate[] = []

  for (const font of FONTS) {
    const templates = buildTemplates(font)
    if (!templates) continue

    const readGroups = (groups: Glyph[][]): { values: number[]; score: number } => {
      const values: number[] = []
      let total = 0
      let count = 0
      for (const group of groups) {
        let text = ''
        for (const glyph of group) {
          const c = classify(glyph, templates)
          text += String(c.digit)
          total += c.score
          count++
        }
        values.push(Number(text))
      }
      return { values, score: count ? total / count : Infinity }
    }

    const rows = readGroups(rowGroups)
    const cols = readGroups(colGroups)

    // 合法性：行目标不超过 1+2+...+width，列目标不超过 1+..+height
    const maxRow = (width * (width + 1)) / 2
    const maxCol = (height * (height + 1)) / 2
    const valid =
      rows.values.length === height &&
      cols.values.length === width &&
      rows.values.every((v) => Number.isFinite(v) && v >= 0 && v <= maxRow) &&
      cols.values.every((v) => Number.isFinite(v) && v >= 0 && v <= maxCol)

    candidates.push({
      font,
      rows: rows.values,
      cols: cols.values,
      score: rows.score + cols.score,
      valid,
    })
  }

  if (!candidates.length) return fail('当前系统缺少可用于比对的字体。')

  const valid = candidates.filter((c) => c.valid)
  const pool = valid.length ? valid : candidates
  pool.sort((a, b) => a.score - b.score)
  const best = pool[0]!

  if (!best.valid) {
    return fail('数字识别结果不在合法范围内，请改用「手动输入」导入。')
  }

  return {
    width,
    height,
    rowTargets: best.rows,
    colTargets: best.cols,
    confidence: Math.max(0, Math.min(1, 1 - best.score)),
    font: best.font,
    grid: { left: gridLeft, top: gridTop, cellW, cellH },
  }
}

/** 把识别结果转成题面；不合法返回 null */
export function toPuzzle(recognized: RecognizedPuzzle, name: string, id: string): Puzzle | null {
  const { width, height, rowTargets, colTargets } = recognized
  if (!width || !height) return null
  if (rowTargets.length !== height || colTargets.length !== width) return null
  return {
    id,
    name,
    width,
    height,
    difficulty: 'custom',
    rowTargets: rowTargets.slice(),
    colTargets: colTargets.slice(),
  } as Puzzle
}
