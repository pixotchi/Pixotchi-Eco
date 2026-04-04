import "@coinbase/onchainkit/styles.css";
import "ethereum-identity-kit/css";
import type { ReactNode } from "react";
import { Providers } from "../providers";

export default function GameLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
