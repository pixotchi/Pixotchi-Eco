import { abortable } from './abortable';

export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

export async function readLimitedJson(request: Request, maxBytes: number, signal = request.signal): Promise<unknown> {
  signal.throwIfAborted();
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new RequestBodyError('Invalid request size.', 400);
    if (Number(length) > maxBytes) throw new RequestBodyError('Request body is too large.', 413);
  }
  if (!request.body) throw new RequestBodyError('JSON body is required.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyError('Request body is too large.', 413);
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new RequestBodyError('Invalid JSON body.', 400); }
}
