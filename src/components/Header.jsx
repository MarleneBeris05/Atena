import React from 'react';
import { Gamepad2, House, Library, RotateCcw, CalendarDays, Monitor, Timer } from 'lucide-react';

const sections = [
  [House, 'Inicio', 'inicio'],
  [Library, 'Aprendizaje', 'aprendizaje'],
  [RotateCcw, 'Repasos', 'repasos'],
  [CalendarDays, 'Planes', 'planes'],
  [Monitor, 'Dispositivo', 'dispositivo'],
  [Timer, 'Pomodoros', 'pomodoros'],
];

export const routes = sections.map(([, , route]) => route);

export default function Header({ active, user, onProfile, account, onAccount }) {
  return <header className="site-header">
    <a className="brand" href="#/inicio"><Gamepad2 size={25} aria-hidden="true"/>Atena</a>
    <div className="header-actions">
    {onProfile && <button className="user-profile" onClick={onProfile} aria-label="Editar perfil">
      <span className="avatar" aria-hidden="true">{user.name.slice(0, 2).toUpperCase()}</span>
      <span><strong>{user.name}</strong><small>Perfil local</small></span>
    </button>}
    {onAccount && <button className="button" onClick={onAccount}>{account ? 'Mi cuenta' : 'Iniciar sesión'}</button>}
    </div>
    <nav aria-label="Navegación principal">
      {sections.map(([Icon, label, route]) => <a key={route} href={'#/' + route}
        className={active === route ? 'nav-active' : ''} aria-current={active === route ? 'page' : undefined}>
        <Icon size={18} aria-hidden="true"/>{label}
      </a>)}
    </nav>
  </header>;
}
