import { Link, Navigate, useLocation } from "react-router";
import { Heading } from "../features/research/Posts";
import { pageMeta } from "../lib/seo";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { home: "featured", name: "精选" };
export const meta = () => pageMeta({ title: "精选", path: "/featured", noindex: true });

export function oldResearchTarget(hash: string, search = "") {
  const [path, query] = hash.slice(1).split("?");
  const [page, raw] = (path || "home").split("/");
  const extra = query ? `?${query}` : search;
  const id = raw ? `/${raw}` : "";
  switch (page) {
    case "picks":
    case "featured":
    case "home": return `/featured${extra}`;
    case "feed":
    case "all": return `/all${extra}`;
    case "hot": return id ? `/story${id}${extra}` : `/hot${extra}`;
    case "topics": return `/topics${id}${extra}`;
    case "post": return id ? `/research/posts${id}${extra}` : `/all${extra}`;
    case "ideas":
    case "trends": return `/${page}${id}${extra}`;
    case "reports":
    case "daily": return `/daily${id.replace(/^\/report-/, "/")}${extra}`;
    case "saved":
    case "bookmarks": return `/starred${extra}`;
    case "sources":
    case "agent":
    case "about": return `/${page}${extra}`;
    case "admin": return "/admin/settings";
    default: return "/featured";
  }
}

export default function ResearchLegacyRoute() {
  const { hash, search } = useLocation();
  const target = oldResearchTarget(hash, search);
  return <>
    <Navigate replace to={target} />
    <Heading title="精选" />
    <Link to={target} className="text-sm text-accent hover:underline">前往新入口</Link>
  </>;
}
