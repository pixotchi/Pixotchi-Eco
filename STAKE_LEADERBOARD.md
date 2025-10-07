# Stake Leaderboard Feature

## Overview
The Stake Leaderboard ranks wallet addresses by their staked SEED amount. This feature provides users with insight into who has the most skin in the game.

## Key Features
- **4-Hour Caching**: Leaderboard data is cached for 4 hours to minimize RPC calls and improve performance
- **Smart Address Discovery**: Automatically discovers active users from the user stats cache
- **Batch Processing**: Fetches stake info in batches of 50 to avoid overwhelming RPC endpoints
- **User Highlighting**: Current user's address is highlighted in the leaderboard
- **Pagination**: Shows 12 entries per page for easy browsing
- **Top 3 Icons**: Special icons for 1st (gold), 2nd (silver), and 3rd (bronze) places

## Architecture

### Backend Service (`lib/stake-leaderboard-service.ts`)
- `getActiveUserAddresses()`: Discovers user addresses from Redis cache
- `buildStakeLeaderboard()`: Fetches and ranks all stakers
- `getStakeLeaderboard()`: Returns cached leaderboard or builds fresh one
- `refreshStakeLeaderboard()`: Forces a rebuild of the leaderboard

### API Route (`app/api/leaderboard/stake/route.ts`)
- **Endpoint**: `GET /api/leaderboard/stake`
- **Returns**: JSON with leaderboard entries, total stakers, and cache duration

### Frontend (`components/tabs/leaderboard-tab.tsx`)
- Added third toggle option: Plants | Lands | **Stake**
- Displays wallet addresses in truncated format (0x1234...5678)
- Shows staked amount with COIN.svg icon
- Highlights current user's entry
- Supports pagination for long lists

## Data Flow
1. User selects "Stake" tab
2. Component fetches from `/api/leaderboard/stake`
3. API checks Redis cache for existing leaderboard
4. If cache miss (or >4 hours old):
   - Discover active user addresses from stats cache
   - Fetch stake info for all addresses in batches
   - Sort by staked amount (highest first)
   - Cache result for 4 hours
5. Return leaderboard to client
6. Display ranked list with pagination

## Performance Considerations
- **Cache Duration**: 4 hours significantly reduces RPC load
- **Batch Size**: 50 addresses per batch prevents RPC throttling
- **Address Discovery**: Uses existing user stats cache (no additional blockchain calls)
- **Minimal Storage**: Only caches final leaderboard, not individual stake info

## Future Enhancements
- ENS resolution for top 10 addresses
- Historical ranking tracking
- Reward distribution to top stakers
- Filter by stake amount ranges
- Export leaderboard data

