import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectFile = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  'utf8',
);

const statusRoute = projectFile('app/api/status/checks/route.ts');
const statusChecks = projectFile('lib/status-checks.ts');
const instrumentation = projectFile('instrumentation.ts');

assert.match(statusRoute, /import \{ verifyVercelCron \} from '@\/lib\/notifications\/cron-auth';/);
assert.match(statusRoute, /export async function GET\(request: NextRequest\)/);
assert.match(statusRoute, /const isCron = verifyVercelCron\(request\);/);
assert.match(statusRoute, /if \(authorization && !isCron\)[\s\S]*?status: 401/);
assert.match(statusRoute, /isCron[\s\S]*?getCachedStatusSnapshot\(true\)[\s\S]*?getStoredStatusSnapshot\(\)/);
assert.doesNotMatch(statusRoute, /message:\s*error\?\.message/);

assert.match(
  statusChecks,
  /export async function getStoredStatusSnapshot\(\): Promise<StatusSnapshot \| null>/,
  'public status reads must not launch a health sweep',
);
assert.match(instrumentation, /export const onRequestError: Instrumentation\.onRequestError/);
assert.match(instrumentation, /routePath: context\.routePath/);
assert.match(instrumentation, /safeDigest\(error\)/);
assert.doesNotMatch(instrumentation, /request\.headers|request\.path|error\.message|error\.stack/);

console.log('Status cron authentication and observability smoke checks passed.');
