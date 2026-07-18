import crypto from 'crypto';
import { config } from '../config';

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body.
 * Meta signs webhook payloads with the App Secret; without this check anyone
 * who finds the webhook URL could POST fake delivery/status events.
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!config.webhook.appSecret) {
    // No app secret configured yet (e.g. local dry-run testing) -- skip verification.
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = crypto
    .createHmac('sha256', config.webhook.appSecret)
    .update(rawBody)
    .digest('hex');
  const provided = signatureHeader.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
