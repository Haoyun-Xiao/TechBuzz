const DAY = 86400000;
const generic = new Set(['ai','人工智能','科技','半导体','ai基础设施','ai数据中心','数据中心','市场','行业']);
const terms = values => new Set((values??[]).map(s=>s.toLowerCase().trim()).filter(s=>s&&!generic.has(s)));
const shared = (a,b) => [...a].filter(x=>b.has(x)).length;
const variables = text => new Set((text??'').toLowerCase().match(/融资|现金流|预付款|付款|担保|交付|资本开支|成本|定价|毛利|产能|认证|良率|供给|需求|订单|库存|financ|cash|prepay|deliver|cost|pric|margin|capacity|yield|qualif|demand|supply|order/g)??[]);

function relevance(row, trigger, normalize) {
  const topics=shared(terms(row.assessment?.topics),terms(trigger.assessment?.topics));
  const companies=shared(terms(normalize(row.assessment?.companies??[])),terms(normalize(trigger.assessment?.companies??[])));
  const operating=shared(variables(row.assessment?.summary),variables(trigger.assessment?.summary));
  return topics*4 + (companies && operating ? 3+operating : 0);
}

// Only triggers may create ideas; related context can support or contradict them.
export function ideaGroups(rows, normalize) {
  const groups=[];
  for(const row of rows){
    const group=groups.find(g=>g.length<4 && relevance(row,g[0],normalize)>=4);
    if(group)group.push(row);else groups.push([row]);
  }
  return groups;
}

export function ideaMaterials(triggers, rows, now, normalize) {
  const triggerIds=new Set(triggers.map(r=>r.material.id));
  const ranked=rows.filter(r=>!triggerIds.has(r.material.id)&&r.assessment
    && Date.parse(r.material.publishedAt)<=now && Date.parse(r.material.publishedAt)>=now-30*DAY)
    .map(row=>({row,rank:Math.max(...triggers.map(t=>relevance(row,t,normalize)))}))
    .filter(x=>x.rank>=4).sort((a,b)=>b.rank-a.rank || b.row.publishedMs-a.row.publishedMs);
  const selected=[...triggers,...ranked.slice(0,8).map(x=>x.row),
    ...ranked.filter(x=>x.row.assessment.score<70).slice(0,3).map(x=>x.row)];
  return [...new Map(selected.map(r=>[r.material.id,r])).values()]
    .sort((a,b)=>a.publishedMs-b.publishedMs||a.material.id.localeCompare(b.material.id));
}


// Related questions share a lane, so later batches see earlier saved judgments.
export function ideaLanes(rows, normalize, related = () => []) {
  const lanes=[];
  for(const row of rows){
    const targets=new Set(related(row));
    const matches=lanes.filter(lane=>lane.rows.some(r=>relevance(row,r,normalize)>=4)
      || [...targets].some(id=>lane.targets.has(id)));
    const lane={rows:[row],targets};
    for(const previous of matches){
      lane.rows.push(...previous.rows);
      for(const id of previous.targets)lane.targets.add(id);
      lanes.splice(lanes.indexOf(previous),1);
    }
    lane.rows.sort((a,b)=>a.publishedMs-b.publishedMs||a.material.id.localeCompare(b.material.id));
    lanes.push(lane);
  }
  return lanes.map(lane=>lane.rows).sort((a,b)=>b.length-a.length);
}
