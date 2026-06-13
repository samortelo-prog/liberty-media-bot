// ==========================================
// LIBERTY MEDIA - BUFFER DE MENSAJES
// ==========================================
// Solución: el buffer vive FUERA del handler.
// Cada mensaje nuevo reinicia el timer y acumula el texto.
// El handler consulta si hay resultado listo; si no, sale.
// Cuando el timer dispara, llama al callback con todo acumulado.

const buffers = new Map();
const BUFFER_DELAY = 4500; // ms de silencio antes de procesar

/**
 * Registra un fragmento en el buffer del usuario.
 * Devuelve true si este mensaje disparó el procesamiento
 * (es decir, el usuario dejó de escribir).
 * Llama a onReady(accumulatedText) cuando el timer se cumple.
 */
export function registerMessage(jid, text, onReady) {
  // Cancelar timer anterior si existía
  if (buffers.has(jid)) {
    clearTimeout(buffers.get(jid).timer);
  }

  // Acumular texto
  const prev = buffers.get(jid)?.accumulated || '';
  const accumulated = prev ? `${prev} ${text}` : text;

  const timer = setTimeout(() => {
    buffers.delete(jid);
    onReady(accumulated);
  }, BUFFER_DELAY);

  buffers.set(jid, { timer, accumulated });
}

/**
 * Cancela buffer pendiente (cuando se pausa el bot)
 */
export function clearBuffer(jid) {
  if (buffers.has(jid)) {
    clearTimeout(buffers.get(jid).timer);
    buffers.delete(jid);
  }
}
