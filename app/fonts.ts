import localFont from "next/font/local";

// next/font/local preloads every `src` entry, so an unused face is downloaded on
// every cold load. The 200 and 300 weights had zero usages (no font-extralight /
// font-light / font-thin anywhere), which cost ~78 KB of woff2 for nothing.
//
// Coinbase Sans ships no SemiBold: the family is ExtraLight, Light, Regular,
// Medium and Bold. `font-semibold` is nonetheless the app's most-used weight
// (282 uses, against 143 `font-medium` and 85 `font-bold`), and CSS weight
// matching resolves an unavailable 600 *upwards* — so every one of those
// rendered as Bold 700, byte-identical to `font-bold`. 71% of all weight
// declarations landed on one face and two tiers of the type hierarchy became
// indistinguishable, which is why dense UI read heavy and flat.
//
// Declaring Medium across 500-600 makes `font-semibold` a real mid weight and
// gives `font-bold` its contrast back. The range descriptor costs no extra
// bytes: it is the same single face, matched over a wider span.
export const coinbaseSans = localFont({
  src: [
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Regular-web-1.32.woff2",
      weight: "400",
      style: "normal"
    },
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Medium-web-1.32.woff2",
      weight: "500 600",
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
  display: "swap",
  // A pixel bitmap face shares no metrics with the default Arial-based
  // adjustment, so the synthesized fallback reflowed every title (several sit
  // inside truncate containers, moving the ellipsis) when the face landed.
  // Monospace is the closest honest stand-in for the fixed-advance glyphs.
  fallback: ["monospace"],
  adjustFontFallback: false
});

