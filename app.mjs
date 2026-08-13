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
client.on('message', async (msg) => {
  try {
    let nombreContacto = '';
    let numeroReal = msg.from;

    try {
      const contact = await msg.getContact();
      if (contact) {
        numeroReal = contact.id?._serialized || msg.from;
        // Obtenemos el nombre real, pushname o el número limpio
        nombreContacto = contact.pushname || contact.name || contact.formattedName || '';
      }
    } catch (e) { }

    try {
      const chat = await msg.getChat();
      if (chat && chat.name && chat.name !== msg.from) {
        nombreContacto = chat.name || nombreContacto;
      }
    } catch (e) { }

    // Si de plano no hay nombre, sacamos el número o una etiqueta limpia
    if (!nombreContacto || nombreContacto === numeroReal) {
      if (msg.from.includes('@lid')) {
        nombreContacto = 'Dispositivo / LID';
      } else if (msg.from.includes('@g.us')) {
        nombreContacto = 'Grupo de WhatsApp';
      } else {
        nombreContacto = numeroReal.replace('@c.us', '');
      }
    }

    const textoMensaje = msg.body && msg.body.trim() !== ''
      ? msg.body
      : (msg.hasMedia ? '[Archivo multimedia]' : '[Sin texto]');

    // Guardamos el mensaje nuevo
    const newMessage = new Message({
      sender: numeroReal,
      senderName: nombreContacto && nombreContacto !== numeroReal ? nombreContacto : 'Alguien', // Forzamos un nombre si viene crudo
      receiver: client.info?.wid?._serialized || 'bot',
      content: textoMensaje,
      timestamp: new Date(msg.timestamp * 1000)
    });

    const savedMessage = await newMessage.save();
    io.emit('nuevo_mensaje', savedMessage);
    console.log(` Mensaje guardado de: ${nombreContacto} (${numeroReal})`);

  } catch (error) {
    console.error('Error crítico en evento message:', error);
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
    const chats = await Message.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$sender',
          // Aquí le decimos que si senderName existe y no está vacío lo use, de lo contrario use el número
          name: { 
            $first: { 
              $cond: [
                { $and: [{ $ne: ['$senderName', ''] }, { $ne: ['$senderName', null] }] },
                '$senderName',
                '$sender'
              ] 
            } 
          },
          phone: { $first: '$sender' },
          lastMessage: { $first: '$content' },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { timestamp: -1 } }
    ]);

    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener la lista de chats', details: error.message });
  }
});

// 5. Iniciar servidor usando server.listen (Obligatorio para Socket.io)
server.listen(PORT, () => {
  console.log(` Servidor y WebSockets corriendo en http://localhost:${PORT}`);
  client.initialize();
});