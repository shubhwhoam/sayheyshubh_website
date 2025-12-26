const { builder } = require('@netlify/functions');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 1. Initialize Firebase (Global Scope)
// We wrap this in a try-catch to prevent immediate crash, but log it.
try {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_PRIVATE_KEY) {
      console.error("Missing Env Var: FIREBASE_PRIVATE_KEY");
    } else {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Fix formatting for Netlify env vars
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
    }
  }
} catch (e) {
  console.error("Firebase Init Error:", e);
}

const db = admin.firestore();

// --- HELPER FUNCTIONS ---
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***.com';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return email;
  return user.slice(0, 2) + '***@' + domain;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

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
           year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        return `
          <div class="reply-item" itemscope itemtype="https://schema.org/CreativeWork">
            <div itemscope itemtype="https://schema.org/Comment" itemprop="comment">
              <div class="comment-header">
                <div class="comment-author-info">
                  <span class="comment-author" itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">${escapeHtml(reply.name)}</span></span>
                  <span class="comment-email">${maskEmail(reply.email)}</span>
                </div>
                <time class="comment-date" datetime="${reply.created_at}" itemprop="datePublished">${formattedReplyDate}</time>
              </div>
              <div class="comment-text" itemprop="text">${escapeHtml(reply.comment)}</div>
            </div>
          </div>`;
      }).join('')}
    </div>` : '';

  const repliesCount = comment.replies ? comment.replies.length : 0;
  const viewRepliesBtn = repliesCount > 0 ? `
    <button class="view-replies-btn" data-comment-id="${comment.id}" onclick="toggleReplies(event, '${comment.id}')">
      <span class="replies-text">View ${repliesCount} ${repliesCount === 1 ? 'Reply' : 'Replies'}</span>
      <span class="arrow">▼</span>
    </button>` : '';

  return `
    <div class="comment-item" data-comment-id="${comment.id}" itemscope itemtype="https://schema.org/CreativeWork">
      <div itemscope itemtype="https://schema.org/Comment" itemprop="comment">
        <div class="comment-header">
          <div class="comment-author-info">
            <span class="comment-author" itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">${escapeHtml(comment.name)}</span></span>
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
    </div>`;
}

// --- MAIN HANDLER ---
async function handler(event, context) {
  try {
    // 1. LOCATE TEMPLATE (Updated with Debugging Info)
    const possiblePaths = [
      path.resolve(__dirname, '../../youtube.html'),
      path.resolve(__dirname, '../youtube.html'),
      path.resolve('youtube.html'),
      path.resolve('./youtube.html')
    ];
    let templatePath = possiblePaths.find(p => fs.existsSync(p));

    // If not found, throw explicit error to see in browser
    if (!templatePath) {
      const currentDirFiles = fs.readdirSync(__dirname);
      const rootFiles = fs.readdirSync(process.cwd());
      throw new Error(`
        Template 'youtube.html' not found!
        Searched paths: ${possiblePaths.join(', ')}
        Current Dir (__dirname): ${__dirname}
        Files in Current Dir: ${currentDirFiles.join(', ')}
        Root Dir (cwd): ${process.cwd()}
        Files in Root: ${rootFiles.join(', ')}
      `);
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    // 2. CHECK FIREBASE KEYS (Fail Loudly)
    if (!process.env.FIREBASE_PRIVATE_KEY) throw new Error("Missing Env Var: FIREBASE_PRIVATE_KEY");
    if (!process.env.FIREBASE_CLIENT_EMAIL) throw new Error("Missing Env Var: FIREBASE_CLIENT_EMAIL");

    // 3. FETCH DATA
    const commentsRef = db.collection('comments')
      .where('page', '==', 'youtube')
      .where('parentId', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(20);

    const snapshot = await commentsRef.get();

    // 4. PROCESS DATA
    const topComments = [];
    snapshot.forEach(doc => {
      topComments.push({
        id: doc.id,
        name: doc.data().userName || 'Student',
        email: doc.data().userEmail,
        comment: doc.data().comment,
        created_at: doc.data().createdAt?.toDate?.() || new Date(),
        replies: [] 
      });
    });

    // Fetch Replies
    const commentIds = topComments.map(c => c.id);
    if (commentIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < commentIds.length; i += 10) {
        chunks.push(commentIds.slice(i, i + 10));
      }
      const allReplies = [];
      for (const chunk of chunks) {
        const rSnap = await db.collection('comments').where('parentId', 'in', chunk).orderBy('createdAt', 'asc').get();
        rSnap.forEach(doc => allReplies.push({
          id: doc.id, parentId: doc.data().parentId, name: doc.data().userName || 'Student',
          email: doc.data().userEmail, comment: doc.data().comment, created_at: doc.data().createdAt?.toDate?.() || new Date()
        }));
      }
      topComments.forEach(parent => {
        parent.replies = allReplies.filter(r => r.parentId === parent.id);
      });
    }

    // 5. INJECT HTML (Safe Regex Method)
    const commentsHtml = topComments.map(renderCommentHtml).join('');

    // Update Title
    const countSnapshot = await db.collection('comments').where('page', '==', 'youtube').where('parentId', '==', null).count().get();
    const titleText = `${countSnapshot.data().count} Student Reviews`;

    // Replace Title safely
    html = html.replace(/<h3[^>]*id="commentsTitle"[^>]*>.*?<\/h3>/s, 
      `<h3 class="comments-title" id="commentsTitle">${titleText}</h3>`);

    // Replace List Container Content safely
    const listRegex = /(<div[^>]*id="commentsList"[^>]*>)([\s\S]*?)(<\/div>)/i;
    if (listRegex.test(html)) {
      html = html.replace(listRegex, `$1${commentsHtml}$3`);
    } else {
      html = html.replace('id="commentsList">', `id="commentsList">${commentsHtml}`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: html,
    };

  } catch (error) {
    console.error("ODB Critical Error:", error);
    // DISPLAY ERROR ON SCREEN FOR DEBUGGING
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: `
        <div style="padding: 2rem; font-family: sans-serif; text-align: center; color: #333;">
          <h1 style="color: #e11d48;">Server Rendering Error</h1>
          <p>The server encountered an error while loading comments.</p>
          <div style="background: #f1f5f9; padding: 1.5rem; border-radius: 8px; text-align: left; margin: 1rem auto; max-width: 800px; overflow: auto; border: 2px solid #e11d48;">
            <strong>Error Message:</strong> ${error.message}<br><br>
            <strong>Stack Trace:</strong><pre>${error.stack}</pre>
          </div>
          <p><em>(Fix this error in Netlify Logs or Environment Variables)</em></p>
        </div>
      `
    };
  }
}

exports.handler = builder(handler);