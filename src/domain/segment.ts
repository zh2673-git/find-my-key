// 时空层级：流转-规则（domain）—— 音符切分：F0 轨迹 → Note[]（docs/05）

import { SEG_STEP_ST, SEG_GAP_FRAMES, SEG_MIN_FRAMES, SEG_MIN_SEC } from '../core/constants'
import type { Note, PitchTrack } from '../core/types'

export interface SegmentOptions {
  stepSt: number      // 相对参考音高的步进阈值（半音）
  gapFrames: number   // 容忍的静音帧数
  minFrames: number   // 最短帧数
  minSec: number      // 最短时长（秒）
}

const DEFAULTS: SegmentOptions = {
  stepSt: SEG_STEP_ST,
  gapFrames: SEG_GAP_FRAMES,
  minFrames: SEG_MIN_FRAMES,
  minSec: SEG_MIN_SEC,
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function segmentNotes(track: PitchTrack, opts?: Partial<SegmentOptions>): Note[] {
  const o = { ...DEFAULTS, ...opts }
  const frames = track.frames
  const notes: Note[] = []

  let cur: number[] = []       // 当前音符的有声帧索引
  let unvoicedRun = 0

  const flush = () => {
    if (cur.length >= o.minFrames) {
      const midis = cur.map(i => frames[i].midi)
      const midi = median(midis)
      const snapped = Math.round(midi)
      const first = cur[0], last = cur[cur.length - 1]
      const startSec = Math.max(0, frames[first].t - track.hopSec / 2)
      const endSec = frames[last].t + track.hopSec / 2
      if (endSec - startSec >= o.minSec) {
        const conf = cur.reduce((s, i) => s + frames[i].prob, 0) / cur.length
        notes.push({ startSec, endSec, midi, cents: (midi - snapped) * 100, conf })
      }
    }
    cur = []
    unvoicedRun = 0
  }

  const refMidi = (): number => {
    const tail = cur.slice(-5).map(i => frames[i].midi)
    return median(tail)
  }

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (!f.voiced) {
      unvoicedRun++
      if (cur.length && unvoicedRun > o.gapFrames) flush()
      continue
    }
    unvoicedRun = 0
    if (cur.length === 0) {
      cur = [i]
    } else if (Math.abs(f.midi - refMidi()) >= o.stepSt) {
      flush()
      cur = [i]
    } else {
      cur.push(i)
    }
  }
  flush()

  return notes
}
