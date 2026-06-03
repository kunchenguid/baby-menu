/* global window, document, gsap */
/* =================================================================
   baby_menu marketing video timeline.

   Frame 0 is the OUTRO (logo + install command) so the X thumbnail
   doubles as a seamless loop point. Then: zoom in on the menu bar,
   the tray icon appears + is clicked, zoom out, the popover opens on
   the real hello-world widget, the user asks for a cpu/memory widget
   (which then ticks live) and a claude code widget, drops the sonnet
   line, and we wipe back to the outro.
   ================================================================= */

window.__timelines = window.__timelines || {}
const tl = gsap.timeline({ paused: true })

const $ = (id) => document.getElementById(id)
const CW = 7.8 // mono char advance at 13px (matches .ch width)

/* ----------------------------------------------------------------
   1. Dynamic spans: typewriter prompts, run task/step/timer stacks,
      session messages, and the live cpu/memory tickers.
   ---------------------------------------------------------------- */
function makePrompt(text) {
  const wrap = document.createElement('span')
  wrap.className = 'ctext'
  wrap.style.opacity = '0'
  for (const c of text) {
    const s = document.createElement('span')
    s.className = 'ch'
    s.textContent = c
    s.style.opacity = '0'
    wrap.appendChild(s)
  }
  const caret = document.createElement('span')
  caret.className = 'ccaret'
  caret.style.opacity = '0'
  const field = $('cfield')
  field.appendChild(wrap)
  field.appendChild(caret)
  return { wrap, caret, chars: wrap.children, n: text.length }
}

// Typed prompts are the requests shown after the simplified hello-world screen.
const P1 = makePrompt('add a widget showing current cpu and memory usage %')
const P2 = makePrompt('add a widget tracking my weekly claude code quota')
const P3 = makePrompt('drop the sonnet quota line')

function makeStack(parent, items, align) {
  parent.textContent = ''
  return items.map((t) => {
    const s = document.createElement('span')
    s.textContent = t
    s.style.position = 'absolute'
    s.style.top = '0'
    if (align === 'right') s.style.right = '0'
    else s.style.left = '0'
    s.style.whiteSpace = 'nowrap'
    s.style.opacity = '0'
    parent.appendChild(s)
    return s
  })
}

// RunStrip task carries the `› ` prefix like the live RunStrip.
const taskStack = makeStack($('run-task'), [
  '› add a widget showing current cpu and memory usage %',
  '› add a widget tracking my weekly claude code quota',
  '› drop the sonnet quota line'
])
$('run-task').style.position = 'relative'
$('run-task').style.display = 'block'
$('run-task').style.height = '15px'

// Subtitle is plain assistant copy (defaults to "Working...").
const RUN1_STEPS = ['Working...', 'Building the cpu and memory widget']
const RUN2_STEPS = ['Working...', 'Building the claude code widget']
const RUN3_STEPS = ['Working...', 'Updating the widget']
$('run-steps').style.position = 'relative'
$('run-steps').style.display = 'block'
$('run-steps').style.height = '14px'
const stepStack = makeStack($('run-steps'), [
  ...RUN1_STEPS,
  ...RUN2_STEPS,
  ...RUN3_STEPS
])

// Timer reads elapsed seconds like the live RunStrip (e.g. "39.6s").
const RUN1_TIME = ['8.4s', '22.1s', '39.6s']
const RUN2_TIME = ['9.0s', '24.5s', '35.0s']
const RUN3_TIME = ['4.0s', '9.5s']
$('run-timer').style.position = 'relative'
$('run-timer').style.display = 'block'
$('run-timer').style.height = '14px'
const timeStack = makeStack(
  $('run-timer'),
  [...RUN1_TIME, ...RUN2_TIME, ...RUN3_TIME],
  'right'
)

const msgStack = makeStack($('sb-msg-wrap'), [
  'Added a cpu and memory widget',
  'Added a claude code widget',
  'Updated the claude widget'
])

// Deterministic small-variation sequences for the live cpu/mem values.
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function genVals(n, base, lo, hi, seed) {
  const rng = mulberry32(seed)
  const out = [base]
  let v = base
  for (let i = 1; i < n; i++) {
    v += Math.round((rng() - 0.5) * 6)
    if (v < lo) v = lo
    if (v > hi) v = hi
    out.push(v)
  }
  return out
}
const N_TICKS = 22
const cpuVals = genVals(N_TICKS, 18, 12, 28, 9123)
const memVals = genVals(N_TICKS, 23, 18, 29, 4567) // memory pressure stays < 30%

// A live metric: crossfade the number spans + animate the progress fill.
function buildTicker(numId, fillId, vals, startT, interval) {
  const numEl = $(numId)
  numEl.textContent = ''
  const fillSel = '#' + fillId
  const spans = vals.map((v) => {
    const s = document.createElement('span')
    s.textContent = String(v)
    s.style.opacity = '0'
    numEl.appendChild(s)
    return s
  })
  vals.forEach((v, i) => {
    const t = startT + i * interval
    if (i === 0) {
      tl.set(spans[0], { opacity: 1 }, t)
      tl.set(fillSel, { width: v + '%' }, t)
      return
    }
    tl.to(spans[i - 1], { opacity: 0, duration: 0.25, ease: 'power1.inOut' }, t)
    tl.to(spans[i], { opacity: 1, duration: 0.25, ease: 'power1.inOut' }, t)
    tl.to(fillSel, { width: v + '%', duration: 0.45, ease: 'power1.inOut' }, t)
  })
}

/* ----------------------------------------------------------------
   2. Measure heights (native popover px) and derive geometry.
   ---------------------------------------------------------------- */
const POP_BORDER = 1
const headH = document.querySelector('.pop-head').offsetHeight
const helloH = $('hello').offsetHeight
const cpuH = $('w-cpu').offsetHeight
const claudeNoSonnetH = $('w-claude').offsetHeight
const sonnetH = $('sonnet-inner').offsetHeight
const dockH = $('dock').offsetHeight

const EXP_HELLO = helloH
const EXP_CPU = cpuH
const EXP_SONNET = sonnetH
const EXP_CLAUDE = claudeNoSonnetH + sonnetH

const DOCK_MARGIN = 10 // .dock margin-top (extra breathing room above the input)
const dockTop = {
  start: POP_BORDER + headH + EXP_HELLO + DOCK_MARGIN,
  cpu: POP_BORDER + headH + EXP_CPU + DOCK_MARGIN,
  claude: POP_BORDER + headH + EXP_CPU + EXP_CLAUDE + DOCK_MARGIN,
  final: POP_BORDER + headH + EXP_CPU + claudeNoSonnetH + DOCK_MARGIN
}

// Popover wrapper: top 70, centered, scale 1.7 (504 -> ~857 displayed).
const SCALE = 1.7
const POP_TOP = 70
const POP_LEFT = (1080 - 504 * SCALE) / 2
const sx = (nx) => POP_LEFT + nx * SCALE
const sy = (ny) => POP_TOP + ny * SCALE

// Cursor targets in native popover coords (504-wide layout).
const FIELD_NX = 90
const SEND_NX = 472
const KEEP_NX = 400 // Keep is the left of the two session buttons

const dockCY = (phase) => sy(dockTop[phase] + dockH / 2)

// Typing zoom: push the camera in on the composer while the user types,
// then pull back out after send. The cursor is outside #stage, so its
// targets are mapped through the same transform (zmapX, TYPE_FY).
const ZC_TYPE = 1.3
const TYPE_FY = 560
const zmapX = (nx) => 540 + ZC_TYPE * (sx(nx) - 540)
function typeZoomIn(phase, t, dur) {
  const cy = dockCY(phase)
  tl.to(
    '#stage',
    { x: 540 - ZC_TYPE * 540, y: TYPE_FY - ZC_TYPE * cy, scale: ZC_TYPE, duration: dur, ease: 'power2.inOut', force3D: false },
    t
  )
}
function stageReset(t, dur) {
  tl.to('#stage', { x: 0, y: 0, scale: 1, duration: dur, ease: 'power2.inOut', force3D: false }, t)
}

// Tray button center (menu bar lives in #stage but is at identity at load).
const trayRect = $('tray-b').getBoundingClientRect()
const TRAY_X = trayRect.left + trayRect.width / 2
const TRAY_Y = trayRect.top + trayRect.height / 2

const CURX = 6
const CURY = 4
const moveCursor = (x, y, t, dur) =>
  tl.to('#cursor', { x: x - CURX, y: y - CURY, duration: dur, ease: 'power2.inOut' }, t)

function click(x, y, t) {
  tl.set('#click-ring', { x: x, y: y, scale: 0, opacity: 1 }, t)
  tl.to('#click-ring', { scale: 2.0, opacity: 0, duration: 0.5, ease: 'power2.out' }, t)
  tl.to('#cursor', { scale: 0.9, duration: 0.09, ease: 'power2.out' }, t)
  tl.to('#cursor', { scale: 1.0, duration: 0.16, ease: 'power2.out' }, t + 0.09)
}

function typePrompt(P, startX, t0, perChar) {
  tl.set(P.wrap, { opacity: 1 }, t0)
  tl.set(P.caret, { x: startX, opacity: 1 }, t0)
  for (let i = 0; i < P.n; i++) {
    const t = t0 + i * perChar
    tl.to(P.chars[i], { opacity: 1, duration: 0.04, ease: 'none' }, t)
    tl.to(P.caret, { x: startX + (i + 1) * CW, duration: perChar, ease: 'none' }, t)
  }
  const tEnd = t0 + P.n * perChar
  tl.to(P.caret, { opacity: 0, duration: 0.4, ease: 'power1.inOut', yoyo: true, repeat: 1 }, tEnd)
  return tEnd
}

function show(span, t, dur) {
  tl.to(span, { opacity: 1, duration: dur || 0.28, ease: 'power2.out' }, t)
}
function hide(span, t, dur) {
  tl.to(span, { opacity: 0, duration: dur || 0.25, ease: 'power2.in' }, t)
}
function pulse(t, dur) {
  const reps = Math.max(1, Math.ceil(dur / 1.4)) - 1
  tl.to('#rdot', { opacity: 0.4, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: reps }, t)
}

/* ----------------------------------------------------------------
   3. Camera + t=0 init. Frame 0 is the settled outro (thumbnail/loop).
   ---------------------------------------------------------------- */
const ZS = 3.0
const ZX = 540
const ZY = 360
const ZTX = ZX - ZS * TRAY_X
const ZTY = ZY - ZS * TRAY_Y

// A static clone of the settled outro is the t=0 thumbnail (it only
// toggles 1->0, so it can't be clobbered the way the real outro's
// 0->1->0 opacity would be). The real outro is reused at the end.
;(function buildOutroPoster() {
  const clone = document.getElementById('outro').cloneNode(true)
  clone.id = 'outro-poster' // keep inner ids so the svg glow filter still resolves
  clone.style.opacity = '1' // visible by default so frame 0 = the outro
  clone.style.display = 'flex'
  document.getElementById('root').appendChild(clone)
})()

tl.set('#stage', { x: 0, y: 0, scale: 1, transformOrigin: '0 0', force3D: false }, 0)
tl.set('#outro', { display: 'none', opacity: 0 }, 0)
tl.set('#popover', { opacity: 0, y: -8, scale: 0.985, transformOrigin: 'top center' }, 0)
tl.set('#tray-b', { opacity: 1, scale: 1, backgroundColor: 'rgba(255,255,255,0.16)' }, 0)
tl.set('#composer', { opacity: 1 }, 0)
tl.set('#runstrip', { opacity: 0 }, 0)
tl.set('#sessionbar', { opacity: 0 }, 0)
tl.set('#cplaceholder', { opacity: 1 }, 0)
tl.set('#rdot', { opacity: 1 }, 0)
tl.set('#wipe', { y: '100%' }, 0)
tl.set('#cursor', { opacity: 0, x: 720, y: 380, scale: 1 }, 0)
tl.set([P1.wrap, P2.wrap, P3.wrap, P1.caret, P2.caret, P3.caret], { opacity: 0 }, 0)
tl.set([...taskStack, ...stepStack, ...timeStack, ...msgStack], { opacity: 0 }, 0)

// Wipe covers immediately - the outro only lives for frame 0.
tl.to('#wipe', { y: '0%', duration: 0.3, ease: 'power3.in' }, 0.05)

// Under cover: hide the outro, zoom in on the menu bar, close popover.
// Drop the poster instantly while the wipe fully covers (0.35), so the
// thumbnail shows for frame 0 only and never flickers back during reveal.
tl.to('#outro-poster', { opacity: 0, duration: 0.03, ease: 'none', immediateRender: false }, 0.36)
tl.set('#outro-poster', { display: 'none' }, 0.39)
const R = 0.38
tl.set('#tray-b', { opacity: 0, backgroundColor: 'rgba(255,255,255,0)' }, R)
tl.set('#stage', { x: ZTX, y: ZTY, scale: ZS, force3D: false }, R)

tl.to('#wipe', { y: '-100%', duration: 0.34, ease: 'power3.out' }, 0.42)

/* SCENE A - zoomed menu bar; the baby_menu tray icon appears. */
tl.fromTo(
  '#tray-b',
  { opacity: 0, scale: 0.6, transformOrigin: 'center center' },
  { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out', immediateRender: false },
  1.6
)

/* SCENE B - click the (zoomed) tray, camera pulls out, popover opens. */
tl.to('#cursor', { opacity: 1, duration: 0.3, ease: 'power1.out' }, 2.4)
moveCursor(ZX, ZY, 2.5, 1.0)
click(ZX, ZY, 3.7)
tl.to('#tray-b', { backgroundColor: 'rgba(255,255,255,0.16)', duration: 0.2, ease: 'power2.out' }, 3.7)
tl.to('#stage', { x: 0, y: 0, scale: 1, duration: 0.95, ease: 'power2.inOut', force3D: false }, 4.15)
tl.to('#cursor', { opacity: 0, duration: 0.3, ease: 'power2.in' }, 4.15)
tl.to('#popover', { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'power3.out' }, 5.2)

/* SCENE C - zoom in, type prompt 1 (cpu + memory), send, zoom out. */
tl.to('#cursor', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 6.5)
typeZoomIn('start', 6.7, 0.7)
moveCursor(zmapX(FIELD_NX), TYPE_FY, 6.6, 0.9)
tl.to('#cplaceholder', { opacity: 0, duration: 0.15 }, 7.45)
typePrompt(P1, 0, 7.55, 0.05)
moveCursor(zmapX(SEND_NX), TYPE_FY, 10.3, 0.6)
click(zmapX(SEND_NX), TYPE_FY, 11.0)
tl.to('#send', { color: '#6AE3B6', duration: 0.12, yoyo: true, repeat: 1 }, 11.0)
stageReset(11.1, 0.7)

/* SCENE D - run 1 (~40s, accelerated). */
tl.to('#composer', { opacity: 0, duration: 0.22, ease: 'power2.in' }, 11.12)
tl.to('#runstrip', { opacity: 1, duration: 0.28, ease: 'power2.out' }, 11.16)
tl.to('#cursor', { opacity: 0, duration: 0.3, ease: 'power2.in' }, 11.3)
show(taskStack[0], 11.3)
pulse(11.4, 3.8)
show(stepStack[0], 11.4)
hide(stepStack[0], 13.1)
show(stepStack[1], 13.2)
show(timeStack[0], 11.5)
hide(timeStack[0], 12.7)
show(timeStack[1], 12.8)
hide(timeStack[1], 14.2)
show(timeStack[2], 14.3)

/* SCENE E - cpu/memory widget reveals (and starts ticking); SB1; Keep. */
const CPU_APPEAR = 15.2
tl.to('#c-hello', { height: 0, opacity: 0, duration: 0.4, ease: 'power2.inOut' }, CPU_APPEAR)
tl.fromTo(
  '#c-cpu',
  { height: 0, opacity: 0 },
  { height: EXP_CPU, opacity: 1, duration: 0.55, ease: 'power3.out', immediateRender: false },
  CPU_APPEAR
)
buildTicker('cpu-num', 'cpu-fill', cpuVals, CPU_APPEAR + 0.5, 1.0)
buildTicker('mem-num', 'mem-fill', memVals, CPU_APPEAR + 0.5, 1.0)
hide(taskStack[0], CPU_APPEAR)
hide(stepStack[1], CPU_APPEAR)
hide(timeStack[2], CPU_APPEAR)
tl.to('#runstrip', { opacity: 0, duration: 0.25, ease: 'power2.in' }, CPU_APPEAR + 0.05)
show(msgStack[0], CPU_APPEAR + 0.1)
tl.fromTo('#sessionbar', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, CPU_APPEAR + 0.1)
tl.to('#cursor', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 16.0)
moveCursor(sx(KEEP_NX), dockCY('cpu'), 16.2, 0.8)
click(sx(KEEP_NX), dockCY('cpu'), 17.05)
tl.to('#sb-keep', { scale: 1.06, duration: 0.12, yoyo: true, repeat: 1, transformOrigin: 'center center' }, 17.05)
tl.to('#sessionbar', { opacity: 0, duration: 0.28, ease: 'power2.in' }, 17.2)
tl.set(P1.wrap, { opacity: 0 }, 17.25)
tl.set(P1.caret, { opacity: 0 }, 17.25)
tl.set('#cplaceholder', { opacity: 1 }, 17.25)
tl.to('#composer', { opacity: 1, duration: 0.28, ease: 'power2.out' }, 17.3)

/* SCENE F - zoom in, type prompt 2 (claude code quota), send, zoom out. */
typeZoomIn('cpu', 18.0, 0.6)
moveCursor(zmapX(FIELD_NX), TYPE_FY, 17.9, 0.7)
tl.to('#cplaceholder', { opacity: 0, duration: 0.15 }, 18.5)
typePrompt(P2, 0, 18.6, 0.05)
moveCursor(zmapX(SEND_NX), TYPE_FY, 21.3, 0.6)
click(zmapX(SEND_NX), TYPE_FY, 22.0)
tl.to('#send', { color: '#6AE3B6', duration: 0.12, yoyo: true, repeat: 1 }, 22.0)
stageReset(22.1, 0.6)

/* SCENE G - run 2 (~35s, accelerated). */
tl.to('#composer', { opacity: 0, duration: 0.22, ease: 'power2.in' }, 22.12)
tl.to('#runstrip', { opacity: 1, duration: 0.28, ease: 'power2.out' }, 22.16)
tl.to('#cursor', { opacity: 0, duration: 0.3, ease: 'power2.in' }, 22.3)
show(taskStack[1], 22.3)
pulse(22.4, 3.3)
show(stepStack[2], 22.4)
hide(stepStack[2], 23.9)
show(stepStack[3], 24.0)
show(timeStack[3], 22.5)
hide(timeStack[3], 23.5)
show(timeStack[4], 23.6)
hide(timeStack[4], 24.7)
show(timeStack[5], 24.8)

/* SCENE H - claude widget reveals (with sonnet line); SB2; Keep. */
tl.set('#c-sonnet', { height: EXP_SONNET, opacity: 1 }, 25.55)
tl.fromTo(
  '#c-claude',
  { height: 0, opacity: 0 },
  { height: EXP_CLAUDE, opacity: 1, duration: 0.6, ease: 'power3.out', immediateRender: false },
  25.6
)
hide(taskStack[1], 25.55)
hide(stepStack[3], 25.55)
hide(timeStack[5], 25.55)
tl.to('#runstrip', { opacity: 0, duration: 0.25, ease: 'power2.in' }, 25.6)
hide(msgStack[0], 25.55)
show(msgStack[1], 25.65)
tl.fromTo('#sessionbar', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, 25.65)
tl.to('#cursor', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 26.4)
moveCursor(sx(KEEP_NX), dockCY('claude'), 26.6, 0.8)
click(sx(KEEP_NX), dockCY('claude'), 27.45)
tl.to('#sb-keep', { scale: 1.06, duration: 0.12, yoyo: true, repeat: 1, transformOrigin: 'center center' }, 27.45)
tl.to('#sessionbar', { opacity: 0, duration: 0.28, ease: 'power2.in' }, 27.6)
tl.set(P2.wrap, { opacity: 0 }, 27.65)
tl.set(P2.caret, { opacity: 0 }, 27.65)
tl.set('#cplaceholder', { opacity: 1 }, 27.65)
tl.to('#composer', { opacity: 1, duration: 0.28, ease: 'power2.out' }, 27.7)

/* SCENE I - zoom in, feedback prompt, send, zoom out. */
typeZoomIn('claude', 28.4, 0.6)
moveCursor(zmapX(FIELD_NX), TYPE_FY, 28.3, 0.7)
tl.to('#cplaceholder', { opacity: 0, duration: 0.15 }, 28.95)
typePrompt(P3, 0, 29.05, 0.06)
moveCursor(zmapX(SEND_NX), TYPE_FY, 30.85, 0.6)
click(zmapX(SEND_NX), TYPE_FY, 31.5)
tl.to('#send', { color: '#6AE3B6', duration: 0.12, yoyo: true, repeat: 1 }, 31.5)
stageReset(31.6, 0.6)

/* SCENE J - run 3 (~10s, accelerated). */
tl.to('#composer', { opacity: 0, duration: 0.22, ease: 'power2.in' }, 31.62)
tl.to('#runstrip', { opacity: 1, duration: 0.28, ease: 'power2.out' }, 31.66)
tl.to('#cursor', { opacity: 0, duration: 0.3, ease: 'power2.in' }, 31.8)
show(taskStack[2], 31.8)
pulse(31.9, 2.0)
show(stepStack[4], 31.9)
hide(stepStack[4], 32.6)
show(stepStack[5], 32.7)
show(timeStack[6], 32.0)
hide(timeStack[6], 33.2)
show(timeStack[7], 33.3)

/* SCENE K - the sonnet line is removed; widget settles to final. */
tl.to('#c-sonnet', { height: 0, opacity: 0, duration: 0.45, ease: 'power2.inOut' }, 33.8)
tl.to('#c-claude', { height: claudeNoSonnetH, duration: 0.45, ease: 'power2.inOut' }, 33.8)
hide(taskStack[2], 33.8)
hide(stepStack[5], 33.8)
hide(timeStack[7], 33.8)
tl.to('#runstrip', { opacity: 0, duration: 0.25, ease: 'power2.in' }, 33.85)
hide(msgStack[1], 33.8)
show(msgStack[2], 33.9)
tl.fromTo('#sessionbar', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, 33.9)
tl.to('#sessionbar', { opacity: 0, duration: 0.3, ease: 'power2.in' }, 35.3)
tl.set(P3.wrap, { opacity: 0 }, 35.35)
tl.set(P3.caret, { opacity: 0 }, 35.35)
tl.set('#cplaceholder', { opacity: 1 }, 35.35)
tl.to('#composer', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 35.4)

/* ----------------------------------------------------------------
   WIPE back to the OUTRO (matches frame 0 -> seamless loop).
   ---------------------------------------------------------------- */
tl.to('#wipe', { y: '0%', duration: 0.32, ease: 'power3.in' }, 36.4)
tl.set('#outro', { display: 'flex' }, 36.73)
tl.to('#outro', { opacity: 1, duration: 0.15, ease: 'none', immediateRender: false }, 36.74)
tl.to('#wipe', { y: '-100%', duration: 0.34, ease: 'power3.out' }, 36.78)

/* SCENE L - OUTRO. The wipe reveals it already settled (identical to
   frame 0), so the video loops seamlessly. The glyph does a joyful,
   excited little baby-bounce, then settles back to rest before the end. */
tl.fromTo('#o-glyph', { y: 0 }, { y: -34, duration: 0.4, ease: 'power2.out', immediateRender: false }, 37.2)
tl.to('#o-glyph', { y: 0, duration: 1.25, ease: 'bounce.out' }, 37.6)
tl.fromTo(
  '#o-glyph',
  { scaleX: 1, scaleY: 1 },
  { scaleX: 1.12, scaleY: 0.9, duration: 0.4, ease: 'power2.out', transformOrigin: 'center bottom', immediateRender: false },
  37.2
)
tl.to('#o-glyph', { scaleX: 1, scaleY: 1, duration: 1.0, ease: 'elastic.out(1, 0.45)', transformOrigin: 'center bottom' }, 37.6)

window.__timelines['main'] = tl
