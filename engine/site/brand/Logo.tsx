// TechBuzz 字标和科技股脉冲标记。size 是高度，单位像素。
import { SITE } from "../site.ts";

export function Wordmark({ size = 24, className = "", title = SITE.name }: { size?: number; className?: string; title?: string }) {
  return (
    <span className={`inline-flex items-center font-black leading-none tracking-[-0.03em] ${className}`} style={{ fontSize: Math.round(size * 0.92) }} aria-label={title} role="img">
      <img src="/logo.svg" alt="" className="mr-[0.34em] size-[1em] shrink-0" />
      <span aria-hidden="true">{SITE.name}</span>
    </span>
  );
}

/** The TechBuzz mark also indicates loading when animated. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return <img src="/logo.svg" alt="" className={className} style={spinning ? { animation: "spin-slow 1.1s linear infinite" } : undefined} />;
}
