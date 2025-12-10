import { NextRequest, NextResponse } from 'next/server';

// Using v5.2 as per standard documentation
const ONEINCH_API_BASE = 'https://api.1inch.dev/swap/v5.2/8453';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const endpoint = searchParams.get('endpoint'); // 'quote' or 'swap'
  
  if (!endpoint || !['quote', 'swap'].includes(endpoint)) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  }

  // Use server-only env var (not NEXT_PUBLIC_)
  // Check both for backward compatibility during migration
  // Using ONEINCH_API_KEY (not 1INCH_API_KEY) to avoid parsing issues with env vars starting with numbers
  const apiKey = process.env.ONEINCH_API_KEY || process.env.NEXT_PUBLIC_1INCH_API_KEY;
  
  // Debug logging (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log('[1inch] Environment check:', {
      hasONEINCH_API_KEY: !!process.env.ONEINCH_API_KEY,
      hasNEXT_PUBLIC_1INCH_API_KEY: !!process.env.NEXT_PUBLIC_1INCH_API_KEY,
      apiKeyLength: apiKey?.length || 0,
      apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : 'none'
    });
  }
  
  if (!apiKey) {
    console.error('[1inch] API key not configured. Check environment variables: ONEINCH_API_KEY or NEXT_PUBLIC_1INCH_API_KEY');
    return NextResponse.json({ 
      error: 'API key not configured',
      hint: 'Set ONEINCH_API_KEY environment variable with your 1inch Business API key',
      debug: process.env.NODE_ENV === 'development' ? {
        checkedVars: ['ONEINCH_API_KEY', 'NEXT_PUBLIC_1INCH_API_KEY'],
        found: false
      } : undefined
    }, { status: 500 });
  }

  // Validate API key format (1inch Business API keys are typically long alphanumeric strings)
  if (apiKey.length < 20) {
    console.warn('[1inch] API key appears to be invalid (too short):', apiKey.length, 'characters');
  }

  // Construct the target URL
  const targetUrl = new URL(`${ONEINCH_API_BASE}/${endpoint}`);
  
  // Copy all search params except 'endpoint'
  searchParams.forEach((value, key) => {
    if (key !== 'endpoint') {
      targetUrl.searchParams.append(key, value);
    }
  });

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails: any = { 
        error: `1inch API error: ${response.status}`,
        status: response.status,
        endpoint: endpoint,
        url: targetUrl.toString()
      };

      // Try to parse error response for more details
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails.details = errorJson;
        errorDetails.message = errorJson.error || errorJson.description || errorJson.message || 'Unknown error';
      } catch {
        errorDetails.rawError = errorText.slice(0, 500);
      }
      
      // Provide helpful hints based on status code
      if (response.status === 403) {
        // Check for specific KYC/KYB error message
        const errorMessage = errorDetails.message || errorDetails.rawError || '';
        if (errorMessage.toLowerCase().includes('kyc') || errorMessage.toLowerCase().includes('kyb') || errorMessage.toLowerCase().includes('verification')) {
          errorDetails.hint = 'KYC/KYB Verification Required';
          errorDetails.message = 'Complete your KYC/KYB verification to gain access';
          errorDetails.troubleshooting = [
            '1. Go to https://business.1inch.com/portal',
            '2. Log in to your account',
            '3. Complete KYC/KYB verification process',
            '4. Wait for approval (usually 1-3 business days)',
            '5. Once approved, your API key will work automatically'
          ];
          errorDetails.actionRequired = 'Complete KYC/KYB verification in 1inch Business Portal';
        } else {
          errorDetails.hint = '403 Forbidden usually means: Invalid API key, expired API key, or missing permissions. Check your 1inch Business Portal dashboard.';
          errorDetails.troubleshooting = [
            '1. Verify API key is correct in .env file (ONEINCH_API_KEY)',
            '2. Check API key is active in 1inch Business Portal',
            '3. Ensure Swap API v5.2 permissions are enabled',
            '4. Verify Base chain (8453) is allowed',
            '5. Try creating a new API key if current one is expired'
          ];
        }
      } else if (response.status === 401) {
        errorDetails.hint = '401 Unauthorized: API key authentication failed. Verify your API key is correct.';
      } else if (response.status === 429) {
        errorDetails.hint = '429 Too Many Requests: Rate limit exceeded. Check your plan limits.';
      }

      console.error(`[1inch] API request failed:`, {
        status: response.status,
        endpoint,
        url: targetUrl.toString(),
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        errorDetails
      });

      return NextResponse.json(errorDetails, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('[1inch] Proxy error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch from 1inch',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
