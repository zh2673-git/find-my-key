/**
 * 和弦推断（v1.9，domain 纯函数）——从单音旋律推"参考和弦"，供弹唱起步。
 *
 * 本质：单音旋律不含和声，和弦只能推断——评分模型 = 段内每个音对候选三和弦的
 * 支持度（时值加权，首尾音加重，非和弦音扣分）。候选固定为以 do 为基准的调内
 * 三和弦 1 2m 3m 4 5 6m：大调主和弦=1 级，小调（la 式）主和弦=6m——与 v1.1 的
 * 简谱参照系完全同构（小调调内音集 = 关系大调音集），一套代码两种调性。
 */

export interface ChordSeg {
  startSec: number
  endSec: number
  /** 级数（1~6），以 do 为基准；m 后缀见 minor 标志 */
  degree: number
  /** 和弦名（如 G / Dm），根音 = do 上方级数对应音 */
  label: string
  /** 级数记号（如 1 / 6m），简谱习惯 */
  numeral: string
}

/** 候选三和弦：相对 do 的根音半音数 + 是否小三和弦（大调调内前六级）。 */
const CHORDS: ReadonlyArray<{ root: number; minor: boolean }> = [
  { root: 0, minor: false }, // 1
  { root: 2, minor: true },  // 2m
  { root: 4, minor: true },  // 3m
  { root: 5, minor: false }, // 4
  { root: 7, minor: false }, // 5
  { root: 9, minor: true },  // 6m
]

/** 音名（与 interfaces 的 midiToName 独立同源——domain 零依赖）。 */
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const

interface SegInput { midi: number; startSec: number; endSec: number }

/** 单段评分：返回每个候选和弦的支持分（越高越像这段的和弦）。导出供测试观测。 */
export function scoreSegment(seg: SegInput[], base: number): number[] {
  return CHORDS.map((ch) => {
    const rootPc = (base + ch.root) % 12
    const tones = new Set([0, ch.minor ? 3 : 4, 7].map((i) => (rootPc + i) % 12))
    let score = 0
    for (let i = 0; i < seg.length; i++) {
      const n = seg[i]
      const dur = Math.max(0.01, n.endSec - n.startSec)
      // midi 来自 YIN 连续频率转换，是浮点（如 55.0007）——必须取整后再比对音级集合，
      // 否则 has() 永远 miss、所有候选并列、整曲糊成一个和弦（v1.10.3 真修）
      const pc = ((Math.round(n.midi) % 12) + 12) % 12
      let w = dur
      const edge = i === 0 || i === seg.length - 1
      if (i === 0) w *= 1.5            // 段首：强拍落点更像和弦音
      if (i === seg.length - 1) w *= 1.5 // 段尾：解决落点
      if (tones.has(pc)) {
        // 段首/段尾落在根音上加成（和声惯例：乐句起落于根音）——
        // 否则单音旋律对"根音三和弦"与"含此音的五音三和弦"评分并列时乱猜。
        // 系数 1.3：强到足以破平局，弱到不把尾音整个段落拉向同一个和弦（v1.10.1）
        score += w * (edge && pc === rootPc ? 1.3 : 1)
      } else {
        score -= w * 0.3
      }
    }
    return score
  })
}

/** 对一组段输入跑"贪心分段 → 逐段评分 → 相邻合并"。prevNumeral 供近分换色。 */
function runPipeline(notesArr: SegInput[], base: number, minSegSec: number): ChordSeg[] {
  // 贪心分段：累计时长到 minSegSec 后闭合（段内至少 2 个音）
  const segs: SegInput[][] = []
  let cur: SegInput[] = []
  for (const n of notesArr) {
    cur.push(n)
    if (cur.length >= 2 && n.endSec - cur[0].startSec >= minSegSec) {
      segs.push(cur)
      cur = []
    }
  }
  if (cur.length) {
    if (segs.length) segs[segs.length - 1].push(...cur)
    else segs.push(cur)
  }

  // 逐段取最优和弦，相邻同和弦合并
  const out: ChordSeg[] = []
  for (const seg of segs) {
    const scores = scoreSegment(seg, base)
    let best = 0
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
    // 多样性先验（v1.10.2，v1.10.3 修正方向）：当最优候选与上一段相同时，若有近分
    // （差 <8%）的其他候选则换过去——对称旋律（"5"既是 I 的五音又是 V 的根音）评分
    // 常并列，不加先验会整曲糊成一个和弦。方向： Away from prev，不是 towards prev。
    const prev = out[out.length - 1]
    if (prev) {
      const prevIdx = CHORDS.findIndex((c, i) => `${i + 1}${c.minor ? 'm' : ''}` === prev.numeral)
      if (prevIdx === best) {
        let alt = -1
        let altScore = -Infinity
        for (let i = 0; i < scores.length; i++) {
          if (i !== best && scores[i] >= scores[best] * 0.92 && scores[i] > altScore) {
            alt = i
            altScore = scores[i]
          }
        }
        if (alt >= 0) best = alt
      }
    }
    const ch = CHORDS[best]
    const rootPc = (base + ch.root) % 12
    const numeral = `${best + 1}${ch.minor ? 'm' : ''}`
    const segOut: ChordSeg = {
      startSec: seg[0].startSec,
      endSec: seg[seg.length - 1].endSec,
      degree: best + 1,
      label: `${NAMES[rootPc]}${ch.minor ? 'm' : ''}`,
      numeral,
    }
    if (prev && prev.numeral === numeral) prev.endSec = segOut.endSec
    else out.push(segOut)
  }
  return out
}

/**
 * 推断参考和弦序列。
 * @param base do 的音级（大调 = tonic；小调 la 式 = tonic + 3，主和弦即 6m）
 * @param minSegSec 最短段长（默认 0.8s ≈ 2 个音，v1.10.1 从 1.2s 收紧——段更细，
 *                  和弦块罩住具体的音组而非整段一糊；段内不足 2 音不闭合） */
export function inferChords(
  notes: ReadonlyArray<SegInput>,
  base: number,
  minSegSec = 0.8,
): ChordSeg[] {
  if (notes.length < 3) return []
  const notesArr = [...notes].sort((a, b) => a.startSec - b.startSec)
  const segs = runPipeline(notesArr, base, minSegSec)

  // 单段僵局兜底（v1.10.2）：≥6 个音仍只有 1 个和弦段时，按时间中点强制二分再推——
  // 哼唱黏连 + 对称旋律会让整曲糊成一个和弦；左右两半和弦不同才接受切分
  if (segs.length === 1 && notesArr.length >= 6) {
    const mid = (notesArr[0].startSec + notesArr[notesArr.length - 1].endSec) / 2
    const left = notesArr.filter(n => n.startSec < mid)
    const right = notesArr.filter(n => n.startSec >= mid)
    if (left.length >= 2 && right.length >= 2) {
      const l = runPipeline(left, base, minSegSec)
      const r = runPipeline(right, base, minSegSec)
      if (l.length && r.length && l[l.length - 1].numeral !== r[0].numeral) {
        return [...l, ...r]
      }
    }
  }
  return segs
}
