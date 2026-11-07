import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBingImages, decodeEntities, squareThumb } from '../src/image-search.js';

const meta = (o) => `<a class="iusc" m="${JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" href="#">`;

test('Bing m 속성 파싱: 썸네일·원본·페이지·제목', () => {
  const html = [
    meta({ turl: 'https://ts1.mm.bing.net/th?id=OIP.a&pid=15.1', murl: 'https://ex.com/a.jpg', purl: 'https://ex.com/a', t: '바다 유령' }),
    meta({ turl: 'https://ts1.mm.bing.net/th?id=OIP.b&pid=15.1', murl: 'http://ex.com/b.jpg', purl: 'https://ex.com/b', t: 'B' })
  ].join('\n');

  const out = parseBingImages(html, 4);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, '바다 유령');
  assert.equal(out[0].full, 'https://ex.com/a.jpg');
  assert.equal(out[0].page, 'https://ex.com/a');
  assert.match(out[0].thumb, /^https:\/\/ts1\.mm\.bing\.net\/th\?id=OIP\.a&pid=15\.1&w=240&h=240&c=7$/);
  assert.equal(out[1].full, 'http://ex.com/b.jpg');
});

test('limit, 중복 제거, 깨진 JSON·위험한 URL 무시', () => {
  const html = [
    '<a class="iusc" m="{not json}">',
    `<div class="related" m="${JSON.stringify({ turl: 'https://ts1.mm.bing.net/th?id=other' }).replace(/"/g, '&quot;')}">`,
    meta({ turl: 'javascript:alert(1)', murl: 'https://x/y.jpg' }),
    meta({ turl: 'https://ts1.mm.bing.net/th?id=1' }),
    meta({ turl: 'https://ts1.mm.bing.net/th?id=1' }),
    meta({ turl: 'https://ts1.mm.bing.net/th?id=2', purl: 'javascript:void(0)' }),
    meta({ turl: 'https://ts1.mm.bing.net/th?id=3' })
  ].join('');

  const out = parseBingImages(html, 2);
  assert.equal(out.length, 2);
  assert.match(out[0].thumb, /id=1/);
  assert.match(out[1].thumb, /id=2/);
  assert.equal(out[1].page, null);
  assert.equal(out[0].full, 'https://ts1.mm.bing.net/th?id=1'); // murl 없으면 썸네일로 폴백
});

test('엔티티 디코딩 & 비 Bing 썸네일은 크롭 파라미터를 붙이지 않음', () => {
  assert.equal(decodeEntities('&quot;a&amp;b&#39;&#x41;'), '"a&b\'A');
  assert.equal(squareThumb('https://example.com/t.jpg'), 'https://example.com/t.jpg');
});
