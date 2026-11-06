import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

let driver = null;

/**
 * Inicializa la conexión:
 *  - Con DATABASE_URL -> PostgreSQL real (Render, local, etc.)
 *  - Sin DATABASE_URL -> PGlite (PostgreSQL embebido, sin instalar nada) para desarrollo local
 * En ambos casos ejecuta db/schema.sql (idempotente).
 */
export async function initDb() {
  const schema = fs.readFileSync(schemaPath, 'utf8');

  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
      max: 5,
    });
    pool.on('error', (err) => console.error('❌ Error en el pool de PostgreSQL:', err.message));
    await pool.query(schema);
    driver = {
      kind: 'postgres',
      query: (text, params) => pool.query(text, params),
      close: () => pool.end(),
    };
    console.log('🐘 Conectado a PostgreSQL');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.resolve(config.pgliteDir);
    fs.mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir);
    await db.exec(schema);
    driver = {
      kind: 'pglite',
      query: (text, params) => db.query(text, params),
      close: () => db.close(),
    };
    console.log(`🐘 Usando PostgreSQL embebido (PGlite) en ${dir}`);
  }
}

export async function query(text, params = []) {
  if (!driver) throw new Error('La base de datos no está inicializada');
  return driver.query(text, params);
}

export async function closeDb() {
  if (driver) await driver.close();
}
