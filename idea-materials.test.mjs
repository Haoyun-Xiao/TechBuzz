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

test('V3 persists the four fields while a high-score context cannot replace a trigger',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {analyze,initResearch}=await import('./research.mjs');
 const db=new DatabaseSync(':memory:');initResearch(db);
 let observed;
 const model=async ({kind,input})=>{
  if(kind==='score')return {scores:input.posts.map(p=>({id:p.id,breakdown:{impact:p.id==='trigger'?30:20,novelty:20,verification:20,followUp:12},summary:'融资与现金流',reason:'公司披露',strength:'high',companies:['Example'],topics:['融资'],event:'融资安排'}))};
  if(kind==='ideas'){if(!input.triggerIds.includes('trigger'))return {entries:[]};observed=input;return {entries:[{id:'',title:'融资对现金回报的影响',summary:'检验股东回报',stance:'事件博弈',targetScope:'Example',horizon:'下一次披露',maturity:'早期线索',pitch:'资金落实后检验股东回报',variantView:'融资成本仍需核实',catalystAndKillSwitch:'交付延期削弱假设',nextDD:'查看融资条款',watchVariables:[{name:'交付',supportIf:'按期',invalidateIf:'延期'}],evidence:['trigger','context'],counterEvidence:[],relatedIds:[]}]}}
  return kind.startsWith('trend_')?{signals:[]}:{entries:[]};
 };
 const posts=[{id:'context',handle:'source',text:'较早的融资条件',publishedAt:'2026-11-21T00:00:00Z'},{id:'trigger',handle:'source',text:'融资安排',publishedAt:'2026-11-22T00:00:00Z'}];
 await analyze(db,[posts[0]],{now:'2026-11-21T00:01:00Z',complete:model});
 const output=await analyze(db,posts,{now:'2026-11-22T00:01:00Z',complete:model});
 assert.equal(output.ideas.length,1);
 assert.equal(output.ideas[0].researchFormat,3);
 assert.equal(output.ideas[0].pitch,'资金落实后检验股东回报');
 assert.equal(output.ideas[0].watchVariables[0].name,'交付');
 assert.equal(observed.posts.find(p=>p.id==='context').allowNewIdea,false);
 assert.deepEqual(observed.triggerIds,['trigger']);
 db.close();
});
