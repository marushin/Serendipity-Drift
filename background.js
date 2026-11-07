import { nanoEngine } from './src/nano-engine.js';
import { searchFetcher } from './src/search-fetcher.js';
import { DRIFT_VECTORS, DEFAULT_VECTOR_ID, pickRandomVector, findVector } from './src/vectors.js';
import { storage } from './src/storage.js';

// 설치 시 초기화 및 사이드패널 동작 설정
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Serendipity Drift] Extension installed.');
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
  } catch (_) {}

  chrome.omnibox.setDefaultSuggestion({
    description: '🌐 Chrome AI 비틀린 검색: <match>%s</match> 의도에서 조금 벗어난 사유로 검색'
  });
});

/**
 * 1. 크롬 주소창 (Omnibox) 연동 최적화
 * - 디바운스를 500ms로 조정하여 연속 타이핑 시 불필요한 모델 세션 생성 방지
 * - 최근 검색어 메모리 캐시 및 최신 입력 토큰 검증으로 이전 응답 역전 현상 차단
 */
let omniboxDebounceTimer = null;
let currentOmniboxToken = 0;
const omniboxCache = new Map();

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const query = text.trim();
  if (!query || query.length < 2) return;

  // 캐시가 있으면 즉각 제안
  if (omniboxCache.has(query)) {
    suggest(omniboxCache.get(query));
    return;
  }

  clearTimeout(omniboxDebounceTimer);
  const thisToken = ++currentOmniboxToken;

  omniboxDebounceTimer = setTimeout(async () => {
    try {
      const direction = findVector(DEFAULT_VECTOR_ID);
      const driftResult = await nanoEngine.generateDriftQueries(query, direction);

      // 사용자가 이미 다음 글자를 타이핑했다면 오래된 결과 폐기
      if (thisToken !== currentOmniboxToken) return;

      const suggestions = (driftResult.queries || []).map((item) => ({
        content: item.query,
        description: `<dim>[${item.stage.split(':')[0]}]</dim> <match>${escapeXml(item.query)}</match> <dim>— ${escapeXml(item.explanation.slice(0, 35))}</dim>`
      }));

      omniboxCache.set(query, suggestions);
      suggest(suggestions);
    } catch (err) {
      console.warn('[Omnibox] Failed to generate suggestions:', err);
    }
  }, 500);
});

// 사용자가 주소창에서 추천 검색어를 선택하고 엔터를 쳤을 때: 크롬 자체 검색창으로 바로 이동!
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  if (disposition === 'currentTab') {
    chrome.tabs.update({ url: searchUrl });
  } else {
    chrome.tabs.create({ url: searchUrl });
  }
});

function escapeXml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 2. 탭 URL 변경 감지: 사용자가 구글 검색 시 사이드패널에 실시간 검색어 브로드캐스팅
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && (changeInfo.url.includes('google.com/search') || changeInfo.url.includes('google.co.kr/search'))) {
    try {
      const url = new URL(changeInfo.url);
      const q = url.searchParams.get('q');
      if (q) {
        chrome.runtime.sendMessage({
          type: 'TAB_SEARCH_UPDATED',
          query: q,
          tabId
        }).catch(() => {});
      }
    } catch (_) {}
  }
});

/**
 * 3. 메시지 통신 핸들러 (Content Script, SidePanel, Popup)
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CHECK_AI_STATUS') {
    nanoEngine.checkAvailability().then(status => {
      sendResponse(status);
    });
    return true;
  }

  if (request.type === 'WARMUP_MODEL') {
    nanoEngine.warmupModel()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'RUN_DRIFT') {
    handleRunDrift(request.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'SEARCH_QUERY') {
    searchFetcher.search(request.query, request.limit || 3)
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'DECONSTRUCT_PHRASES') {
    nanoEngine.deconstructSentenceToPhrases(request.sentence, request.query)
      .then(phrases => sendResponse({ success: true, phrases }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'OPEN_SIDEPANEL') {
    if (chrome.sidePanel && chrome.sidePanel.open && sender.tab) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(console.warn);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Side panel API not available' });
    }
    return true;
  }

  if (request.type === 'REDIRECT_SEARCH') {
    const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(request.query)}`;
    if (sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { url: targetUrl });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
    sendResponse({ success: true });
    return true;
  }
});

/**
 * AI 비틀기 및 선택적 백그라운드 프리뷰 파이프라인
 */
async function handleRunDrift({ query, directionId, fetchResults = false }) {
  if (!query || !query.trim()) {
    throw new Error('검색어가 비어있습니다.');
  }

  const direction = directionId === 'random'
    ? pickRandomVector()
    : findVector(directionId || DEFAULT_VECTOR_ID);

  // 1. Chrome Gemini Nano로 4단계 비틀린 검색어 생성
  const driftResult = await nanoEngine.generateDriftQueries(query.trim(), direction);

  // 2. 필요 시 클라이언트 측에서 검색 결과 프리뷰 미리 가져오기
  if (fetchResults && driftResult.queries && driftResult.queries.length > 0) {
    const searchPromises = driftResult.queries.map(async (stageItem) => {
      const searchData = await searchFetcher.search(stageItem.query, 2);
      return {
        ...stageItem,
        searchResults: searchData
      };
    });
    driftResult.queries = await Promise.all(searchPromises);
  }

  // 3. 탐색 기록 저장
  await storage.addHistoryEntry({
    originalQuery: query.trim(),
    direction,
    queries: driftResult.queries,
    source: driftResult.source
  });

  return driftResult;
}
