function safeRead(storage: Storage, key: string): string | null {
  try {
    const value = storage.getItem(key);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function safeWrite(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode/quota).
  }
}

function safeRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage remove failures.
  }
}

function migrateToken(key: string): string | null {
  const sessionToken = safeRead(sessionStorage, key);
  if (sessionToken) return sessionToken;
  const legacyToken = safeRead(localStorage, key);
  if (!legacyToken) return null;
  safeWrite(sessionStorage, key, legacyToken);
  safeRemove(localStorage, key);
  return legacyToken;
}

export function getAuthToken(): string | null {
  return migrateToken("token");
}

export function setAuthToken(token: string) {
  safeWrite(sessionStorage, "token", token);
  safeRemove(localStorage, "token");
}

export function clearAuthToken() {
  safeRemove(sessionStorage, "token");
  safeRemove(localStorage, "token");
}

export function getAdminToken(): string | null {
  return migrateToken("admin-token");
}

export function setAdminToken(token: string) {
  safeWrite(sessionStorage, "admin-token", token);
  safeRemove(localStorage, "admin-token");
}

export function clearAdminToken() {
  safeRemove(sessionStorage, "admin-token");
  safeRemove(localStorage, "admin-token");
}
