# Balanced garden catalog: Superbloom, Everdew and Raincloud

The live garden catalog reads every item from `getAllGardenItem()` on the NFT
contract. Item IDs, SEED prices, PTS and lifetime come from that read. The frontend
maps the lowercase names `superbloom`, `everdew` and `raincloud` to their artwork; it does not
insert uncreated items or set their economics.

Deploy the frontend before submitting the item-creation transaction. Use the
names **Superbloom**, **Everdew** and **Raincloud**. After confirmation, an active catalog refreshes
every minute; a newly loaded page fetches the catalog immediately. Category
placement follows the onchain effects: points only, lifetime only, or both.
Activity icons use the same name mapping. The assistant receives the full garden
catalog rather than a truncated list.

The September 7 revision leaves the nine existing items unchanged and produces
four items in each category:

- Lifetime: Water, Pollinator, Moonlight, Raincloud.
- Points: Sunlight, Fertilizer, Magic Soil, Botano.
- Both: Dream Dew, Nitro, Everdew, Superbloom.

Cards sort by SEED price inside each category. The catalog uses two columns below
340px of available width and four columns above that, avoiding a three-plus-one row.

The development-only `/qa/frontend` fixture includes the proposed values:

| Item | SEED | PTS | Lifetime |
| --- | ---: | ---: | ---: |
| Superbloom | 37,500 | 250,000 | 14 days |
| Everdew | 20,000 | 125,000 | 90 days |
| Raincloud | 200 | 0 | 7 days |

This supersedes the earlier two-item proposal with a pure-PTS Superbloom. The
prepared creation transaction now contains three tuples and 1,209,600 seconds of
lifetime for Superbloom. Raincloud uses 604,800 seconds; Everdew uses 7,776,000.

Raincloud costs 28.5714 SEED/day, 7.928% below Moonlight's rate. Superbloom and
Everdew retain their earlier PTS discounts versus Botano: 21.739% and 16.522%
lower cost per PTS, before valuing lifetime. Two Everdews give the same 250,000
PTS as one Superbloom, with 180 rather than 14 days, for 2,500 more SEED.

These are test fixtures, not production configuration. Regular wallets buy one
item per purchase; smart wallets can use the existing quantity controls. ETH
purchases quote the complete SEED payment, grossed up for SEED buy tax, with pool
impact and the shared market buffer. The swap minimum checks net received SEED.

## Artwork provenance

Final assets (RGBA PNG, 1254 × 1254, generated alpha preserved):

- `public/icons/superbloom.png`
- `public/icons/everdew.png`
- `public/icons/raincloud.png`

Created with the built-in image generation tool. Superbloom and Everdew used the
previously generated concepts in `output/item-art/concepts/` as edit targets;
Raincloud is a new icon in the same pixel-art style. No CLI image-generation
fallback was used. Final prompts:

**Superbloom**

> Use case: background-extraction. Edit target: attached Superbloom icon. Preserve the exact pixel art golden-orange six-petal flower, magenta center, green leaves, dark outline and two pixel sparkles. Remove ONLY the pale checkerboard backdrop. Deliver a standalone RGBA PNG with genuinely empty transparent alpha outside the artwork, suitable for overlay on a black or white webpage. The checkerboard is not part of the art: do not paint or simulate a checkerboard or any white/gray backdrop. Preserve interior highlights. No redesign, no text, no new objects. Square icon, comfortable transparent margin.

**Everdew**

> Use case: background-extraction. Edit target: attached Everdew icon. Preserve the exact pixel art turquoise dew bottle, gold stopper and hourglass emblem, green leaves, dark outline and two gold pixel sparkles. Remove ONLY the pale checkerboard backdrop. Deliver a standalone RGBA PNG with genuinely empty transparent alpha outside the artwork, suitable for overlay on a black or white webpage. The checkerboard is not part of the art: do not paint or simulate a checkerboard or any white/gray backdrop. Preserve interior glass highlights. No redesign, no text, no new objects. Square icon, comfortable transparent margin.

**Raincloud**

> Create RAINCLOUD, one standalone garden inventory item icon for the Pixotchi pixel-art plant game. It is an affordable item granting seven days of plant lifetime. Subject: one compact puffy rain cloud, silver-white on top with light-cyan and blue underside shade blocks, dark navy/deep-purple thick pixel outline, and three chunky bright cyan/blue raindrops beneath. One tiny cyan four-point pixel sparkle beside it at most. No face or facial features. Match classic colorful retro videogame item sprites: deliberately coarse approximately 32-48 logical pixels, large block shapes, sharp stair-stepped edges, 2-3 flat shade steps, sparse square white highlights. Clear recognizable simple silhouette at 32px display, similar to a magic water-drop garden icon or a coarse moon inventory icon. Center the complete cloud and raindrops on a square canvas, approximately 80% occupancy, balanced comfortable margins. Deliver a real RGBA PNG on an actually transparent empty alpha background. No drawn checkerboard, no white/gray/black background or scenery. No text, words, numbers, logo lettering, panel, border frame, floor, shadow, gradients, glow haze, 3D, blur or fine details. Use case: stylized-concept. Asset type: transparent pixel-art game inventory icon.

## Validation

- `npm run typecheck`
- `npm run swap:smoke` covers net-tax quotes and quantities 1, 10, 15 and 80.
- `tests/frontend/garden-items.spec.ts` covers all 12 cards, artwork, categories,
  large values, late quotes, failures, retries and payment-mode changes.
- Existing care-catalog tests cover popup selection and quantity controls.

Browser fixtures submit no transactions. A live purchase of a new item can only
be checked after its creation onchain.
