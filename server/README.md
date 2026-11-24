# SEOL GIF · AI 영상 서버

GitHub Pages는 누구나 코드를 볼 수 있어서 **토큰을 페이지에 넣을 수 없어요.**
그래서 토큰은 이 작은 서버(Cloudflare Worker)에 **비밀(Secret)** 로만 넣고, 페이지는 서버 주소만 알게 해요.

```
SEOL GIF 페이지 ──(그림 · 프롬프트 · 접속 코드)──▶ 이 서버 ──(토큰)──▶ Google Vertex AI (Veo)
```

- 서버는 Cloudflare 무료 플랜으로 충분해요. 따로 켜둘 컴퓨터가 필요 없어요.
- 토큰은 Cloudflare에 암호화된 Secret으로 저장돼서 페이지 · 저장소 · 방문자 브라우저 어디에도 안 보여요.
- **접속 코드**를 정해두면 코드를 아는 사람만 영상을 만들 수 있어요. (영상 만들 때마다 Google Cloud 요금이 나오니 꼭 정해두세요)

---

## 1. 키 준비 — promm AI 채팅에 쓰던 그 키 그대로

promm의 AI 채팅 Worker(`cloudflare/outfit-chat-worker.js` 등)와 **똑같은 방식**이에요.
그 Worker에 넣은 `VERTEX_API_KEY`(Vertex AI API 키)를 이 서버에도 똑같이 넣으면 돼요.
부르는 주소(`aiplatform.googleapis.com/v1/publishers/google/models/…`)와 키를 보내는 방법(`x-goog-api-key` 헤더)도 같아요.

- Cloudflare Secret은 넣은 뒤엔 대시보드에서 값을 다시 볼 수 없어요.
  키 값은 **Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보**에서 그 API 키를 열어 "키 표시"로 복사하세요.
  (못 찾으면 거기서 새 키를 만들어도 돼요.)
- 키를 채팅이나 저장소에 붙여넣지 마세요. Cloudflare Secret 칸에만 넣으세요.

> **만약 영상 만들 때** "Google이 API 키 요청을 거절했어요"가 뜨면, 그 키로는 Veo(영상)를 못 쓰는 거예요.
> 그땐 [서비스 계정 키](#서비스-계정-키로-바꾸기)를 대신 넣으면 돼요.

## 2. Cloudflare: 서버 올리기 (promm 채팅 Worker 만들 때와 같은 순서)

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) → **Workers & Pages → Create → Create Worker** → 이름 `seol-gif-ai` → Deploy
2. **Edit code** → 원래 코드를 지우고 이 폴더의 [`worker.js`](worker.js) 내용을 전부 붙여넣기 → **Deploy**
3. **Settings → Variables and Secrets → Add**

| 이름 | 종류 | 값 |
|---|---|---|
| `VERTEX_API_KEY` | **Secret** | promm 채팅 Worker에 넣은 것과 같은 Vertex AI API 키 |
| `ALLOWED_ORIGINS` | Text | GIF 페이지 주소. 예) `https://s2ndrome.github.io` (여러 개면 쉼표로) |
| `ACCESS_CODE` | **Secret** | (추천) 접속 코드. 정해두면 코드를 아는 사람만 영상을 만들 수 있어요 |
| `ALLOWED_MODELS` | Text | (선택) 기본 `veo-3.1-fast-generate-001,veo-3.1-generate-001` |
| `GCP_PROJECT` | Text | **필수 (Veo)** API 키를 만든 Google Cloud 프로젝트 ID. 없으면 Google이 `400 Invalid resource field value` 로 거절해요 |

4. 서버 주소가 나와요: `https://seol-gif-ai.<내이름>.workers.dev`
5. 확인: 브라우저로 `…workers.dev/health` 를 열어 `"ok":true,"auth":"api-key"` 가 보이면 성공

### 서비스 계정 키로 바꾸기

API 키로 Veo가 막힐 때만 하면 돼요.

1. Google Cloud 콘솔 → **IAM 및 관리자 → 서비스 계정 → 만들기** (역할: **Vertex AI 사용자**)
2. 그 계정 → **키 → 키 추가 → JSON** → 파일 받기
3. Worker에 `GCP_SA_KEY`(Secret)로 JSON 파일 내용 **전체**를 넣기. (`GCP_SA_KEY`가 있으면 `VERTEX_API_KEY`보다 먼저 써요)
   `GCP_LOCATION`(Text, 기본 `us-central1`)으로 지역을 바꿀 수 있어요.

### (터미널이 편하면) wrangler로 올리기

```bash
cd server
npx wrangler login
npx wrangler deploy
npx wrangler secret put VERTEX_API_KEY     # 붙여넣기
npx wrangler secret put ACCESS_CODE
```
`ALLOWED_ORIGINS` 등 Text 값은 [`wrangler.toml`](wrangler.toml)의 `[vars]`에서 바꿔요.

## 3. 페이지에 서버 주소 연결

둘 중 하나:

- **모두가 바로 쓰게:** [`js/config.js`](../js/config.js) 의 `AI_SERVER` 에 서버 주소를 넣고 커밋
  ```js
  export const AI_SERVER = 'https://seol-gif-ai.<내이름>.workers.dev';
  ```
  (주소는 비밀이 아니에요. 토큰은 서버에만 있어요.)
- **나만:** 페이지의 AI 영상 탭 → AI 서버 → 서버 주소에 붙여넣기

접속 코드는 처음 한 번만 넣으면 그 브라우저에 기억돼요.

## 보안 메모

- 키(`VERTEX_API_KEY` / `GCP_SA_KEY`)는 Cloudflare Secret에만 있어요. `/health` 도 토큰 내용은 보여주지 않아요.
- `ALLOWED_ORIGINS` 는 다른 사이트가 브라우저에서 이 서버를 쓰는 걸 막아요. 다만 curl 같은 프로그램은 Origin을 꾸밀 수 있어서, **진짜 잠금은 `ACCESS_CODE`** 예요.
- 쓸 수 있는 모델은 `ALLOWED_MODELS` 로만 제한돼요.
- 키가 새어 나간 것 같으면 Google Cloud에서 그 키를 **삭제**하고 새 키를 만들어 Secret을 바꾸면 돼요. (같은 키를 쓰는 promm Worker들도 같이 바꿔야 해요)
- 요금이 걱정되면 Google Cloud **결제 → 예산 및 알림**에서 예산 알림을 걸어두세요.
