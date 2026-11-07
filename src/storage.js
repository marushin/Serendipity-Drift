/**
 * 로컬 스토리지 및 세션 히스토리 관리
 * 검색어 비틀기 기록, 브랜치 트리 및 사용자 설정 저장
 */

const HISTORY_KEY = 'serendipity_drift_history';
const SETTINGS_KEY = 'serendipity_drift_settings';

export const storage = {
  /**
   * 사용자 설정 가져오기
   */
  async getSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get(SETTINGS_KEY);
        return Object.assign({
          autoDetect: true,
          preferredVector: 'category',
          resultsPerStage: 2,
          driftIntensity: 'progressive' // 'gentle' | 'progressive' | 'radical'
        }, data[SETTINGS_KEY] || {});
      }
    } catch (_) {}
    return {
      autoDetect: true,
      preferredVector: 'category',
      resultsPerStage: 2,
      driftIntensity: 'progressive'
    };
  },

  /**
   * 사용자 설정 저장
   */
  async saveSettings(newSettings) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const current = await this.getSettings();
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...newSettings } });
      }
    } catch (_) {}
  },

  /**
   * 탐색 히스토리 가져오기
   */
  async getHistory() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get(HISTORY_KEY);
        return data[HISTORY_KEY] || [];
      }
    } catch (_) {}
    return [];
  },

  /**
   * 히스토리에 새 드리프트 세션 추가
   */
  async addHistoryEntry(entry) {
    try {
      const history = await this.getHistory();
      const newEntry = {
        id: 'drift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        timestamp: Date.now(),
        ...entry
      };
      // 최근 50개 유지
      const updated = [newEntry, ...history].slice(0, 50);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [HISTORY_KEY]: updated });
      }
      return newEntry;
    } catch (err) {
      console.warn('[Storage] Failed to add history:', err);
    }
  },

  /**
   * 히스토리 초기화
   */
  async clearHistory() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(HISTORY_KEY);
      }
    } catch (_) {}
  }
};

