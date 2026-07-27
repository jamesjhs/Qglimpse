import { getDb } from './db.js';
import { randomUUID } from 'node:crypto';
export function recordAuditEvent(input) {
    const db = getDb();
    const auditId = randomUUID();
    db.prepare(`INSERT INTO audit_events (audit_id, action, actor_user_id, actor_role, target_user_id, institution_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(auditId, input.action, input.actor?.id ?? null, input.actor?.role ?? null, input.targetUserId ?? null, input.institutionId ?? input.actor?.institutionId ?? null, JSON.stringify(input.metadata ?? {}));
    return auditId;
}
