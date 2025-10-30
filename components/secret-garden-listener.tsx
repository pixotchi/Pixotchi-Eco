"use client";

import { useCallback, useEffect, useState } from "react";
import { SecretGardenOverlay } from "@/components/secret-garden-overlay";

const EVENT_NAME = "pixotchi:secret-garden-unlock";

export function SecretGardenListener() {
  const [open, setOpen] = useState(false);
  const [rerenderKey, setRerenderKey] = useState(0);

  const handleUnlock = useCallback(() => {
    // Reset key to ensure animation restarts if triggered consecutively
    setRerenderKey((key) => key + 1);
    setOpen(true);
  }, []);

  useEffect(() => {
    const handler: EventListener = () => handleUnlock();
    window.addEventListener(EVENT_NAME, handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
    };
  }, [handleUnlock]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <SecretGardenOverlay
      key={rerenderKey}
      open={open}
      onClose={handleClose}
    />
  );
}


