import pkg from 'whatsapp-web.js';
import QRCode from 'qrcode';
import qrTerminal from 'qrcode-terminal';
import { config } from './config.js';
import { PgSessionStore } from './pgSessionStore.js';
import * as repo from './repository.js';

const { Client, LocalAuth, RemoteAuth } = pkg;

// Tipos de mensaje que no son "conversación" (notificaciones de sistema, cifrado, etc.)
const IGNORED_TYPES = new Set([
  'e2e_notification', 'notification', 'notification_template', 'gp2', 'protocol',
  'call_log', 'ciphertext', 'revoked', 'broadcast_notification', 'debug', 'unknown',
  'pinned_message', 'reaction',
]);

const MEDIA_LABELS = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎵 Audio',
  ptt: '🎤 Mensaje de voz',
  document: '📄 Documento',
  sticker: '💟 Sticker',
  location: '📍 Ubicación',
  vcard: '👤 Contacto',
  multi_vcard: '👥 Contactos',
  poll_creation: '📊 Encuesta',
  ptv: '🎥 Videomensaje',
};

let io = null;
let client = null;
let restarting = false;
let syncing = false;

const state = {
  status: 'starting', // starting | qr | loading | authenticated | ready | disconnected | auth_failure | error
  qr: null,
  loadingPercent: null,
  me: null,
  error: null,
  syncing: false,
};

const contactCache = new Map(); // id -> { name, phone, savedName, pushname, ts }
const knownChats = new Set();
const CONTACT_TTL = 10 * 60 * 1000;

export const getStatus = () => ({ ...state });
export const getClient = () => (state.status === 'ready' ? client : null);

function setState(patch) {
  Object.assign(state, patch);
  io?.emit('wa_status', getStatus());
}

// ---------------------------------------------------------------- helpers

const serialize = (id) => {
  if (!id) return null;
  if (typeof id === 'string') return id;
  return id._serialized || id.$1 || id._id || null;
};

const phoneFromId = (id) =>
  id && /@(c\.us|s\.whatsapp\.net)$/.test(id) ? `+${id.split('@')[0]}` : null;

const isSupportedChat = (chatId) =>
  !!chatId &&
  chatId !== 'status@broadcast' &&
  !chatId.endsWith('@broadcast') &&
  !chatId.endsWith('@newsletter');

export function previewFor(type, body, isRevoked = false) {
  if (isRevoked) return '🚫 Mensaje eliminado';
  const label = MEDIA_LABELS[type];
  const text = (body || '').replace(/\s+/g, ' ').trim();
  if (label && text) return `${label}: ${text}`.slice(0, 200);
  if (label) return label;
  return text.slice(0, 200) || 'Mensaje';
}

async function resolveContact(id) {
  if (!id) return { name: null, phone: null };
  const cached = contactCache.get(id);
  if (cached && Date.now() - cached.ts < CONTACT_TTL) return cached;

  let savedName = null;
  let pushname = null;
  let phone = phoneFromId(id);
  try {
    const contact = await client.getContactById(id);
    savedName = contact.isMyContact ? contact.name || null : null;
    pushname = contact.pushname || contact.verifiedName || null;
    if (!phone && contact.number) phone = `+${contact.number}`;
  } catch {
    /* contacto no disponible */
  }
  if (!phone && id.endsWith('@lid') && typeof client.getContactLidAndPhone === 'function') {
    try {
      const [res] = await client.getContactLidAndPhone([id]);
      if (res?.pn) phone = phoneFromId(res.pn);
    } catch {
      /* sin mapeo lid -> teléfono */
    }
  }
  const info = {
    savedName,
    pushname,
    phone,
    // Nombre del contacto guardado -> número telefónico -> nombre de usuario (pushname) -> id
    name: savedName || phone || pushname || id.split('@')[0],
    ts: Date.now(),
  };
  contactCache.set(id, info);
  return info;
}

async function ensureChat(chatId, waChat = null) {
  if (knownChats.has(chatId)) return;
  const isGroup = chatId.endsWith('@g.us');
  let name = null;
  let phone = null;
  try {
    if (isGroup) {
      const chat = waChat || (await client.getChatById(chatId));
      name = chat?.name || null;
    } else {
      const c = await resolveContact(chatId);
      name = c.name;
      phone = c.phone;
    }
  } catch {
    /* nombre no disponible */
  }
  await repo.upsertChat({ id: chatId, name, isGroup, phone });
  knownChats.add(chatId);
}

function extractBody(msg) {
  const type = msg.type;
  if (type === 'location') {
    const loc = msg.location;
    const desc = loc?.description || loc?.name || '';
    const coords = loc ? `${loc.latitude},${loc.longitude}` : '';
    return [desc, coords && `https://maps.google.com/?q=${coords}`].filter(Boolean).join('\n');
  }
  if (type === 'vcard' || type === 'multi_vcard') {
    const cards = msg.vCards || [];
    const names = cards
      .map((v) => /FN:(.*)/.exec(v)?.[1]?.trim())
      .filter(Boolean);
    return names.join(', ') || msg.body || '';
  }
  if (type === 'poll_creation') return msg.pollName || msg.body || '';
  return msg.body || '';
}

/**
 * Convierte un mensaje de whatsapp-web.js en una fila de la BD.
 * live = true -> mensaje en tiempo real (descarga multimedia y emite por socket).
 */
async function processMessage(msg, { live }) {
  if (!msg || IGNORED_TYPES.has(msg.type) || msg.isStatus) return null;

  const waId = serialize(msg.id);
  const chatId = serialize(msg.id?.remote) || (msg.fromMe ? msg.to : msg.from);
  if (!waId || !isSupportedChat(chatId)) return null;
  if (await repo.messageExists(waId)) return null;

  await ensureChat(chatId);
  const isGroup = chatId.endsWith('@g.us');

  let senderId;
  let senderName;
  let senderPhone = null;
  if (msg.fromMe) {
    senderId = state.me?.id || 'me';
    senderName = 'Tú';
  } else {
    senderId = serialize(msg.author) || msg.from;
    const c = await resolveContact(senderId);
    senderName = c.savedName || c.pushname || msg._data?.notifyName || c.phone || c.name;
    senderPhone = c.phone;
  }

  let quotedBody = null;
  let quotedSender = null;
  if (msg.hasQuotedMsg) {
    try {
      const q = await msg.getQuotedMessage();
      if (q) {
        quotedBody = previewFor(q.type, extractBody(q));
        if (q.fromMe) quotedSender = 'Tú';
        else {
          const qc = await resolveContact(serialize(q.author) || q.from);
          quotedSender = qc.savedName || qc.pushname || qc.phone || qc.name;
        }
      }
    } catch {
      /* mensaje citado no disponible */
    }
  }

  const hasMedia = !!msg.hasMedia;
  const body = extractBody(msg);
  const row = await repo.insertMessage({
    waId,
    chatId,
    fromMe: !!msg.fromMe,
    senderId,
    senderName,
    senderPhone,
    type: msg.type || 'chat',
    body,
    hasMedia,
    mediaMime: msg._data?.mimetype || null,
    mediaFilename: msg._data?.filename || null,
    mediaStatus: hasMedia ? 'pending' : 'none',
    quotedBody,
    quotedSender,
    timestamp: new Date((msg.timestamp || Date.now() / 1000) * 1000),
  });
  if (!row) return null;

  const preview = previewFor(row.type, row.body);
  const lastSender = isGroup ? senderName : msg.fromMe ? 'Tú' : null;
  const chat = await repo.touchChat(chatId, row.timestamp, preview, lastSender, live && !msg.fromMe ? 1 : 0);

  if (live) {
    io?.emit('message', row);
    if (chat) io?.emit('chat', chat);
    console.log(`💬 [${chat?.name || chatId}] ${senderName}: ${preview}`);
    if (hasMedia && config.autoDownloadMedia) {
      downloadMedia(msg, waId).catch(() => {});
    }
  }
  return row;
}

/** Descarga el multimedia de un mensaje y lo guarda en la BD. Devuelve el media o null. */
export async function downloadMedia(msg, waId) {
  try {
    const media = await msg.downloadMedia();
    if (!media?.data) throw new Error('Sin datos');
    const buffer = Buffer.from(media.data, 'base64');
    if (buffer.length > config.maxMediaBytes) {
      const row = await repo.setMediaStatus(waId, 'too_large', media.mimetype, media.filename);
      if (row) io?.emit('message_updated', row);
      return null;
    }
    await repo.saveMedia(waId, media.mimetype, media.filename || null, buffer);
    const row = await repo.setMediaStatus(waId, 'ok', media.mimetype, media.filename || null);
    if (row) io?.emit('message_updated', row);
    return { mime: media.mimetype, filename: media.filename, data: buffer };
  } catch (err) {
    const row = await repo.setMediaStatus(waId, 'failed');
    if (row) io?.emit('message_updated', row);
    console.warn(`⚠️  No se pudo descargar multimedia ${waId}: ${err.message}`);
    return null;
  }
}

/** Intenta descargar bajo demanda el multimedia de un mensaje guardado (historial). */
export async function fetchMediaOnDemand(waId) {
  const c = getClient();
  if (!c) return null;
  const msg = await c.getMessageById(waId).catch(() => null);
  if (!msg || !msg.hasMedia) return null;
  return downloadMedia(msg, waId);
}

export async function sendText(chatId, text) {
  const c = getClient();
  if (!c) throw new Error('WhatsApp no está conectado');
  const sent = await c.sendMessage(chatId, text);
  // message_create también lo captura; esto garantiza que quede guardado
  await processMessage(sent, { live: true }).catch(() => {});
  return sent;
}

// ------------------------------------------------------- sincronización

async function syncHistory() {
  if (syncing) return;
  syncing = true;
  setState({ syncing: true });
  try {
    // Esperar 2 segundos tras el ready para asegurar que WhatsApp Web termine de poblar modelos
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawChats = await client.getChats().catch((err) => {
      console.warn('⚠️ No se pudieron obtener chats con getChats():', err.message);
      return [];
    });

    const chats = rawChats
      .filter((c) => isSupportedChat(serialize(c.id)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    console.log(`🔄 Sincronizando ${chats.length} chats...`);

    // 1) Todos los chats con su nombre (para la lista)
    for (const chat of chats) {
      try {
        const chatId = serialize(chat.id);
        if (!chatId) continue;
        knownChats.delete(chatId);
        await ensureChat(chatId, chat).catch(() => {});
        if (chat.isGroup && chat.name) {
          await repo.upsertChat({ id: chatId, name: chat.name, isGroup: true }).catch(() => {});
        }
      } catch (e) {
        // Ignorar chat individual con fallo
      }
    }

    // 2) Últimos mensajes de los chats más recientes
    const toFetch = chats.slice(0, Math.max(0, config.syncChatsLimit));
    for (const chat of toFetch) {
      if (config.syncMessagesPerChat <= 0) break;
      try {
        const msgs = await chat.fetchMessages({ limit: config.syncMessagesPerChat });
        for (const m of msgs) await processMessage(m, { live: false }).catch(() => {});
      } catch (err) {
        console.warn(`⚠️ No se pudo leer el historial de ${chat.name || chat.id?._serialized || 'chat'}: ${err.message}`);
      }
    }

    // 3) Chats sin mensajes guardados: usar el último mensaje que conoce WhatsApp como vista previa
    for (const chat of chats) {
      try {
        if (!chat.lastMessage || !chat.timestamp) continue;
        const lm = chat.lastMessage;
        if (IGNORED_TYPES.has(lm.type)) continue;
        const chatId = serialize(chat.id);
        if (!chatId) continue;
        await repo
          .touchChat(chatId, new Date(chat.timestamp * 1000), previewFor(lm.type, extractBody(lm)), lm.fromMe ? 'Tú' : null, 0)
          .catch(() => {});
      } catch (e) {
        // Ignorar
      }
    }
    console.log('✅ Sincronización completada');
  } catch (err) {
    console.error('❌ Error sincronizando historial:', err);
  } finally {
    syncing = false;
    setState({ syncing: false });
    io?.emit('chats_changed');
  }
}

// --------------------------------------------------------------- cliente

function buildClient() {
  const authStrategy =
    config.waAuth === 'remote'
      ? new RemoteAuth({
          clientId: config.waClientId,
          dataPath: config.waDataPath,
          store: new PgSessionStore(config.waDataPath),
          backupSyncIntervalMs: config.waBackupIntervalMs,
        })
      : new LocalAuth({ dataPath: config.waDataPath });

  const puppeteerOpts = {
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };

  const executablePath = config.chromePath;
  if (executablePath) {
    puppeteerOpts.executablePath = executablePath;
    console.log(`🧭 Usando Chrome en: ${executablePath}`);
  } else {
    console.log('🧭 Usando Chrome por defecto de Puppeteer');
  }

  return new Client({
    authStrategy,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1046916940-alpha.html',
    },
    puppeteer: puppeteerOpts,
  });
}

function attachHandlers(c) {
  c.on('qr', async (qr) => {
    console.log('📱 Escanea este código QR con WhatsApp (también se muestra en la web):');
    qrTerminal.generate(qr, { small: true });
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 }).catch(() => null);
    setState({ status: 'qr', qr: dataUrl, error: null });
  });

  c.on('loading_screen', (percent) => setState({ status: 'loading', loadingPercent: Number(percent) }));
  c.on('authenticated', () => setState({ status: 'authenticated', qr: null }));
  c.on('auth_failure', (m) => setState({ status: 'auth_failure', error: String(m) }));
  c.on('remote_session_saved', () => console.log('💾 Sesión remota guardada'));

  c.on('ready', async () => {
    const me = c.info?.wid?._serialized || null;
    setState({ status: 'ready', qr: null, error: null, me: { id: me, name: c.info?.pushname || null } });
    console.log(`✅ WhatsApp conectado como ${c.info?.pushname || ''} (${me})`);
    syncHistory();
  });

  c.on('message_create', (msg) => {
    processMessage(msg, { live: true }).catch((err) =>
      console.error('❌ Error procesando mensaje_create:', err.message),
    );
  });

  c.on('message', (msg) => {
    processMessage(msg, { live: true }).catch((err) =>
      console.error('❌ Error procesando message:', err.message),
    );
  });

  // "Eliminar para todos": NO se borra, solo se marca y se conserva el contenido original
  c.on('message_revoke_everyone', async (after, before) => {
    try {
      const waId = serialize(before?.id) || serialize(after?.protocolMessageKey) || serialize(after?.id);
      if (!waId) return;
      if (!(await repo.messageExists(waId)) && before) await processMessage(before, { live: true });
      const row = await repo.markRevoked(waId);
      if (row) {
        io?.emit('message_updated', row);
        console.log(`🚫 Mensaje eliminado por el remitente (conservado): ${waId}`);
      }
    } catch (err) {
      console.error('❌ Error en message_revoke_everyone:', err.message);
    }
  });

  c.on('message_edit', async (msg, newBody, prevBody) => {
    try {
      const row = await repo.markEdited(serialize(msg.id), newBody, prevBody);
      if (row) io?.emit('message_updated', row);
    } catch (err) {
      console.error('❌ Error en message_edit:', err.message);
    }
  });

  c.on('disconnected', (reason) => {
    console.warn('🔌 WhatsApp desconectado:', reason);
    setState({ status: 'disconnected', error: String(reason), me: null });
    scheduleRestart();
  });
}

function scheduleRestart(delay = 5000) {
  if (restarting) return;
  restarting = true;
  setTimeout(async () => {
    try {
      await client?.destroy().catch(() => {});
    } finally {
      restarting = false;
      start();
    }
  }, delay);
}

async function start() {
  setState({ status: 'starting', qr: null, error: null });
  knownChats.clear();
  client = buildClient();
  attachHandlers(client);
  try {
    await client.initialize();
  } catch (err) {
    console.error('❌ Error iniciando WhatsApp:', err.message);
    setState({ status: 'error', error: err.message });
    scheduleRestart(15000);
  }
}

export function startWhatsApp(socketServer) {
  io = socketServer;
  console.log(`🤖 Iniciando WhatsApp (sesión: ${config.waAuth === 'remote' ? 'PostgreSQL' : 'disco local'})...`);
  start();
}

export async function stopWhatsApp() {
  await client?.destroy().catch(() => {});
}
