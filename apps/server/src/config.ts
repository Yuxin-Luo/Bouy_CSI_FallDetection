import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

export const config = {
  PORT: parseInt(process.env.PORT || '3001'),

  // Timers — keep in env so you can fast-forward for demo
  T1_MS: parseInt(process.env.T1_MS || '45000'),   // user response window
  T2_MS: parseInt(process.env.T2_MS || '120000'),  // contact ack window
  T3_MS: parseInt(process.env.T3_MS || '180000'),  // before 911 prompt

  PUSHER_APP_ID: process.env.PUSHER_APP_ID || '',
  PUSHER_KEY: process.env.PUSHER_KEY || '',
  PUSHER_SECRET: process.env.PUSHER_SECRET || '',
  PUSHER_CLUSTER: process.env.PUSHER_CLUSTER || 'us2',

  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_FROM: process.env.TWILIO_FROM || '',

  // Public URL used in SMS links — set to deployed URL in prod
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
};
