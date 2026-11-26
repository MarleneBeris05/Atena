const base = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const sessionKey = 'atena.session.' + base;
export const hasAccountApi = Boolean(base);

const messages = {
  authentication_required: 'Tu sesión venció. Vuelve a iniciar sesión para continuar.',
  invalid_credentials: 'El correo o la contraseña no coinciden.',
  registration_conflict: 'Ese correo ya está registrado.',
  resource_not_found: 'El recurso ya no está disponible. Comprueba la biblioteca y vuelve a intentarlo.',
  resource_conflict: 'Ya existe otro registro con ese identificador.',
  invalid_data: 'Revisa los datos. Algún campo está vacío, es demasiado largo o tiene un formato inválido.',
  database_unavailable: 'La biblioteca está temporalmente inaccesible. Inténtalo de nuevo.',
  device_pair_limit: 'Se alcanzó el límite de intentos. Espera unos minutos antes de volver a vincular.',
  device_code_unavailable: 'El código caducó, ya se utilizó o es incorrecto. Pide uno nuevo al dispositivo.',
  device_empty_deck: 'Guarda al menos una flashcard en este tema para publicar el mazo.',
  device_deck_too_large: 'El mazo supera el límite de 500 tarjetas o 1 MiB. Divide el tema en dos mazos más pequeños.',
  pomodoro_limit: 'Puedes guardar hasta 64 Pomodoros por cuenta. Elimina uno antes de crear otro.',
  generation_limit: 'La generación permite hasta 5 intentos cada 10 minutos. Espera antes de volver a intentarlo.',
  generation_not_configured: 'La generación con Gemini aún no está configurada. Puedes crear flashcards manualmente.',
  generation_timeout: 'Gemini tardó demasiado en responder. Puedes volver a intentarlo con estos apuntes.',
  generation_quota: 'Gemini agotó su cuota. Inténtalo más tarde o crea una flashcard manualmente.',
  generation_provider_unavailable: 'Gemini no está disponible en este momento. Tus apuntes se conservan. Inténtalo más tarde o crea una flashcard manualmente.',
  generation_invalid: 'Gemini devolvió borradores inválidos o fragmentos que no aparecen en los apuntes. Inténtalo de nuevo.',
  generation_unavailable: 'Gemini no pudo generar los borradores. Inténtalo de nuevo o crea una flashcard manualmente.',
};

export async function api(path, { token, method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(base + path, {
      method, headers, signal, cache: 'no-store', credentials: 'omit',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('No pudimos conectar con la API. Revisa tu conexión e inténtalo de nuevo.');
  }
  if (response.status === 204) return;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(messages[data?.detail] || 'La API no pudo completar la solicitud. Inténtalo de nuevo.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function readSession() {
  if (!hasAccountApi) return null;
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey));
    return session?.account?.id && session?.account.email && session?.token ? session : null;
  } catch { return null; }
}

export function storeSession(session) {
  try {
    if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
    else sessionStorage.removeItem(sessionKey);
  } catch { /* The active tab can still use its in-memory session. */ }
}
