// 減重推薦套組：早餐盤／早餐碗／餐盒各請 DeepSeek Pro 與 GPT 出 8 套 → out/sets.<entry>.<tag>.json
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
const isGpt=process.argv.includes("--gpt"), tag=isGpt?"gpt":"ds";
const ING="蛋白質：雞胸肉、雞蛋(1顆50g)、希臘優格(無糖)、鮭魚、牛腱、去皮雞腿肉、鯛魚片、板豆腐、蝦仁、無糖豆漿、毛豆仁、水煮鮪魚罐頭、五香豆干、起司片、火腿片、低脂牛奶\n主食：燕麥片、地瓜、糙米飯、藜麥、雜糧飯、南瓜、花椰菜米、馬鈴薯、玉米粒、吐司、饅頭\n蔬菜：青花菜、菠菜、芹菜、綠竹筍、高麗菜、小黃瓜、番茄、紅甜椒、洋蔥、白蘿蔔、甜豆、玉米筍、秋葵、茄子、絲瓜、黑木耳、鮮香菇、綠豆芽、萵苣、紅蘿蔔、地瓜葉\n水果：香蕉、蘋果、奇異果、草莓、芭樂、木瓜、柳丁、鳳梨\n堅果：杏仁、核桃、腰果、花生\n調味：烹調用油(橄欖油/沙拉油)、鹽、醬油、照燒醬、韓式泡菜、黑胡椒";
const CAT={
 plate:{n:"早餐盤",d:"一個盤子裝多樣：蛋白質＋碳水＋蔬菜（可含水果），可煎、水煮、微波，10–15 分鐘內完成，適合上班族早晨。"},
 bowl:{n:"早餐碗",d:"一個碗：乳品/豆漿底＋穀物（燕麥/藜麥）＋水果＋堅果，免開火或微波，5–10 分鐘完成；也可做成鹹口味燕麥粥。"},
 box:{n:"餐盒",d:"午晚餐備餐便當盒：蛋白質＋主食＋至少 2 樣蔬菜，可一次做 3–4 盒冷藏、微波加熱，每盒標明冷藏天數。"}};
const mk=(k,TY)=>`你是台灣減重營養師兼家常料理編輯。請為「${CAT[k].n}」設計 ${TY.length} 套減重常見推薦（${CAT[k].d}）。
這 ${TY.length} 套的類型各是：${TY}。
限制：
- 食材只能從下列清單選（可食生重/生重 g；蛋與優格、豆漿、牛奶也用 g），不得出現清單外食材：
${ING}
- 每套必須具體：每項食材的名稱＋克數(或顆數)、做法 4–7 步（含火候/時間）、預估總熱量與蛋白質/碳水/脂肪/纖維(g)。
- 重量基準：燕麥片、藜麥是乾重(每100g約380-400kcal；燕麥15-40g、藜麥30-50g)；糙米飯、雜糧飯是煮熟重(每100g約180kcal)；其餘肉蔬生重。
- 熱量：早餐盤/碗每套 300–450 kcal；餐盒每盒 450–600 kcal。蛋白質早餐≥20g、餐盒≥30g。減醣類碳水≤30g(早餐)/≤45g(餐盒)。算術要自洽。
- 烹調油用量要算進去(煎炒各約 5g)，餐盒蔬菜至少 150g。
輸出【純 JSON 陣列】（不要 markdown 圍欄、不要說明）元素格式：
{"name":"套組名","type":"減醣|高蛋白|高纖|低GI|地中海|素食|極速|增肌減脂","why":"一句話為什麼適合減重","items":[{"name":"食材","g":數字}],"steps":["..."],"est":{"kcal":0,"protein_g":0,"carb_g":0,"fat_g":0,"fiber_g":0},"prep_min":0,"keep":"可冷藏天數或現做","tip":"一句小撇步"}`;
fs.mkdirSync(path.join(__dirname,"out"),{recursive:true});
const TYS=[["減醣","高蛋白","高纖","低GI"],["地中海","素食","極速","增肌減脂"]];
const BOXT=["減醣","高蛋白","高纖","低GI","地中海","素食","極速","增肌減脂"].map(x=>[x]);const PAR=(process.env.PAR||"0/1").split("/").map(Number);
for(const k of Object.keys(CAT)) for(const [ti,TY] of (k==="box"?BOXT:TYS).entries()){ if(k==="box"&&ti%PAR[1]!==PAR[0])continue;
  const out=path.join(__dirname,"out",`sets.${k}.${tag}${ti}.json`);
  if(fs.existsSync(out)&&fs.statSync(out).size>50)continue;
  console.log("→",k,ti);
  const r=spawnSync(process.execPath,["D:/ok/gptstudio/node_modules/tsx/dist/cli.mjs","src/cli.ts",...(isGpt?[]:["--flash"]),"--effort","none",mk(k,TY.join("、"))],{encoding:"utf8",cwd:"D:/ok/gptstudio/server",maxBuffer:64e6});
  if(r.status!==0){console.error("失敗",k,(r.stderr||"").slice(-300));process.exit(1);}
  fs.writeFileSync(out,r.stdout);
}
console.log("done");
