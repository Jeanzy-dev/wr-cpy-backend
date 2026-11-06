import 'dotenv/config';
import { resolveChromePath } from './chromePath.js';

const env = process.env;
const databaseUrl = env.DATABASE_URL || '';

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const config = {
  port: Number(env.PORT || 3000),
  nodeEnv: env.NODE_ENV || 'development',

  // Base de datos: si no hay DATABASE_URL se usa PGlite (Postgres embebido) en ./.pgdata
  databaseUrl,
  dbSsl: bool(env.DB_SSL, /render\.com|neon\.tech|supabase/.test(databaseUrl)),
  pgliteDir: env.PGLITE_DIR || './.pgdata',

  // Login de la aplicación
  appUser: env.APP_USER || 'jphillip',
  appPassword: env.APP_PASSWORD || 'Jeancito07',
  jwtSecret: env.JWT_SECRET || 'cambia-este-secreto-en-produccion',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',

  // CORS: lista separada por comas, o * para permitir todo
  corsOrigins: (env.CORS_ORIGIN || '*')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  // WhatsApp
  // local  -> guarda la sesión en disco (.wwebjs_auth) - ideal en tu PC
  // remote -> guarda la sesión en PostgreSQL - necesario en Render (disco efímero)
  waAuth: env.WA_AUTH || (databaseUrl ? 'remote' : 'local'),
  waClientId: env.WA_CLIENT_ID || 'monitor',
  waDataPath: env.WA_DATA_PATH || './.wwebjs_auth',
  waBackupIntervalMs: Math.max(60000, Number(env.WA_BACKUP_INTERVAL_MS || 300000)),
  headless: bool(env.HEADLESS, true),
  chromePath: resolveChromePath(),

  // Sincronización del historial al conectar
  syncChatsLimit: Number(env.SYNC_CHATS_LIMIT ?? 30),
  syncMessagesPerChat: Number(env.SYNC_MESSAGES_PER_CHAT ?? 40),

  // Multimedia
  autoDownloadMedia: bool(env.AUTO_DOWNLOAD_MEDIA, true),
  maxMediaBytes: Number(env.MAX_MEDIA_MB ?? 16) * 1024 * 1024,
};
