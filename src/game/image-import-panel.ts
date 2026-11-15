/**
 * 方阵和 —— 图片导入面板
 *
 * 选图 → 自动识别行/列目标 → 表格里可逐格修正 → 用规则引擎确认有解后入库。
 * 识别只给候选值，最终以用户确认为准。
 */

import type { ImportHost, Puzzle } from '../core/types'
import type { ImportCheck } from './types'
import { recognizePuzzle, toPuzzle, type RecognizedPuzzle } from './image-import'
import { encodeImport } from './text-import'

export interface ImageImportDeps {
  /** 用规则引擎检查题面；error 拒绝入库，warning 提示后确认可继续 */
  check: ImportCheck
  maxSize: number
}

export function mountImageImport(panel: HTMLElement, host: ImportHost, deps: ImageImportDeps): void {
  panel.innerHTML = `
    <div class="import-head">
      <h2>从图片导入</h2>
      <button class="btn" id="img-close" type="button">关闭</button>
    </div>
    <div class="import-row">
      <input type="file" id="img-file" accept="image/*" />
      <label class="import-name">名称 <input id="img-name" type="text" placeholder="自动命名" /></label>
    </div>
    <div class="import-hint">
      选一张方阵和题面截图：程序会找出网格线，并读取右侧的行目标与底部的列目标。
      识别结果可以在下方表格里逐格修改，确认无误后入库。
    </div>
    <div class="import-stage" id="img-stage" hidden>
      <canvas id="img-canvas"></canvas>
    </div>
    <div class="import-targets" id="img-targets" hidden>
      <div class="import-targets-col">
        <h3>行目标（右侧）</h3>
        <div class="import-target-list" id="img-rows"></div>
      </div>
      <div class="import-targets-col">
        <h3>列目标（底部）</h3>
        <div class="import-target-list" id="img-cols"></div>
      </div>
    </div>
    <div class="import-info" id="img-info">还没有图片。</div>
    <div class="toolbar">
      <button class="btn" id="img-redetect" type="button">重新识别</button>
      <button class="btn primary" id="img-save" type="button">保存到题库并载入</button>
    </div>
    <div class="import-msg" id="img-msg"></div>
  `

  const fileInput = panel.querySelector<HTMLInputElement>('#img-file')!
  const nameInput = panel.querySelector<HTMLInputElement>('#img-name')!
  const stage = panel.querySelector<HTMLElement>('#img-stage')!
  const canvas = panel.querySelector<HTMLCanvasElement>('#img-canvas')!
  const targets = panel.querySelector<HTMLElement>('#img-targets')!
  const rowsBox = panel.querySelector<HTMLElement>('#img-rows')!
  const colsBox = panel.querySelector<HTMLElement>('#img-cols')!
  const info = panel.querySelector<HTMLElement>('#img-info')!

  let recognized: RecognizedPuzzle | null = null
  let currentFile: File | null = null
  let fileBaseName = ''
  let objectUrl: string | null = null
  /** 已提示过的警告键（同一题面第二次点击才真正导入） */
  let warnKey: string | null = null

  const renderTargets = (): void => {
    if (!recognized || recognized.error) {
      targets.hidden = true
      return
    }
    targets.hidden = false
    rowsBox.innerHTML = recognized.rowTargets
      .map(
        (v, i) =>
          `<label class="import-target"><span>第 ${i + 1} 行</span><input type="number" min="0" data-kind="row" data-i="${i}" value="${v}" /></label>`,
      )
      .join('')
    colsBox.innerHTML = recognized.colTargets
      .map(
        (v, i) =>
          `<label class="import-target"><span>第 ${i + 1} 列</span><input type="number" min="0" data-kind="col" data-i="${i}" value="${v}" /></label>`,
      )
      .join('')
    panel.querySelectorAll<HTMLInputElement>('.import-target input').forEach((el) => {
      el.addEventListener('input', () => {
        if (!recognized) return
        warnKey = null
        const i = Number(el.dataset.i)
        const value = Math.max(0, Number(el.value) || 0)
        if (el.dataset.kind === 'row') recognized.rowTargets[i] = value
        else recognized.colTargets[i] = value
        updateInfo()
      })
    })
  }

  const updateInfo = (): void => {
    if (!recognized) {
      info.textContent = '还没有图片。'
      info.className = 'import-info'
      return
    }
    if (recognized.error) {
      info.textContent = recognized.error
      info.className = 'import-info bad'
      return
    }
    const pct = Math.round(recognized.confidence * 100)
    info.textContent =
      `识别到 ${recognized.width}×${recognized.height} · ` +
      `置信度 ${pct}%（字体 ${recognized.font}）· 已读取 ${recognized.rowTargets.length} 行 + ${recognized.colTargets.length} 列`
    info.className = 'import-info ok'
  }

  const drawPreview = async (file: File): Promise<void> => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(file)
    const image = new Image()
    await new Promise<void>((resolve) => {
      image.onload = () => resolve()
      image.onerror = () => resolve()
      image.src = objectUrl!
    })
    if (!image.naturalWidth) return
    const scale = Math.min(1, 760 / image.naturalWidth)
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    stage.hidden = false
  }

  const run = async (file: File): Promise<void> => {
    currentFile = file
    warnKey = null
    host.message('')
    await drawPreview(file)
    info.textContent = '识别中…'
    info.className = 'import-info'
    const result = await recognizePuzzle(file, { maxSize: deps.maxSize })
    recognized = result
    if (!result.error && !nameInput.value.trim()) {
      const base = fileBaseName || '图片导入'
      nameInput.value = `${base} · ${result.width}×${result.height}`
    }
    renderTargets()
    updateInfo()
    if (result.error) host.message(result.error, 'bad')
    else host.message(`识别完成：${result.width}×${result.height}。请核对右侧数值。`, 'ok')
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    fileBaseName = file.name.replace(/\.[^.]+$/, '')
    nameInput.value = ''
    fileInput.blur()
    void run(file)
  })

  panel.querySelector('#img-redetect')?.addEventListener('click', () => {
    if (!currentFile) {
      host.message('请先选择图片。', 'bad')
      return
    }
    void run(currentFile)
  })

  panel.querySelector('#img-close')?.addEventListener('click', () => host.close())

  panel.querySelector('#img-save')?.addEventListener('click', () => {
    if (!recognized || recognized.error) {
      host.message('请先选择图片并完成识别。', 'bad')
      return
    }
    const { width, height, rowTargets, colTargets } = recognized
    const key = `${width}x${height}|${rowTargets.join(',')}|${colTargets.join(',')}`
    const outcome = deps.check(rowTargets, colTargets, width, height)
    if (outcome.error) {
      warnKey = null
      host.message(outcome.error, 'bad')
      return
    }
    if (outcome.warning && warnKey !== key) {
      warnKey = key
      host.message(`⚠ ${outcome.warning} 再点一次「保存到题库并载入」仍然导入。`, 'bad')
      return
    }
    const name = nameInput.value.trim() || `图片导入 · ${width}×${height}`
    const id = `kakurasu-custom-image-${width}x${height}-${Date.now()}`
    const puzzle = toPuzzle(recognized, name, id) as Puzzle | null
    if (!puzzle) {
      host.message('构造题面失败。', 'bad')
      return
    }
    warnKey = null
    host.loadPuzzle(puzzle)
    const note = outcome.warning ? `（${outcome.warning}）` : ''
    host.message(`已导入「${name}」${note}，题面 ${encodeImport(rowTargets, colTargets)}`, 'ok')
    host.close()
  })
}
