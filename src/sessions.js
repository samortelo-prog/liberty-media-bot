// ==========================================
// LIBERTY MEDIA - GESTOR DE SESIONES (SQLite)
// Persiste entre reinicios del servidor
// ==========================================

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// Base de datos en el volumen de Railway (mismo lugar que auth_info).
// Antes esto dependía de NODE_ENV === 'production', pero esa variable no
// siempre está seteada en Railway — si no lo está, la base de datos caía en
// el filesystem efímero del contenedor y se perdía TODO el estado (modo
// pausado, seguimientos ya enviados, historial) en cada redeploy. Ahora se
// detecta directamente si existe la carpeta del volumen (auth_info), sin
// depender de ninguna variable de entorno.
const DB_PATH = existsSync('/app/auth_info')
  ? '/app/auth_info/sessions.db'
  : './sessions.db';

// Asegurar que el directorio existe
try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch (_) {}

const db = new Database(DB_PATH);

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    jid TEXT PRIMARY KEY,
    started INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'bot',
    history TEXT DEFAULT '[]',
    last_activity INTEGER DEFAULT 0,
    sent_followups TEXT DEFAULT '[]',
    excluded INTEGER DEFAULT 0,
    step INTEGER DEFAULT 0
  );
`);

// Por si la tabla ya existía de antes sin estas columnas
try { db.exec(`ALTER TABLE sessions ADD COLUMN sent_followups TEXT DEFAULT '[]'`); } catch (_) {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN excluded INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN step INTEGER DEFAULT 0`); } catch (_) {}

// Tabla chica de "meta" (clave-valor) para flags únicos de esta base de
// datos en particular — por ejemplo, si ya se hizo la exclusión automática
// de chats existentes al vincular. A propósito NO usamos un archivo dentro
// de auth_info para esto: esa carpeta se empaqueta y sube a Railway como
// AUTH_INFO_B64, así que un marcador ahí viajaría con la sesión y Railway
// pensaría que el trabajo ya se hizo sin haberlo hecho de verdad ahí. La
// base de datos, en cambio, es independiente entre tu Mac y Railway.
db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
const metaStmts = {
  get: db.prepare(`SELECT value FROM meta WHERE key = ?`),
  set: db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
};

console.log(`💾 Base de datos iniciada: ${DB_PATH}`);

// Statements preparados para mejor rendimiento
const stmts = {
  get:    db.prepare(`SELECT * FROM sessions WHERE jid = ?`),
  insert: db.prepare(`INSERT OR IGNORE INTO sessions (jid, last_activity) VALUES (?, ?)`),
  update: db.prepare(`UPDATE sessions SET started=?, mode=?, history=?, last_activity=?, sent_followups=?, excluded=?, step=? WHERE jid=?`),
  delete: db.prepare(`DELETE FROM sessions WHERE last_activity < ?`),
};

class SessionManager {
  getOrCreate(jid) {
    stmts.insert.run(jid, Date.now());
    const row = stmts.get.get(jid);
    const session = this._rowToSession(row);
    this._save(jid, session);
    return session;
  }

  _rowToSession(row) {
    return {
      started:       row.started === 1,
      mode:          row.mode || 'bot',
      history:       JSON.parse(row.history || '[]'),
      lastActivity:  row.last_activity || Date.now(),
      sentFollowUps: JSON.parse(row.sent_followups || '[]'),
      excluded:      row.excluded === 1,
      step:          row.step || 0,
    };
  }

  _save(jid, session) {
    stmts.update.run(
      session.started ? 1 : 0,
      session.mode,
      JSON.stringify(session.history),
      Date.now(),
      JSON.stringify(session.sentFollowUps || []),
      session.excluded ? 1 : 0,
      session.step || 0,
      jid
    );
  }

  setStarted(jid) {
    const session = this.getOrCreate(jid);
    session.started = true;
    this._save(jid, session);
  }

  // Paso del flujo fijo en el que está el chat: 0 = todavía no se le mandó el
  // saludo, 1 = ya recibió el saludo (falta la pregunta de calificación), 2 =
  // ya recibió la pregunta de calificación (falta el cierre), 3 = ya recibió
  // el cierre (de ahí en adelante todo es conversación libre con la IA).
  // Se avanza SOLO cuando de verdad se manda el mensaje fijo de ese paso —
  // si el cliente pregunta algo puntual en el medio, se responde esa
  // pregunta sin avanzar de paso, así no se salta el flujo por eso.
  getStep(jid) {
    return this.getOrCreate(jid).step || 0;
  }

  setStep(jid, step) {
    const session = this.getOrCreate(jid);
    session.step = step;
    this._save(jid, session);
  }

  setMode(jid, mode) {
    const session = this.getOrCreate(jid);
    session.mode = mode;
    this._save(jid, session);
    console.log(`💾 Modo guardado: ${jid} → ${mode}`);
  }

  getMode(jid) {
    return this.getOrCreate(jid).mode;
  }

  // Marca un chat como excluido para siempre: el bot nunca vuelve a
  // escribirle ni a responderle, ni siquiera con la palabra "bot". Se usa
  // para clientes existentes / conversaciones personales donde Sam le
  // escribió primero, antes de que el bot interactuara con ese número.
  setExcluded(jid, excluded = true) {
    const session = this.getOrCreate(jid);
    session.excluded = excluded;
    this._save(jid, session);
    console.log(`🚫 ${jid} → excluido=${excluded}`);
  }

  isExcluded(jid) {
    return this.getOrCreate(jid).excluded === true;
  }

  // Flag de "ya se hizo la exclusión automática de chats existentes en este
  // vinculado" — ver comentario arriba de por qué vive en la base de datos.
  isBaselineExcludeDone() {
    return metaStmts.get.get('baseline_excluded_done')?.value === '1';
  }

  setBaselineExcludeDone() {
    metaStmts.set.run('baseline_excluded_done', '1');
  }

  addMessage(jid, role, content) {
    const session = this.getOrCreate(jid);
    session.history.push({ role, content });
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }
    this._save(jid, session);
  }

  getHistory(jid) {
    return this.getOrCreate(jid).history;
  }

  hasSentFollowUp(jid, id) {
    return this.getOrCreate(jid).sentFollowUps.includes(id);
  }

  markFollowUpSent(jid, id) {
    const session = this.getOrCreate(jid);
    if (!session.sentFollowUps.includes(id)) {
      session.sentFollowUps.push(id);
      this._save(jid, session);
    }
  }

  cleanup() {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 días
    const result = stmts.delete.run(cutoff);
    if (result.changes > 0) {
      console.log(`🧹 ${result.changes} sesiones antiguas eliminadas`);
    }
  }
}

export const sessionManager = new SessionManager();

// Limpiar sesiones viejas cada 24 horas
setInterval(() => sessionManager.cleanup(), 24 * 60 * 60 * 1000);
