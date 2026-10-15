// 用衛福部/代換表重算每套營養，不合標準的請 GPT(mini) 修正份量與步驟，最多 3 輪 → out/sets.fixed.<tag>.json
// 用法：node fix-sets.js gpt|ds
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
const P=require("../../tools/lib/parse-loose"),resolver=require("../../tools/lib/resolve-names").load();
const tag=process.argv[2]||"gpt";
const O=path.join(__dirname,"out");
const LIM={plate:{k:[300,450],p:20},bowl:{k:[300,450],p:20},box:{k:[450,600],p:30}};
const calc=s=>{const t={kcal:0,protein_g:0,carb_g:0,fat_g:0,fiber_g:0};const miss=[];
  s.items.forEach(i=>{const x=resolver(i.name);if(!x){miss.push(i.name);return}for(const k in t)t[k]+=(x.per_100g[k]||0)*i.g/100});
  for(const k in t)t[k]=+t[k].toFixed(1);return{t,miss}};
const issues=(s)=>{const{t,miss}=calc(s);const L=LIM[s.entry];const r=[];
  if(miss.length)r.push("查不到食材："+miss.join("、"));
  if(t.kcal<L.k[0]||t.kcal>L.k[1])r.push(`熱量 ${Math.round(t.kcal)} kcal 不在 ${L.k[0]}–${L.k[1]}`);
  if(t.protein_g<L.p)r.push(`蛋白質 ${Math.round(t.protein_g)}g 低於 ${L.p}g`);
  if(s.type==="減醣"&&t.carb_g>(s.entry==="box"?45:30))r.push(`減醣但碳水 ${Math.round(t.carb_g)}g 過高`);
  return{r,t}};
const ask=p=>{const r=spawnSync(process.execPath,["D:/ok/gptstudio/node_modules/tsx/dist/cli.mjs","src/cli.ts","--mini","--effort","low",p],{encoding:"utf8",cwd:"D:/ok/gptstudio/server",maxBuffer:64e6});if(r.status!==0)throw new Error(r.stderr.slice(-300));return r.stdout};
const NOTE="注意重量基準：燕麥片、藜麥是『乾重』（每100g約380–400kcal，一餐燕麥15–40g、藜麥30–50g乾重）；糙米飯、雜糧飯是『煮熟重』（每100g約180kcal）；雞蛋1顆=50g；其餘肉蔬為生重。烹調油5g≈44kcal、堅果10g≈58–65kcal。";
const out=[];
for(const k of ["plate","bowl","box"]){
  let list=[];
  for(const suf of ["","0","1","2","3","4","5","6","7"]){const f=path.join(O,`sets.${k}.${tag}${suf}.json`);if(!fs.existsSync(f))continue;
    try{list=list.concat(P(fs.readFileSync(f,"utf8")))}catch(e){console.error("BAD",f,e.message)}}
  for(let s of list){
    s=Object.assign({entry:k,src:tag},s);
    for(let round=0;round<3;round++){
      const{r,t}=issues(s);if(!r.length){s.est=t;out.push(s);console.log("✓",k,s.name,Math.round(t.kcal),Math.round(t.protein_g));s=null;break}
      console.log("…",k,s.name,r.join("；"));
      const p=`以下是一套減重${{plate:"早餐盤",bowl:"早餐碗",box:"餐盒"}[k]}，用衛福部資料重算的營養與問題如下，請修正份量(必要時換食材，僅限原清單食材)與作法，使通過標準，並讓 name/type 維持合理。\n${NOTE}\n問題：${r.join("；")}\n重算：${JSON.stringify(t)}\n原套組：${JSON.stringify({name:s.name,type:s.type,why:s.why,items:s.items,steps:s.steps,prep_min:s.prep_min,keep:s.keep,tip:s.tip})}\n只輸出修正後的【單一 JSON 物件】(同樣欄位 name,type,why,items[{name,g}],steps,prep_min,keep,tip)，不要說明、不要 markdown。步驟內的克數必須與 items 一致。`;
      try{const txt=ask(p);const a=txt.indexOf("{"),b=txt.lastIndexOf("}");const n=JSON.parse(txt.slice(a,b+1));s=Object.assign({entry:k,src:tag},n)}catch(e){console.log("  修正失敗",e.message.slice(0,100));break}
    }
    if(s)console.log("✗ 放棄",k,s.name);
  }
}
fs.writeFileSync(path.join(O,`sets.fixed.${tag}.json`),JSON.stringify(out,null,1));
console.log("fixed",out.length);
