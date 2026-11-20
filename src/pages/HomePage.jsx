import React from 'react';
import { Play, Plus } from 'lucide-react';
import Window from '../components/Window';
import Stats from '../components/Stats';
import ActivityCalendar from '../components/ActivityCalendar';
import { activities, activityType, learningPath, localTime, practicePath, subjectId, topicsToRevisit } from '../data/library';

export default function HomePage({ subjects, topics, items, attempts, completed, next, now, onCreate }) {
  const nextTopic = next && topics.find(topic => topic.id === next.plan.topicId);
  const nextSubject = nextTopic && subjects.find(subject => subject.id === subjectId(nextTopic));
  const lastAttempt = [...attempts].reverse().find(entry => topics.some(topic => topic.id === entry.topicId));
  const lastTopic = lastAttempt && topics.find(topic => topic.id === lastAttempt.topicId);
  const lastSubject = lastTopic && subjects.find(subject => subject.id === subjectId(lastTopic));
  const suggestions = topicsToRevisit(topics, attempts);
  const scheduledItems = next && items.some(item => item.topicId === next.plan.topicId
    && (!next.plan.activity || next.plan.activity === 'all' || activityType(item) === next.plan.activity));

  return <div className="home-stack">
    <Window title="Siguiente paso" className="next-window">
      <h2 className="section-title">¿Qué estudio ahora?</h2>
      {nextTopic ? <div className="next-session">
        <div><span className="overline">Próxima sesión</span><h3>{nextSubject?.name} · {nextTopic.name}</h3>
          <p><time dateTime={next.start.toISOString()}>{localTime(next.start)}</time> · {next.plan.minutes} min</p>
          <p>{activities[next.plan.activity || 'all']}</p>
          {!scheduledItems && <p>Añade contenido de esta actividad para poder empezar.</p>}
        </div>
        {scheduledItems ? <a className="button solid" href={practicePath({ occurrence: next })}><Play size={16}/>Empezar sesión</a>
          : <a className="button solid" href={learningPath(nextSubject?.id, nextTopic.id)}>Abrir tema</a>}
      </div> : lastTopic ? <div className="next-session">
        <div><span className="overline">Último tema practicado</span><h3>{lastSubject?.name} · {lastTopic.name}</h3></div>
        <a className="button solid" href={items.some(item => item.topicId === lastTopic.id)
          ? practicePath({ subject: lastSubject?.id, topic: lastTopic.id, start: true }) : learningPath(lastSubject?.id, lastTopic.id)}>
          Continuar último tema
        </a>
      </div> : <div className="next-session">
        <p>{items.length ? 'Elige una actividad para empezar a practicar.'
          : subjects.length ? 'Añade contenido a tu biblioteca para empezar a practicar.'
            : 'Crea una materia para organizar lo que quieres aprender.'}</p>
        {items.length ? <a className="button solid" href="#/repasos"><Play size={16}/>Elegir qué practicar</a>
          : subjects.length ? <a className="button solid" href={learningPath(subjects.length === 1 ? subjects[0].id : '')}>Ir a Aprendizaje</a>
            : <button className="button solid" onClick={onCreate}><Plus size={16}/>Crear mi primera materia</button>}
      </div>}
    </Window>
    <Stats attempts={attempts} completed={completed} now={now}/>
    <div className="home-grid">
      <Window title="Repaso pendiente">
        <h2 className="section-title">Temas para retomar</h2>
        {!suggestions.length && <p>Aquí aparecerán los temas con respuestas incorrectas o tarjetas marcadas «Repasar».</p>}
        {suggestions.map(({ topic, cards, errors, recalls }) => <article className="content-row" key={topic.id}>
          <div><strong>{topic.name}</strong>
            <p>{[cards && (cards === 1 ? '1 tarjeta marcada «Repasar»' : cards + ' tarjetas marcadas «Repasar»'),
              errors && (errors === 1 ? '1 respuesta incorrecta' : errors + ' respuestas incorrectas'),
              recalls && (recalls === 1 ? '1 consigna marcada «Repasar»' : recalls + ' consignas marcadas «Repasar»')]
              .filter(Boolean).join(' · ')}</p>
          </div>
          {items.some(item => item.topicId === topic.id) && <a className="button" href={practicePath({ topic: topic.id, start: true })}>Practicar tema</a>}
        </article>)}
      </Window>
      <ActivityCalendar sessions={attempts} completed={completed}/>
    </div>
  </div>;
}
