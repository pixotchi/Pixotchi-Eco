export type ExpiredSpin = { account: string; plantId: number; commitment: string; commitBlock: number; starsSpent: number | null };
type SpinStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = (account: string, plantId: number) => `pixotchi:spinleaf:expired:${account.toLowerCase()}:${plantId}`;

export function readExpiredSpin(storage: SpinStorage | null, account: string, plantId: number): ExpiredSpin | null {
  try {
    const raw = storage?.getItem(key(account, plantId));
    if (!raw) return null;
    const value = JSON.parse(raw) as ExpiredSpin;
    return value.account.toLowerCase() === account.toLowerCase() && value.plantId === plantId
      && Number.isSafeInteger(value.commitBlock) && value.commitBlock > 0
      && /^0x[0-9a-f]{64}$/i.test(value.commitment)
      && (value.starsSpent === null || Number.isSafeInteger(value.starsSpent) && value.starsSpent >= 0) ? value : null;
  } catch { return null; }
}

/** Keep a public round reference before removing its expired reveal secret. */
export function storeExpiredSpin(storage: SpinStorage | null, value: ExpiredSpin): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key(value.account, value.plantId), JSON.stringify(value));
    return readExpiredSpin(storage, value.account, value.plantId)?.commitment === value.commitment;
  } catch { return false; }
}
