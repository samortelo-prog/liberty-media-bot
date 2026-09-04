// ==========================================
// LIBERTY MEDIA - SEGUIMIENTOS AUTOMÁTICOS
// ==========================================

import { sessionManager } from './sessions.js';
import { NO_RESPONSE_REMINDER } from './config.js';

const followUpTimers = new Map(); // jid → { timers: [], cancelled: false }

// Si no responde al PRIMER mensaje (el saludo inicial): dos intentos de
// reenganche, y si tampoco contesta al segundo, no se insiste más.
const FIRST_MESSAGE_FOLLOW_UPS = [
  {
    id: 'portfolio_link',
    delay: 10 * 60 * 1000, // 10 minutos
    message:
      'Te invito a que visites nuestra web para que veas información, testimonios y algunos trabajos que hemos concretado: libertymediastudio.com',
  },
  {
    id: 'ask_availability',
    delay: 20 * 60 * 1000, // 20 minutos
    message:
      'tienes un momento hoy para conversar un poco más sobre tu proyecto?',
  },
];

// Si no responde a cualquier OTRA pregunta más adelante (calificación o
// cierre): un único recordatorio genérico, sin avanzar de paso.
const GENERIC_FOLLOW_UPS = [
  {
    id: 'no_response_reminder',
    delay: 18 * 60 * 1000, // punto medio de 15-20 min
    message: NO_RESPONSE_REMINDER,
  },
];

/**
 * Programa los seguimientos de "sin respuesta" para un chat.
 * isFirstMessage=true → usa la secuencia de reenganche (portafolio + disponibilidad).
 * isFirstMessage=false → usa el recordatorio genérico único.
 * Cada seguimiento se envía como máximo una vez por conversación.
 */
export function startFollowUps(sock, jid, { isFirstMessage = false } = {}) {
  cancelFollowUps(jid);

  const sequence = isFirstMessage ? FIRST_MESSAGE_FOLLOW_UPS : GENERIC_FOLLOW_UPS;
  const entry = { timers: [], cancelled: false };
  followUpTimers.set(jid, entry);

  for (const fu of sequence) {
    if (sessionManager.hasSentFollowUp(jid, fu.id)) {
      console.log(`⏭️  Seguimiento "${fu.id}" omitido (ya se envió antes en esta conversación)`);
      continue;
    }

    const t = setTimeout(async () => {
      const current = followUpTimers.get(jid);
      if (!current || current.cancelled) return;
      if (sessionManager.hasSentFollowUp(jid, fu.id)) return; // seguro extra ante condiciones de carrera

      try {
        await sock.sendMessage(jid, { text: fu.message });
        sessionManager.markFollowUpSent(jid, fu.id);
        console.log(`📤 Seguimiento "${fu.id}" enviado a ${jid} (${fu.delay / 60000} min)`);
      } catch (err) {
        console.error(`❌ Error enviando seguimiento a ${jid}:`, err.message);
      }
    }, fu.delay);

    entry.timers.push(t);
  }

  console.log(`⏱️  Seguimientos programados para ${jid} (${isFirstMessage ? 'reenganche inicial' : 'recordatorio genérico'})`);
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
