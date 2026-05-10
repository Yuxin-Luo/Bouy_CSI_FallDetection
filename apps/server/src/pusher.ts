import Pusher from 'pusher';
import { config } from './config';

export const pusher = new Pusher({
  appId: config.PUSHER_APP_ID,
  key: config.PUSHER_KEY,
  secret: config.PUSHER_SECRET,
  cluster: config.PUSHER_CLUSTER,
  useTLS: true,
});

export function pushToHousehold(householdCode: string, event: string, data: object) {
  if (!config.PUSHER_APP_ID || !config.PUSHER_KEY || !config.PUSHER_SECRET) {
    console.warn('[Pusher] Not configured — skipping push:', event, data);
    return Promise.resolve();
  }
  return pusher.trigger(`household-${householdCode}`, event, data).catch((err: unknown) => {
    console.error('[Pusher] Failed to push:', err);
  });
}
