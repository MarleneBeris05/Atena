import { useEffect, useRef, useState } from 'react';
import { api } from '../data/api';

export default function useDeviceActivity(token, page) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const cursor = useRef('0');

  useEffect(() => {
    if (!token || !['inicio', 'planes', 'dispositivo'].includes(page)) return;
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        let result;
        do {
          result = await api('/devices/activity?after=' + cursor.current, { token, signal: controller.signal });
          if (controller.signal.aborted) return;
          cursor.current = result.nextCursor;
          if (result.events.length) setEvents(previous => [...previous, ...result.events]);
        } while (result.hasMore);
        setError('');
        setLoaded(true);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 15000);
      }
    }
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, page, revision]);

  return { events, error, loaded, refresh: () => setRevision(value => value + 1) };
}
