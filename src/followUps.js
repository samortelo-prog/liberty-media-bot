// ==========================================
// LIBERTY MEDIA - SEGUIMIENTOS AUTOMÁTICOS
// ==========================================

const followUpTimers = new Map(); // jid → { timers: [], cancelled: false }

const FOLLOW_UPS = [
  {
    delay: 5 * 60 * 1000, // 5 minutos
    message:
      'Puede revisar algunos trabajos y reseñas en nuestra web para que pueda ver el nivel que manejamos! libertymediastudio.com/peru',
  },
  {
    delay: 15 * 60 * 1000, // 15 minutos
    message:
      'Me comenta si está disponible el día de hoy para poder hablar un poco más acerca de tu proyecto.',
  },
  {
    delay: 30 * 60 * 1000, // 30 minutos
    message:
      'Hola, tu web quedó pendiente, me comentas si aún estás interesado y si podría llamarte el día de hoy!',
  },
];

/**
 * Inicia los timers de seguimiento para un usuario.
 * portfolioSent: si ya se envió el link del portafolio, salta el seguimiento de 5 min.
 */
export function startFollowUps(sock, jid, history = []) {
  cancelFollowUps(jid);

  // Revisar si el portafolio ya fue mencionado en la conversación
  const portfolioAlreadySent = history.some(
    (msg) => msg.role === 'assistant' && msg.content?.includes('libertymediastudio.com')
  );

  const entry = { timers: [], cancelled: false };
  followUpTimers.set(jid, entry);

  for (const fu of FOLLOW_UPS) {
    // Si el portafolio ya fue enviado, saltar el seguimiento de 5 minutos
    if (fu.delay === 5 * 60 * 1000 && portfolioAlreadySent) {
      console.log(`⏭️  Seguimiento de 5 min omitido (portafolio ya enviado)`);
      continue;
    }

    const t = setTimeout(async () => {
      const current = followUpTimers.get(jid);
      if (!current || current.cancelled) return;

      try {
        await sock.sendMessage(jid, { text: fu.message });
        console.log(`📤 Seguimiento enviado a ${jid} (${fu.delay / 60000} min)`);
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
