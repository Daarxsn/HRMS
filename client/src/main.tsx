import React from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import './styles.css';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline/PWA support is an enhancement; registration failure must not block the app.
    });
  });
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {clientId ? <GoogleOAuthProvider clientId={clientId}><App /></GoogleOAuthProvider> : <App />}
  </React.StrictMode>
);
