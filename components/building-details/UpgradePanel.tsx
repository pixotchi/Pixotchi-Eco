"use client";

import React from 'react';
import { BuildingData, BuildingType } from '@/lib/types';
import { formatTokenAmount, calculateUpgradeProgress, calculateTimeLeft } from '@/lib/utils';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import BuildingUpgradeTransaction from '@/components/transactions/building-upgrade-transaction';
import BuildingSpeedUpTransaction from '@/components/transactions/building-speedup-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import LeafApproveTransaction from '@/components/transactions/leaf-approve-transaction';
import { toast } from 'react-hot-toast';
import { StandardContainer } from '@/components/ui/pixel-container';
import { useBalances } from '@/lib/balance-context';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import { LAND_CONTRACT_ADDRESS, CREATOR_TOKEN_ADDRESS } from '@/lib/contracts';

interface UpgradePanelProps {
  building: BuildingData;
  landId: bigint;
  buildingType: BuildingType;
  currentBlock: bigint;
  needsLeafApproval: boolean;
  onUpgradeSuccess: () => void;
  onLeafApprovalSuccess: () => void;
  needsSeedApproval: boolean; // Now refers to PIXOTCHI approval
  onSeedApprovalSuccess: () => void;
}

export default function UpgradePanel({
  building,
  landId,
  buildingType,
  currentBlock,
  needsLeafApproval,
  onUpgradeSuccess,
  onLeafApprovalSuccess,
  needsSeedApproval,
  onSeedApprovalSuccess,
}: UpgradePanelProps) {
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const { pixotchiBalance: userPixotchiBalance, leafBalance: userLeafBalance } = useBalances();

  const hasInsufficientLeaf = building.levelUpgradeCostLeaf > userLeafBalance;
  // Speedup cost is now in PIXOTCHI
  const hasInsufficientPixotchi = building.levelUpgradeCostSeedInstant > userPixotchiBalance;

  const upgradeProgress = calculateUpgradeProgress(building, currentBlock);
  const timeLeft = calculateTimeLeft(building, currentBlock);
  const isMaxLevel = building.level >= building.maxLevel;

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      {building.isUpgrading && (
        <StandardContainer className="space-y-2 p-3 rounded-lg border bg-card">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Upgrade Progress:</span>
            <span className="font-semibold">{upgradeProgress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-muted rounded-md overflow-hidden">
            <div
              className="h-2 bg-primary transition-all duration-300"
              style={{ width: `${Math.min(100, upgradeProgress)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Time left:</span>
            <span className="font-semibold">{timeLeft}</span>
          </div>
        </StandardContainer>
      )}

      {!isMaxLevel && (
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Upgrade Costs:</h4>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Normal:</span>
            <span className={`font-semibold ${hasInsufficientLeaf ? 'text-value' : ''}`}>
              {formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF
            </span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Speed up with:</span>
            <span className={`font-semibold ${hasInsufficientPixotchi ? 'text-value' : ''}`}>
              {formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            {isMaxLevel ? 'Building at Max Level' :
              building.isUpgrading ? 'Upgrade Actions' : 'Upgrade Building'}
          </span>
          <SponsoredBadge show={isSponsored && isSmartWallet} />
        </div>
        {isMaxLevel ? (
          <DisabledTransaction buttonText="Max Level Reached" buttonClassName="w-full" />
        ) : building.isUpgrading ? (
          needsSeedApproval ? (
            <div className="space-y-2">
              <div className="text-sm text-center text-muted-foreground">Approve PIXOTCHI spending to use speed ups</div>
              <ApproveTransaction
                spenderAddress={LAND_CONTRACT_ADDRESS}
                tokenAddress={CREATOR_TOKEN_ADDRESS} // PIXOTCHI token
                onSuccess={() => {
                  toast.success('PIXOTCHI approval successful!');
                  onSeedApprovalSuccess();
                }}
                onError={(error) => toast.error(`Approval failed: ${error.message}`)}
                buttonText="Approve PIXOTCHI"
                buttonClassName="w-full"
              />
            </div>
          ) : hasInsufficientPixotchi ? (
            <DisabledTransaction buttonText="Insufficient PIXOTCHI Balance" buttonClassName="w-full" />
          ) : (
            <BuildingSpeedUpTransaction
              building={building}
              landId={landId}
              buildingType={buildingType}
              onSuccess={() => {
                toast.success('Building upgrade sped up!', { id: `speedup-${landId}-${building.id}` });
                onUpgradeSuccess();
                // Refresh both balances and buildings immediately
                window.dispatchEvent(new Event('balances:refresh'));
                window.dispatchEvent(new Event('buildings:refresh'));
              }}
              onError={(error) => toast.error(`Speed up failed: ${error.message}`)}
              buttonText={`Speed Up (${formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI)`}
              buttonClassName="w-full"
              disabled={hasInsufficientPixotchi}
            />
          )
        ) : needsLeafApproval ? (
          <div className="space-y-2">
            <div className="text-sm text-center text-muted-foreground">Step 1: Approve LEAF spending</div>
            <LeafApproveTransaction
              onSuccess={() => { toast.success('LEAF approval successful!'); onLeafApprovalSuccess(); }}
              onError={(error) => toast.error(`Approval failed: ${error.message}`)}
              buttonText="Approve LEAF"
              buttonClassName="w-full"
            />
          </div>
        ) : (
          hasInsufficientLeaf ? (
            <DisabledTransaction buttonText="Insufficient LEAF Balance" buttonClassName="w-full" />
          ) : (
            <BuildingUpgradeTransaction
              building={building}
              landId={landId}
              buildingType={buildingType}
              onSuccess={() => {
                toast.success('Building upgrade started!', { id: `upgrade-${landId}-${building.id}` });
                onUpgradeSuccess();
                // Refresh both balances and buildings immediately
                window.dispatchEvent(new Event('balances:refresh'));
                window.dispatchEvent(new Event('buildings:refresh'));
              }}
              onError={(error) => toast.error(`Upgrade failed: ${error.message}`)}
              buttonText={`${needsLeafApproval ? 'Step 2: ' : ''}Upgrade (${formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF)`}
              buttonClassName="w-full"
              disabled={hasInsufficientLeaf || needsLeafApproval}
            />
          )
        )}
        {hasInsufficientLeaf && !building.isUpgrading && !isMaxLevel && (
          <p className="text-xs text-value text-center mt-2">Not enough LEAF. Balance: {formatTokenAmount(userLeafBalance)} LEAF</p>
        )}
        {hasInsufficientPixotchi && building.isUpgrading && (
          <p className="text-xs text-value text-center mt-2">Not enough PIXOTCHI for speed up. Balance: {formatTokenAmount(userPixotchiBalance)} PIXOTCHI</p>
        )}
      </div>
    </div>
  );
}
