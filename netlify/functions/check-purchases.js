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
    
    // Get user's unlocked notes from their user document
    const userDoc = await db.collection('users').doc(authenticatedUserId).get();
    
    const purchasedNotes = [];
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const unlockedNotes = userData.unlockedNotes || {};
      
      // Convert unlocked notes object to URLs
      // The verify-payment.js stores noteSlug as key, but we need full URLs
      // So we also check the transactions collection for the noteUrls
      const transactionsSnapshot = await db.collection('transactions')
        .where('userId', '==', authenticatedUserId)
        .where('status', '==', 'completed')
        .get();

      transactionsSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.noteUrl) {
          const noteSlug = data.noteUrl.split('/').pop();
          // Check if this note is unlocked in user's document
          if (unlockedNotes[noteSlug] === true) {
            purchasedNotes.push(data.noteUrl);
          }
        }
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        purchasedNotes: purchasedNotes
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