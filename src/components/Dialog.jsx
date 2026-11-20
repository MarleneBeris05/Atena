import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Dialog({ title, onClose, children, busy = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    const viewport = window.visualViewport;
    if (!viewport) return;
    const fitViewport = () => {
      dialog.style.setProperty('--visible-height', viewport.height + 'px');
      dialog.style.setProperty('--visible-top', viewport.offsetTop + 'px');
    };
    fitViewport();
    viewport.addEventListener('resize', fitViewport);
    viewport.addEventListener('scroll', fitViewport);
    return () => {
      viewport.removeEventListener('resize', fitViewport);
      viewport.removeEventListener('scroll', fitViewport);
    };
  }, []);

  return <dialog className="window editor-dialog" ref={ref} aria-labelledby={titleId} onClose={onClose}
    onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="window-bar"><span>Edición</span>
      <button type="button" className="icon-button" aria-label="Cerrar" disabled={busy} onClick={() => ref.current.close()}>
        <X size={20} aria-hidden="true"/>
      </button>
    </div>
    <div className="window-body">
      <h2 id={titleId} className="section-title">{title}</h2>
      {children}
    </div>
  </dialog>;
}
