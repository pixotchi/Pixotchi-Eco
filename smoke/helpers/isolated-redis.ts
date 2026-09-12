import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
function parseResp(buffer: Buffer, offset = 0): { value: unknown; end: number } | null {
  const eol = buffer.indexOf('\r\n', offset);
  if (eol === -1) return null;
  const type = String.fromCharCode(buffer[offset]);
  const head = buffer.toString('utf8', offset + 1, eol);
  const start = eol + 2;
  if (type === '-') throw new Error(head);
  if (type === '+') return { value: head, end: start };
  if (type === ':') return { value: Number(head), end: start };
  if (type === '$') {
    const length = Number(head);
    if (length === -1) return { value: null, end: start };
    if (buffer.length < start + length + 2) return null;
    return { value: buffer.toString('utf8', start, start + length), end: start + length + 2 };
  }
  if (type === '*') {
    const values: unknown[] = [];
    let end = start;
    for (let index = 0; index < Number(head); index++) {
      const child = parseResp(buffer, end);
      if (!child) return null;
      values.push(child.value); end = child.end;
    }
    return { value: values, end };
  }
  throw new Error('Unknown isolated Redis response');
}

function command(port: number, args: Array<string | number>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0);
    socket.setTimeout(10_000, () => socket.destroy(new Error('Isolated Redis timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`*${args.length}\r\n${args.map(arg => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join('')}`));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseResp(buffer);
        if (parsed) { socket.end(); resolve(parsed.value); }
      } catch (error) { socket.destroy(); reject(error); }
    });
  });
}

/** Local Redis only; never loads .env or accepts a remote database URL. */
export async function isolatedRedis() {
  const port = Number(process.env.AUDIT_TEST_REDIS_PORT);
  if (!Number.isInteger(port) || port < 1024 || port === 6379) throw new Error('Set AUDIT_TEST_REDIS_PORT to an isolated loopback Redis port (not 6379).');
  for (const key of Object.keys(process.env)) {
    if (/REDIS|KV_|RPC|PRIVY|API_KEY|SECRET|TOKEN|GAMIFICATION_DISABLED/.test(key)) delete process.env[key];
  }
  process.env.NEXT_PUBLIC_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED = 'false';
  const prefix = `audit-test:${randomUUID()}:`;
  process.env.UPSTASH_KEY_PREFIX = prefix;
  const raw = (args: Array<string | number>) => command(port, args);
  if (await raw(['PING']) !== 'PONG') throw new Error('Isolated Redis unavailable');
  let intercept: ((args: Array<string | number>, execute: typeof raw) => Promise<unknown>) | undefined;
  const encode = (value: unknown): unknown => Array.isArray(value) ? value.map(encode)
    : typeof value === 'string' && value !== 'OK' ? Buffer.from(value).toString('base64') : value;
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const commands = req.url?.includes('pipeline') ? JSON.parse(body) : [JSON.parse(body)];
      const results = [];
      for (const args of commands) {
        try {
          const result = await (intercept ? intercept(args, raw) : raw(args));
          results.push({ result: req.headers['upstash-encoding'] === 'base64' ? encode(result) : result });
        } catch (error) { results.push({ error: String(error) }); }
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url?.includes('pipeline') ? results : results[0]));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing REST bridge address');
  const url = `http://127.0.0.1:${address.port}`;
  process.env.UPSTASH_REDIS_REST_URL = url;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'isolated-test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!target.startsWith(url + '/') && target !== url) throw new Error('External network disabled in isolated Redis regression: ' + new URL(target).hostname);
    return realFetch(input, init);
  };
  return { prefix, raw, setInterceptor: (handler?: typeof intercept) => { intercept = handler; },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      globalThis.fetch = realFetch;
      // Delete only this run's namespaced keys; never FLUSHDB.
      const keys = await raw(['KEYS', `${prefix}*`]) as string[];
      if (keys.length) await raw(['DEL', ...keys]);
    },
  };
}
