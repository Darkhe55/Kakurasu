/**
 * 方阵和 —— 文本导入面板
 *
 * 输入框接受模板的题面编码（`puzzles-data.ts` 里 board 字段的同一格式）：
 *   39,70,62,71,53,51|52,76,39,34,59,75
 * 也接受题库条目 JSON。解析后显示预览与校验结果，确认才写入题库。
 */

import type { ImportHost, Puzzle } from '../core/types'
import type { ImportCheck } from './types'
import { parseImport, toPuzzle, validateImport, type ParsedImport } from './text-import'

export interface TextImportDeps {
  maxSize: number
  /** 用规则引擎检查题面；error 拒绝入库，warning 提示后确认可继续 */
  check: ImportCheck
}

export function mountTextImport(panel: HTMLElement, host: ImportHost, deps: TextImportDeps): void {
  panel.innerHTML = `
    <div class="import-head">
      <h2>从文本导入</h2>
      <button class="btn" id="text-close" type="button">关闭</button>
    </div>
    <div class="import-hint">
      按模板题面格式填写：<code>行目标|列目标</code>，逗号分隔。例如
      <code>39,70,62|52,76,39</code>。也可以直接粘贴题库条目 JSON（含 <code>board</code> 字段），
      或省略 <code>|</code> 并填好宽高。区块数可以互换顺序，空格与换行都会被忽略。
    </div>
    <div class="import-row">
      <label class="import-name">宽 <input id="text-w" type="number" min="2" max="${deps.maxSize}" placeholder="自动" /></label>
      <label class="import-name">高 <input id="text-h" type="number" min="2" max="${deps.maxSize}" placeholder="自动" /></label>
      <label class="import-name">名称 <input id="text-name" type="text" placeholder="自动命名" /></label>
    </div>
    <textarea id="text-input" class="import-textarea" spellcheck="false" rows="5"
      placeholder="39,70,62,71,53,51,69,40|52,76,39,34,59,75,49,73"></textarea>
    <div class="import-info" id="text-info">等待输入。</div>
    <div class="toolbar">
      <button class="btn primary" id="text-save" type="button">保存到题库并载入</button>
    </div>
    <div class="import-msg" id="text-msg"></div>
  `

  const input = panel.querySelector<HTMLTextAreaElement>('#text-input')!
  const wInput = panel.querySelector<HTMLInputElement>('#text-w')!
  const hInput = panel.querySelector<HTMLInputElement>('#text-h')!
  const nameInput = panel.querySelector<HTMLInputElement>('#text-name')!
  const info = panel.querySelector<HTMLElement>('#text-info')!
  /** 已提示过的警告键（同一题面第二次点击才真正导入） */
  let warnKey: string | null = null

  const current = (): ParsedImport => {
    const w = Number(wInput.value) || 0
    const h = Number(hInput.value) || 0
    return parseImport(input.value, {
      width: w > 0 ? w : undefined,
      height: h > 0 ? h : undefined,
      maxSize: deps.maxSize,
    })
  }

  const refresh = (): ParsedImport => {
    const parsed = current()
    const err = validateImport(parsed, deps.maxSize)
    if (err) {
      info.className = 'import-info bad'
      info.textContent = err
    } else {
      info.className = 'import-info ok'
      info.textContent = `${parsed.width}×${parsed.height} · 行目标 ${parsed.height} 个 · 列目标 ${parsed.width} 个`
    }
    return parsed
  }

  input.addEventListener('input', () => {
    warnKey = null
    refresh()
  })
  wInput.addEventListener('input', () => {
    warnKey = null
    refresh()
  })
  hInput.addEventListener('input', () => {
    warnKey = null
    refresh()
  })

  panel.querySelector('#text-close')?.addEventListener('click', () => host.close())

  panel.querySelector('#text-save')?.addEventListener('click', () => {
    const parsed = refresh()
    const err = validateImport(parsed, deps.maxSize)
    if (err) {
      host.message(`无法导入：${err}`, 'bad')
      return
    }
    const key = `${parsed.width}x${parsed.height}|${parsed.rowTargets.join(',')}|${parsed.colTargets.join(',')}`
    const outcome = deps.check(parsed.rowTargets, parsed.colTargets, parsed.width, parsed.height)
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
    const name = nameInput.value.trim() || `文本导入 · ${parsed.width}×${parsed.height}`
    const id = `kakurasu-custom-text-${parsed.width}x${parsed.height}-${Date.now()}`
    const puzzle = toPuzzle(parsed, name, id) as Puzzle | null
    if (!puzzle) {
      host.message('构造题面失败。', 'bad')
      return
    }
    warnKey = null
    host.loadPuzzle(puzzle)
    if (outcome.warning) host.message(`已导入「${name}」（${outcome.warning}）`, '')
    else host.message(`已导入「${name}」。`, 'ok')
    host.close()
  })

  refresh()
}
