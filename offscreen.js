/**
 * 오프스크린 문서의 엔진 호스트.
 * background.js 가 { target: 'offscreen', type: 'ENGINE_CALL', method, args } 로 호출합니다.
 */
import { nanoEngine } from './src/nano-engine.js';

const ALLOWED_METHODS = new Set([
  'checkAvailability',
  'invalidateAvailability',
  'generateDriftQueries',
  'deconstructSentenceToPhrases'
]);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'ENGINE_CALL') return false;

  if (!ALLOWED_METHODS.has(msg.method)) {
    sendResponse({ ok: false, error: `허용되지 않은 엔진 메서드: ${msg.method}` });
    return false;
  }

  Promise.resolve()
    .then(() => nanoEngine[msg.method](...(msg.args || [])))
    .then(
      (value) => sendResponse({ ok: true, value }),
      (err) => sendResponse({ ok: false, error: err?.message || String(err) })
    );
  return true;
});
