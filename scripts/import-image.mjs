/**
 * 方阵和（Kakurasu）题图导入命令行工具。
 *
 * 用法：
 *   node scripts/import-image.mjs <题图.(png|jpg)> [选项]
 *
 * 选项：
 *   --name 名称      题库名称（默认「图片导入 · 宽×高」）
 *   --id ID          指定题目 id（覆盖同 id 条目）
 *   --append         写入 data/library.json（默认只预览、不写盘）
 *   --verify         额外做唯一解校验（默认只做「规则引擎 + 小盘面回溯确认有解」）
 *   --allow-multi    允许多解题目入库
 *   --map 修正       人工修正行列数字，逗号分隔，可重复：
 *                      r3=62    第 3 行目标改为 62（1 基）
 *                      c5=39    第 5 列目标改为 39
 *   --max-nodes N    回溯搜索节点上限（默认 300000）
 *   --out FILE       题库文件（默认 data/library.json）
 *   --json           输出机器可读结果
 *
 * 识别用的是与网页「图片导入」面板同一份 src/game/image-import.ts：
 * 起一个临时 Vite 开发服务器，用 Playwright 在本机 Edge/Chrome 里
 * 把图片转成 Blob 后调用 recognizePuzzle()，不加载游戏页面本身。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { PORT } from './_port.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS_PATH = '/scripts/_import-page.html'
const SERVER_PORT = PORT + 100
const MAX_SIZE = 15

function usage(msg) {
  if (msg) console.error(`\n[import] ${msg}`)
  console.error(
    `\n用法：node scripts/import-image.mjs <题图> [--name 名称] [--id ID] [--append] [--verify]
      [--allow-multi] [--map r3=62,c5=39] [--max-nodes N] [--out FILE] [--json]

  默认只预览识别结果；--append 才写入 data/library.json。
  图片需要是「深色网格 + 蓝色行列数字」的方阵和题面截图（与网页图片导入要求相同）。`,
  )
  process.exit(1)
}

function parseArgs(argv) {
  const out = {
    image: null,
    name: null,
    id: null,
    append: false,
    verify: false,
    allowMulti: false,
    maxNodes: 300_000,
    out: 'data/library.json',
    json: false,
    maps: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) usage(`参数 ${a} 缺少值`)
      return v
    }
    if (a === '--name') out.name = next()
    else if (a === '--id') out.id = next()
    else if (a === '--append') out.append = true
    else if (a === '--verify') out.verify = true
    else if (a === '--allow-multi') out.allowMulti = true
    else if (a === '--json') out.json = true
    else if (a === '--max-nodes') out.maxNodes = Number(next()) || 300_000
    else if (a === '--out') out.out = next()
    else if (a === '--map') {
      for (const token of next().split(',')) if (token.trim()) out.maps.push(token.trim())
    } else if (a === '--dry-run') {
      /* 兼容旧习惯：预览本来就是默认行为 */
    } else if (a.startsWith('--')) usage(`未知参数 ${a}`)
    else if (!out.image) out.image = a
    else usage(`多余参数 ${a}`)
  }
  if (!out.image) usage('请指定题图路径')
  if (!Number.isInteger(out.maxNodes) || out.maxNodes < 1000) usage('--max-nodes 需要 ≥ 1000')
  return out
}

function sniffMime(buf, file) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitReady(url, timeoutMs = 60_000) {
  const started = Date.now()
  for (;;) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) return true
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) return false
    await sleep(150)
  }
}

/** 应用 --map 修正；返回错误说明或 null */
function applyMaps(puzzle, tokens) {
  const { width, height } = puzzle
  const maxRow = (width * (width + 1)) / 2
  const maxCol = (height * (height + 1)) / 2
  for (const token of tokens) {
    let m = /^r(\d+)=(-?\d+)$/.exec(token)
    if (m) {
      const row = Number(m[1]) - 1
      const v = Number(m[2])
      if (row < 0 || row >= height) return `--map ${token}：行号超出 1..${height}`
      if (!Number.isInteger(v) || v < 0 || v > maxRow) {
        return `--map ${token}：行目标应为 0..${maxRow} 的整数`
      }
      puzzle.rowTargets[row] = v
      continue
    }
    m = /^c(\d+)=(-?\d+)$/.exec(token)
    if (m) {
      const col = Number(m[1]) - 1
      const v = Number(m[2])
      if (col < 0 || col >= width) return `--map ${token}：列号超出 1..${width}`
      if (!Number.isInteger(v) || v < 0 || v > maxCol) {
        return `--map ${token}：列目标应为 0..${maxCol} 的整数`
      }
      puzzle.colTargets[col] = v
      continue
    }
    return `--map 格式无法识别：「${token}」（示例 r3=62 / c5=39）`
  }
  return null
}

const args = parseArgs(process.argv.slice(2))
const imagePath = path.resolve(process.cwd(), args.image)
if (!existsSync(imagePath)) usage(`找不到图片：${imagePath}`)
const executablePath = findBrowser()
if (!executablePath) usage('找不到 Edge/Chrome，可用 EDGE_PATH 指定浏览器路径')

const imageBuf = readFileSync(imagePath)
const dataUrl = `data:${sniffMime(imageBuf, imagePath)};base64,${imageBuf.toString('base64')}`

const url = `http://127.0.0.1:${SERVER_PORT}${HARNESS_PATH}`
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(SERVER_PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore', windowsHide: true },
)
const stopServer = () => {
  try {
    vite.kill()
  } catch {
    /* ignore */
  }
}
process.on('exit', stopServer)
process.on('SIGINT', () => process.exit(130))

let browser
try {
  if (!(await waitReady(url))) {
    stopServer()
    usage(`临时 Vite 开发服务器没起来（端口 ${SERVER_PORT} 可能被占用）。`)
  }

  browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage()
  page.on('pageerror', () => {})
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const recognized = await page.evaluate(
    async ({ dataUrl, maxSize }) => {
      const mod = await import('/src/game/image-import.ts')
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      return mod.recognizePuzzle(blob, { maxSize })
    },
    { dataUrl, maxSize: MAX_SIZE },
  )

  if (recognized.error) {
    console.error(`[import] 识别失败：${recognized.error}`)
    if (args.json) console.log(JSON.stringify({ ok: false, errors: [recognized.error] }, null, 2))
    process.exitCode = 1
  } else {
    const puzzle = {
      width: recognized.width,
      height: recognized.height,
      rowTargets: recognized.rowTargets.slice(),
      colTargets: recognized.colTargets.slice(),
    }
    if (args.maps.length) {
      const mapError = applyMaps(puzzle, args.maps)
      if (mapError) usage(mapError)
      console.log(`[import] --map 应用了 ${args.maps.length} 处人工修正`)
    }

    for (const w of recognized.warnings ?? []) console.warn(`[import] 识别提示：${w}`)

    const board = `${puzzle.rowTargets.join(',')}|${puzzle.colTargets.join(',')}`
    if (!args.json) {
      console.log(
        `[import] 识别：${puzzle.width}×${puzzle.height} · 置信度 ` +
          `${(recognized.confidence * 100).toFixed(0)}%（字体 ${recognized.font || '?'}）`,
      )
      console.log(`[import] 行目标：${puzzle.rowTargets.join(' ')}`)
      console.log(`[import] 列目标：${puzzle.colTargets.join(' ')}`)
      console.log(`[import] 题面编码：${board}`)
    }

    // —— 校验（与网页导入面板同一套策略）——
    const check = await page.evaluate(
      async ({ rows, cols, w, h, verify, maxNodes }) => {
        const rules = await import('/src/game/rules.ts')
        const solver = await import('/src/game/solver.ts')
        const size = w * h
        const maxRow = (w * (w + 1)) / 2
        const maxCol = (h * (h + 1)) / 2
        const errors = []
        if (rows.length !== h) errors.push(`行目标应有 ${h} 个，实际 ${rows.length} 个`)
        if (cols.length !== w) errors.push(`列目标应有 ${w} 个，实际 ${cols.length} 个`)
        rows.forEach((v, i) => {
          if (!Number.isInteger(v) || v < 0 || v > maxRow) {
            errors.push(`第 ${i + 1} 行目标 ${v} 不合法（应在 0..${maxRow}）`)
          }
        })
        cols.forEach((v, i) => {
          if (!Number.isInteger(v) || v < 0 || v > maxCol) {
            errors.push(`第 ${i + 1} 列目标 ${v} 不合法（应在 0..${maxCol}）`)
          }
        })
        if (errors.length) return { errors, ok: false }
        const byRules = rules.solveByRules(rows, cols, size, w, h, true, 240)
        const counted = { count: null, nodes: 0, timedOut: false }
        if (byRules.contradiction) {
          return { errors: ['这组数字互相矛盾，没有解。请用 --map 核对数值。'], ok: false }
        }
        if (!byRules.ok || verify) {
          const limit = verify ? 2 : 1
          const out = solver.countSolutions(rows, cols, size, w, h, limit, maxNodes)
          counted.count = out.count
          counted.nodes = out.nodes
          counted.timedOut = out.timedOut
        }
        return {
          ok: true,
          errors: [],
          logicSolved: byRules.ok && !!byRules.solution,
          logicSaturated: byRules.saturated,
          counted,
        }
      },
      {
        rows: puzzle.rowTargets,
        cols: puzzle.colTargets,
        w: puzzle.width,
        h: puzzle.height,
        verify: args.verify,
        maxNodes: args.maxNodes,
      },
    )

    let warning = null
    let verifiedUnique = false
    if (!check.ok) {
      for (const err of check.errors) console.error(`[import] 校验失败：${err}`)
      if (args.json) console.log(JSON.stringify({ ok: false, errors: check.errors }, null, 2))
      process.exitCode = 1
    } else {
      if (check.counted.count === 0) {
        console.error('[import] 这组数字没有解，请用 --map 核对后重试。')
        if (!args.allowMulti) process.exitCode = 1
      } else if (check.counted.count !== null && check.counted.timedOut) {
        warning = '唯一解校验超时，只确认了数值合法'
      } else if (check.counted.count !== null && args.verify) {
        if (check.counted.count === 1) verifiedUnique = true
        else if (check.counted.count >= 2) warning = '这组数字有多个解'
      } else if (!check.logicSolved) {
        warning =
          puzzle.width * puzzle.height > 144
            ? '大盘面只校验了数值合法性，未验证解'
            : '规则引擎推不满，回溯确认有解但可能有多解'
      }
      if (warning) console.warn(`[import] 提示：${warning}`)
      if (args.verify && !verifiedUnique && !args.allowMulti && check.counted.count !== null) {
        console.error('[import] 未能确认唯一解，拒绝入库（可加 --allow-multi）')
        process.exitCode = 1
      }
    }

    if (!process.exitCode && args.append) {
      const id =
        args.id ||
        `kakurasu-custom-image-${puzzle.width}x${puzzle.height}-${Date.now()}`
      const name = args.name || `图片导入 · ${puzzle.width}×${puzzle.height}`
      const entry = {
        id,
        name,
        width: puzzle.width,
        height: puzzle.height,
        difficulty: 'custom',
        savedAt: Date.now(),
        board,
      }
      const outFile = path.resolve(args.out)
      let library = []
      try {
        const raw = JSON.parse(readFileSync(outFile, 'utf8'))
        if (Array.isArray(raw)) library = raw
      } catch {
        /* 空题库 */
      }
      const index = library.findIndex((x) => x && x.id === entry.id)
      if (index >= 0) library[index] = entry
      else library.push(entry)
      mkdirSync(path.dirname(outFile), { recursive: true })
      const tmp = `${outFile}.tmp`
      writeFileSync(tmp, JSON.stringify(library, null, 2) + '\n', 'utf8')
      renameSync(tmp, outFile)
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              id,
              name,
              board,
              width: puzzle.width,
              height: puzzle.height,
              confidence: recognized.confidence,
              unique: verifiedUnique,
              written: path.relative(process.cwd(), outFile),
            },
            null,
            2,
          ),
        )
      } else {
        console.log(`[import] 已写入 ${args.out}：${id}（${name}）${index >= 0 ? '（覆盖）' : ''}`)
        console.log('[import] 浏览器里刷新页面即可在题库看到新题')
      }
    } else if (!args.append) {
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: !process.exitCode,
              width: puzzle.width,
              height: puzzle.height,
              rowTargets: puzzle.rowTargets,
              colTargets: puzzle.colTargets,
              board,
              confidence: recognized.confidence,
              font: recognized.font,
              unique: verifiedUnique,
              warning,
            },
            null,
            2,
          ),
        )
      } else {
        console.log('[import] 预览模式，未写入。加 --append 写入 data/library.json。')
      }
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  stopServer()
}
