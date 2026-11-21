import test from 'node:test';
import assert from 'node:assert/strict';
import { eventBoards, dashboardActivity, activityView } from './activity.mjs';
import { openDatabase } from './db.mjs';
import { ingestPosts } from './collector.mjs';

test('48-hour ranking distinguishes original evidence, propagation and undated historical observations', () => {
  const now=new Date('2026-11-20T12:00:00Z');
  const days='2026-11-19T10:00:00Z';
  const item=(id,postId,handle,activityAt,score,evidenceKey)=>({id,postId,handle,activityAt,score,post:{evidenceKey}});
  const rows=[item('a','1','A',days,81,'1'),item('b','1','B',days,81,'1'),item('c','2','C',days,83,'2'),
    item('d','3','D',null,80,'3'),item('e','4','E',days,70,'4'),item('f','5','F','2026-11-18T11:59:59Z',90,'5')];
  const scores=Object.fromEntries(rows.map(a=>[a.postId,{event:a.postId==='4'?'单源事件':'公司公布订单',score:a.score}]));
  const {hot,singleHot}=eventBoards(rows,scores,now,70);
  assert.equal(hot.length,1);
  assert.equal(hot[0].independentCount,2);
  assert.equal(hot[0].sourceCount,3);
  assert.deepEqual(hot[0].evidence,['1','2']);
  assert.deepEqual(singleHot.map(x=>x.evidence),[['4']]);
});

test('self repost and multiple distributors share a canonical record and translations', () => {
  const db=openDatabase(':memory:');
  try {
    ingestPosts(db,[{id:'101',handle:'Omercheema',text:'market disclosure',textZh:'市场披露',publishedAt:'2026-11-19T00:00:00Z',kind:'original'}]);
    const insert=db.prepare("INSERT INTO x_activity(source_id,tweet_id,kind,author,url,published_at,first_seen_at,last_seen_at,body,observed_at) VALUES (?,?,'repost','Omercheema','url',?,?,?,?,?)");
    const date='2026-11-19T01:00:00Z';
    for(const source of ['x-omercheema','x-hedgeyetech']) insert.run(source,'101',date,date,date,'market disclosure',source==='x-omercheema'?date:null);
    const view=activityView(db);
    const data=dashboardActivity(view,{'101':{score:75,topics:['估值'],companies:['甲']}},70);
    assert.equal(data.activities.length,3);
    assert.equal(data.featured.length,1);
    assert.equal(data.featured[0].distributors.length,2);
    assert.deepEqual(data.activities.map(a=>a.timeBasis),['observed','published','unknown']);
    assert.equal(data.activities.every(a=>a.post.textZh==='市场披露'),true);
    assert.deepEqual(data.topics.map(t=>[t.count,t.propagationCount]),[[1,2],[1,2]]);
  } finally {db.close();}
});

test('repost enrichment preserves a complete long translation and only reprocesses edited text', async () => {
  const {enrichMaterials} = await import('./research.mjs');
  const db=openDatabase(':memory:');
  const sourceText='market '.repeat(1300);
  const material={id:'700',handle:'author',publishedAt:'2026-11-19T00:00:00Z',repostOnly:true,text:sourceText};
  const calls=[];
  const complete=async ({kind,input})=>{
    calls.push(kind);
    if(kind==='translate_repost') return {translations:input.parts.map(part=>({n:part.n,text:'译文'+part.text}))};
    return {categories:input.posts.map(item=>({n:item.n,category:'市场与估值'}))};
  };
  try {
    await enrichMaterials(db,[material],{complete});
    const translation=db.prepare('SELECT translation FROM research_translations WHERE post_id=?').get(material.id).translation;
    assert.equal(translation.split('译文').join('').replaceAll('\n','').replaceAll(' ','').length,sourceText.replaceAll(' ','').length);
    const initial=calls.length;
    await enrichMaterials(db,[material],{complete});
    assert.equal(calls.length,initial);
    await enrichMaterials(db,[{...material,text:'supply chain'}],{complete});
    assert.equal(db.prepare('SELECT original FROM research_translations').get().original,'supply chain');
    assert.equal(db.prepare('SELECT count(*) AS n FROM research_translations').get().n,1);
  } finally {db.close();}
});

test('missing repost text stays visible without turning into model evidence', async () => {
  const {analyze}=await import('./research.mjs');
  const db=openDatabase(':memory:');
  try {
    const date='2026-11-19T01:00:00Z';
    db.prepare("INSERT INTO x_activity(source_id,tweet_id,kind,author,url,published_at,first_seen_at,last_seen_at) VALUES ('x-omercheema','44','repost','external','url',?,?,?)").run(date,date,date);
    const view=activityView(db);
    let calls=0;
    const result=await analyze(db,view.posts,{now:date,complete:async()=>{calls++;throw Error('unexpected model call');}});
    assert.equal(calls,0);
    assert.deepEqual(result.scores,{});
    const [activity]=dashboardActivity(view,result.scores,70).activities;
    assert.equal(activity.post.contextStatus,'unavailable');
    assert.equal(activity.score,null);
    assert.equal(activity.activityAt,null);
  } finally {db.close();}
});

test('an unreadable authored activity keeps its stable ID until the reply is hydrated', () => {
  const db=openDatabase(':memory:');
  try {
    const date='2026-11-19T01:00:00Z';
    db.prepare("INSERT INTO x_activity(source_id,tweet_id,kind,author,url,published_at,first_seen_at,last_seen_at) VALUES ('x-omercheema','99','authored','Omercheema','url',?,?,?)").run(date,date,date);
    const before=activityView(db);
    assert.equal(before.activities[0].kind,'unknown');
    assert.equal(before.posts[0].contextStatus,'unavailable');
    ingestPosts(db,[{id:'99',handle:'Omercheema',publishedAt:date,kind:'reply',text:'recovered',replyTo:{id:'80',text:'context'}}]);
    const after=activityView(db);
    assert.equal(after.activities.length,1);
    assert.equal(after.activities[0].id,before.activities[0].id);
    assert.equal(after.activities[0].kind,'reply');
    assert.equal(after.posts[0].text,'recovered');
  } finally {db.close();}
});
