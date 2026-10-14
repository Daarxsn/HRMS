// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, BriefcaseBusiness, CalendarClock, Check, CircleAlert, FileText, Laptop, LockKeyhole, Plus, RefreshCw, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { get, post, patch, formatDate, assetUrl } from './api';

const adminTabs = [
  ['overview','Command center',Activity], ['people','Lifecycle',Users], ['onboarding','Onboarding',Check],
  ['assets','Assets',Laptop], ['policies','Policies',FileText], ['offboarding','Offboarding',BriefcaseBusiness], ['security','Security',LockKeyhole]
];

function Modal({ title, children, close }) {
  return <div className="modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&close()}>
    <div className="modal enterprise-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><div className="eyebrow">PEOPLE OPERATIONS</div><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="Close"><X size={18}/></button></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}
function Metric({label,value,detail}) { return <div className="enterprise-metric"><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>; }
function Status({value}) { const v=String(value||'—').toLowerCase().replaceAll('_','-'); return <span className={'mini-status mini-'+v}>{String(value||'—').replaceAll('_',' ')}</span>; }
function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }

export default function EnterpriseHRPage() {
  const [tab,setTab]=useState('overview'), [data,setData]=useState(null), [error,setError]=useState(''), [loading,setLoading]=useState(true), [selectedId,setSelectedId]=useState(''), [lifecycle,setLifecycle]=useState(null), [modal,setModal]=useState(null), [notice,setNotice]=useState('');
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
  const onb=o?.onboarding?.summary||{}, tasks=Object.values(onb).reduce((a,v)=>a+Number(v),0), done=Number(onb.COMPLETED||0);
  return <div className="enterprise-grid">
    <section className="card enterprise-wide"><div className="card-heading"><div><h2>Workforce pulse</h2><p>The management layer across the people system.</p></div><Status value={readiness?.status||'READY'}/></div><div className="enterprise-metrics">
      <Metric label="Active people" value={active} detail={total?Math.round(active*100/total)+'% of directory':''}/><Metric label="Active admins" value={o?.headcount?.admins||0}/>
      <Metric label="Late entries · 30d" value={o?.attendance30d?.late||0}/><Metric label="Absences · 30d" value={o?.attendance30d?.absent||0}/>
      <Metric label="Onboarding completion" value={tasks?Math.round(done*100/tasks)+'%':'0%'} detail={done+' of '+tasks+' tasks'}/>
    </div></section>
    <section className="card"><div className="card-heading"><div><h2>Organization shape</h2><p>Where the active workforce sits.</p></div></div><div className="bar-list">{(o?.departments||[]).slice(0,7).map((d,i)=><div className="bar-row" key={d.department}><span>{d.department}</span><b>{d.total}</b><i style={{'--bar':Math.max(8,(d.total/Math.max(...(o.departments||[{total:1}]).map(x=>x.total)))*100)+'%'}}/></div>)}</div></section>
    <section className="card"><div className="card-heading"><div><h2>Readiness</h2><p>Every core layer checked.</p></div></div><div className="readiness-list">{(readiness?.checks||[]).map(c=><div key={c.key}><span className={c.status==='PASS'?'readiness-pass':'readiness-fail'}>{c.status}</span><b>{c.key.replaceAll('_',' ')}</b><small>{c.detail}</small></div>)}</div></section>
    <section className="card"><div className="card-heading"><div><h2>Attendance trend</h2><p>Presence, late entries and absences over six months.</p></div></div><div className="trend-list">{(o?.attendanceTrend||[]).map(m=><div className="trend-row" key={m.month}><span>{m.month}</span><div className="trend-bars"><i style={{'--present':Math.max(5,Math.min(100,Number(m.present)*4))+'%'}}/><i style={{'--late':Math.max(2,Math.min(100,Number(m.late)*10))+'%'}}/><i style={{'--absent':Math.max(2,Math.min(100,Number(m.absent)*10))+'%'}}/></div><b>{m.present}</b></div>)}</div><div className="trend-legend"><span><i/>Present</span><span><i/>Late</span><span><i/>Absent</span></div></section>
    <section className="card"><div className="card-heading"><div><h2>Leave utilization</h2><p>Approved and pending leave committed this year.</p></div></div><div className="leave-intelligence">{(o?.leave||[]).map(l=><div className="leave-row" key={l.leave_type}><span>{l.leave_type.replaceAll('_',' ')}</span><div><i style={{'--leave':Math.min(100,Number(l.committed)*6)+'%'}}/></div><b>{Number(l.approved||0)} approved</b><small>{Number(l.pending||0)} pending</small></div>)}</div></section>
    <section className="card enterprise-wide"><div className="card-heading"><div><h2>Next 60 days</h2><p>Lifecycle items already visible to HR.</p></div></div><div className="enterprise-attention">
      {(o?.upcomingProbation||[]).slice(0,4).map(p=><button type="button" className="attention-item attention-button" key={p.id} onClick={()=>onOpenPerson?.(p.id)} aria-label={'Open employee record for '+p.full_name}><span className="attention-icon"><CalendarClock size={17}/></span><span className="attention-copy"><b>{p.full_name}</b><small>Probation · {formatDate(p.probation_end_date)}</small></span><ArrowRight size={15}/></button>)}
      {(o?.missingDocuments||[]).slice(0,4).map(p=><button type="button" className="attention-item attention-button" key={'doc-'+p.id} onClick={()=>onOpenPerson?.(p.id)} aria-label={'Open HR documents for '+p.full_name}><span className="attention-icon"><FileText size={17}/></span><span className="attention-copy"><b>{p.full_name}</b><small>HR document coverage gap</small></span><ArrowRight size={15}/></button>)}}
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
        <DetailList title="HR documents" rows={lifecycle.documents||[]} empty="No HR documents uploaded." render={r=><><b>{r.title}</b><small>{r.document_type} · {r.expires_on?'Expires '+formatDate(r.expires_on):'No expiry'}</small>{r.original_filename&&<a href={assetUrl('/enterprise/admin/documents/'+r.id)} target="_blank" rel="noreferrer">Open document</a>}</>}/>
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
  <section className="card"><div className="card-heading"><div><h2>Register asset</h2><p>Create the asset before handing it over.</p></div></div><div className="form-stack"><input className="input" placeholder="Asset tag" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/><input className="input" placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input className="input" placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/><input className="input" placeholder="Serial number" value={form.serial} onChange={e=>setForm({...form,serial:e.target.value})}/><button className="button button-primary" disabled={busy||!form.tag||!form.name} onClick={save}>Register asset</button></div></section>
  <section className="card enterprise-wide"><div className="card-heading"><div><h2>Inventory</h2><p>{filteredAssets.length} of {assets.length} registered assets · assignment and condition are tracked separately.</p></div><span className="enterprise-heading-actions">Asset register</span></div><div className="enterprise-toolbar"><input className="input" aria-label="Search assets" placeholder="Search asset tag, name, serial or status" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Asset</span><span>Category</span><span>Assignee</span><span>Status</span></div>{filteredAssets.map(a=><div className="enterprise-tr enterprise-row" key={a.id}><span><b>{a.name}</b><small>{a.asset_tag} · {a.serial_number||'No serial'}</small></span><span>{a.category}</span><span><select aria-label={'Assignee for '+a.name} className="enterprise-select" value={a.assigned_employee_id||''} onChange={async e=>{const assignedEmployeeId=e.target.value||null;await runAction(()=>patch('/enterprise/admin/assets/'+a.id,{assignedEmployeeId}));}}><option value="">Unassigned</option>{people.filter(p=>p.status==='ACTIVE'&&p.role==='EMPLOYEE').map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></span><span><select aria-label={'Status for '+a.name} className="enterprise-select" value={a.status} onChange={async e=>{const status=e.target.value;await runAction(()=>patch('/enterprise/admin/assets/'+a.id,{status}));}}><option value="AVAILABLE">Available</option><option value="ASSIGNED">Assigned</option><option value="REPAIR">In repair</option><option value="RETIRED">Retired</option></select></span></div>)}{!filteredAssets.length&&<div className="enterprise-empty-row">{assets.length?'No assets match your search.':'No assets have been registered yet.'}</div>}</div></section></div>;
}

function Policies({policies,reload,runAction}) {
  const emptyForm={title:'',category:'People',version:'1.0',body:''};
  const [form,setForm]=useState(emptyForm); const [editingId,setEditingId]=useState(''); const [query,setQuery]=useState(''); const [busy,setBusy]=useState(false);
  const filteredPolicies=policies.filter(p=>(String(p.title||'')+' '+String(p.category||'')+' '+String(p.version||'')+' '+String(p.status||'')).toLowerCase().includes(query.toLowerCase()));
  const reset=()=>{setForm(emptyForm);setEditingId('');};
  const save=async()=>{if(!form.title.trim()||form.body.trim().length<20||busy)return;setBusy(true);try{await runAction(async()=>{const payload={...form,title:form.title.trim(),category:form.category.trim()||'People',version:form.version.trim()||'1.0',body:form.body.trim()};if(editingId)await patch('/enterprise/admin/policies/'+editingId,payload);else await post('/enterprise/admin/policies',payload);reset();});}finally{setBusy(false)}};
  const edit=(p)=>{setEditingId(p.id);setForm({title:p.title||'',category:p.category||'People',version:p.version||'1.0',body:p.body||''});};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Policy library</h2><p>Versioned policies with publication and acknowledgement coverage.</p></div><span className="enterprise-heading-actions">{filteredPolicies.length} policies</span></div><div className="enterprise-toolbar"><input className="input" aria-label="Search policies" placeholder="Search title, category, version or status" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="policy-list">{filteredPolicies.map(p=><div className="policy-row" key={p.id}><div><b>{p.title}</b><small>{p.category} · v{p.version} · {Number(p.acknowledgements||0)}/{Number(p.active_people||0)} acknowledged</small></div><Status value={p.status}/><div className="policy-row-actions"><button className="button button-secondary button-sm" type="button" onClick={()=>edit(p)}>Edit</button><button className="button button-secondary button-sm" type="button" onClick={()=>runAction(()=>patch('/enterprise/admin/policies/'+p.id,{status:p.status==='PUBLISHED'?'ARCHIVED':'PUBLISHED'}))}>{p.status==='PUBLISHED'?'Archive':p.status==='ARCHIVED'?'Republish':'Publish'}</button></div></div>)}{!filteredPolicies.length&&<div className="enterprise-empty-row">{policies.length?'No policies match your search.':'No policies yet. Create a draft to start the policy library.'}</div>}</div></section>
  <section className="card"><div className="card-heading"><div><h2>{editingId?'Edit policy':'Create policy'}</h2><p>{editingId?'Update the selected policy while preserving its publication state.':'Create a draft. Publish only after the content has been reviewed.'}</p></div>{editingId&&<button className="button button-secondary button-sm" type="button" onClick={reset}>Cancel</button>}</div><div className="form-stack"><label className="enterprise-field-label">Policy title<input className="input" placeholder="e.g. Information Security Policy" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><div className="enterprise-form-pair"><label className="enterprise-field-label">Category<input className="input" placeholder="People" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label><label className="enterprise-field-label">Version<input className="input" placeholder="1.0" value={form.version} onChange={e=>setForm({...form,version:e.target.value})}/></label></div><label className="enterprise-field-label">Policy content<textarea className="input enterprise-textarea" placeholder="Write clear policy guidance (at least 20 characters)." value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/><small>{form.body.length}/20,000 characters · minimum 20</small></label><button className="button button-primary" type="button" disabled={busy||!form.title.trim()||form.body.trim().length<20} onClick={save}>{busy?'Saving…':editingId?'Save changes':'Create draft'}</button></div></section></div>;
}

function Offboarding({rows,people,reload,runAction}) {
  const [employeeId,setEmployeeId]=useState(people.find(p=>p.role!=='ADMIN')?.id||''),[type,setType]=useState('RESIGNATION'),[date,setDate]=useState(today()),[reason,setReason]=useState(''),[query,setQuery]=useState('');
  const filteredRows=rows.filter(r=>(String(r.full_name||'')+' '+String(r.employee_code||'')+' '+String(r.separation_type||'')+' '+String(r.status||'')).toLowerCase().includes(query.toLowerCase()));
  const create=async()=>{if(!employeeId||!date)return;await runAction(async()=>{await post('/enterprise/admin/separations',{employeeId,separationType:type,lastWorkingDate:date,reason:reason.trim()});setReason('');});};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Offboarding</h2><p>Controlled separation cases with status and last-working-day visibility.</p></div></div><div className="enterprise-toolbar"><input className="input" aria-label="Search separation cases" placeholder="Search employee, ID, case type or status" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Employee</span><span>Type</span><span>Last working day</span><span>Status</span></div>{filteredRows.map(r=><div className="enterprise-tr enterprise-row" key={r.id}><span><b>{r.full_name}</b><small>{r.employee_code}</small></span><span>{String(r.separation_type||'').replaceAll('_',' ')}</span><span>{formatDate(r.last_working_date)}</span><span><select aria-label={'Status for '+r.full_name} className="enterprise-select" value={r.status} onChange={async e=>{const status=e.target.value;if(status==='COMPLETED'&&!window.confirm('Complete offboarding for '+r.full_name+'? This immediately deactivates the employee account and revokes existing sessions. Confirm only after HR has completed the exit checks.')){e.target.value=r.status;return;}if(status==='CANCELLED'&&!window.confirm('Cancel the separation case for '+r.full_name+'?')){e.target.value=r.status;return;}await runAction(()=>patch('/enterprise/admin/separations/'+r.id,{status}));}}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Complete · deactivate account</option><option value="CANCELLED">Cancel case</option></select></span></div>)}{!filteredRows.length&&<div className="enterprise-empty-row">{rows.length?'No cases match your search.':'No separation cases have been started.'}</div>}</div></section>
  <section className="card"><div className="card-heading"><div><h2>Start separation</h2><p>Create the HR case before deactivating an account.</p></div></div><div className="form-stack"><select className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{people.filter(p=>p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select><select className="input" value={type} onChange={e=>setType(e.target.value)}><option>RESIGNATION</option><option>TERMINATION</option><option>CONTRACT_END</option><option>RETIREMENT</option><option>OTHER</option></select><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/><textarea className="input" placeholder="Reason (optional)" value={reason} onChange={e=>setReason(e.target.value)}/><button className="button button-primary" onClick={create}>Start offboarding</button></div></section></div>;
}

function Security({security,people,readiness,reload,runAction}) {
  const [employeeId,setEmployeeId]=useState(''); const target=people.find(p=>p.id===employeeId);
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Security control plane</h2><p>Session revocation and production readiness in one view.</p></div><Status value="PROTECTED"/></div><div className="enterprise-metrics"><Metric label="Active accounts" value={security?.accountSummary?.active||0}/><Metric label="Inactive accounts" value={security?.accountSummary?.inactive||0}/><Metric label="Active admins" value={security?.accountSummary?.activeAdmins||0}/><Metric label="Readiness" value={readiness?.status||'—'}/></div></section>
  <section className="card"><div className="card-heading"><div><h2>Revoke session</h2><p>Force an employee to authenticate again.</p></div></div><div className="form-stack"><select className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{people.filter(p=>p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select><button className="button button-secondary" disabled={!target} onClick={()=>runAction(()=>post('/enterprise/admin/security/revoke/'+target.id))}>Revoke active session</button></div></section>
  <section className="card enterprise-wide"><div className="card-heading"><div><h2>Recent security activity</h2><p>Top audit actions over seven days.</p></div></div><div className="readiness-list">{(security?.recentActions||[]).map(r=><div key={r.action}><b>{r.action.replaceAll('_',' ')}</b><span>{r.total}</span><small>{formatDate(r.last_at)}</small></div>)}</div></section></div>;
}

function HistoryModal({employee,save,close}) {
  const [type,setType]=useState('PROMOTED'),[date,setDate]=useState(today()),[title,setTitle]=useState(employee?.title||''),[department,setDepartment]=useState(employee?.department||''),[branch,setBranch]=useState(employee?.branch||''),[notes,setNotes]=useState('');
  return <Modal title={'Lifecycle event · '+(employee?.full_name||'Employee')} close={close}><div className="form-stack"><select className="input" value={type} onChange={e=>setType(e.target.value)}><option>PROMOTED</option><option>TRANSFERRED</option><option>ROLE_CHANGED</option><option>PROBATION_COMPLETED</option><option>STATUS_CHANGED</option><option>OTHER</option></select><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/><input className="input" placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)}/><input className="input" placeholder="Department" value={department} onChange={e=>setDepartment(e.target.value)}/><input className="input" placeholder="Branch" value={branch} onChange={e=>setBranch(e.target.value)}/><textarea className="input" placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/><button className="button button-primary" onClick={()=>save({eventType:type,effectiveDate:date,title,department,branch,notes})}>Save event</button></div></Modal>;
}
function ContactModal({save,close}) {
  const [name,setName]=useState(''),[relationship,setRelationship]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState(''),[primary,setPrimary]=useState(false);
  return <Modal title="Emergency contact" close={close}><div className="form-stack"><input className="input" placeholder="Contact name" value={name} onChange={e=>setName(e.target.value)}/><input className="input" placeholder="Relationship" value={relationship} onChange={e=>setRelationship(e.target.value)}/><input className="input" placeholder="Phone" value={phone} onChange={e=>setPhone(e.target.value)}/><input className="input" placeholder="Email (optional)" value={email} onChange={e=>setEmail(e.target.value)}/><label className="check-label"><input type="checkbox" checked={primary} onChange={e=>setPrimary(e.target.checked)}/> Primary contact</label><button className="button button-primary" disabled={!name||!relationship||!phone} onClick={()=>save({contactName:name,relationship,phone,email:email||null,isPrimary:primary})}>Save contact</button></div></Modal>;
}
function DocumentModal({save,close}) {
  const [file,setFile]=useState(null),[type,setType]=useState('ID_PROOF'),[title,setTitle]=useState(''),[issued,setIssued]=useState(''),[expires,setExpires]=useState('');
  const submit=()=>{const form=new FormData();form.append('document',file);form.append('documentType',type);form.append('title',title);if(issued)form.append('issuedOn',issued);if(expires)form.append('expiresOn',expires);save(form);};
  return <Modal title="Upload HR document" close={close}><div className="form-stack"><input className="input" placeholder="Document title" value={title} onChange={e=>setTitle(e.target.value)}/><input className="input" placeholder="Document type" value={type} onChange={e=>setType(e.target.value)}/><input className="input" type="date" value={issued} onChange={e=>setIssued(e.target.value)}/><input className="input" type="date" value={expires} onChange={e=>setExpires(e.target.value)}/><input className="input" type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="button button-primary" disabled={!file||!title} onClick={submit}>Upload securely</button></div></Modal>;
}

export function EmployeePoliciesPage() {
  const [policies,setPolicies]=useState([]);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [actionError,setActionError]=useState('');
  const [successMessage,setSuccessMessage]=useState('');
  const [busyId,setBusyId]=useState(null);
  const policyRequest=useRef(0);

  const load=async()=>{
    const requestId=++policyRequest.current;
    setLoading(true);
    setLoadError('');
    setActionError('');
    setSuccessMessage('');
    try {
      const result=await get('/enterprise/policies');
      if(requestId!==policyRequest.current)return;
      setPolicies(Array.isArray(result.policies)?result.policies:[]);
    } catch(e) {
      if(requestId===policyRequest.current)setLoadError(e.message||'Could not load published policies.');
    } finally {
      if(requestId===policyRequest.current)setLoading(false);
    }
  };

  useEffect(()=>{
    void load();
    return ()=>{policyRequest.current+=1;};
  },[]);

  const acknowledged=(policy)=>policy.acknowledged===true||Number(policy.acknowledged)===1;
  const pendingCount=policies.filter((policy)=>!acknowledged(policy)).length;

  const ack=async(id)=>{
    if(busyId)return;
    setBusyId(id);setActionError('');setSuccessMessage('');
    try {
      await post('/enterprise/policies/'+id+'/acknowledge');
      setPolicies((current)=>current.map((policy)=>policy.id===id?{...policy,acknowledged:1}:policy));
      setSuccessMessage('Your acknowledgement has been recorded.');
    } catch(e) {
      setActionError(e.message||'Could not acknowledge this policy. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return <div className="enterprise-page employee-policy-page">
    <section className="enterprise-hero employee-policy-hero">
      <div><div className="eyebrow">PEOPLE · POLICY CENTER</div><h1>Policies that stay clear.</h1><p>Read current company policies, see the latest version, and acknowledge what requires your attention.</p></div>
      <div className="employee-policy-hero-mark" aria-hidden="true"><ShieldCheck size={34}/><span>PEOPLE<br/>· TRUST ·</span></div>
    </section>

    <section className="card employee-policies-panel" aria-busy={loading}>
      <div className="employee-policy-panel-head">
        <div><div className="eyebrow">YOUR POLICY LIBRARY</div><h2>Published policies</h2><p>Current guidance from your HR team, in one place.</p></div>
        <button className="button button-soft button-small" type="button" onClick={()=>void load()} disabled={loading||busyId!==null}><RefreshCw size={15}/> Refresh</button>
      </div>

      {!loading&&!loadError&&<div className="employee-policy-summary" aria-label="Policy summary">
        <div><span>Published</span><b>{policies.length}</b><small>Current company policies</small></div>
        <div><span>Needs acknowledgement</span><b>{pendingCount}</b><small>{pendingCount===1?'One policy':'Policies'} awaiting your review</small></div>
        <div><span>Completed</span><b>{policies.length-pendingCount}</b><small>Already acknowledged</small></div>
      </div>}

      {loadError&&<div className="employee-policy-error" role="alert">
        <span className="employee-policy-error-icon"><CircleAlert size={20}/></span>
        <div><h2>We couldn’t load your policies</h2><p>{loadError}</p><p className="employee-policy-error-help">Retry the request. If the problem continues, share the error reference with your HR administrator.</p><button className="button button-soft button-small" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Try again</button></div>
      </div>}
      {actionError&&<div className="employee-policy-inline-error" role="alert"><CircleAlert size={16}/><span>{actionError}</span></div>}
      {successMessage&&<div className="employee-policy-inline-success" role="status"><Check size={16}/><span>{successMessage}</span></div>}

      {loading?<div className="loading-panel employee-policy-loading" role="status"><span className="spinner"/><p>Loading published policies…</p></div>
      :!loadError&&policies.length? <div className="employee-policy-list">{policies.map((p)=><article className="employee-policy-card" key={p.id}>
          <div className="employee-policy-content"><div className="employee-policy-meta"><span className="eyebrow">{p.category||'COMPANY POLICY'}</span><span className="policy-version">Version {p.version||'1'}</span></div><h2>{p.title}</h2><p className="policy-body">{p.body}</p>{p.published_at&&<small className="employee-policy-published">Published {formatDate(p.published_at)}</small>}</div>
          <div className="policy-actions">{acknowledged(p)?<span className="employee-policy-acknowledged"><Check size={15}/> Acknowledged</span>:<button className="button button-primary" type="button" disabled={busyId===p.id||busyId!==null} aria-busy={busyId===p.id||undefined} onClick={()=>void ack(p.id)}>{busyId===p.id?<><span className="spinner"/> Saving…</>:'Acknowledge'}</button>}</div>
        </article>)}</div>
      :!loadError?<div className="empty-state employee-policy-empty"><span className="empty-icon"><FileText size={21}/></span><h3>No published policies</h3><p>Your HR team has not published a policy yet. When a policy is shared, it will appear here for you to read and acknowledge.</p><button className="button button-soft button-small" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh policies</button></div>:null}
    </section>
  </div>;
}
