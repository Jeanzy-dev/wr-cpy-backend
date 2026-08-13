import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

import { connectDB } from './config/db.js';
import { Message } from './models/Message.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Crear servidor HTTP e integrar Socket.io con CORS libre para Angular
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let qrCodeData = '';

app.use(cors());
app.use(express.json());

// 2. Conectar a MongoDB
connectDB();

// 3. Configurar WhatsApp Web
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014111620-alpha.html'
  }
});

// Evento: Generar QR
client.on('qr', (qr) => {
  console.log(' Escanea este código QR con tu WhatsApp:');
  qrcodeTerminal.generate(qr, { small: true });

  QRCode.toDataURL(qr, (err, url) => {
    if (!err) qrCodeData = url;
  });
});

// Evento: Listo
client.on('ready', () => {
  console.log(' ¡WhatsApp Web está conectado y listo!');
  qrCodeData = '';
});

// Evento: Socket.io conexión de clientes (Frontend)
io.on('connection', (socket) => {
  console.log(' Cliente de Angular conectado por WebSockets. Socket ID:', socket.id);
});

// Evento: Escuchar mensajes entrantes de WhatsApp
// Evento: Escuchar mensajes entrantes de WhatsApp
client.on('message_create', async (msg) => {
  try {
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
        // 🔑 Intentamos obtener el nombre del usuario que habló dentro del grupo
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

    const textoMensaje = msg.body && msg.body.trim() !== ''
      ? msg.body
      : (msg.hasMedia ? '[Archivo multimedia]' : '[Sin texto]');

    const newMessage = new Message({
      sender: idChatPrincipal,
      senderName: esGrupo && !esSaliente ? nombreRemitente : (esSaliente ? 'Tú' : nombreRemitente),
      chatName: nombreGrupoOChat, // 👈 Guardamos el nombre del grupo aquí
      receiver: receptor,
      content: textoMensaje,
      timestamp: new Date(msg.timestamp * 1000)
    });

    const savedMessage = await newMessage.save();
    io.emit('nuevo_mensaje', savedMessage);
    console.log(`💬 Mensaje de ${nombreRemitente} guardado en el grupo: ${nombreGrupoOChat}`);

  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
});
// 4. Endpoints de la API REST
app.get('/api/messages', async (req, res) => {
  try {
    const { sender } = req.query;
    const messages = await Message.find({ sender }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Obtener lista de chats únicos con su respectivo nombre y número
// Obtener lista de chats únicos con su respectivo nombre y número
app.get('/api/chats', async (req, res) => {
  try {
    const chatsAgrupados = await Message.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$sender',
          lastMessage: { $first: '$content' },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { timestamp: -1 } }
    ]);

    const chatsConNombre = await Promise.all(chatsAgrupados.map(async (chat) => {
      let nombreMostrado = chat._id;

      try {
        if (chat._id.includes('@g.us')) {
          const grupoChat = await client.getChatById(chat._id);
          if (grupoChat && grupoChat.name) {
            nombreMostrado = grupoChat.name;
          }
        } else {
          const contacto = await client.getContactById(chat._id);
          if (contacto && (contacto.pushname || contacto.name)) {
            nombreMostrado = contacto.pushname || contacto.name;
          }
        }
      } catch (e) {
        // Si es un grupo y falla la API de wwebjs, le ponemos un nombre temporal estético en vez del ID
        if (chat._id.includes('@g.us')) {
          nombreMostrado = 'Grupo de WhatsApp';
        }
      }

      return {
        id: chat._id,
        name: nombreMostrado,
        lastMessage: chat.lastMessage,
        timestamp: chat.timestamp
      };
    }));

    res.json(chatsConNombre);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Iniciar servidor usando server.listen (Obligatorio para Socket.io)
server.listen(PORT, () => {
  console.log(` Servidor y WebSockets corriendo en http://localhost:${PORT}`);
  client.initialize();
});