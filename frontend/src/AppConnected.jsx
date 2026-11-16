import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, Bell, BookOpen, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, ClipboardCheck, Clock3, FileText, Flower2,
  LayoutDashboard, LogOut, Menu, Plus, Settings2, Sparkles, Users, X,
} from 'lucide-react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, download } from './services/api.js';

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);
const tones = ['coral', 'mint', 'lilac', 'yellow', 'blue'];

function formatDue(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function mapClassroom(room, index) {
  return { ...room, title: room.name, grade: room.grade_level, code: room.joining_code, students: room.student_count, color: tones[index % tones.length] };
}

function mapAssignment(item, index) {
  const due = new Date(item.due_at);
  const status = item.released_at ? 'Results released'
    : Number(item.pending_count) > 0 ? 'Evaluating'
      : Number(item.evaluated_count) > 0 ? 'Review needed'
        : due < new Date() ? (item.submission_count ? 'Evaluating' : 'No submissions')
          : item.submission_count ? 'Evaluating' : 'Open';
  return { ...item, classroom: item.classroom_name, submitted: item.submission_count, total: item.student_count, due: formatDue(item.due_at), status, points: Number(item.max_marks || 0), tone: tones[index % tones.length] };
}

async function loadWorkspace(user) {
  const [classroomResponse, assignmentResponse] = await Promise.all([api('/classrooms'), api('/assignments')]);
  const classrooms = classroomResponse.classrooms.map(mapClassroom);
  const assignments = assignmentResponse.assignments.map(mapAssignment);
  if (user.role === 'teacher') {
    const reviewGroups = await Promise.all(assignments.filter((item) => Number(item.submission_count) > 0 && item.status !== 'Results released').map(async (assignment) => {
      const response = await api(`/assignments/${assignment.id}/reviews`);
      return response.reviews.filter((row) => row.submission_id && !row.final_updated_at).map((row) => {
        const suggestionsReady = row.evaluation_status === 'completed' && row.criteria.every((criterion) => Number.isFinite(Number(criterion.suggestedMarks)));
        const score = suggestionsReady ? row.criteria.reduce((sum, criterion) => sum + Number(criterion.suggestedMarks), 0) : null;
        return {
          id: row.student_id, studentId: row.student_id, submissionId: row.submission_id,
          assignmentId: assignment.id, name: row.student_name,
          initials: row.student_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
          assignment: assignment.title, submitted: formatDue(row.submitted_at), score,
          max: row.criteria.reduce((sum, criterion) => sum + Number(criterion.maxMarks), 0),
          color: tones[indexFromName(row.student_name) % tones.length],
          state: ['pending', 'processing'].includes(row.job_status) ? 'Evaluating'
            : suggestionsReady ? 'AI suggestion ready' : 'Needs manual grading',
          evaluationError: row.evaluation_error,
          criteria: row.criteria,
        };
      });
    }));
    const templateResponse = await api('/rubric-templates');
    return { classrooms, assignments, reviews: reviewGroups.flat(), templates: templateResponse.templates, results: [] };
  }
  const resultResponse = await api('/me/results');
  return { classrooms, assignments, reviews: [], templates: [], results: resultResponse.results };
}

function indexFromName(name) {
  return [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function AppConnected() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [data, setData] = useState({ classrooms: [], assignments: [], reviews: [], templates: [], results: [] });
  const [dataLoading, setDataLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [reloadId, setReloadId] = useState(0);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    let active = true;
    api('/auth/csrf').then(() => api('/auth/me')).then(({ user: currentUser }) => {
      if (active) setUser(currentUser);
    }).catch((error) => {
      if (active && !String(error.message).toLowerCase().includes('sign in')) setConnectionError(error.message);
    }).finally(() => active && setAuthReady(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    setDataLoading(true);
    loadWorkspace(user).then((workspace) => active && setData(workspace)).catch((error) => active && notify(error.message)).finally(() => active && setDataLoading(false));
    return () => { active = false; };
  }, [user, reloadId]);

  const reloadData = () => setReloadId((current) => current + 1);
  const context = useMemo(() => ({ ...data, role: user?.role, user, setModal, notify, reloadData, setUser }), [data, user]);

  if (!authReady) return <div className="auth-loading"><Flower2 size={26} /><span>Getting your workspace ready...</span></div>;
  if (connectionError) return <AuthScreen connectionError={connectionError} onRetry={() => window.location.reload()} />;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return <AppContext.Provider value={context}>
    <div className="app-shell">
      <Sidebar mobileNav={mobileNav} closeMobile={() => setMobileNav(false)} />
      <main className="main-shell">
        <Topbar onMenu={() => setMobileNav(!mobileNav)} onNotify={notify} />
        <div className="demo-banner"><CheckCircle2 size={14} /> Connected workspace <span>{dataLoading ? 'Refreshing your latest data...' : 'Your school data is saved securely'}</span></div>
        <div className="page-wrap">
          <Routes>
            <Route path="/" element={user.role === 'teacher' ? <Dashboard /> : <StudentHome />} />
            <Route path="/classrooms" element={<Classrooms />} />
            <Route path="/assignments" element={user.role === 'teacher' ? <Assignments /> : <StudentAssignments />} />
            <Route path="/rubrics" element={user.role === 'teacher' ? <Rubrics /> : <StudentResults />} />
            <Route path="/review" element={user.role === 'teacher' ? <ReviewPage /> : <StudentResults />} />
            <Route path="/results" element={<StudentResults />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </div>
      </main>
      {modal && <Modal onClose={() => setModal(null)} modal={modal} />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  </AppContext.Provider>;
}

function AuthScreen({ onAuthenticated, connectionError, onRetry }) {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('teacher');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const path = mode === 'login' ? '/auth/login' : `/auth/register/${role}`;
      const response = await api(path, { method: 'POST', body: { name, email, password } });
      onAuthenticated(response.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  };

  return <main className="auth-page"><section className="auth-art"><NavLink to="/" className="brand"><span className="brand-mark"><Flower2 size={22} /></span><span className="brand-word">mochi<span>mark</span><small>little steps, lovely feedback</small></span></NavLink><div className="auth-message"><span className="tiny-label">A LITTLE MORE TIME FOR TEACHING</span><h1>Thoughtful grading,<br />with a softer landing.</h1><p>A calm place to collect work, give kind feedback, and help every student keep growing.</p><div className="auth-sticker"><span>✿</span><b>good things grow<br />one note at a time</b><i>✦</i></div></div><div className="auth-footnote">Made for the people who make learning matter.</div></section><section className="auth-form-side"><div className="auth-form-wrap"><div className="auth-mobile-brand"><span className="brand-mark"><Flower2 size={21} /></span><span className="brand-word">mochi<span>mark</span></span></div><div className="eyebrow">WELCOME TO MOCHIMARK</div><h2>{connectionError ? 'Your workspace is taking a nap' : mode === 'login' ? 'Welcome back' : 'Let’s get started'}</h2><p className="auth-description">{connectionError || (mode === 'login' ? 'Sign in to pick up where you left off.' : 'Make an account for your learning community.')}</p>{connectionError ? <button className="button button-primary auth-submit" onClick={onRetry}>Try again</button> : <form onSubmit={submit}>{mode === 'register' && <><div className="field-label">I’m joining as</div><div className="role-tabs"><button type="button" className={role === 'teacher' ? 'selected' : ''} onClick={() => setRole('teacher')}>Teacher</button><button type="button" className={role === 'student' ? 'selected' : ''} onClick={() => setRole('student')}>Student</button></div><label className="field-label" htmlFor="auth-name">Full name</label><input id="auth-name" className="input-control" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></>}<label className="field-label" htmlFor="auth-email">Email address</label><input id="auth-email" className="input-control" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /><label className="field-label" htmlFor="auth-password">Password <span>{mode === 'register' ? 'At least 10 characters' : ''}</span></label><input id="auth-password" className="input-control" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'register' ? 10 : 1} maxLength={200} />{error && <div className="auth-error" role="alert">{error}</div>}<button className="button button-primary auth-submit" disabled={pending}>{pending ? 'One moment...' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button><p className="auth-mode-switch">{mode === 'login' ? 'New to MochiMark?' : 'Already have an account?'} <button type="button" onClick={() => { setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p></form>}<div className="auth-privacy"><CheckCircle2 size={15} /> Your classroom stays private and teacher-led.</div></div></section></main>;
}

function Sidebar({ mobileNav, closeMobile }) {
  const { role, user, notify, setUser } = useApp();
  const navigate = useNavigate();
  const links = role === 'teacher'
    ? [{ to: '/', label: 'Overview', icon: LayoutDashboard, end: true }, { to: '/classrooms', label: 'My classrooms', icon: Users }, { to: '/assignments', label: 'Assignments', icon: BookOpen }, { to: '/rubrics', label: 'Rubric studio', icon: ClipboardCheck }, { to: '/review', label: 'Review queue', icon: CheckCircle2 }]
    : [{ to: '/', label: 'My home', icon: LayoutDashboard, end: true }, { to: '/classrooms', label: 'My classrooms', icon: Users }, { to: '/assignments', label: 'Assignments', icon: BookOpen }, { to: '/results', label: 'My results', icon: ClipboardCheck }];
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); setUser(null); navigate('/'); }
    catch (error) { notify(error.message); }
  };
  return <>
    {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <NavLink to="/" className="brand" onClick={closeMobile}><span className="brand-mark"><Flower2 size={22} strokeWidth={2.2} /></span><span className="brand-word">mochi<span>mark</span><small>little steps, lovely feedback</small></span></NavLink>
      <div className="workspace-switch"><span className="workspace-avatar">{user.name[0].toUpperCase()}</span><span><b>{user.name}</b><small>{role === 'teacher' ? 'Teacher workspace' : 'Student workspace'}</small></span><ChevronDown size={16} /></div>
      <p className="nav-caption">WORKSPACE</p>
      <nav className="side-nav">{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={closeMobile} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      {role === 'teacher' && <div className="sidebar-nudge"><span className="nudge-sticker">✿</span><b>One kind note<br />can change a day.</b><span>Keep the good feedback flowing.</span></div>}
      <div className="sidebar-bottom"><button className="nav-link quiet" onClick={() => notify('For account support, contact your school administrator.')}><CircleHelp size={18} /><span>Help & support</span></button><button className="nav-link quiet" onClick={() => notify('Account settings are managed by your school.')}><Settings2 size={18} /><span>Settings</span></button><div className="profile-row"><span className={`avatar avatar-${role === 'teacher' ? 'coral' : 'mint'}`}>{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><b>{user.name}</b><small>{user.role}</small></span><button aria-label="Sign out" className="icon-button tiny" onClick={logout}><LogOut size={16} /></button></div></div>
    </aside>
  </>;
}

function Topbar({ onMenu, onNotify }) {
  const location = useLocation();
  const { role } = useApp();
  const titles = { '/': role === 'teacher' ? 'Your little corner' : 'Your learning nook', '/classrooms': 'Classrooms', '/assignments': 'Assignments', '/rubrics': role === 'teacher' ? 'Rubric studio' : 'My results', '/review': 'Review work', '/results': 'My results' };
  return <header className="topbar"><button className="icon-button mobile-menu" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb">MochiMark <ChevronRight size={14} /><b>{titles[location.pathname] || 'Workspace'}</b></div><div className="top-actions"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => onNotify('You’re all caught up!')}><Bell size={18} /></button></div></header>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function Dashboard() {
  const { classrooms, assignments, reviews, user, setModal } = useApp();
  const active = assignments.filter((item) => !['Results released', 'No submissions'].includes(item.status)).length;
  const ready = reviews.filter((item) => item.state === 'AI suggestion ready').length;
  return <>
    <PageHeading eyebrow={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()} title={<>Good morning, {user.name.split(' ')[0]} <span className="wave">✿</span></>} description="A calm little overview of what’s happening in your classrooms." action={<button className="button button-primary" onClick={() => setModal({ type: 'assignment' })}><Plus size={17} /> New assignment</button>} />
    <section className="welcome-strip"><div className="welcome-copy"><span className="tiny-label">YOUR WEEK AT A GLANCE</span><h2>Your classrooms,<br />all growing along.</h2><p>You have <b>{classrooms.length} classrooms</b> and <b>{reviews.length} submissions</b> waiting for your thoughtful review.</p><NavLink className="text-button" to="/review">See review queue <ArrowRight size={15} /></NavLink></div><div className="welcome-art" aria-hidden="true"><div className="sun-doodle">✳</div><div className="paper-stack"><span>GOOD<br />JOB!</span><i>✦</i></div><div className="little-star star-one">✦</div><div className="little-star star-two">✧</div><div className="art-caption">you’re doing great</div></div><div className="welcome-side"><div className="week-progress"><div className="progress-ring"><span>{ready}<small> ready</small></span></div><div><b>Ready for review</b><small>{reviews.length} submissions need a look</small></div></div><div className="progress-track"><span style={{ width: `${reviews.length ? Math.max(12, ready / reviews.length * 100) : 0}%` }} /></div><div className="welcome-note"><Sparkles size={15} /> AI suggestions are a starting point, never the final word.</div></div></section>
    <section className="stats-grid"><StatCard label="My classrooms" value={classrooms.length} detail="Your learning communities" icon={Users} tone="coral" /><StatCard label="Active assignments" value={active} detail="Across your classrooms" icon={BookOpen} tone="mint" /><StatCard label="Ready to review" value={ready} detail="AI suggestion is available" icon={ClipboardCheck} tone="yellow" /><StatCard label="Needs manual grading" value={reviews.length - ready} detail="Teacher attention needed" icon={Clock3} tone="lilac" /></section>
    <section className="dashboard-grid"><div className="panel assignment-panel"><div className="panel-heading"><div><h2>In the classroom</h2><p>Your assignments at a glance</p></div><NavLink to="/assignments" className="text-link">View all <ArrowRight size={15} /></NavLink></div><div className="assignment-list">{assignments.slice(0, 4).map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}{!assignments.length && <EmptyState title="Your first assignment starts here" detail="Create an assignment for one of your classrooms." />}</div></div><div className="panel review-panel"><div className="panel-heading"><div><h2>A little attention</h2><p>Work waiting for your eyes</p></div><span className="soft-count">{reviews.length}</span></div><div className="review-list">{reviews.slice(0, 4).map((review) => <ReviewRow key={`${review.assignmentId}-${review.id}`} review={review} />)}{!reviews.length && <EmptyState title="Nothing waiting right now" detail="Your review queue will appear here." />}</div><NavLink to="/review" className="button button-outline full-button">Open review queue <ArrowRight size={15} /></NavLink></div></section>
    <section className="panel classes-panel"><div className="panel-heading"><div><h2>Your classrooms</h2><p>Little communities learning together</p></div><NavLink to="/classrooms" className="text-link">All classrooms <ArrowRight size={15} /></NavLink></div><div className="class-card-grid">{classrooms.slice(0, 3).map((room) => <ClassCard key={room.id} room={room} />)}</div></section>
  </>;
}

function StatCard({ label, value, detail, icon: Icon, tone }) { return <article className="stat-card"><span className={`stat-icon icon-${tone}`}><Icon size={19} /></span><div className="stat-value-row"><strong>{value}</strong></div><b>{label}</b><small>{detail}</small></article>; }
function EmptyState({ title, detail }) { return <div className="empty-state"><span>✿</span><b>{title}</b><p>{detail}</p></div>; }

function AssignmentRow({ assignment }) {
  const navigate = useNavigate();
  return <div className="assignment-row"><span className={`subject-icon icon-${assignment.tone}`}><FileText size={17} /></span><div className="assignment-name"><b>{assignment.title}</b><small>{assignment.classroom}</small></div><div className="row-submissions"><small>{assignment.submitted}/{assignment.total} in</small></div><StatusPill status={assignment.status} /><span className="due-label"><Clock3 size={14} />{assignment.due}</span><button className="icon-button row-arrow" aria-label={`Open ${assignment.title}`} onClick={() => navigate('/assignments')}><ChevronRight size={17} /></button></div>;
}

function StatusPill({ status }) {
  const tone = status === 'Review needed' ? 'pill-coral' : status === 'Open' ? 'pill-blue' : status === 'No submissions' ? 'pill-gray' : status === 'Evaluating' ? 'pill-blue' : 'pill-green';
  return <span className={`status-pill ${tone}`}><i />{status}</span>;
}

function ReviewRow({ review }) {
  const { setModal, notify, reloadData } = useApp();
  const retryAi = async () => {
    try {
      await api(`/assignments/${review.assignmentId}/reviews/${review.studentId}/retry-ai`, { method: 'POST', body: {} });
      notify('AI re-check queued for the latest submission.');
      reloadData();
    } catch (error) { notify(error.message); }
  };
  const evaluating = review.state === 'Evaluating';
  const manual = review.score === null && !evaluating;
  return <div className="review-row"><span className={`avatar avatar-${review.color}`}>{review.initials}</span><div className="review-person"><b>{review.name}</b><small>{review.assignment}</small></div><span className={`review-state ${manual ? 'manual-state' : ''}`}>{evaluating ? 'AI checking...' : manual ? 'Manual grading' : `${review.score}/${review.max} suggested`}</span><div className="review-actions">{evaluating ? <span className="review-state">In progress</span> : <>{manual && <button className="button button-small button-outline" onClick={retryAi}>Retry AI</button>}<button className="button button-small button-soft" onClick={() => setModal({ type: 'review', review })}>{manual ? 'Grade manually' : 'Review'} <ArrowRight size={14} /></button></>}</div></div>;
}

function ClassCard({ room }) {
  const { role, setModal } = useApp();
  return <article className={`class-card class-${room.color}`}><div className="class-card-top"><span className="class-subject">{room.subject}</span><button className="icon-button tiny" aria-label="Class options" onClick={() => setModal({ type: 'classroom-manage', room })}><ChevronDown size={16} /></button></div><h3>{room.title}</h3><div className="class-grade">{room.grade}</div><div className="class-card-bottom"><span><Users size={15} /> {room.students} students</span>{role === 'teacher' && <span className="class-code">{room.code}</span>}</div></article>;
}

function Classrooms() {
  const { classrooms, role, setModal } = useApp();
  return <><PageHeading eyebrow="YOUR LEARNING COMMUNITIES" title="Classrooms" description="A cozy place for every group to learn and grow." action={role === 'teacher' ? <button className="button button-primary" onClick={() => setModal({ type: 'classroom' })}><Plus size={17} /> Create classroom</button> : <button className="button button-primary" onClick={() => setModal({ type: 'join' })}><Plus size={17} /> Join classroom</button>} /><div className="classroom-grid">{classrooms.map((room) => <ClassCard key={room.id} room={room} />)}{role === 'teacher' && <button className="add-class-card" onClick={() => setModal({ type: 'classroom' })}><span><Plus size={20} /></span><b>Make a new classroom</b><small>A fresh space for your next group</small></button>}{!classrooms.length && <EmptyState title={role === 'teacher' ? 'Create your first classroom' : 'Join a classroom to begin'} detail={role === 'teacher' ? 'Your students will join with a private code.' : 'Ask your teacher for a joining code.'} />}</div></>;
}

function Assignments() {
  const { assignments, setModal, notify } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [exportId, setExportId] = useState('');
  const filtered = assignments.filter((assignment) => filter === 'All' || (filter === 'Needs review' ? assignment.status === 'Review needed' : assignment.status === filter));
  const released = assignments.filter((assignment) => assignment.status === 'Results released');

  const exportResults = async () => {
    try { await download(`/assignments/${exportId}/results/export`, `results-${exportId}.csv`); }
    catch (error) { notify(error.message); }
  };

  return <>
    <PageHeading eyebrow="PLAN, COLLECT, REVIEW" title="Assignments" description="Everything your students are working on, all in one place."
      action={<div className="heading-actions">
        {released.length > 0 && <><select className="input-control export-select" aria-label="Choose released assignment" value={exportId} onChange={(event) => setExportId(event.target.value)}><option value="">Choose results</option>{released.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.title}</option>)}</select><button className="button button-outline" disabled={!exportId} onClick={exportResults}><ArrowDownToLine size={15} /> Export CSV</button></>}
        <button className="button button-primary" onClick={() => setModal({ type: 'assignment' })}><Plus size={17} /> New assignment</button>
      </div>} />
    <div className="tabs-row">{['All', 'Needs review', 'Open', 'Results released'].map((tab) => <button key={tab} className={`tab-button ${filter === tab ? 'selected' : ''}`} onClick={() => setFilter(tab)}>{tab}<span>{tab === 'All' ? assignments.length : assignments.filter((item) => item.status === (tab === 'Needs review' ? 'Review needed' : tab)).length}</span></button>)}</div>
    <div className="panel table-panel">
      <div className="table-heading"><span>ASSIGNMENT</span><span>CLASSROOM</span><span>SUBMISSIONS</span><span>STATUS</span><span>DUE DATE</span><span /></div>
      {filtered.length ? filtered.map((assignment) => <div className="table-row" key={assignment.id}>
        <div className="table-assignment"><span className={`subject-icon icon-${assignment.tone}`}><FileText size={17} /></span><span><b>{assignment.title}</b><small>{assignment.points} points · Rubric attached</small></span></div>
        <span className="table-class">{assignment.classroom}</span><span className="table-submitted">{assignment.submitted}<small> / {assignment.total}</small></span><StatusPill status={assignment.status} /><span className="table-due">{assignment.due}</span>
        <button className="icon-button row-arrow" aria-label={`Open ${assignment.title}`} onClick={() => navigate('/review')}><ChevronRight size={17} /></button>
      </div>) : <EmptyState title="Nothing here just yet" detail="Try another filter, or make something new." />}
    </div>
  </>;
}

function Rubrics() {
  const { templates, setModal } = useApp();
  return <><PageHeading eyebrow="THOUGHTFUL BY DESIGN" title="Rubric studio" description="Your reusable templates, ready for the next great assignment." action={<button className="button button-primary" onClick={() => setModal({ type: 'rubric' })}><Plus size={17} /> New rubric</button>} /><div className="rubric-note"><span className="note-sparkle"><Sparkles size={17} /></span><span><b>Start with what matters.</b><small>Templates are copied into assignments, so each assignment keeps its own rubric.</small></span></div><div className="rubric-grid">{templates.map((rubric) => <article className="rubric-card" key={rubric.id}><div className="rubric-card-top"><span className="subject-icon icon-lilac"><ClipboardCheck size={18} /></span><button className="icon-button tiny" aria-label="Edit rubric" onClick={() => setModal({ type: 'rubric', initial: rubric })}><ChevronDown size={16} /></button></div><h3>{rubric.name}</h3><div className="rubric-meta"><span>{rubric.criteria.length} criteria</span><i /> <span>{rubric.criteria.reduce((sum, item) => sum + Number(item.maxMarks), 0)} points</span></div><div className="rubric-card-bottom"><small>Saved template</small><button className="text-link" onClick={() => setModal({ type: 'rubric', initial: rubric })}>Edit <ArrowRight size={14} /></button></div></article>)}<button className="add-class-card add-rubric" onClick={() => setModal({ type: 'rubric' })}><span><Plus size={20} /></span><b>Build a rubric</b><small>Make feedback feel a little more you</small></button></div></>;
}

function ReviewPage() {
  const { reviews, assignments, notify, reloadData } = useApp();
  const [filter, setFilter] = useState('All work');
  const visible = reviews.filter((item) => filter === 'All work' || (filter === 'Manual grading' ? item.state === 'Needs manual grading' : item.state === 'AI suggestion ready'));
  const release = async (assignmentId) => {
    try {
      const response = await api(`/assignments/${assignmentId}/confirm-results`, { method: 'POST', body: {} });
      notify(response.state === 'no_submissions' ? 'This assignment has no submissions to release.' : 'Results are now available to students.');
      reloadData();
    } catch (error) { notify(error.message); }
  };
  const releasable = assignments.filter((assignment) => assignment.status === 'Review needed');
  return <><PageHeading eyebrow="YOUR STUDENTS DID THE WORK" title="Review queue" description="Take a look, make it yours, and send thoughtful feedback along." /><div className="review-summary"><div><span className="summary-icon"><ClipboardCheck size={19} /></span><span><b>{reviews.length} submissions need your attention</b><small>AI suggestions are a starting point. You make the final call.</small></span></div><span className="privacy-tag"><CheckCircle2 size={15} /> Teacher review required</span></div><div className="tabs-row">{['All work', 'AI suggestion', 'Manual grading'].map((tab) => <button key={tab} className={`tab-button ${filter === tab ? 'selected' : ''}`} onClick={() => setFilter(tab)}>{tab}<span>{tab === 'All work' ? reviews.length : reviews.filter((item) => tab === 'Manual grading' ? item.state === 'Needs manual grading' : item.state === 'AI suggestion ready').length}</span></button>)}</div><div className="panel queue-panel">{visible.map((review) => <ReviewRow key={`${review.assignmentId}-${review.id}`} review={review} />)}{!visible.length && <EmptyState title="All caught up" detail="There’s nothing waiting in this view." />}</div>{releasable.map((assignment) => <div className="release-callout" key={assignment.id}><span className="release-illustration">✧</span><span><b>{assignment.title}: ready for confirmation?</b><small>Every submitted student needs a final mark before release.</small></span><button className="button button-outline" onClick={() => release(assignment.id)}>Confirm and release <ArrowRight size={15} /></button></div>)}</>;
}

function StudentHome() {
  const { assignments, classrooms, results, setModal, user } = useApp();
  const upcoming = assignments.filter((item) => item.status !== 'Results released');
  const next = upcoming[0];
  return <><PageHeading eyebrow="YOUR LEARNING NOOK" title={<>You’ve got this, {user.name.split(' ')[0]} <span className="wave">✿</span></>} description="A little look at what’s next in your learning journey." action={<button className="button button-outline" onClick={() => setModal({ type: 'join' })}><Plus size={17} /> Join a classroom</button>} />{next ? <section className="student-welcome"><div><span className="tiny-label">YOUR NEXT LITTLE ADVENTURE</span><h2>{next.title}</h2><p>{next.classroom} <i /> Due {next.due}</p><div className="student-actions"><button className="button button-primary" onClick={() => setModal({ type: 'upload', assignment: next })}><ArrowDownToLine size={17} /> Submit your work</button></div></div><div className="student-doodle" aria-hidden="true"><div className="doodle-page"><span>once upon<br />a time...</span><b>✦</b></div><i>✿</i><small>your story starts here</small></div></section> : <EmptyState title="Your next assignment will appear here" detail="Your teacher will share work with your classrooms." />}<div className="student-section-heading"><div><h2>Coming up</h2><p>Little steps, one at a time</p></div><NavLink to="/assignments" className="text-link">All assignments <ArrowRight size={15} /></NavLink></div><div className="student-assignment-list">{assignments.slice(0, 5).map((assignment) => <StudentAssignmentRow key={assignment.id} assignment={assignment} />)}</div><div className="student-bottom-grid"><div className="panel student-class-panel"><div className="panel-heading"><div><h2>Your classrooms</h2><p>Good things grow together</p></div><NavLink to="/classrooms" className="text-link">See all <ArrowRight size={15} /></NavLink></div><div className="student-room-list">{classrooms.map((room) => <div key={room.id}><span className={`room-dot dot-${room.color}`} />{room.title}<small>{room.students} classmates</small></div>)}</div></div><div className="kind-note"><span>✿</span><b>{results.length ? `${results.length} results shared with you.` : 'Your progress is yours to grow.'}</b><small>Only your teacher’s final marks are shown here.</small></div></div></>;
}

function StudentAssignmentRow({ assignment }) {
  const { setModal } = useApp();
  return <div className="student-assignment"><span className={`subject-icon icon-${assignment.tone}`}><FileText size={18} /></span><span className="student-assignment-title"><b>{assignment.title}</b><small>{assignment.classroom}</small></span><span className="student-assignment-status"><i />{assignment.status}</span><button className="button button-small button-soft" onClick={() => setModal({ type: 'upload', assignment })}>Open</button></div>;
}

function StudentAssignments() {
  const { assignments } = useApp();
  return <><PageHeading eyebrow="YOUR NEXT STEPS" title="Assignments" description="Every new thing is a chance to learn something." /><div className="student-assignment-list">{assignments.map((assignment) => <StudentAssignmentRow key={assignment.id} assignment={assignment} />)}</div></>;
}

function StudentResults() {
  const { results } = useApp();
  return <><PageHeading eyebrow="A RECORD OF YOUR PROGRESS" title="My results" description="Your teacher’s final feedback, all in one gentle place." /><div className="results-banner"><span className="results-flower">✿</span><span><b>Look how far you’ve come.</b><small>Only final results shared by your teacher appear here.</small></span></div><div className="panel results-panel"><div className="table-heading result-columns"><span>ASSIGNMENT</span><span>CLASSROOM</span><span>YOUR MARK</span><span>STATUS</span></div>{results.map((result) => <div className="table-row result-row" key={result.assignment_id}><div className="table-assignment"><span className="subject-icon icon-yellow"><FileText size={17} /></span><b>{result.assignment_title}</b></div><span className="table-class">{result.classroom_name}</span><strong className="result-mark">{result.total_marks} / {result.max_marks}</strong><StatusPill status="Results released" /></div>)}{!results.length && <EmptyState title="No results shared yet" detail="Your teacher’s final results will show here." />}</div></>;
}

function Modal({ modal, onClose }) {
  const { classrooms, templates, notify, reloadData } = useApp();
  const [name, setName] = useState(modal.initial?.name || '');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [title, setTitle] = useState(modal.initial?.name || '');
  const [instructions, setInstructions] = useState('');
  const [selectedClass, setSelectedClass] = useState(classrooms[0]?.id || '');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [dueAt, setDueAt] = useState(() => localDateTimeInput());
  const [criteria, setCriteria] = useState(modal.review?.criteria?.map((item) => ({ ...item, marks: item.finalMarks ?? item.suggestedMarks ?? 0 })) || modal.initial?.criteria?.map((item) => ({ ...item, maxMarks: item.maxMarks ?? item.max_marks })) || [{ name: 'Understanding', description: '', maxMarks: 10 }]);
  const [file, setFile] = useState(null);
  const [questionPdf, setQuestionPdf] = useState(null);
  const [createdAssignmentId, setCreatedAssignmentId] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [joiningCode, setJoiningCode] = useState(modal.room?.code || '');
  const { role } = useApp();

  useEffect(() => {
    if (modal.type !== 'classroom-manage' || role !== 'teacher') return;
    api(`/classrooms/${modal.room.id}/members`).then((response) => setMembers(response.members)).catch((requestError) => setError(requestError.message));
  }, [modal, role]);

  const closeWithToast = (message) => { onClose(); reloadData(); notify(message); };
  const patchCriterion = (index, key, value) => setCriteria((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, [key]: value } : item));
  const addCriterion = () => setCriteria((current) => [...current, { name: '', description: '', maxMarks: 5 }]);
  const regenerateCode = async () => {
    try {
      const response = await api(`/classrooms/${modal.room.id}/regenerate-code`, { method: 'POST', body: {} });
      setJoiningCode(response.joiningCode);
      reloadData();
    } catch (requestError) { setError(requestError.message); }
  };
  const removeStudent = async (studentId) => {
    try {
      await api(`/classrooms/${modal.room.id}/members/${studentId}`, { method: 'DELETE' });
      setMembers((current) => current.filter((member) => member.id !== studentId));
      reloadData();
    } catch (requestError) { setError(requestError.message); }
  };
  const leaveClassroom = async () => {
    try {
      await api(`/classrooms/${modal.room.id}/membership`, { method: 'DELETE' });
      closeWithToast('You left the classroom. Your academic records are retained.');
    } catch (requestError) { setError(requestError.message); }
  };

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (modal.type === 'classroom') {
        await api('/classrooms', { method: 'POST', body: { name, subject, gradeLevel: grade } });
        closeWithToast('Your new classroom is ready!');
      } else if (modal.type === 'assignment') {
        let assignmentId = createdAssignmentId;
        if (!assignmentId) {
          const { assignment } = await api('/assignments', { method: 'POST', body: { classroomId: selectedClass, title, instructions, dueAt: new Date(dueAt).toISOString(), criteria: normalizeCriteria(criteria) } });
          assignmentId = assignment.id;
          setCreatedAssignmentId(assignmentId);
          if (selectedTemplate) await api(`/assignments/${assignmentId}/rubric/from-template`, { method: 'POST', body: { templateId: selectedTemplate } });
        }
        if (questionPdf) {
          const formData = new FormData();
          formData.append('file', questionPdf);
          await api(`/assignments/${assignmentId}/questions-document`, { method: 'POST', body: formData });
        }
        closeWithToast('Assignment created. It is now available to classroom members.');
      } else if (modal.type === 'review') {
        await api(`/assignments/${modal.review.assignmentId}/reviews/${modal.review.studentId}`, { method: 'PATCH', body: { criteria: criteria.map((item) => ({ criterionId: item.criterionId, marks: Number(item.marks) })) } });
        closeWithToast('Final teacher marks saved.');
      } else if (modal.type === 'upload') {
        if (!file) throw new Error('Choose a file before submitting.');
        const formData = new FormData();
        formData.append('file', file);
        const response = await api(`/assignments/${modal.assignment.id}/submissions`, { method: 'POST', body: formData });
        onClose();
        notify('Submission accepted. Your receipt is downloading.');
        download(response.receiptUrl.replace('/api', ''), `receipt-${response.submission.id}.html`).catch((downloadError) => notify(downloadError.message));
        reloadData();
      } else if (modal.type === 'join') {
        await api('/classrooms/join', { method: 'POST', body: { code } });
        closeWithToast('You joined the classroom!');
      } else if (modal.type === 'rubric') {
        const body = { name: title, criteria: normalizeCriteria(criteria) };
        if (modal.initial?.id) await api(`/rubric-templates/${modal.initial.id}`, { method: 'PATCH', body });
        else await api('/rubric-templates', { method: 'POST', body });
        closeWithToast('Rubric template saved.');
      }
    } catch (requestError) {
      setError(requestError.message);
      setPending(false);
    }
  };

  const headings = { classroom: ['A new little community', 'Create classroom'], 'classroom-manage': ['Your learning community', modal.room?.title || 'Classroom'], assignment: ['Make something wonderful', 'New assignment'], review: ['A thoughtful final look', `Review ${modal.review?.name || 'student'}’s work`], upload: ['Your work, ready to go', 'Submit assignment'], join: ['Find your classroom', 'Join classroom'], rubric: ['Feedback, your way', modal.initial ? 'Edit rubric' : 'New rubric'] };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button><div className="modal-flower">✿</div><div className="eyebrow">{headings[modal.type][0]}</div><h2 id="modal-title">{headings[modal.type][1]}</h2>{modal.type === 'classroom-manage' ? <div className="classroom-manage"><div className="join-code-panel"><span className="tiny-label">CLASS JOINING CODE</span><strong>{joiningCode || 'Private classroom'}</strong>{role === 'teacher' && <button className="button button-outline" onClick={regenerateCode}>Regenerate code</button>}</div>{role === 'teacher' ? <><div className="manage-members-heading"><b>Students</b><span>{members.length} enrolled</span></div><div className="manage-members">{members.map((member) => <div key={member.id}><span className="avatar avatar-mint">{member.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><b>{member.full_name}</b><small>{member.email}</small></span><button className="button button-small button-outline" onClick={() => removeStudent(member.id)}>Remove</button></div>)}{!members.length && <EmptyState title="No students yet" detail="Share the joining code with your class." />}</div></> : <button className="button button-outline leave-class-button" onClick={leaveClassroom}>Leave classroom</button>}{error && <div className="auth-error" role="alert">{error}</div>}</div> : <form onSubmit={submit}>
    {modal.type === 'review' && <><div className="ai-note"><Sparkles size={16} /><span><b>{modal.review.score === null ? 'Manual grading needed' : `AI suggestion: ${modal.review.score}/${modal.review.max}`}</b><small>{modal.review.evaluationError || 'AI suggestions are separate from your final teacher marks.'}</small></span></div>{criteria.map((criterion, index) => <div className="criterion-editor" key={criterion.criterionId || index}><label className="field-label">{criterion.name}<span>out of {criterion.maxMarks}</span></label><input className="input-control" type="number" min="0" max={criterion.maxMarks} step="0.25" value={criterion.marks} onChange={(event) => patchCriterion(index, 'marks', event.target.value)} required /><small>{criterion.explanation || criterion.description}</small></div>)}</>}
    {modal.type === 'classroom' && <><label className="field-label">Classroom name</label><input className="input-control" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Curious Creators" required maxLength={120} /><label className="field-label">Subject</label><input className="input-control" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Language Arts" maxLength={100} /><label className="field-label">Grade level</label><input className="input-control" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="e.g. Grade 8" maxLength={40} /></>}
    {modal.type === 'assignment' && <><label className="field-label">Assignment title</label><input className="input-control" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give it a lovely name" required maxLength={180} /><label className="field-label">Classroom</label><select className="input-control" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} required>{classrooms.map((room) => <option key={room.id} value={room.id}>{room.title}</option>)}</select><label className="field-label">Instructions <span>Optional</span></label><textarea className="input-control" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows="2" /><label className="field-label">Questions PDF <span>Optional · PDF, up to 10 MB</span></label><label className="upload-drop question-upload"><FileText size={20} /><b>{questionPdf?.name || 'Attach the assignment questions'}</b><small>Text is extracted locally; the original stays private.</small><input type="file" accept=".pdf,application/pdf" onChange={(event) => setQuestionPdf(event.target.files?.[0] || null)} /></label><label className="field-label">Due date</label><input className="input-control" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required /><label className="field-label">Start with a saved template <span>Optional</span></label><select className="input-control" value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}><option value="">Build this rubric here</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>{!selectedTemplate && <CriteriaFields criteria={criteria} update={patchCriterion} add={addCriterion} />}</>}
    {modal.type === 'rubric' && <><label className="field-label">Template name</label><input className="input-control" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Short story sparkle" required maxLength={120} /><CriteriaFields criteria={criteria} update={patchCriterion} add={addCriterion} /></>}
    {modal.type === 'upload' && <><p className="upload-assignment-name">{modal.assignment.title}</p><label className="field-label">Choose your file <span>PDF, DOC, DOCX · up to 10 MB</span></label><label className="upload-drop"><ArrowDownToLine size={22} /><b>{file?.name || 'Choose a file from your device'}</b><small>Each accepted version is kept as a separate submission.</small><input type="file" accept=".pdf,.doc,.docx" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label><div className="modal-tip"><CheckCircle2 size={15} /> A downloadable receipt is created when accepted.</div></>}
    {modal.type === 'join' && <><label className="field-label">Class joining code</label><input className="input-control code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. PAPER8" maxLength="12" required /><div className="modal-tip">Ask your teacher for the code to join their classroom.</div></>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={pending}><Check size={16} /> {pending ? 'Saving...' : modal.type === 'review' ? 'Save final marks' : modal.type === 'upload' ? 'Submit work' : modal.type === 'join' ? 'Join classroom' : 'Save and continue'}</button></div>
    </form>}</section></div>;
}

function CriteriaFields({ criteria, update, add }) {
  return <div className="criteria-fields"><div className="criteria-title"><span className="field-label">Rubric criteria</span><button className="text-button" type="button" onClick={add}><Plus size={14} /> Add criterion</button></div>{criteria.map((item, index) => <div className="criterion-row" key={index}><input className="input-control" placeholder="Criterion name" value={item.name} onChange={(event) => update(index, 'name', event.target.value)} required maxLength={120} /><input className="input-control mark-control" type="number" placeholder="Max" min="0" step="0.25" value={item.maxMarks} onChange={(event) => update(index, 'maxMarks', event.target.value)} required /><input className="input-control criterion-description" placeholder="What does good work look like?" value={item.description || ''} onChange={(event) => update(index, 'description', event.target.value)} maxLength={2000} /></div>)}</div>;
}

function normalizeCriteria(criteria) {
  return criteria.map((item) => ({ name: item.name, description: item.description || '', maxMarks: Number(item.maxMarks) }));
}

function localDateTimeInput() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export default AppConnected;