import { PGlite } from '@electric-sql/pglite';

export async function createTestDatabase() {
  const db = new PGlite();
  await db.waitReady;
  const client = {
    async query(sql, parameters = []) {
      const text = typeof sql === 'string' ? sql : sql.text;
      const values = typeof sql === 'string' ? parameters : (sql.values ?? []);
      const result = await db.query(text, values);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length,
        fields: result.fields,
        command: text.trim().split(/\s+/)[0].toUpperCase(),
      };
    },
    release() {},
  };
  const pool = { connect: async () => client, query: client.query, end: async () => {} };
  return { db, pool };
}
