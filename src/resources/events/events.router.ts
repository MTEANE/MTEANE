import type { FastifyInstance } from 'fastify';
import { receiveEvent } from './events.controller';
import { authPreHandler } from '../../middleware/auth';
import { rateLimiter } from '../../middleware/rateLimiter';

export const eventsRouter = async (app: FastifyInstance) => {
	app.post(
		'/events',
		{
			preHandler: [authPreHandler, rateLimiter],
			schema: {
				description: `Ingest an event into Triggrr. The event is **persisted to Postgres first**, then pushed onto a BullMQ Redis queue for async processing. The HTTP response is returned immediately — rule evaluation and action execution happen in the background worker.

**Full processing pipeline**
1. Auth middleware verifies the \`x-api-key\` header (HMAC-SHA256 hash lookup).
2. Rate limiter checks the org's sliding-window quota configured by \`RATE_LIMIT\` (default \`1000/60s\`).
3. Request body is validated against the schema below.
4. If \`idempotency_key\` is supplied, the DB is checked for a prior event with the same \`(org_id, idempotency_key)\` pair. A duplicate returns the **original** event_id without re-queuing.
5. The event row is inserted into the \`events\` table.
6. The event job is pushed onto the \`events\` BullMQ queue.
7. The worker (separate process) picks up the job, fetches active rules for this \`event_type\` (Redis cache → DB), evaluates each rule's condition, and fires matching actions.

**event_type format**
Must match \`^[a-z]+\\.[a-z_]+$\` — a dot-separated pair: \`<noun>.<verb>\`, e.g. \`order.placed\`, \`user.signup\`, \`payment.failed\`.

**Rate limit**
Configured with \`RATE_LIMIT=<requests>/<seconds>s\`. The default is \`1000/60s\`.

When the limit is hit the response is **429** with a \`Retry-After\` header (seconds until the window clears) and \`X-RateLimit-Limit\` / \`X-RateLimit-Remaining\` headers.

**Body size limit** — requests larger than 512 KB are rejected with **413**.`,
				tags: ['Events'],
				body: {
					type: 'object',
					required: ['event_type', 'payload'],
					additionalProperties: false,
					properties: {
						event_type: {
							type: 'string',
							pattern: String.raw`^[a-z]+\.[a-z_]+$`,
							description: 'Dot-namespaced event identifier matching ^[a-z]+\\.[a-z_]+$ — e.g. "order.placed", "user.signup"',
						},
						payload: {
							type: 'object',
							additionalProperties: true,
							description: 'Arbitrary JSON object. Values are available to rule conditions via dot-notation (e.g. field: "user.plan" resolves payload.user.plan)',
						},
						idempotency_key: {
							type: 'string',
							maxLength: 256,
							description: 'Optional — if supplied, duplicate events with the same key are silently de-duplicated (same event_id returned, no second job enqueued). e.g. "order-placed-ord_001"',
						},
					},
				},
				response: {
					200: {
						description: 'Event accepted and queued (also returned for de-duplicated idempotent events)',
						type: 'object',
						properties: {
							event_id:    { type: 'string', format: 'uuid', description: 'Stable ID — use it to query action logs' },
							received_at: { type: 'string', format: 'date-time', description: 'DB insertion timestamp' },
							status:      { type: 'string', enum: ['received'], description: 'Always "received" — processing is async' },
						},
					},
					400: {
						description: 'Validation failed — event_type format wrong, payload not an object, or idempotency_key too long',
						type: 'object',
						properties: {
							message: { type: 'string' },
							errors:  { type: 'array', items: { type: 'object', additionalProperties: true } },
						},
					},
					401: {
						description: 'Missing x-api-key header',
						type: 'object',
						properties: { message: { type: 'string' } },
					},
					403: {
						description: 'Invalid or inactive API key',
						type: 'object',
						properties: { message: { type: 'string' } },
					},
					429: {
						description: 'Rate limit exceeded for the organisation',
						type: 'object',
						properties: {
							message:    { type: 'string', description: 'e.g. "Rate limit exceeded. Try again in 12s."' },
							retryAfter: { type: 'number', description: 'Seconds until the window resets' },
						},
					},
				},
				security: [{ apiKey: [] }],
			},
		},
		receiveEvent,
	);
};
