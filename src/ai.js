// ==========================================
// LIBERTY MEDIA - INTEGRACIÓN CON OPENAI
// ==========================================

import OpenAI from 'openai';
import { SYSTEM_PROMPT, CALL_SCHEDULED_PHRASES } from './config.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Obtiene respuesta de Samuel (GPT-4o-mini)
 */
export async function getAIResponse(history = [], userMessage) {
  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
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
 * Detecta si el cliente quiere agendar una llamada o ya la confirmó.
 * También se activa si la IA ya respondió con el mensaje de confirmación.
 */
export async function detectCallScheduled(userMessage) {
  const hasKeyword = CALL_SCHEDULED_PHRASES.some((phrase) =>
    userMessage.toLowerCase().includes(phrase.toLowerCase())
  );

  // Detectar número de teléfono peruano (9 dígitos empezando en 9)
  const hasPhone = /\b9\d{8}\b/.test(userMessage);

  // Frases directas de confirmación
  const directConfirm = [
    'si me puedes llamar', 'sí me puedes llamar',
    'si puedes llamarme', 'dale llámame', 'dale llamame',
    'si', 'sí', 'dale', 'ok llámame', 'ya puedes llamar',
    'perfecto llámenme', 'bueno llámenme',
  ].some((p) => userMessage.toLowerCase().trim() === p ||
                userMessage.toLowerCase().includes(p));

  if (!hasKeyword && !hasPhone && !directConfirm) return false;

  try {
    const check = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Responde SOLO "si" o "no". ¿El cliente está pidiendo o aceptando que le llamen por teléfono?',
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 5,
      temperature: 0,
    });
    const answer = check.choices[0]?.message?.content?.trim().toLowerCase();
    return answer === 'si' || answer === 'sí';
  } catch {
    return hasPhone || directConfirm;
  }
}
