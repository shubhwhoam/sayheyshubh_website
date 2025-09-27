const admin = require('firebase-admin');
const Razorpay = require('razorpay');

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

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

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
    
    const { amount, noteTitle } = JSON.parse(event.body);
    
    // Basic validation
    if (!amount || !noteTitle) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required parameters' })
      };
    }
    
    if (!amount || amount < 500 || amount > 5000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid amount. Must be between ₹5 and ₹50' })
      };
    }

    // Sanitize note title for security
    const sanitizedNoteTitle = noteTitle.substring(0, 100);

    // Create Razorpay order
    const options = {
      amount: amount, // amount in smallest currency unit (paise)
      currency: 'INR',
      receipt: `receipt_${authenticatedUserId}_${Date.now()}`,
      notes: {
        noteTitle: sanitizedNoteTitle,
        userId: authenticatedUserId,
        timestamp: new Date().toISOString()
      }
    };

    const order = await razorpay.orders.create(options);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: process.env.RAZORPAY_KEY_ID
      })
    };
  } catch (error) {
    console.error('Order creation error:', error);
    return {
      statusCode: error.message.includes('authentication') ? 401 : 400,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to create order' 
      })
    };
  }
};