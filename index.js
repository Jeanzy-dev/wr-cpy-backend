const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Creamos la instancia del cliente guardando la sesión localmente
const client = new Client({
    authStrategy: new LocalAuth()
});

// Evento cuando se genera el QR para vincular el WhatsApp
client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu celular:');
    qrcode.generate(qr, { small: true });
});

// Evento cuando la sesión queda lista y conectada
client.on('ready', () => {
    console.log('¡Conectado exitosamente a WhatsApp Web!');
});

// Evento que se dispara CADA VEZ que llega un mensaje descifrado
client.on('message', async (msg) => {
    // Obtenemos el objeto del contacto resuelto
    const contact = await msg.getContact();

    console.log('\n--- NUEVO MENSAJE RECIBIDO ---');
    console.log(`Nombre guardado / Pushname: ${contact.pushname || contact.name}`);
    console.log(`Número real: ${contact.number}`); // Aquí te sale el número con código de país
    console.log(`ID formato antiguo: ${contact.id._serialized}`);
    console.log(`Contenido: ${msg.body}`);
});

// Inicializamos el cliente
client.initialize();