const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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
    
    const { amount, noteTitle } = req.body;
    
    // Basic validation
    if (!amount || !noteTitle) {
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

// Verify payment endpoint
app.post('/.netlify/functions/verify-payment', async (req, res) => {
  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { paymentId, orderId, signature, noteUrl } = req.body;
    
    // Check if Razorpay credentials are properly configured
    if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) {
      console.error('Razorpay credentials not configured. Payment verification failed.');
      return res.status(500).json({ 
        success: false, 
        verified: false,
        error: 'Payment system not configured properly' 
      });
    }
    
    if (!paymentId || !orderId || !signature || !noteUrl) {
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

    // Save purchase record to Firestore (consistent with netlify functions)
    try {
      // 1. Record the transaction (for history)
      await db.collection('transactions').add({
        userId: authenticatedUserId,
        paymentId: paymentId,
        orderId: orderId,
        noteUrl: noteUrl,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed',
        verified: true
      });

      // 2. Update user's unlocked notes
      const userRef = db.collection('users').doc(authenticatedUserId);
      const noteSlug = noteUrl.split('/').pop(); // Gets the unique identifier (slug) of the note

      await userRef.set({
        unlockedNotes: {
          [noteSlug]: true // Sets a flag: e.g., { 'non-chordata-protists': true }
        }
      }, { merge: true });
      
      console.log('Purchase recorded and note unlocked successfully for user:', authenticatedUserId);
    } catch (firestoreError) {
      console.error('Error saving purchase to Firestore:', firestoreError);
      // Continue with success response since payment was verified
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

// Secure PDF viewer endpoint with session-based access control
app.get('/secure-notes/:noteId', async (req, res) => {
  try {
    // Verify authentication using header only
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { noteId } = req.params;
    
    // Get user's unlocked notes to verify access
    const userDoc = await db.collection('users').doc(authenticatedUserId).get();
    const userData = userDoc.data();
    const unlockedNotes = userData?.unlockedNotes || {};
    
    // Check if user has access to this note
    if (!unlockedNotes[noteId]) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied - note not unlocked' 
      });
    }
    
    // Get the actual Google Drive URL from transactions
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', authenticatedUserId)
      .where('status', '==', 'completed')
      .get();
    
    let noteUrl = null;
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.noteUrl && data.noteUrl.includes(noteId)) {
        noteUrl = data.noteUrl;
      }
    });
    
    if (!noteUrl) {
      return res.status(404).json({ 
        success: false, 
        error: 'Note not found' 
      });
    }
    
    // Convert Google Drive URL to preview mode (more secure than direct download)
    const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    if (!fileIdMatch) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid note URL format' 
      });
    }
    
    const fileId = fileIdMatch[1];
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    
    // Return preview URL for client-side rendering with additional security
    res.json({
      success: true,
      previewUrl: previewUrl,
      noteTitle: 'BSc Zoology Notes',
      userId: authenticatedUserId,
      noteId: noteId,
      securityToken: crypto.createHash('sha256').update(`${authenticatedUserId}:${noteId}:${Date.now()}`).digest('hex').substring(0, 16)
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

// Serve static files
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, req.path));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Payment functions available at:');
  console.log('- GET  /.netlify/functions/public-config');
  console.log('- POST /.netlify/functions/create-order');  
  console.log('- POST /.netlify/functions/verify-payment');
  console.log('- GET  /.netlify/functions/check-purchases');
});