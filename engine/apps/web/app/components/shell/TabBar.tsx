import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useLocation, useRevalidator } from "react-router";
import { IntentLink } from "../ui/IntentLink";
import { railIsActive, tabs, type TabKey, useResearchMode } from "./nav";
import { noteScreen, rememberedTab, useScreen } from "./screens";
import { markBack } from "./transitions";
import { scrollBehavior } from "../../lib/motion";

const subscribe = () => () => {};
const serverTab = () => null;
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The phone tab bar (below lg). A page lights the tab it declares; pages reached from several tabs keep
 * the tab the reader came from. Tapping the tab you are on goes back to its first screen (sliding back,
 * as the bar's back button does); on that screen it scrolls to the top, and at the top it reloads the
 * page's data. Articles bring their own toolbar instead.
 */
export function TabBar() {
  const screen = useScreen();
  const { pathname, key } = useLocation();
  const revalidator = useRevalidator();
  const last = useRef<TabKey | undefined>(undefined);
  const restored = useSyncExternalStore(subscribe, () => rememberedTab(key), serverTab);
  const research = useResearchMode();
  const items = tabs(research);
  const byPath = research ? items.find((tab) => railIsActive(tab, pathname, screen.tab))?.key : undefined;
  const requested = byPath ?? (screen.tab === "starred" && !research ? "me" : screen.tab) ?? restored ?? last.current ?? screen.home;
  const active = requested && !items.some((t) => t.key === requested) ? "featured" : requested;
  useIsoLayoutEffect(() => {
    // Do not overwrite a saved entry with the server fallback before hydration reads this browser's tab.
    if (restored === null) return;
    last.current = active;
    noteScreen(screen.name, key, active);
  }, [active, key, screen.name, restored]);
  if (screen.toolbar) return null;
  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 bg-surface/90 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-1px_0_var(--line)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      <div className={`mx-auto grid max-w-[640px] ${research ? "grid-cols-5 auto-rows-[48px] sm:grid-cols-9" : "h-[50px]"}`}
        style={research ? undefined : { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((t) => {
          const on = t.key === active;
          const Icon = t.icon;
          return (
            <IntentLink
              key={t.key}
              to={t.to}
              aria-current={on ? "page" : undefined}
              viewTransition={on && pathname !== t.to}
              onClick={(event) => {
                if (!on || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (pathname !== t.to) return markBack();
                event.preventDefault();
                if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: scrollBehavior() });
                else if (revalidator.state === "idle") void revalidator.revalidate();
              }}
              className={`relative flex flex-col items-center justify-center gap-[2px] text-[10.5px] transition-colors ${on ? "font-semibold text-accent" : "text-ink-3 active:text-ink"}`}
            >
              <Icon size={research ? 20 : 23} />
              <span>{t.label}</span>
            </IntentLink>
          );
        })}
      </div>
    </nav>
  );
}
