// 时空层级：流转-规则（domain）—— 调性推断：覆盖率 + KS 相关性 + 首尾音锚定（docs/06）

import { W_COVERAGE, W_KS, W_ANCHOR, ANCHOR_LAST, ANCHOR_FIRST, ANCHOR_TONIC, ANCHOR_DOMINANT, ANCHOR_THIRD, KS_MAJOR, KS_MINOR, SCALE_MAJOR, SCALE_MINOR } from '../core/constants'
import type { KeyCandidate, Mode, Note } from '../core/types'

function scalePcs(tonic: number, mode: Mode): number[] {
  const tpl = mode === 'major' ? SCALE_MAJOR : SCALE_MINOR
  return tpl.map(s => (tonic + s) % 12)
}

function pearson(hist: number[], profile: readonly number[], tonic: number): number {
  const n = 12
  const xs = new Array<number>(n)
  const ys = new Array<number>(n)
  for (let pc = 0; pc < n; pc++) {
    xs[pc] = hist[pc]
    ys[pc] = profile[(pc - tonic + 12) % 12]
  }
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my
    num += a * b; dx += a * a; dy += b * b
  }
  const denom = Math.sqrt(dx * dy)
  return denom === 0 ? 0 : num / denom
}

/** 锚定分：主音 1 / 属音 0.6 / 三音 0.3 / 其他 0 */
function anchorScore(pc: number, tonic: number, mode: Mode): number {
  const rel = ((pc - tonic) % 12 + 12) % 12
  if (rel === 0) return ANCHOR_TONIC
  if (rel === 7) return ANCHOR_DOMINANT
  if (rel === (mode === 'major' ? 4 : 3)) return ANCHOR_THIRD
  return 0
}

export function inferKey(notes: Note[]): KeyCandidate[] {
  const hist = new Array<number>(12).fill(0)
  let total = 0
  for (const n of notes) {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12
    const dur = n.endSec - n.startSec
    hist[pc] += dur
    total += dur
  }
  if (total === 0 || notes.length === 0) return []

  const lastPc = ((Math.round(notes[notes.length - 1].midi) % 12) + 12) % 12
  const firstPc = ((Math.round(notes[0].midi) % 12) + 12) % 12

  const cands: KeyCandidate[] = []
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const scale = scalePcs(tonic, mode)
      const coverage = scale.reduce((s, pc) => s + hist[pc], 0) / total
      const profile = mode === 'major' ? KS_MAJOR : KS_MINOR
      const ks = pearson(hist, profile, tonic)
      const anchor = ANCHOR_LAST * anchorScore(lastPc, tonic, mode) + ANCHOR_FIRST * anchorScore(firstPc, tonic, mode)
      const score = W_COVERAGE * coverage + W_KS * Math.max(0, ks) + W_ANCHOR * anchor
      cands.push({ tonicPc: tonic, mode, score })
    }
  }
  cands.sort((a, b) => b.score - a.score)
  return cands.slice(0, 3)
}
