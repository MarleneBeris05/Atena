import { useEffect, useState } from 'react';

export default function useLocalStorage(key, initial, migrate = value => value, persistInitial = false) {
  const [error, setError] = useState('');
  const [stored, setStored] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return { value: migrate(initial), dirty: persistInitial };
      const data = JSON.parse(raw);
      const value = migrate(data ?? initial);
      return { value, dirty: value !== data };
    } catch {
      return { value: initial, dirty: false };
    }
  });

  useEffect(() => {
    if (!stored.dirty) return;
    try {
      localStorage.setItem(key, JSON.stringify(stored.value));
      setError('');
    } catch {
      setError('No se pudo guardar. Revisa los permisos o el espacio del navegador.');
    }
  }, [key, stored]);

  const update = next => setStored(previous => ({
    value: typeof next === 'function' ? next(previous.value) : next,
    dirty: true,
  }));

  return [stored.value, update, error];
}
