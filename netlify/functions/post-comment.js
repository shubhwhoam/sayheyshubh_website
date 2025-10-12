const admin = require('firebase-admin');
const { Pool } = require('pg');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

// Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function verifyFirebaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }
  
  const token = authHeader.split('Bearer ')[1];
  return await admin.auth().verifyIdToken(token);
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const decodedToken = await verifyFirebaseToken(event.headers.authorization);
    const authenticatedUserId = decodedToken.uid;
    
    const { comment, page, parentId } = JSON.parse(event.body);
    
    if (!comment || !page) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Comment and page are required' })
      };
    }
    
    const userDoc = await db.collection('users').doc(authenticatedUserId).get();
    if (!userDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }
    
    const userData = userDoc.data();
    const userName = userData.name || decodedToken.name || 'Anonymous';
    const userEmail = userData.email || decodedToken.email || '';
    
    const sanitizedComment = comment.trim().substring(0, 1000);
    const sanitizedPage = page.substring(0, 50);
    const sanitizedParentId = parentId ? parseInt(parentId) : null;
    
    if (sanitizedComment.length < 3) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Comment must be at least 3 characters' })
      };
    }
    
    if (sanitizedParentId) {
      const parentCheck = await pool.query(
        'SELECT id FROM youtube_comments WHERE id = $1',
        [sanitizedParentId]
      );
      
      if (parentCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Parent comment not found' })
        };
      }
    }
    
    const result = await pool.query(
      `INSERT INTO youtube_comments (user_id, name, email, comment, page, parent_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, user_id, name, email, comment, created_at, parent_id`,
      [authenticatedUserId, userName, userEmail, sanitizedComment, sanitizedPage, sanitizedParentId]
    );
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        comment: result.rows[0]
      })
    };
  } catch (error) {
    console.error('Error posting comment:', error);
    const statusCode = error.message && error.message.includes('authorization') ? 401 : 500;
    return {
      statusCode,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to post comment'
      })
    };
  }
};
