# Netlify Deployment Setup Instructions

## Required Environment Variables

In your Netlify dashboard, go to **Site settings > Environment variables** and add these:

### Required Variables:
1. **RAZORPAY_KEY_ID** - Your Razorpay Key ID (starts with rzp_test_ or rzp_live_)
2. **RAZORPAY_KEY_SECRET** - Your Razorpay Key Secret  
3. **FIREBASE_PROJECT_ID** - Your Firebase project ID (e.g., sayheyshubh-7051c)
4. **FIREBASE_CLIENT_EMAIL** - Service account email from Firebase
5. **FIREBASE_PRIVATE_KEY** - Private key from Firebase service account JSON (keep \n characters)

### Getting Firebase Environment Variables:
1. Go to Firebase Console > Project Settings > Service Accounts
2. Click "Generate new private key" 
3. From the downloaded JSON, extract:
   - `project_id` → FIREBASE_PROJECT_ID
   - `client_email` → FIREBASE_CLIENT_EMAIL  
   - `private_key` → FIREBASE_PRIVATE_KEY (keep the \n characters as-is)

## Files Created:
- `netlify.toml` - Redirects /api/* to functions
- `netlify/functions/` - Serverless payment processing
- Updated client-side code to work with Netlify

## Deployment:
1. Push changes to your Git repository
2. Netlify will auto-deploy the functions
3. Test payment flow on your live site

Your payment gateway will now work properly on Netlify hosting!