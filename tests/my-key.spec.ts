// v1.1.1 回归：我的调持久化（MyKeyStore，注入内存 Storage；node 环境无真实 localStorage）

import { describe, expect, it } from 'vitest'
import { MyKeyStore } from '../src/infrastructure/my-key-store'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  } as Storage
}

describe('MyKeyStore 我的调持久化', () => {
  it('save → load 往返一致；tonicPc 归一化到 0..11', () => {
    const s = fakeStorage()
    const store = new MyKeyStore(s)
    store.save({ tonicPc: 19, mode: 'major' })
    expect(store.load()).toEqual({ tonicPc: 7, mode: 'major' })
  })

  it('clear 后读不到', () => {
    const store = new MyKeyStore(fakeStorage())
    store.save({ tonicPc: 2, mode: 'minor' })
    expect(store.load()).toEqual({ tonicPc: 2, mode: 'minor' })
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('损坏 JSON → 当没设过（null，不抛错）', () => {
    const s = fakeStorage()
    s.setItem('fmk.my-key', '{oops')
    expect(new MyKeyStore(s).load()).toBeNull()
  })

  it('字段非法（mode 越界 / tonicPc 非数字）→ null', () => {
    const s = fakeStorage()
    s.setItem('fmk.my-key', JSON.stringify({ tonicPc: 3, mode: 'dorian' }))
    expect(new MyKeyStore(s).load()).toBeNull()
    s.setItem('fmk.my-key', JSON.stringify({ tonicPc: 'C', mode: 'major' }))
    expect(new MyKeyStore(s).load()).toBeNull()
  })

  it('storage 不可用（null）：静默降级，save/load/clear 不抛错', () => {
    const store = new MyKeyStore(null)
    store.save({ tonicPc: 0, mode: 'major' })
    expect(store.load()).toBeNull()
    store.clear()
  })
})
