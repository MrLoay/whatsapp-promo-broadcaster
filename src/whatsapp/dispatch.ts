import { config } from '../config';
import { sendTextMessage } from './webjs-client';
import { renderTemplateBody } from './render';
import type { MessageTemplate } from '../services/templates';

export interface DispatchResult {
  id: string;
  dryRun: boolean;
}

/**
 * Sends a campaign message via whatsapp-web.js. The official Meta Cloud API
 * path will come back once a WABA is approved -- see SETUP_META.md.
 */
export async function sendCampaignMessage(
  toPhoneE164: string,
  template: MessageTemplate,
  variableValues: string[]
): Promise<DispatchResult> {
  if (!template.body_text) {
    throw new Error(`Template "${template.name}" has no bodyText set`);
  }
  const text = renderTemplateBody(template.body_text, variableValues);
  const result = await sendTextMessage(toPhoneE164, text);
  return { id: result.id, dryRun: config.dryRun };
}
