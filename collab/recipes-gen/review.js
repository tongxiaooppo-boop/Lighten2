// 交叉審查：每 6 道菜把 GPT 版與 DeepSeek 版（隨機 A/B）給 GPT-5.4 mini 審，挑較好的並指出錯誤 → review.json {pick:{id:"gpt|ds"}, notes:{id:"..."}}
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
const P=require("../../tools/lib/parse-loose"),S=require("./score");
const O=path.join(__dirname,"out");
const readAll=re=>{const m={};for(const f of fs.readdirSync(O).filter(x=>re.test(x)))try{P(fs.readFileSync(path.join(O,f),"utf8")).forEach(d=>m[d.id]=d)}catch(e){}return m};
const gpt=readAll(/^batch.*\.gpt\.json$/),ds=readAll(/^batch.*\.ds\.json$/);
const lines={};for(const f of fs.readdirSync(path.join(__dirname,"in")))fs.readFileSync(path.join(__dirname,"in",f),"utf8").split("\n").forEach(l=>lines[l.split("｜")[0]]=l);
const rv=fs.existsSync("review.json")?JSON.parse(fs.readFileSync("review.json","utf8")):{pick:{},notes:{}};
const ids=Object.keys(gpt).filter(id=>ds[id]&&!rv.pick[id]);
console.log("待審",ids.length);
for(let i=0;i<ids.length;i+=6){
  const grp=ids.slice(i,i+6);
  const flip={};
  const body=grp.map(id=>{flip[id]=Math.random()<0.5;const [a,b]=flip[id]?[ds[id],gpt[id]]:[gpt[id],ds[id]];
    return `【${id}】${lines[id]}\nA版：${JSON.stringify({steps:a.steps,tip:a.tip})}\nB版：${JSON.stringify({steps:b.steps,tip:b.tip})}`}).join("\n\n");
  const p=`你是台灣家常菜審稿人。下面每道菜有 A、B 兩版作法，食材克數是可食生重。請逐道審：食安（肉類熟度、蛋、海鮮）、火候與時間是否合理、步驟是否與食材清單矛盾（用了清單沒有的食材、克數不符）、順序是否可行、是否適合減脂（少油）。挑出較好的一版（A 或 B），若兩版都有明顯錯誤請在 note 寫出該改什麼。
只輸出【純 JSON 陣列】，每道：{"id":"...","pick":"A"或"B","note":"一句話理由；有錯誤則寫明錯在哪"}\n\n${body}`;
  const r=spawnSync(process.execPath,["D:/ok/gptstudio/node_modules/tsx/dist/cli.mjs","src/cli.ts","--mini","--effort","low",p],{encoding:"utf8",cwd:"D:/ok/gptstudio/server",maxBuffer:64e6});
  if(r.status!==0){console.error("失敗",r.stderr.slice(-200));break}
  try{P(r.stdout).forEach(x=>{if(!flip.hasOwnProperty(x.id))return;const isA=x.pick==="A";const useDs=flip[x.id]?isA:!isA;rv.pick[x.id]=useDs?"ds":"gpt";rv.notes[x.id]=x.note})}catch(e){console.error("解析失敗",e.message)}
  fs.writeFileSync("review.json",JSON.stringify(rv,null,1));
  console.log("審完",Math.min(i+6,ids.length),"/",ids.length);
}
const c={gpt:0,ds:0};Object.values(rv.pick).forEach(v=>c[v]++);console.log("選 GPT",c.gpt,"選 DS",c.ds);
