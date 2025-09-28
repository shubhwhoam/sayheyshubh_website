const admin = require('firebase-admin');
const crypto = require('crypto');

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
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

    const { paymentId, orderId, signature, noteUrl } = JSON.parse(event.body);

    // Check if Razorpay credentials are properly configured
    if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) {
      console.error('Razorpay credentials not configured. Payment verification failed.');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          verified: false,
          error: 'Payment system not configured properly' 
        })
      };
    }

    if (!paymentId || !orderId || !signature || !noteUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          verified: false,
          error: 'Missing required parameters' 
        })
      };
    }

    // Verify Razorpay payment signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    const isSignatureValid = generatedSignature === signature;

    if (!isSignatureValid) {
      console.error('Payment signature verification failed');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          verified: false,
          error: 'Payment verification failed' 
        })
      };
    }

    // --- START FULFILLMENT LOGIC (The Fix) ---
    try {
      // 1. Record the transaction (for history, renamed to 'transactions' for clarity)
      await db.collection('transactions').add({ 
        userId: authenticatedUserId,
        paymentId: paymentId,
        orderId: orderId,
        noteUrl: noteUrl, 
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed',
        verified: true
      });

      // 2. CRITICAL STEP: Mark the note as UNLOCKED for the user's access control
      const userRef = db.collection('users').doc(authenticatedUserId);
      // Extract proper noteSlug for Google Drive URLs
      let noteSlug;
      if (noteUrl.includes('drive.google.com/file/d/')) {
        // Extract the file ID from Google Drive URL
        const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
        noteSlug = fileIdMatch ? fileIdMatch[1] : noteUrl.split('/').pop();
      } else {
        noteSlug = noteUrl.split('/').pop();
      }

      // This merges the new unlocked note into the user's document without deleting other data
      await userRef.set({
        unlockedNotes: {
          [noteSlug]: true // Sets a flag: e.g., { 'non-chordata-protists': true }
        }
      }, { merge: true });

      console.log('Purchase recorded and note UNLOCKED successfully for user:', authenticatedUserId);

    } catch (firestoreError) {
      // Log the specific fulfillment error for debugging
      console.error('Error in Firestore Fulfillment (Notes still locked):', firestoreError);

      // Return a 500 status but clarify the verification succeeded
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          verified: true,
          error: 'Payment verified, but fulfillment failed. Please contact support.'
        })
      };
    }
    // --- END FULFILLMENT LOGIC ---

    // Final Success Response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        verified: true,
        message: 'Payment verified successfully'
      })
    };

  } catch (error) {
    // General error handling for Firebase token verification, etc.
    console.error('Payment verification error:', error);
    return {
      statusCode: error.message && error.message.includes('authentication') ? 401 : 500,
      headers,
      body: JSON.stringify({
        success: false,
        verified: false,
        error: error.message || 'Payment verification failed'
      })
    };
  }
};