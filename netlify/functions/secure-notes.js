const admin = require('firebase-admin');
// We use relative path to go up two levels to root
const notesData = require('../../notes-data.json'); 

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
    admin.initializeApp({ projectId: 'sayheyshubh-7051c' });
  }
}

const db = admin.firestore();

exports.handler = async (event, context) => {
  // Extract ID from path (e.g., /secure-notes/unit-1-dsc-1)
  const pathParts = event.path.split('/');
  const noteId = pathParts[pathParts.length - 1];

  try {
    // 1. Verify User
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Missing token' }) };
    }
    const idToken = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // 2. Resolve ID to URL
    const realUrl = notesData[noteId];
    if (!realUrl) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Note not found' }) };
    }

    // 3. Extract File ID for DB check
    const fileIdMatch = realUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;

    if (!fileId) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Invalid config' }) };
    }

    // 4. Check DB for access
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData?.unlockedNotes?.[fileId]) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Note not purchased' }) };
    }

    // 5. Success
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        previewUrl: `https://drive.google.com/file/d/${fileId}/preview` 
      })
    };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};