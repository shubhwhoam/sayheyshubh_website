const admin = require('firebase-admin');

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

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const page = params.page || 'youtube';
    const limit = parseInt(params.limit) || 10;
    const offset = parseInt(params.offset) || 0;
    
    // Get top-level comments from Firestore
    const commentsRef = db.collection('comments')
      .where('page', '==', page)
      .where('parentId', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset);
    
    const snapshot = await commentsRef.get();
    
    // Convert Firestore docs to array
    const topComments = [];
    snapshot.forEach(doc => {
      topComments.push({
        id: doc.id,
        user_id: doc.data().userId,
        name: doc.data().userName,
        email: doc.data().userEmail,
        comment: doc.data().comment,
        created_at: doc.data().createdAt?.toDate?.() || new Date(),
        parent_id: doc.data().parentId
      });
    });
    
    // Get all replies for these comments
    const commentIds = topComments.map(comment => comment.id);
    let replies = [];
    
    if (commentIds.length > 0) {
      const repliesRef = db.collection('comments')
        .where('parentId', 'in', commentIds)
        .orderBy('createdAt', 'asc');
      
      const repliesSnapshot = await repliesRef.get();
      repliesSnapshot.forEach(doc => {
        replies.push({
          id: doc.id,
          user_id: doc.data().userId,
          name: doc.data().userName,
          email: doc.data().userEmail,
          comment: doc.data().comment,
          created_at: doc.data().createdAt?.toDate?.() || new Date(),
          parent_id: doc.data().parentId
        });
      });
    }
    
    // Organize replies under their parent comments
    const commentsWithReplies = topComments.map(comment => ({
      ...comment,
      replies: replies.filter(reply => reply.parent_id === comment.id)
    }));
    
    // Get total count of top-level comments
    const countSnapshot = await db.collection('comments')
      .where('page', '==', page)
      .where('parentId', '==', null)
      .count()
      .get();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        comments: commentsWithReplies,
        total: countSnapshot.data().count
      })
    };
  } catch (error) {
    console.error('Error fetching comments from Firestore:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to fetch comments' })
    };
  }
};
