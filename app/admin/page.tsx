"use client";

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Megaphone, Users, Settings } from 'lucide-react';

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Shield className="w-10 h-10 text-primary" />
            <h1 className="text-4xl font-bold">Pixotchi Admin Dashboard</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Manage your game systems and player communications
          </p>
        </div>

        {/* Admin Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Broadcast Messages */}
          <Link href="/admin/broadcast">
            <Card className="hover:border-primary transition-all cursor-pointer h-full group">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
                    <Megaphone className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <CardTitle>Broadcast Messages</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  Send alerts, announcements, and updates to all players. Manage in-game notifications
                  for events, giveaways, contests, and system updates.
                </CardDescription>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li>• Create targeted announcements</li>
                  <li>• Track message impressions</li>
                  <li>• Schedule expiration times</li>
                  <li>• Choose user targeting (current vs all)</li>
                </ul>
              </CardContent>
            </Card>
          </Link>

          {/* Invite System */}
          <Link href="/admin/invite">
            <Card className="hover:border-primary transition-all cursor-pointer h-full group">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                    <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <CardTitle>Invite System</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  Manage invite codes, user access, and system statistics. Control who can access
                  the game and track user growth.
                </CardDescription>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li>• Generate invite codes</li>
                  <li>• View user statistics</li>
                  <li>• Manage chat & AI interactions</li>
                  <li>• Monitor gamification & RPC</li>
                </ul>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Quick Stats */}
        <div className="mt-12 p-6 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-3 mb-4">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Admin Access</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            You need to authenticate with your admin key to access these tools. Your admin key is stored
            locally in your browser for convenience.
          </p>
        </div>
      </div>
    </div>
  );
}

