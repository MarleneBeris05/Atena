import React, { useEffect, useState } from 'react';
import Window from '../components/Window';
import { api } from '../data/api';

const empty = { workMinutes: '', breakMinutes: '' };
const maxMinutes = 2147483647;
const fields = [
  ['workMinutes', 'Tiempo de trabajo (min)'],
  ['breakMinutes', 'Tiempo de descanso (min)'],
];

export default function PomodorosPage({ token, onAccount }) {
  if (token) return <AccountPomodoros token={token}/>;

  return <Window title="Configuraciones">
    <p>{onAccount ? 'Inicia sesión para guardar tus Pomodoros y sincronizarlos con Atena.'
      : 'Conecta la API de Atena para guardar y sincronizar tus Pomodoros.'}</p>
    {onAccount && <button className="button solid" onClick={onAccount}>Iniciar sesión</button>}
  </Window>;
}

function AccountPomodoros({ token }) {
  const [pomodoros, setPomodoros] = useState(null);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api('/pomodoros', { token, signal: controller.signal })
      .then(data => setPomodoros(data.pomodoros))
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [token, revision]);

  function reset() {
    setEditing(null);
    setForm(empty);
  }

  async function save(task, message) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await task();
      setStatus(message);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const body = { workMinutes: Number(form.workMinutes), breakMinutes: Number(form.breakMinutes) };
    if (Object.values(body).some(value => !Number.isInteger(value) || value < 1 || value > maxMinutes)) {
      setError('Introduce minutos enteros positivos para ambos tiempos.');
      return;
    }
    save(async () => {
      const entry = await api(editing ? '/pomodoros/' + editing : '/pomodoros', {
        token, method: editing ? 'PUT' : 'POST', body,
      });
      setPomodoros(list => editing ? list.map(previous => previous.id === entry.id ? entry : previous)
        : [...list, entry]);
      reset();
    }, 'Pomodoro guardado.');
  }

  function remove(entry, label) {
    if (!window.confirm('¿Eliminar el Pomodoro de ' + label + '?')) return;
    save(async () => {
      await api('/pomodoros/' + entry.id, { token, method: 'DELETE' });
      if (editing === entry.id) reset();
      setPomodoros(list => list.filter(previous => previous.id !== entry.id));
    }, 'Pomodoro eliminado.');
  }

  return <div className="page-stack">
    <Window title="Configuraciones">
      <p>Elige <strong>Sincronizar</strong> en el menú de tu Atena vinculada para actualizar la lista.
        Puedes vincular tu ESP32 en <a href="#/dispositivo">Dispositivo</a>.</p>
      {loadError && <>
        <p role="alert" className="storage-error">{loadError}</p>
        <button className="button" onClick={() => { setLoadError(''); setRevision(value => value + 1); }}>Reintentar</button>
      </>}
      {!pomodoros && !loadError && <p role="status">Cargando Pomodoros…</p>}
      {pomodoros?.length === 0 && <p>Aún no tienes Pomodoros.</p>}
      {pomodoros?.map(entry => {
        const label = `${entry.workMinutes} min de trabajo · ${entry.breakMinutes} min de descanso`;
        return <article className="content-row" key={entry.id}>
          <strong>{label}</strong>
          <div className="actions">
            <button className="button" aria-label={'Editar ' + label} disabled={busy} onClick={() => {
              setEditing(entry.id);
              setForm(entry);
              setError('');
              setStatus('');
            }}>Editar</button>
            <button className="button" aria-label={'Eliminar ' + label} disabled={busy}
              onClick={() => remove(entry, label)}>Eliminar</button>
          </div>
        </article>;
      })}
    </Window>
    {pomodoros && <Window title={editing ? 'Editar Pomodoro' : 'Crear Pomodoro'}>
      <form onSubmit={submit}>
        <fieldset className="form-controls" disabled={busy}>
          <div className="form-columns">
            {fields.map(([field, label]) => <label key={field}>{label}
              <input type="number" inputMode="numeric" required min="1" max={maxMinutes} step="1" value={form[field]}
                onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))}/>
            </label>)}
          </div>
          <div className="actions">
            <button className="button solid">{busy ? 'Guardando…' : 'Guardar Pomodoro'}</button>
            {editing && <button className="button" type="button" onClick={() => { reset(); setError(''); }}>Cancelar edición</button>}
          </div>
        </fieldset>
        {error && <p role="alert" className="storage-error">{error}</p>}
        {status && <p role="status">{status}</p>}
      </form>
    </Window>}
  </div>;
}
