// 时空层级：数据接口（interfaces）—— 单页 UI 事件绑定与渲染（docs/03 §3 路由表）
// 只读订阅 application 的结果；不持有业务状态（录音态/所选主音为 UI 局部态）。

import { ANALYSIS_RATE, CENTS_TOLERANCE, midiToHz, midiToName, NOTE_NAMES, SCALE_MAJOR, SOLFEGE_NAMES } from '../core/constants'
import { DomainError } from '../core/errors'
import type { AnalysisResult, KeyCandidate, Mode, SolfegeNote, VoiceRange } from '../core/types'
import { DEMO_SCALE_C, DEMO_TWINKLE_G, synthMelody } from '../core/synth'
import { analyzeRange, analyzeRecording, analyzeScale, LivePitcher, rekey } from '../application/session'
import type { ScaleMatch } from '../domain/scale-match'
import { describeMelody, describeRange } from '../application/describe'
import { inferChords } from '../domain/harmony'
import { PianoPlayer } from '../infrastructure/piano-audio'
import { MyKeyStore } from '../infrastructure/my-key-store'
import { PianoBoard } from './piano'
import { AudioEngine } from '../runtime/engine'

const engine = new AudioEngine()

const CAL_LIMIT_MS = 8000

// ── 工具 ──

function errText(e: unknown): string {
  if (e instanceof DomainError) {
    switch (e.code) {
      case 'NO_TONE': return '没听清人声，请靠近麦克风再哼一次'
      case 'RANGE_INSUFFICIENT': return '几乎没采到声音，请检查麦克风后重试'
      case 'RANGE_TOO_NARROW': return '滑音跨度太小了，请从最低一直哼到最高'
      case 'SCALE_TOO_SHORT': return '音阶没听全——从「do」开始慢一点唱，每个音拖半秒以上'
    }
  }
  return e instanceof Error ? e.message : String(e)
}

// ── 音域渲染 ──
const RANGE_VIEW_LOW = 36  // C2
const RANGE_VIEW_HIGH = 84 // C6

function renderRange(vr: VoiceRange, el: HTMLElement): void {
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - RANGE_VIEW_LOW) / (RANGE_VIEW_HIGH - RANGE_VIEW_LOW)) * 100))
  const left = pct(vr.lowMidi)
  const width = pct(vr.highMidi) - left
  // 推荐主音渲染成可点按钮：点一下即设为"我的调"（默认按大调，之后可在下方钢琴区切换大小调）
  const tonicBtns = vr.recommendedTonics
    .map(pc => `<button class="mini ghost tonic-pick" data-pc="${pc}" title="把 ${NOTE_NAMES[pc]} 设为我的调">${NOTE_NAMES[pc]}</button>`)
    .join(' ') || '（范围偏窄，暂无稳定推荐）'
  const myKeyLabel = myKey ? `★ 我的调：${NOTE_NAMES[myKey.tonicPc]} ${myKey.mode === 'major' ? '大调' : '小调'}` : '未固定我的调'
  el.innerHTML = `
    <div class="result-block">
      <b>你的舒适音域：${midiToName(vr.lowMidi)} – ${midiToName(vr.highMidi)}</b>
      （跨度 ${Math.round(vr.spanSemitones)} 个半音，自然中心 ${midiToName(vr.centerMidi)}）
      <div class="range-bar"><div class="range-fill" style="left:${left}%;width:${width}%"></div></div>
      <div class="range-label"><span>${midiToName(RANGE_VIEW_LOW)}</span><span>${midiToName(RANGE_VIEW_HIGH)}</span></div>
      <div class="tonic-row">你的 do 可以落在：<b>${tonicBtns}</b>
        <span class="key-tag">点一下设为我的调（最省力）</span>
        <span id="cal-my-key" class="key-tag">${myKeyLabel}</span></div>
      <div class="describe">${describeRange(vr)}</div>
    </div>`

  // 状态条同步：测过跨度就常驻显示（v1.3）
  statusRange.textContent = `音域：${midiToName(vr.lowMidi)} – ${midiToName(vr.highMidi)}`

  el.querySelectorAll<HTMLButtonElement>('.tonic-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      myKey = { tonicPc: Number(btn.dataset.pc), mode: 'major' }
      myKeyStore.save(myKey)
      syncMyKeyUi()
    })
  })
}

// ── 音阶定调渲染（v1.2）：唱 1234567 → 你的 do 在哪 + 逐音白话反馈 ──
function renderScaleMatch(m: ScaleMatch, el: HTMLElement): void {
  const tonicName = NOTE_NAMES[m.tonicPc]
  const offKeys = (s: number) => {
    const n = Math.abs(s)
    return `${s > 0 ? '高' : '低'}了约 ${n >= 0.95 ? Math.round(n) + ' 个琴键' : '半个琴键'}`
  }

  const lines: string[] = []
  if (m.ok) {
    lines.push(`唱完了！${m.total} 个音里有 ${m.hit} 个稳稳落在 do re mi fa sol la si 上。`)
    lines.push(`判定：你心中的 do，就是钢琴上的 ${tonicName} 键（${tonicName} 大调）。`)
    lines.push('下一步：点下面「设为我的调」，以后哼唱翻译都固定按它来。')
  } else {
    lines.push(`${m.total} 个音里有 ${m.total - m.hit} 个跑到了音阶外面，这次先不定调。`)
    lines.push('下一步：慢一点，从「do」开始一个音一个音唱，每个音拖半秒以上；唱不准也没关系，也可以换「滑音测跨度」先看看自己的范围。')
  }
  for (const d of m.deviants.slice(0, 3)) {
    lines.push(`第 ${d.index + 1} 个音没落在音阶上（${offKeys(d.semitones)}），多半是唱到隔壁键去了。`)
  }
  if (m.steps) {
    const bad = m.steps.filter(s => Math.abs(s.semitones) > 0.6)
    if (bad.length === 0) lines.push('相邻音的间距也和大调音阶一模一样，唱得很标准！')
    else for (const s of bad.slice(0, 3)) lines.push(`第 ${s.index + 1} 个音和前一个的间距不对（${offKeys(s.semitones)}）——试着唱回正好的距离。`)
  }

  el.innerHTML = `
    <div class="result-block">
      <b>音阶定调：${m.ok ? `你的 do 是 ${tonicName}` : '还差一点，再唱一次'}</b>
      <div class="describe">${lines.join('\n')}</div>
      ${m.ok ? `<div class="tonic-row">
        <button id="scale-set-key" class="primary mini">✓ 设为我的调（${tonicName} 大调）</button>
        <span id="cal-my-key" class="key-tag">${myKey ? `当前我的调：${NOTE_NAMES[myKey.tonicPc]} ${myKey.mode === 'major' ? '大调' : '小调'}` : '未固定我的调'}</span>
      </div>` : ''}
    </div>`

  const setBtn = el.querySelector<HTMLButtonElement>('#scale-set-key')
  setBtn?.addEventListener('click', () => {
    myKey = { tonicPc: m.tonicPc, mode: 'major' }
    myKeyStore.save(myKey)
    syncMyKeyUi()
    setBtn.textContent = `✓ 已固定 ${tonicName} 大调——哼唱翻译将固定按它算`
  })
}

// ── 唱名渲染 + A/B 对照闭环（docs/08）──
// 单一状态源：lastResult + lastBuf + curKey/curSolfege；任何主音变化都走 paintSolfege 同步重绘。

const player = new PianoPlayer()
const board = new PianoBoard()
board.render(document.querySelector<HTMLElement>('#piano-mount')!)
// renderFreqCard 的首次调用在文件尾（curKey/DEGREE_ST 初始化之后，避免 TDZ）

// ── 旋律回放 + 跟弹指引（v1.4，docs/11）──
let seqStop: (() => void) | null = null
let guideOn = false
let guideTotal = 0
let arpStop: (() => void) | null = null // 琶音回放的停止句柄（v1.10）
let singStop: (() => void) | null = null // 弹唱和弦发声体的停止句柄（v1.12）
/** 原声按钮复位（paintSolfege 每次渲染时重挂）——stopSeq 全局停声时也要复位它（v1.12）。 */
let resetRawBtn: () => void = () => {}

/** 停止旋律回放并复位按钮文案（按钮可能因重绘重建，动态查询）。
 * v1.12 升级为全局停声：演奏/琶音/弹唱和弦/原声一并停掉，播放头与原声按钮同步复位。 */
function stopSeq(): void {
  seqStop?.()
  seqStop = null
  arpStop?.() // 琶音未完先停（v1.10）
  arpStop = null
  singStop?.() // 弹唱和弦未完先停（v1.12）
  singStop = null
  stopSingalong() // 重听原声的全曲伴奏调度一并清（v1.12.4）
  player.stopBuffer() // 演奏/跟弹启动时停掉在播原声，防叠音（v1.8.7）
  const btn = humResult.querySelector<HTMLButtonElement>('#play-seq')
  if (btn) btn.textContent = '▶ 按你哼的节奏演奏'
  board.highlight(null)
  board.highlightMulti(null)
  resetRawBtn()
  if (playheadSec != null) { // 播放头随停声复位（v1.12）
    playheadSec = null
    if (lastResult) repaintFinalCanvas(calCanvas, lastResult)
  }
}

/** 全曲伴奏计划（v1.12.4）：paintMelodyGrid 每次重绘时填充——
 * 「重听我的原声」勾选「＋和弦伴奏」时按此逐段铺柱式和弦（与原声同轴）。 */
let lastChordPlan: Array<{ from: number; to: number; midis: number[] }> = []
let singalongTimers: number[] = []
let singalongStops: Array<() => void> = []

/** 清全曲伴奏：未触发的段不再响，正在响的段立即静音（中途停止不留和弦拖尾）。 */
function stopSingalong(): void {
  singalongTimers.forEach(id => window.clearTimeout(id))
  singalongTimers = []
  singalongStops.forEach(stop => stop())
  singalongStops = []
}

/** 退出跟弹模式。 */
function exitGuide(msg = ''): void {
  guideOn = false
  guideTotal = 0
  board.clearGuide()
  const st = humResult.querySelector<HTMLElement>('#guide-status')
  if (st) st.textContent = msg
  const btn = humResult.querySelector<HTMLButtonElement>('#guide-btn')
  if (btn) btn.textContent = '跟弹指引'
}

function updateGuideStatus(ok: boolean): void {
  const st = humResult.querySelector<HTMLElement>('#guide-status')
  if (!st) return
  const done = board.guideIndex()
  st.textContent = ok
    ? `跟弹中 ${done} / ${guideTotal}——点亮着提示的那个键`
    : `不对哦，亮着提示的键（第 ${done + 1} 个音）才是下一个`
}

board.onKeyClick(midi => {
  player.play(midi)
  // 跟弹模式：点对前进，点错提示（不吃掉发声，先响后判）
  if (guideOn) {
    const ok = board.advance(midi)
    if (board.guideActive()) updateGuideStatus(ok)
    return
  }
  board.highlight(midi)
  const pickDo = document.querySelector<HTMLInputElement>('#pick-do')
  if (pickDo?.checked && lastResult) {
    const pc = ((midi % 12) + 12) % 12
    const mode = labelBase().mode
    // 大调：点中的键直接当 do；小调（la 式）：点中的键当 6（la）→ 主音 = 键 − 3 半音
    adoptKey(mode === 'minor' ? (pc + 9) % 12 : pc, mode)
  }
})

let lastResult: AnalysisResult | null = null
let lastBuf: Float32Array | null = null
let curSolfege: SolfegeNote[] = []
/** 本次哼唱的调性判定（仅作"建议"显示，不直接驱动任何简谱标签）。 */
let detected: KeyCandidate | null = null
/** 当前采纳的调（= myKey 的镜像，供渲染取用）。 */
let curKey: KeyCandidate | null = null

// ── 我的调（v1.1.1）：用户显式固定的主音，哼唱翻译默认按它映射，不再随每次哼唱漂移 ──
const myKeyStore = new MyKeyStore()
let myKey = myKeyStore.load()

/** 简谱标签统一基准（v1.8.6）：我的调 ?? C 大调。规则只有一条——
 * 绝对音（键名/频率/键位）恒定，相对音（简谱数字）只随用户显式定调变化；
 * 未定调时一律按中央 C（C 大调）显示，哼唱判定只是"建议"。 */
function labelBase(): { tonicPc: number; mode: Mode } {
  return myKey ?? { tonicPc: 0, mode: 'major' as Mode }
}

function syncMyKeyUi(): void {
  const label = myKey ? `★ 我的调：${NOTE_NAMES[myKey.tonicPc]} ${myKey.mode === 'major' ? '大调' : '小调'}` : ''
  myKeyStatus.textContent = myKey
    ? `★ 我的调：${NOTE_NAMES[myKey.tonicPc]} ${myKey.mode === 'major' ? '大调' : '小调'}——哼唱翻译将固定按它映射唱名`
    : '未固定：哼唱翻译每次自动猜调（起点音高漂移会导致判定不同）'
  statusClear.hidden = !myKey
  // 状态条（v1.8 融合为一：哼唱即主流程，"我的调"自动来自哼唱判定，人工固定为修正手段）
  statusMyKey.textContent = myKey
    ? `我的调：${NOTE_NAMES[myKey.tonicPc]} ${myKey.mode === 'major' ? '大调' : '小调'}`
    : '我的调：未定调（简谱按中央 C 显示）'
  // 校准工具里的标注（若已渲染）同步更新
  const calTag = document.querySelector<HTMLElement>('#cal-my-key')
  if (calTag) calTag.textContent = label || '未固定我的调'
}

function chipHtml(s: SolfegeNote, medDur: number, grow: number): string {
  const cls = ['sol']
  if (s.octaveShift > 0) cls.push('hi')
  if (s.octaveShift < 0) cls.push('lo')
  if (Math.abs(s.cents) > 30) cls.push('off')
  if (s.endSec - s.startSec > medDur * 1.8) cls.push('long')
  const tip = `${midiToName(s.midi)} · 点一下听该键标准音${Math.abs(s.cents) > 20 ? `（你哼的比标准${s.cents > 0 ? '高' : '低'}${Math.abs(Math.round(s.cents))} 音分）` : ''}`
  return `<span class="${cls.join(' ')}" style="flex-grow:${grow.toFixed(4)}" title="${tip}">${s.symbol}<i>${midiToName(s.midi)}</i></span>`
}

/** 旋律对齐网格（v1.9 → v1.10 重构）：和弦行 / 简谱行 / 节奏行三行同比例伸缩（flex-grow∝时长），
 * 边界自动对齐——和弦落在它覆盖的音符正上方，节奏形状与数字一一对应。
 * 点和弦块 = 按当前弹法（柱式/琶音/弹唱）演奏；弹唱弹法 = 和弦伴奏 + 该段原声一起播（v1.12）。 */
let chordMode: 'block' | 'arp' | 'sing' = 'block'
let lastMedDur = 1 // paintSolfege 记下的中位时值——弹法切换重绘网格时复用（v1.12）

function chordModeLabel(): string {
  return chordMode === 'block' ? '柱式（三音齐弹）' : chordMode === 'arp' ? '琶音（依次滚弹）' : '🎤 弹唱（和弦+原声）'
}

function paintMelodyGrid(medDur: number): void {
  const host = document.getElementById('melody-grid')
  if (!host || !lastResult || !curKey) {
    if (host) host.innerHTML = ''
    return
  }
  const notes = lastResult.notes
  const b = labelBase()
  const base = b.mode === 'minor' ? (b.tonicPc + 3) % 12 : b.tonicPc
  const segs = notes.length >= 3 ? inferChords(notes, base) : []
  const doMidi = 12 * Math.round((60 - base) / 12) + base
  // 和弦计划一次算好（v1.12.4）：网格块与「重听+伴奏」共用同一组琴键，不两处各算
  const chordPlan = segs.map(s => {
    const minor = s.label.endsWith('m')
    const rootPc = NOTE_NAMES.indexOf(s.label.replace(/m$/, '') as (typeof NOTE_NAMES)[number])
    const rootMidi = doMidi + (rootPc >= 0 ? (rootPc - base + 12) % 12 : 0)
    const third = minor ? 3 : 4
    return { seg: s, third, midis: [rootMidi, rootMidi + third, rootMidi + 7] }
  })
  lastChordPlan = chordPlan.map(p => ({ from: p.seg.startSec, to: p.seg.endSec, midis: p.midis }))
  const durs = notes.map(n => Math.max(0.05, n.endSec - n.startSec))
  const minDur = Math.min(...durs)

  // 行 1：和弦块（宽度∝段时长；data-* 携带演奏信息与该段时间区间——弹唱模式播原声用）。
  // ×N（v1.12.1）：按最短音节拍折算这段该弹几次（与节奏行 ×n 同一把尺）——长和弦段标注弹奏次数。
  // 段间空隙用 .mg-gap 垫片承载（v1.12.2）：否则 flex 把音间空隙摊进块宽，边界漂移——
  // 看起来"和弦块把下一个和弦的首音也包了进去"。
  const chordHtml = chordPlan.map((p, i) => {
    const s = p.seg
    const beats = Math.max(1, Math.round((s.endSec - s.startSec) / minDur))
    const tip = chordMode === 'sing'
      ? `${s.startSec.toFixed(1)}s ~ ${s.endSec.toFixed(1)}s · 约 ${beats} 拍，自己弹按节奏扫 ${beats} 次 · 点一下 = ${s.label} 伴奏 + 这段你的原声一起播（弹唱）`
      : `${s.startSec.toFixed(1)}s ~ ${s.endSec.toFixed(1)}s · 约 ${beats} 拍，自己弹按节奏弹 ${beats} 次 · 点一下在钢琴上弹 ${s.label}`
    const gapAfter = i < chordPlan.length - 1
      ? `<span class="mg-gap" style="flex-grow:${Math.max(0, chordPlan[i + 1].seg.startSec - s.endSec).toFixed(4)}"></span>`
      : ''
    return `<button class="chord" style="flex-grow:${durs.length ? (s.endSec - s.startSec).toFixed(4) : '1'}" data-root="${p.midis[0]}" data-third="${p.third}" data-from="${s.startSec}" data-to="${s.endSec}" title="${tip}">${s.label}<i><b>×${beats}</b> · ${s.numeral}级</i></button>${gapAfter}`
  }).join('')

  // 行 2：简谱数字（宽度∝音时长）；行 3：节奏块（×n = 相对最短音的倍数）。
  // 音间空隙同样用垫片承载（v1.12.2）——三行同位同宽，与和弦块/色块图严格对齐
  const gapSpan = (from: number, to: number): string =>
    `<span class="mg-gap" style="flex-grow:${Math.max(0, to - from).toFixed(4)}"></span>`
  const chipRow = notes.map((n, i) =>
    chipHtml(curSolfege[i], medDur, durs[i]) + (i < notes.length - 1 ? gapSpan(n.endSec, notes[i + 1].startSec) : '')
  ).join('')
  const rhythmRow = notes.map((n, i) => {
    const mult = Math.max(1, Math.round(durs[i] / minDur))
    return `<span class="rnote" style="flex-grow:${durs[i].toFixed(4)}" title="${n.startSec.toFixed(1)}s 起 · ${(n.endSec - n.startSec).toFixed(2)}s ≈ 最短音的 ${mult} 倍">×${mult}</span>${i < notes.length - 1 ? gapSpan(n.endSec, notes[i + 1].startSec) : ''}`
  }).join('')

  host.innerHTML = `
    ${segs.length ? `<div class="mg-row chord-row">${chordHtml}</div>` : ''}
    <div class="mg-row chip-row">${chipRow}</div>
    <div class="mg-row rhythm-row">${rhythmRow}</div>
    ${segs.length ? `<div class="note-detail">参考和弦（单音哼唱按乐句推的伴奏起步）· 弹法：<button id="chord-mode" class="ghost mini">${chordModeLabel()}</button> · 点和弦块按弹法演奏；弹唱模式 = 和弦伴奏 + 那段原声一起播（直接听弹唱效果）· 和弦下的 <b>×N</b> = 这段按最短音节拍该弹几次（对照下方 ×n 节奏）</div>` : ''}`

  // 点简谱 = 该键标准音（与点钢琴键同源）；一声一道：先停掉在播的原声/演奏/弹唱
  host.querySelectorAll<HTMLSpanElement>('.sol').forEach((chip, idx) => {
    chip.addEventListener('click', () => {
      const s = curSolfege[idx]
      if (!s) return
      stopSeq()
      player.play(s.midi)
      board.highlight(s.midi)
      chip.classList.add('on')
      window.setTimeout(() => chip.classList.remove('on'), 350)
    })
  })

  // 点和弦块 = 按弹法演奏：柱式三音齐弹 / 琶音依次滚弹 / 弹唱 = 和弦铺满整段 + 该段原声一起播（v1.12）
  host.querySelectorAll<HTMLButtonElement>('.chord').forEach(btn => {
    btn.addEventListener('click', () => {
      stopSeq()
      exitGuide()
      const root = Number(btn.dataset.root)
      const third = Number(btn.dataset.third)
      const from = Number(btn.dataset.from)
      const to = Number(btn.dataset.to)
      const midis = [root, root + third, root + 7]
      btn.classList.add('on')
      window.setTimeout(() => btn.classList.remove('on'), chordMode === 'sing' ? Math.min(4000, (to - from) * 1000 + 400) : 900)
      if (chordMode === 'block') {
        player.playChord(midis)
        board.highlightMulti(midis)
        window.setTimeout(() => board.highlightMulti(null), 1400)
      } else if (chordMode === 'arp') {
        arpStop = player.playArpeggio(midis, i => board.highlight(i >= 0 ? midis[i] : null))
      } else if (lastBuf && lastResult) {
        // 弹唱（v1.12）：和弦伴奏铺满该段（时值+0.4s 尾音，上限 4s）+ 该段原声同时播——
        // 直接听"弹唱效果"；画布播放头同步扫过该段，播完自动复位。
        // 原声边界（v1.12.3）：段首音的余量起点 ~ 段尾音的余量终点（余量不越过相邻音）——
        // ×N 标几次就真的响几个音，隔壁和弦的首音不会被带进来
        const all = lastResult.notes
        const i0 = all.findIndex(n => n.startSec >= from - 1e-6)
        let i1 = Math.max(0, i0)
        for (let i = Math.max(0, i0); i < all.length; i++) {
          if (all[i].endSec <= to + 1e-6) i1 = i
          else break
        }
        const head = i0 >= 0 ? rawSliceBounds(i0).from : Math.max(0, from - 0.15)
        const tail = rawSliceBounds(i1).to
        singStop = player.playChord(midis, Math.min(to - from + 0.4, 4))
        board.highlightMulti(midis)
        player.playBuffer(lastBuf, head, tail, t => {
          if (t === null) {
            playheadSec = null
            singStop?.(); singStop = null
            board.highlightMulti(null)
            if (lastResult) repaintFinalCanvas(calCanvas, lastResult)
            return
          }
          playheadSec = t
          if (lastResult) repaintFinalCanvas(calCanvas, lastResult)
        })
      }
    })
  })

  // 弹法切换（柱式 ↔ 琶音 ↔ 弹唱），会话级记忆；重绘网格以刷新和弦块提示文案
  host.querySelector<HTMLButtonElement>('#chord-mode')?.addEventListener('click', ev => {
    chordMode = chordMode === 'block' ? 'arp' : chordMode === 'arp' ? 'sing' : 'block'
    ;(ev.currentTarget as HTMLButtonElement).textContent = chordModeLabel()
    paintMelodyGrid(lastMedDur)
  })
}

function paintSolfege(): void {
  if (!lastResult || !curKey) return
  const r = lastResult
  const durs = r.notes.map(n => n.endSec - n.startSec).sort((a, b) => a - b)
  const medDur = durs.length ? durs[durs.length >> 1] : 1
  const det = detected
  const keyLabel = det
    ? det.mode === 'minor'
      ? `1=${NOTE_NAMES[(det.tonicPc + 3) % 12]}（${NOTE_NAMES[det.tonicPc]} 小调 · la 式）`
      : `1=${NOTE_NAMES[det.tonicPc]}（大调）`
    : '暂无（哼一段后出）'

  const options = (['major', 'minor'] as Mode[]).flatMap(mode =>
    NOTE_NAMES.map((name, pc) => {
      const star = r.keys.some(k => k.tonicPc === pc && k.mode === mode) ? ' ★' : ''
      const selected = pc === curKey!.tonicPc && mode === curKey!.mode ? ' selected' : ''
      return `<option value="${pc}-${mode}"${selected}>${name} ${mode === 'major' ? '大调' : '小调'}${star}</option>`
    }),
  ).join('')

  humResult.innerHTML = `
    <div class="result-block">
      <div id="melody-grid"></div>
      <div class="describe" id="melody-describe">${describeMelody(curSolfege, curKey)}</div>
      <div class="tonic-row">
        ${myKey
          ? `<span class="key-tag">★ 简谱基准：1=${NOTE_NAMES[labelBase().mode === 'minor' ? (labelBase().tonicPc + 3) % 12 : labelBase().tonicPc]}（按你固定的调显示）</span>`
          : '<span class="key-tag">未定调：简谱按中央 C（1=C）显示 · 钢琴键名见数字下方</span>'}
        判定建议：<b>${keyLabel}</b>
        <button id="adopt-key" class="primary mini">✓ 按此显示并固定</button>
        换调显示：<select id="tonic-select">${options}</select>
        <span class="status">音偏橙 = 偏离半音超 30 音分；边框橙 = 长音</span>
      </div>
      <div class="row seq-row">
        <button id="play-seq" class="primary mini">▶ 按你哼的节奏演奏</button>
        <button id="play-raw" class="ghost mini">🎤 重听我的原声</button>
        <label class="raw-opt" title="勾选后，重听原声时按上面的和弦进度自动铺伴奏——听整段弹唱效果"><input type="checkbox" id="raw-chord-opt">＋和弦伴奏</label>
        <button id="guide-btn" class="ghost mini">跟弹指引</button>
        <span id="guide-status" class="status"></span>
      </div>
      <div class="note-detail">共 ${r.notes.length} 个音符 · 点音符 = 听该键标准音（键名标在数字下方）；「重听原声」= 你哼的原始录音，勾选<b>＋和弦伴奏</b> = 按上方和弦进度自动铺伴奏（整段弹唱效果）；「演奏」= 标准音按你哼的节奏连播并逐键高亮；「跟弹」= 琴键上标好顺序，点对一个亮下一个</div>
    </div>`

  paintMelodyGrid(medDur)
  lastMedDur = medDur // 弹法切换重绘网格时复用（v1.12）

  // 音区自适应（v1.5）：扩展钢琴到覆盖旋律全部音符（±2 半音余量），低音不再被夹到最左键
  if (r.notes.length > 0) {
    const lo = Math.min(...r.notes.map(n => n.midi))
    const hi = Math.max(...r.notes.map(n => n.midi))
    board.setRange(lo - 2, hi + 2)
  }
  board.setKey(curKey.tonicPc, curKey.mode)

  // 重绘（换调/新分析）会重建按钮 → 回放与跟弹状态复位（闭包不引用旧 DOM）
  stopSeq()
  exitGuide()

  // ── 原声回放（v1.8.5 独立入口；v1.8.7 支持中途停止；v1.12 播放头联动画布）──
  const rawBtn = humResult.querySelector<HTMLButtonElement>('#play-raw')
  let rawTimer = 0
  resetRawBtn = (): void => {
    window.clearTimeout(rawTimer)
    stopSingalong() // 伴奏调度随按钮复位一并清（v1.12.4）
    if (rawBtn) rawBtn.textContent = '🎤 重听我的原声'
  }
  rawBtn?.addEventListener('click', () => {
    if (!lastResult || !lastBuf) return
    const notes = lastResult.notes
    if (!notes.length) return
    const wasPlaying = rawBtn.textContent !== '🎤 重听我的原声' // 先捕获状态（stopSeq 会复位按钮）
    stopSeq()
    exitGuide()
    // 播放中再点 = 停止（按钮文案即状态；stopSeq 已静默停声并复位播放头）
    if (wasPlaying) return
    const from = notes[0].startSec
    const to = notes[notes.length - 1].endSec
    // ＋和弦伴奏（v1.12.4）：勾选后按和弦计划逐段铺柱式和弦（时值=段长，上限 6s），
    // 调度与原声同轴（同从首音起点起播）——整段弹唱效果；stopSeq/resetRawBtn 统一清调度
    const rawOpt = humResult.querySelector<HTMLInputElement>('#raw-chord-opt')
    if (rawOpt?.checked && lastChordPlan.length) {
      lastChordPlan.forEach(p => {
        const delay = Math.max(0, (p.from - from) * 1000)
        singalongTimers.push(window.setTimeout(() => {
          // 全曲连播：和弦正好铺到段尾（不加尾音）——原声播完时全部和弦已自然收束，
          // 无戛然而止也无拖尾；单段弹唱试听才 +0.4s 尾音
          singalongStops.push(player.playChord(p.midis, Math.min(p.to - p.from, 6)))
        }, delay))
      })
    }
    // onProgress（v1.12）：整段原声播放时，播放头在画布上同步扫过（对节奏），播完自动复位
    player.playBuffer(lastBuf, from, to, t => {
      if (t === null) {
        playheadSec = null
        resetRawBtn()
        if (lastResult) repaintFinalCanvas(calCanvas, lastResult)
        return
      }
      playheadSec = t
      if (lastResult) repaintFinalCanvas(calCanvas, lastResult)
    })
    rawBtn.textContent = '■ 停止播放'
    // 自然播完由 onProgress(null) 复位；此定时器兜底（回调被静默路径吞掉时仍能复位按钮）
    window.clearTimeout(rawTimer)
    rawTimer = window.setTimeout(resetRawBtn, Math.max(300, (to - from) * 1000))
  })

  // 采纳判定（v1.8.6）：判定只是建议，点按钮/换下拉才改变简谱基准（存为我的调）
  humResult.querySelector<HTMLButtonElement>('#adopt-key')?.addEventListener('click', () => {
    if (!detected) return
    adoptKey(detected.tonicPc, detected.mode)
  })

  const sel = humResult.querySelector<HTMLSelectElement>('#tonic-select')
  sel?.addEventListener('change', () => {
    const [pcStr, mode] = (sel.value || '0-major').split('-')
    adoptKey(Number(pcStr), mode as Mode)
  })

  // ── 旋律回放（按哼唱节奏连播标准音，琴键逐音高亮跟随）──
  humResult.querySelector<HTMLButtonElement>('#play-seq')?.addEventListener('click', () => {
    if (!lastResult || !lastBuf) return
    if (seqStop) { stopSeq(); return }
    exitGuide()
    const seq = lastResult.notes.map(n => ({ midi: n.midi, startSec: n.startSec, durSec: n.endSec - n.startSec }))
    board.highlight(null)
    const btn = humResult.querySelector<HTMLButtonElement>('#play-seq')!
    btn.textContent = '■ 停止演奏'
    seqStop = player.playSequence(
      seq,
      i => board.highlight(seq[i].midi),
      () => { seqStop = null; btn.textContent = '▶ 按你哼的节奏演奏'; board.highlight(null) },
    )
  })

  // ── 跟弹指引（琴键标序号，点对一个亮下一个；与"点琴键选 do"互斥）──
  humResult.querySelector<HTMLButtonElement>('#guide-btn')?.addEventListener('click', () => {
    if (!lastResult) return
    if (guideOn) { exitGuide('已退出跟弹'); return }
    stopSeq()
    const pickDo = document.querySelector<HTMLInputElement>('#pick-do')
    if (pickDo) pickDo.checked = false
    const seq = lastResult.notes.map(n => n.midi)
    guideTotal = seq.length
    guideOn = true
    board.showGuide(seq, () => {
      guideOn = false
      const st = humResult.querySelector<HTMLElement>('#guide-status')
      if (st) st.textContent = `全对！这段旋律（${guideTotal} 个音）你已经亲手弹出来了`
      const btn = humResult.querySelector<HTMLButtonElement>('#guide-btn')
      if (btn) btn.textContent = '跟弹指引'
    })
    const btn = humResult.querySelector<HTMLButtonElement>('#guide-btn')
    if (btn) btn.textContent = '退出跟弹'
    updateGuideStatus(true)
  })
}

/** 采纳一个调（v1.8.6）：唯一改变简谱基准的入口——存"我的调"并全链重绘
 * （音符数字、钢琴键标、频率卡、画布刻度同源同步）。下拉换调/点琴键选 do/判定采纳都走这里。 */
function adoptKey(tonicPc: number, mode: Mode): void {
  myKey = { tonicPc, mode }
  myKeyStore.save(myKey)
  syncMyKeyUi()
  if (lastResult) {
    curKey = { tonicPc, mode, score: 0 }
    curSolfege = rekey(lastResult, tonicPc, mode)
    paintSolfege()
  }
  renderFreqCard()
}

// ── 频率对照卡（v1.6）：当前调的简谱 ↔ 标准频率 ↔ 唱准范围 ──
/** do 到各度音的半音数（自然大调 1–7 + 高八度 do）。 */
const DEGREE_ST = [0, 2, 4, 5, 7, 9, 11, 12]
function renderFreqCard(): void {
  const mount = document.querySelector<HTMLElement>('#freq-mount')
  if (!mount) return
  // 与简谱标签同源：base = 基准调的 do（大调 tonic / 小调 la 式 tonic+3）；do 八度取最接近中央区的
  const base = curKey ? (curKey.mode === 'minor' ? (curKey.tonicPc + 3) % 12 : curKey.tonicPc) : 0
  const doMidi = 12 * Math.round((60 - base) / 12) + base
  const k = Math.pow(2, CENTS_TOLERANCE / 1200) // ±30 音分的频率比（≈ ±1.75%）
  const modeName = curKey?.mode === 'minor' ? '小调（la 式：6 是主音，频率表仍以 1=do 排）' : '大调'
  const rows = DEGREE_ST.map((st, i) => {
    const midi = doMidi + st
    const f = midiToHz(midi)
    const deg = (i % 7) + 1
    const label = i === 7 ? '1<span class="dot">̇</span>' : String(deg)
    return `<tr><td><b>${label}</b></td><td>${SOLFEGE_NAMES[i % 7]}</td><td>${midiToName(midi)}</td><td class="num">${f.toFixed(1)}</td><td class="num">${(f / k).toFixed(0)} ~ ${(f * k).toFixed(0)}</td></tr>`
  }).join('')
  mount.innerHTML = `
    <details class="freq-card">
      <summary>每个音的频率对照表（简谱基准：1=${NOTE_NAMES[base]} · ${midiToName(doMidi)} · ${modeName}）</summary>
      <table>
        <thead><tr><th>简谱</th><th>唱名</th><th>钢琴键</th><th>标准频率 Hz</th><th>唱准范围（±30 音分）</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">对照规律：高一个八度频率翻倍、低一个八度减半（表里唱 5 就看 sol 那行）。"唱准范围"和唱名方块变橙是同一把尺子——波动落在这个区间内就算唱准。</p>
    </details>`
}

// ── 实时音高画布（v1.7：背景 = 当前调的简谱刻度 + 唱准带，音高曲线在刻度间上下走）──
/** 画布基准：与全部简谱标签同源（labelBase）——未定调永远中央 C，定调后随我的调。 */
function liveBase(): number {
  return labelBase().mode === 'minor' ? (labelBase().tonicPc + 3) % 12 : labelBase().tonicPc
}

/** 画布公共背景（v1.11 抽取）：音高窗口自适应 + 调外格线 + 调内唱准带/刻度/标签。
 * drawLive（实时曲线）与 repaintFinalCanvas（全曲色块）共用同一把 y 尺。 */
function drawPitchGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  midis: number[],
  base: number,
): { yOf: (m: number) => number; LO: number; HI: number; LABEL_W: number; doMidi: number } {
  const doMidi = 12 * Math.round((60 - base) / 12) + base
  // 窗口自适应：默认 do−2 ~ +13 半音；实际音高超出时向外扩展（只扩不缩），不裁剪真实音高
  let LO = doMidi - 2
  let HI = doMidi + 13
  for (const m of midis) {
    LO = Math.min(LO, Math.floor(m) - 1)
    HI = Math.max(HI, Math.ceil(m) + 1)
  }
  const yOf = (m: number) => h - ((m - LO) / (HI - LO)) * h
  const band = (0.3 / (HI - LO)) * h
  const row = h / (HI - LO)
  const LABEL_W = 58

  // ① 调外半音格线（极淡）：跑偏时能看到"掉进哪个缝隙"
  ctx.strokeStyle = 'rgba(120, 96, 72, .06)'
  ctx.lineWidth = 1
  for (let m = LO; m <= HI; m++) {
    const st = (((m - doMidi) % 12) + 12) % 12
    if (SCALE_MAJOR.includes(st as 0 | 2 | 4 | 5 | 7 | 9 | 11)) continue
    const y = Math.round(yOf(m)) + .5
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }

  // ② 调内音：唱准带 + 刻度线（do 行微强调），右侧标签区画 简谱数字 + 音名
  const fontDeg = Math.max(10, Math.min(13, row * 0.95))
  for (let m = LO; m <= HI; m++) {
    const st = (((m - doMidi) % 12) + 12) % 12
    const deg = SCALE_MAJOR.indexOf(st as 0 | 2 | 4 | 5 | 7 | 9 | 11) + 1
    if (deg === 0) continue
    const y = yOf(m)
    const isDo = deg === 1
    ctx.fillStyle = isDo ? 'rgba(120, 96, 72, .14)' : 'rgba(120, 96, 72, .07)'
    ctx.fillRect(0, y - band, w, band * 2)
    ctx.strokeStyle = isDo ? 'rgba(120, 96, 72, .45)' : 'rgba(120, 96, 72, .22)'
    ctx.lineWidth = isDo ? 1.5 : 1
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = isDo ? '#8a6d3b' : 'rgba(120, 96, 72, .70)'
    ctx.font = `${isDo ? 800 : 500} ${fontDeg}px system-ui, sans-serif`
    ctx.fillText(isDo && m - doMidi === 12 ? '1′' : String(deg), w - LABEL_W + 8, y + 4)
    ctx.fillStyle = 'rgba(120, 96, 72, .45)'
    ctx.font = `500 ${Math.round(fontDeg * 0.7)}px system-ui, sans-serif`
    ctx.fillText(midiToName(m), w - LABEL_W + (isDo && m - doMidi === 12 ? 26 : 22), y + 4)
  }
  return { yOf, LO, HI, LABEL_W, doMidi }
}

// ── 全曲视图（v1.11）：分析后画布切换为时间轴色块图，点色块听那段原声（对节奏）──
let canvasPlayIdx = -1
let canvasPlayTimer = 0
/** 原声播放头（v1.12）：整段重听/弹唱播放中 = 当前时刻；null = 未在播。rAF 每帧驱动重绘。 */
let playheadSec: number | null = null

function repaintFinalCanvas(canvas: HTMLCanvasElement, r: AnalysisResult): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || !r.notes.length) return
  const { width: w, height: h } = canvas
  ctx.clearRect(0, 0, w, h)
  const base = liveBase()
  const g = drawPitchGrid(ctx, w, h, r.notes.map(n => n.midi), base)
  const LABEL_W = g.LABEL_W
  const dur = Math.max(0.5, r.notes[r.notes.length - 1].endSec)
  const xOf = (t: number) => (t / dur) * (w - LABEL_W)

  // 每音符一个圆角色块：x=时间、y=音高——块的疏密就是节奏形状
  r.notes.forEach((n, i) => {
    const x1 = xOf(n.startSec)
    const x2 = Math.max(x1 + 6, xOf(n.endSec))
    const yT = g.yOf(n.midi + 0.5)
    const yB = g.yOf(n.midi - 0.5)
    // 高亮 = 点选的音符（canvasPlayIdx）或播放头正扫过的音符（v1.12）
    const hot = i === canvasPlayIdx ||
      (playheadSec != null && playheadSec >= n.startSec && playheadSec < n.endSec)
    ctx.fillStyle = hot ? '#d96a35' : 'rgba(217, 106, 53, .55)'
    ctx.beginPath()
    ctx.roundRect(x1, yT, x2 - x1, yB - yT, 4)
    ctx.fill()
    if (hot) {
      ctx.strokeStyle = '#b04e22'
      ctx.lineWidth = 2.5
      ctx.stroke()
      // ▶ 标记
      ctx.fillStyle = '#fff'
      ctx.font = '800 11px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('▶', x1 + 4, (yT + yB) / 2 + 4)
    }
    // 块上标简谱数字（宽度足够时）——对节奏时看得懂唱到哪个音
    const s = curSolfege[i]?.symbol
    if (s && x2 - x1 >= 18 && yB - yT >= 12) {
      ctx.fillStyle = '#fff'
      ctx.font = '800 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(s, (x1 + x2) / 2, (yT + yB) / 2 + 4)
    }
  })

  // 底部时间刻度（每秒）：断节奏时的参照尺
  ctx.fillStyle = 'rgba(120, 96, 72, .5)'
  ctx.strokeStyle = 'rgba(120, 96, 72, .18)'
  ctx.lineWidth = 1
  ctx.font = '500 9px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (let s = 0; s <= Math.floor(dur); s++) {
    const x = xOf(s)
    ctx.beginPath(); ctx.moveTo(x, h - 12); ctx.lineTo(x, h); ctx.stroke()
    ctx.fillText(`${s}s`, x, h - 15)
  }

  // 播放头（v1.12）：原声/弹唱播放中，竖线随声音同步扫过——看的和听的走同一把时间尺
  if (playheadSec != null) {
    const x = Math.max(0, Math.min(w - LABEL_W, xOf(playheadSec)))
    ctx.strokeStyle = '#b04e22'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 12); ctx.stroke()
    ctx.fillStyle = '#b04e22'
    ctx.beginPath(); ctx.arc(x, 6, 3.5, 0, Math.PI * 2); ctx.fill()
  }

  // 左上角标注当前视图/播放进度
  ctx.textAlign = 'left'
  ctx.fillStyle = playheadSec != null ? '#b04e22' : 'rgba(120, 96, 72, .55)'
  ctx.font = '500 10px system-ui, sans-serif'
  ctx.fillText(playheadSec != null
    ? `▶ ${playheadSec.toFixed(1)}s / ${dur.toFixed(1)}s · 原声播放中`
    : `全曲 ${dur.toFixed(1)}s · 点任一色块听那段原声`, 10, 16)
}

function drawLive(canvas: HTMLCanvasElement, history: (number | null)[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  ctx.clearRect(0, 0, w, h)
  const base = liveBase()
  const g = drawPitchGrid(ctx, w, h, history.filter((m): m is number => m != null), base)
  const { yOf, LO, HI, LABEL_W, doMidi } = g

  // ③ 音高曲线：加粗 + 发光（for 循环避免回调赋值导致的 TS 类型窄化问题）
  let last: { x: number; y: number } | null = null
  ctx.strokeStyle = '#d96a35'
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(217, 106, 53, .45)'
  ctx.shadowBlur = 5
  ctx.beginPath()
  let pen = false
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    const x = (i / Math.max(1, history.length - 1)) * (w - LABEL_W)
    if (m === null) { pen = false; continue }
    const y = yOf(Math.max(LO, Math.min(HI, m)))
    if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true }
    last = { x, y }
  }
  ctx.stroke()
  ctx.shadowBlur = 0

  // ④ 末端圆点 + 左上角大字当前音（数字 · Hz）
  if (last) {
    ctx.fillStyle = '#d96a35'
    ctx.beginPath(); ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(last.x, last.y, 2, 0, Math.PI * 2); ctx.fill()
  }
  const cur = history[history.length - 1]
  if (cur != null) {
    const deg = SCALE_MAJOR.indexOf((((cur - doMidi) % 12) + 12) % 12 as 0 | 2 | 4 | 5 | 7 | 9 | 11) + 1
    ctx.fillStyle = 'rgba(120, 96, 72, .92)'
    ctx.font = '800 15px system-ui, sans-serif'
    ctx.fillText(`${deg > 0 ? deg + ' · ' : ''}${(440 * Math.pow(2, (cur - 69) / 12)).toFixed(1)} Hz`, 10, 22)
  }
  // 基准调标注（v1.8.4）：未用唱名定调时 = 中央 C 基准，即 C 大调（1=C）；固定"我的调"后随其变化
  const baseName = NOTE_NAMES[base]
  const baseOct = Math.floor(doMidi / 12) - 1
  ctx.fillStyle = 'rgba(120, 96, 72, .55)'
  ctx.font = '500 10px system-ui, sans-serif'
  ctx.fillText(myKey ? `基准：按你固定的调 1=${baseName}（${baseName}${baseOct}）` : `基准：C 大调（1=C，中央 C）· 用唱名定调后随你的调`, 10, 38)
}

// ── 录音通用控制 ──
let recorder: { pitcher: LivePitcher; history: (number | null)[] } | null = null

async function startRec(btn: HTMLButtonElement, status: HTMLElement, live: boolean, canvas: HTMLCanvasElement | null, hzEl: HTMLElement | null): Promise<void> {
  await engine.init()
  recorder = { pitcher: new LivePitcher(), history: [] }
  if (hzEl) hzEl.textContent = '— Hz'
  if (canvas) canvas.style.cursor = '' // 退出"点色块"模式（v1.11）
  await engine.start({
    onFrame: chunk => {
      const rec = recorder
      if (!rec) return
      if (live) {
        rec.pitcher.push(chunk, midi => {
          rec.history.push(midi)
          // 实时频率读数（v1.5）：当前音高 Hz + 音名
          if (hzEl) hzEl.textContent = midi != null
            ? `${(440 * Math.pow(2, (midi - 69) / 12)).toFixed(1)} Hz · ${midiToName(midi)}`
            : '— Hz'
          if (canvas) drawLive(canvas, rec.history)
        })
      } else {
        rec.history.push(null)
      }
    },
  })
  btn.textContent = '停止'
  status.textContent = '录音中…'
}

async function stopRec(): Promise<Float32Array> {
  return engine.stop()
}

function resetBtn(btn: HTMLButtonElement, label: string, status: HTMLElement, msg: string): void {
  btn.textContent = label
  btn.disabled = false
  status.textContent = msg
}

// ── ① 校准流程（v1.2 双模式：唱音阶找 do / 滑音测跨度） ──
const calBtn = document.querySelector<HTMLButtonElement>('#cal-btn')!
const calStatus = document.querySelector<HTMLElement>('#cal-status')!
const calCanvas = document.querySelector<HTMLCanvasElement>('#cal-canvas')!
const calResult = document.querySelector<HTMLElement>('#cal-result')!
const calHint = document.querySelector<HTMLElement>('#cal-hint')!
const calHz = document.querySelector<HTMLElement>('#cal-hz')!
const calModeScale = document.querySelector<HTMLButtonElement>('#cal-mode-scale')!
const calModeGliss = document.querySelector<HTMLButtonElement>('#cal-mode-gliss')!
let calActive = false
let calTimer = 0
let calMode: 'scale' | 'gliss' = 'scale'

const SCALE_LIMIT_MS = 12000

function setCalMode(mode: 'scale' | 'gliss'): void {
  calMode = mode
  calModeScale.classList.toggle('active', mode === 'scale')
  calModeGliss.classList.toggle('active', mode === 'gliss')
  calBtn.textContent = mode === 'scale' ? '开始唱音阶' : '开始滑音'
  calHint.innerHTML = mode === 'scale'
    ? '用「do re mi fa sol la si（+高音 do）」从低到高慢慢唱一遍，每个音拖半秒以上——你唱的音阶会直接告诉我们<b>你的 do 在哪</b>，还能看出哪个音唱偏了。'
    : '点「开始滑音」，用「啊」或哼鸣从<b>最低</b>到<b>最高</b>缓缓滑上去（约 8 秒），别憋气别喊——测出你的舒适音域范围。'
}
calModeScale.addEventListener('click', () => setCalMode('scale'))
calModeGliss.addEventListener('click', () => setCalMode('gliss'))
setCalMode('scale')

calBtn.addEventListener('click', async () => {
  try {
    if (!calActive) {
      calActive = true
      calResult.innerHTML = ''
      calCanvas.getContext('2d')?.clearRect(0, 0, calCanvas.width, calCanvas.height)
      await startRec(calBtn, calStatus, true, calCanvas, calHz)
      calTimer = window.setTimeout(() => calBtn.click(), calMode === 'scale' ? SCALE_LIMIT_MS : CAL_LIMIT_MS)
    } else {
      calActive = false
      clearTimeout(calTimer)
      calBtn.disabled = true
      calStatus.textContent = '分析中…'
      const buf = await stopRec()
      if (calMode === 'scale') renderScaleMatch(analyzeScale(buf, ANALYSIS_RATE), calResult)
      else renderRange(analyzeRange(buf, ANALYSIS_RATE), calResult)
      resetBtn(calBtn, calMode === 'scale' ? '再唱一遍' : '再测一次', calStatus, '完成')
    }
  } catch (e) {
    calActive = false
    clearTimeout(calTimer)
    await engine.stop().catch(() => {})
    resetBtn(calBtn, calMode === 'scale' ? '开始唱音阶' : '开始滑音', calStatus, '')
    calResult.innerHTML = `<div class="error">${errText(e)}</div>`
  }
})

// ── 示例音阶（无麦克风验证入口：内置合成 C 大调音阶走同一管线） ──
document.querySelector<HTMLButtonElement>('#cal-demo')!.addEventListener('click', () => {
  try {
    const buf = synthMelody(DEMO_SCALE_C(), { fs: ANALYSIS_RATE })
    renderScaleMatch(analyzeScale(buf, ANALYSIS_RATE), calResult)
    calStatus.textContent = '示例：C 大调音阶（do–si–高do）· 应判定 do = C'
  } catch (e) {
    calResult.innerHTML = `<div class="error">${errText(e)}</div>`
  }
})

// ── ② 哼唱翻译流程 ──
const humBtn = document.querySelector<HTMLButtonElement>('#hum-btn')!
const humStatus = document.querySelector<HTMLElement>('#hum-status')!
const humResult = document.querySelector<HTMLElement>('#hum-result')!
const humHz = document.querySelector<HTMLElement>('#hum-hz')!
let humActive = false

/** 分析完成 → 记录缓冲（供原声回放）→ 单一状态源重绘（唱名 + 大白话 + 琴键标签）。
 * v1.8.6：判定只写入 detected（建议），简谱标签基准恒为 labelBase()——未定调按中央 C 显示。 */
function renderAnalysis(r: AnalysisResult, buf: Float32Array): void {
  lastResult = r
  lastBuf = buf
  humDone.hidden = false
  detected = r.keys[0]
  const b = labelBase()
  curKey = { tonicPc: b.tonicPc, mode: b.mode, score: 0 }
  curSolfege = rekey(r, b.tonicPc, b.mode)
  paintSolfege()
  renderFreqCard()
  // 全曲视图（v1.11）：分析完成后画布切换为时间轴色块图，点色块听那段原声
  // 新分析复位全部播放态（点选高亮/播放头/兜底定时器），避免旧状态画进新图
  canvasPlayIdx = -1
  window.clearTimeout(canvasPlayTimer)
  playheadSec = null
  calCanvas.style.cursor = 'pointer'
  repaintFinalCanvas(calCanvas, r)
}

/** 原声切片边界（v1.12.3）：±余量（前 0.15s / 后 0.25s）但**绝不越过相邻音**——
 * 余量被前音终点/后音起点夹住（黏连时为 0）。否则段尾余量会吞进下一个和弦的首音
 * （小星星间隙 0.06s，+0.25s 把"5"的头放了 0.19s——×2 听起来响 3 个音）。 */
function rawSliceBounds(idx: number): { from: number; to: number } {
  const all = lastResult!.notes
  const n = all[idx]
  const head = idx > 0 ? Math.min(0.15, Math.max(0, n.startSec - all[idx - 1].endSec)) : 0.15
  const tail = idx < all.length - 1 ? Math.min(0.25, Math.max(0, all[idx + 1].startSec - n.endSec)) : 0.25
  const from = Math.max(0, n.startSec - head)
  const to = Math.min(lastBuf ? lastBuf.length / ANALYSIS_RATE : Infinity, n.endSec + tail)
  return { from, to }
}

// 点色块播原声：x → 时间 → 最近音符（色块中心距最近），播该音 ± 余量（不越过相邻音，v1.12.3）
calCanvas.addEventListener('click', ev => {
  if (!lastResult || !lastBuf || humActive || !lastResult.notes.length) return
  stopSeq() // 一声一道：点选新片段前停掉在播的整段原声/弹唱，播放头同步复位（v1.12）
  const rect = calCanvas.getBoundingClientRect()
  const x = ((ev.clientX - rect.left) / rect.width) * calCanvas.width
  const dur = Math.max(0.5, lastResult.notes[lastResult.notes.length - 1].endSec)
  const t = (x / (calCanvas.width - 58)) * dur
  let best = 0
  let bestDist = Infinity
  lastResult.notes.forEach((n, i) => {
    const c = (n.startSec + n.endSec) / 2
    const d = Math.abs(c - t)
    if (d < bestDist) { bestDist = d; best = i }
  })
  const { from, to } = rawSliceBounds(best)
  player.playBuffer(lastBuf, from, to) // 内部先 stopBuffer，连点不叠音
  canvasPlayIdx = best
  window.clearTimeout(canvasPlayTimer)
  repaintFinalCanvas(calCanvas, lastResult)
  canvasPlayTimer = window.setTimeout(() => {
    canvasPlayIdx = -1
    if (lastResult) repaintFinalCanvas(calCanvas, lastResult)
  }, (to - from) * 1000 + 120)
})

humBtn.addEventListener('click', async () => {
  try {
    if (!humActive) {
      humActive = true
      humResult.innerHTML = ''
      await startRec(humBtn, humStatus, true, calCanvas, humHz)
      // v1.8：哼唱时长不限——用户手动停止即分析（16kHz 单声道 ~3.8MB/分钟，内存安全）
    } else {
      humActive = false
      humBtn.disabled = true
      humStatus.textContent = '分析中…'
      const buf = await stopRec()
      renderAnalysis(analyzeRecording(buf, ANALYSIS_RATE), buf)
      resetBtn(humBtn, '再哼一次', humStatus, '完成')
    }
  } catch (e) {
    humActive = false
    await engine.stop().catch(() => {})
    resetBtn(humBtn, '开始哼唱', humStatus, '')
    humResult.innerHTML = `<div class="error">${errText(e)}</div>`
  }
})

// ── 示例音频（无麦克风验证入口：内置合成《小星星》G 大调走同一管线） ──
document.querySelector<HTMLButtonElement>('#demo-btn')!.addEventListener('click', () => {
  try {
    const buf = synthMelody(DEMO_TWINKLE_G(), { fs: ANALYSIS_RATE })
    renderAnalysis(analyzeRecording(buf, ANALYSIS_RATE), buf)
    humStatus.textContent = '示例：小星星（G 大调）· 未定调时按中央 C 显示为 5 5 2 2 3 3 2——点「✓ 按此显示并固定」切回 1 1 5 5 6 6 5'
  } catch (e) {
    humResult.innerHTML = `<div class="error">${errText(e)}</div>`
  }
})

// ── 我的调按钮（v1.1.1）：把当前调固定记住，哼唱翻译不再变来变去 ──
const myKeySave = document.querySelector<HTMLButtonElement>('#my-key-save')!
const myKeyStatus = document.querySelector<HTMLElement>('#my-key-status')!
// 状态条 + 步骤标记（v1.3 两步流）
const statusMyKey = document.querySelector<HTMLElement>('#status-my-key')!
const statusRange = document.querySelector<HTMLElement>('#status-range')!
const statusClear = document.querySelector<HTMLButtonElement>('#status-clear')!
const humDone = document.querySelector<HTMLElement>('#hum-done')!
const humCard = document.querySelector<HTMLElement>('#hum-card')!

myKeySave.addEventListener('click', () => {
  if (!detected) {
    myKeyStatus.textContent = '还没有可记住的调——先哼一段，或点「示例音频」试试'
    return
  }
  adoptKey(detected.tonicPc, detected.mode)
})

statusClear.addEventListener('click', () => {
  myKey = null
  myKeyStore.clear()
  syncMyKeyUi()
  // 回到未定调状态：简谱基准回落中央 C（v1.8.6）
  if (lastResult) {
    curKey = { tonicPc: 0, mode: 'major', score: 0 }
    curSolfege = rekey(lastResult, 0, 'major')
    paintSolfege()
  }
  renderFreqCard()
})

syncMyKeyUi()

renderFreqCard() // 首次按默认 C 大调渲染频率对照卡；此后 adoptKey/清除时随基准刷新

// 页面卸载：显式回收运行时空间（I 不变量：无泄漏）——采集引擎与播放引擎互不持有、各自回收
window.addEventListener('beforeunload', () => {
  void engine.destroy()
  player.dispose()
})
