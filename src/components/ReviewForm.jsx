import React, { useState } from 'react';
import { activities, activityType } from '../data/library';
import Flashcard from './Flashcard';

export default function ReviewForm({ item, topicId, onSave, onDelete, initialType = 'recall' }) {
  const [type, setType] = useState(item ? activityType(item) : initialType);
  const [question, setQuestion] = useState(item?.question ?? '');
  const [answer, setAnswer] = useState(item?.answer ?? '');
  const choice = type === 'choice';

  return <form onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = type === 'flashcard' ? '' : data.get('name').trim();
    if (!question.trim() || (type === 'flashcard' ? !answer.trim() : !name)) {
      event.currentTarget.reportValidity();
      return;
    }
    const updated = { ...item, topicId, type, name, question: question.trim() };
    if (type === 'flashcard') updated.answer = answer.trim();
    if (choice) {
      updated.options = [0, 1, 2].map(index => data.get('option-' + index).trim());
      updated.correct = Number(data.get('correct'));
      updated.explanation = data.get('explanation').trim();
    }
    onSave(updated);
  }}>
    {!item && <label>Tipo de contenido<select value={type} onChange={event => setType(event.target.value)}>
      {Object.entries(activities).filter(([id]) => id !== 'all').map(([id, name]) =>
        <option value={id} key={id}>{name}</option>)}
    </select></label>}
    {type !== 'flashcard' && <label>Título<input name="name" required maxLength={300} pattern=".*\S.*" defaultValue={item?.name}/></label>}
    <label>{type === 'recall' ? 'Consigna abierta' : 'Pregunta'}
      <textarea required rows={4} maxLength={24000} value={question} onChange={event => {
        setQuestion(event.target.value);
        event.target.setCustomValidity(event.target.value && !event.target.value.trim() ? 'Escribe una consigna o pregunta.' : '');
      }}/>
    </label>
    {type === 'flashcard' && <>
      <label>Respuesta<textarea required rows={4} maxLength={24000} value={answer} onChange={event => {
        setAnswer(event.target.value);
        event.target.setCustomValidity(event.target.value && !event.target.value.trim() ? 'Escribe una respuesta.' : '');
      }}/></label>
      <details className="content-preview">
        <summary>Vista previa de la flashcard</summary>
        <Flashcard item={{ question, answer }}/>
      </details>
    </>}
    {choice && <>
      {[0, 1, 2].map(index => <label key={index}>Opción {index + 1}
        <input required pattern=".*\S.*" name={'option-' + index} defaultValue={item?.options[index]}/>
      </label>)}
      <label>Opción correcta<select name="correct" defaultValue={item?.correct ?? 0}>
        {[0, 1, 2].map(index => <option key={index} value={index}>Opción {index + 1}</option>)}
      </select></label>
      <label>Explicación<textarea name="explanation" rows={3} defaultValue={item?.explanation}/></label>
    </>}
    <div className="actions">
      <button className="button solid">Guardar contenido</button>
      {item && <button className="button" type="button" onClick={onDelete}>Eliminar contenido</button>}
    </div>
  </form>;
}
