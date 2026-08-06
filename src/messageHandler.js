// ==========================================
// LIBERTY MEDIA - MANEJADOR DE MENSAJES
// ==========================================

import { getAIResponse, detectCallScheduled } from './ai.js';
import { sessionManager } from './sessions.js';
import { startFollowUps, cancelFollowUps } from './followUps.js';
import { registerMessage, clearBuffer } from './messageBuffer.js';
import { humanDelay } from './humanDelay.js';
import { transcribeAudio, isAudioMessage } from './audioTranscriber.js';
import { existsSync } from 'fs';
import { OWNER_PHONE, STOP_KEYWORDS, matchesResumeKeyword } from './config.js';

// Brochure que se manda después de 2-3 intercambios reales (no en el primer contacto). Súbelo a esta ruta.
const BROCHURE_PATH = './assets/Desarrollo Web.pdf';

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
  if (matchesResumeKeyword(text)) {
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

  // Comando manual para pausar desde el mismo WhatsApp del bot
  if (STOP_KEYWORDS.includes(text)) {
    clearBuffer(jid);
    cancelFollowUps(jid);
    sessionManager.setMode(jid, 'paused');
    console.log(`⏸️ Bot pausado manualmente en ${jid}`);
    return;
  }

  // Si está pausado o con llamada agendada, solo una palabra de reactivación
  // (palabra completa, no substring) lo vuelve a encender. Este chequeo va
  // SOLO acá adentro — si estuviera antes, cualquier mensaje normal que
  // contenga "auto" (ej. "tengo una automotriz") apagaría el flujo normal
  // sin querer, cortando la conversación sin responder nada.
  if (mode === 'paused' || mode === 'call_scheduled') {
    if (matchesResumeKeyword(text)) {
      sessionManager.setMode(jid, 'bot');
      console.log(`🤖 Bot reactivado por el cliente en ${jid}`);
    } else {
      console.log(`⏸️ Ignorado (modo: ${mode})`);
    }
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

// Evita que dos mensajes del mismo chat (ej. un audio y un texto casi al
// mismo tiempo) se procesen en paralelo y pisen el estado de la sesión
// (dos saludos, dos respuestas, etc).
const processingJids = new Set();

// ── Procesa el mensaje final acumulado ──
async function processMessage(sock, message, jid, text) {
  if (processingJids.has(jid)) {
    console.log(`⏭️  Ya hay un mensaje en proceso para ${jid}, se descarta este para evitar carrera`);
    return;
  }
  processingJids.add(jid);

  const session = sessionManager.getOrCreate(jid);
  console.log(`🔵 processMessage iniciado para ${jid}, started=${session.started}`);

  cancelFollowUps(jid);

  try {
    // Primer mensaje del cliente → saludo fijo + notificar al dueño
    if (!session.started) {
      sessionManager.setStarted(jid);
      console.log(`👋 Enviando saludo a ${jid}...`);

      const greeting = `¡Hola! Soy Samuel de Liberty Media, hacemos páginas web para negocios. ¿Qué tipo de negocio tienes?`;

      await humanDelay(sock, jid, greeting);
      console.log(`📤 Enviando mensaje a ${jid}...`);
      await sock.sendMessage(jid, { text: greeting });
      console.log(`✅ Saludo enviado a ${jid}`);

      sessionManager.addMessage(jid, 'user', text);
      sessionManager.addMessage(jid, 'assistant', greeting);

      await notifyOwner(sock, jid, message.pushName, text);
      startFollowUps(sock, jid, sessionManager.getHistory(jid));
      return;
    }

    // Conversación normal
    console.log(`🤖 Llamando a OpenAI para ${jid}...`);
    sessionManager.addMessage(jid, 'user', text);

    // Detectar intención de agendar ANTES de responder. Si el cliente ya pidió
    // que lo llamen (a cualquier hora), el bot se pausa y te avisa a ti — no
    // manda ninguna confirmación propia, para que tú definas la hora con el cliente.
    const callInUserMsg = await detectCallScheduled(text);
    if (callInUserMsg) {
      await notifyOwnerCallScheduled(sock, jid, message.pushName, text);
      sessionManager.setMode(jid, 'call_scheduled');
      cancelFollowUps(jid);
      console.log(`📞 Llamada solicitada por ${jid}, bot pausado a la espera de que confirmes`);
      return;
    }

    const response = await getAIResponse(session.history, text);
    console.log(`✅ OpenAI respondió: "${response?.substring(0, 50)}"`);
    sessionManager.addMessage(jid, 'assistant', response);

    await humanDelay(sock, jid, response);
    await sock.sendMessage(jid, { text: response });
    console.log(`📤 Respuesta enviada a ${jid}`);

    // Brochure: se adjunta junto con el mensaje de cierre (después de las 2 preguntas
    // de calificación: tipo de negocio + presupuesto/fecha). El texto de cierre ya lo
    // genera la IA según el SYSTEM_PROMPT, acá solo mandamos el documento sin caption
    // repetido para no duplicar lo que Samuel ya dijo en el mensaje anterior.
    const userMessageCount = sessionManager.getHistory(jid).filter((m) => m.role === 'user').length;
    if (userMessageCount >= 3 && !sessionManager.hasSentFollowUp(jid, 'brochure')) {
      if (existsSync(BROCHURE_PATH)) {
        try {
          await sock.sendMessage(jid, {
            document: { url: BROCHURE_PATH },
            fileName: 'Desarrollo Web - Liberty Media.pdf',
            mimetype: 'application/pdf',
          });
          console.log(`📄 Brochure enviado a ${jid}`);
        } catch (err) {
          console.error(`⚠️ No se pudo enviar el brochure a ${jid}:`, err.message);
        }
      } else {
        console.log(`⏭️  Brochure omitido (no existe ${BROCHURE_PATH})`);
      }
      sessionManager.markFollowUpSent(jid, 'brochure');
    }

    // Por si el bot confirmó la llamada con su propia respuesta (caso raro, ya que
    // el chequeo de arriba debería atajarlo antes) — seguro extra para no perder el aviso.
    const callInBotResponse = response.toLowerCase().includes('te llamamos');

    if (callInBotResponse) {
      await notifyOwnerCallScheduled(sock, jid, message.pushName, text);
      sessionManager.setMode(jid, 'call_scheduled');
      cancelFollowUps(jid);
      console.log(`📞 Llamada agendada con ${jid}`);
    } else {
      startFollowUps(sock, jid, sessionManager.getHistory(jid));
    }

  } catch (error) {
    console.error(`❌ Error con ${jid}:`, error.message);
    console.error(error.stack);
    try {
      await sock.sendMessage(jid, {
        text: 'Perdona, algo falló. ¿Me repites? :)',
      });
    } catch (_) {}
  } finally {
    processingJids.delete(jid);
  }
}

// ── Notificar al dueño que hay que confirmar una cita/llamada ──
async function notifyOwnerCallScheduled(sock, clientJid, clientName, clientMessage) {
  if (!OWNER_PHONE) return;
  const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
  const clientNumber = clientJid.replace('@s.whatsapp.net', '');
  const name = clientName || 'Sin nombre';
  try {
    await sock.sendMessage(ownerJid, {
      text:
        `📞 Cita por confirmar\n\n` +
        `👤 ${name}\n` +
        `📞 wa.me/${clientNumber}\n` +
        `💬 "${clientMessage}"\n\n` +
        `Confirma con el cliente el horario de la llamada.`,
    });
  } catch (err) {
    console.error('⚠️ No se pudo notificar la cita al dueño:', err.message);
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
