const admin = require('firebase-admin');
const crypto = require('crypto');

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

    // Save purchase record to Firestore
    try {
      await db.collection('purchases').add({
        userId: authenticatedUserId,
        paymentId: paymentId,
        orderId: orderId,
        noteUrl: noteUrl,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed',
        verified: true
      });
      
      console.log('Purchase recorded successfully for user:', authenticatedUserId);
    } catch (firestoreError) {
      console.error('Error saving purchase to Firestore:', firestoreError);
      // Continue with success response since payment was verified
    }

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
    console.error('Payment verification error:', error);
    return {
      statusCode: error.message.includes('authentication') ? 401 : 500,
      headers,
      body: JSON.stringify({
        success: false,
        verified: false,
        error: error.message || 'Payment verification failed'
      })
    };
  }
};