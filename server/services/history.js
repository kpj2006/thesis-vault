// History & Notification component (Lab 7: IHistoryNotification.recordAndNotify, IHistory, INotification)
import { insert, all, one } from '../db/database.js';

// NFR-016: who did what, to which entity, and when.
export function audit(userId, action, entityType = null, entityId = null, details = null, ip = null) {
  insert(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    userId ?? null, action, entityType, entityId ?? null,
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details), ip,
  );
}

export function notify(recipientId, type, message, thesisId = null) {
  if (!recipientId) return null;
  return insert('INSERT INTO notifications (recipient_id, thesis_id, type, message) VALUES (?, ?, ?, ?)',
    recipientId, thesisId, type, message);
}

// BR-009: every status change is written to the thesis history and pushed to the relevant stakeholders.
export function recordAndNotify({ actorId, thesisId, action, fromStatus = null, toStatus = null, note = null, recipients = [], message, type }) {
  const historyId = insert(
    'INSERT INTO thesis_history (thesis_id, actor_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)',
    thesisId, actorId ?? null, action, fromStatus, toStatus, note,
  );
  const unique = [...new Set(recipients.filter(Boolean))].filter(id => id !== actorId);
  for (const r of unique) notify(r, type || action, message, thesisId);
  return { historyId, notificationStatus: unique.length ? 'SENT' : 'NO_RECIPIENTS' };
}

export const usersWithRole = role => all(`SELECT id FROM users WHERE role = ? AND status = 'active'`, role).map(u => u.id);

export const thesisHistory = thesisId => all(
  `SELECT h.*, u.name AS actor_name, u.role AS actor_role
     FROM thesis_history h LEFT JOIN users u ON u.id = h.actor_id
    WHERE h.thesis_id = ? ORDER BY h.id`, thesisId);

export const unreadCount = userId => one('SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND is_read = 0', userId).n;
