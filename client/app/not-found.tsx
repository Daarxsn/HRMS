'use client';

import React from 'react';
import { NotFoundPage, useApp } from '../src/App';

export default function GlobalNotFound() {
  const { user } = useApp() || {};
  const isSuperAdmin = Boolean(user?.isSuperAdmin || user?.role === 'SUPER_ADMIN' || user?.user_type === 'SUPER_ADMIN');
  const isAdmin = user?.platform === 'ADMIN' || user?.role === 'ADMIN' || isSuperAdmin;
  return <NotFoundPage isAdmin={isAdmin} />;
}
