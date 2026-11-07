/**
 * Chrome Built-in AI (Prompt API / Gemini Nano) 엔진
 *
 * - 최신 전역 `LanguageModel` 과 구형 `ai.languageModel` 을 모두 지원합니다.
 * - 시스템 프롬프트별 베이스 세션을 Map 으로 캐싱하고, 요청마다 clone() 하여
 *   프리필 비용을 아끼면서 대화 맥락이 누적되지 않도록 합니다.
 * - 가용성(availability) 결과를 캐싱해 요청마다 반복 조회하지 않습니다.
 *
 * 이 모듈은 DOM/chrome API 에 의존하지 않으므로 Node 테스트에서도 import 할 수 있습니다.
 */

const STAGE_NAMES = [
  '1단계: 미묘한 각도 (Tangent)',
  '2단계: 유추적 도약 (Metaphor)',
  '3단계: 구조적 전도 (Inversion)',
  '4단계: 사유의 끝점 (Radical)'
];

const DEFAULT_SCOPES = ['동일 소분류', '인접 중분류', '교차 대분류', '사유의 끝점'];
const KNOWN_SCOPE = '동일\\s*소분류|인접\\s*중분류|교차\\s*대분류|사유의\\s*끝점|소분류|중분류|대분류';
const LEADING_BRACKET_RE = /^\[([^\]]+)\]\s*/;
const KNOWN_SCOPE_ANYWHERE_RE = new RegExp(`\\[(?:${KNOWN_SCOPE})\\]`, 'gi');
const INVALID_LABELS = new Set(['단계', '1단계', '2단계', '3단계', '4단계', '검색어', '추천 검색어', '키워드', '이유', '설명']);

const READY_VALUES = new Set(['readily', 'available']);
const DOWNLOADING_VALUES = new Set(['after-download', 'downloadable', 'downloading']);
/** 'ready' 가 아닌 가용성 결과는 이 시간 동안만 캐시합니다 (사용자가 플래그를 켜는 등 상태가 바뀔 수 있음). */
const NON_READY_CACHE_MS = 30_000;

const SESSION_OPTIONS = { temperature: 0.8, topK: 4 };

const PHRASE_SYSTEM_PROMPT =
  '주어진 문장을 원문 순서대로 의미 있는 짧은 구절(2~5단어) 3~5개로 쪼개고, 마지막 줄에 이 문장에서 연상되는 낯선 검색 키워드 1개를 덧붙이세요. 각 항목을 한 줄에 하나씩, 번호나 기호 없이 출력하세요.';

export class NanoDriftEngine {
  constructor() {
    /** @type {Map<string, Promise<any>>} 시스템 프롬프트 → 베이스 세션 Promise */
    this.baseSessions = new Map();
    this.cloneUnsupported = false;
    this._availabilityCache = null; // { result, at }
  }

  /**
   * 브라우저 내 Prompt API 인터페이스 탐지
   */
  _getModelNamespace() {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    if (g.LanguageModel) return g.LanguageModel;
    if (g.ai && g.ai.languageModel) return g.ai.languageModel;
    return null;
  }

  isApiExposed() {
    return this._getModelNamespace() !== null;
  }

  invalidateAvailability() {
    this._availabilityCache = null;
  }

  /**
   * Prompt API 지원 여부 및 모델 가용성 확인
   * @returns {Promise<{status: 'ready'|'downloading'|'unavailable'|'unsupported'|'error', raw?: string, message?: string, error?: string}>}
   */
  async checkAvailability({ fresh = false } = {}) {
    const cached = this._availabilityCache;
    if (!fresh && cached) {
      const stillValid = cached.result.status === 'ready' || Date.now() - cached.at < NON_READY_CACHE_MS;
      if (stillValid) return cached.result;
    }

    const result = await this._queryAvailability();
    this._availabilityCache = { result, at: Date.now() };
    return result;
  }

  async _queryAvailability() {
    try {
      const lm = this._getModelNamespace();
      if (!lm) {
        return {
          status: 'unsupported',
          message: 'Chrome Built-in AI (Prompt API)가 감지되지 않았습니다. chrome://flags 설정을 확인하세요.'
        };
      }

      let raw;
      if (typeof lm.availability === 'function') {
        raw = await lm.availability();
      } else if (typeof lm.capabilities === 'function') {
        raw = (await lm.capabilities()).available;
      } else {
        return { status: 'ready', raw: 'unknown', message: 'Prompt API 사용 가능' };
      }

      if (READY_VALUES.has(raw)) {
        return { status: 'ready', raw, message: 'Gemini Nano 온디바이스 모델이 준비되어 있습니다.' };
      }
      if (DOWNLOADING_VALUES.has(raw)) {
        return {
          status: 'downloading',
          raw,
          message: raw === 'downloading'
            ? 'Gemini Nano 모델을 다운로드하는 중입니다.'
            : 'Gemini Nano 모델을 아직 내려받지 않았습니다. 클릭하여 다운로드를 시작하세요.'
        };
      }
      return { status: 'unavailable', raw, message: '이 기기에서 모델을 사용할 수 없습니다.' };
    } catch (err) {
      console.warn('[NanoDriftEngine] Availability check failed:', err);
      return { status: 'error', error: err.message };
    }
  }

  /**
   * 모델 다운로드/활성화.
   * LanguageModel.create() 는 모델이 아직 없을 때 "사용자 활성화(user activation)"를 요구하므로
   * 반드시 클릭 핸들러가 실행된 페이지(팝업/사이드패널) 컨텍스트에서 직접 호출해야 합니다.
   * 서비스 워커/오프스크린 문서에서는 다운로드를 시작할 수 없습니다.
   */
  async activateModel(onDownloadProgress) {
    const lm = this._getModelNamespace();
    if (!lm) return { success: false, error: 'Prompt API 미지원' };
    try {
      const monitor = onDownloadProgress
        ? (m) => m.addEventListener('downloadprogress', (e) => onDownloadProgress(e.loaded, e.total))
        : undefined;
      const session = await this._createSession('You are a helpful assistant.', monitor);
      try { session.destroy(); } catch (_) {}
      this.invalidateAvailability();
      return { success: true, status: 'ready' };
    } catch (err) {
      console.warn('[NanoDriftEngine] Activation failed:', err);
      this.invalidateAvailability();
      return { success: false, error: err.message };
    }
  }

  /**
   * 새 세션 생성. API 버전별로 지원하는 옵션 조합이 달라 순서대로 시도합니다.
   */
  async _createSession(systemPrompt, monitor) {
    const lm = this._getModelNamespace();
    if (!lm) throw new Error('Prompt API를 사용할 수 없습니다.');

    const extra = monitor ? { monitor } : {};
    const variants = [
      { ...SESSION_OPTIONS, ...extra, initialPrompts: [{ role: 'system', content: systemPrompt }] }, // 최신 API
      { ...SESSION_OPTIONS, ...extra, systemPrompt },                                                 // 구형 API
      { ...extra, initialPrompts: [{ role: 'system', content: systemPrompt }] }                       // 샘플링 옵션 미허용 환경
    ];

    let lastErr;
    for (const options of variants) {
      try {
        return await lm.create(options);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  _getBaseSessionPromise(systemPrompt) {
    let p = this.baseSessions.get(systemPrompt);
    if (!p) {
      p = this._createSession(systemPrompt);
      this.baseSessions.set(systemPrompt, p);
      // 생성 실패한 Promise 는 캐시에 남기지 않음
      p.catch(() => {
        if (this.baseSessions.get(systemPrompt) === p) this.baseSessions.delete(systemPrompt);
      });
    }
    return p;
  }

  _dropBaseSession(systemPrompt) {
    const p = this.baseSessions.get(systemPrompt);
    if (!p) return;
    this.baseSessions.delete(systemPrompt);
    p.then((s) => { try { s.destroy(); } catch (_) {} }).catch(() => {});
  }

  /**
   * 요청 1회용 세션을 반환합니다. 호출자는 사용 후 반드시 destroy() 해야 합니다.
   * 베이스 세션은 엔진이 소유하며 절대 호출자에게 직접 넘기지 않습니다(clone 미지원 환경 제외).
   */
  async getSession(systemPrompt) {
    if (this.cloneUnsupported) {
      return this._createSession(systemPrompt);
    }

    const p = this._getBaseSessionPromise(systemPrompt);
    const base = await p;

    if (typeof base.clone !== 'function') {
      // clone 이 없는 구형 API: 캐시해도 재사용할 수 없으므로 캐시를 끄고,
      // 이 베이스 세션은 먼저 가져간 호출자에게 1회용으로 넘깁니다.
      this.cloneUnsupported = true;
      if (this.baseSessions.get(systemPrompt) === p) {
        this.baseSessions.delete(systemPrompt);
        return base;
      }
      return this._createSession(systemPrompt);
    }

    try {
      return await base.clone();
    } catch (err) {
      console.warn('[NanoDriftEngine] Session clone failed, recreating base session:', err);
      this._dropBaseSession(systemPrompt);
      const fresh = await this._getBaseSessionPromise(systemPrompt);
      return fresh.clone();
    }
  }

  /**
   * 1회용 세션으로 프롬프트를 실행하고 세션을 정리합니다.
   */
  async _promptOnce(systemPrompt, userPrompt) {
    const session = await this.getSession(systemPrompt);
    try {
      return await session.prompt(userPrompt);
    } finally {
      try { session.destroy(); } catch (_) {}
    }
  }

  /**
   * 원본 검색어와 사유 벡터를 바탕으로 4단계의 점진적 비틀린 검색어 생성
   */
  async generateDriftQueries(originalQuery, direction) {
    const availability = await this.checkAvailability();

    if (availability.status !== 'ready') {
      return this._generateFallbackQueries(originalQuery, direction, availability);
    }

    const { systemPrompt, userPrompt } = buildDriftPrompts(originalQuery, direction);

    try {
      const responseText = await this._promptOnce(systemPrompt, userPrompt);
      const parsed = parseModelResponse(responseText, originalQuery);

      if (parsed.length >= 2) {
        return { source: 'gemini-nano', direction, originalQuery, queries: parsed };
      }
      throw new Error('응답 구문 분석 실패');
    } catch (err) {
      console.warn('[NanoDriftEngine] Prompt execution error, falling back:', err);
      this._dropBaseSession(systemPrompt);
      this.invalidateAvailability();
      return this._generateFallbackQueries(originalQuery, direction, { status: 'fallback', reason: err.message });
    }
  }

  /**
   * 문장 조각을 더 잘게 분해하고 비틀린 개념 키워드로 변환
   */
  async deconstructSentenceToPhrases(sentence) {
    const clean = (sentence || '').trim();
    if (!clean) return [];

    const availability = await this.checkAvailability();
    if (availability.status === 'ready') {
      try {
        const res = await this._promptOnce(PHRASE_SYSTEM_PROMPT, `문장: "${clean}"`);
        const parts = parsePhraseResponse(res);
        if (parts.length >= 2) return parts;
      } catch (e) {
        console.warn('[NanoDriftEngine] Phrase deconstruct fallback:', e);
        this._dropBaseSession(PHRASE_SYSTEM_PROMPT);
      }
    }

    return splitPhrasesHeuristically(clean);
  }

  /**
   * Gemini Nano 를 쓸 수 없는 환경을 위한 내장 연상 엔진.
   * 결과에는 source: 'fallback-heuristic' 이 붙으며, UI 는 이를 사용자에게 표시하고 캐시하지 않습니다.
   */
  _generateFallbackQueries(originalQuery, direction, statusInfo) {
    const pool = FALLBACK_KEYWORDS[direction.id] || FALLBACK_KEYWORDS.bio;
    const firstWord = pool[0].split(' ')[0];

    const explanations = [
      `원래 개념의 맥락에서 '${firstWord}'의 관점을 덧붙여 미세하게 비틀었습니다.`,
      `'${direction.title}'의 원리를 적용하여 다른 분야의 메커니즘으로 도약했습니다.`,
      '보이지 않는 구조와 이면의 규칙을 조명하는 개념으로 전환했습니다.',
      '원래의 의도에서 벗어나 완전히 낯선 영토에 도달한 최종 사유의 조각입니다.'
    ];
    // 카테고리 모드는 원 검색어에 수식어를 붙이고, 사유 벡터 모드는 벡터 고유의 키워드로 도약합니다.
    const queries = direction.id === 'category'
      ? [`${originalQuery} ${firstWord}`, ...pool.slice(1).map((k) => `${originalQuery} ${k}`)]
      : [`${originalQuery} ${firstWord}`, pool[1], pool[2], pool[3]];

    return {
      source: 'fallback-heuristic',
      statusInfo,
      direction,
      originalQuery,
      queries: queries.map((query, i) => ({
        rank: i + 1,
        stage: STAGE_NAMES[i],
        scope: DEFAULT_SCOPES[i],
        query,
        explanation: explanations[i],
        distance: `${(i + 1) * 25}%`
      }))
    };
  }
}

/* ------------------------------------------------------------------ */
/* 프롬프트 & 파서 (순수 함수 — 단위 테스트 대상)                         */
/* ------------------------------------------------------------------ */

export function buildDriftPrompts(originalQuery, direction) {
  const isCategoryMode = direction.id === 'category';
  const systemPrompt = isCategoryMode
    ? '당신은 검색어의 카테고리를 1단계(소분류 내 대체재)부터 4단계(먼 연상 카테고리)까지 점진적으로 확장하며 주제어를 바꾸어 주는 검색어 추천 AI입니다.'
    : '당신은 검색어의 의미를 예술적·철학적 유추를 통해 1단계(가까운 비틀기)부터 4단계(완전히 낯선 영토)까지 점진적으로 멀어지게 도약시키는 창의적 검색어 추천 AI입니다.';

  const userPrompt = isCategoryMode
    ? `지침: "${direction.prompt}"
원본 검색어: "${originalQuery}"

[필수 규칙 - 1~4단계 거리 차등화]
4개의 검색어가 모두 비슷한 수준에 머물면 안 됩니다! 1단계에서 4단계로 갈수록 원래 카테고리에서 점점 더 바깥쪽 카테고리로 멀어져야 합니다:
- [1] 1단계 (25% 이탈 · 동일 소분류): 원본과 같은 가장 좁은 카테고리 내의 직접적인 형제/대체 대상
- [2] 2단계 (50% 이탈 · 인접 중분류): 소분류를 벗어나, 소비 맥락이나 용도가 같은 이웃 카테고리의 다른 대상
- [3] 3단계 (75% 이탈 · 교차 대분류): 원래 품목군을 벗어나, 핵심 기능·역할·특성만 공유하는 다른 분야 카테고리의 대상
- [4] 4단계 (100% 이탈 · 사유의 끝점): 언뜻 전혀 다른 분야처럼 보이지만, 구조적·문화적 실마리로만 연결된 먼 카테고리의 뜻밖의 대상

* 주의: 원본 단어("${originalQuery}")를 검색어에 그대로 포함하지 마세요.
* 마크다운 볼드체(**) 없이 정확히 아래 4줄 형식으로만 출력하세요.

[참고 예시 1 - 원본 검색어가 "고구마"일 때 (점진적 확장)]
[1] 토란 | [동일 소분류] 고구마와 같은 뿌리채소·알줄기 카테고리에 속하는 직접적 대체 식재료입니다.
[2] 군밤 | [인접 중분류] 뿌리채소를 벗어나 '겨울철 구워 먹는 길거리 간식' 카테고리로 이동한 대상입니다.
[3] 전투식량 | [교차 대분류] 척박한 환경에서 칼로리를 공급하는 '구황·생존 비상식량' 카테고리로 확장한 대상입니다.
[4] 스발바르 국제 종자 저장고 | [사유의 끝점] 식량 작물의 멸종을 막고 땅속에 보존하는 인류 농업 유산 카테고리의 끝점입니다.

[참고 예시 2 - 원본 검색어가 "아이폰"일 때 (점진적 확장)]
[1] 구글 픽셀 | [동일 소분류] 스마트폰 카테고리 내의 직접적인 대안 기기입니다.
[2] 전자책 리더기 | [인접 중분류] 스마트폰을 벗어나 '휴대용 개인 디지털 스크린' 카테고리로 이동한 기기입니다.
[3] 아마추어 무선통신 | [교차 대분류] 상용 모바일 기기를 벗어나 '원거리 개인 통신 수단' 카테고리로 도약한 영역입니다.
[4] 봉수대 | [사유의 끝점] 빛과 연기로 신호를 주고받던 고대 장거리 정보 전달 네트워크의 원형입니다.

이제 원본 검색어 "${originalQuery}"에 대해 1단계부터 4단계까지 거리가 확연히 멀어지도록 [1]~[4] 4줄만 출력하세요:`
    : `원본 검색어: "${originalQuery}"
사유의 도약 방향: ${direction.title} - "${direction.prompt}"

[필수 규칙 - 1~4단계 거리 차등화]
4개의 검색어가 비슷한 수준에 머물지 않도록, 1단계에서 4단계로 갈수록 개념적 거리를 과감하게 넓히세요:
- [1] 1단계 (25% 이탈 · 미묘한 각도): 원래 주제와 같은 분야에 머물되, 사유의 방향을 살짝 반영한 인접 개념
- [2] 2단계 (50% 이탈 · 유추적 도약): 원래 분야의 경계를 넘어, 다른 학문·스케일·메커니즘과 교차하는 개념
- [3] 3단계 (75% 이탈 · 구조적 전도): 원래의 목적·원리를 뒤집거나 부산물·오작동·이면의 구조로 넘어간 낯선 현상
- [4] 4단계 (100% 이탈 · 사유의 끝점): 처음 검색어와 전혀 무관한 분야처럼 보이지만, 얇고 기발한 은유적 실마리 하나만 남은 파격적 종착지

* 주의: 원본 단어("${originalQuery}")를 그대로 포함하지 마세요.
* 마크다운 볼드체(**)나 제목 없이 반드시 아래 4줄 형식으로만 출력하세요:
[1] 1단계검색어 | 이 검색어로 도약한 짧은 이유(1문장)
[2] 2단계검색어 | 이 검색어로 도약한 짧은 이유(1문장)
[3] 3단계검색어 | 이 검색어로 도약한 짧은 이유(1문장)
[4] 4단계검색어 | 이 검색어로 도약한 짧은 이유(1문장)`;

  return { systemPrompt, userPrompt };
}

/** 검색어 문자열에서 라벨·범위 태그·감싼 따옴표/괄호를 제거합니다. */
export function cleanQueryStr(raw) {
  return (raw || '')
    .replace(KNOWN_SCOPE_ANYWHERE_RE, '')
    .trim()
    .replace(LEADING_BRACKET_RE, '')
    .replace(/^(?:\d+\s*단계|검색어|추천\s*검색어|키워드)\s*[:：\-]?\s*/i, '')
    .replace(/^["'「『\[]+|["'」』\]]+$/g, '')
    .trim();
}

/** 설명 앞의 [범위] 태그를 분리해 scope 로 돌려주고, 설명 본문은 태그 없이 반환합니다. */
export function extractScopeAndClean(rawExp, rawQuery, rank) {
  let scope = '';
  let explanation = (rawExp || '').trim();

  const leading = explanation.match(LEADING_BRACKET_RE);
  if (leading) {
    scope = leading[1].replace(/\s+/g, ' ').trim();
    explanation = explanation.slice(leading[0].length).trim();
  } else {
    const inQuery = (rawQuery || '').match(new RegExp(`\\[(${KNOWN_SCOPE})\\]`, 'i'));
    scope = inQuery ? inQuery[1].replace(/\s+/g, ' ') : (DEFAULT_SCOPES[rank - 1] || '');
  }
  return { scope, explanation: explanation || '관련 사유의 도약' };
}

/**
 * 모델 출력 텍스트 파싱 (다양한 LLM 마크다운 변형에 대응)
 * 반환되는 query / explanation 에는 [범위] 접두사가 남아 있지 않으므로 UI 는 그대로 표시하면 됩니다.
 */
export function parseModelResponse(text, originalQuery) {
  const results = [];
  const seen = new Set();
  const lines = (text || '')
    .split('\n')
    .map((l) => l.replace(/\*\*/g, '').replace(/__/g, '').trim())
    .filter(Boolean);

  const push = (rank, rawQuery, rawExplanation) => {
    const query = cleanQueryStr(rawQuery);
    if (!query || INVALID_LABELS.has(query) || query.endsWith('분류')) return;
    if (query === originalQuery || seen.has(query) || results.length >= 4) return;
    const { scope, explanation } = extractScopeAndClean(rawExplanation, rawQuery, rank);
    seen.add(query);
    results.push({
      rank,
      stage: STAGE_NAMES[rank - 1] || `${rank}단계`,
      scope,
      query,
      explanation,
      distance: `${rank * 25}%`
    });
  };

  // 1차 패스: "[1] 검색어 | 이유", "1. 검색어 | 이유", "1단계: 검색어 | 이유"
  for (const line of lines) {
    const m = line.match(/^[-*•]?\s*\[?([1-4])\]?(?:\s*단계)?[.):：\s-]*([^|]+)\|\s*(.*)$/);
    if (m) push(parseInt(m[1], 10), m[2], m[3]);
  }

  // 2차 패스: 파이프 없이 출력된 경우
  if (results.length < 2) {
    results.length = 0;
    seen.clear();
    for (const line of lines) {
      // '검색어: "OOO" (설명)' 패턴
      const kw = line.match(/^(?:[*•\-]\s*)?(?:검색어|추천\s*검색어|키워드)\s*[:：]\s*["']?([^"'()|–-]+)["']?\s*(?:\(([^)]+)\)|[|–:-]\s*(.*))?$/i);
      if (kw) {
        push(results.length + 1, kw[1], kw[2] || kw[3] || '관련 카테고리 내 변환된 검색어입니다.');
        continue;
      }

      // '1. 감자: 설명', '1단계: 감자 - 설명', '1) 감자 (설명)'
      const num = line.match(/^(?:\[?[1-4]\]?[.)]\s*|\[[1-4]\]\s*|[1-4]\s*단계\s*[:：\-]\s*)([^|:：–\-()]+?)(?:\s*[|:：–\-]\s*(.+)|\s*\(([^)]+)\))$/);
      if (num) push(results.length + 1, num[1], num[2] || num[3] || '');
    }
  }

  return results.slice(0, 4);
}

/** 구절 분해 응답 파싱: 줄/파이프/불릿 단위로 나누고 번호·기호를 제거합니다. */
export function parsePhraseResponse(text) {
  return (text || '')
    .split(/[\n|•]+/)
    .map((s) => s.replace(/^\s*(?:[-*]\s+|\d+[.)]\s*)/, '').replace(/^["'「]|["'」]$/g, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 45)
    .slice(0, 6);
}

/** 모델 없이 문장을 구절로 나누는 규칙 기반 분해 */
export function splitPhrasesHeuristically(clean) {
  const commaSplit = clean.split(/[,，;·—–()]+/).map((s) => s.trim()).filter(Boolean);
  if (commaSplit.length >= 2) return commaSplit;

  const words = clean.split(/\s+/);
  const phrases = [];
  const chunkSize = Math.max(2, Math.ceil(words.length / 4));
  for (let i = 0; i < words.length; i += chunkSize) {
    phrases.push(words.slice(i, i + chunkSize).join(' '));
  }
  return phrases;
}

const FALLBACK_KEYWORDS = {
  category: ['대체재 비교 분석', '유사 분야 사례', '파생 갈래', '인접 카테고리 트렌드'],
  bio: ['균사체 정보 전달 네트워크', '바이오미미크리 생체모방 구조', '지의류 공생 매커니즘', '극지 호극성 미생물 휴면'],
  archaeo: ['점토판 설형문자 회계 기록', '고대 흑요석 교역로', '신석기 거석 정렬 측량', '선사시대 동굴 벽화 안료'],
  ruin: ['우주 쓰레기 궤도 감쇠', '폐선박 해체장 자원화', '디지털 고고학 파일 포맷 소멸', '콘크리트 탄산화 풍화 속도'],
  inversion: ['엔트로피 역전 냉각 기술', '네거티브 스페이스 공간 설계', '수동적 증발 냉각 건축', '역발상 고장 안전 매커니즘'],
  glitch: ['회로 벤딩 앰비언트 사운드', '센서 양자화 오차 패턴', '크로매틱 에버레이션 렌즈 왜곡', '소프트웨어 글리치 아트 미학'],
  synesthesia: ['음파 부양 미세 입자 거동', '냄새 분자 스펙트럼 공명', '촉각 피드백 질감 렌더링', '색청 공감각 신경 가소성'],
  micro: ['브라운 운동 콜로이드 확산', '모세관 현상 다공성 매질', '표면장력 미세 유체 칩', '결정 격자 결함 전위'],
  cosmic: ['중력파 시공간 왜곡 간섭계', '중성자별 지각 표면 진동', '태양풍 자기권 충격파', '우주 배경복사 비등방성'],
  waste: ['바이오차 탄소 격리 토양', '슬래그 유리화 세라믹 신소재', '해양 미세플라스틱 미생물 분해', '산업 부산물 폐열 회수망'],
  infra: ['해저 케이블 중계기 전원 공급', '지하 상수도 공동구 누수 청음', '동기식 전력망 주파수 제어', '광섬유 분산 온도 감지'],
  power: ['파놉티콘 시선 공간 통제', '알고리즘 필터 버블 편향', '국경 검문소 생체인식 감시', '배타적 전파 대역 경매제'],
  economy: ['쿨라 링 조개 장신구 교환', '포틀래치 파괴 증여 의례', '지역 화폐 시효성 감가상각', '공유지의 비극 다자간 협약'],
  mimicry: ['카모플라주 위장 패턴 광학', '의태 나비 포식자 기만 신호', '페이크 페이퍼 학술 위조 탐지', '트로이 목마 코드 은닉술'],
  myth: ['티베트 만다라 모래 해체', '길가메시 불로초 탐색 여정', '터부 음식 금기 문화인류학', '샤머니즘 엑스터시 변성의식'],
  noise: ['열잡음 진성 난수 생성기', '혼돈 이론 로렌츠 끌개', '백색잡음 확률공명 현상', '확률적 튜링 기계 계산 복잡도'],
  threshold: ['생태계 점이대 가장자리 효과', '상전이 임계점 요동 현상', '반도체 p-n 접합면 전위 장벽', '건축적 전이지대 필로티 공간'],
  rhythm: ['생체 일주기 서캐디안 리듬', '진자 시계 동조 현상', '심박 변이도 미주신경 톤', '퇴적층 엽리 밀란코비치 주기'],
  memory: ['팔림프세스트 지워진 양피지 복원', '지질학적 부정합 시간 공백', '기억 흔적 엔그램 시냅스', '유령 통증 중추신경 가소성'],
  material: ['비뉴턴 유체 전단 농화 현상', '형상기억합금 마르텐사이트 변태', '초전도체 마이스너 효과', '압전소자 기계 응력 발전'],
  periphery: ['호극성 극한 환경 고세균', '소수 방언 음운 보존 현상', '심해 열수구 화학합성 생태계', '주변부 은하 회전 곡선 암흑물질']
};

export const nanoEngine = new NanoDriftEngine();
