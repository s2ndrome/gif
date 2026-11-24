// 글자 · 스티커 레이어
// - 미리보기에서 끌어서 옮기기, 모서리 네모로 크기, 위쪽 동그라미로 회전
// - 미리보기와 GIF 저장이 같은 drawLayers()를 씀 (선택 테두리는 미리보기에만)

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const EMOJIS = ['❤️', '💕', '💖', '💗', '💔', '✨', '⭐', '🌟', '💫', '🔥', '💥', '💢', '💦', '💧', '💬', '💭', '❓', '❗', '‼️', '💯',
  '😂', '🤣', '😍', '🥰', '😘', '😎', '🥺', '😭', '😡', '🤔', '😳', '🙄', '😇', '🤭', '😴', '🤤', '👍', '👏', '🙌', '🙏',
  '💪', '👀', '🫶', '🎉', '🎀', '🌸', '🌹', '🍀', '☁️', '🌙', '☀️', '🌈', '⚡', '❄️', '🎵', '🐱', '🐶', '🐰', '🧸', '🍓', '🍰', '☕', '🎂', '👑'];

export const LAYER_ANIMS = [
  { id: 'none', name: '그대로' },
  { id: 'bob', name: '둥실둥실' },
  { id: 'wiggle', name: '흔들흔들' },
  { id: 'pulse', name: '쿵쿵' },
  { id: 'spin', name: '빙글빙글' },
  { id: 'blink', name: '깜빡깜빡' },
  { id: 'pop', name: '뿅 등장' },
];

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const stickerImgs = new Map(); // 내 그림 스티커: id → { el, w, h, name }  (새로고침하면 사라짐)
let uid = Date.now() % 100000;

export const newText = (o = {}) => ({
  id: ++uid, type: 'text', x: 0.5, y: 0.84, rot: 0, opacity: 1, anim: 'none',
  content: '글자를 입력하세요', font: '"Noto Sans KR", sans-serif', size: 72, color: '#ffffff',
  align: 'center', shadow: true, stroke: true, strokeColor: '#000000', appear: 'none', ...o,
});
export const newSticker = (o = {}) => ({
  id: ++uid, type: 'sticker', x: 0.5, y: 0.45, rot: 0, opacity: 1, anim: 'none', size: 0.22, emoji: '❤️', img: null, flip: false, ...o,
});

// ───────── 모양 계산 ─────────
const textLines = (L) => String(L.content || '').split('\n');
let measureCtx = null;
function measure(L, W, H) {
  const u = Math.min(W, H) / 1080, mn = Math.min(W, H);
  if (L.type === 'text') {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    const fs = L.size * u;
    measureCtx.font = `700 ${fs}px ${L.font}`;
    const lines = textLines(L);
    const w = Math.max(fs * 0.6, ...lines.map((l) => measureCtx.measureText(l || ' ').width)) + fs * 0.5;
    return { w, h: fs * 1.3 * lines.length + fs * 0.2, fs };
  }
  const s = L.size * mn;
  const im = L.img && stickerImgs.get(L.img);
  if (im) { const a = im.w / im.h; return a >= 1 ? { w: s, h: s / a } : { w: s * a, h: s }; }
  return { w: s, h: s };
}
/** 화면 위 레이어 상자 (움직임 효과 빼고) */
export function layerGeom(L, W, H) {
  const m = measure(L, W, H);
  return { cx: L.x * W, cy: L.y * H, w: m.w, h: m.h, rot: (L.rot || 0) * Math.PI / 180, fs: m.fs };
}
function animAt(L, t) {
  const ph = (L.id % 7) * 0.9;
  const a = { dy: 0, rot: 0, scale: 1, alpha: 1 };
  switch (L.anim) {
    case 'bob': a.dy = Math.sin(t * 2.4 + ph) * 0.025; break;
    case 'wiggle': a.rot = Math.sin(t * 7 + ph) * 0.14; break;
    case 'pulse': a.scale = 1 + 0.14 * Math.exp(-((t * 2) % 1) * 6); break;
    case 'spin': a.rot = t * 2.2; break;
    case 'blink': a.alpha = Math.floor(t * 2.5) % 2 ? 0.12 : 1; break;
    case 'pop': { const p = clamp(t / 0.45, 0, 1); a.scale = p < 1 ? 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2) : 1; break; }
    default:
  }
  return a;
}

// ───────── 그리기 ─────────
export function drawLayers(x, W, H, t, layers) {
  if (!layers || !layers.length) return;
  const mn = Math.min(W, H);
  for (const L of layers) {
    if (L.type === 'sticker' && L.img && !stickerImgs.has(L.img)) continue;
    const g = layerGeom(L, W, H), a = animAt(L, t);
    let alpha = (L.opacity ?? 1) * a.alpha;
    let lines = L.type === 'text' ? textLines(L) : null;
    if (L.type === 'text' && L.appear === 'fade') alpha *= clamp(t / 1.0, 0, 1);
    if (L.type === 'text' && L.appear === 'type') {
      let left = Math.floor(t * 12);
      lines = lines.map((ln) => { const s = ln.slice(0, Math.max(0, left)); left -= ln.length; return s; });
    }
    if (alpha <= 0.001 || (lines && !lines.join('').trim())) continue;
    x.save();
    x.globalAlpha = alpha;
    x.translate(g.cx, g.cy + a.dy * mn);
    x.rotate(g.rot + a.rot);
    x.scale(a.scale * (L.flip ? -1 : 1), a.scale);
    if (L.type === 'text') {
      const fs = g.fs, lh = fs * 1.3;
      x.font = `700 ${fs}px ${L.font}`;
      x.textAlign = L.align || 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      const tx = L.align === 'left' ? -g.w / 2 + fs * 0.25 : L.align === 'right' ? g.w / 2 - fs * 0.25 : 0;
      const y0 = -((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        const yy = y0 + i * lh;
        if (L.stroke) { x.lineWidth = Math.max(2, fs * 0.16); x.strokeStyle = L.strokeColor || '#000'; x.strokeText(ln, tx, yy); }
        if (L.shadow) { x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = fs * 0.18; x.shadowOffsetY = fs * 0.04; }
        x.fillStyle = L.color; x.fillText(ln, tx, yy);
        x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
      });
    } else if (L.img) {
      x.drawImage(stickerImgs.get(L.img).el, -g.w / 2, -g.h / 2, g.w, g.h);
    } else {
      x.font = `${g.w * 0.86}px ${EMOJI_FONT}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(L.emoji, 0, g.w * 0.05);
    }
    x.restore();
  }
}

// ───────── 미리보기 위 선택 표시 · 끌기 ─────────
const HANDLE = 9; // CSS px
function corners(g) {
  const c = Math.cos(g.rot), s = Math.sin(g.rot);
  const pt = (dx, dy) => ({ x: g.cx + dx * c - dy * s, y: g.cy + dx * s + dy * c });
  const off = 26 * (g.k || 1);
  let rot = pt(0, -g.h / 2 - off), rotBase = pt(0, -g.h / 2), below = false;
  // 화면 밖으로 나가면(맨 위 근처) 회전 손잡이를 아래쪽에
  if (g.H && (rot.y < 12 * (g.k || 1) || rot.x < 0 || rot.x > g.W)) { rot = pt(0, g.h / 2 + off); rotBase = pt(0, g.h / 2); below = true; }
  return { tl: pt(-g.w / 2, -g.h / 2), tr: pt(g.w / 2, -g.h / 2), br: pt(g.w / 2, g.h / 2), bl: pt(-g.w / 2, g.h / 2), rot, rotBase, below };
}
function toLocal(g, px, py) {
  const c = Math.cos(-g.rot), s = Math.sin(-g.rot), dx = px - g.cx, dy = py - g.cy;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/**
 * @param o.canvas 미리보기 캔버스
 * @param o.state () => S
 * @param o.onChange () => void   (다시 그리기 + 저장)
 * @param o.toast
 */
export function initLayers(o) {
  const S = () => o.state();
  let sel = null; // 선택된 레이어 id
  const layers = () => S().layers;
  const cur = () => layers().find((l) => l.id === sel) || null;
  const changed = (renderList = false) => { if (renderList) renderPanel(); else syncEditor(); o.onChange(); };

  // 선택 테두리 (미리보기에만)
  function drawSelection(x, W, H) {
    const L = cur();
    if (!L) return;
    const r = o.canvas.getBoundingClientRect(), k = W / Math.max(1, r.width);
    const g = { ...layerGeom(L, W, H), k, W, H };
    const pad = 6 * k;
    const gg = { ...g, w: g.w + pad * 2, h: g.h + pad * 2 };
    const c = corners(gg);
    x.save();
    x.lineWidth = 1.5 * k; x.setLineDash([5 * k, 4 * k]); x.strokeStyle = '#fff';
    x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 3 * k;
    x.beginPath(); x.moveTo(c.tl.x, c.tl.y); x.lineTo(c.tr.x, c.tr.y); x.lineTo(c.br.x, c.br.y); x.lineTo(c.bl.x, c.bl.y); x.closePath(); x.stroke();
    x.setLineDash([]);
    x.beginPath(); x.moveTo(c.rotBase.x, c.rotBase.y); x.lineTo(c.rot.x, c.rot.y); x.stroke();
    x.fillStyle = '#fff'; x.strokeStyle = '#5f7a8c'; x.lineWidth = 2 * k;
    x.beginPath(); x.arc(c.rot.x, c.rot.y, HANDLE * k * 0.8, 0, 7); x.fill(); x.stroke();
    for (const p of [c.tl, c.tr, c.br, c.bl]) { x.beginPath(); x.rect(p.x - HANDLE * k / 2 * 1.4, p.y - HANDLE * k / 2 * 1.4, HANDLE * k * 1.4, HANDLE * k * 1.4); x.fill(); x.stroke(); }
    x.restore();
  }

  // 끌기: 'move' | 'size' | 'rot'
  let drag = null;
  const toCanvas = (e) => { const r = o.canvas.getBoundingClientRect(); const k = o.canvas.width / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }; };
  /** 미리보기에서 누름 → 레이어를 잡았으면 true */
  function pointerDown(e) {
    const W = o.canvas.width, H = o.canvas.height, p = toCanvas(e);
    const L0 = cur();
    if (L0) {
      const g = { ...layerGeom(L0, W, H), k: p.k, W, H }, pad = 6 * p.k;
      const c = corners({ ...g, w: g.w + pad * 2, h: g.h + pad * 2 });
      const near = (q) => Math.hypot(p.x - q.x, p.y - q.y) < 16 * p.k;
      if (near(c.rot)) { drag = { mode: 'rot', L: L0, g, below: c.below }; return true; }
      if ([c.tl, c.tr, c.br, c.bl].some(near)) { drag = { mode: 'size', L: L0, g, d0: Math.hypot(p.x - g.cx, p.y - g.cy), s0: L0.size }; return true; }
    }
    for (let i = layers().length - 1; i >= 0; i--) {
      const L = layers()[i], g = layerGeom(L, W, H), q = toLocal(g, p.x, p.y), m = 6 * p.k;
      if (Math.abs(q.x) <= g.w / 2 + m && Math.abs(q.y) <= g.h / 2 + m) {
        if (sel !== L.id) { sel = L.id; renderPanel(); }
        drag = { mode: 'move', L, ox: p.x - g.cx, oy: p.y - g.cy };
        o.onChange();
        return true;
      }
    }
    if (sel != null) { sel = null; renderPanel(); o.onChange(); }
    return false;
  }
  function pointerMove(e) {
    if (!drag) return false;
    const W = o.canvas.width, H = o.canvas.height, p = toCanvas(e), L = drag.L;
    if (drag.mode === 'move') {
      L.x = clamp((p.x - drag.ox) / W, -0.1, 1.1); L.y = clamp((p.y - drag.oy) / H, -0.1, 1.1);
      // 가운데 가까우면 딱 붙기
      if (Math.abs(L.x - 0.5) < 0.012) L.x = 0.5;
      if (Math.abs(L.y - 0.5) < 0.012) L.y = 0.5;
    } else if (drag.mode === 'size') {
      const d = Math.hypot(p.x - drag.g.cx, p.y - drag.g.cy);
      const f = d / Math.max(1, drag.d0);
      L.size = L.type === 'text' ? clamp(Math.round(drag.s0 * f), 16, 400) : clamp(+(drag.s0 * f).toFixed(3), 0.03, 1.5);
    } else {
      let deg = (Math.atan2(p.y - drag.g.cy, p.x - drag.g.cx) * 180) / Math.PI + (drag.below ? -90 : 90);
      deg = ((deg + 540) % 360) - 180;
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 4) deg = snap;
      L.rot = Math.round(deg);
    }
    syncEditor(); o.onChange(false);
    return true;
  }
  function pointerUp() { if (!drag) return false; drag = null; o.onChange(); return true; }
  /** 휠: 선택된 레이어 크기 */
  function wheel(e) {
    const L = cur();
    if (!L) return false;
    const f = Math.exp(-e.deltaY * 0.0015);
    L.size = L.type === 'text' ? clamp(Math.round(L.size * f), 16, 400) : clamp(+(L.size * f).toFixed(3), 0.03, 1.5);
    syncEditor(); o.onChange();
    return true;
  }
  // 키보드: 지우기 · 화살표로 조금씩
  addEventListener('keydown', (e) => {
    const L = cur();
    if (!L || e.target.closest('input, textarea, select') || !$('#ai-stage').hidden) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(L.id); return; }
    const st = e.shiftKey ? 0.02 : 0.004;
    const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (mv) { e.preventDefault(); L.x = clamp(L.x + mv[0], -0.1, 1.1); L.y = clamp(L.y + mv[1], -0.1, 1.1); o.onChange(); }
    if (e.key === 'Escape') { sel = null; renderPanel(); o.onChange(); }
  });

  // ───────── 패널 ─────────
  function add(L) { layers().push(L); sel = L.id; changed(true); }
  function remove(id) { const a = layers(), i = a.findIndex((l) => l.id === id); if (i >= 0) a.splice(i, 1); if (sel === id) sel = null; changed(true); }

  const grid = $('#sticker-grid');
  for (const em of EMOJIS) {
    const b = document.createElement('button');
    b.textContent = em; b.title = '스티커 넣기';
    b.onclick = () => {
      const L = cur();
      if (L && L.type === 'sticker' && $('#sticker-grid').dataset.mode === 'swap') { L.emoji = em; L.img = null; changed(true); }
      else add(newSticker({ emoji: em, x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.3 }));
      grid.hidden = true;
    };
    grid.appendChild(b);
  }
  $('#add-text').onclick = () => { add(newText({ y: [0.84, 0.16, 0.5][layers().filter((l) => l.type === 'text').length % 3] })); setTimeout(() => { const t = $('#lt-content'); t.focus(); t.select(); }, 30); };
  $('#add-sticker').onclick = () => { grid.dataset.mode = 'add'; grid.hidden = !grid.hidden; };
  $('#sticker-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const im = new Image(); im.src = url; await im.decode();
      const id = `img${++uid}`;
      stickerImgs.set(id, { el: im, w: im.naturalWidth, h: im.naturalHeight, name: f.name });
      add(newSticker({ img: id, emoji: '', size: 0.32 }));
      o.toast('그림 스티커를 넣었어요. (내 그림 스티커는 새로고침하면 사라져요)');
    } catch { URL.revokeObjectURL(url); o.toast('이 그림은 열 수 없어요.'); }
  });

  function renderPanel() {
    // 내 그림 스티커는 새로고침하면 없어지니 목록에서도 정리
    const a = layers();
    for (let i = a.length - 1; i >= 0; i--) if (a[i].type === 'sticker' && a[i].img && !stickerImgs.has(a[i].img)) a.splice(i, 1);
    const box = $('#layers');
    box.innerHTML = '';
    // 위에 있는 것(나중에 그려지는 것)이 목록 위
    [...a].reverse().forEach((L) => {
      const row = document.createElement('div');
      row.className = `layer-row${L.id === sel ? ' on' : ''}`;
      const label = L.type === 'text' ? `<span class="lk">가</span>${esc(textLines(L)[0] || '(빈 글자)')}` : L.img ? `<span class="lk">🖼</span>${esc(stickerImgs.get(L.img)?.name || '그림')}` : `<span class="lk em">${L.emoji}</span>스티커`;
      row.innerHTML = `<button class="pick">${label}</button><button class="mv" aria-label="앞으로">▲</button><button class="mv" aria-label="뒤로">▼</button><button class="x" aria-label="지우기">✕</button>`;
      const [pick, up, down, x] = row.querySelectorAll('button');
      const i = a.indexOf(L);
      up.disabled = i === a.length - 1; down.disabled = i === 0;
      pick.onclick = () => { sel = L.id === sel ? null : L.id; renderPanel(); o.onChange(); };
      up.onclick = () => { a.splice(i, 1); a.splice(i + 1, 0, L); changed(true); };
      down.onclick = () => { a.splice(i, 1); a.splice(i - 1, 0, L); changed(true); };
      x.onclick = () => remove(L.id);
      box.appendChild(row);
    });
    $('#layers-empty').hidden = a.length > 0;
    syncEditor();
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // 선택한 레이어 편집칸
  const ed = $('#layer-edit');
  function syncEditor() {
    const L = cur();
    ed.hidden = !L;
    if (!L) return;
    $$('[data-lt]', ed).forEach((e) => (e.hidden = e.dataset.lt !== L.type));
    for (const el of $$('[data-l]', ed)) {
      if (el.closest('[data-lt]') && el.closest('[data-lt]').dataset.lt !== L.type) continue;
      const v = L[el.dataset.l];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el || el.type === 'range') el.value = v ?? '';
    }
    for (const out of $$('[data-lo]', ed)) {
      if (out.closest('[data-lt]') && out.closest('[data-lt]').dataset.lt !== L.type) continue;
      const v = L[out.dataset.lo];
      out.textContent = out.dataset.lo === 'size' && L.type === 'sticker' ? Math.round(v * 100) : out.hasAttribute('data-pct') ? Math.round(v * 100) : Math.round(v);
    }
    $('#layer-edit-title').textContent = L.type === 'text' ? '선택한 글자' : '선택한 스티커';
  }
  for (const el of $$('[data-l]', ed)) {
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const L = cur();
      if (!L) return;
      const k = el.dataset.l;
      L[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      if (k === 'font') document.fonts.load(`700 40px ${L.font}`).then(() => o.onChange());
      syncEditor();
      o.onChange();
      if (k === 'content') renderPanel();
    });
  }
  $('#layer-dup').onclick = () => { const L = cur(); if (!L) return; add({ ...L, id: ++uid, x: clamp(L.x + 0.04, 0, 1), y: clamp(L.y + 0.04, 0, 1) }); };
  $('#layer-center').onclick = () => { const L = cur(); if (!L) return; L.x = 0.5; L.y = 0.5; changed(); };
  $('#layer-reset-rot').onclick = () => { const L = cur(); if (!L) return; L.rot = 0; changed(); };
  $('#layer-del').onclick = () => { const L = cur(); if (L) remove(L.id); };
  $('#layer-swap').onclick = () => { grid.dataset.mode = 'swap'; grid.hidden = false; grid.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

  renderPanel();
  return {
    drawSelection, pointerDown, pointerMove, pointerUp, wheel,
    fonts: () => [...new Set(layers().filter((l) => l.type === 'text').map((l) => l.font))],
    deselect: () => { if (sel != null) { sel = null; renderPanel(); } },
    refresh: renderPanel,
  };
}
