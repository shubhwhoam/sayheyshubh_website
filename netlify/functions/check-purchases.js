const notesData = require('../../notes-data.json');

const admin = require('firebase-admin');

// Initialize Firebase Admin with secure environment variables
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
    // Fallback initialization for development
    admin.initializeApp({
      projectId: 'sayheyshubh-7051c'
    });
  }
}

// Get Firestore instance
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

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(event.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    // Get user's unlocked notes from transactions (single source of truth)
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', authenticatedUserId)
      .where('status', '==', 'completed')
      .where('verified', '==', true)
      .get();

    // 1. Collect all purchased File IDs (the XYZ part of drive.google.com/file/d/XYZ)
    const purchasedFileIds = new Set();
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.noteUrl) {
         const match = data.noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
         if (match) purchasedFileIds.add(match[1]);
      }
    });

    // 2. Check which of our secure IDs correspond to these files
    const ownedIds = [];
    for (const [id, url] of Object.entries(notesData)) {
        const match = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
        if (match && purchasedFileIds.has(match[1])) {
            ownedIds.push(id);
        }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        purchasedNotes: ownedIds // Returns ['unit-1-dsc-1', etc.]
      })
    };

  } catch (error) {
    console.error('Error checking purchases:', error);
    return {
      statusCode: error.message && error.message.includes('authentication') ? 401 : 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to check purchases'
      })
    };
  }
};