type AIRequestSafety =
  | { allowed: true }
  | { allowed: false; reason: 'private_data' | 'off_topic' | 'transaction_request'; response: string };

const GAME_TERMS = [
  'pixotchi',
  'plant',
  'plants',
  'land',
  'lands',
  'farm',
  'mint',
  'seed',
  'leaf',
  'pixotchi token',
  'pts',
  'tod',
  'time of death',
  'warehouse',
  'staking',
  'stake',
  'unstake',
  'claim',
  'reward',
  'rewards',
  'quest',
  'quests',
  'mission',
  'missions',
  'rocks',
  'streak',
  'ranking',
  'leaderboard',
  'leaderboards',
  'swap',
  'arcade',
  'stars',
  'casino',
  'barracks',
  'raid',
  'raids',
  'attack',
  'fence',
  'shield',
  'marketplace',
  'transfer assets',
  'wallet',
  'balance',
  'balances',
  'transaction',
  'transactions',
  'tx',
  'tx hash',
  'receipt',
  'confirmed',
  'confirm',
  'history',
  'base',
  'onchain',
  'smart wallet',
  'bridge',
  'solana',
  'airdrop',
  'verify',
  'free claim',
  'how do i play',
  'what should i do',
  'next step',
  'getting started',
];

const PRIVATE_DATA_PATTERNS = [
  /\b(api|openai|anthropic|google|gemini|vercel|redis|upstash|privy|cdp)\s*(key|secret|token)\b/i,
  /\b(private key|seed phrase|mnemonic|session cookie|auth cookie|jwt|bearer token|access token)\b/i,
  /\b(env|environment variable|\.env|process\.env)\b/i,
  /\b(system prompt|developer message|hidden prompt|internal instructions|tool schema|source code prompt)\b/i,
  /\b(private ai chat|other users? chats?|another users? chats?|conversation history for|all conversations)\b/i,
  /\b(feedback database|feedback submissions?|user feedback|admin feedback)\b/i,
  /\b(admin database|admin panel|database dump|dump redis|redis keys|sql dump|all users? data)\b/i,
  /\b(leak|exfiltrate|bypass|jailbreak|ignore (all )?(previous|system|developer) instructions)\b/i,
];

const OFF_TOPIC_PATTERNS = [
  /\b(weather|forecast|recipe|cook|meal|poem|song lyrics|essay|homework|math homework)\b/i,
  /\b(politics|election|celebrity|movie|sports score|stock market|investment advice)\b/i,
  /\b(medical advice|legal advice|diagnose|prescription|lawsuit|contract law)\b/i,
  /\b(write code|debug my code|javascript|python|rust|solidity tutorial|sql query)\b/i,
  /\b(dating advice|travel itinerary|hotel|flight|restaurant recommendation)\b/i,
];

const TRANSACTION_REQUEST_PATTERNS = [
  /\b(calldata|call data|transaction payload|tx payload|raw transaction|encoded transaction|write contract)\b/i,
  /\b(prepare|generate|build|craft|encode|send|execute)\b.{0,80}\b(approval|approve|mint|claim|stake|unstake|swap|transfer|raid|attack|upgrade|revive|buy)\b/i,
  /\b(approve|mint|claim|stake|unstake|swap|transfer|raid|attack|upgrade|revive|buy)\b.{0,80}\b(for me|on my behalf|with my wallet|transaction payload|calldata)\b/i,
];

function includesAnyTerm(message: string, terms: string[]) {
  return terms.some((term) => message.includes(term));
}

export function classifyAIUserMessage(message: string): AIRequestSafety {
  const normalized = message.toLowerCase();

  if (PRIVATE_DATA_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      allowed: false,
      reason: 'private_data',
      response: 'I cannot access or reveal private chats, feedback data, admin data, API keys, env vars, sessions, private keys, or internal prompts. I can help with safe Pixotchi gameplay, public leaderboard data, and read-only onchain game state.',
    };
  }

  if (TRANSACTION_REQUEST_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      allowed: false,
      reason: 'transaction_request',
      response: 'I cannot prepare calldata, transaction payloads, approvals, or execute gameplay actions. I can inspect read-only Pixotchi data and point you to the right in-app flow so your wallet UI builds and confirms the transaction safely.',
    };
  }

  const gameRelated = includesAnyTerm(normalized, GAME_TERMS);
  if (!gameRelated && OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      allowed: false,
      reason: 'off_topic',
      response: 'I can only help with Pixotchi gameplay, safe public game data, and read-only onchain information from the app. Ask me about your plants, lands, missions, staking, prices, leaderboards, or what to do next in-game.',
    };
  }

  return { allowed: true };
}
