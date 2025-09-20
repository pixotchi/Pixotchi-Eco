import "@coinbase/onchainkit/styles.css";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  // Enhanced mobile viewport settings
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#a7c7e7" },
    { media: "(prefers-color-scheme: dark)", color: "#2d3c53" }
  ]
};

export async function generateMetadata(): Promise<Metadata> {
  const baseURL = process.env.NEXT_PUBLIC_URL || "https://mini.pixotchi.tech";
  const miniAppEmbed = {
    version: "1",
    imageUrl: process.env.NEXT_PUBLIC_APP_HERO_IMAGE || `${baseURL}/og-image.png`,
    button: {
      title: "Begin your journey!",
      action: {
        // Per Mini App guidelines, use launch_miniapp for fc:miniapp
        type: "launch_miniapp",
        name: "Pixotchi Mini",
        url: baseURL,
        splashImageUrl: process.env.NEXT_PUBLIC_SPLASH_IMAGE || `${baseURL}/splash.png`,
        splashBackgroundColor: process.env.NEXT_PUBLIC_SPLASH_BACKGROUND_COLOR || "#2d3c53",
      },
    },
  };

  // Backward compatibility for older clients that still read fc:frame
  const legacyFrameEmbed = {
    ...miniAppEmbed,
    button: {
      ...miniAppEmbed.button,
      action: {
        ...miniAppEmbed.button.action,
        // fc:frame expects launch_frame
        type: "launch_frame",
      },
    },
  };

  return {
    title: {
      default: "Pixotchi Mini - Your pocket farm on Base!",
      template: "%s | Pixotchi Mini"
    },
    description: "Mint, grow, and care for your onchain plants in this Tamagotchi-style game on Base blockchain. Buy items, level up your plants, and earn rewards in the ultimate onchain pet simulation.",
    applicationName: "Pixotchi Mini",
    authors: [{ name: "Pixotchi Team" }],
    creator: "Pixotchi Team",
    publisher: "Pixotchi Team",
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    metadataBase: new URL(baseURL),
    alternates: {
      canonical: baseURL,
    },
    keywords: [
      "tamagotchi",
      "onchain game", 
      "Base blockchain",
      "NFT game",
      "virtual pet",
      "p2e",
      "plant simulation",
      "crypto game",
      "Web3 gaming",
      "blockchain gaming",
      "mint NFT",
      "Farcaster miniapp",
      "onchain pets"
    ],
    category: "Gaming",
    classification: "Blockchain Game",
    other: {
      "fc:miniapp": JSON.stringify(miniAppEmbed),
      "fc:frame": JSON.stringify(legacyFrameEmbed), // For backward compatibility
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: baseURL,
      siteName: "Pixotchi Mini",
      title: "Pixotchi Mini - Your pocket farm on Base!",
      description: "Mint, grow, and care for your onchain plants in this Tamagotchi-style game on Base blockchain. Buy items, level up your plants, and earn rewards.",
      images: [
        {
          url: process.env.NEXT_PUBLIC_APP_HERO_IMAGE || `${baseURL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: "Pixotchi Mini - Your pocket farm on Base!",
          type: "image/png",
        }
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: "@pixotchi",
      creator: "@pixotchi", 
      title: "Pixotchi Mini - Onchain Tamagotchi Game",
      description: "Mint, grow, and care for your onchain plants on Base blockchain. The ultimate Web3 pet simulation game.",
      images: [process.env.NEXT_PUBLIC_APP_HERO_IMAGE || `${baseURL}/og-image.png`],
    },
    robots: {
      index: true,
      follow: true,
      nocache: false,
      googleBot: {
        index: true,
        follow: true,
        noimageindex: false,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    icons: {
      icon: [
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon.ico", sizes: "any" },
      ],
      apple: [
        { url: "/favicon.png", sizes: "180x180", type: "image/png" },
      ],
      other: [
        {
          rel: "mask-icon",
          url: "/safari-pinned-tab.svg",
          color: "#2d3c53",
        },
      ],
    },
    manifest: "/site.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Pixotchi Mini",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "Pixotchi Mini",
              "description": "Mint, grow, and care for your onchain plants in this Tamagotchi-style game on Base blockchain.",
              "url": process.env.NEXT_PUBLIC_URL || "https://mini.pixotchi.tech",
              "applicationCategory": "Game",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "creator": {
                "@type": "Organization", 
                "name": "Pixotchi Team"
              },
              "genre": ["Simulation", "Blockchain Game", "Virtual Pet"],
              "gamePlatform": "Web Browser",
              "playMode": "MultiPlayer"
            })
          }}
        />
        {/* Theme color */}
        <meta name="theme-color" content="#2d3c53" />
        <meta name="msapplication-TileColor" content="#2d3c53" />
        {/* Preconnect to external domains */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Preload local fonts */}
        <link
          rel="preload"
          href="/fonts/Coinbase-Sans/Coinbase_Sans-Regular-web-1.32.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/PixotchiKit/pixelmix.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        {/* Preload above-the-fold art to reduce first paint */}
        <link rel="preload" as="image" href="/PixotchiKit/Logonotext.svg" />
        <link rel="preload" as="image" href="/og-image.png" />
      </head>
      <body className="bg-background">
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
