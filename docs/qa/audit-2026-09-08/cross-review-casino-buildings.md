# Independent arcade/casino cross-review

The building reviewer independently checked the shared metadata migration and CA-01/02/03/05/17 implementation while their owners were still working. This is source/bytecode review; browser coverage belongs to the owners' fix reports.

## Confirmed improvements

- All `useTokenMetadata` / `useTokenSymbol` consumers were searched. Monetary parsing and display in migrated game/building consumers wait for verified decimal precision; read-only activity says the amount is unavailable instead of assuming 18 decimals or naming another token. The compatibility symbol hook no longer invents SEED.
- Box Game uses explicit loading/ready/error, validates both returned cooldown numbers, and blocks play until a successful read. Its outer wallet/plant key isolates state on identity changes.
- Roulette configuration now exposes failure/retry while retaining known round/selection state.
- Roulette and Arcade wrappers key the active component by its wallet/land-or-plant/token subject, and Roulette completed results retain denomination fields. Historical payouts no longer use newly selected token precision.

## Actionable peer-review feedback sent to owners

1. **Preserve paid-round recovery through metadata outages.** Newly added broad `metadataReady` branches gated Roulette reveal, Baccarat reveal and Blackjack HIT/STAND/SURRENDER even though those actions do not add a wager. A symbol/decimals failure on cold resume must not create an extra way to expire a paid round. Owners agreed to separate fresh/additional spending from existing-round recovery and preserve raw or previously verified denomination for result display.
2. **Keep the active-round banner current on the Box tab.** The inner Arcade banner remained visible after switching to Box while its block poll required the Spin tab. Owner was asked to poll while an open dialog has a pending round regardless of selected game.
3. **Correct SpinLeaf's exact final eligible block.** The initial helper treated `commitBlock + 257` as expired. The current deployed implementation permits that exact block; expiry is strictly later.

## SpinLeaf bytecode evidence

The local original source file is empty, and public IPFS source retrieval was unavailable. The saved public Blockscout artifact at `docs/research/plant-economy-2026-09-05/sources/SpinGameV2.json` contains deployed bytecode for implementation `0xF7E86A862B395313eF685F6A11E2287D5b898f81`. A fresh `eth_getCode` from Base matched that bytecode exactly. Keccak256: `0x9ba07b210956cb19d6d5cb2686d95e789d8b13ea91b8f17640cd64044d10e1ee`.

For `spinGameV2Play(uint256,bytes32)`, selector `0xbf498f89`, the relevant runtime sequence:

- `0x15e7–0x1606` loads the packed commit block and adds one.
- `0x160a–0x1610`: `DUP1 NUMBER GT … JUMPI` requires the current block to exceed that randomness block.
- `0x1658–0x1663` adds `0x100` (256).
- `0x1665–0x1669`: `NUMBER GT ISZERO …` allows the current block to be **less than or equal to** the randomness block plus 256.

Therefore a commit at B can reveal at B+2 through B+257 inclusive; B+258 is expired. At B+257 the UI should show urgent final-block guidance, not archive/delete the pending key as expired. A transaction submitted after that observed head may mine too late, so the separate fresh simulation remains appropriate; wall-clock delay alone never establishes eligibility.

Evidence utility: [inspect-spin-expiry.mjs](C:/Users/Goat/Documents/Pixotchi-Eco/output/inspect-spin-expiry.mjs). Public artifact origin: [Blockscout contract API](https://base.blockscout.com/api/v2/smart-contracts/0xF7E86A862B395313eF685F6A11E2287D5b898f81). The source owners own final application/test updates for this feedback.
