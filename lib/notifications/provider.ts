export type NotificationProvider = 'neynar' | 'base';

export const DEFAULT_NOTIFICATION_PROVIDER: NotificationProvider = 'neynar';

export function normalizeNotificationProvider(value?: string | null): NotificationProvider {
  return String(value || '').trim().toLowerCase() === 'base' ? 'base' : DEFAULT_NOTIFICATION_PROVIDER;
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
