export type AiSendResult =
  | { status: 'accepted' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: Error };

export class AiChatAuthenticationError extends Error {
  readonly statusCode = 401;
  constructor() { super('Your chat session expired. Refresh it and send your saved question again.'); }
}

/** The AI SDK resolves sendMessage even when transport fails or is aborted. */
export class AiSendAttempt {
  private error: Error | undefined;
  private result: AiSendResult | undefined;
  fail(error: Error) { this.error = error; }
  finish({ isAbort, isError, isDisconnect }: { isAbort: boolean; isError: boolean; isDisconnect: boolean }) {
    this.result = isAbort ? { status: 'cancelled' }
      : isError || isDisconnect ? { status: 'failed', error: this.error ?? new Error('Neural Seed could not finish the response. Your question is saved below; try sending it again.') }
      : { status: 'accepted' };
  }
  cancel() { this.result = { status: 'cancelled' }; }
  outcome(): AiSendResult {
    return this.result ?? { status: 'failed', error: this.error ?? new Error('Neural Seed did not confirm a response. Your question is saved below.') };
  }
}
