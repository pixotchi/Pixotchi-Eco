import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { INVITE_CONFIG } from '@/lib/invite-utils';

export async function proxy(request: NextRequest) {
  // Get the pathname of the request
  const pathname = request.nextUrl.pathname;
  const statusOnly = process.env.NEXT_PUBLIC_STATUS_ONLY === 'true';

  if (statusOnly && pathname === '/') {
    const url = new URL('/status', request.url);
    return NextResponse.rewrite(url);
  }
  
  // Server-side invite validation for protected routes (excluding API and auth routes)
  if (INVITE_CONFIG.SYSTEM_ENABLED && !pathname.startsWith('/api/') && !pathname.startsWith('/_next') && pathname === '/') {
    try {
      // Validated silently
    } catch (error) {
      // Silently ignore validation errors in middleware to prevent log spam
    }
  }
  
  // Create response
  const response = NextResponse.next();
  
  // CORS headers for API routes - be lenient for Farcaster miniapp embedding
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    
    // Special handling for admin routes - restrict to known origins
    if (pathname.startsWith('/api/invite/admin/') || pathname.startsWith('/api/gamification/admin/') || pathname.startsWith('/api/admin/')) {
      const allowedAdminOrigins = process.env.ALLOWED_ADMIN_ORIGINS?.split(',') || [
        'https://mini.pixotchi.tech',
        'https://beta.mini.pixotchi.tech',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ];
      
      // Allow same-origin requests (when origin is null/undefined) or from allowed origins
      if (!origin || allowedAdminOrigins.includes(origin)) {
        if (origin) {
          response.headers.set('Access-Control-Allow-Origin', origin);
          response.headers.set('Access-Control-Allow-Credentials', 'true');
          // Ensure caches vary by Origin when ACAO is dynamic
          response.headers.append('Vary', 'Origin');
        }
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
        response.headers.set('Access-Control-Max-Age', '86400');
      } else {
        // Deny access to admin endpoints from unauthorized origins
        return new Response('Forbidden', { status: 403 });
      }
    } else {
      // Allow all origins for public API routes since we can be embedded anywhere
      if (origin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-webhook-signature, x-webhook-timestamp');
        response.headers.set('Access-Control-Max-Age', '86400');
        // Ensure caches vary by Origin when ACAO is dynamic
        response.headers.append('Vary', 'Origin');
      }
    }
    
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: response.headers });
    }
  }
  
  // Content Security Policy - aligned with Privy guidelines + blockchain RPC connections
  // See: https://docs.privy.io/guide/react/content-security-policy
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel-scripts.com https://challenges.cloudflare.com https://s3.tradingview.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://s3.tradingview.com;
    img-src 'self' data: blob: https:;
    font-src 'self' https://fonts.gstatic.com data:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors *;
    child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org;
    frame-src 'self' https://*.coinbase.com https://vercel.live https://*.base.org https://*.farcaster.xyz https://*.warpcast.com https://*.privy.io https://auth.privy.io https://privy.pixotchi.tech https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://*.tradingview-widget.com;
    connect-src 'self' https://auth.privy.io https://*.privy.io https://privy.pixotchi.tech wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://cca-lite.coinbase.com https://*.base.org https: wss:;
    worker-src 'self';
    manifest-src 'self';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim();
  
  response.headers.set('Content-Security-Policy', cspHeader);
  
  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)  
     * - favicon.ico (favicon file)
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.gif$|.*\\.webp$).*)',
  ],
};