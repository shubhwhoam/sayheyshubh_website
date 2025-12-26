const { builder } = require('@netlify/functions');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 1. Initialize Firebase (Global check)
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Handle both escaped and unescaped newlines for reliability
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
  }
} catch (e) {
  console.error("Firebase Init Error:", e);
}

const db = admin.firestore();

// --- HELPER FUNCTIONS ---

// Helper: Mask Email
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***.com';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return email;
  return user.slice(0, 2) + '***@' + domain;
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper: Generate HTML for a single comment (and its replies)
function renderCommentHtml(comment) {
  const date = new Date(comment.created_at);
  const formattedDate = date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // Render Replies
  const repliesHTML = (comment.replies && comment.replies.length > 0) ? `
    <div class="replies-container" id="replies-${comment.id}">
      ${comment.replies.map(reply => {
        const replyDate = new Date(reply.created_at);
        const formattedReplyDate = replyDate.toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        return `
          <div class="reply-item" itemscope itemtype="https://schema.org/CreativeWork">
            <div itemscope itemtype="https://schema.org/Comment" itemprop="comment">
              <div class="comment-header">
                <div class="comment-author-info">
                  <span class="comment-author" itemprop="author" itemscope itemtype="https://schema.org/Person">
                    <span itemprop="name">${escapeHtml(reply.name)}</span>
                  </span>
                  <span class="comment-email">${maskEmail(reply.email)}</span>
                </div>
                <time class="comment-date" datetime="${reply.created_at}" itemprop="datePublished">${formattedReplyDate}</time>
              </div>
              <div class="comment-text" itemprop="text">${escapeHtml(reply.comment)}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  // Render "View Replies" Button
  const repliesCount = comment.replies ? comment.replies.length : 0;
  const viewRepliesBtn = repliesCount > 0 ? `
    <button class="view-replies-btn" data-comment-id="${comment.id}" onclick="toggleReplies(event, '${comment.id}')">
      <span class="replies-text">View ${repliesCount} ${repliesCount === 1 ? 'Reply' : 'Replies'}</span>
      <span class="arrow">▼</span>
    </button>
  ` : '';

  return `
    <div class="comment-item" data-comment-id="${comment.id}" itemscope itemtype="https://schema.org/CreativeWork">
      <div itemscope itemtype="https://schema.org/Comment" itemprop="comment">
        <div class="comment-header">
          <div class="comment-author-info">
            <span class="comment-author" itemprop="author" itemscope itemtype="https://schema.org/Person">
              <span itemprop="name">${escapeHtml(comment.name)}</span>
            </span>
            <span class="comment-email">${maskEmail(comment.email)}</span>
          </div>
          <time class="comment-date" datetime="${comment.created_at}" itemprop="datePublished">${formattedDate}</time>
        </div>
        <div class="comment-text" itemprop="text">${escapeHtml(comment.comment)}</div>
        <div class="comment-actions">
          <button class="reply-btn" onclick="showReplyForm('${comment.id}')">💬 Reply</button>
          ${viewRepliesBtn}
        </div>
        ${repliesHTML}
      </div>
    </div>
  `;
}

// --- MAIN HANDLER ---

async function handler(event, context) {
  try {
    // ---------------------------------------------------------
    // THE FIX: Robust Path Finding for youtube.html
    // ---------------------------------------------------------
    const possiblePaths = [
      path.resolve(__dirname, '../../youtube.html'), // Standard Netlify Function path
      path.resolve(__dirname, '../youtube.html'),    // Alternative
      path.resolve('youtube.html'),                  // Root relative
      path.resolve('./youtube.html')                 // Current dir relative
    ];

    let templatePath = null;
    let html = "";

    // Loop through paths until we find the file
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        templatePath = p;
        break;
      }
    }

    if (!templatePath) {
      // Fallback: If we genuinely can't find the file, return a simple error 
      // instead of crashing effectively so you can debug
      console.error(`Template youtube.html not found. Searched: ${possiblePaths.join(', ')}`);
      return { statusCode: 500, body: "Error: youtube.html template not found in deployment." };
    }

    // Read the file content
    html = fs.readFileSync(templatePath, 'utf8');


    // ---------------------------------------------------------
    // 2. Fetch Data from Firebase
    // ---------------------------------------------------------
    if (!process.env.FIREBASE_PRIVATE_KEY) {
      throw new Error("Missing Env Var: FIREBASE_PRIVATE_KEY");
    }

    // Get Top 20 Comments (Enough for SEO)
    const commentsRef = db.collection('comments')
      .where('page', '==', 'youtube')
      .where('parentId', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(20);

    const snapshot = await commentsRef.get();

    // Process Comments into a clean array
    const topComments = [];
    snapshot.forEach(doc => {
      topComments.push({
        id: doc.id,
        name: doc.data().userName || 'Student',
        email: doc.data().userEmail,
        comment: doc.data().comment,
        created_at: doc.data().createdAt?.toDate?.() || new Date(),
        replies: [] // Will fill below
      });
    });

    // Fetch Replies (Batch fetch for efficiency)
    const commentIds = topComments.map(c => c.id);
    if (commentIds.length > 0) {
      // Simple chunking for Firestore 'in' query limit (max 10)
      const chunks = [];
      for (let i = 0; i < commentIds.length; i += 10) {
        chunks.push(commentIds.slice(i, i + 10));
      }

      const allReplies = [];
      for (const chunk of chunks) {
        const rSnap = await db.collection('comments')
          .where('parentId', 'in', chunk)
          .orderBy('createdAt', 'asc')
          .get();
        rSnap.forEach(doc => {
          allReplies.push({
            id: doc.id,
            parentId: doc.data().parentId,
            name: doc.data().userName || 'Student',
            email: doc.data().userEmail,
            comment: doc.data().comment,
            created_at: doc.data().createdAt?.toDate?.() || new Date()
          });
        });
      }

      // Attach replies to the correct parents
      topComments.forEach(parent => {
        parent.replies = allReplies.filter(r => r.parentId === parent.id);
      });
    }

    // ---------------------------------------------------------
    // 3. Generate HTML & Inject
    // ---------------------------------------------------------
    const commentsHtml = topComments.map(renderCommentHtml).join('');

    // Update Title with Count
    const countSnapshot = await db.collection('comments')
      .where('page', '==', 'youtube')
      .where('parentId', '==', null)
      .count()
      .get();
    const totalCount = countSnapshot.data().count;
    const titleText = totalCount === 1 ? '1 Student Review' : `${totalCount} Student Reviews`;

    // Replace the Title
    html = html.replace(
      '<h3 class="comments-title" id="commentsTitle">Loading comments...</h3>',
      `<h3 class="comments-title" id="commentsTitle">${titleText}</h3>`
    );

    // Inject the Comments List
    // We search for the specific ID and append the content after it
    if (html.includes('id="commentsList">')) {
       html = html.replace('id="commentsList">', `id="commentsList">${commentsHtml}`);

       // Clean up the "Loading" placeholder if it exists inside the div in the source file
       // This regex removes whitespace + optional "Loading..." comment/text inside the div
       html = html.replace(/<div class="comments-list" id="commentsList">[\s\S]*?<\/div>/, 
          `<div class="comments-list" id="commentsList">${commentsHtml}</div>`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: html,
    };

  } catch (error) {
    console.error("ODB Error:", error);

    // Fallback: return the original static file if something breaks
    // This ensures the site never goes down, even if the function fails.
    // We re-use the path finding logic briefly or default to standard.
    try {
        const fallbackPath = path.resolve(__dirname, '../../youtube.html');
        return {
            statusCode: 200,
            headers: { "Content-Type": "text/html" },
            body: fs.readFileSync(fallbackPath, 'utf8')
        };
    } catch (e) {
        return { statusCode: 500, body: "Critical Error: " + error.message };
    }
  }
}

exports.handler = builder(handler);