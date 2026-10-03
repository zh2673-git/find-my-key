// 时空层级：数据规范（core）—— 离线音频合成器（测试真值源 + UI 演示模式共用），纯函数

export interface SynthNote {
  midi: number
  durMs: number
}

export interface SynthOptions {
  fs?: number          // 采样率，默认 16000
  gapMs?: number       // 音符间隙，默认 60
  harmonics?: number[] // 谐波幅度表，默认 [1, .5, .25, .125]
  amp?: number         // 总幅度，默认 0.25
}

/** 合成一段单声道旋律（谐波叠加 + 起音/释放包络），16kHz。 */
export function synthMelody(notes: SynthNote[], opts?: SynthOptions): Float32Array {
  const fs = opts?.fs ?? 16000
  const gapMs = opts?.gapMs ?? 60
  const harm = opts?.harmonics ?? [1, 0.5, 0.25, 0.125]
  const amp = opts?.amp ?? 0.25

  const attackSec = 0.01
  const releaseSec = 0.03
  let totalMs = 200 // 首尾静音余量
  for (const n of notes) totalMs += n.durMs + gapMs
  const total = Math.ceil((totalMs / 1000) * fs)
  const out = new Float32Array(total)

  let cursor = Math.floor(0.1 * fs) // 首部 100ms 静音
  for (const n of notes) {
    const len = Math.floor((n.durMs / 1000) * fs)
    const f0 = 440 * Math.pow(2, (n.midi - 69) / 12)
    for (let i = 0; i < len; i++) {
      const t = i / fs
      let env = 1
      if (t < attackSec) env = t / attackSec
      const relStart = (n.durMs / 1000) - releaseSec
      if (t > relStart) env = Math.max(0, (n.durMs / 1000 - t) / releaseSec)
      let s = 0
      for (let k = 0; k < harm.length; k++) {
        s += harm[k] * Math.sin(2 * Math.PI * f0 * (k + 1) * t)
      }
      const idx = cursor + i
      if (idx < total) out[idx] += amp * env * s
    }
    cursor += len + Math.floor((gapMs / 1000) * fs)
  }
  return out
}

/** 合成指数滑音（对数频率线性爬升），用于音域校准测试。相位累加器保证瞬时频率精确。 */
export function synthGliss(fromHz: number, toHz: number, durMs: number, fs = 16000, amp = 0.2): Float32Array {
  const total = Math.ceil((durMs / 1000) * fs)
  const out = new Float32Array(total)
  const durSec = durMs / 1000
  const dPhase = 2 * Math.PI / fs
  let phase = 0
  for (let i = 0; i < total; i++) {
    const t = i / fs
    const p = t / durSec
    const f = fromHz * Math.pow(toHz / fromHz, p)
    phase += dPhase * f
    const env = Math.min(1, p * 30, (1 - p) * 30) // 两端淡入淡出
    out[i] = amp * env * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)) / 1.3
  }
  return out
}

/** 内置演示旋律：《小星星》首句，G 大调（简谱 1 1 5 5 6 6 5-）。 */
export function DEMO_TWINKLE_G(): SynthNote[] {
  return [
    { midi: 55, durMs: 420 },
    { midi: 55, durMs: 420 },
    { midi: 62, durMs: 420 },
    { midi: 62, durMs: 420 },
    { midi: 64, durMs: 420 },
    { midi: 64, durMs: 420 },
    { midi: 62, durMs: 840 },
  ]
}

/** 内置演示音阶：C 大调 do–si–高do（音阶定调测试真值 + UI 演示共用）。 */
export function DEMO_SCALE_C(): SynthNote[] {
  return [60, 62, 64, 65, 67, 69, 71, 72].map(midi => ({ midi, durMs: 500 }))
}
