// POST /.netlify/functions/drive-backup
// Body: the JSON from R66.exportAllData() (structured data only -- media
// blobs are intentionally NOT sent through this endpoint in this pass; see
// README for why and what a follow-up media-backup endpoint needs).
const { getValidAccessToken, ensureBackupFolder, driveFetch, getTokens, saveTokens } = require('./lib/drive');

const FILE_NAME = 'evolve-backup.json';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch (e) {
    if (e.message === 'NOT_CONNECTED') {
      return json(409, { ok: false, error: 'NOT_CONNECTED' });
    }
    return json(500, { ok: false, error: e.message });
  }

  try {
    const folderId = await ensureBackupFolder(accessToken);
    const tokens = await getTokens();
    const bodyText = event.body || '{}';

    let fileId = tokens && tokens.backupFileId;
    // Confirm a previously-stored file id still exists before reusing it.
    if (fileId) {
      const check = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!check.ok) fileId = null;
      else { const d = await check.json(); if (d.trashed) fileId = null; }
    }

    if (fileId) {
      // Update existing file's content.
      await driveFetch(
        accessToken,
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: bodyText }
      );
    } else {
      // Multipart create: metadata (name + parent folder) + content in one request.
      const boundary = 'evolveboundary';
      const metadata = JSON.stringify({ name: FILE_NAME, parents: [folderId] });
      const multipartBody =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${bodyText}\r\n` +
        `--${boundary}--`;

      const createRes = await driveFetch(
        accessToken,
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody }
      );
      const created = await createRes.json();
      fileId = created.id;
    }

    const lastBackup = Date.now();
    await saveTokens({ ...(tokens || {}), backupFileId: fileId, lastBackup });

    return json(200, { ok: true, lastBackup });
  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
