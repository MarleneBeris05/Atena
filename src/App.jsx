import React, { useEffect, useRef, useState } from 'react';
import Header, { routes } from './components/Header';
import Dialog from './components/Dialog';
import ReviewForm from './components/ReviewForm';
import HomePage from './pages/HomePage';
import LearningPage from './pages/LearningPage';
import PracticePage from './pages/PracticePage';
import PlansPage from './pages/PlansPage';
import DevicePage from './pages/DevicePage';
import useLocalStorage from './hooks/useLocalStorage';
import { dateKey, initialReviews, initialTopics } from './data/study';
import { activityType, findLegacyReviewId, itemName, learningPath, nextOccurrence, subjectId, unassigned } from './data/library';

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

function assignLegacyTopics(topics) {
  return topics.some(topic => !topic.subjectId)
    ? topics.map(topic => topic.subjectId ? topic : { ...topic, subjectId: unassigned.id })
    : topics;
}

function usedLegacyLibrary() {
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem('repasito.v2.' + key)) ?? fallback; }
    catch { return fallback; }
  };
  const some = (key, predicate) => {
    const entries = read(key, []);
    return Array.isArray(entries) && entries.some(predicate);
  };
  return some('topics', topic => !topic.subjectId)
    || some('reviews', item => !item.type)
    || some('plans', plan => !plan.days)
    || some('sessions', entry => !Object.hasOwn(entry, 'reviewId'))
    || read('device', {}).queued === true;
}

export default function App() {
  const [legacyLibrary] = useState(usedLegacyLibrary);
  const [savedSubjects, setSubjects, subjectsError] = useLocalStorage('repasito.v2.subjects', []);
  const [topics, setTopics, topicsError] = useLocalStorage('repasito.v2.topics', legacyLibrary ? initialTopics : [], assignLegacyTopics, legacyLibrary);
  const defaultItems = legacyLibrary ? initialReviews.filter(item => topics.some(topic => topic.id === item.topicId)) : [];
  const [items, setItems, itemsError] = useLocalStorage('repasito.v2.reviews', defaultItems, undefined, legacyLibrary);
  const [attempts, setAttempts, attemptsError] = useLocalStorage('repasito.v2.sessions', [], history => {
    if (history.every(entry => Object.hasOwn(entry, 'reviewId'))) return history;
    return history.map(entry => Object.hasOwn(entry, 'reviewId') ? entry : {
      ...entry, reviewId: findLegacyReviewId(entry, items), type: entry.type || 'choice',
    });
  });
  const [plans, setPlans, plansError] = useLocalStorage('repasito.v2.plans', []);
  const [completed, setCompleted, completedError] = useLocalStorage('repasito.v2.completedPlans', []);
  const [user, setUser, userError] = useLocalStorage('repasito.v2.user', { name: 'Estudiante' });
  const [device, setDevice, deviceError] = useLocalStorage('repasito.v2.device', {});
  const [route, setRoute] = useState(readRoute);
  const [editor, setEditor] = useState(null);
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
  const subjects = topics.some(topic => subjectId(topic) === unassigned.id) ? [...savedSubjects, unassigned] : savedSubjects;
  const subject = subjects.find(entry => entry.id === ids[0]);
  const topic = topics.find(entry => entry.id === ids[1] && subjectId(entry) === subject?.id);
  const next = nextOccurrence(plans.filter(plan => topics.some(entry => entry.id === plan.topicId)), completed, now);
  const storageError = subjectsError || topicsError || itemsError || attemptsError || plansError || completedError || userError || deviceError;

  const openEditor = value => {
    editorTrigger.current = document.activeElement;
    setEditor(value);
  };
  const closeEditor = () => {
    setEditor(null);
    requestAnimationFrame(() => editorTrigger.current?.focus());
  };
  const saveEntry = (setEntries, previous, values) => {
    const entry = { ...previous, ...values, id: previous?.id || crypto.randomUUID() };
    setEntries(old => previous ? old.map(item => item.id === previous.id ? entry : item) : [...old, entry]);
    return entry;
  };
  const removeContent = matches => {
    setItems(previous => previous.filter(item => !matches(item)));
    if (device.items?.some(matches)) {
      setDevice(previous => ({ ...previous, items: previous.items.filter(item => !matches(item)) }));
    }
  };
  const deleteTopic = target => {
    if (!window.confirm('¿Eliminar este tema, sus actividades y sus planes? El historial se conservará.')) return;
    setTopics(previous => previous.filter(entry => entry.id !== target.id));
    setPlans(previous => previous.filter(entry => entry.topicId !== target.id));
    removeContent(item => item.topicId === target.id);
    location.hash = learningPath(subjectId(target) === unassigned.id ? undefined : subjectId(target));
    closeEditor();
    notify('Tema eliminado.');
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
    <Header active={page} user={user} onProfile={() => openEditor({ type: 'profile' })}/>
    <main id={page}>
      <h1 ref={heading} tabIndex={-1}>{titles[page]}</h1>
      {storageError && <p role="alert" className="storage-error">{storageError}</p>}
      {page === 'inicio' && <HomePage subjects={subjects} topics={topics} items={items} attempts={attempts}
        completed={completed} next={next} now={now} onCreate={() => openEditor({ type: 'subject' })}/>}
      {page === 'aprendizaje' && <LearningPage subjects={subjects} topics={topics} items={items} subject={subject}
        topic={topic} invalid={(ids[0] && !subject) || (ids[1] && !topic)} onEdit={openEditor}/>}
      {page === 'repasos' && <PracticePage key={hash} subjects={subjects} topics={topics} items={items} plans={plans}
        completed={completed} query={query} onAttempt={recordAttempt} onComplete={completePlan}/>}
      {page === 'planes' && <PlansPage subjects={subjects} topics={topics} plans={plans} setPlans={setPlans}
        attempts={attempts} completed={completed} now={now} notify={notify}/>}
      {page === 'dispositivo' && <DevicePage items={items} device={device} onPrepare={() => {
        setDevice(previous => ({ ...previous, items, preparedAt: new Date().toISOString() }));
        notify('Material preparado en este navegador.');
      }}/>}
      <footer>Tus datos se guardan en este navegador.</footer>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
    {editor && <Dialog title={editorTitles[editor.type]} onClose={closeEditor}>
      {editor.type === 'item' ? <ReviewForm item={editor.item} topicId={editor.topic.id} onSave={values => {
        saveEntry(setItems, editor.item, values);
        closeEditor();
        notify('Contenido guardado.');
      }} onDelete={() => {
        if (!window.confirm('¿Eliminar este contenido? El historial se conservará.')) return;
        removeContent(item => item.id === editor.item.id);
        closeEditor();
        notify('Contenido eliminado.');
      }}/> : <form onSubmit={event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        values.name = values.name.trim();
        if (editor.type === 'profile') setUser(previous => ({ ...previous, name: values.name }));
        if (editor.type === 'subject') {
          const entry = saveEntry(setSubjects, editor.subject, values);
          location.hash = learningPath(entry.id);
        }
        if (editor.type === 'topic') {
          const entry = saveEntry(setTopics, editor.topic, values);
          location.hash = learningPath(entry.subjectId, entry.id);
        }
        closeEditor();
        notify({ profile: 'Perfil guardado.', subject: 'Materia guardada.', topic: 'Tema guardado.' }[editor.type]);
      }}>
        {editor.type === 'topic' && <label>Materia<select name="subjectId" required defaultValue={editor.topic
          ? subjectId(editor.topic) : editor.subject?.id}>
          {subjects.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </select></label>}
        <label>Nombre<input name="name" required pattern=".*\S.*" maxLength={editor.type === 'profile' ? 35 : undefined}
          defaultValue={editor.type === 'profile' ? user.name : (editor.topic || editor.subject)?.name}/></label>
        {editor.type !== 'profile' && <label>Descripción (opcional)
          <textarea name="description" rows={3} defaultValue={(editor.topic || editor.subject)?.description}/>
        </label>}
        <div className="actions">
          <button className="button solid">{editor.type === 'subject' ? 'Guardar materia'
            : editor.type === 'topic' ? 'Guardar tema' : 'Guardar perfil'}</button>
          {editor.topic && <button type="button" className="button" onClick={() => deleteTopic(editor.topic)}>Eliminar tema</button>}
        </div>
      </form>}
    </Dialog>}
  </>;
}
