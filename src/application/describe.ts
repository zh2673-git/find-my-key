// 时空层级：流转-编排（application）—— 大白话翻译层（docs/08）
// 判定结果 → 小白能读懂的中文：纯函数、零 UI 依赖、不改判定逻辑（I 不变量：仅消费 core DTO 与文案表）。

import { NOTE_NAMES, SOLFEGE_NAMES, SOLFEGE_PLAIN } from '../core/constants'
import type { KeyCandidate, SolfegeNote, VoiceRange } from '../core/types'

/** 唱名中文名：♭3 → "降mi"。 */
function plainName(degree: number, accidental: number): string {
  const sign = accidental === 1 ? '升' : accidental === -1 ? '降' : ''
  return `${sign}${SOLFEGE_NAMES[degree - 1]}`
}

/** 八度白话：高音/低音（简谱点的文字版）。 */
function octaveTag(shift: number): string {
  return shift > 0 ? '高音' : shift < 0 ? '低音' : ''
}

/** 琴键名：连续 midi → 如 C4、A4（供音域白话使用）。 */
function keyName(midi: number): string {
  const m = Math.round(midi)
  const pc = ((m % 12) + 12) % 12
  return `${NOTE_NAMES[pc]}${Math.floor(m / 12) - 1}`
}

/**
 * 旋律白话叙述：你哼了什么数字 → 开头/最高点/结尾落点 → 主音在哪颗琴键 → 下一步做什么。
 * 文案规范（docs/08）：禁裸术语、唱名带性格、每句回答"我现在该干什么"。
 */
export function describeMelody(solfege: SolfegeNote[], key: KeyCandidate): string {
  if (solfege.length === 0) return '还没听清旋律——离麦克风近一些，再哼长一点（五秒以上）试试。'

  const first = solfege[0]
  const last = solfege[solfege.length - 1]
  let top = solfege[0]
  for (const s of solfege) if (s.midi > top.midi) top = s
  const contour = solfege.map(s => s.symbol).join(' ')

  const isMinor = key.mode === 'minor'
  const homeDeg = isMinor ? 6 : 1
  const homeName = isMinor ? '6（la，小调的主角）' : '1（do，家）'
  const homePianoKey = NOTE_NAMES[key.tonicPc]

  const lines: string[] = []
  lines.push(`你一共哼了 ${solfege.length} 个音，用简谱数字写出来是：${contour}（1 就是 do，7 就是 si）。`)
  lines.push(
    `开头是 ${first.symbol}（${octaveTag(first.octaveShift)}${plainName(first.degree, first.accidental)}），` +
    `最高唱到 ${top.symbol}（${octaveTag(top.octaveShift)}${plainName(top.degree, top.accidental)}），` +
    `最后落在 ${last.symbol}（${plainName(last.degree, last.accidental)}）上。`,
  )
  if (last.degree === homeDeg && last.accidental === 0) {
    lines.push(`结尾稳稳落回了 ${homeName}——${isMinor ? '小调' : '大调'}歌最典型的收法，像回到家推上门。`)
  } else {
    lines.push(`结尾落在 ${last.symbol} 上：${SOLFEGE_PLAIN[last.degree]}。`)
  }
  lines.push(`这首歌更像${isMinor ? '小调（温柔、内敛）' : '大调（明亮、开阔）'}：你的 ${homeName} 对应钢琴上的 ${homePianoKey} 键。`)
  lines.push('下一步：点上面的唱名方块听你哼的原声，再点下面钢琴上标着同一个数字的键听标准音，两只耳朵当裁判；觉得调不对，就勾选「点琴键选 do」再点琴键。')
  return lines.join('\n')
}

/**
 * 音域白话：舒适范围 → 推荐把 do 放哪些键 → 下一步做什么。
 * 禁术语：半音 → "琴键数"。
 */
export function describeRange(vr: VoiceRange): string {
  const span = Math.round(vr.spanSemitones)
  const oct = vr.spanSemitones / 12
  const octText = oct >= 1.75 ? '快两个八度' : oct >= 1.25 ? '一个半八度左右' : oct >= 0.85 ? '一个八度左右' : '大半个八度'
  const names = vr.recommendedTonics.map(pc => NOTE_NAMES[pc]).join('、')

  const lines: string[] = []
  lines.push(`你的嗓子最舒服的范围：从 ${keyName(vr.lowMidi)} 到 ${keyName(vr.highMidi)}，高低差 ${span} 个琴键，大约${octText}。`)
  lines.push(names ? `把 do 放在 ${names} 这些键上、唱这些调的歌最省力。` : '这次滑音跨度偏窄，暂时给不出稳定推荐——下次从最低一路哼到最高，跨度再大一点。')
  lines.push('下一步：哼一段你熟悉的歌，看看它翻出来的数字长什么样，再到钢琴上弹着对照。')
  return lines.join('\n')
}
