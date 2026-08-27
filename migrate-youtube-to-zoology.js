/**
 * ONE-TIME MIGRATION SCRIPT — run this once, then delete it.
 *
 * Updates every existing comment/rating document in Firestore where
 * page === 'youtube' to page === 'zoology', so your existing comment
 * history keeps showing up on zoology.html after the code rename.
 *
 * HOW TO RUN:
 *   1. npm install firebase-admin   (if not already installed locally)
 *   2. Set these env vars in your terminal (same values as in Netlify):
 *        FIREBASE_PROJECT_ID
 *        FIREBASE_CLIENT_EMAIL
 *        FIREBASE_PRIVATE_KEY   (keep the \n escaping as-is)
 *   3. node migrate-youtube-to-zoology.js
 *   4. Check the output count matches what you expect, then delete this file.
 *
 * Safe to re-run: it only touches docs still tagged 'youtube', so running
 * it twice is a no-op the second time.
 */

const admin = require('firebase-admin');

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

async function migrate() {
  const snapshot = await db.collection('comments').where('page', '==', 'youtube').get();

  if (snapshot.empty) {
    console.log('No documents with page="youtube" found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${snapshot.size} documents to migrate...`);

  // Firestore batches are capped at 500 writes — chunk if you have more.
  const batchSize = 450;
  const docs = snapshot.docs;

  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach((doc) => {
      batch.update(doc.ref, { page: 'zoology' });
    });
    await batch.commit();
    console.log(`Migrated ${Math.min(i + batchSize, docs.length)} / ${docs.length}`);
  }

  console.log('Done. All comments/ratings now tagged page="zoology".');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
