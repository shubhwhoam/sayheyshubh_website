const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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
    admin.initializeApp({
      projectId: 'sayheyshubh-7051c'
    });
  }
}

const db = admin.firestore();

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

async function verifyFirebaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Invalid authentication token');
  }
}

function findNoteByIdInConfig(notesConfig, noteId) {
  for (const semesterKey in notesConfig) {
    const semester = notesConfig[semesterKey];
    if (!semester.subjects) continue;

    for (const subjectName in semester.subjects) {
      const subject = semester.subjects[subjectName];
      if (!subject.units) continue;

      for (const unit of subject.units) {
        if (unit.noteUrl && unit.noteUrl.includes(noteId)) {
          return {
            noteUrl: unit.noteUrl,
            requiresPayment: unit.requiresPayment !== false
          };
        }
      }
    }
  }
  return null;
}

async function hasUserPurchasedNote(userId, noteUrl) {
  const transactionsSnapshot = await db.collection('transactions')
    .where('userId', '==', userId)
    .where('noteUrl', '==', noteUrl)
    .where('status', '==', 'completed')
    .where('verified', '==', true)
    .get();

  return !transactionsSnapshot.empty;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const decodedToken = await verifyFirebaseToken(event.headers.authorization);
    const authenticatedUserId = decodedToken.uid;

    const noteId = event.queryStringParameters?.noteId;
    if (!noteId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing noteId parameter' })
      };
    }

    const notesConfigPath = path.join(__dirname, 'config', 'notes-config.json');
    const notesConfig = JSON.parse(fs.readFileSync(notesConfigPath, 'utf8'));

    const noteData = findNoteByIdInConfig(notesConfig, noteId);
    
    if (!noteData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Note not found' })
      };
    }

    if (noteData.requiresPayment) {
      const hasPurchased = await hasUserPurchasedNote(authenticatedUserId, noteData.noteUrl);
      
      if (!hasPurchased) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Payment required',
            requiresPayment: true
          })
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        noteUrl: noteData.noteUrl
      })
    };

  } catch (error) {
    console.error('Error in secure-notes:', error);
    
    if (error.message.includes('authorization') || error.message.includes('authentication')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error' })
    };
  }
};
