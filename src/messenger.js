// ==========================================
// LIBERTY MEDIA - FUNCIONES DE ENVÍO
// ==========================================

import { MAIN_MENU } from './config.js';

/**
 * Envía un mensaje de texto simple
 */
export async function sendMessage(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
  } catch (error) {
    console.error(`❌ Error enviando mensaje a ${jid}:`, error.message);
  }
}

/**
 * Envía el menú principal
 */
export async function sendMenu(sock, jid) {
  try {
    await sock.sendMessage(jid, { text: MAIN_MENU });
  } catch (error) {
    console.error(`❌ Error enviando menú a ${jid}:`, error.message);
  }
}

/**
 * Notifica la transferencia a agente humano
 */
export async function sendHumanHandoff(sock, jid) {
  const agentPhone = process.env.AGENT_PHONE;

  const message =
    `👤 *Transferiendo con un agente humano...*\n\n` +
    `Un miembro del equipo de *Liberty Media* te contactará en breve.\n\n` +
    `⏰ Horario de atención: Lunes a Viernes, 9am - 6pm (Lima, Perú)\n\n` +
    (agentPhone
      ? `📲 También puedes contactarnos directamente:\nhttps://wa.me/${agentPhone}\n\n`
      : '') +
    `Escribe *menú* en cualquier momento para volver al bot. 🤖`;

  await sendMessage(sock, jid, message);

  // Notificar al agente si está configurado
  if (agentPhone) {
    try {
      const agentJid = `${agentPhone}@s.whatsapp.net`;
      await sock.sendMessage(agentJid, {
        text: `🔔 *Nueva consulta en Liberty Media*\n\nEl cliente ${jid.replace('@s.whatsapp.net', '')} solicitó hablar con un agente.\n\nResponde directamente a: wa.me/${jid.replace('@s.whatsapp.net', '')}`,
      });
    } catch (err) {
      console.error('⚠️ No se pudo notificar al agente:', err.message);
    }
  }
}
