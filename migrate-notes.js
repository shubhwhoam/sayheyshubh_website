const admin = require('firebase-admin');

// Initialize Firebase Admin
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
    // Fallback initialization for development
    admin.initializeApp({
      projectId: 'sayheyshubh-7051c'
    });
  }
}

const db = admin.firestore();

// Function to extract proper noteSlug from Google Drive URL
function extractNoteSlug(noteUrl) {
  if (noteUrl.includes('drive.google.com/file/d/')) {
    // Extract the file ID from Google Drive URL
    const fileIdMatch = noteUrl.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
    return fileIdMatch ? fileIdMatch[1] : noteUrl.split('/').pop();
  } else {
    return noteUrl.split('/').pop();
  }
}

async function migrateExistingPurchases() {
  console.log('🔄 Starting migration of existing purchases...');
  
  try {
    // Get all completed transactions
    const transactionsSnapshot = await db.collection('transactions')
      .where('status', '==', 'completed')
      .get();
    
    console.log(`📊 Found ${transactionsSnapshot.size} completed transactions`);
    
    // Group transactions by user
    const userTransactions = {};
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.userId && data.noteUrl) {
        if (!userTransactions[data.userId]) {
          userTransactions[data.userId] = [];
        }
        userTransactions[data.userId].push(data);
      }
    });
    
    console.log(`👥 Found transactions for ${Object.keys(userTransactions).length} users`);
    
    // Process each user
    let successCount = 0;
    let errorCount = 0;
    
    for (const [userId, transactions] of Object.entries(userTransactions)) {
      try {
        console.log(`\n🔧 Processing user: ${userId}`);
        
        // Build the correct unlockedNotes object
        const unlockedNotes = {};
        
        for (const transaction of transactions) {
          const correctNoteSlug = extractNoteSlug(transaction.noteUrl);
          unlockedNotes[correctNoteSlug] = true;
          console.log(`  ✅ Adding note: ${correctNoteSlug} from URL: ${transaction.noteUrl}`);
        }
        
        // Update the user's document with correct unlockedNotes
        const userRef = db.collection('users').doc(userId);
        await userRef.set({
          unlockedNotes: unlockedNotes
        }, { merge: true });
        
        console.log(`  ✅ Updated ${Object.keys(unlockedNotes).length} notes for user ${userId}`);
        successCount++;
        
      } catch (error) {
        console.error(`  ❌ Error processing user ${userId}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n🎉 Migration completed!');
    console.log(`✅ Successfully processed: ${successCount} users`);
    console.log(`❌ Errors: ${errorCount} users`);
    
    if (errorCount === 0) {
      console.log('🎊 All purchases have been successfully migrated!');
      console.log('📝 Users can now access their previously purchased notes.');
    }
    
  } catch (error) {
    console.error('💥 Migration failed:', error);
  }
}

// Run the migration
if (require.main === module) {
  migrateExistingPurchases()
    .then(() => {
      console.log('✨ Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateExistingPurchases };