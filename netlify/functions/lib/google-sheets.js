const crypto = require('crypto');

// Appends a row to a Google Sheet using the same Firebase service account
// already configured for Firestore (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).
// Requires: the Sheets API enabled on that same GCP project, and the target
// spreadsheet shared with the service account's email (Editor access).
// No extra npm dependency — this signs its own OAuth2 JWT with Node's built-in crypto.

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) {
    return cachedToken.token;
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY for Sheets auth');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSeconds + 3600,
    iat: nowSeconds
  };

  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedJwt = `${base64url(header)}.${base64url(claims)}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  const signature = signer.sign(privateKey, 'base64url');
  const signedJwt = `${unsignedJwt}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error('Failed to get Sheets access token: ' + JSON.stringify(data));
  }

  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) };
  return cachedToken.token;
}

// Appends one row to the given tab (e.g. "Purchases" or "Tips") of the given spreadsheet.
// rowValues is a flat array, e.g. ['9 Aug 2026', 'Priya Sharma', 'priya@gmail.com', ...]
async function appendRow(spreadsheetId, tabName, rowValues) {
  if (!spreadsheetId) {
    console.log('GOOGLE_SHEET_ID not configured — skipping sheet append');
    return;
  }

  const accessToken = await getAccessToken();
  const range = encodeURIComponent(`${tabName}!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [rowValues] })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Sheets append failed (${response.status}): ${errText}`);
  }
}

module.exports = { appendRow };
