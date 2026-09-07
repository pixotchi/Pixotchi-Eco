# Cost and resource icon coverage

Extended the shared 14px decorative icon/value treatment to construction time, upgrade costs, optional speed-up costs and time remaining; Village production and upgrade details in building info; Casino and Barracks build costs and balances; Barracks training costs, balances and carry capacity; staking rates and totals; marketplace give/receive reviews; arcade stars and cooldown; plant ETH rewards and revive summaries.

Shared TokenAmount and AmountField available-balance displays now resolve known units to existing artwork. Existing land/ranking/production icons explicitly suppress the nested TokenAmount icon to avoid duplication. Dynamic token symbols are matched case-insensitively; unrecognized units retain their text without displaying another token's artwork. Amount formatting, units, transaction values and the Town/Village calculation guard are preserved.

Verification:
- Targeted ESLint and TypeScript checks passed.
- Land production smoke (including closed Town building regression) and all four frontend smoke suites passed. The standalone land-production run emits the existing missing-Redis diagnostic; its assertions do not require Redis.
- 18 existing browser checks passed across 320px dark, 390px light and 1440px dark: field labels/errors, exact marketplace amounts, land badges, game fields, tiny/large amounts and production readouts.
- Local live read-only checks at 320/390/820/1440px found no overflow in Casino construction or building-info summaries. Build-cost/balance icons rendered at 14px.
- Land #712 Soil Factory L2 upgrade and info views verified at 390px: ~4 days, 4,689,474 LEAF and 27,000 PIXOTCHI, with the corresponding icons and no overflow.
- Screenshots: `output/playwright/frontend-review-2026-09-05/cost-icons-upgrade-mobile.png`, `cost-icons-building-info-mobile.png`, and `cost-icons-casino-mobile.png`.

Browser verification used public owner-list read fixtures. No transaction was submitted. Fixture routes were removed afterward. This pass did not execute every cost-bearing transaction or check every token configuration.
