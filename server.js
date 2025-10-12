const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = 5000;

// PostgreSQL connection for comments
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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

// Migration endpoint to fix existing purchases (one-time use)
app.post('/migrate-purchases', async (req, res) => {
  try {
    console.log('🔄 Starting migration of existing purchases...');
    
    // Function to extract proper noteSlug from Google Drive URL
    function extractNoteSlug(noteUrl) {
      if (noteUrl.includes('drive.google.com/file/d/')) {
        const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
        return fileIdMatch ? fileIdMatch[1] : noteUrl.split('/').pop();
      } else {
        return noteUrl.split('/').pop();
      }
    }
    
    // Get all completed transactions
    const transactionsSnapshot = await db.collection('transactions')
      .where('status', '==', 'completed')
      .get();
    
    console.log(`📊 Found ${transactionsSnapshot.size} completed transactions`);
    
    // Group transactions by user
    const userTransactions = {};
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.userId && data.noteUrl) {
        if (!userTransactions[data.userId]) {
          userTransactions[data.userId] = [];
        }
        userTransactions[data.userId].push(data);
      }
    });
    
    console.log(`👥 Found transactions for ${Object.keys(userTransactions).length} users`);
    
    // Process each user
    let successCount = 0;
    let errorCount = 0;
    const migrationDetails = [];
    
    for (const [userId, transactions] of Object.entries(userTransactions)) {
      try {
        console.log(`🔧 Processing user: ${userId}`);
        
        // Build the correct unlockedNotes object
        const unlockedNotes = {};
        const userDetails = { userId, notes: [] };
        
        for (const transaction of transactions) {
          const correctNoteSlug = extractNoteSlug(transaction.noteUrl);
          unlockedNotes[correctNoteSlug] = true;
          userDetails.notes.push({
            noteSlug: correctNoteSlug,
            originalUrl: transaction.noteUrl
          });
          console.log(`  ✅ Adding note: ${correctNoteSlug} from URL: ${transaction.noteUrl}`);
        }
        
        // Update the user's document with correct unlockedNotes
        const userRef = db.collection('users').doc(userId);
        await userRef.set({
          unlockedNotes: unlockedNotes
        }, { merge: true });
        
        console.log(`  ✅ Updated ${Object.keys(unlockedNotes).length} notes for user ${userId}`);
        migrationDetails.push(userDetails);
        successCount++;
        
      } catch (error) {
        console.error(`  ❌ Error processing user ${userId}:`, error);
        migrationDetails.push({ userId, error: error.message });
        errorCount++;
      }
    }
    
    console.log('🎉 Migration completed!');
    console.log(`✅ Successfully processed: ${successCount} users`);
    console.log(`❌ Errors: ${errorCount} users`);
    
    res.json({
      success: true,
      message: 'Migration completed successfully',
      stats: {
        totalTransactions: transactionsSnapshot.size,
        usersProcessed: Object.keys(userTransactions).length,
        successfulUsers: successCount,
        errors: errorCount
      },
      details: migrationDetails
    });
    
  } catch (error) {
    console.error('💥 Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error.message
    });
  }
});

// Comment endpoints
// Get comments for a page with nested replies
app.get('/api/comments/:page', async (req, res) => {
  console.log(`[GET] /api/comments/${req.params.page} - Fetching comments`);
  try {
    const { page } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    // Get top-level comments (parent_id IS NULL)
    const result = await pool.query(
      `SELECT id, user_id, name, email, comment, created_at, parent_id 
       FROM youtube_comments 
       WHERE page = $1 AND parent_id IS NULL 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [page, limit, offset]
    );
    
    // Get all replies for these comments
    const commentIds = result.rows.map(row => row.id);
    let replies = [];
    
    if (commentIds.length > 0) {
      const repliesResult = await pool.query(
        `SELECT id, user_id, name, email, comment, created_at, parent_id 
         FROM youtube_comments 
         WHERE parent_id = ANY($1) 
         ORDER BY created_at ASC`,
        [commentIds]
      );
      replies = repliesResult.rows;
    }
    
    // Organize replies under their parent comments
    const commentsWithReplies = result.rows.map(comment => ({
      ...comment,
      replies: replies.filter(reply => reply.parent_id === comment.id)
    }));
    
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM youtube_comments WHERE page = $1 AND parent_id IS NULL',
      [page]
    );
    
    res.json({
      success: true,
      comments: commentsWithReplies,
      total: parseInt(countResult.rows[0].count)
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch comments' });
  }
});

// Post a new comment (requires authentication)
app.post('/api/comments', async (req, res) => {
  console.log('[POST] /api/comments - Posting new comment');
  try {
    // Verify authentication
    const decodedToken = await verifyFirebaseToken(req.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { comment, page, parentId } = req.body;
    
    // Validation
    if (!comment || !page) {
      return res.status(400).json({ 
        success: false, 
        error: 'Comment and page are required' 
      });
    }
    
    // Get user info from Firestore
    const userDoc = await db.collection('users').doc(authenticatedUserId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    const userData = userDoc.data();
    const userName = userData.name || decodedToken.name || 'Anonymous';
    const userEmail = userData.email || decodedToken.email || '';
    
    // Sanitize inputs
    const sanitizedComment = comment.trim().substring(0, 1000);
    const sanitizedPage = page.substring(0, 50);
    const sanitizedParentId = parentId ? parseInt(parentId) : null;
    
    if (sanitizedComment.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Comment must be at least 3 characters' 
      });
    }
    
    // If this is a reply, verify parent comment exists
    if (sanitizedParentId) {
      const parentCheck = await pool.query(
        'SELECT id FROM youtube_comments WHERE id = $1',
        [sanitizedParentId]
      );
      
      if (parentCheck.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Parent comment not found' 
        });
      }
    }
    
    const result = await pool.query(
      `INSERT INTO youtube_comments (user_id, name, email, comment, page, parent_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, user_id, name, email, comment, created_at, parent_id`,
      [authenticatedUserId, userName, userEmail, sanitizedComment, sanitizedPage, sanitizedParentId]
    );
    
    res.json({
      success: true,
      comment: result.rows[0]
    });
  } catch (error) {
    console.error('Error posting comment:', error);
    const statusCode = error.message && error.message.includes('authentication') ? 401 : 500;
    res.status(statusCode).json({ 
      success: false, 
      error: error.message || 'Failed to post comment' 
    });
  }
});

// Serve static files - only for non-API routes
app.use((req, res, next) => {
  // Skip static file serving for API routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/.netlify/')) {
    return next();
  }
  
  // Try to serve static file
  const filePath = path.join(__dirname, req.path);
  res.sendFile(filePath, (err) => {
    if (err) {
      // If file not found, send index.html for client-side routing
      res.status(err.status || 500);
      if (err.status === 404) {
        res.sendFile(path.join(__dirname, 'index.html'));
      } else {
        res.send('Error: ' + err.message);
      }
    }
  });
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