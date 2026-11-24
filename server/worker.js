// SEOL GIF · AI 영상 중계 서버 (Cloudflare Worker)
//
// 페이지(GitHub Pages)는 공개라서 토큰을 넣을 수 없어요.
// 이 서버가 토큰을 비밀(Secret)로 갖고 있다가, 페이지 대신 Google Vertex AI(Veo)를 불러요.
//
// 설정 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets)
//   VERTEX_API_KEY  (Secret) Vertex AI API 키. promm의 AI 채팅 Worker(cloudflare/*-worker.js)에 넣은 것과 같은 키.
//                            그 Worker들처럼 aiplatform.googleapis.com 에 x-goog-api-key 헤더로 보냄.
//   GCP_SA_KEY      (Secret) 또는 서비스 계정 키 JSON 전체. 있으면 이쪽을 먼저 씀 (API 키로 Veo가 안 될 때 대안)
//   ACCESS_CODE     (Secret) 접속 코드. 정해두면 이 코드를 아는 사람만 영상을 만들 수 있어요. (강력 추천: 영상 만들 때마다 요금이 나와요)
//   GCP_PROJECT     (Text)   프로젝트 ID. 비우면 서비스 계정 키 안의 project_id를 씀
//   GCP_LOCATION    (Text)   지역. 기본 us-central1
//   ALLOWED_ORIGINS (Text)   이 페이지 주소만 허용. 예) https://s2ndrome.github.io   (쉼표로 여러 개, * = 모두)
//   ALLOWED_MODELS  (Text)   쓸 수 있는 모델. 기본 veo-3.1-fast-generate-001,veo-3.1-generate-001
//
// 주소
//   GET  /health                     → 설정이 맞는지 확인 (토큰 내용은 안 보여줌)
//   POST /generate?model=<모델>      → 본문을 그대로 Vertex predictLongRunning 으로 전달
//   POST /status?model=<모델>        → {"operationName": "..."} → Vertex fetchPredictOperation

const DEFAULT_MODELS = 'veo-3.1-fast-generate-001,veo-3.1-generate-001';
const MAX_BODY = 25 * 1024 * 1024;

let tokenCache = { token: '', exp: 0, keyId: '' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = originAllowed(origin, env);
    const cors = corsHeaders(allowed ? origin : '');

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (origin && !allowed) return json({ error: { code: 'ORIGIN', origin, message: `이 페이지 주소(${origin})가 서버의 ALLOWED_ORIGINS에 없어요. Cloudflare에서 ALLOWED_ORIGINS를 ${origin} 로 바꿔주세요.` } }, 403, corsHeaders(origin));

    try {
      if ((url.pathname === '/health' || url.pathname === '/') && request.method === 'GET') {
        const auth = env.GCP_SA_KEY ? 'service-account' : env.VERTEX_API_KEY ? 'api-key' : 'none';
        // (키 값 자체는 절대 돌려주지 않음)
        return json({
          ok: auth !== 'none',
          auth,
          needsCode: !!env.ACCESS_CODE,
          project: projectId(env) ? 'set' : 'missing',
          location: location(env),
          models: models(env),
        }, 200, cors);
      }

      if (request.method !== 'POST' || !['/generate', '/status'].includes(url.pathname)) {
        return json({ error: { message: '없는 주소예요.' } }, 404, cors);
      }

      if (env.ACCESS_CODE && !safeEqual(request.headers.get('X-Access-Code') || '', env.ACCESS_CODE)) {
        return json({ error: { code: 'ACCESS_CODE', message: '접속 코드가 틀렸어요.' } }, 401, cors);
      }

      const model = url.searchParams.get('model') || models(env)[0];
      if (!models(env).includes(model)) return json({ error: { message: `이 서버에서 쓸 수 없는 모델이에요: ${model}` } }, 400, cors);

      const len = +(request.headers.get('Content-Length') || 0);
      if (len > MAX_BODY) return json({ error: { message: '그림이 너무 커요.' } }, 413, cors);

      const project = projectId(env);
      if (!project && env.GCP_SA_KEY) return json({ error: { message: '서버에 GCP_PROJECT가 없어요.' } }, 500, cors);

      let body = request.body;
      if (url.pathname === '/status') {
        // 작업 번호가 이 프로젝트 · 모델 것인지 확인
        const j = await request.json().catch(() => ({}));
        const op = String(j.operationName || '');
        if (!new RegExp(`(^|/)publishers/google/models/${escapeRe(model)}/operations/[^/]+$`).test(op) || (project && env.GCP_SA_KEY && !op.startsWith(`projects/${project}/`))) {
          return json({ error: { message: '작업 번호가 올바르지 않아요.' } }, 400, cors);
        }
        body = JSON.stringify({ operationName: op });
      }

      const method = url.pathname === '/generate' ? 'predictLongRunning' : 'fetchPredictOperation';
      const headers = { 'Content-Type': 'application/json' };
      let target = vertexUrl(env, project, model, method);
      if (env.GCP_SA_KEY) headers.Authorization = `Bearer ${await accessToken(env)}`;
      else if (env.VERTEX_API_KEY) headers['x-goog-api-key'] = env.VERTEX_API_KEY;
      else return json({ error: { message: '서버에 GCP_SA_KEY(또는 VERTEX_API_KEY)가 설정되지 않았어요.' } }, 500, cors);

      const r = await fetch(target, { method: 'POST', headers, body });
      // 결과(영상 base64)가 크니까 읽지 않고 그대로 흘려보냄
      const out = new Headers(cors);
      out.set('Content-Type', r.headers.get('Content-Type') || 'application/json');
      if ((r.status === 401 || r.status === 403) && !env.GCP_SA_KEY) {
        // API 키로 Veo가 막힐 때: 원인을 알기 쉽게
        const t = await r.text();
        let msg = t.slice(0, 400);
        try { msg = JSON.parse(t).error.message || msg; } catch { /* 무시 */ }
        return json({ error: { code: 'VERTEX_AUTH', message: `Google이 API 키 요청을 거절했어요 (${r.status}): ${msg}\n이 키로 Veo(영상)를 쓸 수 없다면 서버에 GCP_SA_KEY(서비스 계정 키)를 넣어주세요.` } }, r.status, cors);
      }
      return new Response(r.body, { status: r.status, headers: out });
    } catch (e) {
      return json({ error: { message: `서버 오류: ${e && e.message ? e.message : e}` } }, 500, cors);
    }
  },
};

// ───────── 도우미 ─────────
function models(env) { return String(env.ALLOWED_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean); }
function location(env) { return String(env.GCP_LOCATION || 'us-central1').trim(); }
function projectId(env) {
  if (env.GCP_PROJECT) return String(env.GCP_PROJECT).trim();
  try { return env.GCP_SA_KEY ? JSON.parse(env.GCP_SA_KEY).project_id || '' : ''; } catch { return ''; }
}
function vertexUrl(env, project, model, method) {
  const loc = location(env);
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  if (!project) return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${method}`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${loc}/publishers/google/models/${model}:${method}`;
}
function originAllowed(origin, env) {
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { if (s === '*') return s; try { return new URL(s.includes('://') ? s : `https://${s}`).origin; } catch { return s.replace(/\/+$/, ''); } });
  if (!origin) return true; // 브라우저가 아닌 요청(curl 등) — 접속 코드로 막음
  if (!list.length || list.includes('*')) return true;
  return list.includes(origin);
}
function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

/** 서비스 계정 키로 Google OAuth 액세스 토큰 받기 (만료 5분 전까지 재사용) */
async function accessToken(env) {
  const sa = JSON.parse(env.GCP_SA_KEY);
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.keyId === sa.private_key_id && tokenCache.exp - 300 > now) return tokenCache.token;
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud, iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${b64url(sig)}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google 토큰 발급 실패: ${j.error_description || j.error || r.status}`);
  tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600), keyId: sa.private_key_id };
  return j.access_token;
}
