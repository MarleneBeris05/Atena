import React, { useLayoutEffect, useRef, useState } from 'react';
import Window from '../components/Window';
import Flashcard from '../components/Flashcard';
import ScopeFields from '../components/ScopeFields';
import { activities, activityType, getOccurrence, itemName, localTime, practicePath, subjectId } from '../data/library';

export default function PracticePage({ subjects, topics, items, plans, completed, query, onAttempt, onComplete }) {
  const plan = plans.find(entry => entry.id === query.get('plan'));
  const occurrence = getOccurrence(plan, query.get('sesion'));
  const scheduled = query.has('plan');
  const subjectFilter = query.get('materia') || '';
  const topicFilter = query.get('tema') || '';
  const activityFilter = query.get('actividad') || 'all';
  const itemFilter = query.get('contenido') || '';
  const topicsInScope = topics.filter(topic => {
    if (occurrence) return topic.id === plan.topicId;
    return (!subjectFilter || subjectId(topic) === subjectFilter) && (!topicFilter || topic.id === topicFilter);
  });
  const scopedItems = items.filter(item => {
    const type = occurrence ? plan.activity || 'all' : activityFilter;
    return topicsInScope.some(topic => topic.id === item.topicId)
      && (type === 'all' || activityType(item) === type) && (occurrence || !itemFilter || item.id === itemFilter);
  });

  if (scheduled && !occurrence) return <Window title="Sesión programada">
    <h2 className="section-title">Esta sesión ya no está en la agenda</h2>
    <a className="button" href="#/planes">Ver planes</a>
  </Window>;
  if (occurrence && completed.some(entry => entry.id === occurrence.id)) return <Window title="Sesión programada">
    <h2 className="section-title">Sesión programada completada</h2>
    <p>{plan.name} · {localTime(occurrence.start)}</p>
    <a className="button solid" href="#/inicio">Volver a Inicio</a>
  </Window>;

  if (query.has('inicio') || itemFilter || occurrence) {
    return <PracticeRun items={scopedItems} topics={topics} occurrence={occurrence}
      onAttempt={onAttempt} onComplete={onComplete}/>;
  }

  return <Window title="Bandeja de práctica">
    <h2 className="section-title">Elige qué practicar</h2>
    <form onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      location.hash = practicePath({
        subject: data.get('subjectId'), topic: data.get('topicId'), activity: data.get('activity'), start: true,
      });
    }}>
      <ScopeFields subjects={subjects} topics={topics} initialSubject={subjectFilter} initialTopic={topicFilter}/>
      <label>Actividad<select name="activity" defaultValue={activityFilter}>
        {Object.entries(activities).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
      </select></label>
      {items.length ? <button className="button solid">Empezar práctica</button>
        : <><p>Añade contenido a un tema para empezar.</p><a className="button solid" href="#/aprendizaje">Ir a Aprendizaje</a></>}
    </form>
  </Window>;
}

function PracticeRun({ items, topics, occurrence, onAttempt, onComplete }) {
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const item = items[index];
  const topic = item && topics.find(entry => entry.id === item.topicId);

  if (!items.length) return <Window title="Práctica">
    <h2 className="section-title">No hay contenido para esta actividad</h2>
    <div className="actions">
      <a className="button solid" href="#/repasos">Elegir otra actividad</a>
      <a className="button" href="#/aprendizaje">Ir a Aprendizaje</a>
    </div>
  </Window>;
  if (finished) return <Window title="Práctica">
    <h2 className="section-title">Práctica registrada</h2>
    <p>Intentos guardados: {items.length}</p>
    <a className="button solid" href="#/inicio">Volver a Inicio</a>
  </Window>;

  const last = index === items.length - 1;
  const advance = () => {
    if (!last) setIndex(index + 1);
    else if (occurrence) onComplete(occurrence, items.length);
    else setFinished(true);
  };

  return <Window title={occurrence ? 'Sesión programada' : 'Práctica'} className="practice-window">
    {occurrence && <p>{occurrence.plan.name} · {localTime(occurrence.start)} · {occurrence.plan.minutes} min</p>}
    <p className="practice-meta">{topic?.name} · {activities[activityType(item)]} · {index + 1} de {items.length}</p>
    <PracticeItem key={item.id} item={item} focusHeading={index > 0} onResult={result => onAttempt(item, topic, result, occurrence)}
      onAdvance={advance} advanceLabel={!last ? 'Siguiente actividad' : occurrence ? 'Completar sesión programada' : 'Finalizar práctica'}/>
  </Window>;
}

function PracticeItem({ item, focusHeading, onResult, onAdvance, advanceLabel }) {
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState(null);
  const [response, setResponse] = useState('');
  const heading = useRef(null);
  const advance = useRef(null);
  useLayoutEffect(() => {
    if (focusHeading) heading.current.focus();
  }, [focusHeading]);
  useLayoutEffect(() => {
    if (result) advance.current.focus();
  }, [result]);
  const type = activityType(item);
  const record = (correct, selected) => {
    if (result) return;
    setResult({ correct, selected });
    onResult({ correct, selected, response: response.trim() || undefined });
  };

  return <>
    <h2 className="section-title" ref={heading} tabIndex={-1}>{type === 'flashcard' ? 'Flashcard' : itemName(item)}</h2>
    {type === 'flashcard' ? <Flashcard item={item} onReveal={() => setRevealed(true)}/>
      : <p className="written question">{item.question}</p>}
    {type === 'choice' && <div className="choice-list">{item.options.map((option, index) =>
      <button key={index} className={'button answer' + (result && index === item.correct ? ' correct'
        : result?.selected === index ? ' incorrect' : '')} disabled={!!result} onClick={() => record(index === item.correct, index)}>
        {option}
      </button>)}</div>}
    {type === 'recall' && <label className="practice-response">Tu respuesta (opcional)
      <textarea rows={4} value={response} disabled={!!result} onChange={event => setResponse(event.target.value)}/>
    </label>}
    {!result && (type === 'recall' || revealed) && <div className="actions practice-actions">
      <button className="button solid" onClick={() => record(true)}>La recordé</button>
      <button className="button" onClick={() => record(false)}>Repasar</button>
    </div>}
    {result && <div className="answer-feedback">
      <div role="status"><strong>{result.correct ? (type === 'choice' ? '¡Correcto!' : 'Marcado como recordado')
        : (type === 'choice' ? 'Respuesta incorrecta' : 'Marcado para repasar')}</strong>
        {type === 'choice' && <p>{item.explanation || 'Respuesta correcta: ' + item.options[item.correct]}</p>}
      </div>
      <button className="button solid" ref={advance} onClick={onAdvance}>{advanceLabel}</button>
    </div>}
  </>;
}
