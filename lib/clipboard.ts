"use client";

import toast from "react-hot-toast";

/**
 * Copy text with honest feedback. `navigator.clipboard.writeText` rejects in
 * denied-permission states and several in-app webviews (a real scenario for a
 * Farcaster/Base mini app); the old call sites fired a success toast
 * unconditionally and left the rejection unhandled.
 */
export async function copyWithToast(text: string, label: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
    return true;
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
    return false;
  }
}
