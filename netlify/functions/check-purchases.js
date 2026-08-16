const admin = require('firebase-admin');

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
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      // If the transaction has a noteId, they own it! No Google Drive regex needed.
      if (data.noteId) {
         ownedIds.push(data.noteId);
      }
    });

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