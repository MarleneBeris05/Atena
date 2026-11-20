import React, { useLayoutEffect, useRef, useState } from 'react';

export default function Flashcard({ item, onReveal }) {
  const [revealed, setRevealed] = useState(false);
  const face = useRef(null);
  useLayoutEffect(() => {
    if (!revealed) return;
    face.current.scrollTop = 0;
    face.current.focus({ preventScroll: true });
  }, [revealed]);

  return <div className="flashcard-block">
    <div className="flashcard-face" ref={face} tabIndex={0} aria-label={revealed ? 'Respuesta de la flashcard' : 'Pregunta de la flashcard'} aria-live="polite">
      <strong>{revealed ? 'Respuesta' : 'Pregunta'}</strong>
      <p>{revealed ? item.answer : item.question}</p>
    </div>
    {!revealed && <button className="button" type="button" onClick={() => {
      setRevealed(true);
      onReveal?.();
    }}>Revelar respuesta</button>}
  </div>;
}
