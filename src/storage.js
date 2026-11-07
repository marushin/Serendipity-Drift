/**
 * 사용자 설정 저장소 (chrome.storage.local)
 *
 * 탐색 기록은 개인정보 보호와 저장 공간을 위해 더 이상 영구 저장하지 않습니다.
 * (사이드패널의 '사유의 궤적'은 패널이 열려 있는 동안 메모리에만 유지됩니다.)
 *
 * ⚠️ content.js 는 ES 모듈을 import 할 수 없어 SETTINGS_KEY 와 기본값을 직접 복제해 사용합니다.
 *    키나 기본값을 바꾸면 content.js 의 같은 상수도 함께 수정하세요.
 */

export const SETTINGS_KEY = 'serendipity_drift_settings';

export const DEFAULT_SETTINGS = Object.freeze({
  /** 구글 검색 결과 페이지에서 비틀기를 자동 실행할지 여부 (false 면 버튼을 눌러야 실행) */
  autoRun: true
});

/** 이전 버전이 남긴, 더 이상 쓰지 않는 키 */
const LEGACY_KEY_PREFIXES = ['drift_search_'];
const LEGACY_KEYS = ['serendipity_drift_history'];

export const storage = {
  async getSettings() {
    try {
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  },

  async saveSettings(patch) {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  },

  /**
   * 구버전의 무제한 검색 캐시(drift_search_*)와 탐색 기록을 정리합니다.
   */
  async removeLegacyData() {
    const all = await chrome.storage.local.get(null);
    const stale = Object.keys(all).filter(
      (k) => LEGACY_KEYS.includes(k) || LEGACY_KEY_PREFIXES.some((p) => k.startsWith(p))
    );
    if (stale.length > 0) await chrome.storage.local.remove(stale);
    return stale.length;
  }
};
