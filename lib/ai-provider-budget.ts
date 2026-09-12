import type { LanguageModelMiddleware } from 'ai';

type CallOptions = Parameters<NonNullable<LanguageModelMiddleware['transformParams']>>[0]['params'];
type Usage = Awaited<ReturnType<Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['doGenerate']>>['usage'];

// Includes the production instructions, 42 tool schemas, and bounded history.
export const AI_DEFAULT_REQUEST_RESERVATION_TOKENS = 131_072;

export class AIRequestBudgetExceededError extends Error {
  constructor() {
    super('There is not enough AI budget left for another generation. Please try again after the daily reset.');
    this.name = 'AIRequestBudgetExceededError';
  }
}

/** Conservative admission estimate for this text-only assistant, including tool schemas/results. */
export function estimateAIInputAllowance(params: CallOptions): number {
  // One token per UTF-8 byte deliberately overestimates ordinary text. Reserve
  // additional framing space per message/tool; never assume the English 4:1 ratio.
  // Reject non-text media rather than treating a URL as its tokenized payload.
  for (const message of params.prompt) {
    if (Array.isArray(message.content) && message.content.some(part => part.type === 'file')) {
      throw new Error('Media token budgeting is not supported');
    }
  }
  return Buffer.byteLength(JSON.stringify({ prompt: params.prompt, tools: params.tools, responseFormat: params.responseFormat }), 'utf8')
    + 1024 + 256 * (params.prompt.length + (params.tools?.length ?? 0));
}

/** Shared across planning, every SDK tool step, retries, and continuation. */
export class AIProviderBudget {
  private remaining: number;
  started = false;
  constructor(tokens: number) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('Invalid AI provider budget');
    this.remaining = tokens;
  }

  private admit(params: CallOptions): number {
    const input = estimateAIInputAllowance(params);
    const availableOutput = this.remaining - input;
    if (availableOutput < 1) throw new AIRequestBudgetExceededError();
    params.maxOutputTokens = Math.min(params.maxOutputTokens ?? availableOutput, availableOutput);
    const reserved = input + params.maxOutputTokens;
    this.remaining -= reserved;
    return reserved;
  }

  private settle(reserved: number, usage: Usage) {
    const input = usage.inputTokens.total;
    const output = usage.outputTokens.total;
    if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0
      || typeof output !== 'number' || !Number.isSafeInteger(output) || output < 0) return;
    // Missing usage or interrupted streams retain the full allowance. If a
    // provider exceeds its estimate, its actual usage prevents further calls.
    this.remaining += reserved - input - output;
  }

  readonly middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ params, doGenerate }) => {
      const reserved = this.admit(params);
      this.started = true;
      const result = await doGenerate();
      this.settle(reserved, result.usage);
      return result;
    },
    wrapStream: async ({ params, doStream }) => {
      const reserved = this.admit(params);
      this.started = true;
      const result = await doStream();
      let settled = false;
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          transform: (part, controller) => {
            if (part.type === 'finish' && !settled) {
              settled = true;
              this.settle(reserved, part.usage);
            }
            controller.enqueue(part);
          },
        })),
      };
    },
  };
}
