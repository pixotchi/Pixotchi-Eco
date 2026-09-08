import { openBroadcastUrl as openActualBroadcastUrl } from '../../../lib/broadcast-navigation';
export function openBroadcastUrl(url: string): Promise<void> {
  if (new URLSearchParams(location.search).get('slowBroadcast') !== '1') return openActualBroadcastUrl(url);
  return new Promise(resolve => window.addEventListener('fixture:resolve-broadcast', () => resolve(), { once: true }));
}
