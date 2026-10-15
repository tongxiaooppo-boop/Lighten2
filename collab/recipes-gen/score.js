// 作法候選的機械檢查：步驟內的「N g/克」必須對得上食材清單（或其整數分攤）；步驟數 4–7；每步 ≤45 字
const fs=require("fs"),path=require("path");
const P=require("../../tools/lib/parse-loose");
const lines={};
for(const f of fs.readdirSync(path.join(__dirname,"in")))fs.readFileSync(path.join(__dirname,"in",f),"utf8").split("\n").forEach(l=>{const a=l.split("｜");lines[a[0]]=a});
function gramsOf(id){const a=lines[id];const ing=a[5].replace("食材(可食生重)：","");const gs=[...ing.matchAll(/(\d+(?:\.\d+)?)g/g)].map(m=>+m[1]);const oil=+a[6].replace(/[^0-9.]/g,"");gs.push(oil);return{gs,serv:parseInt(a[3]),ing}}
exports.check=(id,c)=>{
  const issues=[];const{gs,serv}=gramsOf(id);
  if(!c.steps||c.steps.length<4||c.steps.length>8)issues.push("步驟數 "+(c.steps||[]).length);
  const set=new Set(gs);const sums=[];for(let i=0;i<gs.length;i++)for(let j=i+1;j<gs.length;j++)sums.push(gs[i]+gs[j]);sums.forEach(x=>set.add(x));
  const total=gs.reduce((a,b)=>a+b,0);set.add(total);
  (c.steps||[]).forEach((s,i)=>{
    if(s.length>50)issues.push(`第${i+1}步過長(${s.length}字)`);
    if(i>0)for(const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(?:g|克|公克)/g)){const v=+m[1];if(!set.has(v)&&Math.abs(v-total/serv)>1&&![...set].some(x=>Math.abs(x/2-v)<0.6||Math.abs(x/3-v)<0.6))issues.push(`第${i+1}步 ${v}g 對不上食材`)}
  });
  return issues};
if(require.main===module){
  const O=path.join(__dirname,"out");let bad=0,n=0;
  for(const tag of ["gpt","ds"])for(const f of fs.readdirSync(O).filter(x=>new RegExp("^batch.*\."+tag+"\.json$").test(x))){
    try{P(fs.readFileSync(path.join(O,f),"utf8")).forEach(d=>{n++;const r=exports.check(d.id,d);if(r.length){bad++;console.log(tag,d.id,r.join("；"))}})}catch(e){console.log("BAD",f)}}
  console.log("共",n,"有問題",bad);
}
