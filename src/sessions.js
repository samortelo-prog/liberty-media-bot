// ==========================================
// LIBERTY MEDIA - GESTOR DE SESIONES
// ==========================================

const SESSION_TTL = 60 * 60 * 1000; // 1 hora de inactividad

class SessionManager {
  constructor() {
    this.sessions = new Map();
    setInterval(() => this.cleanup(), 15 * 60 * 1000);
  }

  getOrCreate(jid) {
    if (!this.sessions.has(jid)) {
      this.sessions.set(jid, this.createSession());
      console.log(`📋 Nueva sesión: ${jid}`);
    }
    const session = this.sessions.get(jid);
    session.lastActivity = Date.now();
    return session;
  }

  createSession() {
    return {
      started: false,
      mode: 'bot',       // 'bot' | 'paused' | 'call_scheduled'
      history: [],
      lastActivity: Date.now(),
    };
  }

  setStarted(jid) {
    this.getOrCreate(jid).started = true;
  }

  setMode(jid, mode) {
    this.getOrCreate(jid).mode = mode;
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
  }

  getHistory(jid) {
    return this.getOrCreate(jid).history;
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [jid, session] of this.sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL) {
        this.sessions.delete(jid);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`🧹 ${cleaned} sesiones limpiadas`);
  }
}

export const sessionManager = new SessionManager();
