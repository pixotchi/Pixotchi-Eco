import type { ReactNode } from "react";
import { CoreProviders } from "../core-providers";

export default function StatusLayout({ children }: { children: ReactNode }) {
  return <CoreProviders>{children}</CoreProviders>;
}
