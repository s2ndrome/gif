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

## 1. Google Cloud: 서버용 키 만들기

`gcloud auth print-access-token` 으로 받는 토큰은 1시간이면 만료돼서 서버에 넣어둘 수 없어요.
대신 **서비스 계정 키(JSON)** 를 넣으면, 서버가 1시간짜리 토큰을 알아서 계속 새로 받아요.

1. [Google Cloud 콘솔](https://console.cloud.google.com/) → 프로젝트 선택
2. **API 및 서비스 → 라이브러리** → `Vertex AI API` → 사용 설정
3. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기**
   - 이름: `seol-gif-ai`
   - 역할: **Vertex AI 사용자** (`roles/aiplatform.user`)
4. 만든 서비스 계정 → **키 → 키 추가 → 새 키 만들기 → JSON** → 파일이 내려받아져요
   - 이 파일이 "토큰" 역할을 해요. **저장소에 올리거나 채팅에 붙여넣지 마세요.**

> 이미 **Vertex AI API 키**를 갖고 있다면 서비스 계정 대신 그걸 써도 돼요 (아래 `VERTEX_API_KEY`). 키 종류에 따라 Veo가 안 될 수도 있어서 서비스 계정 키를 추천해요.

## 2. Cloudflare: 서버 올리기 (대시보드에서, 5분)

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) 가입 / 로그인
2. **Workers & Pages → Create → Create Worker** → 이름 `seol-gif-ai` → Deploy
3. **Edit code** → 원래 코드를 지우고 이 폴더의 [`worker.js`](worker.js) 내용을 전부 붙여넣기 → **Deploy**
4. **Settings → Variables and Secrets → Add** 로 아래를 넣기

| 이름 | 종류 | 값 |
|---|---|---|
| `GCP_SA_KEY` | **Secret** | 1번에서 받은 JSON 파일 내용 **전체** (`{` 부터 `}` 까지) |
| `ACCESS_CODE` | **Secret** | 내가 정한 접속 코드 (예: 아무 긴 문장) |
| `ALLOWED_ORIGINS` | Text | `https://s2ndrome.github.io` |
| `GCP_LOCATION` | Text | (선택) 기본 `us-central1` |
| `GCP_PROJECT` | Text | (선택) 비우면 키 안의 프로젝트를 씀 |
| `ALLOWED_MODELS` | Text | (선택) 기본 `veo-3.1-fast-generate-001,veo-3.1-generate-001` |
| `VERTEX_API_KEY` | Secret | (선택) `GCP_SA_KEY` 대신 API 키를 쓸 때만 |

5. 저장하면 서버 주소가 나와요: `https://seol-gif-ai.<내이름>.workers.dev`
6. 확인: 브라우저로 `https://seol-gif-ai.<내이름>.workers.dev/health` 를 열어서 `"ok":true` 가 보이면 성공

### (터미널이 편하면) wrangler로 올리기

```bash
cd server
npx wrangler login
npx wrangler deploy
npx wrangler secret put GCP_SA_KEY < ~/Downloads/내-서비스계정-키.json
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

- 토큰(서비스 계정 키)은 Cloudflare Secret에만 있어요. `/health` 도 토큰 내용은 보여주지 않아요.
- `ALLOWED_ORIGINS` 는 다른 사이트가 브라우저에서 이 서버를 쓰는 걸 막아요. 다만 curl 같은 프로그램은 Origin을 꾸밀 수 있어서, **진짜 잠금은 `ACCESS_CODE`** 예요.
- 쓸 수 있는 모델은 `ALLOWED_MODELS` 로만 제한돼요.
- 키가 새어 나간 것 같으면 Google Cloud에서 그 키를 **삭제**하고 새 키를 만들어 `GCP_SA_KEY` 를 바꾸면 돼요.
- 요금이 걱정되면 Google Cloud **결제 → 예산 및 알림**에서 예산 알림을 걸어두세요.
