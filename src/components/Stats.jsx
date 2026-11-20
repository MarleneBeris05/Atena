import React from 'react';
import { weeklyStats } from '../data/library';

export default function Stats({ attempts, completed, now }) {
  const week = weeklyStats(attempts, completed, now);
  return <section aria-labelledby="week-title">
    <h2 id="week-title" className="section-title">¿Cómo voy esta semana?</h2>
    <div className="stats">
      {[
        [week.days, 'Días con actividad'],
        [week.cards, 'Tarjetas distintas practicadas'],
        [week.attempts, 'Intentos de práctica'],
        [week.completed, 'Sesiones programadas completadas'],
      ].map(([value, label]) => <div className="stat" key={label}>
        <strong>{value}</strong><span>{label}</span>
      </div>)}
    </div>
  </section>;
}
