// ==========================================
// LIBERTY MEDIA - GESTOR DE SESIONES (SQLite)
// Persiste entre reinicios del servidor
// ==========================================

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

// Base de datos en el volumen de Railway (mismo lugar que auth_info)
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/app/auth_info/sessions.db'
  : './sessions.db';

// Asegurar que el directorio existe
try { mkdirSync('/app/auth_info', { recursive: true }); } catch (_) {}

const db = new Database(DB_PATH);

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    jid TEXT PRIMARY KEY,
    started INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'bot',
    history TEXT DEFAULT '[]',
    last_activity INTEGER DEFAULT 0
  );
`);

console.log(`💾 Base de datos iniciada: ${DB_PATH}`);

// Statements preparados para mejor rendimiento
const stmts = {
  get:    db.prepare(`SELECT * FROM sessions WHERE jid = ?`),
  insert: db.prepare(`INSERT OR IGNORE INTO sessions (jid, last_activity) VALUES (?, ?)`),
  update: db.prepare(`UPDATE sessions SET started=?, mode=?, history=?, last_activity=? WHERE jid=?`),
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
      started:      row.started === 1,
      mode:         row.mode || 'bot',
      history:      JSON.parse(row.history || '[]'),
      lastActivity: row.last_activity || Date.now(),
    };
  }

  _save(jid, session) {
    stmts.update.run(
      session.started ? 1 : 0,
      session.mode,
      JSON.stringify(session.history),
      Date.now(),
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
