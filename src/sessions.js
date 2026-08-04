// ==========================================
// LIBERTY MEDIA - GESTOR DE SESIONES (SQLite)
// Persiste entre reinicios del servidor
// ==========================================

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// Base de datos en el volumen de Railway (mismo lugar que auth_info)
// Solo usamos la ruta de Railway (/app/...) si realmente existe ese volumen;
// si no (por ejemplo corriendo en local con NODE_ENV=production en .env),
// usamos una ruta local para evitar el error "directory does not exist".
const DB_PATH = (process.env.NODE_ENV === 'production' && existsSync('/app'))
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
    sent_followups TEXT DEFAULT '[]'
  );
`);

// Por si la tabla ya existía de antes sin esta columna
try { db.exec(`ALTER TABLE sessions ADD COLUMN sent_followups TEXT DEFAULT '[]'`); } catch (_) {}

console.log(`💾 Base de datos iniciada: ${DB_PATH}`);

// Statements preparados para mejor rendimiento
const stmts = {
  get:    db.prepare(`SELECT * FROM sessions WHERE jid = ?`),
  insert: db.prepare(`INSERT OR IGNORE INTO sessions (jid, last_activity) VALUES (?, ?)`),
  update: db.prepare(`UPDATE sessions SET started=?, mode=?, history=?, last_activity=?, sent_followups=? WHERE jid=?`),
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
    };
  }

  _save(jid, session) {
    stmts.update.run(
      session.started ? 1 : 0,
      session.mode,
      JSON.stringify(session.history),
      Date.now(),
      JSON.stringify(session.sentFollowUps || []),
      jid
    );
  }

  setStarted(jid) {
    const session = this.getOrCreate(jid);
    session.started = true;
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
