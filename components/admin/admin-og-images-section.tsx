'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { parseAdminShare } from '@/lib/admin-api-data';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError } from './admin-section-shared';

export function AdminOgImagesSection({ adminKey, isActive }: Pick<AdminSectionProps, 'adminKey' | 'isActive'>) {
  const [ogAddress, setOgAddress] = useState('vitalik.eth');
  const [ogSelectedStrain, setOgSelectedStrain] = useState(1);
  const [ogRefreshKey, setOgRefreshKey] = useState(0);
  const [ogShortUrl, setOgShortUrl] = useState('');
  const [ogIsGenerating, setOgIsGenerating] = useState(false);
  const [ogError, setOgError] = useState<string | null>(null);

  const ogStrains = [
    { id: 1, name: 'Flora' },
    { id: 2, name: 'Taki' },
    { id: 3, name: 'Rosa' },
    { id: 4, name: 'Zest' },
    { id: 5, name: 'TYJ' },
  ];

  const handleOgRefresh = () => {
    setOgRefreshKey((prev) => prev + 1);
  };

  const handleOgGenerateShortUrl = async () => {
    setOgIsGenerating(true);
    setOgError(null);
    setOgShortUrl('');
    try {
      const response = await fetch('/api/share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
        body: JSON.stringify({
          address: ogAddress,
          strain: String(ogSelectedStrain),
          name: ogStrains.find((s) => s.id === ogSelectedStrain)?.name || 'Flora',
          mintedAt: new Date().toISOString(),
        }),
      });
      if (response.ok) {
        const data = parseAdminShare(await response.json());
        if (!data) throw new Error('Share link could not be read. Generate it again.');
        setOgShortUrl(data.shortUrl);
        toast.success('Short URL generated!');
      } else {
        throw new Error('Failed to generate short URL. Try again.');
      }
    } catch (error) {
      setOgError(error instanceof Error ? error.message : 'Share link could not be generated. Try again.');
      toast.error('Error generating short URL');
    } finally {
      setOgIsGenerating(false);
    }
  };

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={ogError} onRetry={handleOgGenerateShortUrl} busy={ogIsGenerating} />
    <div className="text-center space-y-2 mb-6">
      <h2 className="text-2xl font-bold">🖼️ OG Image Test Lab</h2>
      <p className="text-muted-foreground">
        Test share images for Twitter & Farcaster without posting
      </p>
    </div>

    {/* Controls */}
    <Card>
      <CardHeader>
        <CardTitle>Test Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="og-address" className="text-sm font-medium">Address / ENS / Basename</label>
          <Input
            id="og-address"
            value={ogAddress}
            onChange={(e) => setOgAddress(e.target.value)}
            placeholder="vitalik.eth or 0x123..."
          />
        </div>

        <div className="space-y-2">
          <p id="og-strain-label" className="text-sm font-medium">Strain</p>
          <div role="group" aria-labelledby="og-strain-label" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ogStrains.map((strain) => (
              <Button
                key={strain.id}
                variant={ogSelectedStrain === strain.id ? 'default' : 'outline'}
                aria-pressed={ogSelectedStrain === strain.id}
                onClick={() => setOgSelectedStrain(strain.id)}
                className="w-full"
              >
                {strain.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={handleOgRefresh} className="w-full">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Images
          </Button>

          <Button
            onClick={handleOgGenerateShortUrl}
            className="w-full"
            variant="secondary"
            disabled={ogIsGenerating}
          >
            {ogIsGenerating ? 'Generating...' : '✨ Generate Short URL'}
          </Button>
        </div>

        {ogShortUrl && (
          <div className="p-3 bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.28)] rounded-lg">
            <div className="text-xs font-semibold text-[hsl(var(--success-strong))] mb-1">
              Short URL Generated:
            </div>
            <div className="font-mono text-sm text-[hsl(var(--success-strong))] break-all">
              {ogShortUrl}
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(ogShortUrl);
                  toast.success('Copied!');
                }}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(ogShortUrl, '_blank')}
              >
                Open
              </Button>
            </div>
          </div>
        )}
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
          <Image
            key={`twitter-${ogRefreshKey}`}
            src={`/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}&v=${ogRefreshKey}`}
            alt="Twitter OG Preview"
            width={1200}
            height={630}
            unoptimized
            className="w-full border border-border rounded-lg"
          />
          <div className="flex gap-2">
            <Input
              aria-label="Share image URL"
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`}
              readOnly
              className="flex-1 text-xs"
            />
            <Button
              size="sm"
              onClick={() => {
                const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`;
                navigator.clipboard.writeText(url);
                toast.success('Copied!');
              }}
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`, '_blank')}
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
          <Image
            key={`farcaster-${ogRefreshKey}`}
            src={`/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}&v=${ogRefreshKey}`}
            alt="Farcaster OG Preview"
            width={1200}
            height={800}
            unoptimized
            className="w-full border border-border rounded-lg"
          />
          <div className="flex gap-2">
            <Input
              aria-label="Share image URL"
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`}
              readOnly
              className="flex-1 text-xs"
            />
            <Button
              size="sm"
              onClick={() => {
                const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`;
                navigator.clipboard.writeText(url);
                toast.success('Copied!');
              }}
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`, '_blank')}
            >
              Open
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Testing Checklist */}
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
          <span>Address/ENS/Basename displays correctly</span>
        </div>
        <div className="flex items-center gap-2">
          <span>✅</span>
          <span>Twitter (1200x630) fits content properly</span>
        </div>
        <div className="flex items-center gap-2">
          <span>✅</span>
          <span>Farcaster (1200x800) uses full vertical space</span>
        </div>
        <div className="flex items-center gap-2">
          <span>✅</span>
          <span>Short URLs work and redirect correctly</span>
        </div>
      </CardContent>
    </Card>
  </div>);
}
