"use client";

import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/open-external";
import { PIXOTCHI_BASE_APP_REFERRAL_URL } from "@/lib/pixotchi-links";

export function showMiniAppRequiredToast(input?: {
  id?: string;
  title?: string;
  description?: string;
}) {
  const id = input?.id || "pixotchi-miniapp-required";
  const title = input?.title || "Available In Pixotchi Mini";
  const description =
    input?.description ||
    "Open Pixotchi Mini in Base app to use this feature.";

  toast.custom(
    (t) => (
      <div className="pointer-events-auto w-full max-w-md rounded-[var(--radius-panel)] border border-[hsl(var(--border-strong)/0.38)] bg-card bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-raised)]">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                toast.dismiss(t.id);
                await openExternalUrl(PIXOTCHI_BASE_APP_REFERRAL_URL);
              }}
            >
              Open Base app
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast.dismiss(t.id)}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    ),
    {
      id,
      duration: 7000,
    },
  );
}
