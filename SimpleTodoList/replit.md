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
Protected educational content (study notes) is gated behind authentication using Firebase. The `page-protection.js` handles session validation and redirects unauthorized users. The system checks both user authentication status and device registration before allowing access to premium content.

## Static File Architecture
The website uses a Node.js development server (`server.js`) for local development, serving static files with appropriate MIME types and CORS headers. This approach allows for easy deployment to static hosting platforms while providing a development environment with proper file serving capabilities.

## Navigation and User Experience
The site implements a consistent navigation structure across all pages with a responsive header that adapts to scroll position. Mobile navigation uses a hamburger menu with smooth animations. The design prioritizes accessibility and performance with optimized loading strategies.

# External Dependencies

## Firebase Services
- **Firebase Authentication**: User sign-in and session management
- **Cloud Firestore**: User data storage, device management, and content access control
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

## Third-party Integrations
The site is designed to accommodate future integrations with educational platforms and content delivery networks for the study materials section. The Firebase backend provides scalability for user management and content protection features.