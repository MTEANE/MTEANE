'use client';

import { useState } from 'react';
import { triggrr } from '@/lib/triggrr';
import type { Scenario } from '@/lib/scenarios';
import { withDemoWebhook } from '@/lib/demo-webhook';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Zap, Plus, ChevronDown, ChevronUp } from 'lucide-react';

interface ScenarioCardProps {
  scenario: Scenario;
  onRuleSeeded?: () => void;
}

export function ScenarioCard({ scenario, onRuleSeeded }: ScenarioCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [firing, setFiring] = useState(false);
  const [seeding, setSeeding] = useState(false);

  async function fireEvent() {
    setFiring(true);
    try {
      const res = await triggrr.events.send(scenario.event_type, scenario.payload);
      toast.success(`Event sent: ${scenario.event_type}`, {
        description: `event_id: ${res.event_id}`,
      });
    } catch (e) {
      toast.error('Failed to send event', { description: (e as Error).message });
    } finally {
      setFiring(false);
    }
  }

  async function seedRule() {
    setSeeding(true);
    try {
      await triggrr.rules.create(withDemoWebhook(scenario.rule));
      toast.success('Rule created!', { description: scenario.rule.name });
      onRuleSeeded?.();
    } catch (e) {
      toast.error('Failed to create rule', { description: (e as Error).message });
    } finally {
      setSeeding(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{scenario.title}</CardTitle>
            <CardDescription className="mt-1 text-sm leading-snug">
              {scenario.description}
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs font-mono">
            {scenario.event_type}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {/* Payload toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          View payload
        </button>

        {expanded && (
          <pre className="bg-muted rounded-lg px-3 py-2 text-xs font-mono overflow-auto max-h-36 text-foreground/80">
            {JSON.stringify(scenario.payload, null, 2)}
          </pre>
        )}

        {/* Matching rule hint */}
        <div className="text-xs bg-muted/40 rounded-md px-3 py-2 text-muted-foreground">
          <span className="font-medium text-foreground">Rule: </span>
          {scenario.rule.name}
          <span className="ml-2 font-mono">
            ({scenario.rule.condition.field} {scenario.rule.condition.operator}{' '}
            {JSON.stringify(scenario.rule.condition.value)})
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={fireEvent} disabled={firing} className="flex-1">
            <Zap className="w-3 h-3 mr-1.5" />
            {firing ? 'Sending…' : 'Fire Event'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={seedRule}
            disabled={seeding}
            className="flex-1"
          >
            <Plus className="w-3 h-3 mr-1.5" />
            {seeding ? 'Creating…' : 'Seed Rule'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
