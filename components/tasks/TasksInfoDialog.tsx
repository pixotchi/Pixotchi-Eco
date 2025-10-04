"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAccount } from "wagmi";

export default function TasksInfoDialog() {
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  const [missionDay, setMissionDay] = useState<any | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('pixotchi:openTasks' as any, handler as EventListener);
    return () => window.removeEventListener('pixotchi:openTasks' as any, handler as EventListener);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!address) return;
        const mRes = await fetch(`/api/gamification/missions?address=${address}`);
        if (mRes.ok) {
          const m = await mRes.json();
          setMissionDay(m.day || null);
        }
      } catch {}
    })();
  }, [address, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How Tasks Work</DialogTitle>
          <DialogDescription>
            Earn up to 50 Rock per day by completing 3 sections:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="text-xs text-muted-foreground">Daily reset at 00:00 UTC.</div>
          <div>
            <div className="font-medium">Section 1 (20 Rock)</div>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.buy5 ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Buy at least 5 elements</li>
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.buyShield ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Buy a shield/fence</li>
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.claimProduction ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Claim production from any building</li>
            </ul>
          </div>
          <div>
            <div className="font-medium">Section 2 (20 Rock)</div>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.applyResources ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Apply resources/production to a plant</li>
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.attackPlant ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Attack another plant</li>
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.chatMessage ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Send a message in public chat</li>
            </ul>
          </div>
          <div>
            <div className="font-medium">Section 3 (10 Rock)</div>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.sendQuest ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Send a farmer on a quest</li>
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.placeOrder ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Place a SEED/LEAF order</li>
              <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.claimStake ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Claim stake rewards</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


