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

const short = (id, a11y, primary) => ({
  shortsLockupViewModel: {
    accessibilityText: a11y,
    onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id } } },
    ...(primary ? { overlayMetadata: { primaryText: { content: primary } } } : {})
  }
});

test('일반 영상이 모자라면 쇼츠로 채움 (일반 영상 우선)', () => {
  const data = {
    a: [
      short('SSSSSSSSSS1', '녹슨 우체통 하나가 서 있었어., 조회수 12회 - Shorts 동영상 재생'),
      short('SSSSSSSSSS2', 'x', '오버레이 제목'),
      short('SSSSSSSSSS3', '셋째 쇼츠, 조회수 1회 - Shorts 동영상 재생')
    ],
    b: [vr('VVVVVVVVVVV', '일반 영상')]
  };

  const out = parseYouTubeResults(data, 3);
  assert.deepEqual(out.map((v) => v.id), ['VVVVVVVVVVV', 'SSSSSSSSSS1', 'SSSSSSSSSS2']);
  assert.equal(out[0].isShort, false);
  assert.equal(out[1].isShort, true);
  assert.equal(out[1].title, '녹슨 우체통 하나가 서 있었어.');
  assert.equal(out[1].page, 'https://www.youtube.com/shorts/SSSSSSSSSS1');
  assert.equal(out[2].title, '오버레이 제목');
});
