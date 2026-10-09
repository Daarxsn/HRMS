// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BriefcaseBusiness, CalendarClock, Check, FileText, Laptop, LockKeyhole, Plus, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
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
  const loadLifecycle=async(id)=>{
    if(!id)return;
    try { setLifecycle(await get('/enterprise/admin/employees/'+id+'/lifecycle')); } catch(e) { setNotice(e.message||'Could not load employee lifecycle.'); }
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
    {tab==='overview'&&<Overview data={data} readiness={data.readiness}/>}
    {tab==='people'&&<People people={people} selectedId={selectedId} setSelectedId={setSelectedId} lifecycle={lifecycle} openHistory={()=>setModal('history')} openContact={()=>setModal('contact')} openDocument={()=>setModal('document')}/>}
    {tab==='onboarding'&&<Onboarding people={people} reload={load} />}
    {tab==='assets'&&<Assets assets={data.assets||[]} people={people} reload={load}/>}
    {tab==='policies'&&<Policies policies={data.policies||[]} reload={load}/>}
    {tab==='offboarding'&&<Offboarding rows={data.separations||[]} people={people} reload={load}/>}
    {tab==='security'&&<Security security={data.security} people={people} readiness={data.readiness} reload={load}/>}
    {modal==='history'&&<HistoryModal employee={lifecycle?.employee} save={(body)=>act(()=>post('/enterprise/admin/employees/'+selectedId+'/history',body))} close={()=>setModal(null)}/>}
    {modal==='contact'&&<ContactModal save={(body)=>act(()=>post('/enterprise/admin/employees/'+selectedId+'/emergency-contacts',body))} close={()=>setModal(null)}/>}
    {modal==='document'&&<DocumentModal save={(form)=>act(()=>post('/enterprise/admin/employees/'+selectedId+'/documents',form))} close={()=>setModal(null)}/>}
    {notice&&<div className="enterprise-toast" role="status" onClick={()=>setNotice('')}>{notice}<X size={14}/></div>}
  </div>;
}

function Overview({data,readiness}) {
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
    <section className="card enterprise-wide"><div className="card-heading"><div><h2>Next 60 days</h2><p>Lifecycle items already visible to HR.</p></div></div><div className="enterprise-attention">
      {(o?.upcomingProbation||[]).slice(0,4).map(p=><div className="attention-item" key={p.id}><span className="attention-icon"><CalendarClock size={17}/></span><div><b>{p.full_name}</b><small>Probation · {formatDate(p.probation_end_date)}</small></div><ArrowRight size={15}/></div>)}
      {(o?.missingDocuments||[]).slice(0,4).map(p=><div className="attention-item" key={'doc-'+p.id}><span className="attention-icon"><FileText size={17}/></span><div><b>{p.full_name}</b><small>HR document coverage gap</small></div><ArrowRight size={15}/></div>)}
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

function Onboarding({people,reload}) {
  const [employeeId,setEmployeeId]=useState(people[0]?.id||''),[tasks,setTasks]=useState([]),[title,setTitle]=useState(''),[category,setCategory]=useState('GENERAL'),[due,setDue]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{if(employeeId){const r=await get('/enterprise/admin/employees/'+employeeId+'/lifecycle');setTasks(r.tasks||[]);}};
  useEffect(()=>{load();},[employeeId]);
  const add=async()=>{setBusy(true);try{await post('/enterprise/admin/employees/'+employeeId+'/onboarding',{title,category,dueDate:due||null});setTitle('');setDue('');await load();await reload();}catch(e){alert(e.message)}finally{setBusy(false)}};
  return <section className="card"><div className="card-heading"><div><h2>Onboarding command</h2><p>Create a checklist for every joiner and move each task through a visible state.</p></div></div>
    <div className="enterprise-toolbar"><select className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{people.map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select></div>
    <div className="enterprise-inline-form"><input className="input" placeholder="Task title" value={title} onChange={e=>setTitle(e.target.value)}/><input className="input" placeholder="Category" value={category} onChange={e=>setCategory(e.target.value)}/><input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/><button className="button button-primary" disabled={!title.trim()||busy} onClick={add}><Plus size={16}/> Add</button></div>
    <div className="enterprise-checklist">{tasks.map(t=><div className="check-row" key={t.id}><span className={'check-circle '+(t.status==='COMPLETED'?'done':'')}>{t.status==='COMPLETED'?<Check size={13}/>:null}</span><div><b>{t.title}</b><small>{t.category}{t.due_date?' · Due '+formatDate(t.due_date):''}</small></div><select value={t.status} onChange={async e=>{await patch('/enterprise/admin/onboarding/'+t.id,{status:e.target.value});load();reload();}}><option>PENDING</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>BLOCKED</option></select></div>)}</div>
  </section>;
}

function Assets({assets,people,reload}) {
  const [form,setForm]=useState({tag:'',name:'',category:'Laptop',serial:'',notes:''}); const [busy,setBusy]=useState(false);
  const save=async()=>{setBusy(true);try{await post('/enterprise/admin/assets',{assetTag:form.tag,name:form.name,category:form.category,serialNumber:form.serial,notes:form.notes});setForm({tag:'',name:'',category:'Laptop',serial:'',notes:''});reload();}catch(e){alert(e.message)}finally{setBusy(false)}};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Asset register</h2><p>Track equipment from available → assigned → repair → retired.</p></div></div><div className="enterprise-metrics"><Metric label="Available" value={assets.filter(a=>a.status==='AVAILABLE').length}/><Metric label="Assigned" value={assets.filter(a=>a.status==='ASSIGNED').length}/><Metric label="Repair" value={assets.filter(a=>a.status==='REPAIR').length}/><Metric label="Retired" value={assets.filter(a=>a.status==='RETIRED').length}/></div></section>
  <section className="card"><div className="card-heading"><div><h2>Register asset</h2><p>Create the asset before handing it over.</p></div></div><div className="form-stack"><input className="input" placeholder="Asset tag" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/><input className="input" placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input className="input" placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/><input className="input" placeholder="Serial number" value={form.serial} onChange={e=>setForm({...form,serial:e.target.value})}/><button className="button button-primary" disabled={busy||!form.tag||!form.name} onClick={save}>Register asset</button></div></section>
  <section className="card enterprise-wide"><div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Asset</span><span>Category</span><span>Assignee</span><span>Status</span></div>{assets.map(a=><div className="enterprise-tr enterprise-row" key={a.id}><span><b>{a.name}</b><small>{a.asset_tag} · {a.serial_number||'No serial'}</small></span><span>{a.category}</span><span><select className="enterprise-select" value={a.assigned_employee_id||''} onChange={async e=>{await patch('/enterprise/admin/assets/'+a.id,{assignedEmployeeId:e.target.value||null});reload();}}><option value="">Unassigned</option>{people.filter(p=>p.status==='ACTIVE'&&p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></span><span><Status value={a.status}/></span></div>)}</div></section></div>;
}

function Policies({policies,reload}) {
  const [form,setForm]=useState({title:'',category:'People',version:'1.0',body:''}); const create=async()=>{try{await post('/enterprise/admin/policies',form);setForm({title:'',category:'People',version:'1.0',body:''});reload();}catch(e){alert(e.message)}};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Policy center</h2><p>Versioned policies with publication and acknowledgement coverage.</p></div></div><div className="policy-list">{policies.map(p=><div className="policy-row" key={p.id}><div><b>{p.title}</b><small>{p.category} · v{p.version} · {p.acknowledgements}/{p.active_people} acknowledged</small></div><Status value={p.status}/><button className="button button-secondary button-sm" onClick={async()=>{await patch('/enterprise/admin/policies/'+p.id,{status:p.status==='PUBLISHED'?'ARCHIVED':'PUBLISHED'});reload();}}>{p.status==='PUBLISHED'?'Archive':'Publish'}</button></div>)}</div></section>
  <section className="card"><div className="card-heading"><div><h2>Create policy</h2><p>Keep substantive changes versioned.</p></div></div><div className="form-stack"><input className="input" placeholder="Title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/><input className="input" placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/><input className="input" placeholder="Version" value={form.version} onChange={e=>setForm({...form,version:e.target.value})}/><textarea className="input enterprise-textarea" placeholder="Policy content" value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/><button className="button button-primary" disabled={!form.title||form.body.length<20} onClick={create}>Save draft</button></div></section></div>;
}

function Offboarding({rows,people,reload}) {
  const [employeeId,setEmployeeId]=useState(people.find(p=>p.role!=='ADMIN')?.id||''),[type,setType]=useState('RESIGNATION'),[date,setDate]=useState(today()),[reason,setReason]=useState('');
  const create=async()=>{try{await post('/enterprise/admin/separations',{employeeId,separationType:type,lastWorkingDate:date,reason});setReason('');reload();}catch(e){alert(e.message)}};
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Offboarding</h2><p>Controlled separation cases with status and last-working-day visibility.</p></div></div><div className="enterprise-table"><div className="enterprise-tr enterprise-th"><span>Employee</span><span>Type</span><span>Last working day</span><span>Status</span></div>{rows.map(r=><div className="enterprise-tr enterprise-row" key={r.id}><span><b>{r.full_name}</b><small>{r.employee_code}</small></span><span>{r.separation_type}</span><span>{formatDate(r.last_working_date)}</span><span><select className="enterprise-select" value={r.status} onChange={async e=>{await patch('/enterprise/admin/separations/'+r.id,{status:e.target.value});reload();}}><option>OPEN</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>CANCELLED</option></select></span></div>)}</div></section>
  <section className="card"><div className="card-heading"><div><h2>Start separation</h2><p>Create the HR case before deactivating an account.</p></div></div><div className="form-stack"><select className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{people.filter(p=>p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select><select className="input" value={type} onChange={e=>setType(e.target.value)}><option>RESIGNATION</option><option>TERMINATION</option><option>CONTRACT_END</option><option>RETIREMENT</option><option>OTHER</option></select><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/><textarea className="input" placeholder="Reason (optional)" value={reason} onChange={e=>setReason(e.target.value)}/><button className="button button-primary" onClick={create}>Start offboarding</button></div></section></div>;
}

function Security({security,people,readiness,reload}) {
  const [employeeId,setEmployeeId]=useState(''); const target=people.find(p=>p.id===employeeId);
  return <div className="enterprise-grid"><section className="card enterprise-wide"><div className="card-heading"><div><h2>Security control plane</h2><p>Session revocation and production readiness in one view.</p></div><Status value="PROTECTED"/></div><div className="enterprise-metrics"><Metric label="Active accounts" value={security?.accountSummary?.active||0}/><Metric label="Inactive accounts" value={security?.accountSummary?.inactive||0}/><Metric label="Active admins" value={security?.accountSummary?.activeAdmins||0}/><Metric label="Readiness" value={readiness?.status||'—'}/></div></section>
  <section className="card"><div className="card-heading"><div><h2>Revoke session</h2><p>Force an employee to authenticate again.</p></div></div><div className="form-stack"><select className="input" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{people.filter(p=>p.role!=='ADMIN').map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.employee_code}</option>)}</select><button className="button button-secondary" disabled={!target} onClick={async()=>{await post('/enterprise/admin/security/revoke/'+target.id);reload();}}>Revoke active session</button></div></section>
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
  const [policies,setPolicies]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=async()=>{try{setPolicies((await get('/enterprise/policies')).policies||[]);}catch(e){setError(e.message||'Could not load policies.')}finally{setLoading(false)}};
  useEffect(()=>{load();},[]);
  const ack=async(id)=>{try{await post('/enterprise/policies/'+id+'/acknowledge');load();}catch(e){setError(e.message)}};
  return <div className="enterprise-page"><section className="enterprise-hero"><div><div className="eyebrow">PEOPLE · POLICY CENTER</div><h1>Policies that stay clear.</h1><p>Read current company policies, see the latest version, and acknowledge what requires your attention.</p></div></section><section className="card">{loading?<div className="loading-panel"><span className="spinner"/><p>Loading policies…</p></div>:error?<><h2>Policy center unavailable</h2><p>{error}</p></>:policies.length?policies.map(p=><article className="employee-policy-card" key={p.id}><div><div className="eyebrow">{p.category} · v{p.version}</div><h2>{p.title}</h2><p className="policy-body">{p.body}</p></div><div className="policy-actions">{p.acknowledged?<span className="status status-active"><i className="status-dot"/>Acknowledged</span>:<button className="button button-primary" onClick={()=>ack(p.id)}>Acknowledge</button>}</div></article>):<div className="empty-state"><span className="empty-icon"><FileText size={20}/></span><h3>No published policies</h3><p>Your HR team has not published a policy yet.</p></div>}</section></div>;
}
