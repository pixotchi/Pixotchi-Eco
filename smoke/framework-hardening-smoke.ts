import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const webhook = projectFile("app/api/webhook/route.ts");
assert.match(webhook, /const bodyText = await request\.text\(\);/);
assert.match(webhook, /parsedBody = JSON\.parse\(bodyText\);/);
assert.match(webhook, /parseWebhookEvent as UntypedValue\)\(parsedBody,/);
assert.match(webhook, /\.update\(`\$\{timestamp\}\.\$\{bodyText\}`\)/);
assert.match(webhook, /parsed\.appFid !== expectedAppFid/);

const bridgeDebugAccess = projectFile("lib/bridge-debug-access.ts");
assert.match(
  bridgeDebugAccess,
  /process\.env\.NODE_ENV !== 'production' && isLocalhostRequest\(request\)/,
);
assert.match(bridgeDebugAccess, /require admin authentication in production/);

const layout = projectFile("app/layout.tsx");
assert.match(layout, /from "@vercel\/analytics\/next"/);
assert.doesNotMatch(layout, /from "@vercel\/analytics\/react"/);

const hostEnvironment = projectFile("lib/host-environment.tsx");
assert.match(hostEnvironment, /const miniAppSignalPromise = \(async \(\) =>/);
assert.match(hostEnvironment, /const \[initialContext, isMiniApp\] = await Promise\.all\(\[/);
assert.doesNotMatch(
  hostEnvironment,
  /const initialContext = await withTimeout\([\s\S]*?let isMiniApp = false/,
);

console.log("Framework hardening smoke checks passed.");
