import { NextRequest } from 'next/server';
import { generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
// Use centralized strain data for Agent
import { z } from 'zod';
import { PLANT_STRAINS } from '@/lib/constants';
import { getAgentAIProvider, getAgentModelConfig } from '@/lib/ai-config';
// Removed generic AgentKit/Vercel AI tools to avoid requiring RPC URLs in this route

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

// No AgentKit instance needed here; all onchain actions go through /api/agent/mint

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, userAddress, conversationHistory, preparedSpendCalls } = body || {};
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400 });
    }

    // Use centralized strains (mintPriceSeed in SEED units)
    const HARDCODED_STRAINS = PLANT_STRAINS;

    const listStrainsParams = z.object({
      reason: z.string().optional().describe('Reason for listing strains')
    });

    const listStrainsExecute = async (args: z.infer<typeof listStrainsParams>) => {
      // Return centralized strain dataset
      // Use explicit type casting to avoid union type complexities in inference
      const strains = HARDCODED_STRAINS.map(s => ({ id: Number(s.id), name: String(s.name), mintPriceSeed: Number(s.mintPriceSeed) }));
      return strains;
    };

    const listStrains = tool({
      description: 'List available strains with exact prices. Always use this to get prices; do not guess.',
      inputSchema: listStrainsParams,
      execute: listStrainsExecute
    });

    const mintPlantsParams = z.object({
      count: z.number().int().min(1).max(5).describe('Number of plants to mint'),
      strain: z.number().int().min(2).max(5).optional().describe('Strain ID (2-5)'),
      userAddress: z.string().optional().describe('User wallet address - use the one from context'),
      execute: z.boolean().default(false).describe('false=estimate only, true=actually execute the mint'),
    });

    const mintPlantsExecute = async ({ count, strain, strainName, userAddress: toolUserAddress, execute = false }: { count: number; strain?: number; strainName?: string; userAddress?: string; execute?: boolean }) => {
        console.log('[MINT_TOOL] Tool called with:', { count, strain, strainName, toolUserAddress, execute, bodyUserAddress: userAddress });
        
        // Use userAddress from tool parameter or fallback to the one from request body
        const effectiveUserAddress = toolUserAddress || userAddress;
        console.log('[MINT_TOOL] Effective user address:', effectiveUserAddress);
        
        // Use hardcoded strains dataset
        const strains = HARDCODED_STRAINS;
        let chosen: typeof HARDCODED_STRAINS[number] = strains[0];
        if (typeof strain === 'number') {
          const found = strains.find(s => s.id === Number(strain));
          if (found) chosen = found as typeof HARDCODED_STRAINS[number];
        } else if (strainName) {
          const byName = strains.find(s => `${s.name}`.toLowerCase() === `${strainName}`.toLowerCase());
          if (byName) chosen = byName as typeof HARDCODED_STRAINS[number];
        }
        const unit = chosen?.mintPriceSeed || 0;
        const total = unit * count;
        
        console.log('[MINT_TOOL] Selected strain:', { id: chosen?.id, name: chosen?.name, unitPrice: unit, total });

        // If execute is false, just return estimate
        if (!execute || !effectiveUserAddress) {
          console.log('[MINT_TOOL] Returning estimate only:', { execute, hasAddress: !!effectiveUserAddress });
          return {
            strainId: chosen?.id,
            strainName: chosen?.name,
            unitSeedPrice: unit,
            totalSeedRequired: total,
            estimateOnly: true,
            next: 'To execute: provide your wallet address and confirm execution.'
          };
        }

        // Actually execute the mint
        console.log('[MINT_TOOL] Executing mint...');
        try {
          const origin = (() => { try { return new URL(req.url).origin; } catch { return ''; } })();
          const base = process.env.NEXT_PUBLIC_URL || origin;
          const mintUrl = `${base}/api/agent/mint`;
          const requestBody = {
            userAddress: effectiveUserAddress,
            count,
            strainId: chosen?.id,
            totalSeedRequired: total,
            preparedSpendCalls: Array.isArray((preparedSpendCalls as any)) ? preparedSpendCalls : undefined,
          };
          
          console.log('[MINT_TOOL] Fetching:', { url: mintUrl, base, origin, body: requestBody });
          
          const response = await fetch(mintUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          console.log('[MINT_TOOL] Response received:', { 
            status: response.status, 
            statusText: response.statusText,
            ok: response.ok,
            contentType: response.headers.get('content-type'),
            headers: Object.fromEntries(response.headers.entries())
          });

          // Check if response is JSON before parsing
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('[MINT_TOOL] Non-JSON response:', { status: response.status, contentType, textPreview: text.substring(0, 500) });
            return {
              error: true,
              message: `Mint endpoint returned non-JSON response (${response.status}): ${text.substring(0, 200)}`,
              strainId: chosen?.id,
              strainName: chosen?.name,
              totalSeedRequired: total,
            };
          }

          const result = await response.json();
          console.log('[MINT_TOOL] Parsed JSON result:', JSON.stringify(result, null, 2));
          
          if (!response.ok) {
            console.error('[MINT_TOOL] Response not OK:', { status: response.status, result });
            return {
              error: true,
              message: result.error || 'Failed to execute mint',
              strainId: chosen?.id,
              strainName: chosen?.name,
              totalSeedRequired: total,
            };
          }

          console.log('[MINT_TOOL] Mint successful:', { transactionHash: result.spendTransactionHash || result.result?.transactionHash, message: result.message });
          return {
            success: true,
            strainId: chosen?.id,
            strainName: chosen?.name,
            plantsMinited: count,
            seedSpent: total,
            transactionHash: result.spendTransactionHash || result.result?.transactionHash,
            message: result.message,
            executed: true,
          };

        } catch (error: any) {
          console.error('[MINT_TOOL] Error during mint execution:', {
            error: error.message,
            stack: error.stack,
            name: error.name,
            cause: error.cause
          });
          return {
            error: true,
            message: error.message || 'Network error during mint execution',
            strainId: chosen?.id,
            strainName: chosen?.name,
            totalSeedRequired: total,
          };
        }
      };

    const mintPlants = tool({
      description: 'Mint Pixotchi plants for the user. Use execute=false for estimates, execute=true when user confirms.',
      inputSchema: mintPlantsParams,
      execute: mintPlantsExecute
    });

    const agentProvider = getAgentAIProvider();
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `You are an Neural Seed Agent. Currently you can only mint plants using SEED tokens via spend permissions. With time, you will be able to do more things.
    ${userAddress ? `User wallet: ${userAddress}` : 'User wallet not provided.'}

    Context about the app:
    - Pixotchi Mini is a plant and land game. Players mint plants with SEED tokens, then grow and interact with them. There are other features (lands, buildings, staking), but those are outside your scope.
    - Currency: SEED (ERC-20). Some features use LEAF, but you never handle LEAF.
    - You operate on the Base network and execute transactions using an Agent Smart Account that can spend SEED via user-granted spend permissions.

    Your scope (Agent Mode):
    - You can mint ONLY the ZEST strain (id 4) at a fixed price of 10 SEED per plant.
    - You can mint up to 5 plants at once.
    - You cannot mint any other strains; direct users to the Mint tab for non-ZEST mints.
    - If the user asks for balances, stats, or guidance, direct them to the AI tab (Neural Seed Assistant) for richer help.

    Safety and UX rules:
    - Never guess prices. In agent mode, ZEST price is always 10 SEED.
    - When the user asks to mint, first present an estimate: count × 10 SEED. Ask for explicit confirmation.
    - After the user confirms, call mint_plants with execute=true.
    - Always use the userAddress from context. If missing, ask the user to connect.
    - If a permission/allowance/time-window error occurs, clearly explain that spend permission for your agent is missing/insufficient/expired and ask the user to grant or increase it.
    - Do not attempt any actions beyond ZEST minting.
    - Always and VERY briefly hint at users that you will be gettingtin more features and abilities soon.
    - Use 🌱 and Base emoji (🟦) when fit.`;

    // Enhanced prompt with context and conversation history
    let enhancedPrompt = userAddress ? 
      `User Address: ${userAddress}\nUser Request: ${prompt}` : 
      `User Request: ${prompt}`;
    
    // Add conversation context if available
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-4); // Last 4 messages
      const historyText = recentHistory.map((msg: any) => 
        `${msg.role === 'user' ? 'User' : 'Agent'}: ${msg.content}`
      ).join('\n');
      enhancedPrompt = `Recent conversation:\n${historyText}\n\nCurrent request:\n${enhancedPrompt}`;
    }

    const toolBundle: Record<string, any> = { list_strains: listStrains, mint_plants: mintPlants };

    console.log('[AGENT_CHAT] Starting generateText with:', {
      hasTools: !!toolBundle,
      toolNames: Object.keys(toolBundle),
      promptLength: enhancedPrompt.length,
      hasUserAddress: !!userAddress
    });

    const agentModelConfig = getAgentModelConfig();
    const model = agentProvider === 'claude'
      ? anthropic(agentModelConfig.model)
      : openai(agentModelConfig.model);

    const { text, toolResults } = await generateText({
      model,
      system: systemPrompt,
      tools: toolBundle,
      prompt: enhancedPrompt,
      stopWhen: stepCountIs(5), // Enable multi-step calls so model generates text after tool results
    });

    console.log('[AGENT_CHAT] GenerateText completed:', {
      textLength: text?.length || 0,
      textPreview: text?.substring(0, 200),
      toolResultsCount: toolResults?.length || 0,
      toolResults: toolResults?.map(tr => {
        const output = tr.output as any;
        return {
          toolName: tr.toolName,
          hasError: output?.error,
          errorMessage: output?.error ? output.message : undefined,
          success: output?.success,
          outputPreview: JSON.stringify(tr.output).substring(0, 200)
        };
      })
    });

    return new Response(
      JSON.stringify({ success: true, text, toolResults }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('[AGENT_CHAT] Error:', {
      message: e?.message,
      stack: e?.stack,
      name: e?.name,
      cause: e?.cause,
      error: e
    });
    return new Response(JSON.stringify({ error: e?.message || 'Agent error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


