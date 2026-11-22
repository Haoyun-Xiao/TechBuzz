import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Link, Navigate, useLocation } from "react-router";
import { useEffect } from "react";
import { ResearchFeed, feedPage } from "../../apps/web/app/features/research/ResearchFeed";
import { ResearchEntries, ResearchStory, ResearchHot, ResearchTopics, ResearchSources } from "../../apps/web/app/features/research/ResearchViews";
import { PostDetail } from "../../apps/web/app/features/research/Posts";
import { directoryTopics } from "../../apps/web/app/features/research/directory";
import { useSaved, getSavedEntry } from "../../apps/web/app/features/research/saved";
import { postTitle, type Dashboard } from "../../apps/web/app/features/research/data";

const payload = JSON.parse(document.getElementById("snapshot")!.textContent!);
const data: Dashboard = payload.dashboard;
const posts = new Map(data.posts.map(p => [p.id, p]));
for (const row of [...data.activities, ...data.featured]) row.post = posts.get(row.postId)!;
const topics = directoryTopics(data);
function Page() {
  const { pathname, search } = useLocation();
  const [section, ...segments] = pathname.slice(1).split("/");
  const id = decodeURIComponent(segments.join("/"));
  const params = new URLSearchParams(search);
  const saved = useSaved(data);
  useEffect(() => {
    window.scrollTo(0,0);
    for (const a of document.querySelectorAll("nav a[href^='#/']")) {
      if (a.closest("#offline-app")) continue;
      const active = a.getAttribute("href")!.split("?")[0] === "#" + (pathname === "/" ? "/featured" : pathname);
      if (active) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
    }
  },[pathname,search]);
  if (!section || section === "featured" || section === "all") {
    const featured = section !== "all";
    return <ResearchFeed featured={featured} feed={feedPage(data,params,featured)} />;
  }
  if (section === "ideas" || section === "trends") {
    const item = [...data[section], ...(section==="trends"?data.archivedTrends??[]:[])].find(e=>e.id===id);
    if(item?.mergedInto) return <Navigate replace to={"/trends/"+item.mergedInto}/>;
    if(id&&!item) return <p>此记录未收录在当前快照。<Link to={"/"+section}>返回列表</Link></p>;
    return <ResearchEntries type={section} item={item} data={data}/>;
  }
  if (section === "assistant") return <section><h1>研究助手</h1><p>当前页面展示已生成的研究快照。实时对话需要运行 Docker 版本并配置自己的模型密钥。</p><p><a href="https://github.com/Haoyun-Xiao/TechBuzz#快速开始" target="_blank" rel="noopener noreferrer">查看运行说明</a></p></section>;
  if (section === "sources") return <ResearchSources data={data} />;
  if (section === "hot") return <ResearchHot data={data} />;
  if (section === "story") {
    const entry = [...data.hot,...data.singleHot].find(e=>e.id===id);
    if (entry) return <ResearchStory entry={entry} data={data}/>;
  }
  if (section === "topics") {
    const group = params.get("group") === "issue" ? "issue" : "company";
    if (!id) {
      const selected = new Set(data.featured.map(r=>r.postId));
      const shares = new Map(data.featured.map(r=>[r.postId,r.distributors.length]));
      const list = topics.filter(t=>t.group===group).map(t=>{
        if(params.get("onlyFeatured")!=="1") return t;
        const ids=t.postIds.filter(p=>selected.has(p));
        return {...t,count:ids.length,propagationCount:ids.reduce((n,p)=>n+(shares.get(p)??0),0)};
      }).filter(t=>t.count).sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name));
      return <ResearchTopics topics={list}/>;
    }
    const t=topics.find(t=>t.group===group && t.name===id);
    if(t) return <ResearchFeed feed={feedPage(data,params,false,t)}/>;
  }
  if (section==="research") {
    const p=posts.get(segments.at(-1)??"");
    if(p) {
      const root=data.scores[p.id]?.scoredAs ?? p.id;
      const thread=data.posts.filter(x=>x.id===root || data.scores[x.id]?.scoredAs===root);
      const rows=data.activities.filter(r=>r.postId===p.id);
      return <PostDetail key={p.id} post={p} activity={rows.find(r=>r.id===params.get("activity")) ?? rows[0]} data={{...data,posts:thread}} saved={saved}/>;
    }
  }
  if (section==="starred") return <><h1>收藏</h1>{saved.length===0 && <p>暂无收藏</p>}{saved.map(k=>{
    const e=getSavedEntry(k,data); if(!e)return null;
    const href=e.kind==="post" ? "/research/posts/"+e.item.id : e.kind==="reports" ? "/daily/"+e.item.date : "/"+e.kind+"/"+e.item.id;
    return <p key={k}><Link to={href}>{e.kind==="post"?postTitle(e.item,data.scores[e.item.id]):e.item.title}</Link></p>;
  })}</>;
  if(payload.pages[pathname]) return <div dangerouslySetInnerHTML={{__html:payload.pages[pathname]}}/>;
  return <p>此功能需要在线服务。 <Link to="/">返回精选</Link></p>;
}
createRoot(document.getElementById("offline-app")!).render(<RouterProvider router={createHashRouter([{path:"*",Component:Page}])}/>);
