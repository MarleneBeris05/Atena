import React, { useState } from 'react';
import Window from '../components/Window';
import ScopeFields from '../components/ScopeFields';
import ActivityCalendar from '../components/ActivityCalendar';
import { methods } from '../data/study';
import { activities, days, localTime, nextOccurrence, planDays, subjectId } from '../data/library';

export default function PlansPage({ subjects, topics, plans, setPlans, attempts, completed, now, notify }) {
  const [editing, setEditing] = useState(null);
  const plan = plans.find(entry => entry.id === editing);
  const topic = topics.find(entry => entry.id === plan?.topicId);

  return <div className="plans-layout">
    <div className="page-stack">
      <Window title="Planificador semanal">
        <h2 className="section-title">{plan ? 'Editar plan' : 'Programar sesiones'}</h2>
        {!topics.length && <p><a href="#/aprendizaje">Crea un tema en Aprendizaje</a> para programar una sesión.</p>}
        <PlanForm key={editing || 'nuevo'} plan={plan} topic={topic} subjects={subjects} topics={topics}
          onCancel={() => setEditing(null)} onSave={values => {
            if (plan) setPlans(previous => previous.map(entry => entry.id === plan.id ? { ...entry, ...values } : entry));
            else setPlans(previous => [...previous, { ...values, id: crypto.randomUUID() }]);
            setEditing(null);
            notify('Plan guardado en este navegador.');
          }}/>
      </Window>
      <Window title="Agenda">
        <h2 className="section-title">Tus planes de estudio</h2>
        {!plans.length && <p>Todavía no tienes sesiones programadas.</p>}
        {plans.map(entry => {
          const target = topics.find(item => item.id === entry.topicId);
          const subject = target && subjects.find(item => item.id === subjectId(target));
          const next = nextOccurrence([entry], completed, now);
          return <article className="content-row" key={entry.id}>
            <div><strong>{entry.name}</strong>
              <p>{[subject?.name, target?.name, activities[entry.activity || 'all'], entry.minutes + ' min'].filter(Boolean).join(' · ')}</p>
              <p>{planDays(entry).join(' · ') || 'Sin días fijos'} · {entry.time || 'Sin hora asignada'}</p>
              {next && <p>Próxima sesión: {localTime(next.start)}</p>}
            </div>
            <div className="actions">
              <button className="button" onClick={() => {
                setEditing(entry.id);
                window.scrollTo(0, 0);
              }}>Editar plan</button>
              <button className="button" onClick={() => {
                if (!window.confirm('¿Eliminar este plan?')) return;
                setPlans(previous => previous.filter(item => item.id !== entry.id));
                if (editing === entry.id) setEditing(null);
              }}>Eliminar</button>
            </div>
          </article>;
        })}
      </Window>
    </div>
    <ActivityCalendar sessions={attempts} completed={completed}/>
  </div>;
}

function PlanForm({ plan, topic, subjects, topics, onSave, onCancel }) {
  const [methodId, setMethodId] = useState(plan?.method || methods[0].id);
  const [error, setError] = useState('');
  const method = methods.find(entry => entry.id === methodId);
  return <form className="plan-form" onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedDays = data.getAll('days');
    if (!data.get('topicId') || !selectedDays.length) {
      setError('Elige un tema y al menos un día de estudio.');
      return;
    }
    onSave({
      name: data.get('name').trim(), topicId: data.get('topicId'), subjectId: data.get('subjectId'),
      time: data.get('time'), minutes: Number(data.get('minutes')),
      activity: data.get('activity'), days: selectedDays, method: methodId,
    });
    setError('');
    if (!plan) event.currentTarget.reset();
  }}>
    <label>Nombre del plan<input name="name" required pattern=".*\S.*" defaultValue={plan?.name}/></label>
    <ScopeFields subjects={subjects} topics={topics} required initialTopic={topic?.id}
      initialSubject={topic ? subjectId(topic) : undefined}/>
    <label>Actividad<select name="activity" defaultValue={plan?.activity || 'all'}>
      {Object.entries(activities).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <div className="form-columns">
      <label>Hora local<input name="time" type="time" required defaultValue={plan?.time}/></label>
      <label>Minutos por sesión<input name="minutes" type="number" min="5" max="180" required defaultValue={plan?.minutes ?? 25}/></label>
    </div>
    <fieldset>
      <legend>Días de estudio</legend>
      <div className="day-options">{days.map(day => <label key={day}>
        <input type="checkbox" name="days" value={day}
          defaultChecked={(plan ? planDays(plan) : ['Lunes', 'Miércoles', 'Viernes']).includes(day)}/>{day}
      </label>)}</div>
    </fieldset>
    <details className="method-detail">
      <summary>Método de estudio{method ? ' · ' + method.name : ''}</summary>
      <label>Método<select value={methodId} onChange={event => setMethodId(event.target.value)}>
        {methods.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      {method && <><p>{method.steps}</p><p>{method.minutes} min sugeridos · {method.use}</p></>}
    </details>
    {error && <p className="storage-error" role="alert">{error}</p>}
    <div className="actions">
      <button className="button solid" disabled={!topics.length}>Guardar plan</button>
      {plan && <button className="button" type="button" onClick={onCancel}>Cancelar edición</button>}
    </div>
  </form>;
}
