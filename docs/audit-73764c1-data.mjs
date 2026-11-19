import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-tree','-r','--name-only','73764c1','src/content/questions'],{encoding:'utf8'}).trim().split(/\r?\n/);
const load=rev=>files.flatMap(p=>JSON.parse(execFileSync('git',['show',`${rev}:${p}`],{encoding:'utf8',maxBuffer:10000000})));
const old=load('5ce595c'),bank=load('73764c1'),before=new Map(old.map(q=>[q.id,q]));
const changed=bank.filter(q=>JSON.stringify(q)!==JSON.stringify(before.get(q.id)));
const listed=JSON.parse(fs.readFileSync('docs/REVIEW_REQUEST_73764c1_changed_ids.json','utf8'));
const abs=/一定|絕對|永遠|完全|所有|只要|必定|只能/;
const removals=changed.flatMap(q=>q.options.filter(o=>!q.correctOptionIds.includes(o.id)&&abs.test(before.get(q.id).options.find(x=>x.id===o.id).text)&&!abs.test(o.text)).map(o=>({id:q.id,option:o.id})));
fs.writeFileSync('docs/audit-73764c1-snapshot.json',JSON.stringify({old,bank,changed:changed.map(q=>q.id),removals}));
const mode=process.argv[2]??'all',start=Number(process.argv[3]??0),count=Number(process.argv[4]??25);
const ids=mode==='fixed'?['L12202-0012','L11402-0008','L11402-0010','L23301-0012','L22401-0005','L22101-0015','L22401-0008','L23401-0008'].map(x=>'original-'+x):mode==='a2'?[...new Set(removals.map(x=>x.id))]:changed.map(q=>q.id);
if(mode==='meta'){
const fields=['id','stem','correctOptionIds','reviewStatus','code','verification'];
console.log(JSON.stringify({old:old.length,new:bank.length,changed:changed.length,optionChanged:changed.filter(q=>JSON.stringify(q.options)!==JSON.stringify(before.get(q.id).options)).length,listed:listed.length,missing:changed.filter(q=>!listed.includes(q.id)).map(q=>q.id),extra:listed.filter(id=>!changed.some(q=>q.id===id)),removals:removals.length,fields:Object.fromEntries(fields.map(k=>[k,changed.filter(q=>JSON.stringify(q[k])!==JSON.stringify(before.get(q.id)[k])).map(q=>q.id)]))},null,2));
}else for(const id of ids.slice(start,start+count)){
const q=bank.find(x=>x.id===id),b=before.get(id);
console.log(`\n${id} ${q.stem} [${q.correctOptionIds}]`);
if(q.stem!==b.stem)console.log('舊題幹:'+b.stem);
for(const o of q.options){const bo=b.options.find(x=>x.id===o.id);console.log(`${o.id}${o.text!==bo.text?'*':''} ${o.text} | ${q.explanation.optionRationales[o.id]}`);if(o.text!==bo.text)console.log(`  舊:${bo.text}`);}
if(mode==='fixed')console.log(JSON.stringify(q.explanation));
}
