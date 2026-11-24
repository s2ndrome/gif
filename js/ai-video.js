// 그림 한 장 → AI(Vertex AI Veo)로 움직이는 영상 만들기
// 토큰은 이 브라우저에서 Google(aiplatform.googleapis.com)로만 바로 보냅니다. 다른 곳엔 보내지 않아요.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const AI_MODELS = [
  { id: 'veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast (빠르고 저렴)' },
  { id: 'veo-3.1-generate-001', name: 'Veo 3.1 (고품질)' },
];

// 움직임 문구 (영어가 더 잘 통해서 영어로 넣고, 버튼은 한국어)
const MOTION_PRESETS = [
  { name: '머리카락 흩날림', en: 'hair gently flowing in the wind' },
  { name: '옷자락 펄럭', en: 'clothes and ribbons fluttering softly' },
  { name: '눈 깜빡임', en: 'characters blink naturally and breathe subtly' },
  { name: '천천히 줌인', en: 'slow cinematic camera push-in' },
  { name: '카메라 살짝 회전', en: 'slow gentle camera orbit' },
  { name: '떨어지는 느낌', en: 'floating and slowly falling through the air' },
  { name: '도시 불빛 반짝', en: 'city lights twinkling in the background' },
  { name: '눈 · 빛가루', en: 'soft snow and light particles drifting' },
  { name: '벚꽃잎', en: 'cherry blossom petals drifting' },
  { name: '빗방울', en: 'light rain falling' },
];
const BASE_PROMPT = 'Animate this illustration. Keep the exact art style, characters, faces, colors and composition of the image. Subtle, smooth, natural motion: ';

const SET_KEY = 'seol-gif-ai-v1';
const TOK_KEY = 'seol-gif-ai-token';
const DEF = () => ({
  prompt: BASE_PROMPT + 'hair gently flowing in the wind, clothes and ribbons fluttering softly.',
  neg: 'distorted face, extra limbs, style change, text, watermark',
  model: AI_MODELS[0].id, dur: 6, aspect: 'auto', res: '720p', audio: false, seed: '',
  project: '', location: 'us-central1', auth: 'token', base: '', remember: false,
});

let A = DEF();
try { A = { ...A, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch { /* 무시 */ }
const saveSet = () => { try { const { ...s } = A; localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch { /* 무시 */ } };

function loadToken() {
  try { return sessionStorage.getItem(TOK_KEY) || localStorage.getItem(TOK_KEY) || ''; } catch { return ''; }
}
function storeToken(v) {
  try {
    sessionStorage.setItem(TOK_KEY, v);
    if (A.remember) localStorage.setItem(TOK_KEY, v); else localStorage.removeItem(TOK_KEY);
  } catch { /* 무시 */ }
}

const img = { file: null, url: '', w: 0, h: 0, b64: '', mime: '' };
const job = { ctrl: null, timer: 0, t0: 0 };
let result = null; // { blob, url, name }
let hooks = { toast: (m) => alert(m), useVideo: () => {} };

// ───────── 그림 ─────────
export async function setAiImage(file) {
  if (!file || !(file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif)$/i.test(file.name))) { hooks.toast('그림 파일(png · jpg · webp)을 넣어주세요.'); return; }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image(); im.src = url; await im.decode();
    // Veo는 png / jpeg만 받아서, 너무 크면 줄이고 jpeg로 다시 저장
    const max = 1920, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(im, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.93);
    if (img.url) URL.revokeObjectURL(img.url);
    Object.assign(img, { file, url, w: im.naturalWidth, h: im.naturalHeight, b64: data.split(',')[1], mime: 'image/jpeg' });
    $('#ai-img').src = url;
    setView('img');
    $('#ai-img-name').textContent = `🖼 ${file.name} · ${img.w}×${img.h}`;
    $('#ai-drop').classList.add('has');
    syncAspectHint();
  } catch {
    URL.revokeObjectURL(url);
    hooks.toast('이 그림은 열 수 없어요. (HEIC는 JPG로 바꿔서 넣어주세요)');
  }
}
const autoAspect = () => (img.w && img.h > img.w ? '9:16' : '16:9');
function syncAspectHint() {
  const o = $('#ai-aspect option[value=auto]');
  if (o) o.textContent = img.w ? `그림에 맞춰 자동 (${autoAspect()})` : '그림에 맞춰 자동';
}

// ───────── 연결 ─────────
function endpoint(model, method) {
  const loc = (A.location || 'us-central1').trim();
  if (A.base.trim()) return `${A.base.trim().replace(/\/+$/, '')}/${model}:${method}`;
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  if (!A.project.trim() && A.auth === 'key') return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${method}`;
  return `https://${host}/v1/projects/${encodeURIComponent(A.project.trim())}/locations/${loc}/publishers/google/models/${model}:${method}`;
}
async function call(url, body, signal) {
  const tok = $('#ai-token').value.trim();
  const headers = { 'Content-Type': 'application/json' };
  let u = url;
  if (A.auth === 'key') u += (u.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(tok);
  else headers.Authorization = `Bearer ${tok}`;
  let r;
  try {
    r = await fetch(u, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Google 서버에 연결하지 못했어요. 인터넷 연결이나 지역(location) 이름을 확인해주세요. 회사망·확장 프로그램이 막고 있을 수도 있어요.');
  }
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* 무시 */ }
  if (!r.ok) {
    const msg = j?.error?.message || txt.slice(0, 300) || r.statusText;
    if (r.status === 401) throw new Error(`인증이 안 돼요 (401). ${A.auth === 'token' ? '액세스 토큰은 1시간이면 만료돼요. 새로 발급해서 넣어주세요.' : 'API 키를 확인해주세요.'}\n${msg}`);
    if (r.status === 403) throw new Error(`권한이 없어요 (403). 프로젝트에서 Vertex AI API가 켜져 있는지, 이 계정에 Vertex AI 사용 권한이 있는지 확인해주세요.\n${msg}`);
    if (r.status === 404) throw new Error(`모델이나 프로젝트를 찾을 수 없어요 (404). 프로젝트 ID · 지역 · 모델 이름을 확인해주세요.\n${msg}`);
    if (r.status === 429) throw new Error(`요청이 너무 많아요 (429). 잠시 후 다시 해주세요.\n${msg}`);
    throw new Error(`${r.status} ${msg}`);
  }
  return j || {};
}

function requestBody() {
  const inst = { prompt: A.prompt.trim(), image: { bytesBase64Encoded: img.b64, mimeType: img.mime } };
  const params = {
    sampleCount: 1,
    durationSeconds: +A.dur,
    aspectRatio: A.aspect === 'auto' ? autoAspect() : A.aspect,
    resolution: A.res,
    generateAudio: !!A.audio,
  };
  if (A.neg.trim()) params.negativePrompt = A.neg.trim();
  if (String(A.seed).trim() !== '' && isFinite(+A.seed)) params.seed = Math.max(0, Math.floor(+A.seed)) >>> 0;
  return { instances: [inst], parameters: params };
}

function status(html, kind = '') {
  const s = $('#ai-status');
  s.hidden = !html;
  s.className = `size-est ${kind}`;
  s.innerHTML = html;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const secs = () => Math.round((performance.now() - job.t0) / 1000);

async function generate() {
  if (job.ctrl) { job.ctrl.abort(); return; }
  if (!img.b64) { hooks.toast('먼저 움직일 그림을 넣어주세요.'); return; }
  if (!$('#ai-token').value.trim()) { $('#ai-conn').open = true; $('#ai-token').focus(); hooks.toast(A.auth === 'key' ? 'API 키를 넣어주세요.' : '액세스 토큰을 넣어주세요.'); return; }
  if (!A.project.trim() && A.auth === 'token' && !A.base.trim()) { $('#ai-conn').open = true; $('#ai-project').focus(); hooks.toast('Google Cloud 프로젝트 ID를 넣어주세요.'); return; }
  if (!A.prompt.trim()) { hooks.toast('어떻게 움직일지 설명을 적어주세요.'); return; }
  storeToken($('#ai-token').value.trim());

  const ctrl = new AbortController();
  job.ctrl = ctrl; job.t0 = performance.now();
  const btn = $('#ai-go');
  btn.textContent = '그만두기';
  const tickUI = (msg) => status(`<span class="big">${msg}<small>${secs()}초 지남</small></span>보통 1~3분 걸려요. 이 탭을 열어두세요.`);
  clearInterval(job.timer);
  let phase = 'AI에게 보내는 중…';
  job.timer = setInterval(() => tickUI(phase), 1000);
  tickUI(phase);
  try {
    const op = await call(endpoint(A.model, 'predictLongRunning'), requestBody(), ctrl.signal);
    if (!op.name) throw new Error('작업 번호를 받지 못했어요.');
    phase = '영상 만드는 중…';
    let res;
    for (;;) {
      await new Promise((r, j) => { const t = setTimeout(r, 6000); ctrl.signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('취소됨', 'AbortError')); }, { once: true }); });
      res = await call(endpoint(A.model, 'fetchPredictOperation'), { operationName: op.name }, ctrl.signal);
      if (res.done) break;
      if (secs() > 600) throw new Error('10분이 지나도 끝나지 않았어요. 잠시 후 다시 해주세요.');
    }
    if (res.error) throw new Error(`AI가 영상을 만들지 못했어요: ${res.error.message || res.error.code}`);
    const r = res.response || {};
    const v = (r.videos || r.generatedSamples?.map((s) => s.video) || [])[0];
    if (!v || !v.bytesBase64Encoded) {
      if (r.raiMediaFilteredCount > 0) {
        const why = (r.raiMediaFilteredReasons || []).join(' / ');
        throw new Error(`안전 필터에 걸려서 영상이 나오지 않았어요.${why ? `\n${why}` : ''}\n설명을 바꾸거나 다른 그림으로 해보세요.`);
      }
      if (v && v.gcsUri) throw new Error(`영상이 Cloud Storage(${v.gcsUri})에 저장됐어요. 거기서 내려받아 '영상' 탭에 넣어주세요.`);
      throw new Error('결과 영상이 비어 있어요.');
    }
    const bin = atob(v.bytesBase64Encoded), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const blob = new Blob([u8], { type: v.mimeType && v.mimeType.startsWith('video/') ? v.mimeType : 'video/mp4' });
    showResult(blob);
    status(`<span class="big ok">완성!<small>${secs()}초 걸림 · ${(blob.size / 1048576).toFixed(1)}MB</small></span>`, '');
  } catch (e) {
    if (e.name === 'AbortError') status('그만뒀어요. (이미 보낸 요청은 Google 쪽에서 계속 만들어질 수 있어요)');
    else status(`<span class="warn">${esc(e.message || e).replace(/\n/g, '<br>')}</span>`);
  } finally {
    clearInterval(job.timer);
    job.ctrl = null;
    btn.textContent = 'AI로 영상 만들기';
  }
}

function showResult(blob) {
  if (result) URL.revokeObjectURL(result.url);
  const base = (img.file?.name || 'image').replace(/\.[^.]+$/, '');
  result = { blob, url: URL.createObjectURL(blob), name: `${base}-ai.mp4` };
  const v = $('#ai-video'); v.src = result.url;
  setView('video');
  v.play().catch(() => {});
  const a = $('#ai-dl'); a.href = result.url; a.download = result.name;
  a.textContent = `MP4 다운로드 (${(blob.size / 1048576).toFixed(1)}MB)`;
  $('#ai-result-box').hidden = false; $('#ai-result-box').open = true;
  $('#ai-result-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ───────── 왼쪽 미리보기 ─────────
let view = 'img';
function setView(vw) {
  view = vw;
  const hasImg = !!img.url, hasVid = !!result;
  if (view === 'video' && !hasVid) view = 'img';
  $('#ai-empty').hidden = hasImg || hasVid;
  $('#ai-img').hidden = !(hasImg && view === 'img');
  $('#ai-video').hidden = !(hasVid && view === 'video');
  if (view !== 'video') $('#ai-video').pause();
  $('#ai-view').hidden = !(hasImg && hasVid);
  $$('#ai-view button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
}

// ───────── 화면 연결 ─────────
export function initAi(h) {
  hooks = { ...hooks, ...h };
  // 모델 목록
  const sel = $('#ai-model');
  for (const m of AI_MODELS) sel.add(new Option(m.name, m.id));
  if (!AI_MODELS.some((m) => m.id === A.model)) sel.add(new Option(A.model, A.model));
  sel.add(new Option('직접 입력…', '__custom'));

  // 움직임 칩
  const chips = $('#ai-chips');
  for (const p of MOTION_PRESETS) {
    const b = document.createElement('button');
    b.textContent = p.name; b.title = p.en;
    b.onclick = () => {
      const ta = $('#ai-prompt');
      if (ta.value.includes(p.en)) ta.value = ta.value.replace(new RegExp(`,?\\s*${p.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '');
      else ta.value = ta.value.replace(/[.\s]*$/, '') + (/:\s*$/.test(ta.value) ? ' ' : ', ') + p.en + '.';
      ta.value = ta.value.replace(/:\s*,\s*/, ': ').replace(/,\s*\./, '.');
      A.prompt = ta.value; saveSet(); syncChips();
    };
    chips.appendChild(b);
  }
  const syncChips = () => $$('button', chips).forEach((b) => b.classList.toggle('on', A.prompt.includes(b.title)));
  $('#ai-reset-prompt').onclick = () => { A.prompt = DEF().prompt; $('#ai-prompt').value = A.prompt; saveSet(); syncChips(); };

  // 입력칸 ↔ 상태
  const bind = (id, key, ev = 'input', parse = (v) => v) => {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!A[key]; else el.value = A[key];
    el.addEventListener(ev, () => {
      A[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
      saveSet(); syncChips(); syncConn();
    });
  };
  bind('#ai-prompt', 'prompt');
  bind('#ai-neg', 'neg');
  bind('#ai-dur', 'dur', 'change', Number);
  bind('#ai-aspect', 'aspect', 'change');
  bind('#ai-res', 'res', 'change');
  bind('#ai-audio', 'audio', 'change');
  bind('#ai-seed', 'seed');
  bind('#ai-project', 'project');
  bind('#ai-location', 'location');
  bind('#ai-auth', 'auth', 'change');
  bind('#ai-base', 'base');
  bind('#ai-remember', 'remember', 'change');
  sel.value = A.model;
  sel.addEventListener('change', () => {
    if (sel.value === '__custom') {
      const id = (prompt('모델 이름 (예: veo-3.1-generate-001)', A.model) || '').trim();
      if (id) { if (![...sel.options].some((o) => o.value === id)) sel.add(new Option(id, id), sel.options.length - 1); A.model = id; }
      sel.value = A.model;
    } else A.model = sel.value;
    saveSet();
  });
  $('#ai-token').value = loadToken();
  $('#ai-token').addEventListener('input', syncConn);
  $('#ai-remember').addEventListener('change', () => storeToken($('#ai-token').value.trim()));
  $('#ai-forget').onclick = () => {
    try { sessionStorage.removeItem(TOK_KEY); localStorage.removeItem(TOK_KEY); } catch { /* 무시 */ }
    $('#ai-token').value = ''; syncConn(); hooks.toast('이 브라우저에서 토큰을 지웠어요.');
  };
  $('#ai-show').onclick = () => { const t = $('#ai-token'); t.type = t.type === 'password' ? 'text' : 'password'; };

  function syncConn() {
    const ok = !!$('#ai-token').value.trim() && (A.project.trim() || A.auth === 'key' || A.base.trim());
    $('#ai-conn-state').textContent = ok ? '연결 준비됨' : '설정 필요';
    $('#ai-conn-state').classList.toggle('ok', !!ok);
    $('#ai-token-label').firstChild.textContent = A.auth === 'key' ? 'API 키 ' : '액세스 토큰 ';
    $('#ai-auth-help').hidden = A.auth !== 'token';
    $('#ai-key-help').hidden = A.auth !== 'key';
  }
  syncChips(); syncConn(); syncAspectHint();
  if (!$('#ai-token').value) $('#ai-conn').open = true;

  // 그림 넣기
  const d = $('#ai-drop'), inp = $('input', d);
  d.addEventListener('click', (e) => { if (e.target !== inp) inp.click(); });
  d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  inp.addEventListener('change', () => { if (inp.files[0]) setAiImage(inp.files[0]); inp.value = ''; });

  $('#ai-go').onclick = generate;
  $$('#ai-view button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  setView('img');
  $('#ai-to-gif').onclick = () => {
    if (!result) return;
    hooks.useVideo(new File([result.blob], result.name, { type: result.blob.type }));
  };
}
