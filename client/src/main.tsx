import React, { useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import App from './App';
import './styles.css';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email';

function GmailAccessBridge() {
  const pendingRef = useRef(null);
  const cachedRef = useRef({ token: '', expiresAt: 0 });
  const login = useGoogleLogin({
    scope: gmailSendScope,
    prompt: 'select_account',
    onSuccess: (response) => {
      const token = response?.access_token || '';
      const expiresIn = Number(response?.expires_in || 3600);
      cachedRef.current = { token, expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000 };
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) pending.resolve(token);
    },
    onError: () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) pending.reject(new Error('Gmail permission is required to send this request from your email.'));
    },
    onNonOAuthError: () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) pending.reject(new Error('Google authorization could not be completed. Please allow the Google authorization window and try again.'));
    }
  });

  const requestGmailAccess = useCallback(() => {
    const cached = cachedRef.current;
    if (cached.token && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
    if (pendingRef.current) return pendingRef.current.promise;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    pendingRef.current = { promise, resolve: resolvePromise, reject: rejectPromise };
    login();
    return promise;
  }, [login]);

  return <App requestGmailAccess={requestGmailAccess}/>;
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline/PWA support is an enhancement; registration failure must not block the app.
    });
  });
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {clientId ? <GoogleOAuthProvider clientId={clientId}><GmailAccessBridge /></GoogleOAuthProvider> : <App />}
  </React.StrictMode>
);
