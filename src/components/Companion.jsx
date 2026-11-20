import React from 'react';
import { RefreshCw } from 'lucide-react';
import Window from './Window';

export default function Companion({ onPrepare, prepared, hasContent }) {
  return <Window title="Compañero de estudio" className="companion">
    <h2 className="section-title">Tu compañero Atena</h2>
    <div className="pet-stage"><svg className="pixel-pet" viewBox="0 0 100 110" shapeRendering="crispEdges" aria-label="Atena, compañero virtual verde en un dispositivo de bolsillo" role="img"><path d="M39 4h22v4h10v5h8v9h6v13h4v49h-5v12h-9v7H27v-7H17V84h-5V35h4V22h7v-9h8V8h8z" fill="#b7c896" stroke="#718367" strokeWidth="2"/><path d="M32 14h37v5h8v13H23V22h9z" fill="#d9e1b8"/><path d="M23 39h54v45H23z" fill="#6e8062"/><path d="M28 43h44v36H28z" fill="#d9df9f"/><path d="M43 48h15v5h7v11h-5v9H42v-5h-7V56h8z" fill="#74965e" stroke="#4f7050" strokeWidth="2"/><path d="M43 45v8h-8v-5m23 0h8v7h-8M45 58h3v4h-3m12-4h3v4h-3M48 67h10" fill="none" stroke="#425b43" strokeWidth="3"/><path d="M45 75v4m13-5v5" stroke="#425b43" strokeWidth="3"/><path d="M33 89h7v7h-7zM48 92h7v7h-7zM63 89h7v7h-7z" fill="#a18b73" stroke="#718367" strokeWidth="1.5"/><path d="M93 20h5m-2-3v6" stroke="#829b68" strokeWidth="2"/></svg></div>
    <button className="button solid" disabled={!hasContent} onClick={onPrepare}>
      <RefreshCw size={16} aria-hidden="true"/>{prepared ? 'Preparar de nuevo' : 'Preparar material'}
    </button>
  </Window>;
}
