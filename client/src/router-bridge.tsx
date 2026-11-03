'use client';
import NextLink from 'next/link';
import { useRouter as useNextRouter, usePathname, useSearchParams as useNextSearchParams, useParams as useNextParams } from 'next/navigation';
import React from 'react';

export function Link({ to, href, children, ...props }: any) {
  const target = href || to || '#';
  return <NextLink href={target} {...props}>{children}</NextLink>;
}

export function NavLink({ to, href, className, children, end, ...props }: any) {
  const target = href || to || '#';
  const pathname = usePathname();
  const isActive = end ? pathname === target : (pathname === target || (target !== '/' && target !== '/admin' && pathname?.startsWith(target)));
  const resolvedClass = typeof className === 'function' ? className({ isActive }) : `${className || ''}${isActive ? ' active' : ''}`;
  return <NextLink href={target} className={resolvedClass} {...props}>{children}</NextLink>;
}

export function useNavigate() {
  const router = useNextRouter();
  return (to: string | number, options?: any) => {
    if (typeof to === 'number') {
      if (typeof window !== 'undefined') window.history.go(to);
    } else if (options?.replace) {
      router.replace(to);
    } else {
      router.push(to);
    }
  };
}

export function useLocation() {
  const pathname = usePathname() || '/';
  const searchParams = useNextSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : '';
  return { pathname, search, hash: '', state: null, key: 'default' };
}

export function BrowserRouter({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function Routes({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function Route({ element, children }: { element?: React.ReactNode; children?: React.ReactNode }) {
  return <>{element || children || null}</>;
}

export function Outlet() {
  return null;
}

export function useSearchParams() {
  const nextSearchParams = useNextSearchParams();
  const router = useNextRouter();
  const pathname = usePathname();
  const setSearchParams = (params: any) => {
    const q = new URLSearchParams(params).toString();
    router.replace(`${pathname}?${q}`);
  };
  return [nextSearchParams, setSearchParams] as const;
}

export function useParams() {
  return useNextParams() || {};
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const router = useNextRouter();
  React.useEffect(() => {
    if (replace) router.replace(to);
    else router.push(to);
  }, [router, to, replace]);
  return null;
}
