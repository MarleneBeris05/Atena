import React, { useEffect, useRef, useState } from 'react';
import Companion from '../components/Companion';
import Window from '../components/Window';
import { api } from '../data/api';
import { activityType, itemName, subjectId } from '../data/library';

function LocalDevicePage({ items, device, onPrepare, onAccount }) {
  const snapshots = new Map(device.items?.map(item => [item.id, JSON.stringify(item)]));
  return <div className="device-layout">
    <Companion onPrepare={onPrepare} prepared={!!device.items?.length} hasContent={!!items.length}/>
    <Window title="Material para el ESP32">
      <h2 className="section-title">Sin vincular</h2>
      <p>Inicia sesión para vincular un dispositivo y sincronizar tus flashcards.</p>
      {onAccount && <button className="button solid" onClick={onAccount}>Iniciar sesión</button>}
      {!items.length && <p>Añade contenido en <a href="#/aprendizaje">Aprendizaje</a> para preparar material.</p>}
      {items.map(item => <article className="content-row" key={item.id}>
        <strong>{itemName(item)}</strong>
        <span className="item-status">{snapshots.get(item.id) === JSON.stringify(item)
          ? 'Preparado en este navegador' : 'Pendiente de preparar'}</span>
      </article>)}
    </Window>
  </div>;
}

export default function DevicePage(props) {
  return props.token ? <AccountDevicePage {...props}/> : <LocalDevicePage {...props}/>;
}

function AccountDevicePage({ token, items, subjects, topics, activity }) {
  const [devices, setDevices] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [topicId, setTopicId] = useState('');
  const [code, setCode] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const response = await api('/devices', { token, signal: controller.signal });
        if (!controller.signal.aborted) {
          setDevices(response.devices);
          setLoadError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 8000);
      }
    }
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, revision]);

  const run = async (task, success) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    setActionError('');
    try {
      await task();
      setRevision(value => value + 1);
      setMessage(success);
    } catch (error) { setActionError(error.message); }
    finally {
      setBusy(false);
      pending.current = false;
    }
  };

  const current = devices?.find(device => device.id === selectedDevice) || devices?.[0];
  const selectedTopic = topics.find(topic => topic.id === topicId);
  const cardCount = selectedTopic ? items.filter(item => item.topicId === topicId && activityType(item) === 'flashcard').length : 0;
  const published = current?.published;
  const confirmed = current?.confirmed;
  const status = !current ? 'Sin vincular' : !published ? 'Vinculado · Sin mazo publicado'
    : confirmed?.version === published.version ? 'Disponible sin conexión' : 'Pendiente de sincronizar';

  return <div className="device-layout device-layout-account">
    <div className="device-panels">
      <Window title="Sincronización con el ESP32">
        <h2 className="section-title">Mi Atena</h2>
        {devices === null && !loadError && <p role="status">Consultando dispositivos…</p>}
        {devices !== null && <p className="device-status" role="status"><strong>{status}</strong></p>}
        {loadError && <p className="storage-error" role="alert">{loadError}</p>}
        {actionError && <p className="storage-error" role="alert">{actionError}</p>}
        {message && <p role="status">{message}</p>}
        {busy && <p role="status">Guardando cambios…</p>}
        {devices !== null && <>
          {current && <>
            <label className="device-field">Dispositivo
              <select value={current.id} onChange={event => setSelectedDevice(event.target.value)} disabled={busy}>
                {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
            </label>
            {published && <p>Tema publicado: <strong>{published.subject.name} · {published.topic.name}</strong>
              {' · Versión '}{published.version}{' · '}{published.cardCount} {published.cardCount === 1 ? 'flashcard' : 'flashcards'}</p>}
            {confirmed ? <p>Última sincronización confirmada: <time dateTime={confirmed.confirmedAt}>
              {new Date(confirmed.confirmedAt).toLocaleString('es-MX')}</time>
              {' · '}{confirmed.topic.name}{' · Versión '}{confirmed.version}</p> : <p>Aún no hay una sincronización confirmada.</p>}
            <form className="device-form" onSubmit={event => {
              event.preventDefault();
              if (cardCount > 0) run(() => api('/devices/' + current.id + '/decks', {
                token, method: 'POST', body: { topicId },
              }), 'Mazo publicado. El equipo confirmará cuando reciba la nueva versión.');
            }}>
              <label>Tema para el mazo
                <select value={topicId} onChange={event => setTopicId(event.target.value)} disabled={busy} required>
                  <option value="">Elige un tema</option>
                  {topics.map(topic => <option value={topic.id} key={topic.id}>
                    {(subjects.find(subject => subject.id === subjectId(topic))?.name || 'Por asignar') + ' · ' + topic.name}
                  </option>)}
                </select>
              </label>
              {!topics.length && <p>Crea un tema en <a href="#/aprendizaje">Aprendizaje</a> y guarda sus flashcards.</p>}
              {selectedTopic && <p>{cardCount === 1 ? '1 flashcard guardada.' : cardCount + ' flashcards guardadas.'} {cardCount === 0 && <>
                Añade una flashcard manual o guarda una generada en <a href="#/aprendizaje">Aprendizaje</a>.
              </>}</p>}
              <button className="button solid" disabled={busy || !cardCount}>Preparar para mi Atena</button>
            </form>
            <button className="button" disabled={busy} onClick={() => {
              if (window.confirm('¿Desvincular ' + current.name + '? Se revocará su acceso a la cuenta.')) {
                run(() => api('/devices/' + current.id, { token, method: 'DELETE' }), 'Dispositivo desvinculado.');
              }
            }}>Desvincular dispositivo</button>
          </>}
          <form className="device-form" onSubmit={event => {
            event.preventDefault();
            run(async () => {
              const result = await api('/devices/pairings/claim', { token, method: 'POST', body: { code } });
              setSelectedDevice(result.id);
              setCode('');
            }, 'Dispositivo vinculado.');
          }}>
            <h3>{current ? 'Vincular otro dispositivo' : 'Vincular dispositivo'}</h3>
            <p>Introduce el código de ocho caracteres que muestra tu Atena.</p>
            <label>Código del dispositivo
              <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} autoComplete="off"
                autoCapitalize="characters" maxLength={8} minLength={8} pattern="[2-9A-HJ-NP-Z]{8}" required disabled={busy}/>
            </label>
            <button className="button solid" disabled={busy}>Vincular con código</button>
          </form>
        </>}
        <button className="button" disabled={busy} onClick={() => {
          setRevision(value => value + 1);
          activity.refresh();
        }}>Actualizar estado</button>
      </Window>
      <Window title="Resultados del ESP32">
        <h2 className="section-title">Actividad sin conexión</h2>
        {activity.error && <p className="storage-error" role="alert">{activity.error}</p>}
        {!activity.loaded && !activity.error && <p role="status">Consultando actividad…</p>}
        {activity.loaded && !activity.events.length && <p>Los intentos aparecerán aquí cuando el dispositivo los envíe.</p>}
        {activity.events.length > 0 && <p>{activity.events.length === 1 ? '1 intento sincronizado.' : activity.events.length + ' intentos sincronizados.'} Actividad reciente</p>}
        {[...activity.events].sort((a, b) => new Date(b.studiedAt) - new Date(a.studiedAt)).slice(0, 10).map(event =>
          <article className="content-row" key={event.id}>
            <div><strong>{event.question}</strong><p>{event.topicName}{' · '}{event.deviceName}{' · Versión '}{event.deckVersion}</p>
              <time dateTime={event.studiedAt}>{new Date(event.studiedAt).toLocaleString('es-MX')}</time></div>
            <span>{event.rating === 'remembered' ? 'La recordé' : 'Repasar'}</span>
          </article>)}
      </Window>
    </div>
    <Companion/>
  </div>;
}
