// GET /.netlify/functions/auth-callback?code=...
// This is the exact "Authorized redirect URI" registered in Google Cloud
// Console. Google sends the browser here after the user consents.
const { exchangeCodeForTokens, saveTokens, getValidAccessToken, ensureBackupFolder } = require('./lib/drive');

exports.handler = async (event) => {
  const siteUrl = `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/auth-callback`;

  const { code, error } = event.queryStringParameters || {};
  if (error) {
    return redirectHome(siteUrl, `drive=error&reason=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return redirectHome(siteUrl, 'drive=error&reason=missing_code');
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      // Happens if the user had already granted consent before and Google
      // didn't re-issue a refresh_token. prompt=consent on auth-start is
      // meant to prevent this, but we fail loudly rather than silently
      // storing a connection that can't actually refresh itself later.
      return redirectHome(siteUrl, 'drive=error&reason=no_refresh_token');
    }
    await saveTokens(tokens);

    // Create (or find) the backup folder right away so "Connected ✓" means
    // the whole pipeline actually works, not just that tokens exist.
    const accessToken = await getValidAccessToken();
    await ensureBackupFolder(accessToken);

    return redirectHome(siteUrl, 'drive=connected');
  } catch (e) {
    return redirectHome(siteUrl, `drive=error&reason=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
};

function redirectHome(siteUrl, query) {
  return { statusCode: 302, headers: { Location: `${siteUrl}/index.html?${query}` } };
}
