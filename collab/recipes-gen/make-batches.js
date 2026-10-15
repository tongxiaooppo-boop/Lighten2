// 產生家常菜作法的送審批次（每批 12 道）→ collab/recipes-gen/in/batchNN.txt
const fs=require("fs"),path=require("path");
const R=path.join(__dirname,"..","..");
const rd=f=>JSON.parse(fs.readFileSync(path.join(R,f),"utf8"));
const dishes=rd("data/reference/home_dish_recipes.json").dishes;
const names={};
rd("data/ingredients.json").forEach(i=>names[i.id]=i.name);
rd("data/tfda_lookup.json").items.forEach(i=>names[i.id]=names[i.id]||i.name);
rd("data/reference/home_dish_seasonings.json").items.forEach(i=>names[i.id]=i.name);
names.cooking_oil="食用油";Object.assign(names,{fx_qingjiang:"青江菜",fx_sweet_potato_leaves:"地瓜葉",fx_pork_loin:"豬里肌",fx_green_pepper:"青椒",fx_peanut:"花生",fx_kailan:"芥蘭",fx_napa_cabbage:"大白菜",fx_pork_belly:"五花肉",fx_carrot:"紅蘿蔔",fx_small_dried_tofu:"小豆干",fx_pork_rib:"豬小排",fx_water_spinach:"空心菜",fx_bitter_melon:"苦瓜",fx_crown_daisy:"茼蒿",fx_green_asparagus:"綠蘆筍",fx_cauliflower:"花椰菜",fx_chives:"韭菜",fx_winter_melon:"冬瓜",fx_clam:"蛤蜊(可食肉)",fx_soft_tofu:"嫩豆腐",fx_pork_trotter:"豬腳",fx_mayonnaise:"美乃滋",fx_pork_collar:"豬頸肉",fx_pork_large_intestine:"豬大腸",fx_pork_kidney:"豬腰子",fx_beef_brisket:"牛腩",fx_pork_hock:"蹄膀",fx_potato:"馬鈴薯",fx_cuttlefish:"花枝",fx_cooked_rice:"白飯(熟)",fx_cooked_noodles:"熟麵條",fx_congee:"白粥",fx_oil_noodles:"油麵",fx_rice:"白米(生)",fx_pork_ham_lean:"瘦火腿"});
const miss=new Set();
const line=d=>{
  const ing=d.recipe.map(r=>{if(!names[r.ref])miss.add(r.ref);return (names[r.ref]||r.ref)+r.g+"g";}).join("、");
  return `${d.id}｜${d.name}｜${d.kind==="soup"?"湯":d.method}｜${d.serv}份｜約${d.mins}分｜食材(可食生重)：${ing}｜油${d.oil?d.oil.g:0}g`;
};
fs.mkdirSync(path.join(__dirname,process.env.INDIR||"in"),{recursive:true});
const N=+process.env.N||12;
for(let i=0;i*N<dishes.length;i++){
  fs.writeFileSync(path.join(__dirname,process.env.INDIR||"in",`batch${String(i).padStart(2,"0")}.txt`),dishes.slice(i*N,i*N+N).map(line).join("\n"));
}
console.log(dishes.length,"道；未解析 ref：",[...miss].join(","));
