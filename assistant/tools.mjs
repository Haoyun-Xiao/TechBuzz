import { createHash } from 'node:crypto';
const DAY=86400000;
const normalize = v => String(v??'').normalize('NFKC').toLowerCase();
const schema = (name,description,properties,required=[]) => ({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const str = {type:'string'}, num = {type:'integer',minimum:0};
export const TOOLS = [
  schema('search_posts','搜索完整存储范围中的帖子目录（摘要不是原文）。默认最近30天，无评分门槛。q 可用公司中英文名、股票代码，多个词为空格分隔的OR查询；不填q用于广泛扫描。offset分页，dateFrom/dateTo为北京时间日期。',{q:str,account:str,company:str,topic:str,dateFrom:str,dateTo:str,offset:num,limit:{type:'integer',minimum:1,maximum:100}}),
  schema('read_posts','按ID读取完整原文、译文、引用与回复上文及同作者串帖，不截断正文。根帖与串帖分页，依据 nextOffset 续读。',{ids:{type:'array',items:str,maxItems:12,minItems:1},offset:num,limit:{type:'integer',minimum:1,maximum:12}},['ids']),
  schema('read_research','读取历史模型研究，不能当作独立事实。支持 ideas/trends/reports，按id详情或q检索；evidence字段可供read_posts回查。',{section:{type:'string',enum:['ideas','trends','reports']},id:str,q:str,offset:num},['section']),
  schema('web_search','按需核验公开网络信息，优先公司公告、IR和原始技术文献。只发送公开关键词。返回的是网页检索片段，不冒充完整网页。',{query:str},['query']),
];
export async function fetchSnapshot(base,signal) {
  const r=await fetch(`${base.replace(/\/$/,'')}/api/dashboard`,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  if(!r.ok) throw new Error(`TechBuzz 材料读取失败 (${r.status})`);
  return r.json();
}
export async function webSearch(query,signal) {
  const r=await fetch('https://mcp.exa.ai/mcp',{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'web_search_exa',arguments:{query,numResults:4}}})});
  if(!r.ok) throw new Error(`网络检索暂不可用 (${r.status})`);
  const raw=await r.text();
  let data;
  if(r.headers.get('content-type')?.includes('text/event-stream')) data=raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5));}catch{return null;}}).find(x=>x?.id===1);
  else data=JSON.parse(raw);
  if(data?.result?.isError || !data?.result) throw new Error('网络检索未返回可用结果');
  const pages=[];
  for(const block of data.result.content??[]) for(const text of (block.text??'').split(/(?=^Title: )/m)) {
    const url=/^URL:\s*(https?:\/\/\S+)/m.exec(text)?.[1];
    if(!url || pages.some(p=>p.url===url))continue;
    pages.push({title:/^Title:\s*(.+)/m.exec(text)?.[1]??url,url,date:/^Published(?: Date)?:\s*(.+)/m.exec(text)?.[1]??null,passage:text,kind:'web',extent:'search_excerpt'});
  }
  return pages.slice(0,4);
}
export function makeTools(snapshot,{signal,search=webSearch,now=Date.now(),historicalSources=[]}={}) {
  const refs=new Map(), readIds=new Set();
  const historyWeb=historicalSources.filter(s=>s.kind==='web'&&s.key&&s.url&&s.passage).map(s=>({...s,cached:true,revalidatedThisTurn:false}));
  for(const s of historyWeb)refs.set(s.key,s);
  const posts=new Map(snapshot.posts.map(p=>[p.id,p]));
  for(const p of snapshot.posts) for(const alias of [p.nativeArticleId,...(p.aliases??[])].filter(Boolean)) posts.set(alias,p);
  const postRef=p=>({key:'P-'+p.id,kind:'post',id:p.id,title:snapshot.scores?.[p.id]?.event||`@${p.handle} · ${p.publishedAt??'时间未知'}`,url:p.url||null,href:'/research/posts/'+p.id,date:p.publishedAt??null});
  function addRef(ref){refs.set(ref.key,ref);return `[${ref.key}]`;}
  function bounds(a){const from=a.dateFrom?Date.parse(a.dateFrom+'T00:00:00+08:00'):now-30*DAY;const to=a.dateTo?Date.parse(a.dateTo+'T23:59:59.999+08:00'):now;if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)throw new Error('日期范围无效');return {from,to};}
  function searchPosts(a) {
    const {from,to}=bounds(a); const terms=normalize(a.q).split(/\s+/).filter(Boolean);
    const topicIds = a.topic||a.company ? new Set((snapshot.topics??[]).filter(t=>normalize(t.name).includes(normalize(a.topic||a.company))).flatMap(t=>t.postIds??[])):null;
    const seen=new Set(); const hits=[];
    for(const p of snapshot.posts){
      const time=Date.parse(p.publishedAt); if(!Number.isFinite(time)||time<from||time>to)continue;
      const key=p.originId||p.id;if(seen.has(key))continue;
      const distributors=(snapshot.activities??[]).filter(v=>v.postId===p.id).flatMap(v=>v.distributors??[v.handle]);
      if(a.account&&![p.handle,...distributors].some(v=>normalize(v)===normalize(a.account).replace(/^@/,'')))continue;
      const score=snapshot.scores?.[p.id];
      const text=normalize([p.text,p.textZh,p.article?.text,p.quoted?.text,score?.event,JSON.stringify(score?.companies??[]),JSON.stringify(score?.topics??[])].join(' '));
      if(topicIds&&!topicIds.has(p.id)&&!text.includes(normalize(a.company||a.topic)))continue;
      const matches=terms.filter(t=>text.includes(t)).length;if(terms.length&&!matches)continue;
      seen.add(key);hits.push({p,score,matches,distributors:[...new Set(distributors)]});
    }
    hits.sort((a,b)=>b.matches-a.matches||Date.parse(b.p.publishedAt)-Date.parse(a.p.publishedAt));
    const offset=Math.max(0,a.offset??0),limit=Math.min(100,Math.max(1,a.limit??60));
    const page=hits.slice(offset,offset+limit);
    const days={}, themes={};
    for(const {p,score} of hits){const day=p.publishedAt.slice(0,10);days[day]=(days[day]||0)+1;for(const topic of score?.topics??p.nativeTopics??[]){const name=typeof topic==='string'?topic:topic.name;if(name)themes[name]=(themes[name]||0)+1;}}
    const overview={days,themes:Object.entries(themes).sort((a,b)=>b[1]-a[1]).slice(0,40).map(([name,count])=>({name,count}))};
    return {range:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},snapshotAt:snapshot.generatedAt,overview,total:hits.length,offset,nextOffset:offset+page.length<hits.length?offset+page.length:null,items:page.map(({p,score,distributors})=>({id:p.id,date:p.publishedAt,account:p.handle,kind:p.kind,title:score?.event??null,preview:(p.textZh||p.text||'').slice(0,320),previewOnly:true,bodyCharacters:(p.text??'').length,threadRootId:p.threadRootId,score:score?.score??null,distributors,companies:score?.companies??p.nativeCompanies,topics:score?.topics??p.nativeTopics}))};
  }
  function readPosts(a){
    if(!Array.isArray(a.ids)||!a.ids.length||a.ids.length>12)throw new Error('每次提供1—12个原帖ID');
    const all=new Map(),missing=[];
    for(const id of a.ids){ const p=posts.get(id);if(!p){missing.push(id);continue;} all.set(p.id,p);
      const root=p.threadRootId||p.id;
      for(const part of p.thread??[]) {const child=typeof part==='string'?posts.get(part):part;if(child?.id)all.set(child.id,posts.get(child.id)||child);}
      for(const child of snapshot.posts) if(child.id===root || (child.threadRootId===root&&normalize(child.handle)===normalize(p.handle)))all.set(child.id,child);
    }
    const ordered=[...all.values()].sort((a,b)=>(a.publishedAt??'').localeCompare(b.publishedAt??''));
    const offset=Math.max(0,a.offset??0),limit=Math.min(12,Math.max(1,a.limit??12));
    const items=ordered.slice(offset,offset+limit).map(p=>{readIds.add(p.id); const {thread,...full}=p;return {...full,reference:addRef(postRef(p)),storedBodyComplete:true,visibility:p.contextStatus??'unknown',threadIds:(thread??[]).map(v=>typeof v==='string'?v:v.id),score:snapshot.scores?.[p.id]??null};});
    return {items,missing,total:ordered.length,nextOffset:offset+items.length<ordered.length?offset+items.length:null,note:'完整返回已存储正文；visibility 表示上游采集情况，不能保证付费/不可见内容完整。'};
  }
  function readResearch(a){
    if(!['ideas','trends','reports'].includes(a.section))throw new Error('无效研究类型');
    let rows=snapshot[a.section]??[]; if(a.id)rows=rows.filter(r=>r.id===a.id||r.date===a.id);
    if(a.q){const terms=normalize(a.q).split(/\s+/);rows=rows.filter(r=>terms.some(t=>normalize(JSON.stringify(r)).includes(t)));}
    const offset=a.offset??0;const page=rows.slice(offset,offset+(a.id?1:8));
    return {historicalModelJudgment:true,total:rows.length,nextOffset:offset+page.length<rows.length?offset+page.length:null,items:page.map(r=>({...(!a.id?{id:r.id,title:r.title,summary:r.summary,companies:r.companies,topics:r.topics,evidence:r.evidence,asOf:r.asOf,status:r.status,detailAvailable:true}:r),reference:addRef({key:'R-'+r.id,id:r.id,kind:a.section,title:r.title,date:r.asOf??r.date,href:a.section==='reports'?'/daily/'+(r.date||r.id.replace('report-','')):`/${a.section}/${r.id}`})}))};
  }
  return {refs,readIds,historyWeb, async call(name,args){signal?.throwIfAborted();
    if(name==='search_posts')return searchPosts(args);
    if(name==='read_posts')return readPosts(args);
    if(name==='read_research')return readResearch(args);
    if(name==='web_search'){if(!args.query?.trim())throw new Error('缺少检索词');const pages=await search(args.query,signal);return {items:pages.map(p=>({...p,reference:addRef({...p,retrievedAt:new Date(now).toISOString(),key:'W-'+createHash('sha256').update(p.url).digest('hex').slice(0,12)})})),note:'外部检索片段；日期缺失时不能用于证明历史时点已知。'};}
    throw new Error('未知工具');
  }};
}
