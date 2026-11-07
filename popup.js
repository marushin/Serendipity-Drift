import { nanoEngine } from './src/nano-engine.js';
import { storage } from './src/storage.js';

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const statusDot = $('status-dot');
  const statusTitle = $('status-title');
  const statusDesc = $('status-desc');
  const downloadBtn = $('download-btn');
  const downloadProgress = $('download-progress');
  const openPanelBtn = $('open-panel-btn');
  const flagsGuideLink = $('flags-guide-link');
  const autoRunToggle = $('auto-run-toggle');

  // sidePanel.open() 은 사용자 제스처 안에서 "곧바로" 호출해야 하므로
  // 창 ID 를 미리 받아 두고 클릭 핸들러에서는 await 없이 호출합니다.
  let windowId = null;
  const windowReady = chrome.windows.getCurrent().then((w) => { windowId = w.id; return w.id; });

  let modelStatus = 'unknown';

  function showStatus(dotClass, title, desc, { error = false } = {}) {
    statusDot.className = `status-dot ${dotClass}`.trim();
    statusTitle.textContent = title;
    statusDesc.textContent = desc;
    statusDesc.classList.toggle('is-error', error);
    downloadBtn.hidden = modelStatus !== 'downloading';
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
      showStatus('downloading', '모델 다운로드 필요',
        'Gemini Nano 모델을 아직 내려받지 않았습니다. 아래 버튼으로 다운로드를 시작하세요. 용량이 커서 시간이 걸릴 수 있습니다.');
    } else {
      showStatus('', '내장 연상 모드 작동 중',
        'Prompt API를 사용할 수 없어 미리 정해진 연상 키워드로 동작합니다. 아래 활성화 가이드를 확인하세요.');
    }
  }

  refreshStatus();

  // 모델 다운로드는 사용자 활성화가 필요하므로 팝업에서 직접 실행합니다.
  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = '다운로드 중...';
    downloadProgress.hidden = false;
    downloadProgress.removeAttribute('value'); // 진행률을 받기 전엔 불확정 표시
    showStatus('downloading', '모델 다운로드 중...', '팝업을 닫아도 다운로드는 브라우저에서 계속됩니다.');
    downloadBtn.hidden = false;

    const res = await nanoEngine.activateModel((loaded, total) => {
      const ratio = total ? loaded / total : loaded;
      downloadProgress.value = ratio;
      statusTitle.textContent = `모델 다운로드 중... ${Math.round(ratio * 100)}%`;
    });
    await chrome.runtime.sendMessage({ type: 'AI_STATUS_CHANGED' }).catch(() => {});

    downloadProgress.hidden = true;
    downloadBtn.disabled = false;
    downloadBtn.textContent = '⬇️ Gemini Nano 모델 다운로드';

    if (!res.success) {
      modelStatus = 'downloading';
      showStatus('downloading', '다운로드 실패', `${res.error || '알 수 없는 오류'} — 다시 시도하거나 가이드의 기기 요구사항을 확인하세요.`, { error: true });
      return;
    }
    refreshStatus();
  });

  // 사이드패널 열기
  openPanelBtn.addEventListener('click', async () => {
    if (!chrome.sidePanel?.open) return;
    try {
      if (windowId != null) {
        await chrome.sidePanel.open({ windowId }); // 제스처 유지: await 이전에 호출됨
      } else {
        // 드물게 창 ID 가 아직 없으면 기다린 뒤 시도 (제스처가 만료되면 실패할 수 있음)
        await chrome.sidePanel.open({ windowId: await windowReady });
      }
      window.close();
    } catch (err) {
      console.warn('Side panel open failed:', err);
      openPanelBtn.textContent = '사이드패널을 열 수 없습니다 — 다시 시도';
    }
  });

  // 자동 실행 설정
  storage.getSettings().then((s) => { autoRunToggle.checked = s.autoRun; });
  autoRunToggle.addEventListener('change', () => {
    storage.saveSettings({ autoRun: autoRunToggle.checked });
  });

  flagsGuideLink.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
  });
});
