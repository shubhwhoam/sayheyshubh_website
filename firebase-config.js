// =================================================================
// FIREBASE CONFIGURATION AND UTILITY FUNCTIONS
// =================================================================

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDo2dd1484akY3VmHM0lzQlF1DhX35FD94",
  authDomain: "sayheyshubh-7051c.firebaseapp.com",
  projectId: "sayheyshubh-7051c",
  storageBucket: "sayheyshubh-7051c.firebasestorage.app",
  messagingSenderId: "992127392588",
  appId: "1:992127392588:web:62f89024de9d48c1144de9",
  measurementId: "G-HMQJKKEKPE"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Utility functions
function getDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substr(2, 16);
        localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
}

function maskCredential(credential) {
    if (!credential) return '***';
    
    if (credential.includes('@')) {
        // Email masking
        const [user, domain] = credential.split('@');
        if (user.length <= 2) return credential;
        return user.slice(0, 2) + '***@' + domain;
    } else {
        // Phone number masking
        if (credential.length <= 4) return credential;
        return credential.slice(0, -4) + '****';
    }
}

// =================================================================
// SUBJECT LOGIN TRACKING (new — additive only, does not touch
// the existing `users` collection or any auth/purchase logic)
// =================================================================
// Writes one document to a new `loginEvents` collection the first
// time a logged-in user is seen on a given subject in this browser
// session. Safe to call on every page load / every auth state
// change — it no-ops after the first successful write per subject
// per tab session, so it will never spam Firestore.
function trackSubjectLogin(user, subject) {
    if (!user || !user.uid || !subject) return;
    const sessionKey = 'loggedSubject_' + subject;
    if (sessionStorage.getItem(sessionKey)) return; // already logged this session

    db.collection('loginEvents').add({
        uid: user.uid,
        name: user.displayName || null,
        email: user.email || user.phoneNumber || null,
        subject: subject,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        sessionStorage.setItem(sessionKey, '1');
    }).catch((error) => {
        // Never let tracking failures affect login/purchase flows
        console.warn('Login tracking skipped:', error.message);
    });
}

// Sign out function
function handleSignOut() {
    auth.signOut().then(() => {
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userPhone');
        window.location.href = 'zoology';
    }).catch((error) => {
        console.error('Sign out error:', error);
        alert('Failed to sign out. Please try again.');
    });
}