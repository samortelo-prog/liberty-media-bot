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
 * Clasifica el mensaje del cliente en uno de cuatro tipos, en una sola
 * llamada a la IA (para no multiplicar latencia/costo):
 *
 * - "llamada": pide que lo llamen, pregunta si puede agendar una cita/llamada,
 *   da su número, pregunta cómo contactar directo, o muestra prisa. Esta es
 *   la "regla de prioridad absoluta" del negocio.
 * - "inusual": el cliente se explaya de más, cuenta algo largo y detallado
 *   que no se le pidió, se queja, pregunta algo totalmente fuera de tema, o
 *   en general no es una respuesta puntual a lo que se le preguntó ni algo
 *   relacionado a agendar. Se pausa el chat y se le avisa a Sam.
 * - "pregunta": el cliente pregunta algo puntual (portafolio/ejemplos,
 *   precio, funcionalidades, tiempos, etc.) en vez de (o además de) contestar
 *   lo que se le preguntó. En estos casos la IA responde con las reglas del
 *   SYSTEM_PROMPT, en vez de mandar el texto fijo del paso del flujo — así no
 *   se ignora la pregunta real de la persona.
 * - "normal": una respuesta directa a lo que se le preguntó, o un saludo /
 *   apertura genérica sin pregunta puntual.
 */
export async function classifyMessage(userMessage) {
  // Número de teléfono peruano (9 dígitos empezando en 9): señal inequívoca
  // de intención de llamada, no hace falta ni preguntarle a la IA.
  if (/\b9\d{8}\b/.test(userMessage)) return { callIntent: true, unusual: false, isQuestion: false };

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
            'Eres un clasificador para mensajes de clientes en una conversación de ventas de páginas web por WhatsApp. Responde SOLO con una palabra: "llamada", "inusual", "pregunta", o "normal".\n' +
            '"llamada": el cliente pide que lo llamen, pregunta si puede agendar/coordinar/programar una cita o llamada, dice que él puede llamar, pregunta cómo contactar directo, da su número de teléfono, o muestra prisa (está ocupado, manejando, etc).\n' +
            '"inusual": el cliente se explaya mucho de más, cuenta algo largo y detallado sobre su negocio o situación sin que se le haya pedido, se queja, pregunta algo totalmente fuera de tema (no relacionado a su web ni al negocio), o en general no es simplemente una respuesta puntual a lo que se le preguntó ni algo relacionado a agendar.\n' +
            '"pregunta": el cliente pregunta algo CONCRETO y ESPECÍFICO sobre el servicio — pide ver el portafolio/ejemplos de trabajos, pregunta el precio o cuánto cuesta, pregunta por una funcionalidad puntual, tiempos de entrega exactos, o qué incluye exactamente. NO clasifiques como "pregunta" una apertura genérica de anuncio como "quiero más información", "más info por favor", "cuéntame más", "hola, me interesa" — esas van en "normal", porque no piden nada específico, solo abren la conversación.\n' +
            '"normal": una respuesta directa a la pregunta hecha (corta o algo más larga, mientras sea sobre lo que se le preguntó), o un saludo/apertura genérica sin pedir algo puntual (incluye "quiero información", "más info", "me interesa", etc.).',
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 5,
      temperature: 0,
    });
    const answer = check.choices[0]?.message?.content?.trim().toLowerCase().replace(/["']/g, '');
    return {
      callIntent: answer === 'llamada',
      unusual: answer === 'inusual',
      isQuestion: answer === 'pregunta',
    };
  } catch {
    // Si falla la IA, al menos nos quedamos con el chequeo de palabras clave
    // para intención de llamada. Para "inusual"/"pregunta" no hay fallback —
    // mejor no pausar ni desviar de más si la IA no responde.
    return { callIntent: hasKeyword, unusual: false, isQuestion: false };
  }
}
