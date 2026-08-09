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

// Given a note's real URL, derive the same "slug" secure-notes.js checks against
function slugFromNoteUrl(noteUrl) {
  if (noteUrl.includes('drive.google.com')) {
    const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    return fileIdMatch ? fileIdMatch[1] : noteUrl.split('/').pop();
  } else if (noteUrl.includes('short.gy')) {
    const shortMatch = noteUrl.match(/short\.gy\/([a-zA-Z0-9-_]+)/);
    return shortMatch ? shortMatch[1] : noteUrl.split('/').pop();
  }
  return noteUrl.split('/').pop();
}

// Unlocks every item in the cart for a user, from a single verified payment.
// Idempotent per item: re-running this for the same paymentId+item is a no-op.
async function unlockCartForUser(userId, paymentId, orderId, items, subject) {
  const unlockedSlugs = {};

  // Create one transaction doc per item (deterministic ID -> idempotent per item).
  // These are independent writes on purpose: if one item was already recorded by
  // a prior partial run (e.g. webhook + frontend both firing), the others must
  // still go through rather than the whole batch failing.
  for (const item of items) {
    const noteSlug = slugFromNoteUrl(item.noteUrl);
    const transactionRef = db.collection('transactions').doc(`${paymentId}_${noteSlug}`);

    try {
      await transactionRef.create({
        userId: userId,
        paymentId: paymentId,
        orderId: orderId,
        noteUrl: item.noteUrl,
        noteId: item.noteId,
        noteTitle: item.noteTitle,
        price: item.price,
        subject: subject || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed',
        verified: true
      });
      console.log('New transaction created:', paymentId, noteSlug);
    } catch (error) {
      if (error.code === 6) { // ALREADY_EXISTS
        console.log('Transaction already exists, skipping:', paymentId, noteSlug);
      } else {
        throw error;
      }
    }

    unlockedSlugs[noteSlug] = true;
  }

  // Single atomic merge write unlocking every note in the cart at once.
  const userRef = db.collection('users').doc(userId);
  await userRef.set({
    unlockedNotes: unlockedSlugs
  }, { merge: true });

  console.log('Notes unlocked for user:', userId, 'slugs:', Object.keys(unlockedSlugs));
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

        // Get order details from our database to find userId and the cart
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
        const items = orderData.items || [];
        const subject = orderData.subject;

        // Unlock every note in the cart for the user
        await unlockCartForUser(userId, paymentId, orderId, items, subject);

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

    // SECURITY: Fetch order details (and the cart) from database instead of trusting client
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

    const items = orderData.items || [];
    const subject = orderData.subject;

    // Unlock every note in the cart (using server-validated items)
    try {
      await unlockCartForUser(authenticatedUserId, paymentId, orderId, items, subject);
    } catch (firestoreError) {
      console.error('Error unlocking notes:', firestoreError);
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
        unlockedCount: items.length,
        unlockedNoteIds: items.map(it => it.noteId),
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
