'use client';

import { useCallback, useEffect, useState } from 'react';
import { triggrr, type DemoWebhookDelivery, type HealthResponse } from '@/lib/triggrr';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Check,
  ShieldAlert,
  Webhook,
  Trash2,
} from 'lucide-react';

// ── Health section ────────────────────────────────────────────────────────────

function ProbeRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: 'ok' | 'fail' | 'unknown';
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="flex items-center gap-2.5">
        {status === 'ok' ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : status === 'fail' ? (
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />
        )}
        <span className="text-sm font-medium capitalize">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        <Badge
          variant="outline"
          className={
            status === 'ok'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs'
              : status === 'fail'
                ? 'bg-red-500/10 text-red-400 border-red-500/20 text-xs'
                : 'text-xs'
          }
        >
          {status === 'unknown' ? 'pending' : status}
        </Badge>
      </div>
    </div>
  );
}

function HealthSection() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const check = useCallback(() => {
    setLoading(true);
    setError('');
    triggrr.health
      .check()
      .then(res => setHealth(res))
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(check);
  }, [check]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">API Health</CardTitle>
            <CardDescription className="mt-1">
              Live probe of database, Redis, and memory on the Triggrr API.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {health && (
              <Badge
                variant="outline"
                className={
                  health.status === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }
              >
                {health.status}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={check} disabled={loading}>
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              {loading ? 'Checking…' : 'Refresh'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading && !health ? (
          <div className="space-y-2 animate-pulse">
            {['db', 'redis', 'memory'].map(n => (
              <div key={n} className="h-10 rounded bg-muted/50" />
            ))}
          </div>
        ) : health ? (
          <div>
            <ProbeRow
              name="database"
              status={health.db === 'ok' ? 'ok' : 'fail'}
              detail={
                health.db === 'ok' ? undefined : 'down'
              }
            />
            <ProbeRow
              name="redis"
              status={health.redis === 'ok' ? 'ok' : 'fail'}
              detail={
                health.redis === 'ok' ? undefined : 'down'
              }
            />
            <ProbeRow
              name="memory"
              status={health.memory === 'ok' ? 'ok' : 'fail'}
              detail={
                `${health.memory_mb} MB`
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Demo webhook section ─────────────────────────────────────────────────────

function DemoWebhookSection() {
  const [url, setUrl] = useState('');
  const [deliveries, setDeliveries] = useState<DemoWebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    triggrr.demoWebhook
      .get()
      .then(res => {
        setUrl(res.url);
        setDeliveries(res.deliveries);
      })
      .catch(() => toast.error('Failed to load demo webhook'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function clearDeliveries() {
    setClearing(true);
    try {
      await triggrr.demoWebhook.clear();
      setDeliveries([]);
      toast.success('Demo webhook cleared');
    } catch (err) {
      toast.error('Failed to clear demo webhook', { description: (err as Error).message });
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Demo Webhook</CardTitle>
            <CardDescription className="mt-1">
              Receives webhook actions from demo rules in this producer app.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Receiver URL</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-muted rounded px-3 py-2 break-all">
              {url || 'Loading...'}
            </code>
            <Button variant="outline" size="sm" onClick={copyUrl} disabled={!url}>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Webhook className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {deliveries.length} deliver{deliveries.length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={clearDeliveries}
            disabled={clearing || deliveries.length === 0}
          >
            {clearing ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            )}
            Clear
          </Button>
        </div>

        {loading && deliveries.length === 0 ? (
          <div className="h-20 rounded bg-muted/50 animate-pulse" />
        ) : deliveries.length === 0 ? (
          <div className="flex items-center justify-center h-20 rounded-lg border border-dashed text-sm text-muted-foreground">
            No deliveries yet.
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {deliveries.map(delivery => (
              <div key={delivery.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-mono text-foreground">
                    {delivery.event_type ?? 'unknown.event'}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(delivery.received_at).toLocaleString()}
                  </span>
                </div>
                <pre className="mt-2 max-h-24 overflow-auto text-xs font-mono text-muted-foreground">
                  {JSON.stringify(delivery.payload ?? delivery.body, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Register section ──────────────────────────────────────────────────────────

function RegisterSection() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [orgId, setOrgId] = useState('');
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!name.trim()) { setFormError('Organisation name is required.'); return; }
    if (!slug.trim()) { setFormError('Slug is required.'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setFormError('Slug must be lowercase letters, digits, and hyphens only.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await triggrr.auth.register(name.trim(), slug.trim());
      setApiKey(res.api_key);
      setOrgId(res.org_id);
      setName('');
      setSlug('');
      toast.success('Organisation registered', { description: 'Save the API key now — it will not be shown again.' });
    } catch (err) {
      toast.error('Registration failed', { description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Register Organisation</CardTitle>
        <CardDescription>
          Creates a new tenant and returns a one-time API key. Use this to onboard additional
          orgs or re-test the auth flow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {apiKey ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <ShieldAlert className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-300">
                This key is shown once and never stored. Copy it now and keep it safe.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Organisation ID</Label>
              <p className="font-mono text-xs bg-muted rounded px-3 py-2">{orgId}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">API Key</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-muted rounded px-3 py-2 break-all">
                  {apiKey}
                </code>
                <Button variant="outline" size="sm" onClick={copyKey} className="shrink-0">
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={() => { setApiKey(''); setOrgId(''); }}>
              Register another org
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Organisation name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="acme-corp"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, hyphens only. Must be globally unique.
              </p>
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Registering…
                </>
              ) : (
                'Register'
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="API health probes and organisation management."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthSection />
        <DemoWebhookSection />
        <RegisterSection />
      </div>
    </div>
  );
}
