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

export async function handleExternalAnchorClick(
	e: React.MouseEvent<HTMLAnchorElement, MouseEvent>,
	url: string,
): Promise<void> {
	const mini = await isMiniApp();
	if (mini) {
		e.preventDefault();
		await sdk.actions.openUrl(url);
	}
}

