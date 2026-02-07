const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

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
    // Fallback initialization for development
    admin.initializeApp({
      projectId: 'sayheyshubh-7051c'
    });
  }
}

const db = admin.firestore();

// Initialize Razorpay
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
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

// API Routes

// Public config endpoint
app.get('/.netlify/functions/public-config', (req, res) => {
  res.json({
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || ''
  });
});

// Create order endpoint
app.post('/.netlify/functions/create-order', async (req, res) => {
  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { amount, noteTitle, noteUrl } = req.body;
    
    // Basic validation
    if (!amount || !noteTitle || !noteUrl) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    if (!amount || amount < 500 || amount > 5000) {
      return res.status(400).json({ success: false, error: 'Invalid amount. Must be between ₹5 and ₹50' });
    }

    if (!razorpay) {
      return res.status(500).json({ success: false, error: 'Payment system not configured' });
    }

    // Sanitize note title for security
    const sanitizedNoteTitle = noteTitle.substring(0, 100);

    // Create Razorpay order
    const options = {
      amount: amount, // amount in smallest currency unit (paise)
      currency: 'INR',
      receipt: `r_${Date.now().toString().slice(-8)}`,
      notes: {
        noteTitle: sanitizedNoteTitle,
        userId: authenticatedUserId,
        timestamp: new Date().toISOString()
      }
    };

    const order = await razorpay.orders.create(options);
    
    // Store order details in Firebase for webhook processing (use orderId as doc ID for uniqueness)
    await db.collection('orders').doc(order.id).set({
      orderId: order.id,
      userId: authenticatedUserId,
      noteUrl: noteUrl,
      noteTitle: sanitizedNoteTitle,
      amount: amount,
      currency: 'INR',
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Order created successfully:', order.id);
    
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(error.message && error.message.includes('authentication') ? 401 : 500)
       .json({
         success: false,
         error: error.message || 'Failed to create order'
       });
  }
});

// Helper function for idempotent note unlocking (shared with webhook)
async function unlockNoteForUser(userId, paymentId, orderId, noteUrl) {
  const transactionRef = db.collection('transactions').doc(paymentId);
  
  try {
    // Use create() for atomic idempotency - fails if doc already exists
    await transactionRef.create({
      userId: userId,
      paymentId: paymentId,
      orderId: orderId,
      noteUrl: noteUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed',
      verified: true
    });

    // Update user's unlocked notes
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
    
    console.log('Note unlocked successfully for user:', userId, 'note:', noteSlug);
  } catch (error) {
    if (error.code === 6) { // ALREADY_EXISTS
      console.log('Transaction already processed (idempotent):', paymentId);
      return; // Already processed, skip silently
    }
    throw error; // Rethrow unexpected errors
  }
}

// Verify payment endpoint
app.post('/.netlify/functions/verify-payment', async (req, res) => {
  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { paymentId, orderId, signature } = req.body;
    
    // Check if Razorpay credentials are properly configured
    if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) {
      console.error('Razorpay credentials not configured. Payment verification failed.');
      return res.status(500).json({ 
        success: false, 
        verified: false,
        error: 'Payment system not configured properly' 
      });
    }
    
    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ 
        success: false, 
        verified: false,
        error: 'Missing required parameters' 
      });
    }

    // Verify Razorpay payment signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    const isSignatureValid = generatedSignature === signature;

    if (!isSignatureValid) {
      console.error('Payment signature verification failed');
      return res.status(400).json({ 
        success: false, 
        verified: false,
        error: 'Payment verification failed' 
      });
    }

    // SECURITY: Fetch order details from database instead of trusting client
    const orderDoc = await db.collection('orders').doc(orderId).get();

    if (!orderDoc.exists) {
      console.error('Order not found:', orderId);
      return res.status(404).json({ 
        success: false, 
        verified: true,
        error: 'Order not found' 
      });
    }

    const orderData = orderDoc.data();
    
    // Verify the authenticated user matches the order's user
    if (orderData.userId !== authenticatedUserId) {
      console.error('User mismatch for order:', orderId);
      return res.status(403).json({ 
        success: false, 
        verified: true,
        error: 'Unauthorized: Order does not belong to this user' 
      });
    }

    const noteUrl = orderData.noteUrl;

    // Unlock the note for the user (using server-validated noteUrl)
    try {
      await unlockNoteForUser(authenticatedUserId, paymentId, orderId, noteUrl);
    } catch (firestoreError) {
      console.error('Error unlocking note:', firestoreError);
      return res.status(500).json({
        success: false,
        verified: true,
        error: 'Failed to unlock note'
      });
    }

    res.json({
      success: true,
      verified: true,
      message: 'Payment verified successfully'
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(error.message && error.message.includes('authentication') ? 401 : 500)
       .json({
         success: false,
         verified: false,
         error: error.message || 'Payment verification failed'
       });
  }
});

// Check purchases endpoint
app.get('/.netlify/functions/check-purchases', async (req, res) => {
  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    // Get user's unlocked notes from transactions (single source of truth)
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', authenticatedUserId)
      .where('status', '==', 'completed')
      .where('verified', '==', true)
      .get();

    const purchasedNotes = [];
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.noteUrl) {
        purchasedNotes.push(data.noteUrl);
      }
    });

    res.json({
      success: true,
      purchasedNotes: purchasedNotes
    });

  } catch (error) {
    console.error('Error checking purchases:', error);
    res.status(error.message && error.message.includes('authentication') ? 401 : 500)
       .json({
         success: false,
         error: error.message || 'Failed to check purchases'
       });
  }
});

// Clean URL handling and redirects - only for non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/.netlify/') || req.path.startsWith('/secure-notes/')) {
    return next();
  }

  const queryIndex = req.originalUrl.indexOf('?');
  const queryString = queryIndex !== -1 ? req.originalUrl.slice(queryIndex) : '';

  if (req.path.endsWith('.html')) {
    const cleanPath = req.path.replace(/\.html$/, '');
    return res.redirect(301, `${cleanPath}${queryString}`);
  }

  if (!path.extname(req.path) && req.path !== '/') {
    const htmlPath = path.join(__dirname, `${req.path}.html`);
    if (fs.existsSync(htmlPath)) {
      req.url = `${req.path}.html${queryString}`;
    }
  }

  return next();
});

// Serve static files - only for non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/.netlify/') || req.path.startsWith('/secure-notes/')) {
    return next();
  }
  express.static('.')(req, res, next);
});

// Fallback for non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/.netlify/') || req.path.startsWith('/secure-notes/')) {
    return res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Secure notes data (in a real app, this would be in a database)
const secureNotesData = require('./notes-data.json');

// Secure PDF viewer endpoint with session-based access control
app.get('/secure-notes/:noteId', async (req, res) => {
  try {
    // Verify authentication using header only
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { noteId } = req.params;
    
    // Get the actual Google Drive URL from the secure data store
    const noteUrl = secureNotesData[noteId];
    
    if (!noteUrl) {
      return res.status(404).json({ 
        success: false, 
        error: 'Note not found' 
      });
    }

    // Get user's unlocked notes to verify access
    const userDoc = await db.collection('users').doc(authenticatedUserId).get();
    const userData = userDoc.data();
    const unlockedNotes = userData?.unlockedNotes || {};
    
    // Check if user has access to this note
    const isFree = noteId.startsWith('syllabus-') || noteId.startsWith('free-');
    if (!isFree && !unlockedNotes[noteId]) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied - note not unlocked' 
      });
    }
    
    // Convert Google Drive URL to preview mode
    const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    if (!fileIdMatch) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid note URL format' 
      });
    }
    
    const fileId = fileIdMatch[1];
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    
    res.json({
      success: true,
      previewUrl: previewUrl,
      noteId: noteId
    });
    
  } catch (error) {
    console.error('Error in secure notes endpoint:', error);
    res.status(error.message && error.message.includes('authentication') ? 401 : 500)
       .json({
         success: false,
         error: error.message || 'Failed to access notes'
       });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Payment functions available at:');
  console.log('- GET  /.netlify/functions/public-config');
  console.log('- POST /.netlify/functions/create-order');  
  console.log('- POST /.netlify/functions/verify-payment');
  console.log('- GET  /.netlify/functions/check-purchases');
  console.log('- POST /migrate-purchases (one-time migration)');

});