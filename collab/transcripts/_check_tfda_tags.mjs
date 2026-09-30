// 交件前自我檢查：collab/transcripts/tfda_tags.json
// 1) 1895 筆、key 跟 tfda_remaining.tsv 一一對應（沒有漏、沒有多、沒有重複）
// 2) allergen_tags 與 likely 只用 11 個合法詞
// 3) vegan:true 的不得含 蛋/乳製品/魚/甲殼類/軟體動物/未確認
// 4) lacto_ovo:true 的不得含 魚/甲殼類/軟體動物；vegan:true 的 lacto_ovo 也必須 true
// 5) 名稱或內容物描述含「燕麥」的必須有 麩質
import { readFileSync } from 'node:fs';

const ROOT = 'd:/ok/lighten';
const WORDS = ['甲殼類', '軟體動物', '魚', '蛋', '乳製品', '花生', '堅果', '麩質', '黃豆', '芝麻', '未確認'];
const NO_VEGAN = ['蛋', '乳製品', '魚', '甲殼類', '軟體動物', '未確認'];
const NO_LACTO_OVO = ['魚', '甲殼類', '軟體動物'];

const rows = readFileSync(ROOT + '/collab/transcripts/tfda_remaining.tsv', 'utf8').split(/\r?\n/).filter(l => l.trim() !== '').slice(1).map(l => l.split('\t'));
const data = JSON.parse(readFileSync(ROOT + '/collab/transcripts/tfda_tags.json', 'utf8'));
const items = data.items;

const errors = [];
const ok = [];

// 1) 筆數與 key
const tsvKeys = rows.map(f => f[0]);
const jsonKeys = items.map(i => i.key);
if (items.length !== 1895) errors.push(`筆數不是 1895：${items.length}`);
if (new Set(jsonKeys).size !== jsonKeys.length) {
  const dup = jsonKeys.filter((k, i) => jsonKeys.indexOf(k) !== i);
  errors.push(`key 重複：${[...new Set(dup)].join(', ')}`);
}
const missing = tsvKeys.filter(k => !jsonKeys.includes(k));
const extra = jsonKeys.filter(k => !tsvKeys.includes(k));
if (missing.length) errors.push(`缺少 ${missing.length} 筆：${missing.slice(0, 10).join(', ')}`);
if (extra.length) errors.push(`多出 ${extra.length} 筆：${extra.slice(0, 10).join(', ')}`);
if (!missing.length && !extra.length && new Set(jsonKeys).size === jsonKeys.length) ok.push('1. 1895 筆齊全、key 與 tsv 一一對應、沒有重複');

// 2) 詞彙
const badWord = [];
for (const it of items) {
  for (const w of it.allergen_tags.concat(it.likely)) if (!WORDS.includes(w)) badWord.push(`${it.key} ${it.name} → ${w}`);
}
if (badWord.length) errors.push(`用了詞彙表以外的詞：${badWord.slice(0, 10).join(' | ')}`);
else ok.push('2. allergen_tags 與 likely 只用 11 個合法詞');

// 3) 全素與過敏原不得矛盾
const badVegan = items.filter(i => i.vegan && i.allergen_tags.some(w => NO_VEGAN.includes(w)));
if (badVegan.length) errors.push(`vegan:true 卻含 蛋/乳製品/魚/甲殼類/軟體動物/未確認：${badVegan.slice(0, 5).map(i => i.key + ' ' + i.name).join(' | ')}`);
else ok.push('3. vegan:true 的過敏原沒有 蛋/乳製品/魚/甲殼類/軟體動物/未確認');

// 4) 蛋奶素與過敏原不得矛盾、全素必為蛋奶素
const badLo = items.filter(i => i.lacto_ovo && i.allergen_tags.some(w => NO_LACTO_OVO.includes(w)));
if (badLo.length) errors.push(`lacto_ovo:true 卻含 魚/甲殼類/軟體動物：${badLo.slice(0, 5).map(i => i.key + ' ' + i.name).join(' | ')}`);
const badVeganLo = items.filter(i => i.vegan && !i.lacto_ovo);
if (badVeganLo.length) errors.push(`vegan:true 但 lacto_ovo 不是 true：${badVeganLo.slice(0, 5).map(i => i.key + ' ' + i.name).join(' | ')}`);
if (!badLo.length && !badVeganLo.length) ok.push('4. lacto_ovo:true 的沒有 魚/甲殼類/軟體動物；vegan:true 的 lacto_ovo 也是 true');

// 5) 燕麥 → 麩質
const oatRows = rows.filter(f => (f[2] || '').includes('燕麥') || (f[3] || '').includes('燕麥'));
const badOat = oatRows.filter(f => {
  const it = items.find(i => i.key === f[0]);
  return !it || !it.allergen_tags.includes('麩質');
});
if (badOat.length) errors.push(`含「燕麥」卻沒有麩質：${badOat.slice(0, 5).map(f => f[0] + ' ' + f[2]).join(' | ')}`);
else ok.push(`5. 名稱或描述含「燕麥」的 ${oatRows.length} 筆都有麩質`);

// 額外：欄位完整性與值域
const badField = items.filter(i => !i.key || !i.name || !Array.isArray(i.allergen_tags) || !Array.isArray(i.likely)
  || typeof i.vegan !== 'boolean' || typeof i.lacto_ovo !== 'boolean'
  || !['high', 'medium', 'low'].includes(i.confidence) || !i.reason);
if (badField.length) errors.push(`欄位不完整或值域錯誤：${badField.slice(0, 5).map(i => i.key).join(', ')}`);
else ok.push('6. 每筆都有 key/name/allergen_tags/likely/vegan/lacto_ovo/confidence/reason，confidence 值域正確');

console.log('通過：');
for (const s of ok) console.log('  ' + s);
if (errors.length) {
  console.log('未通過：');
  for (const e of errors) console.log('  ' + e);
  process.exit(1);
}
console.log('全部檢查通過，共 ' + items.length + ' 筆。');
