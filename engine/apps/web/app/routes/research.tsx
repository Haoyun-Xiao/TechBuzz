import { Research } from "../features/research/Research";
import type { Screen } from "../components/shell/screens";
export const handle: Screen = { tab: "me", name: "投研" };
export default function ResearchPage() { return <Research />; }
