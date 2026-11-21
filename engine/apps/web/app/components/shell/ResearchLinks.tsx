const sections = [["home", "投研看板"], ["picks", "研究评分"], ["reports", "研究日报"], ["ideas", "Idea"], ["trends", "趋势跟踪"]] as const;

export function ResearchLinks() {
  return (
    <nav aria-label="科技股投研" className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-2 text-[14px] text-accent">
      {sections.map(([key, label]) => <a className="py-1 hover:underline" key={key} href={`/research/#${key}`}>{label}</a>)}
    </nav>
  );
}
