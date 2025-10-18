import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { INVITE_CONFIG } from '@/lib/invite-utils';

export async function middleware(request: NextRequest) {
  // Get the pathname of the request
  const pathname = request.nextUrl.pathname;
  
  // Server-side invite validation for protected routes (excluding API and auth routes)
  if (INVITE_CONFIG.SYSTEM_ENABLED && !pathname.startsWith('/api/') && !pathname.startsWith('/_next') && pathname === '/') {
    try {
      // Check if user has valid invite validation in localStorage (via client-side check)
      // For server-side validation, we'd need to check cookies or implement session-based auth
      // For now, we log attempts and rely on client-side enforcement + contract-level checks
      // A more robust solution would require session cookies or JWT tokens
      
      // Note: True server-side validation requires authentication state in cookies/headers
      // The current architecture relies on blockchain transactions as final validation
      console.log('[Middleware] Invite system active - client-side enforcement in place');
    } catch (error) {
      console.warn('[Middleware] Invite validation check failed:', error);
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
  
  // Content Security Policy - allow blockchain RPC connections
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel-scripts.com https://challenges.cloudflare.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com data:;
    img-src 'self' data: https: blob:;
    connect-src 'self' https: wss: https://cca-lite.coinbase.com https://*.privy.io https://auth.privy.io https://privy.pixotchi.tech wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://explorer-api.walletconnect.com https://*.base.org https://*.rpc.privy.systems;
    frame-src 'self' https://*.coinbase.com https://vercel.live https://*.base.org https://*.farcaster.xyz https://*.warpcast.com https://*.privy.io https://auth.privy.io https://privy.pixotchi.tech https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com;
    frame-ancestors *;
    base-uri 'self';
    form-action 'self';
    object-src 'none';
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