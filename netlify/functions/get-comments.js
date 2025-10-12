const { Pool } = require('pg');

// Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

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
    
    const result = await pool.query(
      `SELECT id, user_id, name, email, comment, created_at, parent_id 
       FROM youtube_comments 
       WHERE page = $1 AND parent_id IS NULL 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [page, limit, offset]
    );
    
    let replies = [];
    if (result.rows.length > 0) {
      const commentIds = result.rows.map(row => row.id);
      const repliesResult = await pool.query(
        `SELECT id, user_id, name, email, comment, created_at, parent_id 
         FROM youtube_comments 
         WHERE parent_id = ANY($1) 
         ORDER BY created_at ASC`,
        [commentIds]
      );
      replies = repliesResult.rows;
    }
    
    const commentsWithReplies = result.rows.map(comment => ({
      ...comment,
      replies: replies.filter(reply => reply.parent_id === comment.id)
    }));
    
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM youtube_comments WHERE page = $1 AND parent_id IS NULL',
      [page]
    );
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        comments: commentsWithReplies,
        total: parseInt(countResult.rows[0].count)
      })
    };
  } catch (error) {
    console.error('Error fetching comments:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to fetch comments' })
    };
  }
};
