// POST /.netlify/functions/drive-disconnect
const { getTokens, clearTokens } = require('./lib/drive');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const tokens = await getTokens();
    if (tokens && tokens.refreshToken) {
      // Best-effort revoke with Google so the grant doesn't linger on their
      // side either -- failure here shouldn't block clearing local tokens.
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refreshToken }),
      }).catch(() => {});
    }
    await clearTokens();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
