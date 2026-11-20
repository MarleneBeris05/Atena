import React, { useEffect, useMemo, useRef, useState } from 'react';
import Header, { routes } from './components/Header';
import AccountDialog from './components/AccountDialog';
import Dialog from './components/Dialog';
import ReviewForm from './components/ReviewForm';
import GenerateFlashcardsDialog from './components/GenerateFlashcardsDialog';
import HomePage from './pages/HomePage';
import LearningPage from './pages/LearningPage';
import PracticePage from './pages/PracticePage';
import PlansPage from './pages/PlansPage';
import DevicePage from './pages/DevicePage';
import useLocalStorage from './hooks/useLocalStorage';
import useLocalLibrary, { associateAttempts, importPayload, mergeById, readLocal } from './hooks/useLocalLibrary';
import useAccountLibrary from './hooks/useAccountLibrary';
import useDeviceActivity from './hooks/useDeviceActivity';
import { hasAccountApi, readSession, storeSession } from './data/api';
import { dateKey } from './data/study';
import { activityType, itemName, learningPath, mergeStudyAttempts, nextOccurrence, subjectId, unassigned } from './data/library';

const titles = {
  inicio: 'Inicio', aprendizaje: 'Aprendizaje', repasos: 'Repasos', planes: 'Planes', dispositivo: 'Dispositivo',
};

function readRoute() {
  const hash = location.hash;
  const separator = hash.indexOf('?');
  const path = (separator < 0 ? hash : hash.slice(0, separator)).replace(/^#\/?/, '');
  const query = new URLSearchParams(separator < 0 ? '' : hash.slice(separator + 1));
  const [section, ...segments] = path.split('/');
  const page = section === 'temas' ? 'aprendizaje' : routes.includes(section) ? section : 'inicio';
  const ids = segments.map(segment => {
    try { return decodeURIComponent(segment); }
    catch { return segment; }
  });
  return { page, ids, query, hash };
}

export default function App() {
  const local = useLocalLibrary();
  const [session, setSession] = useState(readSession);
  const [showAccount, setShowAccount] = useState(false);
  return <>
    <Workspace key={session?.account.id || 'local'} local={local} session={session}
      openAccount={hasAccountApi ? () => setShowAccount(true) : undefined}/>
    {showAccount && <AccountDialog session={session} onClose={() => setShowAccount(false)} onSession={value => {
      storeSession(value);
      setSession(value);
    }}/>}
  </>;
}

const emptyLibrary = { subjects: [], topics: [], reviews: [] };

function Workspace({ local, session, openAccount }) {
  const remote = useAccountLibrary(session?.token);
  const library = session ? remote.library || emptyLibrary : local.library;
  const { subjects: savedSubjects, topics, reviews: items } = library;
  const key = name => session ? 'repasito.account.' + session.account.id + '.' + name : 'repasito.v2.' + name;
  const [attempts, setAttempts, attemptsError] = useLocalStorage(key('sessions'), [], history => associateAttempts(history, items));
  const [plans, setPlans, plansError] = useLocalStorage(key('plans'), []);
  const [completed, setCompleted, completedError] = useLocalStorage(key('completedPlans'), []);
  const [copiedActivity, setCopiedActivity, copyError] = useLocalStorage(key('copiedActivity'), false);
  const [user, setUser, userError] = useLocalStorage('repasito.v2.user', { name: 'Estudiante' });
  const [device, setDevice, deviceError] = useLocalStorage(key('device'), {});
  const [route, setRoute] = useState(readRoute);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editorError, setEditorError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [toast, notify] = useState('');
  const [now, setNow] = useState(() => new Date());
  const heading = useRef(null);
  const editorTrigger = useRef(null);

  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      setEditor(null);
      setNow(new Date());
      window.scrollTo(0, 0);
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    };
    addEventListener('hashchange', change);
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => {
      removeEventListener('hashchange', change);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const { page, ids, query, hash } = route;
  const deviceActivity = useDeviceActivity(session?.token, page);
  const allAttempts = useMemo(() => mergeStudyAttempts(attempts, deviceActivity.events), [attempts, deviceActivity.events]);
  const subjects = !savedSubjects.some(entry => entry.id === unassigned.id) && topics.some(topic => subjectId(topic) === unassigned.id)
    ? [...savedSubjects, unassigned] : savedSubjects;
  const subject = subjects.find(entry => entry.id === ids[0]);
  const topic = topics.find(entry => entry.id === ids[1] && subjectId(entry) === subject?.id);
  const next = nextOccurrence(plans.filter(plan => topics.some(entry => entry.id === plan.topicId)), completed, now);
  const storageError = local.error || attemptsError || plansError || completedError || userError || deviceError || copyError;

  const openEditor = value => {
    editorTrigger.current = document.activeElement;
    setEditorError(null);
    setEditor({ ...value, newId: crypto.randomUUID() });
  };
  const closeEditor = () => {
    setEditor(null);
    requestAnimationFrame(() => editorTrigger.current?.focus());
  };
  const saveEntry = async (collection, previous, values) => {
    const entry = { ...previous, ...values, id: previous?.id || editor.newId };
    if (session) return remote.save(collection, entry, Boolean(previous));
    local.setters[collection](old => previous ? old.map(item => item.id === previous.id ? entry : item) : [...old, entry]);
    return entry;
  };
  const runEditorAction = async action => {
    if (busy) return;
    setBusy(true);
    setEditorError(null);
    try { await action(); }
    catch (error) { setEditorError(error); }
    finally { setBusy(false); }
  };
  const removePreparedContent = matches => {
    if (device.items?.some(matches)) {
      setDevice(previous => ({ ...previous, items: previous.items.filter(item => !matches(item)) }));
    }
  };
  const deleteTopic = async target => {
    if (!window.confirm('¿Eliminar este tema, sus actividades y sus planes? El historial se conservará.')) return;
    if (session) await remote.remove('topics', target.id);
    else {
      local.setters.topics(previous => previous.filter(entry => entry.id !== target.id));
      local.setters.reviews(previous => previous.filter(item => item.topicId !== target.id));
    }
    setPlans(previous => previous.filter(entry => entry.topicId !== target.id));
    removePreparedContent(item => item.topicId === target.id);
    location.hash = learningPath(subjectId(target) === unassigned.id ? undefined : subjectId(target));
    closeEditor();
    notify('Tema eliminado.');
  };

  const importLibrary = async () => {
    setImporting(true);
    setImportStatus(null);
    try {
      const result = await remote.importFromBrowser(importPayload(local.library));
      if (!copiedActivity) {
        const importedTopics = new Set(result.library.topics.map(entry => entry.id));
        const existing = entries => entries.filter(entry => importedTopics.has(entry.topicId));
        setPlans(previous => mergeById(previous, existing(readLocal('plans', []))));
        setAttempts(previous => mergeById(previous, existing(associateAttempts(readLocal('sessions', []), local.library.reviews))));
        setCompleted(previous => mergeById(previous, existing(readLocal('completedPlans', []))));
        setCopiedActivity(true);
      }
      const added = result.added ? 'Registros nuevos en tu cuenta: ' + result.added + '.' : 'Tu cuenta no recibió registros nuevos.';
      setImportStatus({ message: added + (result.skipped ? ' Registros sin cambios: ' + result.skipped + '.' : '') + ' La copia local se conserva.' });
    } catch (error) {
      setImportStatus({ error: true, message: error.message + ' La copia local se conserva.' });
    } finally { setImporting(false); }
  };

  const recordAttempt = (item, target, result, occurrence) => {
    const timestamp = new Date();
    const attempt = {
      id: crypto.randomUUID(), date: dateKey(timestamp), timestamp: timestamp.toISOString(),
      topicId: target.id, topicName: target.name, reviewId: item.id, reviewName: itemName(item),
      type: activityType(item), occurrenceId: occurrence?.id, ...result,
    };
    setAttempts(old => [...old, attempt]);
  };
  const completePlan = (occurrence, count) => {
    const timestamp = new Date();
    setCompleted(old => old.some(entry => entry.id === occurrence.id) ? old : [...old, {
      id: occurrence.id, planId: occurrence.plan.id, topicId: occurrence.plan.topicId,
      planName: occurrence.plan.name,
      scheduledAt: occurrence.start.toISOString(), date: dateKey(timestamp), timestamp: timestamp.toISOString(), attempts: count,
    }]);
  };

  const editorTitles = {
    profile: 'Editar perfil', subject: editor?.subject ? 'Editar materia' : 'Crear materia',
    topic: editor?.topic ? 'Editar tema' : 'Crear tema', item: editor?.item ? 'Editar contenido' : 'Añadir contenido',
  };

  return <>
    <Header active={page} user={user} onProfile={session ? undefined : () => openEditor({ type: 'profile' })}
      account={session?.account} onAccount={openAccount}/>
    <main id={page}>
      <h1 ref={heading} tabIndex={-1}>{titles[page]}</h1>
      {storageError && <p role="alert" className="storage-error">{storageError}</p>}
      {remote.loading && <p role="status">Cargando la biblioteca de tu cuenta…</p>}
      {remote.error && <div className="library-notice">
        <p role="alert">{remote.error}</p>
        <button className="button" onClick={remote.retry}>Reintentar carga</button>
      </div>}
      {(!session || remote.library) && <>
      {session && page === 'aprendizaje' && Object.values(local.library).some(entries => entries.length) && <section className="library-notice">
        <p>Hay una biblioteca en este navegador. Puedes copiarla a {session.account.email}.</p>
        <button className="button" disabled={importing} onClick={importLibrary}>{importing ? 'Importando…' : 'Importar biblioteca local'}</button>
        {importStatus && <p role={importStatus.error ? 'alert' : 'status'}>{importStatus.message}</p>}
      </section>}
      <fieldset className="form-controls" disabled={importing}>
      {page === 'inicio' && deviceActivity.error && <p role="status">La actividad del dispositivo está temporalmente inaccesible.</p>}
      {page === 'inicio' && <HomePage subjects={subjects} topics={topics} items={items} attempts={allAttempts}
        completed={completed} next={next} now={now} onCreate={() => openEditor({ type: 'subject' })}/>}
      {page === 'aprendizaje' && <LearningPage subjects={subjects} topics={topics} items={items} subject={subject}
        topic={topic} invalid={(ids[0] && !subject) || (ids[1] && !topic)} onEdit={openEditor} canGenerate={!!session}/>}
      {page === 'repasos' && <PracticePage key={hash} subjects={subjects} topics={topics} items={items} plans={plans}
        completed={completed} query={query} onAttempt={recordAttempt} onComplete={completePlan}/>}
      {page === 'planes' && <PlansPage subjects={subjects} topics={topics} plans={plans} setPlans={setPlans}
        attempts={allAttempts} completed={completed} now={now} notify={notify}/>}
      {page === 'dispositivo' && <DevicePage items={items} subjects={subjects} topics={topics} token={session?.token}
        activity={deviceActivity} device={device} onAccount={openAccount} onPrepare={() => {
        setDevice(previous => ({ ...previous, items, preparedAt: new Date().toISOString() }));
        notify('Material preparado en este navegador.');
      }}/>}
      </fieldset>
      </>}
      <footer>{session ? 'Tu cuenta guarda la biblioteca y los resultados del dispositivo. Los planes y la actividad web se guardan en este navegador.'
        : 'Tus datos se guardan en este navegador.'}</footer>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
    {editor?.type === 'generate' ? <GenerateFlashcardsDialog topic={editor.topic} onGenerate={remote.generateFlashcards}
      onSave={remote.saveFlashcards} onClose={closeEditor} onAccount={openAccount}/>
    : editor && <Dialog title={editorTitles[editor.type]} onClose={closeEditor} busy={busy}>
      <fieldset className="form-controls" disabled={busy || (session && editor.type !== 'profile' && !remote.library)}>
      {editor.type === 'item' ? <ReviewForm item={editor.item} topicId={editor.topic.id} initialType={editor.initialType}
        onSave={values => runEditorAction(async () => {
        await saveEntry('reviews', editor.item, values);
        closeEditor();
        notify(session ? 'Contenido guardado en tu cuenta.' : 'Contenido guardado.');
      })} onDelete={() => runEditorAction(async () => {
        if (!window.confirm('¿Eliminar este contenido? El historial se conservará.')) return;
        if (session) await remote.remove('reviews', editor.item.id);
        else local.setters.reviews(previous => previous.filter(item => item.id !== editor.item.id));
        removePreparedContent(item => item.id === editor.item.id);
        closeEditor();
        notify('Contenido eliminado.');
      })}/> : <form onSubmit={event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        values.name = values.name.trim();
        runEditorAction(async () => {
          if (editor.type === 'profile') setUser(previous => ({ ...previous, name: values.name }));
          if (editor.type === 'subject') {
            const entry = await saveEntry('subjects', editor.subject, values);
            location.hash = learningPath(entry.id);
          }
          if (editor.type === 'topic') {
            const entry = await saveEntry('topics', editor.topic, values);
            location.hash = learningPath(entry.subjectId, entry.id);
          }
          closeEditor();
          if (session) notify('Cambios guardados en tu cuenta.');
          else notify({ profile: 'Perfil guardado.', subject: 'Materia guardada.', topic: 'Tema guardado.' }[editor.type]);
        });
      }}>
        {editor.type === 'topic' && <label>Materia<select name="subjectId" required defaultValue={editor.topic
          ? subjectId(editor.topic) : editor.subject?.id}>
          {subjects.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </select></label>}
        <label>Nombre<input name="name" required pattern=".*\S.*" maxLength={editor.type === 'profile' ? 35 : 300}
          defaultValue={editor.type === 'profile' ? user.name : (editor.topic || editor.subject)?.name}/></label>
        {editor.type !== 'profile' && <label>Descripción (opcional)
          <textarea name="description" rows={3} maxLength={24000} defaultValue={(editor.topic || editor.subject)?.description}/>
        </label>}
        <div className="actions">
          <button className="button solid">{editor.type === 'subject' ? 'Guardar materia'
            : editor.type === 'topic' ? 'Guardar tema' : 'Guardar perfil'}</button>
          {editor.topic && <button type="button" className="button" onClick={() => runEditorAction(() => deleteTopic(editor.topic))}>Eliminar tema</button>}
        </div>
      </form>}
      </fieldset>
      {busy && <p role="status">Guardando cambios…</p>}
      {editorError && <p className="storage-error" role="alert">{editorError.message}</p>}
      {editorError?.status === 401 && <button className="button" type="button" onClick={openAccount}>Volver a iniciar sesión</button>}
    </Dialog>}
  </>;
}
