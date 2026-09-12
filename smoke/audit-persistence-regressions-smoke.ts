import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NextRequest } from 'next/server';
import { createSiweMessage } from 'viem/siwe';
import { privateKeyToAccount } from 'viem/accounts';
import { isolatedRedis } from './helpers/isolated-redis';

async function main() {
  const db = await isolatedRedis();
  try {
    const auth = await import('../lib/chat-auth');
    const gm = await import('../lib/gamification-service');
    const { createEnsLookupHandler } = await import('../lib/ens-request');
    const { getBaseReadClient } = await import('../lib/base-rpc');
    const user = `0x${'1'.repeat(40)}`;
    const other = `0x${'2'.repeat(40)}`;
    const req = (id?: string) => new NextRequest('http://localhost:3000/api/chat', { headers: id ? { cookie: `pixotchi_chat_session=${id}` } : {} });
    const identity = { address: user, provider: 'base', method: 'base-siwe' } as const;
    const created = await auth.createChatSessionResponse(req(), identity);
    const id = created.cookies.get('pixotchi_chat_session')!.value;
    const key = `${db.prefix}chat:auth:session:${id}`;
    assert.equal((await auth.getChatSessionFromRequest(req(id))).session?.address, user);
    db.setInterceptor(async (args, run) => {
      if (String(args[0]).toUpperCase() === 'EXPIRE' && args[1] === key) await run(['DEL', key]);
      return run(args);
    });
    assert.equal((await auth.getChatSessionFromRequest(req(id))).session, null, 'Logout between GET and EXPIRE cannot be undone');
    assert.equal(await db.raw(['EXISTS', key]), 0);
    db.setInterceptor();
    const second = await auth.createChatSessionResponse(req(), identity);
    const secondId = second.cookies.get('pixotchi_chat_session')!.value;
    db.setInterceptor(async (args, run) => { if (String(args[0]).toUpperCase() === 'EVAL') throw new Error('Injected rotation failure'); return run(args); });
    await assert.rejects(auth.createChatSessionResponse(req(secondId), identity), { status: 503 });
    assert.equal(await db.raw(['EXISTS', `${db.prefix}chat:auth:session:${secondId}`]), 1, 'Failed rotation retains old session');
    db.setInterceptor();
    const rotated = await auth.createChatSessionResponse(req(secondId), identity);
    assert.equal(await db.raw(['EXISTS', `${db.prefix}chat:auth:session:${secondId}`]), 0);
    assert.ok((await auth.getChatSessionFromRequest(req(rotated.cookies.get('pixotchi_chat_session')!.value))).session);
    db.setInterceptor(async (args, run) => { if (String(args[0]).toUpperCase() === 'DEL') throw new Error('Injected logout failure'); return run(args); });
    await assert.rejects(auth.clearChatSessionForRequest(req(secondId)), { status: 503 });
    db.setInterceptor();

    // Signature verification is tested elsewhere; isolate the nonce's actual Redis atomicity.
    const client = getBaseReadClient();
    const originalVerify = client.verifyMessage;
    client.verifyMessage = async () => true;
    try {
      const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
      const nonce = await auth.issueBaseAuthNonce();
      const message = createSiweMessage({ address: signer.address, domain: 'localhost:3000', uri: 'http://localhost:3000', version: '1', chainId: 8453, nonce });
      const payload = { address: signer.address, message, signature: await signer.signMessage({ message }) };
      db.setInterceptor(async (args, run) => { if (String(args[0]).toUpperCase() === 'EVAL') throw new Error('Injected nonce EVAL failure'); return run(args); });
      await assert.rejects(auth.verifyBaseChatIdentity(req(), payload), { status: 503 });
      assert.equal(await db.raw(['EXISTS', `${db.prefix}chat:auth:base:nonce:${nonce}`]), 1, 'No GET+DEL fallback consumes nonce on EVAL outage');
      db.setInterceptor();
      const claims = await Promise.allSettled(Array.from({ length: 12 }, () => auth.verifyBaseChatIdentity(req(), payload)));
      assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1, 'Only one nonce claim succeeds');
    } finally { client.verifyMessage = originalVerify; }

    const day = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const oldDay = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const streakKey = `${db.prefix}pixotchi:gm:streak:${user}`;
    await db.raw(['SET', streakKey, JSON.stringify({ current: 4, best: 10, lastActive: yesterday })]);
    const streaks = await Promise.all(Array.from({ length: 24 }, () => gm.trackDailyActivity(user)));
    assert.ok(streaks.every(s => s.current === 5 && s.best === 10));
    await gm.normalizeStreakIfMissed(user, { current: 4, best: 4, lastActive: oldDay });
    assert.equal((await gm.getStreak(user)).current, 5, 'Stale normalization never writes over today');
    await db.raw(['SET', `${db.prefix}pixotchi:gm:streak:${other}`, JSON.stringify({ current: 4, best: 10, lastActive: oldDay })]);
    assert.equal((await gm.getStreak(other)).current, 0, 'Missed streak displays zero without a write');

    assert.ok((await gm.getLeaderboards()).streakTop.some(entry => entry.address === user && entry.value === 10), 'Custom prefixes preserve combined streak leaderboard reads');

    const hash = `0x${'a'.repeat(64)}`;
    const proof = { txHash: hash, evidenceIds: ['log:0'] };
    const first = await gm.markMissionTask(user, 's4_buy10_elements', proof, 2);
    assert.equal(first.s4.buyElementsCount, 2);
    await Promise.all(Array.from({ length: 12 }, () => gm.markMissionTask(user, 's4_buy10_elements', proof, 2)));
    assert.equal((await gm.getMissionDay(user)).s4.buyElementsCount, 2, 'Counted transaction retries are idempotent');
    assert.equal(await db.raw(['EXISTS', `${db.prefix}pixotchi:gm:missions:proof-used:${hash}`]), 1,
      'Old deployed workers still see a transaction-wide replay guard');
    assert.equal(await gm.getMissionProofReplay(other, 's4_buy10_elements', hash), null,
      'New workers ignore the compatibility marker and validate their own event');
    await gm.markMissionTask(other, 's4_buy10_elements', { txHash: hash, evidenceIds: ['log:1'] }, 3);
    assert.equal((await gm.getMissionDay(other)).s4.buyElementsCount, 3, 'Different actors in one receipt retain independent events');
    const third = `0x${'3'.repeat(40)}`;
    await assert.rejects(gm.markMissionTask(third, 's4_buy10_elements', proof, 2), gm.MissionProofAlreadyUsedError);
    await gm.markMissionTask(user, 's1_stake_seed', { txHash: hash, evidenceIds: ['log:2'] });
    assert.equal((await gm.getMissionDay(user)).s1.stakeSeed, true, 'Independent actions in one atomic wallet batch count');
    assert.ok(await gm.getMissionProofReplay(user, 's4_buy10_elements', hash));
    await gm.markMissionTask(user, 's2_follow_player');
    await gm.markMissionTask(user, 's2_visit_profile');
    const leaderboard = `${db.prefix}pixotchi:gm:missions:leaderboard:${day.replaceAll('-', '').slice(0, 6)}`;
    await db.raw(['SET', leaderboard, 'wrong-type']);
    await assert.rejects(gm.markMissionTask(user, 's2_chat_message'), gm.MissionProofPersistenceError);
    assert.equal((await gm.getMissionDay(user)).s2.chatMessage, false, 'No mission write survives a leaderboard failure');
    await db.raw(['DEL', leaderboard]);
    const awarded = await gm.markMissionTask(user, 's2_chat_message');
    assert.equal(awarded.pts, 20);
    assert.equal(Number(await db.raw(['ZSCORE', leaderboard, user])), 20);
    await gm.markMissionTask(user, 's2_chat_message');
    assert.equal(Number(await db.raw(['ZSCORE', leaderboard, user])), 20, 'Atomic points are credited exactly once');

    let upstream = 0;
    const handler = createEnsLookupHandler('names', async addresses => { upstream++; return Object.fromEntries(addresses.map(a => [a, null])); });
    const lookup = (body: string) => handler(new NextRequest('http://localhost:3000/api/ens/resolve', { method: 'POST', body }));
    assert.equal((await lookup(JSON.stringify({ addresses: Array(51).fill(user) }))).status, 413);
    assert.equal((await lookup(' '.repeat(8193))).status, 413, 'Actual body limit works without Content-Length');
    assert.equal((await lookup(JSON.stringify({ addresses: [user, 'bad'] }))).status, 400);
    assert.equal(upstream, 0);
    assert.equal((await lookup(JSON.stringify({ addresses: [user, user] }))).status, 200);
    assert.equal(upstream, 1);
    const window = Math.floor(Date.now() / 60000);
    assert.equal(Number(await db.raw(['GET', `${db.prefix}ratelimit:api:ens:global:all:${window}`])), 1, 'Deduplicated work is charged');
    await db.raw(['SET', `${db.prefix}ratelimit:api:ens:ip:unknown:${window}`, '300']);
    assert.equal((await lookup(JSON.stringify({ addresses: [user] }))).status, 429);
    db.setInterceptor(async (args, run) => { if (String(args[0]).toUpperCase() === 'EVAL') throw new Error('Injected quota outage'); return run(args); });
    assert.equal((await lookup(JSON.stringify({ addresses: [user] }))).status, 503);
    assert.equal(upstream, 1, 'Quota outage does not make provider calls');
    db.setInterceptor();
    const ai = await import('../lib/ai-service');
    const aiAddress = `0x${randomUUID().replaceAll('-', '').padEnd(40, '0')}`;
    const conversations = await Promise.all(Array.from({ length: 16 }, () => ai.getOrCreateConversation(aiAddress, 'Hello')));
    assert.equal(new Set(conversations).size, 1, 'Concurrent first requests create exactly one conversation');
    const conversationId = conversations[0];
    assert.equal((await db.raw(['KEYS', `ai:conversations:${aiAddress}:*`]) as string[]).length, 1);
    await Promise.all(Array.from({ length: 20 }, (_, index) => ai.storeAIMessage(aiAddress, `message ${index}`, 'user', conversationId, 7)));
    assert.equal((await ai.getAIConversationForAddress(aiAddress, conversationId))?.messageCount, 20);
    assert.equal((await ai.getAIConversationForAddress(aiAddress, conversationId))?.totalTokens, 140);
    await Promise.all(Array.from({ length: 12 }, () => ai.storeAIMessage(aiAddress, 'retry', 'assistant', conversationId, 9, { messageId: 'stable-test-id' })));
    assert.equal((await ai.getAIConversationForAddress(aiAddress, conversationId))?.messageCount, 21);
    assert.equal((await ai.getAIConversationForAddress(aiAddress, conversationId))?.totalTokens, 149);
    assert.equal((await ai.getAIConversationMessages(conversationId)).length, 21, 'Message index contains each committed ID once');
    // A limited first read must migrate all old messages, including a concurrent append.
    await db.raw(['DEL', `ai:conversation_messages:${conversationId}`, `ai:conversation_index_complete:${conversationId}`]);
    const smallHistory = await ai.getAIConversationMessages(conversationId, 1);
    assert.equal(smallHistory.length, 1);
    assert.equal((await ai.getAIConversationMessages(conversationId, 100)).length, 21, 'A limited migration does not hide older messages');
    assert.equal((await db.raw(['LRANGE', `ai:conversation_messages:${conversationId}`, '0', '-1']) as string[]).length, 21);
    const beforeKeys = (await db.raw(['KEYS', 'ai:*']) as string[]).sort();
    db.setInterceptor(async (args, run) => { if (['GET', 'LRANGE', 'SCAN'].includes(String(args[0]).toUpperCase())) throw new Error('Injected AI storage outage'); return run(args); });
    await assert.rejects(ai.getAIConversationMessages(conversationId));
    await assert.rejects(ai.getAIConversationForAddress(aiAddress, conversationId));
    await assert.rejects(ai.getOrCreateConversation(aiAddress));
    db.setInterceptor();
    assert.deepEqual((await db.raw(['KEYS', 'ai:*']) as string[]).sort(), beforeKeys, 'Read failure creates no replacement conversation');
    assert.equal(await ai.deleteAIConversation(conversationId), true);
    assert.deepEqual(await db.raw(['KEYS', `ai:message_commit:${conversationId}:*`]), [], 'Deletion removes message commit pointers too');

    const { createAIRequestSignal } = await import('../lib/ai-request-deadline');
    const { abortable } = await import('../lib/abortable');
    const { executeReadOnlyAITool } = await import('../lib/ai-read-tools');
    const workSignal = createAIRequestSignal(new AbortController().signal, 60);
    await abortable(delay(35), workSignal); // planning used part of the same deadline
    await assert.rejects(abortable(delay(100), workSignal), { name: 'TimeoutError' });
    let toolCalls = 0;
    const tools = { slow: { execute: async () => { toolCalls++; await delay(100); return {}; } } };
    await assert.rejects(executeReadOnlyAITool(tools, 'slow', {}, { userAddress: user }, workSignal), { name: 'TimeoutError' });
    assert.equal(toolCalls, 0, 'Expired budget cannot start another tool or continuation');
    await assert.rejects(executeReadOnlyAITool(tools, 'slow', {}, { userAddress: user }, createAIRequestSignal(new AbortController().signal, 10)), { name: 'TimeoutError' });
    assert.equal(toolCalls, 1, 'In-flight read stops delaying the request after the deadline');

    const { parseBaseNotificationOutcome, confirmedBaseRecipients } = await import('../lib/notifications/delivery-outcome');
    for (const payload of [null, {}, { success: true }, { sentCount: 0, failedCount: 0 }, { sentCount: -1, failedCount: 3 }, { sentCount: 2, failedCount: 0, results: [{ walletAddress: user, sent: true }] }, { results: [{ walletAddress: user, sent: true }, { walletAddress: user, sent: true }] }]) {
      assert.throws(() => parseBaseNotificationOutcome(payload, [user, other]), { status: 502 });
    }
    const all = parseBaseNotificationOutcome({ sentCount: 2, failedCount: 0 }, [user, other]);
    assert.deepEqual(confirmedBaseRecipients(all, [user, other]), [user, other]);
    const partial = parseBaseNotificationOutcome({ results: [{ walletAddress: user, sent: true }, { walletAddress: other, sent: false }] }, [user, other]);
    assert.deepEqual(confirmedBaseRecipients(partial, [user, other]), [user]);
    assert.deepEqual(confirmedBaseRecipients(parseBaseNotificationOutcome({ sentCount: 1, failedCount: 1 }, [user, other]), [user, other]), [], 'Aggregate partial delivery cannot identify recipients to throttle');
    assert.deepEqual(confirmedBaseRecipients({ success: true, sentCount: 0, failedCount: 0, results: [], raw: {} }, [user, other]), [], 'Downstream guard rejects unproven delivery too');

    const { createBatchedAddressResolver } = await import('../components/hooks/createBatchedAddressResolver');
    const priorFetch = globalThis.fetch;
    const batchSizes: number[] = [];
    globalThis.fetch = async (_input, init) => {
      const addresses = (JSON.parse(String(init?.body)) as { addresses: string[] }).addresses;
      batchSizes.push(addresses.length);
      return Response.json({ names: Object.fromEntries(addresses.map(address => [address, 'test.base.eth'])) });
    };
    try {
      const resolver = createBatchedAddressResolver({ endpoint: '/test-ens', responseKey: 'names', logLabel: 'audit-test' });
      const addresses = Array.from({ length: 120 }, (_, index) => `0x${index.toString(16).padStart(40, '0')}`);
      const resolved = addresses.map(address => new Promise<string | null>(resolve => { resolver.waitForResult(address, resolve); resolver.enqueue(address); }));
      assert.ok((await Promise.all(resolved)).every(value => value === 'test.base.eth'));
      assert.deepEqual(batchSizes, [50, 50, 20], 'Client batches respect the server cap while draining every subscriber');
    } finally { globalThis.fetch = priorFetch; }
    console.log('AI persistence/deadline, notification delivery and client lookup batching regressions passed.');
    console.log('Audit regressions passed against isolated Redis: session revocation/rotation, nonce races, streak concurrency, mission event identities/retries/atomic leaderboard, bounded lookup requests and quotas.');
  } finally { await db.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
