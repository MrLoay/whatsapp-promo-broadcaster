import { config } from '../config';

export interface TemplateComponent {
  type: 'body';
  parameters: { type: 'text'; text: string }[];
}

export interface SendTemplateResult {
  wamid: string;
  dryRun: boolean;
}

function graphUrl(): string {
  return `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}/messages`;
}

export async function sendTemplateMessage(
  toPhoneE164: string,
  metaTemplateName: string,
  language: string,
  variableValues: string[]
): Promise<SendTemplateResult> {
  const components: TemplateComponent[] =
    variableValues.length > 0
      ? [{ type: 'body', parameters: variableValues.map((text) => ({ type: 'text', text })) }]
      : [];

  const payload = {
    messaging_product: 'whatsapp',
    to: toPhoneE164,
    type: 'template',
    template: {
      name: metaTemplateName,
      language: { code: language },
      components,
    },
  };

  if (config.dryRun) {
    const fakeId = `dryrun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DRY_RUN] Would POST ${graphUrl()}\n${JSON.stringify(payload, null, 2)}`);
    return { wamid: fakeId, dryRun: true };
  }

  const response = await fetch(graphUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as {
    messages?: { id: string }[];
    error?: { message: string };
  };

  if (!response.ok || !data.messages?.[0]?.id) {
    throw new Error(`WhatsApp send failed: ${data.error?.message ?? response.statusText}`);
  }

  return { wamid: data.messages[0].id, dryRun: false };
}
