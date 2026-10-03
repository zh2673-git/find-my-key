// 时空层级：流转-规则（domain）—— 帧级 F0 轨迹：滑窗 YIN + 自适应静音门 + 中值滤波 + 八度纠错（docs/04）

import { ANALYSIS_RATE, FRAME_SIZE, HOP, VOICED_PROB, RMS_ABS_FLOOR, RMS_P95_RATIO, MEDIAN_WIN, OCTAVE_FIX_WIN, OCTAVE_FIX_ST } from '../core/constants'
import type { PitchFrame, PitchTrack } from '../core/types'
import { yinDetect } from './yin'

export function trackPitch(buf: Float32Array, fs: number = ANALYSIS_RATE): PitchTrack {
  const frames: PitchFrame[] = []

  for (let start = 0; start + FRAME_SIZE <= buf.length; start += HOP) {
    const seg = buf.subarray(start, start + FRAME_SIZE)
    let sq = 0
    for (let i = 0; i < FRAME_SIZE; i++) sq += seg[i] * seg[i]
    const rms = Math.sqrt(sq / FRAME_SIZE)
    const { hz, probability } = yinDetect(seg, fs)
    const midi = hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0
    frames.push({
      t: (start + FRAME_SIZE / 2) / fs,
      midi,
      prob: probability,
      rms,
      voiced: probability >= VOICED_PROB && hz > 0,
    })
  }

  // 自适应静音门（全局 p95 相对阈值）
  const rmsSorted = frames.map(f => f.rms).sort((a, b) => a - b)
  const p95 = rmsSorted.length ? rmsSorted[Math.min(rmsSorted.length - 1, Math.floor(rmsSorted.length * 0.95))] : 0
  const floor = Math.max(RMS_ABS_FLOOR, p95 * RMS_P95_RATIO)
  for (const f of frames) if (f.voiced && f.rms < floor) f.voiced = false

  medianFilterVoiced(frames)
  octaveFix(frames)

  return { frames, hopSec: HOP / fs }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 仅对有声帧做窗 5 中值滤波（无声帧不参与也不被改写）。 */
function medianFilterVoiced(frames: PitchFrame[]): void {
  const n = frames.length
  const out: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    if (!frames[i].voiced) continue
    const win: number[] = []
    for (let j = Math.max(0, i - (MEDIAN_WIN >> 1)); j <= Math.min(n - 1, i + (MEDIAN_WIN >> 1)); j++) {
      if (frames[j].voiced) win.push(frames[j].midi)
    }
    out[i] = median(win)
  }
  for (let i = 0; i < n; i++) if (frames[i].voiced) frames[i].midi = out[i]
}

/** 八度跳变纠错：与局部中位差 > 9 半音的孤立帧回贴局部中位。 */
function octaveFix(frames: PitchFrame[]): void {
  const n = frames.length
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    if (!f.voiced) continue
    const win: number[] = []
    for (let j = Math.max(0, i - OCTAVE_FIX_WIN); j <= Math.min(n - 1, i + OCTAVE_FIX_WIN); j++) {
      if (frames[j].voiced) win.push(frames[j].midi)
    }
    if (win.length < 3) continue
    const med = median(win)
    if (Math.abs(f.midi - med) > OCTAVE_FIX_ST) f.midi = med
  }
}
