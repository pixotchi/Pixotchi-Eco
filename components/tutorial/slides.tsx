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
    title: "Getting Started",
    art: "token-flow",
    content: (
      <div className="space-y-2 text-sm">
        <p>Swap ETH for SEED using the in-app swap tab.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>SEED is your main in-game currency.</li>
          <li>Rewards come from 2% of SEED trading volume and are paid in ETH.</li>
        </ul>
      </div>
    ),
  },
  // 2) Mint
  {
    id: "mint",
    title: "Start Your Garden",
    art: "mint-plant",
    content: (
      <div className="space-y-2 text-sm">
        <p>Mint a plant of your choice to start your garden.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Choose any strain you like—gameplay is identical!</li>
          <li>Your goal is to keep it alive and growing.</li>
        </ul>
      </div>
    ),
  },
  // 3) TOD & PTS
  {
    id: "tod-pts",
    title: "Growing Your Plant",
    art: "ptstod",
    content: (
      <div className="space-y-2 text-sm">
        <p>Use Farm and Marketplace items to increase your plant's stats:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>TOD (Time of Death):</strong> Keeps your plant alive.</li>
          <li><strong>PTS (Points):</strong> Determines your share of future ETH rewards.</li>
        </ul>
      </div>
    ),
  },
  // 4) Plant Items Marketplace
  {
    id: "items",
    title: "Attack & Defend",
    art: "plant-items",
    content: (
      <div className="space-y-2 text-sm">
        <p>Watch out for other players!</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Check the <strong>Ranking</strong> tab to find plants you can attack for rewards.</li>
          <li>If you don’t want to get attacked, buy a <strong>Fence</strong> from the Marketplace.</li>
        </ul>
      </div>
    ),
  },
  // 5) Mint Land
  {
    id: "mint-land",
    title: "Lands Extension",
    art: "land",
    content: (
      <div className="space-y-2 text-sm">
        <p>Mint a Land for long-term growth.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Resource buildings produce <strong>free PTS and TOD</strong> daily for your plants.</li>
          <li>Tap your land image to view the map and nearby players.</li>
        </ul>
      </div>
    ),
  },
  // 6) Buildings & Benefits
  {
    id: "buildings",
    title: "Town & Buildings",
    art: "buildings",
    content: (
      <div className="space-y-2 text-sm">
        <p>Unlock advanced features with your Town:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Town Buildings:</strong> Unlock Farmer Quests and your own Marketplace.</li>
          <li><strong>Upgrade:</strong> Use LEAF to upgrade buildings and boost production.</li>
        </ul>
      </div>
    ),
  },
  // 7) Stake
  {
    id: "stake",
    title: "Earn LEAF",
    art: "staking",
    content: (
      <div className="space-y-2 text-sm">
        <p>LEAF is the main token for building upgrades.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Stake SEED</strong> to earn LEAF passively.</li>
          <li>Claim your LEAF and reinvest it into your buildings.</li>
          <li>LEAF can also be earned from Arcade games and Quests.</li>
        </ul>
      </div>
    ),
  },
  // 8) Help
  {
    id: "help",
    title: "Need Help?",
    art: "chat",
    content: (
      <div className="space-y-2 text-sm">
        <p>Tap the <strong>Chat</strong> icon at the top of the app.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Public Chat:</strong> Talk to the community.</li>
          <li><strong>AI Assistant:</strong> Get instant guidance on your next steps.</li>
        </ul>
      </div>
    ),
  },
  // 9) Streaks & Tasks
  {
    id: "tasks",
    title: "Tasks & Rewards",
    art: "tasks",
    content: (
      <div className="space-y-2 text-sm">
        <p>Maximize your gains with daily activities:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Complete tasks, maintain daily streaks, and collect <strong>Rocks</strong> for monthly rewards.</li>
          <li>Play <strong>Arcade games</strong> for extra PTS, TOD, and other rewards.</li>
        </ul>
      </div>
    ),
  },
  // 10) Finish
  {
    id: "finish",
    title: "You're All Set!",
    art: "base",
    content: (
      <div className="space-y-2 text-sm">
        <p>Everyone plays differently, so find the strategy that fits you.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use a <strong>Smart Wallet</strong> for the best experience (sponsored gas).</li>
          <li>Good luck, and enjoy your journey in Pixotchi! 🌱</li>
        </ul>
      </div>
    ),
  },
];
