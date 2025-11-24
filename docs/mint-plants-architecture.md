# Mint Plants Architecture (Nov 2025)

Audience: smart-contract + backend devs planning the secondary-token mint feature. This summarizes how plant mints currently work end-to-end so we can reason about the upgrade scope.

## TL;DR

- NFT minting lives in the `NFTLogic` ERC-721A extension: it validates strain availability, charges SEED by pulling ERC-20 allowance, and redistributes the payment between burn + rev-share.
- Frontend mints directly via Coinbase OnchainKit transactions; it first ensures SEED approval for `PIXOTCHI_NFT_ADDRESS`, then fires a `mint(strain)` call with optional sponsored gas.
- A server-side `/api/agent/mint` endpoint mirrors the same mint flow via a Coinbase Agent smart account so the AI assistant can mint on the player’s behalf.
- All higher layers assume SEED-only pricing (UI labels, balance checks, AI prompts, spend-permission logic). Accepting a second token requires coordinated updates across contract storage, API params, approval flows, and UX copy.

---

## Contract Layer (pixotchi-onchain/extensions/NFTLogic)

### Storage + configuration

`GameStorage.Data` holds the SEED token handle plus per-strain pricing/flags. That’s the single source of truth the mint path reads from:

```24:101:pixotchi-onchain/extensions/NFTLogic/src/game/GameStorage.sol
    struct Data {
        uint256 PRECISION;
        IToken token;
        ...
        bool mintIsActive;
        address revShareWallet;
        uint256 burnPercentage;
        ...
        mapping(uint256 => uint256) mintPriceByStrain;
        mapping(uint256 => uint256) strainTotalMinted;
        mapping(uint256 => uint256) strainMaxSupply;
        mapping(uint256 => bool) strainIsActive;
        ...
        mapping(uint256 => uint256) strainInitialTOD;
    }
```

`initializeNFTLogic()` pins `_s().token` to the SEED contract (`0x546d…adc7`) and flips `mintIsActive` on startup, so all mint paths downstream assume SEED semantics.

### Mint entrypoint and invariants

The public entrypoint is a thin wrapper that calls `_mintTo(strain, msg.sender)`:

```103:109:pixotchi-onchain/extensions/NFTLogic/src/nft/NFTLogic.sol
    function mint(uint256 strain) external {
        _mintTo(strain, msg.sender);
    }
```

`_mintTo` enforces mint-gating, mints the ERC-721A token, and charges SEED:

```471:507:pixotchi-onchain/extensions/NFTLogic/src/nft/NFTLogic.sol
    function _mintTo(uint256 strain, address to) internal /*nonReentrant*/ {
        require(_s().mintIsActive, "Mint is closed");
        require(_s().strainIsActive[strain], "Strain is not active");
        require(_s().strainTotalMinted[strain] < _s().strainMaxSupply[strain], "Strain supply exceeded");

        uint256 mintPrice = _s().mintPriceByStrain[strain];
        uint256 tokenId = _totalMinted();
        ...
        _createPlant(plant);
        _addTokenIdToOwner(uint32(tokenId), to);
        _mint(to, 1);
        _tokenBurnAndRedistribute(to, mintPrice);
        emit Mint(to, strain, tokenId);
    }
```

**Implications for multi-token support**

- `_s().mintPriceByStrain[strain]` currently assumes a single ERC-20 unit (SEED/18 decimals). We would need either (a) per-token price tables or (b) a notion of primary + secondary payment assets per strain.
- `_tokenBurnAndRedistribute` always pulls SEED from `account` via `transferFrom`. Any new token must either be swappable into SEED before calling `_tokenBurnAndRedistribute`, or we need an overload that decides which ERC-20 to move.

```531:547:pixotchi-onchain/extensions/NFTLogic/src/nft/NFTLogic.sol
    function _tokenBurnAndRedistribute(address account, uint256 amount) internal {
        uint256 _burnAmount = amount.mulDivDown(_s().burnPercentage, 100);
        uint256 _revShareAmount = amount.mulDivDown(100 - _s().burnPercentage, 100);
        if (_burnAmount > 0) {
            require(_s().token.transferFrom(account, address(0), _burnAmount), "Burn transfer failed");
        }
        if (_revShareAmount > 0) {
            require(_s().token.transferFrom(account, _s().revShareWallet, _revShareAmount), "RevShare transfer failed");
        }
    }
```

### Strain metadata surface

- Off-chain code calls `PIXOTCHI_NFT.getAllStrainInfo()` to populate prices, availability, and names.
- `lib/contracts.getStrainInfo()` maps the onchain response into `Strain` objects; helper constants in `lib/constants.PLANT_STRAINS` provide fallback names/prices for the agent.

```1132:1153:lib/contracts.ts
export const getStrainInfo = async (): Promise<Strain[]> => {
  const strains = await readClient.readContract({
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'getAllStrainInfo',
  }) as any[];
  return strains.map((strain: any) => ({
    id: Number(strain.id),
    name: strain.name || '',
    mintPrice: Number(strain.mintPrice) / 1e18,
    totalSupply: Number(strain.totalSupply),
    totalMinted: Number(strain.totalMinted),
    maxSupply: Number(strain.maxSupply),
    isActive: Boolean(strain.isActive),
    getStrainTotalLeft: Number(strain.getStrainTotalLeft),
    strainInitialTOD: Number(strain.strainInitialTOD),
  }));
};
```

```1:7:lib/constants.ts
export const PLANT_STRAINS = [
  { id: 1, name: 'Flora', mintPriceSeed: 10 },
  { id: 2, name: 'Taki', mintPriceSeed: 20 },
  { id: 3, name: 'Rosa', mintPriceSeed: 40 },
  { id: 4, name: 'Zest', mintPriceSeed: 10 },
  { id: 5, name: 'TYJ', mintPriceSeed: 500 },
] as const;
```

*Takeaway:* today every layer treats `mintPrice` as “SEED amount.” Once the contract exposes secondary-token pricing/requirements, we must extend these surfaces (ABI structs, helper types) accordingly.

---

## Backend Layer (Next.js API, Agent flows)

### `/api/agent/mint`

This endpoint lets the AI agent mint on behalf of users via a Coinbase smart account. The high-level steps:

1. Validate `userAddress`, `count`, `strainId`, `totalSeedRequired`.
2. Ensure the agent smart account is loaded and has spend permissions for the user’s SEED.
3. Build an EOA-style user operation: optional pre-calls, `approve(SEED->NFT)` then `mint(strain)` repeated `count` times.
4. Submit via CDP, wait for completion, parse minted token IDs, and transfer NFTs to the real user if necessary.

```167:228:app/api/agent/mint/route.ts
    const approveData = encodeFunctionData({ ... name: 'approve', args: [PIXOTCHI_NFT_ADDRESS, maxUint256] });
    const mintData = encodeFunctionData({ ... name: 'mint', args: [BigInt(strainId || 1)] });
    const calls = [
      ...preCalls,
      { to: PIXOTCHI_TOKEN_ADDRESS, value: 0n, data: approveData },
      ...Array.from({ length: Number(count || 1) }, () => ({ to: PIXOTCHI_NFT_ADDRESS, value: 0n, data: mintData })),
    ];
    mintOp = await client.evm.sendUserOperation({ smartAccount: agentSmartAccount, network: 'base', calls });
```

```279:353:app/api/agent/mint/route.ts
    if (mintedTokenIds.length > 0 && userAddress) {
      const transferDataList = mintedTokenIds.map((tokenId) => encodeFunctionData({ name: 'transferFrom', args: [agentSmartAccount.address, userAddress, tokenId] }));
      ...
      if (!transferSuccess) {
        return NextResponse.json({
          success: true,
          message: `Minted ${count} plants successfully, but failed to auto-transfer ...`,
          result: { ...mintResult, transferError: String(transferError?.message || transferError) }
        });
      }
    }
```

All unit math (`totalSeedRequired`, allowances, `PIXOTCHI_TOKEN_ADDRESS`) assumes SEED. Supporting a second token means:

- Accepting a `paymentToken` parameter and driving both the `approve` call target and spend-permission lookup off it.
- Calculating `totalRequired` per token/decimals.
- Returning token-specific messaging for the UI.

### `/api/agent/chat`

The “Neural Seed Agent” tool exposes knowledge of strain prices and calls `/api/agent/mint` once the user confirms. It currently hardcodes SEED-only rules in both tool schema and the system prompt.

```45:155:app/api/agent/chat/route.ts
const mintPlantsParams = z.object({
  count: z.number().int().min(1).max(5),
  strain: z.number().int().min(2).max(5).optional(),
  userAddress: z.string().optional(),
  execute: z.boolean().default(false),
});
...
const unit = chosen?.mintPriceSeed || 0;
const total = unit * count;
...
const requestBody = {
  userAddress: effectiveUserAddress,
  count,
  strainId: chosen?.id,
  totalSeedRequired: total,
  preparedSpendCalls: ...
};
```

The system prompt explicitly says “You can only mint using SEED” and enforces ZEST-only agent mints. Once a secondary token exists, we’ll want the prompt/tooling updated with the new rules (e.g., allowed payment assets, decimals, additional approvals).

---

## Frontend Layer (Mint tab + transactions)

### Data loading & gating

`components/tabs/mint-tab.tsx` fetches SEED balances, onchain strain metadata, and allowance state. It flips between Approve-then-Mint or bundled Approve+Mint based on wallet type + sponsorship.

```219:337:components/tabs/mint-tab.tsx
      {needsApproval && (
        ...
        {(() => {
          const useBundle = isSmartWallet && isSponsored && !!selectedStrain;
          return useBundle ? (
            <ApproveMintBundle strain={selectedStrain.id} onSuccess={...} />
          ) : (
            <ApproveTransaction spenderAddress={PIXOTCHI_NFT_ADDRESS} ... />
          );
        })()}
      )}
      {!(isSmartWallet && isSponsored && needsApproval && selectedStrain) && (
        <MintTransaction
          strain={selectedStrain.id}
          disabled={needsApproval || seedBalanceRaw < BigInt(Math.floor((selectedStrain?.mintPrice || 0) * 1e18))}
          ...
        />
      )}
```

Key assumptions baked in:

- `seedBalanceRaw` (from `useBalances`) is the single balance the UI checks; no multi-token balance awareness yet.
- `selectedStrain.mintPrice` is rendered as “X SEED” and converted to wei by multiplying `1e18`.
- Approvals always target `PIXOTCHI_TOKEN_ADDRESS`.

### Transaction helpers

`MintTransaction` and `ApproveMintBundle` statically encode the ABI calls; both rely on Coinbase OnchainKit to bundle calls and optionally get sponsored gas.

```35:45:components/transactions/mint-transaction.tsx
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'mint',
    args: [BigInt(strain)],
  }];
```

```47:75:components/transactions/approve-mint-bundle.tsx
  const calls = [
    {
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PIXOTCHI_NFT_ADDRESS, maxApproval],
    },
    {
      address: PIXOTCHI_NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: 'mint',
      args: [BigInt(strain)],
    },
  ];
```

None of these components expose a way to select/change the payment token yet. To add a secondary token we’ll need:

- UI to pick the funding token (per strain or global).
- Balance + allowance checks per token.
- Dynamic ABI call generation so the correct ERC-20 `approve` target is used.

---

## Cross-Layer Flow (today)

1. **User opens Mint tab** → UI queries `getStrainInfo()` + SEED balance via viem read clients, and determines if a SEED approval exists.
2. **User approves SEED** → OnchainKit sends `approve(SEED -> PIXOTCHI_NFT)` via wallet or sponsored smart wallet.
3. **User mints** → OnchainKit calls `PIXOTCHI_NFT.mint(strain)`, paying gas + SEED from the connected wallet. The contract burns & redistributes SEED, then emits `Mint`.
4. **Post-mint** → UI refreshes balances, triggers share modal, and optionally notifies Farcaster. Strain supply counters update via subsequent reads.
5. **Agent flow (optional)** → AI assistant quotes SEED usage, then hits `/api/agent/mint`, which obtains spend permission to pull SEED from the user via CDP, runs `approve+mint`, and transfers NFTs back to the user.

Every step assumes SEED is the sole currency.

---

## Secondary Token Integration Checklist

### Contract layer

- Decide how to express multi-token pricing: per-strain struct with `{tokenAddress, price}`; or keep SEED as base but allow an alternate ERC-20 via swap/cross-call.
- Update `_tokenBurnAndRedistribute` (or add a sibling) so it knows which ERC-20 to `transferFrom` and how to treat burn vs rev-share per token.
- Expose token metadata via `getAllStrainInfo` (e.g., `paymentToken`, `priceInToken`, maybe `isPrimaryToken`), ensuring storage upgrades follow ERC-7201 slot rules.
- Define events or return values to indicate which token was spent, for downstream analytics.

### Backend layer

- Extend `/api/agent/mint` payload to include `paymentToken`, `totalRequired`, and decimals. Use that to select the right spend permission, `approve` target, and minted message.
- Teach the agent smart account to request spend permissions for each supported token and to fail fast with token-specific errors.
- Update `/api/agent/chat` tools + prompt so estimates mention the selected token, and the agent knows when secondary-token minting is allowed.

### Frontend layer

- Surface token selection + pricing in the Mint tab (probably tied to strain availability: e.g., “Mint with SEED” vs “Mint with LEAF/USDC”).
- Track balances/allowances per token (extend `useBalances`, `checkTokenApproval`, UI copy).
- Update CTA text, error messaging, and share modal copy to mention whichever token funded the mint.
- Ensure OnchainKit calls include any pre-swap logic or multi-call sequences (e.g., `swap -> approve -> mint`) if the secondary token doesn’t map 1:1 to `_tokenBurnAndRedistribute`.

### Testing & analytics

- Add regression tests covering strain activation, supply ceilings, and token routing when multiple payment assets are active.
- Update any off-chain analytics or leaderboard scripts that assume SEED-spend equals mint count.

---

## Open Questions for the Contract Upgrade

1. **Token economics:** Is the secondary token another in-house ERC-20 (e.g., LEAF) or a stable/ETH? Do we need dual burn/rev-share percentages?
2. **Per-strain vs. universal payment:** Can each strain specify a different accepted token, or can the user choose at mint time regardless of strain?
3. **Allowance expectations:** Should wallets approve both tokens up front, or do we prefer prompting at mint time to reduce UX friction?
4. **Swaps vs. direct acceptance:** Does the contract need to accept token B directly, or should the dApp swap token B into SEED off-chain/on-chain before calling `mint`?
5. **Agent scope:** Will the AI agent be allowed to mint with the new token, and if so, does Coinbase’s spend-permission API support it?

Clarifying these will let us schedule the exact schema/storage changes and coordinate UI/API updates without guesswork.

---

Ping @backend and @frontend when the contract interface draft is ready so we can prototype the new approval + pricing surfaces behind feature flags.

