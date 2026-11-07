import { DRIFT_VECTORS, DEFAULT_VECTOR_ID, pickRandomVector } from './src/vectors.js';
import { nanoEngine } from './src/nano-engine.js';
import { escapeHtml, googleSearchUrl } from './src/utils.js';

let trailHistory = [];
/** 진행 중인 비틀기 요청 식별자 — 늦게 도착한 이전 응답이 화면을 덮어쓰지 않도록 */
let driftToken = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const queryInput = document.getElementById('query-input');
  const syncTabBtn = document.getElementById('sync-tab-btn');
  const vectorSelect = document.getElementById('vector-select');
  const randomVectorBtn = document.getElementById('random-vector-btn');
  const runDriftBtn = document.getElementById('run-drift-btn');
  const aiStatusPill = document.getElementById('ai-status-pill');
  const aiStatusText = aiStatusPill.querySelector('.status-text');
  const activeVectorBanner = document.getElementById('active-vector-banner');
  const dockLegendBar = document.getElementById('dock-legend-bar');
  const bannerVectorTitle = document.getElementById('banner-vector-title');
  const bannerVectorPrompt = document.getElementById('banner-vector-prompt');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  const cardStack = document.getElementById('card-stack');
  const historyTrail = document.getElementById('history-trail');
  const trailItems = document.getElementById('trail-items');
  const clearTrailBtn = document.getElementById('clear-trail-btn');
  const openFlagsGuide = document.getElementById('open-flags-guide');

  const myWindowId = (await chrome.windows.getCurrent()).id;

  // 1. 사유 벡터 옵션 채우기
  for (const d of DRIFT_VECTORS) {
    vectorSelect.appendChild(new Option(`${d.icon} ${d.title}`, d.id));
  }
  vectorSelect.appendChild(new Option('🎲 무작위 도약 (랜덤 벡터)', 'random'));
  vectorSelect.value = DEFAULT_VECTOR_ID;

  // 2. Gemini Nano 상태
  let modelStatus = 'unknown';

  function setPill(cls, text) {
    aiStatusPill.className = `status-pill ${cls}`;
    aiStatusText.textContent = text;
  }

  async function checkModelStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CHECK_AI_STATUS', fresh: true });
      modelStatus = res?.data?.status || 'error';
    } catch (_) {
      modelStatus = 'error';
    }

    if (modelStatus === 'ready') {
      setPill('status-ready', 'Gemini Nano 준비됨');
      aiStatusPill.title = 'Gemini Nano 온디바이스 모델 사용 중';
    } else if (modelStatus === 'downloading') {
      setPill('status-downloading', '모델 받기 (클릭)');
      aiStatusPill.title = '클릭하면 Gemini Nano 모델 다운로드를 시작합니다';
    } else {
      setPill('status-fallback', '내장 연상 모드');
      aiStatusPill.title = 'Prompt API를 사용할 수 없어 내장 연상 키워드로 동작합니다. 설정 가이드를 확인하세요.';
    }
  }

  checkModelStatus();
  aiStatusPill.style.cursor = 'pointer';

  // 상태 배지 클릭 → 모델 다운로드/활성화.
  // LanguageModel.create() 는 사용자 활성화가 필요하므로 이 페이지에서 직접 호출합니다.
  aiStatusPill.addEventListener('click', async () => {
    if (modelStatus === 'ready') return;
    if (modelStatus !== 'downloading') {
      chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
      return;
    }

    setPill('status-downloading', '모델 준비 중...');
    const res = await nanoEngine.activateModel((loaded, total) => {
      const ratio = total ? loaded / total : loaded; // 신형 API 는 0~1 비율을 보고
      aiStatusText.textContent = `모델 다운로드 ${Math.round(ratio * 100)}%`;
    });
    await chrome.runtime.sendMessage({ type: 'AI_STATUS_CHANGED' }).catch(() => {});
    if (!res.success) {
      aiStatusPill.title = `활성화 실패: ${res.error}`;
    }
    checkModelStatus();
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

    emptyState.style.display = 'none';
    cardStack.style.display = 'none';
    activeVectorBanner.style.display = 'none';
    if (dockLegendBar) dockLegendBar.style.display = 'none';
    loadingState.style.display = 'flex';
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

    loadingState.style.display = 'none';
    runDriftBtn.disabled = false;

    if (!response?.success || !response.data) {
      emptyState.style.display = 'flex';
      alert(`오류: ${response?.error || '비틀기 응답 실패'}`);
      return;
    }

    renderDriftResult(response.data);
    updateTrail(query);
  }

  // 7. 4단계 카드 스택 렌더링
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

    activeVectorBanner.style.display = 'block';
    if (dockLegendBar) dockLegendBar.style.display = 'flex';

    cardStack.replaceChildren();
    cardStack.style.display = 'flex';

    for (const item of drift.queries || []) {
      cardStack.appendChild(createCard(item));
    }
  }

  function createCard(item) {
    const rank = item.rank || 1;
    const card = document.createElement('article');
    card.className = `drift-card step-card step-${rank}`;

    card.innerHTML = `
      <div class="card-hero">
        <div class="card-step-badge-row">
          <span class="card-step-badge">${rank}단계 · ${escapeHtml(item.distance || `${rank * 25}%`)}</span>
          ${item.scope ? `<span class="card-scope-badge">${escapeHtml(item.scope)}</span>` : ''}
        </div>
        <h2 class="card-headline">${escapeHtml(item.query)}</h2>
        <p class="card-desc">${escapeHtml(item.explanation)}</p>
      </div>
      <div class="card-tray">
        <div class="card-actions icon-only-actions">
          <button class="btn-dock btn-dock-primary search-chrome-btn" title="크롬 검색창으로 검색" aria-label="크롬 검색창으로 검색">
            <span class="dock-icon">🔍</span>
          </button>
          <button class="btn-dock btn-dock-secondary branch-btn" title="이 조각으로 도약" aria-label="이 조각으로 도약">
            <span class="dock-icon">🌱</span>
          </button>
          <button class="btn-dock btn-dock-subtle deconstruct-btn" title="구절 분해" aria-label="구절 분해">
            <span class="dock-icon">✂️</span>
          </button>
        </div>
        <div class="phrase-drawer" style="display: none;"></div>
      </div>
    `;

    card.querySelector('.search-chrome-btn').addEventListener('click', () => {
      chrome.tabs.create({ url: googleSearchUrl(item.query) });
    });

    card.querySelector('.branch-btn').addEventListener('click', () => {
      queryInput.value = item.query;
      executeDrift(item.query, vectorSelect.value || DEFAULT_VECTOR_ID);
    });

    const phraseDrawer = card.querySelector('.phrase-drawer');
    let phraseToken = 0;

    card.querySelector('.deconstruct-btn').addEventListener('click', async () => {
      if (phraseDrawer.style.display === 'flex') {
        phraseDrawer.style.display = 'none';
        phraseToken++;
        return;
      }

      const token = ++phraseToken;
      phraseDrawer.style.display = 'flex';
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
          const pill = document.createElement('span');
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
      span.textContent = text;
      phraseDrawer.replaceChildren(span);
    }

    return card;
  }

  // 8. 탐색 궤적(Breadcrumb) — 패널이 열려 있는 동안만 메모리에 유지
  function updateTrail(query) {
    if (!trailHistory.includes(query)) trailHistory.push(query);
    renderTrail();
  }

  function renderTrail() {
    if (trailHistory.length <= 1) {
      historyTrail.style.display = 'none';
      return;
    }

    historyTrail.style.display = 'flex';
    trailItems.replaceChildren();

    trailHistory.forEach((q, idx) => {
      const node = document.createElement('span');
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
        arrow.textContent = '➔';
        trailItems.appendChild(arrow);
      }
    });
  }

  clearTrailBtn.addEventListener('click', (e) => {
    e.preventDefault();
    trailHistory = [];
    renderTrail();
  });

  // 9. 가이드 페이지
  openFlagsGuide.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
  });
});
