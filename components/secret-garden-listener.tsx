"use client";

import { useCallback, useEffect, useState } from "react";
import { SecretGardenOverlay } from "@/components/secret-garden-overlay";

const EVENT_NAME = "pixotchi:secret-garden-unlock";

type SecretGardenUnlockDetail = {
  token?: string;
};

export function SecretGardenListener() {
  const [open, setOpen] = useState(false);
  const [rerenderKey, setRerenderKey] = useState(0);

  const handleUnlock = useCallback(() => {
    // Reset key to ensure animation restarts if triggered consecutively
    setRerenderKey((key) => key + 1);
    setOpen(true);
  }, []);

  const validateToken = useCallback(
    async (token: string | undefined) => {
      if (!token) {
        return;
      }

      try {
        const response = await fetch("/api/secret-garden/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
          credentials: "include",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { valid?: boolean };
        if (data?.valid) {
          handleUnlock();
        }
      } catch (error) {
        console.warn("Secret garden token validation failed", error);
      }
    },
    [handleUnlock]
  );

  useEffect(() => {
    const handler: EventListener = (event) => {
      const detail = (event as CustomEvent<SecretGardenUnlockDetail>).detail;
      void validateToken(detail?.token);
    };

    window.addEventListener(EVENT_NAME, handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
    };
  }, [validateToken]);

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


