import type pg from 'pg';

export const MAX_BACKUPS = 20;
const BACKUP_EVERY_MS = 60 * 60 * 1000;

/**
 * Called inside a transaction, just before the user's document is replaced: keeps an hourly rotating backup of what is
 * about to go (always when `always` is set, e.g. when a conflict is overwritten).
 */
export async function backupBeforeWrite(
  client: pg.PoolClient, userId: number, current: { data: unknown; revision: number }, reason: string, always = false,
) {
  const last = await client.query('SELECT saved_at FROM document_backups WHERE user_id=$1 ORDER BY saved_at DESC LIMIT 1', [userId]);
  if (!always && last.rows[0] && Date.now() - new Date(last.rows[0].saved_at).getTime() <= BACKUP_EVERY_MS) return;
  await client.query('INSERT INTO document_backups (user_id, reason, revision, data) VALUES ($1,$2,$3,$4)',
    [userId, reason, current.revision, JSON.stringify(current.data)]);
  await client.query(
    `DELETE FROM document_backups WHERE user_id=$1 AND id NOT IN
     (SELECT id FROM document_backups WHERE user_id=$1 ORDER BY saved_at DESC LIMIT ${MAX_BACKUPS})`, [userId]);
}

/**
 * Changes the saved document in place, atomically (row lock), and bumps its revision so every open copy of the app
 * notices. `change` edits the data and returns a result, or returns undefined to abort without writing.
 * Resolves to null when the account has no saved data yet.
 */
export async function mutateDocument<T>(
  pool: pg.Pool, userId: number, change: (data: Record<string, unknown>) => T | undefined,
): Promise<{ result: T | undefined; revision: number } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT data, revision FROM documents WHERE user_id=$1 FOR UPDATE', [userId]);
    const current = cur.rows[0] as { data: Record<string, unknown>; revision: number } | undefined;
    if (!current) { await client.query('ROLLBACK'); return null; }
    const data = structuredClone(current.data);
    const result = change(data);
    if (result === undefined) { await client.query('ROLLBACK'); return { result, revision: current.revision }; }
    await backupBeforeWrite(client, userId, current, 'automatic');
    const revision = current.revision + 1;
    await client.query('UPDATE documents SET data=$2, revision=$3, updated_at=now() WHERE user_id=$1', [userId, JSON.stringify(data), revision]);
    await client.query('COMMIT');
    return { result, revision };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
