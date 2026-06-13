// ==========================================
// LIBERTY MEDIA - MANEJADOR DE MENSAJES
// ==========================================

import { getAIResponse, detectCallScheduled } from './ai.js';
import { sessionManager } from './sessions.js';
import { startFollowUps, cancelFollowUps } from './followUps.js';
import { registerMessage, clearBuffer } from './messageBuffer.js';
import { humanDelay } from './humanDelay.js';
import { transcribeAudio, isAudioMessage } from './audioTranscriber.js';
import { RESUME_KEYWORDS, OWNER_PHONE } from './config.js';

// ── Mensaje enviado por el dueño desde su celular ──
// Pausa el bot automáticamente en ese chat
export async function handleOwnerMessage(sock, message) {
  const jid = message.key.remoteJid;
  if (!jid) return;

  const text =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text || '';

  // Ignorar mensajes enviados a sí mismo o al dueño (notificaciones del bot)
  const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
  if (jid === ownerJid) return;

  // Ignorar si el texto es una notificación automática del bot
  if (text.includes('🔔 Nuevo cliente') || text.includes('🤖 Bot reactivado')) return;

  // Si el dueño escribe "bot" en el chat, reactiva el bot
  if (RESUME_KEYWORDS.some((kw) => text.toLowerCase().includes(kw))) {
    clearBuffer(jid);
    sessionManager.setMode(jid, 'bot');
    console.log(`🤖 Bot reactivado por el dueño en ${jid}`);
    return;
  }

  // Cualquier otro mensaje del dueño en chat de cliente → pausar
  const session = sessionManager.getOrCreate(jid);
  if (session.mode === 'bot') {
    clearBuffer(jid);
    cancelFollowUps(jid);
    sessionManager.setMode(jid, 'paused');
    console.log(`⏸️ Dueño escribió en ${jid} → bot pausado automáticamente`);
  }
}

// ── Mensaje de un cliente ──
export async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  const session = sessionManager.getOrCreate(jid);
  const mode = session.mode;

  let text = '';
  let isAudio = false;

  if (isAudioMessage(message)) {
    isAudio = true;
    const transcribed = await transcribeAudio(sock, message);
    if (!transcribed) {
      await humanDelay(sock, jid, 'corto');
      await sock.sendMessage(jid, {
        text: 'No pude escuchar bien el audio, ¿me lo escribes? :)',
      });
      return;
    }
    text = transcribed;
    console.log(`🎙️ [${jid}] Audio → "${text}"`);
  } else {
    text =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption || '';
    if (!text.trim()) return;
    text = text.trim();
  }

  console.log(`📩 [${jid}] [${mode}] → "${text}"`);

  // Comando manual "." para pausar desde el mismo WhatsApp del bot
  if (text === '.') {
    clearBuffer(jid);
    cancelFollowUps(jid);
    sessionManager.setMode(jid, 'paused');
    console.log(`⏸️ Bot pausado manualmente en ${jid}`);
    return;
  }

  // Reactivar bot escribiendo "bot"
  if (RESUME_KEYWORDS.some((kw) => text.toLowerCase().includes(kw))) {
    sessionManager.setMode(jid, 'bot');
    return;
  }

  // Si está pausado o llamada agendada → ignorar
  if (mode === 'paused' || mode === 'call_scheduled') {
    console.log(`⏸️ Ignorado (modo: ${mode})`);
    return;
  }

  // Audios: directo sin buffer
  if (isAudio) {
    await processMessage(sock, message, jid, text);
    return;
  }

  // Textos: acumular con buffer
  registerMessage(jid, text, async (accumulated) => {
    console.log(`✅ [${jid}] Buffer listo: "${accumulated}"`);
    await processMessage(sock, message, jid, accumulated);
  });
}

// ── Procesa el mensaje final acumulado ──
async function processMessage(sock, message, jid, text) {
  const session = sessionManager.getOrCreate(jid);
  console.log(`🔵 processMessage iniciado para ${jid}, started=${session.started}`);

  cancelFollowUps(jid);

  try {
    // Primer mensaje del cliente → saludo fijo + notificar al dueño
    if (!session.started) {
      sessionManager.setStarted(jid);
      console.log(`👋 Enviando saludo a ${jid}...`);

      const name = message.pushName ? message.pushName.split(' ')[0] : '';
      const greeting = name
        ? `¡Hola ${name}! Soy Samuel de Liberty Media, hacemos páginas web para negocios. ¿Qué tipo de negocio tienes?`
        : `¡Hola! Soy Samuel de Liberty Media, hacemos páginas web para negocios. ¿Qué tipo de negocio tienes?`;

      await humanDelay(sock, jid, greeting);
      console.log(`📤 Enviando mensaje a ${jid}...`);
      await sock.sendMessage(jid, { text: greeting });
      console.log(`✅ Saludo enviado a ${jid}`);

      sessionManager.addMessage(jid, 'user', text);
      sessionManager.addMessage(jid, 'assistant', greeting);

      notifyOwner(sock, jid, message.pushName, text);
      startFollowUps(sock, jid);
      return;
    }

    // Conversación normal
    console.log(`🤖 Llamando a OpenAI para ${jid}...`);
    sessionManager.addMessage(jid, 'user', text);
    const response = await getAIResponse(session.history, text);
    console.log(`✅ OpenAI respondió: "${response?.substring(0, 50)}"`);
    sessionManager.addMessage(jid, 'assistant', response);

    await humanDelay(sock, jid, response);
    await sock.sendMessage(jid, { text: response });
    console.log(`📤 Respuesta enviada a ${jid}`);

    const callScheduled = await detectCallScheduled(text);
    if (callScheduled) {
      sessionManager.setMode(jid, 'call_scheduled');
      cancelFollowUps(jid);
      console.log(`📞 Llamada agendada con ${jid}`);
    } else {
      startFollowUps(sock, jid);
    }

  } catch (error) {
    console.error(`❌ Error con ${jid}:`, error.message);
    console.error(error.stack);
    await sock.sendMessage(jid, {
      text: 'Perdona, algo falló. ¿Me repites? :)',
    });
  }
}

// ── Notificar al dueño ──
async function notifyOwner(sock, clientJid, clientName, firstMessage) {
  if (!OWNER_PHONE) return;
  const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
  const clientNumber = clientJid.replace('@s.whatsapp.net', '');
  const name = clientName || 'Sin nombre';
  try {
    await sock.sendMessage(ownerJid, {
      text:
        `🔔 Nuevo cliente\n\n` +
        `👤 ${name}\n` +
        `📞 wa.me/${clientNumber}\n` +
        `💬 "${firstMessage}"`,
    });
  } catch (err) {
    console.error('⚠️ No se pudo notificar al dueño:', err.message);
  }
}
