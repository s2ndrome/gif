// GIF 만들기: 프레임마다 그려서 색을 줄이고(quantize) gifenc로 묶습니다.
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const abortErr = () => new DOMException('취소됨', 'AbortError');

/** Floyd–Steinberg 디더링으로 팔레트 번호 배열 만들기 */
function ditherIndex(rgba, W, H, palette, strength = 1) {
  const n = W * H, out = new Uint8Array(n);
  const P = palette.length, pr = new Int16Array(P), pg = new Int16Array(P), pb = new Int16Array(P);
  palette.forEach((c, i) => { pr[i] = c[0]; pg[i] = c[1]; pb[i] = c[2]; });
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let k = cache[key];
    if (k >= 0) return k;
    let best = 0, bd = 1e9;
    for (let i = 0; i < P; i++) {
      const dr = r - pr[i], dg = g - pg[i], db = b - pb[i];
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (d < bd) { bd = d; best = i; }
    }
    cache[key] = best;
    return best;
  };
  // 현재 줄 / 다음 줄 오차
  let e0 = new Float32Array((W + 2) * 3), e1 = new Float32Array((W + 2) * 3);
  for (let y = 0; y < H; y++) {
    const rtl = y & 1; // 줄마다 방향을 바꿔 무늬를 줄임
    for (let s = 0; s < W; s++) {
      const x = rtl ? W - 1 - s : s;
      const p = y * W + x, i = p * 4, e = (x + 1) * 3;
      const r = Math.max(0, Math.min(255, rgba[i] + e0[e]));
      const g = Math.max(0, Math.min(255, rgba[i + 1] + e0[e + 1]));
      const b = Math.max(0, Math.min(255, rgba[i + 2] + e0[e + 2]));
      const k = nearest(r | 0, g | 0, b | 0);
      out[p] = k;
      const er = (r - pr[k]) * strength, eg = (g - pg[k]) * strength, eb = (b - pb[k]) * strength;
      const f = rtl ? -3 : 3;
      // 오른쪽(진행 방향) 7/16, 아래-뒤 3/16, 아래 5/16, 아래-앞 1/16
      e0[e + f] += er * 0.4375; e0[e + f + 1] += eg * 0.4375; e0[e + f + 2] += eb * 0.4375;
      e1[e - f] += er * 0.1875; e1[e - f + 1] += eg * 0.1875; e1[e - f + 2] += eb * 0.1875;
      e1[e] += er * 0.3125; e1[e + 1] += eg * 0.3125; e1[e + 2] += eb * 0.3125;
      e1[e + f] += er * 0.0625; e1[e + f + 1] += eg * 0.0625; e1[e + f + 2] += eb * 0.0625;
    }
    const t = e0; e0 = e1; e1 = t; e1.fill(0);
  }
  return out;
}

/**
 * @param o.W,o.H 크기
 * @param o.fps 초당 프레임
 * @param o.dur 길이(초)
 * @param o.prepare async (t) => void  해당 시각의 영상 프레임 준비(탐색)
 * @param o.draw (ctx, W, H, t) => void
 * @param o.colors 2~256
 * @param o.dither 0~1 (0이면 끔)
 * @param o.palette 'frame' | 'global'
 * @param o.loop 0 = 무한, -1 = 한 번, n = n번 더
 */
export async function exportGif(o) {
  const { W, H, fps, dur, prepare, draw, signal, onProgress = () => {} } = o;
  const colors = Math.max(2, Math.min(256, o.colors | 0 || 256));
  const N = Math.max(1, Math.round(dur * fps));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { willReadFrequently: true, alpha: false });
  const timeOf = (i) => Math.min(i / fps, Math.max(0, dur - 1e-3));

  const grab = async (i) => {
    if (signal?.aborted) throw abortErr();
    const t = timeOf(i);
    await prepare(t);
    draw(x, W, H, t);
    return x.getImageData(0, 0, W, H).data;
  };

  // 전체 공통 팔레트: 여러 프레임을 조금씩 모아 한 번만 색을 뽑음
  let global = null;
  if (o.palette === 'global') {
    const S = Math.min(N, 8), step = Math.max(1, Math.floor((W * H) / 60000));
    const per = Math.ceil((W * H) / step);
    const pool = new Uint8Array(per * S * 4);
    let n = 0;
    for (let k = 0; k < S; k++) {
      onProgress(0, `색 고르는 중… ${k + 1}/${S}`);
      const d = await grab(Math.floor((k * N) / S));
      for (let p = 0; p < W * H; p += step) { pool.set(d.subarray(p * 4, p * 4 + 4), n * 4); n++; }
    }
    global = quantize(pool.subarray(0, n * 4), colors, { format: 'rgb565' });
  }

  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (let i = 0; i < N; i++) {
    const d = await grab(i);
    const pal = global || quantize(d, colors, { format: 'rgb565' });
    const idx = o.dither > 0 ? ditherIndex(d, W, H, pal, o.dither) : applyPalette(d, pal, 'rgb565');
    gif.writeFrame(idx, W, H, { palette: global && i ? undefined : pal, delay, repeat: o.loop ?? 0, first: i === 0 });
    onProgress((i + 1) / N, `프레임 ${i + 1} / ${N}`);
    if (i % 4 === 3) await tick();
  }
  gif.finish();
  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  return { blob, frames: N };
}

/** 영상을 원하는 시각으로 옮기고 그 프레임이 준비될 때까지 기다리기 */
export function seekVideo(v, time) {
  return new Promise((res) => {
    const done = () => {
      if ('requestVideoFrameCallback' in v) {
        let fin = false;
        const ok = () => { if (!fin) { fin = true; res(); } };
        v.requestVideoFrameCallback(ok);
        setTimeout(ok, 40);
      } else res();
    };
    if (Math.abs(v.currentTime - time) < 1e-3 && v.readyState >= 2 && !v.seeking) return res();
    const on = () => { v.removeEventListener('seeked', on); done(); };
    v.addEventListener('seeked', on);
    v.currentTime = time;
  });
}
