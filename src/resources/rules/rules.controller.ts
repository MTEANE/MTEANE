import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
	createRule,
	findRuleById,
	listRulesWithLastTriggered,
	softDeleteRule,
	updateRule,
} from './rules.model';
import type { Rule } from './rules.model';
import { invalidateRulesCache } from '../../cache/rules';
import { getRuleLogs } from '../logs/logs.model';

const VALID_OPERATORS = [
	'eq', 'neq',
	'gt', 'gte', 'lt', 'lte',
	'in', 'contains',
	'startsWith', 'endsWith',
	'exists', 'regex',
] as const;

const conditionSchema = z.object({
	field: z.string().min(1),
	operator: z.enum(VALID_OPERATORS),
	value: z.unknown(),
});

const actionTypeSchema = z.enum(['webhook', 'email', 'slack']);

const webhookConfigSchema = z.object({
	url: z.url(),
});

const emailConfigSchema = z.object({
	to: z.string().min(1),
	subject: z.string().min(1),
	body: z.string().min(1),
});

const slackConfigSchema = z.object({
	webhook_url: z.url(),
});

const createRuleSchema = z.object({
	name: z.string().min(1),
	event_type: z.string().min(1),
	condition: conditionSchema,
	action_type: actionTypeSchema,
	action_config: z.record(z.string(), z.unknown()),
});

const patchRuleSchema = z
	.object({
		name: z.string().min(1).optional(),
		condition: conditionSchema.optional(),
		action_config: z.record(z.string(), z.unknown()).optional(),
		is_active: z.boolean().optional(),
	})
	.refine(
		body =>
			body.name !== undefined ||
			body.condition !== undefined ||
			body.action_config !== undefined ||
			body.is_active !== undefined,
		{
			message: 'At least one field is required for update',
		},
	);

const paramsSchema = z.object({
	id: z.uuid(),
});

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
	return reply.status(400).send({
		message: 'Validation failed',
		errors: error.issues.map(issue => ({
			path: issue.path.join('.'),
			message: issue.message,
		})),
	});
}

function validateActionConfig(actionType: Rule['action_type'], actionConfig: Record<string, unknown>) {
	if (actionType === 'webhook') return webhookConfigSchema.safeParse(actionConfig);
	if (actionType === 'email') return emailConfigSchema.safeParse(actionConfig);
	return slackConfigSchema.safeParse(actionConfig);
}

export const createRuleHandler = async (request: FastifyRequest, reply: FastifyReply) => {
	const parsed = createRuleSchema.safeParse(request.body);
	if (!parsed.success) {
		return sendValidationError(reply, parsed.error);
	}

	const configParsed = validateActionConfig(parsed.data.action_type, parsed.data.action_config);
	if (!configParsed.success) {
		return sendValidationError(reply, configParsed.error);
	}

	const rule = await createRule(request.org.id, parsed.data);

	// Invalidate the cache for this org+event_type so the worker picks up the
	// new rule immediately rather than waiting up to 60s for the TTL to expire.
	await invalidateRulesCache(request.org.id, rule.event_type);

	return reply.status(201).send(rule);
};

export const listRulesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
	const rules = await listRulesWithLastTriggered(request.org.id);
	return reply.status(200).send({ rules });
};

export const getRuleLogsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
	const parsedParams = paramsSchema.safeParse(request.params);
	if (!parsedParams.success) {
		return sendValidationError(reply, parsedParams.error);
	}

	const rule = await findRuleById(request.org.id, parsedParams.data.id);
	if (!rule) {
		return reply.status(404).send({ message: 'Rule not found' });
	}

	const logs = await getRuleLogs(request.org.id, parsedParams.data.id, 50);
	return reply.status(200).send({ logs });
};

export const patchRuleHandler = async (request: FastifyRequest, reply: FastifyReply) => {
	const parsedParams = paramsSchema.safeParse(request.params);
	if (!parsedParams.success) {
		return sendValidationError(reply, parsedParams.error);
	}

	const parsedBody = patchRuleSchema.safeParse(request.body);
	if (!parsedBody.success) {
		return sendValidationError(reply, parsedBody.error);
	}

	const existing = await findRuleById(request.org.id, parsedParams.data.id);
	if (!existing) {
		return reply.status(404).send({ message: 'Rule not found' });
	}

	if (parsedBody.data.action_config) {
		const configParsed = validateActionConfig(existing.action_type, parsedBody.data.action_config);
		if (!configParsed.success) {
			return sendValidationError(reply, configParsed.error);
		}
	}

	const updated = await updateRule(request.org.id, parsedParams.data.id, parsedBody.data);
	if (!updated) {
		return reply.status(404).send({ message: 'Rule not found' });
	}

	// Invalidate using the old event_type so stale cache is cleared even if
	// event_type changes in the future. updated.event_type covers the new value.
	await invalidateRulesCache(request.org.id, existing.event_type);
	if (updated.event_type !== existing.event_type) {
		await invalidateRulesCache(request.org.id, updated.event_type);
	}

	return reply.status(200).send(updated);
};

export const deleteRuleHandler = async (request: FastifyRequest, reply: FastifyReply) => {
	const parsedParams = paramsSchema.safeParse(request.params);
	if (!parsedParams.success) {
		return sendValidationError(reply, parsedParams.error);
	}

	const deleted = await softDeleteRule(request.org.id, parsedParams.data.id);
	if (!deleted) {
		return reply.status(404).send({ message: 'Rule not found' });
	}

	await invalidateRulesCache(request.org.id, deleted.event_type);
	return reply.status(200).send({
		id: deleted.id,
		is_active: deleted.is_active,
		status: 'soft_deleted',
	});
};
