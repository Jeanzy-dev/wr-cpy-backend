import fs from 'fs';
import path from 'path';
import { query } from './db.js';

/**
 * Store para RemoteAuth de whatsapp-web.js que guarda la sesión (zip) en PostgreSQL.
 * Así, cuando Render reinicia el servicio, no hay que volver a escanear el QR.
 */
export class PgSessionStore {
  constructor(dataPath) {
    this.dataPath = path.resolve(dataPath);
  }

  async sessionExists({ session }) {
    const { rows } = await query('SELECT 1 FROM wa_sessions WHERE session = $1', [session]);
    return rows.length > 0;
  }

  async save({ session }) {
    const file = path.join(this.dataPath, `${session}.zip`);
    const data = await fs.promises.readFile(file);
    await query(
      `INSERT INTO wa_sessions (session, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (session) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [session, data],
    );
    console.log(`💾 Sesión de WhatsApp respaldada en la BD (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  async extract({ session, path: outPath }) {
    const { rows } = await query('SELECT data FROM wa_sessions WHERE session = $1', [session]);
    if (!rows.length) return;
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, Buffer.from(rows[0].data));
  }

  async delete({ session }) {
    await query('DELETE FROM wa_sessions WHERE session = $1', [session]);
  }
}
