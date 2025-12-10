import { NextRequest, NextResponse } from 'next/server';

/**
 * Diagnostic endpoint to test 1inch API key configuration
 * GET /api/1inch/test
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.ONEINCH_API_KEY || process.env.NEXT_PUBLIC_1INCH_API_KEY;
  
  const diagnostics: {
    hasApiKey: boolean;
    apiKeyLength: number;
    apiKeyPrefix: string;
    envVars: {
      ONEINCH_API_KEY: boolean;
      NEXT_PUBLIC_1INCH_API_KEY: boolean;
    };
    nodeEnv: string | undefined;
    testRequest?: {
      status?: number;
      statusText?: string;
      ok?: boolean;
      error?: unknown;
      success?: boolean;
      hasData?: boolean;
    };
  } = {
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'none',
    envVars: {
      ONEINCH_API_KEY: !!process.env.ONEINCH_API_KEY,
      NEXT_PUBLIC_1INCH_API_KEY: !!process.env.NEXT_PUBLIC_1INCH_API_KEY,
    },
    nodeEnv: process.env.NODE_ENV,
  };

  // Test API key with a simple request
  if (apiKey) {
    try {
      const testUrl = 'https://api.1inch.dev/swap/v5.2/8453/quote?src=0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82&dst=0x546D239032b24eCEEE0cb05c92FC39090846adc7&amount=1000000000';
      const response = await fetch(testUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      diagnostics.testRequest = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      };

      if (!response.ok) {
        const errorText = await response.text();
        try {
          diagnostics.testRequest.error = JSON.parse(errorText);
        } catch {
          diagnostics.testRequest.error = errorText.slice(0, 500);
        }
      } else {
        const data = await response.json();
        diagnostics.testRequest.success = true;
        diagnostics.testRequest.hasData = !!data.toTokenAmount;
      }
    } catch (error) {
      diagnostics.testRequest = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return NextResponse.json(diagnostics, { 
    status: diagnostics.hasApiKey ? 200 : 500 
  });
}
