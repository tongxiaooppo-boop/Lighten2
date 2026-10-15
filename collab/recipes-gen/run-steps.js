// 逐批請 DeepSeek V4 Pro 寫作法 → out/batchNN.json（已有的跳過）。用法：node run-steps.js [--model pro|mini]
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
const isGpt=process.argv.includes("--gpt");
const model=isGpt?"--mini":"--flash";
const tag=isGpt?"gpt":"ds";
fs.mkdirSync(path.join(__dirname,"out"),{recursive:true});
const HEAD=`你是台灣家常菜食譜編輯。以下每行是一道菜：id｜菜名｜做法類型｜份數｜時間｜食材（克數是「可食生重」，骨頭殼已扣除）｜油量。
請為每道菜寫「作法」，輸出【純 JSON 陣列】（不要 markdown 圍欄、不要說明文字），每個元素：
{"id":"原樣id","steps":["步驟1","步驟2",...],"tip":"一句小撇步或注意事項（可空字串）"}
規則：
1. steps 4–7 步，每步一句，≤40 字，要有火候、時間或判斷標準（例如「中大火炒 2 分鐘至菜軟」）。
2. 只能用該行列出的食材與調味，不得新增食材（水、蔥薑蒜若沒列出就不要加）；步驟內提到食材時帶上克數或「全部」，與清單一致。
3. 帶骨/帶殼食材（排骨、雞腿、蛤蜊、魚）在步驟中寫明購買時需買多少帶骨/帶殼重（用常識估：排骨可食約 65%、帶骨雞腿 70%、蛤蜊肉約 25%、整魚約 50%），放在第 1 步「備料」。
4. 台灣家常做法，用減脂友善的順序（少油、先蒸/煮再炒優先），不要編造不存在的醬料。
5. 份數照原樣，最後一步可寫「分成 N 份」。
菜單：
`;
const files=fs.readdirSync(path.join(__dirname,process.env.INDIR||"in")).sort();
const PART=(process.env.PART||"0/1").split("/").map(Number);
for(const [fi,f] of files.entries()){
  if(fi%PART[1]!==PART[0])continue;
  const out=path.join(__dirname,"out",f.replace(".txt",`.${tag}.json`));
  if(fs.existsSync(out)&&fs.statSync(out).size>50)continue;
  const prompt=HEAD+fs.readFileSync(path.join(__dirname,process.env.INDIR||"in",f),"utf8");
  console.log("→",f);
  const r=spawnSync(process.execPath,["D:/ok/gptstudio/node_modules/tsx/dist/cli.mjs","src/cli.ts",...(isGpt?[]:[model]),"--effort","none",prompt],{encoding:"utf8",cwd:"D:/ok/gptstudio/server",maxBuffer:64e6});
  if(r.error)console.error(r.error);if(r.status!==0){console.error("失敗",f,r.status,(r.stderr||"").slice(-400));process.exit(1);}
  fs.writeFileSync(out,r.stdout);
}
console.log("done");
