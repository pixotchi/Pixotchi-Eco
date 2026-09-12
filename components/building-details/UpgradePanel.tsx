"use client";
import { getBalanceShortfallMessage } from '@/lib/balance-shortfall';

import React from 'react';
import { useAccount } from 'wagmi';
import { useBuildingApproval } from '@/hooks/useBuildingApproval';
import { ResourceValue } from '@/components/ui/resource-value';
import { BuildingData, BuildingType } from '@/lib/types';
import { formatTokenAmount, formatUpgradeDuration, calculateUpgradeProgress, calculateTimeLeft, getFriendlyErrorMessage } from '@/lib/utils';
import BuildingUpgradeTransaction from '@/components/transactions/building-upgrade-transaction';
import BuildingSpeedUpTransaction from '@/components/transactions/building-speedup-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import LeafApproveTransaction from '@/components/transactions/leaf-approve-transaction';
import { toast } from 'react-hot-toast';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { Button } from '@/components/ui/button';
import { ResourceState } from '@/components/ui/resource-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useBalances } from '@/lib/balance-context';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import { LAND_CONTRACT_ADDRESS, CREATOR_TOKEN_ADDRESS, LEAF_CONTRACT_ADDRESS } from '@/lib/contracts';
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
  allowancesReady?: boolean;
  allowancesError?: string | null;
  onRetryAllowances?: () => void;
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
  allowancesReady = true,
  allowancesError = null,
  onRetryAllowances,
}: UpgradePanelProps) {
  const { address } = useAccount();
  const approval = useBuildingApproval(`${landId}:${buildingType}:${building.id}:${address?.toLowerCase() ?? 'disconnected'}`);
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

  const seedApproval = (
              <div className="space-y-2">
                {allowancesReady && <div className="text-sm text-center text-muted-foreground">Approve PIXOTCHI spending to use speed ups</div>}
                <ApproveTransaction
                  onStatusUpdate={approval.observe('speedup', CREATOR_TOKEN_ADDRESS, 'Approve PIXOTCHI')}
                  spenderAddress={LAND_CONTRACT_ADDRESS}
                  tokenAddress={CREATOR_TOKEN_ADDRESS} // PIXOTCHI token
                  onSuccess={() => {

                    onSeedApprovalSuccess();
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={approval.active?.action === 'speedup' ? approval.active.label : allowancesReady ? 'Approve PIXOTCHI' : 'Approval status unavailable'}
                  disabled={approval.active?.settled || (!allowancesReady && !approval.active)}
                  buttonClassName="w-full"
                />
              </div>
  );
  const leafApproval = (
            <div className="space-y-2">
              {allowancesReady && <div className="text-sm text-center text-muted-foreground">Approve LEAF spending to upgrade</div>}
              <LeafApproveTransaction
                onStatusUpdate={approval.observe('upgrade', LEAF_CONTRACT_ADDRESS, 'Approve LEAF')}
                onSuccess={() => {  onLeafApprovalSuccess(); }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={approval.active?.action === 'upgrade' ? approval.active.label : allowancesReady ? 'Approve LEAF' : 'Approval status unavailable'}
                disabled={approval.active?.settled || (!allowancesReady && !approval.active)}
                buttonClassName="w-full"
              />
            </div>
  );

  return (
    <div className="border-t border-border/55 pt-4">
      <div className="space-y-4">
        {building.isUpgrading && (
          <div className="space-y-2">
            <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Upgrade Progress:</span>
              <span className="font-semibold">{upgradeProgress.toFixed(1)}%</span>
            </div>
            <ProgressBar label="Building upgrade progress" value={upgradeProgress} />
            <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Time left:</span>
              <ResourceValue resource="duration" className="font-semibold">{timeLeft}</ResourceValue>
            </div>
          </div>
        )}

        {(!isMaxLevel || building.isUpgrading) && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Upgrade Costs</h4>
            {!building.isUpgrading && (
              <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">Construction time</span>
                <ResourceValue resource="duration" className="font-semibold">{formatUpgradeDuration(building.levelUpgradeBlockInterval)}</ResourceValue>
              </div>
            )}
            <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">{building.isUpgrading ? 'Upgrade cost (paid)' : 'Upgrade cost'}</span>
              <ResourceValue resource="leaf" className={`font-semibold ${hasInsufficientLeaf ? 'text-value' : ''}`}>
                {formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF
              </ResourceValue>
            </div>
            <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Optional speed up</span>
              <ResourceValue resource="pixotchi" className={`font-semibold ${hasInsufficientPixotchi ? 'text-value' : ''}`}>
                {formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI
              </ResourceValue>
            </div>
            <p className="text-xs text-muted-foreground">Speed up completes an upgrade after it has started.</p>
          </div>
        )}

        <div className="space-y-2">
          {!allowancesReady && (!isMaxLevel || building.isUpgrading) && <ResourceState
            status={allowancesError ? 'error' : 'loading'} title={allowancesError ? 'Approval status unavailable' : 'Checking approval status…'}
            description={allowancesError ?? undefined} onRetry={onRetryAllowances} />}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {building.isUpgrading ? 'Upgrade Actions' :
                isMaxLevel ? 'Building at Max Level' : 'Upgrade Building'}
            </span>
          </div>
          {approval.active?.action === 'speedup' ? seedApproval : approval.active?.action === 'upgrade' ? leafApproval : building.isUpgrading ? (
            !pixotchiBalanceReady ? balanceUnavailable('PIXOTCHI', pixotchiBalanceStatus) : hasInsufficientPixotchi ? (
              <DisabledTransaction buttonText="Insufficient PIXOTCHI Balance" buttonClassName="w-full" />
            ) : needsSeedApproval ? (
              seedApproval
            ) : (
              <BuildingSpeedUpTransaction
                building={building}
                landId={landId}
                buildingType={buildingType}
                onSuccess={() => {

                  onUpgradeSuccess();
                  dispatchPostTransactionRefresh(['buildings:refresh']);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={`Speed Up (${formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI)`}
                buttonClassName="w-full"
                disabled={hasInsufficientPixotchi || !allowancesReady}
              />
            )
          ) : isMaxLevel ? (
            <DisabledTransaction buttonText="Max Level Reached" buttonClassName="w-full" />
          ) : !leafBalanceReady ? (
            balanceUnavailable('LEAF', leafBalanceStatus)
          ) : hasInsufficientLeaf ? (
            <DisabledTransaction buttonText="Insufficient LEAF Balance" buttonClassName="w-full" />
          ) : needsLeafApproval ? (
            leafApproval
          ) : (
              <BuildingUpgradeTransaction
                building={building}
                landId={landId}
                buildingType={buildingType}
                onSuccess={() => {

                  onUpgradeSuccess();
                  dispatchPostTransactionRefresh(['buildings:refresh']);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={`Upgrade (${formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF)`}
                buttonClassName="w-full"
                disabled={hasInsufficientLeaf || needsLeafApproval || !allowancesReady}
              />
          )}
          {hasInsufficientLeaf && !building.isUpgrading && !isMaxLevel && (
            <InlineBalanceNotice>
              {getBalanceShortfallMessage(userLeafBalance, building.levelUpgradeCostLeaf, 'LEAF')}
            </InlineBalanceNotice>
          )}
          {hasInsufficientPixotchi && building.isUpgrading && (
            <InlineBalanceNotice>
              {getBalanceShortfallMessage(userPixotchiBalance, building.levelUpgradeCostSeedInstant, 'PIXOTCHI')}
            </InlineBalanceNotice>
          )}
        </div>
      </div>
    </div>
  );
}
