"use client";

import React, { useRef } from 'react';
import { useAssetNameDraft, type AssetNameSession } from '@/hooks/useAssetNameDraft';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { AssetNameField } from '@/components/asset-name-field';
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
import Image from 'next/image';
import { Land } from '@/lib/types';
import { LandNameTransaction } from '@/components/transactions/land-name-transaction';
import { getAssetNameValidation } from '@/lib/asset-name-rules';

interface EditLandNameProps {
	land: Land;
	onNameChanged?: (landId: bigint, newName: string) => void;
	className?: string;
	iconSize?: number;
}

const renamePanelClassName =
	"surface-lifted rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]";

export function EditLandName({ land, onNameChanged, className = "", iconSize = 16 }: EditLandNameProps) {
	const { address } = useAccount();
	const { isOpen, newName, setNewName, isTransactionPending, setIsTransactionPending, onOpenChange, beginTransaction, isCurrentSession, scheduleAutoClose } = useAssetNameDraft(`${address?.toLowerCase() ?? ''}:${land.owner.toLowerCase()}:${land.tokenId}`, land.name || '');
	const submittedNameRef = useRef<{ session: AssetNameSession; id: bigint; name: string } | null>(null);

	const isOwnedByUser = address && land.owner.toLowerCase() === address.toLowerCase();

	const trimmedName = newName.trim();
	const nameValidation = getAssetNameValidation('land', newName);
	const isNameValid = nameValidation.validFormat && trimmedName !== (land.name || '').trim();
	const canSubmit = isNameValid && !isTransactionPending; // free action

	const handleSuccess = () => {
		const submitted = submittedNameRef.current;
		if (!submitted) return;
		onNameChanged?.(submitted.id, submitted.name);
		if (!isCurrentSession(submitted.session)) return;
		setIsTransactionPending(false);
		scheduleAutoClose(submitted.session);
	};

	const handleError = (error: UntypedValue) => {
		if (submittedNameRef.current && !isCurrentSession(submittedNameRef.current.session)) return;
		console.error('Land name change failed:', error);
		setIsTransactionPending(false);
	};

	const handleTransactionStart = () => {
		submittedNameRef.current = { session: beginTransaction(), id: land.tokenId, name: trimmedName };
	};

	if (!isOwnedByUser) return null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
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

			<DialogContent layout="form" surface="soft" className="max-w-md">
				<DialogHeader>
					<DialogTitle className="text-lg font-semibold">Change Land Name</DialogTitle>
					<DialogDescription>Set a new onchain name for your land.</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-4 pt-4">
					<section className={renamePanelClassName}>
						<AssetNameField asset="land" assetId={land.tokenId.toString()} value={newName} onChange={setNewName} disabled={isTransactionPending} currentName={land.name || ''} />
						</section>
				</DialogBody>

				<DialogFooter className="block space-y-2">
					<LandNameTransaction
						landId={land.tokenId}
						newName={trimmedName}
						onSuccess={handleSuccess}
						onError={handleError}
						buttonText={isTransactionPending ? 'Changing Name…' : 'Change Name'}
						buttonClassName="w-full"
						disabled={!canSubmit}
						onButtonClick={handleTransactionStart}
					/>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
