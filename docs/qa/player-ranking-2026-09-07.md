# Players ranking

## Scope

Adds Players to the existing Ranking selector. Rows show a wallet's combined plant PTS, plant count, and percentage of all existing plant PTS. The connected wallet's summary links to its ranked page. Selecting a player opens the existing wallet profile. Pagination, medals, names, amounts, and responsive list layout reuse existing app components.

The total includes living and dead plants, excludes burned plants and PTS still held by lands, and is labeled **PTS share**, not estimated ETH rewards. For example, 50,000 PTS out of 5,000,000 PTS is a 1% share. This feature does not change reward distribution or submit transactions.

## Data integrity

- Server reads the token list, total supply, and extended plant records at one block.
- Every existing token must appear exactly once, and the list must match total supply. Missing, duplicated, unexpected, or failed batches reject the snapshot.
- Wallet aggregation and percentages use BigInt. API/cache values use decimal strings and are validated before display.
- Shared Redis and process caches last 60 seconds, with in-process request deduplication. Only the active Players board polls the endpoint; the browser never scans the contract for this ranking.
- Failed reads show the existing retry state rather than a partial ranking or a misleading zero total.

## Verification

- Typecheck, targeted ESLint, `npm run player-ranking:smoke`, and the production build passed.
- Live endpoint returned 27 wallets and 84 plants. Independent reads at the same block confirmed 84 token IDs and total supply of 84.
- Browser checks covered 320, 390, 561, 820, 864, and 1440px widths. No horizontal overflow; mobile and desktop pagination use the existing page sizes.
- Light/dark layouts reviewed. Player rows explicitly use the foreground token; a fresh light-theme load confirmed readable names, amounts, heading, and summary.
- Live pagination, page reload, existing profile opening, failure/retry, and return to existing Plants filters passed.
- A browser-only API fixture verified the connected wallet's rank link and last-page resizing; the fixture was removed and live data restored. No onchain data changed.

Local evidence is under `output/player-ranking-*.log` and `output/playwright/frontend-review-2026-09-05/player-ranking-*.png` (ignored artifacts).
