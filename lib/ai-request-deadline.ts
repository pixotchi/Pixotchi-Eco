/** One deadline spans authentication, tool planning, generation and continuation.
 * Leave ten seconds of the route's 60-second limit for usage settlement/storage. */
export const AI_ROUTE_WORK_MS = 50_000;
export function createAIRequestSignal(incoming: AbortSignal, workMs = AI_ROUTE_WORK_MS): AbortSignal {
  return AbortSignal.any([incoming, AbortSignal.timeout(workMs)]);
}
