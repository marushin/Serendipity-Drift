/* ==========================================================================
   동영상 검색 (API 키 없음)
   YouTube 검색 결과 HTML 에 들어 있는 ytInitialData JSON 에서
   videoRenderer 항목을 뽑습니다. 서비스 워커에서 동작하도록 DOM 을 쓰지 않습니다.
   ========================================================================== */

const YT_RESULTS_URL = 'https://www.youtube.com/results';
const VIDEO_ID_RE = /^[\w-]{11}$/;

/** HTML 에서 ytInitialData 객체 추출 */
export function extractInitialData(html) {
  const m = String(html).match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
}

const textOf = (node) => node?.simpleText ?? (node?.runs || []).map((r) => r.text).join('') ?? '';

/**
 * ytInitialData → [{ id, thumb, page, title, channel, duration }]
 * 순서를 유지하며 깊이 우선으로 videoRenderer 를 수집합니다 (쇼츠·광고·채널은 제외).
 */
export function parseYouTubeResults(data, limit = 4) {
  const out = [];
  const seen = new Set();

  const walk = (node) => {
    if (out.length >= limit || !node || typeof node !== 'object') return;
    const v = node.videoRenderer;
    if (v && VIDEO_ID_RE.test(v.videoId || '') && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      const id = v.videoId;
      out.push({
        id,
        thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        page: `https://www.youtube.com/watch?v=${id}`,
        title: textOf(v.title).trim(),
        channel: textOf(v.ownerText).trim(),
        duration: textOf(v.lengthText).trim() // 라이브는 빈 문자열
      });
      return;
    }
    for (const key in node) {
      walk(node[key]);
      if (out.length >= limit) return;
    }
  };

  walk(data);
  return out;
}

export function youtubeResultsUrl(query) {
  return `${YT_RESULTS_URL}?search_query=${encodeURIComponent(query)}`;
}

/**
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} opts
 */
export async function fetchVideos(query, { limit = 4, signal } = {}) {
  const res = await fetch(youtubeResultsUrl(query), { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`동영상 검색 실패 (HTTP ${res.status})`);
  const data = extractInitialData(await res.text());
  if (!data) throw new Error('동영상 검색 결과를 해석하지 못했습니다.');
  return parseYouTubeResults(data, limit);
}
