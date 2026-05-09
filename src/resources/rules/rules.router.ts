import type { FastifyInstance } from 'fastify';
import { authPreHandler } from '../../middleware/auth';
import {
	createRuleHandler,
	deleteRuleHandler,
	getRuleLogsHandler,
	listRulesHandler,
	patchRuleHandler,
} from './rules.controller';

export const rulesRouter = async (app: FastifyInstance) => {
	app.post(
		'/rules',
		{
			preHandler: [authPreHandler],
			schema: {
				description: `Create a rule that will be evaluated every time an event with a matching \`event_type\` is ingested.

**How evaluation works**
When an event arrives the worker loads all active rules for the org whose \`event_type\` matches. For each rule it runs the \`condition\` against the event's \`payload\`. If the condition passes, the action is executed and an \`action_log\` row is written.

**condition object**
\`\`\`json
{ "field": "amount", "operator": "gt", "value": 200 }
\`\`\`
- \`field\` — dot-notation path into the event payload (e.g. \`"user.plan"\` resolves \`payload.user.plan\`)
- \`operator\` — one of: \`eq\`, \`neq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`, \`in\`, \`contains\`, \`startsWith\`, \`endsWith\`, \`exists\`, \`regex\`
- \`value\` — compared against the resolved field (not required for \`exists\`)

**action_type and required action_config fields**
| action_type | Required fields in action_config |
|-------------|----------------------------------|
| \`webhook\`   | \`url\` (HTTPS URL)               |
| \`email\`     | \`to\`, \`subject\`, \`body\`          |
| \`slack\`     | \`webhook_url\` (Slack Incoming Webhook URL) |

The rule cache for this org + event_type is invalidated immediately on creation so the worker picks up the new rule without waiting for the 60 s TTL.`,
				tags: ['Rules'],
				body: {
					type: 'object',
					required: ['name', 'event_type', 'condition', 'action_type', 'action_config'],
					additionalProperties: false,
					properties: {
					name: {
						type: 'string',
						minLength: 1,
						description: 'Human-readable label shown in logs and the UI — e.g. "Webhook on large order"',
					},
					event_type: {
						type: 'string',
						minLength: 1,
						description: 'Must match the event_type sent via POST /events — e.g. "order.placed"',
					},
					condition: {
						type: 'object',
						additionalProperties: true,
						description: '{ field, operator, value } — field is a dot-notation path into the event payload. e.g. { "field": "amount", "operator": "gt", "value": 200 }',
					},
					action_type: {
						type: 'string',
						enum: ['webhook', 'email', 'slack'],
						description: 'Determines which executor runs and which action_config fields are required',
					},
					action_config: {
						type: 'object',
						additionalProperties: true,
						description: 'Config for the chosen action_type — see table above for required fields. Webhook: { url }. Email: { to, subject, body }. Slack: { webhook_url }',
					},
					},
				},
				response: {
					201: {
						description: 'Rule created and cache invalidated',
						type: 'object', additionalProperties: true,
					},
					400: {
						description: 'Validation failed — condition shape wrong, action_config missing required fields, etc.',
						type: 'object',
						properties: {
							message: { type: 'string' },
							errors:  { type: 'array', items: { type: 'object', additionalProperties: true } },
						},
					},
				},
				security: [{ apiKey: [] }],
			},
		},
		createRuleHandler,
	);

	app.get(
		'/rules',
		{
			preHandler: [authPreHandler],
			schema: {
				description: `Return all non-deleted rules for the authenticated organisation, ordered by creation date descending.

Each rule object includes a computed \`last_triggered_at\` field — the \`executed_at\` timestamp of the most recent successful action log for that rule. This is a single LEFT JOIN; no separate request needed.

Rules with \`is_active: false\` are paused. Deleted rules are hidden from this list while their rows remain available for historical action log joins.`,
				tags: ['Rules'],
				response: {
					200: {
						description: 'Array of rule objects, newest first',
						type: 'object',
						properties: {
							rules: {
								type: 'array',
								items: { type: 'object', additionalProperties: true },
								description: 'Each item includes id, name, event_type, condition, action_type, action_config, is_active, last_triggered_at, created_at, updated_at',
							},
						},
					},
				},
				security: [{ apiKey: [] }],
			},
		},
		listRulesHandler,
	);

	app.patch(
		'/rules/:id',
		{
			preHandler: [authPreHandler],
			schema: {
				description: `Partially update one or more fields of an existing rule. At least one field must be present in the body.

**Patchable fields**
| Field          | Notes |
|----------------|-------|
| \`name\`          | Rename without changing logic |
| \`condition\`     | Full replacement of the condition object — same shape rules as POST /rules |
| \`action_config\` | Full replacement — validated against the existing \`action_type\`; you cannot change action_type here |
| \`is_active\`     | \`true\` re-enables a paused rule; \`false\` pauses it without deleting |

After a successful update the rule cache for this org + event_type is **immediately invalidated** in Redis (for both the old and new event_type if they differ) so the worker starts using the new rule on the very next event.`,
				tags: ['Rules'],
				params: {
					type: 'object',
					required: ['id'],
					additionalProperties: false,
					properties: {
						id: { type: 'string', format: 'uuid', description: 'UUID of the rule to update' },
					},
				},
				body: {
					type: 'object',
					additionalProperties: false,
					properties: {
						name:          { type: 'string', minLength: 1, description: 'New display name' },
						condition:     { type: 'object', additionalProperties: true, description: 'Replacement condition — { field, operator, value }' },
						action_config: { type: 'object', additionalProperties: true, description: 'Replacement action config — must be valid for the existing action_type' },
						is_active:     { type: 'boolean', description: 'true = enable, false = pause (does not delete)' },
					},
				},
				response: {
					200: { description: 'Updated rule object', type: 'object', additionalProperties: true },
					400: {
						description: 'No fields provided, or condition / action_config failed validation',
						type: 'object',
						properties: { message: { type: 'string' }, errors: { type: 'array', items: { type: 'object', additionalProperties: true } } },
					},
					404: {
						description: 'No rule with this ID exists for the authenticated org',
						type: 'object',
						properties: { message: { type: 'string' } },
					},
				},
				security: [{ apiKey: [] }],
			},
		},
		patchRuleHandler,
	);

	app.delete(
		'/rules/:id',
		{
			preHandler: [authPreHandler],
			schema: {
				description: `Delete a rule from normal management views. This is implemented as a soft delete: \`deleted_at\` is set and \`is_active = false\`, while the rule row is kept so historical action logs remain queryable.

The rule will stop matching new events immediately: the cache for this org + event_type is invalidated right after the DB update, so the worker won't load this rule on the next job.
`,
				tags: ['Rules'],
				params: {
					type: 'object',
					required: ['id'],
					additionalProperties: false,
					properties: {
						id: { type: 'string', format: 'uuid', description: 'UUID of the rule to soft-delete' },
					},
				},
				response: {
					200: {
						description: 'Rule deactivated — is_active is now false',
						type: 'object',
						properties: {
						id:        { type: 'string', format: 'uuid' },
						is_active: { type: 'boolean', description: 'Always false after soft-delete' },
						status:    { type: 'string', description: 'Always "soft_deleted"' },
						},
					},
					404: {
						description: 'No rule with this ID exists for the authenticated org',
						type: 'object',
						properties: { message: { type: 'string' } },
					},
				},
				security: [{ apiKey: [] }],
			},
		},
		deleteRuleHandler,
	);

	app.get(
		'/rules/:id/logs',
		{
			preHandler: [authPreHandler],
			schema: {
				description: `Return the last **50** action log entries for a specific rule, ordered by most-recently executed first.

Each log entry tells you: which event triggered the rule (\`event_id\`), whether the action succeeded or failed (\`status\`), the raw response or error message, how many attempts were made, and when it executed.

Use this for per-rule audit / debugging. For org-wide paginated logs with filtering use \`GET /logs\`.

**status values**
| Value      | Meaning |
|------------|---------|
| \`pending\`  | Job is in the queue, action not yet attempted |
| \`success\`  | Action executed and the target responded without error |
| \`failed\`   | Action executed but returned an error / non-2xx; worker may retry |
| \`retrying\` | A DLQ retry was triggered — job re-entered the queue |
| \`dead\`     | Exhausted all retries — moved to DLQ |`,
				tags: ['Rules'],
				params: {
					type: 'object',
					required: ['id'],
					additionalProperties: false,
					properties: {
						id: { type: 'string', format: 'uuid', description: 'UUID of the rule' },
					},
				},
				response: {
					200: {
						description: 'Up to 50 action log entries, newest first',
						type: 'object',
						properties: {
							logs: {
								type: 'array',
								items: { type: 'object', additionalProperties: true },
								description: 'Each item: id, event_id, rule_id, org_id, status, attempt_count, error_message, response_body, executed_at, created_at, updated_at',
							},
						},
					},
					404: {
						description: 'No rule with this ID exists for the authenticated org',
						type: 'object',
						properties: { message: { type: 'string' } },
					},
				},
				security: [{ apiKey: [] }],
			},
		},
		getRuleLogsHandler,
	);
};
