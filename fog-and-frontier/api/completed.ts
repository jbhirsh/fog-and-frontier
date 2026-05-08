import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let initialized = false;
async function ensureSchema() {
  if (initialized) return;
  await db.execute(
    'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
  );
  initialized = true;
}

type Body = { id?: unknown; v?: unknown };

export default async function handler(req: Request): Promise<Response> {
  await ensureSchema();

  if (req.method === 'GET') {
    const rs = await db.execute('SELECT id, v FROM c');
    const map: Record<string, boolean> = {};
    for (const row of rs.rows) {
      map[String(row.id)] = Number(row.v) === 1;
    }
    return Response.json(map);
  }

  if (req.method === 'POST') {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });

    if (body.v === null) {
      await db.execute({ sql: 'DELETE FROM c WHERE id = ?', args: [id] });
    } else if (body.v === true || body.v === false) {
      await db.execute({
        sql: 'INSERT INTO c (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v',
        args: [id, body.v ? 1 : 0],
      });
    } else {
      return Response.json({ error: 'invalid v' }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}
