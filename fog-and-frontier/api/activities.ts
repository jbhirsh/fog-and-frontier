import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client/web';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let initialized = false;
async function ensureSchema() {
  if (initialized) return;
  await db.execute(
    'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
  );
  initialized = true;
}

type Body = { id?: unknown; activity?: unknown };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (req.method === 'GET') {
    const rs = await db.execute('SELECT id, j FROM a ORDER BY t DESC');
    const out: Record<string, unknown> = {};
    for (const row of rs.rows) {
      const id = row.id;
      const j = row.j;
      if (typeof id !== 'string' || typeof j !== 'string') continue;
      try {
        out[id] = JSON.parse(j);
      } catch {
        /* skip malformed row */
      }
    }
    res.status(200).json(out);
    return;
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Body;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) {
      res.status(400).json({ error: 'missing id' });
      return;
    }
    if (!body.activity || typeof body.activity !== 'object') {
      res.status(400).json({ error: 'missing activity' });
      return;
    }
    const json = JSON.stringify(body.activity);
    if (json.length > 8000) {
      res.status(400).json({ error: 'activity too large' });
      return;
    }
    await db.execute({
      sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
      args: [id, json, Date.now()],
    });
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    const id =
      typeof req.query.id === 'string'
        ? req.query.id
        : Array.isArray(req.query.id)
        ? req.query.id[0]
        : null;
    if (!id) {
      res.status(400).json({ error: 'missing id' });
      return;
    }
    await db.execute({ sql: 'DELETE FROM a WHERE id = ?', args: [id] });
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
