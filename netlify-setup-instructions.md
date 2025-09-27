# Netlify Deployment Setup Instructions

## Required Environment Variables

In your Netlify dashboard, go to **Site settings > Environment variables** and add these:

### Required Variables:
1. **RAZORPAY_KEY_ID** - Your Razorpay Key ID (starts with rzp_test_ or rzp_live_)
2. **RAZORPAY_KEY_SECRET** - Your Razorpay Key Secret  
3. **FIREBASE_SERVICE_ACCOUNT_JSON** - Complete Firebase service account JSON (see below)

### Getting Firebase Service Account JSON:
1. Go to Firebase Console > Project Settings > Service Accounts
2. Click "Generate new private key"
3. Copy the entire JSON content (including curly braces)
4. Paste as the value for FIREBASE_SERVICE_ACCOUNT_JSON

## Files Created:
- `netlify.toml` - Redirects /api/* to functions
- `netlify/functions/` - Serverless payment processing
- Updated client-side code to work with Netlify

## Deployment:
1. Push changes to your Git repository
2. Netlify will auto-deploy the functions
3. Test payment flow on your live site

Your payment gateway will now work properly on Netlify hosting!