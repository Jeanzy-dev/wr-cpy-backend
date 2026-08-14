import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const { Client, LocalAuth } = pkg;

// Configuración de Express y Servidor HTTP
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuración de Multer para la carpeta uploads/
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Hacer pública la carpeta uploads para poder ver las imágenes
app.use('/uploads', express.static('uploads'));

// Conexión a MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/whatsapp_monitor')
  .then(() => console.log('📦 Conectado a MongoDB'))
  .catch(err => console.error('Error conectando a MongoDB:', err));

// Modelo de Mongoose
const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  senderName: { type: String, default: '' },
  chatName: { type: String, default: '' },
  receiver: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, required: true }
});

const Message = mongoose.model('Message', messageSchema);

// Inicialización de WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
  console.log('Escanea este código QR con tu celular:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('¡WhatsApp conectado y listo!');
});

// Listener de mensajes unificados (Privados y Grupos)
client.on('message_create', async (msg) => {
  try {
    // FILTRO: Ignorar los estados o historias de WhatsApp de una vez
    if (msg.from === 'status@broadcast' || msg.to === 'status@broadcast') {
      return;
    }

    const miNumero = client.info?.wid?._serialized;
    const esSaliente = msg.fromMe;
    const esGrupo = msg.from.includes('@g.us') || msg.to.includes('@g.us');

    let idChatPrincipal = esGrupo ? (esSaliente ? msg.to : msg.from) : (esSaliente ? msg.to : msg.from);
    let receptor = esGrupo ? idChatPrincipal : (esSaliente ? idChatPrincipal : miNumero);
    let nombreRemitente = '';
    let nombreGrupoOChat = '';

    if (esGrupo) {
      try {
        const chat = await msg.getChat();
        nombreGrupoOChat = chat.name || 'Grupo de WhatsApp';
      } catch (e) {
        nombreGrupoOChat = 'Grupo de WhatsApp';
      }

      if (esSaliente) {
        nombreRemitente = 'Tú';
      } else {
        try {
          const contact = await msg.getContact();
          const nombrePersona = contact.pushname || contact.name || contact.formattedName;
          nombreRemitente = nombrePersona ? `${nombrePersona}` : 'Miembro del Grupo';
        } catch (e) {
          nombreRemitente = 'Miembro del Grupo';
        }
      }
    } else {
      nombreGrupoOChat = esSaliente ? 'Chat Privado' : 'Contacto';
      if (esSaliente) {
        nombreRemitente = 'Tú';
      } else {
        try {
          const contact = await msg.getContact();
          nombreRemitente = contact.pushname || contact.name || contact.formattedName || idChatPrincipal;
        } catch (e) {
          nombreRemitente = idChatPrincipal;
        }
      }
    }

    // Procesamiento seguro y limpio para evitar bloqueos multimedia
    let textoMensaje = msg.body && msg.body.trim() !== '' ? msg.body : '';

    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const extension = media.mimetype ? media.mimetype.split('/')[1] : 'jpg';
          const filename = `whatsapp-${Date.now()}-${Math.round(Math.random() * 1E9)}.${extension}`;
          const filepath = path.join('uploads', filename);

          fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
          textoMensaje = `uploads/${filename}`;
        } else {
          textoMensaje = '[Archivo multimedia]';
        }
      } catch (e) {
        // Dejamos un identificador limpio para saber que multimedia llegó pero está protegida
        textoMensaje = '[Archivo multimedia protegido]';
      }
    } else if (!textoMensaje) {
      textoMensaje = '[Sin texto]';
    }

    const newMessage = new Message({
      sender: idChatPrincipal,
      senderName: esGrupo && !esSaliente ? nombreRemitente : (esSaliente ? 'Tú' : nombreRemitente),
      chatName: nombreGrupoOChat,
      receiver: receptor,
      content: textoMensaje,
      timestamp: new Date(msg.timestamp * 1000)
    });

    const savedMessage = await newMessage.save();
    io.emit('nuevo_mensaje', savedMessage);
    console.log(`💬 Mensaje procesado en el hilo: ${idChatPrincipal}`);

  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
});

client.initialize();

// ==========================================
// ENDPOINTS DE LA API
// ==========================================

// Obtener lista de chats unificados
app.get('/api/chats', async (req, res) => {
  try {
    const chatsAgrupados = await Message.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$sender',
          name: { $first: '$chatName' },
          lastMessage: { $first: '$content' },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { timestamp: -1 } }
    ]);

    const formattedChats = chatsAgrupados.map(chat => ({
      id: chat._id,
      name: chat._id.includes('@g.us')
        ? (chat.name && chat.name !== 'Chat Privado' ? chat.name : 'Grupo de WhatsApp')
        : (chat.name && chat.name !== 'Grupo de WhatsApp' ? chat.name : chat._id),
      lastMessage: chat.lastMessage,
      timestamp: chat.timestamp
    }));

    res.json(formattedChats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener mensajes de un chat específico
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const messages = await Message.find({ sender: chatId }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para subir imágenes/archivos con Multer
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '¡Eche, no subiste ninguna imagen, mi llave!' });
    }
    res.json({
      message: 'Imagen guardada con éxito',
      filePath: req.file.path,
      filename: req.file.filename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Configuración de puertos y entorno (Inyección por comandos)
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.NODE_ENV === 'production'
  ? 'https://kdldzng6-3000.use2.devtunnels.ms'
  : `http://localhost:${PORT}`;

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en modo: ${process.env.NODE_ENV || 'desarrollo'}`);
  console.log(`🔗 Acceso disponible en: ${PUBLIC_URL}`);
});