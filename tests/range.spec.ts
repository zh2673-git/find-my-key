// P/Q/I 验证 —— 音域校准用例回归（docs/07）
import { describe, expect, it } from 'vitest'
import { synthGliss } from '../src/core/synth'
import { analyzeRange, analyzeRecording } from '../src/application/session'
import { DomainError } from '../src/core/errors'

const FS = 16000

describe('Q 后置 · 滑音音域测量', () => {
  it('110Hz→440Hz 指数滑音：低/高误差 ≤2 半音（A2=45, A4=69）', () => {
    const buf = synthGliss(110, 440, 3000, FS)
    const vr = analyzeRange(buf, FS)
    expect(Math.abs(vr.lowMidi - 45)).toBeLessThanOrEqual(2)
    expect(Math.abs(vr.highMidi - 69)).toBeLessThanOrEqual(2)
    expect(vr.spanSemitones).toBeGreaterThanOrEqual(20)
  })

  it('推荐主音带与实测音域一致（带 = [低限+5, 高限−9] 的 pitch class 集合）', () => {
    const buf = synthGliss(110, 440, 3000, FS)
    const vr = analyzeRange(buf, FS)
    expect(vr.recommendedTonics.length).toBeGreaterThan(0)
    // 与实测 low/high 独立重算期望集合（验证映射管线一致性）
    const bandLo = Math.ceil(vr.lowMidi + 5)
    const bandHi = Math.floor(vr.highMidi - 9)
    const expected: number[] = []
    for (let m = bandLo; m <= bandHi; m++) {
      const pc = ((m % 12) + 12) % 12
      if (!expected.includes(pc)) expected.push(pc)
    }
    expect(vr.recommendedTonics).toEqual(expected)
    // 带中部的 G（55）必在推荐内；带边界的 C 允许因 ±2 半音容差出入
    expect(vr.recommendedTonics).toContain(7)
  })
})

describe('运行时规则拦截', () => {
  it('窄滑音（<10 半音）抛 RANGE_TOO_NARROW', () => {
    const buf = synthGliss(220, 330, 2000, FS) // A3→E4，约 7 半音
    expect(() => analyzeRange(buf, FS)).toThrow(DomainError)
    try {
      analyzeRange(buf, FS)
    } catch (e) {
      expect((e as DomainError).code).toBe('RANGE_TOO_NARROW')
    }
  })

  it('纯静音输入翻译用例抛 NO_TONE', () => {
    const buf = new Float32Array(FS * 2)
    expect(() => analyzeRecording(buf, FS)).toThrow(DomainError)
  })
})
