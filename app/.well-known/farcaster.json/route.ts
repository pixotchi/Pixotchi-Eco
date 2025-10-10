function withValidProperties(
  properties: Record<string, undefined | string | string[] | boolean>,
) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === 'boolean') {
        // Always keep explicit booleans, including false
        return true;
      }
      return !!value;
    }),
  );
}

export async function GET() {
  const URL = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://mini.pixotchi.tech');
  const WEBHOOK_URL = process.env.FARCASTER_WEBHOOK_URL || `${URL}/api/webhook`;
  const HOSTNAME = (() => {
    try {
      return URL ? new globalThis.URL(URL).hostname : undefined;
    } catch {
      return undefined;
    }
  })();

  return Response.json({
    accountAssociation: {
      header: process.env.FARCASTER_HEADER,
      payload: process.env.FARCASTER_PAYLOAD,
      signature: process.env.FARCASTER_SIGNATURE,
    },
    frame: withValidProperties({
      version: "1",
      name: "Pixotchi Mini",
      iconUrl: `${URL}/icon1.png`,
      subtitle: "Your Pocket farm on Base!",
      description: "Plant, grow, compete - your onchain garden awaits with ETH rewards.",
      splashImageUrl: `${URL}/splash.png`,
      splashBackgroundColor: "#2d3c53",
      buttonTitle: "Begin your journey!",
      homeUrl: URL,
      webhookUrl: WEBHOOK_URL,
      primaryCategory: "games",
      tags: ["p2e", "miniapp", "nft", "game", "base"],
      heroImageUrl: `${URL}/og-image.png`,
      tagline: "Your Pocket farm on Base!",
      ogTitle: "Pixotchi Mini on Base",
      ogDescription: "Plant, grow, compete - your onchain garden awaits with ETH rewards.",
      ogImageUrl: `${URL}/og-image.png`,
      screenshotUrls: [
        `${URL}/screenshot1.png`,
        `${URL}/screenshot2.png`,
        `${URL}/screenshot3.png`,
      ],
      noindex: process.env.FARCASTER_FRAME_NOINDEX === 'true',
      // Required chains/capabilities per Farcaster Mini App schema
      requiredChains: ["eip155:8453"],
      canonicalDomain: HOSTNAME,
      // Explicitly allow iframe embedding in compatible hosts
      embeds: [
        "https://*.warpcast.com",
        "https://*.farcaster.xyz",
        "https://*.base.org",
        "https://*.base.app",
        "https://base.app",	
        "https://*.coinbase.com",
        "https://mini.pixotchi.tech",
        "https://*.pixotchi.tech",
        "https://*.mini.pixotchi.tech",
      ],
    }),
    castShareUrl: `${URL}/share`,
    baseBuilder: {
      allowedAddresses: [
        "0x2B0ff9e1311a3b7FC4E2250F03B354d6143B1E08",
      ],
    },
  });
} 