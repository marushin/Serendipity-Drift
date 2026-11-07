/* ==========================================================================
   이미지 검색 (API 키 없음)
   Bing 이미지 검색 결과 HTML 을 받아 각 결과의 m="{...}" 메타데이터를 파싱합니다.
   Google 이미지는 JS 실행 없이는 결과를 주지 않으므로 사용하지 않습니다.
   서비스 워커에는 DOMParser 가 없으므로 정규식으로 처리합니다.
   ========================================================================== */

const BING_IMAGES_URL = 'https://www.bing.com/images/search';

/** HTML 속성값에 들어 있는 엔티티 디코딩 (m 속성에 필요한 범위만) */
export function decodeEntities(str) {
  return String(str ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function safeUrl(value, { allowHttp = false } = {}) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) return url.href;
  } catch (_) {}
  return null;
}

/** Bing 썸네일 URL 을 정사각형 스마트 크롭으로 요청 (2x2 그리드용) */
export function squareThumb(turl, size = 240) {
  try {
    const url = new URL(turl);
    if (!/\.mm\.bing\.net$|\.bing\.com$/.test(url.hostname)) return turl;
    url.searchParams.set('w', String(size));
    url.searchParams.set('h', String(size));
    url.searchParams.set('c', '7');
    return url.href;
  } catch (_) {
    return turl;
  }
}

/**
 * Bing 이미지 검색 HTML → [{ thumb, full, page, title }]
 * @param {string} html
 * @param {number} limit
 */
export function parseBingImages(html, limit = 4) {
  const out = [];
  const seen = new Set();
  // 실제 결과 타일(<a class="iusc" m="...">)만 대상으로 함 — 관련 검색 등 다른 모듈의 m 속성 배제
  const tagRe = /<a\b[^>]*\bclass="iusc"[^>]*>/g;
  let match;

  while ((match = tagRe.exec(html)) && out.length < limit) {
    const m = match[0].match(/\bm="(\{[^"]*\})"/);
    if (!m) continue;
    let meta;
    try {
      meta = JSON.parse(decodeEntities(m[1]));
    } catch (_) {
      continue;
    }

    const thumb = safeUrl(meta.turl);
    if (!thumb || seen.has(thumb)) continue;
    seen.add(thumb);

    out.push({
      thumb: squareThumb(thumb),
      // 원본 이미지는 http 이거나 핫링크 차단일 수 있음 → UI 에서 썸네일로 폴백
      full: safeUrl(meta.murl, { allowHttp: true }) || thumb,
      page: safeUrl(meta.purl, { allowHttp: true }),
      title: String(meta.t || '').replace(/[-]/g, '').trim()
    });
  }
  return out;
}

export function bingImagesUrl(query) {
  return `${BING_IMAGES_URL}?q=${encodeURIComponent(query)}&form=HDRSC2`;
}

/**
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} opts
 */
export async function fetchImages(query, { limit = 4, signal } = {}) {
  const res = await fetch(bingImagesUrl(query), { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`이미지 검색 실패 (HTTP ${res.status})`);
  return parseBingImages(await res.text(), limit);
}
