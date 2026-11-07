/**
 * Chrome Built-in AI (Prompt API / Gemini Nano) 엔진
 * 최신 표준 전역 `LanguageModel` 인터페이스와 `ai.languageModel`을 모두 지원하며,
 * 세션 캐싱 및 클로닝(clone)을 통해 지연 시간(Latency)을 최소화합니다.
 */

export class NanoDriftEngine {
  constructor() {
    this.baseSession = null;
    this.baseSessionPrompt = null;
    this.modelStatus = 'unknown'; // 'ready' | 'after-download' | 'no' | 'unsupported'
    this.isCreatingSession = false;
  }

  /**
   * 브라우저 내 Prompt API 인터페이스 탐지 (최신 LanguageModel 전역 객체 및 구형 ai.languageModel 모두 호환)
   */
  _getModelNamespace() {
    if (typeof LanguageModel !== 'undefined') return LanguageModel;
    if (typeof globalThis !== 'undefined' && globalThis.LanguageModel) return globalThis.LanguageModel;
    if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
    if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) return window.ai.languageModel;
    if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) return self.ai.languageModel;
    return null;
  }

  /**
   * 브라우저 내 Prompt API 지원 여부 및 모델 가용성 확인
   */
  async checkAvailability() {
    try {
      const lm = this._getModelNamespace();
      if (!lm) {
        this.modelStatus = 'unsupported';
        return {
          status: 'unsupported',
          message: 'Chrome Built-in AI (Prompt API)가 감지되지 않았습니다. chrome://flags 설정을 확인하세요.'
        };
      }

      // 표준 availability() 확인 ('readily' / 'available' | 'after-download' / 'downloadable' | 'no' / 'unavailable')
      if (typeof lm.availability === 'function') {
        const avail = await lm.availability();
        this.modelStatus = avail;
        const isReady = avail === 'readily' || avail === 'available';
        const isDownloading = avail === 'after-download' || avail === 'downloadable' || avail === 'downloading';
        return {
          status: isReady ? 'ready' : (isDownloading ? 'downloading' : 'unavailable'),
          raw: avail,
          message: isReady
            ? 'Gemini Nano 온디바이스 모델이 준비되어 있습니다.'
            : (isDownloading ? 'Gemini Nano 모델 다운로드가 필요합니다.' : '이 기기에서 모델을 사용할 수 없습니다.')
        };
      }

      // 레거시 capabilities() 폴백
      if (typeof lm.capabilities === 'function') {
        const caps = await lm.capabilities();
        const avail = caps.available;
        this.modelStatus = avail;
        const isReady = avail === 'readily' || avail === 'available';
        return {
          status: isReady ? 'ready' : (avail === 'after-download' ? 'downloading' : 'unavailable'),
          raw: avail,
          message: isReady ? 'Gemini Nano 준비 완료' : '모델 다운로드 필요'
        };
      }

      return { status: 'ready', message: 'Prompt API 사용 가능' };
    } catch (err) {
      console.warn('[NanoDriftEngine] Availability check failed:', err);
      return { status: 'error', error: err.message };
    }
  }

  /**
   * 모델 사전 로드 및 활성화 (최초 1회 컴포넌트 로드 트리거)
   */
  async warmupModel(onDownloadProgress) {
    const lm = this._getModelNamespace();
    if (!lm) return { success: false, error: 'Prompt API 미지원' };
    try {
      await this.getSession('당신은 검색어의 의미를 예술적·철학적으로 비틀어 새로운 사유로 도약시키는 창작 조력자입니다.', onDownloadProgress);
      this.modelStatus = 'readily';
      return { success: true, status: 'ready' };
    } catch (err) {
      console.warn('[NanoDriftEngine] Warmup failed:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Gemini Nano 세션 생성 또는 캐시된 베이스 세션 클론(clone)
   * 세션 클로닝을 사용하면 시스템 프롬프트 프리필(prefill) 시간을 아껴 응답 속도가 대폭 향상됩니다.
   */
  async getSession(systemPrompt, onDownloadProgress) {
    const lm = this._getModelNamespace();
    if (!lm) throw new Error('Prompt API를 사용할 수 없습니다.');

    // 1. 이미 동일한 시스템 프롬프트로 생성된 베이스 세션이 있다면 clone 시도
    if (this.baseSession && this.baseSessionPrompt === systemPrompt) {
      try {
        if (typeof this.baseSession.clone === 'function') {
          return await this.baseSession.clone();
        }
      } catch (cloneErr) {
        console.warn('[NanoDriftEngine] Session clone failed, recreating base session:', cloneErr);
        try { this.baseSession.destroy(); } catch (_) {}
        this.baseSession = null;
      }
    }

    const baseOptions = {
      temperature: 0.8,
      topK: 4
    };

    if (onDownloadProgress) {
      baseOptions.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) => {
          onDownloadProgress(e.loaded, e.total);
        });
      };
    }

    // 최신 Chrome LanguageModel API는 initialPrompts를 사용하고, 구형은 systemPrompt를 사용합니다.
    let newSession = null;
    try {
      newSession = await lm.create({
        ...baseOptions,
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        systemPrompt
      });
    } catch (_) {
      newSession = await lm.create({
        ...baseOptions,
        systemPrompt
      });
    }

    // 베이스 세션 교체 보관
    if (this.baseSession && this.baseSession !== newSession) {
      try { this.baseSession.destroy(); } catch (_) {}
    }
    this.baseSession = newSession;
    this.baseSessionPrompt = systemPrompt;

    if (typeof newSession.clone === 'function') {
      try {
        return await newSession.clone();
      } catch (_) {}
    }

    return newSession;
  }

  /**
   * 원본 검색어와 사유 벡터를 바탕으로 4단계의 점진적 비틀린 검색어 생성
   */
  async generateDriftQueries(originalQuery, direction, onDownloadProgress) {
    const availability = await this.checkAvailability();

    // 완전히 미지원이거나 불가 상태일 때만 즉시 폴백
    if (availability.status === 'unsupported' || availability.status === 'unavailable') {
      console.info('[NanoDriftEngine] 기기 미지원으로 내장 연상 엔진으로 동작합니다.');
      return this._generateFallbackQueries(originalQuery, direction, availability);
    }

    const isCategoryMode = direction.id === 'category';
    const systemPrompt = isCategoryMode
      ? `당신은 검색어의 카테고리를 1단계(소분류 내 대체재)부터 4단계(먼 연상 카테고리)까지 점진적으로 확장하며 주제어를 바꾸어 주는 검색어 추천 AI입니다.`
      : `당신은 검색어의 의미를 예술적·철학적 유추를 통해 1단계(가까운 비틀기)부터 4단계(완전히 낯선 영토)까지 점진적으로 멀어지게 도약시키는 창의적 검색어 추천 AI입니다.`;

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

    let session = null;
    try {
      session = await this.getSession(systemPrompt, onDownloadProgress);
      this.modelStatus = 'readily'; // 세션 생성이 성공하면 모델 준비 완료

      const responseText = await session.prompt(userPrompt);
      const parsed = this._parseModelResponse(responseText, originalQuery);

      if (parsed && parsed.length >= 2) {
        return {
          source: 'gemini-nano',
          direction,
          originalQuery,
          queries: parsed
        };
      }
      throw new Error('응답 구문 분석 실패');
    } catch (err) {
      console.warn('[NanoDriftEngine] Prompt execution error, falling back:', err);
      // 세션 오류 시 베이스 세션 초기화
      if (this.baseSession) {
        try { this.baseSession.destroy(); } catch (_) {}
        this.baseSession = null;
      }
      return this._generateFallbackQueries(originalQuery, direction, { status: 'fallback', reason: err.message });
    } finally {
      // baseSession 자체는 유지하고 복제된 session만 정리
      if (session && session !== this.baseSession) {
        try { session.destroy(); } catch (_) {}
      }
    }
  }

  /**
   * 웹페이지 문장 조각을 더 잘게 분해하고 비틀린 개념 키워드로 변환
   */
  async deconstructSentenceToPhrases(sentence, currentQuery = '') {
    const clean = (sentence || '').trim();
    if (!clean) return [];

    const availability = await this.checkAvailability();
    if (availability.status === 'ready') {
      let session = null;
      try {
        session = await this.getSession(
          '주어진 문장을 원문 순서대로 의미 있는 짧은 구절(2~5단어) 3~5개로 쪼개고, 마지막에 이 문장에서 연상되는 낯선 검색 키워드 1개를 덧붙여 줄바꿈으로만 출력하세요.'
        );
        const res = await session.prompt(`문장: "${clean}"\n구절 목록(|로 구분):`);
        const parts = res
          .split(/[\n|•\-]+/)
          .map(s => s.replace(/^\d+[.)]\s*/, '').trim())
          .filter(s => s.length >= 2 && s.length <= 45);
        if (parts.length >= 2) return parts.slice(0, 6);
      } catch (e) {
        console.warn('[NanoDriftEngine] Phrase deconstruct fallback:', e);
      } finally {
        if (session && session !== this.baseSession) {
          try { session.destroy(); } catch (_) {}
        }
      }
    }

    // 규칙 기반 구절 분해 폴백
    const commaSplit = clean.split(/[,，;·—–()]+/).map(s => s.trim()).filter(Boolean);
    if (commaSplit.length >= 2) return commaSplit;

    const words = clean.split(/\s+/);
    const phrases = [];
    const chunkSize = Math.max(2, Math.ceil(words.length / 4));
    for (let i = 0; i < words.length; i += chunkSize) {
      phrases.push(words.slice(i, i + chunkSize).join(' '));
    }
    return phrases;
  }

  /**
   * 모델 출력 텍스트 파싱 (다양한 LLM 마크다운 변형에 대응하는 방탄 파서)
   */
  _parseModelResponse(text, originalQuery) {
    const results = [];
    const lines = text
      .split('\n')
      .map(l => l.replace(/\*\*/g, '').replace(/__/g, '').trim())
      .filter(Boolean);

    const stageNames = [
      '1단계: 미묘한 각도 (Tangent)',
      '2단계: 유추적 도약 (Metaphor)',
      '3단계: 구조적 전도 (Inversion)',
      '4단계: 사유의 끝점 (Radical)'
    ];

    const defaultScopes = ['동일 소분류', '인접 중분류', '교차 대분류', '사유의 끝점'];
    const scopeRegex = /^\[(동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류)\]\s*/i;

    const extractScopeAndClean = (rawExp, rawQuery, rank) => {
      let scope = '';
      let cleanExp = (rawExp || '').trim();
      const matchExp = cleanExp.match(scopeRegex);
      if (matchExp) {
        scope = matchExp[1].replace(/\s+/g, ' ');
        cleanExp = cleanExp.slice(matchExp[0].length).trim();
      } else {
        const matchQuery = (rawQuery || '').match(/\[(동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류)\]/i);
        if (matchQuery) {
          scope = matchQuery[1].replace(/\s+/g, ' ');
        } else {
          scope = defaultScopes[rank - 1] || '';
        }
      }
      return { scope, explanation: cleanExp || '관련 사유의 도약' };
    };

    const invalidLabels = new Set(['단계', '1단계', '2단계', '3단계', '4단계', '검색어', '추천 검색어', '키워드', '이유', '설명']);

    const cleanQueryStr = (raw) => {
      return (raw || '')
        .replace(/^(?:\d+단계|검색어|추천\s*검색어|키워드)\s*[:：\-]?\s*/i, '')
        .replace(/\[(?:동일\s*소분류|인접\s*중분류|교차\s*대분류|사유의\s*끝점|소분류|중분류|대분류)\]/gi, '')
        .replace(/^["'「『\[]+|["'」』\]]+$/g, '')
        .trim();
    };

    // 1차 패스: [1] 검색어 | 이유 또는 1. 검색어 | 이유 형태 추출
    for (const line of lines) {
      const bracketMatch = line.match(/^\[?([1-4])\]?[.)\s]*(?:\d+단계\s*[:：\-]?\s*)?([^|]+)\|\s*(.*)$/);
      if (bracketMatch) {
        const rank = parseInt(bracketMatch[1], 10);
        const rawQuery = bracketMatch[2];
        const query = cleanQueryStr(rawQuery);
        const rawExplanation = bracketMatch[3].trim();
        const { scope, explanation } = extractScopeAndClean(rawExplanation, rawQuery, rank);

        if (query && !invalidLabels.has(query) && query !== originalQuery) {
          results.push({
            rank,
            stage: stageNames[rank - 1] || `${rank}단계`,
            scope,
            query,
            explanation,
            distance: `${rank * 25}%`
          });
        }
      }
    }

    // 2차 패스: 모델이 '* 검색어: "감자" (설명)' 또는 '1단계: 감자 - 설명' 형태로 출력한 경우
    if (results.length < 2) {
      for (const line of lines) {
        // '검색어: "OOO" (설명)' 패턴
        const keywordLineMatch = line.match(/^(?:[*•\-]\s*)?(?:검색어|추천\s*검색어|키워드)\s*[:：]\s*["']?([^"'()|–-]+)["']?\s*(?:\(([^)]+)\)|[|–:-]\s*(.*))?$/i);
        if (keywordLineMatch) {
          const rawQuery = keywordLineMatch[1];
          const query = cleanQueryStr(rawQuery);
          const rawExplanation = (keywordLineMatch[2] || keywordLineMatch[3] || '관련 카테고리 내 변환된 검색어입니다.').trim();
          const rank = results.length + 1;
          const { scope, explanation } = extractScopeAndClean(rawExplanation, rawQuery, rank);

          if (query && !invalidLabels.has(query) && query !== originalQuery && results.length < 4) {
            results.push({
              rank,
              stage: stageNames[rank - 1] || `${rank}단계`,
              scope,
              query,
              explanation,
              distance: `${rank * 25}%`
            });
          }
          continue;
        }

        // '1. 감자: 설명' 또는 '1단계: 감자 - 설명' 패턴 (단, '1단계: 종류별 분류' 같은 헤더는 제외)
        const numberedMatch = line.match(/^(?:\[?([1-4])\]?[.)\s]+|[1-4]단계\s*[:：\-]\s*)([^|:–\-()]+?)(?:\s*[|:–\-]\s*(.+)|\s*\(([^)]+)\))$/);
        if (numberedMatch) {
          const rawQuery = numberedMatch[2];
          const query = cleanQueryStr(rawQuery);
          const rawExplanation = (numberedMatch[3] || numberedMatch[4] || '').trim();
          const rank = results.length + 1;
          const { scope, explanation } = extractScopeAndClean(rawExplanation, rawQuery, rank);

          if (
            query &&
            !invalidLabels.has(query) &&
            !query.endsWith('분류') &&
            query !== originalQuery &&
            results.length < 4
          ) {
            results.push({
              rank,
              stage: stageNames[rank - 1] || `${rank}단계`,
              scope,
              query,
              explanation,
              distance: `${rank * 25}%`
            });
          }
        }
      }
    }

    return results.slice(0, 4);
  }

  /**
   * Gemini Nano 활성화 전이거나 미지원 환경을 위한 스마트 연상 엔진
   */
  _generateFallbackQueries(originalQuery, direction, statusInfo) {
    const keywordsByVector = {
      category: ['대체재 비교 분석', `${originalQuery} 유사 분야 사례`, `${originalQuery} 파생 갈래`, `${originalQuery} 인접 카테고리 트렌드`],
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

    const pool = keywordsByVector[direction.id] || keywordsByVector.bio;

    return {
      source: 'fallback-heuristic',
      statusInfo,
      direction,
      originalQuery,
      queries: [
        {
          rank: 1,
          stage: '1단계: 미묘한 각도 (Tangent)',
          scope: '동일 소분류',
          query: `${originalQuery} ${pool[0].split(' ')[0]}`,
          explanation: `원래 개념의 맥락에서 '${pool[0].split(' ')[0]}'의 관점을 덧붙여 미세하게 비틀었습니다.`,
          distance: '25%'
        },
        {
          rank: 2,
          stage: '2단계: 유추적 도약 (Metaphor)',
          scope: '인접 중분류',
          query: pool[1],
          explanation: `'${direction.title}'의 원리를 적용하여 다른 분야의 메커니즘으로 도약했습니다.`,
          distance: '50%'
        },
        {
          rank: 3,
          stage: '3단계: 구조적 전도 (Inversion)',
          scope: '교차 대분류',
          query: pool[2],
          explanation: `보이지 않는 구조와 이면의 규칙을 조명하는 개념으로 전환했습니다.`,
          distance: '75%'
        },
        {
          rank: 4,
          stage: '4단계: 사유의 끝점 (Radical)',
          scope: '사유의 끝점',
          query: pool[3],
          explanation: `원래의 의도에서 벗어나 완전히 낯선 영토에 도달한 최종 사유의 조각입니다.`,
          distance: '100%'
        }
      ]
    };
  }
}

export const nanoEngine = new NanoDriftEngine();
