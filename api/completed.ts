import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { requireOwner } from './_auth.js';
import { withErrorLogging } from './_log.js';

let initialized = false;
async function ensureSchema() {
  if (initialized) return;
  await db().execute(
    'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
  );
  initialized = true;
}

type Body = { id?: unknown; v?: unknown };

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureSchema();

  if (req.method === 'GET') {
    const rs = await db().execute('SELECT id, v FROM c');
    const map: Record<string, boolean> = {};
    for (const row of rs.rows) {
      const id = row.id;
      let idKey: string;
      if (typeof id === 'string') idKey = id;
      else if (typeof id === 'number' || typeof id === 'bigint') idKey = id.toString();
      else continue;
      map[idKey] = Number(row.v) === 1;
    }
    res.status(200).json(map);
    return;
  }

  if (req.method === 'POST') {
    if (!(await requireOwner(req, res))) return;
    const body = (req.body ?? {}) as Body;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) {
      res.status(400).json({ error: 'missing id' });
      return;
    }

    if (body.v === null) {
      await db().execute({ sql: 'DELETE FROM c WHERE id = ?', args: [id] });
    } else if (body.v === true || body.v === false) {
      await db().execute({
        sql: 'INSERT INTO c (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v',
        args: [id, body.v ? 1 : 0],
      });
    } else {
      res.status(400).json({ error: 'invalid v' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
});
