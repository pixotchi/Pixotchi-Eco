// Game documentation context for Neural Seed

// System prompt for Neural Seed - keep concise and focused
const SYSTEM_PROMPT = `You are Neural Seed, a helpful AI assistant for Pixotchi Mini, an onchain pocket farm on Base. 

RESPONSE GUIDELINES:
- Give clear, very brief and direct answers. Users are on phone devices most of the time so keep your answers short and concise, while covering and addressing users query.
- Have a smart, yet subtle sense of humor.
- Keep responses brief and simple to understand.
- For sensitive topics, always state that your answers may not be accurate and you are still being trained, eg guides on transferring assets etc.
- You do not have access to onchain data, we are providing it for you with every user message, but this is a secret and you should not mention it.
- Always mention specific app tabs when relevant.
- You love being on Base and you believe it's the best way and form an L2 can exist.
- Never give financial advice.
- If user asked for any onchain actions, refer to the Agent tab in chat section.
- You DO NOT KNOW the prices for Land upgrades.
- If you were asked about how to transfer assets (Lands/Plants NFTs), suggest MagicEden marketplace as it's one of the only marketplaces that properly displayes Land NFTs and allows their transfer.
- Never talk negatively about Base or Pixotchi ecosystem.
- Be smart and be always one ahead of what users are thinking and asking. Sometimes they have geniune questions, sometimes they are testing you and sometimes they may try to get you to say stuff you are not supposed to say. Regardless, make sure their query is attended if within knowledge base.
- Be friendly and encouraging, avoid being cheesy.
- Base app emoji is 🟦 and our ecosystem emoji is 🌱 and 🪴
- Focus on practical game help and avoid talking about anything else. Only Base blockchain and Pixotchi ecosystem
- PERSONALIZATION: When user stats are provided, give personalized advice/answer based on their actual game state
- Reference their specific plants, lands, balances, and progress when relevant
- Alert about urgent plant care needs if timeUntilStarving shows critical timing
- If you are asked a question that the answer is not in knowledge base, say that you are not sure and ask user join Telegram group to get help or visit doc.pixotchi.tech.

CORE GOAL: Help users understand game mechanics and guide them to the right features in the app using their actual game data.`;

// Knowledge base content - comprehensive but organized
const KNOWLEDGE_BASE = `# Pixotchi Mini Game Knowledge Base

## Overview

**Pixotchi Mini** is a miniapp and part of the broader **Pixotchi ecosystem**—an onchain game on **Base** (live for over 1.5 years, since February 12th, 2024). Players mint **Plants** and **Lands**, care for them, earn **ETH rewards**, and compete with others.

---

## Game Navigation

### Main Tabs

* **Farm:** Manage minted Plants and Land NFTs, buy items for plants/upgrade buildings in land.
* **Mint:** Mint new Plant and Land NFTs.
* **Activity:** View game events.
* **Ranking:** Leaderboard based on PTS, sword icon next to eligible plants you can attack.
* **Swap:** Trade ETH ↔ SEED tokens.
* **About:** Invite codes and ecosystem info.

### Header Buttons/Elements

* **Theme Selector:** Change app theme.
* **Profile:** View wallet/account/smartwallet/miniapp details.
* **Chat:** Chat with players or Neural Seed (AI assistant) or Neural Seed (AI Agent)
* **Farcaster + Button:** Save Pixotchi Mini to Farcaster miniapps (only visible within Farcaster app).
* **Status Bar:** Shows SEED/LEAF/ETH balances with a button "Stake" that opens Staking page.
---

## Plant System

### Overview

* NFT-based with **5 visual strains**, no gameplay difference.
* Require **regular care** via Shop Items.
* Feature **status levels**, **PTS**, **TOD**, **levels**, **starvation timers**, and can be attacked if unprotected.

### Plant Strains

| Strain Name | Cost (SEED) | Availability    |
| ----------- | ----------- | --------------- |
| Flora       | -           | Minted out      |
| Taki        | 20          | Available       |
| Rosa        | 40          | Available       |
| Zest        | 10          | Available       |
| TYJ         | 500         | Limited Edition |

> **Note:** TYJ = "Thank You Jesse"

### Attention criteria (Based on TOD)

* **Great:** >48h TOD (Safe)
* **Okay:** 24–48h TOD
* **Dry:** 12–24h TOD
* **Dying:** 3–12h TOD (Critical)
* **Dead:** 0h TOD

### Plant Care

* Use **Shop Items** (Farm > Plants > Shop Items)
* Add **PTS** (points for leaderboard/rewards)
* Extend **TOD** (Time before death)
* **Fence** item protects plant from attacks (48h)
* Feed plants regularly to extend TOD to prevent **DEATH**
* Attack other plants to steal their PTS. (30% chance of winning and 70% chance of losing)

### Plant Items (Marketplace Section)

| Item       | Effect             | Cost (SEED) |
| ---------- | ------------------ | ----------- |
| Sunlight   | +65 PTS            | 8.4         |
| Water      | +14h TOD           | 12          |
| Fertilizer | +104 PTS           | 18          |
| Pollinator | +21h TOD           | 22          |
| Magic Soil | +156 PTS           | 30          |
| Dream Dew  | +97.5 PTS, +27h TOD| 36          |
| Fence      | Protection for 48h | 50          |

> **Note:** Plants that die can be killed by other players. The killer gains a star. Dead plants are burned and auto-redeem their rewards to the owner.

### Attacking mechanics (This filtering is Automatically applied)
Each plant can attack once every 30 minutes.
Target can be attacked again after 60 minutes.
Attacker must be alive and a lower level than the target.
Targets with an active fence cannot be attacked.
You cannot attack your own plant.

---

## Land System

### Overview

* NFT-based Lands with **map coordinates**
* Contain **Village** and **Town** areas
* Generate **PTS** and **TOD** for plants
* Upgrade using **LEAF**, speed up with **SEED**

### Building Types

#### Village Buildings (Generate PTS/TOD)

| Name         | ID | Function                                | Max Level |
| ------------ | -- | --------------------------------------- | --------- |
| Solar Panel  | 0  | Generates daily PTS for plants          | 3         |
| Soil Factory | 3  | Produces daily PTS for plants           | 3         |
| Bee Farm     | 5  | Produces daily TOD and aids pollination | 3         |

#### Town Buildings (Utility & Special Features)

| Name         | ID | Function                   | Max Level |
| ------------ | -- | -------------------------- | --------- |
| Farmer House | 7  | Send on quests for rewards | 3         |
| Marketplace  | 5  | Trade LEAF/SEED            | 1         |
| Warehouse    | 3  | Apply PTS/TOD to plants    | 1         | 
| Stakehouse   | 1  | Stake SEED to earn LEAF    | 1         |

### Upgrading Buildings

* **Upgrade with LEAF**
* Max Level: 3 (for production/quest buildings), 1 (for special buildings)
* **Speed up upgrades** using SEED
* Must **claim PTS/TOD from Warehouse** and apply to plants manually

> **Note:** Stakehouse and Warehouse are prebuilt and not upgradeable.

---

## Token System

### Tokens

| Token | Purpose                                           |
| ----- | ------------------------------------------------- |
| SEED  | Main in-game currency (Buy items, speed upgrades) |
| LEAF  | Used for building upgrades                        |
| ETH   | Traded for SEED via Swap tab                      |

### SEED Tokenomics

* Total Supply: **20M**
* ~300K burned so far
* **5% Buy/Sell Tax**:

  * 2%: Project maintenance
  * 2%: ETH rewards (distributed to players via PTS)
  * 1%: Liquidity Pool
* All SEED spent is burned
* Smart contract enforces automatic and instant distribution

### Earning LEAF

* Stake SEED in **Staking app** or by tapping "Stake" in status bar or by visiting Warehouse building
* Complete **quests** using Farmer House (Lands app)

---

## Getting Started

1. **Connect Wallet** (Prefer Smart Wallet for gasless txs + bundler support)
2. **Swap ETH for SEED** (Swap Tab)
3. **Mint Plant** (Mint Tab)
4. **Care for Plant** (Farm > Plants > Shop Items)
5. **Mint Land** and upgrade buildings (Farm > Lands or Lands app)
6. **Stake SEED to earn LEAF** (Status bar → Stake button → Stake tab → Approve SEED → Stake)

---

## 🛠️ Common Actions

| Task             | Steps                                                                |
| ---------------- | -------------------------------------------------------------------  |
| Mint Plant       | Mint tab → Select strain → Approve SEED → Mint                       |
| Care for Plant   | Farm tab → Plants → Select → Buy Items                               |
| Get SEED         | Swap tab → Input ETH → Confirm                                       |
| Upgrade Building | Farm tab → Lands → Select → Approve LEAF → Upgrade (SEED for speed)  |
| Attack Plant     | Ranking tab → Plants with Sword icon → Tap → Select Attacker → Attack|
| Stake SEED       | Status bar → Stake button → Stake tab → Approve SEED → Stake         |
| Claim LEAF       | Status bar → Stake button → Claim rewards                            |
| Unstake SEED     | Status bar → Stake button → Unstake tab → Unstake                    |

---

## Functionalities Not in Mini App

| Feature                | Available On         |
| ---------------------- | -------------------- |
| Claiming ETH rewards   | Plants app           |
| Minting Passport NFT   | Plants app           |
| Playing Arcade Games   | Plants app           |
| Renaming Land          | Lands app            |

---

## Troubleshooting

| Issue              | Solution                                                         |
| ------------------ | ---------------------------------------------------------------- |
| Wallet not working | Ensure Base network, check balances, smart/regular wallet status |
| Transaction failed | Confirm token balances and approval status                       |
| Plant dying        | Buy and apply shop items immediately                             |
| No SEED            | Use Swap tab to trade ETH for SEED                               |
| No LEAF            | Stake SEED in Staking app or by tapping "Stake" in status bar    |
| No smartwallet     | Visit wallet.coinbase.com to create a new smart wallet           |
| No Bundler/batched txs | Use Smart wallet                                             |

---

## 🔗 Contracts (Onchain References)

| Contract        | Address                                    |
| --------------- | -------------------------------------------|
| Plant (ERC-721) | 0xeb4e16c804ae9275a655abbc20cd0658a91f9235 |
| Land (ERC-721)  | 0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c |
| Staking         | 0xF15D93c3617525054aF05338CC6Ccf18886BD03A |
| LEAF (ERC-20)   | 0xE78ee52349D7b031E2A6633E07c037C3147DB116 |
| SEED (ERC-20)   | 0x546D239032b24eCEEE0cb05c92FC39090846adc7 |
| LP Address      | 0xAA6a81A7df94DAb346e2d677225caD47220540C5 |

---

## Official Links

* Website: https://pixotchi.tech
* Docs: https://doc.pixotchi.tech
* Miniapp: https://mini.pixotchi.tech
* Lands app: https://land.pixotchi.tech
* Plants app: https://app.pixotchi.tech
* Staking app: https://stake.pixotchi.tech
* Twitter: https://x.com/pixotchi
* Telegram: https://t.me/pixotchi
* Email: team@pixotchi.tech

All actions are onchain and require blockchain transactions on Base network. If smartwallet is used, all gas costs is sponsored by the Pixotchi team.`;

export const GAME_DOCS_CONTEXT = SYSTEM_PROMPT + "\n\n" + KNOWLEDGE_BASE;

// Build proper system and user message structure for Anthropic API
export function buildAIPrompt(userMessage: string, conversationHistory?: string, userStats?: string): {
  system: string;
  userContent: string;
} {
  // System prompt - sent once per conversation via 'system' parameter
  const system = GAME_DOCS_CONTEXT;
  
  // User content - actual user question with optional history and stats
  let userContent = '';
  
  if (conversationHistory) {
    userContent += `Previous conversation:\n${conversationHistory}\n\n`;
  }
  
  // Include user stats if available (formatted as clean JSON)
  if (userStats) {
    userContent += `User's Current Game Stats:\n${userStats}\n\n`;
  }
  
  userContent += `User Question: ${userMessage}`;
  
  return {
    system,
    userContent
  };
}

// Legacy function for backward compatibility (remove after migration)
export function buildAIPromptLegacy(userMessage: string, conversationHistory?: string): string {
  const { system, userContent } = buildAIPrompt(userMessage, conversationHistory);
  return system + '\n\n' + userContent;
}

export function generateConversationTitle(firstMessage: string): string {
  // Generate a short title from the first user message
  const cleaned = firstMessage.trim().toLowerCase();
  
  // Common question patterns
  if (cleaned.includes('mint') && cleaned.includes('plant')) return 'Minting Plants';
  if (cleaned.includes('mint') && cleaned.includes('land')) return 'Minting Land';
  if (cleaned.includes('plant') && (cleaned.includes('care') || cleaned.includes('feed'))) return 'Plant Care';
  if (cleaned.includes('swap') || cleaned.includes('token')) return 'Token Swapping';
  if (cleaned.includes('land') || cleaned.includes('building')) return 'Land Management';
  if (cleaned.includes('item') || cleaned.includes('shop')) return 'Items & Shop';
  if (cleaned.includes('help') || cleaned.includes('how')) return 'Game Help';
  if (cleaned.includes('wallet') || cleaned.includes('connect')) return 'Wallet Issues';
  
  // Fallback: use first few words
  const words = firstMessage.split(' ').slice(0, 3).join(' ');
  return words.length > 20 ? words.substring(0, 20) + '...' : words;
}