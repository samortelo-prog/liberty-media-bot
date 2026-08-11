// ==========================================
// LIBERTY MEDIA - INTEGRACIÓN CON OPENAI
// ==========================================

import OpenAI from 'openai';
import { SYSTEM_PROMPT, CALL_SCHEDULED_PHRASES } from './config.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Obtiene respuesta de Samuel (GPT-4o-mini)
 */
function getPeruNow() {
  const now = new Date();
  const fecha = now.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
  const hora = now.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: true });
  return `${fecha}, ${hora}`;
}

export async function getAIResponse(history = [], userMessage) {
  try {
    const horaActual = getPeruNow();
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `Hora actual real en Perú: ${horaActual}. Úsala para decidir si ofreces llamar hoy o al día siguiente, según la regla de horario de atención.` },
      ...history.slice(-12),
      { role: 'user', content: userMessage },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 200,
      temperature: 0.6,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) throw new Error('Respuesta vacía');

    console.log(`🤖 Samuel: "${response.substring(0, 70)}..."`);
    return response;

  } catch (error) {
    console.error('❌ OpenAI error:', error.message);

    if (error.status === 429)
      return 'Estoy recibiendo muchas consultas, dame un momento por favor :)';
    if (error.status === 401)
      return 'Hay un problema técnico, por favor intenta en unos minutos.';

    return 'Perdona, tuve un inconveniente. ¿Puedes repetir tu pregunta?';
  }
}

/**
 * Detecta si el cliente muestra intención de llamada/cita: pide que lo llamen,
 * pregunta si puede agendar, da su número, pregunta cómo contactar directo, o
 * muestra prisa. Esta es la "regla de prioridad absoluta" del negocio, así que
 * SIEMPRE se verifica con el clasificador de IA — no solo con palabras clave,
 * porque frases como "¿puedo agendar una cita?" o "¿podemos coordinar una
 * llamada?" no calzan con una lista fija de keywords y se estaban colando sin
 * detectar.
 */
export async function detectCallScheduled(userMessage) {
  // Número de teléfono peruano (9 dígitos empezando en 9): señal inequívoca,
  // no hace falta ni preguntarle a la IA.
  if (/\b9\d{8}\b/.test(userMessage)) return true;

  const hasKeyword = CALL_SCHEDULED_PHRASES.some((phrase) =>
    userMessage.toLowerCase().includes(phrase.toLowerCase())
  );

  try {
    const check = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Responde SOLO "si" o "no". ¿El cliente está mostrando intención de que lo llamen o de agendar una llamada/cita? ' +
            'Cuenta como "si" cualquiera de estos casos: pide que lo llamen, pregunta si puede agendar/coordinar/programar una cita o llamada, ' +
            'dice que él puede llamar, pregunta cómo contactar directo, da su número de teléfono, o muestra prisa (está ocupado, manejando, etc). ' +
            'Si solo está preguntando por precios, servicios, o dando información de su negocio sin relación a coordinar contacto, responde "no".',
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 5,
      temperature: 0,
    });
    const answer = check.choices[0]?.message?.content?.trim().toLowerCase();
    return answer === 'si' || answer === 'sí';
  } catch {
    // Si falla la IA, al menos nos quedamos con el chequeo de palabras clave.
    return hasKeyword;
  }
}
