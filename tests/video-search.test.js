import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInitialData, parseYouTubeResults } from '../src/video-search.js';

const vr = (id, title, extra = {}) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: '채널' }] },
    lengthText: { simpleText: '1:23' },
    ...extra
  }
});

test('ytInitialData 추출 (var / window[] 두 형태)', () => {
  const a = '<script>var ytInitialData = {"a":1};</script>';
  const b = '<script>window["ytInitialData"] = {"b":{"c":"};"}};</script>';
  assert.deepEqual(extractInitialData(a), { a: 1 });
  assert.deepEqual(extractInitialData(b), { b: { c: '};' } });
  assert.equal(extractInitialData('<html></html>'), null);
});

test('videoRenderer 수집: 순서 유지, 중복·잘못된 ID 제외, limit', () => {
  const data = {
    contents: [
      { shelf: { items: [vr('AAAAAAAAAAA', '첫째'), vr('bad', '잘못된 ID')] } },
      { reelItemRenderer: { videoId: 'SHORTSxxxxx' } },
      vr('AAAAAAAAAAA', '중복'),
      vr('BBBBBBBBB-_', '둘째', { lengthText: undefined }),
      vr('CCCCCCCCCCC', '셋째')
    ]
  };

  const out = parseYouTubeResults(data, 2);
  assert.deepEqual(out.map((v) => v.id), ['AAAAAAAAAAA', 'BBBBBBBBB-_']);
  assert.equal(out[0].title, '첫째');
  assert.equal(out[0].channel, '채널');
  assert.equal(out[0].duration, '1:23');
  assert.equal(out[1].duration, ''); // 라이브
  assert.equal(out[0].thumb, 'https://i.ytimg.com/vi/AAAAAAAAAAA/mqdefault.jpg');
  assert.equal(out[0].page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
});
