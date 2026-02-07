// =================================================================
// PAGE PROTECTION & PROFILE DISPLAY LOGIC (for notes and beyond)
// This file assumes firebase-config.js is loaded first.
// =================================================================

let currentUserData = null; // Global variable to store Firestore data

auth.onAuthStateChanged(function(user) {
    if (user) {
        // 1. User is signed in. Check device and load profile data.
        checkDeviceAndLoadProfile(user);
    } else {
        // 2. User is NOT signed in. Redirect to YouTube page for login.
        // This is necessary if they navigate directly or session expires.
        // Add a parameter to indicate that login popup should be shown
        window.location.href = 'youtube?showLogin=true';
    }
});

function checkDeviceAndLoadProfile(user) {
    const deviceId = getDeviceId();
    const userRef = db.collection('users').doc(user.uid);

    userRef.get().then(doc => {
        if (!doc.exists) {
            auth.signOut();
            throw new Error("User data not found, signing out.");
        }

        const data = doc.data();
        const devices = data.devices || {};

        if (!devices[deviceId]) {
            // Device is not registered (session expired, or data modified)
            auth.signOut();
            alert("Your session has expired or the device limit was exceeded. Please log in again.");
            window.location.href = 'youtube?showLogin=true';
            return;
        }

        // Device is valid. Store data and render header.
        window.currentUserData = data; // Make data globally accessible for paywall logic
        renderProfileHeader(user, data);
        
        // Initialize payment system now that authentication is confirmed
        if (typeof initializePaymentForAuthenticatedUser === 'function') {
            initializePaymentForAuthenticatedUser(user.uid);
        }

    }).catch(error => {
        console.error("Profile check failed:", error);
        auth.signOut();
        alert("Authentication check failed. Redirecting to login.");
        window.location.href = 'youtube?showLogin=true';
    });
}

function renderProfileHeader(user, data) {
    const header = document.querySelector('header');
    if (!header) return; // Cannot add header if <header> element is missing

    const navFlex = header.querySelector('.nav-flex');
    if (!navFlex) {
        console.warn("Could not find .nav-flex to place profile header.");
        return;
    }

    // Get the primary credential (email is preferred, otherwise phone)
    const primaryCredential = user.email || user.phoneNumber;
    const maskedCred = maskCredential(primaryCredential); // Uses the function from firebase-config.js
    
    // Use fallback name if data.name is missing
    const displayName = data.name || user.displayName || 'User';

    const profileHTML = `
        <div id="profileHeader">
            <div class="profile-info">
                <div class="profile-name">${displayName}</div>
                <div class="profile-contact">${maskedCred}</div>
            </div>
            <button id="logoutBtn" class="profile-logout-btn">Logout</button>
        </div>
    `;

    // Remove old header if it exists and insert the new one
    if (document.getElementById('profileHeader')) {
        document.getElementById('profileHeader').remove();
    }

    // Insert the profile section right before the existing <nav> element in the header
    const nav = header.querySelector('nav');
    if (nav) {
        nav.insertAdjacentHTML('beforebegin', profileHTML);
    } else {
        navFlex.insertAdjacentHTML('beforeend', profileHTML);
    }

    // Attach logout listener (uses handleSignOut from firebase-config.js)
    document.getElementById('logoutBtn').addEventListener('click', handleSignOut);
}