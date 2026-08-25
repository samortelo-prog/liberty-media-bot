// ==========================================
// LIBERTY MEDIA - DELAY HUMANO
// Simula que Samuel está leyendo y escribiendo
// ==========================================

/**
 * Espera un tiempo aleatorio como haría una persona real.
 * Muestra "escribiendo..." en WhatsApp durante ese tiempo.
 */
const MIN_DELAY = 120000; // piso: nunca responde antes de 2 minutos, para sonar humano
const MAX_EXTRA = 20000; // variación aleatoria arriba del piso

export async function humanDelay(sock, jid, responseText = '') {
  // Tiempo total nunca baja de 30s; mensajes largos y variación aleatoria lo alargan más
  const words = responseText.split(' ').length;
  const extraByLength = Math.min(words * 150, 15000); // hasta 15s extra si el mensaje es largo
  const randomExtra = randomBetween(0, MAX_EXTRA);
  const totalDelay = MIN_DELAY + extraByLength + randomExtra;

  // Tiempo mostrando "escribiendo..." al final (para que se vea natural en WhatsApp)
  const typingTime = Math.min(3000 + words * 100, 8000);
  const silentTime = Math.max(totalDelay - typingTime, 0);

  // Pausa inicial silenciosa (leyendo)
  await sleep(silentTime);

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
