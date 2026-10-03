// 时空层级：流转-规则（domain）—— YIN 音高检测原语（docs/04），纯函数

export interface YinResult {
  hz: number        // 0 表示无声
  probability: number // 1 - d'(τ谷)，0..1
}

/**
 * YIN 音高检测（de Cheveigné & Kawahara 2002）。
 * 窗长建议 1024 @16kHz（可检测 31–1000Hz）。
 */
export function yinDetect(buf: Float32Array, sampleRate: number, threshold = 0.12): YinResult {
  const n = buf.length
  const half = n >> 1
  if (half < 16) return { hz: 0, probability: 0 }

  // 1. 差分函数
  const diff = new Float32Array(half)
  for (let tau = 0; tau < half; tau++) {
    let sum = 0
    for (let j = 0; j < half; j++) {
      const d = buf[j] - buf[j + tau]
      sum += d * d
    }
    diff[tau] = sum
  }

  // 2. 累积均值归一
  const cmnd = new Float32Array(half)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau < half; tau++) {
    running += diff[tau]
    cmnd[tau] = running === 0 ? 1 : (diff[tau] * tau) / running
  }

  // 3. 周期搜索：首个质量达标的局部极小（容忍滑音的窗内频率漂移，避免落到二倍周期）
  const QUALITY = 0.35 // cmnd < QUALITY ⇔ prob > 0.65
  let tauEst = -1
  for (let tau = 3; tau < half - 1; tau++) {
    if (cmnd[tau] < cmnd[tau - 1] && cmnd[tau] <= cmnd[tau + 1] && cmnd[tau] < QUALITY) {
      tauEst = tau
      break
    }
  }
  if (tauEst < 0) {
    // 全局最小兜底
    let best = 2
    for (let tau = 3; tau < half; tau++) if (cmnd[tau] < cmnd[best]) best = tau
    if (cmnd[best] < QUALITY) tauEst = best
  }
  if (tauEst < 0) return { hz: 0, probability: 0 }

  // 4. 抛物线插值（亚样本精化）
  let tauFine = tauEst
  if (tauEst > 0 && tauEst + 1 < half) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1]
    const denom = 2 * (s0 + s2 - 2 * s1)
    if (denom !== 0) tauFine = tauEst + (s0 - s2) / denom
  }

  const hz = sampleRate / tauFine
  if (!isFinite(hz) || hz < 30 || hz > 1200) return { hz: 0, probability: 0 }
  return { hz, probability: Math.max(0, Math.min(1, 1 - cmnd[tauEst])) }
}
