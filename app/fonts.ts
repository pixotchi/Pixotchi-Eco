import localFont from "next/font/local";

// next/font/local preloads every `src` entry, so an unused face is downloaded on
// every cold load. The 200 and 300 weights had zero usages (no font-extralight /
// font-light / font-thin anywhere), which cost ~78 KB of woff2 for nothing.
//
// Note: `font-semibold` (the most-used weight) has no dedicated file — it resolves
// by CSS weight matching to the 700 Bold face. That is existing, deliberate
// behaviour; don't "fix" it by remapping, which would restyle ~292 call sites.
export const coinbaseSans = localFont({
  src: [
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Regular-web-1.32.woff2",
      weight: "400",
      style: "normal"
    },
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Medium-web-1.32.woff2",
      weight: "500",
      style: "normal"
    },
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Bold-web-1.32.woff2",
      weight: "700",
      style: "normal"
    }
  ],
  variable: "--font-coinbase",
  display: "swap"
});

export const pixelmix = localFont({
  src: [
    {
      path: "../public/fonts/pixelmix.woff2",
      weight: "400",
      style: "normal"
    }
  ],
  variable: "--font-pixel",
  display: "swap"
});

