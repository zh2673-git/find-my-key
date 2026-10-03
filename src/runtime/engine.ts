// 时空层级：运行时（runtime）—— 音频引擎：显式 init/start/stop/destroy（docs/02 §3）
// 空间管家：音频帧缓冲在此独占；stop 时整体移交分析层；destroy 按依赖逆序回收。

import { ANALYSIS_RATE } from '../core/constants'

export interface EngineHooks {
  /** 每收到一帧（512 样本 @16k≈32ms）回调，供 application 的 LivePitcher 等消费。 */
  onFrame?: (chunk: Float32Array) => void
}

/** 线性插值重采样（16k 之外的采样率兜底）。 */
export function resampleLinear(buf: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buf
  const ratio = fromRate / toRate
  const outLen = Math.floor(buf.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(buf.length - 1, i0 + 1)
    const frac = pos - i0
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac
  }
  return out
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private chunks: Float32Array[] = []

  /** 开辟全局空间：AudioContext(16k) + worklet 模块加载。 */
  async init(): Promise<void> {
    if (this.ctx) return
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor({ sampleRate: ANALYSIS_RATE })
    await this.ctx.audioWorklet.addModule(new URL('../infrastructure/capture-worklet.js', import.meta.url))
  }

  /** 启动时间流：mic → worklet → 消息泵（帧事件 + 实时音高回调）。 */
  async start(hooks: EngineHooks = {}): Promise<void> {
    if (!this.ctx) throw new Error('engine not initialized')
    await this.init()
    this.chunks = []

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    this.node = new AudioWorkletNode(this.ctx, 'capture-processor')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.chunks.push(e.data)
      hooks.onFrame?.(e.data)
    }
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.node)
    await this.ctx.resume()
  }

  /** 暂停时间流：断链 → 停轨 → 拼接缓冲（空间移交）。 */
  async stop(): Promise<Float32Array> {
    if (this.node) { this.node.disconnect(); this.node = null }
    if (this.source) { this.source.disconnect(); this.source = null }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
    const total = this.chunks.reduce((s, c) => s + c.length, 0)
    const raw = new Float32Array(total)
    let off = 0
    for (const c of this.chunks) { raw.set(c, off); off += c.length }
    this.chunks = []
    const actualRate = this.ctx ? this.ctx.sampleRate : ANALYSIS_RATE
    return resampleLinear(raw, actualRate, ANALYSIS_RATE)
  }

  /** 空间回收（依赖逆序）：node → tracks → ctx.close → 置空。 */
  async destroy(): Promise<void> {
    if (this.node) { this.node.disconnect(); this.node = null }
    if (this.source) { this.source.disconnect(); this.source = null }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
    this.chunks = []
    if (this.ctx) { await this.ctx.close(); this.ctx = null }
  }

  get running(): boolean {
    return this.stream !== null
  }
}
