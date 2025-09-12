"use client";

import { SlideshowProvider } from "./SlideshowProvider";
import SlideshowModal from "./SlideshowModal";

export default function TutorialBundle({ children }: { children: React.ReactNode }) {
  return (
    <SlideshowProvider>
      {children}
    </SlideshowProvider>
  );
}

// Re-export for dynamic import consumer
TutorialBundle.SlideshowModal = SlideshowModal as any;


