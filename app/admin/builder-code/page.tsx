"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ExternalLink, Copy, RefreshCw } from "lucide-react";

// Simple Badge component since ui/badge doesn't exist
const Badge = ({ 
  children, 
  variant = "default",
  className = "" 
}: { 
  children: React.ReactNode; 
  variant?: "default" | "destructive" | "outline"; 
  className?: string;
}) => {
  const baseClasses = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const variantClasses = {
    default: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    destructive: "bg-red-500/20 text-red-400 border border-red-500/30",
    outline: "border border-zinc-600 text-zinc-300",
  };
  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
};
import { getDataSuffix, getBuilderCode, isBuilderCodeConfigured } from "@/lib/builder-code";

export default function BuilderCodeDiagnosticPage() {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 flex items-center justify-center">
        <div className="animate-pulse text-zinc-500">Loading diagnostics...</div>
      </div>
    );
  }

  const builderCode = getBuilderCode();
  const isConfigured = isBuilderCodeConfigured();
  const dataSuffix = getDataSuffix();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // Parse the dataSuffix to show its structure
  const parseSuffix = (suffix: string | undefined) => {
    if (!suffix) return null;
    return {
      full: suffix,
      length: suffix.length,
      bytes: (suffix.length - 2) / 2, // Remove 0x prefix, each byte is 2 hex chars
    };
  };

  const suffixInfo = parseSuffix(dataSuffix);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Builder Code Diagnostics</h1>
            <p className="text-zinc-400 mt-1">ERC-8021 Attribution Tracking</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        {/* Status Overview */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isConfigured ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              Configuration Status
            </CardTitle>
            <CardDescription>
              Builder Code integration for onchain activity attribution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                <div className="text-sm text-zinc-400 mb-1">Environment Variable</div>
                <div className="font-mono text-sm">NEXT_PUBLIC_BUILDER_CODE</div>
                <Badge 
                  variant={isConfigured ? "default" : "destructive"} 
                  className="mt-2"
                >
                  {isConfigured ? "Configured" : "Not Set"}
                </Badge>
              </div>
              
              <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                <div className="text-sm text-zinc-400 mb-1">Builder Code</div>
                <div className="font-mono text-sm flex items-center gap-2">
                  {builderCode || <span className="text-zinc-500 italic">Not configured</span>}
                  {builderCode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => copyToClipboard(builderCode, "code")}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {copied === "code" && (
                  <span className="text-xs text-emerald-500">Copied!</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Suffix Details */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle>Data Suffix (ERC-8021)</CardTitle>
            <CardDescription>
              The hex-encoded suffix appended to all transaction calldata
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {suffixInfo ? (
              <>
                <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                  <div className="text-sm text-zinc-400 mb-2">Generated Suffix</div>
                  <div className="font-mono text-xs break-all bg-zinc-900 p-3 rounded border border-zinc-700 flex items-start gap-2">
                    <span className="flex-1">{suffixInfo.full}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={() => copyToClipboard(suffixInfo.full, "suffix")}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                  {copied === "suffix" && (
                    <span className="text-xs text-emerald-500">Copied!</span>
                  )}
                </div>
                
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                    <div className="text-sm text-zinc-400 mb-1">Suffix Length</div>
                    <div className="text-2xl font-bold">{suffixInfo.length} chars</div>
                    <div className="text-xs text-zinc-500">{suffixInfo.bytes} bytes</div>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                    <div className="text-sm text-zinc-400 mb-1">Status</div>
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      Active
                    </Badge>
                    <div className="text-xs text-zinc-500 mt-1">Suffix will be appended to all txs</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-6 text-center text-zinc-500 border border-dashed border-zinc-700 rounded-lg">
                <XCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No data suffix generated</p>
                <p className="text-sm mt-1">Configure NEXT_PUBLIC_BUILDER_CODE to enable</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Integration Points */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle>Integration Points</CardTitle>
            <CardDescription>
              Components and functions that include builder code attribution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { name: "SponsoredTransaction", path: "components/transactions/sponsored-transaction.tsx", type: "OnchainKit" },
                { name: "UniversalTransaction", path: "components/transactions/universal-transaction.tsx", type: "OnchainKit" },
                { name: "SmartWalletTransaction", path: "components/transactions/smart-wallet-transaction.tsx", type: "OnchainKit" },
                { name: "ClaimRewardsTransaction", path: "components/transactions/claim-rewards-transaction.tsx", type: "OnchainKit" },
                { name: "PlantNameTransaction", path: "components/transactions/plant-name-transaction.tsx", type: "OnchainKit" },
                { name: "TransferAssetsDialog", path: "components/transactions/transfer-assets-dialog.tsx", type: "Legacy" },
                { name: "transferPlants()", path: "lib/contracts.ts", type: "Legacy" },
                { name: "transferLands()", path: "lib/contracts.ts", type: "Legacy" },
                { name: "routerBatchTransfer()", path: "lib/contracts.ts", type: "Legacy" },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30 border border-zinc-800"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">{item.path}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {item.type}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Verification Links */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle>Verification & Tracking</CardTitle>
            <CardDescription>
              External resources to verify and track your builder code activity
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <a
              href="https://base.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:border-zinc-600 transition-colors"
            >
              <div>
                <div className="font-medium">Base.dev Dashboard</div>
                <div className="text-sm text-zinc-400">View your app analytics and attributed transactions</div>
              </div>
              <ExternalLink className="w-5 h-5 text-zinc-400" />
            </a>
            
            <a
              href="https://basescan.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:border-zinc-600 transition-colors"
            >
              <div>
                <div className="font-medium">Basescan</div>
                <div className="text-sm text-zinc-400">Inspect transaction calldata to verify suffix</div>
              </div>
              <ExternalLink className="w-5 h-5 text-zinc-400" />
            </a>
            
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <div className="font-medium mb-1">💡 How to verify on Basescan</div>
              <ol className="text-sm space-y-1 list-decimal list-inside text-blue-300/80">
                <li>Execute any transaction in your app</li>
                <li>Open the transaction on Basescan</li>
                <li>Click "Click to see More" → "Input Data"</li>
                <li>The builder code suffix should appear at the end of the calldata</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-zinc-500 py-4">
          <a 
            href="/admin/invite" 
            className="hover:text-zinc-400 underline underline-offset-4"
          >
            ← Back to Admin Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

