import { useEffect, useState } from 'react';
import { api } from '../data/api';

export default function useAccountLibrary(token) {
  const [library, setLibrary] = useState(null);
  const [loadedToken, setLoadedToken] = useState(null);
  const [failure, setFailure] = useState(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api('/library', { token, signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setLibrary(result);
      setLoadedToken(token);
    }).catch(error => {
      if (!controller.signal.aborted) setFailure({ token, request, message: error.message });
    });
    return () => controller.abort();
  }, [token, request]);

  const error = failure && failure.token === token && failure.request === request ? failure.message : '';
  return {
    library: loadedToken === token ? library : null,
    loading: Boolean(token && loadedToken !== token && !error),
    error,
    retry: () => setRequest(previous => previous + 1),
    async save(collection, entry, editing) {
      const path = '/library/' + collection + (editing ? '/' + encodeURIComponent(entry.id) : '');
      const saved = await api(path, { token, method: editing ? 'PUT' : 'POST', body: entry });
      setLibrary(previous => ({
        ...previous,
        [collection]: previous[collection].some(item => item.id === saved.id)
          ? previous[collection].map(item => item.id === saved.id ? saved : item)
          : [...previous[collection], saved],
      }));
      return saved;
    },
    async remove(collection, id) {
      await api('/library/' + collection + '/' + encodeURIComponent(id), { token, method: 'DELETE' });
      setLibrary(previous => ({
        ...previous,
        [collection]: previous[collection].filter(entry => entry.id !== id),
        reviews: previous.reviews.filter(entry => collection === 'topics' ? entry.topicId !== id : entry.id !== id),
      }));
    },
    async importFromBrowser(value) {
      const result = await api('/library/import', { token, method: 'POST', body: value });
      setLibrary(result.library);
      return result;
    },
  };
}
