/**
 * 백엔드 서버 없이 브라우저 자체에서 검색 결과를 가져오는 클라이언트 사이드 검색 엔진
 * Manifest V3 host_permissions를 활용하며, Service Worker(DOMParser 부재)와 UI 컨텍스트 모두 지원합니다.
 */

export class ClientSearchFetcher {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 주어진 검색어의 웹 검색 결과를 가져옵니다.
   * @param {string} query 검색어
   * @param {number} limit 가져올 결과 개수 (기본 3개)
   */
  async search(query, limit = 3) {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    // 1. 메모리 캐시 확인
    if (this.cache.has(cleanQuery)) {
      return this.cache.get(cleanQuery);
    }

    // 2. chrome.storage 캐시 확인
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const key = `drift_search_${cleanQuery}`;
        const stored = await chrome.storage.local.get(key);
        if (stored && stored[key]) {
          this.cache.set(cleanQuery, stored[key]);
          return stored[key];
        }
      }
    } catch (_) {}

    let results = [];

    // 3. 1차 시도: Google 검색 직접 요청
    try {
      results = await this._searchGoogle(cleanQuery, limit);
    } catch (err) {
      console.warn(`[SearchFetcher] Google search failed for "${cleanQuery}":`, err.message);
    }

    // 4. 2차 시도: DuckDuckGo HTML 검색 폴백 (캡차/차단 없는 초경량 HTML)
    if (!results || results.length === 0) {
      try {
        results = await this._searchDuckDuckGo(cleanQuery, limit);
      } catch (err) {
        console.warn(`[SearchFetcher] DuckDuckGo fallback failed for "${cleanQuery}":`, err.message);
      }
    }

    // 5. 3차 시도: 위키백과 오픈 API (지식 백과 폴백)
    if (!results || results.length === 0) {
      try {
        results = await this._searchWikipedia(cleanQuery, limit);
      } catch (err) {
        console.warn(`[SearchFetcher] Wikipedia fallback failed for "${cleanQuery}":`, err.message);
      }
    }

    // 캐시에 보관
    if (results.length > 0) {
      this.cache.set(cleanQuery, results);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          const key = `drift_search_${cleanQuery}`;
          await chrome.storage.local.set({ [key]: results });
        } catch (_) {}
      }
    }

    return results;
  }

  /**
   * Google 검색 결과 파싱 (Service Worker 환경과 UI 환경 모두 호환)
   */
  async _searchGoogle(query, limit) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ko&gl=kr`;
    const response = await fetch(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!response.ok) throw new Error(`Google HTTP error ${response.status}`);
    const html = await response.text();

    if (typeof DOMParser !== 'undefined') {
      return this._parseGoogleWithDOM(html, query, limit);
    } else {
      return this._parseGoogleWithRegex(html, query, limit);
    }
  }

  _parseGoogleWithDOM(html, query, limit) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const results = [];
    const h3Elements = doc.querySelectorAll('h3');

    for (const h3 of h3Elements) {
      if (results.length >= limit) break;
      const title = h3.textContent.trim();
      if (!title || title.length < 2) continue;

      const anchor = h3.closest('a') || h3.parentElement?.closest('a');
      if (!anchor || !anchor.href) continue;

      let href = anchor.getAttribute('href') || anchor.href;
      if (href.startsWith('/url?')) {
        const urlParams = new URLSearchParams(href.substring(5));
        const realUrl = urlParams.get('q');
        if (realUrl) href = realUrl;
      }

      if (!href.startsWith('http://') && !href.startsWith('https://')) continue;
      if (href.includes('google.com/search')) continue;

      let snippet = '';
      const parentBlock = h3.closest('.g') || h3.parentElement?.parentElement;
      if (parentBlock) {
        const snippetEl = parentBlock.querySelector('.VwiC3b') || 
                          parentBlock.querySelector('[data-sncf]') ||
                          parentBlock.querySelector('div[style*="-webkit-line-clamp"]');
        snippet = snippetEl ? snippetEl.textContent.trim() : parentBlock.textContent.replace(title, '').slice(0, 160).trim();
      }

      results.push({
        query,
        title,
        url: href,
        snippet: snippet || `${query}에 관한 웹 검색 결과입니다.`,
        source: 'google',
        rank: results.length + 1
      });
    }

    return results;
  }

  _parseGoogleWithRegex(html, query, limit) {
    const results = [];
    // Service Worker 환경을 위한 안전한 HTML 정규식 파서
    const blockRegex = /<a\s+href="(\/url\?q=[^"]+|https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
    let match;

    while ((match = blockRegex.exec(html)) !== null && results.length < limit) {
      let url = match[1];
      if (url.startsWith('/url?q=')) {
        url = decodeURIComponent(url.replace('/url?q=', '').split('&')[0]);
      }
      if (url.includes('google.com/search')) continue;

      const title = match[2].replace(/<[^>]+>/g, '').trim();
      if (!title) continue;

      results.push({
        query,
        title,
        url,
        snippet: `${query}에 관한 구글 검색 결과입니다.`,
        source: 'google',
        rank: results.length + 1
      });
    }

    return results;
  }

  /**
   * DuckDuckGo HTML 검색 파싱
   */
  async _searchDuckDuckGo(query, limit) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=kr-kr`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) throw new Error(`DuckDuckGo HTTP error ${response.status}`);
    const html = await response.text();

    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const results = [];
      const resultElements = doc.querySelectorAll('.result');

      for (const el of resultElements) {
        if (results.length >= limit) break;
        const titleEl = el.querySelector('.result__title a');
        const snippetEl = el.querySelector('.result__snippet');
        if (!titleEl) continue;

        let link = titleEl.getAttribute('href');
        if (link && link.includes('uddg=')) {
          const match = link.match(/uddg=([^&]+)/);
          if (match) link = decodeURIComponent(match[1]);
        }

        const title = titleEl.textContent.trim();
        const snippet = snippetEl ? snippetEl.textContent.trim() : '';

        if (title && link) {
          results.push({
            query,
            title,
            url: link,
            snippet,
            source: 'duckduckgo',
            rank: results.length + 1
          });
        }
      }
      return results;
    } else {
      // Regex 폴백
      const results = [];
      const regex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h2 class="result__title">[\s\S]*?<a[^>]*>(.*?)<\/a>/gi;
      let match;
      while ((match = regex.exec(html)) !== null && results.length < limit) {
        let link = match[1];
        if (link.includes('uddg=')) {
          const m = link.match(/uddg=([^&]+)/);
          if (m) link = decodeURIComponent(m[1]);
        }
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        if (title && link) {
          results.push({
            query,
            title,
            url: link,
            snippet: `${title} 관련 웹페이지`,
            source: 'duckduckgo',
            rank: results.length + 1
          });
        }
      }
      return results;
    }
  }

  /**
   * 위키백과 OpenSearch API 파싱 (순수 JSON으로 항상 안전)
   */
  async _searchWikipedia(query, limit) {
    const endpoint = `https://ko.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json&origin=*`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Wikipedia HTTP error ${response.status}`);

    const data = await response.json();
    const titles = data[1] || [];
    const snippets = data[2] || [];
    const urls = data[3] || [];

    const results = [];
    for (let i = 0; i < titles.length && results.length < limit; i++) {
      if (titles[i] && urls[i]) {
        results.push({
          query,
          title: titles[i],
          url: urls[i],
          snippet: snippets[i] || `${titles[i]}에 대한 위키백과 항목입니다.`,
          source: 'wikipedia',
          rank: results.length + 1
        });
      }
    }

    return results;
  }
}

export const searchFetcher = new ClientSearchFetcher();
