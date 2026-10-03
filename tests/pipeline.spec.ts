// P/Q/I 验证 —— 翻译用例回归（合成音频 = 可控真值）
import { describe, expect, it } from 'vitest'
import { synthMelody, DEMO_TWINKLE_G } from '../src/core/synth'
import type { SynthNote } from '../src/core/synth'
import { analyzeRecording, rekey } from '../src/application/session'

const FS = 16000

function seq(midis: number[], durMs = 400, lastDurMs?: number): SynthNote[] {
  return midis.map((midi, i) => ({ midi, durMs: i === midis.length - 1 && lastDurMs ? lastDurMs : durMs }))
}

describe('Q 后置 · C 大调音阶', () => {
  it('输出唱名 1 2 3 4 5 6 7 1̇，调性 C 大调 top1', () => {
    const buf = synthMelody(seq([60, 62, 64, 65, 67, 69, 71, 72]), { fs: FS })
    const r = analyzeRecording(buf, FS)
    expect(r.keys[0].tonicPc).toBe(0)
    expect(r.keys[0].mode).toBe('major')
    expect(r.solfege.map(s => s.degree)).toEqual([1, 2, 3, 4, 5, 6, 7, 1])
    expect(r.solfege.map(s => s.accidental)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(r.solfege[7].octaveShift).toBe(1)
  })
})

describe('Q 后置 · 小星星（G 大调）', () => {
  it('输出唱名 1 1 5 5 6 6 5，调性 G 大调 top1', () => {
    const buf = synthMelody(DEMO_TWINKLE_G(), { fs: FS })
    const r = analyzeRecording(buf, FS)
    expect(r.keys[0].tonicPc).toBe(7)
    expect(r.keys[0].mode).toBe('major')
    expect(r.solfege.map(s => s.symbol)).toEqual(['1', '1', '5', '5', '6', '6', '5'])
  })

  it('男声低八度哼唱同旋律 → 首调唱名完全不变（I 不变量：首调不变性）', () => {
    const lower = DEMO_TWINKLE_G().map(n => ({ midi: n.midi - 12, durMs: n.durMs }))
    const buf = synthMelody(lower, { fs: FS })
    const r = analyzeRecording(buf, FS)
    expect(r.keys[0].tonicPc).toBe(7)
    expect(r.solfege.map(s => s.symbol)).toEqual(['1', '1', '5', '5', '6', '6', '5'])
  })
})

describe('Q 后置 · a 小调旋律（la 式简谱）', () => {
  it('以 6 为基调输出 6 1 3 5 3 6，调性 A 小调 top1', () => {
    // A4 C5 E5 G4 E4 A4 → 相对 C 大调：6 1̇ 3̇ 5 3 6
    const buf = synthMelody(seq([69, 72, 76, 67, 64, 69], 420, 840), { fs: FS })
    const r = analyzeRecording(buf, FS)
    expect(r.keys[0].tonicPc).toBe(9)
    expect(r.keys[0].mode).toBe('minor')
    expect(r.solfege.map(s => s.degree)).toEqual([6, 1, 3, 5, 3, 6])
  })
})

describe('I 不变量 · 纯函数可复现与值域有界', () => {
  it('同一输入两次分析结果逐字段一致', () => {
    const buf = synthMelody(DEMO_TWINKLE_G(), { fs: FS })
    const a = analyzeRecording(buf, FS)
    const b = analyzeRecording(buf, FS)
    expect(JSON.stringify(a.notes)).toBe(JSON.stringify(b.notes))
    expect(JSON.stringify(a.keys)).toBe(JSON.stringify(b.keys))
    expect(JSON.stringify(a.solfege)).toBe(JSON.stringify(b.solfege))
  })

  it('唱名值域有界：degree∈1..7、accidental∈{-1,0,1}、octaveShift∈[-2,2]', () => {
    const buf = synthMelody(seq([55, 57, 59, 60, 62, 64, 66, 67, 69, 71, 72, 74]), { fs: FS })
    const r = analyzeRecording(buf, FS)
    for (const s of r.solfege) {
      expect(s.degree).toBeGreaterThanOrEqual(1)
      expect(s.degree).toBeLessThanOrEqual(7)
      expect([-1, 0, 1]).toContain(s.accidental)
      expect(Math.abs(s.octaveShift)).toBeLessThanOrEqual(2)
    }
  })
})

describe('主音切换重映射（rekey）', () => {
  it('只改唱名映射，不改音符切分', () => {
    const buf = synthMelody(DEMO_TWINKLE_G(), { fs: FS })
    const r = analyzeRecording(buf, FS)
    const re = rekey(r, 0, 'major') // 强行按 C 大调重映射
    expect(r.notes.length).toBe(re.length)
    expect(r.notes[0].midi).toBe(re[0].midi)
    expect(re.map(s => s.symbol)).toEqual(['5', '5', '2', '2', '3', '3', '2'])
  })
})
