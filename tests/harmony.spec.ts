import { describe, expect, it } from 'vitest'
import { inferChords } from '../src/domain/harmony'

/** 合成一段音符：G 大调小星星片段 1 1 5 5 6 6 5（do=G → G D E D），每音 0.4s。 */
const TWINKLE_G = [
  { midi: 67, startSec: 0.0, endSec: 0.4 },
  { midi: 67, startSec: 0.4, endSec: 0.8 },
  { midi: 74, startSec: 0.8, endSec: 1.2 },
  { midi: 74, startSec: 1.2, endSec: 1.6 },
  { midi: 76, startSec: 1.6, endSec: 2.0 },
  { midi: 76, startSec: 2.0, endSec: 2.4 },
  { midi: 74, startSec: 2.4, endSec: 3.2 },
]

describe('inferChords（v1.9 参考和弦）', () => {
  it('G 大调小星星：段落在 1级(G) / 5级(D) / 6m(Em) 等调内和弦中，且根音正确', () => {
    const segs = inferChords(TWINKLE_G, 7) // do=G
    expect(segs.length).toBeGreaterThan(0)
    const allowed = new Set(['G', 'C', 'D', 'Em', 'Am', 'Bm'])
    for (const s of segs) {
      expect(allowed.has(s.label)).toBe(true)
      expect(s.endSec).toBeGreaterThan(s.startSec)
    }
    // 首段主音 5（D）开头 → 首段应为 D 或 G（不做过度断言，验证首段是调内最优而非乱猜）
    expect(['G', 'D']).toContain(segs[0].label)
  })

  it('小星星应分段出多个和弦块（v1.10.1：和弦罩住具体的音组，而非整段一糊）', () => {
    const segs = inferChords(TWINKLE_G, 7)
    expect(segs.length).toBeGreaterThanOrEqual(2)
    // 首两音 1 1（G G）应属于首段
    expect(segs[0].startSec).toBeLessThanOrEqual(0.01)
  })

  it('慢速黏连哼唱（每音 1.2s 长音）的小星星仍应分段出多个和弦（v1.10.2）', () => {
    // 每音 1.2s：真实哼唱常见速度，对称旋律下评分易并列糊成一块
    const slow = TWINKLE_G.map((n, i) => ({ ...n, startSec: i * 1.2, endSec: i * 1.2 + 1.2 }))
    const segs = inferChords(slow, 7)
    expect(segs.length).toBeGreaterThanOrEqual(2)
  })

  it('浮点 midi（真实 YIN 输出形态）必须与整数 midi 得到相同分段（v1.10.3 回归锁）', () => {
    // 真实切分输出的 midi 带微小浮点误差（55.0007…）——曾因未取整导致音级集合
    // 永远 miss、所有候选并列、整曲糊成一个和弦；此测试防止回退
    const floatMidi = TWINKLE_G.map((n, i) => ({
      midi: n.midi + 0.00068572622977,
      startSec: i * 0.48,
      endSec: i * 0.48 + (i === 6 ? 0.87 : 0.44),
    }))
    const segsFloat = inferChords(floatMidi, 7)
    const segsInt = inferChords(TWINKLE_G.map((n, i) => ({ ...n, startSec: i * 0.48, endSec: i * 0.48 + (i === 6 ? 0.87 : 0.44) })), 7)
    expect(segsFloat.map(s => s.numeral)).toEqual(segsInt.map(s => s.numeral))
    expect(segsFloat.length).toBeGreaterThanOrEqual(2)
  })

  it('长段单一音：全曲都是 do → 合并为单段 1 级', () => {
    const notes = [
      { midi: 60, startSec: 0.0, endSec: 1.0 },
      { midi: 60, startSec: 1.0, endSec: 2.0 },
      { midi: 60, startSec: 2.0, endSec: 3.0 },
    ]
    const segs = inferChords(notes, 0)
    expect(segs).toHaveLength(1)
    expect(segs[0].label).toBe('C')
    expect(segs[0].numeral).toBe('1')
  })

  it('相邻同和弦自动合并：整段统一', () => {
    const notes = [
      { midi: 60, startSec: 0.0, endSec: 1.0 },
      { midi: 64, startSec: 1.0, endSec: 2.0 },
      { midi: 67, startSec: 2.0, endSec: 3.0 },
    ]
    const segs = inferChords(notes, 0)
    // C E G 全是 1 级和弦音 → 不应有碎片化的多段
    expect(segs.every((s) => s.numeral === segs[0].numeral)).toBe(true)
  })

  it('少于 3 个音拒绝推断', () => {
    expect(inferChords([{ midi: 60, startSec: 0, endSec: 1 }], 0)).toEqual([])
    expect(inferChords([], 0)).toEqual([])
  })

  it('小调（la 式 do=tonic+3）：主和弦落在 6m', () => {
    // A 小调旋律：do=C，主音 la=A（69）。全 la 长音 → 主和弦应为 Am（6m）
    const notes = [
      { midi: 69, startSec: 0.0, endSec: 1.0 },
      { midi: 69, startSec: 1.0, endSec: 2.0 },
      { midi: 69, startSec: 2.0, endSec: 3.0 },
    ]
    const segs = inferChords(notes, 0) // la 式：do=C（tonic A + 3）
    expect(segs).toHaveLength(1)
    expect(segs[0].label).toBe('Am')
    expect(segs[0].numeral).toBe('6m')
  })
})
