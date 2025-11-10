<p align="center">
  <img src="https://mini.pixotchi.tech/ecologo.png" alt="Pixotchi Logo" width="180">
</p>

## Pixotchi Ecosystem

Pixotchi is a P2E onchain game. Grow a playful onchain garden on Base. Mint and care for NFT plants and lands, complete daily missions, climb leaderboards, chat with the community, and earn in‑game rewards. Runs on the web and as a Farcaster/Base Mini App.

<!-- Badges -->

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fmini.pixotchi.tech&label=live&up_message=online&down_message=offline&style=flat-square)](https://mini.pixotchi.tech)
[![Vercel](https://img.shields.io/badge/Hosted%20on-Vercel-000?logo=vercel&logoColor=white&style=flat-square)](https://vercel.com)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com/)
[![OnchainKit](https://img.shields.io/badge/Coinbase-OnchainKit-0000FF?logo=coinbase&logoColor=white&style=flat-square)](https://onchainkit.xyz)
[![Coinbase CDP](https://img.shields.io/badge/Coinbase-CDP-000?logo=coinbase&logoColor=white&style=flat-square)](https://docs.cdp.coinbase.com/)
[![Farcaster MiniApp](https://img.shields.io/badge/Farcaster-MiniApp-6f3aff?style=flat-square)](https://www.farcaster.xyz/)
[![Base Network](https://img.shields.io/badge/Base-Mainnet-0052FF?logo=coinbase&logoColor=white&style=flat-square)](https://www.base.org/)

## What is Pixotchi?
- **Grow & earn**: Grow your garden and compete for ETH rewards.
- **Compete**: Daily missions and monthly leaderboards reward consistency.
- **SEED token**: Used for minting, upgrades, and staking.
- **Social by default**: Public chat and a friendly community.
- **Mobile‑first**: Designed for phones; works great inside Farcaster.
- **Wallet‑friendly**: Supports EOAs, embedded wallets, and smart accounts.
- **Notifications**: Get reminders when your plants need attention.
- **AI integrated**: Get assistance from Neural Seed on learning the gameplay and for questions.
- **Agent mode**: Executes approved actions via delegated permissions.

## Why open source?
Pixotchi is maintained by our team and open‑sourced for transparency and long‑term credibility.

## Try it
- **Play now**: [mini.pixotchi.tech](https://mini.pixotchi.tech)
- **Farcaster/Base App**: Available as a Mini App. (Search Pixotchi Mini in Apps)

## Integrations
- **Base** – Layer 2 network where Pixotchi runs.
- **Paymaster** - Gas sponsorship compatibility
- **Farcaster Mini App** – Native, mobile‑friendly in‑app experience.
- **Coinbase OnchainKit & CDP** – Wallets, AI Agents and smart account capabilities.
- **EFP** – Onchain Social Graph by Ethereum Follow Protocol.
- **Memory Protocol** – Onchain Social Identities Graph.
- **Neynar** - Notifications infra

## Smart contracts (Base Mainnet)
- Plant (ERC‑721): 0xeb4e16c804ae9275a655abbc20cd0658a91f9235
- Land (ERC‑721): 0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c
- SEED (ERC‑20): 0x546D239032b24eCEEE0cb05c92FC39090846adc7
- LEAF (ERC‑20): 0xE78ee52349D7b031E2A6633E07c037C3147DB116
- Staking: 0xF15D93c3617525054aF05338CC6Ccf18886BD03A
- LP (BaseSwap): 0xAA6a81A7df94DAb346e2d677225caD47220540C5

## How it works (at a glance)
1. Connect a wallet (or use an embedded wallet).  
2. Mint your first plant/land with SEED.  
3. Check in daily to grow your plants, upgrade buildings, and complete missions.  
4. Chat, trade, stake SEED, and compete for ETH rewards as you climb the leaderboard.  

Built on Base and designed to be fast, simple, and fun.

## Getting started (local)
**Prerequisites**: Node.js 18+ and npm or pnpm. Redis (or a Redis‑compatible service) is recommended for chat and persistence.

```bash
npm install
npm run dev
```

Create an `.env.local` with the basics:
- Base RPC endpoint(s)
- Redis URL (if using chat and persistence locally)
- Admin key for the dashboard (for admin features)
- Credentials for embedded wallets or the automation agent (if enabled)

Common scripts:
```bash
npm run build   # production build
npm run start   # start production server (after build)
npm run lint    # run ESLint
```

## Who is this for?
- **Players** who enjoy a cozy, streak‑based onchain game.  
- **Farcaster/Base app users** who want a native, mobile‑friendly Mini App experience.  
- **Builders** who want to explore or extend a production‑ready Next.js/React onchain game.

## For developers (lightweight)
Pixotchi uses Next.js + React with Tailwind, and integrates wallets and Base L2. The codebase is organized in `app/`, `components/`, and `lib/`. You can explore features like chat, staking, swapping, missions, and notifications directly in the repository.

## Contributing
Issues and pull requests are welcome. Please keep discussions constructive and respectful. If you encounter a security concern, avoid sharing sensitive details publicly and submit a minimal report via issues so we can follow up.

## License
MIT License. See `LICENSE` at the project root.

---

Built with ❤️ for the Pixotchi community
