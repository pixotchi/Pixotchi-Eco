"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Land } from '@/lib/types';
import { LandNameTransaction } from '@/components/transactions/land-name-transaction';
import { ASSET_NAME_RULES, getAssetNameInvalidReason, getAssetNameValidation, truncateUtf8ToMaxBytes } from '@/lib/asset-name-rules';

interface EditLandNameProps {
	land: Land;
	onNameChanged?: (landId: bigint, newName: string) => void;
	className?: string;
	iconSize?: number;
}

const LAND_NAME_RULE = ASSET_NAME_RULES.land;
const renamePanelClassName =
	"chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]";

export function EditLandName({ land, onNameChanged, className = "", iconSize = 16 }: EditLandNameProps) {
	const { address } = useAccount();
	const [isOpen, setIsOpen] = useState(false);
	const [newName, setNewName] = useState(land.name || '');
	const [isTransactionPending, setIsTransactionPending] = useState(false);

	const isOwnedByUser = address && land.owner.toLowerCase() === address.toLowerCase();

	const autoCloseTimerRef = useRef<number | null>(null);

	// Reset the pending flag alongside the name: it was only cleared in the
	// success/error handlers, so a mid-transaction close dead-ended the dialog.
	useEffect(() => {
		if (isOpen) {
			setNewName(land.name || '');
			setIsTransactionPending(false);
		}
	}, [isOpen, land.name]);

	useEffect(() => {
		return () => {
			if (autoCloseTimerRef.current !== null) {
				window.clearTimeout(autoCloseTimerRef.current);
			}
		};
	}, []);

	const handleNameChange = (value: string) => {
		setNewName(truncateUtf8ToMaxBytes(value, LAND_NAME_RULE.maxBytes));
	};

	const trimmedName = newName.trim();
	const nameValidation = getAssetNameValidation('land', newName);
	const nameInvalidReason = getAssetNameInvalidReason('land', newName);
	const isNameValid = nameValidation.validFormat && trimmedName !== (land.name || '').trim();
	const canSubmit = isNameValid && !isTransactionPending; // free action

	const handleSuccess = () => {
		toast.success(`Land name changed to "${trimmedName}"!`);
		setIsTransactionPending(false);
		onNameChanged?.(land.tokenId, trimmedName);
		if (autoCloseTimerRef.current !== null) {
			window.clearTimeout(autoCloseTimerRef.current);
		}
		// Matches the plant rename dialog's delay (they used to differ, 800 vs 1000).
		autoCloseTimerRef.current = window.setTimeout(() => {
			autoCloseTimerRef.current = null;
			setIsOpen(false);
		}, 1000);
	};

	const handleError = (error: UntypedValue) => {
		console.error('Land name change failed:', error);
		toast.error('Failed to change land name. Please try again.');
		setIsTransactionPending(false);
	};

	const handleTransactionStart = () => setIsTransactionPending(true);

	if (!isOwnedByUser) return null;

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className={`hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary ${className}`}
					title="Change land name"
					aria-label="Change land name"
				>
					<Image src="/icons/pencil.svg" alt="Edit" width={iconSize} height={iconSize} className="text-muted-foreground hover:text-foreground" />
				</Button>
			</DialogTrigger>

			<DialogContent surface="soft" className="max-w-md">
				<DialogHeader>
					<DialogTitle className="text-lg font-semibold">Change Land Name</DialogTitle>
					<DialogDescription>Set a new onchain name for your land.</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-4 pt-4">
					<section className={renamePanelClassName}>
						<div className="mb-3 flex items-center justify-between gap-3">
							<label htmlFor="land-name" className="text-sm font-semibold text-foreground">New Name</label>
							<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
								Land #{land.tokenId.toString()}
							</span>
						</div>
							<Input id="land-name" value={newName} onChange={(e) => handleNameChange(e.target.value)} placeholder="Enter new name..." className="w-full font-pixel" />
							<div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
								<span>{nameValidation.rawByteLength}/{LAND_NAME_RULE.maxBytes} bytes</span>
								{nameValidation.rawByteLength === LAND_NAME_RULE.maxBytes && <span className="text-destructive">Byte limit reached</span>}
							</div>
							<p className="mt-1 text-[11px] text-muted-foreground">Emoji and accented letters can use more than 1 byte.</p>
						</section>
				</DialogBody>

				<DialogFooter sticky className="block space-y-2">
					{canSubmit ? (
						<LandNameTransaction
							landId={land.tokenId}
							newName={trimmedName}
							onSuccess={handleSuccess}
							onError={handleError}
							buttonText="Change Name"
							buttonClassName="w-full"
							disabled={!canSubmit}
							onButtonClick={handleTransactionStart}
						/>
					) : (
						<Button disabled className="w-full">
								{nameInvalidReason || (trimmedName === (land.name || '').trim() ? 'Name unchanged' : 'Change Name')}
							</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
