import type { CreateRuleInput } from './triggrr';

const DEMO_WEBHOOK_PATH = '/api/demo-webhook';

export function getDemoWebhookUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DEMO_WEBHOOK_URL?.trim();
  if (configured) return configured;

  if (typeof window !== 'undefined') {
    return new URL(DEMO_WEBHOOK_PATH, window.location.origin).toString();
  }

  return DEMO_WEBHOOK_PATH;
}

export function withDemoWebhook(rule: CreateRuleInput): CreateRuleInput {
  if (rule.action_type !== 'webhook') {
    return rule;
  }

  return {
    ...rule,
    action_config: {
      ...rule.action_config,
      url: getDemoWebhookUrl(),
    },
  };
}
