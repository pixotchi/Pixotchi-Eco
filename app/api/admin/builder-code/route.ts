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
      description: 'Client-level Wagmi dataSuffix attribution (primary path for sendCalls + sendTransaction)',
      onchainKit: [
        'components/transactions/sponsored-transaction.tsx',
        'components/transactions/universal-transaction.tsx',
        'components/transactions/smart-wallet-transaction.tsx',
        'components/transactions/claim-rewards-transaction.tsx',
        'components/transactions/plant-name-transaction.tsx',
      ],
      legacy: [],
      walletSupport: {
        smartWallets: 'Viem client dataSuffix + wallet_sendCalls (ERC-5792)',
        eoaWallets: 'Viem client dataSuffix + eth_sendTransaction path',
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

