// ==========================================
// LIBERTY MEDIA - SEGUIMIENTOS AUTOMÁTICOS
// ==========================================

import { sessionManager } from './sessions.js';
import { NO_RESPONSE_REMINDER } from './config.js';

const followUpTimers = new Map(); // jid → { timers: [], cancelled: false }

// Un único recordatorio si el lead no responde a una pregunta en 15-20 min.
// No avanza de paso, no manda link ni PDF, y no se repite si no contesta a este.
const REMINDER_DELAY = 18 * 60 * 1000; // punto medio de 15-20 min
const REMINDER_ID = 'no_response_reminder';

/**
 * Programa el único recordatorio de "sin respuesta" para un chat.
 * Se envía como máximo una vez por conversación.
 */
export function startFollowUps(sock, jid) {
  cancelFollowUps(jid);

  if (sessionManager.hasSentFollowUp(jid, REMINDER_ID)) {
    console.log(`⏭️  Recordatorio omitido (ya se envió antes en esta conversación)`);
    return;
  }

  const entry = { timers: [], cancelled: false };
  followUpTimers.set(jid, entry);

  const t = setTimeout(async () => {
    const current = followUpTimers.get(jid);
    if (!current || current.cancelled) return;
    if (sessionManager.hasSentFollowUp(jid, REMINDER_ID)) return; // seguro extra ante condiciones de carrera

    try {
      await sock.sendMessage(jid, { text: NO_RESPONSE_REMINDER });
      sessionManager.markFollowUpSent(jid, REMINDER_ID);
      console.log(`📤 Recordatorio enviado a ${jid}`);
    } catch (err) {
      console.error(`❌ Error enviando recordatorio a ${jid}:`, err.message);
    }
  }, REMINDER_DELAY);

  entry.timers.push(t);
  console.log(`⏱️  Recordatorio programado para ${jid} (${REMINDER_DELAY / 60000} min)`);
}

/**
 * Cancela todos los seguimientos pendientes para un usuario
 * (llamar cuando el usuario responde o agenda llamada)
 */
export function cancelFollowUps(jid) {
  const entry = followUpTimers.get(jid);
  if (!entry) return;

  entry.cancelled = true;
  entry.timers.forEach(clearTimeout);
  followUpTimers.delete(jid);
  console.log(`🛑 Seguimientos cancelados para ${jid}`);
}
