<p align="center">
  <img src="https://mini.pixotchi.tech/ecologo.png" alt="Pixotchi Logo" width="180">
</p>

## Pixotchi Ecosystem

Pixotchi is a P2E onchain game. Grow a playful onchain garden on Base. Mint and care for NFT plants and lands, complete daily missions, climb leaderboards, chat with the community, and earn in‑game rewards. Runs on the web and as a Farcaster/Base Mini App.

<!-- Badges -->

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fmini.pixotchi.tech&label=live&up_message=online&down_message=offline&style=flat-square)](https://status.pixotchi.tech)
[![Vercel](https://img.shields.io/badge/Hosted%20on-Vercel-000?logo=vercel&logoColor=white&style=flat-square)](https://vercel.com)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com/)
[![Coinbase CDP](https://img.shields.io/badge/Coinbase-CDP-000?logo=coinbase&logoColor=white&style=flat-square)](https://docs.cdp.coinbase.com/)
[![Farcaster MiniApp](https://img.shields.io/badge/Farcaster-MiniApp-6f3aff?style=flat-square)](https://www.farcaster.xyz/)
[![Base Network](https://img.shields.io/badge/Base-Mainnet-0052FF?logo=coinbase&logoColor=white&style=flat-square)](https://www.base.org/)

## What is Pixotchi?
- **Grow & earn**: Grow your garden and compete for ETH rewards.
- **Compete**: Daily missions and monthly leaderboards reward consistency.
- **SEED token**: Used for minting, upgrades, and staking.
- **Social by default**: Public chat and a friendly community.
- **Mobile‑first**: Designed for phones; works great inside Farcaster.
- **Wallet‑friendly**: Supports EOAs, Privy embedded wallets, and Coinbase smart accounts.
- **Notifications**: Get reminders when your plants need attention.
- **AI integrated**: Neural Seed assistant powered by OpenAI, Anthropic, Google AI, or Vercel AI Gateway.
- **Read-only AI**: Explains gameplay and reads Pixotchi context, but does not sign transactions or execute wallet actions.

## Why open source?
Pixotchi is maintained by our team and open‑sourced for transparency and long‑term credibility.

## Try it
- **Play now**: [mini.pixotchi.tech](https://mini.pixotchi.tech)
- **Farcaster/Base App**: Available as a Mini App. (Search Pixotchi Mini in Apps)

## Integrations
- **Base** – Layer 2 network where Pixotchi runs.
- **Paymaster** – Gas sponsorship compatibility.
- **Farcaster Mini App** – Native, mobile‑friendly in‑app experience.
- **Base Account / Coinbase Wallet** – Wallet connection through Wagmi and Privy-compatible connectors.
- **Coinbase CDP** – Service-side claim/airdrop automation and optional paymaster configuration.
- **Privy** – Embedded wallet authentication and social login.
- **EFP** – Onchain Social Graph by Ethereum Follow Protocol.
- **Base App** – Notification delivery and enabled-wallet audience sync.
- **Solana Bridge** – Experimental adapter-dependent Solana-to-Base flows; some EVM-only features remain unavailable from Solana wallets.

## Features
- **Minting** – Mint plants and lands with SEED or strain‑specific tokens.
- **Daily Missions** – Complete tasks to earn points and climb the leaderboard when the gamification season is enabled.
- **Spin & Box Games** – Mini‑games for bonus rewards and time extensions.
- **Staking & LP** – Stake SEED to earn LEAF rewards; SEED/ETH liquidity is tracked via BaseSwap.
- **Leaderboards** – Compete for top rankings and ETH prizes.
- **Shop & Upgrades** – Buy items to boost your plants and buildings.
- **Secret Garden** – Hidden arcade area with special activities.

## Smart contracts (Base Mainnet)
- Plant (ERC‑721): 0xeb4e16c804ae9275a655abbc20cd0658a91f9235
- Land (ERC‑721): 0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c
- SEED (ERC‑20): 0x546D239032b24eCEEE0cb05c92FC39090846adc7
- LEAF (ERC‑20): 0xE78ee52349D7b031E2A6633E07c037C3147DB116
- Staking: 0xF15D93c3617525054aF05338CC6Ccf18886BD03A
- LP (BaseSwap): 0xAA6a81A7df94DAb346e2d677225caD47220540C5

## How it works
1. Connect a wallet (Autoconnects if in Mini app).  
2. Mint your first plant or land with SEED (or strain‑specific tokens).  
3. Check in daily to grow your plants, upgrade buildings, and complete missions.  
4. Grow your farm, Chat, stake SEED, and compete for ETH rewards as you climb the leaderboard.  

Built on Base and designed to be fast, simple, and fun.

## Local development
1. Install dependencies: `npm install`
2. Copy the example environment: `cp .env.example .env.local`
3. Configure at least `NEXT_PUBLIC_URL`, Base RPC endpoints, one Redis/KV provider, and `ADMIN_INVITE_KEY`.
4. Add production-like integrations as needed: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_CDP_CLIENT_API_KEY`, notification provider keys, and AI provider keys.
5. Run locally: `npm run dev`
6. Verify before shipping: `npm run typecheck` and `npm run lint`

Production deployments fail fast unless the required public URL, at least one unique Base RPC endpoint, indexer config, CDP client key, and Privy client/server keys are present. RPC endpoints may come from any mix of vendors, including a single vendor.

## Configuration notes
- Feature flags control major surfaces: invites, gamification, casino/blackjack, barracks, swap module, Base Verify claims, and Solana support.
- Solana flows require `NEXT_PUBLIC_SOLANA_ENABLED=true` and a configured `NEXT_PUBLIC_SOLANA_TWIN_ADAPTER`.
- Notifications can use the Base App provider or Neynar; keep `NEXT_PUBLIC_NOTIFICATION_PROVIDER` and `NOTIFICATION_PROVIDER` in sync.
- Neural Seed is intentionally read-only. Set `AI_PROVIDER` plus the matching provider key for AI chat.

## Who is this for?
- **Players** who enjoy a cozy, streak‑based onchain game.  
- **Farcaster/Base app users** who want a native, mobile‑friendly Mini App experience.  
- **Builders** who want to explore a production‑ready Next.js/React onchain game.


## Contributing
Issues and pull requests are welcome. Please keep discussions constructive and respectful. If you encounter a security concern, avoid sharing sensitive details publicly and submit a minimal report via issues so we can follow up.

## License
MIT License. See `LICENSE` at the project root.

---

Built with ❤️ for the Pixotchi community
