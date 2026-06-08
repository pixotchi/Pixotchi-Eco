export type NotificationProvider = 'neynar' | 'base';

export const DEFAULT_NOTIFICATION_PROVIDER: NotificationProvider = 'base';

export function normalizeNotificationProvider(value?: string | null): NotificationProvider {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'base') return 'base';
  return normalized === 'neynar' ? 'neynar' : DEFAULT_NOTIFICATION_PROVIDER;
}

export function getNotificationProviderLabel(provider: NotificationProvider): string {
  return provider === 'base' ? 'Base App' : 'Neynar';
}

export function isBaseNotificationProvider(value?: string | null): boolean {
  return normalizeNotificationProvider(value) === 'base';
}

export function isNeynarNotificationProvider(value?: string | null): boolean {
  return normalizeNotificationProvider(value) === 'neynar';
}
