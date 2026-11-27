import React, { useEffect, useState } from 'react';
import Window from './Window';
import { api } from '../data/api';
import { dateKey } from '../data/study';

const countText = count => count === 1 ? '1 repaso' : count + ' repasos';
const statusName = { scheduled: 'Programado', completed: 'Completado', skipped: 'Omitido' };
const actionable = session => session.status === 'scheduled' && new Date(session.startsAt) > new Date();

export function SpacedSession({ session }) {
  const status = session.status === 'scheduled' && new Date(session.startsAt) <= new Date()
    ? 'Pendiente' : statusName[session.status];
  return <details className="spaced-session">
    <summary>{session.time} · {session.topicName} · {session.minutes} min</summary>
    <p>{session.subjectName} · {session.reason}</p>
    <p>{status}
      {session.pendingSync && ' · Cambio pendiente en el ESP32'}</p>
  </details>;
}

export default function SpacedPlans({ topic, token, data }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const plans = data.plans?.filter(plan => plan.topicId === topic.id) || [];
  async function cancel(plan) {
    if (!window.confirm('¿Cancelar el plan «' + plan.reason + '»?')) return;
    setCancelling(true);
    setError('');
    try {
      await api('/spaced-plans/' + plan.id, { token, method: 'DELETE' });
      if (editing?.id === plan.id) setEditing(null);
      data.refresh();
    } catch (error) {
      setError(error.message);
    } finally {
      setCancelling(false);
    }
  }

  return <Window title="Repetición espaciada">
    {!token ? <p>Inicia sesión y vincula un ESP32 para planificar repasos de este tema.</p> : <>
      {data.error && <p role="alert" className="storage-error">{data.error}</p>}
      {error && <p role="alert" className="storage-error">{error}</p>}
      <div className="actions"><button className="button solid" onClick={() => setEditing({})}>Crear plan de repaso</button>
        <a className="button" href="#/planes">Ver calendario</a>
      </div>
      {plans.map(plan => <article className="content-row" key={plan.id}>
        <div>
          <strong>{plan.reason}</strong>
          <p>{plan.cancelled ? 'Cancelado' : countText(plan.sessions.length)}
            {plan.pendingSync && ' · Cambio pendiente en el ESP32'}</p>
        </div>
        {!plan.cancelled && <div className="actions">
          <button className="button" disabled={cancelling} onClick={() => setEditing(plan)}>Editar plan</button>
          <button className="button" disabled={cancelling} onClick={() => cancel(plan)}>Cancelar plan</button>
        </div>}
      </article>)}
      {editing && <SpacedPlanForm key={editing.id || 'new'} plan={editing} topic={topic} token={token}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.refresh(); }}/>}
    </>}
  </Window>;
}

function SpacedPlanForm({ plan, topic, token, onClose, onSaved }) {
  const [devices, setDevices] = useState(null);
  const [deviceError, setDeviceError] = useState('');
  const [form, setForm] = useState(() => {
    const today = new Date();
    const exam = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
    return {
      topicId: topic.id, startDate: plan.startDate || dateKey(today), examDate: plan.examDate || dateKey(exam),
      reason: plan.reason || '', time: plan.time || '18:00', minutes: plan.minutes || 25,
      timeZone: plan.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      deviceId: plan.deviceId || '',
    };
  });
  const [preview, setPreview] = useState(() => plan.sessions?.filter(actionable)
    .map(({ date, time }) => ({ date, time })) || []);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const initialDevice = devices?.some(device => device.id === form.deviceId) ? form.deviceId : devices?.[0]?.id || '';
  const values = { ...form, deviceId: initialDevice, minutes: Number(form.minutes) };
  useEffect(() => {
    const controller = new AbortController();
    api('/devices', { token, signal: controller.signal }).then(data => setDevices(data.devices))
      .catch(error => { if (!controller.signal.aborted) setDeviceError(error.message); });
    return () => controller.abort();
  }, [token]);

  function setField(field, value) {
    setForm(previous => ({ ...previous, [field]: value }));
    if (['startDate', 'examDate'].includes(field)) setPreview([]);
    if (field === 'time') setPreview(previous => previous.map(entry => ({ ...entry, time: value })));
    setErrors({});
  }

  async function submit(event) {
    event.preventDefault();
    const saving = event.nativeEvent.submitter?.value === 'save';
    const regenerate = event.nativeEvent.submitter?.value === 'regenerate';
    const body = { ...values, ...(preview.length && !regenerate ? { sessions: preview } : {}) };
    const path = saving ? '/spaced-plans' + (plan.id ? '/' + plan.id : '')
      : '/spaced-plans/preview' + (plan.id ? '?planId=' + plan.id : '');
    setBusy(true);
    setErrors({});
    try {
      const response = await api(path, { token, method: saving && plan.id ? 'PUT' : 'POST', body });
      if (saving) onSaved();
      else setPreview(response.sessions.map(({ date, time }) => ({ date, time })));
    } catch (error) {
      const detail = error.detail;
      if (detail?.sessions) setPreview(detail.sessions);
      const issues = detail?.issues || (detail?.field ? [detail] : [{ field: 'form', message: error.message }]);
      setErrors(Object.fromEntries(issues.map(({ field, message }) => [field, message])));
    } finally {
      setBusy(false);
    }
  }

  const issue = field => errors[field] && <span className="storage-error" role="alert">{errors[field]}</span>;
  const field = (name, label, type, attributes = {}) => <label>{label}
    <input type={type} value={form[name]} required aria-invalid={Boolean(errors[name])}
      onChange={event => setField(name, event.target.value)} {...attributes}/>{issue(name)}
  </label>;

  return <form className="spaced-plan-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <legend>{plan.id ? 'Editar plan de repaso' : 'Nuevo plan de repaso'}</legend>
      {field('reason', 'Motivo', 'text', { maxLength: 200 })}
      <div className="form-columns">
        {field('startDate', 'Fecha de inicio', 'date')}
        {field('examDate', 'Fecha límite (examen)', 'date')}
        {field('time', 'Hora local de repaso', 'time')}
        {field('minutes', 'Minutos por sesión', 'number', { min: 1, max: 180, step: 1 })}
      </div>
      <p>Zona horaria del plan: {form.timeZone}</p>{issue('timeZone')}
      <label>Enviar a<select required value={initialDevice} onChange={event => setField('deviceId', event.target.value)}>
        {!devices?.length && <option value="">{devices ? 'Sin equipos vinculados' : 'Consultando dispositivos…'}</option>}
        {devices?.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
      </select>{issue('deviceId')}</label>
      {deviceError && <p role="alert" className="storage-error">{deviceError}</p>}
      {devices?.length === 0 && <p><a href="#/dispositivo">Vincula un ESP32 para guardar el plan.</a></p>}
      <p>La fecha de inicio es el estudio inicial. La propuesta programa los repasos antes del examen.
        Puedes ajustar un repaso para hoy si su hora aún es futura.</p>
      {preview.length > 0 && <div className="spaced-preview">
        <h3>Vista previa</h3>
        {preview.map((slot, index) => {
          function change(key, value) {
            setPreview(previous => previous.map((entry, row) => row === index ? { ...entry, [key]: value } : entry));
            setErrors({});
          }
          return <fieldset className="form-columns" key={index}>
            <legend>Repaso {index + 1}</legend>
            <label>Fecha<input type="date" value={slot.date} min={form.startDate} required
              onChange={event => change('date', event.target.value)}/></label>
            <label>Hora local<input type="time" value={slot.time} required
              onChange={event => change('time', event.target.value)}/></label>
            {issue('sessions.' + index)}{issue('sessions.' + index + '.date')}{issue('sessions.' + index + '.time')}
          </fieldset>;
        })}
      </div>}
      {issue('sessions')}{issue('topicId')}{issue('form')}
      <div className="actions">
        <button className="button" disabled={!initialDevice} value="preview">{preview.length ? 'Validar vista previa' : 'Ver fechas sugeridas'}</button>
        {preview.length > 0 && <button className="button" value="regenerate" formNoValidate disabled={!initialDevice}>Regenerar fechas</button>}
        {preview.length > 0 && <button className="button solid" value="save" disabled={!initialDevice}>Guardar plan</button>}
        <button type="button" className="button" onClick={onClose}>Cerrar formulario</button>
      </div>
    </fieldset>
  </form>;
}
