/** Exact record comparison includes the lease owner, phase, prepared hash, and signature. */
export const AIRDROP_CAS_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

// Prefix the result so Upstash's automatic JSON deserialization cannot change
// whitespace/property order before the next byte-exact comparison.
export const AIRDROP_RAW_PREFIX = 'airdrop-raw:';
export const AIRDROP_READ_RAW_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return false end
return '${AIRDROP_RAW_PREFIX}' .. value
`;

/** Admin changes may only touch records which have never entered a claim attempt. */
export const AIRDROP_ADMIN_CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'missing' then
  if current then return 0 end
elseif not current or current ~= ARGV[2] then return 0 end
local function unattempted(raw)
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return false end
  local allowed = {seed=true, leaf=true, pixotchi=true, claimed=true, status=true, createdAt=true}
  for field, _ in pairs(value) do if not allowed[field] then return false end end
  if value.claimed ~= nil and value.claimed ~= false then return false end
  if value.status ~= nil and value.status ~= 'eligible' then return false end
  return true
end
if current and not unattempted(current) then return -1 end
if ARGV[3] == 'delete' then
  if not current then return 0 end
  redis.call('DEL', KEYS[1])
elseif ARGV[3] == 'set' and unattempted(ARGV[4]) then
  redis.call('SET', KEYS[1], ARGV[4])
else return -1 end
return 1
`;
