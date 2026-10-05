// @ts-nocheck
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness, Calendar,
  CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck,
  CircleHelp, CircleUserRound, ClipboardCheck, Clock3, Download, FileClock, FileText, Filter,
  Fingerprint, Gauge, House, LogIn, LogOut, MapPin, Menu, MoreHorizontal, Plus,
  RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Sun, Timer, Trash2, Users, X,
  PanelLeftClose, UserRound, XCircle
} from 'lucide-react';
import { get, post, patch, put, del, formatDate, formatTime, formatMinutes, todayLocal, initials } from './api';

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);
const today = todayLocal();

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
  return <div className={`brand-mark${small?' brand-mark-small':''}`} aria-hidden="true"><span></span><span></span><span></span><span></span></div>;
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
  return <span className={`status status-${key}`}>{labels[String(raw).toLowerCase()]||raw}</span>;
}
function EmptyState({ icon:Icon=FileText, title, body, action }) { return <div className="empty-state"><span className="empty-icon"><Icon size={21}/></span><h3>{title}</h3><p>{body}</p>{action}</div>; }
function Card({ children, className='' }) { return <section className={`card ${className}`}>{children}</section>; }
function CardHeading({ title, subtitle, action }) { return <div className="card-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>; }

function App() {
  const [user,setUser]=useState(null);
  const [loading,setLoading]=useState(true);
  const [demo,setDemo]=useState({enabled:false,users:[]});
  const [toast,setToast]=useState(null);
  const [bootError,setBootError]=useState('');
  const [notifications,setNotifications]=useState({unread:0,notifications:[]});
  const [refresh,setRefresh]=useState(0);
  const notify=(message,type='success')=>setToast({message,type});
  const refreshNotifications=async()=>{if(!user)return;try{setNotifications(await get('/account/notifications'));}catch{}}
  useEffect(()=>{
    let live=true;
    Promise.allSettled([get('/auth/me'),get('/auth/demo-users')]).then(([me,d])=>{
      if(!live)return;
      if(me.status==='fulfilled')setUser(me.value.user);
      if(d.status==='fulfilled')setDemo(d.value);
      if(me.status==='rejected' && d.status==='rejected') setBootError(me.reason?.message || 'We could not reach the HRMS server.');
      setLoading(false);
    });
    return()=>{live=false;};
  },[]);
  useEffect(()=>{ if(user)refreshNotifications(); },[user,refresh]);
  useEffect(()=>{
    const onSessionExpired=()=>{
      setUser(null);
      setNotifications({unread:0,notifications:[]});
      setToast({message:'Your session has expired. Please sign in again.',type:'error'});
    };
    window.addEventListener('hrms:session-expired',onSessionExpired);
    return ()=>window.removeEventListener('hrms:session-expired',onSessionExpired);
  },[]);
  useEffect(()=>{ if(import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); },[]);
  const value=useMemo(()=>({user,setUser,notify,refresh:()=>setRefresh((v)=>v+1),notifications,refreshNotifications}),[user,notifications]);
  const retryBoot=()=>{setBootError('');setLoading(true);window.location.reload();};
  return <AppContext.Provider value={value}><AppErrorBoundary><BrowserRouter>{loading?<div className="loading-screen"><IconLogo/><Spinner large/></div>:bootError?<div className="loading-screen" role="alert"><IconLogo/><div className="card" style={{maxWidth:520,margin:'24px',textAlign:'center'}}><div className="eyebrow">CONNECTION ISSUE</div><h1>We could not reach the portal.</h1><p>{bootError}</p><button className="button button-primary" onClick={retryBoot}>Try again</button></div></div>:user?<Shell/>:<LoginScreen demo={demo}/>}<Toast toast={toast} onClose={()=>setToast(null)}/></BrowserRouter></AppErrorBoundary></AppContext.Provider>;
}

function LoginScreen({demo}) {
  const {setUser,notify}=useApp();
  const [busy,setBusy]=useState(false);
  const [demoEmail,setDemoEmail]=useState('');
  const [error,setError]=useState('');
  const signIn=async(credential)=>{
    setBusy(true);setError('');
    try { const result=await post('/auth/google',{credential});setUser(result.user); }
    catch(e){setError(e.message);setBusy(false);}
  };
  const demoSignIn=async()=>{
    if(!demoEmail)return;
    setBusy(true);setError('');
    try{const result=await post('/auth/demo',{email:demoEmail});setUser(result.user);notify(`Welcome back, ${result.user.full_name.split(' ')[0]}.`);}
    catch(e){setError(e.message);setBusy(false);}
  };
  return <div className="login-page">
    <div className="login-art"><div className="login-art-top"><IconLogo/><span>FALCHION <b>XENIAA</b></span></div><div className="login-art-copy"><div className="art-label"><span className="pulse-dot"/> PEOPLE · WORKPLACE · TRUST</div><h1>Good work<br/><em>starts here.</em></h1><p>One thoughtful place for your workday, your time away, and the people you work with.</p><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-note"><Sparkles size={15}/> Built around people, not presence</div></div><div className="login-art-footer"><span>FAIRNESS IN EVERY SHIFT</span><span>EST. PUNE · INDIA</span></div></div>
    <div className="login-panel"><div className="login-panel-inner"><div className="mobile-login-brand"><IconLogo/><span>FALCHION <b>XENIAA</b></span></div><div className="eyebrow">THE PEOPLE PORTAL</div><h2>Welcome in.</h2><p className="login-lede">Sign in with the Google account your administrator has added.</p>
      {import.meta.env.VITE_GOOGLE_CLIENT_ID?<div className="google-login-wrap">{busy?<div className="google-loading"><Spinner/> Verifying your account…</div>:<GoogleLogin onSuccess={(r)=>r.credential?signIn(r.credential):(setBusy(false),setError('Google did not return a sign-in credential. Please try again.'))} onError={()=>{setBusy(false);setError('Google sign-in could not start. Please try again.')}} size="large" shape="rectangular" theme="outline" text="continue_with" width="320"/>}</div>:<div className="setup-note"><ShieldCheck size={18}/><span>Google Sign-In becomes available after an administrator adds OAuth client details in the deployment settings.</span></div>}
      {demo.enabled&&<div className="demo-box"><div className="demo-heading"><div><span className="demo-tag">LOCAL PREVIEW</span><h3>Explore the demo</h3></div><span className="demo-count">{demo.users.length} accounts</span></div><label className="field-label" htmlFor="demoAccount">Choose an account</label><div className="select-wrap"><select id="demoAccount" value={demoEmail} onChange={(e)=>setDemoEmail(e.target.value)}><option value="">Select an employee or admin</option>{demo.users.map((person)=><option key={person.id} value={person.email}>{person.role==='ADMIN'?'Admin · ':''}{person.full_name} — {person.title}</option>)}</select><ChevronDown size={15}/></div><Button variant="dark" className="demo-continue" onClick={demoSignIn} disabled={!demoEmail} loading={busy}>Continue to preview <ArrowRight size={16}/></Button><p>Demo access is available only in local development. No password is stored.</p></div>}
      {error&&<div className="inline-alert alert-error"><CircleAlert size={17}/>{error}</div>}
      <div className="login-trust"><span><LockKeyholeIcon/> Secure Google sign-in</span><span><MapPin size={14}/> Location only when you check in</span></div>
    </div><div className="login-footer">Need access? Contact your Falchion Xeniaa administrator.</div></div>
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
  {to:'/calendar',label:'Holiday calendar',icon:Calendar}
];
const adminNav=[
  {to:'/',label:'Overview',icon:Gauge},
  {to:'/team',label:'People',icon:Users},
  {to:'/admin-attendance',label:'Attendance',icon:Clock3},
  {to:'/approvals',label:'Requests',icon:ClipboardCheck},
  {to:'/reports',label:'Reports',icon:Activity},
  {to:'/settings',label:'Office settings',icon:Settings},
  {to:'/audit',label:'Audit trail',icon:ShieldCheck},
  {to:'/calendar',label:'Holiday calendar',icon:Calendar}
];

function Shell(){
  const {user,setUser,notifications,refreshNotifications}=useApp();
  const [mobileOpen,setMobileOpen]=useState(false);
  const [bellOpen,setBellOpen]=useState(false);
  const isAdmin=user.role==='ADMIN';
  const location=useLocation();
  const nav=isAdmin?adminNav:employeeNav;
  const logout=async()=>{try{await post('/auth/logout');}catch{}setUser(null);};
  useEffect(()=>{setMobileOpen(false);setBellOpen(false);},[location.pathname]);
  const pageName=nav.find((item)=>item.to===location.pathname)?.label || (location.pathname==='/profile'?'My profile':'Overview');
  return <div className="app-shell">
    {mobileOpen&&<button className="mobile-scrim" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"/>}
    <aside className={`sidebar${mobileOpen?' sidebar-open':''}`}>
      <Link to="/" className="sidebar-brand"><IconLogo/><span className="brand-wordmark">FALCHION <b>XENIAA</b><small>PEOPLE PORTAL</small></span><button className="sidebar-collapse" aria-label="Close menu" onClick={(e)=>{e.preventDefault();setMobileOpen(false);}}><PanelLeftClose size={17}/></button></Link>
      <div className="workspace-chip"><span className="workspace-avatar">FX</span><span><b>Falchion Xeniaa</b><small>Pune · {isAdmin?'Administrator':'People'}</small></span><ChevronDown size={14}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="main-nav">{nav.map((item)=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} end={item.to==='/'} className={({isActive})=>`nav-link${isActive?' nav-active':''}`}><Icon size={18} strokeWidth={1.8}/><span>{item.label}</span>{item.to==='/approvals'&&notifications.unread>0?<span className="nav-count">{notifications.unread}</span>:null}</NavLink>;})}</nav>
      <div className="nav-bottom"><div className="nav-caption">ACCOUNT</div><NavLink to="/profile" className={({isActive})=>`nav-link${isActive?' nav-active':''}`}><CircleUserRound size={18} strokeWidth={1.8}/><span>My profile</span></NavLink><button className="nav-link nav-logout" onClick={logout}><LogOut size={18} strokeWidth={1.8}/><span>Sign out</span></button></div>
      <div className="sidebar-note"><div className="note-spark"><Sparkles size={15}/></div><p><b>Work with trust.</b><br/>Presence is shared when you choose to check in. No background tracking.</p></div>
      <div className="sidebar-user"><div className="avatar avatar-sand">{initials(user.full_name)}</div><div className="user-lines"><b>{user.full_name}</b><small>{user.role==='ADMIN'?'Administrator':user.user_type==='INTERN'?'Intern':'Employee'}</small></div><button className="icon-button user-more" onClick={logout} title="Sign out"><MoreHorizontal size={19}/></button></div>
    </aside>
    <main className="main-shell"><header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumb"><span>Falchion Xeniaa</span><ChevronRight size={13}/><b>{pageName}</b></div></div><div className="topbar-right"><div className="office-status"><span className="pulse-dot"/> Pune office</div><div className="notification-wrap"><button className={`icon-button notification-button${bellOpen?' active':''}`} onClick={()=>setBellOpen((v)=>!v)} aria-label="Notifications"><Bell size={19}/>{notifications.unread>0&&<span className="notification-dot"/>}</button>{bellOpen&&<NotificationPopover close={()=>setBellOpen(false)} refresh={refreshNotifications}/>}</div><Link to="/profile" className="avatar avatar-top">{initials(user.full_name)}</Link></div></header>
      <div className="page-wrap"><Routes><Route path="/" element={isAdmin?<AdminHome/>:<EmployeeHome/>}/><Route path="/attendance" element={<AttendancePage/>}/><Route path="/leave" element={<LeavePage/>}/><Route path="/wfh" element={<WfhPage/>}/><Route path="/out" element={<OutPage/>}/><Route path="/calendar" element={<CalendarPage/>}/><Route path="/profile" element={<ProfilePage/>}/><Route path="/notifications" element={<NotificationsPage/>}/>
        <Route path="/team" element={isAdmin?<TeamPage/>:<NoAccess/>}/><Route path="/admin-attendance" element={isAdmin?<AdminAttendancePage/>:<NoAccess/>}/><Route path="/approvals" element={isAdmin?<ApprovalsPage/>:<NoAccess/>}/><Route path="/reports" element={isAdmin?<ReportsPage/>:<NoAccess/>}/><Route path="/settings" element={isAdmin?<SettingsPage/>:<NoAccess/>}/><Route path="/audit" element={isAdmin?<AuditPage/>:<NoAccess/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></div>
      <footer className="app-footer"><span>Falchion Xeniaa · People portal</span><span>Built on trust <span className="footer-dot">·</span> {new Date().getFullYear()}</span></footer>
    </main>
  </div>;
}
function NotificationPopover({close,refresh}){
  const {notifications,notify}=useApp();const [items,setItems]=useState(notifications.notifications);const [busy,setBusy]=useState(false);const [busyId,setBusyId]=useState(null);
  useEffect(()=>setItems(notifications.notifications),[notifications]);
  const mark=async(id)=>{setBusyId(id);try{await post(`/account/notifications/${id}/read`);setItems((all)=>all.map((x)=>x.id===id?{...x,read_at:new Date().toISOString()}:x));refresh();}catch(e){notify(e.message,'error');}finally{setBusyId(null);}}
  const markAll=async()=>{setBusy(true);try{await post('/account/notifications/read-all');setItems((all)=>all.map((x)=>({...x,read_at:new Date().toISOString()})));refresh();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  return <div className="notification-popover"><div className="popover-heading"><div><b>Notifications</b><small>{notifications.unread?`${notifications.unread} unread`:'You’re all caught up'}</small></div><button className="text-button" disabled={!notifications.unread||busy} onClick={markAll}>Mark all read</button></div><div className="notification-list">{items.length?items.slice(0,8).map((item)=><button className={`notification-item${item.read_at?'':' notification-unread'}`} key={item.id} onClick={()=>mark(item.id)}><span className="notification-icon"><CheckCheck size={15}/></span><span><b>{item.title}</b><small>{item.body}</small><em>{formatTime(item.created_at)} · {formatDate(String(item.created_at).slice(0,10),{month:'short',day:'numeric'})}</em></span></button>):<div className="notification-empty"><Bell size={20}/><span>No notifications yet</span></div>}</div></div>;
}
function NoAccess(){return <div className="no-access"><ShieldCheck size={30}/><h2>You don’t have access to this view.</h2><p>Ask an administrator if you think this is a mistake.</p><Link className="text-link" to="/">Back to overview <ArrowRight size={15}/></Link></div>;}
function weekDaysFor(date){const base=new Date(`${date}T12:00:00Z`);const weekday=base.getUTCDay();const mondayOffset=weekday===0?6:weekday-1;base.setUTCDate(base.getUTCDate()-mondayOffset);return Array.from({length:7},(_,i)=>{const d=new Date(base);d.setUTCDate(base.getUTCDate()+i);return {date:d.toISOString().slice(0,10),label:['M','T','W','T','F','S','S'][i],working:i<6};});}

function EmployeeHome(){
  const {user,notifications}=useApp();const [todayRow,setTodayRow]=useState(null);const [balance,setBalance]=useState([]);const [history,setHistory]=useState([]);const [weekRecords,setWeekRecords]=useState([]);const [holiday,setHoliday]=useState(null);const [calendarHolidays,setCalendarHolidays]=useState([]);const [leaveRequests,setLeaveRequests]=useState([]);const [wfhData,setWfhData]=useState({enabled:false,monthlyCap:4,requests:[]});const [time,setTime]=useState(new Date());const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  useEffect(()=>{const timer=setInterval(()=>setTime(new Date()),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{let live=true;Promise.all([get(`/attendance?from=${today}&to=${today}`),get('/leave/balances'),get(`/attendance?from=${today.slice(0,4)}-01-01&to=${today}`),get(`/calendar?year=${today.slice(0,4)}`),get('/leave'),get('/wfh')]).then(([a,b,h,c,l,w])=>{if(!live)return;setTodayRow(a.records[0]||null);setBalance(b.balances||[]);setWeekRecords(h.records||[]);setHistory((h.records||[]).filter((r)=>r.attendance_date!==today).slice(0,5));setHoliday((c.holidays||[]).find((x)=>x.date===today)||null);setCalendarHolidays(c.holidays||[]);setLeaveRequests(l.requests||[]);setWfhData({enabled:Boolean(w.enabled),monthlyCap:Number(w.monthlyCap||4),requests:w.requests||[]});}).catch((e)=>setError(e.message)).finally(()=>live&&setLoading(false));return()=>{live=false;};},[]);
  const welcome=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Asia/Kolkata'}).format(time));
  const greeting=welcome<12?'Good morning':welcome<17?'Good afternoon':'Good evening';
  const name=user.full_name.split(' ')[0];
  const earned=balance.find((b)=>b.type==='EARNED');
  const week=weekDaysFor(today);const holidayMap=new Map(calendarHolidays.map((item)=>[item.date,item.name]));const weekProgress=week.map((day)=>{const row=weekRecords.find((record)=>record.attendance_date===day.date);const holidayName=holidayMap.get(day.date);return {...day,row,holidayName,working:day.working&&!holidayName,completed:Boolean(row?.check_in_at&&row?.check_out_at),isCurrent:day.date===today};});
  const completedDays=weekProgress.filter((day)=>day.completed).length;const remainingDays=weekProgress.filter((day)=>day.working&&day.date>=today&&!day.completed).length;const shared=balance.find((b)=>b.type==='CASUAL');const floating=balance.find((b)=>b.type==='FLOATING');const pendingLeave=leaveRequests.filter((item)=>item.status==='PENDING').length;const pendingWfh=wfhData.requests.filter((item)=>item.status==='PENDING').length;const approvedWfhThisMonth=wfhData.requests.filter((item)=>item.status==='APPROVED'&&String(item.request_date).slice(0,7)===today.slice(0,7)).length;const nextHoliday=calendarHolidays.find((item)=>item.date>today);const unread=Number(notifications?.unread||0);
  return <>
    {error&&<InlineError>{error}<button className="text-button" onClick={()=>window.location.reload()}>Try again</button></InlineError>}
    <PageTitle eyebrow={formatDate(today,{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).toUpperCase()} title={`${greeting}, ${name}.`} description="A little overview to help you find your rhythm today." action={<Link className="button button-soft" to="/calendar"><CalendarDays size={17}/> View calendar</Link>}/>
    <section className="day-hero"><div className="hero-text"><div className="hero-kicker"><span className="hero-sun"><Sun size={15}/></span> {holiday?'A DAY SET ASIDE TO PAUSE':'YOUR WORKDAY, AT A GLANCE'}</div><h2>{holiday?`Enjoy ${holiday.name}.`:todayRow?.check_in_at?todayRow.check_out_at?'Day wrapped up.':'You’re in for the day.':'Ready when you are.'}</h2><p>{holiday?`${holiday.name} is on the company holiday calendar. Attendance isn’t expected today.`:todayRow?.check_in_at?`You checked in at ${formatTime(todayRow.check_in_at)}. Your day is yours to focus on.`:'Check in when you arrive. Your location is checked once, only for attendance.'}</p><div className="hero-actions">{holiday?<Link className="button button-light" to="/calendar"><CalendarDays size={16}/> View holiday calendar <ArrowRight size={16}/></Link>:todayRow?.check_in_at?<Link className="button button-light" to="/attendance">{todayRow.check_out_at?'Review today':'Check out when you leave'}<ArrowRight size={16}/></Link>:<Link className="button button-light" to="/attendance"><LogIn size={16}/> Check in <ArrowRight size={16}/></Link>}<span className="hero-time">{new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(time)} IST</span></div></div><div className="hero-art"><div className="hero-date"><span>{new Intl.DateTimeFormat('en-IN',{weekday:'short',timeZone:'Asia/Kolkata'}).format(time)}</span><b>{new Intl.DateTimeFormat('en-IN',{day:'2-digit',timeZone:'Asia/Kolkata'}).format(time)}</b><small>{new Intl.DateTimeFormat('en-IN',{month:'short',timeZone:'Asia/Kolkata'}).format(time)}</small></div><div className="hero-ring ring-a"/><div className="hero-ring ring-b"/><div className="hero-plant"><span/><span/><span/><span/><i/></div></div><div className="hero-bottom"><span><MapPin size={14}/> Falchion Xeniaa · Pune HQ</span><span>Mon–Sat <b>·</b> 9:00 AM – 6:00 PM</span></div></section>
    <section className="employee-action-center">
      <Card className="action-center-card">
        <CardHeading title="What needs your attention" subtitle={(pendingLeave||pendingWfh||unread||(!holiday&&!todayRow?.check_in_at)||Boolean(todayRow?.check_in_at&&!todayRow?.check_out_at))?"A few useful next steps for today.":"You’re all caught up."}/>
        <div className="employee-action-grid">
          <Link className={`employee-action-item${!holiday&&!todayRow?.check_in_at?" action-item-primary":""}`} to="/attendance"><span className="employee-action-icon"><Clock3 size={17}/></span><span><b>{holiday?"Holiday today":todayRow?.check_in_at?(todayRow.check_out_at?"Review today":"Check out when you leave"):"Check in when you arrive"}</b><small>{holiday?"Attendance is not expected.":todayRow?.check_in_at?(todayRow.check_out_at?"Your attendance record is complete.":"Location is checked once at check-out."):"Location + office network are verified only when you press the attendance action."}</small></span><ArrowRight size={15}/></Link>
          <Link className="employee-action-item" to="/leave"><span className="employee-action-icon"><CalendarDays size={17}/></span><span><b>{pendingLeave?pendingLeave+" pending leave request"+(pendingLeave===1?"":"s"):"Leave balances ready"}</b><small>{shared?.remaining??0} shared casual/sick · {earned?.remaining??0} earned · {floating?.remaining??0} floating</small></span><ArrowRight size={15}/></Link>
          <Link className="employee-action-item" to="/wfh"><span className="employee-action-icon"><House size={17}/></span><span><b>{wfhData.enabled?(pendingWfh?pendingWfh+" pending WFH request"+(pendingWfh===1?"":"s"):"WFH available by approval"):"WFH not enabled"}</b><small>{wfhData.enabled?approvedWfhThisMonth+"/"+wfhData.monthlyCap+" approved this month":"Ask an administrator if WFH should be enabled for you."}</small></span><ArrowRight size={15}/></Link>
          <button className="employee-action-item employee-action-button" type="button" onClick={()=>document.querySelector('[aria-label="Notifications"]')?.click()}><span className="employee-action-icon"><Bell size={17}/></span><span><b>{unread?unread+" unread notification"+(unread===1?"":"s"):"No unread notifications"}</b><small>{unread?"Review approvals and updates from your team.":"You’re all caught up on updates."}</small></span><ArrowRight size={15}/></button>
        </div>
      </Card>
      <Card className="next-holiday-card"><span className="next-holiday-icon"><Sun size={18}/></span><div><small>NEXT COMPANY HOLIDAY</small><b>{nextHoliday?formatDate(nextHoliday.date,{weekday:"short",day:"numeric",month:"long"}):"No upcoming holiday"}</b><span>{nextHoliday?.name||"Your calendar is clear."}</span></div><Link className="tiny-arrow" to="/calendar"><ArrowRight size={15}/></Link></Card>
    </section>
    <div className="overview-grid"><Card className="balance-card"><CardHeading title="Time off, your way" subtitle="A little room to recharge." action={<Link className="tiny-arrow" to="/leave"><ArrowUpRight size={17}/></Link>}/><div className="balance-display"><div className="balance-number">{earned?.remaining??'—'}<small>days available</small></div><div className="balance-mini"><span className="mini-circle mini-sage"><Sun size={17}/></span><div><b>Earned leave</b><small>Accrues each month</small></div></div></div><div className="balance-rows">{balance.filter((b)=>b.type!=='EARNED').map((b)=><div key={b.type}><span>{b.label}</span><b>{b.remaining} <small>days</small></b></div>)}</div><Link className="card-foot-link" to="/leave">See balances & request leave <ArrowRight size={14}/></Link></Card>
      <Card className="week-card"><CardHeading title="This week" subtitle="Small steps add up." action={<span className="week-number">WEEK AT A GLANCE</span>}/><div className="week-track">{weekProgress.map((day)=><div key={day.date} title={day.holidayName||(!day.working?'Sunday':undefined)} className={`week-day${day.completed?' day-done':''}${day.isCurrent&&!day.holidayName?' day-current':''}${!day.working?' day-off':''}${day.row?.status==='ON_LEAVE'?' day-leave':''}`}><span>{day.label}</span><b>{day.completed?<Check size={14}/>:day.isCurrent&&!day.holidayName?<span className="day-dot"/>:day.row?.status==='ON_LEAVE'?<span className="day-leave-mark">·</span>:!day.working?<span className="day-offmark">·</span>:<span className="day-empty"/>}</b></div>)}</div><div className="week-footer"><span><i className="legend-dot legend-done"/> {completedDays} days complete</span><span><i className="legend-dot legend-planned"/> {remainingDays} working days left</span></div><div className="week-quote"><span className="quote-mark">“</span><span>Presence is a contribution, not a surveillance metric.</span><b>— FALCHION CULTURE</b></div></Card>
    </div>
    <div className="section-head"><div><h2>Your recent days</h2><p>A simple view of your attendance history.</p></div><Link className="text-link" to="/attendance">Full attendance history <ArrowRight size={15}/></Link></div>
    <Card className="table-card"><div className="table-scroll"><table><thead><tr><th>DATE</th><th>CHECK IN</th><th>CHECK OUT</th><th>DAY TYPE</th><th>TIME WORKED</th><th>STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="6" className="table-message"><Spinner/></td></tr>:history.length?history.map((row)=><tr key={row.id}><td><b>{formatDate(row.attendance_date,{weekday:'short',day:'numeric',month:'short'})}</b></td><td>{formatTime(row.check_in_at)}</td><td>{formatTime(row.check_out_at)}</td><td><span className="table-type"><span className="type-dot"/>{row.check_in_method==='WFH'?'Remote':'Office'}</span></td><td>{formatMinutes(row.worked_minutes)}</td><td><StatusPill value={row.status}/></td></tr>):<tr><td colSpan="6"><div className="table-message">No attendance records yet. Your recent workdays will appear here.</div></td></tr>}</tbody></table></div></Card>
  </>;
}

function AdminHome(){
  const {user}=useApp();const [data,setData]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const load=()=>{setLoading(true);setError('');get('/admin/dashboard').then(setData).catch((e)=>setError(e.message)).finally(()=>setLoading(false));};
  useEffect(()=>{load();},[]);
  const stats=data?.stats||{};
  return <>
    {error&&<InlineError>{error}<button className="text-button" onClick={load}>Try again</button></InlineError>}
    <PageTitle eyebrow={formatDate(today,{weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase()} title={`Good morning, ${user.full_name.split(' ')[0]}.`} description="Here’s your workplace at a glance." action={<Link to="/team" className="button button-primary"><Plus size={17}/> Add a person</Link>}/>
    <div className="admin-intro"><div className="intro-icon"><Activity size={18}/></div><div><b>{data?.officeHoliday?`${data.holidayName||'Office holiday'} · attendance not expected`:'People, not just presence.'}</b><span>{data?.officeHoliday?'Today is a scheduled non-working day for Falchion Xeniaa.':'Attendance is a record of the workday—not a measure of someone’s value.'}</span></div><span className="intro-date"><span className="pulse-dot"/> {data?.officeHoliday?'SCHEDULED HOLIDAY':'LIVE TODAY'}</span></div>
    <div className="stat-grid">{[
      {label:'Team members',value:stats.employees,meta:'Across employees & interns',icon:Users,tone:'blue'},
      {label:'Checked in today',value:stats.present,meta:`${stats.employees?Math.round((stats.present/stats.employees)*100):0}% of active team`,icon:Fingerprint,tone:'green'},
      {label:'Needs your attention',value:stats.pending,meta:'Requests waiting for review',icon:ClipboardCheck,tone:'gold'},
      {label:'Late entries today',value:stats.late,meta:'After 9:30 AM',icon:Clock3,tone:'rose'}
    ].map((item)=><Card className="stat-card" key={item.label}><div className={`stat-icon stat-${item.tone}`}><item.icon size={18}/></div><div className="stat-label">{item.label}</div><div className="stat-value">{loading?'—':item.value??0}</div><div className="stat-meta">{item.meta}</div></Card>)}</div>
    <div className="admin-home-grid"><Card className="team-presence"><CardHeading title="Today at Pune HQ" subtitle={data?.officeHoliday?`${data.holidayName||'Office closed'} · attendance not expected.`:'A quiet snapshot of check-ins.'} action={<Link className="tiny-arrow" to="/admin-attendance"><ArrowUpRight size={17}/></Link>}/><div className="presence-visual"><div className="presence-donut" style={{'--progress':`${stats.employees?Math.round((stats.present/stats.employees)*100):0}%`}}><div><b>{loading?'—':stats.present||0}<small>/{stats.employees||0}</small></b><span>checked in</span></div></div><div className="presence-legend"><div><i className="legend-dot legend-done"/><span>On time</span><b>{stats.onTime??0}</b></div><div><i className="legend-dot legend-late"/><span>Late entry</span><b>{stats.late??0}</b></div><div><i className="legend-dot legend-away"/><span>{data?.officeHoliday?'Scheduled holiday':'Not checked in'}</span><b>{data?.officeHoliday?0:Math.max(0,(stats.employees||0)-(stats.present||0))}</b></div><div><i className="legend-dot legend-out"/><span>Temporary exit</span><b>{stats.outNow??0}</b></div></div></div><div className="attendance-window"><span><Clock3 size={15}/> Standard hours</span><b>9:00 AM — 6:00 PM</b></div></Card>
      <Card className="approval-card"><CardHeading title="Your review queue" subtitle="A timely response goes a long way." action={<Link className="tiny-arrow" to="/approvals"><ArrowUpRight size={17}/></Link>}/>{Number(stats.pending)>0?<><div className="approval-highlight"><div className="approval-stack"><span><CalendarDays size={17}/></span><span><House size={17}/></span><span><Clock3 size={17}/></span></div><div><b>{stats.pending} request{stats.pending===1?'':'s'} to review</b><small>Leave, WFH, attendance and flex starts</small></div></div><Link to="/approvals" className="button button-primary full-button">Review requests <ArrowRight size={16}/></Link></>:<div className="queue-clear"><span><Check size={17}/></span><b>All caught up</b><small>No pending requests right now.</small></div>}<div className="review-reminder"><ShieldCheck size={15}/><span>Keep flexibility and individual context in mind when reviewing.</span></div></Card></div>
    <div className="section-head"><div><h2>Temporary exits</h2><p>Only employees who marked themselves as currently out appear here.</p></div></div><Card className="table-card"><div className="table-scroll"><table><thead><tr><th>PERSON</th><th>LEFT AT</th><th>NOTE</th><th>STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="4" className="table-message"><Spinner/></td></tr>:data?.temporaryExits?.length?data.temporaryExits.map((row)=><tr key={row.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(row.full_name)}</span><span><b>{row.full_name}</b><small>{row.employee_code}</small></span></div></td><td>{formatTime(row.left_at)}</td><td>{row.reason||'—'}</td><td><span className="status status-on-time">Currently out</span></td></tr>):<tr><td colSpan="4"><div className="table-message">No one is currently marked as out.</div></td></tr>}</tbody></table></div></Card>
    <div className="section-head"><div><h2>Latest check-ins</h2><p>Attendance records for today.</p></div><Link className="text-link" to="/admin-attendance">View all attendance <ArrowRight size={15}/></Link></div><Card className="table-card"><div className="table-scroll"><table><thead><tr><th>PERSON</th><th>CHECK IN</th><th>METHOD</th><th>DISTANCE</th><th>STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:data?.recent?.length?data.recent.map((row)=><tr key={row.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(row.full_name)}</span><span><b>{row.full_name}</b><small>{row.employee_code}</small></span></div></td><td>{formatTime(row.check_in_at)}</td><td><span className="table-type"><i className="type-dot"/>{row.check_in_method||'—'}</span></td><td>{row.check_in_distance_m==null?'—':`${Math.round(row.check_in_distance_m)} m`}</td><td><StatusPill value={row.status}/></td></tr>):<tr><td colSpan="5"><div className="table-message">No check-ins have been recorded yet today.</div></td></tr>}</tbody></table></div></Card>
  </>;
}

function AttendancePage(){
  const {notify,refresh}=useApp();
  const [rows,setRows]=useState([]);
  const [todayHoliday,setTodayHoliday]=useState(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [correctionOpen,setCorrectionOpen]=useState(false);
  const [flexOpen,setFlexOpen]=useState(false);
  const [exit,setExit]=useState(null);
  const [workplaceMode,setWorkplaceMode]=useState('OFFICE');const [verificationStage,setVerificationStage]=useState('idle');

  const load=async()=>{
    setLoading(true);
    try{
      const [a,x,c]=await Promise.all([
        get(`/attendance?from=${today.slice(0,4)}-01-01&to=${today}`),
        get('/attendance/exits/current'),
        get(`/calendar?year=${today.slice(0,4)}`)
      ]);
      setRows(a.records||[]);
      setExit(x.exit);
      setTodayHoliday(c.holidays.find((h)=>h.date===today)||null);
    }catch(e){setError(e.message);}
    finally{setLoading(false);}
  };

  useEffect(()=>{load();},[]);

  const current=rows.find((r)=>r.attendance_date===today);
  const working=current?.check_in_at&&!current.check_out_at;

  const captureLocation=()=>new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error('This browser does not support location. Use a supported browser or device.'));
      return;
    }
    const requestLocation=()=>navigator.geolocation.getCurrentPosition(
      ({coords})=>resolve({latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy}),
      (geoError)=>{
        const message = geoError?.code===1
          ? 'Location permission is required for office attendance. Allow location access for this site and try again.'
          : geoError?.code===2
            ? 'Your location could not be determined. Move to a clearer area and try again.'
            : geoError?.code===3
              ? 'Location lookup took too long. Try again.'
              : 'Location access is unavailable. Check the browser location permission and try again.';
        reject(new Error(message));
      },
      {enableHighAccuracy:true,timeout:12000,maximumAge:0}
    );

    if(navigator.permissions?.query){
      navigator.permissions.query({name:'geolocation'})
        .then((permission)=>{
          if(permission.state==='denied'){
            reject(new Error('Location permission is blocked for this site. Allow Location access for localhost in Safari settings, then try again.'));
            return;
          }
          requestLocation();
        })
        .catch(requestLocation);
    }else{
      requestLocation();
    }
  });

  const punch=async(type,method='GPS')=>{
    setBusy(true);
    setError('');
    setVerificationStage(method==='GPS'?'location':'network');
    try{
      let geo={};
      if(method==='GPS'){
        setVerificationStage('location');
        geo=await captureLocation();
        setVerificationStage('network');
      }
      const result=await post(`/attendance/${type}`,{method,...geo});
      setVerificationStage('success');
      setWorkplaceMode('OFFICE');
      notify(type==='check-in'
        ? `You're checked in${result.status==='LATE_ENTRY'?' — recorded as a late entry':''}.`
        : "You're checked out. Have a good evening.");
      await load();
      refresh();
    }catch(e){
      setVerificationStage('idle');
      setError(e.message);
    }finally{
      setBusy(false);
    }
  };

  return <>
    <PageTitle eyebrow="YOUR TIME, YOUR RECORD" title="Attendance" description="Arrive, verify once, and start your workday." action={<button className="button button-soft" onClick={load}><RefreshCw size={16}/> Refresh</button>}/>
    {error&&<div className="inline-alert alert-error"><CircleAlert size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss"><X size={15}/></button></div>}
    <div className="attendance-layout">
      <div className="attendance-main-col">
        <Card className="attendance-action-card">
          <div className="attendance-action-copy">
            <span className="action-kicker"><span className={`pulse-dot${working?'':' pulse-muted'}`}/>{todayHoliday&&!working?todayHoliday.name.toUpperCase():working?'DAY IN PROGRESS':'TODAY · '+formatDate(today,{weekday:'long',day:'numeric',month:'long'})}</span>
            <h2>{todayHoliday&&!working?'A scheduled day to pause.':working?"You're checked in.":'Start your workday.'}</h2>
            <p>{todayHoliday&&!working?`${todayHoliday.name} is a company holiday. There’s no check-in expected today.`:working?`You started at ${formatTime(current.check_in_at)}. Check out when you’re ready to wrap up.`:workplaceMode==='WFH'?'Your approved remote day does not require office location verification.':'Click check in and we’ll request your location once, verify the office geofence and confirm the office network.'}</p>
            {busy&&workplaceMode==='OFFICE' && <div className="verification-panel" role="status" aria-live="polite">
              <div className="verification-line">
                <span className={`verification-step ${verificationStage==='location'?'verification-active':'verification-done'}`}>{verificationStage==='location'?<Spinner/>:<Check size={13}/>}</span>
                <span><b>{verificationStage==='location'?'Verifying your location':'Location verified'}</b><small>{verificationStage==='location'?'Waiting for the browser’s one-time location result.':'GPS accuracy and the 80 m office radius passed.'}</small></span>
              </div>
              <div className="verification-line">
                <span className={`verification-step ${verificationStage==='network'?'verification-active':verificationStage==='success'?'verification-done':''}`}>{verificationStage==='network'?<Spinner/>:verificationStage==='success'?<Check size={13}/>:<span>2</span>}</span>
                <span><b>{verificationStage==='network'?'Verifying office network':verificationStage==='success'?'Office network verified':'Office network check'}</b><small>{verificationStage==='network'?'Confirming that this request came through the approved office network.':'Checked by the HRMS server; no Wi-Fi name is collected.'}</small></span>
              </div>
            </div>}
            <div className="checkin-action-row">
              {working
                ? <Button onClick={()=>punch('check-out',current.check_in_method==='WFH'?'WFH':'GPS')} loading={busy} icon={LogOut}>Check out</Button>
                : todayHoliday
                  ? <Link className="button button-soft" to="/calendar"><CalendarDays size={16}/> View holiday calendar</Link>
                  : <><Button onClick={()=>workplaceMode==='WFH'?punch('check-in','WFH'):punch('check-in','GPS')} loading={busy} icon={LogIn}>{busy?(verificationStage==='location'?'Verifying location…':verificationStage==='network'?'Verifying office network…':'Checking in…'):workplaceMode==='WFH'?'Start remote day':'Check in at office'}</Button><button className={`mode-switch${workplaceMode==='WFH'?' mode-switch-active':''}`} onClick={()=>setWorkplaceMode(workplaceMode==='WFH'?'OFFICE':'WFH')}><House size={15}/>{workplaceMode==='WFH'?'Remote work selected':'Working from home'}</button></>
              }
            </div>
            <div className="checkin-meta">
              <span><MapPin size={14}/>{todayHoliday&&!working?todayHoliday.name:workplaceMode==='WFH'?'Approved remote work':'Pune HQ · 80 m radius'}</span>
              <span><ShieldCheck size={14}/>{workplaceMode==='WFH'?'WFH approved':'Location + office Wi-Fi verification'}</span>
            </div>
          </div>
          <div className="attendance-status-art"><div className="status-orbit status-orbit1"/><div className="status-orbit status-orbit2"/><div className="status-clock"><Clock3 size={37}/><span>{working?'IN':todayHoliday?'HOL':'—'}</span></div><small>9:00 AM <i/> 6:00 PM</small></div>
        </Card>
        <div className="section-head attendance-section-head"><div><h2>Attendance history</h2><p>Day-by-day, without the noise.</p></div><span className="date-range-label"><CalendarDays size={15}/> {today.slice(0,4)}</span></div>
        <Card className="table-card"><div className="table-scroll"><table><thead><tr><th>DATE</th><th>CHECK IN</th><th>CHECK OUT</th><th>WORKED</th><th>STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:rows.length?rows.map((r)=><tr key={r.id}><td><b>{formatDate(r.attendance_date,{weekday:'short',day:'numeric',month:'short'})}</b></td><td>{formatTime(r.check_in_at)}</td><td>{formatTime(r.check_out_at)}</td><td>{formatMinutes(r.worked_minutes)}</td><td><StatusPill value={r.status}/></td></tr>):<tr><td colSpan="5"><div className="table-message">Your attendance records will appear here.</div></td></tr>}</tbody></table></div></Card>
      </div>
      <div className="attendance-side-col">
        <Card className="schedule-card"><span className="side-card-icon"><Sun size={18}/></span><h3>Today’s rhythm</h3><p>A steady schedule that leaves space for life.</p><div className="schedule-row"><span>Office hours</span><b>9:00 AM — 6:00 PM</b></div><div className="schedule-row"><span>Lunch</span><b>30 minutes · fixed</b></div><div className="schedule-row"><span>Working days</span><b>Monday to Saturday</b></div><div className="schedule-policy"><ShieldCheck size={14}/><span>Office check-in verifies <b>your location + office Wi-Fi</b>. There is no background tracking.</span></div></Card>
        <Card className="help-card"><div className="help-top"><span><CircleHelp size={17}/></span><h3>Need to correct a day?</h3></div><p>Forgot to check out, or had a location issue? Ask an administrator to review a correction.</p><button className="text-link" onClick={()=>setCorrectionOpen(true)}>Request correction <ArrowRight size={14}/></button></Card>
        <Card className="help-card flex-help"><div className="help-top"><span><Timer size={17}/></span><h3>Need a flex start?</h3></div><p>Request an adjusted start between 9:00 and 10:30 AM for manager approval.</p><button className="text-link" onClick={()=>setFlexOpen(true)}>Request flex start <ArrowRight size={14}/></button></Card>
        <Card className="wfh-shortcut"><span className="wfh-short-icon"><House size={17}/></span><b>Remote day?</b><small>WFH is separate from office attendance verification.</small><Link to="/wfh">See WFH requests <ArrowRight size={13}/></Link></Card>
      </div>
    </div>
    {correctionOpen&&<CorrectionModal close={()=>setCorrectionOpen(false)} onDone={()=>{setCorrectionOpen(false);notify('Your correction request was sent for review.');load();}}/>}
    {flexOpen&&<FlexModal close={()=>setFlexOpen(false)} onDone={()=>{setFlexOpen(false);notify('Your flex-start request was sent to the administrator.');refresh();}}/>}
  </>;
}

function CorrectionModal({close,onDone}){
  const [date,setDate]=useState(today);const [checkIn,setCheckIn]=useState('');const [checkOut,setCheckOut]=useState('');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/attendance/corrections',{date,requestedCheckIn:checkIn?new Date(checkIn).toISOString():undefined,requestedCheckOut:checkOut?new Date(checkOut).toISOString():undefined,reason});onDone();}catch(x){setError(x.message);}finally{setBusy(false);}};
  return <Modal title="Request an attendance correction" subtitle="A short note helps the administrator review the day." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Work date</span><input type="date" value={date} max={today} onChange={(e)=>setDate(e.target.value)} required/></label><div className="form-two"><label className="form-field"><span>Correct check-in <small>(optional)</small></span><input type="datetime-local" value={checkIn} onChange={(e)=>setCheckIn(e.target.value)}/></label><label className="form-field"><span>Correct check-out <small>(optional)</small></span><input type="datetime-local" value={checkOut} onChange={(e)=>setCheckOut(e.target.value)}/></label></div><label className="form-field"><span>What happened?</span><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="For example: I missed the checkout because my phone battery ran out." minLength="8" maxLength="1000" required/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button type="submit" loading={busy} icon={Send}>Send for review</Button></div></form></Modal>;
}
function FlexModal({close,onDone}){
  const [date,setDate]=useState(today);const [startTime,setStart]=useState('10:00');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/attendance/flex-requests',{date,startTime,reason});onDone();}catch(x){setError(x.message);}finally{setBusy(false);}};
  return <Modal title="Request a flexible start" subtitle="The policy allows 9:00–10:30 AM with manager approval." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Date</span><input type="date" value={date} min={today} onChange={(e)=>setDate(e.target.value)} required/></label><label className="form-field"><span>Requested start</span><input type="time" min="09:00" max="10:30" value={startTime} onChange={(e)=>setStart(e.target.value)} required/></label><label className="form-field"><span>Context for your manager</span><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Share any details that would be helpful." minLength="8" maxLength="1000" required/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button type="submit" loading={busy} icon={Send}>Request approval</Button></div></form></Modal>;
}
function Modal({title,subtitle,close,children}){
  useEffect(()=>{
    const onKey=(event)=>{if(event.key==='Escape')close();};
    document.addEventListener('keydown',onKey);
    return()=>document.removeEventListener('keydown',onKey);
  },[close]);
  return <div className="modal-overlay" onMouseDown={(e)=>e.target===e.currentTarget&&close()}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" onClick={close} aria-label="Close"><X size={19}/></button></div>{children}</div></div>;
}
function InlineError({children}){return <div className="inline-alert alert-error" role="alert"><CircleAlert size={16}/>{children}</div>;}

function LeavePage(){
  const {notify,refresh}=useApp();const [balances,setBalances]=useState([]);const [requests,setRequests]=useState([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [withdrawBusy,setWithdrawBusy]=useState(null);const [error,setError]=useState('');const [file,setFile]=useState(null);const [type,setType]=useState('CASUAL');const [startDate,setStart]=useState('');const [endDate,setEnd]=useState('');const [reason,setReason]=useState('');
  const load=async()=>{setLoading(true);try{const [b,r]=await Promise.all([get('/leave/balances'),get('/leave')]);setBalances(b.balances);setRequests(r.requests);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const sickDays=type==='SICK'&&startDate&&endDate?Math.round((new Date(`${endDate}T12:00:00`)-new Date(`${startDate}T12:00:00`))/86400000)+1:0;
  const requiresDoctorNote=type==='SICK'&&sickDays>=3;
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{let attachmentId;if(file){const form=new FormData();form.append('file',file);const upload=await post('/files',form);attachmentId=upload.id;}await post('/leave',{type,startDate,endDate,reason,attachmentId});notify('Your leave request was sent for review.');setStart('');setEnd('');setReason('');setFile(null);await load();refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const withdraw=async(id)=>{if(!window.confirm('Withdraw this pending leave request?'))return;setWithdrawBusy(id);setError('');try{await del(`/leave/${id}`);notify('The pending request was withdrawn.');await load();refresh();}catch(e){setError(e.message);}finally{setWithdrawBusy(null);}};
  const balanceCards=[balances.find((b)=>b.type==='CASUAL'),balances.find((b)=>b.type==='EARNED'),balances.find((b)=>b.type==='FLOATING')].filter(Boolean);
  return <><PageTitle eyebrow="TIME TO REST & RESET" title="Leave & time off" description="Your balances, requests and time away—all in one place." action={<span className="policy-chip"><ShieldCheck size={14}/> Clear balances, no surprises</span>}/>
    {error&&<InlineError>{error}</InlineError>}
    <div className="leave-balance-grid">{loading?<Card className="balance-loading"><Spinner/></Card>:balanceCards.map((b,i)=><Card className={`leave-balance-tile leave-balance-${i}`} key={b.type}><div className="leave-tile-top"><span>{b.type==='CASUAL'?'Casual + sick':b.label}</span><span className="leave-tile-icon">{b.type==='CASUAL'?<Sun size={17}/>:b.type==='EARNED'?<BriefcaseBusiness size={17}/>:<Sparkles size={17}/>}</span></div><div className="leave-tile-value">{b.remaining}<small>days available</small></div><div className="leave-progress"><span style={{width:`${b.entitlement?Math.max(4,Math.min(100,(b.remaining/b.entitlement)*100)):0}%`}}/></div><div className="leave-tile-foot"><span>{b.used} used</span><span>{b.pending?`${b.pending} pending`:`${b.accrued} allocated`}</span></div><p className="leave-tile-note">{b.type==='CASUAL'?'Shared 8-day annual balance for casual and sick leave.':b.type==='EARNED'?'Accrues 1 day/month after probation, up to 15 days/year.':'For cultural, religious or personal days.'}</p></Card>)}</div>
    <div className="leave-layout"><Card className="leave-form-card"><CardHeading title="Request time off" subtitle="Share the dates and a little context."/><form className="form-stack leave-request-form" onSubmit={submit}>
      <label className="form-field"><span>Leave type</span><div className="select-wrap"><select value={type} onChange={(e)=>setType(e.target.value)}><option value="CASUAL">Casual leave · shared balance</option><option value="SICK">Sick leave · shared balance</option><option value="EARNED">Earned leave</option><option value="FLOATING">Floating leave</option></select><ChevronDown size={15}/></div></label>
      <div className="form-two"><label className="form-field"><span>First day</span><input type="date" value={startDate} min={today} onChange={(e)=>setStart(e.target.value)} required/></label><label className="form-field"><span>Last day</span><input type="date" value={endDate} min={startDate||today} onChange={(e)=>setEnd(e.target.value)} required/></label></div>
      <label className="form-field"><span>A short note</span><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="What would you like your approver to know?" minLength="8" maxLength="1000" required/></label>
      {requiresDoctorNote&&<div className="doc-required"><FileText size={16}/><span><b>Doctor’s note required</b><small>The policy asks for basic documentation for 3+ consecutive days.</small></span></div>}
      <label className="file-drop"><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e)=>{const next=e.target.files?.[0]||null;setError('');if(next&&next.size>10*1024*1024){setError('Attachments must be 10 MB or smaller.');setFile(null);return;}setFile(next);}}/><span className="file-drop-icon"><Plus size={17}/></span><span><b>{file?file.name:'Add an attachment'}</b><small>{type==='SICK'&&sickDays>=3?'PDF, JPG or PNG · Required':'PDF, JPG or PNG · up to 10 MB'}</small></span>{file?<button type="button" className="icon-button" onClick={(e)=>{e.preventDefault();e.stopPropagation();setFile(null);}} aria-label="Remove attachment"><X size={16}/></button>:<span className="file-optional">OPTIONAL</span>}</label>
      <div className="leave-form-note"><CircleHelp size={15}/><span>Working days are Monday–Saturday. Sundays and listed holidays aren’t deducted from your balance.</span></div>
      <Button type="submit" loading={busy} icon={Send}>Send leave request</Button>
    </form></Card>
      <div className="leave-side"><Card className="policy-card"><div className="policy-card-icon"><ShieldCheck size={18}/></div><h3>Time away is time gained.</h3><p>We encourage advance notice where you can, and understand that emergencies happen.</p><div className="policy-rule"><b>01</b><span><strong>Casual + sick</strong><small>Shared 8 days/year. No note for up to 2 consecutive sick days.</small></span></div><div className="policy-rule"><b>02</b><span><strong>Earned leave</strong><small>15 days/year entitlement; accrues 1 day/month after probation.</small></span></div><div className="policy-rule"><b>03</b><span><strong>Floating days</strong><small>4 days each calendar year for meaningful observances.</small></span></div></Card><Card className="leave-help-card"><span className="help-leaf"><Sun size={18}/></span><div><b>Plans change. That’s okay.</b><p>Pending requests can be withdrawn and sent again with new dates.</p></div></Card></div>
    </div>
    <div className="section-head"><div><h2>Your requests</h2><p>See what’s coming up and what’s been approved.</p></div><span className="history-count">{requests.length} {requests.length===1?'request':'requests'}</span></div><Card className="table-card"><div className="table-scroll"><table><thead><tr><th>LEAVE</th><th>DATES</th><th>DAYS</th><th>REQUESTED</th><th>STATUS</th><th></th></tr></thead><tbody>{loading?<tr><td colSpan="6" className="table-message"><Spinner/></td></tr>:requests.length?requests.map((r)=><tr key={r.id}><td><b>{({CASUAL:'Casual leave',SICK:'Sick leave',EARNED:'Earned leave',FLOATING:'Floating leave'})[r.leave_type]}</b>{r.attachment_name&&<small className="table-subline"><FileText size={12}/> {r.attachment_name}</small>}</td><td>{formatDate(r.start_date,{day:'numeric',month:'short'})}{r.start_date!==r.end_date?` – ${formatDate(r.end_date,{day:'numeric',month:'short'})}`:''}</td><td>{r.days}</td><td>{formatDate(String(r.created_at).slice(0,10),{day:'numeric',month:'short'})}</td><td><StatusPill value={r.status}/></td><td>{r.status==='PENDING'&&<button className="table-action" disabled={withdrawBusy===r.id||busy} onClick={()=>withdraw(r.id)}>{withdrawBusy===r.id?'Withdrawing…':'Withdraw'}</button>}{r.reviewer_note&&<span className="table-note" title={r.reviewer_note}><CircleHelp size={14}/></span>}</td></tr>):<tr><td colSpan="6"><div className="table-message">No leave requests yet. When you’re ready, your first request starts above.</div></td></tr>}</tbody></table></div></Card>
  </>;
}

function WfhPage(){
  const {notify,refresh}=useApp();const [data,setData]=useState({enabled:false,requests:[],monthlyCap:4});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [date,setDate]=useState('');const [kind,setKind]=useState('PLANNED');const [reason,setReason]=useState('');const [error,setError]=useState('');
  const load=async()=>{setLoading(true);try{setData(await get('/wfh'));}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{if(!date)throw new Error('Choose a remote-work date.');if(data.requests.some((r)=>r.request_date===date&&['PENDING','APPROVED'].includes(r.status)))throw new Error('You already have a pending or approved WFH request for that date.');if(kind==='EMERGENCY'&&date!==today)throw new Error('Unexpected WFH requests are for today.');if(kind==='PLANNED'){const target=new Date(`${date}T00:00:00+05:30`).getTime();if(target-Date.now()<24*60*60*1000)throw new Error('Planned WFH requests should be submitted at least 24 hours ahead.');}await post('/wfh',{date,kind,reason});notify('Your WFH request was sent for approval.');setDate('');setReason('');await load();refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const todayDate=today;
  return <><PageTitle eyebrow="FLEXIBILITY, WITH ALIGNMENT" title="Work from home" description="Occasional remote days are available by approval." action={<span className="policy-chip"><House size={14}/> No activity tracking</span>}/>
    {error&&<InlineError>{error}</InlineError>}
    <section className="wfh-banner"><div className="wfh-banner-icon"><House size={21}/></div><div><span className="hero-kicker">FLEXIBILITY IS BUILT ON TRUST</span><h2>{data.enabled?'A remote day, with a little planning.':'WFH isn’t enabled for your account yet.'}</h2><p>{data.enabled?`WFH is available for you by approval, typically up to ${data.monthlyCap} days per month.`:'Ask an administrator if your role should be included in the current WFH arrangement.'}</p></div><div className="wfh-banner-art"><div/><House size={42}/><span/></div></section>
    <div className="wfh-layout"><Card className="wfh-request-card"><CardHeading title="Request a remote day" subtitle="Your manager will review the date and context."/>{data.enabled?<form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Remote work date</span><input type="date" value={date} min={today} onChange={(e)=>setDate(e.target.value)} required/></label><div className="request-kind-toggle"><button type="button" className={kind==='PLANNED'?'kind-selected':''} onClick={()=>setKind('PLANNED')}><CalendarDays size={16}/><span><b>Planned</b><small>Ask at least 24 hours ahead</small></span></button><button type="button" className={kind==='EMERGENCY'?'kind-selected':''} onClick={()=>setKind('EMERGENCY')}><CircleAlert size={16}/><span><b>Unexpected</b><small>Same-day emergency request</small></span></button></div><label className="form-field"><span>Anything your manager should know?</span><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="A little context helps with team coordination." minLength="8" maxLength="1000" required/></label><div className="wfh-policy-note"><ShieldCheck size={15}/><span>Remote work follows the same 9 AM–6 PM schedule. Performance is measured through delivery, not online presence.</span></div><Button type="submit" loading={busy} icon={Send}>Request WFH approval</Button></form>:<div className="wfh-disabled"><LockIcon/><h3>Not enabled for this account</h3><p>WFH currently applies to one employee and can be configured by an administrator.</p></div>}</Card>
      <div className="wfh-side"><Card className="wfh-guidelines"><CardHeading title="Working remotely" subtitle="Simple expectations for a good day."/><div className="guideline-row"><span className="guideline-number">01</span><div><b>Keep your team aligned</b><p>Availability on Slack, email and calls during regular working hours.</p></div></div><div className="guideline-row"><span className="guideline-number">02</span><div><b>Protect company information</b><p>Use a private workspace and avoid unsecured public Wi-Fi.</p></div></div><div className="guideline-row"><span className="guideline-number">03</span><div><b>Trust over tracking</b><p>No spyware, screen recording, webcam watching or keyboard tracking.</p></div></div></Card><div className="wfh-quote">“We measure contribution through delivery, not online presence.”<small>REMOTE WORK POLICY</small></div></div></div>
    <div className="section-head"><div><h2>Your WFH requests</h2><p>Planned and emergency requests for this year.</p></div></div><Card className="table-card"><div className="table-scroll"><table><thead><tr><th>DATE</th><th>REQUEST TYPE</th><th>CONTEXT</th><th>STATUS</th><th>NOTE</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:data.requests?.length?data.requests.map((r)=><tr key={r.id}><td><b>{formatDate(r.request_date,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</b></td><td>{r.request_kind==='EMERGENCY'?'Emergency':'Planned'}</td><td className="reason-cell">{r.reason}</td><td><StatusPill value={r.status}/></td><td>{r.reviewer_note||'—'}</td></tr>):<tr><td colSpan="5"><div className="table-message">No WFH requests yet.</div></td></tr>}</tbody></table></div></Card>
  </>;
}
function LockIcon(){return <ShieldCheck size={25}/>;}

function OutPage(){
  const {notify}=useApp();const [exit,setExit]=useState(null);const [attendance,setAttendance]=useState(null);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const load=async()=>{try{const [x,a]=await Promise.all([get('/attendance/exits/current'),get(`/attendance?from=${today}&to=${today}`)]);setExit(x.exit);setAttendance(a.records?.[0]||null);}catch(e){setError(e.message);}};
  useEffect(()=>{load();},[]);
  const start=async()=>{setBusy(true);setError('');try{await post('/attendance/exits',{reason});setReason('');notify('Your temporary exit is recorded.');load();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const back=async()=>{setBusy(true);try{await patch(`/attendance/exits/${exit.id}/return`,{});notify('Welcome back. Your return is recorded.');load();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <><PageTitle eyebrow="A LIGHTWEIGHT RECORD" title="Out of office" description="Let your team know when you step out and when you’re back." action={<span className="policy-chip"><MapPin size={14}/> No location tracking</span>}/>{error&&<InlineError>{error}</InlineError>}
    <div className="out-layout"><Card className="out-main-card"><div className={`out-state-illustration${exit?' out-state-active':''}`}><div className="out-sun"><Sun size={25}/></div><div className="out-path path-one"/><div className="out-path path-two"/><div className="out-person"><span/><i/></div></div><div className="out-card-content"><span className={`out-state-label${exit?' is-out':''}`}><i className="pulse-dot"/>{exit?'CURRENTLY AWAY':'ON YOUR WORKDAY'}</span><h2>{exit?'We’ll see you back soon.':'Stepping out for a bit?'}</h2><p>{exit?`You stepped out at ${formatTime(exit.left_at)}. When you return, close this record so your day stays clear.`:'Record a short exit for appointments or errands. This does not pause attendance or collect your location.'}</p>{exit?<Button onClick={back} loading={busy} icon={Check}>I’m back</Button>:<><label className="form-field out-reason"><span>Optional note for your team</span><input type="text" maxLength="500" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="For example: appointment, lunch, quick errand"/></label><Button onClick={start} loading={busy} disabled={!attendance?.check_in_at||Boolean(attendance?.check_out_at)} icon={ArrowUpRight}>Record a temporary exit</Button>{!attendance?.check_in_at&&<small className="out-hint">Check in for today before creating an out record.</small>}</>}</div></Card>
      <Card className="out-explainer"><span className="side-card-icon"><ShieldCheck size={18}/></span><h3>A record, not a tracker.</h3><p>We keep just the time you left and returned. No continuous location checks, no background monitoring, and no effect on your attendance totals.</p><div className="exit-timeline">{exit?<><div className="exit-time-row"><i className="exit-timeline-dot dot-exit"/><span>Stepped out</span><b>{formatTime(exit.left_at)}</b></div><div className="exit-time-row"><i className="exit-timeline-dot dot-return"/><span>Return</span><b>Waiting for you</b></div></>:<><div className="exit-time-row"><i className="exit-timeline-dot dot-exit"/><span>Temporary exit</span><b>Not started</b></div><div className="exit-time-row"><i className="exit-timeline-dot dot-return"/><span>Return</span><b>Recorded when you’re back</b></div></>}</div></Card></div>
  </>;
}

function CalendarPage(){
  const {user}=useApp();const [month,setMonth]=useState(()=>{const p=today.split('-').map(Number);return new Date(p[0],p[1]-1,1);});const [holidays,setHolidays]=useState([]);const [loading,setLoading]=useState(false);const [addOpen,setAddOpen]=useState(false);const [error,setError]=useState('');const [created,setCreated]=useState(false);
  const year=month.getFullYear();const monthNo=month.getMonth();
  useEffect(()=>{setLoading(true);get(`/calendar?year=${year}`).then((r)=>setHolidays(r.holidays)).catch((e)=>setError(e.message)).finally(()=>setLoading(false));},[year]);
  const firstDay=new Date(year,monthNo,1).getDay();const days=new Date(year,monthNo+1,0).getDate();const total=Math.ceil((firstDay+days)/7)*7;const holidayMap=new Map(holidays.map((h)=>[h.date,h.name]));
  const prev=()=>setMonth(new Date(year,monthNo-1,1));const next=()=>setMonth(new Date(year,monthNo+1,1));
  const rows=Array.from({length:total},(_,i)=>{const day=i-firstDay+1;if(day<1||day>days)return null;const key=`${year}-${String(monthNo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return {day,key,holiday:holidayMap.get(key),isToday:key===today,isSunday:new Date(year,monthNo,day).getDay()===0};});
  return <><PageTitle eyebrow="PLAN AHEAD, LEAVE SPACE" title="Holiday calendar" description="National holidays and company observances for your year." action={user.role==='ADMIN'?<Button variant="soft" icon={Plus} onClick={()=>setAddOpen(true)}>Add holiday</Button>:null}/>{error&&<InlineError>{error}</InlineError>}
    {created&&<div className="inline-alert alert-success"><CircleCheck size={16}/> Holiday added to the company calendar.<button onClick={()=>setCreated(false)}><X size={15}/></button></div>}
    <div className="calendar-layout"><Card className="calendar-card"><div className="calendar-toolbar"><div><div className="calendar-eyebrow">FALCHION XENIAA · PUNE</div><h2>{new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(month)}</h2></div><div className="calendar-controls"><button className="icon-button" onClick={prev} aria-label="Previous month"><ChevronLeft size={19}/></button><button className="button button-soft button-small" onClick={()=>setMonth(new Date(Number(today.slice(0,4)),Number(today.slice(5,7))-1,1))}>Today</button><button className="icon-button" onClick={next} aria-label="Next month"><ChevronRight size={19}/></button></div></div><div className="calendar-weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d)=><span key={d}>{d}</span>)}</div><div className="calendar-grid">{rows.map((cell,i)=>cell?<div key={cell.key} className={`calendar-day${cell.isToday?' calendar-today':''}${cell.holiday?' calendar-holiday':''}${cell.isSunday?' calendar-sunday':''}`}><b>{cell.day}</b>{cell.holiday&&<small title={cell.holiday}>{cell.holiday}</small>}</div>:<div className="calendar-day calendar-day-empty" key={`empty-${i}`}/>)}</div><div className="calendar-legend"><span><i className="legend-dot legend-holiday"/> Holiday</span><span><i className="legend-dot legend-done"/> Today</span><span>Working days: Monday – Saturday</span></div></Card>
      <div className="calendar-side"><Card className="holidays-card"><CardHeading title={`Holidays in ${year}`} subtitle="Company-wide dates to remember." action={<span className="holiday-count">{holidays.filter((h)=>h.date.startsWith(String(year))).length}</span>}/>{loading?<div className="table-message"><Spinner/></div>:holidays.filter((h)=>h.date.startsWith(String(year))).length?holidays.filter((h)=>h.date.startsWith(String(year))).map((h)=><div className="holiday-row" key={h.date}><div className="holiday-date"><b>{formatDate(h.date,{day:'2-digit'})}</b><small>{formatDate(h.date,{month:'short'}).toUpperCase()}</small></div><div><b>{h.name}</b><small>{formatDate(h.date,{weekday:'long'})}</small></div><span className="holiday-pin"><Sun size={15}/></span></div>):<EmptyState icon={CalendarDays} title="No holidays found" body="Company holidays will show here once they’re added."/>}</Card><div className="calendar-note"><span><ShieldCheck size={17}/></span><div><b>How leave days are counted</b><p>Sundays and holidays are excluded from leave balance calculations. Saturday is a working day.</p></div></div></div></div>
    {addOpen&&<AddHolidayModal close={()=>setAddOpen(false)} onDone={()=>{setAddOpen(false);setCreated(true);get(`/calendar?year=${year}`).then((r)=>setHolidays(r.holidays));}}/>}
  </>;
}
function AddHolidayModal({close,onDone}){const [date,setDate]=useState('');const [name,setName]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/calendar',{date,name});onDone();}catch(e){setError(e.message);}finally{setBusy(false);}};return <Modal title="Add a company holiday" subtitle="This date will be excluded from working-day leave calculations." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<label className="form-field"><span>Date</span><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} required/></label><label className="form-field"><span>Holiday name</span><input value={name} maxLength="160" onChange={(e)=>setName(e.target.value)} placeholder="For example: Diwali" required/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Add holiday</Button></div></form></Modal>;}

function NotificationsPage(){
  const {notifications,refreshNotifications,notify}=useApp();
  const [items,setItems]=useState([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [busyId,setBusyId]=useState(null);const [filter,setFilter]=useState('ALL');
  const load=async()=>{setLoading(true);try{const data=await get('/account/notifications');setItems(data.notifications||[]);refreshNotifications();}catch(e){notify(e.message,'error');}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const mark=async(id)=>{setBusyId(id);try{await post(`/account/notifications/${id}/read`);setItems(all=>all.map(item=>item.id===id?{...item,read_at:new Date().toISOString()}:item));refreshNotifications();}catch(e){notify(e.message,'error');}finally{setBusyId(null);}};
  const markAll=async()=>{setBusy(true);try{await post('/account/notifications/read-all');setItems(all=>all.map(item=>({...item,read_at:item.read_at||new Date().toISOString()})));refreshNotifications();notify('All notifications marked as read.');}catch(e){notify(e.message,'error');}finally{setBusy(false);}};
  const visible=filter==='UNREAD'?items.filter(item=>!item.read_at):items;
  return <><PageTitle eyebrow="STAY IN THE LOOP" title="Notifications" description="Approvals, attendance updates and other useful workplace messages." action={<Button variant="soft" icon={CheckCheck} onClick={markAll} disabled={!notifications.unread||busy} loading={busy}>Mark all read</Button>}/>
    <div className="notification-page-summary"><Card><span><Bell size={17}/></span><div><b>{notifications.unread}</b><small>Unread</small></div></Card><Card><span><CheckCheck size={17}/></span><div><b>{items.length}</b><small>Recent messages</small></div></Card><Card><span><ShieldCheck size={17}/></span><div><b>Private</b><small>Only visible to you</small></div></Card></div>
    <div className="notification-page-toolbar"><div className="approval-tabs"><button className={filter==='ALL'?'approval-tab-active':''} onClick={()=>setFilter('ALL')}>All</button><button className={filter==='UNREAD'?'approval-tab-active':''} onClick={()=>setFilter('UNREAD')}>Unread {notifications.unread?`(${notifications.unread})`:''}</button></div><button className="text-button" onClick={load} disabled={loading}>Refresh</button></div>
    <Card className="notification-page-card">{loading?<div className="table-message"><Spinner/></div>:visible.length?<div className="notification-page-list">{visible.map(item=><button type="button" key={item.id} className={`notification-page-item${item.read_at?'':' notification-page-item-unread'}`} onClick={()=>!item.read_at&&mark(item.id)} disabled={busyId===item.id}><span className="notification-page-icon"><Bell size={16}/></span><span className="notification-page-copy"><b>{item.title}</b><small>{item.body}</small><em>{formatDate(String(item.created_at).slice(0,10),{weekday:'short',day:'numeric',month:'short'})} · {formatTime(item.created_at)}</em></span><span className="notification-page-state">{item.read_at?'Read':'Unread'}</span></button>)}</div>:<EmptyState icon={Bell} title={filter==='UNREAD'?'You have no unread notifications.':'No notifications yet.'} body="New approvals and workplace updates will appear here."/>}</Card>
  </>;
}
function ProfilePage(){
  const {user,setUser,notify}=useApp();const [profile,setProfile]=useState(user);const [phone,setPhone]=useState(user.phone||'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{get('/account/profile').then((r)=>{setProfile(r.profile);setPhone(r.profile.phone||'');}).catch((e)=>setError(e.message));},[]);
  const save=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await patch('/account/profile',{phone:phone||null});const updated={...profile,phone:phone||null};setProfile(updated);setUser(updated);notify('Your profile details are up to date.');}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <><PageTitle eyebrow="YOUR DETAILS, YOURS TO UPDATE" title="My profile" description="A little about you and your place at Falchion Xeniaa."/>{error&&<InlineError>{error}</InlineError>}
    <div className="profile-layout"><Card className="profile-card"><div className="profile-cover"><div className="profile-avatar-large">{initials(profile.full_name)}</div><div className="profile-cover-art"><span/><span/><span/></div></div><div className="profile-main"><div className="profile-name-row"><div><h2>{profile.full_name}</h2><p>{profile.title} <span>·</span> {profile.user_type==='INTERN'?'Intern':'Employee'}</p></div><StatusPill value={profile.status}/></div><div className="profile-divider"/><div className="profile-details-grid"><div><span>Employee ID</span><b>{profile.employee_code}</b></div><div><span>Email</span><b>{profile.email}</b></div><div><span>Joined</span><b>{formatDate(profile.joined_on)}</b></div><div><span>Reports to</span><b>{profile.manager||'Falchion Xeniaa administrator'}</b></div></div></div></Card>
      <Card className="profile-edit-card"><CardHeading title="Contact details" subtitle="Keep your team’s information up to date."/><form className="form-stack" onSubmit={save}><label className="form-field"><span>Full name</span><input value={profile.full_name} disabled/></label><label className="form-field"><span>Work email</span><input value={profile.email} disabled/></label><label className="form-field"><span>Phone number</span><input type="tel" value={phone} maxLength="32" onChange={(e)=>setPhone(e.target.value)} placeholder="Add a contact number"/></label><div className="profile-security"><ShieldCheck size={15}/><span>Google Sign-In keeps your account secure. An administrator manages your work email and role.</span></div><Button type="submit" loading={busy}>Save contact details</Button></form></Card></div>
    <Card className="privacy-card"><div className="privacy-icon"><ShieldCheck size={18}/></div><div><b>Trust is part of how we work.</b><p>Falchion Xeniaa does not use spyware, screen recording, webcam watching or keyboard tracking. Your location is requested only when you choose a GPS attendance action.</p></div></Card>
  </>;
}

function TeamPage(){
  const {notify}=useApp();const [people,setPeople]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [busyId,setBusyId]=useState(null);const [search,setSearch]=useState('');const [addOpen,setAddOpen]=useState(false);const [filter,setFilter]=useState('ALL');
  const load=async()=>{setLoading(true);try{const r=await get('/admin/users');setPeople(r.users);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const update=async(person,changes)=>{if(changes.status==='INACTIVE'&&!window.confirm(`Deactivate ${person.full_name}'s account? They will no longer be able to sign in.`))return;setBusyId(person.id);setError('');try{await patch(`/admin/users/${person.id}`,changes);notify(`${person.full_name}’s profile was updated.`);await load();}catch(e){setError(e.message);}finally{setBusyId(null);}};
  const filtered=people.filter((p)=>`${p.full_name} ${p.employee_code} ${p.email}`.toLowerCase().includes(search.toLowerCase())&&(filter==='ALL'||(filter==='ACTIVE'?p.status==='ACTIVE':p.status==='INACTIVE')));
  return <><PageTitle eyebrow="A PEOPLE-FIRST WORKPLACE" title="People" description="Manage the people who make Falchion Xeniaa work." action={<Button icon={Plus} onClick={()=>setAddOpen(true)}>Add a person</Button>}/>{error&&<InlineError>{error}</InlineError>}
    <div className="team-summary"><div><span className="team-summary-icon"><Users size={18}/></span><div><b>{people.filter((p)=>p.role==='EMPLOYEE'&&p.status==='ACTIVE').length} team members</b><small>Employees and interns · no departments in V1</small></div></div><div className="team-summary-right"><span className="active-indicator"><i/> {people.filter((p)=>p.status==='ACTIVE').length} active</span><span>{people.filter((p)=>p.wfh_enabled).length} with WFH access</span></div></div>
    <Card className="people-table-card"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search people" aria-label="Search people"/></div><div className="toolbar-right"><div className="select-wrap select-small"><select value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="ALL">All people</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select><ChevronDown size={14}/></div><button className="button button-soft button-small" onClick={load}><RefreshCw size={14}/> Refresh</button></div></div><div className="table-scroll"><table><thead><tr><th>PERSON</th><th>ROLE</th><th>EMAIL</th><th>WFH</th><th>LATE · 30D</th><th>STATUS</th><th></th></tr></thead><tbody>{loading?<tr><td colSpan="7" className="table-message"><Spinner/></td></tr>:filtered.length?filtered.map((p)=><tr key={p.id}><td><div className="person-cell"><span className={`avatar avatar-table ${p.role==='ADMIN'?'avatar-admin':''}`}>{initials(p.full_name)}</span><span><b>{p.full_name}</b><small>{p.employee_code} · {p.title}</small></span></div></td><td><span className={`role-chip${p.role==='ADMIN'?' role-admin':''}`}>{p.role==='ADMIN'?'Administrator':p.user_type==='INTERN'?'Intern':'Employee'}</span></td><td className="email-cell">{p.email}</td><td><button className={`toggle${p.wfh_enabled?' toggle-on':''}`} role="switch" aria-checked={p.wfh_enabled} aria-label={`${p.wfh_enabled?'Disable':'Enable'} WFH for ${p.full_name}`} onClick={()=>update(p,{wfhEnabled:!p.wfh_enabled})} disabled={busyId===p.id}><i/></button></td><td><span className={Number(p.late_count)>2?'late-count-warning':'late-count'}>{p.late_count||0}</span></td><td><StatusPill value={p.status}/></td><td><button className="text-button" onClick={()=>update(p,{status:p.status==='ACTIVE'?'INACTIVE':'ACTIVE'})} disabled={busyId===p.id}>{busyId===p.id?'Updating…':p.status==='ACTIVE'?'Deactivate':'Reactivate'}</button></td></tr>):<tr><td colSpan="7"><div className="table-message">No people match your search.</div></td></tr>}</tbody></table></div><div className="table-bottom"><span>Showing {filtered.length} of {people.length} people</span><span>Google access is granted only to pre-authorized email addresses.</span></div></Card>
    <div className="team-notice"><ShieldCheck size={16}/><span>Accounts do not have passwords stored here. Add the employee’s Google email, then the employee can sign in with Google.</span></div>
    {addOpen&&<AddPersonModal close={()=>setAddOpen(false)} onDone={()=>{setAddOpen(false);notify('The new account is ready for Google sign-in.');load();}}/>}
  </>;
}
function AddPersonModal({close,onDone}){const [values,setValues]=useState({employeeCode:'',fullName:'',email:'',userType:'EMPLOYEE',title:'',phone:'',joinedOn:today,wfhEnabled:false,probationEndDate:''});const [error,setError]=useState('');const [busy,setBusy]=useState(false);const set=(key,value)=>setValues((v)=>({...v,[key]:value}));const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await post('/admin/users',{...values,probationEndDate:values.probationEndDate||null});onDone();}catch(e){setError(e.message);}finally{setBusy(false);}};return <Modal title="Add someone to the team" subtitle="Their email will be authorized for Google Sign-In." close={close}><form className="form-stack" onSubmit={submit}>{error&&<InlineError>{error}</InlineError>}<div className="form-two"><label className="form-field"><span>Employee ID</span><input value={values.employeeCode} maxLength="24" onChange={(e)=>set('employeeCode',e.target.value)} placeholder="FX-0012" required/></label><label className="form-field"><span>Employee type</span><div className="select-wrap"><select value={values.userType} onChange={(e)=>set('userType',e.target.value)}><option value="EMPLOYEE">Employee</option><option value="INTERN">Intern</option><option value="ADMIN">Administrator</option></select><ChevronDown size={14}/></div></label></div><label className="form-field"><span>Full name</span><input value={values.fullName} maxLength="120" onChange={(e)=>set('fullName',e.target.value)} required/></label><label className="form-field"><span>Google account email</span><input type="email" value={values.email} maxLength="254" onChange={(e)=>set('email',e.target.value)} placeholder="name@example.com" required/></label><label className="form-field"><span>Job title</span><input value={values.title} maxLength="120" onChange={(e)=>set('title',e.target.value)} placeholder="For example: Product designer"/></label><div className="form-two"><label className="form-field"><span>Joined on</span><input type="date" value={values.joinedOn} onChange={(e)=>set('joinedOn',e.target.value)} required/></label><label className="form-field"><span>Probation ends</span><input type="date" value={values.probationEndDate} onChange={(e)=>set('probationEndDate',e.target.value)}/></label></div><label className="checkbox-line"><input type="checkbox" checked={values.wfhEnabled} onChange={(e)=>set('wfhEnabled',e.target.checked)}/><span>Enable WFH request access</span></label><div className="form-modal-actions"><Button type="button" variant="soft" onClick={close}>Cancel</Button><Button type="submit" loading={busy} icon={Plus}>Create account</Button></div></form></Modal>;}

function AdminAttendancePage(){
  const [from,setFrom]=useState(today);const [to,setTo]=useState(today);const [rows,setRows]=useState([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const load=async()=>{setLoading(true);setError('');try{if(from>to)throw new Error('The start date must be on or before the end date.');const data=await get(`/admin/attendance?from=${from}&to=${to}`);setRows(data.records);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  return <><PageTitle eyebrow="ATTENDANCE, WITH CONTEXT" title="Attendance" description="Check-ins, check-outs and their one-time verification record." action={<Button variant="soft" icon={RefreshCw} onClick={load}>Refresh records</Button>}/>{error&&<InlineError>{error}</InlineError>}
    <Card className="admin-attendance-card"><div className="filter-toolbar"><div className="filter-date"><CalendarDays size={16}/><label><span>FROM</span><input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/></label><ArrowRight size={14}/><label><span>TO</span><input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/></label></div><Button size="small" onClick={load} icon={Filter}>Apply filters</Button></div><div className="table-scroll"><table><thead><tr><th>PERSON</th><th>DATE</th><th>CHECK IN</th><th>CHECK OUT</th><th>VERIFY</th><th>LOCATION CHECK</th><th>STATUS</th><th>EXIT RECORDS</th></tr></thead><tbody>{loading?<tr><td colSpan="8" className="table-message"><Spinner/></td></tr>:rows.length?rows.map((r)=><tr key={r.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(r.full_name)}</span><span><b>{r.full_name}</b><small>{r.employee_code} · {r.user_type==='INTERN'?'Intern':'Employee'}</small></span></div></td><td>{formatDate(r.attendance_date,{day:'numeric',month:'short'})}</td><td>{formatTime(r.check_in_at)}</td><td>{formatTime(r.check_out_at)}</td><td><span className="verify-tag"><i/>{r.check_in_method||'—'}</span></td><td>{r.check_in_distance_m==null?'—':<span className="location-audit"><MapPin size={13}/>{Math.round(r.check_in_distance_m)} m<small>±{Math.round(r.check_in_accuracy_m||0)} m</small></span>}</td><td><StatusPill value={r.status}/>{r.correction_pending&&<span className="correction-mark">Correction</span>}</td><td>{r.exit_count||0}</td></tr>):<tr><td colSpan="8"><div className="table-message">No attendance records in this date range.</div></td></tr>}</tbody></table></div><div className="admin-attendance-foot"><span><ShieldCheck size={14}/> GPS coordinates are stored only when the employee checks in or out.</span><Link to="/approvals" className="text-link">Review corrections <ArrowRight size={14}/></Link></div></Card>
    <div className="attendance-audit-note"><div className="audit-note-icon"><Fingerprint size={18}/></div><div><b>What the location record means</b><p>For a GPS check-in, the system stores a one-time latitude/longitude, reported accuracy and distance from the office so the attendance decision can be reviewed. WFH check-ins do not create office location records.</p></div></div>
  </>;
}

function ApprovalsPage(){
  const {notify}=useApp();const [items,setItems]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [filter,setFilter]=useState('ALL');const [reviewing,setReviewing]=useState(null);const [busy,setBusy]=useState(false);
  const load=async()=>{setLoading(true);try{const r=await get('/admin/approvals');setItems(r.approvals);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const visible=items.filter((x)=>filter==='ALL'||x.type.toUpperCase()===filter);
  const review=async(item,decision,note)=>{setBusy(true);setError('');try{await post(`/admin/approvals/${item.type}/${item.id}`,{decision,note});notify(`${item.full_name}’s ${item.type} request was ${decision==='APPROVED'?'approved':'declined'}.`);setReviewing(null);await load();refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <><PageTitle eyebrow="YOUR REVIEW MAKES A DIFFERENCE" title="Requests" description="A thoughtful review helps people plan their work and their time away." action={<button className="button button-soft" onClick={load}><RefreshCw size={15}/> Refresh</button>}/>{error&&<InlineError>{error}</InlineError>}
    <div className="approval-overview"><span className="approval-overview-icon"><ClipboardCheck size={19}/></span><div><b>{items.length?`${items.length} request${items.length===1?'':'s'} awaiting review`:'No requests need your attention'}</b><small>{items.length?'Leave, WFH, attendance correction and flexible starts.':''}</small></div><div className="approval-tabs">{[['ALL','All'],['LEAVE','Leave'],['WFH','WFH'],['CORRECTION','Attendance'],['FLEX','Flex start']].map(([key,label])=><button className={filter===key?'approval-tab-active':''} onClick={()=>setFilter(key)} key={key}>{label}</button>)}</div></div>
    {loading?<div className="approval-skeleton"><Spinner/></div>:visible.length?<div className="approval-list">{visible.map((item)=><ApprovalCard key={`${item.type}-${item.id}`} item={item} onReview={(decision)=>setReviewing({item,decision})}/>)}</div>:<Card className="approval-empty"><EmptyState icon={CheckCheck} title={filter==='ALL'?'You’re all caught up.':'Nothing in this queue.'} body={filter==='ALL'?'Every request has been reviewed. Your team will see you when something needs attention.':'Try another request type filter.'}/></Card>}
    {reviewing&&<ReviewModal item={reviewing.item} initialDecision={reviewing.decision} busy={busy} close={()=>setReviewing(null)} onReview={(decision,note)=>review(reviewing.item,decision,note)}/>}
  </>;
}
function ApprovalCard({item,onReview}){
  const icon=item.type==='leave'?CalendarDays:item.type==='wfh'?House:item.type==='flex'?Timer:Clock3;const Icon=icon;
  const [downloading,setDownloading]=useState(false);
  const attachment=async()=>{if(!item.attachment_id)return;setDownloading(true);try{const response=await get(`/files/${item.attachment_id}`);const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=item.attachment_name||'leave-document';document.body.appendChild(a);a.click();a.remove();globalThis.setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notify(e.message,'error');}finally{setDownloading(false);}};
  return <Card className="approval-request"><div className="approval-request-icon"><Icon size={19}/></div><div className="approval-request-main"><div className="approval-request-top"><span className="approval-category">{item.category}</span><span className="approval-request-date">Received {formatDate(String(item.created_at).slice(0,10),{day:'numeric',month:'short'})}</span></div><h3>{item.full_name}<small>{item.employee_code}</small></h3><div className="approval-request-meta">{item.date&&<span><Calendar size={14}/>{formatDate(item.date,{day:'numeric',month:'short',year:'numeric'})}{item.end_date&&item.end_date!==item.date?` – ${formatDate(item.end_date,{day:'numeric',month:'short'})}`:''}</span>}{item.days!=null&&<span><Timer size={14}/>{item.days} day{Number(item.days)===1?'':'s'}</span>}</div><p className="approval-reason">{item.reason}</p>{item.attachment_name&&<button className="attachment-link" onClick={attachment} disabled={downloading}><FileText size={14}/>{downloading?'Opening…':item.attachment_name}<Download size={13}/></button>}</div><div className="approval-actions"><button className="button button-soft button-small" onClick={()=>onReview('REJECTED')}>Decline</button><button className="button button-primary button-small" onClick={()=>onReview('APPROVED')}><Check size={15}/> Approve</button></div></Card>;
}
function ReviewModal({item,initialDecision,busy,close,onReview}){const [note,setNote]=useState('');const [decision,setDecision]=useState(initialDecision||'APPROVED');return <Modal title={`${decision==='APPROVED'?'Approve':'Decline'} this request?`} subtitle={`${item.full_name} · ${item.category}`} close={close}><div className="review-summary"><span className="review-summary-icon">{item.type==='wfh'?<House size={17}/>:item.type==='flex'?<Timer size={17}/>:item.type==='correction'?<Clock3 size={17}/>:<CalendarDays size={17}/>}</span><div><b>{item.date?formatDate(item.date,{weekday:'short',day:'numeric',month:'long',year:'numeric'}):'Attendance correction'}</b><p>{item.reason}</p></div></div><label className="form-field"><span>Note for the employee <small>(optional)</small></span><textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder={decision==='APPROVED'?'Add helpful context if you like.':'A short explanation will help them understand.'} maxLength="1000"/></label><div className="form-modal-actions"><Button variant="soft" type="button" onClick={close}>Cancel</Button><Button variant={decision==='APPROVED'?'primary':'danger'} loading={busy} onClick={()=>onReview(decision,note)}>{decision==='APPROVED'?'Confirm approval':'Confirm decline'}</Button></div><div className="decision-toggle"><button className={decision==='APPROVED'?'decision-current':''} onClick={()=>setDecision('APPROVED')}><Check size={14}/> Approve</button><button className={decision==='REJECTED'?'decision-current decision-no':''} onClick={()=>setDecision('REJECTED')}><X size={14}/> Decline</button></div></Modal>;}

function ReportsPage(){
  const monthStart=`${today.slice(0,7)}-01`;const [from,setFrom]=useState(monthStart);const [to,setTo]=useState(today);const [rows,setRows]=useState([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [exporting,setExporting]=useState(false);
  const load=async()=>{setLoading(true);setError('');try{const r=await get(`/admin/attendance?from=${from}&to=${to}`);setRows(r.records);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const download=async()=>{setExporting(true);setError('');try{if(from>to)throw new Error('The start date must be on or before the end date.');const blob=await get(`/admin/reports.csv?from=${from}&to=${to}`);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`falchion-attendance-${from}-${to}.csv`;a.click();URL.revokeObjectURL(url);}catch(e){setError(e.message);}finally{setExporting(false);}};
  const onTime=rows.filter((r)=>r.status==='ON_TIME').length;const late=rows.filter((r)=>r.status==='LATE_ENTRY').length;
  return <><PageTitle eyebrow="CLEAR RECORDS, USEFUL CONTEXT" title="Reports" description="Review attendance for a date range and export a spreadsheet-ready file." action={<Button icon={Download} onClick={download} loading={exporting}>Export CSV</Button>}/>{error&&<InlineError>{error}</InlineError>}
    <Card className="report-filter-card"><div className="report-filter-copy"><span className="report-filter-icon"><Activity size={18}/></span><div><b>Attendance report</b><small>One row per attendance day · private to administrators</small></div></div><div className="report-filter-controls"><label><span>FROM</span><input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/></label><ArrowRight size={15}/><label><span>TO</span><input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/></label><Button size="small" variant="soft" icon={Filter} onClick={load}>Apply</Button></div></Card>
    <div className="report-metrics"><Card><span className="report-metric-icon metric-blue"><FileText size={17}/></span><small>ATTENDANCE DAYS</small><b>{loading?'—':rows.length}</b></Card><Card><span className="report-metric-icon metric-green"><Check size={17}/></span><small>ON TIME</small><b>{loading?'—':onTime}</b></Card><Card><span className="report-metric-icon metric-rose"><Clock3 size={17}/></span><small>LATE ENTRIES</small><b>{loading?'—':late}</b></Card><Card><span className="report-metric-icon metric-gold"><Timer size={17}/></span><small>OPEN DAYS</small><b>{loading?'—':rows.filter((r)=>!r.check_out_at).length}</b></Card></div>
    <div className="section-head"><div><h2>Report preview</h2><p>{from} — {to} · Fixed 30-minute lunch deducted from completed shifts.</p></div><Link className="text-link" to="/admin-attendance">Open attendance management <ArrowRight size={15}/></Link></div><Card className="table-card"><div className="table-scroll"><table><thead><tr><th>PERSON</th><th>DATE</th><th>CHECK IN</th><th>CHECK OUT</th><th>WORKED</th><th>STATUS</th></tr></thead><tbody>{loading?<tr><td colSpan="6" className="table-message"><Spinner/></td></tr>:rows.length?rows.slice(0,20).map((r)=><tr key={r.id}><td><div className="person-cell"><span className="avatar avatar-table">{initials(r.full_name)}</span><span><b>{r.full_name}</b><small>{r.employee_code}</small></span></div></td><td>{formatDate(r.attendance_date,{day:'numeric',month:'short',year:'2-digit'})}</td><td>{formatTime(r.check_in_at)}</td><td>{formatTime(r.check_out_at)}</td><td>{r.check_out_at?formatMinutes(Math.max(0,Math.round((new Date(r.check_out_at)-new Date(r.check_in_at))/60000)-30)):'In progress'}</td><td><StatusPill value={r.status}/></td></tr>):<tr><td colSpan="6"><div className="table-message">No records in this report range.</div></td></tr>}</tbody></table></div>{rows.length>20&&<div className="table-bottom">Showing the latest 20 of {rows.length} records. The CSV includes every record in the selected range.</div>}</Card>
    <div className="report-privacy"><ShieldCheck size={16}/><span>Exports contain check-in method, office-distance and accuracy fields for audit review. They never contain background or continuous location data.</span></div>
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

  const load=async()=>{
    setLoading(true);
    setHealthLoading(true);
    setHealthError('');
    try{
      const [r,h]=await Promise.all([get('/admin/settings'),get('/admin/system-health')]);
      setForm({
        office_name:r.settings.office_name,
        office_latitude:r.settings.office_latitude,
        office_longitude:r.settings.office_longitude,
        geofence_meters:r.settings.geofence_meters,
        gps_max_accuracy_meters:r.settings.gps_max_accuracy_meters,
        wfh_monthly_cap:r.settings.wfh_monthly_cap
      });
      setHealth(h);
    }catch(e){
      setHealthError(e.message);
      try{
        const r=await get('/admin/settings');
        setForm({
          office_name:r.settings.office_name,
          office_latitude:r.settings.office_latitude,
          office_longitude:r.settings.office_longitude,
          geofence_meters:r.settings.geofence_meters,
          gps_max_accuracy_meters:r.settings.gps_max_accuracy_meters,
          wfh_monthly_cap:r.settings.wfh_monthly_cap
        });
      }catch(inner){setError(inner.message);}
    }finally{
      setLoading(false);
      setHealthLoading(false);
    }
  };

  useEffect(()=>{load();},[]);

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
      load();
    }catch(e){setError(e.message);}
    finally{setBusy(false);}
  };

  const set=(key,value)=>setForm((f)=>({...f,[key]:value}));
  const network=health?.officeNetwork;

  return <>
    <PageTitle eyebrow="ONE OFFICE · CLEAR RULES" title="Office settings" description="Manage Pune HQ verification and the current WFH limit." action={<button className="button button-soft" onClick={load}><RefreshCw size={15}/> Refresh</button>}/>
    {error&&<InlineError>{error}</InlineError>}
    {loading?<Card className="settings-loading"><Spinner/></Card>:<div className="settings-layout">
      <div className="settings-main">
        <Card className="settings-card">
          <CardHeading title="Pune HQ attendance" subtitle="Office attendance requires a one-time location check and the configured office network."/>
          <form className="form-stack" onSubmit={save}>
            <label className="form-field"><span>Office name</span><input value={form.office_name||''} maxLength="120" onChange={(e)=>set('office_name',e.target.value)} required/></label>
            <div className="form-two"><label className="form-field"><span>Latitude</span><input type="number" step="0.000001" min="-90" max="90" value={form.office_latitude??''} onChange={(e)=>set('office_latitude',e.target.value)} required/></label><label className="form-field"><span>Longitude</span><input type="number" step="0.000001" min="-180" max="180" value={form.office_longitude??''} onChange={(e)=>set('office_longitude',e.target.value)} required/></label></div>
            <div className="form-two"><label className="form-field"><span>Geofence radius <small>(metres)</small></span><input type="number" min="20" max="1000" value={form.geofence_meters??''} onChange={(e)=>set('geofence_meters',e.target.value)} required/></label><label className="form-field"><span>Maximum GPS accuracy <small>(metres)</small></span><input type="number" min="20" max="250" value={form.gps_max_accuracy_meters??''} onChange={(e)=>set('gps_max_accuracy_meters',e.target.value)} required/></label></div>
            <div className="locked-policy"><span><Clock3 size={16}/></span><div><b>Attendance rules</b><small>9:00 AM–6:00 PM · Monday–Saturday · late at 9:30 AM · fixed 30-minute lunch</small></div><span className="locked-badge"><ShieldCheck size={12}/> CURRENT POLICY</span></div>
            <Button type="submit" loading={busy}>Save office settings</Button>
          </form>
        </Card>

        <Card className="settings-card">
          <CardHeading title="Office network verification" subtitle="The API verifies the network used for every GPS check-in and check-out."/>
          {healthLoading?<div className="settings-loading"><Spinner/></div>:network?<div className="settings-health-grid">
            <div><small>Configuration</small><b>{network.configured?'Ready':'Not configured'}</b></div>
            <div><small>This request</small><b>{network.matchedCurrentRequest?'Office network':'Outside office network'}</b></div>
            <div><small>Observed IP</small><b>{network.currentClientIp||'—'}</b></div>
            <div><small>Allowed IPs</small><b>{network.configuredIpCount}</b></div>
            <div><small>Attendance gate</small><b>{network.configured?'Location + Wi-Fi':'Configuration required'}</b></div>
            <div><small>Tracking</small><b>One-time check only</b></div>
          </div>:<InlineError>{healthError || 'Network verification status is unavailable.'}</InlineError>}
          <div className="privacy-promise"><ShieldCheck size={16}/><span>The browser does not need to know the Wi-Fi name. The server verifies the office network identity when the attendance request arrives.</span></div>
        </Card>

        <Card className="settings-card">
          <CardHeading title="System health" subtitle="Runtime and database diagnostics for administrators." action={<span className="live-tag"><i/> OPERATIONAL VIEW</span>}/>
          {healthLoading?<div className="settings-loading"><Spinner/></div>:health?<div className="settings-health-grid">
            <div><small>API status</small><b>{health.status === 'ok' ? 'Operational' : 'Unavailable'}</b></div><div><small>Database</small><b>{health.mysqlVersion || 'Connected'}</b></div><div><small>DB latency</small><b>{health.databaseLatencyMs} ms</b></div><div><small>Runtime</small><b>{health.nodeVersion}</b></div><div><small>Release</small><b>{health.version}</b></div><div><small>Build</small><b>{String(health.build).slice(0,12)}</b></div>
          </div>:<InlineError>{healthError || 'System health is unavailable.'}</InlineError>}
        </Card>

        <Card className="settings-card">
          <CardHeading title="Remote work" subtitle="The usual guideline is up to 4 days per month, with manager approval."/>
          <div className="wfh-cap-row"><div className="wfh-cap-icon"><House size={18}/></div><div><b>Typical monthly limit</b><small>Only employees with WFH enabled can request a day.</small></div><div className="cap-input"><input type="number" min="1" max="15" value={form.wfh_monthly_cap??4} onChange={(e)=>set('wfh_monthly_cap',e.target.value)}/><span>days / month</span></div></div>
          <div className="privacy-promise"><ShieldCheck size={16}/><span>No spyware, screen recording, webcam watching or keyboard tracking. WFH is trust-based; performance is measured through delivery.</span></div>
        </Card>
      </div>
      <div className="settings-side">
        <Card className="office-map-card"><div className="map-drawing"><div className="map-grid-lines"/><div className="map-ring map-ring-one"/><div className="map-ring map-ring-two"/><span className="map-pin"><MapPin size={20} fill="currentColor"/></span><span className="map-label">PUNE HQ</span></div><div className="map-caption"><span className="office-live"><i/> OFFICE GEOGRAPHY</span><b>{form.office_name}</b><small>{Number(form.office_latitude).toFixed(6)}° N · {Number(form.office_longitude).toFixed(6)}° E</small><span className="radius-label"><i/> {form.geofence_meters} m geofence</span></div></Card>
        <Card className="settings-note"><span className="note-shield"><ShieldCheck size={18}/></span><h3>Respect is built in.</h3><p>Location is sampled only for an attendance action and stored as a verification record. The app has no background location or continuous tracking.</p><Link className="text-link" to="/admin-attendance">Review the attendance data <ArrowRight size={14}/></Link></Card>
      </div>
    </div>}
  </>;
}

function AuditPage(){
  const [logs,setLogs]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  useEffect(()=>{get('/admin/audit').then((r)=>setLogs(r.logs)).catch((e)=>setError(e.message)).finally(()=>setLoading(false));},[]);
  return <><PageTitle eyebrow="A CLEAR ACCOUNT OF CHANGES" title="Audit trail" description="Administrator actions and attendance events, kept for accountability." action={<button className="button button-soft" onClick={()=>{setLoading(true);get('/admin/audit').then((r)=>setLogs(r.logs)).catch((e)=>setError(e.message)).finally(()=>setLoading(false));}}><RefreshCw size={15}/> Refresh</button>}/>{error&&<InlineError>{error}</InlineError>}
    <div className="audit-banner"><div className="audit-banner-icon"><ShieldCheck size={19}/></div><div><b>Trust, with a record.</b><p>Sign-ins, approvals, attendance and settings changes are recorded. Private attachment contents and exact locations are not copied into this log.</p></div><span>{logs.length} recent events</span></div>
    <Card className="audit-table-card"><div className="table-toolbar"><div><h2>Recent activity</h2><p>Newest events first · up to 150 entries</p></div><span className="audit-retention"><FileClock size={14}/> Audit records are append-only</span></div><div className="table-scroll"><table><thead><tr><th>EVENT</th><th>WHO</th><th>WHAT CHANGED</th><th>NETWORK</th><th>WHEN</th></tr></thead><tbody>{loading?<tr><td colSpan="5" className="table-message"><Spinner/></td></tr>:logs.length?logs.map((row)=><tr key={row.id}><td><span className="audit-event"><i/>{row.action.replaceAll('_',' ').toLowerCase()}</span><small className="table-subline">{row.entity_type}</small></td><td><div className="person-cell"><span className="avatar avatar-table avatar-audit">{initials(row.actor_name||'System')}</span><span><b>{row.actor_name||'System'}</b><small>{row.employee_code||'Automated'}</small></span></div></td><td className="audit-details">{row.details&&Object.keys(row.details).length?Object.entries(row.details).map(([k,v])=>`${k.replaceAll('_',' ')}: ${typeof v==='object'?JSON.stringify(v):v}`).join(' · '):row.entity_id||'—'}</td><td className="audit-ip">{row.ip_address||'—'}</td><td><b>{formatDate(String(row.created_at).slice(0,10),{day:'numeric',month:'short'})}</b><small className="table-subline">{formatTime(row.created_at)}</small></td></tr>):<tr><td colSpan="5"><div className="table-message">No audit events yet.</div></td></tr>}</tbody></table></div></Card>
  </>;
}

export default App;
