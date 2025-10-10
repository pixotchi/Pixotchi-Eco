'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { BaseExpandedLoadingPageLoader } from '../ui/loading';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getFormattedTokenBalance, getStrainInfo, checkTokenApproval, getLandBalance, getLandSupply, getLandMintStatus, checkLandTokenApproval, getLandMintPrice, LAND_CONTRACT_ADDRESS, PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { useBalances } from '@/lib/balance-context';
import { Strain } from '@/lib/types';
import { formatNumber, formatTokenAmount } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { getFriendlyErrorMessage } from '@/lib/utils';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import MintTransaction from '@/components/transactions/mint-transaction';
import ApproveMintBundle from '@/components/transactions/approve-mint-bundle';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { ToggleGroup } from '@/components/ui/toggle-group';
import LandMintTransaction from '../transactions/land-mint-transaction';
import { MintShareModal } from '@/components/mint-share-modal';
// Removed BalanceCard from tabs; status bar now shows balances globally

const STRAIN_NAMES = ['OG', 'FLORA', 'TAKI', 'ROSA', 'ZEST'];

// Placeholder for plant images, assuming you might have them
const PLANT_STATIC_IMAGES = [
  '/icons/plant1.svg',
  '/icons/plant2.svg',
  '/icons/plant3WithFrame.svg',
  '/icons/plant4WithFrame.svg',
  '/icons/plant5.png'
];

export default function MintTab() {
  const { address, chainId } = useAccount();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const { seedBalance: seedBalanceRaw } = useBalances();

  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [strains, setStrains] = useState<Strain[]>([]);
  const [selectedStrain, setSelectedStrain] = useState<Strain | null>(null);
  const [needsApproval, setNeedsApproval] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [mintType, setMintType] = useState<'plant' | 'land'>('plant');
  const [landBalance, setLandBalance] = useState(0);
  const [landSupply, setLandSupply] = useState<{ totalSupply: number; maxSupply: number; } | null>(null);
  const [landMintStatus, setLandMintStatus] = useState<{ canMint: boolean; reason: string; } | null>(null);
  const [needsLandApproval, setNeedsLandApproval] = useState<boolean>(true);
  const [landMintPrice, setLandMintPrice] = useState<bigint>(BigInt(0));
  
  const [forcedFetchCount, setForcedFetchCount] = useState(0);
  const [shareData, setShareData] = useState<{
    address: string;
    strainName: string;
    strainId: number;
    mintedAt: string;
    txHash?: string;
    shareUrl?: string;
  } | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const incrementForcedFetch = () => {
    setForcedFetchCount(prev => prev + 1);
  };

  const fetchData = async () => {
    if (!address) return;
    
    setLoading(true);
    try {
      if (mintType === 'plant') {
        const [balance, strainsData, hasApproval] = await Promise.allSettled([
          getFormattedTokenBalance(address),
          getStrainInfo(),
          checkTokenApproval(address),
        ]);

        if (balance.status === 'fulfilled') setTokenBalance(balance.value);
        if (strainsData.status === 'fulfilled') {
          const availableStrains = strainsData.value.filter(s => s.maxSupply - s.totalMinted > 0);
          setStrains(strainsData.value);
          if (!selectedStrain && availableStrains.length > 0) {
            setSelectedStrain(availableStrains[0]);
          }
        }
        if (hasApproval.status === 'fulfilled') setNeedsApproval(!hasApproval.value);
      } else {
        if (!chainId || !address) return; // Guard against undefined chainId or address
        const [lands, supply, status, landApproval, price] = await Promise.all([
          getLandBalance(address),
          getLandSupply(),
          getLandMintStatus(address),
          checkLandTokenApproval(address),
          getLandMintPrice()
        ]);
        setLandBalance(lands);
        setLandSupply(supply);
        setLandMintStatus(status);
        setNeedsLandApproval(!landApproval);
        setLandMintPrice(price);
      }

    } catch (error) {
      console.error('Unexpected error in fetchData:', error);
      toast.error(getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    
    fetchData();
  }, [address, forcedFetchCount, mintType, chainId]);

  const renderPlantMinting = () => (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Choose a Strain</CardTitle>
        </CardHeader>
        <CardContent>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                {selectedStrain ? (
                  <div className="flex items-center space-x-2">
                    <Image src={PLANT_STATIC_IMAGES[selectedStrain.id -1]} alt={selectedStrain.name} width={24} height={24} />
                    <span>{selectedStrain.name}</span>
                  </div>
                ) : (
                  'Select a Strain'
                )}
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
              {strains.map(strain => {
                const isSoldOut = strain.maxSupply - strain.totalMinted <= 0;
                return (
                  <DropdownMenuItem 
                    key={strain.id} 
                    onSelect={() => !isSoldOut && setSelectedStrain(strain)}
                    disabled={isSoldOut}
                    className={isSoldOut ? 'text-muted-foreground' : ''}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className={`flex items-center space-x-2 ${isSoldOut ? 'line-through' : ''}`}>
                        <Image src={PLANT_STATIC_IMAGES[strain.id - 1]} alt={strain.name} width={24} height={24} />
                        <span>{strain.name}</span>
                      </div>
                      {isSoldOut && (
                        <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                          SOLD OUT
                        </span>
                      )}
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>

      {selectedStrain && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Price</span>
              <div className="flex items-center space-x-1 font-semibold">
                <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                <span>{formatNumber(selectedStrain.mintPrice)} SEED</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Available</span>
              <span className="font-semibold">{formatNumber(selectedStrain.maxSupply - selectedStrain.totalMinted)} / {formatNumber(selectedStrain.maxSupply)}</span>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* StatusBar replaces BalanceCard globally under header */}

      <div className="flex flex-col space-y-2">
        {needsApproval && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Approval</span>
              <SponsoredBadge show={isSponsored && isSmartWallet} />
            </div>
            {/* If smart wallet + sponsored, offer bundled Approve + Mint */}
            {(() => {
              const useBundle = isSmartWallet && isSponsored && !!selectedStrain;
              return useBundle ? (
              <ApproveMintBundle
                strain={selectedStrain.id}
                onSuccess={() => {
                  toast.success('Approved and minted successfully!');
                  setNeedsApproval(false);
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
                }}
                onTransactionComplete={(tx) => {
                  if (address) {
                    const mintedAt = new Date().toISOString();
                    const shareUrl = `/share/mint?address=${encodeURIComponent(address)}&strain=${selectedStrain.id}&name=${encodeURIComponent(selectedStrain.name)}&mintedAt=${encodeURIComponent(mintedAt)}`;
                    setShareData({
                      address,
                      strainName: selectedStrain.name,
                      strainId: selectedStrain.id,
                      mintedAt,
                      txHash: tx?.transactionHash,
                      shareUrl,
                    });
                    setShowShareModal(true);
                  }
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Approve + Mint"
                buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
              />
              ) : (
              <ApproveTransaction
                spenderAddress={PIXOTCHI_NFT_ADDRESS}
                onSuccess={() => {
                  toast.success('Token approval successful!');
                  setNeedsApproval(false);
                  incrementForcedFetch();
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Approve SEED"
                buttonClassName="w-full"
              />
              );
            })()}
          </div>
        )}
        
        {/** Hide Mint step if using bundle path (smart wallet + sponsored + needsApproval) **/}
        {!(isSmartWallet && isSponsored && needsApproval && selectedStrain) && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Mint Plant</span>
              <SponsoredBadge show={isSponsored && isSmartWallet} />
            </div>
            {selectedStrain ? (
              <MintTransaction
                strain={selectedStrain.id}
                onSuccess={(tx) => {
                  toast.success('Plant minted successfully!');
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
                  if (address) {
                    const mintedAt = new Date().toISOString();
                    const shareUrl = `/share/mint?address=${encodeURIComponent(address)}&strain=${selectedStrain.id}&name=${encodeURIComponent(selectedStrain.name)}&mintedAt=${encodeURIComponent(mintedAt)}`;
                    setShareData({
                      address,
                      strainName: selectedStrain.name,
                      strainId: selectedStrain.id,
                      mintedAt,
                      txHash: tx?.transactionHash,
                      shareUrl,
                    });
                    setShowShareModal(true);
                  }
                  try {
                    const fx = (window as any)?.__pixotchi_frame_context__;
                    const fid = fx?.context?.user?.fid;
                    const notificationDetails = fx?.context?.client?.notificationDetails;
                    if (fid) {
                      fetch('/api/notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          fid,
                          notification: {
                            title: 'Mint Completed! 🌱',
                            body: `You minted ${selectedStrain?.name || 'a plant'} — tap to view your farm`,
                            notificationDetails,
                          },
                        }),
                      }).catch(() => {});
                    }
                  } catch {}
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Mint Plant"
                buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
                disabled={needsApproval || (Number(seedBalanceRaw) / 1e18) < (selectedStrain?.mintPrice || 0)}
              />
            ) : (
              <DisabledTransaction
                buttonText="Select a Strain First"
                buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
              />
            )}
          </div>
        )}
      </div>
    </>
  );

  const renderLandMinting = () => (
    <>
      {landSupply && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Price</span>
              <div className="flex items-center space-x-1 font-semibold">
                <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                <span>{formatTokenAmount(landMintPrice)} SEED</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Available</span>
              <span className="font-semibold">{formatNumber(landSupply.maxSupply - landSupply.totalSupply)} / {formatNumber(landSupply.maxSupply)}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {/* StatusBar replaces BalanceCard globally under header */}
      <div className="flex flex-col space-y-2">
        {needsLandApproval && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Step 1: Approve SEED</span>
              <SponsoredBadge show={isSponsored && isSmartWallet} />
            </div>
            <ApproveTransaction
              spenderAddress={LAND_CONTRACT_ADDRESS}
              onSuccess={() => {
                toast.success('Token approval successful!');
                setNeedsLandApproval(false);
                incrementForcedFetch();
              }}
              onError={(error) => toast.error(getFriendlyErrorMessage(error))}
              buttonText="Approve SEED for Land"
              buttonClassName="w-full"
            />
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {needsLandApproval ? 'Step 2: Mint Land' : 'Mint Land'}
          </span>
                            <SponsoredBadge show={isSmartWallet} />
        </div>
        {landMintStatus && !landMintStatus.canMint ? (
          <DisabledTransaction
            buttonText={landMintStatus.reason}
            buttonClassName="w-full"
          />
        ) : (
          <LandMintTransaction
            onSuccess={() => {
              toast.success('Land minted successfully!');
              incrementForcedFetch();
              window.dispatchEvent(new Event('balances:refresh'));
            }}
            onError={(error) => toast.error(getFriendlyErrorMessage(error))}
            buttonText={`Mint Land`}
            buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
            disabled={!landMintStatus?.canMint || needsLandApproval || (Number(seedBalanceRaw) < Number(landMintPrice))}
          />
        )}
      </div>
    </>
  );

  const renderContent = () => {
  if (!address) {
    return (
        <Card className="text-center p-6">
          <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
          <p className="text-muted-foreground mb-4">Please connect your wallet to mint plants.</p>
        </Card>
    );
  }

  if (loading) {
          return (
        <div className="flex items-center justify-center py-8">
          <BaseExpandedLoadingPageLoader text="Loading mint data..." />
          </div>
        )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col space-y-3">
          <div className="flex justify-between items-start w-full gap-4">
            <div className="space-y-2">
              <h3 className="text-xl font-pixel font-bold">
                {mintType === 'plant' ? 'Mint a Plant' : 'Mint a Land'}
              </h3>
              <p className="text-muted-foreground text-sm max-w-xl">
                {mintType === 'plant'
                  ? 'Plant your SEED and mint your very own Pixotchi Plant NFT. Each strain has a unique look and feel.'
                  : 'Expand your onchain farm by minting a new land plot. Lands unlock new buildings and opportunities.'}
              </p>
            </div>
            <ToggleGroup
              value={mintType}
              onValueChange={(v) => setMintType(v as 'plant' | 'land')}
              options={[
                { value: 'plant', label: 'Plants' },
                { value: 'land', label: 'Lands' },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {mintType === 'plant' ? renderPlantMinting() : renderLandMinting()}

      <MintShareModal
        open={showShareModal}
        onOpenChange={setShowShareModal}
        data={shareData}
      />
    </div>
  );
  };

  return <div>{renderContent()}</div>;
} 