import type { ActivityEvent } from './types';

/**
 * Activity feed filtering.
 *
 * The feed mixes 20+ onchain event types from plants, lands, combat and the casino.
 * Active players quickly end up with hundreds of entries in the 24h window, which
 * pushes the events they actually care about (usually "who attacked me") onto the
 * last page. These helpers group events into a small set of player-facing
 * categories and, for combat, resolve whether the viewer was the aggressor or the
 * target.
 */

export type ActivityTypename = ActivityEvent['__typename'];

export type ActivityCategoryId = 'all' | 'attacks' | 'plants' | 'lands' | 'casino';
export type ActivityDirectionId = 'all' | 'incoming' | 'outgoing';
export type ActivityDirection = Exclude<ActivityDirectionId, 'all'>;

type ActivityCategoryBucket = Exclude<ActivityCategoryId, 'all'>;

export const ACTIVITY_CATEGORY_IDS = ['all', 'attacks', 'plants', 'lands', 'casino'] as const;
export const ACTIVITY_DIRECTION_IDS = ['all', 'incoming', 'outgoing'] as const;

export const DEFAULT_ACTIVITY_CATEGORY: ActivityCategoryId = 'all';
export const DEFAULT_ACTIVITY_DIRECTION: ActivityDirectionId = 'all';

/**
 * Every indexed event type maps to exactly one category. The `Record` is keyed by
 * the full `ActivityEvent` union, so adding a new event type fails typecheck here
 * until it has been categorised - the feed can never silently drop an event.
 */
const CATEGORY_BY_TYPENAME: Record<ActivityTypename, ActivityCategoryBucket> = {
  // Combat
  Attack: 'attacks',
  Killed: 'attacks',
  BarracksRaidEvent: 'attacks',

  // Plants
  Mint: 'plants',
  Played: 'plants',
  ItemConsumed: 'plants',
  ShopItemPurchased: 'plants',

  // Lands, buildings and quests
  LandTransferEvent: 'lands',
  LandMintedEvent: 'lands',
  LandNameChangedEvent: 'lands',
  VillageUpgradedWithLeafEvent: 'lands',
  VillageSpeedUpWithSeedEvent: 'lands',
  TownUpgradedWithLeafEvent: 'lands',
  TownSpeedUpWithSeedEvent: 'lands',
  QuestStartedEvent: 'lands',
  QuestFinalizedEvent: 'lands',
  VillageProductionClaimedEvent: 'lands',
  BarracksBuiltEvent: 'lands',
  CasinoBuiltEvent: 'lands',

  // Casino games
  RouletteSpinResultEvent: 'casino',
  BlackjackResultEvent: 'casino',
  BaccaratRoundResultEvent: 'casino',
};

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategoryId, string> = {
  all: 'All',
  attacks: 'Attacks',
  plants: 'Plants',
  lands: 'Lands',
  casino: 'Casino',
};

export const ACTIVITY_CATEGORY_ARIA_LABELS: Record<ActivityCategoryId, string> = {
  all: 'All activity',
  attacks: 'Attacks and raids',
  plants: 'Plant activity',
  lands: 'Land and building activity',
  casino: 'Casino activity',
};

/** Empty-state copy, keyed by category. */
export const ACTIVITY_CATEGORY_EMPTY_LABELS: Record<ActivityCategoryId, string> = {
  all: 'activity',
  attacks: 'attacks or raids',
  plants: 'plant activity',
  lands: 'land activity',
  casino: 'casino activity',
};

export const ACTIVITY_DIRECTION_LABELS: Record<ActivityDirectionId, string> = {
  all: 'All',
  incoming: 'On Me',
  outgoing: 'By Me',
};

export const ACTIVITY_DIRECTION_ARIA_LABELS: Record<ActivityDirectionId, string> = {
  all: 'All attacks and raids',
  incoming: 'Attacks and raids on me',
  outgoing: 'Attacks and raids by me',
};

export const ACTIVITY_DIRECTION_EMPTY_LABELS: Record<ActivityDirectionId, string> = {
  all: 'attacks or raids',
  incoming: 'attacks or raids on you',
  outgoing: 'attacks or raids by you',
};

/**
 * The viewer's own assets, used to tell an incoming attack from an outgoing one.
 * IDs are normalised to strings because indexed events return them as strings.
 */
export type ActivityPerspective = {
  landIds: ReadonlySet<string>;
  plantIds: ReadonlySet<string>;
};

export const EMPTY_ACTIVITY_PERSPECTIVE: ActivityPerspective = {
  landIds: new Set<string>(),
  plantIds: new Set<string>(),
};

export function createActivityPerspective(
  plantIds: ReadonlyArray<string | number> = [],
  landIds: ReadonlyArray<string | number> = [],
): ActivityPerspective {
  return {
    landIds: new Set(landIds.map((id) => String(id))),
    plantIds: new Set(plantIds.map((id) => String(id))),
  };
}

export function hasActivityPerspective(perspective: ActivityPerspective | null | undefined): boolean {
  return Boolean(perspective && (perspective.plantIds.size > 0 || perspective.landIds.size > 0));
}

export function isActivityCategoryId(value: unknown): value is ActivityCategoryId {
  return typeof value === 'string' && (ACTIVITY_CATEGORY_IDS as readonly string[]).includes(value);
}

export function isActivityDirectionId(value: unknown): value is ActivityDirectionId {
  return typeof value === 'string' && (ACTIVITY_DIRECTION_IDS as readonly string[]).includes(value);
}

export function parseActivityCategory(rawValue: string | null): ActivityCategoryId | null {
  return isActivityCategoryId(rawValue) ? rawValue : null;
}

export function parseActivityDirection(rawValue: string | null): ActivityDirectionId | null {
  return isActivityDirectionId(rawValue) ? rawValue : null;
}

export function getActivityCategory(event: Pick<ActivityEvent, '__typename'>): ActivityCategoryBucket | null {
  return CATEGORY_BY_TYPENAME[event.__typename] ?? null;
}

/** Direction is only defined for the combat categories; everything else returns null. */
export function isDirectionalActivityCategory(category: ActivityCategoryId): boolean {
  return category === 'attacks';
}

/**
 * Resolve whether the viewer was the aggressor or the target.
 *
 * Plant attacks record `attacker` (who initiated) plus `winner`/`loser` (the
 * outcome), so a defender that survives appears only as `winner` - being involved
 * without being the attacker is what makes an attack incoming.
 */
export function getActivityDirection(
  event: ActivityEvent,
  perspective: ActivityPerspective,
): ActivityDirection | null {
  const { landIds, plantIds } = perspective;

  switch (event.__typename) {
    case 'Attack': {
      if (plantIds.has(String(event.attacker))) return 'outgoing';
      if (plantIds.has(String(event.winner)) || plantIds.has(String(event.loser))) return 'incoming';
      return null;
    }
    case 'Killed': {
      // `nftId` is the killer's plant, `deadId` is the plant that was burned.
      if (plantIds.has(String(event.nftId))) return 'outgoing';
      if (plantIds.has(String(event.deadId))) return 'incoming';
      return null;
    }
    case 'BarracksRaidEvent': {
      if (landIds.has(String(event.attackerLandId))) return 'outgoing';
      if (landIds.has(String(event.defenderLandId))) return 'incoming';
      return null;
    }
    default:
      return null;
  }
}

export type ActivityFilterOptions = {
  category: ActivityCategoryId;
  direction?: ActivityDirectionId;
  perspective?: ActivityPerspective | null;
};

/**
 * Filter a feed by category and (for combat) direction. Direction is ignored
 * unless the category supports it and the viewer's assets are known, so a stale
 * direction value can never blank out an unrelated category.
 */
export function filterActivityEvents<T extends ActivityEvent>(
  events: readonly T[],
  { category, direction = DEFAULT_ACTIVITY_DIRECTION, perspective }: ActivityFilterOptions,
): readonly T[] {
  const applyDirection =
    direction !== 'all' && isDirectionalActivityCategory(category) && hasActivityPerspective(perspective);

  if (category === 'all' && !applyDirection) {
    return events;
  }

  return events.filter((event) => {
    if (category !== 'all' && getActivityCategory(event) !== category) {
      return false;
    }

    if (applyDirection && getActivityDirection(event, perspective as ActivityPerspective) !== direction) {
      return false;
    }

    return true;
  });
}

/**
 * Resolve the direction a feed should actually use. Keeps the UI, the URL and the
 * filtering in agreement when the category or the viewer context changes.
 */
export function resolveActivityDirection(
  category: ActivityCategoryId,
  direction: ActivityDirectionId,
  perspective?: ActivityPerspective | null,
): ActivityDirectionId {
  if (!isDirectionalActivityCategory(category) || !hasActivityPerspective(perspective)) {
    return DEFAULT_ACTIVITY_DIRECTION;
  }

  return direction;
}
