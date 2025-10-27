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

async function getUserPurchasedNotes(userId) {
  const transactionsSnapshot = await db.collection('transactions')
    .where('userId', '==', userId)
    .where('status', '==', 'completed')
    .where('verified', '==', true)
    .get();

  const purchasedNotes = [];
  transactionsSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.noteUrl) {
      purchasedNotes.push(data.noteUrl);
    }
  });

  return purchasedNotes;
}

function extractNoteId(noteUrl) {
  if (noteUrl && noteUrl.includes('drive.google.com/file/d/')) {
    const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    return fileIdMatch ? fileIdMatch[1] : null;
  }
  return null;
}

function sanitizeNotesForUser(notesConfig, purchasedNotes, semesterKey) {
  const semesterData = notesConfig[semesterKey];
  if (!semesterData) {
    return null;
  }

  const sanitized = {
    title: semesterData.title,
    syllabus: semesterData.syllabus,
    syllabusUrl: semesterData.syllabusUrl || null,
    subjects: {}
  };

  Object.keys(semesterData.subjects).forEach(subjectName => {
    const subject = semesterData.subjects[subjectName];
    sanitized.subjects[subjectName] = {
      color: subject.color || 'subject-color-1',
      units: []
    };

    subject.units.forEach(unit => {
      const unitData = {
        title: unit.title,
        videoUrl: unit.videoUrl || null,
        status: unit.status || null
      };

      if (unit.status === 'coming-soon') {
        unitData.status = 'coming-soon';
      } else if (unit.noteUrl) {
        if (unit.requiresPayment === false || purchasedNotes.includes(unit.noteUrl)) {
          unitData.noteId = extractNoteId(unit.noteUrl);
          unitData.hasAccess = true;
        } else {
          unitData.hasAccess = false;
          unitData.requiresPayment = true;
        }
      }

      sanitized.subjects[subjectName].units.push(unitData);
    });
  });

  return sanitized;
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

    const semesterKey = event.queryStringParameters?.semester;
    if (!semesterKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing semester parameter' })
      };
    }

    const notesConfigPath = path.join(process.cwd(), 'notes-config.json');
    const notesConfig = JSON.parse(fs.readFileSync(notesConfigPath, 'utf8'));

    const purchasedNotes = await getUserPurchasedNotes(authenticatedUserId);

    const sanitizedData = sanitizeNotesForUser(notesConfig, purchasedNotes, semesterKey);

    if (!sanitizedData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Semester not found' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: sanitizedData
      })
    };

  } catch (error) {
    console.error('Error in get-notes:', error);
    
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
