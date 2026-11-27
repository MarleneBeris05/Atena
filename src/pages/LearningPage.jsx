import React from 'react';
import { Library, Plus } from 'lucide-react';
import Window from '../components/Window';
import Flashcard from '../components/Flashcard';
import SpacedPlans from '../components/SpacedPlans';
import { activities, activityType, itemName, learningPath, practicePath, subjectId, unassigned } from '../data/library';

export default function LearningPage({ subjects, topics, items, subject, topic, invalid, onEdit, canGenerate, token, spaced }) {
  const visibleSubjects = subjects.filter(entry => entry.id !== unassigned.id || topics.some(t => subjectId(t) === entry.id));
  const relevantTopics = subject ? topics.filter(t => subjectId(t) === subject.id) : [];
  const content = topic ? items.filter(item => item.topicId === topic.id) : [];
  const openEditor = (type, fields = {}) => onEdit({ type, ...fields });

  return <>
    <nav className="breadcrumbs" aria-label="Ruta de aprendizaje">
      {subject ? <a href={learningPath()}>Aprendizaje</a> : <span aria-current="page">Aprendizaje</span>}
      {subject && <><span aria-hidden="true">/</span>{topic
        ? <a href={learningPath(subject.id)}>{subject.name}</a>
        : <span aria-current="page">{subject.name}</span>}</>}
      {topic && <><span aria-hidden="true">/</span><span aria-current="page">{topic.name}</span></>}
    </nav>
    {invalid ? <Window title="Aprendizaje">
      <h2 className="section-title">Este contenido ya no está en esa ruta</h2>
      <a className="button" href={learningPath(subject?.id)}>Volver a {subject?.name || 'Aprendizaje'}</a>
    </Window> : topic ? <div className="page-stack"><Window title="Tema">
      <div className="section-heading">
        <div><h2>{topic.name}</h2>{topic.description && <p>{topic.description}</p>}</div>
        <div className="actions">
          <button className="button" onClick={() => openEditor('topic', { topic })}>Editar tema</button>
          <button className="button" onClick={() => openEditor('item', { topic })}>Añadir contenido</button>
          <button className="button solid" onClick={() => openEditor('item', { topic, initialType: 'flashcard' })}><Plus size={17}/>Crear flashcard</button>
          {canGenerate && <button className="button" onClick={() => openEditor('generate', { topic })}>Generar con IA</button>}
        </div>
      </div>
      {!!content.length && <a className="button" href={practicePath({ subject: subject.id, topic: topic.id, start: true })}>Practicar tema</a>}
      {!content.length && <p>Añade un repaso de recuerdo activo o una flashcard para empezar.</p>}
      {Object.entries(activities).filter(([id]) => id !== 'all' && content.some(item => activityType(item) === id)).map(([id, name]) =>
        <section className="content-group" key={id}>
          <h3>{id === 'recall' ? 'Repasos de recuerdo activo' : name}</h3>
          {content.filter(item => activityType(item) === id).map(item => <article className="content-row" key={item.id}>
            <details className="content-preview">
              <summary><span className="content-label">{itemName(item)}</span></summary>
              {id === 'flashcard' ? <Flashcard item={item}/> : <p className="written">{item.question}</p>}
              {id === 'choice' && <><ul>{item.options.map((option, index) => <li key={index}>{option}</li>)}</ul>
                <p>Respuesta correcta: {item.options[item.correct]}</p>{item.explanation && <p>{item.explanation}</p>}</>}
            </details>
            <div className="actions">
              <a className="button" href={practicePath({ subject: subject.id, topic: topic.id, item: item.id })}>Practicar</a>
              <button className="button" onClick={() => openEditor('item', { topic, item })}>Editar</button>
            </div>
          </article>)}
        </section>)}
    </Window><SpacedPlans key={topic.id} topic={topic} token={token} data={spaced}/></div> : subject ? <Window title="Materia">
      <div className="section-heading">
        <div><h2>{subject.name}</h2>{subject.description && <p>{subject.description}</p>}</div>
        <div className="actions">
          {subject.id !== unassigned.id && <button className="button" onClick={() => openEditor('subject', { subject })}>Editar materia</button>}
          <button className="button solid" onClick={() => openEditor('topic', { subject })}><Plus size={17}/>Crear tema</button>
        </div>
      </div>
      {!relevantTopics.length && <p>Esta materia todavía no tiene temas.</p>}
      <div className="library-grid">
        {relevantTopics.map(entry => <a className="library-card" key={entry.id} href={learningPath(subject.id, entry.id)}>
          <strong>{entry.name}</strong>
          <span>{items.filter(item => item.topicId === entry.id).length} actividades</span>
        </a>)}
      </div>
    </Window> : <Window title="Biblioteca">
      <div className="section-heading">
        <h2>Materias</h2>
        <button className="button solid" onClick={() => openEditor('subject')}><Plus size={17}/>
          {visibleSubjects.length ? 'Crear materia' : 'Crear mi primera materia'}
        </button>
      </div>
      {!visibleSubjects.length && <p>Organiza lo que estudias en materias y temas.</p>}
      <div className="library-grid">
        {visibleSubjects.map(entry => <a className="library-card" key={entry.id} href={learningPath(entry.id)}>
          <Library size={21} aria-hidden="true"/>
          <strong>{entry.name}</strong>
          <span>{topics.filter(t => subjectId(t) === entry.id).length} temas</span>
        </a>)}
      </div>
    </Window>}
  </>;
}
