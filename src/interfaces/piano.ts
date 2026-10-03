// 时空层级：数据接口（interfaces）—— 钢琴对照键盘组件（docs/08）
// 纯 DOM 组件：C3–C6 三组八度；键上实时标注"当前调的简谱数字"（与 toSolfege 同源：
// 共用 domain 的 labelForPitch / DEGREE_MAP，I 不变量）；点击回调交由 UI 编排 A/B 闭环。
// destroy = 移除节点；无定时器无泄漏。

import { NOTE_NAMES } from '../core/constants'
import type { Mode } from '../core/types'
import { labelForPitch } from '../domain/solfege'

const LOW_MIDI = 48    // C3
const HIGH_MIDI = 84   // C6
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]
const BLACK_PCS = [1, 3, 6, 8, 10]

export class PianoBoard {
  private host: HTMLElement | null = null
  private tonicPc = 0
  private mode: Mode = 'major'
  private clickCb: ((midi: number) => void) | null = null
  // ── 音区（v1.5 自适应）：默认 C3–C6，哼唱分析后按旋律范围自动扩展，解决"低音被夹到最左键" ──
  private lowMidi = LOW_MIDI
  private highMidi = HIGH_MIDI
  // ── 跟弹指引状态（v1.4，docs/11）──
  private guideSeq: number[] = []
  private guideIdx = 0
  private guideDoneCb: (() => void) | null = null

  /** 挂载到容器（重复调用即重挂载）。 */
  render(el: HTMLElement): void {
    this.host = el
    this.draw()
  }

  /**
   * 音区自适应（v1.5）：把显示范围扩展到覆盖 [low, high]（含 ±2 半音余量由调用方给），
   * 边界对齐到 C（low 向下取整、high 向上取整），夹取 C1(24)–C7(96)。
   * 超出显示范围的音符此前会被夹到最边缘键——这是"低音显示不对"的根因。
   */
  setRange(low: number, high: number): void {
    const lo = Math.max(24, 12 * Math.floor(low / 12))
    const hi = Math.min(96, 12 * Math.ceil(high / 12))
    if (hi <= lo) return
    if (lo === this.lowMidi && hi === this.highMidi) return
    this.lowMidi = lo
    this.highMidi = hi
    if (this.host) this.draw()
  }

  /** 主音切换：只改标签不改键位（大调 do=tonicPc；小调 la 式 base=tonicPc+3）。 */
  setKey(tonicPc: number, mode: Mode): void {
    this.tonicPc = tonicPc
    this.mode = mode
    if (this.host) this.draw()
  }

  /** 高亮某个琴键（null 清除）；超界夹取到当前音区。 */
  highlight(midi: number | null): void {
    if (!this.host) return
    this.host.querySelector('.pkey.active')?.classList.remove('active')
    if (midi === null) return
    const m = this.clamp(midi)
    this.host.querySelector(`[data-midi="${m}"]`)?.classList.add('active')
  }

  /** 多键高亮（v1.10 和弦演奏）：chord-active 类，与旋律 active 互不干扰；null 清除。 */
  highlightMulti(midis: number[] | null): void {
    if (!this.host) return
    this.host.querySelectorAll('.pkey.chord-active').forEach(el => el.classList.remove('chord-active'))
    if (!midis) return
    for (const midi of midis) {
      const m = this.clamp(midi)
      this.host.querySelector(`[data-midi="${m}"]`)?.classList.add('chord-active')
    }
  }

  /** 夹取到当前音区（自适应扩展后极少真的截断）。 */
  private clamp(midi: number): number {
    return Math.max(this.lowMidi, Math.min(this.highMidi, Math.round(midi)))
  }

  // ── 跟弹指引（v1.4）：键上按顺序标序号气泡，指针键脉冲提示"下一个点我"，点对前进、点错抖动 ──

  /** 开启跟弹：seq 为旋律的 midi 序列；全部点对后回调 onDone。 */
  showGuide(seq: number[], onDone?: () => void): void {
    this.guideSeq = seq.map(m => this.clamp(m))
    this.guideIdx = 0
    this.guideDoneCb = onDone ?? null
    this.applyGuide()
  }

  /** 已点对的数量（进度显示用）。 */
  guideIndex(): number {
    return this.guideIdx
  }

  /** 跟弹模式是否进行中。 */
  guideActive(): boolean {
    return this.guideSeq.length > 0
  }

  /** 跟弹点击：点对 → 前进并刷新提示；点错 → 该键抖动。返回是否点对。 */
  advance(clickedMidi: number): boolean {
    if (!this.guideSeq.length) return true
    const m = this.clamp(clickedMidi)
    if (m !== this.guideSeq[this.guideIdx]) {
      const key = this.host?.querySelector(`[data-midi="${m}"]`)
      key?.classList.add('wrong')
      window.setTimeout(() => key?.classList.remove('wrong'), 350)
      return false
    }
    this.guideIdx++
    if (this.guideIdx >= this.guideSeq.length) {
      const cb = this.guideDoneCb
      this.guideSeq = []
      this.guideIdx = 0
      this.guideDoneCb = null
      this.applyGuide()
      cb?.()
      return true
    }
    this.applyGuide()
    return true
  }

  clearGuide(): void {
    this.guideSeq = []
    this.guideIdx = 0
    this.guideDoneCb = null
    this.applyGuide()
  }

  /** 依据 guideSeq/guideIdx 重建染色与气泡（draw 重绘后调用即自动恢复）。
   *  v1.4.2 修正：气泡只放"当前该点的键"一个（显示第 N 个）——旋律里连续同音时
   *  多个气泡叠同一键会错乱；已点的键直接 .gdone 染色，不再放 ✓ 气泡。 */
  private applyGuide(): void {
    if (!this.host) return
    this.host.querySelectorAll('.gbadge').forEach(b => b.remove())
    this.host.querySelectorAll('.pkey.guide, .pkey.gdone').forEach(k => k.classList.remove('guide', 'gdone'))
    for (let i = 0; i < this.guideIdx && i < this.guideSeq.length; i++) {
      this.host.querySelector(`[data-midi="${this.guideSeq[i]}"]`)?.classList.add('gdone')
    }
    const next = this.guideSeq[this.guideIdx]
    if (next !== undefined) {
      const nk = this.host.querySelector(`[data-midi="${next}"]`)
      nk?.classList.add('guide')
      const badge = document.createElement('span')
      badge.className = 'gbadge'
      badge.textContent = String(this.guideIdx + 1)
      nk?.appendChild(badge)
    }
  }

  onKeyClick(cb: (midi: number) => void): void {
    this.clickCb = cb
  }

  destroy(): void {
    if (this.host) this.host.innerHTML = ''
    this.host = null
    this.clickCb = null
  }

  private draw(): void {
    const host = this.host
    if (!host) return
    host.innerHTML = ''
    const piano = document.createElement('div')
    piano.className = 'piano'

    const base = this.mode === 'minor' ? (this.tonicPc + 3) % 12 : this.tonicPc
    // 音区自适应（v1.5）：白键数按实际范围计算；键太挤时容器横向滚动
    let whiteCount = 0
    for (let m = this.lowMidi; m <= this.highMidi; m++) {
      if (!BLACK_PCS.includes(((m % 12) + 12) % 12)) whiteCount++
    }
    piano.style.minWidth = `${Math.max(whiteCount * 36, 600)}px`
    const whiteW = 100 / whiteCount
    const blackW = whiteW * 0.62

    let whiteIdx = 0
    for (let midi = this.lowMidi; midi <= this.highMidi; midi++) {
      const pc = ((midi % 12) + 12) % 12
      const { degree, accidental, symbol } = labelForPitch(midi, base)
      const isBlack = BLACK_PCS.includes(pc)
      const key = document.createElement('div')
      key.className = `pkey ${isBlack ? 'black' : 'white'}`
      key.dataset.midi = String(midi)

      const label = document.createElement('span')
      label.className = 'plabel'
      label.textContent = symbol
      key.appendChild(label)

      // do 键标记（v1.4.1）：当前调的"1"染色高亮，一眼锁定简谱基准键
      if (degree === 1 && accidental === 0) key.classList.add('do-key')

      // 白键 C 附注音名（和"音域/调性"里的 C4、G4 互相印证）
      if (!isBlack && pc === 0) {
        const sub = document.createElement('span')
        sub.className = 'psub'
        sub.textContent = NOTE_NAMES[pc] + (Math.floor(midi / 12) - 1)
        key.appendChild(sub)
      }
      if (accidental !== 0) key.classList.add('alt')

      key.addEventListener('click', () => {
        this.clickCb?.(midi)
        key.classList.add('hit')
        window.setTimeout(() => key.classList.remove('hit'), 200)
      })

      if (isBlack) {
        key.style.left = `${whiteIdx * whiteW - blackW / 2}%`
        key.style.width = `${blackW}%`
        piano.appendChild(key)
      } else {
        piano.appendChild(key)
        whiteIdx++
      }
    }

    host.appendChild(piano)
    // 重绘后恢复跟弹指引（setKey 会触发全量重绘）
    this.applyGuide()
  }
}
