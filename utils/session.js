// utils/session.js
// In-memory session store. Survives restarts if you swap for Redis later.

const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: null, data: {} });
  }
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.set(userId, { state: null, data: {} });
}

module.exports = { getSession, clearSession };
