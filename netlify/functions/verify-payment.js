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

// Helper function to unlock note for user (idempotent - uses deterministic doc ID)
async function unlockNoteForUser(userId, paymentId, orderId, noteUrl) {
  // Use paymentId as document ID for true idempotency (Firestore prevents duplicates)
  const transactionRef = db.collection('transactions').doc(paymentId);
  
  try {
    // Use set with merge:false to create only if doesn't exist (atomic)
    await transactionRef.create({ 
      userId: userId,
      paymentId: paymentId,
      orderId: orderId,
      noteUrl: noteUrl, 
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed',
      verified: true
    });
    
    console.log('New transaction created for payment:', paymentId);
  } catch (error) {
    if (error.code === 6) { // ALREADY_EXISTS error code
      console.log('Transaction already exists for payment:', paymentId);
      return; // Already processed by webhook or frontend, skip
    }
    throw error; // Re-throw other errors
  }

  // 2. Mark note as unlocked in user's document (for backward compatibility)
  const userRef = db.collection('users').doc(userId);
  let noteSlug;
  if (noteUrl.includes('drive.google.com/file/d/')) {
    const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    noteSlug = fileIdMatch ? fileIdMatch[1] : noteUrl.split('/').pop();
  } else {
    noteSlug = noteUrl.split('/').pop();
  }

  await userRef.set({
    unlockedNotes: {
      [noteSlug]: true
    }
  }, { merge: true });

  console.log('Note unlocked permanently for user:', userId, 'noteSlug:', noteSlug);
}

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Razorpay-Signature',
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

  // Check if Razorpay credentials are configured
  if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) {
    console.error('Razorpay credentials not configured');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: 'Payment system not configured' 
      })
    };
  }

  // Determine if this is a webhook from Razorpay or a frontend request
  const isWebhook = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'];
  
  if (isWebhook) {
    // WEBHOOK HANDLER - From Razorpay servers
    try {
      const webhookSignature = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'];
      const webhookBody = event.body;
      
      // Verify webhook signature
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET)
        .update(webhookBody)
        .digest('hex');

      if (webhookSignature !== expectedSignature) {
        console.error('Webhook signature verification failed');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid webhook signature' })
        };
      }

      // Parse webhook payload
      const payload = JSON.parse(webhookBody);
      const event_type = payload.event;

      // Handle payment.captured event
      if (event_type === 'payment.captured') {
        const paymentEntity = payload.payload.payment.entity;
        const paymentId = paymentEntity.id;
        const orderId = paymentEntity.order_id;
        const amount = paymentEntity.amount;

        // Get order details from our database to find userId and noteUrl
        const orderDoc = await db.collection('orders').doc(orderId).get();

        if (!orderDoc.exists) {
          console.error('Order not found for webhook:', orderId);
          return {
            statusCode: 200, // Return 200 to acknowledge webhook
            headers,
            body: JSON.stringify({ received: true, error: 'Order not found' })
          };
        }

        const orderData = orderDoc.data();
        const userId = orderData.userId;
        const noteUrl = orderData.noteUrl;

        // Unlock the note for the user
        await unlockNoteForUser(userId, paymentId, orderId, noteUrl);

        console.log('Webhook processed successfully for user:', userId);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ received: true, status: 'success' })
        };
      }

      // Acknowledge other webhook events
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true })
      };

    } catch (error) {
      console.error('Webhook processing error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Webhook processing failed' })
      };
    }
  }

  // FRONTEND REQUEST HANDLER - From authenticated user
  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(event.headers.authorization);
    const authenticatedUserId = decodedToken.uid;

    const { paymentId, orderId, signature } = JSON.parse(event.body);

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

    if (!paymentId || !orderId || !signature) {
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

    // SECURITY: Fetch order details from database instead of trusting client
    const orderDoc = await db.collection('orders').doc(orderId).get();

    if (!orderDoc.exists) {
      console.error('Order not found:', orderId);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          success: false, 
          verified: true,
          error: 'Order not found' 
        })
      };
    }

    const orderData = orderDoc.data();
    
    // Verify the authenticated user matches the order's user
    if (orderData.userId !== authenticatedUserId) {
      console.error('User mismatch for order:', orderId);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          success: false, 
          verified: true,
          error: 'Unauthorized: Order does not belong to this user' 
        })
      };
    }

    const noteUrl = orderData.noteUrl;

    // Unlock the note for the user (using server-validated noteUrl)
    try {
      await unlockNoteForUser(authenticatedUserId, paymentId, orderId, noteUrl);
    } catch (firestoreError) {
      console.error('Error unlocking note:', firestoreError);
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