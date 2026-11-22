const DAY = 86400000;
export function latestSignal(entry) {
  return Math.max(0, ...[entry.lastSignalAt, ...(entry.timeline ?? []).map(n=>n.date), entry.firstSeen]
    .map(v=>Date.parse(v)).filter(Number.isFinite));
}

export function expiredTrends(entries, now) {
  return entries.filter(e => e.status === 'active' && latestSignal(e) > 0 && now-latestSignal(e)>30*DAY);
}

export function mergeTrendUpdates(updates, existing, merges, now) {
  const consumed = new Set();
  for (const {target, ids} of merges) {
    const main = updates.get(target);
    if (!main || main.status !== 'active') throw new Error('合并目标须为本轮有效趋势');
    const parts = ids.map(id=>existing.find(e=>e.id===id));
    if (parts.some(e=>!e || e.id===target || e.status!=='active' || updates.has(e.id) || consumed.has(e.id)))
      throw new Error('合并趋势编号重复、过期或与本轮更新冲突');
    const union = field => [...new Set([...(main[field]??[]), ...parts.flatMap(e=>e[field]??[])])];
    main.evidence=union('evidence');
    main.counterEvidence=union('counterEvidence').filter(id=>!main.evidence.includes(id));
    main.relatedIds=union('relatedIds').filter(id=>!ids.includes(id)&&id!==target);
    const nodes=new Map();
    for (const n of [...parts.flatMap(e=>e.timeline??[]),...(main.timeline??[])]) {
      const old=nodes.get(n.date);
      nodes.set(n.date, old ? {...n,summary:[...new Set([old.summary,n.summary])].join(' '),
        evidence:[...new Set([...(old.evidence??[]),...(n.evidence??[])])],
        counterEvidence:[...new Set([...(old.counterEvidence??[]),...(n.counterEvidence??[])])]}:n);
    }
    main.timeline=[...nodes.values()].sort((a,b)=>a.date.localeCompare(b.date));
    main.mergedFrom=[...new Set([...(main.mergedFrom??[]),...ids])];
    main.lastSignalAt=new Date(Math.max(latestSignal(main),...parts.map(latestSignal))).toISOString();
    if(main.history?.length) Object.assign(main.history.at(-1),{evidence:main.evidence,counterEvidence:main.counterEvidence,timeline:main.timeline,mergedFrom:main.mergedFrom,lastSignalAt:main.lastSignalAt});
    for(const part of parts) {
      consumed.add(part.id);
      updates.set(part.id,{...part,status:'archived',mergedInto:target,updatedAt:new Date(now).toISOString()});
    }
  }
  return updates;
}
