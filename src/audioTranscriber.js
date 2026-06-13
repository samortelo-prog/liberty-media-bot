// ==========================================
// LIBERTY MEDIA - TRANSCRIPCIÓN DE AUDIOS
// Usa OpenAI Whisper para convertir voz a texto
// ==========================================

import OpenAI from 'openai';
import { writeFile, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Descarga y transcribe un mensaje de audio de WhatsApp.
 * Devuelve el texto transcrito o null si falla.
 */
export async function transcribeAudio(sock, message) {
  const tmpPath = join(tmpdir(), `audio_${Date.now()}.ogg`);

  try {
    console.log('🎙️  Descargando audio...');

    // Descargar el audio del mensaje
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      { logger: { level: 'silent', child: () => ({ level: 'silent', info: ()=>{}, warn: ()=>{}, error: ()=>{}, debug: ()=>{}, trace: ()=>{}, fatal: ()=>{} }) }, reuploadRequest: sock.updateMediaMessage }
    );

    if (!buffer || buffer.length === 0) {
      console.error('❌ Audio vacío');
      return null;
    }

    // Guardar temporalmente
    await writeFile(tmpPath, buffer);
    console.log(`🎙️  Audio guardado (${(buffer.length / 1024).toFixed(1)} KB)`);

    // Transcribir con Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: 'whisper-1',
      language: 'es',
    });

    const text = transcription.text?.trim();
    console.log(`🎙️  Transcripción: "${text}"`);
    return text || null;

  } catch (error) {
    console.error('❌ Error transcribiendo audio:', error.message);
    return null;
  } finally {
    // Limpiar archivo temporal
    try { await unlink(tmpPath); } catch (_) {}
  }
}

/**
 * Verifica si un mensaje contiene audio
 */
export function isAudioMessage(message) {
  return !!(
    message.message?.audioMessage ||
    message.message?.pttMessage  // ptt = Push To Talk (nota de voz)
  );
}
