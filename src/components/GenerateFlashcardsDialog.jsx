import React, { useRef, useState } from 'react';
import Dialog from './Dialog';
import Flashcard from './Flashcard';

const maxNotes = 12000;
const maxText = 24000;

export default function GenerateFlashcardsDialog({ topic, onGenerate, onSave, onClose, onAccount }) {
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState('5');
  const [drafts, setDrafts] = useState([]);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const pending = useRef(false);
  const selected = drafts.filter(draft => draft.selected);
  const canSave = selected.length > 0 && selected.every(draft => draft.question.trim() && draft.answer.trim());

  const update = (id, patch) => setDrafts(previous => previous.map(draft => draft.id === id ? { ...draft, ...patch } : draft));
  const run = async (action, task) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setFeedback(null);
    try { await task(); }
    catch (error) { setFeedback({ action, error }); }
    finally {
      pending.current = false;
      setBusy('');
    }
  };
  const renderFeedback = action => feedback?.action === action && (feedback.error ? <>
    <p className="storage-error" role="alert">{feedback.error.message}</p>
    {feedback.error.status === 401 && <button className="button" type="button" onClick={onAccount}>Volver a iniciar sesión</button>}
  </> : <p role="status">{feedback.message}</p>);

  return <Dialog title="Generar flashcards con IA" onClose={onClose} busy={!!busy}>
    <p>{topic.name} · Se enviarán a Gemini los apuntes que pegues aquí.</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!notes.trim()) {
        setFeedback({ action: 'generate', error: new Error('Pega tus apuntes antes de generar las tarjetas.') });
        return;
      }
      run('generate', async () => {
        const response = await onGenerate(topic.id, { notes, count: Number(count) });
        setDrafts(response.drafts.map(draft => ({ ...draft, id: crypto.randomUUID(), selected: false })));
        setFeedback({ action: 'generate', message: response.drafts.length
          ? 'Revisa los borradores y marca las tarjetas que quieras guardar.'
          : 'Puedes añadir más detalles a los apuntes para generar tarjetas.' });
      });
    }}>
      <fieldset className="form-controls" disabled={!!busy}>
        <label>Apuntes<textarea rows={6} required maxLength={maxNotes} value={notes} onChange={event => setNotes(event.target.value)}
          aria-describedby="notes-limit"/></label>
        <p id="notes-limit">Máximo 12 000 caracteres.</p>
        <label>Cantidad de tarjetas<input type="number" min={1} max={10} required value={count}
          onChange={event => setCount(event.target.value)}/></label>
        <button className="button solid">{busy === 'generate' ? 'Generando borradores…' : 'Generar borradores'}</button>
      </fieldset>
    </form>
    {busy === 'generate' && <p role="status">Gemini está generando los borradores.</p>}
    {renderFeedback('generate')}
    {drafts.length > 0 && <form className="draft-review" onSubmit={event => {
      event.preventDefault();
      if (!canSave) return;
      run('save', async () => {
        const cards = selected.map(({ id, question, answer }) => ({ id, question: question.trim(), answer: answer.trim() }));
        await onSave(topic.id, cards);
        const saved = new Set(cards.map(card => card.id));
        setDrafts(previous => previous.filter(draft => !saved.has(draft.id)));
        setFeedback({ action: 'save', message: cards.length === 1
          ? 'Se guardó 1 flashcard en tu cuenta.' : 'Se guardaron ' + cards.length + ' flashcards en tu cuenta.' });
      });
    }}>
      <fieldset className="form-controls" disabled={!!busy}>
        <h3>Borradores</h3>
        {drafts.map((draft, index) => <article className="draft-card" aria-label={'Borrador ' + (index + 1)} key={draft.id}>
          <label className="draft-check"><input type="checkbox" checked={draft.selected}
            onChange={event => update(draft.id, { selected: event.target.checked })}/>Seleccionar tarjeta {index + 1}</label>
          <label>Pregunta<textarea rows={3} maxLength={maxText} value={draft.question}
            onChange={event => update(draft.id, { question: event.target.value })}/></label>
          <label>Respuesta<textarea rows={3} maxLength={maxText} value={draft.answer}
            onChange={event => update(draft.id, { answer: event.target.value })}/></label>
          <details>
            <summary>Fragmento de los apuntes</summary>
            <blockquote className="draft-source">{draft.source}</blockquote>
          </details>
          <details>
            <summary>Vista previa de la flashcard</summary>
            <Flashcard item={draft}/>
          </details>
        </article>)}
        <button className="button solid" disabled={!canSave}>{busy === 'save' ? 'Guardando tarjetas…' : 'Guardar seleccionadas'}</button>
      </fieldset>
    </form>}
    {busy === 'save' && <p role="status">Guardando las flashcards en tu cuenta.</p>}
    {renderFeedback('save')}
  </Dialog>;
}
