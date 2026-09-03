import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectFile = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  "utf8",
);

const authController = projectFile("hooks/useAppAuthController.ts");
const localTestConnector = projectFile("lib/local-test-connector.ts");

assert.match(
  authController,
  /state\.surface === "test" && storedAuto === "test" && isLocalTestAuthAllowed\(\)/,
  "local test autologin must require the explicit one-shot login marker",
);
assert.match(
  localTestConnector,
  /async disconnect\(\) \{\s*connected = false;\s*config\.emitter\.emit\("disconnect"\);/,
  "the local connector must publish its disconnected state immediately",
);
assert.match(
  localTestConnector,
  /async isAuthorized\(\) \{\s*return isLocalTestAuthAllowed\(\);/,
  "normal localhost reloads must remain reconnectable after one-shot autologin settles",
);

console.log("Local test logout smoke checks passed.");
