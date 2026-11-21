// The collector stores the eight sources. Evidence may have been written by any X author.
import { handles, posts as authoredPosts } from './collector.mjs';

export const CATEGORY_LABELS = { earnings: '业绩与指引', markets: '市场与估值', 'supply-chain': '产业链', industry: '行业', opinion: '观点' };
const categoryRules = [
  ['业绩与指引', /财报|业绩|指引|营收增长|季度收入|earnings|guidance|quarterly results/i],
  ['市场与估值', /估值|目标价|市盈率|股价|仓位|预期差|利润率|valuation|multiple expansion|price target|margin compression/i],
  ['产业链', /供需|供应链|产能|交期|良率|出货|库存|短缺|产量|供货|封装|supply chain|capacity|lead times|shipments|inventory|packaging/i],
  ['行业', /收购|并购|监管|协议|诉讼|获批|签约|合作|政策|发布|推出|发售|acqui[rs]|merger|partner|launch|regulat/i],
  ['观点', /观点|判断|预测|认为|看好|看空|推测|争论|作者主张|i think|in my view|my take/i],
];
function category(post, assessment) {
  if (Object.values(CATEGORY_LABELS).includes(assessment?.category)) return assessment.category;
  if (CATEGORY_LABELS[post.nativeCategory]) return CATEGORY_LABELS[post.nativeCategory];
  if ('researchCategory' in post) return post.researchCategory;
  const material = [assessment?.summary, assessment?.reason, post.textZh, post.article?.text, post.text].filter(Boolean).join(' ');
  return categoryRules.find(([, pattern]) => pattern.test(material))?.[0] ?? null;
}
const handleFor = sourceId => handles.find(handle => handle.toLowerCase() === sourceId.slice(2).toLowerCase());
const key = (a, b) => a.localeCompare(b);
const newest = (a,b) => key(b.activityAt ?? '', a.activityAt ?? '') || key(b.id,a.id);

export function activityView(db) {
  const authored = authoredPosts(db);
  const observations = db.prepare('SELECT * FROM x_activity ORDER BY source_id, tweet_id').all();
  const materials = new Map(authored.filter(p => p.kind !== 'repost').map(p => [p.id, p]));
  const byActivity = new Map();
  const translations = new Map();
  for (const p of authored) {
    if (p.quoted?.id && p.quotedTextZh && p.quoted.text) translations.set(p.quoted.id, {text:p.quoted.text, zh:p.quotedTextZh});
  }
  function add(postId, kind, handle, time, basis, firstSeenAt, original) {
    if (!postId || !handle) return;
    const id = kind === 'repost' ? `repost:${handle.toLowerCase()}:${postId}` : `post:${postId}`;
    if (original) {
      const current = materials.get(postId);
      if (!current || ((current.repostOnly || current.kind === 'unknown') && (original.text?.length ?? 0) > (current.text?.length ?? 0))) {
        materials.set(postId, {...original, id:postId, kind:current?.kind ?? original.kind, repostOnly:current?.repostOnly ?? true, thread:[], threadRootId:postId, evidenceKey:`x:${postId}`});
      }
    }

    const previous = byActivity.get(id);
    const earliest=[previous?.firstSeenAt,firstSeenAt].filter(Boolean).sort()[0] ?? null;
    if (previous) previous.firstSeenAt=earliest;
    // A paid/verified repost wrapper has a true action timestamp. A public mirror usually does not.
    if (!previous || previous.timeBasis === 'unknown' || basis === 'exact') {
      byActivity.set(id, {id,postId,kind,handle,activityAt:time ?? null,timeBasis:basis,firstSeenAt:earliest});
    }
  }
  for (const post of authored) {
    if (post.kind !== 'repost') add(post.id,post.kind,post.handle,post.publishedAt,'published',post.collectedAt);
    else {
      const original = post.repostOf;
      if (original?.id) add(original.id,'repost',post.handle,post.publishedAt,'exact',post.collectedAt,original);
      else add(post.id,'repost',post.handle,post.publishedAt,'exact',post.collectedAt,{...post, text:'',contextStatus:'unavailable'});
    }
  }
  for (const row of observations) {
    if (row.kind === 'authored') {
      const source=handleFor(row.source_id);
      if (!source || source.toLowerCase() !== row.author?.toLowerCase()) continue;
      const existing=byActivity.get('post:'+row.tweet_id);
      if (existing) {
        existing.firstSeenAt=[existing.firstSeenAt,row.first_seen_at].filter(Boolean).sort()[0] ?? null;
        continue;
      }
      const original=materials.get(row.tweet_id);
      const post=original ?? {id:row.tweet_id,handle:source,url:row.url,publishedAt:row.published_at,text:row.body ?? '',kind:'unknown',
        media:[],thread:[],threadRootId:row.tweet_id,evidenceKey:'x:'+row.tweet_id,contextStatus:row.body?'complete':'unavailable'};
      post.repostOnly=false;
      post.kind='unknown';
      materials.set(post.id,post);
      add(post.id,'unknown',source,row.published_at,'published',row.first_seen_at);
      continue;
    }
    add(row.tweet_id,'repost',handleFor(row.source_id),row.observed_at,row.observed_at ? 'observed' : 'unknown',row.first_seen_at,{
      handle:row.author,url:row.url,publishedAt:row.published_at,text:row.body ?? '',kind:'original',media:[],
      contextStatus:row.body ? 'complete' : 'unavailable',
    });
  }
  for (const post of authored) {
    if (post.kind !== 'repost' || !post.repostOf?.id) continue;
    const original = materials.get(post.repostOf.id);
    if (original) original.aliases = [...new Set([...(original.aliases ?? []), post.id, post.nativeArticleId].filter(Boolean))];
  }
  const cached = db.prepare('SELECT post_id, original, translation FROM research_translations').all();
  for (const row of cached) translations.set(row.post_id, {text:row.original, zh:row.translation});
  const categories = new Map(db.prepare('SELECT post_id,category FROM research_categories').all().map(row=>[row.post_id,row.category]));
  for (const post of materials.values()) {
    if(categories.has(post.id)) post.researchCategory=categories.get(post.id);
    const tr = translations.get(post.id);
    if (!post.textZh && tr?.text === post.text) post.textZh = tr.zh;
  }
  for (const a of byActivity.values()) {
    if (a.kind !== 'repost' || !a.activityAt) continue;
    const post=materials.get(a.postId);
    (post.repostObservations ??= []).push({handle:a.handle,time:a.activityAt,basis:a.timeBasis});
  }
  return {posts:[...materials.values()].sort((a,b)=>key(b.publishedAt ?? '',a.publishedAt ?? '') || key(b.id,a.id)),
    activities:[...byActivity.values()].sort(newest)};
}

export function dashboardActivity(view, scores, threshold) {
  const byId = new Map(view.posts.map(p=>[p.id,p]));
  const distributors = new Map();
  for (const a of view.activities) {
    if (a.kind !== 'repost') continue;
    if (!distributors.has(a.postId)) distributors.set(a.postId, new Set());
    distributors.get(a.postId).add(a.handle);
  }
  const activities = view.activities.map(a=>{
    const post = byId.get(a.postId);
    const assessment = scores[a.postId];
    const score = assessment?.score ?? null;
    const translationStatus = post.textZh ? 'translated' : (post.article?.text || post.text)?.trim() ? 'original' : 'unavailable';
    return {...a, post, originalAuthor:post.handle, url:post.url, score, translationStatus, featured:score !== null && score >= threshold,
      category:category(post,assessment), distributors:[...(distributors.get(post.id) ?? [])]};
  });
  const selected = new Map();
  for (const item of activities) if (item.featured && !selected.has(item.postId)) selected.set(item.postId,item);
  const featured = [...selected.values()].sort((a,b)=>b.score-a.score || newest(a,b));
  const topics = new Map();
  for (const p of view.posts) {
    const s = scores[p.id];
    for (const [group, names] of [['company',[...(p.nativeCompanies ?? []), ...(s?.companies ?? [])]],['issue',[...(p.nativeTopics ?? []), ...(s?.topics ?? [])]]]) {
      for (const name of new Set(names ?? [])) {
        const id = group + ':' + name.normalize('NFKC').toLowerCase();
        if (!topics.has(id)) topics.set(id,{name,group,postIds:[],count:0,propagationCount:0});
        const topic = topics.get(id);
        if (topic.postIds.at(-1) === p.id) continue;
        topic.postIds.push(p.id);
        topic.count++;
        topic.propagationCount += distributors.get(p.id)?.size ?? 0;
      }
    }
  }
  return {activities,featured,topics:[...topics.values()].sort((a,b)=>b.count-a.count || key(a.name,b.name))};
}

// Join event aliases from native fact grouping and the normalized research-model event label.
// Distinct evidence counts are keyed to original disclosures, irrespective of the number of distributors.
export function eventBoards(activities,scores,now,threshold) {
  const end = +now, start = end-48*3600000;
  const recent = activities.filter(a=>a.activityAt && Date.parse(a.activityAt)>=start && Date.parse(a.activityAt)<=end);
  const parent = new Map();
  const root = k => { let r=k; while(parent.has(r)) r=parent.get(r); return r; };
  const eventKeys = new Map();
  for(const a of recent) {
    const label=scores[a.postId]?.event?.trim();
    const keys=[`post:${a.postId}`];
    if(label) keys.push('event:'+label.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu,''));
    if(a.post.factId) keys.push('fact:'+a.post.factId);
    if(a.post.quoted?.id) keys.push('post:'+a.post.quoted.id);
    for(const k of keys.slice(1)) {const left=root(keys[0]),right=root(k); if(left!==right) parent.set(left,right);}
    eventKeys.set(a.id,keys[0]);
  }
  const groups=new Map();
  for(const a of recent) {
    const id=root(eventKeys.get(a.id));
    if(!groups.has(id)) groups.set(id,{id,title:'',authors:new Set(),origins:new Set(),ids:new Set(),updatedAt:a.activityAt,score:null,postCount:0});
    const g=groups.get(id), s=scores[a.postId];
    g.title ||= s?.event || '';
    g.authors.add(a.handle); g.ids.add(a.postId); g.origins.add(a.post.evidenceKey || a.postId);
    g.postCount++; if(s) g.score=Math.max(g.score ?? 0,s.score);
    if(a.activityAt>g.updatedAt) g.updatedAt=a.activityAt;
  }
  const hot=[],singleHot=[];
  for(const g of groups.values()){
    const evidence=[...g.ids];
    const title=g.title || scores[evidence[0]]?.summary || recent.find(a=>a.postId===evidence[0])?.post.text?.slice(0,140);
    if(!title) continue;
    const row={id:g.id,title,authors:[...g.authors],sourceCount:g.authors.size,independentCount:g.origins.size,postCount:g.postCount,evidence,score:g.score,updatedAt:g.updatedAt};
    const age=(end-Date.parse(row.updatedAt))/3600000;
    if(row.sourceCount>=2) hot.push({...row,heat:(row.sourceCount+Math.log2(1+row.independentCount))*Math.pow(0.5,age/24)});
    else if(row.score!==null && row.score>=threshold) singleHot.push(row);
  }
  hot.sort((a,b)=>b.heat-a.heat || key(a.id,b.id));
  singleHot.sort((a,b)=>b.score-a.score || key(b.updatedAt,a.updatedAt) || key(a.id,b.id));
  return {hot,singleHot};
}
