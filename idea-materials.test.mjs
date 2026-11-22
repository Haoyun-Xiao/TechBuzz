import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ideaGroups,ideaMaterials} from './idea-materials.mjs';
const normalize=x=>x;
const row=(id,day,topics,summary,score=80)=>({material:{id,publishedAt:day},publishedMs:Date.parse(day),assessment:{topics,summary,score,companies:['Example']}});
test('dossiers retain relevant low-score evidence and exclude future or unrelated same-company posts',()=>{
 const seed=row('trigger','2026-11-22',['融资'],'融资与现金流');
 const counter=row('counter','2026-11-21',['融资'],'付款风险',30);
 const unrelated=row('product','2026-11-21',['新产品'],'产品发布');
 const future=row('future','2026-11-24',['融资'],'融资完成');
 const posts=[seed,counter,unrelated,future];
 assert.deepEqual(ideaMaterials([seed],posts,Date.parse('2026-11-23'),normalize).map(r=>r.material.id),['counter','trigger']);
 assert.deepEqual(ideaGroups([seed,unrelated],normalize).map(g=>g.length),[1,1]);
 assert.equal(counter.assessment.score,30);
});
