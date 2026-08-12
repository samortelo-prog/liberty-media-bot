// ==========================================
// LIBERTY MEDIA - BOT WHATSAPP
// ==========================================

import 'dotenv/config';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { rmSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
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
//
// El marcador guarda un hash del valor de AUTH_INFO_B64 ya importado (no solo
// un "sí/no"), así que si en algún momento subes una sesión nueva (ej. tras
// una corrupción Bad MAC) y actualizas la variable en Railway, el siguiente
// deploy la detecta automáticamente y la reimporta — sin tener que borrar
// marcadores a mano ni tocar el startCommand.
function bootstrapAuthFromEnv(authPath) {
  const b64 = process.env.AUTH_INFO_B64;
  if (!b64) return;

  const markerPath = `${authPath}/.bootstrapped_from_env`;
  const currentHash = createHash('sha256').update(b64).digest('hex');

  let previousHash = null;
  try { previousHash = readFileSync(markerPath, 'utf8').trim(); } catch (_) {}

  if (previousHash === currentHash) {
    console.log('📦 AUTH_INFO_B64 sin cambios respecto a la sesión ya restaurada en este volumen — no se reimporta.');
    return;
  }

  console.log('📦 AUTH_INFO_B64 es nuevo o cambió — restaurando sesión (sobreescribiendo lo que haya en el volumen)...');
  try {
    clearAuthDirContents(authPath); // limpiar cualquier sesión vieja/inválida
    const tarPath = '/tmp/auth_info_bootstrap.tar.gz';
    writeFileSync(tarPath, Buffer.from(b64, 'base64'));
    execSync(`tar -xzf ${tarPath} -C ${process.cwd()}`);
    writeFileSync(markerPath, currentHash);
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

// Referencia al socket activo, para poder cerrarlo antes de crear uno nuevo
// en cada reconexión. Sin esto, cada reconexión deja un socket "zombie"
// escuchando mensajes, y el mismo mensaje termina respondido varias veces.
let currentSock = null;

// IDs de mensajes ya procesados, para no responder dos veces al mismo mensaje
// (Baileys a veces reentrega el mismo mensaje más de una vez).
const processedMessageIds = new Set();
const MAX_PROCESSED_IDS = 500;

function alreadyProcessed(id) {
  if (!id) return false;
  if (processedMessageIds.has(id)) return true;
  processedMessageIds.add(id);
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
  return false;
}

async function startBot() {
  console.log('🚀 Iniciando Liberty Media WhatsApp Bot...');

  // Cerrar cualquier socket anterior antes de abrir uno nuevo
  if (currentSock) {
    try {
      currentSock.ev.removeAllListeners();
      currentSock.end(new Error('reconectando'));
    } catch (_) {}
    currentSock = null;
  }

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
      console.log(`❌ Conexión cerrada. Código: ${statusCode}`);

      if (statusCode === DisconnectReason.connectionReplaced) {
        // Otra sesión (ej. un deploy nuevo, o el bot corriendo en otro lugar)
        // tomó esta misma cuenta. NO hay que pelear por recuperarla — si este
        // proceso insiste en reconectar, se genera un forcejeo entre dos
        // instancias que termina corrompiendo las claves de cifrado (Bad MAC).
        // Simplemente nos rendimos y dejamos que la otra instancia siga.
        console.log('🔁 Sesión reemplazada por otra conexión activa. Este proceso se retira sin reconectar.');
        process.exit(0);
        return;
      }

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
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
      if (alreadyProcessed(message.key.id)) {
        console.log(`⏭️  Mensaje duplicado ignorado (id ${message.key.id})`);
        continue;
      }

      if (message.key.fromMe) {
        // Mensaje enviado desde el celular del dueño → pausar bot en ese chat
        await handleOwnerMessage(sock, message);
      } else {
        // Mensaje de un cliente
        await handleMessage(sock, message);
      }
    }
  });

  currentSock = sock;
  return sock;
}

process.on('uncaughtException', (err) => console.error('❌ Error:', err));
process.on('unhandledRejection', (err) => console.error('❌ Promesa:', err));

startBot();
