/**
 * ONE-TIME BACKFILL SCRIPT
 * -------------------------------------------------------------------------
 * Root cause: before the cart feature shipped (commit b66d6e5, 2026-08-09),
 * purchase transactions in Firestore's `transactions` collection were only
 * ever written with a `noteUrl` field (the Google Drive / short.gy link) -
 * never a `noteId` field (e.g. "unit-1-dsc-5").
 *
 * When check-purchases.js was refactored (commit b84e53b, 2026-08-15) to use
 * `transactions` as the single source of truth, it started trusting only the
 * `noteId` field on each transaction doc. Every transaction created before
 * 2026-08-09 has no `noteId`, so those completed & verified purchases are now
 * silently skipped - the notes look locked again even though the user paid.
 *
 * This script finds every completed+verified transaction missing `noteId`,
 * derives the correct noteId from its old noteUrl (via the legacy Drive
 * fileId -> noteId map), and permanently writes `noteId` onto the doc.
 * After this runs once, check-purchases.js's fallback logic becomes
 * unnecessary for these old docs (though it's safe to leave in place).
 *
 * Usage:
 *   node backfill-legacy-noteids.js            # dry run, just prints a report
 *   node backfill-legacy-noteids.js --apply    # actually writes the fix
 *
 * Requires the same FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY env vars (or default credentials) as the other
 * scripts in this repo.
 */

const admin = require('firebase-admin');
const legacyFileIdToNoteId = require('./legacy-fileid-map.json');

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

function deriveLegacyNoteId(noteUrl) {
  if (!noteUrl) return null;
  const driveMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
  if (driveMatch && legacyFileIdToNoteId[driveMatch[1]]) {
    return legacyFileIdToNoteId[driveMatch[1]];
  }
  return null;
}

async function backfill() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '🔧 Running in APPLY mode - Firestore will be updated.' : '🔍 Running in DRY-RUN mode - no writes will happen. Pass --apply to write.');

  const snapshot = await db.collection('transactions')
    .where('status', '==', 'completed')
    .where('verified', '==', true)
    .get();

  console.log(`📊 Found ${snapshot.size} completed+verified transactions total.`);

  const missingNoteId = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (!data.noteId) missingNoteId.push({ id: doc.id, ref: doc.ref, data });
  });

  console.log(`🕵️  ${missingNoteId.length} of those are missing a noteId (legacy, pre-cart-feature purchases).`);

  let resolved = 0;
  let unresolved = 0;
  const unresolvedList = [];
  const usersToTouch = {}; // userId -> Set of noteIds, for an optional users.unlockedNotes mirror

  for (const { id, ref, data } of missingNoteId) {
    const noteId = deriveLegacyNoteId(data.noteUrl);
    if (!noteId) {
      unresolved++;
      unresolvedList.push({ docId: id, userId: data.userId, noteUrl: data.noteUrl });
      continue;
    }
    resolved++;
    console.log(`  ✅ ${id}  ->  noteId: ${noteId}  (user: ${data.userId})`);
    if (!usersToTouch[data.userId]) usersToTouch[data.userId] = new Set();
    usersToTouch[data.userId].add(noteId);

    if (apply) {
      await ref.update({ noteId });
    }
  }

  console.log(`\n✨ Resolved: ${resolved}   ❌ Unresolved: ${unresolved}`);
  if (unresolvedList.length) {
    console.log('⚠️  Could not resolve these - inspect manually (unrecognized noteUrl format, e.g. short.gy links not in the legacy map):');
    console.log(JSON.stringify(unresolvedList, null, 2));
  }

  if (apply) {
    console.log('\n💾 Firestore transaction docs updated with noteId.');
  } else {
    console.log('\n👉 This was a dry run. Re-run with --apply to write the fix.');
  }
}

backfill()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('💥 Backfill failed:', err);
    process.exit(1);
  });
