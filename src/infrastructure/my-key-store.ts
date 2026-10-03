// 时空层级：基础设施（infrastructure）—— "我的调"持久化（v1.1.1，用户诉求：固定适合自己的调）
// 隐私铁律不变：录音绝不落盘；此处仅存用户显式选择的主音数字 + 大小调（2 个字段），
// 随时可在界面一键清除。存储不可用（隐私模式等）时静默降级为"不记忆"。

import type { Mode } from '../core/types'

const STORAGE_KEY = 'fmk.my-key'

export interface StoredKey {
  tonicPc: number  // 主音 pitch class 0..11（0=C）
  mode: Mode
}

export class MyKeyStore {
  constructor(private storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null) {}

  /** 读取"我的调"；数据损坏/字段非法一律返回 null（当没设过）。 */
  load(): StoredKey | null {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY)
      if (!raw) return null
      const obj = JSON.parse(raw) as Partial<StoredKey>
      if (typeof obj.tonicPc !== 'number' || (obj.mode !== 'major' && obj.mode !== 'minor')) return null
      return { tonicPc: ((Math.round(obj.tonicPc) % 12) + 12) % 12, mode: obj.mode }
    } catch {
      return null
    }
  }

  save(key: StoredKey): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(key))
    } catch { /* 存储不可用：静默降级 */ }
  }

  clear(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY)
    } catch { /* 同上 */ }
  }
}
