const admin = require('firebase-admin');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const zoologyNotes = require('../../notes-data.json'); 
const microbiologyNotes = require('../../microbiology-notes-data.json'); 
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

exports.handler = async (event, context) => {
  const pathParts = event.path.split('/');
  const noteId = pathParts[pathParts.length - 1];

  try {
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Missing token' }) };
    }
    const idToken = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const storagePath = notesData[noteId];
    if (!storagePath) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Note not found' }) };
    }

    // Security Check: Look for the exact purchase record in Firestore
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

    // Generate a secure Backblaze B2 URL that expires in 3600 seconds (1 hour)
    const command = new GetObjectCommand({
      Bucket: 'sayheyshubh-notes', // Ensure this matches your exact bucket name
      Key: storagePath,
      ResponseContentDisposition: 'inline' // Forces browser to VIEW instead of download
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
         success: true, 
         previewUrl: signedUrl 
       })
    };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};