export class SwapReviewRequiredError extends Error {
  readonly code = 'SWAP_REVIEW_REQUIRED';
  constructor() {
    super('The quote changed. Review the updated minimum received, then confirm again.');
  }
}

export class SwapBuildInvalidError extends Error {
  readonly code = 'SWAP_BUILD_INVALID';
  constructor(message = 'The swap provider returned an inconsistent transaction. Please refresh the quote.') {
    super(message);
  }
}
