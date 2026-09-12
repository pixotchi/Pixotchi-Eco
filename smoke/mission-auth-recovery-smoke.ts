import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

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

const browserEvents = new EventTarget();
const documentEvents = new EventTarget();
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
localStorage.setItem("pixotchi:authSurface", "privy");
Object.assign(browserEvents, {
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  localStorage,
  parent: browserEvents,
  postMessage: () => {},
  setTimeout: globalThis.setTimeout.bind(globalThis),
});
Object.assign(documentEvents, { visibilityState: "visible" });
Object.assign(globalThis, {
  document: documentEvents,
  addEventListener: browserEvents.addEventListener.bind(browserEvents),
  localStorage,
  removeEventListener: browserEvents.removeEventListener.bind(browserEvents),
  sessionStorage,
  window: browserEvents,
});

async function main() {
  const {
  PUBLIC_CHAT_SESSION_REFRESH_REQUEST_EVENT,
  emitPublicChatSessionRefreshResult,
  } = await import("../lib/public-chat-session-refresh");
  const {
  MISSION_TRACKING_EVENT,
  onMissionTrackingEvent,
  postMissionProgress,
  } = await import("../lib/mission-tracking");

const address = "0x1111111111111111111111111111111111111111";
let missionFetchCount = 0;
let recoveryRequestCount = 0;
let keepRetryUnauthorized = false;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  assert.equal(String(input), "/api/gamification/missions");
  missionFetchCount += 1;
  if (missionFetchCount === 1 || keepRetryUnauthorized) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  return Response.json({ success: true });
};

browserEvents.addEventListener(
  PUBLIC_CHAT_SESSION_REFRESH_REQUEST_EVENT,
  ((event: Event) => {
    const detail = (event as CustomEvent<{
      expectedAddress: string;
      requestId: string;
      surface: string;
    }>).detail;
    recoveryRequestCount += 1;
    assert.equal(detail.expectedAddress, address);
    assert.equal(detail.surface, "privy");
    emitPublicChatSessionRefreshResult({
      requestId: detail.requestId,
      status: "success",
    });
  }) as EventListener,
);

const recovered = await postMissionProgress({ address, taskId: "s2_visit_profile" });
assert.equal(recovered.status, 200);
assert.equal(missionFetchCount, 2, "a 401 must result in exactly one authenticated retry");
assert.equal(recoveryRequestCount, 1, "Privy recovery must be requested once");

missionFetchCount = 0;
recoveryRequestCount = 0;
keepRetryUnauthorized = true;
const visibleErrors: Array<{ message?: string; status: string }> = [];
const unsubscribe = onMissionTrackingEvent((detail) => {
  if (detail.payload.address === address && detail.status === "error") {
    visibleErrors.push(detail);
  }
});

await assert.rejects(
  postMissionProgress({
    address,
    count: 1,
    taskId: "s4_buy10_elements",
  }),
);
assert.equal(missionFetchCount, 2, "a second 401 must not trigger a third mission request");
assert.equal(recoveryRequestCount, 1, "a second 401 must not trigger another recovery loop");
const visibleError = visibleErrors.at(-1);
assert.equal(visibleError?.status, "error", "non-queueable failures must remain visible");
assert.match(visibleError?.message ?? "", /Authentication required/i);
unsubscribe();
const replayedErrors: Array<{ status: string }> = [];
const unsubscribeReplay = onMissionTrackingEvent((detail) => {
  if (detail.payload.address === address && detail.status === "error") {
    replayedErrors.push(detail);
  }
});
assert.equal(
  replayedErrors.at(-1)?.status,
  "error",
  "the latest address-bound error must be replayed to a late-mounted notice UI",
);
unsubscribeReplay();
// Verified transaction identities now make counted mission retries safe too.
missionFetchCount = 0;
recoveryRequestCount = 0;
const queued = await postMissionProgress({ address, count: 1,
  proof: { txHash: `0x${"1".repeat(64)}` }, taskId: "s4_buy10_elements" });
assert.equal(queued.status, 202);
assert.equal(missionFetchCount, 2);
assert.equal(recoveryRequestCount, 1);
localStorage.clear();

globalThis.fetch = originalFetch;

const missionSource = readFileSync(
  new URL("../lib/mission-tracking.ts", import.meta.url),
  "utf8",
);
assert.match(missionSource, /surface: "farcaster"/);
assert.match(missionSource, /surface === "privy" \|\| surface === "privysolana"/);
assert.match(missionSource, /return await postMissionRequest\(payload\)/);

const providerSource = readFileSync(
  new URL("../components/chat/chat-context.tsx", import.meta.url),
  "utf8",
);
assert.match(
  providerSource,
  /expectedAddress !== connectedAddress[\s\S]*status: 'ignored'/,
  "recovery must retain exact connected-wallet binding",
);
assert.match(
  providerSource,
  /detail\.surface === 'farcaster'[\s\S]*sdk\.quickAuth\.getToken\(\)[\s\S]*createFarcasterPublicChatSession/,
);
assert.match(
  providerSource,
  /createPrivyPublicChatSession\([\s\S]*expectedAddress[\s\S]*nextSession\.address\.toLowerCase\(\) !== expectedAddress/,
);
const providerRefreshSource = readFileSync(
  new URL("../lib/public-chat-session-refresh.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  providerRefreshSource,
  /base-chat-session-refresh|SIWE/i,
  "Privy and Farcaster recovery must not depend on the Base SIWE bridge",
);
assert.notEqual(MISSION_TRACKING_EVENT, PUBLIC_CHAT_SESSION_REFRESH_REQUEST_EVENT);

  console.log("mission auth recovery smoke: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
