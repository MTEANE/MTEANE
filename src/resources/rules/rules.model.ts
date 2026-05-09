import { query } from '../../shared/db';

export interface Rule {
  id: string;
  org_id: string;
  name: string;
  event_type: string;
  condition: Record<string, unknown>;
  action_type: 'webhook' | 'email' | 'slack';
  action_config: Record<string, unknown>;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleInput {
  name: string;
  event_type: string;
  condition: Record<string, unknown>;
  action_type: Rule['action_type'];
  action_config: Record<string, unknown>;
}

export interface UpdateRuleInput {
  name?: string;
  condition?: Record<string, unknown>;
  action_config?: Record<string, unknown>;
  is_active?: boolean;
}

export async function getActiveRules(orgId: string, eventType: string): Promise<Rule[]> {
  const result = await query<Rule>(
    `SELECT id, org_id, name, event_type, condition, action_type, action_config, is_active, deleted_at, created_at, updated_at
     FROM rules
     WHERE org_id = $1 AND event_type = $2 AND is_active = true AND deleted_at IS NULL`,
    [orgId, eventType],
  );
  return result.rows;
}

export async function createRule(orgId: string, input: CreateRuleInput): Promise<Rule> {
  const result = await query<Rule>(
    `INSERT INTO rules (org_id, name, event_type, condition, action_type, action_config)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING id, org_id, name, event_type, condition, action_type, action_config, is_active, deleted_at, created_at, updated_at`,
    [
      orgId,
      input.name,
      input.event_type,
      JSON.stringify(input.condition),
      input.action_type,
      JSON.stringify(input.action_config),
    ],
  );

  if (!result.rows[0]) {
    throw new Error('Failed to create rule');
  }

  return result.rows[0];
}

export async function listRulesByOrg(orgId: string): Promise<Rule[]> {
  const result = await query<Rule>(
    `SELECT id, org_id, name, event_type, condition, action_type, action_config, is_active, deleted_at, created_at, updated_at
     FROM rules
     WHERE org_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [orgId],
  );
  return result.rows;
}

export async function findRuleById(orgId: string, ruleId: string): Promise<Rule | null> {
  const result = await query<Rule>(
    `SELECT id, org_id, name, event_type, condition, action_type, action_config, is_active, deleted_at, created_at, updated_at
     FROM rules
     WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [orgId, ruleId],
  );
  return result.rows[0] ?? null;
}

export async function updateRule(
  orgId: string,
  ruleId: string,
  patch: UpdateRuleInput,
): Promise<Rule | null> {
  const result = await query<Rule>(
    `UPDATE rules
     SET
       name = COALESCE($3, name),
       condition = COALESCE($4::jsonb, condition),
       action_config = COALESCE($5::jsonb, action_config),
       is_active = COALESCE($6, is_active),
       updated_at = CURRENT_TIMESTAMP
     WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING id, org_id, name, event_type, condition, action_type, action_config, is_active, deleted_at, created_at, updated_at`,
    [
      orgId,
      ruleId,
      patch.name ?? null,
      patch.condition ? JSON.stringify(patch.condition) : null,
      patch.action_config ? JSON.stringify(patch.action_config) : null,
      patch.is_active ?? null,
    ],
  );

  return result.rows[0] ?? null;
}

/** Rule enriched with the timestamp of its most recent action log execution. */
export interface RuleWithLastTriggered extends Rule {
  last_triggered_at: string | null;
}

/**
 * Like listRulesByOrg but also includes last_triggered_at from action_logs.
 * Used by GET /rules so callers can see which rules have recently fired.
 */
export async function listRulesWithLastTriggered(
  orgId: string,
): Promise<RuleWithLastTriggered[]> {
  const result = await query<RuleWithLastTriggered>(
    `SELECT
       r.id, r.org_id, r.name, r.event_type, r.condition, r.action_type,
       r.action_config, r.is_active, r.deleted_at, r.created_at, r.updated_at,
       (SELECT MAX(al.executed_at)
        FROM action_logs al
        WHERE al.rule_id = r.id) AS last_triggered_at
     FROM rules r
     WHERE r.org_id = $1 AND r.deleted_at IS NULL
     ORDER BY r.created_at DESC`,
    [orgId],
  );
  return result.rows;
}

export async function softDeleteRule(orgId: string, ruleId: string): Promise<Rule | null> {
  const result = await query<Rule>(
    `UPDATE rules
     SET is_active = false, deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING id, org_id, name, event_type, condition, action_type, action_config, is_active, deleted_at, created_at, updated_at`,
    [orgId, ruleId],
  );

  return result.rows[0] ?? null;
}
