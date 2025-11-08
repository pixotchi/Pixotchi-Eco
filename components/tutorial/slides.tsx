"use client";

import type { ReactNode } from "react";

export type TutorialSlide = {
  id: string;
  title: string;
  content: ReactNode;
  icon?: ReactNode;
  art?: "token-flow" | "mint-plant" | "plant-items" | "attack" | "land" | "buildings" | "staking" | "chat" | "base" | "ptstod" | "tasks";
};

export const TUTORIAL_VERSION = "v1";

export const slides: TutorialSlide[] = [
  // 1) Swap
  {
    id: "swap",
    title: "Swap ETH → SEED",
    art: "token-flow",
    content: (
      <div className="space-y-2 text-sm">
        <p>SEED is your main in‑game currency.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Trade ETH ↔ SEED in the Swap tab (unsponsored, with slippage guard).</li>
          <li>All SEED spent in game is burned.</li>
          <li>SEED has a 5% buy/sell tax: 2% maintenance, 2% ETH rewards, 1% LP.</li>
        </ul>
        <p className="text-xs text-muted-foreground">ETH rewards are funded by SEED taxes and distributed via PTS.</p>
      </div>
    ),
  },
  // 2) Mint
  {
    id: "mint",
    title: "Mint Your Plant",
    art: "mint-plant",
    content: (
      <div className="space-y-2 text-sm">
        <p>Mint a Plant NFT (5 visual strains; gameplay identical).</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use SEED to mint. Then care for your plant to keep it alive.</li>
          <li>Key stats: TOD (lifetime), PTS (points), status, level, stars.</li>
          <li>Attention criteria: Great (&gt;48h) · Okay (24–48h) · Dry (12–24h) · Dying (3–12h) · Dead (0h).</li>
        </ul>
      </div>
    ),
  },
  // 3) TOD & PTS
  {
    id: "tod-pts",
    title: "TOD and PTS (Rewards)",
    art: "ptstod",
    content: (
      <div className="space-y-2 text-sm">
        <p>Feeding increases TOD (time alive) and PTS (points).</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>PTS drives Leaderboard and ETH rewards distribution.</li>
          <li>ETH rewards pool comes from SEED taxes; higher PTS = larger share.</li>
          <li>Claiming ETH happens in the full Plants app.</li>
        </ul>
      </div>
    ),
  },
  // 4) Plant Items Marketplace
  {
    id: "items",
    title: "Plant Items Marketplace",
    art: "plant-items",
    content: (
      <div className="space-y-2 text-sm">
        <p>Buy items to boost PTS and extend TOD.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>PTS items: Sunlight, Fertilizer, Magic Soil, Dream Dew.</li>
          <li>TOD items: Water, Pollinator, Dream Dew.</li>
          <li>Fence protects your plant for 48h from attacks.</li>
          <li>Attacks: 30% win / 70% lose, cooldowns enforced automatically, can’t attack fenced or your own plant.</li>
        </ul>
        <p className="text-xs text-muted-foreground">If a plant dies, others may kill it (killer gains a star); dead plants are burned and auto‑redeem rewards to the owner.</p>
      </div>
    ),
  },
  // 5) Mint Land
  {
    id: "mint-land",
    title: "Mint Land",
    art: "land",
    content: (
      <div className="space-y-2 text-sm">
        <p>Land NFTs unlock long‑term growth and production.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Each land has map coordinates and two areas: Village and Town.</li>
          <li>Village buildings produce daily resources for your plants (e.g., Soil Factory → PTS, Bee Farm → TOD; Solar Panel powers the village).</li>
          <li>Town buildings provide utilities (Farmer House for quests, Marketplace for trading, Warehouse to apply, Stakehouse to stake).</li>
          <li>Lands store production (PTS/TOD) you can collect and apply.</li>
        </ul>
      </div>
    ),
  },
  // 6) Buildings & Benefits
  {
    id: "buildings",
    title: "Land Buildings and Benefits",
    art: "buildings",
    content: (
      <div className="space-y-2 text-sm">
        <p>Produce daily resources and unlock utilities.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Village: Solar Panel (energy), Soil Factory (PTS), Bee Farm (TOD).</li>
          <li>Town: Farmer House (quests), Marketplace (trade), Warehouse (apply PTS/TOD), Stakehouse (stake).</li>
          <li>Upgrade with <strong>LEAF</strong>; speed up using <strong>SEED</strong>. Claim from Warehouse, then apply to plants.</li>
          <li>Stakehouse and Warehouse are prebuilt (not upgradeable).</li>
        </ul>
      </div>
    ),
  },
  // 7) Stake
  {
    id: "stake",
    title: "Stake to Earn LEAF",
    art: "staking",
    content: (
      <div className="space-y-2 text-sm">
        <p>Stake SEED to generate LEAF for building upgrades.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Open staking from the Status Bar (Stake button) or Stakehouse.</li>
          <li>Approve once, then Stake / Claim / Unstake anytime.</li>
          <li>Quests via Farmer House can also earn LEAF (Lands app).</li>
        </ul>
      </div>
    ),
  },
  // 8) Help
  {
    id: "help",
    title: "Get Help Anytime",
    art: "chat",
    content: (
      <div className="space-y-2 text-sm">
        <ul className="list-disc pl-5 space-y-1">
          <li>Public Chat for quick questions.</li>
          <li>Neural Seed AI assistant for fast, in‑app guidance.</li>
          <li>Docs: doc.pixotchi.tech · Telegram: t.me/pixotchi</li>
        </ul>
        <p className="text-xs text-muted-foreground">Some actions (e.g., claiming ETH rewards, arcade, renaming land) are in the full apps.</p>
      </div>
    ),
  },
  // 9) Streaks & Tasks
  {
    id: "tasks",
    title: "Streaks & Farmer's Tasks",
    art: "tasks",
    content: (
      <div className="space-y-2 text-sm">
        <p>Keep a daily streak by completing onchain actions and earn Rock from Farmer's Tasks.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Daily streak resets if you miss a day.</li>
          <li>Tasks award up to 80 Rock per day across four sections; details may change over time.</li>
          <li>These stats may be used at the team’s discretion to reward players.</li>
        </ul>
      </div>
    ),
  },
  // 9) Finish
  {
    id: "finish",
    title: "You're all set!",
    art: "base",
    content: (
      <div className="space-y-2 text-sm">
        <p>We wish you a great journey in Pixotchi 🌱🟦</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>For best compatibility, use a <strong>smart wallet</strong> (gas sponsorship supported).</li>
          <li>Run the Mini app inside the <strong>Base</strong> app for the smoothest experience.</li>
        </ul>
        <p className="text-xs text-muted-foreground">Tip: Add Pixotchi Mini to your Farcaster/Base miniapps for quick access.</p>
      </div>
    ),
  },
];


