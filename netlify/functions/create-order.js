const zoologyNotes = require('../../notes-data.json');
const microbiologyNotes = require('../../microbiology-notes-data.json');

// Combine both datasets into one master list
const notesData = { ...zoologyNotes, ...microbiologyNotes };

const admin = require('firebase-admin');
const Razorpay = require('razorpay');

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

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// --- Cart constraints ---
const MIN_PRICE_RUPEES = 10;   // per-unit floor
const MAX_PRICE_RUPEES = 100;  // per-unit ceiling
const MAX_ITEMS_PER_ORDER = 20; // sanity cap so one order can't balloon indefinitely

// --- Tip constraints ---
const MIN_TIP_RUPEES = 5;
const MAX_TIP_RUPEES = 500;
const MAX_TIP_MESSAGE_LENGTH = 300;

// --- Payment gateway fee pass-through ---
// Razorpay deducts a transaction fee, then GST on top of that fee, before settling
// to the bank. To make sure the creator actually nets the price shown on the site
// (e.g. a ₹20 unit settles as ₹20, not ₹19.52), we gross up what the buyer pays by
// exactly enough to cover that deduction. Rates below are based on this account's
// observed UPI settlement (2% fee + 18% GST on the fee ≈ 2.36% effective) — if
// Razorpay's pricing for this account changes, update RZP_FEE_RATE here.
const RZP_FEE_RATE = 0.02;
const GST_ON_FEE_RATE = 0.18;
const EFFECTIVE_DEDUCTION_RATE = RZP_FEE_RATE * (1 + GST_ON_FEE_RATE); // ≈ 0.0236

// Given what the creator should net (in paise), returns what the buyer must pay
// (in paise) so that after Razorpay's cut, the creator still nets that amount.
// Always rounds up, so the creator is never shorted by a paisa of rounding.
function computeGrossPaise(netPaise) {
  return Math.ceil(netPaise / (1 - EFFECTIVE_DEDUCTION_RATE));
}

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

    let { items, subject, tip } = JSON.parse(event.body);
    subject = subject || 'unknown';

    // --- Validate the cart shape ---
    if (!Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Cart is empty' })
      };
    }

    if (items.length > MAX_ITEMS_PER_ORDER) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: `You can unlock at most ${MAX_ITEMS_PER_ORDER} units in one order` })
      };
    }

    // --- Validate the optional tip ---
    let tipAmountRupees = 0;
    let tipMessage = '';
    if (tip && (Number(tip.amount) > 0 || (tip.message && String(tip.message).trim()))) {
      tipAmountRupees = Number(tip.amount) || 0;
      if (tipAmountRupees > 0 && (tipAmountRupees < MIN_TIP_RUPEES || tipAmountRupees > MAX_TIP_RUPEES)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: `Tip must be between ₹${MIN_TIP_RUPEES} and ₹${MAX_TIP_RUPEES}` })
        };
      }
      tipMessage = String(tip.message || '').trim().substring(0, MAX_TIP_MESSAGE_LENGTH);
    }

    // De-duplicate by noteId (last price wins if sent twice)
    const dedupedById = new Map();
    for (const raw of items) {
      const noteId = raw && raw.noteId;
      const priceRupees = raw && Number(raw.price);
      const noteTitle = (raw && raw.noteTitle) || 'BSc Notes';

      if (!noteId || typeof noteId !== 'string') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid item in cart' })
        };
      }

      if (!Number.isFinite(priceRupees) || priceRupees < MIN_PRICE_RUPEES || priceRupees > MAX_PRICE_RUPEES) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: `Price for ${noteTitle} must be between ₹${MIN_PRICE_RUPEES} and ₹${MAX_PRICE_RUPEES}` })
        };
      }

      // Resolve the secure ID to the real note URL — never trust a client-sent URL
      const realUrl = notesData[noteId];
      if (!realUrl) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: `Unknown note: ${noteId}` })
        };
      }

      dedupedById.set(noteId, {
        noteId,
        noteUrl: realUrl,
        noteTitle: String(noteTitle).substring(0, 100),
        price: priceRupees
      });
    }

    const resolvedItems = Array.from(dedupedById.values());
    const notesTotalPaise = resolvedItems.reduce((sum, it) => sum + it.price * 100, 0);
    const tipAmountPaise = Math.round(tipAmountRupees * 100);
    const netTargetPaise = notesTotalPaise + tipAmountPaise;
    const grossAmountPaise = computeGrossPaise(netTargetPaise);
    const platformFeePaise = grossAmountPaise - netTargetPaise;

    // Create Razorpay order — Razorpay's `notes` field shows on the dashboard's order
    // details page, so we include the actual unit names there (truncated to Razorpay's
    // ~256 char per-value limit) in addition to storing the full cart in Firestore.
    const unitNamesJoined = resolvedItems.map(it => it.noteTitle).join(', ');
    const options = {
      amount: grossAmountPaise, // in paise — already grossed up to cover Razorpay's fee + GST
      currency: 'INR',
      receipt: `r_${Date.now().toString().slice(-8)}`,
      notes: {
        userId: authenticatedUserId,
        subject: subject,
        units: unitNamesJoined.length <= 250 ? unitNamesJoined : unitNamesJoined.substring(0, 247) + '...',
        itemCount: String(resolvedItems.length),
        hasTip: String(tipAmountPaise > 0),
        timestamp: new Date().toISOString()
      }
    };

    const order = await razorpay.orders.create(options);

    // Store full order + cart + tip details in Firebase for verify-payment / webhook processing
    const db = admin.firestore();
    await db.collection('orders').doc(order.id).set({
      orderId: order.id,
      userId: authenticatedUserId,
      userName: decodedToken.name || '',
      userEmail: decodedToken.email || '',
      items: resolvedItems, // [{ noteId, noteUrl, noteTitle, price }] — price is the note price, not what was charged
      subject: subject,
      notesTotal: notesTotalPaise,
      tipAmount: tipAmountPaise,
      tipMessage: tipMessage,
      platformFee: platformFeePaise,
      amount: grossAmountPaise,
      currency: 'INR',
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId: order.id,
        amount: order.amount,
        notesTotal: notesTotalPaise,
        tipAmount: tipAmountPaise,
        platformFee: platformFeePaise,
        currency: order.currency,
        key: process.env.RAZORPAY_KEY_ID,
        itemCount: resolvedItems.length
      })
    };
  } catch (error) {
    console.error('Order creation error:', error);
    return {
      statusCode: error.message && error.message.includes('authentication') ? 401 : 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to create order'
      })
    };
  }
};
