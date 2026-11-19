import fs from 'node:fs';
const {old,bank,changed}=JSON.parse(fs.readFileSync('docs/audit-73764c1-snapshot.json','utf8'));
const previous=new Map(old.map(q=>[q.id,q]));
const notes={
 'original-L22102-0008':'N1：固定 n=200 不足保證常態近似；A2 改寫後 C 的歧義需處理。',
 'original-L11301-0006':'N2：D 加通常後仍缺單次／整段服務期間的比較單位，解析未排除後者。',
 'original-L11402-0008':'F2 核心修正接受；S1：D 解析仍須避免不依 token 預算就斷言超長。',
 'original-L21104-0006':'S2：B 解析沿用名稱未命中即找不到，忽略描述及同義詞；既有缺漏。',
 'original-L23401-0005':'S3：這一個特定等加長文案建議精簡；不認定兩解。',
 'original-L23303-0014':'S3：最後／最終重複，建議精簡；不認定兩解。',
};
const rows=changed.map(id=>{const q=bank.find(x=>x.id===id),p=previous.get(id);return {id,stemChanged:q.stem!==p.stem,changedOptions:q.options.filter(o=>o.text!==p.options.find(x=>x.id===o.id).text).map(o=>o.id),result:notes[id]??'已以題幹、四選項及解析核對本次改寫；本次未見應另列的問題。此為 AI 複查，非專業人工審核通過。'};});
fs.writeFileSync('docs/AUDIT_73764c1_reviewed_ids.json',JSON.stringify(rows,null,2));
console.log(`Review ledger: ${rows.length} questions`);
