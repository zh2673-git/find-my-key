// 时空层级：基础设施（infrastructure）—— 琴键标准音/原声回放（docs/08）+ 旋律时序回放（v1.4，docs/11）
// 懒创建独立 AudioContext：与采集引擎（runtime/engine）互不持有、互不管理生命周期；
// dispose 由页面 beforeunload 显式调用。录音不落盘不上传（隐私铁律）。

import { ANALYSIS_RATE } from '../core/constants'

export interface SeqNote {
  midi: number
  startSec: number   // 相对旋律起点（哼唱分析缓冲的秒时刻）
  durSec: number
}

export class PianoPlayer {
  private ctx: AudioContext | null = null

  /** 懒开辟播放空间：首次发声时创建；被用户手势触发即满足自动播放策略。 */
  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** 标准音：三角波基频 + 八度泛音点缀，指数衰减模拟拨弦。 */
  play(midi: number, durSec = 0.7): void {
    const ctx = this.ensure()
    const t = ctx.currentTime
    const freq = 440 * Math.pow(2, (midi - 69) / 12)

    const g = ctx.createGain()
    g.connect(ctx.destination)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSec)

    const o1 = ctx.createOscillator()
    o1.type = 'triangle'
    o1.frequency.value = freq
    const o2 = ctx.createOscillator()
    o2.type = 'sine'
    o2.frequency.value = freq * 2
    const g2 = ctx.createGain()
    g2.gain.value = 0.18
    o1.connect(g)
    o2.connect(g2)
    g2.connect(g)
    o1.start(t)
    o2.start(t)
    o1.stop(t + durSec + 0.05)
    o2.stop(t + durSec + 0.05)
  }

  /**
   * 柱式和弦（v1.10）：所有音同一时刻起振。多音叠加会变响，单音包络增益按音数均摊
   * （0.35 → 0.35/√n），听感响度接近单音。
   * 返回停止函数（v1.12）：弹唱模式下点和弦时和弦要铺满整段，提前切换需停掉仍在响的发声体。
   */
  playChord(midis: number[], durSec = 1.4): () => void {
    if (!midis.length) return () => {}
    const ctx = this.ensure()
    const t = ctx.currentTime
    const amp = 0.35 / Math.sqrt(midis.length)
    const oscs: OscillatorNode[] = []
    for (const midi of midis) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const g = ctx.createGain()
      g.connect(ctx.destination)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(amp, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t + durSec)
      const o1 = ctx.createOscillator()
      o1.type = 'triangle'
      o1.frequency.value = freq
      const g2 = ctx.createGain()
      g2.gain.value = 0.18
      const o2 = ctx.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = freq * 2
      o1.connect(g)
      o2.connect(g2)
      g2.connect(g)
      oscs.push(o1, o2)
      o1.start(t)
      o2.start(t)
      o1.stop(t + durSec + 0.05)
      o2.stop(t + durSec + 0.05)
    }
    return () => {
      for (const o of oscs) { try { o.stop() } catch { /* 已自然结束，stop 抛错忽略 */ } }
    }
  }

  /**
   * 琶音（v1.10）：和弦音从低到高依次弹出（stepSec 间隔）。
   * 复用 playSequence 的时序调度：onNote 供琴键逐键高亮，返回停止函数。
   */
  playArpeggio(midis: number[], onNote?: (i: number) => void, stepSec = 0.18): () => void {
    const notes: SeqNote[] = midis.map((midi, i) => ({
      midi,
      startSec: i * stepSec,
      durSec: Math.max(0.5, (midis.length - i) * stepSec + 0.5),
    }))
    return this.playSequence(notes, i => onNote?.(i), () => onNote?.(-1))
  }

  /**
   * 旋律回放（v1.4）：按哼唱原时序调度标准音——"按你哼的节奏"演奏；
   * 每音触发 onNote(i) 供琴键高亮跟随，全部结束后回调 onEnd。
   * setTimeout 调度（误差 ~10ms，对视觉跟随与听感足够）；返回停止函数（清全部定时器）。
   */
  playSequence(notes: SeqNote[], onNote: (i: number) => void, onEnd: () => void): () => void {
    const timers: number[] = []
    if (notes.length > 0) {
      const ctx = this.ensure()
      const t0 = ctx.currentTime + 0.15
      notes.forEach((n, i) => {
        const delayMs = (t0 + n.startSec - ctx.currentTime) * 1000
        timers.push(window.setTimeout(() => {
          this.play(n.midi, Math.min(Math.max(n.durSec, 0.15), 1.2))
          onNote(i)
        }, Math.max(0, delayMs)))
      })
      const last = notes[notes.length - 1]
      const endMs = (t0 + last.startSec + last.durSec - ctx.currentTime) * 1000
      timers.push(window.setTimeout(onEnd, Math.max(0, endMs) + 150))
    } else {
      timers.push(window.setTimeout(onEnd, 0))
    }
    return () => timers.forEach(id => window.clearTimeout(id))
  }

  /**
   * 原声回放：16k 分析缓冲切片 → AudioBuffer（自带采样率，浏览器播放时自动重采样）。
   * fromSec/toSec 为分析缓冲内的时间区间（与音符 startSec/endSec 同基准）。
   * 峰值归一化（v1.4.2）：麦克风哼鸣录音电平天然远低于合成音——按切片峰值放大到 0.9，
   * 增益上限 6 倍防极端底噪被放大成爆音；同一响度基准与钢琴标准音对齐。
   */
  /** 当前在播的原声源（v1.8.7：支持中途停止——同一时刻至多一段原声）。 */
  private bufferSrc: AudioBufferSourceNode | null = null

  playBuffer(buf: Float32Array, fromSec = 0, toSec = buf.length / ANALYSIS_RATE, onProgress?: (tSec: number | null) => void): void {
    if (buf.length === 0) return
    const ctx = this.ensure()
    const i0 = Math.max(0, Math.floor(fromSec * ANALYSIS_RATE))
    const i1 = Math.min(buf.length, Math.ceil(toSec * ANALYSIS_RATE))
    if (i1 - i0 < 16) return

    this.stopBuffer() // 重播前先停掉上一段，防叠音
    const slice = buf.slice(i0, i1)
    let peak = 0
    for (let i = 0; i < slice.length; i++) {
      const a = Math.abs(slice[i])
      if (a > peak) peak = a
    }
    if (peak < 1e-4) return  // 纯静音切片不发
    const gain = Math.min(0.9 / peak, 6)

    const ab = ctx.createBuffer(1, slice.length, ANALYSIS_RATE)
    ab.copyToChannel(slice, 0)
    const src = ctx.createBufferSource()
    src.buffer = ab
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(ctx.destination)
    const startCtx = ctx.currentTime
    let raf = 0
    src.onended = () => {
      if (this.bufferSrc === src) this.bufferSrc = null
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      onProgress?.(null) // null = 播放结束（自然播完；中途 stop 由 stopBuffer 静默，见下）
    }
    this.bufferSrc = src
    src.start()
    // 播放进度（v1.12）：rAF 上报当前时刻，供画布播放头同步扫过（对节奏）
    if (onProgress) {
      const tick = () => {
        if (this.bufferSrc !== src) return
        onProgress(Math.min(fromSec + (ctx.currentTime - startCtx), toSec))
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
  }

  /** 停止正在播放的原声（v1.8.7）。无在播原声时为无害空操作。
   * v1.12：中途停止不再触发 onended——旧播放的清理回调不得误伤刚启动的新播放。 */
  stopBuffer(): void {
    if (!this.bufferSrc) return
    const s = this.bufferSrc
    this.bufferSrc = null
    s.onended = null
    try { s.stop() } catch { /* 已停止/未开始时 stop 抛错，忽略 */ }
  }

  /** 空间回收（页面卸载调用）。 */
  dispose(): void {
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
  }
}
