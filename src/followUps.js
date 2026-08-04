// ==========================================
// LIBERTY MEDIA - SEGUIMIENTOS AUTOMÁTICOS
// ==========================================

import { sessionManager } from './sessions.js';

const followUpTimers = new Map(); // jid → { timers: [], cancelled: false }

const FOLLOW_UPS = [
  {
    id: 'portfolio_link',
    delay: 5 * 60 * 1000, // 5 minutos
    type: 'text',
    message:
      'Te invito a que visites nuestra web para que veas información, testimonios y algunos trabajos que hemos concretado: libertymediastudio.com',
  },
  {
    id: 'ask_availability',
    delay: 15 * 60 * 1000, // 15 minutos
    type: 'text',
    message:
      'tienes un momento hoy para conversar un poco más sobre tu proyecto?',
  },
  {
    id: 'still_interested',
    delay: 90 * 60 * 1000, // 1 hora y media
    type: 'text',
    message:
      'sigues interesado en avanzar con tu web? avísame si te puedo llamar hoy',
  },
];

/**
 * Inicia los timers de seguimiento para un usuario.
 * Cada seguimiento se envía como máximo una vez por conversación
 * (se recuerda en sessionManager, no depende de que el timer llegue a cumplirse).
 */
export function startFollowUps(sock, jid, history = []) {
  cancelFollowUps(jid);

  // El link del portafolio puede haberlo dado Samuel también en la conversación normal,
  // no solo por seguimiento automático — en ese caso tampoco lo repetimos.
  const portfolioAlreadySent = history.some(
    (msg) => msg.role === 'assistant' && msg.content?.includes('libertymediastudio.com')
  );

  const entry = { timers: [], cancelled: false };
  followUpTimers.set(jid, entry);

  for (const fu of FOLLOW_UPS) {
    if (sessionManager.hasSentFollowUp(jid, fu.id)) {
      console.log(`⏭️  Seguimiento "${fu.id}" omitido (ya se envió antes en esta conversación)`);
      continue;
    }
    if (fu.id === 'portfolio_link' && portfolioAlreadySent) {
      sessionManager.markFollowUpSent(jid, fu.id);
      console.log(`⏭️  Seguimiento "${fu.id}" omitido (el link ya se mencionó en la conversación)`);
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

  console.log(`⏱️  Seguimientos programados para ${jid}`);
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
