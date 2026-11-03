'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { get, post, todayLocal } from '../src/api';
import {
  AppContext,
  Shell,
  LoginScreen,
  IconLogo,
  Toast,
  AppErrorBoundary
} from '../src/App';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const [bootError, setBootError] = useState('');
  const [notifications, setNotifications] = useState({ unread: 0, notifications: [] });
  const [refresh, setRefresh] = useState(0);
  const [currentDate, setCurrentDate] = useState(() => todayLocal());

  useEffect(() => {
    let activeToday = todayLocal();
    const syncCurrentDate = () => {
      const fresh = todayLocal();
      if (fresh !== activeToday) {
        activeToday = fresh;
        setCurrentDate(fresh);
      }
    };
    const timer = window.setInterval(syncCurrentDate, 15000);
    window.addEventListener('focus', syncCurrentDate);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncCurrentDate();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', syncCurrentDate);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          // Progressive shell caching; failures never block the app.
        });
      });
    }
  }, []);

  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('hrms-theme') || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('hrms-theme', theme);
    } catch {}
  }, [theme]);

  const notify = (message: string, type = 'success') => setToast({ message, type });

  const refreshNotifications = async () => {
    if (!user) return;
    try {
      setNotifications(await get('/account/notifications'));
    } catch {}
  };

  useEffect(() => {
    let live = true;
    const safetyTimer = setTimeout(() => {
      if (live) setLoading(false);
    }, 5000);

    Promise.allSettled([get('/auth/me')])
      .then(([me]) => {
        if (!live) return;
        clearTimeout(safetyTimer);
        if (me.status === 'fulfilled') setUser(me.value.user);
        if (me.status === 'rejected' && (me.reason as any)?.status !== 401) {
          setBootError((me.reason as any)?.message || 'We could not reach the HRMS server.');
        }
        setLoading(false);
      })
      .catch(() => {
        if (live) {
          clearTimeout(safetyTimer);
          setLoading(false);
        }
      });

    return () => {
      live = false;
      clearTimeout(safetyTimer);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNotifications();
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 60000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user, refresh]);

  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null);
      try {
        if (typeof window !== 'undefined' && window.location.pathname !== '/' && window.location.pathname !== '/login') {
          sessionStorage.setItem('fx_hrms_return_url', window.location.pathname + window.location.search);
        }
      } catch {}
      setToast({ message: 'Your session has expired. Please sign in again.', type: 'error' });
    };
    window.addEventListener('hrms:session-expired', onSessionExpired);
    return () => window.removeEventListener('hrms:session-expired', onSessionExpired);
  }, []);

  useEffect(() => {
    if (!loading && !user && typeof window !== 'undefined' && window.location.pathname !== '/' && window.location.pathname !== '/login') {
      try {
        sessionStorage.setItem('fx_hrms_return_url', window.location.pathname + window.location.search);
      } catch {}
    }
  }, [loading, user]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      notify,
      refresh: () => setRefresh((v) => v + 1),
      notifications,
      refreshNotifications,
      theme,
      setTheme,
      today: currentDate,
      currentDate,
    }),
    [user, notifications, theme, currentDate]
  );

  const retryBoot = () => {
    setBootError('');
    setLoading(true);
    if (typeof window !== 'undefined') window.location.reload();
  };

  const googleClientId =
    (typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID)) || '';

  const content = loading ? (
    <div className="loading-screen">
      <div className="boot-brand">
        <IconLogo />
        <div>
          <b>FALCHION XENIAA</b>
          <span>PEOPLE PORTAL</span>
        </div>
      </div>
      <div className="boot-loader">
        <div className="boot-line">
          <i />
        </div>
        <span>Preparing your workspace</span>
      </div>
    </div>
  ) : bootError ? (
    <div className="loading-screen" role="alert">
      <IconLogo />
      <div className="card" style={{ maxWidth: 520, margin: '24px', textAlign: 'center' }}>
        <div className="eyebrow">CONNECTION ISSUE</div>
        <h1>We could not reach the portal.</h1>
        <p>{bootError}</p>
        <button className="button button-primary" onClick={retryBoot}>
          Try again
        </button>
      </div>
    </div>
  ) : user ? (
    <Shell>{children}</Shell>
  ) : (
    <LoginScreen />
  );

  const wrapped = (
    <AppContext.Provider value={value}>
      <AppErrorBoundary>
        {content}
        <Toast toast={toast} onClose={() => setToast(null)} />
      </AppErrorBoundary>
    </AppContext.Provider>
  );

  if (googleClientId) {
    return <GoogleOAuthProvider clientId={googleClientId}>{wrapped}</GoogleOAuthProvider>;
  }

  return wrapped;
}
