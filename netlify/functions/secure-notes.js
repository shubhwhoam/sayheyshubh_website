const admin = require('firebase-admin');
const crypto = require('crypto');

const zoologyNotes = require('./data/notes-data.json');
const microbiologyNotes = require('./data/microbiology-notes-data.json');
const notesData = { ...zoologyNotes, ...microbiologyNotes };

if (!admin.apps.length) {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      }),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  } else {
    admin.initializeApp({ projectId: 'sayheyshubh-7051c' });
  }
}

const db = admin.firestore();

// Base URL of the Cloudflare Worker that proxies B2, e.g.
// https://sayheyshubh-notes-proxy.<your-subdomain>.workers.dev
const WORKER_URL = process.env.WORKER_URL;

// Shared secret with the Worker — used to HMAC-sign the URL so the Worker
// can trust it was issued by this function (i.e. after auth + purchase
// checks already passed), without the Worker needing to talk to Firestore
// itself.
const WORKER_SECRET = process.env.WORKER_SECRET;

// The link only needs to live long enough for pdf.js to start fetching the
// file right when the viewer opens — it's requested fresh on every open.
// Keeping this short means that if someone grabs the URL out of the
// browser's Network tab, it's only useful for a couple of minutes.
const SIGNED_URL_EXPIRY_SECONDS = 180;

// A real B2 object key never looks like a URL. This catches notes that
// haven't been migrated/uploaded to B2 yet (including leftover placeholder
// text like "YOUR_DRIVE_LINK_HERE") and fails cleanly instead of generating
// a link that will just 404 against the bucket.
function isValidB2Key(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  if (value.includes('YOUR_DRIVE_LINK_HERE')) return false;
  return true;
}

function buildWorkerUrl(storagePath) {
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRY_SECONDS;
  const sig = crypto.createHmac('sha256', WORKER_SECRET)
    .update(`${storagePath}|${exp}`)
    .digest('hex');
  const encodedKey = encodeURIComponent(storagePath);
  return `${WORKER_URL}/${encodedKey}?exp=${exp}&sig=${sig}`;
}

exports.handler = async (event, context) => {
  const pathParts = event.path.split('/');
  const noteId = pathParts[pathParts.length - 1];

  try {
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Missing token' }) };
    }
    const idToken = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const storagePath = notesData[noteId];
    if (!isValidB2Key(storagePath)) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'This note isn\'t available yet. Please check back soon.' }) };
    }

    // Security check: confirm the exact purchase record exists in Firestore
    const txSnapshot = await db.collection('transactions')
      .where('userId', '==', userId)
      .where('noteId', '==', noteId)
      .where('status', '==', 'completed')
      .where('verified', '==', true)
      .limit(1)
      .get();

    if (txSnapshot.empty) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Note not purchased' }) };
    }

    const previewUrl = buildWorkerUrl(storagePath);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        previewUrl
      })
    };
  } catch (error) {
    console.error('secure-notes error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Something went wrong loading this note. Please try again.' })
    };
  }
};
