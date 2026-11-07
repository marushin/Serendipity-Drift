import { nanoEngine } from './src/nano-engine.js';
import { storage } from './src/storage.js';

document.addEventListener('DOMContentLoaded', () => {
  const statusCard = document.getElementById('status-card');
  const statusDot = document.getElementById('status-dot');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const openPanelBtn = document.getElementById('open-panel-btn');
  const flagsGuideLink = document.getElementById('flags-guide-link');
  const autoRunToggle = document.getElementById('auto-run-toggle');

  // sidePanel.open() 은 사용자 제스처 안에서 "곧바로" 호출해야 하므로
  // 창 ID 를 미리 받아 두고 클릭 핸들러에서는 await 없이 호출합니다.
  let windowId = null;
  chrome.windows.getCurrent().then((w) => { windowId = w.id; });

  let modelStatus = 'unknown';

  function showStatus(dotClass, title, desc) {
    statusDot.className = `status-dot ${dotClass}`.trim();
    statusTitle.textContent = title;
    statusDesc.textContent = desc;
    statusCard.style.cursor = modelStatus === 'downloading' ? 'pointer' : 'default';
  }

  async function refreshStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CHECK_AI_STATUS', fresh: true });
      modelStatus = res?.data?.status || 'error';
    } catch (_) {
      modelStatus = 'error';
    }

    if (modelStatus === 'ready') {
      showStatus('ready', 'Gemini Nano 준비 완료', 'Chrome 내장 온디바이스 AI가 백엔드 없이 동작합니다.');
    } else if (modelStatus === 'downloading') {
      showStatus('downloading', '모델 다운로드 필요 (클릭하여 시작)',
        'Gemini Nano 모델을 아직 내려받지 않았습니다. 이 카드를 클릭하면 다운로드를 시작합니다. 수 GB 크기라 시간이 걸릴 수 있습니다.');
    } else {
      showStatus('', '내장 연상 모드 작동 중',
        'Prompt API를 사용할 수 없어 미리 정해진 연상 키워드로 동작합니다. 아래 활성화 가이드를 확인하세요.');
    }
  }

  refreshStatus();

  // 모델 다운로드는 사용자 활성화가 필요하므로 팝업(클릭이 일어난 페이지)에서 직접 실행합니다.
  statusCard.addEventListener('click', async () => {
    if (modelStatus !== 'downloading') return;
    modelStatus = 'activating';
    showStatus('downloading', '모델 다운로드 중...', '팝업을 닫아도 다운로드는 브라우저에서 계속됩니다.');

    const res = await nanoEngine.activateModel((loaded, total) => {
      const ratio = total ? loaded / total : loaded;
      statusTitle.textContent = `모델 다운로드 중... ${Math.round(ratio * 100)}%`;
    });
    await chrome.runtime.sendMessage({ type: 'AI_STATUS_CHANGED' }).catch(() => {});

    if (!res.success) {
      modelStatus = 'downloading';
      showStatus('downloading', '활성화 실패 (다시 클릭)', res.error || '알 수 없는 오류');
      return;
    }
    refreshStatus();
  });

  // 사이드패널 열기
  openPanelBtn.addEventListener('click', () => {
    if (!chrome.sidePanel?.open) return;
    const target = windowId != null ? { windowId } : null;
    if (!target) return;
    chrome.sidePanel.open(target).then(() => window.close()).catch((err) => {
      console.warn('Side panel open failed:', err);
    });
  });

  // 자동 실행 설정
  storage.getSettings().then((s) => { autoRunToggle.checked = s.autoRun; });
  autoRunToggle.addEventListener('change', () => {
    storage.saveSettings({ autoRun: autoRunToggle.checked });
  });

  flagsGuideLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
  });
});
