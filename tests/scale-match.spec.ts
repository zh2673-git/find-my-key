// v1.2 回归（docs/09）：音阶定调——唱 1234567 → 判定 do 在哪 + 步进音准偏差
// 真值源：synthMelody 合成音阶（与 UI 示例按钮共用 DEMO_SCALE_C），走完整管线 track→segment→matchScale。

import { describe, expect, it } from 'vitest'
import { synthMelody } from '../src/core/synth'
import { trackPitch } from '../src/domain/pitch-track'
import { segmentNotes } from '../src/domain/segment'
import { matchScale } from '../src/domain/scale-match'
import { DEMO_SCALE_C } from '../src/core/synth'

const FS = 16000

function pipeline(notes: { midi: number; durMs: number }[]) {
  return matchScale(segmentNotes(trackPitch(synthMelody(notes, { fs: FS }), FS)))
}

describe('matchScale 音阶定调', () => {
  it('标准 C 大调音阶（do–si–高do）→ do=C，全命中，步进零偏差', () => {
    const m = pipeline(DEMO_SCALE_C())
    expect(m.ok).toBe(true)
    expect(m.tonicPc).toBe(0)
    expect(m.hit).toBe(m.total)
    expect(m.total).toBe(8)
    expect(m.steps!.every(s => Math.abs(s.semitones) < 0.3)).toBe(true)
  })

  it('从 G 唱起的音阶 → do=G（首调：唱名锚点决定主音）', () => {
    const m = pipeline([67, 69, 71, 72, 74, 76, 78, 79].map(midi => ({ midi, durMs: 500 })))
    expect(m.ok).toBe(true)
    expect(m.tonicPc).toBe(7)
  })

  it('音符不足 5 个 → SCALE_TOO_SHORT（信息不足直接拒判）', () => {
    expect(() => pipeline([60, 62, 64].map(midi => ({ midi, durMs: 400 })))).toThrowError(/SCALE_TOO_SHORT/)
  })

  it('mi 唱成 fa（64→65）→ do 仍判 C，步进对齐点名第 2→3 音间多走 1 键', () => {
    const m = pipeline([60, 62, 65, 65, 67, 69, 71, 72].map(midi => ({ midi, durMs: 500 })))
    expect(m.tonicPc).toBe(0)
    expect(m.steps).not.toBeNull()
    // step 2 = 第 2→3 个音的间距：实际 re→"mi" 差 3 个琴键，模板 2 → +1
    const s2 = m.steps!.find(s => s.index === 2)!
    expect(s2.semitones).toBeGreaterThan(0.5)
  })

  it('整段唱低半音（起音偏低）→ do 判 B（投票跟随实际音高，不做自动纠偏）', () => {
    const m = pipeline([59, 61, 63, 64, 66, 68, 70, 71].map(midi => ({ midi, durMs: 500 })))
    expect(m.ok).toBe(true)
    expect(m.tonicPc).toBe(11)
  })
})
