import assert from 'node:assert/strict';
import { getStrainInfo, JESSE_TOKEN_ADDRESS, type PixotchiReadClient } from '../lib/contracts';
import { formatStartingLifetime, getSharedStartingLifetimeCopy } from '../lib/mint-copy';

const listed = [{ strainInitialTOD: 86_400 }, { strainInitialTOD: 86_400 }];
assert.equal(getSharedStartingLifetimeCopy(listed), 'All listed strains currently start with 24 hours of lifetime.');
assert.equal(getSharedStartingLifetimeCopy([listed[0], { strainInitialTOD: 43_200 }]), null);
assert.equal(getSharedStartingLifetimeCopy([]), null);
assert.equal(getSharedStartingLifetimeCopy([{ strainInitialTOD: Number.NaN }, listed[0]]), null);
assert.equal(formatStartingLifetime(5_400), '1h 30m');
assert.equal(formatStartingLifetime(3_600), '1 hour');

const strain = {
  id: BigInt(5), name: 'TYJ', mintPrice: BigInt(500) * BigInt(10) ** BigInt(18),
  totalSupply: BigInt(11), totalMinted: BigInt(242), maxSupply: BigInt(750),
  isActive: true, getStrainTotalLeft: BigInt(508), strainInitialTOD: BigInt(86_400),
};
function readClient(failPayment = false, lifetime = strain.strainInitialTOD): PixotchiReadClient {
  return { readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === 'getAllStrainInfo') return [{ ...strain, strainInitialTOD: lifetime }];
    assert.equal(functionName, 'getStrainPaymentInfo');
    if (failPayment) throw new Error('Payment lookup unavailable');
    return [JESSE_TOKEN_ADDRESS, BigInt(0)];
  } } as unknown as PixotchiReadClient;
}

async function main() {
  const catalog = await getStrainInfo(readClient());
  assert.equal(catalog[0].paymentToken, JESSE_TOKEN_ADDRESS);
  assert.equal(catalog[0].paymentPrice, BigInt(0), 'An authoritative zero price must not fall back to the legacy mint price');
  assert.equal(catalog[0].mintPriceRaw, strain.mintPrice);
  assert.equal(catalog[0].strainInitialTOD, 86_400);
  assert.equal((await getStrainInfo(readClient(false, BigInt(0))))[0].strainInitialTOD, 86_400, 'Unset lifetime uses NFTLogic’s one-day default');
  await assert.rejects(getStrainInfo(readClient(true)), /Payment lookup unavailable/);
  console.log('PASS mint copy/read: live shared lifetime, differing lifetimes, exact duration, default lifetime, token/zero price, failed payment read');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
