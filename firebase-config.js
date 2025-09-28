// =================================================================
// FIREBASE CONFIGURATION AND UTILITY FUNCTIONS
// =================================================================

// Firebase configuration - loaded from server for security
let firebaseConfig = null;

// Function to load Firebase config from server
async function loadFirebaseConfig() {
  try {
    const response = await fetch('/.netlify/functions/public-config');
    const config = await response.json();
    return {
      apiKey: config.firebaseApiKey || "AIzaSyDo2dd1484akY3VmHM0lzQlF1DhX35FD94",
      authDomain: config.firebaseAuthDomain || "sayheyshubh-7051c.firebaseapp.com",
      projectId: config.firebaseProjectId || "sayheyshubh-7051c",
      storageBucket: config.firebaseStorageBucket || "sayheyshubh-7051c.firebasestorage.app",
      messagingSenderId: config.firebaseMessagingSenderId || "992127392588",
      appId: config.firebaseAppId || "1:992127392588:web:62f89024de9d48c1144de9",
      measurementId: config.firebaseMeasurementId || "G-HMQJKKEKPE"
    };
  } catch (error) {
    console.warn('Failed to load config from server, using fallback values');
    return {
      apiKey: "AIzaSyDo2dd1484akY3VmHM0lzQlF1DhX35FD94",
      authDomain: "sayheyshubh-7051c.firebaseapp.com",
      projectId: "sayheyshubh-7051c",
      storageBucket: "sayheyshubh-7051c.firebasestorage.app",
      messagingSenderId: "992127392588",
      appId: "1:992127392588:web:62f89024de9d48c1144de9",
      measurementId: "G-HMQJKKEKPE"
    };
  }
}

// Initialize Firebase asynchronously
let auth, db;
(async function initializeFirebase() {
  firebaseConfig = await loadFirebaseConfig();
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
})();

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

// Sign out function
function handleSignOut() {
    auth.signOut().then(() => {
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userPhone');
        window.location.href = 'youtube.html';
    }).catch((error) => {
        console.error('Sign out error:', error);
        alert('Failed to sign out. Please try again.');
    });
}