/**
 * Google 검색 페이지 콘텐츠 스크립트
 * 크롬 검색창과 직접 연동하여, 사용자의 검색어를 실시간으로 비틀고
 * 구글 검색 결과 상단 및 검색창 옆에 단계별 비틀린 검색 경로를 주입합니다.
 */

(function () {
  'use strict';

  // 중복 삽입 방지
  if (window.__serendipityDriftInjected) return;
  window.__serendipityDriftInjected = true;

  let currentQuery = '';
  let activeDriftData = null;

  // 구글 검색창의 현재 검색어 추출
  function extractSearchQuery() {
    // 1. URL 파라미터에서 추출
    const urlParams = new URLSearchParams(window.location.search);
    const qParam = urlParams.get('q');
    if (qParam && qParam.trim()) return qParam.trim();

    // 2. 검색 입력창에서 추출
    const searchInput = document.querySelector('input[name="q"], textarea[name="q"]');
    if (searchInput && searchInput.value && searchInput.value.trim()) {
      return searchInput.value.trim();
    }

    return '';
  }

  // 구글 홈 화면('google.com') 검색 버튼 영역에 '비틀어서 검색' 버튼 주입
  function injectHomeSearchButton() {
    const isSearchPage = window.location.pathname.startsWith('/search');
    if (isSearchPage) return;

    // 이미 주입되었으면 건너뜀
    if (document.getElementById('serendipity-home-btn')) return;

    // 구글 홈 검색 버튼 컨테이너 찾기
    const btnContainers = document.querySelectorAll('center input[name="btnK"], form input[name="btnK"]');
    if (!btnContainers || btnContainers.length === 0) return;

    const googleBtn = btnContainers[0];
    const parent = googleBtn.parentElement;
    if (!parent) return;

    const driftBtn = document.createElement('input');
    driftBtn.id = 'serendipity-home-btn';
    driftBtn.type = 'button';
    driftBtn.value = '🌐 Chrome AI 비틀어 검색';
    driftBtn.className = 'serendipity-google-btn';

    driftBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const input = document.querySelector('input[name="q"], textarea[name="q"]');
      const query = input ? input.value.trim() : '';
      if (!query) return;

      driftBtn.value = '🌀 Gemini Nano가 비트는 중...';
      driftBtn.disabled = true;

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'RUN_DRIFT',
          data: { query, directionId: 'category', fetchResults: false }
        });

        if (response && response.success && response.data?.queries?.length > 0) {
          // 4단계 중 2~3단계의 도약 검색어로 이동
          const pick = response.data.queries[1] || response.data.queries[0];
          window.location.href = `https://www.google.com/search?q=${encodeURIComponent(pick.query)}`;
        } else {
          // 폴백: 바로 원래 검색
          window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        }
      } catch (err) {
        console.warn('Drift failed:', err);
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
    });

    parent.appendChild(driftBtn);
  }

  // 구글 검색 결과 페이지('/search') 상단에 비틀린 궤적 바 주입
  function injectDriftBar(query) {
    if (!query) return;
    if (document.getElementById('serendipity-drift-bar')) {
      // 검색어가 바뀌었는지 확인
      if (currentQuery === query) return;
      document.getElementById('serendipity-drift-bar').remove();
    }

    currentQuery = query;

    // 검색 결과 삽입 타겟 컨테이너 찾기
    const target = document.getElementById('search') ||
                   document.getElementById('rcnt') ||
                   document.getElementById('center_col') ||
                   document.querySelector('[role="main"]');

    if (!target) return;

    // 구글 검색창 테마(다크모드/라이트모드) 자동 감지
    const isDark = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ||
                   document.documentElement.getAttribute('data-darkmode') === 'true' ||
                   document.body.classList.contains('dark') ||
                   (() => {
                     try {
                       const m = window.getComputedStyle(document.body).backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                       return m ? (m[1] * 0.299 + m[2] * 0.587 + m[3] * 0.114) < 128 : false;
                     } catch (_) { return false; }
                   })();

    const container = document.createElement('div');
    container.id = 'serendipity-drift-bar';
    container.className = `serendipity-drift-container${isDark ? ' serendipity-dark' : ''}`;
    container.innerHTML = `
      <div class="serendipity-drift-header">
        <div class="serendipity-title-group">
          <svg class="serendipity-chrome-icon" viewBox="0 0 48 48" width="22" height="22" fill="none">
            <path d="M24 4.5C15.8 4.5 8.7 9.4 5.5 16.5L16.2 35.1C18.4 36.6 21.1 37.5 24 37.5C31.5 37.5 37.5 31.5 37.5 24C37.5 23.3 37.4 22.7 37.3 22H24V4.5Z" fill="#ea4335"/>
            <path d="M43.5 24C43.5 18.5 41.3 13.5 37.8 9.9L24 33.8H12.3L22.9 43.1C23.3 43.1 23.6 43.2 24 43.2C34.8 43.2 43.5 34.5 43.5 24Z" fill="#fbbc04"/>
            <path d="M4.5 24C4.5 29.5 6.7 34.5 10.2 38.1L24 14.2H35.7L25.1 4.9C24.7 4.9 24.4 4.8 24 4.8C13.2 4.8 4.5 13.5 4.5 24Z" fill="#34a853"/>
            <circle cx="24" cy="24" r="9.5" fill="#ffffff"/>
            <circle cx="24" cy="24" r="7.5" fill="#1a73e8"/>
          </svg>
          <h3 class="serendipity-heading">비틀린 사유의 궤적</h3>
          <span class="serendipity-badge">Chrome AI</span>
        </div>
        <div class="serendipity-actions">
          <button id="serendipity-reroll-btn" class="serendipity-btn" title="다른 사유 벡터로 다시 비틀기">
            🎲 다른 각도
          </button>
          <button id="serendipity-sidepanel-btn" class="serendipity-btn serendipity-btn-primary" title="사이드패널에서 카드 스택 탐색">
            📖 카드 스택
          </button>
        </div>
      </div>
      <div id="serendipity-vector-indicator" class="serendipity-vector-tag">
        <span class="serendipity-spinner"></span> 사유의 벡터를 탐색하는 중...
      </div>
      <div id="serendipity-chips-container" class="serendipity-chips-row">
        <!-- 4단계 칩이 여기에 로드됩니다 -->
      </div>
    `;

    target.parentNode.insertBefore(container, target);

    // 이벤트 리스너 등록
    container.querySelector('#serendipity-reroll-btn').addEventListener('click', () => {
      loadDriftData(query, 'random', true);
    });

    container.querySelector('#serendipity-sidepanel-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
    });

    // 데이터 로드 (기본값: 관련 카테고리 내 변환)
    loadDriftData(query, 'category', false);
  }

  // 백그라운드 모델에 요청하여 비틀린 검색어 받아와 렌더링
  async function loadDriftData(query, directionId = 'category', forceReroll = false) {
    const vectorEl = document.getElementById('serendipity-vector-indicator');
    const chipsEl = document.getElementById('serendipity-chips-container');
    if (!vectorEl || !chipsEl) return;

    vectorEl.innerHTML = '<span class="serendipity-spinner"></span> 온디바이스 모델로 새로운 사유를 직조하는 중...';
    chipsEl.innerHTML = '';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RUN_DRIFT',
        data: { query, directionId, fetchResults: false }
      });

      if (!response || !response.success || !response.data) {
        throw new Error(response?.error || '비틀기 응답을 받지 못했습니다.');
      }

      const drift = response.data;
      activeDriftData = drift;

      // 벡터 표시
      const dir = drift.direction;
      vectorEl.innerHTML = `
        <span class="serendipity-vector-icon">${dir.icon || '🧭'}</span>
        <strong class="serendipity-vector-name">${dir.title}</strong>
        <span class="serendipity-vector-prompt">"${dir.prompt}"</span>
      `;

      // 4단계 칩 렌더링 (구글 페이지 내 검색창: 좁은 공간 최적화 - [동일 소분류] 등 앞단 태그 완전 제거)
      chipsEl.innerHTML = '';
      (drift.queries || []).forEach((item) => {
        const rank = item.rank || 1;
        const chip = document.createElement('div');
        chip.className = `serendipity-stage-chip chip-step-${rank}`;

        // 설명 및 검색어에서 [동일 소분류] 등 모든 대괄호 접두사 깔끔하게 제거
        const cleanQuery = (item.query || '')
          .replace(/^\[(?:동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류|[^\]]+)\]\s*/i, '')
          .trim();
        const cleanExp = (item.explanation || '')
          .replace(/^\[(?:동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류|[^\]]+)\]\s*/i, '')
          .trim();

        chip.title = `${item.stage}\n${cleanExp}\n(클릭하여 이 검색어로 구글 검색)`;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;

        chip.innerHTML = `
          <div class="serendipity-chip-meta">
            <span class="serendipity-stage-rank">${item.rank}단계 · ${item.distance} 이탈</span>
          </div>
          <div class="serendipity-chip-query">${escapeHtml(cleanQuery)}</div>
          <div class="serendipity-chip-exp">${escapeHtml(cleanExp)}</div>
          <a href="${searchUrl}" class="serendipity-chip-link">크롬 검색창으로 바로 가기 ↗</a>
        `;

        chip.addEventListener('click', (e) => {
          // 링크 클릭이 아니더라도 카드 전체 클릭 시 이동
          if (e.target.tagName !== 'A') {
            window.location.href = searchUrl;
          }
        });

        chipsEl.appendChild(chip);
      });

    } catch (err) {
      console.warn('Drift load error:', err);
      vectorEl.innerHTML = `<span class="serendipity-error">⚠️ 비틀기 중 오류 발생: ${escapeHtml(err.message)}</span>`;
    }
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 초기화 및 URL 변경 감지
  function init() {
    injectHomeSearchButton();

    const q = extractSearchQuery();
    if (q) {
      injectDriftBar(q);
    }
  }

  // 페이지 로드 시 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 구글 검색의 동적 페이지 전환(SPA 네비게이션) 감지
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(init, 300);
    }
  }).observe(document, { subtree: true, childList: true });

})();

