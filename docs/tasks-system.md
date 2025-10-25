# Pixotchi Tasks & Rock Economy

This note documents how daily tasks (“Farmer’s Tasks”) and the Rock currency are wired through the codebase. It covers data storage, task progression, Rock accrual, and the admin dashboards used to monitor/reset activity.

---

## High-level flow

1. **Redis-backed persistence** lives in `lib/gamification-service.ts`. Keys under the prefix `pixotchi:gm:*` store:
   - Daily mission state per address/day (`missions`)
   - Streak metadata per address (`streak`)
   - Monthly leaderboards for both streaks and mission points
   - Optional task proof blobs

2. **Public API routes** expose the service:
   - `GET|POST /api/gamification/missions` → read/update mission progress (aka Rock points)
   - `GET|POST /api/gamification/streak` → read/advance streak counters
   - `GET /api/gamification/leaderboards` → top 50 streak/mission addresses for the current month
   - `POST /api/gamification/admin/reset` → admin-only removal of cached data

3. **Front-end surfaces**
   - `/tabs/about-tab.tsx` fetches missions & streak to show 50 Rock daily progress and opens the “How tasks work” modal.
   - Many transactional components hit `POST /api/gamification/missions` when the user completes an action (buy item, attack, claim stake, etc.) to mark individual tasks.
   - `components/transactions/base-transaction.tsx` also pings the streak endpoint on success to keep the daily streak in sync.
   - Admin view (`app/admin/invite/page.tsx`, “Gamification” tab) reads leaderboards and offers reset buttons.

---

## Data model (`lib/gamification-types.ts`)

- `GmMissionDay`
  ```ts
  {
    date: 'YYYY-MM-DD',
    s1: { buy5, buyElementsCount, buyShield, claimProduction, done },
    s2: { applyResources, attackPlant, chatMessage, done },
    s3: { sendQuest, placeOrder, claimStake, done },
    pts: number,          // Rock (0..50)
    completedAt?: number // timestamp when 50 Rock achieved
  }
  ```
  Section 1 awards 20 Rock, section 2 awards 20 Rock, section 3 awards 10 Rock. When all sections marked done, `pts` caps at 50.

- `GmStreak`: `{ current, best, lastActive }` (tracking consecutive days of activity).

- `GmTaskId`: enumerates the nine tracked actions (buy 5 elements, buy shield, claim production, apply resources, attack, chat, send quest, place orders, claim stake).

---

## Mission progression (`markMissionTask`)

Located in `lib/gamification-service.ts`. Key steps when `POST /api/gamification/missions` is called:

1. Load today’s mission (creating a default record if absent).
2. Flip task-specific booleans depending on `taskId` (incrementing `buyElementsCount` for the “buy 5” requirement).
3. Call `awardPoints` to figure out if any sections were newly completed.
   - S1 done → +20 Rock
   - S2 done → +20 Rock
   - S3 done → +10 Rock
   - Points are capped at 50, and `completedAt` is stamped when the cap is reached.
4. Persist the mission JSON to Redis, optionally writing `proof` metadata (tx hash, etc.).
5. If points increased, increment the monthly leaderboard score via `ZINCRBY`.
6. Return the updated mission object.

The various UI components fire this endpoint after relevant on-chain transactions succeed (e.g. `components/transactions/bundle-buy-transaction.tsx`, `attack-transaction.tsx`, `staking-dialog.tsx`, `item-details-panel.tsx`, `warehouse-panel.tsx`).

### Rock balance

The Rock “balance” is simply `mission.pts`. When About tab or task modal fetch mission data, the UI renders `missionPts / 50` daily progress. No on-chain balance exists; all Rock is a Redis counter.

---

## Streak tracking (`trackDailyActivity`)

Triggered by `POST /api/gamification/streak` (usually from `SponsoredTransaction` or mission-completing flows). Takes these steps:

1. Fetch today’s streak record.
2. If already touched today, return.
3. Otherwise, check whether `lastActive` equals yesterday → if so, increment `current`, else reset to 1. Update `best` accordingly.
4. Save to Redis, add the address to the “today active” set, and update the monthly streak leaderboard.

`normalizeStreakIfMissed` ensures reading the streak resets `current` to zero whenever users miss a full day.

---

## Admin surface

- `app/admin/invite/page.tsx` includes a **Gamification** tab that:
  - Calls `GET /api/gamification/leaderboards` and shows the top 50 streak and mission addresses.
  - Offers buttons to call `POST /api/gamification/admin/reset` with scopes `streaks`, `missions`, or `all`. The reset route scans Redis keys and deletes relevant mission/streak entries, refreshing the scoreboard.

No dedicated admin UI displays individual Rock balances—just the leaderboard aggregate. Additional introspection would require querying Redis directly or adding new routes.

---

## Summary

- Rock is not on-chain; it’s the `pts` field in mission JSON stored in Redis.
- Task completion flows call `markMissionTask`, which updates the relevant boolean/ counter, awards Rock, and logs optional proof.
- Streaks are managed separately through `trackDailyActivity` with a simple consecutive-day logic.
- Front-end fetches mission & streak records for display (About tab, Tasks modal) and triggers POSTs from gameplay interactions.
- Admins can view monthly leaderboards and reset data but do not have a per-user Rock view beyond `missionTop` scores.

