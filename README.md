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
3. **20가지 예술적·철학적 도약 벡터**:
   - 생물의 공생, 잊힌 과거의 의례, 쓸모없어진 미래의 잔해, 원인과 결과의 전도, 고장과 오작동, 감각의 치환, 보이지 않는 인프라 등 20가지 깊이 있는 사유의 렌즈를 제공합니다.
4. **4단계 점진적 탈선 (Semantic Drift)**:
   - `1단계 (미묘한 각도)` ➔ `2단계 (유추적 도약)` ➔ `3단계 (구조적 전도)` ➔ `4단계 (사유의 끝점)`
   - 사용자의 원래 의도에서 점차 멀어지며 뜻밖의 지적 발견(Serendipity)을 선사합니다.
5. **사유의 가지치기 (Branching Exploration)**:
   - 비틀려 나온 임의의 조각(키워드)을 클릭하면, 그 조각이 새로운 씨앗이 되어 사유의 궤적을 무한히 이어갈 수 있습니다.

---

## 📂 프로젝트 구조

```
chrome_extension/
├── manifest.json            # Manifest V3 확장 프로그램 설정 (Omnibox, SidePanel, ContentScript)
├── background.js            # 백그라운드 서비스 워커 (Omnibox 주소창 연동 & 메시징)
├── content.js               # 구글 검색 결과 페이지 인라인 궤적 바 및 검색 버튼 주입
├── content.css              # 구글 페이지 주입 위젯 스타일 (다크/라이트 융합)
├── sidepanel.html           # 크롬 네이티브 사이드패널 UI (인터랙티브 카드 스택)
├── sidepanel.css            # 사이드패널 스타일 (사이버 미니멀리즘 테마)
├── sidepanel.js             # 사이드패널 컨트롤러 & 사유의 궤적(Breadcrumbs) 관리
├── popup.html               # 툴바 팝업 UI (AI 상태 진단 & 바로가기)
├── popup.css                # 팝업 스타일
├── popup.js                 # 팝업 스크립트
├── icons/                   # 확장 프로그램 아이콘 (16, 48, 128)
├── src/
│   ├── vectors.js           # 사유 벡터(렌즈) 정의
│   ├── nano-engine.js       # Chrome Prompt API (Gemini Nano) 래퍼 & 연상 폴백
│   ├── search-fetcher.js    # 클라이언트 사이드 경량 검색/프리뷰 파서
│   └── storage.js           # 로컬 스토리지 & 히스토리 관리
├── GUIDE.md                 # 상세 설치 & Chrome Gemini Nano 플래그 활성화 가이드
└── README.md                # 프로젝트 개요 및 설명서
```

---

## 🚀 빠른 시작

1. Chrome에서 `chrome://extensions` 접속 ➔ **개발자 모드** 활성화
2. **[압축해제된 확장 프로그램을 로드합니다]** 클릭 ➔ 본 폴더 선택
3. 주소창에 `drift 인공지능` 입력하거나 `google.com`에서 검색하여 바로 체험!

> 세부 설정 및 Gemini Nano 플래그 켜는 법은 [GUIDE.md](GUIDE.md)를 참고하세요.

