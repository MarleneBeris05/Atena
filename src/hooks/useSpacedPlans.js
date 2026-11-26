import { useEffect, useState } from 'react';
import { api } from '../data/api';

export default function useSpacedPlans(token, page) {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const active = Boolean(token) && ['inicio', 'aprendizaje', 'planes'].includes(page);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const data = await api('/spaced-plans', { token, signal: controller.signal });
        if (controller.signal.aborted) return;
        setPlans(data.plans);
        setError('');
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 8000);
      }
    }
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, token, revision]);
  return { plans, error, refresh: () => setRevision(previous => previous + 1) };
}
