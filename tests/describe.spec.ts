// v1.1 回归（docs/08）：大白话层纯函数 + labelForPitch 与 toSolfege 同源（单一映射表）
// I 不变量：本文件不触碰分析管线；v1 的 11 项回归必须保持全绿。

import { describe, expect, it } from 'vitest'
import { describeMelody, describeRange } from '../src/application/describe'
import { labelForPitch, toSolfege } from '../src/domain/solfege'
import type { KeyCandidate, Note, VoiceRange } from '../src/core/types'

function note(midi: number, startSec = 0): Note {
  const snapped = Math.round(midi)
  return { startSec, endSec: startSec + 0.3, midi, cents: Math.round((midi - snapped) * 100), conf: 0.9 }
}

const G_MAJOR: KeyCandidate = { tonicPc: 7, mode: 'major', score: 1 }
const A_MINOR: KeyCandidate = { tonicPc: 9, mode: 'minor', score: 0.9 }

describe('labelForPitch 与 toSolfege 同源（琴键标签 = 唱名映射）', () => {
  it('大调：逐音符标签一致', () => {
    const notes = [67, 69, 71, 72, 74, 76].map(note)
    const sol = toSolfege(notes, G_MAJOR)
    for (const s of sol) {
      expect(labelForPitch(s.midi, 7).symbol).toBe(s.symbol)
    }
  })

  it('小调（la 式，base = tonic+3）：逐音符标签一致', () => {
    const notes = [69, 71, 72, 74, 76].map(note)
    const sol = toSolfege(notes, A_MINOR)
    expect(sol.every(s => s.symbol === labelForPitch(s.midi, (9 + 3) % 12).symbol)).toBe(true)
  })

  it('变化音给出 ♭/♯ 符号（G 调的 B♭ = ♭3）', () => {
    expect(labelForPitch(70, 7).symbol).toBe('♭3')
    expect(labelForPitch(70, 7).degree).toBe(3)
    expect(labelForPitch(70, 7).accidental).toBe(-1)
  })
})

describe('describeMelody 大白话叙述', () => {
  it('空旋律给行动指引而不是报错', () => {
    expect(describeMelody([], G_MAJOR)).toContain('再哼长一点')
  })

  it('叙述含数字轮廓、结尾落点、主音琴键与下一步', () => {
    const twinkle = [67, 67, 74, 74, 76, 76, 74].map((m, i) => note(m, i * 0.4))
    const d = describeMelody(toSolfege(twinkle, G_MAJOR), G_MAJOR)
    expect(d).toContain('1 1 5 5 6 6 5')
    expect(d).toContain('最后落在 5')
    expect(d).toContain('sol')    // 结尾非主音 → 引用唱名性格表
    expect(d).toContain('G 键')   // 大调 do 对应琴键 G
    expect(d).toContain('下一步')
  })

  it('结尾落回主音时给"回家"叙述（大调 do）', () => {
    const mel = [74, 71, 67].map((m, i) => note(m, i * 0.4)) // G 调 sol-mi-do 收尾
    const d = describeMelody(toSolfege(mel, G_MAJOR), G_MAJOR)
    expect(d).toContain('稳稳落回了 1（do，家）')
  })

  it('小调以 la 为主角并指向主音琴键（la 式主音显示为 6）', () => {
    const mel = [69, 67, 64, 69].map((m, i) => note(m, i * 0.4))
    const d = describeMelody(toSolfege(mel, A_MINOR), A_MINOR)
    expect(d).toContain('小调')
    expect(d).toContain('6（la，小调的主角）')
    expect(d).toContain('A 键')
  })
})

describe('describeRange 音域白话', () => {
  const vr: VoiceRange = { lowMidi: 48, highMidi: 69, spanSemitones: 21, centerMidi: 55.35, recommendedTonics: [0, 2, 5, 7] }

  it('范围用琴键数表述，给推荐调与下一步（禁裸术语）', () => {
    const d = describeRange(vr)
    expect(d).toContain('C3')
    expect(d).toContain('A4')
    expect(d).toContain('21 个琴键')
    expect(d).toContain('C、D、F、G')
    expect(d).toContain('下一步')
  })

  it('无稳定推荐时给行动指引', () => {
    const d = describeRange({ ...vr, recommendedTonics: [] })
    expect(d).toContain('跨度再大一点')
  })
})
