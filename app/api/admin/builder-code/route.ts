import { NextResponse } from 'next/server';
import { Attribution } from 'ox/erc8021';
import { CLIENT_ENV } from '@/lib/env-config';

/**
 * Builder Code Diagnostic API
 * 
 * GET /api/admin/builder-code
 * 
 * Returns the current builder code configuration and generated suffix.
 * Useful for automated verification and monitoring.
 */
export async function GET() {
  const builderCode = CLIENT_ENV.BUILDER_CODE;
  const isConfigured = Boolean(builderCode && builderCode.trim() !== '');
  
  let dataSuffix: string | null = null;
  let error: string | null = null;
  
  if (isConfigured) {
    try {
      dataSuffix = Attribution.toDataSuffix({ codes: [builderCode] });
    } catch (e: any) {
      error = e?.message || 'Failed to generate dataSuffix';
    }
  }
  
  const response = {
    status: isConfigured ? (dataSuffix ? 'active' : 'error') : 'not_configured',
    builderCode: isConfigured ? builderCode : null,
    dataSuffix,
    suffixBytes: dataSuffix ? (dataSuffix.length - 2) / 2 : null,
    error,
    integrationPoints: {
      description: 'Dual integration: capabilities.dataSuffix for wallet_sendCalls + calldata suffix appending for sendTransaction fallbacks',
      onchainKit: [
        'components/transactions/sponsored-transaction.tsx',
        'components/transactions/universal-transaction.tsx',
        'components/transactions/smart-wallet-transaction.tsx',
        'components/transactions/claim-rewards-transaction.tsx',
        'components/transactions/plant-name-transaction.tsx',
      ],
      legacy: [
        'components/transactions/transfer-assets-dialog.tsx',
        'lib/contracts.ts:transferPlants',
        'lib/contracts.ts:transferLands',
        'lib/contracts.ts:routerBatchTransfer',
      ],
      walletSupport: {
        smartWallets: 'capabilities.dataSuffix via wallet_sendCalls (ERC-5792)',
        eoaWallets: 'Pre-encoded calldata with suffix appended',
      },
    },
    verificationLinks: {
      baseDev: 'https://base.dev',
      basescan: 'https://basescan.org',
    },
    timestamp: new Date().toISOString(),
  };
  
  return NextResponse.json(response);
}

