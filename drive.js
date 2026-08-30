// Shared helper used by every Evolve Drive function. Lives in a
// subfolder (not netlify/functions/*.js directly) so Netlify doesn't
// treat it as its own endpoint -- it's imported, not deployed as a route.
const { getStore } = require('@netlify/blobs');

const TOKEN_KEY = 'tokens';
const FOLDER_NAME = 'Evolve Backup';

function tokenStore() {
  // Single-user personal app: one shared token record is intentional.
  // If this were multi-user, the store key would be per-account instead.
  return getStore('reset66-drive');
}

async function getTokens() {
  const store = tokenStore();
  const raw = await store.get(TOKEN_KEY, { type: 'json' });
  return raw || null;
}

async function saveTokens(tokens) {
  const store = tokenStore();
  await store.setJSON(TOKEN_KEY, tokens);
}

async function clearTokens() {
  const store = tokenStore();
  await store.delete(TOKEN_KEY);
}

async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('TOKEN_EXCHANGE_FAILED: ' + JSON.stringify(data));
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // only present on first consent
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('TOKEN_REFRESH_FAILED: ' + JSON.stringify(data));
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
}

// Returns a valid access token, refreshing + persisting if the cached one
// is expired or about to expire. Throws NOT_CONNECTED if nothing is stored.
async function getValidAccessToken() {
  const tokens = await getTokens();
  if (!tokens || !tokens.refreshToken) {
    const err = new Error('NOT_CONNECTED');
    throw err;
  }
  const expiringSoon = !tokens.expiresAt || tokens.expiresAt < Date.now() + 60000;
  if (!expiringSoon) return tokens.accessToken;

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const next = { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  await saveTokens(next);
  return next.accessToken;
}

async function driveFetch(accessToken, url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options && options.headers), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DRIVE_API_ERROR ${res.status}: ${text}`);
  }
  return res;
}

// Finds the Evolve Backup folder (drive.file scope only sees files this
// app created, so a stale folderId from Blobs is trusted first, with a
// search-by-name fallback in case the stored id ever goes stale).
async function ensureBackupFolder(accessToken) {
  const tokens = await getTokens();
  if (tokens && tokens.folderId) {
    const check = await fetch(
      `https://www.googleapis.com/drive/v3/files/${tokens.folderId}?fields=id,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (check.ok) {
      const data = await check.json();
      if (!data.trashed) return tokens.folderId;
    }
  }

  const searchRes = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)`,
    { method: 'GET' }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    const folderId = searchData.files[0].id;
    await saveTokens({ ...(tokens || {}), folderId });
    return folderId;
  }

  const createRes = await driveFetch(accessToken, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const created = await createRes.json();
  await saveTokens({ ...(tokens || {}), folderId: created.id });
  return created.id;
}

module.exports = {
  getTokens, saveTokens, clearTokens,
  exchangeCodeForTokens, getValidAccessToken, driveFetch, ensureBackupFolder,
};
