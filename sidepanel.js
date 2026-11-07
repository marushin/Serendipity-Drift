import { DRIFT_VECTORS, DEFAULT_VECTOR_ID, pickRandomVector, findVector } from './src/vectors.js';

let trailHistory = [];

document.addEventListener('DOMContentLoaded', async () => {
  const queryInput = document.getElementById('query-input');
  const syncTabBtn = document.getElementById('sync-tab-btn');
  const vectorSelect = document.getElementById('vector-select');
  const randomVectorBtn = document.getElementById('random-vector-btn');
  const runDriftBtn = document.getElementById('run-drift-btn');
  const aiStatusPill = document.getElementById('ai-status-pill');
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

  // 1. 기본 카테고리 변환 및 20개 사유 벡터 옵션 채우기 (기본값: 'category')
  DRIFT_VECTORS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.icon} ${d.title}`;
    vectorSelect.appendChild(opt);
  });

  const randomOpt = document.createElement('option');
  randomOpt.value = 'random';
  randomOpt.textContent = '🎲 무작위 도약 (랜덤 벡터)';
  vectorSelect.appendChild(randomOpt);

  vectorSelect.value = DEFAULT_VECTOR_ID;

  // 2. Chrome Gemini Nano 모델 상태 확인
  checkModelStatus();

  async function checkModelStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'CHECK_AI_STATUS' });
      aiStatusPill.className = 'status-pill';

      if (status.status === 'ready') {
        aiStatusPill.classList.add('status-ready');
        aiStatusPill.querySelector('.status-text').textContent = 'Gemini Nano 준비됨';
      } else if (status.status === 'downloading') {
        aiStatusPill.classList.add('status-downloading');
        aiStatusPill.querySelector('.status-text').textContent = '모델 활성화 (클릭)';
      } else {
        aiStatusPill.classList.add('status-fallback');
        aiStatusPill.querySelector('.status-text').textContent = '내장 연상 모드';
      }
    } catch (_) {
      aiStatusPill.className = 'status-pill status-fallback';
      aiStatusPill.querySelector('.status-text').textContent = '내장 연상 모드';
    }
  }

  // 상태 배지 클릭 시 모델 즉시 활성화(Warmup) 시도
  aiStatusPill.style.cursor = 'pointer';
  aiStatusPill.addEventListener('click', async () => {
    aiStatusPill.querySelector('.status-text').textContent = '모델 활성화 중...';
    const res = await chrome.runtime.sendMessage({ type: 'WARMUP_MODEL' });
    if (res && res.success) {
      aiStatusPill.className = 'status-pill status-ready';
      aiStatusPill.querySelector('.status-text').textContent = 'Gemini Nano 준비됨';
    } else {
      checkModelStatus();
    }
  });

  // 3. 현재 활성 탭의 검색어 자동 감지 함수
  async function syncActiveTabQuery() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        if ((url.hostname.includes('google.com') || url.hostname.includes('google.co.kr')) && url.searchParams.has('q')) {
          const q = url.searchParams.get('q');
          if (q && q !== queryInput.value) {
            queryInput.value = q;
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('Tab query failed:', e);
    }
    return false;
  }

  syncTabBtn.addEventListener('click', async () => {
    const synced = await syncActiveTabQuery();
    if (synced) queryInput.focus();
  });

  // 초기 탭 검색어 동기화 시도
  syncActiveTabQuery();

  // 4. 실시간 탭 검색어 변경 메시지 수신 (구글 탭에서 검색 시 자동 동기화)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TAB_SEARCH_UPDATED' && msg.query) {
      if (queryInput.value !== msg.query) {
        queryInput.value = msg.query;
      }
    }
  });

  // 5. 사유 벡터 랜덤 셔플
  randomVectorBtn.addEventListener('click', () => {
    const random = pickRandomVector();
    vectorSelect.value = random.id;
  });

  // 6. 비틀기 실행 핸들러
  runDriftBtn.addEventListener('click', () => {
    const query = queryInput.value.trim();
    if (!query) {
      queryInput.focus();
      return;
    }
    executeDrift(query, vectorSelect.value);
  });

  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runDriftBtn.click();
    }
  });

  async function executeDrift(query, vectorId) {
    emptyState.style.display = 'none';
    cardStack.style.display = 'none';
    activeVectorBanner.style.display = 'none';
    if (dockLegendBar) dockLegendBar.style.display = 'none';
    loadingState.style.display = 'flex';
    runDriftBtn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RUN_DRIFT',
        data: { query, directionId: vectorId, fetchResults: false }
      });

      if (!response || !response.success || !response.data) {
        throw new Error(response?.error || '비틀기 응답 실패');
      }

      const drift = response.data;
      renderDriftResult(drift);

      // 궤적(Breadcrumbs) 업데이트
      updateTrail(query);
    } catch (err) {
      alert(`오류: ${err.message}`);
      emptyState.style.display = 'flex';
    } finally {
      loadingState.style.display = 'none';
      runDriftBtn.disabled = false;
    }
  }

  // 7. Chrome 공식 웹사이트 스타일 4단계 카드 스택 렌더링
  function renderDriftResult(drift) {
    const dir = drift.direction;
    bannerVectorTitle.textContent = `${dir.icon || '🧭'} ${dir.title}`;
    bannerVectorPrompt.textContent = `"${dir.prompt}"`;
    activeVectorBanner.style.display = 'block';
    if (dockLegendBar) dockLegendBar.style.display = 'flex';

    cardStack.innerHTML = '';
    cardStack.style.display = 'flex';

    (drift.queries || []).forEach((item) => {
      const rank = item.rank || 1;
      const card = document.createElement('article');
      card.className = `drift-card step-card step-${rank}`;

      const defaultScopes = ['동일 소분류', '인접 중분류', '교차 대분류', '사유의 끝점'];
      const scopeTag = item.scope || (defaultScopes[rank - 1] || '');

      const cleanQuery = (item.query || '')
        .replace(/^\[(?:동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류|[^\]]+)\]\s*/i, '')
        .trim();
      const cleanExp = (item.explanation || '')
        .replace(/^\[(?:동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류|[^\]]+)\]\s*/i, '')
        .trim();

      card.innerHTML = `
        <!-- 상단 히어로 영역 (크롬 공식 사이트 컬러 블록) -->
        <div class="card-hero">
          <div class="card-step-badge-row">
            <span class="card-step-badge">${rank}단계 · ${item.distance || (rank * 25 + '%')}</span>
            ${scopeTag ? `<span class="card-scope-badge">${escapeHtml(scopeTag)}</span>` : ''}
          </div>
          <h2 class="card-headline">${escapeHtml(cleanQuery)}</h2>
          <p class="card-desc">${escapeHtml(cleanExp)}</p>
        </div>

        <!-- 하단 트레이 영역 (트레이 직접 배치) -->
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

      // '크롬으로 검색' 버튼 클릭 시: 새 탭에서 구글 검색창으로 이동
      const openChromeSearch = () => {
        chrome.tabs.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`
        });
      };

      card.querySelector('.search-chrome-btn').addEventListener('click', openChromeSearch);

      // '이 조각으로 도약' 클릭 시: 현재 선택된 사유 벡터를 유지하며 다시 비틀기
      card.querySelector('.branch-btn').addEventListener('click', () => {
        queryInput.value = cleanQuery;
        executeDrift(cleanQuery, vectorSelect.value || DEFAULT_VECTOR_ID);
      });

      // '구절 분해' 클릭 시: 문장을 더 잘게 쪼개어 세부 씨앗 생성 (art-hackathon 분해 기능)
      const deconstructBtn = card.querySelector('.deconstruct-btn');
      const phraseDrawer = card.querySelector('.phrase-drawer');

      deconstructBtn.addEventListener('click', async () => {
        if (phraseDrawer.style.display === 'flex') {
          phraseDrawer.style.display = 'none';
          return;
        }

        phraseDrawer.style.display = 'flex';
        phraseDrawer.innerHTML = '<span class="phrase-loading">✂️ 문장을 조각내는 중...</span>';

        try {
          const res = await chrome.runtime.sendMessage({
            type: 'DECONSTRUCT_PHRASES',
            sentence: cleanExp,
            query: cleanQuery
          });

          if (res && res.success && res.phrases?.length > 0) {
            phraseDrawer.innerHTML = '';
            res.phrases.forEach((phrase) => {
              const pill = document.createElement('span');
              pill.className = 'phrase-pill';
              pill.textContent = phrase;
              pill.title = `"${phrase}"(으)로 사유 도약하기`;
              pill.addEventListener('click', () => {
                queryInput.value = phrase;
                executeDrift(phrase, vectorSelect.value || DEFAULT_VECTOR_ID);
              });
              phraseDrawer.appendChild(pill);
            });
          } else {
            phraseDrawer.innerHTML = '<span class="phrase-loading">분해할 구절을 찾지 못했습니다.</span>';
          }
        } catch (_) {
          phraseDrawer.innerHTML = '<span class="phrase-loading">구절 분해 중 오류가 발생했습니다.</span>';
        }
      });

      cardStack.appendChild(card);
    });
  }

  // 8. 탐색 궤적(Breadcrumb) 관리
  function updateTrail(query) {
    if (!trailHistory.includes(query)) {
      trailHistory.push(query);
    }
    renderTrail();
  }

  function renderTrail() {
    if (trailHistory.length <= 1) {
      historyTrail.style.display = 'none';
      return;
    }

    historyTrail.style.display = 'flex';
    trailItems.innerHTML = '';

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

  // 9. Gemini Nano 가이드 페이지 열기
  openFlagsGuide.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
  });

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
});
