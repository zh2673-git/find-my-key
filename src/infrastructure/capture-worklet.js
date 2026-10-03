// 时空层级：数据存储（infrastructure）—— AudioWorklet 采集器（worklet 线程内运行，纯 JS）
// 累积 128 样本块 → 凑满 512 样本 → transferable postMessage（零拷贝移交主线程）

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._size = 512
    this._buf = new Float32Array(this._size)
    this._n = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const ch = input[0]
    let i = 0
    while (i < ch.length) {
      const take = Math.min(this._size - this._n, ch.length - i)
      this._buf.set(ch.subarray(i, i + take), this._n)
      this._n += take
      i += take
      if (this._n === this._size) {
        const out = this._buf.slice(0, this._size)
        this.port.postMessage(out, [out.buffer])
        this._n = 0
      }
    }
    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
