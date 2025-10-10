"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const strains = [
  { id: 1, name: "OG" },
  { id: 2, name: "FLORA" },
  { id: 3, name: "TAKI" },
  { id: 4, name: "ROSA" },
  { id: 5, name: "ZEST" },
];

export default function OGImageTestPage() {
  const [address, setAddress] = useState("vitalik.eth");
  const [selectedStrain, setSelectedStrain] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const twitterUrl = `${baseUrl}/api/og/mint?platform=twitter&address=${encodeURIComponent(
    address
  )}&strain=${selectedStrain}&v=${refreshKey}`;

  const farcasterUrl = `${baseUrl}/api/og/mint?platform=farcaster&address=${encodeURIComponent(
    address
  )}&strain=${selectedStrain}&v=${refreshKey}`;

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold">🖼️ OG Image Test Lab</h1>
          <p className="text-muted-foreground">
            Secret endpoint to preview share images for Twitter & Farcaster
          </p>
        </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Test Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Address / ENS / Basename</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="vitalik.eth or 0x123..."
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Strain</label>
              <div className="grid grid-cols-5 gap-2">
                {strains.map((strain) => (
                  <Button
                    key={strain.id}
                    variant={selectedStrain === strain.id ? "default" : "outline"}
                    onClick={() => setSelectedStrain(strain.id)}
                    className="w-full"
                  >
                    {strain.name}
                  </Button>
                ))}
              </div>
            </div>

            <Button onClick={handleRefresh} className="w-full">
              🔄 Refresh Images
            </Button>
          </CardContent>
        </Card>

        {/* Twitter Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>🐦 Twitter</span>
              <span className="text-sm font-normal text-muted-foreground">
                (1200 x 630)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <img
                key={twitterUrl}
                src={twitterUrl}
                alt="Twitter OG Preview"
                className="w-full border border-border rounded-lg"
              />
              <div className="flex gap-2">
                <Input value={twitterUrl} readOnly className="flex-1 text-xs" />
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(twitterUrl);
                  }}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(twitterUrl, "_blank")}
                >
                  Open
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Farcaster Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>🟣 Farcaster</span>
              <span className="text-sm font-normal text-muted-foreground">
                (1200 x 800 - 3:2 ratio)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <img
                key={farcasterUrl}
                src={farcasterUrl}
                alt="Farcaster OG Preview"
                className="w-full border border-border rounded-lg"
              />
              <div className="flex gap-2">
                <Input value={farcasterUrl} readOnly className="flex-1 text-xs" />
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(farcasterUrl);
                  }}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(farcasterUrl, "_blank")}
                >
                  Open
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>📝 Testing Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>Text is readable against background</span>
            </div>
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>Plant image is clearly visible on left</span>
            </div>
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>Address/ENS displays correctly</span>
            </div>
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>Twitter (1200x630) fits content properly</span>
            </div>
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>Farcaster (1200x800) uses full vertical space</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

