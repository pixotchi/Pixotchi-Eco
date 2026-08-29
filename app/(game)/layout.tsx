import type { ReactNode } from "react";
import { LoginHeroPanel } from "@/components/login-hero";
import { Providers } from "../providers";

export default function GameLayout({ children }: { children: ReactNode }) {
  // LoginHeroPanel is a server component, so it lands in the prerendered HTML and
  // acts as the first paint while the provider tower boots.
  return <Providers fallback={<LoginHeroPanel />}>{children}</Providers>;
}
