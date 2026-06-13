// ==========================================
// LIBERTY MEDIA - DELAY HUMANO
// Simula que Samuel está leyendo y escribiendo
// ==========================================

/**
 * Espera un tiempo aleatorio como haría una persona real.
 * Muestra "escribiendo..." en WhatsApp durante ese tiempo.
 */
export async function humanDelay(sock, jid, responseText = '') {
  // Tiempo base según largo de la respuesta (más texto = más tiempo)
  const words = responseText.split(' ').length;
  const readingTime = randomBetween(1500, 3000);       // tiempo "leyendo"
  const typingTime  = Math.min(words * 120, 6000);     // ~120ms por palabra, máx 6s
  const totalDelay  = readingTime + typingTime;

  // Pausa inicial (leyendo)
  await sleep(readingTime);

  // Mostrar "escribiendo..." en WhatsApp
  try {
    await sock.sendPresenceUpdate('composing', jid);
  } catch (_) {}

  // Tiempo escribiendo
  await sleep(typingTime);

  // Dejar de mostrar "escribiendo"
  try {
    await sock.sendPresenceUpdate('paused', jid);
  } catch (_) {}
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
