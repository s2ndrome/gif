import { COLOR_PRESETS, COLOR_KEYS, MOTIONS, OVERLAYS, prepareFrame, drawFrame } from './image-fx.js';
import { exportGif, seekVideo, measureFrames } from './gif.js';
import { initAi, setAiImage } from './ai-video.js';
import { initLayers, drawLayers, newText } from './layers.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };
const todayStamp = () => { const d = new Date(); return `'${String(d.getFullYear()).slice(2)} ${String(d.getMonth() + 1).padStart(2, ' ')} ${String(d.getDate()).padStart(2, ' ')}`; };

// ───────── 상태 ─────────
const DEFAULTS = () => ({
  tab: 'video',
  photo: { fit: 'cover', bg: 'blur', bgColor: '#000000', zoom: 1, x: 0, y: 0 },
  color: { preset: 'none', bright: 0, contrast: 0, sat: 0, warm: 0, fade: 0, sepia: 0, tint: 0, glow: 0 },
  motion: {},
  overlay: {},
  stamp: { on: false, text: todayStamp() },
  text: { content: '', font: '"Noto Sans KR", sans-serif', pos: 'bottom', align: 'center', anim: 'none', size: 72, color: '#ffffff', shadow: true },
  layers: [], // 글자 · 스티커
  clip: { start: 0, end: null, speed: 1, dir: 'fwd' },
  out: { ratio: 'video', res: 480, fps: 15, colors: 256, dither: 0.6, palette: 'frame', loop: 0, vfadeIn: 0, vfadeOut: 0, name: '', maxMB: 0 },
});
const KEY = 'seol-gif-v1';
let S = DEFAULTS();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) for (const k of Object.keys(S)) if (saved[k] != null) S[k] = typeof S[k] === 'object' ? { ...S[k], ...saved[k] } : saved[k];
  S.clip.start = 0; S.clip.end = null; // 영상마다 다르니 구간은 기억하지 않음
  if (!Array.isArray(S.layers)) S.layers = [];
  // 예전 '글자 넣기' 한 줄 → 움직일 수 있는 글자 레이어로
  if (S.text && String(S.text.content || '').trim()) {
    S.layers.push(newText({ content: S.text.content, font: S.text.font, size: S.text.size, color: S.text.color, align: S.text.align, shadow: S.text.shadow, stroke: false, appear: S.text.anim, y: { top: 0.15, center: 0.5, bottom: 0.85 }[S.text.pos] || 0.85 }));
    S.text.content = '';
  }
} catch { /* 무시 */ }
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 무시 */ } }, 300); scheduleEstimate(); };

const vid = $('#vid');
const media = { ok: false, url: '', name: '', w: 0, h: 0, dur: 0, id: 0, strip: null };

const getK = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
const setK = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ───────── 시간 계산 ─────────
function clipRange() {
  const d = media.dur || 0;
  const a = clamp(S.clip.start, 0, Math.max(0, d - 0.1));
  const b = clamp(S.clip.end ?? d, a + 0.1, d || a + 0.1);
  return { a, b, L: b - a };
}
/** GIF 전체 길이(초) */
function totalDur() {
  if (!media.ok) return 3;
  const { L } = clipRange();
  const one = L / S.clip.speed;
  return S.clip.dir === 'boom' ? one * 2 : one;
}
/** GIF 시각 t → 영상 시각 */
function vtime(t) {
  const { a, b, L } = clipRange();
  const u = t * S.clip.speed;
  let v;
  if (S.clip.dir === 'rev') v = b - u;
  else if (S.clip.dir === 'boom') v = u <= L ? a + u : b - (u - L);
  else v = a + u;
  return clamp(v, a, Math.max(a, Math.min(b, media.dur - 0.02)));
}
const goingForward = (t) => S.clip.dir === 'fwd' || (S.clip.dir === 'boom' && t * S.clip.speed <= clipRange().L);

// ───────── 재생 ─────────
const player = { playing: false, pos: 0, t0: 0 };
function position() {
  if (!player.playing) return player.pos;
  return player.pos + (performance.now() - player.t0) / 1000;
}
function play() {
  if (!media.ok) return;
  player.playing = true;
  player.t0 = performance.now();
  $('#play').textContent = '❚❚';
  syncVideo(player.pos, true);
}
function pause() {
  player.pos = clamp(position(), 0, totalDur());
  player.playing = false;
  vid.pause();
  $('#play').textContent = '▶';
  parkVideo();
}
function seek(p) {
  player.pos = clamp(p, 0, totalDur());
  player.t0 = performance.now();
  if (player.playing) syncVideo(player.pos, true);
  else parkVideo();
}
/** 멈춘 상태: 영상을 지금 위치로 옮겨 두기 */
function parkVideo() {
  if (!media.ok) return redraw();
  const v = vtime(player.pos);
  if (Math.abs(vid.currentTime - v) > 0.01) vid.currentTime = v;
  redraw();
}
/** 재생 중: 시계(t)에 영상을 맞추기 */
function syncVideo(t, hard = false) {
  const target = vtime(t);
  if (goingForward(t)) {
    if (vid.playbackRate !== S.clip.speed) vid.playbackRate = S.clip.speed;
    if (hard || vid.paused || Math.abs(vid.currentTime - target) > 0.25) vid.currentTime = target;
    if (vid.paused) vid.play().catch(() => {});
  } else {
    if (!vid.paused) vid.pause();
    if (!vid.seeking && Math.abs(vid.currentTime - target) > 0.03) vid.currentTime = target;
  }
}
vid.addEventListener('seeked', () => redraw());
function settingsChangedTiming() {
  player.pos = Math.min(player.pos, totalDur());
  if (player.playing) seek(player.pos); else parkVideo();
  updateTrimUI();
  scheduleEstimate();
}

// ───────── 영상 넣기 ─────────
async function loadVideoFile(f, opts = {}) {
  $('#video-name').textContent = '불러오는 중…';
  if (player.playing) pause();
  const url = URL.createObjectURL(f);
  try {
    await new Promise((res, rej) => {
      const ok = () => { off(); res(); }, bad = () => { off(); rej(new Error('decode')); };
      const off = () => { vid.removeEventListener('loadeddata', ok); vid.removeEventListener('error', bad); };
      vid.addEventListener('loadeddata', ok); vid.addEventListener('error', bad);
      vid.src = url; vid.load();
    });
    let d = vid.duration;
    if (!isFinite(d)) { // 일부 webm은 길이를 모름
      await new Promise((r) => { const on = () => { vid.removeEventListener('durationchange', on); r(); }; vid.addEventListener('durationchange', on); vid.currentTime = 1e7; setTimeout(r, 1500); });
      d = isFinite(vid.duration) ? vid.duration : vid.currentTime;
      vid.currentTime = 0;
    }
    if (!vid.videoWidth || !d) throw new Error('size');
    if (media.url) URL.revokeObjectURL(media.url);
    // AI 영상(그림 전체 살리기): 위아래(또는 양옆) 검은 띠를 잘라내고 그림 부분만 씀
    const vw = vid.videoWidth, vh = vid.videoHeight, ca = +opts.cropAspect || 0;
    let crop = null;
    if (ca && Math.abs(vw / vh - ca) / ca > 0.01) {
      // 경계에 얇은 검은 줄이 남지 않게 띠 쪽으로 1%씩 더 안쪽까지 자름
      if (ca > vw / vh) { const ch = Math.round(vw / ca), m = Math.ceil(ch * 0.01); crop = { x: 0, y: Math.round((vh - ch) / 2) + m, w: vw, h: ch - 2 * m }; }
      else { const cw = Math.round(vh * ca), m = Math.ceil(cw * 0.01); crop = { x: Math.round((vw - cw) / 2) + m, y: 0, w: cw - 2 * m, h: vh }; }
    }
    Object.assign(media, { ok: true, url, name: f.name, w: crop ? crop.w : vw, h: crop ? crop.h : vh, crop, dur: d, id: media.id + 1 });
    S.clip.start = 0;
    S.clip.end = d > 6 ? 3 : null;
    player.pos = 0;
    videoChanged();
    buildStrip();
    toast(d > 6 ? `영상을 넣었어요 · ${fmt(d)} (앞 3초를 골라뒀어요)` : `영상을 넣었어요 · ${fmt(d)}`);
  } catch {
    URL.revokeObjectURL(url);
    if (media.url) { vid.src = media.url; } else vid.removeAttribute('src');
    toast('이 영상은 열 수 없어요. mp4(H.264)나 webm 영상을 넣어주세요.', 4000);
    videoChanged();
  }
}
function videoChanged() {
  $('#video-name').textContent = media.ok ? `▶ ${media.name} · ${media.w}×${media.h}${media.crop ? ' · 검은 띠 잘라냄' : ''}` : '영상을 여기로 끌어다 놓기';
  $('#video-drop').classList.toggle('has', media.ok);
  $('#trim-box').hidden = !media.ok;
  $('#empty').hidden = media.ok;
  thumbKey = null;
  presetThumbs();
  updateTrimUI();
  sizeCanvas();
  parkVideo();
  scheduleEstimate();
}

// 구간 고르기용 필름 띠
async function buildStrip() {
  const id = media.id, N = 12;
  const tv = document.createElement('video');
  tv.muted = true; tv.playsInline = true; tv.preload = 'auto'; tv.src = media.url;
  try { await new Promise((r, j) => { tv.onloadeddata = r; tv.onerror = j; }); } catch { return; }
  const th = 60, tw = Math.max(20, Math.round((th * media.w) / media.h));
  const c = document.createElement('canvas'); c.width = tw * N; c.height = th;
  const x = c.getContext('2d');
  media.strip = c;
  for (let k = 0; k < N; k++) {
    if (media.id !== id) return;
    await seekVideo(tv, Math.min(media.dur - 0.05, ((k + 0.5) * media.dur) / N));
    if (media.crop) x.drawImage(tv, media.crop.x, media.crop.y, media.crop.w, media.crop.h, k * tw, 0, tw, th);
    else x.drawImage(tv, k * tw, 0, tw, th);
    drawStrip();
  }
  tv.removeAttribute('src'); tv.load();
}
function drawStrip() {
  const cv = $('#strip');
  if (!media.ok || cv.offsetParent === null) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  if (media.strip) x.drawImage(media.strip, 0, 0, w, h);
  const { a, b } = clipRange(), d = media.dur, s = a / d, e = b / d;
  x.fillStyle = 'rgba(243,247,250,.78)';
  x.fillRect(0, 0, s * w, h); x.fillRect(e * w, 0, w - e * w, h);
  x.strokeStyle = '#5f7a8c'; x.lineWidth = 2;
  x.strokeRect(s * w + 1, 1, Math.max(2, (e - s) * w - 2), h - 2);
  const ph = vtime(clamp(position(), 0, totalDur())) / d;
  x.fillStyle = '#34495a'; x.fillRect(ph * w - 1, 0, 2, h);
}
function updateTrimUI() {
  if (!media.ok) { renderSummary(); return; }
  const d = media.dur, st = $('#trim-start'), en = $('#trim-end');
  st.max = en.max = d.toFixed(2);
  st.value = S.clip.start; en.value = S.clip.end ?? d;
  const { a, b } = clipRange();
  $('#start-out').textContent = fmt(a);
  $('#end-out').textContent = fmt(b);
  const N = Math.max(1, Math.round(totalDur() * S.out.fps));
  $('#trim-info').textContent = `GIF 길이 ${fmt(totalDur())} · ${N}프레임${S.clip.speed !== 1 ? ` (속도 ${S.clip.speed}× 반영)` : ''}${S.clip.dir === 'boom' ? ' · 부메랑' : ''}`;
  renderSummary();
}

// ───────── 미리보기 ─────────
const pv = $('#pv');
const pvx = pv.getContext('2d', { alpha: false });

function outSize(res = +S.out.res) {
  let ar;
  if (S.out.ratio === 'video') ar = media.ok ? clamp(media.w / media.h, 9 / 21, 21 / 9) : 1;
  else { const [a, b] = S.out.ratio.split(':').map(Number); ar = a / b; }
  let W, H;
  if (ar < 1) { W = res; H = res / ar; } else { H = res; W = res * ar; }
  const ev = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { W: ev(W), H: ev(H) };
}
function sizeCanvas() {
  const { W, H } = outSize();
  const maxW = Math.min(440, $('.preview').clientWidth - 24);
  const maxH = Math.min(innerHeight * (innerWidth <= 860 ? 0.55 : 0.62), 600);
  const sc = Math.min(maxW / W, maxH / H);
  const dw = Math.round(W * sc), dh = Math.round(H * sc);
  pv.style.width = dw + 'px'; pv.style.height = dh + 'px';
  const q = Math.min(Math.min(2, devicePixelRatio || 1), 600 / Math.min(dw, dh));
  pv.width = Math.round(dw * q); pv.height = Math.round(dh * q);
  showEstimate();
  renderSummary();
  redraw();
}
function colorVals() {
  const v = {};
  for (const k of COLOR_KEYS) v[k] = S.color[k] || 0;
  return v;
}
function scene(dur) {
  return {
    img: null, dur,
    photo: S.photo, color: S.color, motion: S.motion, overlay: S.overlay,
    stamp: S.stamp, text: S.text,
    drawLayers: (x, W, H, t) => drawLayers(x, W, H, t, S.layers),
    vfadeIn: S.out.vfadeIn, vfadeOut: S.out.vfadeOut,
  };
}
let dirty = true;
const redraw = () => { dirty = true; };

function frame() {
  const dur = totalDur();
  if (player.playing) {
    let p = position();
    if (p >= dur) { player.pos = 0; player.t0 = performance.now(); p = 0; syncVideo(0, true); } // GIF처럼 반복
    else syncVideo(p);
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    const t = clamp(position(), 0, Math.max(0, dur - 1e-3));
    const sc = { ...scene(dur), noFade: !player.playing };
    if (media.ok && vid.readyState >= 2) sc.img = prepareFrame(vid, media.w, media.h, colorVals(), pv.width, pv.height, 'pv', media.crop);
    drawFrame(pvx, pv.width, pv.height, t, sc, null);
    if (S.tab !== 'ai') layerUI.drawSelection(pvx, pv.width, pv.height);
    $('#seek').max = dur.toFixed(2);
    if (document.activeElement !== $('#seek')) $('#seek').value = t;
    $('#time').textContent = `${fmt(t)} / ${fmt(dur)}`;
    drawStrip();
  }
  requestAnimationFrame(frame);
}

// 미리보기를 드래그해서 위치 옮기기, 휠로 확대
(() => {
  const shot = $('#shot');
  let drag = null;
  shot.addEventListener('pointerdown', (e) => {
    if (!media.ok || e.target.closest('.empty')) return;
    shot.setPointerCapture(e.pointerId);
    if (layerUI.pointerDown(e)) return;
    drag = { x: e.clientX, y: e.clientY, px: S.photo.x, py: S.photo.y };
  });
  shot.addEventListener('pointermove', (e) => {
    if (layerUI.pointerMove(e)) return;
    if (!drag) return;
    const r = pv.getBoundingClientRect();
    S.photo.x = clamp(drag.px - ((e.clientX - drag.x) / r.width) * 2.2, -1, 1);
    S.photo.y = clamp(drag.py - ((e.clientY - drag.y) / r.height) * 2.2, -1, 1);
    syncInputs('photo.'); redraw();
  });
  const end = () => { if (layerUI.pointerUp()) return; if (drag) { drag = null; save(); } };
  shot.addEventListener('pointerup', end);
  shot.addEventListener('pointercancel', end);
  shot.addEventListener('wheel', (e) => {
    if (!media.ok) return;
    e.preventDefault();
    if (layerUI.wheel(e)) return;
    S.photo.zoom = clamp(S.photo.zoom * Math.exp(-e.deltaY * 0.0015), 1, 2.5);
    syncInputs('photo.'); redraw(); save();
  }, { passive: false });
})();

// ───────── 입력 연결 ─────────
const NUM_KEYS = ['out.res', 'out.fps', 'out.colors', 'out.loop'];
function syncInputs(prefix = '') {
  for (const el of $$('[data-k]')) {
    const k = el.dataset.k;
    if (!k.startsWith(prefix)) continue;
    const v = getK(k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el || el.type === 'range') el.value = v ?? '';
  }
  for (const o of $$('[data-out]')) {
    const v = getK(o.dataset.out);
    o.textContent = o.hasAttribute('data-pct') ? Math.round(v * 100) : String(Math.round(v * 100) / 100);
  }
  syncChips();
}
function syncChips() {
  $$('#ratio-seg button').forEach((b) => b.classList.toggle('on', b.dataset.ratio === S.out.ratio));
  $$('#fit-chips button').forEach((b) => b.classList.toggle('on', b.dataset.fit === S.photo.fit));
  $$('#speed-chips button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === S.clip.speed));
  $$('#dir-chips button').forEach((b) => b.classList.toggle('on', b.dataset.dir === S.clip.dir));
  $$('#max-chips button').forEach((b) => b.classList.toggle('on', +b.dataset.mb === (+S.out.maxMB || 0)));
  $$('[data-show=contain]').forEach((e) => (e.hidden = S.photo.fit !== 'contain'));
  $$('[data-show=bgcolor]').forEach((e) => (e.hidden = S.photo.bg !== 'color'));
  $$('#color-presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === S.color.preset));
  renderSummary();
}

for (const el of $$('[data-k]')) {
  const ev = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
  el.addEventListener(ev, () => {
    const k = el.dataset.k;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range' || el.type === 'number' || NUM_KEYS.includes(k)) v = Math.max(0, parseFloat(el.value) || 0);
    else v = el.value;
    setK(k, v);
    if (el.hasAttribute('data-color')) S.color.preset = 'custom';
    if (k === 'out.ratio' || k === 'out.res' || k === 'out.fps') sizeCanvas();
    if (k === 'clip.speed' || k === 'out.fps') settingsChangedTiming();
    if (k === 'text.font') document.fonts.load(`700 40px ${S.text.font}`).then(redraw);
    syncInputs();
    redraw();
    save();
  });
}

// 탭
function setTab(t) {
  if (!['ai', 'video', 'look', 'out'].includes(t)) t = 'video';
  S.tab = t;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.panel [data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
  const ai = t === 'ai';
  $('#ai-stage').hidden = !ai;
  $$('.preview > .pv-bar, .preview > .pv-stage, .preview > .player, .preview > .pv-hint, #hero-s').forEach((e) => (e.hidden = ai));
  if (ai && player.playing) pause();
  if (!ai) $('#ai-video').pause();
  $('#hero-t').textContent = { ai: 'AI Video', video: 'Video', look: 'Effects', out: 'Export' }[t];
  if (t === 'look') presetThumbs();
  redraw();
  save();
}
$$('.tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

$$('#ratio-seg button').forEach((b) => (b.onclick = () => { S.out.ratio = b.dataset.ratio; syncInputs(); sizeCanvas(); save(); }));
$$('#fit-chips button').forEach((b) => (b.onclick = () => { S.photo.fit = b.dataset.fit; syncInputs(); redraw(); save(); }));
$$('#speed-chips button').forEach((b) => (b.onclick = () => { S.clip.speed = +b.dataset.speed; syncInputs(); settingsChangedTiming(); save(); }));
$$('#dir-chips button').forEach((b) => (b.onclick = () => { S.clip.dir = b.dataset.dir; syncInputs(); settingsChangedTiming(); save(); }));
$$('#max-chips button').forEach((b) => (b.onclick = () => { S.out.maxMB = +b.dataset.mb; syncInputs(); save(); }));

// ───────── 필터 프리셋 ─────────
let thumbKey = null;
function presetThumbs() {
  const box = $('#color-presets');
  if (!box.children.length) {
    for (const p of COLOR_PRESETS) {
      const b = document.createElement('button');
      b.dataset.p = p.id;
      b.innerHTML = `<span class="ph"></span>${p.name}`;
      b.onclick = () => {
        for (const k of COLOR_KEYS) S.color[k] = p.v[k] || 0;
        S.color.preset = p.id;
        syncInputs(); redraw(); save();
      };
      box.appendChild(b);
    }
  }
  if (!media.ok || vid.readyState < 2) { thumbKey = null; $$('canvas', box).forEach((c) => c.replaceWith(Object.assign(document.createElement('span'), { className: 'ph' }))); return; }
  const key = `${media.id}:${S.clip.start}`;
  if (thumbKey === key || $('[data-pane=look]').hidden) return;
  thumbKey = key;
  const sm = document.createElement('canvas');
  const iw = media.w, ih = media.h, s = 120 / Math.min(iw, ih);
  sm.width = 120; sm.height = 120;
  const cr = media.crop || { x: 0, y: 0, w: iw, h: ih };
  sm.getContext('2d').drawImage(vid, cr.x, cr.y, cr.w, cr.h, (120 - iw * s) / 2, (120 - ih * s) / 2, iw * s, ih * s);
  $$('button', box).forEach((b) => {
    const p = COLOR_PRESETS.find((x) => x.id === b.dataset.p);
    const v = {}; for (const k of COLOR_KEYS) v[k] = p.v[k] || 0;
    const pr = prepareFrame(sm, 120, 120, v, 120, 120, 'thumb');
    const c = document.createElement('canvas'); c.width = c.height = 120;
    const x = c.getContext('2d'); x.drawImage(pr.canvas, 0, 0, 120, 120);
    if (v.glow) { x.globalCompositeOperation = 'screen'; x.globalAlpha = 0.65 * v.glow; x.drawImage(pr.small, 0, 0, 120, 120); }
    b.querySelector('canvas, .ph').replaceWith(c);
  });
}

// ───────── 효과 칩 ─────────
function fxPicker({ grid, on, defs, get, toggle, setK: setVal }) {
  const g = $(grid), o = $(on);
  g.innerHTML = '';
  for (const d of defs) {
    const b = document.createElement('button');
    b.textContent = d.name; b.title = d.desc; b.dataset.id = d.id;
    b.onclick = () => { toggle(d.id); render(); };
    g.appendChild(b);
  }
  function render() {
    $$('button', g).forEach((b) => b.classList.toggle('on', get(b.dataset.id) > 0));
    o.innerHTML = '';
    defs.filter((d) => get(d.id) > 0).forEach((d) => {
      const row = document.createElement('div');
      row.className = 'fx-row';
      row.innerHTML = `<b>${d.name}<small>${d.desc}</small></b><button class="x" aria-label="끄기">✕</button><input type="range" min="0.05" max="1" step="0.01" aria-label="${d.name} 강도">`;
      const r = row.querySelector('input');
      r.value = get(d.id);
      r.oninput = () => setVal(d.id, parseFloat(r.value));
      row.querySelector('.x').onclick = () => { toggle(d.id); render(); };
      o.appendChild(row);
    });
    renderSummary();
  }
  render();
  return render;
}

const renderMotion = fxPicker({
  grid: '#motion-grid', on: '#motion-on', defs: MOTIONS,
  get: (id) => S.motion[id] || 0,
  toggle: (id) => { S.motion[id] ? delete S.motion[id] : (S.motion[id] = 0.6); redraw(); save(); },
  setK: (id, v) => { S.motion[id] = v; redraw(); save(); },
});
const renderOverlay = fxPicker({
  grid: '#overlay-grid', on: '#overlay-on', defs: OVERLAYS,
  get: (id) => S.overlay[id] || 0,
  toggle: (id) => { S.overlay[id] ? delete S.overlay[id] : (S.overlay[id] = 0.6); redraw(); save(); },
  setK: (id, v) => { S.overlay[id] = v; redraw(); save(); },
});

$('#look-reset').onclick = () => {
  S.motion = {}; S.overlay = {}; S.stamp.on = false;
  for (const k of COLOR_KEYS) S.color[k] = 0;
  S.color.preset = 'none';
  renderMotion(); renderOverlay(); syncInputs(); redraw(); save();
};
$('#stamp-today').onclick = () => { S.stamp.text = todayStamp(); S.stamp.on = true; syncInputs(); redraw(); save(); };

function renderSummary() {
  const box = $('#summary');
  if (!box) return;
  const names = (defs, obj) => defs.filter((d) => obj[d.id] > 0).map((d) => d.name).join(', ') || '없음';
  const preset = COLOR_PRESETS.find((p) => p.id === S.color.preset);
  const { a, b } = clipRange();
  const dirName = { fwd: '정방향', rev: '거꾸로', boom: '부메랑' }[S.clip.dir];
  const N = Math.max(1, Math.round(totalDur() * S.out.fps));
  box.innerHTML = [
    `<b>영상</b> ${media.ok ? `${media.name} · ${fmt(a)}~${fmt(b)}` : '없음'}`,
    `<b>재생</b> ${S.clip.speed}× · ${dirName}`,
    `<b>필터</b> ${preset ? preset.name : '직접 조절'}`,
    `<b>움직임</b> ${names(MOTIONS, S.motion)}`,
    `<b>효과</b> ${names(OVERLAYS, S.overlay)}${S.stamp.on ? ', 캠코더 날짜' : ''}`,
    `<b>길이</b> ${fmt(totalDur())} · ${N}프레임`,
  ].map((l) => `<div>${l}</div>`).join('');
  const { W, H } = outSize();
  const info = $('#out-info');
  if (info) info.textContent = `${W}×${H}px · ${S.out.fps}fps · ${N}프레임 · ${S.out.colors}색${N > 300 ? ' · 프레임이 많아 오래 걸리고 파일이 커질 수 있어요' : ''}`;
}

// ───────── 파일 넣기 (선택 · 끌어다 놓기 · 붙여넣기) ─────────
const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|ogv|avi)$/i.test(f.name);
function routeFiles(files) {
  const arr = [...files];
  const v = arr.find(isVideo);
  const im = arr.find((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp)$/i.test(f.name));
  if (v) { loadVideoFile(v); if (S.tab === 'ai') setTab('video'); }
  else if (im) { setAiImage(im); if (S.tab !== 'ai') { setTab('ai'); toast('그림은 AI 영상 탭으로 넣었어요. 움직이는 영상으로 만들 수 있어요.'); } }
  else if (arr.length) toast('영상이나 그림 파일만 넣을 수 있어요.');
}
$$('input[type=file][data-pick]').forEach((inp) => inp.addEventListener('change', () => { routeFiles(inp.files); inp.value = ''; }));
{
  const d = $('#video-drop'), inp = $('input', d);
  d.addEventListener('click', (e) => { if (e.target !== inp) inp.click(); });
  d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
}
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop-cover').hidden = false; });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-cover').hidden = true; });
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#drop-cover').hidden = true;
  routeFiles(e.dataTransfer.files);
});
addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...cd.files];
  if (!files.length) for (const it of cd.items || []) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
  if (files.length) { e.preventDefault(); routeFiles(files); }
});

$('#video-clear').onclick = () => {
  if (player.playing) pause();
  media.id++;
  if (media.url) URL.revokeObjectURL(media.url);
  Object.assign(media, { ok: false, url: '', name: '', w: 0, h: 0, dur: 0, strip: null, crop: null });
  vid.removeAttribute('src'); vid.load();
  player.pos = 0;
  videoChanged();
};

// 모달
const openModal = (id) => ($(id).hidden = false);
$$('[data-close-modal]').forEach((b) => b.addEventListener('click', () => { const m = b.closest('.modal'); if (m.id !== 'exp-modal' || !exporting) m.hidden = true; }));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && !(m.id === 'exp-modal' && exporting)) m.hidden = true; }));
$('#qa-btn').onclick = () => openModal('#qa-modal');

// 구간 자르기
$('#trim-start').addEventListener('input', (e) => {
  const end = S.clip.end ?? media.dur;
  S.clip.start = clamp(+e.target.value, 0, end - 0.1);
  player.pos = 0; thumbKey = null; settingsChangedTiming();
});
$('#trim-end').addEventListener('input', (e) => {
  const v = clamp(+e.target.value, S.clip.start + 0.1, media.dur);
  S.clip.end = v >= media.dur - 0.01 ? null : v;
  settingsChangedTiming();
});
$$('[data-len]').forEach((b) => (b.onclick = () => {
  if (!media.ok) return;
  const len = +b.dataset.len, d = media.dur;
  if (!len) { S.clip.start = 0; S.clip.end = null; }
  else {
    if (S.clip.start + len > d) S.clip.start = Math.max(0, d - len);
    S.clip.end = Math.min(d, S.clip.start + len);
    if (S.clip.end >= d - 0.01) S.clip.end = null;
  }
  player.pos = 0; settingsChangedTiming();
}));
$('#start-here').onclick = () => {
  if (!media.ok) return;
  const v = vtime(clamp(position(), 0, totalDur()));
  const len = (S.clip.end ?? media.dur) - S.clip.start;
  S.clip.start = clamp(v, 0, media.dur - 0.1);
  S.clip.end = Math.min(media.dur, S.clip.start + len);
  if (S.clip.end >= media.dur - 0.01) S.clip.end = null;
  player.pos = 0; settingsChangedTiming();
};

// 재생
$('#play').onclick = () => (player.playing ? pause() : play());
$('#seek').addEventListener('input', (e) => seek(+e.target.value));
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('input, textarea, select, button')) return;
  e.preventDefault(); player.playing ? pause() : play();
});
let rsT = 0;
addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(sizeCanvas, 100); });

// ───────── 용량 예상 · 목표 용량 맞추기 ─────────
const MB = 1048576;
const fmtMB = (b) => `${(b / MB).toFixed(b < MB ? 2 : 1)}MB`;
const RES_STEPS = [720, 640, 560, 480, 400, 360, 320, 280, 240, 200, 160, 120];
const FPS_STEPS = [25, 20, 15, 12, 10, 8, 6, 5];
const COL_STEPS = [256, 128, 64, 32, 16];
const SAMPLES = 4;
const est = { ver: 0, sig: '', busy: false, cur: 0, fit: null, key: '', samples: null, ev: null, evId: -1 };
const basePlan = () => ({ res: +S.out.res, fps: +S.out.fps, colors: +S.out.colors, dither: +S.out.dither });
const targetBytes = () => (+S.out.maxMB > 0 ? +S.out.maxMB * MB : 0);
const planFrames = (fps) => Math.max(1, Math.round(totalDur() * fps));
const planText = (p) => { const { W, H } = outSize(p.res); return `${W}×${H} · ${p.fps}fps · ${p.colors}색${p.dither ? '' : ' · 디더링 끔'}`; };
function stateSig() {
  const { tab, ...rest } = S;
  return JSON.stringify([media.id, rest, { ...S.out, name: '' }]);
}

/** 영상에서 미리 몇 장만 꺼내 두기 (설정을 바꿔도 다시 꺼내지 않음) */
async function getSamples() {
  const { a, b } = clipRange();
  const key = [media.id, a.toFixed(2), b.toFixed(2), S.clip.speed, S.clip.dir].join('|');
  if (est.key === key && est.samples) return est.samples;
  if (est.evId !== media.id) {
    const ev = document.createElement('video');
    ev.muted = true; ev.playsInline = true; ev.preload = 'auto'; ev.src = media.url;
    await new Promise((r, j) => { ev.onloadeddata = r; ev.onerror = j; });
    est.ev = ev; est.evId = media.id;
  }
  const dur = totalDur(), sc = Math.min(1, 1280 / Math.max(media.w, media.h));
  const out = [];
  for (let k = 0; k < SAMPLES; k++) {
    const t = ((k + 0.5) * dur) / SAMPLES;
    await seekVideo(est.ev, vtime(t));
    const c = document.createElement('canvas');
    c.width = Math.round(media.w * sc); c.height = Math.round(media.h * sc);
    if (media.crop) c.getContext('2d').drawImage(est.ev, media.crop.x, media.crop.y, media.crop.w, media.crop.h, 0, 0, c.width, c.height);
    else c.getContext('2d').drawImage(est.ev, 0, 0, c.width, c.height);
    out.push({ t, c });
  }
  est.key = key; est.samples = out;
  return out;
}

/** 샘플을 실제로 그리고 GIF로 묶어 본 프레임당 바이트 */
async function perFrameBytes(p, samples, memo) {
  const mk = `${p.res}|${p.colors}|${p.dither}`;
  if (memo.has(mk)) return memo.get(mk);
  const { W, H } = outSize(p.res);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { willReadFrequently: true, alpha: false });
  const sc = scene(totalDur()), color = colorVals(), datas = [];
  for (const s of samples) {
    const img = prepareFrame(s.c, s.c.width, s.c.height, color, W, H, 'est');
    drawFrame(x, W, H, s.t, { ...sc, img }, null);
    datas.push(x.getImageData(0, 0, W, H).data);
    await new Promise((r) => setTimeout(r, 0));
  }
  const v = measureFrames(datas, W, H, { colors: p.colors, dither: p.dither, palette: S.out.palette }) / samples.length;
  memo.set(mk, v);
  return v;
}
const totalBytes = (per, fps) => 900 + per * planFrames(fps);

function stepDown(p, k) {
  if (k === 'dither') {
    if (p.dither > 0.3) { p.dither = 0.3; return true; }
    if (p.dither > 0) { p.dither = 0; return true; }
    return false;
  }
  const list = k === 'res' ? RES_STEPS : k === 'fps' ? FPS_STEPS : COL_STEPS;
  const nx = list.find((v) => v < p[k]);
  if (nx == null) return false;
  p[k] = nx;
  return true;
}
/** 목표 용량 안에 들어올 때까지 조금씩 줄이기 */
async function fitPlan(base, target, samples, memo, alive) {
  const p = { ...base };
  let bytes = totalBytes(await perFrameBytes(p, samples, memo), p.fps);
  const order = ['dither', 'res', 'fps', 'res', 'colors', 'dither', 'res', 'fps', 'res', 'colors'];
  let i = 0;
  while (bytes > target) {
    if (!alive()) return null;
    let changed = false;
    for (let j = 0; j < order.length && !changed; j++) {
      const k = order[(i + j) % order.length];
      if (stepDown(p, k)) { changed = true; i = (i + j + 1) % order.length; }
    }
    if (!changed) break;
    bytes = totalBytes(await perFrameBytes(p, samples, memo), p.fps);
  }
  return { p, bytes, ok: bytes <= target };
}

let estT = 0;
function scheduleEstimate() {
  if (exporting) return;
  if (!media.ok) { est.cur = 0; est.fit = null; est.sig = ''; showEstimate(); return; }
  if (stateSig() === est.sig) return;
  est.ver++;
  est.busy = true; showEstimate();
  clearTimeout(estT);
  estT = setTimeout(runEstimate, 600);
}
async function runEstimate() {
  if (!media.ok || exporting) return;
  const ver = ++est.ver, sig = stateSig();
  const alive = () => ver === est.ver && !exporting;
  est.busy = true; showEstimate();
  try {
    const samples = await getSamples();
    if (!alive()) return;
    const memo = new Map(), base = basePlan();
    est.cur = totalBytes(await perFrameBytes(base, samples, memo), base.fps);
    est.fit = null;
    const target = targetBytes();
    if (target && est.cur > target) {
      showEstimate();
      const r = await fitPlan(base, target, samples, memo, alive);
      if (!r || !alive()) return;
      est.fit = r;
    }
    if (!alive()) return;
    est.busy = false; est.sig = sig;
    showEstimate();
  } catch (e) { console.warn(e); if (ver === est.ver) { est.busy = false; showEstimate(); } }
}
function showEstimate() {
  const { W, H } = outSize();
  const box = $('#size-est'), target = targetBytes();
  const final = est.fit ? est.fit.bytes : est.cur;
  const sizeTxt = media.ok && est.cur ? ` · 약 ${fmtMB(final)}` : '';
  $('#hero-s').textContent = `${W}×${H} · ${S.out.fps}fps${est.busy ? ' · 용량 계산 중…' : sizeTxt}`;
  $('#export-btn2').textContent = media.ok && est.cur && !est.busy ? `GIF 저장 · 약 ${fmtMB(final)}` : 'GIF 저장';
  if (!box) return;
  if (!media.ok) { box.innerHTML = '<span class="muted">영상을 넣으면 저장될 용량을 알려드려요.</span>'; return; }
  if (!est.cur) { box.innerHTML = '<span class="big">계산 중…</span>'; return; }
  const lines = [`<span class="big">약 ${fmtMB(est.cur)}<small>지금 설정 그대로 저장할 때${est.busy ? ' · 다시 계산 중…' : ''}</small></span>`];
  if (target) {
    const tg = `${+S.out.maxMB}MB`;
    if (est.cur <= target) lines.push(`<span class="ok">✓ 목표 ${tg} 안에 들어와요.</span>`);
    else if (est.fit && est.fit.ok) lines.push(`목표 ${tg}에 맞추면 <b>약 ${fmtMB(est.fit.bytes)}</b><br>${planText(est.fit.p)}`);
    else if (est.fit) lines.push(`<span class="warn">가장 작게 줄여도 약 ${fmtMB(est.fit.bytes)}예요. 구간을 더 짧게 잘라주세요.</span>`);
    else lines.push('목표에 맞추는 방법을 찾는 중…');
  }
  box.innerHTML = lines.join('<br>');
}

// ───────── GIF 저장 ─────────
let exporting = null;
async function doExport() {
  if (!media.ok) { toast('먼저 영상을 넣어주세요.'); setTab('video'); return; }
  const dur = totalDur();
  const target = targetBytes();
  if (player.playing) pause();
  clearTimeout(estT); est.ver++;
  const ctrl = new AbortController();
  exporting = ctrl;
  const alive = () => !ctrl.signal.aborted;
  const bar = $('#exp-bar'), label = $('#exp-label');
  $('#exp-title').textContent = 'GIF 만드는 중';
  $('#exp-run').hidden = false; $('#exp-done').hidden = true;
  bar.style.width = '0%'; label.textContent = '준비 중…';
  openModal('#exp-modal');
  const t0 = performance.now();
  try {
    await Promise.all([...layerUI.fonts().map((f) => document.fonts.load(`700 40px ${f}`)), document.fonts.load('700 40px "VT323"')]).catch(() => {});
    let plan = basePlan(), guess = 0;
    const memo = new Map();
    label.textContent = target ? `목표 ${+S.out.maxMB}MB에 맞추는 중…` : '용량 계산 중…';
    const samples = await getSamples();
    if (!alive()) throw new DOMException('취소됨', 'AbortError');
    if (target) {
      const r = await fitPlan(plan, target, samples, memo, alive);
      if (!r) throw new DOMException('취소됨', 'AbortError');
      plan = r.p; guess = r.bytes;
    } else guess = totalBytes(await perFrameBytes(plan, samples, memo), plan.fps);

    const N0 = planFrames(plan.fps);
    if (N0 > 450 && !confirm(`프레임이 ${N0}장이라 오래 걸리고 파일이 커질 수 있어요 (약 ${fmtMB(guess)}).\n그래도 만들까요?`)) throw new DOMException('취소됨', 'AbortError');

    const sc = scene(dur), color = colorVals();
    let res, W, H, tries = 0;
    for (;;) {
      ({ W, H } = outSize(plan.res));
      let img = null;
      const g = guess;
      res = await exportGif({
        W, H, fps: plan.fps, dur, signal: ctrl.signal,
        colors: plan.colors, dither: plan.dither, palette: S.out.palette, loop: +S.out.loop,
        prepare: async (t) => { await seekVideo(vid, vtime(t)); img = prepareFrame(vid, media.w, media.h, color, W, H, 'export', media.crop); },
        draw: (x, w, h, t) => drawFrame(x, w, h, t, { ...sc, img }, null),
        onProgress: (p, l, bytes) => {
          bar.style.width = `${Math.round(p * 100)}%`;
          label.textContent = `${l}${bytes ? ` · 지금 ${fmtMB(bytes)} / 예상 약 ${fmtMB(g)}` : ''}${tries ? ' · 다시 만드는 중' : ''}`;
        },
      });
      // 예상보다 커서 목표를 넘으면, 넘은 만큼 줄여서 다시
      if (!target || res.blob.size <= target || tries >= 2) break;
      tries++;
      const want = plan.res * Math.sqrt(target / res.blob.size) * 0.97;
      const nr = RES_STEPS.find((v) => v <= want);
      if (nr && nr < plan.res) plan.res = nr;
      else if (!stepDown(plan, 'fps') && !stepDown(plan, 'colors')) break;
      guess = res.blob.size * (target / res.blob.size) * 0.95;
      label.textContent = `목표보다 ${fmtMB(res.blob.size - target)} 커서 조금 줄여서 다시 만드는 중…`;
    }

    const url = URL.createObjectURL(res.blob);
    const name = `${(S.out.name || 'seol-gif').replace(/[\\/:*?"<>|]+/g, '_')}.gif`;
    const im = $('#exp-img');
    if (im.src.startsWith('blob:')) URL.revokeObjectURL(im.src);
    im.src = url;
    const size = res.blob.size;
    const a = $('#exp-dl'); a.href = url; a.download = name;
    a.textContent = `다운로드 (${fmtMB(size)})`;
    const tgTxt = target ? (size <= target ? `목표 ${+S.out.maxMB}MB 안에 맞췄어요` : `목표 ${+S.out.maxMB}MB보다 커요 · 구간을 줄여보세요`) : '';
    $('#exp-size').innerHTML = `${fmtMB(size)}<small>${tgTxt}</small>`;
    const changed = JSON.stringify(plan) !== JSON.stringify(basePlan());
    $('#exp-note').textContent = `${planText(plan)} · ${res.frames}프레임 · ${fmt(dur)} · ${((performance.now() - t0) / 1000).toFixed(1)}초 걸림${changed ? ' (용량에 맞춰 줄임)' : ''}`;
    const file = new File([res.blob], name, { type: 'image/gif' });
    const sh = $('#exp-share');
    sh.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    sh.onclick = () => navigator.share({ files: [file] }).catch(() => {});
    $('#exp-title').textContent = '완성!';
    $('#exp-run').hidden = true; $('#exp-done').hidden = false;
  } catch (err) {
    $('#exp-modal').hidden = true;
    if (err && err.name === 'AbortError') toast('저장을 취소했어요.');
    else { console.error(err); toast(`GIF를 만들지 못했어요: ${err && err.message ? err.message : err}`, 5000); }
  } finally {
    exporting = null;
    parkVideo();
    est.sig = ''; scheduleEstimate();
  }
}
$('#export-btn').onclick = doExport;
$('#export-btn2').onclick = doExport;
$('#exp-cancel').onclick = () => exporting && exporting.abort();

// ───────── 시작 ─────────
const layerUI = initLayers({
  canvas: pv,
  state: () => S,
  onChange: (persist = true) => { redraw(); if (persist) save(); },
  toast,
});
initAi({
  toast,
  useVideo: (file, opts) => { setTab('video'); loadVideoFile(file, opts); },
});
$('#support').textContent = '모든 처리는 이 브라우저 안에서 해요. 저장 시간은 대략 길이 × 초당 프레임에 비례해요.';
syncInputs();
setTab(S.tab);
videoChanged();
sizeCanvas();
document.fonts.ready.then(redraw);
requestAnimationFrame(frame);
