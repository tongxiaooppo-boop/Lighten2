// 合併兩個來源 → final/steps.json、final/sets.json（預設取 GPT 版；review.json 內有人工/交叉審查的指定時照指定）
const fs=require("fs"),path=require("path");
const P=require("../../tools/lib/parse-loose");
const O=path.join(__dirname,"out"),F=path.join(__dirname,"final");
fs.mkdirSync(F,{recursive:true});
const readAll=(re)=>{const m={};for(const f of fs.readdirSync(O).filter(x=>re.test(x)).sort())try{P(fs.readFileSync(path.join(O,f),"utf8")).forEach(d=>{m[d.id]=d})}catch(e){console.error("BAD",f,e.message)}return m};
const gpt=readAll(/^batch.*\.gpt\.json$/),ds=readAll(/^batch.*\.ds\.json$/);
const review=fs.existsSync(path.join(__dirname,"review.json"))?JSON.parse(fs.readFileSync(path.join(__dirname,"review.json"),"utf8")):{pick:{}};
const steps={};let both=0;
for(const id of Object.keys(gpt)){
  const pick=review.pick[id]||"gpt";
  const c=(pick==="ds"&&ds[id])?ds[id]:gpt[id];
  steps[id]={steps:c.steps,tip:c.tip||"",buy:c.buy||"",src:pick};
  if(ds[id])both++;
}
fs.writeFileSync(path.join(F,"steps.json"),JSON.stringify(steps,null,1));
console.log("steps",Object.keys(steps).length,"兩來源皆有",both);
const sets=[];
const rd=f=>fs.existsSync(path.join(O,f))?JSON.parse(fs.readFileSync(path.join(O,f),"utf8")):[];
const MID={plate:375,bowl:375,box:525};
for(const k of ["plate","bowl","box"]){
  const cand=rd("sets.fixed.gpt.json").concat(rd("sets.fixed.ds.json")).filter(s=>s.entry===k);
  const byType={};
  cand.forEach(s=>{(byType[s.type]=byType[s.type]||[]).push(s)});
  for(const t of Object.keys(byType)){
    const best=byType[t].sort((a,b)=>(Math.abs(a.est.kcal-MID[k])-a.est.protein_g)-(Math.abs(b.est.kcal-MID[k])-b.est.protein_g))[0];
    best.name=best.name.replace(/[（(]每盒[）)]/g,"");if(best.type==="蛋素"||best.type==="素食")best.type="蛋奶素";
    if(best.entry==="box"&&best.type==="極速")best.type="快速備餐";
    // 審查修正（GPT 審稿 2026-10-15）：帶殼蛋不可微波；牛腱不適合短時間快炒，改去皮雞腿肉
    best.steps=best.steps.map(x=>/雞蛋.*微波/.test(x)&&!/煮|蒸/.test(x)?"雞蛋冷水下鍋，水滾後轉中小火煮 8 分鐘，泡冷水剝殼（不要整顆帶殼微波，會爆裂）。":x);
    if(best.items.some(i=>i.name==="牛腱")){
      best.items.forEach(i=>{if(i.name==="牛腱")i.name="去皮雞腿肉"});
      best.steps=best.steps.map(x=>x.replace(/牛腱/g,"雞腿肉").replace(/切塊，沸水加少許鹽煮40分鐘至軟（或壓力鍋15分鐘），放涼切片/,"切塊，平底鍋中小火煎 6–8 分鐘至全熟，放涼").replace(/炒 3–4 分鐘/,"炒 5–6 分鐘至全熟").replace(/加蓋燜煮15–20分鐘至軟嫩/,"加蓋燜煮 8–10 分鐘至全熟"));
      best.name=best.name.replace(/牛腱/g,"雞腿");
    }sets.push(best);
  }
}
fs.writeFileSync(path.join(F,"sets.json"),JSON.stringify(sets,null,1));
console.log("sets",sets.length,sets.map(s=>s.entry+"/"+s.type+"/"+s.src).join(" "));
