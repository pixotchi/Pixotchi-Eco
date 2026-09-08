# Plant copy: deployed contract verification

Read-only Base mainnet snapshot at block **51,051,672**, hash `0x8b3fdee1ab36a032928b4c6fffd6d64137173ed7e4e2a0ef1c3cc5a37f97197e`, dated **2026-09-08 18:38:11 UTC**. No wallet, signature, simulation, or transaction was used.

The app's plant router is `0xeb4e16c804AE9275a655AbBc20cD0658A91F9235`. Calls to `getAllStrainInfo`, each `getStrainPaymentInfo`, and ERC-20 token metadata used the same block. Raw values, implementation routing, code hashes, source provenance, and supplementary storage reads are preserved in [the evidence JSON](./copywriting-chain-evidence-2026-09-08.json).

## Current strains

| Strain | Starting lifetime | Mint price | Lifetime mint cap | Minted to date | Remaining mints | Existing supply |
| --- | --- | --- | --- | --- | --- | --- |
| Flora | 86,400 seconds / 24 hours | 10 SEED | 10,000 | 10,000 | 0 | 100 |
| Taki | 86,400 seconds / 24 hours | 20 SEED | 7,000 | 2,924 | 4,076 | 70 |
| ROSA | 86,400 seconds / 24 hours | 40 SEED | 2,500 | 1,945 | 555 | 18 |
| ZEST | 86,400 seconds / 24 hours | 10 SEED | 7,500 | 7,334 | 166 | 46 |
| TYJ | 86,400 seconds / 24 hours | 500 jesse | 750 | 242 | 508 | 11 |

All five returned strains are active; Flora has no remaining mints. The configured strain counter is five. `getAllStrainInfo` itself filters inactive strains. Existing supply means minted minus burned, while remaining mints means maximum minus minted: burning a plant does not replenish mint availability. Minting is globally active in this snapshot.

SEED is `0x546D239032b24eCEEE0cb05c92FC39090846adc7`; jesse is `0x50F88fe97f72CD3E75b9Eb4f747F59BcEBA80d59`. Both report 18 decimals. Current differences therefore include payment token as well as appearance, price, and supply. The frontend should not imply that choosing a more expensive strain currently buys a longer starting lifetime.

## Current source, verified against deployed code

The router's own `getImplementationForFunction`/`getAllExtensions` calls identify the actual implementations at the pinned block. This matters because the explorer's proxy implementation badge points to an older NFT implementation. The deployed bytecode for each implementation below exactly matches the verified Blockscout contract bytecode; source SHA-256 and bytecode Keccak hashes are in the JSON.

| Implementation | Source | Relevant behavior |
| --- | --- | --- |
| NFTLogic `0x80BA8113125C0b5C115D3a74cf269c1D1190BcD3` | [Verified NFTLogic](https://base.blockscout.com/address/0x80BA8113125C0b5C115D3a74cf269c1D1190BcD3?tab=contract) | Mint/payment routing, initial plant attributes, artwork, supply counters, and in-game token burn. |
| GameLogic `0x0d45AED9Cb7BCb6d34FaA35cdB20C1fC1e6B7ecf` | [Verified GameLogic](https://base.blockscout.com/address/0x0d45AED9Cb7BCb6d34FaA35cdB20C1fC1e6B7ecf?tab=contract) | Strain list, plant status/levels, rewards/claim, attack, and dead-plant burn. |
| ConfigLogic `0x529c06F4a8268245E0c611B305ae5aA080356FA6` | [Verified ConfigLogic](https://base.blockscout.com/address/0x529c06F4a8268245E0c611B305ae5aA080356FA6?tab=contract) | Authorized configuration can change per-strain initial lifetime and global burn percentage. |

Confirmed source behavior:

- `NFTLogic._mintTo` initializes every strain at zero score and zero stars, with its configured starting lifetime; zero configured lifetime falls back to one day. Name/artwork, availability, price/payment token, mint supply, and initial lifetime are the strain-dependent fields in this implementation. Current GameLogic status, level, combat, and pending-ETH formulas have no per-strain advantage branch.
- `GameLogic._redeem` clears the plant's entire score, accrued reward balance, and reward debt, then transfers pending ETH to its owner. `level` returns one at zero score. Claiming does not change lifetime or stars.
- Attack uses 31 winning integer outcomes out of 100 (`random % 100 <= 30`) and transfers 0.5% of the loser's score/reward debt. A plant can attack every 30 minutes; the target must be past its one-hour repeat-attack cooldown. These are current contract rules; this source review is not a randomness-security audit.
- Burning a dead plant gives the acting player's plant one star, burns the dead NFT, and settles its pending ETH to its previous owner. It does not transfer the dead plant's score to the acting player. The cooldown is one hour per acting wallet. `canKill(address)` and `getKillCooldownRemaining(address)` are installed; `getKillCooldownSeconds()` is not installed in the current router.
- The current in-game burn percentage is 70, confirmed by a pinned storage read using the verified packed `GameStorage.Data` layout. The NFT implementation applies this percentage to supported SEED and alternate-token spend, with the rest sent to its revenue-share destination. This is separate from the token's trading taxes.

## Boundaries of this evidence

The snapshot establishes that all five currently active strains start with the same lifetime, not that lifetime can never differ. The deployed configuration supports per-strain values. Source review covered the current plant mint, core gameplay, and configuration implementations; it does not establish that every external or future extension has identical behavior for every strain.

One protocol edge case discovered during review is separate from copy changes: `isPlantAlive` includes the exact death timestamp, while `getStatus` has strict comparisons leaving exactly 8, 12, and 16 remaining hours outside its named live-status intervals. Those exact values fall through to the BURNED enum. Explanatory copy should not claim mathematically exhaustive status intervals, and fixing the deployed behavior requires contract work.

Reads initially used `https://base-rpc.publicnode.com`; supplementary pinned reads used `https://mainnet.base.org` after the public provider rejected older-block requests. No private endpoint or credential appears in the saved evidence.
