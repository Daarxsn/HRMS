'use client';

import React from 'react';
import { AdminHome, NoAccess, useApp } from '../../src/App';

export default function Page() {
  const { user } = useApp() || {};
  const isSuperAdmin = Boolean(user?.isSuperAdmin || user?.role === 'SUPER_ADMIN' || user?.user_type === 'SUPER_ADMIN');
  const isAdmin = user?.platform === 'ADMIN' || user?.role === 'ADMIN' || isSuperAdmin;

  return isAdmin ? <AdminHome /> : <NoAccess />;
}
