// @ts-nocheck
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness, Camera, Calendar,
  CalendarDays, CalendarHeart, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck,
  CircleHelp, CircleUserRound, ClipboardCheck, Clock3, Command, Download, FileClock, FileQuestion, FileText, Filter,
  Fingerprint, Gauge, House, Laptop, LogIn, LogOut, MapPin, Menu, Megaphone, MoreHorizontal, Moon, Pencil, Plus,
  RefreshCw, Search, Send, Settings, ShieldCheck, Sun, Timer, Trash2, Users, X,
  PanelLeftClose, UserRound, XCircle, ShieldAlert, GraduationCap
} from 'lucide-react';
import { get, post, patch, put, del, formatDate, formatTime, formatMinutes, todayLocal, initials, assetUrl } from './api';
import EnterpriseHRPage, { EmployeeDocumentsPage, EmployeePoliciesPage, GrievancePage } from './EnterpriseHRPage';

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);
let today = todayLocal();
export const getToday = () => todayLocal();

function locationFailureMessage(error, action='office check-in') {
  const code = Number(error?.code || 0);
  if (code === 1) {
    return `Location permission was denied for ${action}. In browser settings, set Location to Allow, or connect to the approved office Wi-Fi network.`;
  }
  if (code === 2) {
    return `Chrome could not determine your Mac’s location for ${action}. Ensure Wi-Fi is enabled or connect to the approved office Wi-Fi network.`;
  }
  if (code === 3) {
    return `The location request timed out for ${action}. Verifying via approved office Wi-Fi network…`;
  }
  return `No location fix was received for ${action}. Verifying via approved office Wi-Fi network…`;
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('HRMS frontend error', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <div className="loading-screen" role="alert">
      <IconLogo />
      <div className="card" style={{ maxWidth: 520, margin: '24px', textAlign: 'center' }}>
        <div className="eyebrow">TEMPORARY ISSUE</div>
        <h1>Something went wrong.</h1>
        <p>We could not load this page safely. Refresh the page and try again.</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>Refresh</button>
      </div>
    </div>;
  }
}

function IconLogo({ small=false }) {
  return <span className={`brand-logo-image${small?' brand-logo-image-small':''}`} aria-hidden="true"><img src="/falchion-xeniaa-horizontal.svg" alt="" /></span>;
}
function Toast({ toast, onClose }) {
  useEffect(() => { if (toast) { const timer=setTimeout(onClose,4300); return ()=>clearTimeout(timer); } },[toast,onClose]);
  if (!toast) return null;
  return <div className={`toast toast-${toast.type||'success'}`} role="status" aria-live={toast.type==='error'?'assertive':'polite'}><span className="toast-icon">{toast.type==='error'?<CircleAlert size={17}/>:<CircleCheck size={17}/>}</span><span>{toast.message}</span><button type="button" onClick={onClose} aria-label="Dismiss"><X size={15}/></button></div>;
}
function Spinner({ large=false }) { return <span className={`spinner${large?' spinner-large':''}`} aria-label="Loading" role="status"/>; }
function PageTitle({ eyebrow, title, description, action, children }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description&&<p>{description}</p>}{children}</div>{action&&<div className="page-title-action">{action}</div>}</div>;
}
function Button({ children, variant='primary', size='', icon:Icon, disabled, loading, type='button', ...props }) {
  return <button type={type} className={`button button-${variant}${size?` button-${size}`:''}`} disabled={disabled||loading} aria-busy={loading||undefined} {...props}>{loading?<Spinner/>:Icon?<Icon size={17} strokeWidth={1.9}/>:null}{children}</button>;
}
function StatusPill({ value, children }) {
  const raw=value || children || '—';
  const key=String(raw).toLowerCase().replaceAll('_','-').replaceAll(' ','-');
  const labels={on_time:'On time',late_entry:'Late entry',pending:'Pending',approved:'Approved',rejected:'Declined',cancelled:'Withdrawn',active:'Active',inactive:'Inactive',wfh:'Working remotely',on_leave:'On leave',gps:'GPS verified',absent:'Absent'};
  return <span className={`status status-${key}`}><i className="status-dot" aria-hidden="true"/>{labels[String(raw).toLowerCase()]||raw}</span>;
}
function roleInfo(personOrRole) {
  const role = typeof personOrRole === 'string' ? personOrRole : (personOrRole?.role || personOrRole?.user_type || 'EMPLOYEE');
  const userType = typeof personOrRole === 'object' ? personOrRole?.user_type : null;
  if (role === 'SUPER_ADMIN' || userType === 'SUPER_ADMIN') {
    return { role: 'SUPER_ADMIN', label: 'Super Admin', fullLabel: 'Super Administrator', className: 'role-super-admin', avatarClass: 'avatar-super-admin' };
  }
  if (role === 'ADMIN' || userType === 'ADMIN') {
    return { role: 'ADMIN', label: 'Administrator', fullLabel: 'Administrator', className: 'role-admin', avatarClass: 'avatar-admin' };
  }
  if (role === 'INTERN' || userType === 'INTERN') {
    return { role: 'INTERN', label: 'Intern', fullLabel: 'Intern', className: 'role-intern', avatarClass: 'avatar-intern' };
  }
  return { role: 'EMPLOYEE', label: 'Employee', fullLabel: 'Employee', className: '', avatarClass: '' };
}
function EmptyState({ icon:Icon=FileText, title, body, action }) { return <div className="empty-state"><span className="empty-icon"><Icon size={21}/></span><h3>{title}</h3><p>{body}</p>{action}</div>; }
function Card({ children, className='', ...props }) { return <section {...props} className={`card ${className}`}>{children}</section>; }
function CardHeading({ title, subtitle, action }) { return <div className="card-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>; }

function App() {
  const [user,setUser]=useState(null);
  const [loading,setLoading]=useState(true);
  const [toast,setToast]=useState(null);
  const [bootError,setBootError]=useState('');
  const [notifications,setNotifications]=useState({unread:0,notifications:[]});
  const [refresh,setRefresh]=useState(0);
  const [currentDate,setCurrentDate]=useState(()=>todayLocal());
  useEffect(()=>{
    const syncCurrentDate=()=>{
      const fresh=todayLocal();
      if(fresh!==today){
        today=fresh;
        setCurrentDate(fresh);
      }
    };
    const timer=window.setInterval(syncCurrentDate,15000);
    window.addEventListener('focus',syncCurrentDate);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncCurrentDate();});
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',syncCurrentDate);};
  },[]);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('hrms-theme')||'light';}catch{return 'light';}});
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('hrms-theme',theme);}catch{/* Theme remains active for this session when storage is unavailable. */}},[theme]);
  const notify=(message,type='success')=>setToast({message,type});
  const refreshNotifications=async()=>{if(!user)return;try{setNotifications(await get('/account/notifications'));}catch{}}
  useEffect(()=>{
    let live=true;
    Promise.allSettled([get('/auth/me')]).then(([me])=>{
      if(!live)return;
      if(me.status==='fulfilled')setUser(me.value.user);
      if(me.status==='rejected' && me.reason?.status !== 401) setBootError(me.reason?.message || 'We could not reach the HRMS server.');
      setLoading(false);
    });
    return()=>{live=false;};
  },[]);
  useEffect(()=>{
    if(!user)return;
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')refreshNotifications();};
    refreshWhenVisible();
    const timer=window.setInterval(refreshWhenVisible,60000);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refreshWhenVisible);};
  },[user,refresh]);
  useEffect(()=>{
    const onSessionExpired=()=>{
      setUser(null);
      setNotifications({unread:0,notifications:[]});
      try {
        if (window.location.pathname !== '/' && window.location.pathname !== '/login') {
          sessionStorage.setItem('fx_hrms_return_url', window.location.pathname + window.location.search);
        }
      } catch {}
      setToast({message:'Your session has expired. Please sign in again.',type:'error'});
    };
    window.addEventListener('hrms:session-expired',onSessionExpired);
    return ()=>window.removeEventListener('hrms:session-expired',onSessionExpired);
  },[]);
  useEffect(()=>{
    if (!loading && !user && window.location.pathname !== '/' && window.location.pathname !== '/login') {
      try {
        sessionStorage.setItem('fx_hrms_return_url', window.location.pathname + window.location.search);
      } catch {}
    }
  },[loading,user]);
  const value=useMemo(()=>({user,setUser,notify,refresh:()=>setRefresh((v)=>v+1),notifications,refreshNotifications,theme,setTheme,today:currentDate,currentDate}),[user,notifications,theme,currentDate]);
  const retryBoot=()=>{setBootError('');setLoading(true);window.location.reload();};
  return <AppContext.Provider value={value}><AppErrorBoundary><BrowserRouter>{loading?<div className="loading-screen"><div className="boot-brand"><IconLogo/><div><b>FALCHION XENIAA</b><span>PEOPLE PORTAL</span></div></div><div className="boot-loader"><div className="boot-line"><i/></div><span>Preparing your workspace</span></div></div>:bootError?<div className="loading-screen" role="alert"><IconLogo/><div className="card" style={{maxWidth:520,margin:'24px',textAlign:'center'}}><div className="eyebrow">CONNECTION ISSUE</div><h1>We could not reach the portal.</h1><p>{bootError}</p><button className="button button-primary" onClick={retryBoot}>Try again</button></div></div>:user?<Shell/>:<LoginScreen/>}<Toast toast={toast} onClose={()=>setToast(null)}/></BrowserRouter></AppErrorBoundary></AppContext.Provider>;
}

function getSafeReturnUrl(platform?: string): string {
  try {
    const raw = sessionStorage.getItem('fx_hrms_return_url');
    sessionStorage.removeItem('fx_hrms_return_url');
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
      return platform === 'ADMIN' ? '/admin' : '/';
    }
    if (raw.startsWith('/admin') && platform !== 'ADMIN') {
      return '/';
    }
    return raw;
  } catch {
    return platform === 'ADMIN' ? '/admin' : '/';
  }
}

function LoginScreen() {
  const {setUser}=useApp();
  const navigate=useNavigate();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [rememberMe,setRememberMe]=useState(true);
  const signIn=async(credential)=>{
    setBusy(true);setError('');
    try {
      const result=await post('/auth/google',{credential,rememberMe});
      setUser(result.user);
      const destination = getSafeReturnUrl(result.user.platform);
      navigate(destination,{replace:true});
    }
    catch(e){setError(e.message);setBusy(false);}
  };
  return <div className="login-page">
    <section className="login-art" aria-label="Welcome to the Falchion Xeniaa people portal">
      <div className="login-art-top"><img className="login-reference-brand" src="/falchion-xeniaa-horizontal.svg" alt="Falchion Xeniaa"/><span className="login-brand-divider"/><span className="login-brand-caption">PEOPLE<br/> & CULTURE</span></div>
      <div className="login-art-copy">
        <div className="art-label"><span className="pulse-dot"/> PEOPLE · WORKPLACE · TRUST</div>
        <h1>THE<br/>WORKPLACE<br/>BUILDS<br/><em>PEOPLE.</em></h1>
        <p>A modern HR platform for teams that aim higher.</p>
        <div className="login-feature-row" aria-label="People portal features">
          <div className="login-feature"><span className="login-feature-icon"><CalendarDays size={17}/></span><span><b>Your time</b><small>Attendance & leave</small></span></div>
          <div className="login-feature"><span className="login-feature-icon"><Users size={17}/></span><span><b>Your people</b><small>Team & workplace</small></span></div>
          <div className="login-feature"><span className="login-feature-icon"><ShieldCheck size={17}/></span><span><b>Your space</b><small>Secure by design</small></span></div>
        </div>
      </div>
      <div className="login-art-footer"><span>CULTURE TODAY. STRONGER TOMORROW.</span><span>EST. PUNE · INDIA</span></div>
    </section>
    <section className="login-panel" aria-label="Sign in">
      <div className="login-panel-inner">
        <div className="mobile-login-brand"><IconLogo/><span>FALCHION XENIAA</span></div>
        <div className="login-access-mark"><span className="login-access-icon"><ShieldCheck size={17}/></span><span>YOUR WORKSPACE, SECURED</span></div>
        <div className="eyebrow">THE PEOPLE PORTAL</div>
        <h2>Welcome back<span className="login-title-period">.</span></h2>
        <p className="login-lede">Sign in with your Google account to access Falchion Xeniaa HRMS.</p>
        <div className="login-auth-card">
          <div className="login-auth-card-heading"><span className="login-google-g">G</span><span><b>Continue with Google</b><small>Use your authorised work account</small></span><ShieldCheck size={17} className="login-auth-shield"/></div>
          {import.meta.env.VITE_GOOGLE_CLIENT_ID?<div className="google-login-wrap">{busy?<div className="google-loading"><Spinner/> Verifying your account…</div>:<GoogleLogin onSuccess={(r)=>r.credential?signIn(r.credential):(setBusy(false),setError('Google did not return a sign-in credential. Please try again.'))} onError={()=>{setBusy(false);setError('Google sign-in could not start. Please try again.')}} size="large" shape="rectangular" theme="outline" text="continue_with" width="320"/>}</div>:<div className="setup-note"><ShieldCheck size={18}/><span>Google Sign-In becomes available after an administrator adds OAuth client details in the deployment settings.</span></div>}
          {error&&<div className="inline-alert alert-error"><CircleAlert size={17}/>{error}</div>}
          <label className="login-remember-toggle" style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',margin:'14px 0 8px',fontSize:'13px',color:'rgba(242, 241, 235, 0.85)',userSelect:'none'}}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e)=>setRememberMe(e.target.checked)}
              aria-label="Keep me signed in on this device for 30 days"
              style={{width:'16px',height:'16px',cursor:'pointer',accentColor:'var(--fx-gold,#DAAF51)'}}
            />
            <span>Keep me signed in on this device for 30 days</span>
          </label>
          <div className="login-auth-assurance"><LockKeyholeIcon/> Your account is verified securely by Google.</div>
        </div>
      </div>
      <div className="login-trust"><span aria-label="Secure Google sign-in"><ShieldCheck size={14}/> Secure Google sign-in</span><span><LockKeyholeIcon/> Encrypted data</span><span><MapPin size={14}/> Location only when you check in</span></div>
      <div className="login-footer"><span>Need access?</span> Contact your Falchion Xeniaa administrator.</div>
    </section>
  </div>;
}
function LockKeyholeIcon(){return <ShieldCheck size={14}/>;}

const employeeNav=[
  {to:'/',label:'Overview',icon:Gauge},
  {to:'/attendance',label:'Attendance',icon:Clock3},
  {to:'/leave',label:'Leave & time off',icon:CalendarDays},
  {to:'/wfh',label:'Work from home',icon:House},
  {to:'/out',label:'Out of office',icon:ArrowUpRight},
  {to:'/notifications',label:'Notifications',icon:Bell},
  {to:'/documents',label:'My documents',icon:FileText},
  {to:'/calendar',label:'Holiday calendar',icon:Calendar},
  {to:'/policies',label:'Policy center',icon:FileText},
  {to:'/grievance',label:'Speak-Up & Grievance',icon:ShieldAlert}
];
const adminNav=[
  {to:'/admin',label:'Overview',icon:Gauge},
  {to:'/admin/team',label:'People',icon:Users},
  {to:'/admin/hr',label:'HR operations',icon:BriefcaseBusiness},
  {to:'/admin/attendance',label:'Attendance',icon:Clock3},
  {to:'/admin/approvals',label:'Requests',icon:ClipboardCheck},
  {to:'/admin/reports',label:'Reports',icon:Activity},
  {to:'/admin/settings',label:'Office settings',icon:Settings},
  {to:'/admin/audit',label:'Audit trail',icon:ShieldCheck},
  {to:'/admin/calendar',label:'Holiday calendar',icon:Calendar}
];

function NotFoundPage({ isAdmin }: { isAdmin?: boolean }) {
  return (
    <div className="not-found-page" style={{ maxWidth: 540, margin: '48px auto', padding: '0 20px', textAlign: 'center' }}>
      <Card style={{ padding: '48px 32px', borderRadius: '16px', border: '1px solid var(--color-border, #E4E4E7)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '999px', background: 'rgba(218, 175, 81, 0.14)', color: 'var(--fx-gold, #DAAF51)', fontWeight: 700, fontSize: '12px', letterSpacing: '0.08em', marginBottom: '18px' }}>
          <ShieldAlert size={14} /> 404 NOT FOUND
        </div>
        <h1 style={{ fontFamily: "var(--font-display, 'Sansation', sans-serif)", fontSize: '28px', color: 'var(--color-text, #18181B)', margin: '0 0 12px', letterSpacing: '-0.03em' }}>
          We couldn’t find that page
        </h1>
        <p style={{ color: 'var(--color-text-muted, #52525B)', fontSize: '14px', lineHeight: 1.6, margin: '0 0 28px' }}>
          The link you followed may be broken or the page may have been moved. Return to your overview to continue your workday.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Link to={isAdmin ? '/admin' : '/'} className="button button-primary">
            Return to overview <ArrowRight size={16} />
          </Link>
          <Link to="/attendance" className="button button-soft">
            <Clock3 size={16} /> View attendance
          </Link>
        </div>
      </Card>
    </div>
  );
}

function PageSkeletonLoader() {
  return (
    <div className="page-skeleton-loader" style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: '20px' }} role="status" aria-label="Loading page content">
      <div className="skeleton-pulse" style={{ width: '240px', height: '32px', borderRadius: '8px' }} />
      <div className="skeleton-pulse" style={{ width: '100%', height: '180px', borderRadius: '14px' }} />
      <div className="skeleton-pulse" style={{ width: '100%', height: '320px', borderRadius: '14px' }} />
    </div>
  );
}

function Shell(){
  const {user,setUser,notifications,refreshNotifications,theme,setTheme}=useApp();
  const [mobileOpen,setMobileOpen]=useState(false);
  const [bellOpen,setBellOpen]=useState(false);
  const [commandOpen,setCommandOpen]=useState(false);
  const isSuperAdmin=Boolean(user.isSuperAdmin || user.role==='SUPER_ADMIN' || user.user_type==='SUPER_ADMIN');
  const isAdmin=user.platform==='ADMIN' || user.role==='ADMIN' || isSuperAdmin;
  const location=useLocation();
  const nav=isAdmin
    ? adminNav.filter((item)=>{
        if(item.to==='/admin/settings') return isSuperAdmin || user.capabilities?.includes('office_settings');
        if(item.to==='/admin/audit') return isSuperAdmin || user.capabilities?.includes('audit_trail');
        return true;
      })
    : employeeNav.filter((item)=>item.to!=='/wfh'||user.wfh_enabled);
  const logout=async()=>{try{await post('/auth/logout');}catch{}setUser(null);};
  useEffect(()=>{setMobileOpen(false);setBellOpen(false);setCommandOpen(false);},[location.pathname]);
  useEffect(()=>{const handler=(event)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCommandOpen(true);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
  const pageName=nav.find((item)=>item.to===location.pathname)?.label || (location.pathname==='/profile'?'My profile':location.pathname.startsWith('/admin/')||location.pathname==='/admin'?'Overview':'Overview');
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a>
    {mobileOpen&&<button className="mobile-scrim" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"/>}
    <aside id="primary-navigation" className={`sidebar${mobileOpen?' sidebar-open':''}`} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <Link to={isAdmin?'/admin':'/'} className="sidebar-brand-link" aria-label="Falchion Xeniaa People Portal">
          <span className="brand-logo-wrap"><IconLogo/></span>
        </Link>
        <button className="sidebar-collapse" aria-label="Close menu" aria-expanded={mobileOpen} aria-controls="primary-navigation" onClick={()=>setMobileOpen(false)}><PanelLeftClose size={17}/></button>
      </div>
      <div className="workspace-chip"><span className="workspace-avatar">FX</span><span><b>Falchion Xeniaa</b><small>Pune · {isSuperAdmin?'Super Admin':isAdmin?'Administrator':'People'}</small></span><ChevronDown size={14}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="main-nav" aria-label="Workspace">{nav.map((item)=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} end={item.to==='/' || item.to==='/admin'} className={({isActive})=>`nav-link${isActive?' nav-active':''}`} aria-label={item.label}><Icon size={18} strokeWidth={1.8}/><span>{item.label}</span>{(item.to==='/approvals'||item.to==='/admin/approvals')&&notifications.unread>0?<span className="nav-count">{notifications.unread}</span>:null}</NavLink>;})}</nav>
      <div className="nav-bottom"><div className="nav-caption">ACCOUNT</div><NavLink to="/profile" className={({isActive})=>`nav-link${isActive?' nav-active':''}`}><CircleUserRound size={18} strokeWidth={1.8}/><span>My profile</span></NavLink><button className="nav-link nav-logout" onClick={logout}><LogOut size={18} strokeWidth={1.8}/><span>Sign out</span></button></div>
      <div className="sidebar-note"><div className="note-spark"><ShieldCheck size={16}/></div><p><b>Sovereign Privacy Architecture</b><br/>Presence is logged only on explicit check-in. Zero background tracking.</p></div>
      <div className="sidebar-user"><div className="avatar avatar-sand avatar-with-photo">{user.profile_photo_available?<img src={assetUrl('/account/profile/photo')} alt="" loading="lazy" decoding="async"/>:initials(user.full_name)}</div><div className="user-lines"><b>{user.full_name}</b><small>{roleInfo(user).fullLabel}</small></div><button className="icon-button user-more" onClick={logout} title="Sign out"><MoreHorizontal size={19}/></button></div>
    </aside>
    <main id="main-content" className="main-shell"><header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={()=>setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="primary-navigation"><Menu size={20}/></button><div className="breadcrumb"><span>Falchion Xeniaa</span><ChevronRight size={13}/><b>{pageName}</b></div></div><div className="topbar-right"><div className="office-status"><span className="pulse-dot"/> Pune office</div><button className="command-trigger" onClick={()=>setCommandOpen(true)} aria-label="Search"><Command size={15}/><span>Search</span><kbd aria-hidden="true">⌘ K</kbd></button><button className="icon-button theme-toggle" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button><div className="notification-wrap"><button className={`icon-button notification-button${bellOpen?' active':''}`} onClick={()=>setBellOpen((v)=>!v)} aria-label="Notifications"><Bell size={19}/>{notifications.unread>0&&<span className="notification-dot"/>}</button>{bellOpen&&<NotificationPopover close={()=>setBellOpen(false)} refresh={refreshNotifications}/>}</div><Link to="/profile" className="avatar avatar-top avatar-with-photo" aria-label="My profile">{user.profile_photo_available?<img src={assetUrl('/account/profile/photo')} alt=""/>:<span aria-hidden="true">{initials(user.full_name)}</span>}</Link></div></header>
      <div className="page-wrap"><Suspense fallback={<PageSkeletonLoader/>}><Routes><Route path="/" element={isAdmin?<Navigate to="/admin" replace/>:<EmployeeHome/>}/>
        <Route path="/admin" element={isAdmin?<AdminHome/>:<NoAccess/>}/><Route path="/attendance" element={<AttendancePage/>}/><Route path="/leave" element={<LeavePage/>}/><Route path="/wfh" element={<WfhPage/>}/><Route path="/out" element={<OutPage/>}/><Route path="/calendar" element={<CalendarPage/>}/><Route path="/admin/calendar" element={isAdmin?<CalendarPage/>:<NoAccess/>}/><Route path="/profile" element={<ProfilePage/>}/><Route path="/notifications" element={<NotificationsPage/>}/><Route path="/documents" element={<EmployeeDocumentsPage/>}/><Route path="/policies" element={<EmployeePoliciesPage/>}/><Route path="/grievance" element={<GrievancePage/>}/>
        <Route path="/admin/team" element={isAdmin?<TeamPage/>:<NoAccess/>}/><Route path="/admin/team/:id" element={isAdmin?<TeamPage/>:<NoAccess/>}/><Route path="/admin/attendance" element={isAdmin?<AdminAttendancePage/>:<NoAccess/>}/><Route path="/admin/approvals" element={isAdmin?<ApprovalsPage/>:<NoAccess/>}/><Route path="/admin/reports" element={isAdmin?<ReportsPage/>:<NoAccess/>}/><Route path="/admin/settings" element={isAdmin&&(isSuperAdmin||user.capabilities?.includes('office_settings'))?<SettingsPage/>:<NoAccess/>}/><Route path="/admin/hr" element={isAdmin?<EnterpriseHRPage/>:<NoAccess/>}/><Route path="/admin/hr/:subTab" element={isAdmin?<EnterpriseHRPage/>:<NoAccess/>}/><Route path="/admin/audit" element={isAdmin&&(isSuperAdmin||user.capabilities?.includes('audit_trail'))?<AuditPage/>:<NoAccess/>}/>
        <Route path="/team" element={<Navigate to="/admin/team" replace/>}/><Route path="/admin-attendance" element={<Navigate to="/admin/attendance" replace/>}/><Route path="/approvals" element={<Navigate to="/admin/approvals" replace/>}/><Route path="/reports" element={<Navigate to="/admin/reports" replace/>}/><Route path="/settings" element={<Navigate to="/admin/settings" replace/>}/><Route path="/audit" element={<Navigate to="/admin/audit" replace/>}/><Route path="*" element={<NotFoundPage isAdmin={isAdmin}/>}/></Routes></Suspense></div>
      <footer className="app-footer"><span>Falchion Xeniaa · People portal</span><span>Built on trust <span className="footer-dot">·</span> {new Date().getFullYear()}</span></footer>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{(isAdmin?[['/admin','Overview',Gauge],['/admin/attendance','Attendance',Clock3],['/admin/approvals','Requests',ClipboardCheck],['/admin/team','People',Users],['/profile','Profile',CircleUserRound]]:[['/','Home',House],['/attendance','Attendance',Fingerprint],['/leave','Leave',CalendarDays],['/notifications','Alerts',Bell],['/profile','Profile',CircleUserRound]]).map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'||to==='/admin'} className={({isActive})=>`mobile-bottom-item${isActive?' active':''}`}><Icon size={18}/><span>{label}</span>{((to==='/notifications'||to==='/admin/approvals')&&notifications.unread>0)&&<i>{notifications.unread>9?'9+':notifications.unread}</i>}</NavLink>)}</nav>
      {commandOpen&&<CommandPalette close={()=>setCommandOpen(false)} theme={theme} setTheme={setTheme} isAdmin={isAdmin}/>} 
    </main>
  </div>;
}

function CommandPalette({close,theme,setTheme,isAdmin}){
  const navigate=useNavigate();const location=useLocation();const [queryText,setQueryText]=useState('');
  const nav=[...(isAdmin?adminNav:employeeNav),{to:'/profile',label:'My profile',icon:CircleUserRound}];
  const actions=isAdmin?[['/admin/attendance','Open live attendance',Clock3],['/admin/approvals','Review requests',ClipboardCheck],['/admin/team','Manage people',Users],['/admin/reports','Open reports',Activity]]:[['/attendance','Open today’s attendance',Fingerprint],['/leave','Request time off',CalendarDays],['/wfh','Request WFH',House],['/out','Mark temporary exit',ArrowUpRight]];
  const q=queryText.trim().toLowerCase();const filtered=nav.filter((item)=>item.label.toLowerCase().includes(q));const filteredActions=actions.filter(([,label])=>label.toLowerCase().includes(q));
  const go=(to)=>{navigate(to);close();};
  useEffect(()=>{const onKey=(e)=>{if(e.key==='Escape')close();if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);},[close]);
  return <div className="command-overlay" onMouseDown={(e)=>e.target===e.currentTarget&&close()}><div className="command-palette" role="dialog" aria-modal="true" aria-label="HRMS command menu">
    <div className="command-head"><Command size={18}/><input autoFocus value={queryText} onChange={e=>setQueryText(e.target.value)} placeholder="Search pages and actions…" aria-label="Search pages and actions"/><kbd>ESC</kbd></div>
    <div className="command-section"><span>QUICK ACTIONS</span>{filteredActions.length?filteredActions.map(([to,label,Icon])=><button className="command-item" key={to} onClick={()=>go(to)}><span className="command-item-icon"><Icon size={16}/></span><span>{label}</span><ArrowRight size={14}/></button>):<div className="command-empty"><Search size={18}/><span>No matching actions.</span></div>}</div>
    <div className="command-section"><span>NAVIGATE</span>{filtered.length?filtered.map((item)=>{const Icon=item.icon;return <button className={`command-item${location.pathname===item.to?' active':''}`} key={item.to} onClick={()=>go(item.to)}><span className="command-item-icon"><Icon size={16}/></span><span>{item.label}</span><ArrowRight size={14}/></button>}):<div className="command-empty"><Search size={18}/><span>No matching pages.</span></div>}</div>
    <div className="command-section"><span>PREFERENCES</span><button className="command-item" onClick={()=>setTheme(theme==='dark'?'light':'dark')}><span className="command-item-icon">{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</span><span>{theme==='dark'?'Use light appearance':'Use dark appearance'}</span><kbd>{theme==='dark'?'LIGHT':'DARK'}</kbd></button></div>
  </div></div>;
}

function NotificationPopover({close,refresh}){
  const popoverRef=useRef(null);
  const {notifications,notify}=useApp();const [items,setItems]=useState(notifications.notifications);const [busy,setBusy]=useState(false);const [busyId,setBusyId]=useState(null);
  useEffect(()=>setItems(notifications.notifications),[notifications]);
  useEffect(()=>{
    const onPointerDown=(e)=>{
      if(popoverRef.current&&!popoverRef.current.contains(e.target)&&!e.target.closest?.('.notification-button')){
        close();
      }
    };
    const onKeyDown=(e)=>{
      if(e.key==='Escape')close();
    };
    document.addEventListener('mousedown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    return()=>{
      document.removeEventListener('mousedown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
    };
  },[close]);
  const mark=async(id)=>{setBusyId(id);try{await post(`/account/notifications/${id}/read`);setItems((all)=>all.map((x)=>x.id===id?{...x,read_at:new Date().toISOString()}:x));refresh();}catch(e){notify(e.message,'error');}finally{setBusyId(null);}};
  const markAll=async()=>{setBusy(true);try{await post('/account/notifications/read-all');setItems((all)=>all.map((x)=>({...x,read_at:new Date().toISOString()})));refresh();}catch(e){notify(e.message,'error');}finally{setBusy(false);}};
  return <div ref={popoverRef} className="notification-popover" role="dialog" aria-label="Notifications popover"><div className="popover-heading"><div><b>Notifications</b><small>{notifications.unread?`${notifications.unread} unread`:'You’re all caught up'}</small></div><button className="text-button" disabled={!notifications.unread||busy} onClick={markAll}>Mark all read</button></div><div className="notification-list">{items.length?items.slice(0,8).map((item)=><button className={`notification-item${item.read_at?'':' notification-unread'}`} key={item.id} onClick={()=>mark(item.id)}><span className="notification-icon"><CheckCheck size={15}/></span><span><b>{item.title}</b><small>{item.body}</small><em>{formatTime(item.created_at)} · {formatDate(String(item.created_at).slice(0,10),{month:'short',day:'numeric'})}</em></span></button>):<div className="notification-empty"><Bell size={20}/><span>No notifications yet</span></div>}</div></div>;
}
function NoAccess(){return <div className="no-access"><ShieldCheck size={30}/><h2>You don’t have access to this view.</h2><p>Ask an administrator if you think this is a mistake.</p><Link className="text-link" to="/">Back to overview <ArrowRight size={15}/></Link></div>;}
function weekDaysFor(date){const base=new Date(`${date}T12:00:00Z`);const weekday=base.getUTCDay();const mondayOffset=weekday===0?6:weekday-1;base.setUTCDate(base.getUTCDate()-mondayOffset);return Array.from({length:7},(_,i)=>{const d=new Date(base);d.setUTCDate(base.getUTCDate()+i);return {date:d.toISOString().slice(0,10),label:['M','T','W','T','F','S','S'][i],working:true};});}

function EmployeeHome(){
  const {user,notifications,notify}=useApp();const [todayRow,setTodayRow]=useState(null);const [balance,setBalance]=useState([]);const [history,setHistory]=useState([]);const [weekRecords,setWeekRecords]=useState([]);const [holiday,setHoliday]=useState(null);const [calendarHolidays,setCalendarHolidays]=useState([]);const [leaveRequests,setLeaveRequests]=useState([]);const [wfhData,setWfhData]=useState({enabled:false,approvedToday:false,today:'',monthlyCap:4,requests:[]});const [birthdayPass,setBirthdayPass]=useState(null);const [time,setTime]=useState(new Date());const [todayOpen,setTodayOpen]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [dashboardRetry,setDashboardRetry]=useState(0);const homeRequest=useRef(0);
  useEffect(()=>{const timer=setInterval(()=>setTime(new Date()),30000);return()=>clearInterval(timer);},[]);
  const loadDashboard=async()=>{
    const requestId=++homeRequest.current;setLoading(true);
    const results=await Promise.allSettled([
      get(`/attendance?from=${today}&to=${today}`),get('/leave/balances'),
      get(`/attendance?from=${today.slice(0,4)}-01-01&to=${today}`),get(`/calendar?year=${today.slice(0,4)}`),
      get('/leave'),get('/wfh'),get('/enterprise/birthday-pass')
    ]);
    if(requestId!==homeRequest.current)return;
    const [attendance,balanceRows,historyRows,calendar,leave,wfh,bpass]=results;const unavailable=[];
    if(attendance.status==='fulfilled')setTodayRow(attendance.value.records?.[0]||null);else unavailable.push('today attendance');
    if(balanceRows.status==='fulfilled')setBalance(balanceRows.value.balances||[]);else unavailable.push('leave balances');
    if(historyRows.status==='fulfilled'){setWeekRecords(historyRows.value.records||[]);setHistory((historyRows.value.records||[]).filter((row)=>row.attendance_date!==today).slice(0,5));}else unavailable.push('attendance history');
    if(calendar.status==='fulfilled'){setHoliday((calendar.value.holidays||[]).find((item)=>item.date===today&&item.kind==='FIXED')||null);setCalendarHolidays(calendar.value.holidays||[]);}else unavailable.push('holiday calendar');
    if(leave.status==='fulfilled')setLeaveRequests(leave.value.requests||[]);else unavailable.push('leave requests');
    if(wfh.status==='fulfilled')setWfhData({enabled:Boolean(wfh.value.enabled),approvedToday:wfh.value.approvedToday===true,today:String(wfh.value.today||today).slice(0,10),monthlyCap:Number(wfh.value.monthlyCap||4),requests:wfh.value.requests||[]});else unavailable.push('WFH summary');
    if(bpass.status==='fulfilled'&&bpass.value)setBirthdayPass(bpass.value);
    setError(unavailable.length?`Some overview details could not be refreshed: ${unavailable.join(', ')}. Retry to try again.`:'');setLoading(false);
  };
  const claimBirthdayPass=async()=>{
    try{
      await post('/enterprise/birthday-pass/claim');
      setBirthdayPass((prev)=>prev?{...prev,pass:{...(prev.pass||{}),status:'CLAIMED'}}:null);
      notify('Happy Birthday! Your 2-Hour Early Sign-Off Pass is now active.');
    }catch(err){notify(err?.message||'Could not claim birthday pass.');}
  };
  useEffect(()=>{void loadDashboard();return()=>{homeRequest.current+=1;};},[dashboardRetry]);
  const welcome=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Asia/Kolkata'}).format(time));
  const greeting=welcome<12?'Good morning':welcome<17?'Good afternoon':'Good evening';
  const name=user.full_name.split(' ')[0];
  const earned=balance.find((b)=>b.type==='EARNED');
  const week=weekDaysFor(today);const holidayMap=new Map(calendarHolidays.map((item)=>[item.date,item]));const weekProgress=week.map((day)=>{const row=weekRecords.find((record)=>record.attendance_date===day.date);const holiday=holidayMap.get(day.date);const holidayName=holiday?.name;const fixedHoliday=holiday?.kind==='FIXED';return {...day,row,holidayName,fixedHoliday,working:day.working&&!fixedHoliday,completed:Boolean(row?.check_in_at&&row?.check_out_at),isCurrent:day.date===today};});
  const completedDays=weekProgress.filter((day)=>day.completed).length;const remainingDays=weekProgress.filter((day)=>day.working&&day.date>=today&&!day.completed).length;const shared=balance.find((b)=>b.type==='CASUAL');const floating=balance.find((b)=>b.type==='FLOATING');const pendingLeave=leaveRequests.filter((item)=>item.status==='PENDING').length;const pendingWfh=wfhData.requests.filter((item)=>item.status==='PENDING').length;const approvedWfhThisMonth=wfhData.requests.filter((item)=>item.status==='APPROVED'&&String(item.request_date).slice(0,7)===today.slice(0,7)).length;const nextHoliday=calendarHolidays.find((item)=>item.date>today);const unread=Number(notifications?.unread||0);const latestAnnouncement=notifications?.notifications?.find((item)=>item.kind==='ANNOUNCEMENT')||null;const [punchBusy,setPunchBusy]=useState(false);const [punchError,setPunchError]=useState('');const [punchStage,setPunchStage]=useState('');const remoteCheckInAvailable=wfhData.enabled||wfhData.approvedToday===true||wfhData.requests.some((item)=>String(item.request_date||'').slice(0,10)===String(wfhData.today||today).slice(0,10)&&String(item.status||'').toUpperCase()==='APPROVED');
  const quickLocation=()=>new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location is not available in this browser.'));return;}
    let best=null;let watchId=null;let timeoutId=null;let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;if(watchId!==null)navigator.geolocation.clearWatch(watchId);if(timeoutId!==null)globalThis.clearTimeout(timeoutId);error?reject(error):resolve(value);};
    const handlePosition=({coords})=>{
      const candidate={latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy};
      if(!best||candidate.accuracy<best.accuracy)best=candidate;
      if(candidate.accuracy<=100)finish(null,candidate);
    };
    const handleError=(geoError)=>{
      if(settled)return;
      if(geoError.code===1){finish(new Error(locationFailureMessage(geoError,'office check-in')));return;}
      if(best&&best.accuracy<=100){finish(null,best);return;}
      if(geoError.code===2||geoError.code===3){
        finish(new Error(best
          ?'Your browser could not get a precise enough location for office check-in. Falling back to office Wi-Fi verification.'
          :locationFailureMessage(geoError,'office check-in')));
      }
    };
    watchId=navigator.geolocation.watchPosition(handlePosition,handleError,{enableHighAccuracy:true,timeout:5000,maximumAge:0});
    timeoutId=globalThis.setTimeout(()=>{
      if(best&&best.accuracy<=100)finish(null,best);
      else if(best)finish(new Error('Your browser could not get a precise enough location for office check-in. Falling back to office Wi-Fi verification.'));
      else finish(new Error(locationFailureMessage({code:3},'office check-in')));
    },5000);
  });
  const quickPunch=async(type,workLocation)=>{
    if(punchBusy||holiday)return;
    setPunchBusy(true);setPunchError('');
    const method=type==='check-out'&&todayRow?.check_in_method==='WFH'?'WFH':type==='check-in'&&remoteCheckInAvailable&&workLocation!=='OFFICE'?'WFH':'GPS';
    setPunchStage(method==='WFH'?'Using enabled WFH access…':'Requesting an accurate location (up to 5 seconds)…');
    try{
      let geo={};let verifiedMethod=method;
      if(method==='GPS'){
        try{geo=await quickLocation();}
        catch(locationError){
          verifiedMethod=type==='check-out'?'OFF_PREMISES':'WIFI';
          setPunchStage(type==='check-out'?'GPS unavailable; saving off-premises check-out…':'GPS unavailable or inaccurate; checking the approved office Wi-Fi…');
        }
      }
      if(verifiedMethod==='WIFI')setPunchStage('Verifying the approved office network…');
      setPunchStage('Saving attendance and audit record…');
      const result=await post(`/attendance/${type}`,{method:verifiedMethod,...(type==='check-in'&&workLocation==='OFFICE'?{workLocation:'OFFICE'}:{}),...geo});
      const successMessage=type==='check-in'?(verifiedMethod==='WFH'?'Remote check-in recorded.':verifiedMethod==='WIFI'?'Check-in recorded using approved office Wi-Fi.':'Check-in recorded.'):(verifiedMethod==='WFH'?'Remote check-out recorded.':verifiedMethod==='WIFI'?'Check-out recorded using approved office Wi-Fi.':'Check-out recorded.');
      notify(result?.warning?.code==='PRIOR_OPEN_SHIFT_REQUIRES_REVIEW' ? successMessage+(result.warning.hrNotified?' HR has been alerted to review earlier attendance records.':' HR review is required for earlier attendance records; the notice could not be sent.') : successMessage);
      try{const a=await get(`/attendance?from=${today}&to=${today}`);setTodayRow(a.records?.[0]||null);setWeekRecords((prev)=>[...prev.filter((row)=>row.attendance_date!==today),...(a.records||[])]);}
      catch{setError('Your attendance action was recorded, but the latest status could not be refreshed. Retry the overview to confirm it.');}
    }catch(e){setPunchError(e.message||'The attendance action could not be completed.');}
    finally{setPunchBusy(false);setPunchStage('');}
  };

  return <>
    {error&&<div className="employee-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>setDashboardRetry((v)=>v+1)} disabled={loading}><RefreshCw size={14}/>{loading?'Refreshing…':'Retry overview'}</button></div>}
    <PageTitle eyebrow={formatDate(today,{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).toUpperCase()} title={`${greeting}, ${name}.`} description="A little overview to help you find your rhythm today." action={<Link className="button button-soft" to="/calendar"><CalendarDays size={17}/> View calendar</Link>}/>
    <div className="employee-mobile-quick-actions" aria-label="Quick actions">
      <Link to="/attendance"><Fingerprint size={17}/><span>Attendance</span></Link>
      <Link to="/leave"><CalendarDays size={17}/><span>Leave</span></Link>
      {wfhData.enabled&&<Link to="/wfh"><House size={17}/><span>WFH</span></Link>}
      <Link to="/notifications"><Bell size={17}/><span>Alerts{unread>0?<i>{unread>9?'9+':unread}</i>:null}</span></Link>
    </div>
    <section className="day-hero">
      <div className="hero-text">
        <div className="hero-kicker"><span className="hero-sun"><Sun size={15}/></span> {holiday?"A DAY SET ASIDE TO PAUSE":"YOUR WORKDAY, AT A GLANCE"}</div>
        <h2>{holiday?"Enjoy "+holiday.name+".":todayRow?.check_in_at?todayRow.check_out_at?"Day wrapped up.":"You’re in for the day.":"Ready when you are."}</h2>
        <p>{holiday?holiday.name+" is on the company holiday calendar. Attendance isn’t expected today.":todayRow?.check_in_at?"You checked in at "+formatTime(todayRow.check_in_at)+". Your day is yours to focus on.":remoteCheckInAvailable?"WFH access is enabled. Check in remotely without GPS, office Wi-Fi, or office geofencing.":"Check in when you arrive. Office attendance uses the office geofence or approved office network."}</p>
        <div className="hero-actions">{holiday?<Link className="button button-light" to="/calendar"><CalendarDays size={16}/> View holiday calendar <ArrowRight size={16}/></Link>:todayRow?.check_in_at?<Link className="button button-light" to="/attendance">{todayRow.check_out_at?"Review today":"Check out when you leave"}<ArrowRight size={16}/></Link>:<Link className="button button-light" to="/attendance"><LogIn size={16}/> {remoteCheckInAvailable?"Check in remotely":"Check in"} <ArrowRight size={16}/></Link>}<span className="hero-time">{new Intl.DateTimeFormat("en-IN",{hour:"numeric",minute:"2-digit",timeZone:"Asia/Kolkata"}).format(time)} IST</span></div>
      </div>
      <div className="hero-art"><div className="hero-date"><span>{new Intl.DateTimeFormat("en-IN",{weekday:"short",timeZone:"Asia/Kolkata"}).format(time)}</span><b>{new Intl.DateTimeFormat("en-IN",{day:"2-digit",timeZone:"Asia/Kolkata"}).format(time)}</b><small>{new Intl.DateTimeFormat("en-IN",{month:"short",timeZone:"Asia/Kolkata"}).format(time)}</small></div></div>
      <button type="button" className="hero-pulse-strip hero-pulse-interactive" onClick={()=>setTodayOpen(true)} aria-label="Today's pulse - Open today attendance details">
        <div className="hero-pulse-status">
          <span className="hero-pulse-live"><i className="pulse-dot"/> TODAY&apos;S PULSE</span>
          <b>{todayRow?.check_in_at?(todayRow.check_out_at?'Day complete':'In progress'):(holiday?'Holiday':'Ready to begin')}</b>
          <small>{holiday?'No attendance is expected today.':todayRow?.check_in_at?'Your workday is underway.':'Your next step is one tap away.'}</small>
        </div>
        <div className="hero-pulse-stat"><small>LEAVE</small><b>{earned?.remaining??'—'} <em>days</em></b></div>
        <div className="hero-pulse-stat"><small>WEEK</small><b>{completedDays}<em> / {week.filter(d=>d.working).length}</em></b></div>
        <div className="hero-pulse-stat"><small>NEXT HOLIDAY</small><b>{nextHoliday?formatDate(nextHoliday.date,{day:"numeric",month:"short"}):"Clear"}</b></div>
      </button>
      <div className="hero-bottom"><span>{remoteCheckInAvailable?<House size={14}/>:<MapPin size={14}/>} {remoteCheckInAvailable?'WFH access enabled · remote check-in available':'Falchion Xeniaa · Pune HQ'}</span><span>Mon–Sat <b>·</b> Report by 9:30 AM</span></div>
    </section>
    {todayOpen&&<TodayDrawer row={todayRow} holiday={holiday} close={()=>setTodayOpen(false)}/>}
    {birthdayPass?.isBirthday&&(
      <Card style={{
        background: 'linear-gradient(135deg, rgba(218, 175, 81, 0.16) 0%, rgba(147, 19, 20, 0.08) 100%)',
        border: '1.5px solid var(--fx-gold, #DAAF51)',
        marginBottom: '20px',
        padding: '20px 24px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '32px' }}>🎂</span>
            <div>
              <b style={{ fontSize: '18px', color: 'var(--fx-red, #931314)', display: 'block' }}>Happy Birthday, {name}! 🎉</b>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text, #333)' }}>
                Because it’s your day, enjoy your <b>2-Hour Early Sign-Off Pass</b> today. No early exit penalty will be recorded upon checking out.
              </p>
            </div>
          </div>
          <div>
            {birthdayPass.pass?.status === 'CLAIMED' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: 'rgba(22, 163, 74, 0.15)', color: '#16a34a', fontWeight: 700, fontSize: '13px' }}>
                <Check size={16} /> Pass Active (2h early exit enabled)
              </span>
            ) : (
              <button className="button button-primary" type="button" onClick={claimBirthdayPass}>
                Claim 2-Hour Pass
              </button>
            )}
          </div>
        </div>
      </Card>
    )}
    <Card className="overview-attendance-card"><div className="overview-attendance-copy"><div className="eyebrow">ATTENDANCE</div><h2>{holiday?'Holiday today':todayRow?.check_in_at?(todayRow.check_out_at?'Today is complete':'You are checked in'):'Ready to check in'}</h2><p>{holiday?'No attendance action is expected today.':todayRow?.check_in_at?(todayRow.check_out_at?'Your attendance entry is complete for today.':`Checked in at ${formatTime(todayRow.check_in_at)}. Check out when you finish.`):remoteCheckInAvailable?'WFH access is enabled. Start remotely without office location verification.':'Report between 9:00 and 9:30 AM. Office check-in verifies your location once.'}</p>{punchStage&&<small className="attendance-progress" role="status" aria-live="polite">{punchStage}</small>}{punchError&&<div className="inline-alert alert-error"><CircleAlert size={16}/>{punchError}<button type="button" onClick={()=>setPunchError('')} aria-label="Dismiss"><X size={14}/></button></div>}</div><div className="overview-attendance-action">{holiday?<Link className="button button-soft" to="/calendar">View calendar</Link>:todayRow?.check_in_at&&!todayRow?.check_out_at?<Button loading={punchBusy} icon={LogOut} onClick={()=>quickPunch('check-out')}>Check out</Button>:todayRow?.check_out_at?<span className="overview-attendance-done"><Check size={16}/> Checked out</span>:<Button loading={punchBusy} icon={LogIn} onClick={()=>quickPunch('check-in')}>{remoteCheckInAvailable?'Check in remotely':'Check in'}</Button>}{!holiday&&!todayRow?.check_in_at&&remoteCheckInAvailable&&<button type="button" className="text-link" onClick={()=>quickPunch('check-in','OFFICE')} disabled={punchBusy}>At the office? Check in with office verification</button>}<span className="report-window">Report time · 9:00–9:30 AM</span></div></Card>
    {latestAnnouncement&&<Card className="announcement-banner"><div className="announcement-banner-icon"><Megaphone size={18}/></div><div className="announcement-banner-copy"><span className="eyebrow">FROM FALCHION XENIAA</span><h2>{latestAnnouncement.title}</h2><p>{latestAnnouncement.body}</p><small>{formatDate(String(latestAnnouncement.created_at).slice(0,10),{day:'numeric',month:'short'})} · {formatTime(latestAnnouncement.created_at)}</small></div><Link className="tiny-arrow" to="/notifications" aria-label="View announcements"><ArrowUpRight size={16}/></Link></Card>}
    <section className="employee-action-center">
      <Card className="action-center-card">
        <CardHeading title="What needs your attention" subtitle={(pendingLeave||pendingWfh||unread||(!holiday&&!todayRow?.check_in_at)||Boolean(todayRow?.check_in_at&&!todayRow?.check_out_at))?"A few useful next steps for today.":"You’re all caught up."}/>
        <div className="employee-action-grid">
          <Link className={`employee-action-item${!holiday&&!todayRow?.check_in_at?" action-item-primary":""}`} to="/attendance"><span className="employee-action-icon"><Clock3 size={17}/></span><span><b>{holiday?"Holiday today":todayRow?.check_in_at?(todayRow.check_out_at?"Review today":"Check out when you leave"):remoteCheckInAvailable?"Check in remotely":"Check in when you arrive"}</b><small>{holiday?"Attendance is not expected.":todayRow?.check_in_at?(todayRow.check_out_at?"Your attendance record is complete.":"Check out when you finish.") :remoteCheckInAvailable?"WFH access is enabled. No GPS or office Wi-Fi verification is required for remote check-in.":"Either the office geofence or approved office network can verify office attendance."}</small></span><ArrowRight size={15}/></Link>
          <Link className="employee-action-item" to="/leave"><span className="employee-action-icon"><CalendarDays size={17}/></span><span><b>{pendingLeave?pendingLeave+" pending leave request"+(pendingLeave===1?"":"s"):"Leave balances ready"}</b><small>{shared?.remaining??0} shared casual/sick · {earned?.remaining??0} earned · {floating?.remaining??0} floating</small></span><ArrowRight size={15}/></Link>
          <Link className="employee-action-item" to="/profile"><span className="employee-action-icon"><GraduationCap size={17}/></span><span><b>Learning Budget</b><small>₹24,000/yr allowance · Submit claim</small></span><ArrowRight size={15}/></Link>
          {wfhData.enabled&&<Link className="employee-action-item" to="/wfh"><span className="employee-action-icon"><House size={17}/></span><span><b>{pendingWfh?pendingWfh+" pending WFH request"+(pendingWfh===1?"":"s"):"WFH access enabled"}</b><small>{approvedWfhThisMonth+"/"+wfhData.monthlyCap+" approved this month"}</small></span><ArrowRight size={15}/></Link>}
          <Link className="employee-action-item employee-action-button" to="/notifications"><span className="employee-action-icon"><Bell size={17}/></span><span><b>{unread?unread+" unread notification"+(unread===1?"":"s"):"No unread notifications"}</b><small>{unread?"Review approvals and updates from your team.":"You’re all caught up on updates."}</small></span><ArrowRight size={15}/></Link>
        </div>
      </Card>
      <Card className="next-holiday-card"><span className="next-holiday-icon"><Sun size={18}/></span><div><small>NEXT COMPANY HOLIDAY</small><b>{nextHoliday?formatDate(nextHoliday.date,{weekday:"short",day:"numeric",month:"long"}):"No upcoming holiday"}</b><span>{nextHoliday?.name||"Your calendar is clear."}</span></div><Link className="tiny-arrow" to="/calendar" aria-label="View calendar"><ArrowRight size={15}/></Link></Card>
    </section>
    <div className="overview-grid"><Card className="balance-card"><CardHeading title="Time off, your way" subtitle="A little room to recharge." action={<Link className="tiny-arrow" to="/leave" aria-label="View leave balances"><ArrowUpRight size={17}/></Link>}/><div className="balance-display"><div className="balance-number">{earned?.remaining??'—'}<small>days available</small></div><div className="balance-mini"><span className="mini-circle mini-gold"><Sun size={17}/></span><div><b>Earned leave</b><small>Accrues each month</small></div></div></div><div className="balance-rows">{balance.filter((b)=>b.type!=='EARNED').map((b)=><div key={b.type}><span>{b.label}</span><b>{b.remaining} <small>days</small></b></div>)}</div><Link className="card-foot-link" to="/leave">See balances & request leave <ArrowRight size={14}/></Link></Card>
      <Card className="week-card"><CardHeading title="This week" subtitle="Small steps add up." action={<span className="week-number">WEEK AT A GLANCE</span>}/><div className="week-track">{weekProgress.map((day)=><div key={day.date} title={day.holidayName||(!day.working?'Sunday':undefined)} className={`week-day${day.completed?' day-done':''}${day.isCurrent&&!day.fixedHoliday?' day-current':''}${!day.working?' day-off':''}${day.row?.status==='ON_LEAVE'?' day-leave':''}`}><span>{day.label}</span><b>{day.completed?<Check size={14}/>:day.isCurrent&&!day.fixedHoliday?<span className="day-dot"/>:day.row?.status==='ON_LEAVE'?<span className="day-leave-mark">·</span>:!day.working?<span className="day-offmark">·</span>:<span className="day-empty"/>}</b></div>)}</div><div className="week-footer"><span><i className="legend-dot legend-done"/> {completedDays} days complete</span><span><i className="legend-dot legend-planned"/> {remainingDays} working days left</span></div><div className="week-quote"><span className="quote-mark">“</span><span>Presence is a contribution, not a surveillance metric.</span><b>— FALCHION CULTURE</b></div></Card>
    </div>
    <div className="section-head"><div><h2>Your recent days</h2><p>A simple view of your attendance history.</p></div><Link className="text-link" to="/attendance">Full attendance history <ArrowRight size={15}/></Link></div>
    <Card className="table-card"><div className="table-scroll"><table aria-label="Recent attendance history"><thead><tr><th scope="col">DATE</th><th scope="col">DAY TYPE</th><th scope="col">STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="3" className="table-message"><Spinner/></td></tr>:history.length?history.map((row)=><tr key={row.id}><td><b>{formatDate(row.attendance_date,{weekday:'short',day:'numeric',month:'short'})}</b></td><td><span className="table-type"><span className="type-dot"/>{row.check_in_method==='WFH'?'Remote':'Office'}</span></td><td><StatusPill value={row.status}/></td></tr>):<tr><td colSpan="3"><div className="table-message">No attendance records yet. Your recent workdays will appear here.</div></td></tr>}</tbody></table></div></Card>
    {!holiday&&<div className="mobile-attendance-dock" aria-label="Quick attendance action">
      <div className="mobile-attendance-dock-status"><span className="pulse-dot"/><span><b>{todayRow?.check_in_at?(todayRow.check_out_at?'Attendance complete':'Currently checked in'):'Not checked in'}</b><small>{todayRow?.check_in_at?formatTime(todayRow.check_in_at):'Ready when you arrive'}</small></span></div>
      {todayRow?.check_in_at&&!todayRow?.check_out_at
        ?<Button size="small" onClick={()=>quickPunch('check-out')} loading={punchBusy} icon={LogOut}>Check out</Button>
        :todayRow?.check_out_at
          ?<Link className="mobile-attendance-dock-link" to="/attendance">Review</Link>
          :<Button size="small" onClick={()=>quickPunch('check-in')} loading={punchBusy} icon={LogIn}>Check in</Button>}
    </div>}
  </>;
}

function AdminSelfAttendanceCard(){
  const {notify}=useApp();
  const [row,setRow]=useState(null);
  const [holiday,setHoliday]=useState(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [attendanceProgress,setAttendanceProgress]=useState('');
  const [time,setTime]=useState(new Date());
  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [attendance,calendar]=await Promise.all([get(`/attendance?from=${today}&to=${today}`),get(`/calendar?year=${today.slice(0,4)}`)]);
      setRow(attendance.records?.[0]||null);
      setHoliday((calendar.holidays||[]).find((item)=>item.date===today&&item.kind==='FIXED')||null);
    }catch(e){setError(e.message);}finally{setLoading(false);}
  };
  useEffect(()=>{
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')load();};
    refreshWhenVisible();
    const timer=window.setInterval(refreshWhenVisible,30000);
    const clock=window.setInterval(()=>{if(document.visibilityState==='visible')setTime(new Date());},30000);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{window.clearInterval(timer);window.clearInterval(clock);document.removeEventListener('visibilitychange',refreshWhenVisible);};
  },[]);
  const getLocation=()=>new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location is not available in this browser.'));return;}
    navigator.geolocation.getCurrentPosition(
      ({coords})=>resolve({latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy}),
      (geoError)=>reject(new Error(locationFailureMessage(geoError,'office attendance'))),
      {enableHighAccuracy:true,timeout:5000,maximumAge:0}
    );
  });
  const punch=async(type)=>{
    setBusy(true);setError('');setAttendanceProgress('Requesting an accurate location (up to 5 seconds)…');
    try{
      let geo={};let method=type==='check-out'&&row?.check_in_method==='WFH'?'WFH':'GPS';
      if(method==='GPS'){
        try{geo=await getLocation();}
        catch(locationError){method=type==='check-out'?'OFF_PREMISES':'WIFI';setAttendanceProgress(type==='check-out'?'GPS unavailable; saving off-premises check-out…':'GPS unavailable; checking the approved office Wi-Fi…');}
      }
      if(method==='WIFI')setAttendanceProgress('Verifying the approved office network…');
      setAttendanceProgress('Saving attendance and audit record…');
      const result=await post(`/attendance/${type}`,{method,...geo});
      await load();
      const message=method==='WIFI'?'Attendance recorded using approved office Wi-Fi.':method==='OFF_PREMISES'?'Off-premises check-out recorded.':type==='check-in'?'Your administrator check-in is recorded.':'Your administrator check-out is recorded.';
      notify(result?.shortShiftReviewRequired?message+' This was a short shift and has been flagged for review.':message);
    }catch(e){setError(e.message);}finally{setBusy(false);setAttendanceProgress('');}
  };
  const state=holiday
    ? {label:'Holiday',title:holiday.name||'Office holiday',body:'Attendance is not expected today.'}
    : row?.check_in_at
      ? row.check_out_at
        ? {label:'Complete',title:'Your workday is complete.',body:`Checked in at ${formatTime(row.check_in_at)} · checked out at ${formatTime(row.check_out_at)}.`}
        : {label:'In progress',title:`Checked in at ${formatTime(row.check_in_at)}.`,body:'Your workday is underway. Check out when you leave the office.'}
      : {label:'Ready',title:'Ready to start your workday.',body:'Check in when you arrive at the Pune office. GPS check-in requires office geofencing and the approved office network; if GPS is inaccurate, the approved office network can verify the check-in.'};
  return <Card className="admin-self-attendance-card">
    <div className="admin-self-attendance-copy">
      <div className="admin-self-attendance-kicker"><span className="pulse-dot"/><span>YOUR ATTENDANCE</span><small>{new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(time)} IST</small></div>
      <div className="admin-self-attendance-heading"><div><h2>{state.title}</h2><p>{state.body}</p></div><span className={`admin-self-attendance-status admin-self-attendance-status-${state.label.toLowerCase().replaceAll(' ','-')}`}>{state.label}</span></div>
      {attendanceProgress&&<small className="attendance-progress" role="status" aria-live="polite">{attendanceProgress}</small>}{error&&<div className="admin-self-attendance-error"><CircleAlert size={15}/>{error}<button type="button" className="text-button" onClick={load}>Retry</button></div>}
      {!holiday&&<div className="admin-self-attendance-actions">
        <Button variant={row?.check_in_at?'soft':'primary'} onClick={()=>punch('check-in')} loading={busy} disabled={loading||Boolean(row?.check_in_at)} icon={LogIn}>Check in</Button>
        <Button variant={row?.check_in_at&&!row?.check_out_at?'primary':'soft'} onClick={()=>punch('check-out')} loading={busy} disabled={loading||!row?.check_in_at||Boolean(row?.check_out_at)} icon={LogOut}>Check out</Button>
      </div>}
      {holiday&&<div className="admin-self-attendance-holiday"><CalendarDays size={15}/><span>Today is a scheduled company holiday.</span></div>}
    </div>
    <div className="admin-self-attendance-facts">
      <div><span>CHECK-IN</span><b>{row?.check_in_at?formatTime(row.check_in_at):'—'}</b></div>
      <div><span>CHECK-OUT</span><b>{row?.check_out_at?formatTime(row.check_out_at):'—'}</b></div>
      <div><span>VERIFY</span><b>{row?.check_in_method||'Not recorded'}</b></div>
      <div><span>WORKDAY</span><b>9:00 AM — 6:00 PM</b></div>
    </div>
  </Card>;
}

function AdminHome(){
  const {user,notify}=useApp();const [data,setData]=useState(null);const [approvals,setApprovals]=useState([]);const [activity,setActivity]=useState([]);const [health,setHealth]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [announcementOpen,setAnnouncementOpen]=useState(false);const [announcementTitle,setAnnouncementTitle]=useState('');const [announcementBody,setAnnouncementBody]=useState('');const [announcementBusy,setAnnouncementBusy]=useState(false);const [lastUpdated,setLastUpdated]=useState(null);const adminRequest=useRef(0);const adminDashboardLoaded=useRef(false);const [adminSections,setAdminSections]=useState({dashboard:false,approvals:false,activity:false,health:false});
  const load=async()=>{
    const requestId=++adminRequest.current;
    if(!adminDashboardLoaded.current)setLoading(true);
    setError('');
    const results=await Promise.allSettled([get('/admin/dashboard'),get('/admin/approvals'),get('/admin/recent-activity'),get('/admin/system-health')]);
    if(requestId!==adminRequest.current)return;
    const [dashboard,queue,feed,system]=results;const unavailable=[];
    if(dashboard.status==='fulfilled'){setData(dashboard.value);adminDashboardLoaded.current=true;setAdminSections((s)=>({...s,dashboard:true}));}else unavailable.push('workplace metrics');
    if(queue.status==='fulfilled'){setApprovals(queue.value.approvals||[]);setAdminSections((s)=>({...s,approvals:true}));}else unavailable.push('review queue');
    if(feed.status==='fulfilled'){setActivity((feed.value.logs||[]).slice(0,6));setAdminSections((s)=>({...s,activity:true}));}else unavailable.push('recent activity');
    if(system.status==='fulfilled'){setHealth(system.value);setAdminSections((s)=>({...s,health:true}));}else unavailable.push('system health');
    if(results.some((result)=>result.status==='fulfilled'))setLastUpdated(new Date());
    setError(unavailable.length?`Some dashboard sections could not be refreshed: ${unavailable.join(', ')}. Previously loaded data is retained; try again.`:'');
    setLoading(false);
  };
  useEffect(()=>{
    void load();
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')void load();};
    const timer=window.setInterval(refreshWhenVisible,30000);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refreshWhenVisible);adminRequest.current+=1;};
  },[]);
  const stats=data?.stats||{};
  const adminHour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Asia/Kolkata'}).format(new Date()));
  const adminGreeting=adminHour<12?'Good morning':adminHour<17?'Good afternoon':'Good evening';
  return <div className="admin-overview-page">
    {error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>{loading?'Refreshing…':'Retry dashboard'}</button></div>}
    <PageTitle eyebrow={formatDate(today,{weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase()} title={`${adminGreeting}, ${user.full_name.split(' ')[0]}.`} description="Your people, today’s pulse, and the decisions that need you." action={<Link to="/admin/team" className="button button-primary"><Plus size={17}/> Add a person</Link>}/>
    <div className="admin-mobile-command-strip" aria-label="Admin quick actions">
      <Link to="/admin/attendance"><Fingerprint size={17}/><span>Attendance</span></Link>
      <Link to="/admin/approvals"><ClipboardCheck size={17}/><span>Requests{stats.pending>0?<i>{stats.pending>9?'9+':stats.pending}</i>:null}</span></Link>
      <Link to="/admin/team"><Users size={17}/><span>People</span></Link>
      <Link to="/admin/reports"><Activity size={17}/><span>Reports</span></Link>
    </div>
    <AdminSelfAttendanceCard/><section className="admin-hero"><div className="admin-hero-copy"><span className="admin-hero-kicker"><i className="pulse-dot"/> LIVE WORKFORCE BRIEF <small>{lastUpdated?'Updated '+new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Asia/Kolkata'}).format(lastUpdated)+' IST':'Updating…'}</small></span><h2>{!adminSections.dashboard?'Workplace metrics are temporarily unavailable.':data?.officeHoliday?String(data.holidayName||"Office holiday")+" today.":"Your workplace, in one calm view."}</h2><p>{!adminSections.dashboard?'Retry to refresh the workplace snapshot.':data?.officeHoliday?"Attendance is not expected today. Use the day to keep your team aligned and requests moving.":String(stats.present||0)+" of "+String(stats.employees||0)+" active people are checked in. "+String(stats.pending||0)+" request"+(stats.pending===1?" is waiting for review.":"s are waiting for review.")}</p><div className="admin-hero-actions"><Link className="button button-light" to="/admin/attendance">Open live attendance <ArrowRight size={16}/></Link><Link className="admin-hero-secondary" to="/admin/approvals">Review queue <span>{stats.pending||0}</span></Link></div></div><div className="admin-hero-score"><span>ATTENDANCE TODAY</span><b>{adminSections.dashboard&&stats.employees?Math.round((stats.present/stats.employees)*100)+'%':'—'}</b><small>{adminSections.dashboard?String(stats.present||0)+' checked in · '+String(stats.absent||0)+' not checked in':'Waiting for workplace metrics'}</small><div><i style={{width:(adminSections.dashboard&&stats.employees?Math.round((stats.present/stats.employees)*100):0)+"%"}}/></div></div></section>
    <div className="admin-intro"><div className="intro-icon"><Activity size={18}/></div><div><b>{data?.officeHoliday?`${data.holidayName||'Office holiday'} · attendance not expected`:'Floor operations & workforce status.'}</b><span>{data?.officeHoliday?'Today is a scheduled non-working day for Falchion Xeniaa.':'Live Pune HQ presence logs, review queues, and real-time floor metrics.'}</span></div><span className="intro-date"><span className="pulse-dot"/> {data?.officeHoliday?'SCHEDULED HOLIDAY':'LIVE TODAY'}</span></div>
    <div className="stat-grid">{[
      {label:'Team members',value:stats.employees,meta:'Across employees & interns',icon:Users,tone:'blue'},
      {label:'Checked in today',value:stats.present,meta:`${stats.employees?Math.round((stats.present/stats.employees)*100):0}% of active team`,icon:Fingerprint,tone:'green'},
      {label:'Needs your attention',value:stats.pending,meta:'Requests waiting for review',icon:ClipboardCheck,tone:'gold'},
      {label:'Late entries today',value:stats.late,meta:'After 9:30 AM',icon:Clock3,tone:'rose'}
    ].map((item)=><Card className="stat-card" key={item.label}><div className={`stat-icon stat-${item.tone}`}><item.icon size={18}/></div><div className="stat-label">{item.label}</div><div className="stat-value">{loading||!adminSections.dashboard?'—':item.value??0}</div><div className="stat-meta">{item.meta}</div></Card>)}</div>
    <div className="admin-pulse-grid">
      <Card className="admin-pulse-card"><CardHeading title="Workplace pulse" subtitle="A simple read on today’s working pattern."/><div className="admin-pulse-metrics">
        <div><span className="pulse-metric-icon pulse-green"><Fingerprint size={16}/></span><small>IN OFFICE</small><b>{loading?'—':stats.present||0}</b><em>checked in</em></div>
        <div><span className="pulse-metric-icon pulse-blue"><House size={16}/></span><small>REMOTE</small><b>{loading?'—':stats.approvedWfh||0}</b><em>approved WFH</em></div>
        <div><span className="pulse-metric-icon pulse-gold"><CalendarDays size={16}/></span><small>ON LEAVE</small><b>{loading?'—':stats.onLeave||0}</b><em>approved leave</em></div>
        <div><span className="pulse-metric-icon pulse-rose"><CircleAlert size={16}/></span><small>ABSENT</small><b>{loading?'—':stats.absent||0}</b><em>after cutoff</em></div>
      </div><div className="admin-pulse-foot"><span><ShieldCheck size={14}/> Approved leave and WFH are separated from attendance.</span><Link className="text-link" to="/admin/attendance">Open attendance <ArrowRight size={14}/></Link></div></Card>
      <Card className="admin-review-preview"><CardHeading title="Next to review" subtitle={stats.pending?String(stats.pending)+' request'+(stats.pending===1?'':'s')+' in your queue.':'Your queue is clear.'} action={<Link className="tiny-arrow" to="/admin/approvals" aria-label="Open review queue"><ArrowUpRight size={17}/></Link>}/>{!adminSections.approvals?<div className="admin-data-unavailable"><CircleAlert size={15}/><span>Review queue could not be loaded.</span><button type="button" className="text-button" onClick={()=>void load()}>Retry</button></div>:approvals.length?<div className="review-preview-list">{approvals.slice(0,4).map((item)=><Link className="review-preview-item" key={item.type+'-'+item.id} to="/admin/approvals"><span className="review-preview-icon">{item.type==='leave'?<CalendarDays size={15}/>:item.type==='wfh'?<House size={15}/>:item.type==='correction'?<Fingerprint size={15}/>:<Clock3 size={15}/>}</span><span><b>{item.full_name}</b><small>{item.type==='leave'?'Leave':item.type==='wfh'?'WFH':item.type==='correction'?'Attendance correction':'Flex start'} · {formatDate(item.date,{day:'numeric',month:'short'})}</small></span><ArrowRight size={14}/></Link>)}</div>:<div className="queue-clear"><span><Check size={17}/></span><b>All caught up</b><small>No pending requests right now.</small></div>}<Link to="/admin/approvals" className="button button-soft full-button">Open review queue <ArrowRight size={16}/></Link></Card>
    </div>
    <div className="admin-home-grid"><Card className="team-presence"><CardHeading title="Today at Pune HQ" subtitle={data?.officeHoliday?`${data.holidayName||'Office closed'} · attendance not expected.`:'A quiet snapshot of check-ins.'} action={<Link className="tiny-arrow" to="/admin/attendance" aria-label="Open live attendance"><ArrowUpRight size={17}/></Link>}/><div className="presence-visual"><div className="presence-donut" style={{'--progress':`${stats.employees?Math.round((stats.present/stats.employees)*100):0}%`}}><div><b>{loading?'—':stats.present||0}<small>/{stats.employees||0}</small></b><span>checked in</span></div></div><div className="presence-legend"><div><i className="legend-dot legend-done"/><span>On time</span><b>{stats.onTime??0}</b></div><div><i className="legend-dot legend-late"/><span>Late entry</span><b>{stats.late??0}</b></div><div><i className="legend-dot legend-away"/><span>{data?.officeHoliday?'Scheduled holiday':'Not checked in'}</span><b>{data?.officeHoliday?0:Math.max(0,(stats.employees||0)-(stats.present||0))}</b></div><div><i className="legend-dot legend-out"/><span>Temporary exit</span><b>{stats.outNow??0}</b></div></div></div><div className="attendance-window"><span><Clock3 size={15}/> Standard hours</span><b>9:00 AM — 6:00 PM</b></div></Card>
      <Card className="approval-card"><CardHeading title="Your review queue" subtitle="A timely response goes a long way." action={<Link className="tiny-arrow" to="/admin/approvals" aria-label="Open review queue"><ArrowUpRight size={17}/></Link>}/>{Number(stats.pending)>0?<><div className="approval-highlight"><div className="approval-stack"><span><CalendarDays size={17}/></span><span><House size={17}/></span><span><Clock3 size={17}/></span></div><div><b>{stats.pending} request{stats.pending===1?'':'s'} to review</b><small>Leave, WFH, attendance and flex starts</small></div></div><Link to="/admin/approvals" className="button button-primary full-button">Review requests <ArrowRight size={16}/></Link></>:<div className="queue-clear"><span><Check size={17}/></span><b>All caught up</b><small>No pending requests right now.</small></div>}<div className="review-reminder"><ShieldCheck size={15}/><span>Keep flexibility and individual context in mind when reviewing.</span></div></Card></div>
    <Card className="announcement-card"><CardHeading title="Workplace announcement" subtitle="Send a useful note to every active employee."/><div className="announcement-launch"><div className="announcement-launch-icon"><Megaphone size={18}/></div><div><b>Share something that matters</b><small>Holiday reminders, office updates or team notes.</small></div><button className="button button-soft button-small" onClick={()=>setAnnouncementOpen(true)}>New announcement</button></div></Card>
    <div className="admin-lower-grid"><Card className="activity-card"><CardHeading title="Recent activity" subtitle="Latest meaningful changes across the workspace." action={user.capabilities?.includes('audit_trail')?<Link className="tiny-arrow" to="/admin/audit" aria-label="Open audit trail"><ArrowUpRight size={17}/></Link>:undefined}/>{!adminSections.activity?<div className="admin-data-unavailable"><CircleAlert size={15}/><span>Recent activity is unavailable.</span><button type="button" className="text-button" onClick={()=>void load()}>Retry</button></div>:activity.length?<div className="activity-feed">{activity.map((item)=><div className="activity-item" key={item.id}><span className="activity-dot"/><div><b>{String(item.action||"Activity").replaceAll("_"," ")}</b><small>{item.actor_name||"System"} · {formatTime(item.created_at)}</small></div><span>{formatDate(String(item.created_at).slice(0,10),{day:"numeric",month:"short"})}</span></div>)}</div>:<div className="queue-clear"><span><Check size={17}/></span><b>No recent activity</b><small>Workspace events will appear here.</small></div>}</Card><Card className="system-health-card"><CardHeading title="System health" subtitle="A quick signal that the workspace is ready."/><div className="health-grid"><div><span><i className="health-good"/> Database</span><b>{!adminSections.health?'Unavailable':health?.status==="ok"?"Healthy":"Unavailable"}</b><small>{health?.databaseLatencyMs?Math.round(health.databaseLatencyMs)+" ms latency":"—"}</small></div><div><span><i className="health-good"/> Storage</span><b>Configured</b><small>Private object storage</small></div><div><span><i className="health-good"/> Authentication</span><b>Ready</b><small>Google sign-in</small></div><div><span><i className="health-good"/> Office network</span><b>{!adminSections.health?'Unavailable':health?.officeNetwork?.configured?"Configured":"Needs setup"}</b><small>{!adminSections.health?'Could not verify':health?.officeNetwork?.configured?health.officeNetwork.configuredIpCount+" allowed source"+(health.officeNetwork.configuredIpCount===1?"":"s"):"Admin action needed"}</small></div></div></Card></div>
    <div className="section-head"><div><h2>Temporary exits</h2><p>Only employees who marked themselves as currently out appear here.</p></div></div><Card className="table-card"><div className="table-scroll"><table aria-label="Currently out employees"><thead><tr><th scope="col">PERSON</th><th scope="col">LEFT AT</th><th scope="col">NOTE</th><th scope="col">STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="4" className="table-message"><Spinner/></td></tr>:!adminSections.dashboard?<div className="table-message">Workplace data is unavailable. Retry to refresh.</div>:data?.temporaryExits?.length?data.temporaryExits.map((row)=><tr key={row.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(row.full_name)}</span><span><b>{row.full_name}</b><small>{row.employee_code}</small></span></div></td><td>{formatTime(row.left_at)}</td><td>{row.reason||'—'}</td><td><span className="status status-on-time">Currently out</span></td></tr>):<tr><td colSpan="4"><div className="table-message">No one is currently marked as out.</div></td></tr>}</tbody></table></div></Card>
    <div className="section-head"><div><h2>Today’s attendance</h2><p>Check-in, check-out and worked time for every active employee.</p></div><Link className="text-link" to="/admin/attendance">Open attendance management <ArrowRight size={15}/></Link></div><Card className="table-card admin-dashboard-attendance"><div className="table-scroll"><table aria-label="Today team attendance overview"><thead><tr><th scope="col">PERSON</th><th scope="col">CHECK IN</th><th scope="col">CHECK OUT</th><th scope="col">WORKED</th><th scope="col">STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:!adminSections.dashboard?<div className="table-message">Attendance data is unavailable. Retry to refresh.</div>:data?.recent?.length?data.recent.map((row)=><tr key={row.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(row.full_name)}</span><span><b>{row.full_name}</b><small>{row.employee_code} · {row.user_type==='INTERN'?'Intern':'Employee'}</small></span></div></td><td>{formatTime(row.check_in_at)}</td><td>{formatTime(row.check_out_at)}</td><td>{row.worked_minutes==null?(row.check_in_at?'In progress':'—'):formatMinutes(row.worked_minutes)}</td><td>{row.status?<StatusPill value={row.status}/>:<span className="status status-pending">Not checked in</span>}</td></tr>):<tr><td colSpan="5"><div className="table-message">No active employees are configured.</div></td></tr>}</tbody></table></div></Card>    {announcementOpen&&<Modal title="Publish an announcement" subtitle="It will appear in every active employee’s notifications." close={()=>setAnnouncementOpen(false)}><form className="form-stack" onSubmit={async(e)=>{e.preventDefault();setAnnouncementBusy(true);try{const result=await post('/admin/announcements',{title:announcementTitle,body:announcementBody});notify('Announcement sent to '+result.recipientCount+' active people.');setAnnouncementTitle('');setAnnouncementBody('');setAnnouncementOpen(false);await load();}catch(e){setError(e.message);}finally{setAnnouncementBusy(false);}}}><label className="form-field"><span>Headline</span><input aria-label="Headline" value={announcementTitle} onChange={e=>setAnnouncementTitle(e.target.value)} maxLength="120" required placeholder="Example: Diwali office closure"/></label><label className="form-field"><span>Message</span><textarea aria-label="Message" value={announcementBody} onChange={e=>setAnnouncementBody(e.target.value)} minLength="8" maxLength="1000" required placeholder="Share the important details…"/></label><div className="form-modal-actions"><Button type="button" variant="soft" onClick={()=>setAnnouncementOpen(false)}>Cancel</Button><Button type="submit" loading={announcementBusy} icon={Megaphone}>Publish announcement</Button></div></form></Modal>}
  </div>;
}

function TodayDrawer({row,holiday,close}){
  const status=holiday?'Holiday':row?.check_in_at?(row.check_out_at?'Complete':'In progress'):'Not started';
  const dayType=row?.check_in_method==='WFH'?'Remote':holiday?'Holiday':'Office';
  return <div className="drawer-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&close()}><aside className="person-drawer today-drawer" role="dialog" aria-modal="true" aria-label="Today attendance details"><div className="drawer-cover"><button className="icon-button drawer-close" onClick={close} aria-label="Close"><X size={18}/></button><div className="drawer-attendance-mark"><CalendarDays size={23}/></div></div><div className="drawer-body"><div className="drawer-heading"><div><span className="eyebrow">TODAY</span><h2>{new Intl.DateTimeFormat('en-IN',{weekday:'long'}).format(new Date(today+'T12:00:00'))}</h2><p>{formatDate(today,{day:'numeric',month:'long',year:'numeric'})}</p></div><span className="today-status-badge">{status}</span></div><div className="today-drawer-status"><span className="pulse-dot"/><b>{status==='Complete'?'Your attendance is complete.':status==='In progress'?'Your workday is underway.':status==='Holiday'?'No attendance action is expected today.':'Your attendance has not started yet.'}</b></div><div className="drawer-section"><span className="eyebrow">DAY DETAIL</span><div className="drawer-facts"><div><small>Day type</small><b>{dayType}</b></div><div><small>Check-in</small><b>{row?.check_in_at?formatTime(row.check_in_at):'—'}</b></div><div><small>Check-out</small><b>{row?.check_out_at?formatTime(row.check_out_at):row?.check_in_at?'In progress':'—'}</b></div><div><small>Verification</small><b>{row?.check_in_method||'—'}</b></div><div><small>Office</small><b>Falchion Xeniaa · Pune HQ</b></div><div><small>Location record</small><b>{row?.check_in_distance_m!=null?Math.round(row.check_in_distance_m)+' m from HQ':row?.check_in_method==='WFH'?'Not required':'Not recorded'}</b></div></div></div><div className="today-drawer-note"><ShieldCheck size={16}/><span>Location is checked only when you choose an attendance action. This view does not run background tracking.</span></div></div></aside></div>;
}
function AttendancePage(){
  const {user,notify,refresh}=useApp();
  const [rows,setRows]=useState([]);const [todayHoliday,setTodayHoliday]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [attendanceAvailable,setAttendanceAvailable]=useState(false);const attendanceRequest=useRef(0);const attendanceLoaded=useRef(false);const [correctionOpen,setCorrectionOpen]=useState(false);const [flexOpen,setFlexOpen]=useState(false);const [actionBusy,setActionBusy]=useState(false);const [actionError,setActionError]=useState('');const [actionStage,setActionStage]=useState('');const [wfhData,setWfhData]=useState({enabled:false,approvedToday:false,today:'',requests:[]});
  const load=async()=>{
    const requestId=++attendanceRequest.current;
    if(!attendanceLoaded.current)setLoading(true);
    setError('');
    const requests=[get(`/attendance?from=${today.slice(0,4)}-01-01&to=${today}`),get(`/calendar?year=${today.slice(0,4)}`)];
    if(user?.role!=='ADMIN')requests.push(get('/wfh'));
    const results=await Promise.allSettled(requests);
    if(requestId!==attendanceRequest.current)return;
    const [attendance,calendar,wfh]=results;const unavailable=[];
    if(attendance.status==='fulfilled'){setRows(attendance.value.records||[]);setAttendanceAvailable(true);}else unavailable.push('attendance history');
    if(calendar.status==='fulfilled')setTodayHoliday((calendar.value.holidays||[]).find((h)=>h.date===today&&h.kind==='FIXED')||null);else unavailable.push('holiday calendar');
    if(user?.role!=='ADMIN'){if(wfh?.status==='fulfilled')setWfhData({enabled:Boolean(wfh.value.enabled),approvedToday:wfh.value.approvedToday===true,today:String(wfh.value.today||today).slice(0,10),requests:wfh.value.requests||[]});else unavailable.push('WFH eligibility');}
    setError(unavailable.length?`Could not refresh ${unavailable.join(' and ')}. Existing records are retained; retry when the connection is available.`:'');
    attendanceLoaded.current=true;setLoading(false);
  };
  useEffect(()=>{
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')void load();};
    refreshWhenVisible();
    const interval=window.setInterval(refreshWhenVisible,30000);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{window.clearInterval(interval);document.removeEventListener('visibilitychange',refreshWhenVisible);attendanceRequest.current+=1;};
  },[user?.role]);
  const current=rows.find((r)=>r.attendance_date===today);
  const remoteCheckInAvailable=user?.role!=='ADMIN'&&(wfhData.enabled||wfhData.approvedToday===true||wfhData.requests.some((r)=>String(r.request_date||'').slice(0,10)===String(wfhData.today||today).slice(0,10)&&String(r.status||'').toUpperCase()==='APPROVED'));
  const requestLocation=()=>new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location is not available in this browser.'));return;}
    let best=null;let settled=false;let watchId=null;let timeoutId=null;
    const finish=(error,value)=>{if(settled)return;settled=true;if(watchId!==null)navigator.geolocation.clearWatch(watchId);if(timeoutId!==null)window.clearTimeout(timeoutId);error?reject(error):resolve(value);};
    const onPosition=({coords})=>{const candidate={latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy};if(!best||candidate.accuracy<best.accuracy)best=candidate;if(candidate.accuracy<=100)finish(null,candidate);};
    const onError=(geoError)=>{
      if(geoError.code===1){finish(new Error(locationFailureMessage(geoError,'office attendance')));return;}
      if(best&&best.accuracy<=100){finish(null,best);return;}
      if(geoError.code===2||geoError.code===3){
        finish(new Error(best
          ?'Your browser could not get a precise enough location. Falling back to office Wi-Fi verification.'
          :locationFailureMessage(geoError,'office attendance')));
      }
    };
    watchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,timeout:5000,maximumAge:0});
    timeoutId=window.setTimeout(()=>best?(best.accuracy<=100?finish(null,best):finish(new Error('Your browser could not get a precise enough location. Falling back to office Wi-Fi verification.'))):finish(new Error(locationFailureMessage({code:3},'office attendance'))),5000);
  });
  const punch=async(type,workLocation)=>{
    setActionBusy(true);setActionError('');
    let method=type==='check-out'&&current?.check_in_method==='WFH'?'WFH':type==='check-in'&&remoteCheckInAvailable&&workLocation!=='OFFICE'?'WFH':'GPS';
    setActionStage(method==='WFH'?'Using enabled WFH access…':'Requesting high-accuracy location…');
    try{
      let geo={};
      if(method==='GPS'){
        try{geo=await requestLocation();}
        catch(locationError){method=type==='check-out'?'OFF_PREMISES':'WIFI';setActionStage(type==='check-out'?'GPS unavailable; saving off-premises check-out…':'GPS unavailable or inaccurate; checking the approved office Wi-Fi…');}
      }
      if(method==='WIFI')setActionStage('Verifying the approved office network…');
      setActionStage('Saving attendance and audit record…');
      const result=await post(`/attendance/${type}`,{method,...(type==='check-in'&&workLocation==='OFFICE'?{workLocation:'OFFICE'}:{}),...geo});
      await load();
      const successMessage=method==='WIFI'?'Attendance recorded using approved office Wi-Fi.':type==='check-in'?(method==='WFH'?'Remote check-in recorded.':'Check-in recorded.'):(method==='WFH'?'Remote check-out recorded.':'Check-out recorded.');
      notify(result?.warning?.code==='PRIOR_OPEN_SHIFT_REQUIRES_REVIEW' ? successMessage+(result.warning.hrNotified?' HR has been alerted to review earlier attendance records.':' HR review is required for earlier attendance records; the notice could not be sent.') : successMessage);
    }catch(e){setActionError(e.message);}
    finally{setActionBusy(false);setActionStage('');}
  };const statusLabel=todayHoliday?'Holiday':!attendanceAvailable?(loading?'Loading':'Unavailable'):current?.check_in_at?(current.check_out_at?'Complete':'In progress'):'Not checked in';
  const presentRows=rows.filter((r)=>['ON_TIME','LATE_ENTRY'].includes(r.status)||r.check_in_at);const lateRows=rows.filter((r)=>r.status==='LATE_ENTRY');const absentRows=rows.filter((r)=>r.status==='ABSENT');const leaveRows=rows.filter((r)=>r.status==='ON_LEAVE');const considered=Math.max(1,presentRows.length+absentRows.length);const healthPercent=Math.round((presentRows.length/considered)*100);
  return <>
    <PageTitle eyebrow="YOUR TIME, YOUR RECORD" title="Attendance" description="A clear history of your attendance without exposing worked-hour details." action={<button className="button button-soft" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>{loading?' Refreshing…':' Refresh'}</button>}/>
    {error&&<InlineError>{error}</InlineError>}
    <Card className="attendance-overview-card attendance-redesign">
      <div className="attendance-overview-main">
        <div className="attendance-overview-kicker"><span className="eyebrow">TODAY · {today}</span><span className="attendance-live-badge"><i className="pulse-dot"/> LIVE</span></div>
        <h2>{todayHoliday?todayHoliday.name:statusLabel==='Complete'?'Attendance recorded.':statusLabel==='In progress'?'You checked in at '+formatTime(current.check_in_at)+'.':'Ready when you are.'}</h2>
        <p>{todayHoliday?'No attendance action is expected today.':statusLabel==='Complete'?'Your attendance entry is complete for today.':statusLabel==='In progress'?'Your workday is underway. Check out when you finish.':remoteCheckInAvailable?'WFH access is enabled. Check in remotely without GPS, office Wi-Fi, or office geofencing.':'Check in when you arrive. Your office location is verified only when you press the attendance action.'}</p>
        {actionStage&&<small className="attendance-progress" role="status" aria-live="polite">{actionStage}</small>}{actionError&&<div className="attendance-action-error" role="alert"><CircleAlert size={15}/><span>{actionError}</span><button type="button" onClick={()=>setActionError('')} aria-label="Dismiss"><X size={14}/></button></div>}
        <div className="attendance-overview-meta"><span><Clock3 size={15}/> 9:00–9:30 AM report window</span><span><ShieldCheck size={15}/> One-time verification</span><span>{remoteCheckInAvailable?<House size={15}/>:<MapPin size={15}/>} {remoteCheckInAvailable?'Remote check-in enabled':'Pune HQ'}</span></div>
      </div>
      <div className="attendance-overview-state">
        <div className={'attendance-state-ring attendance-state-'+statusLabel.toLowerCase().replaceAll(' ','-')}>{statusLabel==='Complete'?<Check size={28}/>:statusLabel==='In progress'?<Clock3 size={28}/>:todayHoliday?<CalendarDays size={28}/>:<Fingerprint size={28}/>}</div>
        <b>{statusLabel}</b>
        {todayHoliday?<Link className="button button-soft button-small" to="/calendar">View calendar</Link>:!attendanceAvailable?<Button size="small" loading={loading} icon={RefreshCw} onClick={()=>void load()}>Retry attendance</Button>:statusLabel==='In progress'?<Button size="small" loading={actionBusy} icon={LogOut} onClick={()=>punch('check-out')}>Check out</Button>:statusLabel==='Complete'?<Link className="button button-soft button-small" to="/">Overview</Link>:<Button size="small" loading={actionBusy} icon={LogIn} onClick={()=>punch('check-in')}>{remoteCheckInAvailable?'Check in remotely':'Check in'}</Button>}
        {!todayHoliday&&!current?.check_in_at&&remoteCheckInAvailable&&<button type="button" className="text-link attendance-office-alternative" onClick={()=>void punch('check-in','OFFICE')} disabled={actionBusy}>At the office? Check in with office verification</button>}
        <small className="attendance-last-updated">Auto-refreshes every 30 sec</small>
      </div>
    </Card>
    <Card className="attendance-health-card"><div className="attendance-health-head"><div><span className="eyebrow">ATTENDANCE PATTERN</span><h2>Your year at a glance</h2><p>A calm summary of the days recorded so far.</p></div><div className="attendance-health-score"><b>{loading?"—":healthPercent}%</b><small>present pattern</small></div></div><div className="attendance-health-metrics"><div><span className="health-bar green"/><b>{loading?"—":presentRows.length}</b><small>Present</small></div><div><span className="health-bar red"/><b>{loading?"—":lateRows.length}</b><small>Late</small></div><div><span className="health-bar gold"/><b>{loading?"—":leaveRows.length}</b><small>Leave</small></div><div><span className="health-bar gray"/><b>{loading?"—":absentRows.length}</b><small>Absent</small></div></div></Card>
    <AttendanceHistoryExplorer rows={rows} loading={loading} />
    <div className="attendance-support-grid"><Card className="help-card"><div className="help-top"><span><CircleHelp size={17}/></span><h3>Need to correct a day?</h3></div><p>Forgot to check in, check out, or had a location issue? Ask an administrator to review the day.</p><button className="text-link" onClick={()=>setCorrectionOpen(true)}>Request correction <ArrowRight size={14}/></button></Card><Card className="help-card flex-help"><div className="help-top"><span><Timer size={17}/></span><h3>Need a flex start?</h3></div><p>Request an adjusted start between 9:00 and 10:30 AM for administrator approval.</p><button className="text-link" onClick={()=>setFlexOpen(true)}>Request flex start <ArrowRight size={14}/></button></Card></div>
    {correctionOpen&&<CorrectionModal close={()=>setCorrectionOpen(false)} onDone={()=>{setCorrectionOpen(false);notify('Your correction request was sent for review.');load();}}/>}
    {flexOpen&&<FlexModal close={()=>setFlexOpen(false)} onDone={()=>{setFlexOpen(false);notify('Your flex-start request was sent to the administrator.');refresh();}}/>}
  </>;
}

function AttendanceHistoryExplorer({rows,loading}){
  const [searchParams,setSearchParams]=useSearchParams();
  const dateParam=searchParams.get('date');
  const initialDate=dateParam&&/^\d{4}-\d{2}-\d{2}$/.test(dateParam)?dateParam:today;
  const [month,setMonth]=useState(()=>new Date(Number(initialDate.slice(0,4)),Number(initialDate.slice(5,7))-1,1));
  const [selected,setSelectedState]=useState(initialDate);
  const setSelected=(d)=>{
    setSelectedState(d);
    setSearchParams(prev=>{const n=new URLSearchParams(prev);if(d===today)n.delete('date');else n.set('date',d);return n;},{replace:true});
  };
  const year=month.getFullYear();const monthNo=month.getMonth();const prefix=`${year}-${String(monthNo+1).padStart(2,'0')}`;
  const monthRows=rows.filter((r)=>String(r.attendance_date).startsWith(prefix));
  const byDate=new Map(monthRows.map((r)=>[r.attendance_date,r]));
  const days=new Date(year,monthNo+1,0).getDate();const first=new Date(year,monthNo,1).getDay();
  const cells=Array.from({length:Math.ceil((first+days)/7)*7},(_,i)=>{const d=i-first+1;if(d<1||d>days)return null;const date=`${year}-${String(monthNo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;return {date,day:d,row:byDate.get(date)};});
  const counts={present:0,absent:0,wfh:0,leave:0};
  monthRows.forEach((r)=>{if(['ON_TIME','LATE_ENTRY'].includes(r.status))counts.present++;else if(r.status==='ABSENT')counts.absent++;else if(r.status==='WFH'||r.check_in_method==='WFH')counts.wfh++;else if(r.status==='ON_LEAVE')counts.leave++;});
  const selectedRow=byDate.get(selected);const selectedDate=new Date(selected+'T12:00:00');
  const move=(delta)=>{setMonth(new Date(year,monthNo+delta,1));setSelected(new Date(year,monthNo+delta,1).toISOString().slice(0,10));};
  const statusClass=(row)=>row?.status?String(row.status).toLowerCase().replaceAll('_','-'):'empty';
  return <section className="attendance-history-explorer">
    <div className="section-head attendance-section-head"><div><h2>Attendance history</h2><p>Choose a month, scan the pattern, and open a day for details.</p></div><div className="history-year"><CalendarDays size={15}/>{year}</div></div>
    <Card className="attendance-history-card">
      <div className="history-toolbar">
        <div><span className="eyebrow">MONTHLY VIEW</span><h3>{new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(month)}</h3></div>
        <div className="history-month-nav"><button className="icon-button" onClick={()=>move(-1)} aria-label="Previous month"><ChevronLeft size={18}/></button><button className="button button-soft button-small" onClick={()=>{setMonth(new Date(Number(today.slice(0,4)),Number(today.slice(5,7))-1,1));setSelected(today)}}>This month</button><button className="icon-button" onClick={()=>move(1)} aria-label="Next month"><ChevronRight size={18}/></button></div>
      </div>
      <div className="history-summary"><div><span className="history-stat-dot dot-present"/><small>Present</small><b>{counts.present}</b></div><div><span className="history-stat-dot dot-absent"/><small>Absent</small><b>{counts.absent}</b></div><div><span className="history-stat-dot dot-wfh"/><small>Remote</small><b>{counts.wfh}</b></div><div><span className="history-stat-dot dot-leave"/><small>Leave</small><b>{counts.leave}</b></div></div>
      <div className="history-workspace">
        <div className="history-calendar">
          <div className="history-weekdays">{['S','M','T','W','T','F','S'].map((d,i)=><span key={i}>{d}</span>)}</div>
          <div className="history-days">{loading?<div className="history-loading"><Spinner/></div>:cells.map((cell,i)=>cell?<button key={cell.date} type="button" className={`history-day history-${statusClass(cell.row)}${cell.date===selected?' history-selected':''}${cell.date===today?' history-today':''}`} onClick={()=>setSelected(cell.date)} title={cell.row?.status?StatusPillLabel(cell.row.status):'No attendance record'}><span>{cell.day}</span><i/></button>:<span key={'empty-'+i} className="history-day history-blank"/>)}</div>
          <div className="history-legend"><span><i className="dot-present"/><small>Present</small></span><span><i className="dot-absent"/><small>Absent</small></span><span><i className="dot-wfh"/><small>Remote</small></span><span><i className="dot-leave"/><small>Leave</small></span></div>
        </div>
        <div className="history-detail">
          <div className="history-detail-top"><span className="eyebrow">SELECTED DAY</span>{selected===today&&<span className="today-chip">TODAY</span>}</div>
          <h4>{new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(selectedDate)}</h4>
          {selectedRow?<><StatusPill value={selectedRow.status}/><div className="history-detail-list"><div><small>DAY TYPE</small><b>{selectedRow.check_in_method==='WFH'||selectedRow.status==='WFH'?'Remote':'Office'}</b></div><div><small>CHECK-IN</small><b>{selectedRow.check_in_at?formatTime(selectedRow.check_in_at):'—'}</b></div><div><small>CHECK-OUT</small><b>{selectedRow.check_out_at?formatTime(selectedRow.check_out_at):selectedRow.check_in_at?'In progress':'—'}</b></div></div></>:<div className="history-empty"><CalendarDays size={18}/><b>No attendance entry</b><small>This day has no recorded attendance.</small></div>}
        </div>
      </div>
    </Card>
  </section>;
}
function StatusPillLabel(value){const labels={ON_TIME:'On time',LATE_ENTRY:'Late entry',ABSENT:'Absent',WFH:'Working remotely',ON_LEAVE:'On leave'};return labels[value]||value||'No attendance record';}
function CorrectionModal({close,onDone}){
  const [date,setDate]=useState(today);const [checkIn,setCheckIn]=useState('');const [checkOut,setCheckOut]=useState('');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/attendance/corrections',{date,requestedCheckIn:checkIn?new Date(checkIn).toISOString():undefined,requestedCheckOut:checkOut?new Date(checkOut).toISOString():undefined,reason});onDone();}catch(x){setError(x.message);}finally{setBusy(false);}};
  return <Modal title="Request an attendance correction" subtitle="A short note helps the administrator review the day." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Work date</span><input aria-label="Work date" type="date" value={date} max={today} onChange={(e)=>setDate(e.target.value)} required/></label><div className="form-two"><label className="form-field"><span>Correct check-in <small>(optional)</small></span><input type="datetime-local" value={checkIn} onChange={(e)=>setCheckIn(e.target.value)}/></label><label className="form-field"><span>Correct check-out <small>(optional)</small></span><input type="datetime-local" value={checkOut} onChange={(e)=>setCheckOut(e.target.value)}/></label></div><label className="form-field"><span>What happened?</span><textarea aria-label="What happened?" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="For example: I missed the checkout because my phone battery ran out." minLength="8" maxLength="1000" required/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button type="submit" loading={busy} icon={Send}>Send for review</Button></div></form></Modal>;
}
function FlexModal({close,onDone}){
  const [date,setDate]=useState(today);const [startTime,setStart]=useState('10:00');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/attendance/flex-requests',{date,startTime,reason});onDone();}catch(x){setError(x.message);}finally{setBusy(false);}};
  return <Modal title="Request a flexible start" subtitle="The policy allows 9:00–10:30 AM with manager approval." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Date</span><input aria-label="Date" type="date" value={date} min={today} onChange={(e)=>setDate(e.target.value)} required/></label><label className="form-field"><span>Requested start</span><input aria-label="Requested start" type="time" min="09:00" max="10:30" value={startTime} onChange={(e)=>setStart(e.target.value)} required/></label><label className="form-field"><span>Context for your manager</span><textarea aria-label="Context for your manager" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Share any details that would be helpful." minLength="8" maxLength="1000" required/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button type="submit" loading={busy} icon={Send}>Request approval</Button></div></form></Modal>;
}
function Modal({title,subtitle,close,children}){
  const closeRef=useRef(null);
  const modalRef=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;
    const scrollY=window.scrollY;
    document.body.style.overflow='hidden';
    requestAnimationFrame(()=>{
      const focusable=modalRef.current?.querySelectorAll('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if(focusable?.length>1){
        focusable[1].focus();
      }else{
        closeRef.current?.focus();
      }
    });
    const onKey=(event)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        close();
        return;
      }
      if(event.key==='Tab'&&modalRef.current){
        const focusable=Array.from(modalRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
        if(!focusable.length)return;
        const first=focusable[0];
        const last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){
          event.preventDefault();
          last.focus();
        }else if(!event.shiftKey&&document.activeElement===last){
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown',onKey);
    return()=>{
      document.removeEventListener('keydown',onKey);
      document.body.style.overflow='';
      if(previous instanceof HTMLElement)previous.focus();
      window.scrollTo(0,scrollY);
    };
  },[close]);
  return <div className="modal-overlay" onMouseDown={(e)=>e.target===e.currentTarget&&close()}><div ref={modalRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button ref={closeRef} className="icon-button" onClick={close} aria-label="Close dialog"><X size={19}/></button></div>{children}</div></div>;
}
function InlineError({children}){return <div className="inline-alert alert-error" role="alert"><CircleAlert size={16}/>{children}</div>;}

function EarnedLeaveEncashmentSection({ notify, refresh }) {
  const [eligibility, setEligibility] = useState(null);
  const [encashments, setEncashments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [elRes, encRes] = await Promise.all([
        get('/leave/encashment/eligibility'),
        get('/leave/encashments')
      ]);
      setEligibility(elRes);
      setEncashments(encRes?.encashments || []);
      if (elRes?.maxEncashableDays >= 1) {
        setDays((prev) => Math.min(Math.max(1, prev), elRes.maxEncashableDays));
      }
    } catch (e) {
      setError(e.message || 'Could not load encashment details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || !eligibility?.isEligible) return;
    setSubmitting(true);
    setError('');
    try {
      await post('/leave/encashment', { days: Number(days), reason: reason.trim() || undefined });
      notify(`Encashment request for ${days} Earned Leave day(s) submitted for admin review.`);
      setReason('');
      await loadData();
      if (refresh) refresh();
    } catch (err) {
      setError(err.message || 'Could not submit encashment request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="leave-encashment-card" style={{ marginTop: '24px' }}>
      <CardHeading
        title="Earned Leave Encashment"
        subtitle="Eligible employees with 12+ months continuous service can encash accrued Earned Leaves. Casual and Sick leaves are strictly excluded."
        action={<span className="policy-chip"><BriefcaseBusiness size={14} /> 12-Month Rule</span>}
      />
      {error && <InlineError>{error}</InlineError>}
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center' }}><Spinner /></div>
      ) : (
        <div className="form-stack">
          {eligibility?.isEligible ? (
            <div style={{ padding: '16px', background: 'rgba(218, 175, 81, 0.08)', borderRadius: '10px', border: '1px solid var(--brand-gold, #DAAF51)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontWeight: 700, color: 'var(--brand-dark, #111)' }}>
                  Tenure: {eligibility.tenureMonths} months (Eligible)
                </span>
                <span style={{ fontSize: '13px', color: '#666' }}>
                  Available EL: <b>{eligibility.earnedBalance} days</b> · Max encashable now: <b>{eligibility.maxEncashableDays} days</b>
                </span>
              </div>
              <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: '12px', alignItems: 'end' }}>
                <label className="form-field">
                  <span>Days to encash</span>
                  <input
                    type="number"
                    min="1"
                    max={eligibility.maxEncashableDays}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Note (optional)</span>
                  <input
                    type="text"
                    placeholder="Context for payroll review"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <Button type="submit" loading={submitting} disabled={eligibility.maxEncashableDays < 1} icon={Send}>
                  Submit encashment
                </Button>
              </form>
            </div>
          ) : (
            <div style={{ padding: '16px', background: 'var(--canvas-subtle, #f8f9fa)', borderRadius: '10px', border: '1px solid var(--border-subtle, #e5e7eb)' }}>
              <p style={{ margin: 0, color: 'var(--text-muted, #666)', fontSize: '13px' }}>
                <b>Not currently eligible for encashment:</b> {eligibility?.tenureMonths < 12
                  ? `Continuous tenure is currently ${eligibility?.tenureMonths || 0} of 12 required months.`
                  : `No available Earned Leave balance to encash (EL balance: ${eligibility?.earnedBalance || 0}, pending: ${eligibility?.pendingDays || 0}).`}
              </p>
            </div>
          )}

          {encashments.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>Your encashment requests</h3>
              <div className="table-scroll">
                <table aria-label="Earned leave encashments">
                  <thead>
                    <tr>
                      <th scope="col">DATES</th>
                      <th scope="col">DAYS</th>
                      <th scope="col">STATUS</th>
                      <th scope="col">REASON / REVIEW NOTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {encashments.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(String(item.created_at).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td><b>{item.days} day{Number(item.days) === 1 ? '' : 's'}</b></td>
                        <td><StatusPill value={item.status} /></td>
                        <td>{item.rejection_reason || item.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function LeavePage(){
  const {notify,refresh}=useApp();const [balances,setBalances]=useState([]);const [requests,setRequests]=useState([]);const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);const [busy,setBusy]=useState(false);const [withdrawBusy,setWithdrawBusy]=useState(null);const [error,setError]=useState('');const [loadError,setLoadError]=useState('');const leaveRequest=useRef(0);const leaveLoaded=useRef(false);const [file,setFile]=useState(null);const [type,setType]=useState('CASUAL');const [startDate,setStart]=useState('');const [endDate,setEnd]=useState('');const [reason,setReason]=useState('');
  const load=async()=>{
    const requestId=++leaveRequest.current;
    if(!leaveLoaded.current)setLoading(true);else setRefreshing(true);
    setLoadError('');
    const results=await Promise.allSettled([get('/leave/balances'),get('/leave')]);
    if(requestId!==leaveRequest.current)return;
    const [balanceResult,requestResult]=results;const unavailable=[];
    if(balanceResult.status==='fulfilled')setBalances(balanceResult.value.balances||[]);else unavailable.push('leave balances');
    if(requestResult.status==='fulfilled')setRequests(requestResult.value.requests||[]);else unavailable.push('leave requests');
    setLoadError(unavailable.length?`Could not refresh ${unavailable.join(' and ')}. Your last available data is retained; retry when the connection is available.`:'');
    leaveLoaded.current=true;setLoading(false);setRefreshing(false);
  };
  useEffect(()=>{void load();return()=>{leaveRequest.current+=1;};},[]);
  const sickDays=type==='SICK'&&startDate&&endDate?Math.round((new Date(`${endDate}T12:00:00`)-new Date(`${startDate}T12:00:00`))/86400000)+1:0;
  const requiresDoctorNote=type==='SICK'&&sickDays>=3;
  const submit=async(e)=>{e.preventDefault();setError('');if(!startDate||!endDate){setError('Choose both the first and last day of your leave.');return;}if(endDate<startDate){setError('The last day cannot be before the first day.');return;}if(requiresDoctorNote&&!file){setError('Attach a doctor’s note for sick leave of 3 or more consecutive calendar days.');return;}setBusy(true);try{let attachmentId;if(file){const form=new FormData();form.append('file',file);const upload=await post('/files',form);attachmentId=upload.id;}const result=await post('/leave',{type,startDate,endDate,reason,attachmentId});notify(result?.emailDelivery?.sent?`Leave request submitted and HR email notification delivered (${result.emailDelivery.sent}).`:'Leave request saved, but the HR email could not be sent. Please contact HR or try again later.');setStart('');setEnd('');setReason('');setFile(null);await load();refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const withdraw=async(id)=>{if(!window.confirm('Withdraw this pending leave request?'))return;setWithdrawBusy(id);setError('');try{await del(`/leave/${id}`);notify('The pending request was withdrawn.');await load();refresh();}catch(e){setError(e.message);}finally{setWithdrawBusy(null);}};
  const balanceCards=[balances.find((b)=>b.type==='CASUAL'),balances.find((b)=>b.type==='EARNED'),balances.find((b)=>b.type==='FLOATING')].filter(Boolean);
  const upcomingLeave=requests.filter((r)=>r.status==='APPROVED'&&String(r.end_date||r.start_date)>=today).sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date))).slice(0,3);
  return <><PageTitle eyebrow="TIME TO REST & RESET" title="Leave & time off" description="Your balances, requests and time away—all in one place." action={<span className="policy-chip"><ShieldCheck size={14}/> Clear balances, no surprises</span>}/>
    {error&&<InlineError>{error}</InlineError>}
    {loadError&&<div className="employee-page-error" role="alert"><CircleAlert size={16}/><span>{loadError}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading||refreshing}><RefreshCw size={14} className={refreshing?'spin':''}/>{loading||refreshing?'Refreshing…':'Retry leave data'}</button></div>}
    <div className="leave-balance-grid">{loading?<Card className="balance-loading"><Spinner/></Card>:balanceCards.map((b,i)=><Card className={`leave-balance-tile leave-balance-${i}`} key={b.type}><div className="leave-tile-top"><span>{b.type==='CASUAL'?'Casual + sick':b.label}</span><span className="leave-tile-icon">{b.type==='CASUAL'?<Sun size={17}/>:b.type==='EARNED'?<BriefcaseBusiness size={17}/>:<CalendarHeart size={17}/>}</span></div><div className="leave-tile-value">{b.reviewRequired?'HR review':b.remaining}<small>{b.reviewRequired?'balance provisional':'days available'}</small></div><div className="leave-progress"><span style={{width:`${b.entitlement?Math.max(4,Math.min(100,(b.remaining/b.entitlement)*100)):0}%`}}/></div><div className="leave-tile-foot"><span>{b.used} used</span><span>{b.pending?`${b.pending} pending`:`${b.accrued} allocated`}</span></div><p className="leave-tile-note">{b.type==='CASUAL'?'Shared 8-day annual balance for casual and sick leave.':b.type==='EARNED'?(b.reviewRequired?'HR review required before using this provisional balance.':'Accrues 1 day/month after probation, up to 15 days/year.'):'For cultural, religious or personal days.'}</p></Card>)}</div>
    {upcomingLeave.length>0&&<section className="leave-upcoming-strip"><div className="leave-upcoming-heading"><span className="eyebrow">UP NEXT</span><b>Your approved time away</b><small>Planned days already cleared by your approver.</small></div><div className="leave-upcoming-list">{upcomingLeave.map((r)=><Link to="/leave" key={r.id} className="leave-upcoming-item"><span className="leave-upcoming-date"><b>{formatDate(r.start_date,{day:'2-digit'})}</b><small>{formatDate(r.start_date,{month:'short'}).toUpperCase()}</small></span><span><b>{{CASUAL:'Casual',SICK:'Sick',EARNED:'Earned',FLOATING:'Floating',LEARNING:'Learning'}[r.leave_type]||'Leave'}</b><small>{r.start_date===r.end_date?formatDate(r.start_date,{weekday:'short'}):formatDate(r.start_date,{day:'numeric',month:'short'})+' – '+formatDate(r.end_date,{day:'numeric',month:'short'})} · {r.days} day{Number(r.days)===1?'':'s'}</small></span><ArrowRight size={14}/></Link>)}</div></section>}
    <div className="leave-layout"><Card className="leave-form-card"><CardHeading title="Request time off" subtitle="Share the dates and a little context."/><form className="form-stack leave-request-form" onSubmit={submit}>
      <div className="leave-type-group"><div className="form-field"><span>Casual + sick</span><div className="leave-type-switch" role="group" aria-label="Casual and sick leave selection"><button type="button" className={type==='CASUAL'?'active':''} onClick={()=>setType('CASUAL')}>Casual</button><button type="button" className={type==='SICK'?'active':''} onClick={()=>setType('SICK')}>Sick</button></div><small className="field-help">Both use the same shared 8-day annual balance. Sick leave of 3+ consecutive calendar days requires a doctor’s note.</small></div><div className="form-field"><span>Other leave</span><div className="select-wrap"><select aria-label="Other leave type" value={type==='CASUAL'||type==='SICK'?'EARNED':type} onChange={(e)=>setType(e.target.value)}><option value="EARNED">Earned leave</option><option value="FLOATING">Floating leave</option><option value="LEARNING">Learning time off (up to 2d/quarter)</option></select><ChevronDown size={15}/></div></div></div>
      <div className="form-two"><label className="form-field"><span>First day</span><input aria-label="First day" type="date" value={startDate} min={today} onChange={(e)=>setStart(e.target.value)} required/></label><label className="form-field"><span>Last day</span><input aria-label="Last day" type="date" value={endDate} min={startDate||today} onChange={(e)=>setEnd(e.target.value)} required/></label></div>
      <label className="form-field"><span>A short note</span><textarea aria-label="A short note" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder={type==='LEARNING'?'Course title, provider, and learning summary…':'What would you like your approver to know?'} minLength="8" maxLength="1000" required/></label>
      {type==='LEARNING'&&<div className="doc-required" style={{borderColor:'var(--brand-gold,#DAAF51)'}}><GraduationCap size={16}/><span><b>Learning Time Off</b><small>Up to 2 days per calendar quarter for professional development, certifications, and conferences. Does not deduct from your personal leave balances.</small></span></div>}
      {requiresDoctorNote&&<div className="doc-required"><FileText size={16}/><span><b>Doctor’s note required</b><small>The policy asks for basic documentation for 3+ consecutive days.</small></span></div>}
      <label className="file-drop"><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e)=>{const next=e.target.files?.[0]||null;setError('');if(next&&next.size>4*1024*1024){setError('Attachments must be 4 MB or smaller.');setFile(null);return;}setFile(next);}}/><span className="file-drop-icon"><Plus size={17}/></span><span><b>{file?file.name:'Add an attachment'}</b><small>{type==='SICK'&&sickDays>=3?'PDF, JPG or PNG · Required':'PDF, JPG or PNG · up to 4 MB'}</small></span>{file?<button type="button" className="icon-button" onClick={(e)=>{e.preventDefault();e.stopPropagation();setFile(null);}} aria-label="Remove attachment"><X size={16}/></button>:<span className="file-optional">OPTIONAL</span>}</label>
      <div className="leave-form-note"><CircleHelp size={15}/><span>Working days are Monday–Saturday. Sundays and listed holidays aren’t deducted from your balance.</span></div>
      {(startDate||endDate||reason)&&<div className="leave-request-preview">
        <div className="leave-request-preview-head"><span className="eyebrow">REQUEST PREVIEW</span><Check size={15}/></div>
        <div className="leave-request-preview-main">
          <span><CalendarDays size={16}/><b>{startDate?formatDate(startDate,{day:'numeric',month:'short',year:'numeric'}):'Choose your first day'}{endDate?' – '+formatDate(endDate,{day:'numeric',month:'short',year:'numeric'}):''}</b></span>
          <span><b>{{CASUAL:'Casual',SICK:'Sick',EARNED:'Earned',FLOATING:'Floating',LEARNING:'Learning'}[type]||'Leave'}</b><small>{reason?reason.length+' characters added':'Add a short note'}</small></span>
        </div>
      </div>}
      <Button type="submit" loading={busy} icon={Send}>Send leave request</Button>
    </form></Card>
      <div className="leave-side"><Card className="policy-card"><div className="policy-card-icon"><ShieldCheck size={18}/></div><h3>Time away is time gained.</h3><p>We encourage advance notice where you can, and understand that emergencies happen.</p><div className="policy-rule"><b>01</b><span><strong>Casual + sick</strong><small>Shared 8 days/year. No note for up to 2 consecutive sick days.</small></span></div><div className="policy-rule"><b>02</b><span><strong>Earned leave</strong><small>15 days/year entitlement; accrues 1 day/month after probation.</small></span></div><div className="policy-rule"><b>03</b><span><strong>Floating days</strong><small>4 days each calendar year for meaningful observances.</small></span></div><div className="policy-rule"><b>04</b><span><strong>Learning time off</strong><small>Up to 2 days/quarter for training and certifications.</small></span></div></Card><Card className="leave-help-card"><span className="help-leaf"><Sun size={18}/></span><div><b>Plans change. That’s okay.</b><p>Pending requests can be withdrawn and sent again with new dates.</p></div></Card></div>
    </div>
    <div className="section-head"><div><h2>Your requests</h2><p>See what’s coming up and what’s been approved.</p></div><span className="history-count">{requests.length} {requests.length===1?'request':'requests'}</span></div><Card className="table-card"><div className="table-scroll"><table aria-label="Your leave request history"><thead><tr><th scope="col">LEAVE</th><th scope="col">DATES</th><th scope="col">DAYS</th><th scope="col">REQUESTED</th><th scope="col">STATUS</th><th scope="col">ACTIONS</th></tr></thead><tbody>{loading?<tr><td colSpan="6" className="table-message"><Spinner/></td></tr>:requests.length?requests.map((r)=><tr key={r.id}><td><b>{({CASUAL:'Casual leave',SICK:'Sick leave',EARNED:'Earned leave',FLOATING:'Floating leave',LEARNING:'Learning time off'})[r.leave_type]||r.leave_type}</b>{r.attachment_name&&<small className="table-subline"><FileText size={12}/> {r.attachment_name}</small>}</td><td>{formatDate(r.start_date,{day:'numeric',month:'short'})}{r.start_date!==r.end_date?` – ${formatDate(r.end_date,{day:'numeric',month:'short'})}`:''}</td><td>{r.days}</td><td>{formatDate(String(r.created_at).slice(0,10),{day:'numeric',month:'short'})}</td><td><StatusPill value={r.status}/></td><td>{r.status==='PENDING'&&<button className="table-action" disabled={withdrawBusy===r.id||busy} onClick={()=>withdraw(r.id)}>{withdrawBusy===r.id?'Withdrawing…':'Withdraw'}</button>}{r.reviewer_note&&<span className="table-note" title={r.reviewer_note}><CircleHelp size={14}/></span>}</td></tr>):<tr><td colSpan="6"><div className="table-message">No leave requests yet. When you’re ready, your first request starts above.</div></td></tr>}</tbody></table></div></Card>
    <div className="mobile-request-list">
      {loading?<Card className="mobile-request-empty"><Spinner/></Card>:requests.length?requests.map((r)=><Card className="mobile-request-card" key={'mobile-'+r.id}>
        <div className="mobile-request-card-top"><span className="mobile-request-date"><b>{formatDate(r.start_date,{day:'2-digit'})}</b><small>{formatDate(r.start_date,{month:'short'}).toUpperCase()}</small></span><div><b>{{CASUAL:'Casual leave',SICK:'Sick leave',EARNED:'Earned leave',FLOATING:'Floating leave',LEARNING:'Learning time off'}[r.leave_type]||r.leave_type}</b><small>{r.start_date===r.end_date?formatDate(r.start_date,{weekday:'short'}):formatDate(r.start_date,{day:'numeric',month:'short'})+' – '+formatDate(r.end_date,{day:'numeric',month:'short'})}</small></div><StatusPill value={r.status}/></div>
        <div className="mobile-request-card-meta"><span><b>{r.days}</b> day{Number(r.days)===1?'':'s'}</span><span>Requested {formatDate(String(r.created_at).slice(0,10),{day:'numeric',month:'short'})}</span></div>
        {r.reviewer_note&&<div className="mobile-request-note"><CircleHelp size={14}/><span>{r.reviewer_note}</span></div>}
        {r.status==='PENDING'&&<button className="mobile-request-action" disabled={withdrawBusy===r.id||busy} onClick={()=>withdraw(r.id)}>{withdrawBusy===r.id?'Withdrawing…':'Withdraw request'}</button>}
      </Card>):<EmptyState icon={CalendarDays} title="No leave requests yet." body="Your submitted requests will appear here."/>}
    </div>
    <EarnedLeaveEncashmentSection notify={notify} refresh={load}/>
  </>;
}

function WfhPage(){
  const {notify,refresh}=useApp();const [data,setData]=useState({enabled:false,approvedToday:false,today:'',requests:[],monthlyCap:4});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [cancelBusy,setCancelBusy]=useState(null);const [date,setDate]=useState('');const [kind,setKind]=useState('PLANNED');const [reason,setReason]=useState('');const [error,setError]=useState('');const [loadError,setLoadError]=useState('');const wfhRequest=useRef(0);const wfhLoaded=useRef(false);
  const load=async()=>{const requestId=++wfhRequest.current;setLoading(true);setLoadError('');try{const next=await get('/wfh');if(requestId!==wfhRequest.current)return;setData({enabled:Boolean(next.enabled),approvedToday:next.approvedToday===true,today:String(next.today||today).slice(0,10),requests:Array.isArray(next.requests)?next.requests:[],monthlyCap:Number(next.monthlyCap||4)});}catch(e){if(requestId===wfhRequest.current)setLoadError(e.message||'WFH eligibility could not be checked.');}finally{if(requestId===wfhRequest.current){wfhLoaded.current=true;setLoading(false);}}};
  useEffect(()=>{void load();return()=>{wfhRequest.current+=1;};},[]);
  const submit=async(e)=>{e.preventDefault();if(busy||loading||loadError)return;setBusy(true);setError('');try{if(!date)throw new Error('Choose a remote-work date.');if(data.requests.some((r)=>r.request_date===date&&['PENDING','APPROVED'].includes(r.status)))throw new Error('You already have a pending or approved WFH request for that date.');if(kind==='EMERGENCY'&&date!==today)throw new Error('Unexpected WFH requests are for today.');if(kind==='PLANNED'){const target=new Date(`${date}T00:00:00+05:30`).getTime();if(target-Date.now()<24*60*60*1000)throw new Error('Planned WFH requests should be submitted at least 24 hours ahead.');}const result=await post('/wfh',{date,kind,reason});notify(result?.emailDelivery?.sent?'Your WFH request was emailed to HR. You can reply to the notification to contact you.': 'Your request was saved, but the HR email could not be sent. Please notify HR or try again later.');setDate('');setReason('');await load();refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const cancelRequest=async(request)=>{
    if(cancelBusy||!['PENDING','APPROVED'].includes(String(request.status).toUpperCase()))return;
    setCancelBusy(request.id);setError('');
    try{await del('/wfh/'+encodeURIComponent(request.id));notify('WFH request cancelled. You can submit a new request for this date.');await load();refresh();}
    catch(e){setError(e.message||'Could not cancel the WFH request.');}
    finally{setCancelBusy(null);}
  };
  const approvedThisMonth=data.requests.filter((r)=>r.status==='APPROVED'&&String(r.request_date).slice(0,7)===today.slice(0,7)).length;const pendingWfhCount=data.requests.filter((r)=>r.status==='PENDING').length;const remainingWfhDays=Math.max(0,Number(data.monthlyCap||0)-approvedThisMonth);
  return <><PageTitle eyebrow="FLEXIBILITY, WITH ALIGNMENT" title="Work from home" description="Occasional remote days are available by approval." action={<span className="policy-chip"><House size={14}/> No activity tracking</span>}/>
    {error&&<InlineError>{error}</InlineError>}
    {loadError&&<div className="employee-page-error" role="alert"><CircleAlert size={16}/><span>We couldn’t verify WFH access. {loadError}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>{loading?'Checking…':'Retry access check'}</button></div>}
    {!loading&&!loadError&&data.enabled&&data.approvedToday&&<div className="inline-alert alert-success wfh-approved-today" role="status"><CircleCheck size={17}/><span><b>Your WFH is approved for today.</b> You can check in remotely without GPS or office Wi-Fi.</span><Link className="button button-primary button-small" to="/attendance"><LogIn size={14}/> Check in remotely</Link></div>}
    {!loading&&!loadError&&data.enabled&&!data.approvedToday&&<div className="inline-alert alert-neutral wfh-not-approved-today" role="status"><House size={17}/><span>WFH access is enabled. You can check in remotely without GPS or office Wi-Fi; same-day attendance does not require a WFH request approval.</span></div>}
    {data.enabled&&!loadError&&!loading&&<div className="wfh-usage-grid"><div className="wfh-usage-main"><span className="eyebrow">THIS MONTH</span><b>{approvedThisMonth} <em>/ {data.monthlyCap}</em></b><small>approved remote days</small><div className="wfh-usage-bar"><i style={{width:(data.monthlyCap?Math.min(100,(approvedThisMonth/data.monthlyCap)*100):0)+'%'}}/></div></div><div><span className="eyebrow">AVAILABLE</span><b>{remainingWfhDays}</b><small>days remaining</small></div><div><span className="eyebrow">PENDING</span><b>{pendingWfhCount}</b><small>awaiting approval</small></div></div>}
    <section className="wfh-banner"><div className="wfh-banner-icon"><House size={21}/></div><div><span className="hero-kicker">FLEXIBILITY IS BUILT ON TRUST</span><h2>{loading?'Checking your remote-work access…':loadError?'Remote-work status is temporarily unavailable.':data.enabled?'A remote day, with a little planning.':'WFH isn’t enabled for your account yet.'}</h2><p>{loading?'We’re checking your current eligibility and request history.':loadError?'Retry the access check. We won’t treat a connection failure as a disabled account.':data.enabled?`WFH is available for you by approval, typically up to ${data.monthlyCap} days per month.`:'Ask an administrator if your role should be included in the current WFH arrangement.'}</p></div><div className="wfh-banner-art"><div/><House size={42}/><span/></div></section>
    <div className="wfh-layout"><Card className="wfh-request-card"><CardHeading title="Plan a remote day" subtitle="Submit planned dates for manager review. Enabled employees can check in remotely without same-day approval."/>{loading?<div className="employee-page-loading" role="status"><Spinner/><span>Checking eligibility…</span></div>:loadError?<div className="employee-page-error-inline"><CircleAlert size={16}/><span>Remote-work access could not be verified.</span><button type="button" className="text-button" onClick={()=>void load()}>Retry</button></div>:data.enabled?<form className="form-stack" onSubmit={submit}><label className="form-field"><span>Remote work date</span><input aria-label="Remote work date" type="date" value={date} min={today} onChange={(e)=>setDate(e.target.value)} required/></label><div className="request-kind-toggle"><button type="button" className={kind==='PLANNED'?'kind-selected':''} onClick={()=>setKind('PLANNED')}><CalendarDays size={16}/><span><b>Planned</b><small>Ask at least 24 hours ahead</small></span></button><button type="button" className={kind==='EMERGENCY'?'kind-selected':''} onClick={()=>setKind('EMERGENCY')}><CircleAlert size={16}/><span><b>Unexpected</b><small>Same-day emergency request</small></span></button></div><label className="form-field"><span>Anything your manager should know?</span><textarea aria-label="Anything your manager should know?" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="A little context helps with team coordination." minLength="8" maxLength="1000" required/></label><div className="wfh-policy-note"><ShieldCheck size={15}/><span>Remote work follows the same 9 AM–6 PM schedule. Performance is measured through delivery, not online presence.</span></div>{(date||reason)&&<div className="wfh-request-preview"><div className="wfh-request-preview-head"><span className="eyebrow">REQUEST PREVIEW</span><Check size={15}/></div><div className="wfh-request-preview-grid"><span><CalendarDays size={16}/><b>{date?formatDate(date,{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"Choose a date"}</b></span><span><House size={16}/><b>{kind==="EMERGENCY"?"Unexpected":"Planned"}</b><small>{reason?reason.length+" characters added":"Add a little context"}</small></span></div></div>}<Button type="submit" loading={busy} disabled={loading||Boolean(loadError)} icon={Send}>Request WFH approval</Button></form>:<div className="wfh-disabled"><LockIcon/><h3>Not enabled for this account</h3><p>WFH currently applies to one employee and can be configured by an administrator.</p></div>}</Card>
      <div className="wfh-side"><Card className="wfh-guidelines"><CardHeading title="Working remotely" subtitle="Simple expectations for a good day."/><div className="guideline-row"><span className="guideline-number">01</span><div><b>Keep your team aligned</b><p>Availability on Slack, email and calls during regular working hours.</p></div></div><div className="guideline-row"><span className="guideline-number">02</span><div><b>Protect company information</b><p>Use a private workspace and avoid unsecured public Wi-Fi.</p></div></div><div className="guideline-row"><span className="guideline-number">03</span><div><b>Trust over tracking</b><p>No spyware, screen recording, webcam watching or keyboard tracking.</p></div></div></Card><div className="wfh-quote">“We measure contribution through delivery, not online presence.”<small>REMOTE WORK POLICY</small></div></div></div>
    <div className="section-head"><div><h2>Your WFH requests</h2><p>Planned and emergency requests for this year.</p></div></div><Card className="table-card"><div className="table-scroll"><table aria-label="Your work from home requests"><thead><tr><th scope="col">DATE</th><th scope="col">REQUEST TYPE</th><th scope="col">CONTEXT</th><th scope="col">STATUS</th><th scope="col">NOTE</th><th scope="col">ACTION</th></tr></thead><tbody>{loading?<tr><td colSpan="6" className="table-message"><Spinner/></td></tr>:data.requests?.length?data.requests.map((r)=><tr key={r.id}><td><b>{formatDate(r.request_date,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</b></td><td>{r.request_kind==='EMERGENCY'?'Emergency':'Planned'}</td><td className="reason-cell">{r.reason}</td><td><StatusPill value={r.status}/></td><td>{r.reviewer_note||'—'}</td><td>{['PENDING','APPROVED'].includes(String(r.status).toUpperCase())&&String(r.request_date).slice(0,10)>=today?<Button size="small" variant="soft" loading={cancelBusy===r.id} disabled={Boolean(cancelBusy)} onClick={()=>void cancelRequest(r)}>Cancel</Button>:'—'}</td></tr>):<tr><td colSpan="6"><div className="table-message">No WFH requests yet.</div></td></tr>}</tbody></table></div></Card>
    <div className="mobile-request-list">
      {loading?<Card className="mobile-request-empty"><Spinner/></Card>:data.requests?.length?data.requests.map((r)=><Card className="mobile-request-card" key={'mobile-'+r.id}>
        <div className="mobile-request-card-top"><span className="mobile-request-date"><House size={16}/></span><div><b>{r.request_kind==='EMERGENCY'?'Emergency WFH':'Planned WFH'}</b><small>{formatDate(r.request_date,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</small></div><StatusPill value={r.status}/></div>
        <p className="mobile-request-reason">{r.reason}</p>
        {r.reviewer_note&&<div className="mobile-request-note"><CircleHelp size={14}/><span>{r.reviewer_note}</span></div>}{['PENDING','APPROVED'].includes(String(r.status).toUpperCase())&&String(r.request_date).slice(0,10)>=today&&<Button size="small" variant="soft" loading={cancelBusy===r.id} disabled={Boolean(cancelBusy)} onClick={()=>void cancelRequest(r)}>Cancel request</Button>}
      </Card>):<EmptyState icon={House} title="No WFH requests yet." body="Your planned and emergency remote-work requests will appear here."/>}
    </div>
  </>;
}
function LockIcon(){return <ShieldCheck size={25}/>;}

function OutPage(){
  const {notify}=useApp();const [exit,setExit]=useState(null);const [attendance,setAttendance]=useState(null);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [loadError,setLoadError]=useState('');const outRequest=useRef(0);
  const load=async()=>{const requestId=++outRequest.current;setLoading(true);setLoadError('');const results=await Promise.allSettled([get('/attendance/exits/current'),get(`/attendance?from=${today}&to=${today}`)]);if(requestId!==outRequest.current)return;const [exitResult,attendanceResult]=results;const unavailable=[];if(exitResult.status==='fulfilled')setExit(exitResult.value.exit);else unavailable.push('temporary-exit status');if(attendanceResult.status==='fulfilled')setAttendance(attendanceResult.value.records?.[0]||null);else unavailable.push('today attendance');setLoadError(unavailable.length?`Could not refresh ${unavailable.join(' and ')}.`:'');setLoading(false);};
  useEffect(()=>{void load();return()=>{outRequest.current+=1;};},[]);
  const start=async()=>{if(busy||loading||loadError||exit||!attendance?.check_in_at||attendance?.check_out_at)return;setBusy(true);setError('');try{await post('/attendance/exits',{reason});setReason('');notify('Your temporary exit is recorded.');await load();}catch(e){setError(e.message||'Your temporary exit could not be recorded.');}finally{setBusy(false);}};
  const back=async()=>{if(busy||loading||loadError||!exit?.id)return;setBusy(true);setError('');try{await patch(`/attendance/exits/${exit.id}/return`,{});notify('Welcome back. Your return is recorded.');await load();}catch(e){setError(e.message||'Your return could not be recorded.');}finally{setBusy(false);}};
  return <><PageTitle eyebrow="A LIGHTWEIGHT RECORD" title="Out of office" description="Let your team know when you step out and when you’re back." action={<span className="policy-chip"><MapPin size={14}/> No location tracking</span>}/>{error&&<InlineError>{error}</InlineError>}
    {loadError&&<div className="employee-page-error" role="alert"><CircleAlert size={16}/><span>{loadError} Existing records are retained.</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>{loading?'Refreshing…':'Retry status'}</button></div>}
    <div className="out-layout" aria-busy={loading}><Card className="out-main-card"><div className={`out-state-illustration${exit?' out-state-active':''}`}><div className="out-sun"><Sun size={25}/></div><div className="out-path path-one"/><div className="out-path path-two"/><div className="out-person"><span/><i/></div></div><div className="out-card-content">{loading&&<div className="employee-page-loading" role="status"><Spinner/><span>Checking today’s attendance and exit status…</span></div>}<span className={`out-state-label${exit?' is-out':''}`}><i className="pulse-dot"/>{exit?'CURRENTLY AWAY':'ON YOUR WORKDAY'}</span><h2>{exit?'We’ll see you back soon.':'Stepping out for a bit?'}</h2><p>{exit?`You stepped out at ${formatTime(exit.left_at)}. When you return, close this record so your day stays clear.`:'Record a short exit for appointments or errands. This does not pause attendance or collect your location.'}</p>{exit?<Button onClick={back} loading={busy} disabled={loading||Boolean(loadError)} icon={Check}>I’m back</Button>:<><label className="form-field out-reason"><span>Optional note for your team</span><input type="text" maxLength="500" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="For example: appointment, lunch, quick errand"/></label><Button onClick={start} loading={busy} disabled={loading||Boolean(loadError)||!attendance?.check_in_at||Boolean(attendance?.check_out_at)||Boolean(exit)} icon={ArrowUpRight}>Record a temporary exit</Button>{!attendance?.check_in_at&&<small className="out-hint">Check in for today before creating an out record.</small>}</>}</div></Card>
      <Card className="out-explainer"><span className="side-card-icon"><ShieldCheck size={18}/></span><h3>A record, not a tracker.</h3><p>We keep just the time you left and returned. No continuous location checks, no background monitoring, and no effect on your attendance totals.</p><div className="exit-timeline">{exit?<><div className="exit-time-row"><i className="exit-timeline-dot dot-exit"/><span>Stepped out</span><b>{formatTime(exit.left_at)}</b></div><div className="exit-time-row"><i className="exit-timeline-dot dot-return"/><span>Return</span><b>Waiting for you</b></div></>:<><div className="exit-time-row"><i className="exit-timeline-dot dot-exit"/><span>Temporary exit</span><b>Not started</b></div><div className="exit-time-row"><i className="exit-timeline-dot dot-return"/><span>Return</span><b>Recorded when you’re back</b></div></>}</div></Card></div>
  </>;
}

function CalendarPage(){
  const {user,notify}=useApp();
  const [month,setMonth]=useState(()=>{const p=today.split('-').map(Number);return new Date(p[0],p[1]-1,1);});
  const [holidays,setHolidays]=useState([]);
  const [loading,setLoading]=useState(true);
  const [reloadKey,setReloadKey]=useState(0);
  const [addOpen,setAddOpen]=useState(false);
  const [editingHoliday,setEditingHoliday]=useState(null);
  const [deletingHoliday,setDeletingHoliday]=useState(null);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [error,setError]=useState('');
  const [created,setCreated]=useState(false);
  const year=month.getFullYear();
  const monthNo=month.getMonth();

  useEffect(()=>{
    let active=true;
    setLoading(true);
    setError('');
    get('/calendar?year='+year)
      .then((r)=>{if(active)setHolidays(Array.isArray(r.holidays)?r.holidays:[]);})
      .catch((e)=>{if(active)setError(e.message||'The holiday calendar could not be loaded.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[year,reloadKey]);

  const firstDay=new Date(year,monthNo,1).getDay();
  const days=new Date(year,monthNo+1,0).getDate();
  const total=Math.ceil((firstDay+days)/7)*7;
  const holidayMap=new Map(holidays.map((h)=>[h.date,h]));
  const yearHolidays=holidays.filter((h)=>String(h.date).startsWith(String(year)));
  const prev=()=>setMonth(new Date(year,monthNo-1,1));
  const next=()=>setMonth(new Date(year,monthNo+1,1));
  const retry=()=>setReloadKey((v)=>v+1);
  const rows=Array.from({length:total},(_,i)=>{
    const day=i-firstDay+1;
    if(day<1||day>days)return null;
    const key=String(year)+'-'+String(monthNo+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    return {day,key,holiday:holidayMap.get(key),isToday:key===today,isSunday:new Date(year,monthNo,day).getDay()===0};
  });

  const handleDeleteHoliday=async()=>{
    if(!deletingHoliday)return;
    setDeleteBusy(true);
    try{
      await del('/calendar/'+deletingHoliday.date);
      notify(deletingHoliday.name+' was removed from the calendar.');
      setDeletingHoliday(null);
      retry();
    }catch(e){
      throw e;
    }finally{
      setDeleteBusy(false);
    }
  };

  return <>
    <PageTitle eyebrow="PLAN AHEAD, LEAVE SPACE" title="Holiday calendar" description="National holidays and company observances for your year." action={user.role==='ADMIN'?<Button variant="soft" icon={Plus} onClick={()=>setAddOpen(true)}>Add holiday</Button>:null}/>
    {error&&<div className="calendar-load-error" role="alert"><span className="calendar-load-error-icon"><CircleAlert size={17}/></span><div><b>We couldn’t refresh the holiday calendar.</b><p>{error}</p><Button variant="soft" size="small" icon={RefreshCw} onClick={retry} disabled={loading}>Retry calendar</Button></div></div>}
    {created&&<div className="inline-alert alert-success calendar-created-message" role="status" aria-live="polite"><CircleCheck size={16}/> Holiday updated in the company calendar.<button type="button" onClick={()=>setCreated(false)} aria-label="Dismiss confirmation"><X size={15}/></button></div>}

    <div className="calendar-main-stage">
      <Card className="calendar-card" aria-busy={loading}>
        <div className="calendar-toolbar">
          <div><div className="calendar-eyebrow">FALCHION XENIAA · PUNE</div><h2>{new Intl.DateTimeFormat("en-IN",{month:"long",year:"numeric"}).format(month)}</h2>{loading&&<span className="calendar-refreshing" role="status"><Spinner/> Updating calendar…</span>}</div>
          <div className="calendar-controls"><button className="icon-button" type="button" onClick={prev} aria-label="Previous month"><ChevronLeft size={19}/></button><button className="button button-soft button-small" type="button" onClick={()=>setMonth(new Date(Number(today.slice(0,4)),Number(today.slice(5,7))-1,1))} aria-label="Today - Go to current month">Today</button><button className="icon-button" type="button" onClick={next} aria-label="Next month"><ChevronRight size={19}/></button></div>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d)=><span key={d}>{d}</span>)}</div>
        <div className="calendar-grid" aria-label={new Intl.DateTimeFormat("en-IN",{month:"long",year:"numeric"}).format(month)}>{rows.map((cell,i)=>cell?<div key={cell.key} className={"calendar-day"+(cell.isToday?" calendar-today":"")+(cell.holiday?" calendar-holiday":"")+(cell.holiday?.kind==="FIXED"?" calendar-holiday-fixed":"")+(cell.holiday?.kind==="FLOATING"?" calendar-holiday-floating":"")+(cell.isSunday?" calendar-sunday":"")}><b>{cell.day}</b>{cell.holiday&&<small title={cell.holiday.name}>{cell.holiday.name}</small>}</div>:<div className="calendar-day calendar-day-empty" aria-hidden="true" key={"empty-"+i}/>)}</div>
        <div className="calendar-legend"><span><i className="legend-dot legend-fixed"/> Fixed</span><span><i className="legend-dot legend-floating"/> Floating</span><span><i className="legend-dot legend-done"/> Today</span><span>Working days: Monday – Saturday</span></div>
      </Card>
    </div>
    <section className="holiday-section">
      <div className="section-head holiday-section-head"><div><h2>Holidays in {year}</h2><p>One clean view of national and company observances.</p></div><div className="holiday-section-meta"><span className="holiday-count">{yearHolidays.length}</span><span>{loading?"Updating calendar…":error?"Last available data":"Updated for this year"}</span></div></div>
      <Card className="holidays-card holidays-card-wide" aria-busy={loading}>
        {loading?<div className="table-message calendar-list-loading" role="status"><Spinner/> Loading annual holidays…</div>:yearHolidays.length?<div className="holiday-grid">{yearHolidays.map((h)=><div className={"holiday-row holiday-row-"+(h.kind==="FLOATING"?"floating":"fixed")} key={h.date}><div className="holiday-date"><b>{formatDate(h.date,{day:"2-digit"})}</b><small>{formatDate(h.date,{month:"short"}).toUpperCase()}</small></div><div className="holiday-row-copy"><b>{h.name}</b><small>{formatDate(h.date,{weekday:"long"})} · {h.kind==="FLOATING"?"Floating":"Fixed"}{h.isPolicy?' · Statutory national holiday':''}</small></div>{user.role==='ADMIN'&&!h.isPolicy?<div className="holiday-row-actions" style={{display:'flex',gap:'6px',alignItems:'center'}}><button className="icon-button" type="button" title={"Edit "+h.name} aria-label={"Edit "+h.name} onClick={()=>setEditingHoliday(h)}><Pencil size={14}/></button><button className="icon-button" type="button" style={{color:'var(--red,#e53e3e)'}} title={"Remove "+h.name} aria-label={"Remove "+h.name} onClick={()=>setDeletingHoliday(h)}><Trash2 size={14}/></button></div>:<span className="holiday-pin" title={h.isPolicy?'Statutory national holiday':'Company observance'}><Sun size={16}/></span>}</div>)}</div>:error?<div className="calendar-empty-error"><CircleAlert size={18}/><b>Holiday data is unavailable.</b><p>Try loading the calendar again. No changes have been made to your leave balance.</p><Button variant="soft" size="small" icon={RefreshCw} onClick={retry}>Retry calendar</Button></div>:<EmptyState icon={CalendarDays} title="No holidays found" body="Company holidays will show here once they’re added."/>}
      </Card>
      <div className="calendar-note calendar-note-wide"><span><ShieldCheck size={17}/></span><div><b>How leave days are counted</b><p>Sundays and holidays are excluded from leave balance calculations. Saturday is a working day.</p></div></div>
    </section>
    {addOpen&&<HolidayModal close={()=>setAddOpen(false)} onDone={(msg)=>{setAddOpen(false);setCreated(true);notify(msg);retry();}}/>}
    {editingHoliday&&<HolidayModal holiday={editingHoliday} close={()=>setEditingHoliday(null)} onDone={(msg)=>{setEditingHoliday(null);notify(msg);retry();}}/>}
    {deletingHoliday&&<DeleteHolidayModal holiday={deletingHoliday} close={()=>setDeletingHoliday(null)} onConfirm={handleDeleteHoliday} busy={deleteBusy}/>}
  </>;
}
function HolidayModal({holiday,close,onDone}){
  const isEditing=Boolean(holiday);
  const [date,setDate]=useState(holiday?.date||'');
  const [name,setName]=useState(holiday?.name||'');
  const [kind,setKind]=useState(holiday?.kind||'FLOATING');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const submit=async(e)=>{
    e.preventDefault();
    setBusy(true);
    setError('');
    try{
      await post('/calendar',{date,name,kind});
      onDone(isEditing?name+' was updated.':name+' was added to the company calendar.');
    }catch(e){
      setError(e.message);
    }finally{
      setBusy(false);
    }
  };
  return <Modal title={isEditing?"Edit company holiday":"Add a company holiday"} subtitle={isEditing?"Update observance name or classification.":"This date will be excluded from working-day leave calculations."} close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Date</span><input aria-label="Date" type="date" value={date} onChange={(e)=>setDate(e.target.value)} disabled={isEditing} required/></label><label className="form-field"><span>Holiday name</span><input aria-label="Holiday name" value={name} maxLength="160" onChange={(e)=>setName(e.target.value)} placeholder="For example: Diwali" required/></label><label className="form-field"><span>Holiday type</span><div className="select-wrap"><select aria-label="Holiday type" value={kind} onChange={(e)=>setKind(e.target.value)}><option value="FLOATING">Floating festival / observance · yellow</option><option value="FIXED">Fixed company holiday · red</option></select><ChevronDown size={15}/></div></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{isEditing?"Save changes":"Add holiday"}</Button></div></form></Modal>;
}
function DeleteHolidayModal({holiday,close,onConfirm,busy}){
  const [error,setError]=useState('');
  const submit=async(e)=>{
    e.preventDefault();
    setError('');
    try{
      await onConfirm();
    }catch(e){
      setError(e.message);
    }
  };
  return <Modal title="Remove company holiday" subtitle="Remove this observance from the company calendar." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<div className="inline-alert alert-warning" role="alert" style={{display:'flex',gap:'8px',alignItems:'flex-start'}}><CircleAlert size={18} style={{flexShrink:0,marginTop:'2px'}}/><div><strong>Confirm removal:</strong><p style={{margin:'4px 0 0 0',fontSize:'13px'}}>Are you sure you want to remove <b>{holiday.name}</b> ({holiday.date})? This date will become a regular working day for leave calculations.</p></div></div><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" className="button-danger" loading={busy}>Remove holiday</Button></div></form></Modal>;
}
const AddHolidayModal=HolidayModal;

function NotificationsPage(){
  const {notifications,refreshNotifications,notify}=useApp();
  const [items,setItems]=useState([]);const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);const [loadError,setLoadError]=useState('');const [actionError,setActionError]=useState('');const [busy,setBusy]=useState(false);const [busyId,setBusyId]=useState(null);const [filter,setFilter]=useState('ALL');const [kindFilter,setKindFilter]=useState('ALL');const [prefsOpen,setPrefsOpen]=useState(false);const [prefs,setPrefs]=useState(()=>{try{return JSON.parse(localStorage.getItem('hrms-notification-prefs')||'{}');}catch{return {};}});const notificationRequest=useRef(0);const notificationsLoaded=useRef(false);
  const load=async()=>{const requestId=++notificationRequest.current;if(!notificationsLoaded.current)setLoading(true);else setRefreshing(true);setLoadError('');setActionError('');try{const data=await get('/account/notifications');if(requestId!==notificationRequest.current)return;setItems(Array.isArray(data.notifications)?data.notifications:[]);notificationsLoaded.current=true;void refreshNotifications();}catch(e){if(requestId===notificationRequest.current)setLoadError(e.message||'Notifications could not be loaded.');}finally{if(requestId===notificationRequest.current){setLoading(false);setRefreshing(false);}}};
  useEffect(()=>{void load();return()=>{notificationRequest.current+=1;};},[]);
  const unreadCount=items.filter((item)=>!item.read_at).length;
  const mark=async(id)=>{if(busy||busyId!==null)return;setBusyId(id);setActionError('');try{await post(`/account/notifications/${id}/read`);setItems(all=>all.map(item=>item.id===id?{...item,read_at:new Date().toISOString()}:item));void refreshNotifications();}catch(e){setActionError(e.message||'This notification could not be marked as read.');}finally{setBusyId(null);}};
  const markAll=async()=>{if(busy||busyId!==null||unreadCount===0)return;setBusy(true);setActionError('');try{await post('/account/notifications/read-all');setItems(all=>all.map(item=>({...item,read_at:item.read_at||new Date().toISOString()})));void refreshNotifications();notify('All notifications marked as read.');}catch(e){setActionError(e.message||'Notifications could not be marked as read.');}finally{setBusy(false);}};
  const updatePreference=(key)=>setPrefs((previous)=>{const next={...previous,[key]:previous[key]===false};try{localStorage.setItem('hrms-notification-prefs',JSON.stringify(next));}catch{/* Preferences still work for this session if storage is unavailable. */}return next;});
  const visible=items.filter((item)=>{const unreadMatch=filter!=='UNREAD'||!item.read_at;const kind=String(item.kind||'').toUpperCase();const category=kind==='ANNOUNCEMENT'?'announcements':['REQUEST','APPROVAL'].includes(kind)?'requests':'updates';const prefMatch=prefs[category]!==false;const kindMatch=kindFilter==='ALL'||(kindFilter==='ANNOUNCEMENT'&&kind==='ANNOUNCEMENT')||(kindFilter==='REQUEST'&&['REQUEST','APPROVAL'].includes(kind))||(kindFilter==='UPDATE'&&!['ANNOUNCEMENT','REQUEST','APPROVAL'].includes(kind));return unreadMatch&&kindMatch&&prefMatch;});
  return <><PageTitle eyebrow="STAY IN THE LOOP" title="Notifications" description="Approvals, attendance updates and other useful workplace messages." action={<Button variant="soft" icon={CheckCheck} onClick={markAll} disabled={!unreadCount||busy||busyId!==null} loading={busy}>Mark all read</Button>}/>
    <div className="notification-page-summary"><Card><span><Bell size={17}/></span><div><b>{unreadCount}</b><small>Unread</small></div></Card><Card><span><CheckCheck size={17}/></span><div><b>{items.length}</b><small>Recent messages</small></div></Card><Card><span><ShieldCheck size={17}/></span><div><b>Private</b><small>Only visible to you</small></div></Card></div>
    <div className="notification-page-toolbar"><div className="notification-filter-stack"><div className="approval-tabs"><button className={filter==='ALL'?'approval-tab-active':''} onClick={()=>setFilter('ALL')}>All</button><button type="button" className={filter==='UNREAD'?'approval-tab-active':''} onClick={()=>setFilter('UNREAD')}>Unread {unreadCount?"("+unreadCount+")":""}</button></div><div className="approval-tabs notification-kind-tabs"><button className={kindFilter==='ALL'?'approval-tab-active':''} onClick={()=>setKindFilter('ALL')}>Everything</button><button className={kindFilter==='ANNOUNCEMENT'?'approval-tab-active':''} onClick={()=>setKindFilter('ANNOUNCEMENT')}>Announcements</button><button className={kindFilter==='REQUEST'?'approval-tab-active':''} onClick={()=>setKindFilter('REQUEST')}>Requests</button></div></div><div className="notification-toolbar-actions"><button type="button" className="icon-button" onClick={()=>setPrefsOpen(v=>!v)} aria-label="Notification preferences"><Settings size={16}/></button><button type="button" className="text-button" onClick={()=>void load()} disabled={loading||refreshing}>{loading||refreshing?'Refreshing…':'Refresh'}</button></div></div>
    {prefsOpen&&<Card className="notification-preferences"><div><span className="eyebrow">PREFERENCES</span><b>Choose what appears in this browser</b><small>These settings only control display on this device.</small></div><div className="notification-preference-switches">{[["announcements","Announcements"],["requests","Requests"],["updates","Updates"]].map(([key,label])=><button type="button" className={prefs[key]!==false?"selected":""} key={key} onClick={()=>updatePreference(key)}><span className={prefs[key]!==false?"pref-check":"pref-empty"}>{prefs[key]!==false?<Check size={12}/>:null}</span>{label}</button>)}</div></Card>}
    {loadError&&<div className="employee-page-error" role="alert"><CircleAlert size={16}/><span>{loadError}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading||refreshing}><RefreshCw size={14}/>{loading||refreshing?'Refreshing…':'Retry notifications'}</button></div>}
    {actionError&&<div className="employee-page-error-inline" role="alert"><CircleAlert size={15}/><span>{actionError}</span></div>}
    <Card className="notification-page-card" aria-busy={loading||refreshing}>{loading?<div className="employee-page-loading notification-loading" role="status"><Spinner/><span>Loading your notifications…</span></div>:visible.length?<div className="notification-page-list">{visible.map(item=><button type="button" key={item.id} className={`notification-page-item${item.read_at?'':' notification-page-item-unread'}`} onClick={()=>!item.read_at&&mark(item.id)} disabled={busyId===item.id}><span className="notification-page-icon"><Bell size={16}/></span><span className="notification-page-copy"><b>{item.title}</b><small>{item.body}</small><em>{formatDate(String(item.created_at).slice(0,10),{weekday:'short',day:'numeric',month:'short'})} · {formatTime(item.created_at)}</em></span><span className="notification-page-state">{item.read_at?'Read':'Unread'}</span></button>)}</div>:<EmptyState icon={Bell} title={loadError?'Could not load notifications.':filter==='UNREAD'?'You have no unread notifications.':'No notifications yet.'} body={loadError?'Retry to load your notifications.':'New approvals and workplace updates will appear here.'}/>}</Card>
  </>;
}
function ApprovalsPage(){
  const {notify,refresh}=useApp();
  const [searchParams,setSearchParams]=useSearchParams();
  const [items,setItems]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [loadFailed,setLoadFailed]=useState(false);
  const [filter,setFilterState]=useState(()=>searchParams.get('filter')?.toUpperCase()||'ALL');
  const [search,setSearchState]=useState(()=>searchParams.get('search')||'');
  const [reviewing,setReviewing]=useState(null);const [busy,setBusy]=useState(false);const approvalsRequest=useRef(0);const approvalsLoaded=useRef(false);
  const deepLinkedProcessed = useRef(false);
  const targetId = searchParams.get('id');
  const targetType = searchParams.get('type')?.toLowerCase();

  useEffect(() => {
    if (!targetId || items.length === 0 || deepLinkedProcessed.current) return;
    const found = items.find((x: any) => x.id === targetId && (!targetType || String(x.type).toLowerCase() === targetType));
    if (found) {
      deepLinkedProcessed.current = true;
      setReviewing({ item: found, decision: 'APPROVED' });
    }
  }, [items, targetId, targetType]);

  useEffect(() => {
    if (!targetId && reviewing) {
      setReviewing(null);
    }
  }, [targetId]);

  const openReview = (item: any, decision: string) => {
    setReviewing({ item, decision });
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.set('id', item.id);
      n.set('type', item.type);
      return n;
    }, { replace: false });
  };

  const closeReview = () => {
    setReviewing(null);
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.delete('id');
      n.delete('type');
      return n;
    }, { replace: false });
  };
  const setFilter=(f)=>{
    setFilterState(f);
    setSearchParams(prev=>{const n=new URLSearchParams(prev);if(f==='ALL')n.delete('filter');else n.set('filter',f);return n;},{replace:true});
  };
  const setSearch=(s)=>{
    setSearchState(s);
    setSearchParams(prev=>{const n=new URLSearchParams(prev);if(!s)n.delete('search');else n.set('search',s);return n;},{replace:true});
  };
  const load=async()=>{const requestId=++approvalsRequest.current;if(!approvalsLoaded.current)setLoading(true);setError('');setLoadFailed(false);try{const r=await get('/admin/approvals');if(requestId!==approvalsRequest.current)return;setItems(Array.isArray(r.approvals)?r.approvals:[]);approvalsLoaded.current=true;}catch(e){if(requestId===approvalsRequest.current){setError(e.message||'The review queue could not be loaded.');setLoadFailed(true);}}finally{if(requestId===approvalsRequest.current)setLoading(false);}};
  useEffect(()=>{void load();return()=>{approvalsRequest.current+=1;};},[]);
  const visible=items.filter((x)=>{const matchFilter=filter==='ALL'||String(x.type||'').toUpperCase()===filter;const text=((x.full_name||'')+' '+(x.employee_code||'')+' '+(x.category||'')+' '+(x.reason||'')).toLowerCase();return matchFilter&&text.includes(search.toLowerCase());});
  const counts={all:items.length,leave:items.filter(x=>x.type==='leave').length,wfh:items.filter(x=>x.type==='wfh').length,correction:items.filter(x=>x.type==='correction').length,flex:items.filter(x=>x.type==='flex').length};
  const review=async(item,decision,note)=>{if(busy)return;setBusy(true);setError('');try{await post('/admin/approvals/'+item.type+'/'+item.id,{decision,note});setItems((current)=>current.filter((entry)=>!(entry.id===item.id&&entry.type===item.type)));closeReview();await load();refresh();notify(item.full_name+'’s '+item.type+' request was '+(decision==='APPROVED'?'approved':'declined')+'.');}catch(e){setError(e.message||'The decision could not be saved. Refresh the queue and verify the request status.');}finally{setBusy(false);}};
  return <><PageTitle eyebrow="YOUR REVIEW MAKES A DIFFERENCE" title="Requests" description="Review leave, WFH, attendance corrections and flexible-start requests with context." action={<Button variant="soft" icon={RefreshCw} onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh'}</Button>}/>{error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}>Retry queue</button></div>}
    <div className="approval-command-bar">
      <div className="approval-command-intro"><span className="approval-command-icon"><ClipboardCheck size={19}/></span><div><span className="eyebrow">REVIEW QUEUE</span><b>{counts.all?counts.all+' request'+(counts.all===1?'':'s')+' need your attention':'Queue is clear'}</b><small>{counts.all?'Approve or decline after considering the employee’s context.':'Nothing is waiting for a decision right now.'}</small></div></div>
      <div className="approval-command-metrics"><button onClick={()=>setFilter('ALL')} className={filter==='ALL'?'active':''}><b>{counts.all}</b><small>All</small></button><button onClick={()=>setFilter('LEAVE')} className={filter==='LEAVE'?'active':''}><b>{counts.leave}</b><small>Leave</small></button><button onClick={()=>setFilter('WFH')} className={filter==='WFH'?'active':''}><b>{counts.wfh}</b><small>WFH</small></button><button onClick={()=>setFilter('CORRECTION')} className={filter==='CORRECTION'?'active':''}><b>{counts.correction}</b><small>Attendance</small></button><button onClick={()=>setFilter('FLEX')} className={filter==='FLEX'?'active':''}><b>{counts.flex}</b><small>Flex</small></button></div>
    </div>
    <Card className="approval-workspace"><div className="approval-workspace-toolbar"><div className="search-box"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people or request context…" aria-label="Search requests"/></div><span>{visible.length} visible</span></div>
      {loading?<div className="approval-skeleton"><Spinner/></div>:loadFailed?<div className="admin-empty-recovery"><CircleAlert size={18}/><b>Review queue unavailable</b><span>We could not determine whether requests are waiting. Refresh to try again.</span><Button size="small" variant="soft" onClick={()=>void load()}>Retry queue</Button></div>:visible.length?<div className="approval-list">{visible.map((item)=><ApprovalCard key={item.type+'-'+item.id} item={item} onReview={(decision)=>openReview(item,decision)}/>)}</div>:<EmptyState icon={CheckCheck} title={filter==='ALL'&& !search?'You’re all caught up.':'Nothing matches this view.'} body={filter==='ALL'&&!search?'Every request has been reviewed. Your team will see you when something needs attention.':'Try another request type or search term.'}/>}
    </Card>
    {reviewing&&<ReviewModal item={reviewing.item} initialDecision={reviewing.decision} busy={busy} close={closeReview} onReview={(decision,note)=>review(reviewing.item,decision,note)}/>}
  </>;
}
function ApprovalCard({item,onReview}){
  const icon=item.type==='leave'?CalendarDays:item.type==='wfh'?House:item.type==='flex'?Timer:Clock3;const Icon=icon;const [downloading,setDownloading]=useState(false);const {notify}=useApp();
  const attachment=async()=>{if(!item.attachment_id)return;setDownloading(true);try{const response=await get('/files/'+item.attachment_id);const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=item.attachment_name||'leave-document';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notify(e.message,'error');}finally{setDownloading(false);}};
  return <Card className="approval-request"><div className="approval-request-icon"><Icon size={19}/></div><div className="approval-request-main"><div className="approval-request-top"><span className="approval-category">{item.category}</span><span className="approval-request-date">Received {formatDate(String(item.created_at).slice(0,10),{day:'numeric',month:'short'})}</span></div><h3>{item.full_name}<small>{item.employee_code}</small></h3><div className="approval-request-meta">{item.date&&<span><Calendar size={14}/>{formatDate(item.date,{day:'numeric',month:'short',year:'numeric'})}{item.end_date&&item.end_date!==item.date?' – '+formatDate(item.end_date,{day:'numeric',month:'short'}):''}</span>}{item.days!=null&&<span><Timer size={14}/>{item.days} day{Number(item.days)===1?'':'s'}</span>}</div><p className="approval-reason">{item.reason||'No additional context provided.'}</p>{item.attachment_name&&<button className="attachment-link" onClick={attachment} disabled={downloading}><FileText size={14}/>{downloading?'Opening…':item.attachment_name}<Download size={13}/></button>}</div><div className="approval-actions"><button className="button button-soft button-small" onClick={()=>onReview('REJECTED')}>Decline</button><button className="button button-primary button-small" onClick={()=>onReview('APPROVED')}><Check size={15}/> Approve</button></div></Card>;
}
function ReviewModal({item,initialDecision,busy,close,onReview}){
  const [note,setNote]=useState('');const [decision,setDecision]=useState(initialDecision||'APPROVED');
  return <Modal title={decision==='APPROVED'?'Approve this request?':'Decline this request?'} subtitle={item.full_name+' · '+item.category} close={close}><div className="review-summary"><span className="review-summary-icon">{item.type==='wfh'?<House size={17}/>:item.type==='flex'?<Timer size={17}/>:item.type==='correction'?<Clock3 size={17}/>:<CalendarDays size={17}/>}</span><div><b>{item.date?formatDate(item.date,{weekday:'short',day:'numeric',month:'long',year:'numeric'}):'Attendance correction'}</b><p>{item.reason||'No additional context provided.'}</p></div></div><label className="form-field"><span>Note for the employee <small>(optional)</small></span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={decision==='APPROVED'?'Add helpful context if useful.':'A short explanation will help them understand.'} maxLength="1000"/></label><div className="decision-toggle"><button type="button" className={decision==='APPROVED'?'decision-current':''} onClick={()=>setDecision('APPROVED')}><Check size={14}/> Approve</button><button type="button" className={decision==='REJECTED'?'decision-current decision-no':''} onClick={()=>setDecision('REJECTED')}><X size={14}/> Decline</button></div><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button variant={decision==='APPROVED'?'primary':'danger'} loading={busy} onClick={()=>onReview(decision,note)}>{decision==='APPROVED'?'Confirm approval':'Confirm decline'}</Button></div></Modal>;
}

function LearningAllowanceSection({ notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: '', provider: '', amount: '', notes: '' });
  const [file, setFile] = useState(null);

  const loadBudget = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await get('/enterprise/learning/budget');
      setData(res);
    } catch (e) {
      setError(e.message || 'Could not load Learning & Development allowance.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadBudget(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || !form.title.trim() || !form.provider.trim() || !form.amount) return;
    const amountVal = Number(form.amount);
    if (amountVal <= 0 || (data && amountVal > data.remaining_balance)) {
      setError(`Claim amount cannot exceed remaining balance (₹${data?.remaining_balance || 0}).`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let attachmentId = null;
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const up = await post('/files', formData);
        attachmentId = up.id;
      }
      await post('/enterprise/learning/claims', {
        title: form.title.trim(),
        provider: form.provider.trim(),
        amount_inr: amountVal,
        invoice_attachment_id: attachmentId,
        notes: form.notes.trim() || undefined
      });
      notify(`L&D claim for ₹${amountVal} submitted for admin review.`);
      setForm({ title: '', provider: '', amount: '', notes: '' });
      setFile(null);
      setShowForm(false);
      await loadBudget();
    } catch (err) {
      setError(err.message || 'Could not submit learning claim.');
    } finally {
      setSubmitting(false);
    }
  };

  const spentOrCommitted = (data?.approved_amount || 0) + (data?.pending_amount || 0);
  const percentUsed = data?.annual_allowance ? Math.min(100, Math.round((spentOrCommitted / data.annual_allowance) * 100)) : 0;

  return (
    <Card className="profile-info-card learning-allowance-card" style={{ marginTop: '20px' }}>
      <div className="profile-info-heading">
        <div>
          <span className="profile-info-icon"><GraduationCap size={18} /></span>
          <div>
            <h2>Learning & Development Allowance</h2>
            <p>Annual budget of ₹24,000 (₹2,000/month) for books, courses, certifications, and conferences.</p>
          </div>
        </div>
        {!showForm && data && data.remaining_balance > 0 && (
          <button type="button" className="button button-soft button-small" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New claim
          </button>
        )}
      </div>

      {error && <InlineError>{error}</InlineError>}

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center' }}><Spinner /></div>
      ) : data ? (
        <div>
          <div className="leave-progress" style={{ marginBottom: '16px' }}>
            <span style={{ width: `${percentUsed}%`, background: 'var(--brand-gold, #DAAF51)' }} />
          </div>
          <div className="profile-info-grid" style={{ marginBottom: '16px' }}>
            <div><span>Annual allowance</span><b>₹{data.annual_allowance.toLocaleString('en-IN')}</b></div>
            <div><span>Approved claims</span><b>₹{data.approved_amount.toLocaleString('en-IN')}</b></div>
            <div><span>Pending review</span><b>₹{data.pending_amount.toLocaleString('en-IN')}</b></div>
            <div><span>Remaining balance</span><b style={{ color: 'var(--brand-gold, #DAAF51)' }}>₹{data.remaining_balance.toLocaleString('en-IN')}</b></div>
          </div>

          {showForm && (
            <form onSubmit={handleSubmit} className="form-stack" style={{ padding: '16px', background: 'var(--canvas-subtle, #f9fafb)', borderRadius: '8px', border: '1px solid var(--border-subtle, #eee)', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Submit L&D Reimbursement Claim</h3>
              <div className="form-two">
                <label className="form-field">
                  <span>Course / Certification Title</span>
                  <input
                    type="text"
                    required
                    maxLength={180}
                    placeholder="e.g. AWS Certified Solutions Architect"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </label>
                <label className="form-field">
                  <span>Platform / Provider</span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    placeholder="e.g. Udemy, Coursera, Pearson"
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-two">
                <label className="form-field">
                  <span>Reimbursement Amount (₹)</span>
                  <input
                    type="number"
                    required
                    min="1"
                    max={data.remaining_balance}
                    placeholder={`Max ₹${data.remaining_balance}`}
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </label>
                <label className="form-field">
                  <span>Receipt / Invoice (PDF, JPG, PNG)</span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <label className="form-field">
                <span>Learning context / Relevance</span>
                <textarea
                  rows={2}
                  maxLength={1000}
                  placeholder="How does this course enhance your role at Falchion Xeniaa?"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" className="button button-soft button-small" onClick={() => setShowForm(false)}>Cancel</button>
                <Button type="submit" loading={submitting} size="small" icon={Send}>Submit claim</Button>
              </div>
            </form>
          )}

          {data.claims && data.claims.length > 0 ? (
            <div className="table-scroll">
              <table aria-label="Learning allowance claims">
                <thead>
                  <tr>
                    <th scope="col">COURSE / CERTIFICATION</th>
                    <th scope="col">PROVIDER</th>
                    <th scope="col">AMOUNT</th>
                    <th scope="col">DATE</th>
                    <th scope="col">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.claims.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.title}</b>
                        {c.attachment_name && (
                          <small className="table-subline"><FileText size={12} /> {c.attachment_name}</small>
                        )}
                        {c.rejection_reason && (
                          <small style={{ color: 'var(--brand-red, #931314)', display: 'block', marginTop: '2px' }}>Note: {c.rejection_reason}</small>
                        )}
                      </td>
                      <td>{c.provider}</td>
                      <td><b>₹{Number(c.amount_inr).toLocaleString('en-IN')}</b></td>
                      <td>{formatDate(String(c.created_at).slice(0, 10), { day: 'numeric', month: 'short' })}</td>
                      <td><StatusPill value={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: '13px', color: 'var(--text-muted, #777)', margin: '8px 0 0' }}>No claims submitted for this fiscal year yet.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function ProfilePage(){
  const {user,setUser,notify,theme,setTheme}=useApp();
  const [profile,setProfile]=useState(user);
  const [phone,setPhone]=useState(user.phone||'');
  const [busy,setBusy]=useState(false);
  const [photoBusy,setPhotoBusy]=useState(false);
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');
  const [profileLoading,setProfileLoading]=useState(true);
  const [profileRetry,setProfileRetry]=useState(0);
  const [photoVersion,setPhotoVersion]=useState(Date.now());

  useEffect(()=>{
    let active=true;
    setProfileLoading(true);
    setLoadError('');
    get('/account/profile')
      .then((r)=>{
        if(!active)return;
        setProfile(r.profile);
        setPhone(r.profile.phone||'');
        setPhotoVersion(Date.now());
      })
      .catch((e)=>{if(active)setLoadError(e.message||'Your profile details could not be loaded.');})
      .finally(()=>{if(active)setProfileLoading(false);});
    return ()=>{active=false;};
  },[profileRetry]);

  const normalizedPhone=phone.trim()||null;
  const phoneChanged=normalizedPhone!==(profile.phone||null);

  const save=async(e)=>{
    e.preventDefault();
    if(!phoneChanged||busy)return;
    setBusy(true);setError('');
    try{
      await patch('/account/profile',{phone:normalizedPhone});
      setProfile((current)=>({...current,phone:normalizedPhone}));
      setUser((current)=>({...current,phone:normalizedPhone}));
      setPhone(normalizedPhone||'');
      notify('Your contact details were saved.');
    }catch(e){setError(e.message||'Your mobile number could not be saved.');}
    finally{setBusy(false);}
  };

  const uploadPhoto=async(e)=>{
    const file=e.target.files?.[0]||null;e.target.value='';
    if(!file)return;
    if(file.size>4*1024*1024){setError('Profile photos must be 4 MB or smaller.');return;}
    setPhotoBusy(true);setError('');
    try{
      const form=new FormData();form.append('photo',file);
      await post('/account/profile/photo',form);
      setProfile((p)=>({...p,profile_photo_available:true}));
      setUser((u)=>({...u,profile_photo_available:true}));
      setPhotoVersion(Date.now());
      notify('Profile photo updated.');
    }catch(e){setError(e.message||'The profile photo could not be updated.');}
    finally{setPhotoBusy(false);}
  };

  const removePhoto=async()=>{
    if(photoBusy)return;
    setPhotoBusy(true);setError('');
    try{
      await del('/account/profile/photo');
      setProfile((p)=>({...p,profile_photo_available:false}));
      setUser((u)=>({...u,profile_photo_available:false}));
      setPhotoVersion(Date.now());
      notify('Profile photo removed.');
    }catch(e){setError(e.message||'The profile photo could not be removed.');}
    finally{setPhotoBusy(false);}
  };

  const photoSrc=profile.profile_photo_available?assetUrl('/account/profile/photo')+'?v='+photoVersion:null;
  const displayRole=profile.role==='ADMIN'?'Administrator':profile.user_type==='INTERN'?'Intern':'Employee';
  const profileCompletion=[Boolean(profile.full_name),Boolean(profile.email),Boolean(profile.profile_photo_available),Boolean(profile.phone),Boolean(profile.department),Boolean(profile.position)].filter(Boolean).length*100/6;

  return <>
    <PageTitle
      eyebrow="YOUR DETAILS, YOURS TO UPDATE"
      title="My profile"
      description="Keep your work identity, contact details and organization information current."
    />

    {profileLoading&&<div className="profile-loading-strip" role="status"><Spinner/><span>Syncing your work details…</span></div>}
    {loadError&&<div className="profile-load-error" role="alert"><span><CircleAlert size={17}/></span><div><b>We couldn’t refresh your profile.</b><p>{loadError}</p><Button variant="soft" size="small" icon={RefreshCw} onClick={()=>setProfileRetry((v)=>v+1)} disabled={profileLoading}>Retry profile details</Button></div></div>}
    {error&&<InlineError>{error}</InlineError>}

    {profileCompletion<100&&<Card className="profile-onboarding-card"><div className="profile-onboarding-icon"><CheckCircle2 size={18}/></div><div className="profile-onboarding-copy"><span className="eyebrow">WORKSPACE SETUP</span><h2>Make your profile feel complete.</h2><p>Add a photo and mobile number so your People Portal identity is ready when your team needs it.</p><div className="profile-onboarding-progress" role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(profileCompletion)}><i style={{width:profileCompletion+"%"}}/></div><small>{Math.round(profileCompletion)}% complete · {profile.profile_photo_available?'Photo added':'Photo missing'} · {profile.phone?'Mobile added':'Mobile missing'}</small></div><div className="profile-onboarding-actions">{!profile.profile_photo_available&&<label className="photo-button"><Camera size={14}/> Add photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={photoBusy}/></label>} {!profile.phone&&<a className="button button-soft button-small" href="#contact-details">Add mobile</a>}</div></Card>}

    <div className="profile-page" aria-busy={profileLoading}>
      <Card className="profile-identity-card">
        <div className="profile-identity">
          <div className="profile-identity-avatar">
            {photoSrc?<img src={photoSrc} alt={profile.full_name||'Profile photo'} decoding="async"/>:initials(profile.full_name)}
          </div>
          <div className="profile-identity-copy">
            <h2>{profile.full_name||'Your profile'}</h2>
            <p>{profile.position||profile.title||'Team member'} <span>·</span> {displayRole}</p>
            <div className="profile-identity-meta">
              <span>{profile.employee_code||'Employee ID pending'}</span>
              <span>{profile.department||'General'}</span>
              <span>{profile.branch||'Pune'}</span>
            </div>
          </div>
          <StatusPill value={profile.status}/>
        </div>
        <div className="profile-photo-actions profile-photo-actions-clean">
          <label className={'photo-button'+(photoBusy?' photo-button-busy':'')}><Camera size={15}/>{photoBusy?'Updating…':'Change photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={photoBusy}/></label>
          {profile.profile_photo_available&&<button className="photo-remove-button" type="button" onClick={removePhoto} disabled={photoBusy}>{photoBusy?'Please wait…':'Remove photo'}</button>}
          <span className="profile-photo-hint">JPG, PNG or WebP · Up to 4 MB</span>
        </div>
      </Card>

      <Card className="profile-info-card">
        <div className="profile-info-heading">
          <div><span className="profile-info-icon"><BriefcaseBusiness size={18}/></span><div><h2>Work information</h2><p>Your organization and employment details.</p></div></div>
        </div>
        <div className="profile-info-grid">
          <div><span>Employee ID</span><b>{profile.employee_code||'—'}</b></div>
          <div><span>Work email</span><b className="profile-value-wrap">{profile.email||'—'}</b></div>
          <div><span>Position</span><b>{profile.position||profile.title||'Employee'}</b></div>
          <div><span>Department</span><b>{profile.department||'General'}</b></div>
          <div><span>Branch</span><b>{profile.branch||'Pune'}</b></div>
          <div><span>Employment type</span><b>{profile.user_type==='ADMIN'?'Administrator':profile.user_type==='INTERN'?'Intern':'Employee'}</b></div>
          <div><span>Joining date</span><b>{formatDate(profile.joined_on)}</b></div>
          <div><span>Probation ends</span><b>{profile.probation_end_date?formatDate(profile.probation_end_date):'Not set'}</b></div>
          <div><span>Reports to</span><b>{profile.manager||'Falchion Xeniaa administrator'}</b></div>
          <div><span>WFH access</span><b>{profile.wfh_enabled?'Enabled':'Not enabled'}</b></div>
          <div><span>Status</span><b><StatusPill value={profile.status}/></b></div>
        </div>
      </Card>

      <Card id="contact-details" className="profile-info-card profile-contact-card">
        <div className="profile-info-heading">
          <div><span className="profile-info-icon"><CircleUserRound size={18}/></span><div><h2>Personal details</h2><p>Your name and work email are controlled by administrators. You can update your mobile number.</p></div></div>
        </div>
        <form className="profile-contact-form" onSubmit={save}>
          <label className="form-field"><span>Full name</span><input aria-label="Full name" value={profile.full_name||''} disabled autoComplete="name"/></label>
          <label className="form-field"><span>Work email</span><input aria-label="Work email" type="email" value={profile.email||''} disabled autoComplete="email"/></label>
          <label className="form-field"><span>Mobile number</span><input aria-label="Mobile number" type="tel" value={phone} maxLength="32" autoComplete="tel" onChange={(e)=>setPhone(e.target.value)} placeholder="+91 …" aria-describedby="profile-phone-help"/></label>
          <div id="profile-phone-help" className="profile-security"><ShieldCheck size={16}/><span>Google Sign-In secures access. Role, branch, department and position remain administrator-controlled.</span></div>
          <Button type="submit" loading={busy} disabled={!phoneChanged||profileLoading}>Save mobile number</Button>
        </form>
      </Card>

      <Card className="profile-preferences-card"><div className="profile-preferences-heading"><span className="profile-info-icon"><Settings size={18}/></span><div><h2>Workspace preferences</h2><p>Personalize how the People Portal feels on your devices.</p></div></div><div className="preference-row"><div><b>Appearance</b><small>Choose the visual mode for this browser.</small></div><div className="preference-segment" role="group" aria-label="Appearance"><button className={theme==='light'?'active':''} aria-pressed={theme==='light'} onClick={()=>setTheme('light')} type="button"><Sun size={14}/> Light</button><button className={theme==='dark'?'active':''} aria-pressed={theme==='dark'} onClick={()=>setTheme('dark')} type="button"><Moon size={14}/> Dark</button></div></div><div className="preference-row"><div><b>Motion</b><small>Interface animations respect your system accessibility settings.</small></div><span className="preference-note"><ShieldCheck size={14}/> Accessible by default</span></div></Card>

      <LearningAllowanceSection notify={notify}/>

      <ActiveDevicesCard notify={notify}/>

      <Card className="privacy-card">
        <div className="privacy-icon"><ShieldCheck size={18}/></div>
        <div><b>Trust is part of how we work.</b><p>Falchion Xeniaa does not use spyware, screen recording, webcam watching or keyboard tracking. Location is requested only when you choose an attendance action.</p></div>
      </Card>
    </div>
  </>;
}

function ActiveDevicesCard({notify}){
  const [sessions,setSessions]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revokingId,setRevokingId]=useState(null);
  const [revokingAll,setRevokingAll]=useState(false);

  const loadSessions=async()=>{
    setLoading(true);
    setError('');
    try{
      const data=await get('/auth/sessions');
      setSessions(Array.isArray(data.sessions)?data.sessions:[]);
    }catch(e){
      setError(e.message||'Could not load active sessions.');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{void loadSessions();},[]);

  const revokeSession=async(id)=>{
    setRevokingId(id);
    try{
      const res=await del('/auth/sessions/'+id);
      if(res.signedOut){
        window.location.reload();
        return;
      }
      notify('Device session was disconnected.');
      await loadSessions();
    }catch(e){
      notify(e.message||'Could not revoke device session.','error');
    }finally{
      setRevokingId(null);
    }
  };

  const revokeAllOther=async()=>{
    setRevokingAll(true);
    try{
      const res=await del('/auth/sessions');
      notify(`Disconnected ${res.revokedCount||'all'} other device session(s).`);
      await loadSessions();
    }catch(e){
      notify(e.message||'Could not disconnect other sessions.','error');
    }finally{
      setRevokingAll(false);
    }
  };

  const otherSessions=sessions.filter(s=>!s.isCurrent);

  return (
    <Card className="profile-preferences-card profile-sessions-card">
      <div className="profile-preferences-heading">
        <span className="profile-info-icon"><Laptop size={18}/></span>
        <div style={{flex:1}}>
          <h2>Active devices & sessions</h2>
          <p>Manage devices authorized to access your account with 30-day Remember Me.</p>
        </div>
        {otherSessions.length>0&&(
          <Button
            variant="soft"
            size="small"
            onClick={revokeAllOther}
            loading={revokingAll}
          >
            Sign out other devices
          </Button>
        )}
      </div>

      {loading?(
        <div className="table-message" style={{padding:'20px 0'}}><Spinner/> Loading authorized devices…</div>
      ):error?(
        <div className="inline-alert alert-error" style={{margin:'10px 0'}}><CircleAlert size={16}/>{error}</div>
      ):(
        <div className="device-sessions-list" style={{display:'flex',flexDirection:'column',gap:'10px',marginTop:'14px'}}>
          {sessions.map((session)=>(
            <div
              key={session.id}
              className="device-session-item"
              style={{
                display:'flex',
                alignItems:'center',
                justifyContent:'space-between',
                padding:'12px 14px',
                borderRadius:'8px',
                border:'1px solid var(--ui-border,#e5e7eb)',
                background:session.isCurrent?'var(--ui-surface-subtle,#f8faf9)':'var(--ui-surface,#ffffff)'
              }}
            >
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div
                  style={{
                    width:'36px',
                    height:'36px',
                    borderRadius:'8px',
                    display:'grid',
                    placeItems:'center',
                    background:session.isCurrent?'rgba(30,90,64,0.1)':'rgba(0,0,0,0.05)',
                    color:session.isCurrent?'var(--green-primary,#1e5a40)':'var(--ui-text-muted,#6b7280)'
                  }}
                >
                  <Laptop size={18}/>
                </div>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <b style={{fontSize:'13px',color:'var(--ui-text,#253831)'}}>{session.deviceName||'Web Device'}</b>
                    {session.isCurrent?(
                      <span className="status-pill status-pill-active" style={{fontSize:'11px',padding:'2px 8px'}}>This device</span>
                    ):(
                      <span style={{fontSize:'11px',color:'var(--ui-text-muted,#6b7280)'}}>
                        {session.isRememberMe?'Remembered · 30d':'Standard session'}
                      </span>
                    )}
                  </div>
                  <small style={{fontSize:'11px',color:'var(--ui-text-muted,#6b7280)',display:'block',marginTop:'2px'}}>
                    {session.ipAddress ? `IP: ${session.ipAddress} · ` : ''}
                    {session.isCurrent ? 'Active now' : `Last active ${formatDate(session.lastActiveAt)}`}
                  </small>
                </div>
              </div>
              {!session.isCurrent&&(
                <button
                  type="button"
                  className="button button-soft button-small"
                  style={{color:'var(--red,#dc2626)',borderColor:'rgba(220,38,38,0.2)'}}
                  onClick={()=>revokeSession(session.id)}
                  disabled={revokingId===session.id}
                >
                  {revokingId===session.id?'Revoking…':'Revoke'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamPage(){
  const {user,notify}=useApp();
  const navigate=useNavigate();
  const {id:routePersonId}=useParams<{id?:string}>();
  const isSuperAdmin=Boolean(user?.isSuperAdmin || user?.role==='SUPER_ADMIN' || user?.user_type==='SUPER_ADMIN');
  const [people,setPeople]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [busyId,setBusyId]=useState(null);const [search,setSearch]=useState('');const [addOpen,setAddOpen]=useState(false);const [deactivatingPerson,setDeactivatingPerson]=useState(null);const [roleChangeTarget,setRoleChangeTarget]=useState(null);const [filter,setFilter]=useState('ALL');const [view,setView]=useState(()=>{try{return localStorage.getItem('hrms-people-view')||'cards';}catch{return 'cards';}});const [selected,setSelected]=useState(null);const [photoVersion,setPhotoVersion]=useState(Date.now());const peopleRequest=useRef(0);const peopleLoaded=useRef(false);
  const load=async()=>{const requestId=++peopleRequest.current;if(!peopleLoaded.current)setLoading(true);setError('');try{const r=await get('/admin/users');if(requestId!==peopleRequest.current)return;setPeople(Array.isArray(r.users)?r.users:[]);setPhotoVersion(Date.now());peopleLoaded.current=true;}catch(e){if(requestId===peopleRequest.current)setError(e.message||'The people directory could not be loaded.');}finally{if(requestId===peopleRequest.current)setLoading(false);}};
  useEffect(()=>{void load();return()=>{peopleRequest.current+=1;};},[]);
  useEffect(()=>{
    if(routePersonId && people.length>0){
      const found=people.find((p:any)=>p.id===routePersonId || String(p.employee_code||'').toLowerCase()===routePersonId.toLowerCase());
      if(found) setSelected(found);
    } else if(!routePersonId && selected){
      setSelected(null);
    }
  },[routePersonId, people]);
  const selectPerson=(p:any)=>{
    setSelected(p);
    try{
      if(p) navigate('/admin/team/'+p.id);
      else navigate('/admin/team');
    }catch{}
  };
  const performUpdate=async(person,changes)=>{setBusyId(person.id);setError('');try{await patch('/admin/users/'+person.id,changes);notify(person.full_name+'’s profile was updated.');await load();if(selected?.id===person.id)setSelected({...person,...changes});}catch(e){setError(e.message);}finally{setBusyId(null);}};
  const update=async(person,changes)=>{if(changes.status==='INACTIVE'){setDeactivatingPerson(person);return;}await performUpdate(person,changes);};
  const confirmDeactivate=async()=>{if(!deactivatingPerson)return;setBusyId(deactivatingPerson.id);try{await patch('/admin/users/'+deactivatingPerson.id,{status:'INACTIVE'});notify(deactivatingPerson.full_name+'’s account was deactivated.');await load();if(selected?.id===deactivatingPerson.id)setSelected({...selected,status:'INACTIVE'});setDeactivatingPerson(null);}catch(e){setError(e.message);throw e;}finally{setBusyId(null);}};
  const confirmRoleChange=async(targetRole)=>{
    if(!roleChangeTarget)return;
    setBusyId(roleChangeTarget.person.id);
    try{
      await put('/admin/employees/'+roleChangeTarget.person.id+'/role',{role:targetRole});
      notify(roleChangeTarget.person.full_name+'’s role was updated to '+roleInfo(targetRole).label+'. Active sessions refreshed.');
      await load();
      if(selected?.id===roleChangeTarget.person.id){
        setSelected({...selected,role:targetRole,user_type:targetRole});
      }
      setRoleChangeTarget(null);
    }catch(e){
      setError(e.message||'Could not update role.');
      throw e;
    }finally{
      setBusyId(null);
    }
  };
  const uploadPhoto=async(person,file)=>{if(!file)return;if(file.size>4*1024*1024){setError('Profile photos must be 4 MB or smaller.');return;}setBusyId(person.id);setError('');try{const form=new FormData();form.append('photo',file);await post('/admin/users/'+person.id+'/photo',form);notify(person.full_name+'’s profile photo was updated.');await load();}catch(e){setError(e.message);}finally{setBusyId(null);}};
  const filtered=people.filter((p)=>((p.full_name||'')+' '+(p.employee_code||'')+' '+(p.email||'')+' '+(p.department||'')+' '+(p.position||'')).toLowerCase().includes(search.toLowerCase())&&(filter==='ALL'||(filter==='ACTIVE'?p.status==='ACTIVE':p.status==='INACTIVE')));
  const setViewMode=(mode)=>{setView(mode);try{localStorage.setItem('hrms-people-view',mode);}catch{/* Keep the selected view for this session if storage is unavailable. */}};
  const getRoleOptionsFor=(targetPerson)=>{
    if(isSuperAdmin){
      return [{value:'SUPER_ADMIN',label:'Super Admin'},{value:'ADMIN',label:'Administrator'},{value:'EMPLOYEE',label:'Employee'},{value:'INTERN',label:'Intern'}];
    }
    if(targetPerson.role==='SUPER_ADMIN'||targetPerson.user_type==='SUPER_ADMIN'||targetPerson.id===user?.id){
      return [];
    }
    return [{value:'ADMIN',label:'Administrator'},{value:'EMPLOYEE',label:'Employee'},{value:'INTERN',label:'Intern'}];
  };

  return <><PageTitle eyebrow="A PEOPLE-FIRST WORKPLACE" title="People" description="A living directory of your workplace, access and organization." action={<Button icon={Plus} onClick={()=>setAddOpen(true)}>Add a person</Button>}/>{error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>{loading?'Refreshing…':'Retry people'}</button></div>}
    <div className="people-hero-strip" aria-busy={loading}><div><span className="eyebrow">WORKFORCE DIRECTORY</span><b>{people.filter((p)=>p.status==='ACTIVE').length} active people</b><small>{people.filter((p)=>p.wfh_enabled).length} enabled for WFH · {people.filter((p)=>p.role==='SUPER_ADMIN'||p.user_type==='SUPER_ADMIN').length} super admins · {people.filter((p)=>(p.role==='ADMIN'||p.user_type==='ADMIN')&&p.role!=='SUPER_ADMIN'&&p.user_type!=='SUPER_ADMIN').length} administrators</small></div><div className="people-strip-stats"><span><b>{people.length}</b><small>Total</small></span><span><b>{people.filter((p)=>p.role==='SUPER_ADMIN'||p.user_type==='SUPER_ADMIN'||p.role==='ADMIN'||p.user_type==='ADMIN').length}</b><small>Admins</small></span><span><b>{people.filter((p)=>p.user_type==='INTERN'||p.role==='INTERN').length}</b><small>Interns</small></span><span><b>{new Set(people.map((p)=>p.department).filter(Boolean)).size||0}</b><small>Departments</small></span></div></div>
    <Card className="people-table-card"><div className="table-toolbar people-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search name, ID, department…" aria-label="Search people"/></div><div className="toolbar-right"><div className="view-toggle"><button className={view==='cards'?'active':''} onClick={()=>setViewMode('cards')} aria-label="Cards view">Cards</button><button className={view==='table'?'active':''} onClick={()=>setViewMode('table')} aria-label="Table view">Table</button></div><div className="select-wrap select-small"><select aria-label="Filter people by status" value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="ALL">All people</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select><ChevronDown size={14}/></div><button className="button button-soft button-small" onClick={load}><RefreshCw size={14}/> Refresh</button></div></div>
      {view==='cards'?<div className="people-card-grid">{loading?<div className="people-loading-grid"><Spinner/></div>:filtered.length?filtered.map((p)=>{const photo=p.profile_photo_key?assetUrl('/admin/users/'+p.id+'/photo')+'?v='+photoVersion:null;const info=roleInfo(p);const isLocked=getRoleOptionsFor(p).length===0;return <button className="person-card" key={p.id} onClick={()=>selectPerson(p)}><div className="person-card-top"><span className={'avatar person-card-avatar '+(info.avatarClass||(p.role==='ADMIN'?'avatar-admin':''))}>{photo?<img src={photo} alt=""/>:initials(p.full_name)}</span><span className="person-card-arrow"><ArrowUpRight size={15}/></span></div><div className="person-card-name">{p.full_name}</div><div className="person-card-role">{p.position||p.title||'Employee'} · <span className={'role-chip '+(info.className||'')+(isLocked?' role-locked-badge':'')}>{info.label}</span></div><div className="person-card-meta"><span>{p.department||'General'}</span><span>{p.branch||'Pune'}</span></div><div className="person-card-footer"><span className={'person-live-dot '+(p.status==='ACTIVE'?'on':'off')}/><span>{p.status==='ACTIVE'?'Active':'Inactive'}</span><span className="person-card-code">{p.employee_code}</span></div></button>}):<div className="table-message">No people match your search.</div>}</div>
      :<div className="table-scroll"><table aria-label="Company employee directory"><thead><tr><th scope="col">PERSON</th><th scope="col">ROLE</th><th scope="col">BRANCH</th><th scope="col">DEPARTMENT</th><th scope="col">POSITION</th><th scope="col">EMAIL</th><th scope="col">WFH</th><th scope="col">STATUS</th><th scope="col">ACTIONS</th></tr></thead><tbody>{loading?<tr><td colSpan="9" className="table-message"><Spinner/></td></tr>:filtered.length?filtered.map((p)=>{const photo=p.profile_photo_key?assetUrl('/admin/users/'+p.id+'/photo')+'?v='+photoVersion:null;const info=roleInfo(p);const options=getRoleOptionsFor(p);const isLocked=options.length===0;const currentVal=(p.role==='SUPER_ADMIN'||p.user_type==='SUPER_ADMIN')?'SUPER_ADMIN':p.role==='ADMIN'?'ADMIN':(p.user_type==='INTERN'||p.role==='INTERN')?'INTERN':'EMPLOYEE';return <tr key={p.id} onClick={()=>selectPerson(p)} className="table-row-click"><td><div className="person-cell"><label className="table-avatar-photo" onClick={(e)=>e.stopPropagation()}><span className={'avatar avatar-table '+(info.avatarClass||(p.role==='ADMIN'?'avatar-admin':''))}>{photo?<img src={photo} alt=""/>:initials(p.full_name)}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>{const f=e.target.files?.[0];e.target.value='';uploadPhoto(p,f);}} disabled={busyId===p.id}/></label><span><b>{p.full_name}</b><small>{p.employee_code}</small></span></div></td><td onClick={(e)=>e.stopPropagation()}>{isLocked?<span className={'role-chip '+(info.className||'')+' role-locked-badge'} title={p.role==='SUPER_ADMIN'||p.user_type==='SUPER_ADMIN'?'Super Administrator accounts can only be modified by Super Administrators.':'You cannot change your own administrative account role.'}><ShieldCheck size={12}/> {info.label}</span>:<div className="role-select-inline"><select value={currentVal} onChange={(e)=>{const nextVal=e.target.value;if(nextVal!==currentVal){setRoleChangeTarget({person:p,targetRole:nextVal});}}} disabled={busyId===p.id} aria-label={'Change role for '+p.full_name}>{options.map((opt)=><option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><ChevronDown size={12}/></div>}</td><td>{p.branch||'Pune'}</td><td>{p.department||'General'}</td><td>{p.position||p.title}</td><td className="email-cell">{p.email}</td><td><button className={'toggle'+(p.wfh_enabled?' toggle-on':'')} role="switch" aria-checked={p.wfh_enabled} aria-label={'Toggle WFH for '+p.full_name} onClick={(e)=>{e.stopPropagation();update(p,{wfhEnabled:!p.wfh_enabled})}} disabled={busyId===p.id}><i/></button></td><td><StatusPill value={p.status}/></td><td><button className="text-button" onClick={(e)=>{e.stopPropagation();update(p,{status:p.status==='ACTIVE'?'INACTIVE':'ACTIVE'})}} disabled={busyId===p.id}>{busyId===p.id?'Updating…':p.status==='ACTIVE'?'Deactivate':'Reactivate'}</button></td></tr>}):<tr><td colSpan="9"><div className="table-message">No people match your search.</div></td></tr>}</tbody></table></div>}
      <div className="table-bottom"><span>Showing {filtered.length} of {people.length} people</span><span>Click a profile to open details.</span></div></Card>
    <div className="team-notice"><ShieldCheck size={16}/><span>Google access is granted only after an administrator provisions the employee’s email.</span></div>
    {selected&&<PersonDrawer person={selected} close={()=>selectPerson(null)} onUpdate={update} onRoleChange={(person,role)=>setRoleChangeTarget({person,targetRole:role})} isSuperAdmin={isSuperAdmin} currentUser={user} busyId={busyId}/>}
    {addOpen&&<AddPersonModal close={()=>setAddOpen(false)} onDone={()=>{setAddOpen(false);notify('The new account is ready for Google sign-in.');load();}} isSuperAdmin={isSuperAdmin}/>}
    {deactivatingPerson&&<DeactivateConfirmModal person={deactivatingPerson} close={()=>setDeactivatingPerson(null)} onConfirm={confirmDeactivate} busy={busyId===deactivatingPerson.id}/>}
    {roleChangeTarget&&<RoleChangeConfirmModal person={roleChangeTarget.person} targetRole={roleChangeTarget.targetRole} close={()=>setRoleChangeTarget(null)} onConfirm={confirmRoleChange} busy={busyId===roleChangeTarget.person.id}/>}
  </>;
}

function RoleChangeConfirmModal({person,targetRole,close,onConfirm,busy}){
  const [error,setError]=useState('');
  const current=roleInfo(person);
  const next=roleInfo(targetRole);

  const getImpactDescription=(newRole)=>{
    switch(newRole){
      case 'SUPER_ADMIN':
        return 'Grants full root authority: company settings, geofence configuration, audit trails, and authority to promote or demote any administrative account.';
      case 'ADMIN':
        return 'Grants standard administrative permissions: workforce management, attendance reviews, leave and WFH approvals, HR operations, and reporting.';
      case 'EMPLOYEE':
        return 'Grants standard workforce workspace access: attendance check-in, leave requests, WFH requests, profile, and policy center access.';
      case 'INTERN':
        return 'Grants intern workspace access: attendance check-in, policy center, and intern leave policy (max 1 day/month accrual; 0 Earned Leave).';
      default:
        return 'Updates organizational permissions.';
    }
  };

  const handleConfirm=async()=>{
    setError('');
    try{
      await onConfirm(targetRole);
    }catch(err){
      setError(err?.message||'Could not update employee role.');
    }
  };

  return <Modal title="Confirm Role Change" subtitle={'Updating organizational tier for '+(person?.full_name||'employee')} close={close}>
    <div className="form-stack">
      <div className="inline-alert alert-warning" role="alert" style={{display:'flex',gap:'10px',alignItems:'flex-start'}}>
        <ShieldAlert size={20} style={{flexShrink:0,marginTop:'2px',color:'#b45309'}}/>
        <div>
          <strong>Privilege & Session Impact:</strong>
          <p style={{margin:'4px 0 0 0',fontSize:'12px',lineHeight:1.5}}>
            Changing <b>{person?.full_name}</b> from <span className={'role-chip '+(current.className||'')}>{current.label}</span> to <span className={'role-chip '+(next.className||'')}>{next.label}</span> will immediately invalidate all active login sessions for this account. The user will be required to sign in again to receive updated permissions.
          </p>
        </div>
      </div>

      <div style={{padding:'12px 14px',borderRadius:'8px',background:'var(--color-bg-subtle,#f8fafc)',border:'1px solid var(--color-border,#e2e8f0)',fontSize:'12px'}}>
        <b style={{display:'block',marginBottom:'4px',color:'var(--color-text,#1e293b)'}}>Target Tier Privileges:</b>
        <p style={{margin:0,color:'var(--color-text-muted,#64748b)',lineHeight:1.5}}>
          {getImpactDescription(targetRole)}
        </p>
      </div>

      {error&&<InlineError>{error}</InlineError>}

      <div className="form-modal-actions">
        <Button variant="soft" type="button" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={handleConfirm} loading={busy} icon={ShieldCheck}>
          Confirm & update role
        </Button>
      </div>
    </div>
  </Modal>;
}

function DeactivateConfirmModal({person,close,onConfirm,busy}){
  const [typedName,setTypedName]=useState('');
  const [error,setError]=useState('');
  const isMatch=typedName.trim()===(person?.full_name||'').trim();

  const handleSubmit=async(e)=>{
    e.preventDefault();
    if(!isMatch){
      setError('Typed name does not match the employee name.');
      return;
    }
    setError('');
    try{
      await onConfirm();
    }catch(err){
      setError(err?.message||'Could not deactivate employee.');
    }
  };

  return <Modal title="Deactivate employee account" subtitle={'Revoking access for '+(person?.full_name||'employee')} close={close}><form className="form-stack" onSubmit={handleSubmit}><div className="inline-alert alert-warning" role="alert" style={{display:'flex',gap:'8px',alignItems:'flex-start'}}><CircleAlert size={18} style={{flexShrink:0,marginTop:'2px'}}/><div><strong>Important safeguard:</strong><p style={{margin:'4px 0 0 0',fontSize:'12px'}}>Deactivating this account will immediately revoke all active sessions for <b>{person?.full_name}</b> ({person?.email}). They will no longer be able to log in or submit attendance and leave requests.</p></div></div>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>To confirm, please type <strong>{person?.full_name}</strong> below:</span><input aria-label="Confirm employee full name" value={typedName} onChange={(e)=>{setTypedName(e.target.value);setError('');}} placeholder={person?.full_name} autoFocus required/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" className="button-danger" disabled={!isMatch||busy} loading={busy}>Deactivate account</Button></div></form></Modal>;
}

function PersonDrawer({person,close,onUpdate,onRoleChange,isSuperAdmin,currentUser,busyId}){
  const photo=person.profile_photo_key?assetUrl('/admin/users/'+person.id+'/photo')+'?v='+Date.now():null;
  const info=roleInfo(person);
  const isTargetSuper=person.role==='SUPER_ADMIN'||person.user_type==='SUPER_ADMIN';
  const isSelf=person.id===currentUser?.id;
  const canModifyRole=isSuperAdmin?true:(!isTargetSuper&&!isSelf);
  const options=isSuperAdmin
    ?[{value:'SUPER_ADMIN',label:'Super Admin'},{value:'ADMIN',label:'Administrator'},{value:'EMPLOYEE',label:'Employee'},{value:'INTERN',label:'Intern'}]
    :[{value:'ADMIN',label:'Administrator'},{value:'EMPLOYEE',label:'Employee'},{value:'INTERN',label:'Intern'}];
  const currentVal=isTargetSuper?'SUPER_ADMIN':person.role==='ADMIN'?'ADMIN':(person.user_type==='INTERN'||person.role==='INTERN')?'INTERN':'EMPLOYEE';

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}};
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[close]);

  return <div className="drawer-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&close()}><aside className="person-drawer" role="dialog" aria-modal="true" aria-label={person.full_name+' details'}>
    <div className="drawer-cover"><button className="icon-button drawer-close" onClick={close} aria-label="Close"><X size={18}/></button><div className="drawer-avatar">{photo?<img src={photo} alt=""/>:initials(person.full_name)}</div></div>
    <div className="drawer-body"><div className="drawer-heading"><div><span className="eyebrow">EMPLOYEE PROFILE</span><h2>{person.full_name}</h2><p>{person.position||person.title||'Employee'} · <span className={'role-chip '+(info.className||'')}>{info.fullLabel}</span></p></div><StatusPill value={person.status}/></div>
    <div className="drawer-tags"><span>{person.employee_code}</span><span>{person.department||'General'}</span><span>{person.branch||'Pune'}</span></div>
    <div className="drawer-section"><span className="eyebrow">WORKPLACE</span><div className="drawer-facts"><div><small>Email</small><b>{person.email}</b></div><div><small>Position</small><b>{person.position||person.title}</b></div><div><small>WFH access</small><b>{person.wfh_enabled?'Enabled':'Not enabled'}</b></div><div><small>Joined</small><b>{person.joined_on?formatDate(person.joined_on):'—'}</b></div><div><small>Probation</small><b>{person.probation_end_date?formatDate(person.probation_end_date):'—'}</b></div><div><small>Late entries · 30d</small><b>{person.late_count??0}</b></div></div></div>
    <div className="drawer-section"><span className="eyebrow">ROLE & PERMISSIONS</span>
      <div className="drawer-facts"><div><small>System Tier</small><span className={'role-chip '+(info.className||'')}>{info.fullLabel}</span></div><div><small>Authority</small><b>{isTargetSuper?'Full Root Authority':person.role==='ADMIN'?'Workforce Administration':info.role==='INTERN'?'Intern Quota Enforced':'Standard Employee'}</b></div></div>
      {canModifyRole?(
        <div style={{marginTop:'12px'}}>
          <label className="form-field"><span>Change organizational role</span>
            <div className="select-wrap">
              <select value={currentVal} onChange={(e)=>{if(e.target.value!==currentVal&&onRoleChange)onRoleChange(person,e.target.value);}} disabled={busyId===person.id} aria-label="Change employee role">
                {options.map((opt)=><option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <ChevronDown size={14}/>
            </div>
          </label>
        </div>
      ):(
        <div style={{marginTop:'10px',fontSize:'12px',color:'var(--color-text-muted,#71717a)',display:'flex',gap:'6px',alignItems:'center'}}>
          <ShieldCheck size={14} style={{color:'var(--fx-gold,#DAAF51)'}}/>
          <span>{isSelf?'Self-privilege alteration is restricted.':'Super Administrator accounts are protected.'}</span>
        </div>
      )}
    </div>
    <div className="drawer-section"><span className="eyebrow">ACCOUNT</span><div className="drawer-actions"><button className="button button-soft" onClick={()=>onUpdate(person,{wfhEnabled:!person.wfh_enabled})}>{person.wfh_enabled?'Disable':'Enable'} WFH</button><button className={'button '+(person.status==='ACTIVE'?'button-danger':'button-primary')} onClick={()=>onUpdate(person,{status:person.status==='ACTIVE'?'INACTIVE':'ACTIVE'})}>{person.status==='ACTIVE'?'Deactivate':'Reactivate'}</button></div></div>
    </div>
  </aside></div>;
}

function AddPersonModal({close,onDone,isSuperAdmin}){
  const defaultJoined=today;
  const defaultProbation=(()=>{const d=new Date(`${defaultJoined}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+4);return d.toISOString().slice(0,10);})();
  const [values,setValues]=useState({employeeCode:'',fullName:'',email:'',userType:'EMPLOYEE',title:'Employee',position:'Employee',branch:'Pune',department:'General',phone:'',joinedOn:defaultJoined,wfhEnabled:false,probationEndDate:defaultProbation});
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const set=(key,value)=>setValues((v)=>({...v,[key]:value}));
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/admin/users',{...values,probationEndDate:values.probationEndDate||null});onDone();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal title="Add someone to the team" subtitle="Provision their organization record and Google Sign-In access." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}
    <div className="form-two"><label className="form-field"><span>Employee ID</span><input aria-label="Employee ID" value={values.employeeCode} maxLength="24" onChange={(e)=>set('employeeCode',e.target.value)} placeholder="FX-0012" required/></label><label className="form-field"><span>Employee tier</span><div className="select-wrap"><select value={values.userType} onChange={(e)=>set('userType',e.target.value)}><option value="EMPLOYEE">Employee</option><option value="INTERN">Intern</option><option value="ADMIN">Administrator</option>{isSuperAdmin&&<option value="SUPER_ADMIN">Super Administrator</option>}</select><ChevronDown size={14}/></div></label></div>
    <label className="form-field"><span>Full name</span><input aria-label="Full name" value={values.fullName} maxLength="120" onChange={(e)=>set('fullName',e.target.value)} required/></label>
    <label className="form-field"><span>Google account email</span><input aria-label="Google account email" type="email" value={values.email} maxLength="254" onChange={(e)=>set('email',e.target.value)} placeholder="name@falchionxeniaa.com" required/></label>
    <div className="form-three"><label className="form-field"><span>Branch</span><input aria-label="Branch" value={values.branch} onChange={(e)=>set('branch',e.target.value)} placeholder="Pune" required/></label><label className="form-field"><span>Department</span><input aria-label="Department" value={values.department} onChange={(e)=>set('department',e.target.value)} placeholder="General" required/></label><label className="form-field"><span>Position</span><input aria-label="Position" value={values.position} onChange={(e)=>{set('position',e.target.value);set('title',e.target.value)}} placeholder="Employee" required/></label></div>
    <div className="form-two"><label className="form-field"><span>Mobile number</span><input aria-label="Mobile number" type="tel" value={values.phone} maxLength="32" onChange={(e)=>set('phone',e.target.value)} placeholder="+91 …"/></label><label className="form-field"><span>Joined on</span><input aria-label="Joined on" type="date" value={values.joinedOn} onChange={(e)=>{const next=e.target.value;set('joinedOn',next);const d=new Date(`${next}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+4);set('probationEndDate',d.toISOString().slice(0,10));}} required/></label></div>
    <label className="form-field"><span>Provision / probation ends <small>(4 months)</small></span><input type="date" value={values.probationEndDate} onChange={(e)=>set('probationEndDate',e.target.value)} required/></label>
    <label className="checkbox-line"><input type="checkbox" checked={values.wfhEnabled} onChange={(e)=>set('wfhEnabled',e.target.checked)}/><span>Enable WFH request access</span></label>
    <div className="form-modal-actions"><Button type="button" variant="soft" onClick={close}>Cancel</Button><Button type="submit" loading={busy} icon={Plus}>Create account</Button></div>
  </form></Modal>;
}

function AdminAttendancePage(){
  const [searchParams, setSearchParams] = useSearchParams();
  const [from,setFromState]=useState(()=>searchParams.get('from')||today);
  const [to,setToState]=useState(()=>searchParams.get('to')||today);
  const [rows,setRows]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [search,setSearchState]=useState(()=>searchParams.get('search')||'');
  const [statusFilter,setStatusFilterState]=useState(()=>searchParams.get('status')||'ALL');
  const [selected,setSelected]=useState(null);const attendanceAdminRequest=useRef(0);const attendanceAdminLoaded=useRef(false);
  const recordParam = searchParams.get('record');
  const setFrom=(v)=>{setFromState(v);setSearchParams(prev=>{const n=new URLSearchParams(prev);n.set('from',v);return n;},{replace:true});};
  const setTo=(v)=>{setToState(v);setSearchParams(prev=>{const n=new URLSearchParams(prev);n.set('to',v);return n;},{replace:true});};
  const setSearch=(v)=>{setSearchState(v);setSearchParams(prev=>{const n=new URLSearchParams(prev);if(!v)n.delete('search');else n.set('search',v);return n;},{replace:true});};
  const setStatusFilter=(v)=>{setStatusFilterState(v);setSearchParams(prev=>{const n=new URLSearchParams(prev);if(v==='ALL')n.delete('status');else n.set('status',v);return n;},{replace:true});};

  const selectRecord=(r)=>{
    setSelected(r);
    setSearchParams(prev=>{
      const n=new URLSearchParams(prev);
      if(r) n.set('record',r.id);
      else n.delete('record');
      return n;
    },{replace:false});
  };

  useEffect(()=>{
    if(recordParam && rows.length>0){
      const found=rows.find((r:any)=>r.id===recordParam);
      if(found) setSelected(found);
    } else if(!recordParam && selected){
      setSelected(null);
    }
  },[recordParam, rows]);

  const load=async()=>{const requestId=++attendanceAdminRequest.current;if(from>to){setError('The start date must be on or before the end date.');setLoading(false);return;}if(!attendanceAdminLoaded.current)setLoading(true);setError('');try{const data=await get('/admin/attendance?from='+from+'&to='+to);if(requestId!==attendanceAdminRequest.current)return;setRows(Array.isArray(data.records)?data.records:[]);attendanceAdminLoaded.current=true;}catch(e){if(requestId===attendanceAdminRequest.current)setError(e.message||'Attendance records could not be refreshed.');}finally{if(requestId===attendanceAdminRequest.current)setLoading(false);}};
  useEffect(()=>{void load();return()=>{attendanceAdminRequest.current+=1;};},[]);
  const filteredRows=rows.filter((r)=>((r.full_name||'')+' '+(r.employee_code||'')).toLowerCase().includes(search.toLowerCase())&&(statusFilter==='ALL'||(statusFilter==='PRESENT'&&['ON_TIME','LATE_ENTRY'].includes(r.status))||(statusFilter==='LATE'&&r.status==='LATE_ENTRY')||(statusFilter==='ABSENT'&&r.status==='ABSENT')||(statusFilter==='WFH'&&r.status==='WFH')));
  const present=rows.filter((r)=>['ON_TIME','LATE_ENTRY'].includes(r.status)).length;const late=rows.filter((r)=>r.status==='LATE_ENTRY').length;const absent=rows.filter((r)=>r.status==='ABSENT').length;const remote=rows.filter((r)=>r.status==='WFH').length;
  return <><PageTitle eyebrow="ATTENDANCE, WITH CONTEXT" title="Attendance" description="Review the working day without losing the human context behind the record." action={<Button variant="soft" icon={RefreshCw} onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh records'}</Button>}/>{error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}>Retry records</button></div>}
    <div className="admin-attendance-summary"><div><span className="admin-attendance-summary-icon green"><Fingerprint size={17}/></span><b>{loading?'—':present}</b><small>Present</small></div><div><span className="admin-attendance-summary-icon rose"><Clock3 size={17}/></span><b>{loading?'—':late}</b><small>Late</small></div><div><span className="admin-attendance-summary-icon gold"><CalendarDays size={17}/></span><b>{loading?'—':absent}</b><small>Absent</small></div><div><span className="admin-attendance-summary-icon blue"><House size={17}/></span><b>{loading?'—':remote}</b><small>Remote</small></div></div>
    <Card className="admin-attendance-card"><div className="filter-toolbar admin-attendance-toolbar"><div className="filter-date"><CalendarDays size={16}/><label><span>FROM</span><input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/></label><ArrowRight size={14}/><label><span>TO</span><input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/></label></div><div className="admin-attendance-filters"><div className="search-box"><Search size={15}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search people" aria-label="Search people"/></div><div className="select-wrap select-small"><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="ALL">All status</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="WFH">Remote</option></select><ChevronDown size={14}/></div><Button size="small" onClick={load} icon={Filter}>Apply</Button></div></div>
      <div className="table-scroll"><table aria-label="Workforce attendance management records"><thead><tr><th scope="col">PERSON</th><th scope="col">DATE</th><th scope="col">CHECK IN</th><th scope="col">CHECK OUT</th><th scope="col">VERIFY</th><th scope="col">LOCATION CHECK</th><th scope="col">STATUS</th><th scope="col">EXITS</th></tr></thead><tbody>{loading?<tr><td colSpan="8" className="table-message"><Spinner/></td></tr>:filteredRows.length?filteredRows.map((r)=><tr key={r.id} className="table-row-click" onClick={()=>selectRecord(r)}><td><div className="person-cell"><span className="avatar avatar-table">{initials(r.full_name)}</span><span><b>{r.full_name}</b><small>{r.employee_code} · {r.user_type==='INTERN'?'Intern':'Employee'}</small></span></div></td><td>{formatDate(r.attendance_date,{day:'numeric',month:'short'})}</td><td>{formatTime(r.check_in_at)}</td><td>{formatTime(r.check_out_at)}</td><td><span className="verify-tag"><i/>{r.check_in_method||'—'}</span></td><td>{r.check_in_distance_m==null?'—':<span className="location-audit"><MapPin size={13}/>{Math.round(r.check_in_distance_m)} m<small>±{Math.round(r.check_in_accuracy_m||0)} m</small></span>}</td><td><StatusPill value={r.status}/>{r.correction_pending&&<span className="correction-mark">Correction</span>}</td><td>{r.exit_count||0}</td></tr>):<tr><td colSpan="8"><div className="table-message">No attendance records match these filters.</div></td></tr>}</tbody></table></div><div className="admin-attendance-foot"><span><ShieldCheck size={14}/> GPS coordinates are stored only when the employee checks in or out.</span><span>{filteredRows.length} visible records</span></div></Card>
    <div className="mobile-admin-attendance-list">
      {loading?<Card className="mobile-request-empty"><Spinner/></Card>:filteredRows.length?filteredRows.map((r)=><button type="button" key={'mobile-'+r.id} className="mobile-admin-attendance-card" onClick={()=>selectRecord(r)}>
        <div className="mobile-admin-attendance-top"><div className="person-cell"><span className="avatar avatar-table">{initials(r.full_name)}</span><span><b>{r.full_name}</b><small>{r.employee_code} · {r.user_type==='INTERN'?'Intern':'Employee'}</small></span></div><StatusPill value={r.status}/></div>
        <div className="mobile-admin-attendance-grid">
          <span><small>DATE</small><b>{formatDate(r.attendance_date,{day:'numeric',month:'short'})}</b></span>
          <span><small>IN</small><b>{formatTime(r.check_in_at)}</b></span>
          <span><small>OUT</small><b>{formatTime(r.check_out_at)}</b></span>
          <span><small>VERIFY</small><b>{r.check_in_method||'—'}</b></span>
        </div>
        <div className="mobile-admin-attendance-foot">{r.check_in_distance_m!=null?<span><MapPin size={13}/>{Math.round(r.check_in_distance_m)} m from HQ</span>:<span><ShieldCheck size={13}/>No location record</span>}{r.exit_count>0&&<span>{r.exit_count} exit{r.exit_count===1?'':'s'}</span>}<ArrowRight size={14}/></div>
      </button>):<EmptyState icon={Fingerprint} title="No attendance records match." body="Try a different date, person or status filter."/>}
    </div>
    <div className="attendance-audit-note"><div className="audit-note-icon"><Fingerprint size={18}/></div><div><b>What the location record means</b><p>For a GPS check-in, the system stores a one-time latitude/longitude, reported accuracy and distance from the office so the attendance decision can be reviewed. WFH check-ins do not create office location records.</p></div></div>
    {selected&&<AdminAttendanceDrawer row={selected} close={()=>selectRecord(null)}/>}
  </>;
}
function AdminAttendanceDrawer({row,close}){
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}};
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[close]);

  return <div className="drawer-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&close()}><aside className="person-drawer admin-attendance-drawer" role="dialog" aria-modal="true" aria-label="Attendance record details"><div className="drawer-cover"><button className="icon-button drawer-close" onClick={close} aria-label="Close"><X size={18}/></button><div className="drawer-attendance-mark"><Fingerprint size={24}/></div></div><div className="drawer-body"><div className="drawer-heading"><div><span className="eyebrow">ATTENDANCE RECORD</span><h2>{row.full_name}</h2><p>{row.employee_code} · {formatDate(row.attendance_date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div><StatusPill value={row.status}/></div><div className="drawer-section"><span className="eyebrow">DAY DETAIL</span><div className="drawer-facts"><div><small>Check-in</small><b>{formatTime(row.check_in_at)}</b></div><div><small>Check-out</small><b>{formatTime(row.check_out_at)}</b></div><div><small>Verification</small><b>{row.check_in_method||'—'}</b></div><div><small>Location</small><b>{row.check_in_distance_m==null?'Not recorded':Math.round(row.check_in_distance_m)+' m from HQ'}</b></div><div><small>GPS accuracy</small><b>{row.check_in_accuracy_m==null?'—':Math.round(row.check_in_accuracy_m)+' m'}</b></div><div><small>Exit records</small><b>{row.exit_count||0}</b></div></div></div><div className="drawer-section"><span className="eyebrow">REVIEW STATE</span><div className="attendance-review-state"><span className={row.correction_pending?'review-attention':'review-ok'}><i/>{row.correction_pending?'Correction pending':'No correction pending'}</span><small>Technical verification details remain available to administrators for audit review.</small></div></div></div></aside></div>;
}

function ReportsPage(){
  const [searchParams, setSearchParams] = useSearchParams();
  const monthStart=`${today.slice(0,7)}-01`;
  const [from,setFromState]=useState(()=>searchParams.get('from')||monthStart);
  const [to,setToState]=useState(()=>searchParams.get('to')||today);
  const [rows,setRows]=useState([]);const [leaveReport,setLeaveReport]=useState({summary:{requested:0,approved:0,pending:0,rejected:0,approvedDays:0},requests:[]});const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [attendanceReportLoaded,setAttendanceReportLoaded]=useState(false);const [leaveReportLoaded,setLeaveReportLoaded]=useState(false);const reportsRequest=useRef(0);const [exporting,setExporting]=useState(false);const [exportOpen,setExportOpen]=useState(false);
  const setFrom=(v)=>{setFromState(v);setSearchParams(prev=>{const n=new URLSearchParams(prev);n.set('from',v);return n;},{replace:true});};
  const setTo=(v)=>{setToState(v);setSearchParams(prev=>{const n=new URLSearchParams(prev);n.set('to',v);return n;},{replace:true});};
  const load=async()=>{const requestId=++reportsRequest.current;if(from>to){setError('The start date must be on or before the end date.');setLoading(false);return;}setLoading(true);setError('');const results=await Promise.allSettled([get(`/admin/attendance?from=${from}&to=${to}`),get(`/admin/leave-report?from=${from}&to=${to}`)]);if(requestId!==reportsRequest.current)return;const [attendance,leave]=results;const unavailable=[];if(attendance.status==='fulfilled'){setRows(Array.isArray(attendance.value.records)?attendance.value.records:[]);setAttendanceReportLoaded(true);}else unavailable.push('attendance report');if(leave.status==='fulfilled'){setLeaveReport(leave.value);setLeaveReportLoaded(true);}else unavailable.push('leave report');setError(unavailable.length?`Could not refresh the ${unavailable.join(' and ')}. Previously loaded data is retained; retry after checking the date range.`:'');setLoading(false);};
  useEffect(()=>{void load();return()=>{reportsRequest.current+=1;};},[]);
  const download=async()=>{if(exporting||loading)return false;setExporting(true);setError('');try{if(from>to)throw new Error('The start date must be on or before the end date.');const blob=await get(`/admin/reports.csv?from=${from}&to=${to}`);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`falchion-attendance-${from}-${to}.csv`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);return true;}catch(e){setError(e.message||'The report export could not be prepared.');return false;}finally{setExporting(false);}};
  const attended=rows.filter((r)=>r.status==='ON_TIME'||r.status==='LATE_ENTRY');const onTime=rows.filter((r)=>r.status==='ON_TIME').length;const late=rows.filter((r)=>r.status==='LATE_ENTRY').length;const absent=rows.filter((r)=>r.status==='ABSENT').length;const onLeave=rows.filter((r)=>r.status==='ON_LEAVE').length;const wfh=rows.filter((r)=>r.status==='WFH').length;const open=attended.filter((r)=>!r.check_out_at).length;const leaveSummary=leaveReport.summary||{}; const reportAttendanceRate=rows.length?Math.round((attended.length/rows.length)*100):0;const reportOnTimeRate=attended.length?Math.round((onTime/attended.length)*100):0; const trendDates=[...new Set(rows.map((r)=>String(r.attendance_date||'')).filter(Boolean))].sort().slice(-14);const attendanceTrend=trendDates.map((date)=>{const dayRows=rows.filter((r)=>r.attendance_date===date);const presentDay=dayRows.filter((r)=>['ON_TIME','LATE_ENTRY'].includes(r.status)).length;return {date,rate:dayRows.length?Math.round((presentDay/dayRows.length)*100):0,present:presentDay,total:dayRows.length};});
  return <><PageTitle eyebrow="CLEAR RECORDS, USEFUL CONTEXT" title="Reports" description="Attendance and leave reporting for administrators." action={<Button icon={Download} onClick={()=>setExportOpen(true)} disabled={loading||!attendanceReportLoaded||!leaveReportLoaded}>Export report</Button>}/>{error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}>Retry report</button></div>}
    <Card className="report-filter-card"><div className="report-filter-copy"><span className="report-filter-icon"><Activity size={18}/></span><div><b>Reporting period</b><small>Attendance and leave · private to administrators</small></div></div><div className="report-filter-controls"><label><span>FROM</span><input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/></label><ArrowRight size={15}/><label><span>TO</span><input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/></label><Button size="small" variant="soft" icon={Filter} onClick={load}>Apply</Button></div></Card>
    <div className="report-executive-strip"><div><span className="eyebrow">ATTENDANCE RATE</span><b>{loading||!attendanceReportLoaded?'—':reportAttendanceRate+'%'}</b><small>of records present</small></div><div><span className="eyebrow">ON-TIME RATE</span><b>{loading||!attendanceReportLoaded?'—':reportOnTimeRate+'%'}</b><small>of attended days</small></div><div><span className="eyebrow">OPEN SHIFTS</span><b>{loading||!attendanceReportLoaded?'—':open}</b><small>still in progress</small></div><div><span className="eyebrow">LEAVE DAYS</span><b>{loading||!leaveReportLoaded?'—':leaveSummary.approvedDays||0}</b><small>approved in range</small></div></div>
    <Card className="report-trend-card"><div className="report-trend-heading"><div><span className="eyebrow">14-DAY SIGNAL</span><h2>Attendance trend</h2><p>How much of the selected range was recorded as present each day.</p></div><div className="report-trend-score"><b>{loading||!attendanceReportLoaded?'—':reportAttendanceRate+'%'}</b><small>range average</small></div></div>{loading?<div className="report-trend-loading"><Spinner/></div>:attendanceTrend.length?<div className="report-trend-bars">{attendanceTrend.map((day)=><div className="report-trend-col" key={day.date}><div className="report-trend-value">{day.rate}%</div><div className="report-trend-bar"><i style={{height:Math.max(8,day.rate)+"%"}}/></div><small>{formatDate(day.date,{day:'2-digit',month:'short'})}</small></div>)}</div>:<div className="report-trend-empty">Choose a wider reporting range to see a daily trend.</div>}</Card>
    <div className="report-metrics"><Card><span className="report-metric-icon metric-blue"><FileText size={17}/></span><small>PRESENT DAYS</small><b>{loading||!attendanceReportLoaded?'—':attended.length}</b></Card><Card><span className="report-metric-icon metric-green"><Check size={17}/></span><small>ON TIME</small><b>{loading||!attendanceReportLoaded?'—':onTime}</b></Card><Card><span className="report-metric-icon metric-rose"><Clock3 size={17}/></span><small>LATE ENTRIES</small><b>{loading||!attendanceReportLoaded?'—':late}</b></Card><Card><span className="report-metric-icon metric-gold"><Timer size={17}/></span><small>OPEN SHIFTS</small><b>{loading||!attendanceReportLoaded?'—':open}</b></Card></div>
    <div className="report-status-summary"><span>ABSENT <b>{loading||!attendanceReportLoaded?'—':absent}</b></span><span>ON LEAVE <b>{loading||!attendanceReportLoaded?'—':onLeave}</b></span><span>WFH <b>{loading||!attendanceReportLoaded?'—':wfh}</b></span><span>TOTAL WORKDAYS <b>{loading||!attendanceReportLoaded?'—':rows.length}</b></span></div>
    <div className="section-head"><div><h2>Attendance report</h2><p>{from} — {to} · Fixed 30-minute lunch deducted from completed shifts.</p></div><Link className="text-link" to="/admin/attendance">Open attendance management <ArrowRight size={15}/></Link></div>
    <Card className="table-card"><div className="table-scroll"><table aria-label="Attendance report data"><thead><tr><th scope="col">PERSON</th><th scope="col">DATE</th><th scope="col">CHECK IN</th><th scope="col">CHECK OUT</th><th scope="col">WORKED</th><th scope="col">STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="6" className="table-message"><Spinner/></td></tr>:rows.length?rows.slice(0,20).map((r)=><tr key={r.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(r.full_name)}</span><span><b>{r.full_name}</b><small>{r.employee_code}</small></span></div></td><td>{formatDate(r.attendance_date,{day:'numeric',month:'short',year:'2-digit'})}</td><td>{formatTime(r.check_in_at)}</td><td>{formatTime(r.check_out_at)}</td><td>{r.check_out_at?formatMinutes(Math.max(0,Math.round((new Date(r.check_out_at)-new Date(r.check_in_at))/60000)-30)):'In progress'}</td><td><StatusPill value={r.status}/></td></tr>):<tr><td colSpan="6"><div className="table-message">No records in this report range.</div></td></tr>}</tbody></table></div>{rows.length>20&&<div className="table-bottom">Showing the latest 20 of {rows.length} records. The CSV includes every record in the selected range.</div>}</Card>
    <div className="mobile-report-list">
      {loading?<Card className="mobile-request-empty"><Spinner/></Card>:rows.length?rows.slice(0,20).map((row)=><Card className="mobile-report-card" key={'mobile-att-report-'+row.id}>
        <div className="mobile-report-card-top"><div className="person-cell"><span className="avatar avatar-table">{initials(row.full_name)}</span><span><b>{row.full_name}</b><small>{row.employee_code}</small></span></div><StatusPill value={row.status}/></div>
        <div className="mobile-report-grid"><span><small>DATE</small><b>{formatDate(row.attendance_date,{day:'numeric',month:'short',year:'2-digit'})}</b></span><span><small>CHECK IN</small><b>{formatTime(row.check_in_at)}</b></span><span><small>CHECK OUT</small><b>{formatTime(row.check_out_at)}</b></span><span><small>WORKED</small><b>{row.check_out_at?formatMinutes(Math.max(0,Math.round((new Date(row.check_out_at)-new Date(row.check_in_at))/60000)-30)):'In progress'}</b></span></div>
      </Card>):<EmptyState icon={FileText} title="No records in this range." body="Adjust the reporting period and apply again."/>}
    </div>
    <div className="section-head"><div><h2>Leave & time off</h2><p>Approved, pending and rejected leave requests in the selected period.</p></div><span className="history-count">{loading||!leaveReportLoaded?'—':leaveSummary.requested||0} requests</span></div>
    <Card className="report-leave-card"><div className="report-leave-summary"><div className="summary-box"><small>REQUESTED</small><b>{loading?'—':leaveSummary.requested||0}</b></div><div className="summary-box"><small>APPROVED</small><b>{loading?'—':leaveSummary.approved||0}</b></div><div className="summary-box"><small>PENDING</small><b>{loading?'—':leaveSummary.pending||0}</b></div><div className="summary-box"><small>APPROVED DAYS</small><b>{loading||!leaveReportLoaded?'—':leaveSummary.approvedDays||0}</b></div></div><div className="table-scroll"><table aria-label="Leave report data"><thead><tr><th scope="col">PERSON</th><th scope="col">LEAVE</th><th scope="col">DATES</th><th scope="col">DAYS</th><th scope="col">STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:leaveReport.requests?.length?leaveReport.requests.slice(0,30).map((r)=><tr key={r.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(r.full_name)}</span><span><b>{r.full_name}</b><small>{r.employee_code}</small></span></div></td><td>{r.leave_type==='CASUAL'||r.leave_type==='SICK'?'Casual + sick':r.leave_type==='EARNED'?'Earned':'Floating'}</td><td>{formatDate(r.start_date,{day:'numeric',month:'short'})}{r.start_date!==r.end_date?` – ${formatDate(r.end_date,{day:'numeric',month:'short'})}`:''}</td><td>{r.days}</td><td><StatusPill value={r.status}/></td></tr>):<tr><td colSpan="5"><div className="table-message">No leave requests in this report range.</div></td></tr>}</tbody></table></div></Card>
    <div className="mobile-report-list">
      {loading?<Card className="mobile-request-empty"><Spinner/></Card>:leaveReport.requests?.length?leaveReport.requests.slice(0,30).map((row)=><Card className="mobile-report-card" key={'mobile-leave-report-'+row.id}>
        <div className="mobile-report-card-top"><div className="person-cell"><span className="avatar avatar-table">{initials(row.full_name)}</span><span><b>{row.full_name}</b><small>{row.employee_code}</small></span></div><StatusPill value={row.status}/></div>
        <div className="mobile-report-leave-main"><b>{row.leave_type==='CASUAL'||row.leave_type==='SICK'?'Casual + sick':row.leave_type==='EARNED'?'Earned':'Floating'}</b><span>{formatDate(row.start_date,{day:'numeric',month:'short'})}{row.start_date!==row.end_date?' – '+formatDate(row.end_date,{day:'numeric',month:'short'}):''}</span></div>
        <div className="mobile-report-grid"><span><small>DAYS</small><b>{row.days}</b></span><span><small>REQUESTED</small><b>{row.created_at?formatDate(String(row.created_at).slice(0,10),{day:'numeric',month:'short'}):'—'}</b></span></div>
      </Card>):<EmptyState icon={CalendarDays} title="No leave requests in this range." body="Approved and pending requests will appear here."/>}
    </div>
    <div className="report-privacy"><ShieldCheck size={16}/><span>Attendance exports contain verification details for audit review. Personal data remains administrator-only.</span></div>
    {exportOpen&&<Modal title="Export a workplace report" subtitle="Download the current administrator report as a private CSV." close={()=>setExportOpen(false)}><div className="export-preview"><div><span className="eyebrow">READY TO EXPORT</span><b>Attendance + leave records</b><small>{from} → {to} · {rows.length} attendance records</small></div><span className="export-preview-icon"><FileText size={19}/></span></div><div className="export-field-grid"><div><span>FROM</span><b>{from}</b></div><div><span>TO</span><b>{to}</b></div><div><span>FORMAT</span><b>CSV</b></div><div><span>ACCESS</span><b>Admin only</b></div></div><div className="form-modal-actions"><Button variant="soft" type="button" onClick={()=>setExportOpen(false)}>Cancel</Button><Button type="button" icon={Download} loading={exporting} onClick={async()=>{if(await download())setExportOpen(false);}}>Download CSV</Button></div></Modal>}
  </>;
}
function SettingsPage(){
  const {notify}=useApp();
  const [form,setForm]=useState({});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [health,setHealth]=useState(null);
  const [healthLoading,setHealthLoading]=useState(true);
  const [healthError,setHealthError]=useState('');
  const [emailStatus,setEmailStatus]=useState(null);const [emailError,setEmailError]=useState('');const [settingsAvailable,setSettingsAvailable]=useState(false);const settingsRequest=useRef(0);
  const [emailBusy,setEmailBusy]=useState(false);

  const load=async()=>{
    const requestId=++settingsRequest.current;
    setLoading(true);setHealthLoading(true);setHealthError('');setEmailError('');setError('');
    const results=await Promise.allSettled([get('/admin/settings'),get('/admin/system-health'),get('/admin/email-status')]);
    if(requestId!==settingsRequest.current)return;
    const [settingsResult,healthResult,emailResult]=results;
    if(settingsResult.status==='fulfilled'){
      const settings=settingsResult.value.settings;
      setForm({office_name:settings.office_name,office_latitude:settings.office_latitude,office_longitude:settings.office_longitude,geofence_meters:settings.geofence_meters,gps_max_accuracy_meters:settings.gps_max_accuracy_meters,wfh_monthly_cap:settings.wfh_monthly_cap});
      setSettingsAvailable(true);
    }else{setSettingsAvailable(false);setError(settingsResult.reason?.message||'Office settings could not be loaded.');}
    if(healthResult.status==='fulfilled')setHealth(healthResult.value);
    else setHealthError(healthResult.reason?.message||'System health could not be loaded.');
    if(emailResult.status==='fulfilled')setEmailStatus(emailResult.value);
    else{setEmailStatus(null);setEmailError(emailResult.reason?.message||'Email configuration status could not be loaded.');}
    setLoading(false);setHealthLoading(false);
  };

  useEffect(()=>{void load();return()=>{settingsRequest.current+=1;};},[]);

  const save=async(e)=>{
    e.preventDefault();
    setBusy(true);
    setError('');
    try{
      const body={
        ...form,
        office_latitude:Number(form.office_latitude),
        office_longitude:Number(form.office_longitude),
        geofence_meters:Number(form.geofence_meters),
        gps_max_accuracy_meters:Number(form.gps_max_accuracy_meters),
        wfh_monthly_cap:Number(form.wfh_monthly_cap)
      };
      await put('/admin/settings',body);
      notify('Office settings saved.');
      await load();
    }catch(e){setError(e.message);}
    finally{setBusy(false);}
  };

  const set=(key,value)=>setForm((f)=>({...f,[key]:value}));
  const network=health?.officeNetwork;

  return <>
    <PageTitle eyebrow="ONE OFFICE · CLEAR RULES" title="Office settings" description="Manage Pune HQ verification and the current WFH limit." action={<button type="button" className="button button-soft" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?' Refreshing…':' Refresh'}</button>}/>
    {error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{!settingsAvailable&&<button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}>Retry settings</button>}</div>}
    {loading?<Card className="settings-loading"><Spinner/></Card>:!settingsAvailable?<div className="admin-empty-recovery"><CircleAlert size={18}/><b>Office settings unavailable</b><span>Settings were not changed. Retry the request before editing attendance or WFH configuration.</span><Button variant="soft" size="small" onClick={()=>void load()}>Retry settings</Button></div>:<div className="settings-layout">
      <div className="settings-main">
        <Card className="settings-card">
          <CardHeading title="Pune HQ attendance" subtitle="GPS check-in requires both the office geofence and approved office network; the network can also serve as the fallback when GPS is inaccurate."/>
          <form className="form-stack" onSubmit={save}>
            <label className="form-field"><span>Office name</span><input aria-label="Office name" value={form.office_name||''} maxLength="120" onChange={(e)=>set('office_name',e.target.value)} required/></label>
            <div className="form-two"><label className="form-field"><span>Latitude</span><input aria-label="Latitude" type="number" step="0.000001" min="-90" max="90" value={form.office_latitude??''} onChange={(e)=>set('office_latitude',e.target.value)} required/></label><label className="form-field"><span>Longitude</span><input aria-label="Longitude" type="number" step="0.000001" min="-180" max="180" value={form.office_longitude??''} onChange={(e)=>set('office_longitude',e.target.value)} required/></label></div>
            <div className="form-two"><label className="form-field"><span>Geofence radius <small>(metres)</small></span><input type="number" min="20" max="1000" value={form.geofence_meters??''} onChange={(e)=>set('geofence_meters',e.target.value)} required/></label><label className="form-field"><span>Maximum GPS accuracy <small>(metres)</small></span><input type="number" min="20" max="250" value={form.gps_max_accuracy_meters??''} onChange={(e)=>set('gps_max_accuracy_meters',e.target.value)} required/></label></div>
            <div className="locked-policy"><span><Clock3 size={16}/></span><div><b>Attendance rules</b><small>9:00 AM–6:00 PM · Monday–Saturday · late at 9:30 AM · fixed 30-minute lunch</small></div><span className="locked-badge"><ShieldCheck size={12}/> CURRENT POLICY</span></div>
            <Button type="submit" loading={busy}>Save office settings</Button>
          </form>
        </Card>

        <Card className="settings-card">
          <CardHeading title="Office network verification" subtitle="When GPS is inaccurate, HRMS falls back to the public IP seen by the API and checks it against OFFICE_NETWORK_IPS—not the Wi-Fi name or connection icon."/>
          {healthLoading?<div className="settings-loading"><Spinner/></div>:network?<div className="settings-health-grid">
            <div><small>Configuration</small><b>{network.configured?'Ready':'Not configured'}</b></div>
            <div><small>Public IP match</small><b>{network.matchedCurrentRequest?'Matches allow-list':'No allow-list match'}</b></div>
            <div><small>IP seen by API</small><b>{network.currentClientIp||'—'}</b></div>
            <div><small>Allow-listed IPs</small><b>{network.configuredIpCount}</b></div>
            <div><small>Attendance gate</small><b>{network.configured?'GPS or Wi-Fi':'GPS geofence · Wi-Fi fallback needs setup'}</b></div>
            <div><small>Tracking</small><b>One-time check only</b></div>
          </div>:<InlineError>{healthError || 'Network verification status is unavailable.'}</InlineError>}
          <div className="privacy-promise"><ShieldCheck size={16}/><span>For anti-spoof protection, GPS check-in requires both an in-office GPS fix and a matching approved office public egress IP. If GPS is inaccurate, HRMS can fall back to the same approved office network. Browsers cannot expose the Wi-Fi name; if the office public IP changes, update OFFICE_NETWORK_IPS in the production environment and redeploy. Never add a home or hotspot IP to bypass verification.</span></div>
        </Card>

        <Card className="settings-card">
          <CardHeading title="System health" subtitle="Runtime and database diagnostics for administrators." action={<span className="live-tag"><i/> OPERATIONAL VIEW</span>}/>
          {healthLoading?<div className="settings-loading"><Spinner/></div>:health?<div className="settings-health-grid">
            <div><small>API status</small><b>{health.status === 'ok' ? 'Operational' : 'Unavailable'}</b></div><div><small>Database</small><b>{health.mysqlVersion || 'Connected'}</b></div><div><small>DB latency</small><b>{health.databaseLatencyMs} ms</b></div><div><small>Runtime</small><b>{health.nodeVersion}</b></div><div><small>Release</small><b>{health.version}</b></div><div><small>Build</small><b>{String(health.build).slice(0,12)}</b></div>
          </div>:<InlineError>{healthError || 'System health is unavailable.'}</InlineError>}
        </Card>

        <Card className="settings-card">
          <CardHeading title="Email notifications" subtitle="All HR request emails are sent to one designated HR mailbox for a durable record." action={<span className={`live-tag ${emailStatus?.configured?'':'settings-email-off'}`}><i/> {emailStatus?.configured?'SMTP READY':'SMTP NOT CONFIGURED'}</span>}/>
          {emailError?<div className="settings-inline-error" role="alert"><span>{emailError}</span><button type="button" className="text-button" onClick={()=>void load()} disabled={loading}>Retry email status</button></div>:emailStatus?.configured?<div className="settings-health-grid">
            <div><small>SMTP host</small><b>{emailStatus.host||'Configured'}</b></div>
            <div><small>Port</small><b>{emailStatus.port}</b></div>
            <div><small>Transport</small><b>{emailStatus.secure?'Direct TLS':'STARTTLS'}</b></div>
            <div><small>Sender</small><b>{emailStatus.from||'—'}</b></div><div><small>HR mailbox</small><b>{emailStatus.hrNotificationEmail||'Not configured'}</b></div>
          </div>:<div className="privacy-promise"><ShieldCheck size={16}/><span>Configure the SMTP settings and HR_NOTIFICATION_EMAIL in the production environment, then redeploy.</span></div>}
          <div className="settings-email-actions"><button type="button" className="button button-soft" disabled={!emailStatus?.configured||!emailStatus?.hrNotificationEmail||emailBusy} onClick={async()=>{setEmailBusy(true);try{await post('/admin/email-test');notify('SMTP test email sent to the configured HR mailbox.');}catch(e){setError(e.message||'SMTP test failed.')}finally{setEmailBusy(false)}}}>{emailBusy?'Sending…':'Send test email to HR mailbox'}</button></div>
        </Card>

        <Card className="settings-card">
          <CardHeading title="Remote work" subtitle="The usual guideline is up to 4 days per month, with manager approval."/>
          <div className="wfh-cap-row"><div className="wfh-cap-icon"><House size={18}/></div><div><b>Typical monthly limit</b><small>Only employees with WFH enabled can request a day.</small></div><div className="cap-input"><input type="number" min="1" max="15" aria-label="Typical monthly limit" value={form.wfh_monthly_cap??4} onChange={(e)=>set('wfh_monthly_cap',e.target.value)}/><span>days / month</span></div></div><div className="settings-remote-save"><Button type="button" variant="soft" loading={busy} onClick={()=>void save({preventDefault:()=>{}})}>Save remote-work limit</Button><small>This saves the current office and WFH settings together.</small></div>
          <div className="privacy-promise"><ShieldCheck size={16}/><span>No spyware, screen recording, webcam watching or keyboard tracking. WFH is trust-based; performance is measured through delivery.</span></div>
        </Card>
      </div>
      <div className="settings-side">
        <Card className="office-map-card"><div className="map-drawing"><div className="map-grid-lines"/><div className="map-ring map-ring-one"/><div className="map-ring map-ring-two"/><span className="map-pin"><MapPin size={20} fill="currentColor"/></span><span className="map-label">PUNE HQ</span></div><div className="map-caption"><span className="office-live"><i/> OFFICE GEOGRAPHY</span><b>{form.office_name}</b><small>{Number(form.office_latitude).toFixed(6)}° N · {Number(form.office_longitude).toFixed(6)}° E</small><span className="radius-label"><i/> {form.geofence_meters} m geofence</span></div></Card>
        <Card className="settings-note"><span className="note-shield"><ShieldCheck size={18}/></span><h3>Respect is built in.</h3><p>Location is sampled only for an attendance action and stored as a verification record. The app has no background location or continuous tracking.</p><Link className="text-link" to="/admin/attendance">Review the attendance data <ArrowRight size={14}/></Link></Card>
      </div>
    </div>}
  </>;
}

function AuditPage(){
  const [logs,setLogs]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [loadFailed,setLoadFailed]=useState(false);const [search,setSearch]=useState('');const [eventFilter,setEventFilter]=useState('ALL');const auditRequest=useRef(0);const auditLoaded=useRef(false);
  const load=async()=>{const requestId=++auditRequest.current;if(!auditLoaded.current)setLoading(true);setError('');setLoadFailed(false);try{const r=await get('/admin/audit');if(requestId!==auditRequest.current)return;setLogs(Array.isArray(r.logs)?r.logs:[]);auditLoaded.current=true;}catch(e){if(requestId===auditRequest.current){setError(e.message||'The audit trail could not be loaded.');setLoadFailed(true);}}finally{if(requestId===auditRequest.current)setLoading(false);}};
  useEffect(()=>{void load();return()=>{auditRequest.current+=1;};},[]);
  const events=[...new Set(logs.map((l)=>l.action).filter(Boolean))];
  const visible=logs.filter((row)=>{const q=(search||'').toLowerCase();const hay=((row.action||'')+' '+(row.actor_name||'')+' '+(row.employee_code||'')+' '+(row.entity_type||'')+' '+JSON.stringify(row.details||{})).toLowerCase();return (eventFilter==='ALL'||row.action===eventFilter)&&hay.includes(q);});
  return <><PageTitle eyebrow="A CLEAR ACCOUNT OF CHANGES" title="Audit trail" description="A searchable, append-only account of important workspace changes." action={<button type="button" className="button button-soft" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?' Refreshing…':' Refresh'}</button>}/>{error&&<div className="admin-page-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button type="button" className="button button-soft button-small" onClick={()=>void load()} disabled={loading}>Retry audit trail</button></div>}
    <div className="audit-banner"><div className="audit-banner-icon"><ShieldCheck size={19}/></div><div><b>Trust, with a record.</b><p>Sign-ins, approvals, attendance and settings changes are recorded. Private attachment contents and exact locations are not copied into this log.</p></div><span>{visible.length} of {logs.length} events</span></div>
    <Card className="audit-table-card"><div className="table-toolbar audit-toolbar"><div className="search-box"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search person, event or detail…" aria-label="Search audit trail"/></div><div className="toolbar-right"><div className="select-wrap select-small"><select value={eventFilter} onChange={e=>setEventFilter(e.target.value)} aria-label="Filter audit logs by event type"><option value="ALL">All events</option>{events.map((event)=><option value={event} key={event}>{String(event).replaceAll('_',' ')}</option>)}</select><ChevronDown size={14}/></div><span className="audit-retention"><FileClock size={14}/> Append-only</span></div></div><div className="table-scroll"><table aria-label="System audit logs"><thead><tr><th scope="col">EVENT</th><th scope="col">WHO</th><th scope="col">WHAT CHANGED</th><th scope="col">NETWORK</th><th scope="col">WHEN</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:loadFailed?<tr><td colSpan="5"><div className="admin-empty-recovery"><CircleAlert size={18}/><b>Audit trail unavailable</b><span>We could not verify the latest recorded events. Refresh to try again.</span></div></td></tr>:visible.length?visible.map((row)=><tr key={row.id}><td><span className="audit-event"><i/>{String(row.action||'event').replaceAll('_',' ').toLowerCase()}</span><small className="table-subline">{row.entity_type}</small></td><td><div className="person-cell"><span className="avatar avatar-table avatar-audit">{initials(row.actor_name||'System')}</span><span><b>{row.actor_name||'System'}</b><small>{row.employee_code||'Automated'}</small></span></div></td><td className="audit-details">{row.details&&Object.keys(row.details).length?Object.entries(row.details).map(([key,value])=>String(key).replaceAll('_',' ')+': '+(typeof value==='object'?JSON.stringify(value):String(value))).join(' · '):row.entity_id||'—'}</td><td className="audit-ip">{row.ip_address||'—'}</td><td><b>{formatDate(String(row.created_at).slice(0,10),{day:'numeric',month:'short'})}</b><small className="table-subline">{formatTime(row.created_at)}</small></td></tr>):<tr><td colSpan="5"><div className="table-message">No audit events match this view.</div></td></tr>}</tbody></table></div></Card>
  </>;
}


export default App;