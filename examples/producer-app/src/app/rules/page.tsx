'use client';

import { useCallback, useEffect, useState } from 'react';
import { triggrr, type Rule } from '@/lib/triggrr';
import { DEMO_RULES } from '@/lib/scenarios';
import { withDemoWebhook } from '@/lib/demo-webhook';
import { PageHeader } from '@/components/page-header';
import { RuleRow } from '@/components/rule-row';
import { RuleFormDialog } from '@/components/rule-form-dialog';
import { RuleLogsDialog } from '@/components/rule-logs-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { ListChecks, Loader2, Plus } from 'lucide-react';

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsRule, setLogsRule] = useState<Rule | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    triggrr.rules
      .list()
      .then(r => setRules(r.rules))
      .catch(() => toast.error('Failed to load rules'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function openCreate() {
    setFormMode('create');
    setEditingRule(null);
    setFormOpen(true);
  }

  function openEdit(rule: Rule) {
    setFormMode('edit');
    setEditingRule(rule);
    setFormOpen(true);
  }

  function openLogs(rule: Rule) {
    setLogsRule(rule);
    setLogsOpen(true);
  }

  async function seedAll() {
    setSeeding(true);
    let created = 0;
    let failed = 0;
    for (const rule of DEMO_RULES) {
      try {
        await triggrr.rules.create(withDemoWebhook(rule));
        created++;
      } catch {
        failed++;
      }
    }
    toast.success(`Seeded ${created} rules`, {
      description: failed > 0 ? `${failed} skipped (may already exist)` : undefined,
    });
    load();
    setSeeding(false);
  }

  return (
    <div>
      <PageHeader
        title="Rules"
        description="Create rules with webhooks, Slack, or email actions. Toggle rules on/off without deleting them."
        action={
          <div className="flex flex-wrap gap-2 justify-end">
            <Button size="sm" onClick={openCreate}>
              Create rule
            </Button>
            <Button size="sm" onClick={seedAll} disabled={seeding} variant="outline">
              {seeding ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              {seeding ? 'Seeding…' : 'Add example rules'}
            </Button>
          </div>
        }
      />

      <RuleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        rule={editingRule}
        onSuccess={load}
      />

      <RuleLogsDialog
        open={logsOpen}
        onOpenChange={setLogsOpen}
        rule={logsRule}
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm animate-pulse">
              Loading…
            </div>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <ListChecks className="w-10 h-10 opacity-20" />
              <p className="text-sm">No rules yet.</p>
              <p className="text-xs">
                Click &quot;Add example rules&quot; above, or use Seed Rule in Scenarios.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Last triggered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map(rule => (
                  <RuleRow key={rule.id} rule={rule} onChanged={load} onEdit={openEdit} onViewLogs={openLogs} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
