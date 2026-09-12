/** Conversation scripts validate Redis types before writing because Lua errors do not roll back. */
export const SELECT_AI_CONVERSATION_LUA = `
local active = redis.call('GET', KEYS[1])
if active then
  local existing = redis.call('GET', ARGV[3] .. active)
  if existing then
    local record = cjson.decode(existing)
    if type(record) ~= 'table' or record.id ~= active or record.address ~= ARGV[4] then
      return redis.error_reply('Invalid active conversation')
    end
    return active
  end
end
local indexType = redis.call('TYPE', KEYS[2]).ok
if indexType ~= 'none' and indexType ~= 'set' then return redis.error_reply('Invalid conversation index') end
local legacy = redis.call('GET', KEYS[4])
local record = cjson.decode(legacy or ARGV[1])
if type(record) ~= 'table' or type(record.id) ~= 'string' or record.address ~= ARGV[4] then
  return redis.error_reply('Invalid conversation')
end
local chosenKey = legacy and KEYS[4] or KEYS[3]
if not legacy then redis.call('SET', chosenKey, ARGV[1], 'EX', ARGV[2]) end
redis.call('SET', KEYS[1], record.id, 'EX', ARGV[2])
redis.call('SADD', KEYS[2], chosenKey)
return record.id
`;

export const STORE_AI_MESSAGE_LUA = `
for i, key in ipairs(KEYS) do
  local kind = redis.call('TYPE', key).ok
  local wanted = i == 2 and 'list' or 'string'
  if kind ~= 'none' and kind ~= wanted then return redis.error_reply('Invalid conversation storage type') end
end
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('Conversation no longer exists') end
local conversation = cjson.decode(raw)
local message = cjson.decode(ARGV[1])
if type(conversation) ~= 'table' or conversation.id ~= message.conversationId or conversation.address ~= message.address
  or type(conversation.messageCount) ~= 'number' or type(conversation.totalTokens) ~= 'number'
  or type(conversation.lastMessageAt) ~= 'number' or conversation.messageCount < 0 or conversation.totalTokens < 0 then
  return redis.error_reply('Invalid conversation metadata')
end
local previous = redis.call('GET', KEYS[4])
if previous then
  local committed = redis.call('GET', previous)
  if not committed then return redis.error_reply('Committed message no longer exists') end
  return committed
end
conversation.lastMessageAt = math.max(conversation.lastMessageAt, message.timestamp)
conversation.messageCount = conversation.messageCount + 1
conversation.totalTokens = conversation.totalTokens + message.tokensUsed
local metadata = cjson.encode(conversation)
redis.call('SET', KEYS[1], metadata, 'EX', ARGV[2])
redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[4], KEYS[3], 'EX', ARGV[2])
redis.call('RPUSH', KEYS[2], KEYS[3])
redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('EXPIRE', KEYS[6], ARGV[2])
if redis.call('GET', KEYS[5]) == message.conversationId then redis.call('EXPIRE', KEYS[5], ARGV[2]) end
return ARGV[1]
`;

// Backfill the complete legacy index once, preserving messages appended during SCAN.
export const MIGRATE_AI_MESSAGE_INDEX_LUA = `
local kind = redis.call('TYPE', KEYS[1]).ok
if kind ~= 'none' and kind ~= 'list' then return redis.error_reply('Invalid message index') end
if redis.call('EXISTS', KEYS[2]) == 1 then return 1 end
local legacy = cjson.decode(ARGV[1])
local current = redis.call('LRANGE', KEYS[1], 0, -1)
local seen = {}
local merged = {}
for _, list in ipairs({legacy, current}) do
  for _, key in ipairs(list) do
    if type(key) ~= 'string' or string.sub(key, 1, #ARGV[3]) ~= ARGV[3] then return redis.error_reply('Invalid message index entry') end
    if not seen[key] then seen[key] = true; table.insert(merged, key) end
  end
end
table.sort(merged)
redis.call('DEL', KEYS[1])
for _, key in ipairs(merged) do redis.call('RPUSH', KEYS[1], key) end
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
return 1
`;
