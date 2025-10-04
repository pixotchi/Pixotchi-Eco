"use client";

import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Land } from '@/lib/types';
import { LandNameTransaction } from '@/components/transactions/land-name-transaction';

interface EditLandNameProps {
	land: Land;
	onNameChanged?: (landId: bigint, newName: string) => void;
	className?: string;
	iconSize?: number;
}

const MAX_NAME_LENGTH = 9; // match plant constraints

export function EditLandName({ land, onNameChanged, className = "", iconSize = 16 }: EditLandNameProps) {
	const { address } = useAccount();
	const [isOpen, setIsOpen] = useState(false);
	const [newName, setNewName] = useState(land.name || '');
	const [isTransactionPending, setIsTransactionPending] = useState(false);

	const isOwnedByUser = address && land.owner.toLowerCase() === address.toLowerCase();

	useEffect(() => {
		if (isOpen) setNewName(land.name || '');
	}, [isOpen, land.name]);

	const handleNameChange = (value: string) => {
		const truncated = value.slice(0, MAX_NAME_LENGTH);
		setNewName(truncated);
	};

	const trimmedName = newName.trim();
	const isNameValid = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH && trimmedName !== (land.name || '').trim();
	const canSubmit = isNameValid && !isTransactionPending; // free action

	const handleSuccess = () => {
		toast.success(`Land name changed to "${trimmedName}"!`);
		setIsTransactionPending(false);
		onNameChanged?.(land.tokenId, trimmedName);
		setTimeout(() => setIsOpen(false), 800);
	};

	const handleError = (error: any) => {
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
					size="sm"
					className={`p-1 h-auto hover:bg-muted ${className}`}
					title="Change land name"
				>
					<Image src="/icons/pencil.svg" alt="Edit" width={iconSize} height={iconSize} className="text-muted-foreground hover:text-foreground" />
				</Button>
			</DialogTrigger>

		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle className="text-lg font-semibold">Change Land Name</DialogTitle>
				<DialogDescription>Set a new onchain name for your land.</DialogDescription>
			</DialogHeader>

				<div className="space-y-6">
					<div className="space-y-3">
						<label htmlFor="land-name" className="text-sm font-medium">New Name</label>
						<Input id="land-name" value={newName} onChange={(e) => handleNameChange(e.target.value)} placeholder="Enter new name..." maxLength={MAX_NAME_LENGTH} className="w-full" />
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>{newName.length}/{MAX_NAME_LENGTH} characters</span>
							{newName.length === MAX_NAME_LENGTH && <span className="text-red-500">Maximum length reached</span>}
						</div>
					</div>

					{canSubmit ? (
						<div onClick={handleTransactionStart}>
							<LandNameTransaction
								landId={land.tokenId}
								newName={trimmedName}
								onSuccess={handleSuccess}
								onError={handleError}
								buttonText="Change Name"
								buttonClassName="w-full"
								disabled={!canSubmit}
							/>
						</div>
					) : (
						<Button disabled className="w-full">
							{trimmedName.length === 0 ? 'Enter a name' : trimmedName.length > MAX_NAME_LENGTH ? 'Name too long' : trimmedName === (land.name || '').trim() ? 'Name unchanged' : 'Change Name'}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

export default EditLandName;


