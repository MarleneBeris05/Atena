import React from 'react';
export default function Window({ title, children, className = '' }) {
  return <section className={`window ${className}`}><div className="window-bar"><span>{title}</span><span className="window-controls" aria-hidden="true">− ◇ ×</span></div><div className="window-body">{children}</div></section>;
}

