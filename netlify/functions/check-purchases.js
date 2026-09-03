const admin = require('firebase-admin');
// Legacy Google Drive fileId -> current noteId map, built from the repo's git
// history of notes-data.json (every version before the Backblaze B2 migration
// on 2026-08-15). Needed to recognize purchases made before the cart feature
// (pre 2026-08-09), whose transaction docs never got a `noteId` field — only
// the old Drive `noteUrl`.
const legacyFileIdToNoteId = require('./data/legacy-fileid-map.json');

// Initialize Firebase Admin
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

// Authentication helper
async function verifyFirebaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }
  const idToken = authHeader.substring(7);
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Invalid authentication token');
  }
}

// Best-effort recovery for pre-cart-feature transactions that only have a
// noteUrl (Drive link or short.gy link) and no noteId field at all.
function deriveLegacyNoteId(noteUrl) {
  if (!noteUrl) return null;
  const driveMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
  if (driveMatch && legacyFileIdToNoteId[driveMatch[1]]) {
    return legacyFileIdToNoteId[driveMatch[1]];
  }
  return null;
}

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const decodedToken = await verifyFirebaseToken(event.headers.authorization);
    const authenticatedUserId = decodedToken.uid;

    // Get user's unlocked notes from transactions (single source of truth)
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', authenticatedUserId)
      .where('status', '==', 'completed')
      .where('verified', '==', true)
      .get();

    // Collect the clean note IDs (e.g., 'unit-1-dsc-5')
    const ownedIds = [];
    const unresolvedLegacyDocs = [];
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.noteId) {
        // Modern transaction (cart feature onward) - already has the clean ID.
        ownedIds.push(data.noteId);
        return;
      }
      // Legacy transaction from before the cart feature - fall back to
      // deriving the note ID from the old Drive noteUrl so these purchases
      // don't silently disappear.
      const legacyId = deriveLegacyNoteId(data.noteUrl);
      if (legacyId) {
        ownedIds.push(legacyId);
      } else {
        unresolvedLegacyDocs.push(doc.id);
      }
    });

    if (unresolvedLegacyDocs.length > 0) {
      // Doesn't fail the request - just makes it easy to spot in logs which
      // transaction docs still need a manual look (e.g. run the backfill
      // script, or the noteUrl format is one we don't recognize yet).
      console.warn('check-purchases: could not resolve noteId for legacy transactions', unresolvedLegacyDocs);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        purchasedNotes: ownedIds
      })
    };
  } catch (error) {
    console.error('Error checking purchases:', error);
    return {
      statusCode: error.message && error.message.includes('authentication') ? 401 : 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message || 'Failed to check purchases' })
    };
  }
};
