// Audit logging helper — writes immutable records to audit_log table

function logAudit(db, recordType, recordId, userId, action, changes) {
  db.prepare(`
    INSERT INTO audit_log (record_type, record_id, user_id, action, changes_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    recordType,
    recordId,
    userId || null,
    action,
    changes ? JSON.stringify(changes) : null
  );
}

module.exports = { logAudit };
