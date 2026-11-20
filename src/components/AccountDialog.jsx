import React, { useState } from 'react';
import Dialog from './Dialog';
import { api } from '../data/api';

export default function AccountDialog({ session, onSession, onClose }) {
  const [mode, setMode] = useState(session ? 'account' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event, action) => {
    event.preventDefault();
    const body = action === 'logout' ? undefined : Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const result = await api('/auth/' + action, { method: 'POST', token: session?.token, body });
      onSession(result || null);
      onClose();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  return <Dialog title={mode === 'register' ? 'Crear cuenta' : mode === 'login' ? 'Iniciar sesión' : 'Tu cuenta'}
    onClose={onClose} busy={busy}>
    {mode === 'account' ? <form onSubmit={event => submit(event, 'logout')}>
      <p>{session.account.email}</p>
      {error && <p className="storage-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="button solid" disabled={busy}>{busy ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
        <button className="button" type="button" disabled={busy} onClick={() => {
          setMode('login');
          setError('');
        }}>Volver a iniciar sesión</button>
      </div>
    </form> : <form onSubmit={event => submit(event, mode)}>
      <fieldset disabled={busy} className="form-controls">
        <label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength={254}
          defaultValue={session?.account.email}/></label>
        <label>Contraseña<input key={mode} name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required minLength={mode === 'register' ? 12 : undefined} maxLength={128}/></label>
        {mode === 'register' && <p>Usa al menos 12 caracteres.</p>}
        {error && <p className="storage-error" role="alert">{error}</p>}
        <div className="actions">
          <button className="button solid">{busy ? 'Conectando…' : mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión'}</button>
          {!session && <button className="button" type="button" onClick={() => {
            setMode(mode === 'register' ? 'login' : 'register');
            setError('');
          }}>{mode === 'register' ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button>}
        </div>
      </fieldset>
    </form>}
  </Dialog>;
}
