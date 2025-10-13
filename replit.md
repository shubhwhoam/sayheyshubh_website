# Overview

SayHeyShubh is a personal portfolio and educational website for Shubham Kumar, a BSc Zoology student who serves as a UGC creator, content writer, and digital marketer. The site features a comprehensive study notes section with authentication, a portfolio showcasing digital marketing projects, a blog section, and various informational pages. The platform combines personal branding with educational resources, providing protected access to detailed study materials organized by academic year and semester.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The application follows a traditional multi-page architecture using vanilla HTML, CSS, and JavaScript. Each page is a separate HTML file with shared styling through a central `style.css` file and common functionality via `script.js`. The design emphasizes responsive layouts with mobile-first principles, utilizing CSS Grid and Flexbox for layout management.

## Authentication System
The authentication system is built around Firebase Authentication with custom device management. Users authenticate through a YouTube page entry point, with sessions tied to specific device IDs stored in localStorage. The system implements a device limit mechanism where user sessions are validated against registered devices in Firestore, preventing unauthorized access and session sharing.

## Content Protection Strategy
Protected educational content (study notes) is gated behind authentication and payment using Firebase and Razorpay. The `page-protection.js` handles session validation and redirects unauthorized users. The system checks authentication status, device registration, and purchase verification before allowing access to premium content.

## Payment System Architecture (Razorpay Integration)
The payment system implements a secure, idempotent architecture to prevent duplicate unlocks and ensure notes remain unlocked forever once purchased.

### Key Security Features:
- **Server-Side Validation**: All noteUrl values are fetched from the database, never trusted from client input
- **Idempotent Transactions**: Uses deterministic document IDs (paymentId) with atomic create() operations to prevent duplicates
- **User Authorization**: Validates that the authenticated user matches the order's userId before unlocking
- **Webhook Support**: Razorpay webhook with HMAC signature verification handles async payment notifications
- **Deterministic Order Storage**: Orders stored with orderId as document ID to prevent duplicate order records

### Payment Flow:
1. **Order Creation**: User requests note purchase, server creates Razorpay order and stores order metadata (userId, noteUrl) in Firestore using orderId as document ID
2. **Payment Processing**: Razorpay handles payment UI and processes transaction
3. **Dual Verification Path**: 
   - Frontend path: Client sends payment details, server fetches order from database, validates user, unlocks note
   - Webhook path: Razorpay sends webhook, server verifies HMAC signature, fetches order, unlocks note
4. **Idempotent Unlock**: Both paths call shared `unlockNoteForUser` helper that uses `transactionRef.create()` with paymentId as doc ID for atomic deduplication
5. **Purchase Verification**: `check-purchases` endpoint uses transactions collection (with verified=true) as single source of truth

### Database Collections:
- **orders**: Stores order metadata (orderId as doc ID, userId, noteUrl, amount, status)
- **transactions**: Records completed payments (paymentId as doc ID, userId, noteUrl, verified flag)
- **users/{userId}/unlockedNotes**: Maps noteSlug to boolean for quick access checks

### Migration Support:
The `fix-unlocked-notes.js` function restores notes for users affected by the previous race condition bug, adding verified=true flags to existing transactions with proper batch handling for large datasets.

## Static File Architecture
The website uses a Node.js development server (`server.js`) for local development, serving static files with appropriate MIME types and CORS headers. This approach allows for easy deployment to static hosting platforms while providing a development environment with proper file serving capabilities.

## Navigation and User Experience
The site implements a consistent navigation structure across all pages with a responsive header that adapts to scroll position. Mobile navigation uses a hamburger menu with smooth animations. The design prioritizes accessibility and performance with optimized loading strategies.

## Comment System Architecture
The YouTube page features a user feedback and comment system with the following characteristics:
- **Authentication Required**: Users must be logged in via Firebase to post comments or replies
- **Firebase Firestore Database**: Comments stored in `comments` collection with flat structure using `parentId` field for threaded replies
- **Environment-Aware API**: JavaScript automatically detects environment (local vs deployed) and uses appropriate endpoints:
  - Local development: `/api/comments` (Node.js server)
  - Netlify deployment: `/.netlify/functions/post-comment` and `/.netlify/functions/get-comments`
- **User Profile Display**: Shows authenticated user info in header with avatar, masked contact details, and logout functionality
- **Comment Features**: 
  - Pagination support with offset-based loading
  - Nested replies with expand/collapse "View Replies" button to prevent screen overflow
  - Character limits (1000 chars) and input validation
  - Real-time comment posting and reply functionality

# External Dependencies

## Firebase Services
- **Firebase Authentication**: User sign-in and session management
- **Cloud Firestore**: User data storage, device management, content access control, and comments storage
- **Firestore Collections**:
  - `users`: User profiles and unlocked notes
  - `orders`: Razorpay order metadata
  - `transactions`: Verified payment records
  - `comments`: User comments and replies (requires composite index on `page + parentId + createdAt`)
- Firebase configuration includes analytics and measurement services for user tracking

## Analytics and Tracking
- **Google Analytics 4**: Comprehensive user behavior tracking across all pages
- **Google Tag Manager**: Advanced event tracking and conversion monitoring

## Font and Icon Libraries
- **Google Fonts**: Inter font family for modern typography
- **Font Awesome**: Icon library for UI elements and visual enhancements

## Development Tools
- **Node.js HTTP Server**: Local development server for static file serving
- Custom MIME type handling for various file formats including images and documents

## Database
- **PostgreSQL**: Available but not currently in use (previously used for comments, now migrated to Firestore)
- All data now stored in Firebase Firestore for unified backend infrastructure

## Payment Gateway
- **Razorpay**: Payment processing for note purchases with webhook support for reliable payment verification
- Requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables
- Webhook endpoint must be configured in Razorpay dashboard to point to verify-payment function

## Third-party Integrations
The site uses Firebase for authentication and data storage, Razorpay for secure payment processing, Google Analytics for tracking, and is designed to accommodate future integrations with educational platforms and content delivery networks.