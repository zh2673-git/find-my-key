// 时空层级：流转-编排（application）—— 会话状态机与用例编排（docs/03 §3）

import { ANALYSIS_RATE, FRAME_SIZE, HOP, VOICED_PROB } from '../core/constants'
import { DomainError } from '../core/errors'
import type { AnalysisResult, KeyCandidate, Mode, PitchTrack, SolfegeNote, VoiceRange } from '../core/types'
import { trackPitch } from '../domain/pitch-track'
import { segmentNotes } from '../domain/segment'
import { inferKey } from '../domain/tonality'
import { toSolfege } from '../domain/solfege'
import { matchScale } from '../domain/scale-match'
import type { ScaleMatch } from '../domain/scale-match'
import { measureRange } from '../domain/voice-range'
import { yinDetect } from '../domain/yin'

/** 翻译用例：采集缓冲 → 音高轨迹 → 音符 → 调性 → 首调唱名（严格顺序管道）。 */
export function analyzeRecording(buf: Float32Array, fs: number = ANALYSIS_RATE): AnalysisResult {
  const track = trackPitch(buf, fs)
  const notes = segmentNotes(track)
  if (notes.length === 0) throw new DomainError('NO_TONE')
  const keys = inferKey(notes)
  const solfege = toSolfege(notes, keys[0])
  return { track, notes, keys, solfege }
}

/** 校准用例：滑音缓冲 → 舒适音域 + 推荐主音。 */
export function analyzeRange(buf: Float32Array, fs: number = ANALYSIS_RATE): VoiceRange {
  return measureRange(trackPitch(buf, fs))
}

/** 音阶定调用例（v1.2）：唱 1234567 → 判定 do 在哪 + 音准偏差（docs/09）。 */
export function analyzeScale(buf: Float32Array, fs: number = ANALYSIS_RATE): ScaleMatch {
  return matchScale(segmentNotes(trackPitch(buf, fs)))
}

/** 主音切换重映射：只重算唱名映射，绝不重算切分（I 不变量）。 */
export function rekey(result: AnalysisResult, tonicPc: number, mode: Mode): SolfegeNote[] {
  return toSolfege(result.notes, { tonicPc, mode, score: 0 })
}

/**
 * 校准实时音高句柄：滑动窗逐次 YIN，供 UI 实时画布。
 * 有状态但短命——随录音 stop 一并丢弃（见 docs/07 生命周期说明）。
 */
export class LivePitcher {
  private buf: Float32Array = new Float32Array(0)

  push(chunk: Float32Array, cb: (midi: number | null) => void): void {
    const merged = new Float32Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    this.buf = merged.length > FRAME_SIZE * 4 ? merged.subarray(merged.length - FRAME_SIZE * 4) : merged
    if (this.buf.length >= FRAME_SIZE) {
      const seg = this.buf.subarray(this.buf.length - FRAME_SIZE)
      let sq = 0
      for (let i = 0; i < seg.length; i++) sq += seg[i] * seg[i]
      const rms = Math.sqrt(sq / seg.length)
      const { hz, probability } = yinDetect(seg, ANALYSIS_RATE)
      if (hz > 0 && probability >= VOICED_PROB && rms > 0.004) {
        cb(69 + 12 * Math.log2(hz / 440))
        return
      }
    }
    cb(null)
  }
}

/** 供 UI 展示轨迹摘要（避免把整个 track 塞给渲染层时的冗余）。 */
export function trackSummary(track: PitchTrack): { voicedSec: number; totalSec: number } {
  const voiced = track.frames.filter(f => f.voiced).length
  return { voicedSec: voiced * track.hopSec, totalSec: track.frames.length * track.hopSec }
}

export const HOP_SEC = HOP / ANALYSIS_RATE
