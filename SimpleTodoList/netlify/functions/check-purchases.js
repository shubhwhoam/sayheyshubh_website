const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  if (serviceAccount.project_id) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  } else {
    // Fallback initialization
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
    
    // Get purchased notes for the authenticated user
    const purchasesSnapshot = await db.collection('purchases')
      .where('userId', '==', authenticatedUserId)
      .where('status', '==', 'completed')
      .get();

    const purchasedNotes = [];
    purchasesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.noteUrl) {
        purchasedNotes.push(data.noteUrl);
      }
    });

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
      statusCode: error.message.includes('authentication') ? 401 : 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to check purchases'
      })
    };
  }
};