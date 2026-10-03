// 时空层级：数据规范（core）—— 全部算法常量与音表（设计见 docs/02 §5）

// ── 采集/分析时基 ──
export const ANALYSIS_RATE = 16000
export const FRAME_SIZE = 1024
export const HOP = 256
export const YIN_THRESHOLD = 0.12

// ── 有声判定 ──
export const VOICED_PROB = 0.5
export const RMS_ABS_FLOOR = 0.004
export const RMS_P95_RATIO = 0.06

// ── 轨迹平滑 ──
export const MEDIAN_WIN = 5
export const OCTAVE_FIX_WIN = 4
export const OCTAVE_FIX_ST = 9

// ── 音符切分 ──
export const SEG_STEP_ST = 0.8
export const SEG_GAP_FRAMES = 2
export const SEG_MIN_FRAMES = 4
export const SEG_MIN_SEC = 0.08

// ── 调性打分 ──
export const W_COVERAGE = 0.5
export const W_KS = 0.3
export const W_ANCHOR = 0.2
export const ANCHOR_LAST = 0.7
export const ANCHOR_FIRST = 0.3
export const ANCHOR_TONIC = 1
export const ANCHOR_DOMINANT = 0.6
export const ANCHOR_THIRD = 0.3

// ── 音域校准 ──
export const RANGE_P_LOW = 0.03
export const RANGE_P_HIGH = 0.97
export const RANGE_MIN_FRAMES = 20
export const RANGE_MIN_SPAN = 10
export const TONIC_MARGIN_LOW = 5   // do 下方到 sol
export const TONIC_MARGIN_HIGH = 9  // do 上方到 la
export const CENTER_RATIO = 0.35

// ── 音表 ──
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
export const SOLFEGE_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'] as const

// rel = (pc - base) mod 12 → [度数, 变化音]
export const DEGREE_MAP: ReadonlyArray<readonly [1 | 2 | 3 | 4 | 5 | 6 | 7, -1 | 0 | 1]> = [
  [1, 0], [2, -1], [2, 0], [3, -1], [3, 0], [4, 0], [4, 1],
  [5, 0], [6, -1], [6, 0], [7, -1], [7, 0],
]

export const ACCIDENTAL_SIGN = { [-1]: '♭', 0: '', 1: '♯' } as const

// Krumhansl-Kessler 音阶画像（主音对齐 index 0）
export const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] as const
export const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] as const

// 音阶模板（相对主音的半音集合）
export const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11] as const
export const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10] as const

// ── 大白话层（v1.1，docs/08）：唱名性格表——按"回到 do 的倾向"描述 ──
export const SOLFEGE_PLAIN: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, string>> = {
  1: 'do（哆）——家，最稳最踏实的音，歌常常回到它身上',
  2: 're（来）——刚离开家一步，往明亮的方向走',
  3: 'mi（咪）——明亮开朗，走到这里心里亮堂',
  4: 'fa（发）——有点悬，总想着往回走（回家找 do）',
  5: 'sol（嗦）——稳当，像第二主角，很多歌在这儿落脚',
  6: 'la（拉）——温柔带点忧伤，小调歌的主角',
  7: 'si（西）——最想回家的音，一出现就盼着回到 do',
}

/** 唱准容差（音分）：唱名 chip 橙色判定与频率对照卡的"唱准范围"共用同一阈值。 */
export const CENTS_TOLERANCE = 30

/** midi → 音名（如 67 → "G4"），钢琴/读数共用。 */
export function midiToName(midi: number): string {
  const m = Math.round(midi)
  const pc = ((m % 12) + 12) % 12
  return `${NOTE_NAMES[pc]}${Math.floor(m / 12) - 1}`
}

/** midi → 标准频率 Hz（十二平均律，A4 = 440 Hz 国际标准）。 */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
