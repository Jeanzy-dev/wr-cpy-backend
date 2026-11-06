-- =====================================================================
--  WhatsApp Monitor - Esquema PostgreSQL
--  Es idempotente: se puede ejecutar varias veces sin romper nada.
--  El backend también lo ejecuta automáticamente al arrancar.
-- =====================================================================

-- Chats (individuales y grupos)
CREATE TABLE IF NOT EXISTS chats (
    id                   TEXT PRIMARY KEY,               -- ej: 573001234567@c.us | 1203630...@g.us | 1234@lid
    name                 TEXT,                           -- nombre del contacto/grupo
    is_group             BOOLEAN     NOT NULL DEFAULT FALSE,
    phone                TEXT,                           -- número telefónico (si se conoce)
    last_message_at      TIMESTAMPTZ,
    last_message_preview TEXT,
    last_message_sender  TEXT,
    unread_count         INTEGER     NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats (last_message_at DESC NULLS LAST);

-- Mensajes. Nunca se borran: si alguien "elimina para todos" se marca is_revoked = TRUE
-- y se conserva el contenido original.
CREATE TABLE IF NOT EXISTS messages (
    id              BIGSERIAL PRIMARY KEY,
    wa_id           TEXT        NOT NULL UNIQUE,          -- id serializado de WhatsApp
    chat_id         TEXT        NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
    from_me         BOOLEAN     NOT NULL DEFAULT FALSE,
    sender_id       TEXT,                                  -- id del autor (en grupos, el participante)
    sender_name     TEXT,                                  -- nombre del contacto o pushname
    sender_phone    TEXT,
    type            TEXT        NOT NULL DEFAULT 'chat',   -- chat | image | video | audio | ptt | document | sticker | ...
    body            TEXT,
    original_body   TEXT,                                  -- texto antes de una edición
    has_media       BOOLEAN     NOT NULL DEFAULT FALSE,
    media_mime      TEXT,
    media_filename  TEXT,
    media_status    TEXT        NOT NULL DEFAULT 'none',   -- none | pending | ok | failed
    is_revoked      BOOLEAN     NOT NULL DEFAULT FALSE,
    is_edited       BOOLEAN     NOT NULL DEFAULT FALSE,
    quoted_body     TEXT,
    quoted_sender   TEXT,
    timestamp       TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, timestamp);

-- Archivos multimedia (fotos, audios, videos, documentos, stickers)
-- Se guardan en la BD porque el disco de Render es efímero.
CREATE TABLE IF NOT EXISTS media (
    message_wa_id TEXT PRIMARY KEY REFERENCES messages (wa_id) ON DELETE CASCADE,
    mime          TEXT        NOT NULL,
    filename      TEXT,
    size_bytes    INTEGER     NOT NULL,
    data          BYTEA       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sesión de WhatsApp (RemoteAuth) para no tener que escanear el QR en cada reinicio de Render
CREATE TABLE IF NOT EXISTS wa_sessions (
    session    TEXT PRIMARY KEY,
    data       BYTEA       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
