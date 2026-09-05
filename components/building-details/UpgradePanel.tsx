"use client";

import React from 'react';
import { BuildingData, BuildingType } from '@/lib/types';
import { formatTokenAmount, formatUpgradeDuration, calculateUpgradeProgress, calculateTimeLeft, getFriendlyErrorMessage } from '@/lib/utils';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import BuildingUpgradeTransaction from '@/components/transactions/building-upgrade-transaction';
import BuildingSpeedUpTransaction from '@/components/transactions/building-speedup-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import LeafApproveTransaction from '@/components/transactions/leaf-approve-transaction';
import { toast } from 'react-hot-toast';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useBalances } from '@/lib/balance-context';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import { LAND_CONTRACT_ADDRESS, CREATOR_TOKEN_ADDRESS } from '@/lib/contracts';
import { dispatchPostTransactionRefresh } from '@/lib/transaction-refresh';

interface UpgradePanelProps {
  building: BuildingData;
  landId: bigint;
  buildingType: BuildingType;
  currentBlock: bigint;
  leafAllowance: bigint;
  onUpgradeSuccess: () => void;
  onLeafApprovalSuccess: () => void;
  seedAllowance: bigint; // Now refers to PIXOTCHI allowance
  onSeedApprovalSuccess: () => void;
}

export default function UpgradePanel({
  building,
  landId,
  buildingType,
  currentBlock,
  leafAllowance,
  onUpgradeSuccess,
  onLeafApprovalSuccess,
  seedAllowance,
  onSeedApprovalSuccess,
}: UpgradePanelProps) {
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const {
    pixotchiBalance: userPixotchiBalance,
    leafBalance: userLeafBalance,
    pixotchiBalanceStatus,
    leafBalanceStatus,
    balanceError,
    refreshBalances,
  } = useBalances();

  const pixotchiBalanceReady = pixotchiBalanceStatus === 'ready';
  const leafBalanceReady = leafBalanceStatus === 'ready';

  // Determine if approval is needed based on allowance vs cost
  const needsLeafApproval = leafAllowance < building.levelUpgradeCostLeaf;
  const needsSeedApproval = seedAllowance < building.levelUpgradeCostSeedInstant;

  const hasInsufficientLeaf = leafBalanceReady && building.levelUpgradeCostLeaf > userLeafBalance;
  // Speedup cost is now in PIXOTCHI
  const hasInsufficientPixotchi = pixotchiBalanceReady && building.levelUpgradeCostSeedInstant > userPixotchiBalance;

  const retryBalances = () => { void refreshBalances(); };
  const balanceErrorMessage = balanceError instanceof Error
    ? balanceError.message
    : typeof balanceError === 'string' ? balanceError : null;
  const balanceUnavailable = (token: 'LEAF' | 'PIXOTCHI', status: string) => (
    <div className="space-y-2">
      <DisabledTransaction
        buttonText={status === 'unknown' ? `Checking ${token} balance` : `${token} balance unavailable`}
        buttonClassName="w-full"
      />
      {status === 'error' && (
        <Button type="button" variant="outline" className="w-full" onClick={retryBalances}>
          Retry balance check
        </Button>
      )}
      {status === 'error' && balanceErrorMessage && (
        <p className="text-center text-xs text-[hsl(var(--warning-strong))]" role="status">{balanceErrorMessage}</p>
      )}
    </div>
  );

  const upgradeProgress = calculateUpgradeProgress(building, currentBlock);
  const timeLeft = calculateTimeLeft(building, currentBlock);
  const isMaxLevel = building.level >= building.maxLevel;

  return (
    <div className="border-t border-border/55 pt-4">
      <div className="chromatic-white-surface space-y-4 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
        {building.isUpgrading && (
          <div className="chromatic-white-surface space-y-2 rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Upgrade Progress:</span>
              <span className="font-semibold">{upgradeProgress.toFixed(1)}%</span>
            </div>
            <ProgressBar label="Building upgrade progress" value={upgradeProgress} />
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Time left:</span>
              <span className="font-semibold">{timeLeft}</span>
            </div>
          </div>
        )}

        {(!isMaxLevel || building.isUpgrading) && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Upgrade Costs</h4>
            {!building.isUpgrading && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Construction time</span>
                <span className="font-semibold">{formatUpgradeDuration(building.levelUpgradeBlockInterval)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Normal</span>
              <span className={`font-semibold ${hasInsufficientLeaf ? 'text-value' : ''}`}>
                {formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Optional speed up</span>
              <span className={`font-semibold ${hasInsufficientPixotchi ? 'text-value' : ''}`}>
                {formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Speed up completes an upgrade after it has started.</p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {building.isUpgrading ? 'Upgrade Actions' :
                isMaxLevel ? 'Building at Max Level' : 'Upgrade Building'}
            </span>
            <SponsoredBadge show={isSponsored && isSmartWallet} />
          </div>
          {building.isUpgrading ? (
            !pixotchiBalanceReady ? balanceUnavailable('PIXOTCHI', pixotchiBalanceStatus) : needsSeedApproval ? (
              <div className="space-y-2">
                <div className="text-sm text-center text-muted-foreground">Approve PIXOTCHI spending to use speed ups</div>
                <ApproveTransaction
                  spenderAddress={LAND_CONTRACT_ADDRESS}
                  tokenAddress={CREATOR_TOKEN_ADDRESS} // PIXOTCHI token
                  onSuccess={() => {
                    toast.success('PIXOTCHI approval successful!');
                    onSeedApprovalSuccess();
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
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
                  dispatchPostTransactionRefresh(['buildings:refresh']);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={`Speed Up (${formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI)`}
                buttonClassName="w-full"
                disabled={hasInsufficientPixotchi}
              />
            )
          ) : isMaxLevel ? (
            <DisabledTransaction buttonText="Max Level Reached" buttonClassName="w-full" />
          ) : !leafBalanceReady ? (
            balanceUnavailable('LEAF', leafBalanceStatus)
          ) : needsLeafApproval ? (
            <div className="space-y-2">
              <div className="text-sm text-center text-muted-foreground">Step 1: Approve LEAF spending</div>
              <LeafApproveTransaction
                onSuccess={() => { toast.success('LEAF approval successful!'); onLeafApprovalSuccess(); }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
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
                  dispatchPostTransactionRefresh(['buildings:refresh']);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={`${needsLeafApproval ? 'Step 2: ' : ''}Upgrade (${formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF)`}
                buttonClassName="w-full"
                disabled={hasInsufficientLeaf || needsLeafApproval}
              />
            )
          )}
          {hasInsufficientLeaf && !building.isUpgrading && !isMaxLevel && (
            <InlineBalanceNotice>
              Not enough LEAF. Balance: {formatTokenAmount(userLeafBalance)} • Required: {formatTokenAmount(building.levelUpgradeCostLeaf)}
            </InlineBalanceNotice>
          )}
          {hasInsufficientPixotchi && building.isUpgrading && (
            <InlineBalanceNotice>
              Not enough PIXOTCHI. Balance: {formatTokenAmount(userPixotchiBalance)} • Required: {formatTokenAmount(building.levelUpgradeCostSeedInstant)}
            </InlineBalanceNotice>
          )}
        </div>
      </div>
    </div>
  );
}
