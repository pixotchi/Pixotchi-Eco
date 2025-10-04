## Pixotchi Ecosystem App

Production-ready, Farcaster client compatible and web application deployed on Base Network. Provides onchain asset management for NFT-based plants and lands with smart wallet support, autonomous agent actions via Coinbase CDP Spend Permissions, real-time chat infrastructure, and comprehensive reliability features.

<!-- Badges -->

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fmini.pixotchi.tech&label=live&up_message=online&down_message=offline&style=flat-square)](https://mini.pixotchi.tech)
[![Vercel](https://img.shields.io/badge/Hosted%20on-Vercel-000?logo=vercel&logoColor=white&style=flat-square)](https://vercel.com)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com/)
[![OnchainKit](https://img.shields.io/badge/Coinbase-OnchainKit-0000FF?logo=coinbase&logoColor=white&style=flat-square)](https://onchainkit.xyz)
[![Coinbase CDP](https://img.shields.io/badge/Coinbase-CDP-000?logo=coinbase&logoColor=white&style=flat-square)](https://docs.cdp.coinbase.com/)
[![Farcaster MiniApp](https://img.shields.io/badge/Farcaster-MiniApp-6f3aff?style=flat-square)](https://www.farcaster.xyz/)
[![Base Network](https://img.shields.io/badge/Base-Mainnet-0052FF?logo=coinbase&logoColor=white&style=flat-square)](https://www.base.org/)

## Architecture Overview
- **Platform**: Dual-deployment architecture supporting Farcaster Mini App and standalone web application.
- **Agent System**: Coinbase CDP Smart Account implementation with Spend Permissions for delegated transaction execution and comprehensive permission validation.
- **Blockchain Integration**: Viem-based transaction layer with Uniswap V2-compatible swap routing on Base Network.
- **Frontend Stack**: React 19 with Next.js 15 App Router, Tailwind CSS 4, Radix UI primitives, WCAG 2.1 accessibility compliance.
- **Authentication**: Multi-provider wallet support (Privy embedded wallets, EOA, Farcaster embedded), Wagmi hooks, OnchainKit MiniKit integration, ERC-4337 smart wallet detection, optional paymaster sponsorship.
- **Gamification Engine**: Daily mission tracking, streak persistence, monthly leaderboard aggregation with admin reset capabilities.
- **Communication Infrastructure**: Redis-backed public chat with rate limiting and spam detection, OpenAI-powered AI assistant, Agent mode with tool-calling capabilities, administrative moderation interface.
- **Security Architecture**: Multi-endpoint RPC failover, Content Security Policy enforcement, CORS with origin validation, IP-based rate limiting with timing-attack mitigation, structured audit logging.
- **Notification System**: Farcaster Mini App push notifications via Neynar v2 API for transaction confirmations and time-sensitive alerts.

## Tech Stack
- **Framework**: Next.js 15, React 19, TypeScript
- **UI**: Tailwind CSS 4, Radix UI, Lucide and custom icons
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

## Core Features
### Blockchain Transaction Layer
- Resilient Viem transport configuration with multi-endpoint RPC fallback and exponential backoff retry logic.
- Contract interface abstractions in `lib/contracts.ts`:
  - `PIXOTCHI_NFT_ADDRESS` (ERC-721), `PIXOTCHI_TOKEN_ADDRESS` (SEED ERC-20), `LEAF` (ERC-20), `STAKE` (staking contract), `UNISWAP_ROUTER_ADDRESS` (AMM integration)
- Transaction helpers: NFT minting, token approvals, staking operations, marketplace item purchases, land/building management, token swaps, activity logging.

### Autonomous Agent System (CDP Spend Permissions)
- Coinbase CDP Smart Account with ERC-7715 Spend Permission delegation for autonomous transaction execution.
- Supported operations: ZEST strain minting (strain ID 4, 10 SEED per NFT, maximum 5 NFTs per transaction).
- API surface `/api/agent/*`:
  - `GET|POST /api/agent/wallet` – Smart Account initialization and wallet bootstrap
  - `GET /api/agent/config` – Agent configuration and operational parameters
  - `GET /api/agent/config/suggest-allowance` – Permission allowance calculation
  - `GET /api/agent/permission/summary?address=0x..` – Permission enumeration and status
  - `POST /api/agent/permission/validate` – Pre-execution permission validation
  - `POST /api/agent/mint` – Atomic approve-mint-transfer transaction sequence
  - `POST /api/agent/chat` – LLM-driven tool-calling interface with estimation and confirmation flow
  - `POST /api/agent/test-conversation` – Integration testing endpoint
- Client implementation: `components/chat/AgentPermissionsPanel.tsx` for permission management interface.

### Access Control System
- Invite code generation and validation with daily issuance caps, expiration enforcement, self-invite prevention, and user validation pipeline.
- Administrative interface for code lifecycle management, statistical analysis, bulk generation, cleanup operations, and audit trail persistence.

### Public Chat Infrastructure
- Redis-backed message persistence with per-address rate limiting and duplicate message detection.
- Administrative moderation dashboard with message listing, selective/bulk deletion, and usage analytics.

### AI Assistant
- Multi-provider architecture (OpenAI/Anthropic) with runtime model selection, automatic retry with exponential backoff, request timeout enforcement, and usage/cost tracking.
- Conversation management with persistent history, automatic title generation, administrative list/fetch/delete operations, and aggregated usage metrics.

### Gamification System
- Daily mission completion tracking with point attribution, consecutive day streak persistence, and monthly leaderboard aggregation.
- Administrative reset endpoints with granular scope (streaks/missions/all) and real-time leaderboard visualization dashboard.

### DeFi Features
- SEED token staking with approve-stake-claim workflow, marketplace order creation and fulfillment with dynamic price quotes, land building upgrades (LEAF cost), production acceleration (SEED cost), yield claiming, and quest progression.

### Farcaster Platform Integration
- Manifest at `/.well-known/farcaster.json` with metadata, embed URL allowlist, and webhook configuration. OpenGraph and `fc:miniapp`/`fc:frame` metadata in `app/layout.tsx`.
- Push notification delivery via `/api/notify` endpoint; token lifecycle management via `/api/webhook` with signature verification (Farcaster JSON signatures and HMAC fallback). Delivery orchestrated through Neynar v2 API.

## Security & Reliability
### RPC Resilience
- Centralized RPC configuration in `lib/env-config.ts#getRpcConfig()` with multi-endpoint fallback transport, automatic endpoint rotation, and exponential backoff on failures.

### Rate Limiting & Abuse Prevention
- Per-address rate limiting on public and AI chat endpoints with Redis-backed token buckets and duplicate message detection.
- Administrative endpoint protection: IP-based rate limiting (10 attempts per 15-minute window) with constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

### CORS & Content Security Policy
- Dynamic CORS configuration in `middleware.ts` with origin-specific policies for public APIs and strict admin endpoint allowlist. Global OPTIONS handler for preflight requests.
- Content Security Policy with explicit host allowlisting for scripts, styles, connect sources, and frame ancestors. Additional security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy.

### Data Layer & Observability
- Redis client with JSON serialization safety, key namespace prefixing, and non-blocking connectivity validation.
- Structured logging infrastructure with request correlation IDs, administrative audit logs with Time-To-Live expiration, and rolling history retention.
- Notification dashboard aggregates delivery metrics, batch history, eligible user counts, and scheduled cron execution timestamps.
- Backend scheduled tasks use dedicated public Base RPC endpoints to isolate from application RPC pools.

## APIs
All routes are under `/api/*`.

### Invite
- `POST /api/invite/generate` – Generate invite code with expiration and usage limits
- `POST /api/invite/validate` – Validate invite code without consumption
- `POST /api/invite/use` – Consume invite code and mark user as validated
- `GET|POST /api/invite/stats` – Retrieve user statistics and invite history
- `POST /api/invite/user-codes` – List invite codes created by specific user
- Admin (Bearer `ADMIN_INVITE_KEY`, allowed origin):
  - `GET /api/invite/admin/stats` – Global invite system statistics
  - `GET /api/invite/admin/list` – List all invite codes with filters
  - `POST /api/invite/admin/generate` – Administrative bulk code generation
  - `POST /api/invite/admin/cleanup` – Cleanup expired or invalid codes

### Chat (Public)
- `GET /api/chat/messages?limit=50` – Retrieve recent public chat messages
- `POST /api/chat/send` – Send message to public chat with rate limiting
- Admin:
  - `GET /api/chat/admin/messages` – List all messages with metadata
  - `DELETE /api/chat/admin/delete` – Delete specific or all messages

### AI Chat
- `GET /api/chat/ai/messages?address=0x..[&conversationId=..][&limit=50]` – Retrieve conversation messages for address
- `POST /api/chat/ai/send` – Send message to AI assistant with context
- Admin:
  - `GET /api/chat/ai/admin/conversations?includeStats=true` – List all conversations with usage statistics
  - `GET /api/chat/ai/admin/messages?conversationId=..[&limit=100]` – Retrieve messages from specific conversation
  - `DELETE /api/chat/ai/admin/conversations?conversationId=..` – Delete conversation and associated messages

### Agent (Spend Permissions)
- `GET|POST /api/agent/wallet` – Initialize or retrieve agent Smart Account wallet
- `GET /api/agent/config` – Retrieve agent configuration and operational parameters
- `GET /api/agent/config/suggest-allowance?mintsPerDay=10&strainId=4` – Calculate suggested allowance for permission grant
- `GET /api/agent/permission/summary?address=0x..` – Enumerate all permissions granted to agent by address
- `POST /api/agent/permission/validate` – Validate permission allowance and time window constraints
- `POST /api/agent/mint` – Execute atomic approve-mint-transfer transaction sequence
- `POST /api/agent/chat` – LLM-driven conversation interface with tool-calling (estimate, confirm, execute)
- `POST /api/agent/test-conversation` – End-to-end integration test for agent workflow

### Gamification
- `GET|POST /api/gamification/missions` – Retrieve or update daily mission progress
- `GET|POST /api/gamification/streak` – Retrieve or update consecutive day streak
- Admin (Bearer `ADMIN_INVITE_KEY`, allowed origin):
  - `GET /api/gamification/leaderboards` – Retrieve monthly leaderboard rankings
  - `POST /api/gamification/admin/reset` – Reset user data (scope: `streaks|missions|all`)

### Staking
- `GET /api/staking/balance?address=0x..` – Retrieve staked SEED token balance
- `GET /api/staking/info?address=0x..` – Retrieve staking position details and rewards

### Swap
- `POST /api/swap` – Execute token swap or retrieve quote (`{ action: 'quote'|'execute', ethAmount, userAddress }`)

### Notifications & Webhooks
- `POST /api/notify` – Send per-user Farcaster Mini App notification with type-specific metrics
- `POST /api/webhook` – Process Farcaster Mini App webhook events (token add/remove) with signature verification
- `GET|POST /api/notifications/cron/plant-care` – Scheduled task to check plant health and send batch alerts (invoked by QStash/Vercel Cron)
- Admin:
  - `GET /api/admin/notifications` – Retrieve notification delivery statistics
  - `DELETE /api/admin/notifications/reset?scope=all|fid|plant[&fid=..][&plantId=..]` – Reset notification tracking data

### Farcaster Manifest
- `GET /.well-known/farcaster.json` – Serve Farcaster Mini App manifest (metadata, icons, webhooks)

## Environment Configuration
Centralized in `lib/env-config.ts` and specific routes.


## Development Setup
**Prerequisites**: Node.js 18+, npm or pnpm, Redis-compatible database (Upstash recommended).

### Installation
```bash
npm install
```

### Environment Configuration
Create `.env.local` with required variables:
- Base Network RPC endpoints
- Redis connection URL
- `ADMIN_INVITE_KEY` for administrative access
- Optional: CDP credentials (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`) for Agent Mode
- Optional: Privy credentials for embedded wallet support

### Available Commands
```bash
npm run dev    # Start Next.js development server with hot reload
npm run build  # Generate production build with optimization
npm run start  # Start production server (requires build)
npm run lint   # Run ESLint static analysis
```

## Admin Dashboard
- Path: `/admin/invite`
- Auth: Bearer key (`ADMIN_INVITE_KEY`) with constant-time comparison, IP-based rate limiting (10 attempts/15min)
- Tabs: Overview, Codes, Users, Chat moderation, AI Chat moderation, Cleanup, Gamification (leaderboards + resets), RPC Status, Notifications
- Architecture: Request cancellation via AbortController, fail-closed rate limiting on Redis unavailability, structured error handling with detailed logging

## Agent Mode Integration
### Configuration
1. Configure environment variables:
   - Server-side: `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
   - Client-side (optional): `NEXT_PUBLIC_CDP_CLIENT_API_KEY` for UI integration
2. Start application and navigate to Chat interface, enable Agent mode.
3. Grant Spend Permission through the permission management panel, authorizing the agent's Smart Account to spend SEED tokens.

### Operation
4. Initiate minting request through natural language interface (e.g., "mint 1 ZEST").
5. System provides cost estimation (10 SEED per NFT).
6. Upon user confirmation, agent executes transaction sequence via `/api/agent/mint` endpoint and transfers NFT to user wallet.

### Diagnostics
Troubleshooting endpoints:
- `GET /api/agent/permission/summary?address=0x..` – Permission status verification
- `POST /api/agent/permission/validate` – Pre-execution validation
- `POST /api/agent/test-conversation` – End-to-end integration test

## Configuration Notes
- Strict CSP/security headers live in `middleware.ts`. If embedding new iframes/RPC domains, update CSP and CORS accordingly.
- Prefer private Base RPCs with multiple endpoints for automatic failover.
- If using the paymaster, ensure `NEXT_PUBLIC_CDP_*` are set; the app runs without it if omitted.



## License
Licensed under the MIT License. See the `LICENSE` file at the project root for complete terms and conditions.

---

**Built with ❤️ for the Pixotchi community**