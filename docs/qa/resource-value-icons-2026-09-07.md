# Resource value icons

Added a shared 14px decorative resource/value treatment using the existing artwork. Applied to element purchase costs (SEED, ETH, SOL), points/lifetime/protection effects, land production summaries, warehouse available resources, and batch claim/quest PIXOTCHI costs. Text units, amount formatting, quantities, and transaction calculations are preserved. Mixed effects can wrap separately; icons cannot shrink or separate from their value.

Validation:
- TypeScript and targeted ESLint passed.
- All four `frontend:smoke` suites passed.
- ProductionSummary's existing QA fixture passed browser checks at 320, 390, 820, and 1440px: icons loaded at 14px and large resource amounts did not overflow.
- Screenshot: `output/playwright/frontend-review-2026-09-05/resource-icons-production-mobile.png`.
- Live element popup visual verification was unavailable: the local test wallet returned no plants, including with the previous read-only owner fixture. No transaction was submitted. Browser routes were removed after verification.
