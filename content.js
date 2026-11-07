/**
 * Google 검색 페이지 콘텐츠 스크립트
 * - 홈 화면: '비틀어 검색' 버튼 주입
 * - 웹 검색 결과 페이지: 상단에 4단계 비틀린 검색어 바 주입
 *
 * 콘텐츠 스크립트는 ES 모듈을 import 할 수 없으므로 필요한 상수를 직접 둡니다.
 */

(function () {
  'use strict';

  if (window.__serendipityDriftInjected) return;
  window.__serendipityDriftInjected = true;

  // src/storage.js 의 SETTINGS_KEY / DEFAULT_SETTINGS 와 동일하게 유지
  const SETTINGS_KEY = 'serendipity_drift_settings';
  const DEFAULT_AUTO_RUN = true;

  const BAR_ID = 'serendipity-drift-bar';
  const HOME_BTN_ID = 'serendipity-home-btn';

  let currentQuery = '';
  /** 진행 중인 요청 식별자. 응답 도착 시 최신 요청이 아니면 버립니다. */
  let requestToken = 0;

  const googleSearchUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  /** 간단한 DOM 생성 헬퍼 (텍스트는 항상 textContent 로 넣어 XSS 를 원천 차단) */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child != null) node.append(child);
    }
    return node;
  }

  async function getAutoRun() {
    try {
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      const autoRun = data?.[SETTINGS_KEY]?.autoRun;
      return typeof autoRun === 'boolean' ? autoRun : DEFAULT_AUTO_RUN;
    } catch (_) {
      return DEFAULT_AUTO_RUN;
    }
  }

  /**
   * 검색 결과 페이지 종류: 'web' | 'image' | 'video' | null(뉴스·쇼핑 등 그 밖의 탭)
   */
  function pageKind() {
    if (!location.pathname.startsWith('/search')) return null;
    const params = new URLSearchParams(location.search);
    const tbm = params.get('tbm');
    const udm = params.get('udm');
    if (udm === '2' || tbm === 'isch') return 'image';
    if (udm === '7' || tbm === 'vid') return 'video';
    if (!tbm && (!udm || udm === '14')) return 'web';
    return null;
  }

  const UDM = { image: '2', video: '7' };

  /** 같은 탭 종류로 검색 (사용자가 쓰던 구글 도메인 유지) */
  function tabSearchUrl(q, kind) {
    const base = `${location.origin}/search?q=${encodeURIComponent(q)}`;
    return UDM[kind] ? `${base}&udm=${UDM[kind]}` : base;
  }

  async function isSidePanelOpen() {
    try {
      const res = await sendMessage({ type: 'IS_SIDEPANEL_OPEN' });
      return !!(res?.success && res.data);
    } catch (_) {
      return false;
    }
  }

  function extractSearchQuery() {
    const q = new URLSearchParams(location.search).get('q');
    if (q && q.trim()) return q.trim();
    const input = document.querySelector('input[name="q"], textarea[name="q"]');
    return input?.value?.trim() || '';
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  /* -------------------------------------------------------------- */
  /* 홈 화면 버튼                                                     */
  /* -------------------------------------------------------------- */

  function injectHomeSearchButton() {
    if (location.pathname.startsWith('/search')) return;
    if (document.getElementById(HOME_BTN_ID)) return;

    const googleBtn = document.querySelector('center input[name="btnK"], form input[name="btnK"]');
    const parent = googleBtn?.parentElement;
    if (!parent) return;

    const driftBtn = el('input', {
      id: HOME_BTN_ID,
      type: 'button',
      value: '🌐 Chrome AI 비틀어 검색',
      className: `serendipity-google-btn${detectDarkTheme() ? ' serendipity-dark' : ''}`
    });

    driftBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const input = document.querySelector('input[name="q"], textarea[name="q"]');
      const query = input ? input.value.trim() : '';
      if (!query) return;

      driftBtn.value = '🌀 Gemini Nano가 비트는 중...';
      driftBtn.disabled = true;

      let target = query;
      try {
        const res = await sendMessage({ type: 'RUN_DRIFT', data: { query, directionId: 'category' } });
        const picked = res?.success && (res.data.queries[1] || res.data.queries[0]);
        if (picked) target = picked.query;
      } catch (err) {
        console.warn('[Serendipity Drift] Drift failed:', err);
      }
      location.href = googleSearchUrl(target);
    });

    parent.appendChild(driftBtn);
  }

  /* -------------------------------------------------------------- */
  /* 검색 결과 상단 바                                                 */
  /* -------------------------------------------------------------- */

  /**
   * Google 페이지 자체의 테마를 판정합니다.
   * OS 가 다크여도 Google 을 라이트 테마로 쓰는 사용자가 있으므로
   * 페이지의 명시적 표시 → 실제 배경색 → OS 설정 순서로 확인합니다.
   */
  function detectDarkTheme() {
    const attr = document.documentElement.getAttribute('data-darkmode');
    if (attr === 'true') return true;
    if (attr === 'false') return false;

    for (const node of [document.body, document.documentElement]) {
      if (!node) continue;
      try {
        const m = getComputedStyle(node).backgroundColor
          .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) continue;
        const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (alpha === 0) continue; // 투명 배경은 판단 근거가 아님
        return (m[1] * 0.299 + m[2] * 0.587 + m[3] * 0.114) < 128;
      } catch (_) {}
    }

    return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  }

  // 정적 마크업(외부 데이터 없음)
  const CHROME_ICON_SVG = `
    <svg class="serendipity-chrome-icon" viewBox="0 0 48 48" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M24 4.5C15.8 4.5 8.7 9.4 5.5 16.5L16.2 35.1C18.4 36.6 21.1 37.5 24 37.5C31.5 37.5 37.5 31.5 37.5 24C37.5 23.3 37.4 22.7 37.3 22H24V4.5Z" fill="#ea4335"/>
      <path d="M43.5 24C43.5 18.5 41.3 13.5 37.8 9.9L24 33.8H12.3L22.9 43.1C23.3 43.1 23.6 43.2 24 43.2C34.8 43.2 43.5 34.5 43.5 24Z" fill="#fbbc04"/>
      <path d="M4.5 24C4.5 29.5 6.7 34.5 10.2 38.1L24 14.2H35.7L25.1 4.9C24.7 4.9 24.4 4.8 24 4.8C13.2 4.8 4.5 13.5 4.5 24Z" fill="#34a853"/>
      <circle cx="24" cy="24" r="9.5" fill="#ffffff"/>
      <circle cx="24" cy="24" r="7.5" fill="#1a73e8"/>
    </svg>`;

  function removeDriftBar() {
    document.getElementById(BAR_ID)?.remove();
    currentQuery = '';
    requestToken++; // 진행 중인 응답 무효화
  }

  async function injectDriftBar(query, kind = 'web') {
    if (!query) return;
    const key = `${kind}\u0000${query}`;
    const existing = document.getElementById(BAR_ID);
    if (existing && currentQuery === key) return;
    existing?.remove();

    const target = document.getElementById('search') ||
                   document.getElementById('rcnt') ||
                   document.getElementById('center_col') ||
                   document.querySelector('[role="main"]');
    if (!target?.parentNode) return;

    currentQuery = key;
    const isMedia = kind !== 'web';

    const titleGroup = el('div', { className: 'serendipity-title-group' });
    titleGroup.innerHTML = CHROME_ICON_SVG;
    titleGroup.append(
      el('h3', { className: 'serendipity-heading', text: '비틀린 사유의 궤적' }),
      el('span', { className: 'serendipity-badge', text: 'Chrome AI' })
    );

    const indicator = el('div', { className: 'serendipity-vector-tag', 'aria-live': 'polite' });
    const chips = el('div', { className: isMedia ? 'serendipity-media-row' : 'serendipity-chips-row' });

    const bar = el('div', {
      id: BAR_ID,
      className: `serendipity-drift-container${isMedia ? ' serendipity-is-media' : ''}${detectDarkTheme() ? ' serendipity-dark' : ''}`
    }, [
      el('div', { className: 'serendipity-drift-header' }, [
        titleGroup,
        el('div', { className: 'serendipity-actions' }, [
          el('button', {
            type: 'button',
            className: 'serendipity-btn',
            title: '다른 사유 벡터로 다시 비틀기',
            text: '🎲 다른 각도',
            onClick: () => loadDriftData(bar, query, 'random', true)
          }),
          el('button', {
            type: 'button',
            className: 'serendipity-btn serendipity-btn-primary',
            title: '사이드패널에서 카드 스택 탐색',
            text: '📖 카드 스택',
            onClick: () => sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {})
          })
        ])
      ]),
      indicator,
      chips
    ]);
    bar._refs = { indicator, chips, kind };

    target.parentNode.insertBefore(bar, target);

    if (await getAutoRun()) {
      loadDriftData(bar, query, 'category', false);
    } else {
      showIdle(bar, query);
    }
  }

  /** 자동 실행이 꺼져 있을 때: 사용자가 직접 실행하도록 버튼 표시 */
  function showIdle(bar, query) {
    const { indicator, chips } = bar._refs;
    chips.replaceChildren();
    indicator.replaceChildren(
      el('span', { text: '이 검색어를 비틀어 낯선 검색어 4개를 만들어 볼까요?' }),
      el('button', {
        type: 'button',
        className: 'serendipity-btn serendipity-btn-primary serendipity-run-btn',
        text: '⚡ 비틀기',
        onClick: () => loadDriftData(bar, query, 'category', false)
      })
    );
  }

  async function loadDriftData(bar, query, directionId, fresh) {
    const token = ++requestToken;
    const { indicator, chips } = bar._refs;

    indicator.replaceChildren(
      el('span', { className: 'serendipity-spinner' }),
      ' 온디바이스 모델로 새로운 사유를 직조하는 중...'
    );
    chips.replaceChildren();

    let response;
    try {
      response = await sendMessage({ type: 'RUN_DRIFT', data: { query, directionId, fresh } });
    } catch (err) {
      response = { success: false, error: err.message };
    }

    // 그 사이 검색어가 바뀌었거나 다른 요청이 시작되었으면 이 응답은 버림
    if (token !== requestToken || !bar.isConnected) return;

    if (!response?.success || !response.data) {
      indicator.replaceChildren(
        el('span', { className: 'serendipity-error', text: `⚠️ 비틀기 중 오류 발생: ${response?.error || '응답 없음'}` })
      );
      return;
    }

    renderDrift(bar, response.data);
  }

  function renderDrift(bar, drift) {
    const { indicator, chips } = bar._refs;
    const dir = drift.direction;
    const isFallback = drift.source !== 'gemini-nano';

    // replaceChildren 은 null 을 "null" 글자로 넣으므로 빈 항목은 걸러냄
    indicator.replaceChildren(...[
      el('span', { className: 'serendipity-vector-icon', text: dir.icon || '🧭' }),
      el('strong', { className: 'serendipity-vector-name', text: dir.title }),
      el('span', { className: 'serendipity-vector-prompt', text: `"${dir.prompt}"` }),
      isFallback
        ? el('span', {
            className: 'serendipity-fallback-badge',
            title: 'Gemini Nano를 사용할 수 없어 미리 정해진 연상 키워드로 대신했습니다. 확장 프로그램 팝업에서 모델을 활성화하세요.',
            text: '내장 연상 모드'
          })
        : null
    ].filter(Boolean));

    const { kind } = bar._refs;
    if (kind !== 'web') {
      renderMediaSteps(chips, drift.queries || [], kind);
      return;
    }

    chips.replaceChildren(...(drift.queries || []).map((item) => {
      const rank = item.rank || 1;
      return el('a', {
        className: `serendipity-stage-chip chip-step-${rank}`,
        href: googleSearchUrl(item.query),
        title: `${item.stage}\n${item.explanation}\n(클릭하여 이 검색어로 구글 검색)`
      }, [
        el('div', { className: 'serendipity-chip-meta' }, [
          el('span', { className: 'serendipity-stage-rank', text: `${rank}단계 · ${item.distance} 이탈` })
        ]),
        el('div', { className: 'serendipity-chip-query', text: item.query }),
        el('div', { className: 'serendipity-chip-exp', text: item.explanation })
      ]);
    }));
  }

  /* -------------------------------------------------------------- */
  /* 이미지·동영상 탭: 단계별 썸네일 미리보기                            */
  /* 단계 칸을 누르면 이 페이지가 그 키워드의 같은 탭 검색으로 이동합니다. */
  /* -------------------------------------------------------------- */

  const MEDIA_PER_STEP = 4;

  function renderMediaSteps(row, queries, kind) {
    row.replaceChildren(...queries.map((item) => {
      const rank = item.rank || 1;
      const grid = el('div', {
        className: `serendipity-media-grid${kind === 'video' ? ' is-video' : ''}`,
        'aria-busy': 'true'
      });
      const step = el('a', {
        className: `serendipity-media-step chip-step-${rank}`,
        href: tabSearchUrl(item.query, kind),
        title: `${item.stage}\n${item.explanation}\n(클릭하여 이 키워드로 ${kind === 'video' ? '동영상' : '이미지'} 검색)`
      }, [
        el('div', { className: 'serendipity-media-label' }, [
          el('span', { className: 'serendipity-stage-rank', text: `${rank}단계` }),
          el('span', { className: 'serendipity-media-query', text: item.query })
        ]),
        grid
      ]);
      loadMediaInto(grid, item.query, kind);
      return step;
    }));
  }

  async function loadMediaInto(grid, query, kind) {
    grid.replaceChildren(...Array.from({ length: MEDIA_PER_STEP }, () =>
      el('div', { className: 'serendipity-media-thumb serendipity-media-skeleton' })));

    let items = [];
    try {
      const res = await sendMessage({ type: 'FETCH_MEDIA', kind, query, limit: MEDIA_PER_STEP });
      items = res?.success ? res.data : [];
    } catch (_) {}
    if (!grid.isConnected) return;

    grid.removeAttribute('aria-busy');
    if (!items.length) {
      grid.replaceChildren(el('span', { className: 'serendipity-media-empty', text: '결과를 불러오지 못했습니다.' }));
      return;
    }

    grid.replaceChildren(...items.map((it) => {
      const cell = el('div', { className: 'serendipity-media-thumb' });
      const img = el('img', { src: it.thumb, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => cell.remove(), { once: true });
      cell.append(img);
      if (kind === 'video') {
        cell.append(el('span', {
          className: 'serendipity-media-duration',
          'aria-hidden': 'true',
          text: it.isShort ? 'Shorts' : (it.duration || 'LIVE')
        }));
      }
      return cell;
    }));
  }

  /* -------------------------------------------------------------- */
  /* 초기화 & SPA 네비게이션 감지                                       */
  /* -------------------------------------------------------------- */

  async function init() {
    injectHomeSearchButton();

    const kind = pageKind();
    if (!kind) {
      removeDriftBar();
      return;
    }
    const q = extractSearchQuery();
    if (!q) return;

    // 사이드패널이 열려 있으면 위젯 생략: 비틀기는 사이드패널이 맡고 본창은 0단계(원래 검색 결과)만 보여줌.
    // (위젯까지 돌리면 같은 검색어로 비틀기를 한 번 더 하게 되고 결과도 사이드패널과 달라짐)
    if (await isSidePanelOpen()) {
      removeDriftBar();
      return;
    }
    injectDriftBar(q, kind);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // 구글의 동적 페이지 전환 감지.
  // 문서 전체 MutationObserver 대신 Navigation API 를 사용합니다.
  // currententrychange 는 pushState/replaceState/뒤로가기를 모두 잡습니다.
  // 미지원 브라우저에서만 가벼운 URL 폴링으로 대체합니다.
  let lastUrl = location.href;
  const onMaybeNavigated = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    setTimeout(init, 300); // 새 결과 DOM 이 그려질 시간을 줌
  };

  if (window.navigation?.addEventListener) {
    window.navigation.addEventListener('currententrychange', onMaybeNavigated);
  } else {
    setInterval(onMaybeNavigated, 1000);
  }
  window.addEventListener('popstate', onMaybeNavigated);
})();
