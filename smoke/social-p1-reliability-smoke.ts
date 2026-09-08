import assert from 'node:assert/strict';
import { Chat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { AiSendAttempt } from '../lib/ai-send-outcome';
import { OwnerOperationScope } from '../lib/owner-operation-scope';
import { assertKillReadiness, assertReviveReadiness, readReviveReadiness } from '../lib/ranking-action-readiness';
import { getKillCooldown, type PixotchiReadClient } from '../lib/contracts';

async function main() {
  // A slow A response remains invalid even after switching back to A.
  const scope = new OwnerOperationScope('a');
  const a = scope.capture();
  scope.setOwner('b');
  const b = scope.capture();
  assert.equal(a.isCurrent(), false);
  scope.setOwner('a');
  assert.equal(a.isCurrent(), false);
  assert.equal(b.isCurrent(), false);
  const current = scope.capture();
  assert.equal(current.isCurrent(), true);
  scope.invalidate();
  assert.equal(current.isCurrent(), false);

  assert.throws(() => assertKillReadiness({ canKill: false, remainingSeconds: 900 }), /cooldown/);
  assert.throws(() => assertKillReadiness({ canKill: true, remainingSeconds: 1 }), /cooldown/);
  assert.doesNotThrow(() => assertKillReadiness({ canKill: true, remainingSeconds: 0 }));
  const cooldownClient = (results: unknown[]) => ({ multicall: async () => results }) as unknown as PixotchiReadClient;
  const success = (result: unknown) => ({ status: 'success', result });
  await assert.rejects(getKillCooldown('a', cooldownClient([{ status: 'failure' }, success(BigInt(0))])), /unavailable/);
  await assert.rejects(getKillCooldown('a', cooldownClient([success(true), { status: 'failure' }])), /unavailable/);
  await assert.rejects(getKillCooldown('a', cooldownClient([success(true), success(-1)])), /invalid/);
  assert.deepEqual(await getKillCooldown('a', cooldownClient([success(false), success(BigInt(900))])), { canKill: false, remainingSeconds: 900 });

  await assert.rejects(readReviveReadiness('a', async () => BigInt(200), async () => { throw new Error('RPC unavailable'); }), /RPC unavailable/);
  await assert.rejects(readReviveReadiness('a', async () => { throw new Error('Balance unavailable'); }, async () => BigInt(100)), /Balance unavailable/);
  const paid = await readReviveReadiness('b', async owner => { assert.equal(owner, 'b'); return BigInt(200); }, async () => BigInt(100));
  assert.doesNotThrow(() => assertReviveReadiness(paid, BigInt(100)));
  assert.throws(() => assertReviveReadiness(paid, BigInt(90)), /cost changed/);
  assert.throws(() => assertReviveReadiness({ balance: BigInt(99), price: BigInt(100) }, BigInt(100)), /Not enough/);
  const free = await readReviveReadiness('a', async () => BigInt(0), async () => BigInt(0));
  assert.doesNotThrow(() => assertReviveReadiness(free, BigInt(0)));

  // Exercise the installed SDK, not a fake promise that rejects differently.
  for (const outcome of ['failed', 'accepted'] as const) {
    const attempt = new AiSendAttempt();
    const transport: ChatTransport<UIMessage> = {
      sendMessages: async () => {
        if (outcome === 'failed') throw new Error('Unauthorized 401');
        return new ReadableStream<UIMessageChunk>({ start(controller) {
          controller.enqueue({ type: 'start', messageId: 'answer' });
          controller.enqueue({ type: 'finish', finishReason: 'stop' });
          controller.close();
        } });
      },
      reconnectToStream: async () => null,
    };
    const chat = new Chat({ transport, onError: error => attempt.fail(error), onFinish: result => attempt.finish(result) });
    await chat.sendMessage({ text: 'Preserve this question' });
    assert.equal(attempt.outcome().status, outcome);
    if (outcome === 'failed') assert.equal(chat.status, 'error', 'SDK resolves despite transport failure');
  }
  const stopped = new AiSendAttempt();
  stopped.finish({ isAbort: true, isError: false, isDisconnect: false });
  assert.equal(stopped.outcome().status, 'cancelled');
  assert.equal(new AiSendAttempt().outcome().status, 'failed', 'Missing completion must never clear a draft');
  console.log('Social P1 reliability smoke passed: owner races, kill cooldown, revive reads/preflight, installed AI SDK outcomes.');
}
void main();
