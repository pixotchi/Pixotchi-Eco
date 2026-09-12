/** Admission and persistence share one atomic operation. Validate all data and
 * Redis types before the first write: Lua does not roll back runtime errors. */
export const STORE_PUBLIC_CHAT_MESSAGE_LUA = `
for i, key in ipairs(KEYS) do
  local kind = redis.call('TYPE', key).ok
  local expected = i == 2 and 'zset' or 'string'
  if kind ~= 'none' and kind ~= expected then return redis.error_reply('Invalid chat storage type') end
end
local now = tonumber(ARGV[1])
local message = cjson.decode(ARGV[2])
local old = redis.call('GET', KEYS[1])
if old then
  local stored = cjson.decode(old)
  if stored.address ~= message.address or stored.message ~= message.message then return {-3, ''} end
  return {1, old}
end
local prior = redis.call('GET', KEYS[3])
if prior then
  local rate = cjson.decode(prior)
  if not tonumber(rate.lastMessage) then return redis.error_reply('Invalid chat cooldown') end
  if now - tonumber(rate.lastMessage) < tonumber(ARGV[3]) then return {-1, ''} end
end
local spam = {count=0, addresses={}}
local rawSpam = redis.call('GET', KEYS[4])
if rawSpam then
  spam = cjson.decode(rawSpam)
  if type(spam.addresses) ~= 'table' or not tonumber(spam.count) then return redis.error_reply('Invalid chat duplicate record') end
  for _, actor in ipairs(spam.addresses) do
    if actor == message.address then return {-2, ''} end
  end
  if tonumber(spam.count) >= 3 then return {-2, ''} end
end
spam.count = spam.count + 1
table.insert(spam.addresses, message.address)
local nextSpam = cjson.encode(spam)
local nextRate = cjson.encode({lastMessage=now, messageCount=1})
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('ZADD', KEYS[2], now, KEYS[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - tonumber(ARGV[4])*1000)
redis.call('SET', KEYS[3], nextRate, 'EX', ARGV[5])
redis.call('SET', KEYS[4], nextSpam, 'EX', ARGV[6])
return {1, ARGV[2]}
`;

export class ChatAdmissionError extends Error {
  constructor(readonly reason: 'cooldown' | 'duplicate' | 'idempotency_conflict') {
    super(reason === 'cooldown' ? 'Please wait before sending another message.'
      : reason === 'duplicate' ? 'Duplicate or spam message detected'
        : 'This message ID was already used for a different message.');
  }
}

export const DELETE_PUBLIC_CHAT_MESSAGE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local message = cjson.decode(raw)
if message.id ~= ARGV[1] or tonumber(message.timestamp) ~= tonumber(ARGV[2]) then return 0 end
local indexType = redis.call('TYPE', KEYS[2]).ok
if indexType ~= 'none' and indexType ~= 'zset' then return redis.error_reply('Invalid chat index') end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], KEYS[1])
return 1
`;
