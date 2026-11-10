# 🌐 Serendipity Drift (비틀린 사유의 궤적)
> **Chrome Built-in AI (Gemini Nano) 기반의 백엔드 없는 온디바이스 사유 탈선 탐색기**

[art-hackathon](https://github.com/kanghohyeong/art-hackathon)의 "검색어를 점진적으로 비틀어 의도에서 벗어난 낯선 결과를 탐색하는 철학"에서 출발하여, **외부 백엔드 서버나 유료 API(OpenAI/Anthropic/SerpAPI) 없이 Chrome 브라우저에 내장된 모델과 크롬 검색창 자체를 활용하도록 재창조**한 프로젝트입니다.

---

## 💡 프로젝트 핵심 컨셉

1. **완전한 온디바이스 (Zero Backend, 100% On-Device)**:
   - 외부 서버도, API Key도 필요 없습니다.
   - 크롬 브라우저 내장 **Gemini Nano (Prompt API)**가 모든 연산과 창의적 도약을 기기 로컬에서 수행합니다.
2. **크롬 검색창 네이티브 융합 (Zero Search API)**:
   - 유료 검색 API(SerpAPI 등)를 쓰지 않습니다.
   - 브라우저 주소창(Omnibox), 구글 검색 페이지, 사이드패널에서 크롬 자체의 검색창 기능을 그대로 활용합니다.
3. **16가지 사유 벡터**:
   - 손과 도구의 숙련, 날씨와 계절, 지도 위의 길, 아이의 엉뚱한 질문, 부엌과 발효, 밤과 꿈, 빛과 색, 높이와 깊이 등 16가지 사유의 렌즈를 제공합니다.
4. **4단계 점진적 탈선 (Semantic Drift)**:
   - `1단계 (미묘한 각도)` ➔ `2단계 (유추적 도약)` ➔ `3단계 (구조적 전도)` ➔ `4단계 (사유의 끝점)`
   - 사용자의 원래 의도에서 점차 멀어지며 뜻밖의 지적 발견(Serendipity)을 선사합니다.
   - **문장형 검색어**(어절 4개 이상, 또는 조사·어미가 있는 3어절)는 단어 하나로 줄이지 않습니다. 1·2단계는 문장 틀을 유지한 채 요소만 바꾸고, 3단계에서 틀을 풀어 4단계에서 키워드로 도약합니다.
5. **사유의 가지치기 (Branching Exploration)**:
   - 비틀려 나온 임의의 조각(키워드)을 클릭하면, 그 조각이 새로운 씨앗이 되어 사유의 궤적을 무한히 이어갈 수 있습니다.

---

## 📂 프로젝트 구조

```
chrome_extension/
├── manifest.json            # Manifest V3 확장 프로그램 설정 (Omnibox, SidePanel, ContentScript)
├── background.js            # 서비스 워커 (Omnibox, 메시징, 결과 LRU 캐시, 엔진 호스트 선택)
├── offscreen.html / .js     # SW에 Prompt API가 없을 때 Gemini Nano를 실행하는 숨은 문서
├── content.js               # 구글 웹 검색 결과 페이지 인라인 궤적 바 및 홈 검색 버튼 주입
├── content.css              # 구글 페이지 주입 위젯 스타일 (다크/라이트 융합)
├── stage-eye.js             # 단계별 눈알 아이콘 SVG (콘텐츠 스크립트·사이드패널 공용)
├── sidepanel.html           # 크롬 네이티브 사이드패널 UI (인터랙티브 카드 스택)
├── sidepanel.css            # 사이드패널 스타일 (사이버 미니멀리즘 테마)
├── sidepanel.js             # 사이드패널 컨트롤러 & 사유의 궤적(Breadcrumbs) 관리
├── popup.html               # 툴바 팝업 UI (AI 상태 진단 & 바로가기)
├── popup.css                # 팝업 스타일
├── popup.js                 # 팝업 스크립트
├── icons/                   # 확장 프로그램 아이콘 (16, 48, 128)
├── src/
│   ├── vectors.js           # 기본 모드 + 16가지 사유 벡터(렌즈) 정의
│   ├── nano-engine.js       # Chrome Prompt API (Gemini Nano) 래퍼, 응답 파서 & 연상 폴백
│   ├── lru-cache.js         # 크기 제한 LRU 캐시
│   ├── utils.js             # 공용 헬퍼 (escapeHtml 등)
│   └── storage.js           # 사용자 설정 저장 (자동 실행 여부)
├── tests/                   # 파서·세션 관리 단위 테스트 (node --test)
├── scripts/package.ps1      # 배포용 zip 생성 (dist/)
├── GUIDE.md                 # 상세 설치 & Chrome Gemini Nano 플래그 활성화 가이드
└── README.md                # 프로젝트 개요 및 설명서
```

### 아키텍처 메모

- **엔진 호스트**: Prompt API가 서비스 워커에 노출되면 SW에서 바로 실행하고, 아니면 `offscreen.html`에서 실행합니다. 모든 호출은 `background.js`의 `callEngine()`을 거칩니다.
- **모델 다운로드**: `LanguageModel.create()`는 모델이 없을 때 사용자 클릭(user activation)이 필요하므로, 팝업·사이드패널이 클릭 핸들러에서 `nanoEngine.activateModel()`을 직접 호출합니다.
- **세션**: 시스템 프롬프트별 베이스 세션을 캐시하고 요청마다 `clone()` 한 1회용 세션을 사용·파기합니다.
- **캐시**: Gemini Nano 결과만 메모리 LRU(60개)에 보관하며, 폴백 결과는 캐시하지 않습니다. 탐색 기록은 저장하지 않습니다.
- **테마**: 모든 색은 CSS 토큰으로만 정의하고 다크 모드는 토큰만 덮어씁니다. 배경용(`*-fill`)과 글자용(`*-text`) 색을 분리해 대비(WCAG AA)를 보장합니다. 구글 페이지 위젯은 OS 설정이 아니라 **구글 페이지 자체의 테마**를 따릅니다.
- **이미지 모드 (2.0)**: 단계별 비틀린 키워드마다 썸네일 4장을 보여줍니다. Google 이미지는 JS 실행 없이 결과를 주지 않으므로, `src/image-search.js`가 Bing 이미지 검색 HTML의 결과 타일(`a.iusc`의 `m` 메타데이터)을 API 키 없이 파싱합니다. 결과는 메모리 LRU(120개)에 캐시합니다. 썸네일 클릭 → 확대 보기(`<dialog>`) → "원본 페이지 ↗".
- **동영상 모드 (2.0)**: 단계별 키워드마다 YouTube 영상 4개(16:9 썸네일 + 재생 시간)를 보여줍니다. `src/video-search.js`가 YouTube 검색 결과 HTML의 `ytInitialData`에서 `videoRenderer`를 API 키 없이 추출합니다. 확장 페이지 안 임베드는 YouTube가 막으므로(오류 153) 썸네일 클릭 시 본창에서 재생합니다.
- **본창 = 보는 화면**: 0단계(원래 검색어의 구글 이미지 `udm=2` / 동영상 `udm=7` 결과), 동영상 재생, 이미지 "원본 페이지 ↗"는 모두 본창에 띄웁니다. 구글·YouTube·새 탭, 그리고 확장이 직전에 연 탭은 그 자리에서 바꾸고, 다른 사이트를 보고 있으면 새 탭으로 엽니다.
- **권한**: `sidePanel`, `storage`, `tabs`, `offscreen`과 미디어 검색용 호스트 권한 `https://www.bing.com/*`, `https://www.youtube.com/*`을 사용하며, 콘텐츠 스크립트는 `www.google.com` / `www.google.co.kr`의 홈·검색 페이지에만 주입됩니다.

## 🧪 개발

```bash
npm test           # 파서·세션 단위 테스트 (Node 18+)
npm run package    # dist/serendipity-drift-v<버전>.zip 생성
```

---

## 🚀 빠른 시작

1. Chrome에서 `chrome://extensions` 접속 ➔ **개발자 모드** 활성화
2. **[압축해제된 확장 프로그램을 로드합니다]** 클릭 ➔ 본 폴더 선택
3. 주소창에 `drift 인공지능` 입력하거나 `google.com`에서 검색하여 바로 체험!

> 세부 설정 및 Gemini Nano 플래그 켜는 법은 [GUIDE.md](GUIDE.md)를 참고하세요.

