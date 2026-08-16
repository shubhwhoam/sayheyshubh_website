const admin = require('firebase-admin');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const zoologyNotes = require('./data/notes-data.json');
const microbiologyNotes = require('./data/microbiology-notes-data.json');
const notesData = { ...zoologyNotes, ...microbiologyNotes };

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

// Robustly handle the endpoint format
const endpoint = process.env.B2_ENDPOINT.startsWith('https://')
  ? process.env.B2_ENDPOINT
  : `https://${process.env.B2_ENDPOINT}`;

// Automatically extract the region (e.g., 'eu-central-003') from the endpoint string
const region = process.env.B2_ENDPOINT.split('.')[1];

// Initialize Backblaze B2 Client using the S3 protocol
const s3 = new S3Client({
  region: region,
  endpoint: endpoint,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  }
});

const B2_BUCKET = 'sayheyshubh-notes';

// The signed URL only needs to live long enough for pdf.js to start fetching
// the file right when the viewer opens — it's requested fresh on every open.
// Keeping this short (instead of the old 1 hour) means that if someone grabs
// the raw URL out of the browser's Network tab, it's only useful for a couple
// of minutes rather than staying valid and downloadable for the rest of the hour.
const SIGNED_URL_EXPIRY_SECONDS = 180;

// A real B2 object key never looks like a URL. This catches notes that
// haven't been migrated/uploaded to B2 yet (including leftover placeholder
// text like "YOUR_DRIVE_LINK_HERE") and fails cleanly instead of generating
// a signed URL that will just 404 against the bucket.
function isValidB2Key(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  if (value.includes('YOUR_DRIVE_LINK_HERE')) return false;
  return true;
}

exports.handler = async (event, context) => {
  const pathParts = event.path.split('/');
  const noteId = pathParts[pathParts.length - 1];

  try {
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Missing token' }) };
    }
    const idToken = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const storagePath = notesData[noteId];
    if (!isValidB2Key(storagePath)) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'This note isn\'t available yet. Please check back soon.' }) };
    }

    // Security check: confirm the exact purchase record exists in Firestore
    const txSnapshot = await db.collection('transactions')
      .where('userId', '==', userId)
      .where('noteId', '==', noteId)
      .where('status', '==', 'completed')
      .where('verified', '==', true)
      .limit(1)
      .get();

    if (txSnapshot.empty) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Note not purchased' }) };
    }

    const command = new GetObjectCommand({
      Bucket: B2_BUCKET,
      Key: storagePath,
      ResponseContentDisposition: 'inline' // Forces browser to VIEW instead of download
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        previewUrl: signedUrl
      })
    };
  } catch (error) {
    console.error('secure-notes error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Something went wrong loading this note. Please try again.' })
    };
  }
};
