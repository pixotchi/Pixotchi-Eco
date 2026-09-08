# Player-facing copy review — 8 September 2026

## Mint finding and correction

The user's concern was correct for the current catalog. At Base block **51,051,672** (18:38:11 UTC), all five listed strains had **86,400 seconds / 24 hours** of starting lifetime. The current mint implementation starts each at zero PTS and zero stars; the reviewed core status, level, combat, and ETH reward calculations do not give a strain-specific advantage. Appearance, price, payment token, and supply distinguish the current choices. TYJ uses JESSE; the other four use SEED.

The old “Each strain has its own starting lifetime” introduction suggested a difference that does not currently exist. Mint now says:

> Choose a look you like, then review the mint price, payment token and available supply.

When every loaded strain has the same starting lifetime, a separate sentence describes that live value:

> All listed strains currently start with 24 hours of lifetime.

The contract supports changing per-strain lifetime, so this sentence is derived from the loaded catalog. It disappears when values differ or the catalog read fails. Each selected strain still displays its own lifetime. The frontend also applies the verified contract's one-day default when a configured lifetime is zero.

Detailed pinned reads, current implementation addresses, verified-source provenance, and the distinction between existing NFT supply and remaining mints are in [the chain verification note](./copywriting-chain-verification-2026-09-08.md) and [raw evidence](./copywriting-chain-evidence-2026-09-08.json).

## Corrections across the app

| Area | Confirmed problem | Final behavior or wording |
| --- | --- | --- |
| Mint payment reads | A failed alternate-token price lookup could fall back to a legacy SEED price. Truthiness checks could also replace a legitimate zero price. | Failed payment reads reach the existing catalog error state. Authoritative token/price values, including zero, are preserved. |
| Land mint and tutorial | Copy conflated staking with Village production and implied passive growth of plants. | SEED staking earns LEAF. Village production is collected into the Warehouse, then applied to a plant. |
| Claim review and help | Claim reset was vague and could obscure its full consequence. | Explains that all PTS are removed, level returns to 1, the NFT is retained, and the action cannot be undone. The preview labels ETH as the current claimable reward. |
| Protection and first care | Fence language could imply blanket protection; revival and care guidance needed precise action names. | Fence blocks incoming attacks while active. Guidance correctly identifies SEED revival and the relevant care actions. |
| Arcade and combat help | Some guidance implied actions could only earn PTS. | Acknowledges that arcade play and attacks can lose PTS. |
| AI gameplay guidance | Stale claims about strain differences, passive stars, quest participants, item costs, free actions, and navigation. | Uses current rules: quests send farmers, normal Box play does not inherently require spending a star, name-change cost is not hardcoded, and network fees can still apply. Corrects Batch Claim and help destinations. |
| AI mint data | Compact tool results omitted an available lifetime field. | Keeps `strainInitialTODSeconds` in compact game-price and mint-availability results so guidance can use live data. |
| SEED reward statistics | A 24-hour volume × 2% calculation was labeled rewards distributed. | Identifies it as an estimate; does not present the calculation as an observed ETH distribution. |
| Market information | Cached DexScreener data was described as a live BaseSwap quote. | Describes the market data accurately rather than implying it is an executable live quote. |
| Token utility | Burn, staking, Marketplace, and upgrade wording mixed distinct mechanisms. | Scopes the verified 70% burn to supported paid plant actions/minting; distinguishes LEAF upgrade cost from optional PIXOTCHI speed-up and explains player-priced Marketplace orders. |
| Token history and roadmap | Assertive launch-allocation, permanent-liquidity, and future-feature claims lacked sufficient support. | Replaces SEED launch promotion with its verified 20M initial supply/no additional minting/burn behavior. Removes the liquidity promotion and LEAF roadmap promise. Retains the independently verified PIXOTCHI initial allocation and five-year creator vesting, explicitly as a schedule. |
| Staking | A rate could be read as already-earned rewards. | Distinguishes the current reward rate from accrued claimable LEAF. |
| Airdrop | No-allocation messages implied future activity would establish eligibility. | States that the wallet has no allocation in the current airdrop without promising future eligibility. |
| Free-plant claim | Success wording could promise optional bonuses that may fail separately. | Confirms the plant was received without asserting every optional bonus succeeded. |
| Wallet payment mode | ETH-mode copy implied broader payment support than implemented. | Describes supported SEED purchases and smart-wallet approval bundling accurately. |
| Swap confirmation | A recovered token approval briefly displayed “Swap successful.” | Displays “Token approval confirmed. Review your swap, then confirm it.” Actual swap completion retains “Swap successful.” Submission/state logic is unchanged. |
| Swap quote and errors | “Market slippage” confused a configured tolerance with a measured market effect; insufficient principal was described as missing gas. | Uses “Slippage tolerance” and identifies insufficient ETH for the swap amount correctly. |
| Casino help and statistics | Returns and profit were mixed; “provably fair” was unsupported; aggregate “Won” was ambiguous. | Separates total return from profit and removes the unsupported claim. “Payouts” explains returned stakes and that Blackjack totals exclude surrender refunds. |
| Baccarat help | Static rules hardcoded configurable rates and instructed a one-block wait. | Directs players to the current rules displayed by the actual game UI before betting. |
| Building upgrades | An upgrade already underway was labeled as the next upgrade and its cost looked payable again. | Shows “Current upgrade (Level N)” and “Upgrade cost (paid).” |
| Batch collection | Thresholds, batch quantities, and success descriptions were incomplete or imprecise. | Explains the 0.1 PTS / 15-second minimum and that smaller amounts remain individually collectible; uses “up to” limits and the actual submitted batch count/token. |
| Batch quests | “One transaction” ignored the configured batch limit; finishing could imply the slot was immediately idle. | Uses the configured maximum per transaction and explains return/open/reset steps and cooldowns. |
| Quest rewards | “Open check” exposed internal jargon and could imply every started quest earns a reward. | Uses clearer reward availability language without promising a reward. |
| Marketplace | Selected-price order heading did not match the asset the player buys. | Uses “Buy LEAF” / “Buy SEED,” consistent with the order book. |
| Raid preview | “Won/Lost” looked like a completed result. | Uses “Would win/Would lose.” |
| Rankings and profiles | Empty states invented score requirements; wallet profile stats could look wallet-wide when sourced from one plant. | Empty states explain the selected ranking. The wallet variant identifies the source plant beside plant-specific star/ETH values. |
| Error page | Promised plants were safe and the failure was necessarily temporary. | Gives recovery guidance and notes that plant timers continue. |
| Shared-page text | Metadata and visible copy used ambiguous “plant your SEED” / ranking reward language. | Uses consistent mint, PTS, and exploration wording. |

## Revalidation and coverage

This pass reviewed production copy in Mint and empty Farm, plant care/claim/protection, About/tutorial/first-care guidance, AI guidance and tool presentation, token information, Swap, staking, wallet/airdrop/verification states, Land and building help, quests, batch actions, Marketplace, casino help, raid previews, Activity, rankings/profiles, chat, map notices, notifications, shared pages, and app error/loading text. Copy that matched the implementation was retained.

In particular, the Warehouse reassurance was revalidated rather than removed: the reviewed Barracks code caps raids by newly collected pending production, protecting preexisting Warehouse reserves. Current casino expiry/forfeiture, quest expiry, production pauses, speed-up, and cooldown descriptions were also checked against their implementations. The exact attack win count and cooldowns were checked against the current deployed plant source, not an old explorer proxy badge.

The [economy read at block **51,051,802**](./copywriting-economy-evidence-2026-09-08.json) confirmed SEED's current 5% buy and sell tax split (2% rewards, 2% treasury, 1% liquidity), the SEED/LEAF staking tokens, and the configured staking ratio/time unit. Building/casino source checks resolved the active Roulette, Blackjack, Baccarat, Barracks, Village, and Town facets before using their source as evidence.

A separate [PIXOTCHI read at block **51,052,250**](./copywriting-creator-coin-evidence-2026-09-08.json) confirmed 1B total supply, 500M allocated for market positions, and a 157,788,000-second creator vesting interval. The [deployed CreatorCoin source](https://basescan.org/address/0xa2ef17bb7eea1143196678337069dfa24d37d2ac#code) and [Zora's allocation documentation](https://support.zora.co/en/articles/6338497) support the retained initial-allocation/schedule statement. The [deployed SEED source](https://basescan.org/address/0x546D239032b24eCEEE0cb05c92FC39090846adc7#code) supports its initial 20M mint and lack of additional minting. These facts do not establish the removed fair-launch or permanent-liquidity claims.

## Validation performed

- `npx tsc --noEmit` passed after the agents' component changes and root mint changes.
- Scoped ESLint and `git diff --check` passed. The frontend P2 runner syntax check passed.
- New `smoke/mint-copy-read-smoke.ts` passed: shared/different/invalid lifetimes, exact duration formatting, the contract's zero-value lifetime default, alternate-token prices, legitimate zero price, and rejected payment reads. It is included in the existing frontend P2 runner.
- The existing claim/first-care browser test passed on Chromium 390-light and 1440-dark and WebKit 390-light.
- Existing tutorial/task component checks passed in four Chromium/WebKit width groups, including enlarged text.
- Existing airdrop, Verify Claim, and frontend recovery smokes passed; four economy-medium tests passed on Chromium 390-light. Mocked production rendering confirmed distinct recovered approval/swap messages and the displayed slippage tolerance.
- The existing Batch Claim prerequisite/route assertion passed after updating its copy literal. Scoped source checks covered the other building wording.
- The existing compact plant-profile test passed at 320px with enlarged text; the newly attributed wallet-profile statistics line was source-reviewed rather than separately browser-driven.
- A live local Mint session loaded the real catalog, selected Taki and TYJ, and checked the shared lifetime and TYJ's 500 $JESSE price. Widths 320, 390, 820, and 1440 passed the checked viewport bounds; 320px with 200% root text also passed. Mobile and desktop screenshots were visually reviewed and saved under `output/playwright/copy-mint-{390,1440}.png`.

The live session was disconnected and closed. No transaction was signed/submitted; no server was restarted; no commit, push, or deployment was made.

## Evidence boundaries

This is a copy and associated display-state correction pass, not a security audit or a guarantee about every future extension or wallet host. Live settings can change. Retained token allocation/supply/vesting statements were checked separately from current balance/tax reads; unsupported historical/promotional claims were removed. The chain verification note separately records a preexisting exact-timestamp status boundary issue in the deployed GameLogic; that requires contract work and was not changed here.

This report does not replace the initial frontend audit or its outstanding external/native acceptance item.
