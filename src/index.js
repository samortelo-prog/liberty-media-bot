// ==========================================
// LIBERTY MEDIA - BOT WHATSAPP
// ==========================================

import 'dotenv/config';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { handleMessage, handleOwnerMessage } from './messageHandler.js';

// auth_info puede ser el punto de montaje de un volumen (Railway): se puede
// vaciar su contenido, pero no borrar la carpeta en sí (da EBUSY).
// sessions.db vive en la misma carpeta pero ya está abierta por better-sqlite3,
// así que nunca debe borrarse aquí (rompería la conexión con "readonly database").
function clearAuthDirContents(authPath) {
  if (!existsSync(authPath)) {
    mkdirSync(authPath, { recursive: true });
    return;
  }
  for (const entry of readdirSync(authPath)) {
    if (entry === 'sessions.db') continue;
    rmSync(`${authPath}/${entry}`, { recursive: true, force: true });
  }
}

// ── Restaurar sesión ya vinculada desde una variable de entorno (bootstrap) ──
// Útil cuando el proveedor (ej. Railway) bloquea el handshake inicial del QR
// por venir de una IP de datacenter: se vincula una vez en una red normal y
// se sube esa sesión ya autenticada como AUTH_INFO_B64 (tar.gz en base64).
function bootstrapAuthFromEnv(authPath) {
  const b64 = process.env.AUTH_INFO_B64;
  if (!b64) return;

  console.log('📦 Restaurando sesión desde AUTH_INFO_B64 (sobreescribiendo lo que haya en el volumen)...');
  try {
    clearAuthDirContents(authPath); // limpiar cualquier sesión vieja/inválida
    const tarPath = '/tmp/auth_info_bootstrap.tar.gz';
    writeFileSync(tarPath, Buffer.from(b64, 'base64'));
    execSync(`tar -xzf ${tarPath} -C ${process.cwd()}`);
    console.log('✅ Sesión restaurada desde AUTH_INFO_B64.');
  } catch (err) {
    console.error('❌ Error restaurando sesión desde AUTH_INFO_B64:', err.message);
  }
}

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

  const authPath = './auth_info';
  console.log(`📁 Auth path: ${process.cwd()}/${authPath}`);

  bootstrapAuthFromEnv(authPath);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
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
        console.log('🔒 Sesión cerrada. Borrando credenciales inválidas para generar un QR nuevo...');
        try { clearAuthDirContents(authPath); } catch (_) {}
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
