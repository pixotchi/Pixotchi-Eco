# Medium economy remediation — 2026-09-08

Scope: TX-09, TX-10, TX-11, TX-12, TX-14, FND-V3 and FND-V4. Revalidated against the P1-fixed shared worktree retained in `output/p2-baseline`. No commits, deployments or wallet submissions were made in this round.

## TX-09 — Failed economy reads

**Revalidated:** Swap discarded balance errors and defaulted missing values to zero. Staking retained default/stale values without revoking action readiness; its upstream composite reader also converted required multicall failures into plausible empty results. Marketplace displayed an error without revoking stale balances/allowances. The batch quest finding was already repaired by P1: complete scans, explicit Retry and receipt-aware reconciliation now control readiness.

**Solution:** `lib/economic-read-state.ts` is the shared loading/error/ready policy used by Swap, staking and marketplace. Each surface preserves transport-specific behavior and wallet identity checks. Missing initial data reads unavailable; retained values are explicitly last known and cannot authorize spending. Retry sits beside the failed read. Swap's Max and submission require verified spend balances, including native gas funds where required; an unavailable output-token balance alone does not block spending another token. Marketplace Cancel remains possible with verified owned-order and land data because it returns existing escrow. Staking commits only a complete wallet-bound snapshot. `getStakeComposite` now throws on required failed/malformed entries while accepting valid zero and missing optional rate metadata.

See `fixes-medium-economic-reads.md` for child revalidation, upstream caller checks and the preserved cancellation/approval-controller behavior.

## TX-10 — Mandatory swap review

**Revalidated:** the environment flag still hid minimum received, slippage and tax by default after P1.

**Solution:** `SwapQuoteReview` always shows exact minimum received, token tax and the available network fee budget before the action. Route and slippage live in expandable details. The minimum supports the shared accessible exact-amount/copy disclosure. Buy is explicitly estimated and has an em dash before a quote exists. Quote and fee failures have in-place Retry. `lib/swap/review.ts` defines the financial review identity and rejects a refreshed execution quote when amount, minimum, estimate, tax, slippage, tokens or strategy change; a fresh signed transport token alone does not force repeated review.

## TX-11 — Feedback and durable transaction reference

**Revalidated:** Swap still removed all visible transaction references after its transient success state. Mint, marketplace approval and batch error handlers duplicated the shared transaction error toast. Substring matching confused Unstake and staking approval with Stake.

**Solution:** a small `pendingText` API passes through GameTransaction and its compatibility wrapper; staking supplies explicit Approving, Staking, Unstaking and Claiming labels. The shared fallback checks approval and unstake before stake. `getTransactionPhase` is exported for the casino owner's status normalization. No submission/recovery controller logic changed in this round. Duplicate feature error toasts were removed from Mint, marketplace and batch claim; the buildings owner removed the batch quest duplicate in its coordinated edit. Domain-specific success/reconciliation callbacks remain.

Swap uses content-height `SwapExecutionNotice`, with a validated current transaction explorer link and a last confirmed approval/swap reference. `useLastSwapTransaction` stores only the public hash, owner, action and confirmation time. Confirmation is recorded after a successful receipt; it survives tab changes and reload, is immediately hidden for another wallet, and remains in memory if browser storage is unavailable. The existing durable pending-EVM recovery registry remains authoritative for submitted/unknown outcomes; a last confirmed link is historical evidence, not permission to retry a pending intent.

## TX-12 — Focus and selected state

**Revalidated:** Swap suppressed input focus; token menus and marketplace toggles lacked selected-item semantics. P1 had already added `aria-pressed` to Mint strain buttons.

**Solution:** Swap retains a native visible focus outline plus its card boundary, with no ring/outline suppression. Its token menu uses checked radio menu items. Marketplace Sell and Mine/All use the shared radio ToggleGroup and arrow-key navigation. Mint's existing semantic pressed state is preserved. Marketplace scrolling now uses the scoped shared ScrollArea, eliminating its dependency on the document-global observer. Monetary order reviews also use the shared exact disclosure without nesting interactive controls.

## TX-14 — Economic policy boundaries

**Revalidated:** the large feature components still mixed loading authority, display formatting, review identity and execution feedback. P1 had already consolidated Mint/rename ETH quotes with `useSeedPurchaseQuote`, keyed Mint selection with `useMintCatalog`, and receipt-aware batch reconciliation.

**Solution:** this round separates the economic read state policy (three production consumers), financial quote review identity, owner-bound confirmed-reference parser/storage hook, and composable amount/review/execution-notice components. The extracted policies contain actual decisions and validation; they are independently exercised with failed/malformed reads, changed terms, altered credentials and wallet changes. Feature components retain their domain-specific call builders and the stable P1 transaction controller. The changes preserve P1 synchronous quote identity invalidation, fresh preflight, selected currency, immutable submitted strain/batch snapshots, complete owned order reachability and receipt-aware batch locks.

**Remaining maintenance debt:** this is a bounded policy extraction, not elimination of every legacy ABI literal or every large component. Existing ERC20 approval amounts and semantic feature wrappers are preserved. ARC-07/08 owns broader runtime boundaries and controller decomposition. No blanket `any` substitution or generic configuration-driven transaction rewrite was introduced.

## FND-V3 — Mint promo hierarchy

**Revalidated:** the promotional VerifyClaim card preceded primary Mint content on mobile and used an oversized decorative surface.

**Solution:** primary Mint precedes the supporting aside on small screens. Mint opts into VerifyClaim's additive compact appearance: neutral surface, smaller title/padding, outline action and quieter attribution. The desktop supporting column remains. Default VerifyClaim presentation and all verification/claim lifecycle behavior are preserved; the social owner continues its separate recovery/copy work. Land SEED and ETH mint-price displays adopt the shared inspectable amount disclosure.

## FND-V4 — Compact swap density

**Revalidated:** the initial P1-fixed amount cards still consumed approximately 152/138 px at 320 px after the first spacing pass, placing the idle action below the fixed navigation.

**Solution:** the production `SwapAmountCard` places amount/label/balance beside selector/Max on compact widths, while the wider layout keeps the amount's full input row. Typography scales with actual available width with a 16 px minimum; exceptionally long values retain native horizontal editing. Controls retain at least 44 px height. Output is visually quieter; status/recovery text grows naturally. Actual 320×568 measurement is 120/94 px for the two idle cards, no document overflow, and the entire idle Swap action remains above navigation. Entering an amount adds its required financial review; that content scrolls rather than being hidden to force a fixed height.

## Validation and evidence

- **28/28** production-component economic read and swap behavior checks passed across Chromium 390 and WebKit 390. These cover initial/refresh failure, valid zero, malformed required multicalls, wallet switches, retained approval controllers, escrow cancellation, mandatory review and changed financial terms.
- **2/2** additional marketplace radio/arrow-key checks passed in Chromium and WebKit.
- **8/8** layout and durable receipt checks passed at Chromium 320/820/1440 and WebKit 390: long exact values, visible keyboard focus, minimum font/control sizes, no horizontal overflow, content-height recovery text, reload persistence and immediate wallet separation.
- After the final desktop grid alignment refinement, the 320/1440 layout checks passed again. One receipt rerun encountered the transient Next build overlay during the root's removal of `scroll-fade-controller`; the captured failure identifies that unrelated missing import. The same receipt check passed on rerun once the coordinated edit settled. No test expectations were weakened.
- Scoped ESLint passed for edited economy components, policies/hooks and tests. Diff whitespace checks passed. The child also re-ran the batch quest/reconciliation smokes successfully. Root owns integrated typecheck, smoke and full browser runs.

Browser screenshots were captured and visually inspected from the real development app using its local test wallet: `output/p2-economy/mint-320.png`, `mint-820.png`, `mint-1440.png`, `swap-320.png`, `swap-820.png`, `swap-1440.png`, and `swap-320-dark.png`. They show current live catalog/balance data; exact amounts may change. The dark and light 320×568 Swap views keep the action above navigation. The own browser session was closed afterward.

The deterministic tests replace only wallet/RPC I/O and the final submission boundary, or mount the production presentation/storage hooks on development-only QA pages. They do not establish production RPC availability or prove physical-device wallet/keyboard overlays. No claim of exhaustive live-chain or physical-device execution is made.
