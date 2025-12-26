const { builder } = require('@netlify/functions');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 1. Initialize Firebase (Same logic as your get-comments.js)
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

// Helper: Mask Email (Matches your script.js logic)
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***.com';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return email;
  return user.slice(0, 2) + '***@' + domain;
}

// Helper: Escape HTML (Security & formatting)
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

  // Calculate replies count for button text
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

// Main Handler
async function handler(event, context) {
  try {
    // 1. Read the static HTML template
    // We resolve from the function directory back to the root
    const templatePath = path.resolve(__dirname, '../../youtube.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // 2. Fetch Comments (Simplified Logic from your API)
    // Get top 20 comments for SEO (Pagination isn't needed for the static bot view)
    const commentsRef = db.collection('comments')
      .where('page', '==', 'youtube')
      .where('parentId', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(20);

    const snapshot = await commentsRef.get();

    // Process comments
    const topComments = [];
    snapshot.forEach(doc => {
      topComments.push({
        id: doc.id,
        name: doc.data().userName,
        email: doc.data().userEmail,
        comment: doc.data().comment,
        created_at: doc.data().createdAt?.toDate?.() || new Date(),
        replies: [] // Will fill below
      });
    });

    // Fetch replies for these comments (Batch fetch)
    const commentIds = topComments.map(c => c.id);
    if (commentIds.length > 0) {
      // In a real app, chunk this if > 10 IDs. Assuming < 10 for top 20 limit or handled simply.
      // For ODB simplicity, let's just fetch all replies for the page or just the relevant ones.
      // To keep it robust, we'll fetch replies where parentId is in our list.

      // Note: Firestore 'in' limit is 10. We'll do a simple loop or just skip deep reply rendering for SEO if complex.
      // Better approach for SEO: Just fetch all replies for the page (if not huge) or just skip for now.
      // Let's implement the chunking correctly to be safe:
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
            name: doc.data().userName,
            email: doc.data().userEmail,
            comment: doc.data().comment,
            created_at: doc.data().createdAt?.toDate?.() || new Date()
          });
        });
      }

      // Attach replies to parents
      topComments.forEach(parent => {
        parent.replies = allReplies.filter(r => r.parentId === parent.id);
      });
    }

    // 3. Generate HTML String
    const commentsHtml = topComments.map(renderCommentHtml).join('');

    // Get total count for the title
    const countSnapshot = await db.collection('comments')
      .where('page', '==', 'youtube')
      .where('parentId', '==', null)
      .count()
      .get();
    const totalCount = countSnapshot.data().count;

    // 4. Inject into Template
    // Replace the Title
    const titleText = totalCount === 1 ? '1 Student Review' : `${totalCount} Student Reviews`;
    html = html.replace(
      '<h3 class="comments-title" id="commentsTitle">Loading comments...</h3>',
      `<h3 class="comments-title" id="commentsTitle">${titleText}</h3>`
    );

    // Replace the List Container content
    // We match the specific HTML structure of your empty container
    const listRegex = /<div class="comments-list" id="commentsList">\s*\s*<\/div>/;
    const newListHtml = `<div class="comments-list" id="commentsList">${commentsHtml}</div>`;

    // If regex doesn't match due to whitespace differences, fallback to string replacement of the ID
    if (listRegex.test(html)) {
      html = html.replace(listRegex, newListHtml);
    } else {
      // Fallback: simpler replacement
      html = html.replace('id="commentsList">', `id="commentsList">${commentsHtml}`);
      // Note: This leaves the closing div and comment, but browsers handle extra text fine. 
      // For cleanliness, regex is better, but this ensures it works if whitespace changes.
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
      },
      body: html,
    };

  } catch (error) {
    console.error("ODB Error:", error);
    // Fallback: return the original file if something breaks, so the site never goes down
    const templatePath = path.resolve(__dirname, '../../youtube.html');
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: fs.readFileSync(templatePath, 'utf8')
    };
  }
}

// Wrap with builder for ODB (Caching)
exports.handler = builder(handler);