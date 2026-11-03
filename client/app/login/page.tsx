'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoginScreen, useApp } from '../../src/App';

export default function LoginPage() {
  const { user } = useApp() || {};
  const router = useRouter();

  useEffect(() => {
    if (user) {
      const isSuperAdmin = Boolean(user.isSuperAdmin || user.role === 'SUPER_ADMIN' || user.user_type === 'SUPER_ADMIN');
      const isAdmin = user.platform === 'ADMIN' || user.role === 'ADMIN' || isSuperAdmin;
      router.replace(isAdmin ? '/admin' : '/');
    }
  }, [user, router]);

  return <LoginScreen />;
}
