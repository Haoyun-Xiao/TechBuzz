import { sources } from './collector.mjs';
import { research } from './research.mjs';
import { activityView, dashboardActivity, eventBoards } from './activity.mjs';

function generationStatus(db, analysis, now, rows) {
  const bjDay = ms => new Date(ms+8*3600000).toISOString().slice(0,10);
  const date = bjDay(+now-86400000);
  const due = now.getTime() >= Date.parse(date+'T00:00:00+08:00')+32*3600000;
  const byId = new Map(rows.map(post=>[post.id,post]));
  const latestEvidence = ids => ids.map(id=>byId.get(id)?.publishedAt).filter(Boolean).sort().at(-1) ?? null;
  function state(kind, scope, entries) {
    const job = analysis.jobs.find(j=>j.kind===kind && j.scope===scope);
    const success=db.prepare('SELECT * FROM research_success WHERE kind=? AND scope=?').get(kind,scope);
    let updatedAt=job?.updatedAt ?? null;
    const lastSuccessAt=success?.succeeded_at ?? (job?.status==='completed'?updatedAt:entries.map(entry=>entry.updatedAt).filter(Boolean).sort().at(-1) ?? null);
    let status=job?.status ?? 'pending';
    let error=job?.error ?? null;
    const scoring=analysis.jobs.find(j=>j.kind==='score' && j.scope==='current');
    if(kind !== 'report' && status !== 'running' && scoring && ['running','failed'].includes(scoring.status) && (!updatedAt || scoring.updatedAt>=updatedAt)) {
      updatedAt=scoring.updatedAt;
      if(scoring.status==='failed') {
        status='failed';
        error=`评分失败，等待重试：${scoring.error ?? ''}`;
      } else if(status !== 'failed') {
        status='pending';
        error=null;
      }
    }
    return {status,updatedAt,lastSuccessAt,error,
      evidenceThrough:success ? success.through : latestEvidence(entries.flatMap(entry=>[...(entry.evidence??[]),...(entry.counterEvidence??[])]))};
  }
  const trends = state('trends','current',analysis.trends);
  const targeted = db.prepare("SELECT COUNT(*) AS count, MAX(through) AS through FROM research_success WHERE kind='trends' AND scope LIKE 'replay:%'").get();
  if (targeted.count) {
    trends.targetedCount = targeted.count;
    trends.targetedThrough = targeted.through;
  }
  const report=analysis.reports.find(r=>r.date===date);
  const daily=state('report',date,report?[report]:[]);
  if (report?.generatedAt) {
    daily.lastSuccessAt = report.generatedAt;
    if (daily.status === 'completed') daily.updatedAt = report.generatedAt;
  }
  if(!due) {daily.status='scheduled';daily.error=null;}
  else if(report?.inputCount===0 && !report.sections?.length && daily.status==='completed') daily.status='insufficient';
  return {ideas:state('ideas','current',analysis.ideas),trends,report:{...daily,date}};
}

export function dashboard(db, now = new Date()) {
  db.exec('BEGIN');
  try {
    const view = activityView(db);
    const analysis = research(db);
    const selection = dashboardActivity(view, analysis.scores, analysis.threshold);
    const boards = eventBoards(selection.activities, analysis.scores, now, analysis.threshold);
    const activity = db.prepare("SELECT * FROM x_activity WHERE kind = 'repost' ORDER BY first_seen_at DESC").all().map(row=>({
      source:row.source_id.slice(2),tweetId:row.tweet_id,kind:row.kind,author:row.author,url:row.url,publishedAt:row.published_at,
      firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,body:row.body,
    }));
    return { ...analysis,activity, ...selection, ...boards, name:'TechBuzz',mode:'live',generatedAt:now.toISOString(),
      sources:sources(db),posts:view.posts,generation:generationStatus(db,analysis,now,view.posts) };
  } finally {
    db.exec('COMMIT');
  }
}
