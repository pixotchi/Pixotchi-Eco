import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectFile = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  "utf8",
);

const plantsView = projectFile("components/tabs/plants-view.tsx");
const tradingView = projectFile("components/tabs/TradingViewWidget.tsx");
const swapPanel = projectFile("components/tabs/pixotchi-swap-panel.tsx");

assert.match(
  plantsView,
  /import ClaimRewardsTransaction from "@\/components\/transactions\/claim-rewards-transaction"/,
  "the critical claim action must arrive with Farm so first use still opens offline",
);
assert.doesNotMatch(
  plantsView,
  /dynamic\(\(\) => import\("@\/components\/transactions\/claim-rewards-transaction"\)/,
);

assert.match(tradingView, /usePerformanceMode\(\)/);
assert.match(tradingView, /if \(!mounted \|\| performanceModeEnabled \|\| !node\) return/);
assert.match(tradingView, /Chart paused/);

assert.match(swapPanel, /useSwitchChain\(\)/);
assert.match(swapPanel, /switchChainAsync\(\{ chainId: BASE_CHAIN_ID \}\)/);
assert.match(
  swapPanel,
  /chainId !== BASE_CHAIN_ID[\s\S]*type="button"[\s\S]*onClick=\{handleSwitchToBase\}/,
  "the wrong-network recovery label must be an actionable button",
);

console.log("App UI resilience smoke checks passed.");
