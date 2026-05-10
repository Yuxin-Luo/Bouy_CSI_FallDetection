import twilio from 'twilio';
import { config } from './config';

const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

// Set TWILIO_MODE=sms for a paid Twilio account with a real phone number.
// Default is 'whatsapp' (sandbox). Switch to 'sms' once you have a subscription.
const mode = process.env.TWILIO_MODE || 'whatsapp';

export async function sendSMS(to: string, body: string): Promise<void> {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_FROM) {
    console.warn('[SMS] Twilio not configured — skipping message to', to);
    console.warn('[SMS] Message:', body);
    return;
  }
  // Normalise number — strip any existing prefix
  const bare = to.replace(/^whatsapp:/, '');
  const toAddr  = mode === 'sms' ? bare : `whatsapp:${bare}`;
  const fromAddr = mode === 'sms' ? config.TWILIO_FROM : `whatsapp:${config.TWILIO_FROM}`;

  try {
    await client.messages.create({ to: toAddr, from: fromAddr, body });
    console.log(`[SMS/${mode}] Sent to`, bare);
  } catch (err) {
    console.error(`[SMS/${mode}] Failed to send to`, bare, err);
  }
}
