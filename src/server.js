import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config.js';
import { initDb, closeDb } from './db.js';
import { loginHandler, requireAuth, verifyToken } from './auth.js';
import * as repo from './repository.js';
import {
  startWhatsApp,
  stopWhatsApp,
  getStatus,
  fetchMediaOnDemand,
  sendText,
} from './whatsapp.js';

const app = express();
app.set('trust proxy', 1);

const corsOrigin = config.corsOrigins.includes('*') ? true : config.corsOrigins;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});

// Solo sockets autenticados con el JWT del login
io.use((socket, next) => {
  const payload = verifyToken(socket.handshake.auth?.token);
  if (!payload) return next(new Error('No autorizado'));
  socket.data.user = payload;
  next();
});
io.on('connection', (socket) => {
  socket.emit('wa_status', getStatus());
});

// --------------------------------------------------------- rutas públicas

app.get('/', (_req, res) => res.json({ ok: true, service: 'whatsapp-monitor-backend' }));
app.get('/health', (_req, res) => res.json({ ok: true, whatsapp: getStatus().status }));
app.post('/api/auth/login', loginHandler);

// --------------------------------------------------- rutas autenticadas

app.use('/api', requireAuth);

app.get('/api/auth/me', (req, res) => res.json({ username: req.user.sub }));

app.get('/api/whatsapp/status', (_req, res) => res.json(getStatus()));

app.get('/api/chats', async (_req, res, next) => {
  try {
    res.json(await repo.listChats());
  } catch (err) {
    next(err);
  }
});

app.get('/api/chats/:id', async (req, res, next) => {
  try {
    const chat = await repo.getChat(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });
    res.json(chat);
  } catch (err) {
    next(err);
  }
});

app.get('/api/chats/:id/messages', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    res.json(await repo.getMessages(req.params.id, { before, limit }));
  } catch (err) {
    next(err);
  }
});

app.post('/api/chats/:id/read', async (req, res, next) => {
  try {
    const chat = await repo.markChatRead(req.params.id);
    if (chat) io.emit('chat', chat);
    res.json(chat || {});
  } catch (err) {
    next(err);
  }
});

app.post('/api/chats/:id/messages', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'El mensaje está vacío' });
  try {
    await sendText(req.params.id, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.get('/api/media/:waId', async (req, res, next) => {
  try {
    const waId = req.params.waId;
    let media = await repo.getMedia(waId);
    if (!media) {
      const msg = await repo.getMessage(waId);
      if (!msg || !msg.has_media) return res.status(404).json({ error: 'Sin multimedia' });
      if (msg.media_status === 'too_large') {
        return res.status(413).json({ error: 'Archivo demasiado grande' });
      }
      media = await fetchMediaOnDemand(waId);
      if (!media) return res.status(404).json({ error: 'Multimedia no disponible' });
    }
    res.setHeader('Content-Type', media.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (media.filename) {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(media.filename)}"`);
    }
    res.send(media.data);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error('❌ Error en la API:', err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

// --------------------------------------------------------------- arranque

async function main() {
  await initDb();
  server.listen(config.port, () => {
    console.log(`🚀 Backend escuchando en el puerto ${config.port} (${config.nodeEnv})`);
  });
  startWhatsApp(io);
}

async function shutdown(signal) {
  console.log(`\n🛑 ${signal} recibido, cerrando...`);
  await stopWhatsApp();
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('⚠️  Promesa no manejada:', err));

main().catch((err) => {
  console.error('❌ No se pudo iniciar el servidor:', err);
  process.exit(1);
});
