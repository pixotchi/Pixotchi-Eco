"use client";

import type { ReactNode } from "react";
import type { TutorialSlideId } from "./config";

export type TutorialSlide = {
  id: TutorialSlideId;
  title: string;
  content: ReactNode;
  icon?: ReactNode;
  art?: "token-flow" | "mint-plant" | "plant-items" | "attack" | "land" | "buildings" | "staking" | "chat" | "base" | "ptstod" | "tasks";
};

export const slides: TutorialSlide[] = [
  {
    id: 'first-plant', title: 'Start with your farm', art: 'mint-plant',
    content: <div className="space-y-2 text-sm"><p>Already have a plant? Open Farm to see its remaining lifetime.</p><p>Need your first plant? Mint shows the options supported by your wallet, including any free-plant eligibility. Check that before choosing a paid strain.</p></div>,
  },
  {
    id: 'first-care', title: 'Give your plant its first care', art: 'plant-items',
    content: <div className="space-y-2 text-sm"><p>In Farm, choose a care item to add lifetime or points. The review explains its cost and effect before you confirm.</p><p>If your plant has died, use the revival option first. If you need SEED, Swap is available from the main tabs.</p></div>,
  },
  {
    id: 'next-step', title: 'Choose your next step', art: 'chat',
    content: <div className="space-y-2 text-sm"><p>Your First Care checklist stays in Farm. It points to the next available activity for your account.</p><p>Open Chat for community help. The full game guide is always available in About, and resumes where you leave it.</p></div>,
  },
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
          <li>A portion of SEED trading fees funds ETH rewards, shared according to plant PTS when distributed.</li>
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
          <li>Compare each strain&apos;s appearance, mint price, and available supply. Mint also shows the current starting lifetime.</li>
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
        <p>Use items in Plant care to increase your plant&apos;s stats:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Lifetime:</strong> Time remaining before your plant dies. Older game screens and contracts call this TOD (Time of Death).</li>
          <li><strong>PTS (Points):</strong> Contributes to your share when ETH rewards are distributed. Reward amounts vary.</li>
          <li>Claiming a plant&apos;s ETH rewards removes all of its PTS and resets its level to 1. Review this in Rewards before claiming.</li>
        </ul>
      </div>
    ),
  },
  // 4) Plant care items
  {
    id: "items",
    title: "Attack & Defend",
    art: "plant-items",
    content: (
      <div className="space-y-2 text-sm">
        <p>Watch out for other players!</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Check <strong>Ranking</strong> for eligible living plants to attack. An attack can win or lose PTS.</li>
          <li>Buy a <strong>Fence</strong> from Plant care for temporary protection, and check when it expires.</li>
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
          <li>Village buildings accumulate <strong>PTS and lifetime</strong>. Collect them into Warehouse, then apply them to a plant.</li>
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
          <li><strong>Town buildings:</strong> Build Farmer House for quests or Marketplace to trade LEAF and SEED.</li>
          <li><strong>Upgrade:</strong> Review each building&apos;s token cost and construction time. Village upgrades increase production; Town upgrades unlock or improve services.</li>
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
          <li>SpinLeaf in Arcade and Farmer House quests can also award LEAF. Check their current rewards before playing.</li>
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
        <p>Explore daily activities:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Complete available tasks and track your daily streak and <strong>Rocks</strong> progress. Check current in-app announcements for any reward events.</li>
          <li>Try <strong>Arcade games</strong> and review each game&apos;s possible outcomes first. A result can include lost PTS or no reward.</li>
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
          <li>Use a <strong>Smart Wallet</strong> for the smoothest onchain experience.</li>
          <li>Good luck, and enjoy your journey in Pixotchi! 🌱</li>
        </ul>
      </div>
    ),
  },
];
