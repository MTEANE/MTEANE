'use client';

import { useEffect, useState } from 'react';
import { triggrr, type CreateRuleInput, type Rule } from '@/lib/triggrr';
import { SCENARIOS } from '@/lib/scenarios';
import { getDemoWebhookUrl } from '@/lib/demo-webhook';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Webhook } from 'lucide-react';

const EVENT_TYPE_PATTERN = /^[a-z]+\.[a-z_]+$/;

const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'startsWith',
  'endsWith',
  'exists',
  'regex',
] as const;

type Operator = (typeof OPERATORS)[number];

function conditionValueToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function parseConditionValue(raw: string, operator: Operator): unknown {
  if (operator === 'exists') return null;
  const t = raw.trim();
  if (t === '') throw new Error('Condition value is required (unless operator is exists).');
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return t;
  }
}

function defaultCreateState() {
  return {
    templateId: '' as string,
    name: '',
    event_type: '',
    conditionField: '',
    operator: 'eq' as Operator,
    conditionValue: '',
    action_type: 'webhook' as CreateRuleInput['action_type'],
    webhookUrl: '',
    slackWebhookUrl: '',
    emailTo: '',
    emailSubject: '',
    emailBody: '',
  };
}

export type RuleFormMode = 'create' | 'edit';

interface RuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RuleFormMode;
  rule?: Rule | null;
  onSuccess: () => void;
}

export function RuleFormDialog({
  open,
  onOpenChange,
  mode,
  rule,
  onSuccess,
}: RuleFormDialogProps) {
  const [state, setState] = useState(defaultCreateState);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && rule) {
      setState({
        templateId: '',
        name: rule.name,
        event_type: rule.event_type,
        conditionField: rule.condition.field,
        operator: (OPERATORS.includes(rule.condition.operator as Operator)
          ? rule.condition.operator
          : 'eq') as Operator,
        conditionValue: conditionValueToString(rule.condition.value),
        action_type: rule.action_type,
        webhookUrl:
          rule.action_type === 'webhook' ? String(rule.action_config.url ?? '') : '',
        slackWebhookUrl:
          rule.action_type === 'slack'
            ? String(rule.action_config.webhook_url ?? '')
            : '',
        emailTo: rule.action_type === 'email' ? String(rule.action_config.to ?? '') : '',
        emailSubject:
          rule.action_type === 'email' ? String(rule.action_config.subject ?? '') : '',
        emailBody: rule.action_type === 'email' ? String(rule.action_config.body ?? '') : '',
      });
    } else if (mode === 'create') {
      setState(defaultCreateState());
    }
    setFormError('');
  }, [open, mode, rule]);

  function handleTemplatePick(scenarioId: string | null) {
    if (scenarioId == null || scenarioId === '__none__') {
      setState(defaultCreateState());
      return;
    }
    const s = SCENARIOS.find(x => x.id === scenarioId);
    if (!s) return;
    const r = s.rule;
    setState({
      templateId: scenarioId,
      name: r.name,
      event_type: r.event_type,
      conditionField: r.condition.field,
      operator: r.condition.operator as Operator,
      conditionValue: conditionValueToString(r.condition.value),
      action_type: r.action_type,
      webhookUrl: r.action_type === 'webhook' ? getDemoWebhookUrl() : '',
      slackWebhookUrl:
        r.action_type === 'slack' ? String(r.action_config.webhook_url ?? '') : '',
      emailTo: r.action_type === 'email' ? String(r.action_config.to ?? '') : '',
      emailSubject:
        r.action_type === 'email' ? String(r.action_config.subject ?? '') : '',
      emailBody: r.action_type === 'email' ? String(r.action_config.body ?? '') : '',
    });
  }

  function buildActionConfig(): Record<string, unknown> {
    if (state.action_type === 'webhook') {
      return { url: state.webhookUrl.trim() };
    }
    if (state.action_type === 'slack') {
      return { webhook_url: state.slackWebhookUrl.trim() };
    }
    return {
      to: state.emailTo.trim(),
      subject: state.emailSubject.trim(),
      body: state.emailBody.trim(),
    };
  }

  function useDemoWebhook() {
    setState(s => ({
      ...s,
      action_type: 'webhook',
      webhookUrl: getDemoWebhookUrl(),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    const et = state.event_type.trim();
    if (!EVENT_TYPE_PATTERN.test(et)) {
      setFormError(
        `Event type must match ${EVENT_TYPE_PATTERN}: lowercase noun.verb (e.g. order.placed).`,
      );
      return;
    }

    let conditionValue: unknown;
    try {
      conditionValue = parseConditionValue(state.conditionValue, state.operator);
    } catch (err) {
      setFormError((err as Error).message);
      return;
    }

    const condition = {
      field: state.conditionField.trim(),
      operator: state.operator,
      value: conditionValue,
    };

    if (!condition.field) {
      setFormError('Condition field is required (dot path into payload, e.g. amount).');
      return;
    }

    if (!state.name.trim()) {
      setFormError('Rule name is required.');
      return;
    }

    let action_config: Record<string, unknown>;
    try {
      action_config = buildActionConfig();
    } catch {
      setFormError('Invalid action configuration.');
      return;
    }

    if (state.action_type === 'webhook' && !state.webhookUrl.trim()) {
      setFormError('Webhook URL is required.');
      return;
    }
    if (state.action_type === 'slack' && !state.slackWebhookUrl.trim()) {
      setFormError('Slack incoming webhook URL is required.');
      return;
    }
    if (state.action_type === 'email') {
      if (!state.emailTo.trim() || !state.emailSubject.trim() || !state.emailBody.trim()) {
        setFormError('Email action requires to, subject, and body.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        await triggrr.rules.create({
          name: state.name.trim(),
          event_type: et,
          condition,
          action_type: state.action_type,
          action_config,
        });
        toast.success('Rule created');
      } else if (rule) {
        await triggrr.rules.update(rule.id, {
          name: state.name.trim(),
          condition,
          action_config,
        });
        toast.success('Rule updated');
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(mode === 'create' ? 'Failed to create rule' : 'Failed to update rule', {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create rule' : 'Edit rule'}</DialogTitle>
          <DialogDescription>
            Rules match incoming events by <code className="font-mono text-xs">event_type</code>,
            then evaluate the condition against the event payload. Actions run when the condition
            passes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label>Start from demo template (optional)</Label>
              <Select
                value={state.templateId === '' ? '__none__' : state.templateId}
                onValueChange={handleTemplatePick}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Blank — fill manually</SelectItem>
                  {SCENARIOS.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="truncate">
                        {s.category}: {s.title}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Prefills name, event type, condition, and action. Replace Slack / webhook URLs with
                your own endpoints.
              </p>
            </div>
          )}

          {mode === 'edit' && rule && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary" className="font-mono">
                {rule.event_type}
              </Badge>
              <Badge variant="outline">{rule.action_type}</Badge>
              <span className="text-muted-foreground self-center">
                Event type and action type cannot be changed — create a new rule instead.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={state.name}
              onChange={e => setState(s => ({ ...s, name: e.target.value }))}
              placeholder="e.g. Notify on large orders"
            />
          </div>

          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-event-type">Event type</Label>
              <Input
                id="rule-event-type"
                className="font-mono text-sm"
                value={state.event_type}
                onChange={e => setState(s => ({ ...s, event_type: e.target.value }))}
                placeholder="order.placed"
              />
              <p className="text-xs text-muted-foreground">
                Pattern: lowercase <code className="font-mono">noun.verb</code> (underscores allowed
                after the dot).
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cond-field">Condition — payload field</Label>
              <Input
                id="cond-field"
                className="font-mono text-sm"
                value={state.conditionField}
                onChange={e => setState(s => ({ ...s, conditionField: e.target.value }))}
                placeholder="amount or user.plan"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Operator</Label>
              <Select
                value={state.operator}
                onValueChange={v => setState(s => ({ ...s, operator: v as Operator }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map(op => (
                    <SelectItem key={op} value={op}>
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cond-value">Value</Label>
              <Input
                id="cond-value"
                className="font-mono text-sm"
                value={state.conditionValue}
                onChange={e => setState(s => ({ ...s, conditionValue: e.target.value }))}
                placeholder='200 or "pro" or ["a","b"]'
                disabled={state.operator === 'exists'}
              />
              <p className="text-xs text-muted-foreground">
                JSON optional for numbers/objects/arrays. Not used for{' '}
                <code className="font-mono">exists</code>.
              </p>
            </div>
          </div>

          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label>Action type</Label>
              <Select
                value={state.action_type}
                onValueChange={v =>
                  setState(s => ({
                    ...s,
                    action_type: v as CreateRuleInput['action_type'],
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook">Webhook (HTTP POST)</SelectItem>
                  <SelectItem value="slack">Slack (incoming webhook)</SelectItem>
                  <SelectItem value="email">Email (SMTP from server)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {state.action_type === 'webhook' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Button type="button" variant="outline" size="xs" onClick={useDemoWebhook}>
                  <Webhook className="w-3 h-3 mr-1.5" />
                  Use demo webhook
                </Button>
              </div>
              <Input
                id="webhook-url"
                className="font-mono text-sm"
                value={state.webhookUrl}
                onChange={e => setState(s => ({ ...s, webhookUrl: e.target.value }))}
                placeholder="https://hooks.example.com/..."
                autoComplete="off"
              />
            </div>
          )}

          {state.action_type === 'slack' && (
            <div className="space-y-1.5">
              <Label htmlFor="slack-url">Slack incoming webhook URL</Label>
              <Input
                id="slack-url"
                className="font-mono text-sm"
                value={state.slackWebhookUrl}
                onChange={e => setState(s => ({ ...s, slackWebhookUrl: e.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Create an incoming webhook in Slack for a channel, then paste the URL here.
              </p>
            </div>
          )}

          {state.action_type === 'email' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Email is sent using SMTP settings configured on the Triggrr server (not in this form).
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="email-to">To</Label>
                <Input
                  id="email-to"
                  type="email"
                  value={state.emailTo}
                  onChange={e => setState(s => ({ ...s, emailTo: e.target.value }))}
                  placeholder="user@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-subject">Subject</Label>
                <Input
                  id="email-subject"
                  value={state.emailSubject}
                  onChange={e => setState(s => ({ ...s, emailSubject: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-body">Body</Label>
                <Textarea
                  id="email-body"
                  value={state.emailBody}
                  onChange={e => setState(s => ({ ...s, emailBody: e.target.value }))}
                  rows={4}
                  className="resize-none text-sm"
                />
              </div>
            </div>
          )}

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : mode === 'create' ? (
                'Create rule'
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
