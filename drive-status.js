// GET /.netlify/functions/drive-status
// The frontend calls this to render Settings > Backup honestly -- it never
// receives the actual tokens, just a connected/disconnected verdict.
const { getTokens } = require('./lib/drive');

exports.handler = async () => {
  try {
    const tokens = await getTokens();
    return json200({
      connected: !!(tokens && tokens.refreshToken),
      lastBackup: (tokens && tokens.lastBackup) || null,
    });
  } catch (e) {
    return json200({ connected: false, lastBackup: null, error: e.message });
  }
};

function json200(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
