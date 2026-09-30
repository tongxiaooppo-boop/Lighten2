// 衛福部食品營養成分資料庫「剩餘 1895 筆」的過敏原與素食標註初稿產生器
// 規則來源：collab/to-ai-allergen-tagging.md（標註規則）＋ collab/to-cline-tfda-allergen.md
// 輸出：collab/transcripts/tfda_tags.json
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'd:/ok/lighten';
const TSV = ROOT + '/collab/transcripts/tfda_remaining.tsv';
const OUT = ROOT + '/collab/transcripts/tfda_tags.json';

const rows = readFileSync(TSV, 'utf8').split(/\r?\n/).filter(l => l.trim() !== '').slice(1).map(l => {
  const f = l.split('\t');
  return { id: f[0], cat: f[1], name: f[2], desc: f[3] || '', alias: f[4] || '' };
});

const uniq = a => [...new Set(a)];
const has = (t, list) => list.some(k => t.includes(k));

function mk(r, tags, likely, vegan, lacto_ovo, confidence, reason) {
  return { key: r.id, name: r.name, allergen_tags: uniq(tags), likely: uniq(likely), vegan, lacto_ovo, confidence, reason };
}
// plant：全素可（無動物成分且過敏原確定）／ovo：蛋奶素可（蛋、乳）／animal：兩者皆不可／unknown：複合加工品，含未確認
const plant = (r, tags, conf, reason, likely = []) => mk(r, tags, likely, true, true, conf, reason);
const ovo = (r, tags, conf, reason, likely = []) => mk(r, tags, likely, false, true, conf, reason);
const animal = (r, tags, conf, reason, likely = []) => mk(r, tags, likely, false, false, conf, reason);
const unknown = (r, tags, likely, conf, reason) => mk(r, tags.concat('未確認'), likely, false, false, conf, reason);
// 依掃描到的過敏原決定素食旗標（用於成分單純、可以確認的傳統加工品）
const MEATY = ['魚', '甲殼類', '軟體動物'];
function autoVege(r, tags, likely, conf, reason) {
  if (tags.some(x => MEATY.includes(x))) return animal(r, tags, conf, reason, likely);
  if (tags.some(x => x === '蛋' || x === '乳製品')) return ovo(r, tags, conf, reason, likely);
  return plant(r, tags, conf, reason, likely);
}

// 複合加工品的過敏原掃描：只認明確寫在名稱／內容物描述裡的成分
function scan(text) {
  // 先去掉「名字裡有但不是該食材」的雜訊（杏鮑菇、鮑魚菇的「鮑魚」；鴻喜菇別名蟹味菇等）
  const tx = text.replace(/杏鮑菇|鮑魚菇|鮑魚茸|蟹味菇|海鮮菇|栗子蘑|栗子南瓜|魚腥草/g, '');
  const tags = [];
  const add = w => { if (!tags.includes(w)) tags.push(w); };
  if (/芝麻|胡麻|香油|麻油/.test(tx)) add('芝麻');
  if (/花生|落花生/.test(tx)) add('花生');
  if (/杏仁|甘扁桃仁|核桃|腰果|榛果|松子|開心果|夏威夷豆|栗子|堅果|銀杏/.test(tx)) add('堅果');
  if (/黃豆|大豆|黑豆|毛豆|豆漿|豆奶|豆皮|腐皮|腐竹|豆包|豆腐|豆干|豆乾|味噌|豆豉|腐乳|素肉|天貝|醬油|豆瓣|豆醬|豆乳|豆酥/.test(tx)) add('黃豆');
  if (/小麥|大麥|麵粉|麥粉|燕麥|土司|吐司|麵包|麵條|麵線|麵皮|餃皮|餅皮|餅乾|泡麵|麵筋|燒餅|油條/.test(tx)) add('麩質');
  if (/(雞|鴨|鵪鶉|鵝|鴿)(蛋|蛋白)|蛋液|蛋黃|蛋皮|蛋餃|蛋酥|滷蛋|皮蛋|鹹蛋|卵白|蛋糕|美乃滋|美奶滋|沙拉醬|(?:^|[,，（(])蛋(?:[等,，)）]|$)/.test(tx)) add('蛋');
  if (/牛奶|牛乳|奶粉|鮮乳|乳酪|起司|芝士|奶油|鮮奶油|煉乳|乳清|優格|優酪乳|乳製品|奶黃|羊奶|羊乳/.test(tx)) add('乳製品');
  if (/魚/.test(tx.replace(/魷魚|墨魚|章魚|鮑魚|魚腥/g, ''))) add('魚');
  if (/蝦|蟹/.test(tx)) add('甲殼類');
  if (/花枝|魷魚|小卷|鎖管|章魚|干貝|牡蠣|蚵|蛤|螺|鮑魚|九孔|烏賊|墨魚|雪螺/.test(tx)) add('軟體動物');
  return tags;
}
// 品名推斷：名稱本身就足以判定成分的加工品（保守加註；用在成分表缺失或不足的糕餅、調理食品）
const FLOURY = /麵包|蛋糕|吐司|土司|可頌|鬆餅|甜甜圈|銅鑼燒|泡芙|馬拉糕|月餅|鳳梨酥|太陽餅|牛舌餅|綠豆凸|蛋黃酥|方塊酥|捲心酥|煎餅|餅乾|口糧|雪餅|沙其馬|起酥|餅|酥|饅頭|水餃|餛飩|鍋貼|包子|包$|燒賣|餃/;
function nameGuess(tags, n) {
  const add = w => { if (!tags.includes(w)) tags.push(w); };
  if (FLOURY.test(n) && !/魚酥|豆酥/.test(n)) add('麩質');
  if (/蛋/.test(n)) add('蛋');
  if (/奶酥|乳酪|起司|芝士|牛奶|鮮奶|煉乳|奶粉|奶油|冰淇淋|冰棒/.test(n)) add('乳製品');
  return tags;
}

// 描述裡有沒有列出成分（有「(成分,成分)」）
const noIngredientList = r => !/[(（]/.test(r.desc);

function tagRow(r) {
  const n = r.name;
  const t = r.name + ' ' + r.desc + ' ' + r.alias;

  // ---- 個案覆寫：品項內容與所屬分類落差較大的幾筆 ----
  if (r.id === 'R1300401') return unknown(r, ['花生'], [], 'medium', '糙秈米漿：米漿類飲品（樣品狀態標示含花生），瓶裝加工品配方依廠牌。');
  if (r.id === 'L0124201') return ovo(r, ['乳製品', '麩質', '堅果', '芝麻'], 'medium', '中脂調味乳（多穀類）：成分表列出大麥、燕麥（麩質）、杏仁豆（堅果）、白芝麻，乳製品為主要成分。');

  // ================= 穀物類 =================
  if (r.cat === '穀物類') {
    if (n.includes('雜糧中筋麵粉')) return plant(r, ['麩質', '黃豆'], 'medium', '雜糧預拌粉，成分含中筋／全麥麵粉、裸麥、燕麥等麩質穀物與大豆（黃豆）。');
    if (n.includes('雜糧高筋麵粉')) return plant(r, ['麩質'], 'medium', '雜糧預拌粉，成分含高筋麵粉、燕麥、大麥等麩質穀物。');
    if (n.includes('去筋麵粉')) return plant(r, ['麩質'], 'medium', '去筋麵粉（澄粉）為小麥澱粉，仍屬小麥來源，保守標麩質。');
    if (/麵粉|小麥|大麥|黑麥|燕麥|全麥|裸麥|麥片|麩皮/.test(n)) {
      return plant(r, ['麩質'], 'high', '小麥、大麥、黑麥、燕麥等屬含麩質穀物（台灣過敏原標示將燕麥列入）；單一原料、全素。');
    }
    return plant(r, [], 'high', '米、玉米、小米、高粱、蕎麥、薏仁、藜麥等無麩質穀物；單一原料、全素。');
  }

  // ================= 澱粉類 =================
  if (r.cat === '澱粉類') {
    if (n.includes('芋頭粉')) return ovo(r, ['乳製品'], 'medium', '芋頭粉：樣品狀態標示含「香芋,乳糖等」，乳糖來自乳品。');
    if (n.includes('蒟蒻粉')) return plant(r, [], 'medium', '蒟蒻粉：蒟蒻抽出物、海藻抽出物、葡萄糖、檸檬酸鉀等，皆為植物性原料與食品添加物。');
    if (n.includes('油炸脫水甘藷')) return unknown(r, [], [], 'medium', '油炸脫水甘藷：油炸加工品，用油與添加物依廠牌而異。');
    return plant(r, [], 'high', '山藥、甘藷、芋頭、馬鈴薯、蓮藕、荸薺、菱角、樹薯等根莖類或澱粉，單一原料、全素。');
  }

  // ================= 堅果及種子類 =================
  if (r.cat === '堅果及種子類') {
    if (/芝麻|胡麻/.test(t)) return plant(r, ['芝麻'], 'high', '芝麻（胡麻）及其製品；植物性、全素。');
    if (/花生|落花生/.test(t)) return plant(r, ['花生'], 'high', '花生及其製品；植物性、全素。');
    if (/甘扁桃仁|杏仁|松子|夏威夷豆|栗子|腰果|榛果|核桃|銀杏/.test(t)) {
      return plant(r, ['堅果'], n.includes('銀杏') ? 'medium' : 'high', '杏仁（甘扁桃仁）、松子、夏威夷豆、栗子、腰果、榛果、核桃、銀杏等堅果類；植物性、全素。');
    }
    return plant(r, [], 'high', '亞麻仁籽、奇亞子、山粉圓、芡實、愛玉子、蓮子、咖啡豆等種子類，非堅果、非芝麻；無過敏原、全素。');
  }

  // ================= 水果類 =================
  if (r.cat === '水果類') {
    if (/汁/.test(n)) return plant(r, [], 'medium', '果汁類，原料為水果；單一水果來源、無過敏原、全素。');
    if (/乾|蜜餞/.test(n)) return plant(r, [], 'medium', '水果乾／糖漬水果；無過敏原、全素（乾貨可能使用亞硫酸鹽，亞硫酸鹽不在 App 詞彙內）。');
    return plant(r, [], 'high', '水果，單一天然食材、無過敏原、全素。');
  }

  // ================= 蔬菜類 =================
  if (r.cat === '蔬菜類') {
    if (/黃豆芽|黑豆芽/.test(n)) return plant(r, ['黃豆'], 'high', '豆芽由黃豆／黑豆（皆為黃豆）發芽而成；植物性、全素。');
    if (/小麥苗/.test(n)) return plant(r, ['麩質'], 'medium', '小麥苗（小麥草）為小麥植株，名稱含小麥，保守標麩質；植物性、全素。');
    if (/乾|醃|漬|沙拉筍|熟/.test(n)) return plant(r, [], 'medium', '蔬菜乾貨、醃漬或熟製蔬菜，單一蔬菜原料；無過敏原、全素（乾貨可能含亞硫酸鹽，不在詞彙內）。');
    return plant(r, [], 'high', '蔬菜，單一天然食材、無過敏原、全素。');
  }

  // ================= 藻類 =================
  if (r.cat === '藻類') {
    if (n.includes('壽司海苔片')) return plant(r, [], 'medium', '壽司海苔片：乾燥海苔，部分市售品經調味，但海苔本身無過敏原、全素。');
    return plant(r, [], 'high', '海藻（紫菜、海帶、裙帶菜、麒麟菜等），單一原料、無過敏原、全素。');
  }

  // ================= 菇類 =================
  if (r.cat === '菇類') {
    if (n.includes('白茯苓')) return plant(r, [], 'medium', '白茯苓為真菌類藥食兩用材料，無過敏原、全素。');
    return plant(r, [], 'high', '菇類（蕈類），單一原料、無過敏原、全素。');
  }

  // ================= 豆類 =================
  if (r.cat === '豆類') {
    if (/黃豆|黑豆|毛豆|大豆|豆漿|豆奶|天貝/.test(t)) return plant(r, ['黃豆'], 'high', '黃豆（含黑豆、毛豆）及其製品；植物性、全素。');
    return plant(r, [], 'high', '紅豆、綠豆、花豆、豌豆、蠶豆、扁豆等豆類，非黃豆、非花生；無過敏原、全素。');
  }

  // ================= 肉類 =================
  if (r.cat === '肉類') {
    return animal(r, [], 'high', '肉類／內臟／骨湯，過敏原詞彙沒有肉類，故為空陣列；動物來源，全素與蛋奶素皆不可。');
  }

  // ================= 魚貝類（依整合編號前綴分群） =================
  if (r.cat === '魚貝類') {
    const p = r.id.slice(0, 3);
    if (r.id === 'J0600701') return unknown(r, ['魚'], [], 'medium', '魚漿（旗魚）：主原料為旗魚（魚）並含澱粉等添加物，配方依廠牌。');
    if (r.id === 'J3500401') return unknown(r, ['軟體動物'], [], 'medium', '泡魷魚：魷魚（軟體動物）發泡製品，添加物依廠牌。');
    if (['J21', 'J22', 'J23', 'J25', 'J26'].includes(p)) return animal(r, ['甲殼類'], 'high', '蝦、蟹等甲殼類水產；動物來源，全素與蛋奶素皆不可。');
    if (['J31', 'J32', 'J33', 'J35', 'J36', 'J37'].includes(p)) return animal(r, ['軟體動物'], 'high', '貝類、螺類、頭足類（花枝、魷魚、小卷、干貝、蚵）等軟體動物；動物來源、非素。');
    if (p === 'J41' || p === 'J51') return animal(r, [], 'high', '海參、海蜇等棘皮／腔腸動物，不在 App 過敏原詞彙內；動物來源、非素。');
    return animal(r, ['魚'], 'high', '魚類；動物來源，全素與蛋奶素皆不可。');
  }

  // ================= 蛋類 =================
  if (r.cat === '蛋類') {
    if (/滷蛋|鐵蛋|溫泉蛋|茶葉蛋\(市售\)|鵪鶉鹹蛋/.test(n)) {
      return ovo(r, ['蛋'], 'medium', '蛋製品，主原料為蛋；滷汁／調味含醬油與香辛料（醬油通常含黃豆與小麥），配方依店家或廠牌。', ['黃豆', '麩質']);
    }
    if (/皮蛋|鹹蛋/.test(n)) return ovo(r, ['蛋'], 'high', '皮蛋／鹹蛋：主原料為蛋，以鹼液、鹽醃製；蛋奶素可、全素不可。');
    return ovo(r, ['蛋'], 'high', '蛋（全蛋、蛋白或蛋黃），單一原料；蛋奶素可、全素不可。');
  }

  // ================= 乳品類 =================
  if (r.cat === '乳品類') {
    if (/調味乳|調味保久乳|調味奶粉|鮮奶可可/.test(n)) return unknown(r, ['乳製品'], ['黃豆', '麩質'], 'medium', '調味乳／調味奶粉：以乳為主並加可可、糖、香料等，乳製品為確定成分；其餘配方依廠牌。');
    if (/奶粉/.test(n) && /卵磷脂/.test(r.desc)) return ovo(r, ['乳製品', '黃豆'], 'medium', '奶粉類：成分標示含大豆卵磷脂（黃豆）；DHA 等強化成分來源依廠牌（若為魚油則含魚）。', ['魚']);
    if (/發酵乳/.test(n)) return ovo(r, ['乳製品'], 'medium', '發酵乳（優酪乳／優格）：以生乳發酵，乳製品為確定成分；調味款配方依廠牌。');
    if (/木瓜牛奶/.test(n)) return ovo(r, ['乳製品'], 'medium', '木瓜牛奶：現調飲料，成分為水、木瓜、牛奶、糖，乳製品為確定成分。');
    if (/乾酪/.test(n)) return ovo(r, ['乳製品'], 'medium', '乾酪（起司）：以牛乳發酵製成，乳製品為確定成分。');
    return ovo(r, ['乳製品'], 'high', '乳品（鮮乳、保久乳、奶粉、羊乳、煉乳等），乳製品為確定成分；動物來源，全素不可、蛋奶素可。');
  }

  // ================= 油脂類 =================
  if (r.cat === '油脂類') {
    if (/人造奶油/.test(n)) return unknown(r, [], ['乳製品', '黃豆'], 'medium', '人造奶油（瑪琪琳）：植物油、水、鹽、乳化劑等複合配方，部分含乳成分或大豆卵磷脂，依廠牌而異。');
    if (/豬油|牛油/.test(n)) return animal(r, [], 'high', '豬油／牛油等動物性油脂，過敏原詞彙無對應項目；動物來源，全素與蛋奶素皆不可。');
    if (/奶油/.test(n)) return ovo(r, ['乳製品'], 'medium', '奶油（乳脂製品），乳製品為確定成分；全素不可、蛋奶素可。');
    if (/調合花生油/.test(n)) return unknown(r, ['花生', '芝麻', '黃豆'], [], 'medium', '調合花生油：成分含花生油、芝麻油、玉米胚芽油、沙拉油（大豆油）等，比例依廠牌。');
    if (/調合芝麻油/.test(n)) return unknown(r, ['芝麻'], ['黃豆'], 'medium', '調合芝麻油：芝麻油與其他植物油調合，成分比例依廠牌。');
    if (/大豆油/.test(n)) return plant(r, ['黃豆'], 'medium', '大豆油（含卵磷脂或維生素強化），原料為黃豆；與代換表「大豆油」同一標準，保守標黃豆。');
    if (/芝麻油/.test(n)) return plant(r, ['芝麻'], 'medium', '白芝麻油，原料為芝麻；植物性、全素。');
    if (/核桃油/.test(n)) return plant(r, ['堅果'], 'medium', '核桃油，原料為核桃（堅果）；與代換表「花生油」同一標準，保守標堅果。');
    if (/調合/.test(n)) return plant(r, [], 'medium', '調合植物油：成分表列出米油、紅花籽油、葵花油、橄欖油等，皆非過敏原；植物性、全素。');
    return plant(r, [], 'high', '植物油（米油、亞麻仁油、芥花油、葵花油、葡萄籽油、油茶油、中鏈脂肪酸油等），原料非過敏原、全素。');
  }

  // ================= 糖類 =================
  if (r.cat === '糖類') {
    if (/蜂蜜/.test(n)) return mk(r, [], [], false, true, 'medium', '蜂蜜為蜜蜂產物，全素不可、蛋奶素可食；過敏原詞彙無對應項目。');
    if (/冬瓜糖磚/.test(n)) return plant(r, [], 'medium', '冬瓜糖磚：冬瓜與砂糖熬製，無過敏原、全素。');
    if (/黑糖蜜/.test(n)) return plant(r, [], 'medium', '黑糖蜜：甘蔗糖蜜、麥芽糖、甘蔗原糖等，無過敏原、全素。');
    return plant(r, [], 'high', '糖（蔗糖、冰糖、麥芽糖、果糖、楓糖等），無過敏原、全素。');
  }

  // ================= 飲料類 =================
  if (r.cat === '飲料類') {
    if (/茶湯/.test(n)) return plant(r, [], 'medium', '茶湯：茶包加熱水沖泡，單一原料、無過敏原、全素。');
    if (/汁\(100%\)/.test(n)) return plant(r, [], 'medium', '100% 果汁，單一水果原料、無過敏原、全素。');
    if (/椰奶/.test(n)) return unknown(r, [], ['乳製品', '麩質'], 'medium', '椰奶（椰漿飲品）：冷藏與室溫產品並存，部分產品含乳成分或添加物，依廠牌。');
    if (/黑麥汁/.test(n)) return unknown(r, ['麩質'], [], 'medium', '黑麥汁：以全穀黑麥釀製，屬含麩質穀物；瓶裝加工飲品，配方依廠牌。');
    if (/麥茶|紅茶\(大麥\)/.test(n)) return unknown(r, ['麩質'], [], 'medium', '以大麥抽出液／大麥為原料，屬含麩質穀物；瓶裝加工飲品，配方依廠牌。');
    if (/拿鐵|奶茶|咖啡\(三合一\)|咖啡沖泡包|奶茶沖泡包|乳酸飲料|多多/.test(n)) {
      return unknown(r, ['乳製品'], ['黃豆', '麩質'], 'medium', '含乳（牛奶、奶粉或奶精）的調製飲品，乳製品為確定成分；其餘配方依廠牌。');
    }
    if (/龜苓茶/.test(n)) return unknown(r, [], [], 'medium', '龜苓茶：以龜苓糕粉、蜂蜜熬製，傳統配方含龜板等動物性成分，是否含動物來源依廠牌。');
    const btags = scan(t);
    if (/小麥草粉|小麥苗/.test(n) && !btags.includes('麩質')) btags.push('麩質');
    return unknown(r, btags, [], 'medium', '瓶裝／罐裝／現調飲料：成分表列出 ' + (btags.join('、') || '水、糖、抽出液等非過敏原成分') + '，其餘配方依廠牌。');
  }

  // ================= 調味料及香辛料類 =================
  if (r.cat === '調味料及香辛料類') {
    const single = ['八角', '小茴香粉', '甘草粉', '肉桂粉', '西洋芹菜片', '花椒粉', '洋香菜片', '洋蔥粉', '白胡椒粉', '紅胡椒粒', '黑胡椒粉', '綠胡椒粒', '迷迭香粉', '荳蔻粉', '蒜粉', '辣椒粉', '薑黃粉', '薑粉', '羅勒片', '花椒粒', '椰子粉', '糖粉', '岩鹽', '低鈉鹽', '味精', '高鮮味精', '酵母粉', '陳皮', '山楂', '黃耆片'];
    if (single.includes(n)) return plant(r, [], 'high', '單一香辛料，或成分單純的鹽、味精、酵母粉；無過敏原、全素。');
    if (n === '黃耆水') return plant(r, [], 'medium', '黃耆片熬煮液，無過敏原、全素。');
    if (n === '油蔥酥' || n === '蒜頭酥') return plant(r, [], 'medium', '紅蔥頭／蒜頭與油製成，無過敏原、全素。');
    if (/醬油|油膏/.test(n)) {
      if (/黑豆/.test(n)) return plant(r, ['黃豆'], 'medium', '黑豆醬油（蔭油）系列：以黑豆（黃豆）釀造；植物性、全素。');
      return plant(r, ['黃豆', '麩質'], 'medium', '醬油系列：以黃豆與小麥釀造，含黃豆與麩質；植物性、全素。');
    }
    if (n === '味噌') return plant(r, ['黃豆'], 'medium', '味噌：以米、黃豆、鹽發酵，含黃豆；植物性、全素。');
    if (n === '味醂') return plant(r, [], 'medium', '味醂：糯米、蓬萊米、米麴、釀造酢等製成，無過敏原、全素。');
    if (/醋/.test(n)) {
      if (/烏醋/.test(n) && !/素食/.test(n)) return plant(r, ['黃豆', '麩質'], 'medium', '烏醋：成分含醬油（黃豆與小麥）與果汁、蔬菜汁等；植物性、全素。');
      return plant(r, [], 'medium', '醋（米醋、糯米醋、高梁醋、薏仁醋、香醋、壽司醋等），以穀物或水果釀造，無過敏原、全素。');
    }
    if (/鮮味露/.test(n)) return unknown(r, [], ['黃豆'], 'medium', '鮮味露：標示為醬油（水、脫水性植物蛋白質、鹽等），植物蛋白來源多為黃豆，依廠牌。');
    if (/蠔油/.test(n)) return unknown(r, ['軟體動物'], ['魚', '麩質', '黃豆'], 'medium', '蠔油：以鮮蠔（軟體動物）提煉，並含澱粉、醬色等，配方依廠牌。');
    if (/魚露/.test(n)) return unknown(r, ['魚'], [], 'medium', '魚露：魚類發酵製品，主原料為魚；配方依廠牌。');
    if (/蝦油|蝦醬/.test(n)) return unknown(r, ['甲殼類'], ['魚'], 'medium', '蝦油／蝦醬：以蝦（甲殼類）發酵製成，配方依廠牌。');
    if (/干貝醬/.test(n)) return unknown(r, ['軟體動物', '甲殼類', '魚'], [], 'medium', '干貝醬（XO 醬）：成分含干貝、小卷、乾蝦、火腿等，配方依廠牌。');
    if (/沙茶/.test(n)) {
      if (/素沙茶/.test(n)) return unknown(r, ['麩質', '芝麻'], ['黃豆'], 'medium', '素沙茶醬：成分含小麥胚芽（麩質）、胡麻粉（芝麻）等，配方依廠牌。');
      return unknown(r, ['魚', '甲殼類', '黃豆'], ['麩質'], 'medium', '沙茶醬：成分含扁魚（魚）、蝦米（甲殼類）、黃豆油等，配方依廠牌。');
    }
    if (/麻醬包/.test(n)) return unknown(r, ['芝麻', '花生', '黃豆'], ['麩質'], 'medium', '速食乾麵麻醬包：含芝麻醬、花生醬、醬油與豬油等，配方依廠牌。');
    if (/無糖黑芝麻醬|芝麻麵包醬/.test(n)) {
      const tags = n.includes('白芝麻') ? ['芝麻', '黃豆'] : ['芝麻'];
      return unknown(r, tags, [], 'medium', '芝麻麵包醬／芝麻醬：以芝麻為主，部分配方含大豆等，依廠牌。');
    }
    if (/麻醬|芝麻醬/.test(n)) return plant(r, ['芝麻'], 'medium', '麻醬（芝麻醬）：以芝麻製成，無其他過敏原、全素。');
    if (/紅辣椒油/.test(n)) return plant(r, ['芝麻'], 'medium', '紅辣椒油：成分含植物油、芝麻油與辣椒萃取物，含芝麻、全素。');
    if (/香油/.test(n)) return plant(r, ['芝麻'], 'medium', '香油：白芝麻油與沙拉油（大豆油）調合，含芝麻（大豆油見「沙拉油」爭議）、全素。');
    if (/沙拉醬/.test(n)) {
      if (n.includes('無蛋沙拉醬')) {
        if (/乳清/.test(r.desc)) return unknown(r, ['乳製品'], ['黃豆'], 'medium', '無蛋沙拉醬：標示含乳清蛋白（乳製品）與植物油、醋等，配方依廠牌。');
        return unknown(r, [], ['黃豆'], 'medium', '無蛋沙拉醬：成分為植物油與大豆卵磷脂等，配方依廠牌（無蛋）。');
      }
      if (n.includes('和風沙拉醬')) return unknown(r, [], ['黃豆', '麩質'], 'medium', '和風沙拉醬：以糯米酢、醬油、橄欖油等調製，配方依廠牌。');
      if (n.includes('凱撒沙拉醬')) return unknown(r, ['蛋', '乳製品', '芝麻', '魚'], ['麩質', '黃豆'], 'medium', '凱撒沙拉醬：成分含蛋、乾酪（乳製品）、芝蔴、鯷魚／銀魚（魚）等，配方依廠牌。');
      return unknown(r, ['蛋'], ['黃豆', '麩質'], 'medium', '沙拉醬／千島沙拉醬：以沙拉油與雞蛋為主（蛋為確定成分），配方依廠牌。');
    }
    if (/七味唐辛子/.test(n)) return unknown(r, ['芝麻'], [], 'medium', '七味唐辛子：成分含黑芝麻、白芝麻與多種香辛料，配方依廠牌。');
    if (/沙茶粉/.test(n)) return unknown(r, ['魚'], ['甲殼類', '黃豆'], 'medium', '沙茶粉：成分含扁魚（魚）、蒜頭、辣椒粉、椰子粉等，配方依廠牌。');
    if (/豆酥/.test(n)) return unknown(r, ['黃豆'], [], 'medium', '豆酥／豆酥醬：以黃豆為主並加蒜、薑、調味料，配方依廠牌。');
    if (/咖哩塊/.test(n)) return unknown(r, ['麩質', '乳製品'], ['黃豆'], 'medium', '咖哩塊：含咖哩粉、麵粉（麩質）、油脂、奶粉（乳製品）等，配方依廠牌。');
    if (/咖哩粉|五香粉|梅子粉|山葵粉/.test(n)) return unknown(r, [], [], 'medium', '香辛料混合粉（咖哩粉、五香粉、梅子粉、山葵粉等），成分多為香辛料與鹽、糖，配方依廠牌。');
    if (/奶精/.test(n)) {
      if (/液體奶精/.test(n)) return unknown(r, ['乳製品'], ['黃豆'], 'medium', '液體奶精：成分含酪蛋白、奶粉（乳製品）與植物油等，配方依廠牌。');
      return unknown(r, [], ['乳製品', '黃豆'], 'medium', '奶精粉：標示為植物性油脂／氫化油，可能含乳成分或大豆卵磷脂，依廠牌而異。');
    }
    if (/炸排粉|炸雞粉|麵包粉/.test(n)) return unknown(r, ['麩質'], ['蛋', '乳製品'], 'medium', '油炸裹粉：以小麥粉、麵包粉與澱粉為主（麩質為確定成分），配方依廠牌。');
    if (/蒸肉粉/.test(n)) return unknown(r, [], ['麩質'], 'medium', '蒸肉粉（五香）：以米、花椒、八角與香辛料等製成，配方依廠牌。');
    if (/熱狗粉/.test(n)) return unknown(r, ['乳製品', '黃豆', '麩質'], [], 'medium', '熱狗粉：成分含奶粉（乳製品）、黃豆粉、麵粉（麩質）等，配方依廠牌。');
    if (/果醬/.test(n)) {
      if (!noIngredientList(r)) return plant(r, [], 'medium', '果醬：成分為水果、糖與果膠等，無過敏原、全素。');
      return unknown(r, [], [], 'low', '果醬：來源未列出成分，配方依廠牌（部分產品可能添加其他原料）。');
    }
    if (/鰹魚粉/.test(n)) return unknown(r, ['魚'], [], 'medium', '鰹魚粉：成分含乾燻鰹魚與鰹魚抽出物（魚），配方依廠牌。');
    if (/鮮雞精/.test(n)) return unknown(r, [], [], 'medium', '鮮雞精：以雞肉、雞油與調味料製成，動物來源、非素；配方依廠牌。');
    if (/高湯/.test(n)) {
      if (/素食/.test(n)) return unknown(r, [], ['黃豆'], 'medium', '素食高湯：以香菇抽出物、水、植物蛋白等製成，植物蛋白多為黃豆，依廠牌。');
      return unknown(r, [], [], 'medium', '高湯（塊）：以豬骨、雞肉或肉類濃縮汁與調味料製成，動物來源、非素；配方依廠牌。');
    }
    // 其餘醬料／複合調味料：靠成分掃描
    const tags = scan(t);
    const likely = [];
    if (/醬油/.test(t) && !tags.includes('麩質')) likely.push('麩質');
    if (noIngredientList(r)) return unknown(r, tags, likely, 'low', '複合調味料，來源資料未列出成分，無法判斷是否含過敏原，保守標未確認。');
    if (tags.length === 0) return unknown(r, [], likely, 'medium', '複合調味料：成分表為香辛料、糖、鹽、醋等非過敏原成分，配方依廠牌。');
    return unknown(r, tags, likely, 'medium', '複合調味料：成分表列出 ' + tags.join('、') + '，配方依廠牌。');
  }

  // ================= 糕餅點心類 =================
  if (r.cat === '糕餅點心類') {
    if (/口含錠|咀嚼錠/.test(n)) {
      const tags = scan(t);
      return unknown(r, tags, [], 'medium', '保健食品（口含錠／咀嚼錠），不是一般食物，過敏原無法完整判斷；成分表列出 ' + (tags.join('、') || '糖、澱粉、維生素等') + '。');
    }
    if (/甜年糕/.test(n)) return plant(r, [], 'medium', '甜年糕：糯米與糖製成，成分單純、無過敏原、全素。');
    if (/豆花/.test(n)) return unknown(r, scan(t).concat('黃豆'), [], 'medium', '豆花：以黃豆為主（黃豆為確定成分），配料與糖水配方依店家。');
    const tags = nameGuess(scan(t), n);
    const likely = [];
    if (/醬油/.test(t) && !tags.includes('麩質')) likely.push('麩質');
    if (noIngredientList(r)) {
      if (tags.length === 0) return unknown(r, tags, likely, 'low', '糕餅點心類加工品：來源資料未列出成分，也無法從品名判斷過敏原，保守標未確認。');
      return unknown(r, tags, likely, 'low', '糕餅點心類加工品：來源資料未列出成分，名稱可判斷的過敏原（' + tags.join('、') + '）已列出，其餘依廠牌，保守標未確認。');
    }
    return unknown(r, tags, likely, 'medium', '糕餅點心類加工品：成分表列出 ' + (tags.join('、') || '糖、澱粉、油脂等非過敏原成分') + '，配方依廠牌而異。');
  }

  // ================= 加工調理食品及其他類 =================
  if (r.cat === '加工調理食品及其他類') {
    if (/免煮飯|米粉|粄條|粿仔條|寬粉|冬粉|粉圓|米苔目/.test(n)) return plant(r, [], 'medium', '米／澱粉類主食（米粉、粄條、粿仔條、寬粉、冬粉、粉圓等），以米、綠豆或馬鈴薯澱粉製成，無過敏原、全素。');
    if (/啤酒/.test(n)) {
      if (noIngredientList(r)) return unknown(r, [], ['麩質'], 'medium', '啤酒：以大麥芽釀造，屬含麩質穀物；來源未列出成分，配方依廠牌。');
      return plant(r, ['麩質'], 'medium', '啤酒：以大麥芽（麩質）釀造，另含米、啤酒花；植物性、全素。');
    }
    if (/紹興酒/.test(n)) return plant(r, ['麩質'], 'medium', '紹興酒：以糯米、蓬萊米與小麥（麩質）釀造；全素。');
    if (/葡萄酒/.test(n)) return plant(r, [], 'medium', '葡萄酒：以葡萄與糖釀造，無過敏原、全素。');
    if (/雞精/.test(n)) return unknown(r, [], [], 'medium', '雞精：以雞肉濃縮製成，動物來源、非素；配方依廠牌。');
    if (/寒天脆藻/.test(n)) return plant(r, [], 'medium', '寒天脆藻：寒天（藻膠）、水與昆布萃取物，無過敏原、全素。');
    if (/烤雞$|茶鵝|熟鵝腿肉/.test(n)) return animal(r, [], 'medium', '全雞／鵝肉熟製品，僅加熱或燻烤；過敏原詞彙無肉類，配方依廠牌。');
    if (/麵線|麵條|烏龍麵|意麵|雞蛋麵|刀削麵|黃麵|蕎麥麵|雞絲麵|紅蘿蔔麵|菠菜麵/.test(n)) {
      const tags = ['麩質'];
      if (/雞蛋|意麵/.test(n)) tags.push('蛋');
      if (tags.includes('蛋')) return ovo(r, tags, 'medium', '麵條：以小麥麵粉（麩質）製成，配方含蛋；蛋奶素可、全素不可。');
      return plant(r, tags, 'medium', '麵條／麵線：以小麥麵粉（麩質）製成，無其他過敏原、全素。');
    }
    if (/泡麵/.test(n)) {
      const tags = ['麩質'];
      if (/鮮蝦/.test(n)) tags.push('甲殼類');
      return unknown(r, tags, ['黃豆', '蛋', '乳製品', '魚'], 'medium', '泡麵：以小麥麵粉製麵（麩質）並附調味包，口味與添加物依廠牌。');
    }
    if (/酒釀/.test(n)) return plant(r, [], 'medium', '酒釀：糯米加水與酵母發酵，無過敏原、全素。');
    if (/水餃|餛飩|鍋貼|小籠包|包子|饅頭|花捲|銀絲卷|燒賣|水晶包|水晶餃|餡餅|韭菜盒子|水煎包|蔥油餅|竹筍包|大餅包小餅|三明治|披薩|棺材板|春捲|可樂餅/.test(n)) {
      const tags = nameGuess(scan(t), n);
      if (!tags.includes('麩質')) tags.push('麩質');
      return unknown(r, tags, ['蛋', '乳製品', '黃豆'], 'medium', '麵皮類製品（水餃、包子、饅頭、餡餅等）：以小麥麵粉製成（麩質），內餡與配方依廠牌。');
    }
    if (/傳統豆腐|冷凍豆腐|日式炸豆皮/.test(n)) return plant(r, ['黃豆'], 'medium', '豆製品：黃豆為唯一主要原料（豆腐、豆皮），無其他過敏原、全素。');
    if (/素肉|素雞|素火腿/.test(n)) return unknown(r, [], ['黃豆', '麩質'], 'medium', '素食加工品（素肉等）：以大豆蛋白或小麥蛋白製成並調味，配方依廠牌。');
    if (/豆漿|豆奶|豆乳|豆花/.test(n)) return unknown(r, scan(t).concat('黃豆'), ['麩質'], 'medium', '豆漿／豆奶類：以黃豆為主（黃豆為確定成分），其他成分依廠牌。');
    if (/豆腐|豆皮|豆干|豆棗|腐乳|佃煮黑豆|黑豆干/.test(n)) {
      const tags = scan(t);
      if (!tags.includes('黃豆')) tags.push('黃豆');
      return unknown(r, tags, [], 'medium', '豆製品：以黃豆為主（黃豆為確定成分），調味與添加物依廠牌。');
    }
    if (/花生/.test(n)) {
      const tags = scan(t);
      if (!tags.includes('花生')) tags.push('花生');
      return unknown(r, tags, [], 'medium', '含花生的加工品：花生為確定成分，調味與製程依廠牌。');
    }
    if (/甘扁桃仁|杏仁|核桃|腰果|榛果|松子|夏威夷豆|栗子|堅果/.test(n)) {
      const tags = scan(t);
      if (!tags.includes('堅果')) tags.push('堅果');
      return unknown(r, tags, [], 'medium', '堅果加工品：堅果為主要原料，調味與製程依廠牌。');
    }
    if (/火腿|臘肉|肉乾|肉鬆|肉酥|香腸|培根|肉羹|雞塊|漢堡肉|叉燒|滷牛筋|滷豬腳|醃燻豬肝|醬肘子|珍珠丸|貢丸|雞肉丸|咕咾肉|豬腳凍|肉燥|烤雞翅/.test(n)) {
      return unknown(r, nameGuess(scan(t), n), ['黃豆', '麩質', '蛋'], 'medium', '調理肉品：以肉類為主並含澱粉、調味料與食品添加物，配方依廠牌。');
    }
    if (/丸|餃|捲|排|漿|羹|魚板|蟹味棒|魚卵|魚酥|魚鬆|肉脯|蒲燒|鯊魚煙|蠑螺|柳葉魚|烏魚子|魚子/.test(n) && !/米漿|豆漿|燕麥奶|椰奶/.test(n)) {
      return unknown(r, nameGuess(scan(t), n), ['魚', '麩質', '甲殼類', '軟體動物'], 'medium', '水產調理製品：主原料為魚或其他水產並含澱粉、調味料，配方依廠牌。');
    }
    if (/濃湯/.test(n)) {
      const tags = scan(t);
      if (/海鮮/.test(n)) tags.push('甲殼類', '軟體動物', '魚');
      return unknown(r, tags, ['麩質', '乳製品'], 'medium', '沖泡濃湯／調理湯品：複合配方（澱粉、調味料、海鮮或蔬菜抽出物），依廠牌。');
    }
    if (/沖泡|麥片|麵茶|燕麥奶|杏仁茶|芝麻糊|米漿|穀物|糙米麩/.test(n)) {
      const tags = nameGuess(scan(t), n);
      if (/麥片|燕麥|麥粉|麵茶|穀物/.test(n) && !tags.includes('麩質')) tags.push('麩質');
      return unknown(r, tags, ['麩質', '乳製品'], 'medium', '沖泡包／即食沖泡飲品：成分與添加物依廠牌。');
    }
    if (/醃|漬|泡菜|酸菜|榨菜|梅乾菜|筍干|甘藍乾|薤/.test(n)) return autoVege(r, scan(t), ['甲殼類', '魚'], 'medium', '醃漬／鹽漬蔬菜：以蔬菜與鹽為主，部分配方以魚露、蝦醬調味，依店家或廠牌。');
    if (/罐頭/.test(n)) {
      const tags = nameGuess(scan(t), n);
      if (tags.length === 0 && !noIngredientList(r)) return plant(r, [], 'medium', '罐頭製品：成分表為主原料與鹽、糖、水等，無過敏原、全素。');
      return unknown(r, tags, [], 'medium', '罐頭製品：以蔬菜、菇類、豆類或水產為主，浸泡液與調味依廠牌。');
    }
    if (/薯條|甘藷條/.test(n)) return unknown(r, [], [], 'medium', '冷凍薯條：以馬鈴薯／甘藷為原料，可能含油脂、葡萄糖等，依廠牌。');
  }

  // 其他（分類規則未涵蓋者）：一律保守標未確認
  const fb = nameGuess(scan(t), n);
  if (noIngredientList(r)) {
    if (fb.length === 0) return unknown(r, fb, [], 'low', '加工調理食品：來源資料未列出成分，也無法從品名判斷過敏原，保守標未確認。');
    return unknown(r, fb, [], 'low', '加工調理食品：來源資料未列出成分，名稱可判斷的過敏原（' + fb.join('、') + '）已列出，其餘依廠牌，保守標未確認。');
  }
  return unknown(r, fb, [], 'medium', '加工調理食品：成分與配方依廠牌，保守標未確認。');
}

const items = rows.map(tagRow);

// 一致性（規則 3、4）：含未確認或動物性過敏原者不得標全素；全素者的蛋奶素必為 true
for (const it of items) {
  const t = it.allergen_tags;
  if (t.includes('未確認') || t.some(x => ['蛋', '乳製品', '魚', '甲殼類', '軟體動物'].includes(x))) it.vegan = false;
  if (t.some(x => ['魚', '甲殼類', '軟體動物'].includes(x))) it.lacto_ovo = false;
  if (it.vegan) it.lacto_ovo = true;
  // likely 只留「還沒列在 allergen_tags 裡」的詞
  it.likely = it.likely.filter(w => !it.allergen_tags.includes(w));
}

writeFileSync(OUT, JSON.stringify({ _by: 'Cline（Claude）', _date: '2026-10-01', items }, null, 2) + '\n', 'utf8');

const counts = {};
for (const it of items) counts[it.confidence] = (counts[it.confidence] || 0) + 1;
console.log('items:', items.length, counts);
console.log('含未確認:', items.filter(i => i.allergen_tags.includes('未確認')).length, '／全素:', items.filter(i => i.vegan).length, '／蛋奶素:', items.filter(i => i.lacto_ovo).length);
