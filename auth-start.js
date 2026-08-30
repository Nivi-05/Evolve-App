// GET /.netlify/functions/auth-start
// Redirects the browser into Google's consent screen. Kicked off by the
// "Connect Google Drive" button in Settings.
exports.handler = async (event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return { statusCode: 500, body: 'GOOGLE_CLIENT_ID is not configured on this deploy.' };
  }

  const siteUrl = `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/auth-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',   // required to receive a refresh_token
    prompt: 'consent',        // forces refresh_token on repeat connects too
    include_granted_scopes: 'true',
  });

  return {
    statusCode: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  };
};
