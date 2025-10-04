const admin = require('firebase-admin');

// Initialize Firebase Admin with secure environment variables
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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('🔄 Starting fix for unlocked notes...');
    
    // Get all completed transactions
    const transactionsSnapshot = await db.collection('transactions')
      .where('status', '==', 'completed')
      .get();
    
    console.log(`📊 Found ${transactionsSnapshot.size} completed transactions`);
    
    let updatedCount = 0;
    let alreadyVerifiedCount = 0;
    
    let batch = db.batch();
    let batchCount = 0;
    
    for (const doc of transactionsSnapshot.docs) {
      const data = doc.data();
      
      // If transaction doesn't have verified flag or it's false, set it to true
      if (data.verified !== true) {
        batch.update(doc.ref, { verified: true });
        updatedCount++;
        batchCount++;
        
        // Firestore batch limit is 500 operations
        if (batchCount >= 500) {
          await batch.commit();
          console.log(`✅ Committed batch of ${batchCount} updates`);
          // Create a new batch for the next set of operations
          batch = db.batch();
          batchCount = 0;
        }
      } else {
        alreadyVerifiedCount++;
      }
    }
    
    // Commit remaining updates
    if (batchCount > 0) {
      await batch.commit();
      console.log(`✅ Committed final batch of ${batchCount} updates`);
    }
    
    const result = {
      success: true,
      totalTransactions: transactionsSnapshot.size,
      updatedCount: updatedCount,
      alreadyVerifiedCount: alreadyVerifiedCount,
      message: `Successfully restored ${updatedCount} unlocked notes. ${alreadyVerifiedCount} were already verified.`
    };
    
    console.log('✨ Migration completed:', result);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Migration failed'
      })
    };
  }
};
