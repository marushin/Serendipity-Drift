/**
 * 크기 제한이 있는 LRU 캐시 (Map 의 삽입 순서를 이용)
 */
export class LruCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    // 최근 사용으로 갱신
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key) {
    return this.map.has(key);
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      this.map.delete(this.map.keys().next().value);
    }
    return this;
  }

  get size() {
    return this.map.size;
  }
}
