import React, { useState } from 'react';
import { subjectId } from '../data/library';

export default function ScopeFields({ subjects, topics, initialSubject = '', initialTopic = '', required = false }) {
  const [subject, setSubject] = useState(initialSubject);
  const [topic, setTopic] = useState(initialTopic);
  const availableTopics = topics.filter(entry => !subject || subjectId(entry) === subject);

  return <div className="form-columns">
    <label>Materia<select name="subjectId" required={required} value={subject} onChange={event => {
      setSubject(event.target.value);
      setTopic('');
    }}>
      <option value="">{required ? 'Elige una materia' : 'Todas las materias'}</option>
      {subjects.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select></label>
    <label>Tema<select name="topicId" required={required} value={topic}
      disabled={!availableTopics.length} onChange={event => setTopic(event.target.value)}>
      <option value="">{required ? 'Elige un tema' : 'Todos los temas'}</option>
      {availableTopics.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select></label>
  </div>;
}
