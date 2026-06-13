// ==========================================
// LIBERTY MEDIA - BOT WHATSAPP
// ==========================================

import 'dotenv/config';
import baileys from '@whiskeysockets/baileys';
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baileys;
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { handleMessage, handleOwnerMessage } from './messageHandler.js';

const logger = pino({ level: 'silent' });

// Suprimir logs internos de Baileys que usan console.log directo
const originalLog = console.log;
console.log = (...args) => {
  const msg = args[0]?.toString() || '';
  if (
    msg.includes('Closing session') ||
    msg.includes('Closing stale') ||
    msg.includes('SessionEntry') ||
    msg.includes('remoteIdentityKey') ||
    msg.includes('registrationId') ||
    msg.includes('currentRatchet') ||
    msg.includes('indexInfo') ||
    msg.includes('baseKey') ||
    msg.includes('_chains') ||
    msg.includes('rootKey')
  ) return;
  originalLog(...args);
};

async function startBot() {
  console.log('🚀 Iniciando Liberty Media WhatsApp Bot...');

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: true,
    browser: ['Liberty Media Bot', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Escanea este código QR con WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`❌ Conexión cerrada. Código: ${statusCode}`);
      if (shouldReconnect) {
        console.log('🔄 Reconectando en 5 segundos...');
        setTimeout(startBot, 5000);
      } else {
        console.log('🔒 Sesión cerrada.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log('✅ Bot conectado a WhatsApp!');
      console.log(`📞 Número: ${sock.user?.id}`);
      console.log('💬 Listo para recibir mensajes...\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      if (message.key.remoteJid?.endsWith('@g.us')) continue;
      if (message.key.remoteJid === 'status@broadcast') continue;

      if (message.key.fromMe) {
        // Mensaje enviado desde el celular del dueño → pausar bot en ese chat
        await handleOwnerMessage(sock, message);
      } else {
        // Mensaje de un cliente
        await handleMessage(sock, message);
      }
    }
  });

  return sock;
}

process.on('uncaughtException', (err) => console.error('❌ Error:', err));
process.on('unhandledRejection', (err) => console.error('❌ Promesa:', err));

startBot();
