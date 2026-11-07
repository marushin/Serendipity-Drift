import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelResponse,
  parsePhraseResponse,
  splitPhrasesHeuristically,
  cleanQueryStr,
  NanoDriftEngine
} from '../src/nano-engine.js';

const queries = (r) => r.map((x) => x.query);

test('표준 [n] 검색어 | [범위] 이유 형식', () => {
  const text = `[1] 토란 | [동일 소분류] 같은 뿌리채소입니다.
[2] 군밤 | [인접 중분류] 겨울 간식입니다.
[3] 전투식량 | [교차 대분류] 비상식량입니다.
[4] 스발바르 국제 종자 저장고 | [사유의 끝점] 농업 유산입니다.`;
  const r = parseModelResponse(text, '고구마');
  assert.deepEqual(queries(r), ['토란', '군밤', '전투식량', '스발바르 국제 종자 저장고']);
  assert.equal(r[0].scope, '동일 소분류');
  assert.equal(r[0].explanation, '같은 뿌리채소입니다.');
  assert.equal(r[3].distance, '100%');
});

test('"1단계: 검색어 | 이유" 형식에서 "단계" 라벨이 검색어에 섞이지 않음', () => {
  const text = `1단계: 토란 | 대체재
2단계: 군밤 | 간식
3단계: 전투식량 | 생존`;
  assert.deepEqual(queries(parseModelResponse(text, '고구마')), ['토란', '군밤', '전투식량']);
});

test('마크다운 볼드 및 불릿 제거', () => {
  const text = `- **[1] 구글 픽셀** | 대안 기기
- **[2] 전자책 리더기** | 휴대용 스크린`;
  assert.deepEqual(queries(parseModelResponse(text, '아이폰')), ['구글 픽셀', '전자책 리더기']);
});

test('알 수 없는 대괄호 접두사도 설명에서 분리', () => {
  const r = parseModelResponse(`[1] 토란 | [기타 분류] 설명입니다.\n[2] 군밤 | 간식`, '고구마');
  assert.equal(r[0].scope, '기타 분류');
  assert.equal(r[0].explanation, '설명입니다.');
  assert.equal(r[1].scope, '인접 중분류'); // 기본 범위
});

test('파이프 없는 번호 목록 (2차 패스)', () => {
  const text = `1. 토란 - 같은 뿌리채소
2. 군밤 - 겨울 간식
3) 전투식량 (비상식량)`;
  assert.deepEqual(queries(parseModelResponse(text, '고구마')), ['토란', '군밤', '전투식량']);
});

test('"검색어: ..." 형식 (2차 패스)', () => {
  const text = `* 검색어: "토란" (뿌리채소)
* 검색어: "군밤" (간식)`;
  assert.deepEqual(queries(parseModelResponse(text, '고구마')), ['토란', '군밤']);
});

test('원본 검색어·중복·헤더 라벨 제외', () => {
  const text = `[1] 고구마 | 원본
[2] 토란 | a
[3] 토란 | 중복
[4] 검색어 | 라벨`;
  assert.deepEqual(queries(parseModelResponse(text, '고구마')), ['토란']);
});

test('하이픈이 포함된 검색어 보존', () => {
  const r = parseModelResponse(`[1] p-n 접합 | 반도체\n[2] 상전이 | 물질`, '경계');
  assert.equal(r[0].query, 'p-n 접합');
});

test('빈 입력', () => {
  assert.deepEqual(parseModelResponse('', 'x'), []);
  assert.deepEqual(parseModelResponse(undefined, 'x'), []);
});

test('cleanQueryStr', () => {
  assert.equal(cleanQueryStr('[동일 소분류] "토란"'), '토란');
  assert.equal(cleanQueryStr('검색어: 토란'), '토란');
  assert.equal(cleanQueryStr('[메모] 토란'), '토란');
});

test('구절 응답 파싱: 번호·불릿 제거, 하이픈 단어 보존', () => {
  const r = parsePhraseResponse(`1. 빛과 연기로\n- 신호를 주고받던\n• 고대 네트워크\np-n 접합`);
  assert.deepEqual(r, ['빛과 연기로', '신호를 주고받던', '고대 네트워크', 'p-n 접합']);
});

test('규칙 기반 구절 분해', () => {
  assert.deepEqual(splitPhrasesHeuristically('가, 나다'), ['가', '나다']);
  assert.equal(splitPhrasesHeuristically('a b c d e f g h').length, 4);
});

test('Prompt API 미지원 환경에서는 폴백 결과를 반환', async () => {
  const engine = new NanoDriftEngine();
  const r = await engine.generateDriftQueries('고구마', { id: 'category', title: 't', prompt: 'p' });
  assert.equal(r.source, 'fallback-heuristic');
  assert.equal(r.queries.length, 4);
  assert.ok(r.queries.every((q) => q.query.startsWith('고구마')));
});

test('세션: clone 으로 1회용 세션을 만들고 베이스는 재사용', async () => {
  let created = 0;
  let destroyed = 0;
  const makeSession = () => ({
    prompt: async () => '[1] 토란 | a\n[2] 군밤 | b',
    clone: async () => makeSession(),
    destroy: () => { destroyed++; }
  });
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async () => { created++; return makeSession(); }
  };
  try {
    const engine = new NanoDriftEngine();
    const dir = { id: 'category', title: 't', prompt: 'p' };
    const [a, b] = await Promise.all([
      engine.generateDriftQueries('고구마', dir),
      engine.generateDriftQueries('감자', dir)
    ]);
    assert.equal(a.source, 'gemini-nano');
    assert.equal(b.source, 'gemini-nano');
    assert.equal(created, 1, '동시 요청에도 베이스 세션은 한 번만 생성');
    assert.equal(destroyed, 2, '1회용 clone 세션은 모두 파기');
  } finally {
    delete globalThis.LanguageModel;
  }
});

test('세션: clone 미지원 환경에서는 매 요청 새 세션을 만들고 파기', async () => {
  let created = 0;
  let destroyed = 0;
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async () => {
      created++;
      return { prompt: async () => '[1] 토란 | a\n[2] 군밤 | b', destroy: () => { destroyed++; } };
    }
  };
  try {
    const engine = new NanoDriftEngine();
    const dir = { id: 'category', title: 't', prompt: 'p' };
    await engine.generateDriftQueries('고구마', dir);
    await engine.generateDriftQueries('감자', dir);
    assert.equal(created, 2);
    assert.equal(destroyed, 2);
  } finally {
    delete globalThis.LanguageModel;
  }
});
