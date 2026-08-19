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
  owner: string,
  toPhoneE164: string,
  template: MessageTemplate,
  variableValues: string[]
): Promise<DispatchResult> {
  if (!template.body_text && !template.media_path) {
    throw new Error(`Template "${template.name}" has no bodyText and no media set`);
  }
  const text = template.body_text ? renderTemplateBody(template.body_text, variableValues) : '';
  const result = await sendTextMessage(owner, toPhoneE164, text, template.media_path, template.media_mime_type);
  return { id: result.id, dryRun: config.dryRun };
}
