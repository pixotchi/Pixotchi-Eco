import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projectFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const chatAuthClient = projectFile("lib/chat-auth-client.ts");
assert.match(chatAuthClient, /let publicChatSessionGeneration = 0/);
assert.match(
  chatAuthClient,
  /function emitPublicChatSessionEvent[\s\S]*publicChatSessionGeneration \+= 1[\s\S]*setPublicChatSessionCache/,
);
assert.match(
  chatAuthClient,
  /const requestGeneration = publicChatSessionGeneration[\s\S]*if \(publicChatSessionGeneration !== requestGeneration\)[\s\S]*if \(response\.status === 401\)/,
);

const chatContext = projectFile("components/chat/chat-context.tsx");
assert.match(chatContext, /const bootstrapRunRef = useRef\(0\)/);
assert.match(
  chatContext,
  /bootstrapRunRef\.current \+= 1;[\s\S]*publicChatSessionRef\.current = nextSession/,
);
assert.match(
  chatContext,
  /waitForBaseAuthBootstrap\([\s\S]*getCurrentPublicChatSessionForAddress\(chatAddress\)/,
);
assert.match(
  chatContext,
  /PUBLIC_CHAT_AUTO_RETRY_DELAYS_MS = \[1250, 2500, 5000\]/,
);
assert.match(
  chatContext,
  /requestBaseChatSessionRefresh\('chat-auth-failure', 15_000\)/,
);

const authController = projectFile("hooks/useAppAuthController.ts");
assert.match(
  authController,
  /ensureLocalTestWallet\(\);[\s\S]*completeBaseAuthentication\(testConnector as UntypedValue\);[\s\S]*finally[\s\S]*removeAutologin\(\)/,
);

const missionTracking = projectFile("lib/mission-tracking.ts");
assert.match(
  missionTracking,
  /getMiniAppQuickAuthHeaders\(\{[\s\S]*expectedAddress: getExpectedAddress\(payload\)/,
);
assert.match(
  missionTracking,
  /surface === ["']base["'] \|\| surface === ["']test["']/,
);
assert.match(missionTracking, /if \(response\.ok\)/);
assert.match(missionTracking, /MISSION_OUTBOX_KEY/);
assert.match(missionTracking, /typeof payload\.count !== ["']number["']/);
assert.match(
  missionTracking,
  /status: queued \? ["']queued["'] : ["']error["']/,
);

const stakingDialog = projectFile("components/staking/staking-dialog.tsx");
assert.match(stakingDialog, /refreshGenerationRef/);
assert.match(stakingDialog, /controller\.abort\(\)/);
assert.match(stakingDialog, /currentAddressRef\.current === requestAddress/);
assert.match(
  stakingDialog,
  /if \(!open \|\| !address\) \{[\s\S]*return onBalanceRefresh\(\(\) => void refresh\(\)\)/,
);
assert.match(
  stakingDialog,
  /response\.status === 202[\s\S]*Task progress is queued/,
);

const tasksDialog = projectFile("components/tasks/TasksInfoDialog.tsx");
assert.match(tasksDialog, /summaryRequestGenerationRef/);
assert.match(tasksDialog, /onMissionTrackingEvent/);
assert.match(tasksDialog, /flushMissionProgressOutbox/);

// Behavioral regression: an unauthenticated GET that began before a successful
// Base session POST must resolve to the newer authoritative session, not erase
// it when its late 401 arrives.
async function verifyLateGetCannotClobberNewSession() {
  const browserEvents = new EventTarget();
  Object.assign(browserEvents, {
    parent: browserEvents,
    postMessage: () => {},
  });
  Object.assign(globalThis, {
    addEventListener: browserEvents.addEventListener.bind(browserEvents),
    removeEventListener: browserEvents.removeEventListener.bind(browserEvents),
    window: browserEvents,
  });
  if (typeof globalThis.CustomEvent === "undefined") {
    class NodeCustomEvent<T> extends Event {
      readonly detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    }
    Object.assign(globalThis, { CustomEvent: NodeCustomEvent });
  }

  let resolveSessionGet: ((response: Response) => void) | null = null;
  let markSessionGetStarted: (() => void) | null = null;
  const sessionGetStarted = new Promise<void>((resolve) => {
    markSessionGetStarted = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const method = init?.method ?? "GET";
    if (method === "POST") {
      return Promise.resolve(
        Response.json({
          address: "0x1111111111111111111111111111111111111111",
          authenticated: true,
          method: "base-siwe",
          provider: "base",
        }),
      );
    }

    assert.equal(String(input), "/api/chat/auth/session");
    markSessionGetStarted?.();
    return new Promise<Response>((resolve) => {
      resolveSessionGet = resolve;
    });
  };

  const { createBasePublicChatSession, getCurrentPublicChatSessionForAddress } =
    await import("../lib/chat-auth-client");
  const expectedAddress = "0x1111111111111111111111111111111111111111";
  const pendingSession = getCurrentPublicChatSessionForAddress(expectedAddress);
  await sessionGetStarted;
  const createdSession = await createBasePublicChatSession({
    address: expectedAddress,
    message: "test SIWE message",
    signature: `0x${"11".repeat(65)}`,
  });
  assert.ok(resolveSessionGet, "The pre-auth session GET should be in flight.");
  (resolveSessionGet as (response: Response) => void)(
    Response.json({ error: "Authentication required." }, { status: 401 }),
  );
  assert.deepEqual(await pendingSession, createdSession);
  globalThis.fetch = originalFetch;
}

verifyLateGetCannotClobberNewSession()
  .then(() => {
    console.log(
      "Auth/session, mission, and staking hardening smoke checks passed.",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
