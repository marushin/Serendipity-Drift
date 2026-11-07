import { DRIFT_VECTORS, DEFAULT_VECTOR_ID, pickRandomVector } from './src/vectors.js';
import { nanoEngine } from './src/nano-engine.js';
import { escapeHtml, googleSearchUrl } from './src/utils.js';

let trailHistory = [];
/** 진행 중인 비틀기 요청 식별자 — 늦게 도착한 이전 응답이 화면을 덮어쓰지 않도록 */
let driftToken = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const queryInput = $('query-input');
  const syncTabBtn = $('sync-tab-btn');
  const vectorSelect = $('vector-select');
  const randomVectorBtn = $('random-vector-btn');
  const runDriftBtn = $('run-drift-btn');
  const aiStatusPill = $('ai-status-pill');
  const aiStatusText = aiStatusPill.querySelector('.status-text');
  const activeVectorBanner = $('active-vector-banner');
  const dockLegendBar = $('dock-legend-bar');
  const bannerVectorTitle = $('banner-vector-title');
  const bannerVectorPrompt = $('banner-vector-prompt');
  const loadingState = $('loading-state');
  const loadingMessage = $('loading-message');
  const emptyState = $('empty-state');
  const errorState = $('error-state');
  const errorMessage = $('error-message');
  const cardStack = $('card-stack');
  const historyTrail = $('history-trail');
  const trailItems = $('trail-items');
  const clearTrailBtn = $('clear-trail-btn');
  const openFlagsGuide = $('open-flags-guide');

  const myWindowId = (await chrome.windows.getCurrent()).id;

  /** 화면 상태 전환: 'empty' | 'loading' | 'result' | 'error' */
  function showView(view) {
    emptyState.hidden = view !== 'empty';
    loadingState.hidden = view !== 'loading';
    errorState.hidden = view !== 'error';
    cardStack.hidden = view !== 'result';
    activeVectorBanner.hidden = view !== 'result';
    dockLegendBar.hidden = view !== 'result';
  }

  // 1. 사유 벡터 옵션
  for (const d of DRIFT_VECTORS) {
    vectorSelect.appendChild(new Option(`${d.icon} ${d.title}`, d.id));
  }
  vectorSelect.appendChild(new Option('🎲 무작위 도약 (랜덤 벡터)', 'random'));
  vectorSelect.value = DEFAULT_VECTOR_ID;

  // 2. Gemini Nano 상태
  let modelStatus = 'unknown';

  function setPill(cls, text, title) {
    aiStatusPill.className = `status-pill ${cls}`;
    aiStatusText.textContent = text;
    aiStatusPill.title = title;
    aiStatusPill.setAttribute('aria-label', `${text}. ${title}`);
  }

  async function checkModelStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CHECK_AI_STATUS', fresh: true });
      modelStatus = res?.data?.status || 'error';
    } catch (_) {
      modelStatus = 'error';
    }

    if (modelStatus === 'ready') {
      setPill('status-ready', 'Gemini Nano 준비됨', 'Gemini Nano 온디바이스 모델 사용 중');
    } else if (modelStatus === 'downloading') {
      setPill('status-downloading', '모델 받기', '클릭하면 Gemini Nano 모델 다운로드를 시작합니다');
    } else {
      setPill('status-fallback', '내장 연상 모드', 'Prompt API를 사용할 수 없어 내장 연상 키워드로 동작합니다. 클릭하면 설정 가이드를 엽니다.');
    }
  }

  checkModelStatus();

  // 상태 배지 클릭 → 모델 다운로드 (사용자 활성화가 필요하므로 이 페이지에서 직접 호출)
  aiStatusPill.addEventListener('click', async () => {
    if (modelStatus === 'ready' || modelStatus === 'activating') return;
    if (modelStatus !== 'downloading') {
      openGuide();
      return;
    }

    modelStatus = 'activating';
    setPill('status-downloading', '모델 준비 중...', 'Gemini Nano 모델을 내려받고 있습니다');
    const res = await nanoEngine.activateModel((loaded, total) => {
      const ratio = total ? loaded / total : loaded; // 신형 API 는 0~1 비율
      aiStatusText.textContent = `다운로드 ${Math.round(ratio * 100)}%`;
    });
    await chrome.runtime.sendMessage({ type: 'AI_STATUS_CHANGED' }).catch(() => {});
    await checkModelStatus();
    if (!res.success) {
      aiStatusPill.title = `활성화 실패: ${res.error}`;
    }
  });

  // 3. 현재 창의 활성 탭 검색어 동기화
  async function syncActiveTabQuery() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: myWindowId });
      if (!tab?.url) return false;
      const url = new URL(tab.url);
      const isGoogle = url.hostname === 'www.google.com' || url.hostname === 'www.google.co.kr';
      const q = url.searchParams.get('q');
      if (isGoogle && q && q !== queryInput.value) {
        queryInput.value = q;
        return true;
      }
    } catch (e) {
      console.warn('Tab query failed:', e);
    }
    return false;
  }

  syncTabBtn.addEventListener('click', async () => {
    if (await syncActiveTabQuery()) queryInput.focus();
  });

  syncActiveTabQuery();

  // 4. 같은 창의 활성 탭에서 검색했을 때만 입력값 동기화
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'TAB_SEARCH_UPDATED' || !msg.query) return;
    if (msg.windowId !== myWindowId || !msg.active) return;
    if (queryInput.value !== msg.query) queryInput.value = msg.query;
  });

  // 5. 벡터 셔플
  randomVectorBtn.addEventListener('click', () => {
    vectorSelect.value = pickRandomVector().id;
  });

  // 6. 비틀기 실행
  runDriftBtn.addEventListener('click', () => {
    const query = queryInput.value.trim();
    if (!query) {
      queryInput.focus();
      return;
    }
    executeDrift(query, vectorSelect.value, { fresh: true });
  });

  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) runDriftBtn.click();
  });

  async function executeDrift(query, vectorId, { fresh = false } = {}) {
    const token = ++driftToken;

    loadingMessage.textContent = modelStatus === 'ready'
      ? 'Gemini Nano가 사유의 틈새를 직조하는 중...'
      : '내장 연상 키워드로 궤적을 엮는 중...';
    showView('loading');
    runDriftBtn.disabled = true;

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'RUN_DRIFT',
        data: { query, directionId: vectorId, fresh }
      });
    } catch (err) {
      response = { success: false, error: err.message };
    }

    // 더 최근 요청이 있으면 이 응답은 무시 (로딩 상태도 최신 요청이 정리)
    if (token !== driftToken) return;

    runDriftBtn.disabled = false;

    if (!response?.success || !response.data) {
      errorMessage.textContent = response?.error || '응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.';
      showView('error');
      return;
    }

    renderDriftResult(response.data);
    showView('result');
    updateTrail(query);
  }

  // 7. 4단계 카드 스택
  function renderDriftResult(drift) {
    const dir = drift.direction;
    bannerVectorTitle.textContent = `${dir.icon || '🧭'} ${dir.title}`;
    bannerVectorPrompt.textContent = `"${dir.prompt}"`;

    activeVectorBanner.querySelector('.fallback-note')?.remove();
    if (drift.source !== 'gemini-nano') {
      const note = document.createElement('p');
      note.className = 'fallback-note';
      note.textContent = '⚠️ Gemini Nano를 사용할 수 없어 내장 연상 키워드로 대신한 결과입니다. 상단 상태 배지를 눌러 모델을 활성화하세요.';
      activeVectorBanner.appendChild(note);
    }

    cardStack.replaceChildren(...(drift.queries || []).map(createCard));
  }

  function createCard(item) {
    const rank = item.rank || 1;
    const card = document.createElement('article');
    card.className = `drift-card step-${rank}`;

    card.innerHTML = `
      <div class="card-step-badge-row">
        <span class="card-step-badge">${rank}단계 · ${escapeHtml(item.distance || `${rank * 25}%`)}</span>
        ${item.scope ? `<span class="card-scope-badge">${escapeHtml(item.scope)}</span>` : ''}
      </div>
      <h2 class="card-headline">${escapeHtml(item.query)}</h2>
      <p class="card-desc">${escapeHtml(item.explanation)}</p>
      <div class="card-actions-bar">
        <button type="button" class="btn-dock btn-dock-primary search-chrome-btn" title="크롬 검색창으로 검색" aria-label="'${escapeHtml(item.query)}' 구글에서 검색">
          <span class="dock-icon" aria-hidden="true">🔍</span>
        </button>
        <button type="button" class="btn-dock branch-btn" title="이 조각으로 도약" aria-label="'${escapeHtml(item.query)}'(으)로 도약">
          <span class="dock-icon" aria-hidden="true">🌱</span>
        </button>
        <button type="button" class="btn-dock deconstruct-btn" title="구절 분해" aria-label="설명 구절 분해" aria-expanded="false">
          <span class="dock-icon" aria-hidden="true">✂️</span>
        </button>
      </div>
      <div class="phrase-drawer" hidden></div>
    `;

    card.querySelector('.search-chrome-btn').addEventListener('click', () => {
      chrome.tabs.create({ url: googleSearchUrl(item.query) });
    });

    card.querySelector('.branch-btn').addEventListener('click', () => {
      queryInput.value = item.query;
      executeDrift(item.query, vectorSelect.value || DEFAULT_VECTOR_ID);
    });

    const deconstructBtn = card.querySelector('.deconstruct-btn');
    const phraseDrawer = card.querySelector('.phrase-drawer');
    let phraseToken = 0;

    const setDrawerOpen = (open) => {
      phraseDrawer.hidden = !open;
      deconstructBtn.setAttribute('aria-expanded', String(open));
    };

    deconstructBtn.addEventListener('click', async () => {
      if (!phraseDrawer.hidden) {
        setDrawerOpen(false);
        phraseToken++;
        return;
      }

      const token = ++phraseToken;
      setDrawerOpen(true);
      setPhraseMessage('✂️ 문장을 조각내는 중...');

      try {
        const res = await chrome.runtime.sendMessage({ type: 'DECONSTRUCT_PHRASES', sentence: item.explanation });
        if (token !== phraseToken) return;

        const phrases = res?.success ? res.data : [];
        if (!phrases?.length) {
          setPhraseMessage('분해할 구절을 찾지 못했습니다.');
          return;
        }
        phraseDrawer.replaceChildren(...phrases.map((phrase) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'phrase-pill';
          pill.textContent = phrase;
          pill.title = `"${phrase}"(으)로 사유 도약하기`;
          pill.addEventListener('click', () => {
            queryInput.value = phrase;
            executeDrift(phrase, vectorSelect.value || DEFAULT_VECTOR_ID);
          });
          return pill;
        }));
      } catch (_) {
        if (token === phraseToken) setPhraseMessage('구절 분해 중 오류가 발생했습니다.');
      }
    });

    function setPhraseMessage(text) {
      const span = document.createElement('span');
      span.className = 'phrase-loading';
      span.setAttribute('role', 'status');
      span.textContent = text;
      phraseDrawer.replaceChildren(span);
    }

    return card;
  }

  // 8. 탐색 궤적 — 패널이 열려 있는 동안만 메모리에 유지
  function updateTrail(query) {
    if (!trailHistory.includes(query)) trailHistory.push(query);
    renderTrail();
  }

  function renderTrail() {
    historyTrail.hidden = trailHistory.length <= 1;
    if (historyTrail.hidden) return;

    trailItems.replaceChildren();
    trailHistory.forEach((q, idx) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'trail-node';
      node.textContent = q;
      node.title = `이 사유 지점으로 돌아가기: ${q}`;
      node.addEventListener('click', () => {
        queryInput.value = q;
        executeDrift(q, vectorSelect.value);
      });
      trailItems.appendChild(node);

      if (idx < trailHistory.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'trail-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '➔';
        trailItems.appendChild(arrow);
      }
    });
  }

  clearTrailBtn.addEventListener('click', () => {
    trailHistory = [];
    renderTrail();
  });

  // 9. 가이드 페이지
  function openGuide() {
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
  }
  openFlagsGuide.addEventListener('click', openGuide);
});
