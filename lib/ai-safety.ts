type AIRequestSafety =
  | { allowed: true }
  | { allowed: false; reason: 'financial_advice' | 'private_data' | 'off_topic' | 'transaction_request'; response: string };

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
  'base chain',
  'base network',
  'base blockchain',
  'onchain',
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
  /\b(system prompt|developer message|hidden prompt|internal instructions|source code prompt)\b/i,
  /\b(system|developer|hidden|internal)\s+(prompt|message|messages|instruction|instructions|policy|policies|rules|guardrails)\b/i,
  /\b(chain of thought|reasoning trace|hidden reasoning|scratchpad)\b/i,
  /\b(tool|function)\s+(schema|schemas|definition|definitions|input schema|registry|manifest)\b/i,
  /\b(available|internal|hidden)\s+(tools|functions|tool names|function names)\b/i,
  /\b(model|provider|fallback model|token budget|rate limit|configuration|config)\b.{0,40}\b(reveal|show|print|dump|list|tell|share|expose)\b/i,
  /\b(reveal|show|print|dump|repeat|quote|summarize|translate|encode|base64|rot13|list|reconstruct)\b.{0,100}\b(system prompt|developer message|hidden prompt|internal instructions|tool schema|available tools|tool names|function names|model config|provider config|fallback models?|token budgets?|rate limits?|env vars?)\b/i,
  /\b(what|which|list|show|tell me)\b.{0,80}\b(tools?|functions?|models?|providers?|fallback models?|system prompt|developer instructions)\b.{0,80}\b(access|available|using|have|configured|run on)\b/i,
  /\b(private ai chat|other users? chats?|another users? chats?|conversation history for|all conversations)\b/i,
  /\b(feedback database|feedback submissions?|user feedback|admin feedback)\b/i,
  /\b(admin database|admin panel|database dump|dump redis|redis keys|sql dump|all users? data)\b/i,
  /\b(leak|exfiltrate|bypass|jailbreak|ignore (all )?(previous|system|developer) instructions)\b/i,
  /\b(ignore|disregard|override|forget)\b.{0,80}\b(previous|system|developer|hidden|above|instructions|rules|policy|policies|guardrails)\b/i,
  /\b(jailbreak|dan mode|developer mode|admin mode|debug mode|god mode)\b/i,
  /\b(you are now|act as|pretend to be|roleplay as)\b.{0,80}\b(admin|developer|system|unfiltered|jailbroken|debugger)\b/i,
  /\b(for security testing|as an auditor|compliance check|red team)\b.{0,120}\b(system prompt|developer message|tool|function|secret|config|env|key|token)\b/i,
  /\b(repeat|quote|print|dump)\b.{0,80}\b(text above|messages above|initial message|first message|hidden text|instructions above)\b/i,
];

const ALWAYS_OFF_TOPIC_PATTERNS = [
  /\b(weather|forecast|recipe|cook|meal|poem|song lyrics|essay|homework|math homework)\b/i,
  /\b(politics|election|president|celebrity|movie|sports score|baseball|basketball|football|soccer|tennis)\b/i,
  /\b(medical advice|legal advice|diagnose|prescription|lawsuit|contract law)\b/i,
  /\b(write|debug|review|fix|generate)\b.{0,50}\b(code|javascript|python|rust|solidity|sql)\b/i,
  /\b(dating advice|travel itinerary|hotel|flight|restaurant recommendation)\b/i,
  /\b(investment advice|financial advice|price prediction|will .{0,40} pump|should i buy .{0,40} as an investment)\b/i,
];

const OFF_TOPIC_PATTERNS = [
  /\b(weather|forecast|recipe|cook|meal|poem|song lyrics|essay|homework|math homework)\b/i,
  /\b(politics|election|president|celebrity|movie|sports score|stock market|investment advice)\b/i,
  /\b(medical advice|legal advice|diagnose|prescription|lawsuit|contract law)\b/i,
  /\b(write code|debug my code|javascript|python|rust|solidity tutorial|sql query)\b/i,
  /\b(dating advice|travel itinerary|hotel|flight|restaurant recommendation)\b/i,
];

const TRANSACTION_REQUEST_PATTERNS = [
  /\b(calldata|call data|transaction payload|tx payload|raw transaction|encoded transaction|write contract|permit signature|setapprovalforall)\b/i,
  /\b(prepare|generate|build|craft|encode|send|execute|sign)\b.{0,80}\b(approval|approve|mint|claim|stake|unstake|swap|transfer|raid|attack|upgrade|revive|buy|permit|setapprovalforall)\b/i,
  /\b(approve|mint|claim|stake|unstake|swap|transfer|raid|attack|upgrade|revive|buy|sign)\b.{0,80}\b(for me|on my behalf|with my wallet|transaction payload|calldata|raw tx|signature)\b/i,
];

const FINANCIAL_ADVICE_PATTERNS = [
  /\b(financial advice|investment advice|price prediction|portfolio sizing|entry price|exit price)\b/i,
  /\b(should|would|do you think|recommend|worth|is it smart to)\b.{0,80}\b(buy|sell|hold|invest|ape|accumulate|dump|take profit|enter|exit)\b.{0,80}\b(seed|leaf|pixotchi|token|coin)\b/i,
  /\b(seed|leaf|pixotchi|token|coin)\b.{0,80}\b(good investment|worth buying|undervalued|overvalued|price prediction|pump|moon|crash|profit)\b/i,
  /\b(will|can|could)\b.{0,60}\b(seed|leaf|pixotchi)\b.{0,60}\b(go up|go down|pump|moon|make me money|profit|crash)\b/i,
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesAnyTerm(message: string, terms: string[]) {
  return terms.some((term) => {
    const pattern = escapeRegExp(term).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(message);
  });
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

  if (FINANCIAL_ADVICE_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      allowed: false,
      reason: 'financial_advice',
      response: 'I cannot give financial advice, investment advice, price predictions, or buy/sell/hold recommendations. I can explain Pixotchi token utility, contract addresses, live market pulse data, swap quote mechanics, and in-app token use as factual information only.',
    };
  }

  if (ALWAYS_OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      allowed: false,
      reason: 'off_topic',
      response: 'I can only help with Pixotchi gameplay, safe public game data, and read-only onchain information from the app. Ask me about your plants, lands, missions, staking, prices, leaderboards, or what to do next in-game.',
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
