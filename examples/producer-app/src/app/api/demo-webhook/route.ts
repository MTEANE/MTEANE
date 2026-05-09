import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export interface DemoWebhookDelivery {
  id: string;
  received_at: string;
  event_id: string | null;
  event_type: string | null;
  org_id: string | null;
  payload: unknown;
  body: unknown;
}

const MAX_DELIVERIES = 25;
let deliveries: DemoWebhookDelivery[] = [];

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function webhookUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_DEMO_WEBHOOK_URL?.trim();
  if (configured) return configured;

  return new URL('/api/demo-webhook', req.url).toString();
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    url: webhookUrl(req),
    deliveries,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    body = await req.text().catch(() => null);
  }

  const objectBody = asObject(body);
  const delivery: DemoWebhookDelivery = {
    id: randomUUID(),
    received_at: new Date().toISOString(),
    event_id: asString(objectBody?.event_id),
    event_type: asString(objectBody?.event_type),
    org_id: asString(objectBody?.org_id),
    payload: objectBody?.payload ?? null,
    body,
  };

  deliveries = [delivery, ...deliveries].slice(0, MAX_DELIVERIES);

  return NextResponse.json({
    ok: true,
    id: delivery.id,
    received_at: delivery.received_at,
  });
}

export async function DELETE() {
  deliveries = [];
  return NextResponse.json({ ok: true });
}
