// 时空层级：数据规范（core）—— 全项目唯一 DTO 来源，零依赖

export interface PitchFrame {
  t: number          // 帧中心时间（秒）
  midi: number       // 连续 MIDI 音高（69 + 12*log2(f/440)），无声时 0
  prob: number       // YIN 有声概率 0..1
  rms: number        // 帧能量
  voiced: boolean    // 有声判定
}

export interface PitchTrack {
  frames: PitchFrame[]
  hopSec: number
}

export interface Note {
  startSec: number
  endSec: number
  midi: number       // 段内中位连续 MIDI
  cents: number      // 相对最近半音的偏差（-50..50）
  conf: number       // 平均有声概率
}

export type Mode = 'major' | 'minor'

export interface KeyCandidate {
  tonicPc: number    // 主音 pitch class 0..11（0=C）
  mode: Mode
  score: number
}

export interface SolfegeNote {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7
  accidental: -1 | 0 | 1     // -1=♭ 0=♮ 1=♯
  octaveShift: -2 | -1 | 0 | 1 | 2  // 相对全曲中位八度（高音点/低音点）
  midi: number
  startSec: number
  endSec: number
  cents: number
  symbol: string     // 如 "5" "♭3" "♯4"
}

export interface VoiceRange {
  lowMidi: number
  highMidi: number
  spanSemitones: number
  centerMidi: number
  recommendedTonics: number[] // 主音 pitch class 列表
}

export interface AnalysisResult {
  track: PitchTrack
  notes: Note[]
  keys: KeyCandidate[]
  solfege: SolfegeNote[]
}
