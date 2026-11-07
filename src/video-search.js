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

/** 쇼츠 접근성 문구 "제목, 조회수 12회 - Shorts 동영상 재생" → "제목" */
function shortsTitle(s) {
  const primary = s.overlayMetadata?.primaryText?.content;
  if (primary) return primary.trim();
  return String(s.accessibilityText || '').replace(/,\s*[^,]*-\s*Shorts[^,]*$/i, '').trim();
}

/**
 * ytInitialData → [{ id, thumb, page, title, channel, duration, isShort }]
 * 일반 영상(videoRenderer)을 순서대로 먼저 채우고, 모자라면 쇼츠(shortsLockupViewModel)로 채웁니다.
 * 낯선 키워드일수록 YouTube 가 쇼츠만 돌려주는 경우가 많기 때문입니다.
 */
export function parseYouTubeResults(data, limit = 4) {
  const videos = [];
  const shorts = [];
  const seen = new Set();

  const take = (id) => {
    if (!VIDEO_ID_RE.test(id || '') || seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  const walk = (node) => {
    if (videos.length >= limit || !node || typeof node !== 'object') return;

    const v = node.videoRenderer;
    if (v) {
      if (take(v.videoId)) {
        videos.push({
          id: v.videoId,
          thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          page: `https://www.youtube.com/watch?v=${v.videoId}`,
          title: textOf(v.title).trim(),
          channel: textOf(v.ownerText).trim(),
          duration: textOf(v.lengthText).trim(), // 라이브는 빈 문자열
          isShort: false
        });
      }
      return;
    }

    const s = node.shortsLockupViewModel;
    if (s) {
      const id = s.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (shorts.length < limit && take(id)) {
        shorts.push({
          id,
          thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, // 16:9 중앙 크롭
          page: `https://www.youtube.com/shorts/${id}`,
          title: shortsTitle(s),
          channel: '',
          duration: '',
          isShort: true
        });
      }
      return;
    }

    for (const key in node) {
      walk(node[key]);
      if (videos.length >= limit) return;
    }
  };

  walk(data);
  return videos.concat(shorts).slice(0, limit);
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
