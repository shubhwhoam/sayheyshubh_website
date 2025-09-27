const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 5000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

// For payment processing
const crypto = require('crypto');
const Razorpay = require('razorpay');

// Firebase Admin for server-side authentication
const admin = require('firebase-admin');

// Initialize Firebase Admin with minimal config (client will handle auth tokens)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'sayheyshubh-7051c' // Match the client-side project ID
  });
}

// Firestore database for persistent purchase storage
const db = admin.firestore();

// Authentication middleware for payment endpoints
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

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const server = http.createServer((req, res) => {
  // Set CORS headers - restrict to same origin for security
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:5000',
    'http://0.0.0.0:5000',
    process.env.REPLIT_URL || 'http://localhost:5000'
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Cache control for development
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Handle API routes
  if (req.url.startsWith('/api/')) {
    handleAPIRequest(req, res);
    return;
  }

  // Parse URL to remove query parameters and sanitize path
  let pathname = req.url;
  if (req.url.includes('?')) {
    pathname = req.url.split('?')[0];
  }
  
  // Decode the pathname
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>400 Bad Request</h1>', 'utf-8');
    return;
  }
  
  // Prevent directory traversal attacks
  if (pathname.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>', 'utf-8');
    return;
  }
  
  // Normalize and resolve the full path
  let filePath = path.resolve('.', '.' + pathname);
  const rootPath = path.resolve('.');
  
  // Ensure the resolved path is within the root directory
  if (!filePath.startsWith(rootPath + path.sep) && filePath !== rootPath) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>', 'utf-8');
    return;
  }
  
  // Convert back to relative path for existing code compatibility
  filePath = '.' + pathname;
  
  // Default to index.html
  if (filePath === './') {
    filePath = './index.html';
  }
  
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeType = mimeTypes[extname] || 'application/octet-stream';
  
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        // File not found, try with .html extension
        if (!extname && !filePath.endsWith('.html')) {
          const htmlPath = filePath + '.html';
          fs.readFile(htmlPath, (htmlError, htmlContent) => {
            if (htmlError) {
              res.writeHead(404, { 'Content-Type': 'text/html' });
              res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              // Inject Razorpay key into HTML files
              let finalContent = htmlContent.toString();
              if (process.env.RAZORPAY_KEY_ID) {
                finalContent = finalContent.replace(
                  'YOUR_KEY_WILL_BE_SET_BY_SERVER',
                  process.env.RAZORPAY_KEY_ID
                );
              }
              res.end(finalContent, 'utf-8');
            }
          });
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code + ' ..\n');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      // Inject Razorpay key into HTML files
      if (mimeType === 'text/html' && process.env.RAZORPAY_KEY_ID) {
        let finalContent = content.toString();
        finalContent = finalContent.replace(
          'YOUR_KEY_WILL_BE_SET_BY_SERVER',
          process.env.RAZORPAY_KEY_ID
        );
        res.end(finalContent, 'utf-8');
      } else {
        res.end(content, 'utf-8');
      }
    }
  });
});

// API request handler
function handleAPIRequest(req, res) {
  const url = req.url;
  const method = req.method;

  // Create Razorpay order
  if (url === '/api/create-order' && method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        // Verify authentication
        const decodedToken = await verifyFirebaseToken(req.headers.authorization);
        const authenticatedUserId = decodedToken.uid;
        
        const { amount, noteTitle } = JSON.parse(body);
        
        // Basic validation
        if (!amount || !noteTitle) {
          throw new Error('Missing required parameters');
        }
        
        if (!amount || amount < 500 || amount > 5000) {
          throw new Error('Invalid amount. Must be between ₹5 and ₹50');
        }

        // Sanitize note title for security
        const sanitizedNoteTitle = noteTitle.substring(0, 100);

        // Create actual Razorpay order using authenticated user ID
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
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          key: process.env.RAZORPAY_KEY_ID
        }));
      } catch (error) {
        console.error('Order creation error:', error);
        res.writeHead(error.message.includes('authentication') ? 401 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message || 'Failed to create order' 
        }));
      }
    });
    return;
  }

  // Verify payment
  if (url === '/api/verify-payment' && method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        // Verify authentication
        const decodedToken = await verifyFirebaseToken(req.headers.authorization);
        const authenticatedUserId = decodedToken.uid;
        
        const { paymentId, orderId, signature, noteUrl } = JSON.parse(body);
        
        // Check if Razorpay credentials are properly configured
        if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) {
          console.error('Razorpay credentials not configured. Payment verification failed.');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            verified: false,
            error: 'Payment system not configured properly' 
          }));
          return;
        }
        
        if (!paymentId || !orderId || !signature || !noteUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            verified: false,
            error: 'Missing required payment parameters' 
          }));
          return;
        }
        
        // Verify signature using HMAC-SHA256 (required for security)
        const expectedSignature = crypto
          .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
          .update(orderId + '|' + paymentId)
          .digest('hex');
        
        const verified = expectedSignature === signature;
        
        if (!verified) {
          console.error('Payment signature verification failed', {
            paymentId,
            orderId,
            providedSignature: signature.substring(0, 10) + '...' // Log partial signature for debugging
          });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            verified: false,
            error: 'Payment signature verification failed' 
          }));
          return;
        }
        
        // Payment verified successfully - store purchase record in Firestore
        const purchaseData = {
          userId: authenticatedUserId,
          noteUrl: noteUrl,
          paymentId: paymentId,
          orderId: orderId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          verified: true
        };

        // Use composite key to prevent duplicate purchases
        const purchaseId = `${authenticatedUserId}_${Buffer.from(noteUrl).toString('base64').substring(0, 20)}`;
        
        await db.collection('verified_purchases').doc(purchaseId).set(purchaseData, { merge: true });
        
        console.log(`Payment verified and recorded for user ${authenticatedUserId}: ${noteUrl}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          verified: true,
          paymentId: paymentId
        }));
      } catch (error) {
        console.error('Payment verification error:', error);
        res.writeHead(error.message.includes('authentication') ? 401 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          verified: false,
          error: 'Payment verification failed' 
        }));
      }
    });
    return;
  }

  // Check purchase status
  if (url === '/api/check-purchases' && method === 'GET') {
    (async () => {
      try {
        // Verify authentication
        const decodedToken = await verifyFirebaseToken(req.headers.authorization);
        const authenticatedUserId = decodedToken.uid;
      
        // Get all purchases for this user from Firestore
        const purchasesSnapshot = await db.collection('verified_purchases')
          .where('userId', '==', authenticatedUserId)
          .where('verified', '==', true)
          .get();

        const userPurchases = [];
        purchasesSnapshot.forEach(doc => {
          const purchase = doc.data();
          userPurchases.push(purchase.noteUrl);
        });
      
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          purchases: userPurchases
        }));
      } catch (error) {
        console.error('Purchase check error:', error);
        res.writeHead(error.message.includes('authentication') ? 401 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Failed to check purchases' 
        }));
      }
    })();
    return;
  }

  // Handle 404 for API routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'API endpoint not found' }));
}

server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://0.0.0.0:${port}/`);
  console.log(`📱 Website is ready for testing`);
  console.log(`💳 Payment API endpoints available at /api/`);
});