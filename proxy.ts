import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { INVITE_CONFIG } from '@/lib/invite-utils';

const CHAT_SESSION_COOKIE = 'pixotchi_chat_session';
const MINIAPP_BYPASS_COOKIE = 'pixotchi_miniapp';
const MINIAPP_BYPASS_ADDRESS_COOKIE = 'pixotchi_miniapp_address';
const MINIAPP_BYPASS_HEADER = 'x-pixotchi-miniapp';
const MINIAPP_BYPASS_ADDRESS_HEADER = 'x-pixotchi-address';
const EDGE_SESSION_REQUIRED_API_PATHS = new Set([
  '/api/chat/messages',
  '/api/chat/send',
  '/api/chat/ai/messages',
  '/api/chat/ai/send',
  '/api/agent/chat',
  '/api/agent/mint',
]);
const EDGE_SAME_ORIGIN_ONLY_API_PATHS = new Set([
  '/api/chat/auth/session',
  '/api/chat/auth/base/nonce',
  '/api/chat/auth/base/debug',
  '/api/broadcast/active',
  '/api/ens/resolve',
  '/api/swap/quote',
  '/api/swap/build-step',
]);
const DEFAULT_ADMIN_ORIGINS = [
  'https://mini.pixotchi.tech',
  'https://beta.mini.pixotchi.tech',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const DEFAULT_FRAME_ANCESTORS = [
  "'self'",
  'https://mini.pixotchi.tech',
  'https://beta.mini.pixotchi.tech',
  'https://*.farcaster.xyz',
  'https://*.warpcast.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function parseOrigins(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function getFrameAncestors() {
  return Array.from(
    new Set([
      ...DEFAULT_FRAME_ANCESTORS,
      ...parseOrigins(process.env.ALLOWED_FRAME_ANCESTORS),
    ]),
  ).join(' ');
}

function isEdgeSessionRequiredApiPath(pathname: string): boolean {
  return EDGE_SESSION_REQUIRED_API_PATHS.has(pathname);
}

function isEdgeSameOriginOnlyApiPath(pathname: string): boolean {
  return EDGE_SAME_ORIGIN_ONLY_API_PATHS.has(pathname);
}

function hasChatAuthArtifacts(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get(CHAT_SESSION_COOKIE)?.value ||
    (
      request.cookies.get(MINIAPP_BYPASS_COOKIE)?.value === '1' &&
      request.cookies.get(MINIAPP_BYPASS_ADDRESS_COOKIE)?.value
    ) ||
    (
      request.headers.get(MINIAPP_BYPASS_HEADER) === '1' &&
      request.headers.get(MINIAPP_BYPASS_ADDRESS_HEADER)
    ),
  );
}

function isMiniAppChatRequest(request: NextRequest, pathname: string): boolean {
  if (!pathname.startsWith('/api/chat/')) {
    return false;
  }

  return request.headers.get(MINIAPP_BYPASS_HEADER) === '1';
}

function isCrossSiteBrowserRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (!secFetchSite) {
    return false;
  }

  return secFetchSite !== 'same-origin';
}

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

      console.log('[Middleware] Invite system active - client-side enforcement in place');
    } catch (error) {
      console.warn('[Middleware] Invite validation check failed:', error);
    }
  }
  
  // Create response
  const response = NextResponse.next();

  if (isEdgeSessionRequiredApiPath(pathname) || isEdgeSameOriginOnlyApiPath(pathname)) {
    if (isCrossSiteBrowserRequest(request) && !isMiniAppChatRequest(request, pathname)) {
      return NextResponse.json(
        { error: 'Cross-site browser access is not allowed for this endpoint.' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 403,
        },
      );
    }
  }

  if (isEdgeSessionRequiredApiPath(pathname)) {
    if (request.method !== 'OPTIONS' && !hasChatAuthArtifacts(request)) {
      return NextResponse.json(
        { error: 'Authentication required for chat access.' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 401,
        },
      );
    }
  }
  
  // CORS headers for API routes - be lenient for Farcaster miniapp embedding
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    const requestOrigin = request.nextUrl.origin;
    const allowedPublicApiOrigins = new Set([
      requestOrigin,
      ...parseOrigins(process.env.ALLOWED_PUBLIC_API_ORIGINS),
    ]);
    
    // Special handling for admin routes - restrict to known origins
    if (pathname.startsWith('/api/invite/admin/') || pathname.startsWith('/api/gamification/admin/') || pathname.startsWith('/api/admin/')) {
      const allowedAdminOrigins = parseOrigins(process.env.ALLOWED_ADMIN_ORIGINS);
      const adminOriginSet = new Set(
        allowedAdminOrigins.length > 0 ? allowedAdminOrigins : DEFAULT_ADMIN_ORIGINS,
      );
      
      // Allow same-origin requests (when origin is null/undefined) or from allowed origins
      if (!origin || adminOriginSet.has(origin)) {
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
      if (origin && !allowedPublicApiOrigins.has(origin)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (origin && allowedPublicApiOrigins.has(origin)) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, x-webhook-signature, x-webhook-timestamp, x-pixotchi-miniapp, x-pixotchi-address',
        );
        response.headers.set('Access-Control-Max-Age', '86400');
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
  const frameAncestors = getFrameAncestors();
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel-scripts.com https://challenges.cloudflare.com https://s3.tradingview.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://s3.tradingview.com;
    img-src 'self' data: blob: https:;
    font-src 'self' https://fonts.gstatic.com data:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors ${frameAncestors};
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
