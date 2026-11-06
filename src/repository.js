import { query } from './db.js';

const MESSAGE_COLUMNS = `
  id, wa_id, chat_id, from_me, sender_id, sender_name, sender_phone, type, body,
  original_body, has_media, media_mime, media_filename, media_status, is_revoked,
  is_edited, quoted_body, quoted_sender, timestamp`;

export async function upsertChat({ id, name = null, isGroup = false, phone = null }) {
  const { rows } = await query(
    `INSERT INTO chats (id, name, is_group, phone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, chats.name),
       is_group = EXCLUDED.is_group,
       phone = COALESCE(EXCLUDED.phone, chats.phone),
       updated_at = NOW()
     RETURNING *`,
    [id, name, isGroup, phone],
  );
  return rows[0];
}

/** Actualiza el "último mensaje" del chat solo si el nuevo es más reciente. */
export async function touchChat(chatId, timestamp, preview, sender, unreadIncrement = 0) {
  const { rows } = await query(
    `UPDATE chats SET
       last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at <= $2 THEN $2 ELSE last_message_at END,
       last_message_preview = CASE WHEN last_message_at IS NULL OR last_message_at <= $2 THEN $3 ELSE last_message_preview END,
       last_message_sender = CASE WHEN last_message_at IS NULL OR last_message_at <= $2 THEN $4 ELSE last_message_sender END,
       unread_count = unread_count + $5,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [chatId, timestamp, preview, sender, unreadIncrement],
  );
  return rows[0];
}

export async function getChat(chatId) {
  const { rows } = await query('SELECT * FROM chats WHERE id = $1', [chatId]);
  return rows[0] || null;
}

export async function listChats() {
  const { rows } = await query(
    `SELECT * FROM chats
     ORDER BY last_message_at DESC NULLS LAST, name ASC`,
  );
  return rows;
}

export async function markChatRead(chatId) {
  const { rows } = await query(
    'UPDATE chats SET unread_count = 0 WHERE id = $1 RETURNING *',
    [chatId],
  );
  return rows[0] || null;
}

/** Inserta el mensaje; si ya existía (mismo wa_id) devuelve null y no toca nada. */
export async function insertMessage(m) {
  const { rows } = await query(
    `INSERT INTO messages (
       wa_id, chat_id, from_me, sender_id, sender_name, sender_phone, type, body,
       has_media, media_mime, media_filename, media_status, quoted_body, quoted_sender, timestamp
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (wa_id) DO NOTHING
     RETURNING ${MESSAGE_COLUMNS}`,
    [
      m.waId, m.chatId, m.fromMe, m.senderId, m.senderName, m.senderPhone, m.type, m.body,
      m.hasMedia, m.mediaMime, m.mediaFilename, m.mediaStatus, m.quotedBody, m.quotedSender,
      m.timestamp,
    ],
  );
  return rows[0] || null;
}

export async function messageExists(waId) {
  const { rows } = await query('SELECT 1 FROM messages WHERE wa_id = $1', [waId]);
  return rows.length > 0;
}

export async function getMessage(waId) {
  const { rows } = await query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE wa_id = $1`, [waId]);
  return rows[0] || null;
}

/** Devuelve los últimos `limit` mensajes (opcionalmente anteriores a `before`) en orden cronológico. */
export async function getMessages(chatId, { before = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT ${MESSAGE_COLUMNS} FROM messages
     WHERE chat_id = $1 AND ($2::timestamptz IS NULL OR timestamp < $2::timestamptz)
     ORDER BY timestamp DESC, id DESC
     LIMIT $3`,
    [chatId, before, limit],
  );
  return rows.reverse();
}

export async function markRevoked(waId) {
  const { rows } = await query(
    `UPDATE messages SET is_revoked = TRUE WHERE wa_id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [waId],
  );
  return rows[0] || null;
}

export async function markEdited(waId, newBody, prevBody) {
  const { rows } = await query(
    `UPDATE messages SET
       body = $2,
       original_body = COALESCE(original_body, $3, body),
       is_edited = TRUE
     WHERE wa_id = $1
     RETURNING ${MESSAGE_COLUMNS}`,
    [waId, newBody, prevBody ?? null],
  );
  return rows[0] || null;
}

export async function setMediaStatus(waId, status, mime = null, filename = null) {
  const { rows } = await query(
    `UPDATE messages SET
       media_status = $2,
       media_mime = COALESCE($3, media_mime),
       media_filename = COALESCE($4, media_filename)
     WHERE wa_id = $1
     RETURNING ${MESSAGE_COLUMNS}`,
    [waId, status, mime, filename],
  );
  return rows[0] || null;
}

export async function saveMedia(waId, mime, filename, data) {
  await query(
    `INSERT INTO media (message_wa_id, mime, filename, size_bytes, data)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (message_wa_id) DO UPDATE SET
       mime = EXCLUDED.mime, filename = EXCLUDED.filename,
       size_bytes = EXCLUDED.size_bytes, data = EXCLUDED.data`,
    [waId, mime, filename, data.length, data],
  );
}

export async function getMedia(waId) {
  const { rows } = await query(
    'SELECT mime, filename, size_bytes, data FROM media WHERE message_wa_id = $1',
    [waId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return { ...row, data: Buffer.from(row.data) };
}
