// 时空层级：流转-规则（domain）—— 首调唱名映射（docs/06）：形状 → do re mi（含变化音与八度点）

import { DEGREE_MAP, ACCIDENTAL_SIGN } from '../core/constants'
import type { KeyCandidate, Note, SolfegeNote } from '../core/types'

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface PitchLabel {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7
  accidental: -1 | 0 | 1
  symbol: string
}

/**
 * 单音 → 首调标签（琴键标注与 toSolfege 同源，共用 DEGREE_MAP——单一映射表）。
 * rel = (round(midi) − base) mod 12。
 */
export function labelForPitch(midi: number, base: number): PitchLabel {
  const snapped = Math.round(midi)
  const rel = ((snapped - base) % 12 + 12) % 12
  const [degree, accidental] = DEGREE_MAP[rel]
  const sign = ACCIDENTAL_SIGN[accidental]
  return { degree, accidental, symbol: `${sign}${degree}` }
}

/**
 * 首调（movable-do）映射。
 * 小调按中国简谱惯例以 la 为基调：base = 相对大调主音 = (tonicPc + 3) mod 12，主音呈现为 6。
 * 八度点以"中位之下最近的主音"为中央八度参照（主音永不带点）。
 */
export function toSolfege(notes: Note[], key: KeyCandidate): SolfegeNote[] {
  const base = key.mode === 'minor' ? (key.tonicPc + 3) % 12 : key.tonicPc
  // 中央八度参照 = 中位 midi 之下（含）最近的主音：简谱习惯上主音不带点，
  // [ref, ref+12) 区间内的音均无八度点（I 不变量：主音切换只改映射不改参照系语义）。
  const med = median(notes.map(n => n.midi))
  const refBase = base + 12 * Math.floor((med - base) / 12)

  return notes.map(n => {
    const snapped = Math.round(n.midi)
    const { degree, accidental, symbol } = labelForPitch(n.midi, base)
    const rawShift = Math.floor((snapped - refBase) / 12)
    const octaveShift = Math.max(-2, Math.min(2, rawShift)) as SolfegeNote['octaveShift']
    return {
      degree,
      accidental,
      octaveShift,
      midi: n.midi,
      startSec: n.startSec,
      endSec: n.endSec,
      cents: n.cents,
      symbol,
    }
  })
}
