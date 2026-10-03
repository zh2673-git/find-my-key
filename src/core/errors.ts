// 时空层级：数据规范（core）—— 域层错误码，UI 层负责转用户文案

export type DomainErrorCode =
  | 'NO_TONE'             // 未检测到有效人声
  | 'RANGE_INSUFFICIENT'  // 有声帧太少
  | 'RANGE_TOO_NARROW'    // 滑音跨度不足 10 半音
  | 'SCALE_TOO_SHORT'     // 音阶音符不足 5 个（唱太短/没听清）

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code)
    this.name = 'DomainError'
  }
}
