/**
 * 단계별 눈알 아이콘 — 단계가 올라갈수록 색이 바뀌고 눈동자가 더 옆으로 돌아갑니다.
 *
 * 콘텐츠 스크립트(content.js)와 사이드패널이 함께 쓰므로 ES 모듈이 아닌 클래식 스크립트로 두고
 * 전역 함수 하나만 노출합니다. 반환 마크업은 아래 상수로만 만들어지는 정적 SVG 입니다.
 */
(function () {
  'use strict';

  // 단계별 [바탕, 눈꺼풀, 홍채] — 단계 카드 색(파랑·노랑·초록·빨강 계열)과 짝을 맞춘 파스텔
  const PALETTES = [
    ['#add6ff', '#82bcf5', '#3f82d6'],
    ['#ffdf8a', '#f5c452', '#c98a1b'],
    ['#9fdcc8', '#74c5ae', '#3a9d8a'],
    ['#ffc4ad', '#f7a286', '#d9694a']
  ];

  // 눈알 중심 (24, 24.5) 기준 — iris: 홍채 치우침, pupil: 홍채 안에서 검은자의 추가 치우침,
  // lid: 눈꺼풀 아랫선의 [왼쪽 y, 오른쪽 y] (클수록 더 내려와 흘겨보는 표정)
  const GLANCE = [
    { iris: [1.2, 1], pupil: [0.8, 0.4], lid: [10.5, 12.5] },
    { iris: [3.4, 1.5], pupil: [1.7, 0.7], lid: [12.5, 16] },
    { iris: [5.5, 2], pupil: [2.7, 1.1], lid: [14.5, 19.5] },
    { iris: [7.6, 2.2], pupil: [3.7, 1.3], lid: [16, 22.5] }
  ];

  let seq = 0;

  /**
   * @param {number} rank 1~4 단계
   * @returns {string} SVG 마크업
   */
  globalThis.serendipityStageEye = function (rank) {
    const i = Math.min(Math.max(Math.round(Number(rank)) || 1, 1), 4) - 1;
    const [bg, lid, iris] = PALETTES[i];
    const g = GLANCE[i];
    const ix = 24 + g.iris[0];
    const iy = 24.5 + g.iris[1];
    const clipId = `serendipity-eye-clip-${++seq}`;

    return `<svg class="serendipity-stage-eye" viewBox="0 0 48 48" fill="none" aria-hidden="true">` +
      `<defs><clipPath id="${clipId}"><circle cx="24" cy="24.5" r="16"/></clipPath></defs>` +
      `<circle cx="24" cy="24" r="22" fill="${bg}"/>` +
      `<circle cx="24" cy="24.5" r="16" fill="#ffffff"/>` +
      `<g clip-path="url(#${clipId})">` +
        `<circle cx="${ix}" cy="${iy}" r="9.5" fill="${iris}"/>` +
        `<circle cx="${ix + g.pupil[0]}" cy="${iy + g.pupil[1]}" r="5.2" fill="#1f2a37"/>` +
        `<circle cx="${ix - 1.9}" cy="${iy - 3.7}" r="2" fill="#ffffff"/>` +
        `<path d="M4 4H44V${g.lid[1]}L4 ${g.lid[0]}Z" fill="${lid}"/>` +
        `<path d="M4 ${g.lid[0]}L44 ${g.lid[1]}" stroke="${iris}" stroke-width="1.4"/>` +
      `</g></svg>`;
  };
})();
