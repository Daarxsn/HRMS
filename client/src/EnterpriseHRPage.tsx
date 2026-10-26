import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, BriefcaseBusiness, CalendarClock, Check, CircleAlert, FileText, Laptop, LockKeyhole, Plus, RefreshCw, ShieldCheck, UserPlus, Users, X, GraduationCap, ShieldAlert, Award, Sparkles, Filter, ChevronRight, Eye, CheckCircle2 } from 'lucide-react';
import { get, post, patch, formatDate, assetUrl } from './api';

const adminTabs: [string, string, React.ElementType][] = [
  ['overview','Command center',Activity],
  ['people','Lifecycle',Users],
  ['onboarding','Onboarding',Check],
  ['assets','Assets',Laptop],
  ['policies','Policies',FileText],
  ['learning','L&D Claims',GraduationCap],
  ['grievances','Grievances & PoSH',ShieldAlert],
  ['encashments','EL Encashments',CalendarClock],
  ['offboarding','Offboarding',BriefcaseBusiness],
  ['security','Security',LockKeyhole]
];

function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const focusable = modalRef.current?.querySelectorAll('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])') as NodeListOf<HTMLElement> | undefined;
      if (focusable && focusable.length > 1) {
        focusable[1].focus();
      } else {
        closeRef.current?.focus();
      }
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab' && modalRef.current) {
        const focusable = Array.from(modalRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')) as HTMLElement[];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (previous instanceof HTMLElement) previous.focus();
      window.scrollTo(0, scrollY);
    };
  }, [close]);
  return <div className="modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&close()}>
    <div ref={modalRef} className="modal enterprise-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><div className="eyebrow">PEOPLE OPERATIONS</div><h2>{title}</h2></div><button ref={closeRef} className="icon-button" onClick={close} aria-label="Close dialog"><X size={18}/></button></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}
function Metric({label,value,detail}: {label:any;value:any;detail?:any}) { return <div className="enterprise-metric"><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>; }
function Status({value}) { const v=String(value||'—').toLowerCase().replaceAll('_','-'); return <span className={'mini-status mini-'+v}>{String(value||'—').replaceAll('_',' ')}</span>; }
function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function documentExpiry(value) {
  if(!value)return {label:'No expiry date',state:'none'};
  const date=String(value).slice(0,10);
  const days=Math.ceil((Date.parse(date+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000);
  if(days<0)return {label:'Expired '+Math.abs(days)+'d ago',state:'expired'};
  if(days===0)return {label:'Expires today',state:'urgent'};
  if(days<=30)return {label:'Expires in '+days+'d',state:'urgent'};
  if(days<=90)return {label:'Expires in '+days+'d',state:'soon'};
  return {label:'Expires '+formatDate(value),state:'valid'};
}

export default function EnterpriseHRPage() {
  const [tab, setTabState] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      return q && ['overview','people','onboarding','assets','policies','learning','grievances','encashments','offboarding','security'].includes(q) ? q : 'overview';
    } catch { return 'overview'; }
  });
  const setTab = (nextTab: string) => {
    setTabState(nextTab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', nextTab);
      window.history.replaceState(null, '', url.pathname + url.search);
    } catch {}
  };
  const [data,setData]=useState(null), [error,setError]=useState(''), [loading,setLoading]=useState(true), [selectedId,setSelectedId]=useState(''), [lifecycle,setLifecycle]=useState(null), [modal,setModal]=useState(null), [notice,setNotice]=useState('');
  const people=data?.people||[];
  const load=async()=>{
    setLoading(true);setError('');
    try {
      const [overview,peopleRows,assets,policies,separations,security,readiness]=await Promise.all([
        get('/enterprise/admin/overview'),get('/admin/users'),get('/enterprise/admin/assets'),get('/enterprise/admin/policies'),
        get('/enterprise/admin/separations'),get('/enterprise/admin/security'),get('/enterprise/admin/readiness')
      ]);
      setData({overview,people:peopleRows.users||[],assets:assets.assets||[],policies:policies.policies||[],separations:separations.separations||[],security,readiness});
      setSelectedId((current)=>current||peopleRows.users?.[0]?.id||'');
    } catch(e) { setError(e.message||'Could not load HR operations.'); } finally { setLoading(false); }
  };
  const lifecycleRequest = useRef(0);
  const loadLifecycle=async(id)=>{
    const requestId = ++lifecycleRequest.current;
    if(!id){setLifecycle(null);return;}
    setLifecycle(null);
    try {
      const result = await get('/enterprise/admin/employees/'+id+'/lifecycle');
      if(requestId === lifecycleRequest.current) setLifecycle(result);
    } catch(e) {
      if(requestId === lifecycleRequest.current) {
        setLifecycle(null);
        setNotice(e.message||'Could not load employee lifecycle.');
      }
    }
  };
  useEffect(()=>{load();},[]);
  useEffect(()=>{if(selectedId)loadLifecycle(selectedId);},[selectedId]);
  useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(t);}},[notice]);
  const act=async(fn)=>{try{await fn();setNotice('Saved successfully.');await load();if(selectedId)await loadLifecycle(selectedId);setModal(null);}catch(e){setNotice(e.message||'Could not complete the action.');}};
  if(loading&&!data)return <div className="loading-panel"><span className="spinner spinner-large"/><p>Loading HR command center…</p></div>;
  if(error&&!data)return <section className="card"><div className="eyebrow">PEOPLE OPERATIONS</div><h2>Workspace unavailable</h2><p>{error}</p><button className="button button-primary" onClick={load}>Retry</button></section>;
  return <div className="enterprise-page">
    <section className="enterprise-hero">
      <div><div className="eyebrow">PHASES 44–48 · ENTERPRISE HR</div><h1>People operations, in one place.</h1><p>Lifecycle records, onboarding, workforce intelligence, assets, policies, offboarding and security — designed as one operating layer.</p></div>
      <div className="enterprise-hero-meta"><span><i className="pulse-dot"/> Live controls</span><small>{data?.overview?.headcount?.active||0} active people</small></div>
    </section>
    <div className="enterprise-tabs" role="tablist">{adminTabs.map(([key,label,Icon])=><button key={key} role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}><Icon size={16}/>{label}</button>)}</div>
    {tab==='overview'&&<Overview data={data} readiness={data.readiness} onOpenPerson={(id)=>{setSelectedId(id);setTab('people');}}/>}
    {tab==='people'&&<People people={people} selectedId={selectedId} setSelectedId={setSelectedId} lifecycle={lifecycle} openHistory={()=>setModal('history')} openContact={()=>setModal('contact')} openDocument={()=>setModal('document')}/>}
    {tab==='onboarding'&&<Onboarding people={people} reload={load} runAction={act} />}
    {tab==='assets'&&<Assets assets={data.assets||[]} people={people} reload={load} runAction={act}/>}
    {tab==='policies'&&<Policies policies={data.policies||[]} reload={load} runAction={act}/>}
    {tab==='learning'&&<AdminLearningClaimsTab runAction={act}/>}
    {tab==='grievances'&&<AdminGrievancesTab runAction={act}/>}
    {tab==='encashments'&&<AdminLeaveEncashmentsTab runAction={act}/>}
    {tab==='offboarding'&&<Offboarding rows={data.separations||[]} people={people} reload={load} runAction={act}/>}
    {tab==='security'&&<Security security={data.security} people={people} readiness={data.readiness} reload={load} runAction={act}/>}
    {modal==='history'&&<HistoryModal employee={lifecycle?.employee} save={(body)=>act(()=>post('/enterprise/admin/employees/'+selectedId+'/history',body))} close={()=>setModal(null)}/>}
    {modal==='contact'&&<ContactModal save={(body)=>act(()=>post('/enterprise/admin/employees/'+selectedId+'/emergency-contacts',body))} close={()=>setModal(null)}/>}
    {modal==='document'&&<DocumentModal save={(form)=>act(()=>post('/enterprise/admin/employees/'+selectedId+'/documents',form))} close={()=>setModal(null)}/>}
    {notice&&<div className="enterprise-toast" role="status" onClick={()=>setNotice('')}>{notice}<X size={14}/></div>}
  </div>;
}

function Overview({data,readiness,onOpenPerson}) {
  const o=data?.overview, active=o?.headcount?.active||0, total=o?.headcount?.total||0;
  const onb=o?.onboarding?.summary||{}, tasks=Object.values(onb).reduce<number>((a,v)=>a+Number(v),0), done=Number(onb.COMPLETED||0);
  return <div className="enterprise-grid">
    <section className="card enterprise-wide"><div className="card-heading"><div><h2>Workforce pulse</h2><p>The management layer across the people system.</p></div><Status value={readiness?.status||'READY'}/></div><div className="enterprise-metrics">
      <Metric label="Active people" value={active} detail={total?Math.round(active*100/total)+'% of directory':''}/><Metric label="Active admins" value={o?.headcount?.admins||0}/>
      <Metric label="Late entries · 30d" value={o?.attendance30d?.late||0}/><Metric label="Absences · 30d" value={o?.attendance30d?.absent||0}/>
      <Metric label="Onboarding completion" value={tasks?Math.round(done*100/tasks)+'%':'0%'} detail={done+' of '+tasks+' tasks'}/>
    </div></section>
    <section className="card"><div className="card-heading"><div><h2>Organization shape</h2><p>Where the active workforce sits.</p></div></div><div className="bar-list">{(o?.departments||[]).slice(0,7).map((d,i)=><div className="bar-row" key={d.department}><span>{d.department}</span><b>{d.total}</b><i style={{'--bar':Math.max(8,(Number(d.total)/Math.max(...(o.departments||[{total:1}]).map(x=>Number(x.total))))*100)+'%'} as React.CSSProperties}/></div>)}</div></section>
    <section className="card"><div className="card-heading"><div><h2>Readiness</h2><p>Every core layer checked.</p></div></div><div className="readiness-list">{(readiness?.checks||[]).map(c=><div key={c.key}><span className={c.status==='PASS'?'readiness-pass':'readiness-fail'}>{c.status}</span><b>{c.key.replaceAll('_',' ')}</b><small>{c.detail}</small></div>)}</div></section>
    <section className="card"><div className="card-heading"><div><h2>Attendance trend</h2><p>Presence, late entries and absences over six months.</p></div></div><div className="trend-list">{(o?.attendanceTrend||[]).map(m=><div className="trend-row" key={m.month}><span>{m.month}</span><div className="trend-bars"><i style={{'--present':Math.max(5,Math.min(100,Number(m.present)*4))+'%'} as React.CSSProperties}/><i style={{'--late':Math.max(2,Math.min(100,Number(m.late)*10))+'%'} as React.CSSProperties}/><i style={{'--absent':Math.max(2,Math.min(100,Number(m.absent)*10))+'%'} as React.CSSProperties}/></div><b>{m.present}</b></div>)}</div><div className="trend-legend"><span><i/>Present</span><span><i/>Late</span><span><i/>Absent</span></div></section>
    <section className="card"><div className="card-heading"><div><h2>Leave utilization</h2><p>Approved and pending leave committed this year.</p></div></div><div className="leave-intelligence">{(o?.leave||[]).map(l=><div className="leave-row" key={l.leave_type}><span>{l.leave_type.replaceAll('_',' ')}</span><div><i style={{'--leave':Math.min(100,Number(l.committed)*6)+'%'} as React.CSSProperties}/></div><b>{Number(l.approved||0)} approved</b><small>{Number(l.pending||0)} pending</small></div>)}</div></section>
    <section className="card enterprise-wide"><div className="card-heading"><div><h2>Next 60 days</h2><p>Lifecycle items already visible to HR.</p></div></div><div className="enterprise-attention">
      {(o?.upcomingProbation||[]).slice(0,4).map(p=><button type="button" className="attention-item attention-button" key={p.id} onClick={()=>onOpenPerson?.(p.id)} aria-label={'Open employee record for '+p.full_name}><span className="attention-icon"><CalendarClock size={17}/></span><span className="attention-copy"><b>{p.full_name}</b><small>Probation · {formatDate(p.probation_end_date)}</small></span><ArrowRight size={15}/></button>)}
      {(o?.missingDocuments||[]).slice(0,4).map(p=><button type="button" className="attention-item attention-button" key={'doc-'+p.id} onClick={()=>onOpenPerson?.(p.id)} aria-label={'Open HR documents for '+p.full_name}><span className="attention-icon"><FileText size={17}/></span><span className="attention-copy"><b>{p.full_name}</b><small>HR document coverage gap</small></span><ArrowRight size={15}/></button>)}
      {!(o?.upcomingProbation?.length||o?.missingDocuments?.length)&&<div className="empty-state"><span className="empty-icon"><Check size={20}/></span><h3>Clear</h3><p>No immediate lifecycle gaps are flagged.</p></div>}
    </div></section>
  </div>;
}

function People({people,selectedId,setSelectedId,lifecycle,openHistory,openContact,openDocument}) {
  const [q,setQ]=useState(''); const filtered=useMemo(()=>people.filter(p=>(p.full_name+' '+p.employee_code+' '+p.email).toLowerCase().includes(q.toLowerCase())),[people,q]);
  const employee=lifecycle?.employee;
  return <div className="enterprise-grid">
    <section className="card enterprise-wide"><div className="card-heading"><div><h2>Employee lifecycle</h2><p>Durable people records beyond the basic directory.</p></div><div className="enterprise-heading-actions"><span>{filtered.length} people</span></div></div>
      <div className="enterprise-toolbar"><input className="input" placeholder="Search name, ID or email" value={q} onChange={e=>setQ(e.target.value)}/></div>
      <div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Person</span><span>Position</span><span>Status</span><span>Joined</span></div>
      {filtered.map(p=><button key={p.id} className={'enterprise-tr enterprise-row '+(selectedId===p.id?'selected':'')} onClick={()=>setSelectedId(p.id)}><span><b>{p.full_name}</b><small>{p.employee_code} · {p.email}</small></span><span>{p.position||p.title||'Employee'}</span><span><Status value={p.status}/></span><span>{formatDate(p.joined_on)}</span></button>)}</div>
    </section>
    {employee&&<section className="card enterprise-wide"><div className="lifecycle-profile-head"><div><div className="eyebrow">EMPLOYEE RECORD · {employee.employee_code}</div><h2>{employee.full_name}</h2><p>{employee.position||employee.title||'Employee'} · {employee.department||'Unassigned'} · {employee.branch||'Unassigned'}</p></div><Status value={employee.status}/></div>
      <div className="enterprise-metrics lifecycle-metrics"><Metric label="Email" value={employee.email}/><Metric label="Joined" value={formatDate(employee.joined_on)}/><Metric label="Probation" value={employee.probation_end_date?formatDate(employee.probation_end_date):'—'}/><Metric label="Onboarding" value={(lifecycle.onboardingProgress?.percent||0)+'%'}/></div>
      <div className="enterprise-action-grid"><button className="button button-secondary" onClick={openHistory}><Plus size={16}/> Lifecycle event</button><button className="button button-secondary" onClick={openContact}><UserPlus size={16}/> Emergency contact</button><button className="button button-secondary" onClick={openDocument}><FileText size={16}/> HR document</button></div>
      <div className="enterprise-detail-grid">
        <DetailList title="Employment history" rows={lifecycle.history||[]} empty="No lifecycle events recorded." render={r=><><b>{r.event_type.replaceAll('_',' ')}</b><small>{formatDate(r.effective_date)} · {r.title||'—'} {r.department?'· '+r.department:''}</small>{r.notes&&<p>{r.notes}</p>}</>}/>
        <DetailList title="Emergency contacts" rows={lifecycle.contacts||[]} empty="No emergency contacts." render={r=><><b>{r.contact_name} · {r.relationship}</b><small>{r.phone}{r.email?' · '+r.email:''}{r.is_primary?' · Primary':''}</small></>}/>
        <DetailList title="HR documents" rows={lifecycle.documents||[]} empty="No HR documents uploaded." render={r=>{const expiry=documentExpiry(r.expires_on);return <><b>{r.title}</b><small>{r.document_type} · {expiry.label}</small>{expiry.state!=='none'&&<span className={'document-expiry document-expiry-'+expiry.state}>{expiry.state==='expired'?'Expired':expiry.state==='urgent'?'Action needed':expiry.state==='soon'?'Expiring soon':'In date'}</span>}{r.original_filename&&<a href={assetUrl('/enterprise/admin/documents/'+r.id)} target="_blank" rel="noreferrer">Open document</a>}</>}}/>
        <DetailList title="Assigned assets" rows={lifecycle.assets||[]} empty="No assigned assets." render={r=><><b>{r.name}</b><small>{r.asset_tag} · {r.category} · {r.serial_number||'No serial'}</small></>}/>
      </div>
    </section>}
  </div>;
}
function DetailList({title,rows,empty,render}) { return <section className="enterprise-detail"><h3>{title}</h3>{rows.length?rows.map(r=><div className="enterprise-detail-row" key={r.id}>{render(r)}</div>):<p className="muted-copy">{empty}</p>}</section>; }

function Onboarding({people,reload,runAction}) {
  const [employeeId,setEmployeeId]=useState(people[0]?.id||''),[tasks,setTasks]=useState([]),[title,setTitle]=useState(''),[category,setCategory]=useState('GENERAL'),[due,setDue]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
  const [taskLoading,setTaskLoading]=useState(false),[taskError,setTaskError]=useState('');
  const overdueCount=tasks.filter(t=>t.due_date&&String(t.due_date).slice(0,10)<today()&&t.status!=='COMPLETED').length;
  const blockedCount=tasks.filter(t=>t.status==='BLOCKED').length;
  const completedCount=tasks.filter(t=>t.status==='COMPLETED').length;
  const filteredTasks=tasks.filter(t=>(String(t.title||'')+' '+String(t.category||'')+' '+String(t.status||'')).toLowerCase().includes(query.toLowerCase()));
  const taskRequest = useRef(0);
  const load=async()=>{
    const requestId=++taskRequest.current;
    if(!employeeId){setTasks([]);setTaskError('Select an employee to view onboarding tasks.');setTaskLoading(false);return;}
    setTasks([]);setTaskLoading(true);setTaskError('');
    try {
      const r=await get('/enterprise/admin/employees/'+employeeId+'/lifecycle');
      if(requestId===taskRequest.current)setTasks(r.tasks||[]);
    } catch(e) {
      if(requestId===taskRequest.current)setTaskError(e.message||'Could not load onboarding tasks.');
    } finally {
      if(requestId===taskRequest.current)setTaskLoading(false);
    }
  };
  useEffect(()=>{load();},[employeeId]);
  const add=async()=>{if(!employeeId||!title.trim())return;setBusy(true);setTaskError('');try{await runAction(async()=>{await post('/enterprise/admin/employees/'+employeeId+'/onboarding',{title:title.trim(),category:category.trim()||'GENERAL',dueDate:due||null});setTitle('');setDue('');});await load();}finally{setBusy(false)}};
  return <section className="card"><div className="card-heading"><div><h2>Onboarding command</h2><p>Build a clear checklist for every joiner, track progress and surface tasks that need attention.</p></div></div>
    <div className="enterprise-toolbar"><label className="enterprise-field-label">Employee<select aria-label="Select employee for onboarding" className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{people.length?people.map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>):<option value="">No employees available</option>}</select></label><span className="enterprise-heading-actions">{tasks.length} total tasks</span></div>
    <div className="enterprise-metrics onboarding-metrics"><Metric label="Completed" value={completedCount} detail={tasks.length?Math.round(completedCount*100/tasks.length)+'% of checklist':'No tasks yet'}/><Metric label="In progress" value={tasks.filter(t=>t.status==='IN_PROGRESS').length}/><Metric label="Overdue" value={overdueCount} detail="Past due and not completed"/><Metric label="Blocked" value={blockedCount} detail="Needs HR follow-up"/></div>
    <div className="enterprise-inline-form"><input className="input" aria-label="New onboarding task title" placeholder="Task title" value={title} onChange={e=>setTitle(e.target.value)}/><input className="input" aria-label="New onboarding task category" placeholder="Category" value={category} onChange={e=>setCategory(e.target.value)}/><input className="input" aria-label="Onboarding task due date" type="date" min={today()} value={due} onChange={e=>setDue(e.target.value)}/><button className="button button-primary" disabled={!employeeId||!title.trim()||busy} onClick={add}><Plus size={16}/> Add task</button></div>
    {taskError&&<p className="muted-copy" role="alert">{taskError} <button className="button button-secondary button-sm" type="button" onClick={load} disabled={taskLoading}>{taskLoading?'Retrying…':'Retry'}</button></p>}
    <div className="enterprise-toolbar"><input className="input" aria-label="Search onboarding tasks" placeholder="Search tasks by title, category or status" value={query} onChange={e=>setQuery(e.target.value)}/><span className="enterprise-heading-actions">{filteredTasks.length} shown</span></div>
    {taskLoading?<div className="loading-panel" role="status"><span className="spinner"/><p>Loading onboarding tasks…</p></div>:<div className="enterprise-checklist">{filteredTasks.map(t=>{const overdue=Boolean(t.due_date&&String(t.due_date).slice(0,10)<today()&&t.status!=='COMPLETED');return <div className={'check-row '+(overdue?'check-row-overdue':'')} key={t.id}><span className={'check-circle '+(t.status==='COMPLETED'?'done':'')}>{t.status==='COMPLETED'?<Check size={13}/>:null}</span><div><b>{t.title}</b><small>{t.category}{t.due_date?' · Due '+formatDate(t.due_date):''}</small>{overdue&&<span className="onboarding-overdue-label">Overdue</span>}</div><select aria-label={'Status for onboarding task '+t.title} className="enterprise-select" value={t.status} onChange={async e=>{const status=e.target.value;await runAction(()=>patch('/enterprise/admin/onboarding/'+t.id,{status}));await load();}}><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="BLOCKED">Blocked</option></select></div>})}{!filteredTasks.length&&<div className="enterprise-empty-row">{tasks.length?'No tasks match your search.':'No onboarding tasks yet. Add the first task above.'}</div>}</div>}
  </section>;
}

function Assets({assets,people,reload,runAction}) {
  const [form,setForm]=useState({tag:'',name:'',category:'Laptop',serial:'',notes:''}); const [busy,setBusy]=useState(false); const [query,setQuery]=useState('');
  const filteredAssets=assets.filter(a=>(String(a.name||'')+' '+String(a.asset_tag||'')+' '+String(a.serial_number||'')+' '+String(a.category||'')+' '+String(a.status||'')).toLowerCase().includes(query.toLowerCase()));
  const save=async()=>{if(!form.tag.trim()||!form.name.trim())return;setBusy(true);try{await runAction(async()=>{await post('/enterprise/admin/assets',{assetTag:form.tag.trim(),name:form.name.trim(),category:form.category.trim()||'General',serialNumber:form.serial.trim(),notes:form.notes.trim()});setForm({tag:'',name:'',category:'Laptop',serial:'',notes:''});});}finally{setBusy(false)}};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Asset register</h2><p>Track equipment from available → assigned → repair → retired.</p></div></div><div className="enterprise-metrics"><Metric label="Available" value={assets.filter(a=>a.status==='AVAILABLE').length}/><Metric label="Assigned" value={assets.filter(a=>a.status==='ASSIGNED').length}/><Metric label="Repair" value={assets.filter(a=>a.status==='REPAIR').length}/><Metric label="Retired" value={assets.filter(a=>a.status==='RETIRED').length}/></div></section>
  <section className="card"><div className="card-heading"><div><h2>Register asset</h2><p>Create the asset before handing it over.</p></div></div><div className="form-stack"><input className="input" placeholder="Asset tag" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/><input className="input" placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input className="input" placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/><input className="input" aria-label="Serial number" placeholder="Serial number (optional)" value={form.serial} onChange={e=>setForm({...form,serial:e.target.value})}/><textarea className="input enterprise-textarea" aria-label="Asset notes" placeholder="Notes (optional: condition, accessories, warranty)" maxLength={1000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/><button className="button button-primary" type="button" disabled={busy||!form.tag.trim()||!form.name.trim()} onClick={save}>{busy?'Registering…':'Register asset'}</button></div></section>
  <section className="card enterprise-wide"><div className="card-heading"><div><h2>Inventory</h2><p>{filteredAssets.length} of {assets.length} registered assets · assignment and condition are tracked separately.</p></div><span className="enterprise-heading-actions">Asset register</span></div><div className="enterprise-toolbar"><input className="input" aria-label="Search assets" placeholder="Search asset tag, name, serial or status" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Asset</span><span>Category</span><span>Assignee</span><span>Status</span></div>{filteredAssets.map(a=><div className="enterprise-tr enterprise-row" key={a.id}><span><b>{a.name}</b><small>{a.asset_tag} · {a.serial_number||'No serial'}</small></span><span>{a.category}</span><span><select aria-label={'Assignee for '+a.name} className="enterprise-select" value={a.assigned_employee_id||''} onChange={async e=>{const assignedEmployeeId=e.target.value||null;await runAction(()=>patch('/enterprise/admin/assets/'+a.id,{assignedEmployeeId}));}}><option value="">Unassigned</option>{people.filter(p=>p.status==='ACTIVE'&&p.role==='EMPLOYEE').map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></span><span><select aria-label={'Status for '+a.name} className="enterprise-select" value={a.status} onChange={async e=>{const status=e.target.value;const isAssigned=Boolean(a.assigned_employee_id);if(status==='ASSIGNED')return;if(isAssigned&&['AVAILABLE','REPAIR','RETIRED'].includes(status)&&!window.confirm('Changing '+a.name+' to '+status.toLowerCase().replace('_',' ')+' will unassign it from the current employee and record its return. Continue?')){e.target.value=a.status;return;}await runAction(()=>patch('/enterprise/admin/assets/'+a.id,isAssigned?{status,assignedEmployeeId:null}:{status}));}}>{a.status==='ASSIGNED'&&<option value="ASSIGNED">Assigned</option>}<option value="AVAILABLE">Available</option><option value="REPAIR">In repair</option><option value="RETIRED">Retired</option></select></span></div>)}{!filteredAssets.length&&<div className="enterprise-empty-row">{assets.length?'No assets match your search.':'No assets have been registered yet.'}</div>}</div></section></div>;
}

function Policies({policies,reload,runAction}) {
  const emptyForm={title:'',category:'People',version:'1.0',body:''};
  const [form,setForm]=useState(emptyForm); const [editingId,setEditingId]=useState(''); const [query,setQuery]=useState(''); const [busy,setBusy]=useState(false);
  const filteredPolicies=policies.filter(p=>(String(p.title||'')+' '+String(p.category||'')+' '+String(p.version||'')+' '+String(p.status||'')).toLowerCase().includes(query.toLowerCase()));
  const reset=()=>{setForm(emptyForm);setEditingId('');};
  const save=async()=>{if(!form.title.trim()||form.body.trim().length<20||busy)return;setBusy(true);try{await runAction(async()=>{const payload={...form,title:form.title.trim(),category:form.category.trim()||'People',version:form.version.trim()||'1.0',body:form.body.trim()};if(editingId)await patch('/enterprise/admin/policies/'+editingId,payload);else await post('/enterprise/admin/policies',payload);reset();});}finally{setBusy(false)}};
  const edit=(p)=>{setEditingId(p.id);setForm({title:p.title||'',category:p.category||'People',version:p.version||'1.0',body:p.body||''});};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Policy library</h2><p>Versioned policies with publication and acknowledgement coverage.</p></div><span className="enterprise-heading-actions">{filteredPolicies.length} policies</span></div><div className="enterprise-toolbar"><input className="input" aria-label="Search policies" placeholder="Search title, category, version or status" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="policy-list">{filteredPolicies.map(p=><div className="policy-row" key={p.id}><div><b>{p.title}</b><small>{p.category} · v{p.version} · {Number(p.acknowledgements||0)}/{Number(p.active_people||0)} acknowledged</small></div><Status value={p.status}/><div className="policy-row-actions"><button className="button button-secondary button-sm" type="button" disabled={p.status==='PUBLISHED'||Number(p.acknowledgements||0)>0} title={p.status==='PUBLISHED'||Number(p.acknowledgements||0)>0?'Published or acknowledged policies are immutable; create a new version instead.':'Edit draft policy'} onClick={()=>edit(p)}>Edit</button><button className="button button-secondary button-sm" type="button" onClick={()=>runAction(()=>patch('/enterprise/admin/policies/'+p.id,{status:p.status==='PUBLISHED'?'ARCHIVED':'PUBLISHED'}))}>{p.status==='PUBLISHED'?'Archive':p.status==='ARCHIVED'?'Republish':'Publish'}</button></div></div>)}{!filteredPolicies.length&&<div className="enterprise-empty-row">{policies.length?'No policies match your search.':'No policies yet. Create a draft to start the policy library.'}</div>}</div></section>
  <section className="card"><div className="card-heading"><div><h2>{editingId?'Edit policy':'Create policy'}</h2><p>{editingId?'Update the selected policy while preserving its publication state.':'Create a draft. Publish only after the content has been reviewed.'}</p></div>{editingId&&<button className="button button-secondary button-sm" type="button" onClick={reset}>Cancel</button>}</div><div className="form-stack"><label className="enterprise-field-label">Policy title<input aria-label="Policy title" className="input" placeholder="e.g. Information Security Policy" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><div className="enterprise-form-pair"><label className="enterprise-field-label">Category<input aria-label="Category" className="input" placeholder="People" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label><label className="enterprise-field-label">Version<input aria-label="Version" className="input" placeholder="1.0" value={form.version} onChange={e=>setForm({...form,version:e.target.value})}/></label></div><label className="enterprise-field-label">Policy content<textarea aria-label="Policy content" className="input enterprise-textarea" placeholder="Write clear policy guidance (at least 20 characters)." value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/><small>{form.body.length}/20,000 characters · minimum 20</small></label><button className="button button-primary" type="button" disabled={busy||!form.title.trim()||form.body.trim().length<20} onClick={save}>{busy?'Saving…':editingId?'Save changes':'Create draft'}</button></div></section></div>;
}

function Offboarding({rows,people,reload,runAction}) {
  const [employeeId,setEmployeeId]=useState(people.find(p=>p.role!=='ADMIN')?.id||''),[type,setType]=useState('RESIGNATION'),[date,setDate]=useState(today()),[reason,setReason]=useState(''),[query,setQuery]=useState('');
  const filteredRows=rows.filter(r=>(String(r.full_name||'')+' '+String(r.employee_code||'')+' '+String(r.separation_type||'')+' '+String(r.status||'')).toLowerCase().includes(query.toLowerCase()));
  const create=async()=>{if(!employeeId||!date)return;await runAction(async()=>{await post('/enterprise/admin/separations',{employeeId,separationType:type,lastWorkingDate:date,reason:reason.trim()});setReason('');});};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Offboarding</h2><p>Controlled separation cases with status and last-working-day visibility.</p></div></div><div className="enterprise-toolbar"><input className="input" aria-label="Search separation cases" placeholder="Search employee, ID, case type or status" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Employee</span><span>Type</span><span>Last working day</span><span>Status</span></div>{filteredRows.map(r=><div className="enterprise-tr enterprise-row" key={r.id}><span><b>{r.full_name}</b><small>{r.employee_code}</small></span><span>{String(r.separation_type||'').replaceAll('_',' ')}</span><span>{formatDate(r.last_working_date)}</span><span><select aria-label={'Status for '+r.full_name} className="enterprise-select" value={r.status} onChange={async e=>{const status=e.target.value;if(status==='COMPLETED'&&!window.confirm('Complete offboarding for '+r.full_name+'? This immediately deactivates the employee account and revokes existing sessions. Confirm only after HR has completed the exit checks.')){e.target.value=r.status;return;}if(status==='CANCELLED'&&!window.confirm('Cancel the separation case for '+r.full_name+'?')){e.target.value=r.status;return;}await runAction(()=>patch('/enterprise/admin/separations/'+r.id,{status}));}}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Complete · deactivate account</option><option value="CANCELLED">Cancel case</option></select></span></div>)}{!filteredRows.length&&<div className="enterprise-empty-row">{rows.length?'No cases match your search.':'No separation cases have been started.'}</div>}</div></section>
  <section className="card"><div className="card-heading"><div><h2>Start separation</h2><p>Create the HR case before deactivating an account.</p></div></div><div className="form-stack"><select aria-label="Select employee for offboarding" className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{people.filter(p=>p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select><select aria-label="Separation type" className="input" value={type} onChange={e=>setType(e.target.value)}><option>RESIGNATION</option><option>TERMINATION</option><option>CONTRACT_END</option><option>RETIREMENT</option><option>OTHER</option></select><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/><textarea className="input" placeholder="Reason (optional)" value={reason} onChange={e=>setReason(e.target.value)}/><button className="button button-primary" onClick={create}>Start offboarding</button></div></section></div>;
}

function Security({security,people,readiness,reload,runAction}) {
  const [employeeId,setEmployeeId]=useState(''); const target=people.find(p=>p.id===employeeId);
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Security control plane</h2><p>Session revocation and production readiness in one view.</p></div><Status value="PROTECTED"/></div><div className="enterprise-metrics"><Metric label="Active accounts" value={security?.accountSummary?.active||0}/><Metric label="Inactive accounts" value={security?.accountSummary?.inactive||0}/><Metric label="Active admins" value={security?.accountSummary?.activeAdmins||0}/><Metric label="Readiness" value={readiness?.status||'—'}/></div></section>
  <section className="card"><div className="card-heading"><div><h2>Revoke session</h2><p>Force an employee to authenticate again.</p></div></div><div className="form-stack"><select aria-label="Choose employee to revoke session" className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{people.filter(p=>p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select><button className="button button-secondary" disabled={!target||target.status!=='ACTIVE'} onClick={()=>{if(!target)return;if(window.confirm('Revoke the active session for '+target.full_name+'? They will need to sign in again. This does not deactivate the account.'))void runAction(()=>post('/enterprise/admin/security/revoke/'+target.id));}}>Revoke active session</button><small className="security-action-note">This invalidates the selected employee’s existing session. It does not change their employment status or permissions.</small></div></section>
  <section className="card enterprise-wide"><div className="card-heading"><div><h2>Recent security activity</h2><p>Top audit actions over seven days.</p></div></div><div className="readiness-list">{(security?.recentActions||[]).map(r=><div key={r.action}><b>{r.action.replaceAll('_',' ')}</b><span>{r.total}</span><small>{formatDate(r.last_at)}</small></div>)}</div></section></div>;
}

function HistoryModal({employee,save,close}) {
  const [type,setType]=useState('PROMOTED'),[date,setDate]=useState(today()),[title,setTitle]=useState(employee?.title||''),[department,setDepartment]=useState(employee?.department||''),[branch,setBranch]=useState(employee?.branch||''),[notes,setNotes]=useState('');
  return <Modal title={'Lifecycle event · '+(employee?.full_name||'Employee')} close={close}><div className="form-stack"><select aria-label="Lifecycle event type" className="input" value={type} onChange={e=>setType(e.target.value)}><option>PROMOTED</option><option>TRANSFERRED</option><option>ROLE_CHANGED</option><option>PROBATION_COMPLETED</option><option>STATUS_CHANGED</option><option>OTHER</option></select><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/><input className="input" placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)}/><input className="input" placeholder="Department" value={department} onChange={e=>setDepartment(e.target.value)}/><input className="input" placeholder="Branch" value={branch} onChange={e=>setBranch(e.target.value)}/><textarea className="input" placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/><button className="button button-primary" onClick={()=>save({eventType:type,effectiveDate:date,title,department,branch,notes})}>Save event</button></div></Modal>;
}
function ContactModal({save,close}) {
  const [name,setName]=useState(''),[relationship,setRelationship]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState(''),[primary,setPrimary]=useState(false);
  return <Modal title="Emergency contact" close={close}><div className="form-stack"><input className="input" placeholder="Contact name" value={name} onChange={e=>setName(e.target.value)}/><input className="input" placeholder="Relationship" value={relationship} onChange={e=>setRelationship(e.target.value)}/><input className="input" placeholder="Phone" value={phone} onChange={e=>setPhone(e.target.value)}/><input className="input" placeholder="Email (optional)" value={email} onChange={e=>setEmail(e.target.value)}/><label className="check-label"><input type="checkbox" checked={primary} onChange={e=>setPrimary(e.target.checked)}/> Primary contact</label><button className="button button-primary" disabled={!name||!relationship||!phone} onClick={()=>save({contactName:name,relationship,phone,email:email||null,isPrimary:primary})}>Save contact</button></div></Modal>;
}
function DocumentModal({save,close}) {
  const [file,setFile]=useState(null),[type,setType]=useState('ID_PROOF'),[title,setTitle]=useState(''),[issued,setIssued]=useState(''),[expires,setExpires]=useState('');
  const invalidDates=Boolean(issued&&expires&&expires<issued);
  const submit=()=>{if(!file||!title.trim()||invalidDates)return;const form=new FormData();form.append('document',file);form.append('documentType',type);form.append('title',title.trim());if(issued)form.append('issuedOn',issued);if(expires)form.append('expiresOn',expires);save(form);};
  return <Modal title="Upload HR document" close={close}><div className="form-stack"><label className="enterprise-field-label">Document title<input aria-label="Document title" className="input" placeholder="e.g. Employment agreement" maxLength={180} value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="enterprise-field-label">Document type<select aria-label="Document type" className="input" value={type} onChange={e=>setType(e.target.value)}><option value="ID_PROOF">Identity proof</option><option value="CONTRACT">Employment contract</option><option value="OFFER_LETTER">Offer letter</option><option value="CERTIFICATE">Certificate</option><option value="OTHER">Other</option></select></label><div className="enterprise-form-pair"><label className="enterprise-field-label">Issue date<input aria-label="Issue date" className="input" type="date" max={expires||undefined} value={issued} onChange={e=>setIssued(e.target.value)}/></label><label className="enterprise-field-label">Expiry date<input aria-label="Expiry date" className="input" type="date" min={issued||undefined} value={expires} onChange={e=>setExpires(e.target.value)}/></label></div>{invalidDates&&<p className="form-error" role="alert">Expiry date cannot be earlier than the issue date.</p>}<label className="enterprise-field-label">File (PDF, JPG, PNG or WebP; max 10 MB)<input aria-label="File (PDF, JPG, PNG or WebP; max 10 MB)" className="input" type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<small>{file.name} · {(file.size/1024/1024).toFixed(2)} MB</small>}</label><button className="button button-primary" disabled={!file||!title.trim()||invalidDates||file.size>10*1024*1024} onClick={submit}>Upload securely</button></div></Modal>;
}


export function EmployeeDocumentsPage() {
  const [documents,setDocuments]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=async()=>{
    setLoading(true);
    try { const result=await get('/enterprise/employee/documents'); setDocuments(result.documents||[]); setError(''); }
    catch (err) { setError(err?.message||'Your documents could not be loaded. Please try again.'); }
    finally { setLoading(false); }
  };
  useEffect(()=>{void load();},[]);
  return <div className="enterprise-page">
    <div className="page-title"><div><div className="eyebrow">YOUR HR RECORDS</div><h1>My documents</h1><p>View and download employment documents HR has shared with your profile.</p></div><div className="page-title-action"><button className="button button-soft" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>{loading?' Refreshing…':' Refresh'}</button></div></div>
    {error&&<div className="inline-error" role="alert">{error}</div>}
    <section className="card">
      <div className="card-heading"><div><h2>Personal documents</h2><p>Only documents assigned to your employee profile are shown here.</p></div><span className="mini-status">{documents.length} document{documents.length===1?'':'s'}</span></div>
      {loading?<div className="empty-state"><p>Loading your documents…</p></div>:documents.length===0?<div className="empty-state"><span className="empty-icon"><FileText size={21}/></span><h3>No documents available yet</h3><p>Documents shared by HR will appear here. Contact HR if you need a copy of a contract or payslip.</p></div>:<div className="table-scroll"><table aria-label="Employee documents library"><thead><tr><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Issued</th><th scope="col">Expires</th><th scope="col">Access</th></tr></thead><tbody>{documents.map((doc)=><tr key={doc.id}><td><b>{doc.title}</b>{doc.description&&<div className="table-subline">{doc.description}</div>}</td><td>{String(doc.document_type||'OTHER').replaceAll('_',' ')}</td><td><Status value={doc.status}/></td><td>{doc.issued_on?formatDate(doc.issued_on):'—'}</td><td>{doc.expires_on?formatDate(doc.expires_on):'—'}</td><td><a className="button button-soft" href={assetUrl('/enterprise/employee/documents/'+encodeURIComponent(doc.id))} target="_blank" rel="noreferrer">Download</a></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}

function AdminLearningClaimsTab({ runAction }: { runAction: (fn: () => Promise<any>) => Promise<void> }) {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [rejectionModal, setRejectionModal] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await get('/enterprise/admin/learning/claims' + (filter !== 'ALL' ? `?status=${filter}` : ''));
      setClaims(res.claims || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [filter]);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED', reason?: string) => {
    await runAction(async () => {
      await post(`/enterprise/admin/learning/claims/${id}/review`, { status, rejection_reason: reason });
      await load();
      setRejectionModal(null);
      setRejectionReason('');
    });
  };

  return (
    <div className="enterprise-grid">
      <section className="card enterprise-wide">
        <div className="card-heading">
          <div>
            <h2>Learning & Development Reimbursement Claims</h2>
            <p>Review course, certification, and workshop claims against the ₹24,000/yr annual allowance.</p>
          </div>
          <div className="enterprise-toolbar-chips" style={{ display: 'flex', gap: '8px' }}>
            {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((s) => (
              <button key={s} type="button" className={`button button-small ${filter === s ? 'button-primary' : 'button-soft'}`} onClick={() => setFilter(s)}>{s}</button>
            ))}
          </div>
        </div>
        {loading ? <div className="loading-panel"><span className="spinner" /> Loading claims…</div> : claims.length === 0 ? (
          <div className="enterprise-empty-row">No learning reimbursement claims found.</div>
        ) : (
          <div className="table-scroll">
            <table aria-label="Learning reimbursement claims queue">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Title & Provider</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Invoice</th>
                  <th scope="col">Status</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.full_name}</b><div className="table-subline">{c.employee_code} · {c.department || 'General'}</div></td>
                    <td><b>{c.title}</b><div className="table-subline">{c.provider}{c.notes ? ` · Note: ${c.notes}` : ''}</div></td>
                    <td><b style={{ color: 'var(--fx-gold, #DAAF51)' }}>₹{Number(c.amount_inr).toLocaleString('en-IN')}</b></td>
                    <td>
                      {c.invoice_attachment_id ? (
                        <a className="button button-soft button-small" href={assetUrl(`/workplace/files/${c.invoice_attachment_id}`)} target="_blank" rel="noreferrer">View receipt</a>
                      ) : <span className="table-subline">None attached</span>}
                    </td>
                    <td><Status value={c.status} /></td>
                    <td>{formatDate(c.created_at)}</td>
                    <td>
                      {c.status === 'PENDING' ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="button button-primary button-small" type="button" onClick={() => void review(c.id, 'APPROVED')}>Approve</button>
                          <button className="button button-secondary button-small" type="button" onClick={() => { setRejectionModal(c); setRejectionReason(''); }}>Reject</button>
                        </div>
                      ) : <span className="table-subline">{c.status === 'APPROVED' ? `Reviewed ${formatDate(c.reviewed_at)}` : c.rejection_reason || 'Rejected'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rejectionModal && (
        <Modal title={`Reject L&D Claim · ${rejectionModal.title}`} close={() => setRejectionModal(null)}>
          <div className="form-stack">
            <p>Provide a rejection reason so <b>{rejectionModal.full_name}</b> understands why the claim could not be processed:</p>
            <textarea className="input" placeholder="e.g. Receipt unreadable, non-accredited provider, or beyond eligible scope." value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="button button-soft" type="button" onClick={() => setRejectionModal(null)}>Cancel</button>
              <button className="button button-danger" type="button" onClick={() => void review(rejectionModal.id, 'REJECTED', rejectionReason)}>Confirm rejection</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminGrievancesTab({ runAction }: { runAction: (fn: () => Promise<any>) => Promise<void> }) {
  const [grievances, setGrievances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [statusVal, setStatusVal] = useState('OPEN');
  const [notesVal, setNotesVal] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await get('/enterprise/admin/grievances');
      setGrievances(res.grievances || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openReview = (g: any) => {
    setSelected(g);
    setStatusVal(g.status || 'OPEN');
    setNotesVal(g.resolution_notes || '');
  };

  const update = async () => {
    if (!selected) return;
    await runAction(async () => {
      await patch(`/enterprise/admin/grievances/${selected.id}`, {
        status: statusVal,
        resolution_notes: notesVal
      });
      await load();
      setSelected(null);
    });
  };

  return (
    <div className="enterprise-grid">
      <section className="card enterprise-wide">
        <div className="card-heading">
          <div>
            <h2>Confidential Grievance & PoSH Incident Desk</h2>
            <p>Protected investigation console for PoSH, Good Samaritan whistleblowing, and workplace integrity complaints.</p>
          </div>
          <button className="button button-soft button-small" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>

        {loading ? <div className="loading-panel"><span className="spinner" /> Loading reports…</div> : grievances.length === 0 ? (
          <div className="enterprise-empty-row">No confidential grievances recorded.</div>
        ) : (
          <div className="table-scroll">
            <table aria-label="Confidential grievances investigation log">
              <thead>
                <tr>
                  <th scope="col">Ref Code</th>
                  <th scope="col">Category</th>
                  <th scope="col">Reporter</th>
                  <th scope="col">Subject</th>
                  <th scope="col">ICC Routing</th>
                  <th scope="col">Status</th>
                  <th scope="col">Filed</th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {grievances.map((g) => (
                  <tr key={g.id}>
                    <td><code style={{ fontWeight: 700, color: 'var(--fx-gold, #DAAF51)' }}>{g.reference_code}</code></td>
                    <td>
                      <span style={{
                        display: 'inline-flex', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                        background: g.category === 'POSH' ? 'rgba(147, 19, 20, 0.15)' : 'rgba(218, 175, 81, 0.15)',
                        color: g.category === 'POSH' ? 'var(--fx-red, #931314)' : 'var(--fx-gold, #DAAF51)'
                      }}>
                        {g.category.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td>{g.is_anonymous ? <i>Anonymous</i> : <b>{g.reporter_name}</b>}</td>
                    <td><b>{g.subject}</b><div className="table-subline">{g.description.slice(0, 60)}…</div></td>
                    <td>{g.assigned_to_icc ? <span style={{ color: 'var(--fx-red, #931314)', fontWeight: 700 }}>Assigned to ICC</span> : 'HR General'}</td>
                    <td><Status value={g.status} /></td>
                    <td>{formatDate(g.created_at)}</td>
                    <td>
                      <button className="button button-soft button-small" type="button" onClick={() => openReview(g)}>Inspect & update</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <Modal title={`Confidential Case · ${selected.reference_code}`} close={() => setSelected(null)}>
          <div className="form-stack">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'var(--color-surface-2, rgba(0,0,0,0.03))', padding: '12px', borderRadius: '8px' }}>
              <div><small>Category</small><br /><b>{selected.category}</b></div>
              <div><small>Reporter</small><br /><b>{selected.is_anonymous ? 'Protected Anonymous' : `${selected.reporter_name} (${selected.reporter_email})`}</b></div>
              <div><small>Date Submitted</small><br /><b>{formatDate(selected.created_at)}</b></div>
              <div><small>Routing</small><br /><b>{selected.assigned_to_icc ? 'Internal Complaints Committee (ICC)' : 'General HR'}</b></div>
            </div>

            <div>
              <label className="enterprise-field-label">Subject</label>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>{selected.subject}</div>
            </div>

            <div>
              <label className="enterprise-field-label">Full Report Statement</label>
              <div style={{ whiteSpace: 'pre-wrap', background: 'var(--color-bg, #fff)', padding: '12px', border: '1px solid var(--color-border, #ddd)', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {selected.description}
              </div>
            </div>

            <label className="enterprise-field-label">
              Investigation Status
              <select aria-label="Investigation Status" className="input" value={statusVal} onChange={(e) => setStatusVal(e.target.value)}>
                <option value="OPEN">OPEN</option>
                <option value="UNDER_INVESTIGATION">UNDER INVESTIGATION</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </label>

            <label className="enterprise-field-label">
              Confidential Investigation Notes / Resolution
              <textarea className="input enterprise-textarea" placeholder="Record findings, witness consultations, or resolution measures (visible to reporter via tracker)." value={notesVal} onChange={(e) => setNotesVal(e.target.value)} />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="button button-soft" type="button" onClick={() => setSelected(null)}>Cancel</button>
              <button className="button button-primary" type="button" onClick={() => void update()}>Save case progress</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminLeaveEncashmentsTab({ runAction }: { runAction: (fn: () => Promise<any>) => Promise<void> }) {
  const [encashments, setEncashments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectionModal, setRejectionModal] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await get('/leave/admin/encashments');
      setEncashments(res.encashments || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED', reason?: string) => {
    await runAction(async () => {
      await post(`/leave/admin/encashments/${id}/review`, { status, rejection_reason: reason });
      await load();
      setRejectionModal(null);
      setRejectionReason('');
    });
  };

  return (
    <div className="enterprise-grid">
      <section className="card enterprise-wide">
        <div className="card-heading">
          <div>
            <h2>Earned Leave (EL) Encashment Applications</h2>
            <p>Annual encashment applications for confirmed employees with 12+ months service.</p>
          </div>
          <button className="button button-soft button-small" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>

        {loading ? <div className="loading-panel"><span className="spinner" /> Loading applications…</div> : encashments.length === 0 ? (
          <div className="enterprise-empty-row">No leave encashment requests found.</div>
        ) : (
          <div className="table-scroll">
            <table aria-label="Leave encashment review queue">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Days Requested</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {encashments.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.full_name}</b><div className="table-subline">{e.employee_code} · {e.department || 'General'}</div></td>
                    <td><b style={{ fontSize: '15px', color: 'var(--fx-gold, #DAAF51)' }}>{e.days} day(s)</b></td>
                    <td>{e.reason || <span className="table-subline">None specified</span>}</td>
                    <td><Status value={e.status} /></td>
                    <td>{formatDate(e.created_at)}</td>
                    <td>
                      {e.status === 'PENDING' ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="button button-primary button-small" type="button" onClick={() => void review(e.id, 'APPROVED')}>Approve</button>
                          <button className="button button-secondary button-small" type="button" onClick={() => { setRejectionModal(e); setRejectionReason(''); }}>Reject</button>
                        </div>
                      ) : <span className="table-subline">{e.status === 'APPROVED' ? `Approved ${formatDate(e.reviewed_at)}` : e.rejection_reason || 'Rejected'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rejectionModal && (
        <Modal title={`Reject Encashment · ${rejectionModal.full_name}`} close={() => setRejectionModal(null)}>
          <div className="form-stack">
            <p>Provide a reason for rejecting the encashment request for <b>{rejectionModal.days} day(s)</b>:</p>
            <textarea className="input" placeholder="e.g. Encashment quota exceeded, or insufficient earned balance." value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="button button-soft" type="button" onClick={() => setRejectionModal(null)}>Cancel</button>
              <button className="button button-danger" type="button" onClick={() => void review(rejectionModal.id, 'REJECTED', rejectionReason)}>Confirm rejection</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function EmployeePoliciesPage() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const policyRequest=useRef(0);

  const load = async () => {
    const requestId = ++policyRequest.current;
    setLoading(true);
    setLoadError('');
    setActionError('');
    setSuccessMessage('');
    try {
      const result = await get('/enterprise/policies');
      if (requestId !== policyRequest.current) return;
      setPolicies(Array.isArray(result.policies) ? result.policies : []);
    } catch (e: any) {
      if (requestId === policyRequest.current) setLoadError(e.message || 'Could not load published policies.');
    } finally {
      if (requestId === policyRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { policyRequest.current += 1; };
  }, []);

  const acknowledged = (policy: any) => policy.acknowledged === true || Number(policy.acknowledged) === 1;
  const pendingCount = policies.filter((policy) => !acknowledged(policy)).length;

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of policies) if (p.category) cats.add(p.category);
    return ['ALL', ...Array.from(cats).sort()];
  }, [policies]);

  const filtered = useMemo(() => {
    if (selectedCategory === 'ALL') return policies;
    return policies.filter((p) => p.category === selectedCategory);
  }, [policies, selectedCategory]);

  const ack = async (id: string) => {
    if (busyId) return;
    setBusyId(id); setActionError(''); setSuccessMessage('');
    try {
      await post('/enterprise/policies/' + id + '/acknowledge');
      setPolicies((current)=>current.map((policy)=>policy.id===id?{...policy,acknowledged:1}:policy));
      setSuccessMessage('Your digital policy signature has been recorded with timestamp and IP audit trail.');
    } catch (e: any) {
      setActionError(e.message || 'Could not acknowledge this policy. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="enterprise-page employee-policy-page">
      <section className="enterprise-hero employee-policy-hero">
        <div>
          <div className="eyebrow" style={{ color: 'var(--fx-gold, #DAAF51)' }}>PEOPLE · 14 OFFICIAL POLICIES</div>
          <h1>Policies that stay clear.</h1>
          <p>Read current company policies across ethics, attendance, safety, benefits, and workplace standards. Provide your digital acknowledgement with verified legal authenticity.</p>
        </div>
        <div className="employee-policy-hero-mark" aria-hidden="true">
          <ShieldCheck size={34} />
          <span>FALCHION<br />XENIAA</span>
        </div>
      </section>

      <section className="card employee-policies-panel" aria-busy={loading}>
        <div className="employee-policy-panel-head">
          <div>
            <div className="eyebrow">POLICY DIRECTORY</div>
            <h2>Company Policies ({policies.length})</h2>
            <p>14 official governance, safety, and operational standards.</p>
          </div>
          <button className="button button-soft button-small" type="button" onClick={() => void load()} disabled={loading || busyId !== null}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        {!loading && !loadError && (
          <div className="employee-policy-summary" aria-label="Policy summary">
            <div><span>Total Policies</span><b>{policies.length}</b><small>Official corporate standards</small></div>
            <div><span>Awaiting Signature</span><b style={{ color: pendingCount > 0 ? 'var(--fx-red, #931314)' : undefined }}>{pendingCount}</b><small>{pendingCount === 1 ? 'One policy' : 'Policies'} pending review</small></div>
            <div><span>Signed & Verified</span><b>{policies.length - pendingCount}</b><small>Digital signature recorded</small></div>
          </div>
        )}

        {/* Category Filter Chips */}
        {!loading && categories.length > 1 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '16px 0 20px' }}>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`button button-small ${selectedCategory === cat ? 'button-primary' : 'button-soft'}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
        )}

        {loadError && (
          <div className="employee-policy-error" role="alert">
            <span className="employee-policy-error-icon"><CircleAlert size={20} /></span>
            <div>
              <h2>We couldn’t load your policies</h2>
              <p>{loadError}</p>
              <p className="employee-policy-error-help">Retry the request. If the problem continues, share the error reference with your HR administrator.</p>
              <button className="button button-soft button-small" type="button" onClick={() => void load()} disabled={loading}>
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          </div>
        )}
        {actionError && <div className="employee-policy-inline-error" role="alert"><CircleAlert size={16} /><span>{actionError}</span></div>}
        {successMessage && <div className="employee-policy-inline-success" role="status"><Check size={16} /><span>{successMessage}</span></div>}

        {loading ? (
          <div className="loading-panel employee-policy-loading" role="status"><span className="spinner" /><p>Loading official policies…</p></div>
        ) : !loadError && filtered.length ? (
          <div className="employee-policy-list">
            {filtered.map((p) => {
              const isAck = acknowledged(p);
              return (
                <article className="employee-policy-card" key={p.id}>
                  <div className="employee-policy-content">
                    <div className="employee-policy-meta">
                      <span className="eyebrow" style={{ color: 'var(--fx-gold, #DAAF51)' }}>{p.category || 'POLICY'}</span>
                      <span className="policy-version">v{p.version || '2026.1'}</span>
                    </div>
                    <h2>{p.title}</h2>
                    <p className="policy-body" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.body}</p>
                    <div style={{ marginTop: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--color-text-muted, #777)' }}>
                      {p.published_at && <span>Published: {formatDate(p.published_at)}</span>}
                      {isAck && p.acknowledged_at && (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>
                          ✓ Digitally signed on {formatDate(p.acknowledged_at)}{p.ip_address ? ` · IP: ${p.ip_address}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="policy-actions" style={{ minWidth: '160px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                    {isAck ? (
                      <span className="employee-policy-acknowledged" style={{ background: 'rgba(22, 163, 74, 0.1)', color: '#16a34a', padding: '8px 14px', borderRadius: '8px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={16} /> Signed
                      </span>
                    ) : (
                      <button className="button button-primary" type="button" disabled={busyId === p.id || busyId !== null} aria-busy={busyId === p.id || undefined} onClick={() => void ack(p.id)}>
                        {busyId === p.id ? <><span className="spinner" /> Signing…</> : 'Acknowledge & Sign'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !loadError ? (
          <div className="empty-state employee-policy-empty">
            <span className="empty-icon"><FileText size={21} /></span>
            <h3>No policies found in this category</h3>
            <button className="button button-soft button-small" type="button" onClick={() => setSelectedCategory('ALL')}>View all policies</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function GrievancePage() {
  const [category, setCategory] = useState<'POSH' | 'GOOD_SAMARITAN' | 'GENERAL_GRIEVANCE'>('POSH');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  // Tracking
  const [trackCode, setTrackCode] = useState('');
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState('');
  const [trackedRecord, setTrackedRecord] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || description.trim().length < 10 || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await post('/enterprise/grievances', {
        category,
        subject: subject.trim(),
        description: description.trim(),
        is_anonymous: isAnonymous
      });
      setSubmittedRef(res.reference_code);
      setSubject('');
      setDescription('');
    } catch (err: any) {
      setSubmitError(err.message || 'Could not submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackCode.trim() || tracking) return;
    setTracking(true);
    setTrackError('');
    setTrackedRecord(null);
    try {
      const res = await get(`/enterprise/grievances/track/${encodeURIComponent(trackCode.trim())}`);
      setTrackedRecord(res.grievance);
    } catch (err: any) {
      setTrackError(err.message || 'Grievance reference code not found.');
    } finally {
      setTracking(false);
    }
  };

  return (
    <div className="enterprise-page grievance-page">
      <section className="enterprise-hero grievance-hero">
        <div>
          <div className="eyebrow" style={{ color: 'var(--fx-gold, #DAAF51)' }}>SECURITY · POSH & WHISTLEBLOWER CHANNELS</div>
          <h1>Speak up with cryptographic trust.</h1>
          <p>Falchion Xeniaa is committed to an ethical, safe, and transparent workplace. Submit confidential concerns directly to the Internal Complaints Committee (ICC) or HR leadership with optional end-to-end anonymity.</p>
        </div>
        <div className="employee-policy-hero-mark" aria-hidden="true">
          <ShieldAlert size={36} color="var(--fx-red, #931314)" />
          <span>ZERO<br />TOLERANCE</span>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '24px', alignItems: 'start' }}>
        {/* Submission Form */}
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Submit a Confidential Report</h2>
              <p>Protected by the POSH Act 2013 and Falchion Xeniaa Good Samaritan Whistleblower safeguards.</p>
            </div>
          </div>

          {submittedRef ? (
            <div style={{ padding: '24px', background: 'rgba(218, 175, 81, 0.08)', borderRadius: '12px', border: '1px solid var(--fx-gold, #DAAF51)', textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', background: 'var(--fx-gold, #DAAF51)', color: '#111', marginBottom: '14px' }}>
                <Check size={28} />
              </div>
              <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Report Securely Filed</h3>
              <p style={{ color: 'var(--color-text-muted, #666)', marginBottom: '16px' }}>Your report has been received. Save this unique reference code to check investigation progress anonymously:</p>
              <div style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--fx-red, #931314)', padding: '12px 20px', background: 'var(--color-surface, #fff)', border: '2px dashed var(--fx-gold, #DAAF51)', borderRadius: '8px', display: 'inline-block', marginBottom: '18px' }}>
                {submittedRef}
              </div>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted, #777)', marginBottom: '20px' }}>
                The ICC and HR leadership review every submission. No metadata tying back to your identity is retained when submitted anonymously.
              </p>
              <button className="button button-soft" type="button" onClick={() => setSubmittedRef(null)}>Submit another report</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="form-stack">
              {submitError && <div className="inline-error" role="alert">{submitError}</div>}

              <label className="enterprise-field-label">
                Complaint Category
                <select aria-label="Complaint Category" className="input" value={category} onChange={(e) => setCategory(e.target.value as any)}>
                  <option value="POSH">Prevention of Sexual Harassment (PoSH) · Routed to ICC</option>
                  <option value="GOOD_SAMARITAN">Good Samaritan · Whistleblower / Financial / Ethical</option>
                  <option value="GENERAL_GRIEVANCE">General Grievance · Workplace Conduct / Management</option>
                </select>
              </label>

              <label className="enterprise-field-label">
                Subject
                <input className="input" placeholder="Brief summary of the issue or incident" maxLength={180} required value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>

              <label className="enterprise-field-label">
                Detailed Statement & Evidence
                <textarea className="input enterprise-textarea" placeholder="Describe the incident, dates, locations, persons involved, or any relevant details. (Minimum 10 characters)" rows={6} required value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>

              <div style={{ padding: '14px', background: 'var(--color-surface-2, rgba(0,0,0,0.03))', borderRadius: '8px', border: '1px solid var(--color-border, #eee)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                  Submit Anonymously
                </label>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted, #666)', margin: '6px 0 0 28px' }}>
                  {isAnonymous
                    ? 'Your identity, employee ID, and contact details will NOT be linked to this submission. Keep your tracking reference code to check updates.'
                    : 'Your name and company email will be visible only to the authorized ICC committee / HR leadership.'}
                </p>
              </div>

              <button className="button button-primary" type="submit" disabled={submitting || !subject.trim() || description.trim().length < 10}>
                {submitting ? 'Submitting securely…' : 'Submit Confidential Report'}
              </button>
            </form>
          )}
        </section>

        {/* Tracker Panel */}
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Track Report Status</h2>
              <p>Check the active status of any previously submitted report.</p>
            </div>
          </div>

          <form onSubmit={handleTrack} className="form-stack" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="input" placeholder="e.g. FX-GRIEV-XXXX-XXXX" value={trackCode} onChange={(e) => setTrackCode(e.target.value)} required />
              <button className="button button-primary" type="submit" disabled={tracking || !trackCode.trim()}>
                {tracking ? 'Checking…' : 'Track'}
              </button>
            </div>
          </form>

          {trackError && <div className="inline-error" role="alert">{trackError}</div>}

          {trackedRecord && (
            <div style={{ padding: '18px', background: 'var(--color-surface-2, rgba(0,0,0,0.03))', borderRadius: '10px', border: '1px solid var(--color-border, #ddd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <code style={{ fontWeight: 800, color: 'var(--fx-gold, #DAAF51)' }}>{trackedRecord.reference_code}</code>
                <Status value={trackedRecord.status} />
              </div>
              <div style={{ marginBottom: '8px' }}>
                <small style={{ color: 'var(--color-text-muted, #666)' }}>Category:</small> <b>{trackedRecord.category.replaceAll('_', ' ')}</b>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <small style={{ color: 'var(--color-text-muted, #666)' }}>Subject:</small> <b>{trackedRecord.subject}</b>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <small style={{ color: 'var(--color-text-muted, #666)' }}>Filed on:</small> {formatDate(trackedRecord.created_at)}
              </div>
              {trackedRecord.resolution_notes ? (
                <div style={{ padding: '12px', background: 'var(--color-bg, #fff)', border: '1px solid var(--color-border, #ccc)', borderRadius: '8px' }}>
                  <b style={{ fontSize: '13px', display: 'block', marginBottom: '4px', color: 'var(--fx-red, #931314)' }}>ICC / HR Case Notes:</b>
                  <p style={{ margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap' }}>{trackedRecord.resolution_notes}</p>
                  {trackedRecord.resolved_at && <small style={{ color: '#888', display: 'block', marginTop: '6px' }}>Resolved on {formatDate(trackedRecord.resolved_at)}</small>}
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted, #777)', fontStyle: 'italic', margin: 0 }}>
                  Case is currently under active review. Further updates will be reflected here.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
