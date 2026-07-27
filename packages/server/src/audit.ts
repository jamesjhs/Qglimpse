import { getDb } from './db.js'
import type { SessionUser } from './auth.js'
import { randomUUID } from 'node:crypto'

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'email_verification_requested'
  | 'email_verification_completed'
  | '2fa_changed'
  | 'user_updated'
  | 'user_status_changed'
  | 'user_deleted'
  | 'institution_created'
  | 'institution_updated'
  | 'institution_status_changed'
  | 'institution_deleted'
  | 'institution_kiosk_mode_changed'
  | 'smtp_settings_updated'
  | 'smtp_test_sent'
  | 'question_created'
  | 'question_updated'
  | 'question_deleted'

export function recordAuditEvent(input: {
  action: AuditAction
  actor?: SessionUser | null
  targetUserId?: number | null
  institutionId?: number | null
  metadata?: Record<string, unknown>
}) {
  const db = getDb()
  const auditId = randomUUID()
  db.prepare(
    `INSERT INTO audit_events (audit_id, action, actor_user_id, actor_role, target_user_id, institution_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    auditId,
    input.action,
    input.actor?.id ?? null,
    input.actor?.role ?? null,
    input.targetUserId ?? null,
    input.institutionId ?? input.actor?.institutionId ?? null,
    JSON.stringify(input.metadata ?? {}),
  )
  return auditId
}
