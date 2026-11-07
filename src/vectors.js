/**
 * 사유 벡터(렌즈) 정의.
 * 각 벡터는 검색어를 어느 쪽으로 비틀지 Gemini Nano 에게 알려 주는 한 줄 안내문입니다.
 * 첫 항목(category)은 벡터를 고르지 않았을 때 쓰는 기본 모드입니다.
 */
export const DEFAULT_VECTOR_ID = 'category';

export const DRIFT_VECTORS = [
  {
    id: 'category',
    title: '관련 카테고리 내 변환 (기본)',
    icon: '🗂️',
    prompt: '주제어를 관련 카테고리내에서 바꿔라'
  },
  {
    id: 'craft',
    title: '손과 도구의 숙련',
    icon: '🛠️',
    prompt: '이것을 만들고 고치는 사람의 손놀림과 연장에 주목한 뒤, 전혀 다른 직업의 숙련 기술로 건너가세요.'
  },
  {
    id: 'weather',
    title: '날씨와 계절의 변덕',
    icon: '🌦️',
    prompt: '이것이 비·바람·더위·추위를 만나면 어떻게 달라지는지 떠올리고, 하늘과 계절이 빚는 현상으로 건너가세요.'
  },
  {
    id: 'map',
    title: '지도 위의 길',
    icon: '🗺️',
    prompt: '이것을 지도에 올려 지명·경로·지형으로 바꿔 읽고, 길을 내고 땅을 재는 일의 세계로 건너가세요.'
  },
  {
    id: 'child',
    title: '아이의 엉뚱한 질문',
    icon: '🧒',
    prompt: '이것을 처음 본 아이가 던질 법한 "왜?"를 하나 고르고, 그 답을 실제로 연구하는 분야로 건너가세요.'
  },
  {
    id: 'kitchen',
    title: '부엌과 발효',
    icon: '🍳',
    prompt: '이것을 썰고 끓이고 삭히고 묵히는 부엌의 일로 옮겨 보고, 조리와 저장의 지혜가 닿는 뜻밖의 영역으로 건너가세요.'
  },
  {
    id: 'word',
    title: '이름과 말의 뿌리',
    icon: '🔤',
    prompt: '이것의 이름이 어디서 왔는지, 다른 언어에서는 무엇이라 부르는지 따라가며 말이 세상을 가르는 방식으로 건너가세요.'
  },
  {
    id: 'shape',
    title: '숫자와 도형',
    icon: '📐',
    prompt: '이것 안에 숨은 비율·대칭·반복 무늬를 찾아내고, 같은 수학적 모양을 가진 엉뚱한 대상으로 건너가세요.'
  },
  {
    id: 'night',
    title: '밤과 꿈',
    icon: '🌙',
    prompt: '모두가 잠든 한밤중의 이것을 상상하고, 어둠·잠·꿈 속에서만 벌어지는 일로 건너가세요.'
  },
  {
    id: 'body',
    title: '몸과 자세',
    icon: '🫀',
    prompt: '이것을 다룰 때 사람 몸이 취하는 자세·호흡·근육의 쓰임을 떠올리고, 몸을 다루는 다른 기예로 건너가세요.'
  },
  {
    id: 'paper',
    title: '서류와 절차',
    icon: '📎',
    prompt: '이것에 따라붙는 서식·도장·분류 번호·인허가 절차를 상상하고, 행정과 문서가 만들어 낸 기묘한 제도로 건너가세요.'
  },
  {
    id: 'abroad',
    title: '낯선 도시의 일상',
    icon: '🧳',
    prompt: '지구 반대편 어느 도시에서 이것의 자리를 대신하는 물건이나 풍습을 찾아, 그곳의 일상으로 건너가세요.'
  },
  {
    id: 'stage',
    title: '무대와 연출',
    icon: '🎬',
    prompt: '이것을 무대 위 소품이나 한 장면으로 세워 보고, 조명·분장·특수효과 같은 연출의 기술로 건너가세요.'
  },
  {
    id: 'archive',
    title: '수집과 분류',
    icon: '🗃️',
    prompt: '이것만 평생 모은 수집가의 진열장을 상상하고, 표본·목록·보존 처리를 다루는 세계로 건너가세요.'
  },
  {
    id: 'light',
    title: '빛과 색',
    icon: '🌈',
    prompt: '이것의 색·광택·그림자가 어떻게 생기는지 들여다보고, 안료와 빛을 다루는 과학이나 예술로 건너가세요.'
  },
  {
    id: 'water',
    title: '물과 흐름',
    icon: '🌊',
    prompt: '이것을 흐르고 고이고 넘치는 물길에 빗대어 보고, 강·바다·조류가 움직이는 원리로 건너가세요.'
  },
  {
    id: 'depth',
    title: '높이와 깊이',
    icon: '🏔️',
    prompt: '이것을 산꼭대기나 땅속·바닷속 깊은 곳으로 가져갔다고 상상하고, 그 고도와 깊이에서만 만나는 것으로 건너가세요.'
  }
];

export function pickRandomVector() {
  return DRIFT_VECTORS[Math.floor(Math.random() * DRIFT_VECTORS.length)];
}

export function findVector(id) {
  return DRIFT_VECTORS.find((v) => v.id === id) ?? DRIFT_VECTORS[0];
}
