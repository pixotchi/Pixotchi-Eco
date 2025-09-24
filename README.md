## Pixotchi Ecosystem App (Mini app compatible)

Pixotchi app is a lightweight, production‑ready Farcaster Mini App and web app on Base. It streamlines onboarding, minting, and managing onchain plants and lands, with smart wallet support, agent actions via Coinbase CDP Spend Permissions, robust chat, and reliability features.

<!-- Badges -->

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fmini.pixotchi.tech&label=live&up_message=online&down_message=offline&style=flat-square)](https://mini.pixotchi.tech)
[![Vercel](https://img.shields.io/badge/Hosted%20on-Vercel-000?logo=vercel&logoColor=white&style=flat-square)](https://vercel.com)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com/)
[![OnchainKit](https://img.shields.io/badge/Coinbase-OnchainKit-0000FF?logo=coinbase&logoColor=white&style=flat-square)](https://onchainkit.xyz)
[![Coinbase CDP](https://img.shields.io/badge/Coinbase-CDP-000?logo=coinbase&logoColor=white&style=flat-square)](https://docs.cdp.coinbase.com/)
[![Farcaster MiniApp](https://img.shields.io/badge/Farcaster-MiniApp-6f3aff?style=flat-square)](https://www.farcaster.xyz/)
[![Base Network](https://img.shields.io/badge/Base-Mainnet-0052FF?logo=coinbase&logoColor=white&style=flat-square)](https://www.base.org/)

### Highlights
- **Dual‑mode**: Runs as a Farcaster Mini App and as a standard web app.
- **Agent Mode (new)**: Coinbase CDP Smart Account uses Spend Permissions to mint on users’ behalf, with validation and UX built‑in.
- **Base‑native**: Viem for reads/writes; swap helper via Uniswap V2‑style router.
- **Rich UI/UX**: React 19 + Next.js 15 + Tailwind + Radix + custom components; tutorial, themes, accessibility.
- **Wallet/Auth**: Privy (embedded + EOA), Wagmi, OnchainKit MiniKit, smart wallet detection, optional paymaster.
- **Gamification (new)**: Daily missions, streaks, leaderboards, and admin reset tools.
- **Chat**: Public chat (anti‑spam) + AI assistant + Agent chat (ZEST mint flow), with admin moderation.
- **Reliability & Security**: Multi‑endpoint RPC, CSP, CORS, rate limits, audit logs.
- **Notifications**: Farcaster Mini App notifications for key events (e.g., mint success, plant care alerts) with Neynar delivery and admin tracking.

## Tech Stack
- **Framework**: Next.js 15, React 19, TypeScript
- **UI**: Tailwind CSS 4, Radix UI, Lucide icons
- **Web3**: Viem, Wagmi, Coinbase OnchainKit, Coinbase CDP SDK
- **AI**: Vercel AI SDK, `@ai-sdk/openai` (OpenAI), optional Anthropic/Claude
- **Data**: Redis/KV (Upstash compatible) for invites, chat, usage, audit logs
- **Mini App**: `@farcaster/miniapp-sdk` with manifest and notifications (Neynar v2 delivery)
- **Scheduler**: Upstash QStash (HTTP cron) to trigger backend checks

## Project Structure
Key directories and files:
- `app/`: Next.js routes (pages + API)
  - `app/.well-known/farcaster.json/route.ts`: Farcaster Mini App manifest (icon/hero/splash, embeds, webhook, association)
  - `app/admin/*`: Admin dashboard (invites, chat moderation, AI moderation, gamification)
  - `app/api/*`: Server routes for chat, AI, agent, invites, staking, swap, notify, webhook, gamification, notifications cron/admin
- `components/`: UI, transactions, chat, tutorial, dialogs, loaders, theme
- `hooks/`: UX and platform hooks (Farcaster, keyboard, countdown, auto‑connect)
- `lib/`: Core logic (contracts, env, AI, invites, gamification, redis, logger, wallet contexts)
- `public/`: Static assets (icons, fonts, ABIs, images)
- `middleware.ts`: Global CORS, CSP, and security headers

## Features
### Onchain interactions (Base)
- Resilient Viem transports with multi‑RPC fallback and exponential backoff.
- Addresses and helpers in `lib/contracts.ts`:
  - `PIXOTCHI_NFT_ADDRESS`, `PIXOTCHI_TOKEN_ADDRESS` (SEED), `LEAF`, `STAKE`, `UNISWAP_ROUTER_ADDRESS`
- Helpers for: minting, approvals, staking, shop/garden items, lands/buildings, swaps, activity.

### Agent Mode (Spend Permissions)
- Coinbase CDP Smart Account acts on behalf of users with Spend Permissions.
- Primary flow: Agent can mint the ZEST strain (id 4) at 10 SEED per plant (max 5 per call).
- Endpoints under `/api/agent/*`:
  - Wallet bootstrap: `GET|POST /api/agent/wallet`
  - Config: `GET /api/agent/config`, `GET /api/agent/config/suggest-allowance`
  - Permissions: `GET /api/agent/permission/summary?address=0x..`, `POST /api/agent/permission/validate`
  - Mint: `POST /api/agent/mint` (approve + mint + transfer)
  - Agent chat: `POST /api/agent/chat` (tool‑calling with estimate/confirm steps)
  - Conversation test: `POST /api/agent/test-conversation`
- Client UI: `components/chat/AgentPermissionsPanel.tsx` to view/grant allowances and spender.

### Invite system
- Generate/validate/use codes with daily caps, expiration, self‑invite guard, and user validation.
- Admin dashboard to list/stats/generate/cleanup, with audit logs.

### Chat (public)
- Redis‑backed storage, per‑address rate limits, duplicate detection.
- Admin moderation: list, delete (single/all), and usage stats.

### AI chat
- Provider‑switchable via env; validated model list; retry + timeouts; usage and cost tracking.
- Conversations with history and titles; admin: list, fetch messages, delete; usage metrics.

### Gamification (new)
- Daily missions and streak tracking with points; monthly leaderboards.
- Admin reset endpoints for streaks/missions/all; dashboard tab shows leaders.

### Staking, Marketplace, Buildings
- SEED staking (approve/stake/claim), marketplace dialog (create/take orders with quotes),
  and land buildings (upgrade with LEAF, speed‑up with SEED, production claims, quests).

### Farcaster Mini App integration
- Manifest exposes rich metadata and embed allowlist; `fc:miniapp` and legacy `fc:frame` metadata are set in `app/layout.tsx`.
- Notifications: `/api/notify` sends per‑user Mini App notifications; webhook `/api/webhook` saves/removes tokens. Delivery is Neynar‑managed via the manifest `webhookUrl` and uses Neynar v2 publish APIs.

## Reliability & Security
### RPC strategy
- Central `lib/env-config.ts#getRpcConfig()` builds a resilient fallback transport across multiple RPCs.

### Rate limiting and spam control
- Public + AI chat rate‑limited; duplicate detection; admin cleanups.

### CORS & CSP
- `middleware.ts` sets dynamic CORS for public APIs, strict admin origin allowlist, global OPTIONS handler.
- CSP permits required hosts for scripts/styles/connect/frames; additional security headers included.

### Data durability & observability
- Redis helpers with JSON safety and key prefixing; non‑blocking connectivity check.
- Structured logger; admin audit logs with TTL and rolling history.
 - Admin Notifications dashboard summarizes send history, recent batches, eligible users, and last cron runs.
 - Backend cron uses public Base RPC for reads to isolate from app RPCs.

## APIs
All routes are under `/api/*`.

### Invite
- `POST /api/invite/generate` – generate code
- `POST /api/invite/validate` – validate code
- `POST /api/invite/use` – consume code and mark user validated
- `GET|POST /api/invite/stats` – user stats
- `POST /api/invite/user-codes` – list codes created by a user
- Admin (Bearer `ADMIN_INVITE_KEY`, allowed origin):
  - `GET /api/invite/admin/stats`
  - `GET /api/invite/admin/list`
  - `POST /api/invite/admin/generate`
  - `POST /api/invite/admin/cleanup`

### Chat (public)
- `GET /api/chat/messages?limit=50`
- `POST /api/chat/send`
- Admin: `GET /api/chat/admin/messages`, `DELETE /api/chat/admin/delete`

### AI chat
- `GET /api/chat/ai/messages?address=0x..[&conversationId=..][&limit=50]`
- `POST /api/chat/ai/send`
- Admin: `GET /api/chat/ai/admin/conversations?includeStats=true`,
  `GET /api/chat/ai/admin/messages?conversationId=..[&limit=100]`,
  `DELETE /api/chat/ai/admin/conversations?conversationId=..`

### Agent (Spend Permissions)
- `GET|POST /api/agent/wallet` – ensure agent SA exists
- `GET /api/agent/config` – agent flags + defaults
- `GET /api/agent/config/suggest-allowance?mintsPerDay=10&strainId=4`
- `GET /api/agent/permission/summary?address=0x..` – list permissions to agent
- `POST /api/agent/permission/validate` – check allowance/time‑window
- `POST /api/agent/mint` – approve + mint + transfer
- `POST /api/agent/chat` – tool‑calling agent (estimate → confirm → execute)
- `POST /api/agent/test-conversation` – smoke test flow

### Gamification
- `GET /api/gamification/leaderboards`
- `GET|POST /api/gamification/missions`
- `GET|POST /api/gamification/streak`
- Admin: `POST /api/gamification/admin/reset` (scope: `streaks|missions|all`)

### Staking
- `GET /api/staking/balance?address=0x..`
- `GET /api/staking/info?address=0x..`

### Swap
- `POST /api/swap` with `{ action: 'quote'|'execute', ethAmount, userAddress }`

### Notifications & Webhooks
- `POST /api/notify` – send per‑user notification (mint, custom types), with global/type metrics
- `POST /api/webhook` – Farcaster Mini App events (token add/remove) with signature verification (MiniApp JSON signature; HMAC fallback)
- `GET|POST /api/notifications/cron/plant-care` – checks wallets for plants under 1h and sends batched alerts (QStash/Vercel cron hits this)
- Admin: `GET /api/admin/notifications` (stats), `DELETE /api/admin/notifications/reset?scope=all|fid|plant[&fid=..][&plantId=..]`

### Farcaster Manifest
- `GET /.well-known/farcaster.json`

## Environment Configuration
Centralized in `lib/env-config.ts` and specific routes.


## Development
Prerequisites: Node.js 18+, npm/pnpm, and a Redis provider for full functionality.

1) Install dependencies
2) Create `.env.local` (minimal: Base RPCs + Redis + ADMIN_INVITE_KEY). Add CDP + Privy keys to enable Agent Mode and embedded wallets.
3) Start the dev server

```bash
npm run dev   # start Next.js dev server
npm run build # production build
npm run start # start production build
npm run lint  # eslint
```

## Admin Dashboard
- Path: `/admin/invite`
- Auth: Bearer key (`ADMIN_INVITE_KEY`) entered in the UI
- Tabs: Overview, Codes, Users, Chat moderation, AI Chat moderation, Cleanup, Gamification (leaderboards + resets)

## Agent Quickstart
1) Set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (server) and optionally `NEXT_PUBLIC_CDP_CLIENT_API_KEY` (client visuals).
2) Start the app, open Chat → Agent mode. Use the Spend Permission panel to grant allowance to the agent’s Smart Account for SEED.
3) Ask the agent to “mint 1 ZEST” → it gives an estimate (10 SEED) → confirm → it executes via `/api/agent/mint` and transfers to your wallet.
4) Troubleshoot with:
   - `GET /api/agent/permission/summary?address=0x..`
   - `POST /api/agent/permission/validate`
   - `POST /api/agent/test-conversation`

## Configuration Notes
- Strict CSP/security headers live in `middleware.ts`. If embedding new iframes/RPC domains, update CSP and CORS accordingly.
- Prefer private Base RPCs with multiple endpoints for automatic failover.
- If using the paymaster, ensure `NEXT_PUBLIC_CDP_*` are set; the app runs without it if omitted.

## Known Limitations
- Agent Mode currently supports minting the ZEST strain only (id 4, 10 SEED each, up to 5 at once).
- Destructive admin operations (e.g., “delete everything”) are gated by confirmations but should only be used in secure environments.
- Public API uses dynamic CORS with origin echo; rate limits and server‑side validation still apply.
 - Automatic plant‑care alerts require an external scheduler (e.g., QStash or Vercel Cron) calling `/api/notifications/cron/plant-care`.

## License
Licensed under the MIT License. See the `LICENSE` file at the project root for details.

---

**Built with ❤️ for the Pixotchi community**
