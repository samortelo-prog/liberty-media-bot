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
import { OWNER_PHONE, STOP_KEYWORDS, matchesResumeKeyword, CALL_INTENT_MESSAGE, CLOSE_MESSAGE, isAffirmativeReply, containsLink } from './config.js';

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

// Si llega un mensaje nuevo del cliente MIENTRAS ya se está procesando el
// anterior (algo común: el bot tarda 30+ segundos en responder por el delay
// humano, y el cliente escribe algo más en ese rato), antes se descartaba en
// silencio y nunca se respondía. Ahora se encola y se procesa apenas termina
// el mensaje en curso, en vez de perderse.
const pendingWhileProcessing = new Map(); // jid → { message, text }

// ── Procesa el mensaje final acumulado ──
async function processMessage(sock, message, jid, text) {
  if (processingJids.has(jid)) {
    console.log(`⏳ [${jid}] Ocupado procesando otro mensaje, se encola: "${text}"`);
    const prev = pendingWhileProcessing.get(jid);
    const mergedText = prev ? `${prev.text} ${text}` : text;
    pendingWhileProcessing.set(jid, { message, text: mergedText });
    return;
  }
  processingJids.add(jid);

  const session = sessionManager.getOrCreate(jid);
  console.log(`🔵 processMessage iniciado para ${jid}, started=${session.started}`);

  cancelFollowUps(jid);

  try {
    sessionManager.addMessage(jid, 'user', text);

    // Prioridad máxima, incluso por encima de la intención de llamada: si el
    // cliente manda un link (para que veamos su página, redes, etc.), el bot
    // NO responde nada — se pausa el chat completamente y te avisa para que
    // respondas tú directamente.
    if (containsLink(text)) {
      sessionManager.setStarted(jid);
      sessionManager.setMode(jid, 'paused');
      cancelFollowUps(jid);
      await notifyOwnerLinkReceived(sock, jid, message.pushName, text);
      console.log(`🔗 Link recibido de ${jid}, chat pausado a la espera de que respondas`);
      return;
    }

    // Si el último mensaje del bot fue el cierre fijo (paso 3, "¿deseas que
    // agendemos una llamada?"), una respuesta afirmativa corta ("sí", "dale",
    // "ok"...) ya cuenta como intención de llamada, aunque no mencione
    // "llamar" — el clasificador de IA por sí solo no tiene ese contexto
    // porque solo evalúa el mensaje suelto.
    const historyBeforeThis = sessionManager.getHistory(jid);
    const lastAssistantMsg = [...historyBeforeThis].reverse().find((m) => m.role === 'assistant');
    const isAffirmativeAfterClose = lastAssistantMsg?.content === CLOSE_MESSAGE && isAffirmativeReply(text);

    // Prioridad absoluta, por encima de cualquier otra cosa: si el lead muestra
    // intención de llamada (en cualquier punto, incluso en su primer mensaje),
    // el bot NUNCA confirma horario ni sigue calificando — manda siempre el
    // mismo texto fijo + el PDF, y te notifica a ti para que definas la hora.
    const callInUserMsg = isAffirmativeAfterClose || (await detectCallScheduled(text));
    if (callInUserMsg) {
      await sendCallIntentReply(sock, jid);
      sessionManager.addMessage(jid, 'assistant', CALL_INTENT_MESSAGE);
      sessionManager.setStarted(jid);
      await notifyOwnerCallScheduled(sock, jid, message.pushName, text);
      sessionManager.setMode(jid, 'call_scheduled');
      cancelFollowUps(jid);
      console.log(`📞 Intención de llamada de ${jid}, bot pausado a la espera de que confirmes`);
      return;
    }

    // Primer mensaje del cliente → saludo generado por IA (varía cada vez) + notificar al dueño
    if (!session.started) {
      sessionManager.setStarted(jid);
      console.log(`👋 Generando saludo inicial para ${jid}...`);

      const greeting = await getAIResponse([], text);
      console.log(`✅ Saludo generado: "${greeting?.substring(0, 60)}"`);

      await humanDelay(sock, jid, greeting);
      await sock.sendMessage(jid, { text: greeting });
      console.log(`📤 Saludo enviado a ${jid}`);

      sessionManager.addMessage(jid, 'assistant', greeting);

      await notifyOwner(sock, jid, message.pushName, text);
      startFollowUps(sock, jid, { isFirstMessage: true });
      return;
    }

    // Conversación normal (pregunta de calificación, o cierre)
    // userMessageCount ya incluye el mensaje actual (se agregó arriba). El
    // mensaje #1 lo maneja el saludo inicial (return más arriba), así que acá
    // llegamos desde el #2 en adelante. Cuando el lead ya respondió la
    // pregunta de calificación (#3), el cierre es SIEMPRE el texto fijo
    // CLOSE_MESSAGE, no algo generado por la IA — así la oferta de llamada
    // suena igual siempre y evitamos que la IA la redacte distinto cada vez.
    const userMessageCount = sessionManager.getHistory(jid).filter((m) => m.role === 'user').length;
    const isCloseStep = userMessageCount === 3 && !sessionManager.hasSentFollowUp(jid, 'brochure');

    let response;
    if (isCloseStep) {
      response = CLOSE_MESSAGE;
      console.log(`📌 Cierre fijo para ${jid}`);
    } else {
      console.log(`🤖 Llamando a OpenAI para ${jid}...`);
      response = await getAIResponse(session.history, text);
      console.log(`✅ OpenAI respondió: "${response?.substring(0, 50)}"`);
    }
    sessionManager.addMessage(jid, 'assistant', response);

    await humanDelay(sock, jid, response);
    await sock.sendMessage(jid, { text: response });
    console.log(`📤 Respuesta enviada a ${jid}`);

    // Brochure: se adjunta junto con el mensaje de cierre.
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

    startFollowUps(sock, jid);

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

    // Si llegó algo mientras estábamos ocupados, procesarlo ahora.
    const queued = pendingWhileProcessing.get(jid);
    if (queued) {
      pendingWhileProcessing.delete(jid);
      processMessage(sock, queued.message, jid, queued.text).catch((err) =>
        console.error(`❌ Error procesando mensaje en cola para ${jid}:`, err.message)
      );
    }
  }
}

// ── Respuesta fija (texto exacto, nunca generado por IA) + PDF cuando el
// lead muestra intención de llamada ──
async function sendCallIntentReply(sock, jid) {
  await humanDelay(sock, jid, CALL_INTENT_MESSAGE);
  await sock.sendMessage(jid, { text: CALL_INTENT_MESSAGE });
  console.log(`📤 Mensaje de intención de llamada enviado a ${jid}`);

  if (existsSync(BROCHURE_PATH)) {
    try {
      await sock.sendMessage(jid, {
        document: { url: BROCHURE_PATH },
        fileName: 'Desarrollo Web - Liberty Media.pdf',
        mimetype: 'application/pdf',
      });
      console.log(`📄 Brochure enviado a ${jid} (intención de llamada)`);
    } catch (err) {
      console.error(`⚠️ No se pudo enviar el brochure a ${jid}:`, err.message);
    }
  } else {
    console.log(`⏭️  Brochure omitido (no existe ${BROCHURE_PATH})`);
  }
  sessionManager.markFollowUpSent(jid, 'brochure');
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

// ── Notificar al dueño que un cliente mandó un link (chat pausado) ──
async function notifyOwnerLinkReceived(sock, clientJid, clientName, clientMessage) {
  if (!OWNER_PHONE) return;
  const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
  const clientNumber = clientJid.replace('@s.whatsapp.net', '');
  const name = clientName || 'Sin nombre';
  try {
    await sock.sendMessage(ownerJid, {
      text:
        `🔗 Cliente envió un link\n\n` +
        `👤 ${name}\n` +
        `📞 wa.me/${clientNumber}\n` +
        `💬 "${clientMessage}"\n\n` +
        `El bot está pausado en este chat — respóndele tú directamente. Escribe "bot" ahí para reactivarlo.`,
    });
  } catch (err) {
    console.error('⚠️ No se pudo notificar el link al dueño:', err.message);
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
