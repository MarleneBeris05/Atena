import React, { useState } from 'react';
import Window from './Window';
import { dateKey } from '../data/study';

export default function ActivityCalendar({ sessions, completed }) {
  const today = dateKey();
  const [month, setMonth] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [selected, setSelected] = useState(today);
  const countByDate = entries => entries.reduce((all, entry) => all.set(entry.date, (all.get(entry.date) || 0) + 1), new Map());
  const counts = countByDate(sessions);
  const completions = countByDate(completed);
  const activity = sessions.filter(entry => entry.date === selected);
  const finished = completed.filter(entry => entry.date === selected);
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const shiftMonth = difference => {
    const next = new Date(month.getFullYear(), month.getMonth() + difference, 1);
    setMonth(next);
    setSelected(today.slice(0, 7) === dateKey(next).slice(0, 7) ? today : dateKey(next));
  };

  return <Window title="Calendario de actividad" className="calendar">
    <h2 className="section-title">Actividad por día</h2>
    <div className="calendar-nav">
      <button aria-label="Mes anterior" onClick={() => shiftMonth(-1)}>←</button>
      <strong>{month.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</strong>
      <button aria-label="Mes siguiente" onClick={() => shiftMonth(1)}>→</button>
    </div>
    <div className="calendar-grid">
      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(day => <span className="weekday" key={day}>{day}</span>)}
      {Array.from({ length: offset }, (_, index) => <span key={'vacío' + index}/>)}
      {Array.from({ length: days }, (_, index) => {
        const date = dateKey(new Date(month.getFullYear(), month.getMonth(), index + 1));
        const count = counts.get(date) || 0;
        const finishedCount = completions.get(date) || 0;
        return <button key={date} className={'calendar-day intensity-' + Math.min(count + finishedCount, 3)
          + (date === today ? ' today' : '') + (date === selected ? ' selected' : '')}
          aria-pressed={date === selected} aria-label={date + ': ' + count + ' intentos, ' + finishedCount + ' sesiones completadas'}
          onClick={() => setSelected(date)}>
          {index + 1}{count + finishedCount > 0 && <i/>}
        </button>;
      })}
    </div>
    <div className="calendar-legend"><span>Sin actividad</span><i/><i/><i/><i/><span>Más actividad</span></div>
    <div className="calendar-detail" aria-live="polite" tabIndex={0}>
      <strong>{new Date(selected + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}
        {' · '}{activity.length} {activity.length === 1 ? 'intento' : 'intentos'}</strong>
      {activity.length ? activity.map(entry => <p key={entry.id}>{entry.topicName} · {entry.reviewName}
        {entry.correct === false && ' · Para repasar'}</p>) : <p>Aún no hay intentos registrados este día.</p>}
      {finished.map(entry => <p key={entry.id}>Sesión programada completada{entry.planName && ' · ' + entry.planName}</p>)}
    </div>
  </Window>;
}
