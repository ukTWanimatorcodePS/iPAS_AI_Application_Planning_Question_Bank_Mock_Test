import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {summarizeCues} from '../src/content/optionCues.ts';
const {old,bank}=JSON.parse(fs.readFileSync('docs/audit-73764c1-snapshot.json','utf8'));
const files=execFileSync('git',['ls-tree','-r','--name-only','73764c1','src/content/questions'],{encoding:'utf8'}).trim().split(/\r?\n/);
const priorA2=files.flatMap(p=>JSON.parse(execFileSync('git',['show',`1c069f3:${p}`],{encoding:'utf8',maxBuffer:10000000})));
const abs=/一定|絕對|永遠|完全|所有|只要|必定|只能/;
function diff(a,b){const previous=new Map(a.map(q=>[q.id,q]));let changes=[],removed=[];for(const q of b){const p=previous.get(q.id);if(JSON.stringify(q)!==JSON.stringify(p))changes.push(q.id);for(const o of q.options){const before=p.options.find(x=>x.id===o.id);if(!q.correctOptionIds.includes(o.id)&&abs.test(before.text)&&!abs.test(o.text))removed.push({id:q.id,option:o.id});}}return {questions:changes.length,removedOptions:removed.length,removedQuestions:new Set(removed.map(x=>x.id)).size};}
const result={range:diff(old,bank),A2:diff(priorA2,bank),A2Baseline:summarizeCues(priorA2)};
fs.writeFileSync('docs/audit-73764c1-counts.json',JSON.stringify(result,null,2));console.log(result);
