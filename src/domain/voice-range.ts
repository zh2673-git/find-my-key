// 时空层级：流转-规则（domain）—— 音域测量与推荐主音（docs/07）

import { RANGE_P_LOW, RANGE_P_HIGH, RANGE_MIN_FRAMES, RANGE_MIN_SPAN, TONIC_MARGIN_LOW, TONIC_MARGIN_HIGH, CENTER_RATIO } from '../core/constants'
import { DomainError } from '../core/errors'
import type { PitchTrack, VoiceRange } from '../core/types'

/**
 * 滑音轨迹 → 舒适音域 + 推荐主音带。
 * p3/p97 百分位裁剪去破音/假声毛刺；主音带 = do−5 ≥ 低限 且 do+9 ≤ 高限。
 */
export function measureRange(track: PitchTrack): VoiceRange {
  const voiced = track.frames.filter(f => f.voiced).map(f => f.midi).sort((a, b) => a - b)
  if (voiced.length < RANGE_MIN_FRAMES) throw new DomainError('RANGE_INSUFFICIENT')

  const pct = (q: number) => voiced[Math.floor(q * (voiced.length - 1))]
  const lowMidi = pct(RANGE_P_LOW)
  const highMidi = pct(RANGE_P_HIGH)
  const spanSemitones = highMidi - lowMidi
  if (spanSemitones < RANGE_MIN_SPAN) throw new DomainError('RANGE_TOO_NARROW')

  const centerMidi = lowMidi + spanSemitones * CENTER_RATIO

  const recommendedTonics: number[] = []
  const bandLow = lowMidi + TONIC_MARGIN_LOW
  const bandHigh = highMidi - TONIC_MARGIN_HIGH
  if (bandLow <= bandHigh) {
    for (let m = Math.ceil(bandLow); m <= Math.floor(bandHigh); m++) {
      const pc = ((m % 12) + 12) % 12
      if (!recommendedTonics.includes(pc)) recommendedTonics.push(pc)
    }
  }

  return { lowMidi, highMidi, spanSemitones, centerMidi, recommendedTonics }
}

/**
 * 歌曲移调建议（预留）：最小 |shift| 使 [songLow+shift+1, songHigh+shift-1] ⊆ [voiceLow, voiceHigh]。
 * 找不到合适移调时返回 0（调用方据此提示"超出你的舒适区"）。
 */
export function suggestTranspose(songLow: number, songHigh: number, voiceLow: number, voiceHigh: number): number {
  for (let off = 0; off <= 24; off++) {
    for (const shift of off === 0 ? [0] : [-off, off]) {
      const lo = songLow + shift + 1
      const hi = songHigh + shift - 1
      if (lo >= voiceLow && hi <= voiceHigh) return shift
    }
  }
  return 0
}
