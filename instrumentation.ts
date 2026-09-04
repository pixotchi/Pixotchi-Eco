import type { Instrumentation } from 'next';

function safeDigest(error: unknown): string | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('digest' in error) ||
    typeof error.digest !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(error.digest)
  ) {
    return null;
  }

  return error.digest;
}

/**
 * Emits correlation-safe server failure metadata to the deployment log. Do not
 * add request headers, request URLs, error messages, or stacks here: those can
 * include credentials or user-supplied data.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  console.error(JSON.stringify({
    event: 'next_request_error',
    errorKind: error instanceof Error ? 'error' : typeof error,
    digest: safeDigest(error),
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    revalidateReason: context.revalidateReason ?? null,
  }));
};
