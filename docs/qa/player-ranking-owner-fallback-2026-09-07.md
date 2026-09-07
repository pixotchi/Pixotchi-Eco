# Player ranking: missing extended owner

The local `/api/leaderboard/players` endpoint reproduced the reported state with HTTP 503. Direct execution of the ranking service reported `Missing plant owner`; RPC reads themselves succeeded.

At Base block **50999927**, the configured plant contract (`0xeb4e16c804AE9275a655AbBc20cD0658A91F9235`) returned 86 IDs and a total supply of 86. Plant **22434** had zero PTS and status DEAD. Its extended record returned the zero address, while ERC-721 `ownerOf(22434)` at that same block returned `0x7e5A140080178338CbB322D97c9DE30c58EA3CEc`. Rejecting the extended record therefore prevented the whole ranking from loading despite valid token ownership.

The reader now resolves zero-address extended owners through `ownerOf` at the snapshot block. Fallback calls run sequentially within each of the existing three batch workers. Every plant remains included, including zero-PTS plants. Failed, malformed, or still-zero ownership continues to reject the snapshot; no records are silently skipped. The UI and AI share this service.

Validation:

- Player-ranking smoke covers recovery, zero and nonzero PTS, same-block ownership, and failed/invalid/zero fallback results, alongside existing completeness checks.
- TypeScript and targeted ESLint passed; AI player-ranking smoke passed.
- Live service returned 28 wallets / 86 plants at block 50999961.
- Local endpoint returned HTTP 200; the live desktop Players tab rendered 20 first-page rows without the error state.

This verifies the local failure against live contract reads. No beta deployment or push was performed.
