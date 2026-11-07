document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const openPanelBtn = document.getElementById('open-panel-btn');
  const flagsGuideLink = document.getElementById('flags-guide-link');

  // AI 가용성 확인
  try {
    const status = await chrome.runtime.sendMessage({ type: 'CHECK_AI_STATUS' });
    if (status && status.status === 'ready') {
      statusDot.className = 'status-dot ready';
      statusTitle.textContent = 'Gemini Nano 준비 완료';
      statusDesc.textContent = 'Chrome 내장 온디바이스 AI가 백엔드 없이 완벽히 동작합니다.';
    } else if (status && status.status === 'downloading') {
      statusDot.className = 'status-dot downloading';
      statusTitle.textContent = '모델 로드 대기 중 (클릭 시 활성화)';
      statusDesc.textContent = '이미 다운로드된 모델 가중치를 메모리에 로드하려면 여기를 클릭하세요.';
      document.getElementById('status-card').style.cursor = 'pointer';
      document.getElementById('status-card').addEventListener('click', async () => {
        statusTitle.textContent = '모델 활성화 중... (잠시만 기다려주세요)';
        const res = await chrome.runtime.sendMessage({ type: 'WARMUP_MODEL' });
        if (res && res.success) {
          statusDot.className = 'status-dot ready';
          statusTitle.textContent = 'Gemini Nano 준비 완료';
          statusDesc.textContent = 'Chrome 내장 온디바이스 AI가 백엔드 없이 완벽히 동작합니다.';
        }
      });
    } else {
      statusDot.className = 'status-dot';
      statusTitle.textContent = '내장 연상 모드 작동 중';
      statusDesc.textContent = 'Prompt API 미활성화 상태입니다. 기본 연상 엔진으로 동작합니다.';
    }
  } catch (_) {
    statusTitle.textContent = '내장 연상 모드';
    statusDesc.textContent = '기본 연상 엔진으로 작동 중입니다.';
  }

  // 사이드패널 열기 버튼
  openPanelBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close(); // 팝업 닫기
    }
  });

  // 설정 가이드 링크 -> 스타일링된 guide.html 새 탭으로 열기
  flagsGuideLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
  });
});
