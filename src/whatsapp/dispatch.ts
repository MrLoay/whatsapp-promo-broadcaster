import { config } from '../config';
import { sendTemplateMessage as sendCloudApiTemplate } from './client';
import { sendTextMessage as sendWebJsText } from './webjs-client';
import { renderTemplateBody } from './render';
import type { MessageTemplate } from '../services/templates';

export interface DispatchResult {
  id: string;
  dryRun: boolean;
  provider: 'cloud_api' | 'web_js';
}

/** Sends a campaign message via whichever provider is configured (WHATSAPP_PROVIDER). */
export async function sendCampaignMessage(
  toPhoneE164: string,
  template: MessageTemplate,
  variableValues: string[]
): Promise<DispatchResult> {
  if (config.whatsapp.provider === 'web_js') {
    if (!template.body_text) {
      throw new Error(`Template "${template.name}" has no bodyText set, required for the web_js provider`);
    }
    const text = renderTemplateBody(template.body_text, variableValues);
    const result = await sendWebJsText(toPhoneE164, text);
    return { id: result.id, dryRun: config.dryRun, provider: 'web_js' };
  }

  if (!template.meta_template_name) {
    throw new Error(`Template "${template.name}" has no metaTemplateName set, required for the cloud_api provider`);
  }
  const result = await sendCloudApiTemplate(toPhoneE164, template.meta_template_name, template.language, variableValues);
  return { id: result.wamid, dryRun: result.dryRun, provider: 'cloud_api' };
}
