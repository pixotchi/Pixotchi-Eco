"use client";

import { sdk } from "@farcaster/miniapp-sdk";
import {
	ensureHostEnvironmentResolved,
	getHostEnvironmentSnapshot,
} from "@/lib/host-environment";
import type React from "react";

export async function isMiniApp(): Promise<boolean> {
	const snapshot = getHostEnvironmentSnapshot();
	if (snapshot.initialized) {
		return snapshot.isMiniApp;
	}

	try {
		const resolved = await ensureHostEnvironmentResolved();
		return resolved.isMiniApp;
	} catch {
		return false;
	}
}

export async function openExternalUrl(url: string): Promise<void> {
	try {
		const mini = await isMiniApp();
		if (mini) {
			await sdk.actions.openUrl(url);
			return;
		}
	} catch {}

	try {
		window.open(url, "_blank", "noopener,noreferrer");
	} catch {}
}

/**
 * Click handler for external <a> elements.
 *
 * Inside the Farcaster / Base Mini App webview a plain target="_blank" anchor is
 * inert, so external links silently do nothing. This intercepts the click and
 * routes it through sdk.actions.openUrl instead.
 *
 * preventDefault() must run synchronously: once the handler awaits, the browser
 * has already dispatched the anchor's default action. So we read the host
 * snapshot synchronously and only fall back to the async resolve when the
 * snapshot is not yet initialised (in which case the anchor's own default
 * behaviour is the safer outcome on web, and we do not preventDefault).
 */
export function handleExternalAnchorClick(
	e: React.MouseEvent<HTMLAnchorElement, MouseEvent>,
	url: string,
): void {
	// Let the browser handle modified clicks (new tab, download, middle-click).
	if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
		return;
	}

	const snapshot = getHostEnvironmentSnapshot();
	if (!snapshot.initialized || !snapshot.isMiniApp) {
		return;
	}

	e.preventDefault();
	void sdk.actions.openUrl(url).catch(() => {
		// If the host rejects it, fall back to a normal window open.
		try {
			window.open(url, "_blank", "noopener,noreferrer");
		} catch {}
	});
}

