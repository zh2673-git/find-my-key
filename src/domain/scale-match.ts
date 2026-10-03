// 时空层级：流转-规则（domain）—— 音阶定调（v1.2，docs/09）：唱 1234567 → 判定 do 在哪 + 音准偏差
// 本质：音阶唱名自带语义锚点——唱"1"的那个音就是用户心中的 do。滑音测的是物理跨度，
// 音阶测的是音乐锚点 + 相对音准，二者互补不互斥。
// 算法：12 个候选主音投票（命中大调音级最多、总偏差最小者胜，对漏音/重复/跑偏稳健）；
// 音符数恰为 8 时附加步进音程对齐（模板 2-2-1-2-2-2-1），可指出"哪个音唱高了/低了"。

import { SCALE_MAJOR } from '../core/constants'
import { DomainError } from '../core/errors'
import type { Note } from '../core/types'

export interface ScaleDeviation {
  index: number      // 音符序号（0 起）
  semitones: number  // 带符号偏差（+ = 偏高），半音连续值
}

export interface ScaleMatch {
  ok: boolean
  tonicPc: number                  // 判定主音 pitch class（0=C）
  hit: number                      // 落在大调音级上的音符数
  total: number
  deviants: ScaleDeviation[]       // 落在音阶外的音（相对最近音级的带符号偏差）
  steps: ScaleDeviation[] | null   // 音符数=8 时逐步音程偏差；否则 null
}

/** 折环：半音差 wrap 到 -6..6（八度等价，do 与高音 do 同级）。 */
function wrap(d: number): number {
  return ((d % 12) + 18) % 12 - 6
}

/** 相对大调音阶级（0,2,4,5,7,9,11）的最近距离与带符号偏差。 */
function nearestDegree(rel: number): { dist: number; dev: number } {
  let bestDist = Number.POSITIVE_INFINITY
  let bestDev = 0
  for (const s of SCALE_MAJOR) {
    const dev = wrap(rel - s)
    const dist = Math.abs(dev)
    if (dist < bestDist) {
      bestDist = dist
      bestDev = dev
    }
  }
  return { dist: bestDist, dev: bestDev }
}

/**
 * 音阶音符 → 主音判定与音准偏差。
 * notes 为切分后的音符序列；少于 5 个音信息不足，抛 SCALE_TOO_SHORT。
 * ok 判定：命中音级比例 ≥ 0.8（跑偏一两个音仍可定调，但会点名偏差）。
 */
export function matchScale(notes: Note[]): ScaleMatch {
  if (notes.length < 5) throw new DomainError('SCALE_TOO_SHORT')
  const midis = notes.map(n => n.midi)

  let best: { tonicPc: number; hit: number; devSum: number; deviants: ScaleDeviation[] } | null = null
  for (let t = 0; t < 12; t++) {
    let hit = 0
    let devSum = 0
    const deviants: ScaleDeviation[] = []
    midis.forEach((m, i) => {
      const rel = ((m - t) % 12 + 12) % 12
      const { dist, dev } = nearestDegree(rel)
      devSum += dist
      if (dist <= 0.5) hit++
      else deviants.push({ index: i, semitones: dev })
    })
    if (!best || hit > best.hit || (hit === best.hit && devSum < best.devSum)) {
      best = { tonicPc: t, hit, devSum, deviants }
    }
  }

  // 步进对齐：仅当音符数恰为 8（do–si–高do 各一）时做逐位音程比对
  const TEMPLATE = [2, 2, 1, 2, 2, 2, 1] as const
  let steps: ScaleDeviation[] | null = null
  if (midis.length === 8) {
    steps = TEMPLATE.map((tpl, i) => ({ index: i + 1, semitones: midis[i + 1] - midis[i] - tpl }))
  }

  return { ok: best!.hit / midis.length >= 0.8, tonicPc: best!.tonicPc, hit: best!.hit, total: midis.length, deviants: best!.deviants, steps }
}
