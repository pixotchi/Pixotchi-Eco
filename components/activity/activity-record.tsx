'use client';

import { useMemo, type ReactNode } from 'react';
import Image from 'next/image';
import { ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ActivityEvent } from '@/lib/types';
import { activityDate } from '@/lib/activity-presentation';
import { getActivityHeadline, getActivityIcon, getActivitySource, type ActivityItemNames } from '@/lib/activity-metadata';
import { useRelativeTimeTick } from '@/hooks/useRelativeTimeTick';

function ActivityTime({ timestamp }: { timestamp: string }) {
  const tick = useRelativeTimeTick();
  const date = activityDate(timestamp);
  const relative = useMemo(() => {
    const current = activityDate(timestamp);
    return current ? formatDistanceToNow(current, { addSuffix: true }) : 'Time unavailable';
    // The shared visible clock keeps a fixed event's relative text current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timestamp, tick]);
  return <time dateTime={date?.toISOString()} title={date?.toLocaleString()}>{relative}</time>;
}

/** One concise result, with the complete existing record available by touch or keyboard. */
export function ActivityRecord({ children, event, shopItemMap, gardenItemMap, isMine }: {
  children: ReactNode; event: ActivityEvent; shopItemMap?: ActivityItemNames; gardenItemMap?: ActivityItemNames; isMine?: boolean;
}) {
  const icon = getActivityIcon(event, shopItemMap, gardenItemMap);
  const source = getActivitySource(event);
  const sourceLabel = source.id === null ? source.name : `${source.kind === 'land' ? 'Land' : 'Plant'} #${source.id}`;
  return <details data-activity-record className="group surface-group min-w-0 px-2 py-1 [overflow-wrap:anywhere]">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <Image src={icon.icon} alt="" width={24} height={24} className="h-[24px] w-[24px] shrink-0 object-contain" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{getActivityHeadline(event, shopItemMap, gardenItemMap)}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {sourceLabel && <>{sourceLabel}{isMine && ' (You)'} · </>}<ActivityTime timestamp={event.timestamp} />
        </span>
      </span>
      <ChevronDown aria-hidden="true" className="h-[16px] w-[16px] shrink-0 text-muted-foreground group-open:rotate-180" />
      <span className="sr-only">Show full activity details</span>
    </summary>
    <div className="surface-inset space-y-2 rounded-[var(--radius-control)] px-2 py-2 text-sm leading-relaxed sm:ml-8 sm:px-3">
      {children}
    </div>
  </details>;
}
