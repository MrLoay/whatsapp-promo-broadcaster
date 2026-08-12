import type Database from 'better-sqlite3';
import cron from 'node-cron';

export function cleanupOldLogs(db: Database.Database, daysToKeep = 30): { deletedRecipients: number; deletedInbound: number } {
  const recipientInfo = db
    .prepare(
      `DELETE FROM campaign_recipients
       WHERE sent_at IS NOT NULL AND sent_at < datetime('now', '-' || ? || ' days')`
    )
    .run(daysToKeep);

  const inboundInfo = db
    .prepare(
      `DELETE FROM inbound_messages
       WHERE received_at < datetime('now', '-' || ? || ' days')`
    )
    .run(daysToKeep);

  return {
    deletedRecipients: recipientInfo.changes,
    deletedInbound: inboundInfo.changes,
  };
}

export function vacuumDb(db: Database.Database): void {
  db.pragma('vacuum');
}

export function scheduleDbMaintenance(db: Database.Database): void {
  // Run daily at 03:00 AM
  cron.schedule('0 3 * * *', () => {
    console.log('[MAINTENANCE] Starting scheduled database maintenance...');
    try {
      const stats = cleanupOldLogs(db, 30);
      console.log(`[MAINTENANCE] Purged ${stats.deletedRecipients} old campaign recipient records and ${stats.deletedInbound} old inbound messages.`);
      vacuumDb(db);
      console.log('[MAINTENANCE] SQLite database VACUUM completed successfully.');
    } catch (err) {
      console.error('[MAINTENANCE] Database maintenance failed:', (err as Error).message);
    }
  });
}
