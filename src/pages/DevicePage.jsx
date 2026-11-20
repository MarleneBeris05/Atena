import React from 'react';
import Companion from '../components/Companion';
import Window from '../components/Window';
import { itemName } from '../data/library';

export default function DevicePage({ items, device, onPrepare }) {
  const snapshots = new Map(device.items?.map(item => [item.id, JSON.stringify(item)]));
  return <div className="device-layout">
    <Companion onPrepare={onPrepare} prepared={!!device.items?.length} hasContent={!!items.length}/>
    <Window title="Material para el ESP32">
      <h2 className="section-title">Preparación del dispositivo</h2>
      <div className="device-status">
        <strong>Disponible en el ESP32: sin confirmar</strong>
        <p>La sincronización física está pendiente. El ESP32 debe confirmar qué material recibió.</p>
      </div>
      {!items.length && <p>Añade contenido en <a href="#/aprendizaje">Aprendizaje</a> para preparar material.</p>}
      {items.map(item => <article className="content-row" key={item.id}>
        <strong>{itemName(item)}</strong>
        <span className="item-status">{snapshots.get(item.id) === JSON.stringify(item)
          ? 'Preparado en este navegador' : 'Pendiente de preparar'}</span>
      </article>)}
      {device.items?.length > 0 && device.preparedAt && <p>Última preparación: {new Date(device.preparedAt).toLocaleString('es-MX')}</p>}
    </Window>
  </div>;
}
