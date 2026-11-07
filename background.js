import { nanoEngine } from './src/nano-engine.js';
import { DEFAULT_VECTOR_ID, pickRandomVector, findVector } from './src/vectors.js';
import { storage } from './src/storage.js';
import { LruCache } from './src/lru-cache.js';
import { googleSearchUrl } from './src/utils.js';
import { fetchImages } from './src/image-search.js';
import { fetchVideos } from './src/video-search.js';

/* ------------------------------------------------------------------ */
/* 0. 엔진 호스트 선택                                                   */
/*    Prompt API 가 서비스 워커에 노출되면 직접 사용하고, 그렇지 않으면     */
/*    오프스크린 문서(window 컨텍스트)에서 실행합니다.                      */
/* ------------------------------------------------------------------ */

const ENGINE_IN_WORKER = nanoEngine.isApiExposed();
const OFFSCREEN_URL = 'offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER'],
        justification: 'Chrome 내장 Prompt API(Gemini Nano)는 문서 컨텍스트에서만 노출되는 경우가 있어 숨은 문서에서 실행합니다.'
      })
      .finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function callEngine(method, ...args) {
  if (ENGINE_IN_WORKER) {
    return nanoEngine[method](...args);
  }
  await ensureOffscreenDocument();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ENGINE_CALL', method, args });
  if (!res || !res.ok) throw new Error(res?.error || '엔진 호스트가 응답하지 않습니다.');
  return res.value;
}

/* ------------------------------------------------------------------ */
/* 1. 설치/업데이트                                                     */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

  chrome.omnibox.setDefaultSuggestion({
    description: '🌐 Chrome AI 비틀린 검색: <match>%s</match> 의도에서 조금 벗어난 사유로 검색'
  });

  try {
    const removed = await storage.removeLegacyData();
    if (removed > 0) console.info(`[Serendipity Drift] 구버전 캐시/기록 ${removed}개를 정리했습니다.`);
  } catch (err) {
    console.warn('[Serendipity Drift] Legacy cleanup failed:', err);
  }
});

/* ------------------------------------------------------------------ */
/* 2. 비틀기 파이프라인 + 결과 캐시                                       */
/*    - Gemini Nano 결과만 캐시합니다 (폴백 결과는 모델이 준비되면 바뀌어야 함). */
/*    - 크기 제한이 있는 LRU 이므로 메모리가 무한히 늘지 않습니다.           */
/* ------------------------------------------------------------------ */

const driftCache = new LruCache(60);
const cacheKey = (directionId, query) => `${directionId}\u0000${query}`;

/**
 * @param {{ query: string, directionId?: string, fresh?: boolean }} params
 *   fresh: true 면 캐시를 건너뛰고 새로 생성합니다 (다시 비틀기 등).
 */
async function runDrift({ query, directionId, fresh = false }) {
  const q = (query || '').trim();
  if (!q) throw new Error('검색어가 비어있습니다.');

  const direction = directionId === 'random'
    ? pickRandomVector()
    : findVector(directionId || DEFAULT_VECTOR_ID);

  const key = cacheKey(direction.id, q);
  if (!fresh && driftCache.has(key)) return driftCache.get(key);

  const result = await callEngine('generateDriftQueries', q, direction);
  if (result.source === 'gemini-nano') driftCache.set(key, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* 2-1. 미디어 검색 (API 키 없음) + 캐시                                  */
/*      image: Bing 이미지 HTML / video: YouTube 검색 HTML               */
/*      같은 검색어의 동시 요청은 하나의 Promise 를 공유합니다.            */
/* ------------------------------------------------------------------ */

const MEDIA_FETCHERS = { image: fetchImages, video: fetchVideos };
const mediaCache = new LruCache(200);
const mediaInflight = new Map();

async function getMedia(kind, query, limit = 4) {
  const fetcher = MEDIA_FETCHERS[kind];
  if (!fetcher) throw new Error(`알 수 없는 미디어 종류: ${kind}`);
  const q = (query || '').trim();
  if (!q) throw new Error('검색어가 비어있습니다.');
  const key = `${kind}\u0000${limit}\u0000${q}`;
  if (mediaCache.has(key)) return mediaCache.get(key);
  if (mediaInflight.has(key)) return mediaInflight.get(key);

  const p = fetcher(q, { limit, signal: AbortSignal.timeout(12000) })
    .then((items) => {
      if (items.length) mediaCache.set(key, items);
      return items;
    })
    .finally(() => mediaInflight.delete(key));
  mediaInflight.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ */
/* 3. 크롬 주소창 (Omnibox)                                           */
/* ------------------------------------------------------------------ */

let omniboxDebounceTimer = null;
let currentOmniboxToken = 0;

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSuggestions(drift) {
  const tag = drift.source === 'gemini-nano' ? '' : '<dim>(내장 연상)</dim> ';
  return (drift.queries || []).map((item) => ({
    content: item.query,
    description: `${tag}<dim>[${escapeXml(item.stage.split(':')[0])}]</dim> <match>${escapeXml(item.query)}</match> <dim>— ${escapeXml(item.explanation.slice(0, 35))}</dim>`
  }));
}

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const query = text.trim();
  clearTimeout(omniboxDebounceTimer);
  const thisToken = ++currentOmniboxToken;
  if (query.length < 2) return;

  const cached = driftCache.get(cacheKey(DEFAULT_VECTOR_ID, query));
  if (cached) {
    suggest(toSuggestions(cached));
    return;
  }

  omniboxDebounceTimer = setTimeout(async () => {
    try {
      const drift = await runDrift({ query, directionId: DEFAULT_VECTOR_ID });
      // 사용자가 이미 다음 글자를 타이핑했다면 오래된 결과 폐기
      if (thisToken !== currentOmniboxToken) return;
      suggest(toSuggestions(drift));
    } catch (err) {
      console.warn('[Omnibox] Failed to generate suggestions:', err);
    }
  }, 500);
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const url = googleSearchUrl(text);
  if (disposition === 'currentTab') {
    chrome.tabs.update({ url });
  } else {
    chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  }
});

/* ------------------------------------------------------------------ */
/* 4. 구글 검색 탭의 검색어 변경을 사이드패널로 전달                        */
/*    사이드패널은 windowId 와 active 로 자기 창의 활성 탭인지 판단합니다.   */
/* ------------------------------------------------------------------ */

const GOOGLE_SEARCH_RE = /^https:\/\/www\.google\.(?:com|co\.kr)\/search\?/;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !GOOGLE_SEARCH_RE.test(changeInfo.url)) return;
  try {
    const q = new URL(changeInfo.url).searchParams.get('q');
    if (!q) return;
    chrome.runtime.sendMessage({
      type: 'TAB_SEARCH_UPDATED',
      query: q,
      tabId,
      windowId: tab.windowId,
      active: tab.active
    }).catch(() => {}); // 사이드패널이 닫혀 있으면 수신자가 없음
  } catch (_) {}
});

/* ------------------------------------------------------------------ */
/* 5. 메시지 핸들러 (Content Script, SidePanel, Popup)                  */
/* ------------------------------------------------------------------ */

const respond = (promise, sendResponse) => {
  promise
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
  return true;
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 오프스크린 문서로 가는 메시지는 처리하지 않음
  if (!request || request.target === 'offscreen') return false;

  switch (request.type) {
    case 'CHECK_AI_STATUS':
      return respond(callEngine('checkAvailability', { fresh: !!request.fresh }), sendResponse);

    case 'AI_STATUS_CHANGED':
      // 팝업/사이드패널에서 모델을 활성화한 뒤 호출 → 캐시된 가용성 무효화
      return respond(callEngine('invalidateAvailability'), sendResponse);

    case 'RUN_DRIFT':
      return respond(runDrift(request.data || {}), sendResponse);

    case 'IS_SIDEPANEL_OPEN':
      // 콘텐츠 스크립트가 자기 창에 사이드패널이 열려 있는지 확인 (열려 있으면 인라인 미디어 위젯 생략)
      return respond(
        chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
          .then((ctx) => ctx.some((c) => c.windowId === sender.tab?.windowId)),
        sendResponse
      );

    case 'FETCH_MEDIA':
      return respond(getMedia(request.kind, request.query, request.limit), sendResponse);

    case 'DECONSTRUCT_PHRASES':
      return respond(callEngine('deconstructSentenceToPhrases', request.sentence), sendResponse);

    case 'OPEN_SIDEPANEL':
      // sidePanel.open 은 사용자 제스처 안에서 호출되어야 하므로 await 없이 즉시 호출
      if (chrome.sidePanel?.open && sender.tab) {
        return respond(chrome.sidePanel.open({ windowId: sender.tab.windowId }), sendResponse);
      }
      sendResponse({ success: false, error: 'Side panel API not available' });
      return false;

    default:
      return false;
  }
});
