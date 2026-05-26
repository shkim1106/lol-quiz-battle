const champions = require('../data/champions.json');
const items     = require('../data/items_simple.json');

const champList  = Object.values(champions);
const champNames = champList.map(c => c.name);

const itemList = Object.entries(items)
  .map(([id, v]) => ({ id, ...v }))
  .filter(i => i.name && i.total_gold > 0);
const itemNames   = itemList.map(i => i.name);
const descItems   = itemList.filter(i => i.plaintext?.length > 5);
const recipeItems = itemList.filter(i => i.from?.length  >= 1);
const intoItems   = itemList.filter(i => i.into?.length  >= 1);

const pick1  = arr => arr[Math.floor(Math.random() * arr.length)];
const pickN  = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

function makeChoices(correct, pool) {
  const wrongs = shuffle(pool.filter(x => x !== correct)).slice(0, 3);
  return shuffle([correct, ...wrongs]);
}

// 조사 쌍: 어느 쪽이 오든 두 형태를 모두 표시 (모음/자음 끝 힌트 방지)
const PARTICLE_PAIR = {
  '는': '는/은', '은': '는/은',
  '이': '이/가', '가': '이/가',
  '를': '를/을', '을': '를/을',
  '와': '와/과', '과': '와/과',
  '의': '의',    '도': '도',
};

// 텍스트 안에 포함된 챔피언 이름을 <b>[정답]</b> 으로 치환 (스포일러 방지)
function redactName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const particles = '(?:는|은|이|가|를|을|의|도|와|과)?';
  return text.replace(
    new RegExp(escaped + particles, 'g'),
    m => {
      const particle = m.slice(name.length);
      const display  = PARTICLE_PAIR[particle] ?? particle;
      return '<b>[정답]</b>' + display;
    }
  );
}

const generators = {

  price() {
    const [a, b, c] = pickN(itemList.filter(i => i.total_gold >= 300), 3);
    const r = Math.random();
    let question, answer;
    if (r < 0.34) {
      question = `<b>${a.name}</b> + <b>${b.name}</b> = ?G`;
      answer   = a.total_gold + b.total_gold;
    } else if (r < 0.67) {
      question = `<b>${a.name}</b> + <b>${b.name}</b> − <b>${c.name}</b> = ?G`;
      answer   = a.total_gold + b.total_gold - c.total_gold;
    } else {
      question = `<b>${a.name}</b> × 2 − <b>${b.name}</b> = ?G`;
      answer   = a.total_gold * 2 - b.total_gold;
    }
    return {
      type: 'input', label: '💰 가격 계산',
      // hint 제거: 가격을 외웠는지 확인하는 문제
      question, answer, tolerance: 0.08,
    };
  },

  description() {
    const item = pick1(descItems);
    return {
      type: 'choice', label: '🔍 아이템 설명 맞추기',
      question: `다음 설명의 아이템은?<br><br><em>"${item.plaintext}"</em>`,
      options: makeChoices(item.name, itemNames),
      answer:  item.name,
    };
  },

  recipe() {
    const item    = pick1(recipeItems);
    const correct = pick1(item.from);
    return {
      type: 'choice', label: '📦 재료 아이템 맞추기',
      question: `<b>${item.name}</b> (${item.total_gold}G)<br><br>이 아이템의 <u>재료</u>로 사용되는 아이템은?`,
      options: makeChoices(correct, itemNames),
      answer:  correct,
    };
  },

  into() {
    const item    = pick1(intoItems);
    const correct = pick1(item.into);
    return {
      type: 'choice', label: '⬆️ 상위 아이템 맞추기',
      question: `<b>${item.name}</b> (${item.total_gold}G)<br><br>이 아이템으로 조합할 수 있는 <u>상위 아이템</u>은?`,
      options: makeChoices(correct, itemNames),
      answer:  correct,
    };
  },

  skill() {
    const champ  = pick1(champList);
    const spells = Object.values(champ.spells);
    return {
      type: 'choice', label: '⚡ 스킬로 챔피언 맞추기',
      question:
        `다음 스킬을 가진 챔피언은?<br><br>` +
        `패시브: <b>${champ.passive.name}</b><br>` +
        `Q: <b>${spells[0].name}</b><br>` +
        `W: <b>${spells[1].name}</b>`,
      options: makeChoices(champ.name, champNames),
      answer:  champ.name,
    };
  },

  lore() {
    const champ   = pick1(champList.filter(c => c.lore?.length > 50));
    const snippet = redactName(champ.lore.slice(0, 110) + '…', champ.name);
    return {
      type: 'choice', label: '📖 로어로 챔피언 맞추기',
      question: `다음 배경 스토리의 챔피언은?<br><br><em>"${snippet}"</em>`,
      options: makeChoices(champ.name, champNames),
      answer:  champ.name,
    };
  },

  tip() {
    const champ = pick1(champList.filter(c => c.allytips?.length > 0));
    const tip   = redactName(pick1(champ.allytips), champ.name);
    return {
      type: 'choice', label: '💡 아군 팁으로 챔피언 맞추기',
      question: `다음 아군 팁은 어떤 챔피언에 대한 설명인가요?<br><br><em>"${tip}"</em>`,
      options: makeChoices(champ.name, champNames),
      answer:  champ.name,
    };
  },

  title() {
    const champ = pick1(champList.filter(c => c.title));
    // 칭호에 이름이 포함되는 경우도 처리
    const title = redactName(champ.title, champ.name);
    return {
      type: 'choice', label: '🏷️ 칭호로 챔피언 맞추기',
      question: `다음 칭호를 가진 챔피언은?<br><br><em>"${title}"</em>`,
      options: makeChoices(champ.name, champNames),
      answer:  champ.name,
    };
  },
};

const MODES = [
  { id: 'price',       label: '💰 가격 계산' },
  { id: 'description', label: '🔍 아이템 설명 맞추기' },
  { id: 'recipe',      label: '📦 재료 아이템 맞추기' },
  { id: 'into',        label: '⬆️ 상위 아이템 맞추기' },
  { id: 'skill',       label: '⚡ 스킬로 챔피언 맞추기' },
  { id: 'lore',        label: '📖 로어로 챔피언 맞추기' },
  { id: 'tip',         label: '💡 아군 팁으로 챔피언 맞추기' },
  { id: 'title',       label: '🏷️ 칭호로 챔피언 맞추기' },
];

// 클라이언트에 보낼 때 answer 제거
function sanitize(quiz) {
  const { answer, tolerance, ...safe } = quiz;
  return safe;
}

module.exports = { generators, MODES, sanitize };
