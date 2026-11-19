import fs from 'node:fs';
import {rankStrategyScore,absoluteEliminationScore,summarizeCues} from '../src/content/optionCues.ts';
const {old,bank}=JSON.parse(fs.readFileSync('docs/audit-73764c1-snapshot.json','utf8'));
const permutations=a=>a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>i!==j)).map(p=>[v,...p])):[[]];
const perms=permutations([0,1,2,3]);
let rankChecks=0,elimChecks=0,failures=[];
for(let shape=0;shape<256;shape++)for(let correct=0;correct<4;correct++){
 const lengths=[0,1,2,3].map(i=>1+((shape>>(2*i))&3));
 const q={id:'probe',subject:'L11',correctOptionIds:['ABCD'[correct]],options:lengths.map((n,i)=>({id:'ABCD'[i],text:'😀'.repeat(n)}))};
 const hits=[0,0,0,0];
 for(const p of perms){const sorted=[...p].sort((a,b)=>lengths[b]-lengths[a]);sorted.forEach((i,k)=>hits[k]+=Number(i===correct)/24);}
 for(let k=1;k<=4;k++){rankChecks++;if(Math.abs(rankStrategyScore(q,k)-hits[k-1])>1e-10)failures.push({kind:'rank',shape,correct,k});}
 for(let mask=0;mask<16;mask++)for(const thenLongest of [false,true]){
  const test={...q,options:q.options.map((o,i)=>({...o,text:(mask&(1<<i)?'一定':'')+o.text}))};
  let pool=[0,1,2,3].filter(i=>!(mask&(1<<i)));if(!pool.length)pool=[0,1,2,3];
  if(thenLongest){const max=Math.max(...pool.map(i=>[...test.options[i].text].length));pool=pool.filter(i=>[...test.options[i].text].length===max);}
  const expected=pool.includes(correct)?1/pool.length:0;
  elimChecks++;if(absoluteEliminationScore(test,thenLongest)!==expected)failures.push({kind:'absolute',shape,correct,mask,thenLongest});
 }
}
const patterns={literal:/一定|絕對|永遠|完全|所有|只要|必定|只能/,expanded:/一定|絕對|永遠|完全|所有|只要|必定|只能|每[個位份項筆一]|全部|各[個項種家]|保證|一律|任何|不必|不需|無法|就能|就可以|就會/};
function strategy(q,re,mode){let pool=q.options.filter(o=>!re.test(o.text));if(!pool.length)pool=q.options;if(mode==='longest'){const max=Math.max(...pool.map(o=>[...o.text].length));pool=pool.filter(o=>[...o.text].length===max);}return pool.filter(o=>q.correctOptionIds.includes(o.id)).length/pool.length;}
function probe(qs){const result={};for(const [name,re] of Object.entries(patterns))result[name]={random:qs.reduce((s,q)=>s+strategy(q,re),0)/qs.length*100,longest:qs.reduce((s,q)=>s+strategy(q,re,'longest'),0)/qs.length*100};return result;}
const cautious=/可能|通常|不一定|未必|視情況|依情況/;
function cautiousScore(qs){let triggers=0,hits=0;for(const q of qs){const pool=q.options.filter(o=>cautious.test(o.text));if(pool.length===1){triggers++;hits+=Number(q.correctOptionIds.includes(pool[0].id));}}return {triggers,hits,conditional:triggers?hits/triggers*100:0,withRandomFallback:(hits+(qs.length-triggers)/4)/qs.length*100};}
const output={rankChecks,elimChecks,failures,old:summarizeCues(old),current:summarizeCues(bank),sensitivity:{old:probe(old),current:probe(bank)},cautious:{old:cautiousScore(old),current:cautiousScore(bank)}};
fs.writeFileSync('docs/audit-73764c1-metrics.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
