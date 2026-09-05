# Pixotchi frontend and player experience audit

Audited 5 September 2026 against checkout `6f7ddf0`, app version 1.8.30. This is an assessment and proposed implementation plan; application code was not changed.

## Assessment

Pixotchi has a substantial, functioning game and a much better foundation than its remaining inconsistencies suggest. It already has shared controls, design tokens, keyboard-aware dialogs, wallet ownership guards, transaction recovery, receipt-driven refresh, reduced-motion support, and meaningful regression checks. Preserve those investments.

The immediate problem is correctness at the interaction boundary. The marketplace's best-price shortcuts choose the wrong end of the price ordering. Mobile roulette hit regions select a different bet from the visible number tapped. Swap and staking lose drafts at responsive transitions. These deserve attention before another visual redesign.

The broader experience suffers from too much equally emphasized information, nested responsive layouts that do not know their available space, and feature-local versions of recurring tasks. Players repeatedly have to decode token units, learn a new form arrangement, or scroll past decoration to reach the action. The intended direction should be a calm, legible game interface with distinctive pixel art and dependable behavior.

## What the application does and how it works

Pixotchi is an onchain plant-care and land-management game on Base, available as a browser application and a Farcaster/Base Mini App.

- **Plants:** players mint different strains, maintain lifetime, increase PTS and level, collect ETH rewards, buy care items and fences, earn or spend stars, play arcade games, attack eligible plants, collect stars from dead plants, and revive their own plants.
- **Lands:** players mint and select lands, inspect their position on the world map, upgrade production buildings, collect PTS/lifetime into a warehouse, assign those resources to plants, stake, use the SEED/LEAF marketplace, run quests, train troops and raid, or enter casino games. Batch claim and batch quest flows span multiple lands.
- **Economy:** SEED, LEAF, PIXOTCHI, ETH, PTS, lifetime and stars have different roles and precision rules. Staking produces LEAF; swaps and some wallet-dependent bundled purchases bridge acquisition and spending. These distinctions are central to the UX.
- **Community and progression:** four ranking boards, filtered activity, Farmer's Tasks, a tutorial, public chat, the read-only Neural Seed assistant, player profiles, and EFP social actions.
- **Supporting surfaces:** wallet identity and asset transfer, free-plant verification, airdrop claims, broadcasts, updates, share pages, service status, error/404 pages, and an administrative console.

The root game page owns the six main tabs. Tab modules are dynamically loaded and visited tabs use React `Activity` to preserve state while hidden. Query parameters preserve selected navigation/filter state. The same shell switches between bottom navigation and a desktop side rail, and relocates balances depending on width and height.

`app/providers.tsx` composes authentication, host detection, theme, effects/audio, query state, Wagmi/Privy, smart-wallet/paymaster handling, optional Solana support, balances, chat, tutorials and global feedback. The provider count is partly the cost of supporting several execution environments; reducing it arbitrarily would not fix the experience.

Feature components read from shared contracts/query helpers and app APIs. The browser uses the same-origin RPC proxy; server-side clients manage provider fallback. Indexer-backed activity and rankings have a different freshness path from direct contract reads. Redis-backed services support persisted app features such as chat, tasks and claims.

Feature transaction wrappers build contract calls and delegate to the shared transaction infrastructure. Its important responsibilities include submission ownership, smart-wallet/EOA routing, durable proof, pending recovery, duplicate prevention, confirmation and resource invalidation. Success is not simply a button changing color: the receipt must reconcile balances, plant/land state and later activity.

Primary entry points: [game shell](C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx), [providers](C:/Users/Goat/Documents/Pixotchi-Eco/app/providers.tsx), [transaction kit](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-kit.tsx), [RPC client](C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc.ts), [shared styles](C:/Users/Goat/Documents/Pixotchi-Eco/app/globals.css).

## Coverage and evidence

The source census indexed **431 source/style files** in `app`, `components`, `hooks` and `lib`, including **174 TSX files / 58,759 TSX lines**, four page routes, **32 `DialogContent` call sites in 25 files**, and **67 input/control sites** matching the inventory's input, textarea, select, switch and toggle-group categories. These are mechanical counts, not claims that every branch was executed. Dialog counts include alternate/loading implementations.

The companion [source inventory](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/frontend-source-inventory-2026-09-05.csv) accounts for every indexed file. The [dialog coverage inventory](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/frontend-dialog-coverage-2026-09-05.csv) accounts for all 32 call sites.

Browser work used the existing local development server and Chromium with the Local Test Wallet. More than 100 screenshots and corresponding accessibility snapshots were collected. Some first-load captures deliberately show loading; settled captures have `ready` or explicit action names. A screenshot is evidence of one state, not an entire feature passing.

| Surface | Runtime inspection completed | Important states still requiring fixtures or another environment |
| --- | --- | --- |
| Shell / authentication | Browser login, local test wallet, six tabs, mobile/desktop navigation, balance placement, responsive transitions | Privy/social login completion, injected EOA rejection/switches, real Mini App host behavior, Solana identity |
| Plants / shop | Owned live plant, detail metrics, marketplace items, rename and reward dialogs, post-transaction refresh | No plants, dead plant/revive, long/many assets, all item/fence purchase outcomes |
| Arcade | Box choices, box cooldown, star modes, SpinLeaf, insufficient-star state | Submitted play, pending reveal, win/loss, expiry/recovery, enough-stars state |
| Lands | Selector, production buildings, Stake House, Warehouse, Farmer House, Marketplace, Casino, Barracks, batch entry points, name and info dialogs | Every building level/upgrade phase; batch partial failures; quest completion and reward exhaustion |
| Warehouse | Valid amount, selected plant, dropdown, submitted 1 PTS assignment, confirmation and both resource updates | RPC failure presentation, lifetime assignment, wallet changes mid-request |
| Map | Mobile and desktop rendering; source review of keyboard, panning, zoom and selection | Full touch/pinch behavior, real device frame rate, all loading and neighbor-data failures |
| Mint | Plant strains, land mint, sold-out option, price/availability, insufficient balances, free-plant entry | Paid mint confirmation/share, free-claim eligibility outcomes, all alternative payment routes |
| Ranking | All four boards, plant profile, Attackable and Dead filters, attack confirmation with attacker and win/loss preview | Submitted attack/kill/revive, all cooldown outcomes, EFP updates |
| Activity | Loaded feed and controls; normalization/filter source | All event types and partial indexer/RPC failure permutations |
| Swap | Desktop/mobile, token-info view, draft loss reproduced twice | Newly submitted swap, smart-wallet bundles, stale/failed quotes, interrupted multi-step recovery |
| Staking | Stake/unstake controls, balances, reward data, amount draft, resize loss | Newly submitted stake/unstake/claim and rejection/recovery |
| Wallet / transfer | Profile, balances, initial transfer selection, asset picker, invalid recipient | Final transfer execution, partial multi-NFT recovery, embedded-wallet export |
| Chat / AI / profiles | Chat shell, desktop split layout, mobile layout, authentication error; plant profile | Authenticated messaging, AI stream/error/cancel, IME typing and EFP transactions |
| Tutorial / themes | All ten slides and all eight themes on mobile Farm | Every theme × every dialog × every interaction state |
| About / ancillary | About, feedback form, status, admin gate, missing route/share | Sending feedback; authenticated admin workflows; actual mint-share success; broadcast scheduling/delivery |

Viewport checks included 320×568, 360×800, 390×844, 768×1024, 820×1180, 864×1024, 1024×768, 1280×800, 1440×900, 1920×1080 and 844×390. A 1024×600 resize also exercised compact header ownership. These are Chromium CSS viewport checks, **not physical iOS/Android/tablet testing**. Safari keyboard behavior, browser chrome/safe areas, touch precision, screen-reader operation, actual zoom, low-end GPU performance and host SDK differences remain separate validation work.

Seven settled axe runs covered light Warehouse, Swap, Staking, Wallet, Transfer, dark Farm, and Roulette. They reported no automatic violations in those states. Numerous contrast checks remained incomplete over gradients/images; Roulette also had a target-size check requiring review. A transient scan taken during theme-menu dismissal reported `aria-hidden-focus`; a settled rerun cleared it, so it is not reported as a persistent defect. The roulette pointer bug below exists despite a zero-violation automated result.

`npm run typecheck`, `npm run app-ui:smoke`, and `npm run uiux:smoke` passed. Existing historical validation in [the earlier fix record](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/uiux-fixes-2026-09-05.md) was consulted, but its build/lint/transaction results are not presented as new runs from this audit.

Local chat authentication returned `Unexpected SIWE domain`; the configured public URL is the production domain while the inspected page is localhost. This blocks authenticated chat coverage here and is **not evidence that production chat is broken**.

No public chat message, feedback submission, administrative mutation, transfer, market order or casino wager was submitted. One authorized transaction applied **1 PTS from land #712 to plant #22419**. The RPC receipt returned success. Warehouse PTS changed **71.5022 → 70.5022**, and the plant changed **10,870.77 → 10,871.77 PTS**. [Transaction evidence](https://basescan.org/tx/0xe5adadb13e197c247a50f6ddd9ebf6bd70585d9ce498938dcaeb960b6c4bd18a).

**Coverage conclusion:** this is a complete source census and broad feature/state sampling, with deep investigation of the highest-risk boundaries. It is not 100% runtime coverage. Reaching that standard requires the explicit state/device matrix at the end of this report; claiming it from one wallet and one browser would hide meaningful gaps.

## Findings and proposed solutions

Priority: **P1** = fix before the next quality release; **P2** = material usability/reliability/maintenance issue; **P3** = polish or targeted follow-up. Evidence distinguishes **reproduced**, **source-confirmed**, and **design assessment**.

### F01 — P1: Marketplace “best” prices use the unfavorable end of the ordering

**Reproduced + source-confirmed.** The UI quotes **LEAF per SEED**, groups sellers of LEAF as asks sorted ascending, and sellers of SEED as bids sorted descending. `Use Best Bid` puts the highest LEAF/SEED rate into a Sell LEAF order. `Use Best Ask` puts the lowest rate into Sell SEED. Those directions are unfavorable for the chosen sale.

For example, selling 1,000 LEAF at 100 LEAF/SEED returns 10 SEED; at 1,000 LEAF/SEED it returns only 1 SEED. The current descending shortcut prefers the latter. Selling 1 SEED reverses the preference: 1,000 LEAF is better than 100 LEAF. The current ascending shortcut prefers 100.

The live UI populated approximately **185,185,185,185 LEAF/SEED** via Best Bid and displayed a **92,592,600,000** midpoint. No order was submitted. The midpoint also gives arbitrary outlier orders an undeserved appearance of market authority.

**Solution:** establish one base/quote convention throughout labels, sorting, side selection and calculations; sort according to the player's receive amount. Compare exact ratios with bigint cross-multiplication before display rounding. Show “You give / You receive” before creating or taking an order. Do not present a midpoint as a reliable market value when the book is crossed, sparse or dominated by extreme quotes.

**Acceptance:** tests with two competing prices on each sale side must choose the greater receive amount; rates below 0.000001 and very large ratios remain distinct. Verify UI shortcuts and prepared call amounts agree. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/marketplace-dialog.tsx:319), [live prefill](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/market-best-bid-1440.txt).

### F02 — P1: Mobile roulette selects a split bet when the player taps a number

**Reproduced.** At 390px, the center of the visible number **3** is hit-tested as **“Bet split 3 and 6.”** A physical pointer click at that center added **Split 3–6**, not a straight bet on 3. The number cells are roughly 34px wide while absolutely positioned split/corner targets are 44×44px and sit above them.

**Solution:** redesign the mobile betting interaction so hit regions do not overlap. Prefer a number-first selection followed by a clearly labeled choice of straight/split/street/corner, or an explicitly selected bet mode. A larger scrollable table can also work if every target has non-overlapping space. Simply shrinking targets or adding more invisible padding is not a sufficient fix.

**Acceptance:** pointer/touch-center tests for every visible number select that number; split/corner targets select only their advertised areas. Include edge taps, horizontal scroll and keyboard navigation. No wager was submitted during this reproduction. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/CasinoDialog.tsx:826), [selected wrong bet](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/roulette-after-center-click-390.png), [hit-test record](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/verify-last.json).

### F03 — P1: Swap loses its draft during ordinary navigation and resize

**Reproduced.** Entering `0.000001` ETH on desktop, then resizing to 820px, produces an empty input. On mobile, entering an amount, opening Token Info and returning to Swap also clears it. Conditional layouts mount different `PixotchiSwapPanel` instances.

**Solution:** keep a single swap controller and draft above the view/layout switch. Render or position presentation regions around it; mount the chart lazily without unmounting the financial form. Preserve selected tokens and slippage too. Do not retain stale quotes as executable after preserving the draft—revalidate them.

**Acceptance:** all panel switches and 863↔864px resizes preserve intent; pending/submitted operations remain attached to their existing recovery identity. Draft loss is proven; loss of a submitted transaction is not claimed. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/swap-tab.tsx:592), [reproduction](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/targeted-sweep.json).

### F04 — P1: Staking closes and discards its draft when header placement changes

**Reproduced.** Opening Stake and typing `1` at 390px, then resizing to 1024×600, removes the dialog entirely. Reopening it gives an empty form. `StatusBar` owns the dialog state, while the shell replaces the standalone status bar with a different header instance. Desktop-to-phone resize has the same result.

**Solution:** own the staking dialog once at the app/dialog-provider level. Header and standalone buttons should dispatch the same open action to that owner. Audit other layout-dependent dialog owners, especially chat draft ownership.

**Acceptance:** draft, open state and active staking operation survive header relocation, desktop resize and relevant tablet rotations. [State owner](C:/Users/Goat/Documents/Pixotchi-Eco/components/status-bar.tsx:152), [layout decision](C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:676).

### F05 — P2: The tablet shop collapses into an unusably narrow purchase column

**Reproduced.** At 864px the purchase detail card is **122.7px wide**; its button is **89.3px wide** with **134px of text width**. Prices and helper text wrap excessively. The outer plant/shop split and inner shop/detail split activate at the same breakpoint, leaving the innermost form without enough room.

**Solution:** let the shop's own available width determine when its internal columns split. Keep the item details below the catalog until a reasonable minimum form width is available. A container query or explicit layout variant is better than another viewport exception.

**Acceptance:** check 820, 863, 864, 900, 1024 and 1280px, including long token labels and errors. The primary action and price must remain legible without ellipsis. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/plants-view.tsx:928), [screenshot](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/farm-864x1024.png).

### F06 — P2: Read failures still become apparently empty resource states

**Source-confirmed.** Warehouse plant loading catches failure by setting an empty list and no selected plant, without an error/retry presentation. Batch claim logs a failed scan and marks the land set scanned, allowing initial failure to resemble nothing claimable. Chat profile fetch failure resolves to no plant with no corresponding error state.

**Solution:** standardize `loading / ready / empty / stale / error` resource states. Keep stale data visibly marked where safe; block spending on unverified data; expose a contextual Retry. Preserve the existing owner/request-generation guards.

**Acceptance:** failed reads must never claim “no plants” or “nothing to claim.” Test first-load failure, stale refresh failure and wallet replacement. [Warehouse](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/WarehousePanel.tsx:49), [batch scan](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/batch-claim-card.tsx:114), [chat profile](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-profile-dialog.tsx:77).

### F07 — P2: Asset transfer starts with every asset selected

**Reproduced + source-confirmed.** The transfer dialog opened with **1/1 plants and 3/3 lands selected**. The load effect selects every returned asset whenever it is not in the confirmation step. The final confirmation and irreversible-action acknowledgment are good safeguards, but the initial intent is overly broad for a routine “send an asset” operation.

**Solution:** start with none selected, or a specific asset when launched from its detail. Make Select All explicit. Preserve deliberate selection through refresh. The review should enumerate names/IDs and clearly identify the recipient, in addition to counts.

**Acceptance:** loading and refresh never silently expand the user's intended selection. Retain existing durable transfer plans and partial-send recovery. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transfer-assets-dialog.tsx:396), [initial state](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/transfer-390.txt).

### F08 — P2: Chat has draft-ownership and input-semantics gaps

**Source-confirmed; authenticated reproduction outstanding.** Desktop mounts two `ChatInput` instances, both with `id="chat-character-count"`. Drafts live inside those instances, so changing between desktop and mobile replaces them. On mobile, switching Public/AI keeps the same local draft while changing its destination. Enter handling also lacks an IME composition guard.

**Solution:** store drafts by chat mode above the layout split; use `useId` for descriptions; ignore Enter while composition is active. Consider an auto-growing textarea with explicit Enter/Shift+Enter behavior. Keep the existing “preserve draft on send failure” behavior.

**Acceptance:** desktop resizing and Public↔AI switches preserve the correct separate drafts; no duplicate IDs; Japanese/Chinese/Korean composition does not trigger a send. [Input](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-input.tsx:26), [responsive ownership](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-dialog.tsx:101).

### F09 — P2: Warehouse grid syntax is invalid

**Reproduced.** Both `grid-cols-[1fr,auto]` containers compute as a single full-width column, stacking Apply beneath its input. The comma produces an invalid grid track list. The error element's `col-span-2` can additionally change layout when validation appears.

**Solution:** use valid track syntax such as `grid-cols-[minmax(0,1fr)_auto]`, and place error text after the control row with an explicit full-row span. Keep the input/button relationship stable when an error appears. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/WarehousePanel.tsx:197).

### F10 — P2: Dropdown widths use inconsistent CSS-variable syntax

**Reproduced.** The Warehouse trigger measured **425.5px**, but its menu measured **235.5px**. `w-[--radix-dropdown-menu-trigger-width]` is not the explicit `var(...)` form used in newer call sites. The same old form remains in Barracks.

**Solution:** give the shared dropdown an opt-in `matchTriggerWidth` contract using valid CSS. Cap it against available viewport width; do not globally force all menus to match triggers, since theme/action menus differ. [Warehouse](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/WarehousePanel.tsx:174), [Barracks](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/BarracksPanelV2.tsx:1247).

### F11 — P2: The same balance is rounded, truncated and abbreviated differently

**Reproduced.** A SEED balance appeared as **6.19** in the header, **6.18** in staking/mint/transfer-related surfaces, and **6.189625** in the shop/swap. LEAF appears as 2.9M, 2.94M, 3M or a long decimal depending on context. Different levels of detail are reasonable; unexplained contradictory rounding is not.

**Solution:** centralize token formatting policies: compact summary, spendable amount, exact inspection and estimated quote. Use the same rounding policy within a context, mark approximations, keep exact bigint comparisons for affordability, and provide an exact-value disclosure where helpful. [Header formatter](C:/Users/Goat/Documents/Pixotchi-Eco/components/status-bar.tsx:71), [shared formatters](C:/Users/Goat/Documents/Pixotchi-Eco/lib/utils.ts:140), [market formatter](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/marketplace-dialog.tsx:67).

### F12 — P2: Shop tiles do not explain what players are selecting

**Reproduced/design assessment.** Most tiles show an icon and “Qty: 1,” with names and benefits only available after selection. The default Sunlight selection opens an unaffordable purchase for this wallet. A newcomer first sees an error without having chosen an action.

**Solution:** give each item a visible name, concise effect and price. Use “Add lifetime,” “Increase points” and “Protection” as player-facing categories. Separate selection, quantity and review. Prefer a neutral initial detail or a relevant affordable care suggestion over an unsolicited error state. [Catalog](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/plants-view.tsx:921), [details](C:/Users/Goat/Documents/Pixotchi-Eco/components/item-details-panel.tsx:477).

### F13 — P2: Mint puts decoration ahead of the purchase decision

**Reproduced/design assessment.** On a 390px phone, the initial viewport shows introduction, large art and strain choices; selected price and confirmation require scrolling. The text says strains differ in starting lifetime, but the main comparison is not organized around price, lifetime and availability together. Free-plant verification competes with paid mint cards lower in the flow.

**Solution:** make the selected strain's price, starting lifetime and eligibility a compact decision summary, keep art proportional, and use a persistent review action when the form is long. Offer a clear first-plant route before requiring the player to understand every strain/token combination. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/mint-tab.tsx:877), [phone capture](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/mint-390.png).

### F14 — P2: Mobile land management delays the useful controls

**Reproduced/design assessment.** The selector, large illustration, land title and repeated ID consume most of the opening screen; buildings and their actions begin much farther down. Desktop offers a useful overview that the mobile ordering loses.

**Solution:** bring “ready to collect,” active construction, current quest and warehouse totals above the fold in a compact summary. Allow the illustration to collapse. Keep a clear selected-building heading and anchor the chosen panel into view. Preserve the larger illustration as an optional inspection view. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/lands-view.tsx:1105), [mobile capture](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/lands-390.png).

### F15 — P2: Tablet layout jumps from a narrow phone canvas to overly dense columns

**Reproduced/design assessment.** At 768/820px the main app still uses a 448px maximum content canvas; at 864px multiple splits activate at once. In 844×390 landscape, the narrow vertical composition and persistent chrome leave little room for the actual game.

**Solution:** make intermediate widths fluid. Define minimum usable widths per region rather than treating 54rem as permission for every nested split. On short screens reduce decorative height before reducing text or targets. Coordinate chrome and content rules in one layout model. [Shell width rules](C:/Users/Goat/Documents/Pixotchi-Eco/app/globals.css:1080), [responsive contact sheet](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/responsive-overview.jpg).

### F16 — P2: Small screens truncate identifying and decision-making information

**Reproduced + source-confirmed.** At 320px the plant title truncates to a partial ID and PTS loses digits/unit visibility. The reward formatter can shrink toward 8px to fit. Attack confirmation uses 10px win/loss labels and units on both inspected phone and desktop layouts. These mechanisms technically avoid overflow while reducing legibility at important decisions.

**Solution:** preserve IDs, units and amounts in deliberate two-line layouts or compact notation with exact-value access. Restrict pixel typography to short identity accents. Set a legibility floor instead of continuously shrinking financial text. [Fitted reward value](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/plants-view.tsx:99), [320px capture](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/farm-320x568.png).

### F17 — P2: Form units and visible labels vary between features

**Reproduced + source-confirmed.** Warehouse uses two generic Apply buttons, with PTS primarily in a shared availability sentence and the input's accessible label. Barracks uses placeholder-led amounts. Roulette's text amount input does not request a decimal keypad. Shared inputs default to 14px.

**Solution:** introduce a shared amount field with visible label, persistent unit, available balance, Max action, helper/error slot and numeric input mode. Use “Apply PTS” and “Add lifetime” for distinct actions. Prefer 16px editable text on phones; verify actual iOS focus/zoom rather than assuming Chromium emulation covers it. [Input primitive](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/input.tsx:13), [Warehouse fields](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/WarehousePanel.tsx:199).

### F18 — P2: Dialog geometry depends on callers knowing negative-margin internals

**Source-confirmed/design assessment.** `DialogHeader` assumes the parent's 20/24px padding through negative margins, while callers use p-0, p-4 and custom frames. Body/footers mix local scrolling, sticky placement and height caps. The `auto` mobile mode currently follows centered behavior; it does not choose a sheet based on content. This makes spacing changes difficult to predict.

**Solution:** explicit header/body/footer slots should own their padding and separators. Establish small confirmation, form, long-detail and game layouts, each with clear scrolling rules. Use a sheet where it helps the task; complex casino screens can justify a larger dedicated surface. Preserve focus restoration, feedback portals and visual-viewport caps. [Primitive](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/dialog.tsx:258).

### F19 — P2: A successful transaction emits duplicate success feedback

**Reproduced.** Applying 1 PTS produced the feature toast “PTS applied” and the global transaction card “Action complete / You're all set” simultaneously. One action receives two live status announcements and two visual success treatments.

**Solution:** keep one transaction notice keyed to the operation and let feature code supply meaningful outcome text: “Added 1 PTS to Plant #22419.” Use in-place resource updates for confirmation. Preserve explorer/recovery actions and distinguish confirmation from delayed data synchronization. [Feature toast](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/WarehousePanel.tsx:239), [confirmed UI](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/warehouse-transaction-2.png).

### F20 — P2: Several recurring touch controls prioritize density over comfortable use

**Source-confirmed/design assessment.** Quantity steppers intentionally use 24/28px boxes; theme swatches use 32px; several toggles use 40px. These are not automatically WCAG failures, but frequently used care controls should be easier to hit. Roulette demonstrates why invisible target expansion must never overlap neighboring actions.

**Solution:** target 44px usable touch regions for frequent actions, allowing justified compact desktop controls. Keep adequate spacing and verify pointer ownership. The WCAG 2.2 AA target-size criterion is generally 24 CSS px with exceptions; 44px is a product-quality target here, not a claim about that minimum. [Quantity control](C:/Users/Goat/Documents/Pixotchi-Eco/components/quantity-selector.tsx:39), [W3C target guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).

### F21 — P2: Wallet profile emphasizes configuration ahead of the player's holdings

**Reproduced/design assessment.** Airdrop eligibility and account/provider/network/Mini App/wallet-type details precede balances. The name-service CTA compresses the already abbreviated identity. Disconnect is a visually strong footer peer of Transfer Assets.

**Solution:** lead with recognizable identity, balances and owned assets; place provider/network details in a disclosure. Show airdrop status when actionable. Give name-service acquisition its own secondary row and lower the visual prominence of disconnect. Avoid recommending a smart wallet without explaining the concrete benefit for the current action. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/wallet-profile.tsx:671), [capture](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/wallet-390.png).

### F22 — P2: Mobile marketplace is a trading terminal without sufficient guidance

**Reproduced/design assessment.** The long order book dominates the phone dialog and pushes order creation farther down. “Mid,” bid/ask, sell side, amount, price, take and create order require the player to reconstruct the exchange. Extreme numbers and visually identical rounded price rows make this harder.

**Solution:** lead with a simple sell/buy intent and a receive preview. Put the order book behind a dedicated view or compact disclosure, retain advanced exact-price entry, and distinguish taking an existing order from creating a new one. Show the full rate/unit when reviewing an action. This is separate from the pricing correctness fix in F01. [Dialog](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/marketplace-dialog.tsx:460), [mobile book](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/market-ready-390.png).

### F23 — P3: Desktop map wastes available space

**Reproduced/design assessment.** The map remains capped at 440px wide on a 1440px desktop. Its dense repeating terrain is harder to inspect than a wider landscape view would be.

**Solution:** use a larger desktop map with a selected-land inspector and compact legend. On phones, preserve a clear selection marker and discoverable zoom/recenter controls. Retain the existing keyboard navigation rather than replacing it with pointer-only canvas controls. [Source](C:/Users/Goat/Documents/Pixotchi-Eco/components/map/land-map-modal.tsx:233), [desktop capture](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/map-1440.png).

### F24 — P2: Too many layers share the same visual emphasis

**Design assessment.** Page, tab card, inset card, metric, chip and button often all have tinted gradients, borders, highlights and shadows. Static readouts resemble buttons; multiple surfaces compete with the actual action. Large branded/pixel illustrations coexist with tiny highly compressed explanatory text.

**Solution:** use three intentional surface levels: background, content and temporary overlay. Reserve strong elevation for overlays and selected/interactive controls. Keep pixel art expressive while making surrounding text and spacing quiet. Retain themes as accents and atmosphere rather than tinting every nested element equally. [Shared surfaces](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/card.tsx:23), [theme comparison](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/themes-overview.jpg).

### F25 — P2: Shared primitives still have inconsistent composition contracts

**Source-confirmed.** `Card` applies padding to an inner wrapper, whereas `StandardContainer` applies it to the outer element. Adding p-6 to a TabCard therefore adds to, rather than replaces, its default inner p-4. Additional CardContent padding occurs in several features. `StatusChip` aliases Badge but retains its own density override.

**Solution:** document and enforce ownership of padding, radius, elevation and density. Prefer named variants over caller utility patches. Migrate real call sites before removing compatibility aliases. This is a consolidation of the existing design system, not a reason to build a second one. [Card](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/card.tsx:16), [StandardContainer](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/pixel-container.tsx:16), [double-padding call](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/mint-tab.tsx:1307).

### F26 — P2: Feature controllers are too large to change confidently

**Source-confirmed.** The transaction kit is 2,741 lines, swap panel 2,310, ranking 2,155, Blackjack 2,065, Arcade 1,713, chat context 1,681 and Barracks 1,484. These sizes are signals of concentrated responsibility, not proof that every line is bad. UI layout, contract state, validation, recovery and copy are frequently reviewed together.

**Solution:** extract domain controllers and pure selectors first, then presentational regions. Keep one authority for each operation. For example: a swap draft/quote controller with form and review views; a casino game controller with bet entry, active game and result views; a building resource controller with shared amount/approval states. Avoid a single enormous generic component with dozens of feature flags. [Inventory](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/frontend-source-inventory-2026-09-05.csv).

### F27 — P2: Type escape hatches weaken the frontend's contract boundaries

**Source-confirmed.** `UntypedValue` is defined using the return type of `JSON.parse`, effectively `any`, and occurs in transaction callbacks, contract data and feature state. A green typecheck cannot validate those shapes.

**Solution:** use `unknown` at external boundaries, parse into validated domain objects, and type transaction lifecycle states as discriminated unions. Prioritize prices, token decimals, ownership, pending recovery and receipt effects. Do not spend the first iteration rewriting unrelated server code. [Alias](C:/Users/Goat/Documents/Pixotchi-Eco/lib/untyped-value.d.ts), [transaction boundary](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-kit.tsx).

### F28 — P3: Conceptual duplication matters more than exact copied lines

**Measured + source-confirmed.** A clone scan of `app`, `components` and `hooks` found 21 exact/similar blocks totaling 503 lines, about 0.66% at a 12-line/100-token threshold. That includes server code and is not a complete measure of duplication. The more important repetition is balance formatting, amount validation, approval branches, error/empty states and feature-local success toasts.

**Solution:** consolidate those behaviors into typed utilities/components, keeping feature transaction wrappers that meaningfully bind a contract action. Useful candidates are AmountField, TokenAmount, ResourceState, ApprovalAction, transaction outcome text and common selection rows. Do not remove `BalanceCard`: it is actively used by Wallet Profile. [Clone report](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/duplicates/jscpd-report.json).

### F29 — P3: Asset identity and terminology drift between surfaces

**Source-confirmed/design assessment.** Warehouse synthesizes a strain-1/level-0 plant object for the selected row instead of rendering the actual selected plant. Its fallback repeats “Plant #22419” and then “#22419.” Building names use “Ware House” while the feature uses “Warehouse”; lifetime appears as TOD, Time of Death, Lifetime Hours, minutes and seconds. Batch actions use BC/BQ art substitutes.

**Solution:** render shared asset identity rows from real data; show the ID once. Establish a small player-language glossary and consistent action verbs. Use “Lifetime” in routine UI, with TOD explained once for experienced players. Replace BC/BQ placeholders with purposeful batch-action icons. [Warehouse identity](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/WarehousePanel.tsx:156), [building tiles](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-grid.tsx:103).

### F30 — P3: Onboarding explains the whole system before helping with the next action

**Reproduced/design assessment.** Ten slides cover a large game vocabulary. They are useful reference material, but a new player still needs a clear immediate path through funding/claiming, minting and first care. Provider names and technical language add to the learning burden.

**Solution:** keep the tutorial as reference and add a short contextual first-session checklist: get a plant, understand remaining lifetime, perform one care action, find the next useful task. Returning players should see urgent/actionable farm state first. Avoid forcing a full replay when only one feature has changed. [Tutorial](C:/Users/Goat/Documents/Pixotchi-Eco/components/tutorial/SlideshowModal.tsx:90), [login](C:/Users/Goat/Documents/Pixotchi-Eco/components/login-hero.tsx).

### F31 — P2: The QA system does not enforce the promised breadth of UI coverage

**Source-confirmed.** Existing smoke suites cover important domain behavior, invariants and some source-level structure. There is no equivalent tracked, comprehensive browser-state fixture suite covering this app's dialogs, layout boundaries and wallet modes. Today's browser findings passed the existing typecheck and selected smoke suites.

**Solution:** add a stable, read-only fixture harness for representative player states and transaction lifecycle snapshots, plus actual browser tests for high-risk transitions. Track a small visual baseline set and a larger behavioral matrix. Keep real onchain transactions as selected staging validations, not a prerequisite for every visual test. Use receipt/event assertions to complement screenshots.

**Acceptance:** F01–F10 have dedicated behavioral regression cases; every dialog call site has a named fixture or explicit justification; CI covers 320, 390, 820, 864, 1024 and 1440px, light/dark, reduced motion and keyboard operation. [Current smoke](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/app-ui-resilience-smoke.ts), [resource regression smoke](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/uiux-audit-fixes-smoke.ts).

## Additional follow-up areas, without an unsupported defect claim

- **Contrast:** eight theme screenshots are not a contrast certification. Verify normal text at 4.5:1 and applicable large text at 3:1, including disabled/error/selected/focus states and composited gradients. Axe's incomplete results need manual resolution. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- **Motion/performance:** reduced-motion and performance-mode support already exist in snow, map, roulette, logos and other primitives. Profile a production build on a low-end phone before claiming a frame-rate or battery defect. Audit animated backdrop/shadow layers, chat streaming, map rendering and per-instance countdown timers. A minute-only countdown still ticks every second in `useCountdown`; optimize if measurements justify it.
- **Navigation continuity:** top-level/filter query state and per-tab scroll handling are useful. Decide which selected plants, lands and profiles deserve shareable URLs and browser Back behavior. Do not indiscriminately encode every transient confirmation dialog in the URL.
- **Casino reliability states:** active games, reveal deadlines, expired games, retries, split hands and reconnect are high-risk combinations that a 10-SEED minimum and insufficient demo balance did not let this audit fully execute. Use deterministic fixtures for all of them. Keep contract-derived limits and fail-closed behavior.
- **Administration:** the 4,031-line admin page should be decomposed by domain with consistent table/form patterns, but only its gate was inspected live. Admin sending, grants, sweeps, broadcasts and configuration changes require a separate authorized operational review.
- **Real input environments:** test touch, screen readers, browser zoom, virtual keyboards, IME and host webviews. Responsive screenshots cannot substitute for these.

## Proposed design and frontend standard

Use Apple's attention to hierarchy, feedback, continuity and direct manipulation as the quality reference while preserving Pixotchi's game identity. Copying a particular Apple material effect is not the objective. [Apple interface guidance](https://developer.apple.com/design/human-interface-guidelines?lang=en).

| Area | Proposed contract |
| --- | --- |
| Layout | Fluid content regions with explicit minimum usable widths; nested sections respond to container space; one state owner survives layout changes |
| Spacing | A small 4/8/12/16/24/32px scale; 8px label-to-control, consistent helper spacing, 16px field groups and 24px sections as defaults, adjusted deliberately for density |
| Typography | Clear page/section/card hierarchy; 14–16px body; 16px phone form text; 12px secondary labels where necessary; no automatic shrinking of critical amounts to 8px |
| Surfaces | Background, content, overlay; quiet internal rows; elevation reserved for meaningful hierarchy and interaction |
| Controls | Shared heights and radii; explicit compact desktop variants; frequent touch actions around 44px; no overlapping invisible hit regions |
| Amounts | Visible label and unit, exact arithmetic, deliberate display precision, persistent balance/Max relationship and contextual validation |
| Buttons | One clear primary action per task region; action-specific verbs; pending/proof/recovery states do not erase context |
| Dialogs | Header/body/footer slots, one scroll owner where possible, predictable mobile/full-screen variants, keyboard-safe footer, focus return and nested-layer tests |
| Feedback | One notice per transaction, meaningful resource outcome, recoverable errors with retry; separate confirmation from delayed indexer synchronization |
| Selection | Visible names and selected state, predictable dropdown sizing, preserved choice through refresh, no implicit “all assets” intent |
| Motion | Short feedback transitions, interruptible state changes, preserved layout continuity, reduced-motion equivalents; profile expensive effects |
| Copy | Player-facing vocabulary; PTS/lifetime/stars/token roles explained in context; implementation details moved to advanced disclosures |

These are proposed defaults to validate against actual screens, not rigid numerical rules that should create another layer of exceptions. Reflow should remain useful at 320 CSS px; legitimate two-dimensional content such as maps and game tables needs a deliberate contained interaction. [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Implementation sequence and release checks

**First: interaction correctness.** Fix marketplace ordering and receive previews; remove overlapping roulette hit regions; preserve swap/staking state. Add focused behavior checks before changing large layouts. These are the four P1 findings.

**Second: dependable shared behavior.** Resolve warehouse/batch/profile error states, transfer defaults, chat draft/IME/ID handling, dropdown width and grid syntax. Consolidate amount fields, token formatting and transaction outcome feedback. Preserve existing ownership and pending-operation safeguards.

**Third: responsive composition.** Repair the 864px nested split, make intermediate tablet widths fluid, simplify short-screen chrome, prioritize mobile land actions and mint decisions, and expand desktop map use. Validate at both sides of every actual breakpoint rather than only at common device presets.

**Fourth: visual and language refinement.** Reduce redundant elevation, normalize spacing/density, improve visible item naming and asset identity, reorganize Wallet Profile, and make onboarding contextual. Roll out through a few representative features first, then migrate the rest against the same approved patterns.

**Throughout: component boundaries and regression coverage.** Extract controllers while implementing the above, not as an unrelated rewrite. Use the inventories to prevent forgotten dialogs. Track the following matrix:

1. **Identity:** disconnected, EOA, smart wallet/paymaster, Privy embedded, Mini App, Solana; owner and network changes while a panel is open.
2. **Resources:** zero/one/many assets, long names, large/tiny amounts, dead/live plants, upgrading/ready buildings, empty/exhausted reward pools.
3. **Requests:** first load, cached data, background refresh, stale data, offline, rate limit, partial failure and retry.
4. **Transactions:** insufficient funds, approval required, rejection, submission, confirmation, revert, unknown/delayed result, reopened recovery, duplicate attempt and partial batch completion.
5. **Presentation:** phone/tablet/desktop, breakpoint crossing, short landscape, light/dark plus themed checks, reduced motion, touch, keyboard, screen reader, text zoom and virtual keyboard.

Do not brute-force every Cartesian combination. Require all individual states, all critical transitions, pairwise environment coverage, and full end-to-end tests for the highest-risk operations. This turns “100% coverage” into a reviewable inventory and evidence standard instead of an unverifiable promise.

## Evidence locations

- [Mobile overview](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/mobile-overview.jpg)
- [Desktop overview](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/desktop-overview.jpg)
- [Responsive comparison](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/responsive-overview.jpg)
- [All eight themes](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/themes-overview.jpg)
- [Draft and grid reproductions / initial axe results](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/targeted-sweep.json)
- [Roulette hit test, settled accessibility scans and transaction receipt](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/verify-last.json)
- [Full source AST inventory](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-review-2026-09-05/source-inventory.json)

Browser artifacts remain under the ignored `output/playwright/frontend-review-2026-09-05` directory. The report and CSV inventories are durable repository documents; archive the ignored artifacts separately if this evidence must be shared with teammates. Some early screenshots include the Next development issue badge; that badge was excluded from product findings.
