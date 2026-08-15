const admin = require('firebase-admin');
const crypto = require('crypto');
const { appendRow } = require('./lib/google-sheets');
const { notify } = require('./lib/telegram');

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
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Invalid authentication token');
  }
}

// Unlocks every item in the cart for a user.
async function unlockCartForUser(userId, paymentId, orderId, items, subject) {
  const unlockedSlugs = {};

  for (const item of items) {
    // Use the clean frontend ID (e.g., 'unit-1-dsc-5') instead of trying to parse a URL
    const noteSlug = item.noteId; 
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
  await userRef.set({ unlockedNotes: unlockedSlugs }, { merge: true });
  console.log('Notes unlocked for user:', userId, 'slugs:', Object.keys(unlockedSlugs));
}

// Records a tip
async function recordTipIfAny(userId, userName, userEmail, paymentId, orderId, subject, tipAmountPaise, tipMessage) {
  if (!tipAmountPaise && !tipMessage) return false;
  const tipRef = db.collection('tips').doc(paymentId);
  try {
    await tipRef.create({
      userId: userId,
      userName: userName || '',
      userEmail: userEmail || '',
      amount: tipAmountPaise || 0,
      message: tipMessage || '',
      subject: subject || 'unknown',
      orderId: orderId,
      paymentId: paymentId,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (error) {
    if (error.code === 6) return false;
    throw error;
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function logOrderExternally(orderData, paymentId, orderId) {
  const tipAmountPaise = orderData.tipAmount || 0;
  const tipMessage = orderData.tipMessage || '';
  if (!tipAmountPaise && !tipMessage) return; 

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const dateStr = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const buyerName = orderData.userName || 'Unknown';
  const buyerEmail = orderData.userEmail || '';
  const items = orderData.items || [];

  if (sheetId) {
    await appendRow(sheetId, 'Tips', [dateStr, buyerName, buyerEmail, (tipAmountPaise / 100).toFixed(2), tipMessage, paymentId, orderId]);
  }

  const unitLines = items.map(it => `- ${escapeHtml(it.noteTitle)} ₹${it.price}`).join('\n');
  let message = `🔔 <b>New tip!</b>\n👤 ${escapeHtml(buyerName)} (${escapeHtml(buyerEmail)})\n💰 ₹${(tipAmountPaise / 100).toFixed(2)}`;
  if (tipMessage) message += `\n💬 "${escapeHtml(tipMessage)}"`;
  if (items.length > 0) message += `\n\n📚 Also unlocked ${items.length} unit${items.length > 1 ? 's' : ''} in ${escapeHtml(orderData.subject || 'unknown')}:\n${unitLines}`;
  message += `\n⏰ ${dateStr}`;
  await notify(message);
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Razorpay-Signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Payment system not configured' }) };
  }

  const isWebhook = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'];
  if (isWebhook) {
    try {
      const webhookSignature = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'];
      const webhookBody = event.body;
      const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET).update(webhookBody).digest('hex');

      if (webhookSignature !== expectedSignature) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid webhook signature' }) };

      const payload = JSON.parse(webhookBody);
      if (payload.event === 'payment.captured') {
        const paymentEntity = payload.payload.payment.entity;
        const paymentId = paymentEntity.id;
        const orderId = paymentEntity.order_id;

        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists) return { statusCode: 200, headers, body: JSON.stringify({ received: true, error: 'Order not found' }) };

        const orderData = orderDoc.data();
        await unlockCartForUser(orderData.userId, paymentId, orderId, orderData.items || [], orderData.subject);
        const isNewTip = await recordTipIfAny(orderData.userId, orderData.userName, orderData.userEmail, paymentId, orderId, orderData.subject, orderData.tipAmount, orderData.tipMessage);

        if (isNewTip) {
          try { await logOrderExternally(orderData, paymentId, orderId); } 
          catch (e) { console.error('Logging failed:', e); }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ received: true, status: 'success' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Webhook processing failed' }) };
    }
  }

  // FRONTEND REQUEST HANDLER
  try {
    const decodedToken = await verifyFirebaseToken(event.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    const { paymentId, orderId, signature } = JSON.parse(event.body);

    if (!paymentId || !orderId || !signature) return { statusCode: 400, headers, body: JSON.stringify({ success: false, verified: false, error: 'Missing parameters' }) };

    const generatedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(orderId + '|' + paymentId).digest('hex');
    if (generatedSignature !== signature) return { statusCode: 400, headers, body: JSON.stringify({ success: false, verified: false, error: 'Payment verification failed' }) };

    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return { statusCode: 404, headers, body: JSON.stringify({ success: false, verified: true, error: 'Order not found' }) };

    const orderData = orderDoc.data();
    if (orderData.userId !== authenticatedUserId) return { statusCode: 403, headers, body: JSON.stringify({ success: false, verified: true, error: 'Unauthorized' }) };

    const items = orderData.items || [];
    try {
      await unlockCartForUser(authenticatedUserId, paymentId, orderId, items, orderData.subject);
      const isNewTip = await recordTipIfAny(authenticatedUserId, orderData.userName, orderData.userEmail, paymentId, orderId, orderData.subject, orderData.tipAmount, orderData.tipMessage);
      if (isNewTip) {
        try { await logOrderExternally(orderData, paymentId, orderId); } 
        catch (e) { console.error('Logging failed:', e); }
      }
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, verified: true, error: 'Payment verified, but fulfillment failed.' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        verified: true,
        unlockedCount: items.length,
        unlockedNoteIds: items.map(it => it.noteId),
        tipAmount: orderData.tipAmount || 0,
        message: 'Payment verified successfully'
      })
    };
  } catch (error) {
    return { statusCode: error.message && error.message.includes('authentication') ? 401 : 500, headers, body: JSON.stringify({ success: false, verified: false, error: error.message }) };
  }
};