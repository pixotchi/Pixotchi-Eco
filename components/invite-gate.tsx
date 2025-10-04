"use client";

import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useMiniKit, useAddFrame } from "@coinbase/onchainkit/minikit";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info, Gift, ExternalLink, User, PlusCircle } from 'lucide-react';
import Image from 'next/image';
import { useTheme } from "next-themes";
import InviteCodeInput from './invite-code-input';
import { getLocalStorageKeys } from '@/lib/invite-utils';
import { toast } from 'react-hot-toast';
import { WalletProfile } from './wallet-profile';
import { ThemeSelector } from './theme-selector';

interface InviteGateProps {
  onValidated: (code: string) => void;
  onSkip?: () => void;
  showSkip?: boolean;
}

export default function InviteGate({ onValidated, onSkip, showSkip = false }: InviteGateProps) {
  const { address, isConnected } = useAccount();
  const { context } = useMiniKit();
  const { theme } = useTheme();
  const [urlCode, setUrlCode] = useState<string>('');
  const [showWalletProfile, setShowWalletProfile] = useState(false);

  const addFrame = useAddFrame();

  useEffect(() => {
    // Check for invite code in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const inviteParam = urlParams.get('invite');
    if (inviteParam) {
      setUrlCode(inviteParam.toUpperCase());
      // Clean URL after extracting code
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const handleAddFrame = async () => {
    const result = await addFrame();
    console.log("Frame added:", result);
  };

  const handleValidated = async (code: string) => {
    try {
      // Store validation in localStorage
      const keys = getLocalStorageKeys();
      localStorage.setItem(keys.INVITE_VALIDATED, 'true');
      localStorage.setItem(keys.VALIDATED_CODE, code);
      
      // Store wallet address if connected
      if (address) {
        localStorage.setItem(keys.USER_ADDRESS, address);
      }

      toast.success('Access granted! Welcome to Pixotchi Mini!');
      onValidated(code);
    } catch (error) {
      console.error('Error handling validation:', error);
      toast.error('Validation succeeded but failed to save state');
      onValidated(code);
    }
  };

  return (
    <div className="flex justify-center w-full min-h-dvh bg-background">
      <div className="w-full max-w-md flex flex-col h-dvh bg-background">
        {/* Header wrapper with matching background */}
        <div className="bg-card/90 backdrop-blur-sm">
          <header className="bg-card/90 backdrop-blur-sm border-b border-border px-4 py-2 safe-area-top">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Image
                  src="/PixotchiKit/Logonotext.svg"
                  alt="Pixotchi Mini Logo"
                  width={24}
                  height={24}
                />
                <h1 className="text-sm font-pixel text-foreground">
                  PIXOTCHI MINI
                </h1>
              </div>

              <div className="flex items-center space-x-2">
                {context && !context.client.added && (
                  <Button variant="outline" size="sm" onClick={handleAddFrame}>
                    <PlusCircle className="w-4 h-4" />
                  </Button>
                )}

                {isConnected && address ? (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowWalletProfile(true)}
                  >
                    <Image 
                      src={theme === "pink" ? "/icons/Avatar1.svg" : "/icons/Avatar2.svg"} 
                      alt="Profile" 
                      width={24} 
                      height={24} 
                      className="w-6 h-6"
                    />
                  </Button>
                ) : null}
                <ThemeSelector />
              </div>
            </div>
          </header>
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-8">
            {/* Header */}
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Image
                  src="/PixotchiKit/Logonotext.svg"
                  alt="Pixotchi Logo"
                  width={80}
                  height={80}
                  sizes="80px"
                  quality={90}
                  priority
                  className="opacity-90"
                />
              </div>
              
              <div>
                <h1 className="text-2xl font-pixel text-foreground mb-2">
                  Invite Required
                </h1>
                <p className="text-muted-foreground text-sm">
                  Pixotchi Mini is currently invite-only. Enter your invite code to continue.
                </p>
              </div>
            </div>

            {/* Invite Code Input */}
            <InviteCodeInput 
              onValidated={handleValidated}
              initialCode={urlCode}
              autoSubmit={!!urlCode}
            />

            {/* Skip for development */}
            {showSkip && onSkip && (
              <div className="text-center">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={onSkip}
                  className="text-muted-foreground"
                >
                  Skip (Development Mode)
                </Button>
              </div>
            )}

            {/* Wallet connection reminder */}
            {!address && (
              <Card className="bg-destructive/10 border-destructive/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <div className="font-medium text-foreground mb-1">
                        Connect Your Wallet
                      </div>
                      <p className="text-muted-foreground">
                        For the best experience, connect your wallet after validation 
                        to automatically track your invite usage.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Wallet Profile Modal */}
        {showWalletProfile && (
          <WalletProfile 
            open={showWalletProfile} 
            onOpenChange={setShowWalletProfile}
          />
        )}
      </div>
    </div>
  );
} 