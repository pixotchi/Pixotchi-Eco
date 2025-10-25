import localFont from "next/font/local";

export const coinbaseSans = localFont({
  src: [
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Extra_Light-web-1.32.woff2",
      weight: "200",
      style: "normal"
    },
    {
      path: "../public/fonts/Coinbase-Sans/Coinbase_Sans-Light-web-1.32.woff2",
      weight: "300",
      style: "normal"
    },
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

