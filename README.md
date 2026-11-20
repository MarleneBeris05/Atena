# Atena

Atena es un asistente de estudio. La web usa React y Vite. Al iniciar sesión, la biblioteca se guarda en PostgreSQL mediante la API de FastAPI y se puede abrir desde otro navegador. El modo local sigue disponible en el mismo navegador.

```sh
npm install
npm run dev
```

Abre la dirección que indica Vite. `npm run build` genera la versión de producción.

## Ejecutar la API en local

1. Crea una base PostgreSQL vacía y un usuario con permisos para migrarla. Usa Python 3.11 o posterior e instala las dependencias con `python -m pip install -r backend/requirements.txt` en un entorno virtual.
2. Configura `DATABASE_URL`, `SESSION_SECRET` y `ALLOWED_ORIGINS` en el entorno del proceso. [backend/.env.example](backend/.env.example) contiene el formato. Genera un secreto aleatorio con `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Conserva el mismo secreto entre reinicios para mantener activas las sesiones.
3. Dentro de `backend`, ejecuta `python -m alembic upgrade head` y `python -m uvicorn atena.main:app --host 127.0.0.1 --port 8000`.
4. En la raíz, copia [.env.example](.env.example) a `.env.local` o configura `VITE_API_URL` en el entorno de Vite. Reinicia `npm run dev` después de cambiarla. Abre el frontend desde un origen exacto de `ALLOWED_ORIGINS`.
5. Comprueba que `http://127.0.0.1:8000/health` responde HTTP 200 con `{"status":"ok"}`. El endpoint devuelve 503 cuando PostgreSQL o los esquemas de biblioteca y dispositivo no están disponibles. La API expone su contrato en `/docs`.

Las pruebas de integración usan PostgreSQL. Instala `backend/requirements-test.txt`, ejecuta las migraciones en una **base de pruebas separada** y configura `ATENA_TEST_DATABASE_URL` con su URL. Desde `backend`, ejecuta `python -m unittest discover -s tests -v`. Las pruebas crean cuentas y contenido de prueba en esa base.

## Recorrido de estudio

1. En **Aprendizaje**, crea la materia «Redes» y el tema «Topologías». Añade una flashcard y un repaso de recuerdo activo desde el tema.
2. En **Repasos**, elige la materia, el tema o el tipo de actividad. Revela la respuesta de una flashcard y marca «La recordé» o «Repasar». También puedes practicar las preguntas de opción múltiple.
3. En **Planes**, programa una actividad eligiendo tema, días, hora local y duración. Abre la próxima sesión desde **Inicio**. Tras responder a todas las actividades, pulsa «Completar sesión programada» para registrarla como completada.
4. En **Dispositivo**, inicia sesión e introduce el código mostrado por tu Atena. Elige el dispositivo y un tema con flashcards y pulsa **Preparar para mi Atena**. La última versión pasa a **Disponible sin conexión** cuando el equipo verifica el paquete y confirma su recepción. Este flujo se puede probar con el cliente ESP32 simulado.

Con la API configurada, abre **Iniciar sesión** y crea una cuenta con correo y contraseña. Guarda «Redes → Topologías» y una flashcard. Recarga la página y comprueba que sigue en el tema. Después, abre la web en otra sesión del navegador o en tu teléfono e inicia sesión con la misma cuenta.

## Generar flashcards con Gemini

1. Configura `GEMINI_API_KEY` y `GEMINI_MODEL` en el entorno del proceso FastAPI. En Render, agrégalas al servicio **atena-api**. En local, usa [backend/.env.example](backend/.env.example) como referencia. El modelo inicial es `gemini-3.5-flash-lite`. [Ficha del modelo](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite).
2. Ejecuta `python -m alembic upgrade head` desde `backend` para crear la tabla de límites por cuenta. Render ejecuta ese comando en el predespliegue.
3. Inicia sesión y abre **Aprendizaje → Materia → Tema → Generar con IA**. Pega hasta 12 000 caracteres y solicita entre 1 y 10 tarjetas. Atena envía a Gemini el texto pegado y las instrucciones de generación. El límite es de 5 intentos por cuenta cada 10 minutos, incluidos los fallos del proveedor.
4. Revisa el fragmento citado, edita las preguntas y respuestas y marca las tarjetas que quieras conservar. **Guardar seleccionadas** incorpora ese contenido a tu biblioteca.

Las pruebas automáticas simulan el modelo `gemini-3.5-flash-lite`, incluido el transporte HTTP del SDK oficial. Para verificar una generación real, configura la clave en el backend y usa apuntes de prueba con datos ficticios. La generación se activa al configurar ambas variables. La creación manual funciona de forma independiente.

Si los logs indican `http_status=503 provider_status=UNAVAILABLE`, Gemini informó que el servicio no estaba disponible. Cada solicitud de Atena realiza un intento. Si el fallo persiste en `gemini-3.8-flash`, prueba `gemini-3.5-flash-lite` cambiando `GEMINI_MODEL` en **atena-api → Environment** de Render y vuelve a desplegar la API. Comprueba el cambio con apuntes ficticios antes de usarlo con material de estudio. [Errores de la API de Gemini](https://aistudio.google.com/docs/api-errors).

Inicio calcula las métricas desde el lunes con la fecha local del navegador. Combina la actividad web y los resultados sincronizados por identificador de intento. Tres intentos sobre la misma flashcard cuentan como tres intentos y una tarjeta distinta. Las sesiones programadas completadas se contabilizan en el día en que se completan.

## Datos locales

La aplicación conserva los datos `repasito.v2.*` y sus identificadores. La ruta `#/temas` abre Aprendizaje. Los temas anteriores aparecen en «Por asignar». Puedes cambiar su materia en «Editar tema». Los planes antiguos conservan los días guardados y admiten una hora al editarlos. Si una instalación antigua usaba los temas o preguntas de ejemplo sin haberlos guardado, se recuperan al encontrar datos de la biblioteca, la agenda o el historial anteriores.

Los intentos antiguos se vinculan a su pregunta cuando coinciden el tema y el título y hay una sola coincidencia. El historial y el calendario conservan los intentos con coincidencias ambiguas. El navegador conserva los datos al recargar en el mismo origen, incluido el puerto. Borrar los datos del sitio elimina la biblioteca y el historial locales.

Con la sesión abierta, **Aprendizaje → Importar biblioteca local** copia materias, temas y actividades a la cuenta y conserva los IDs. La importación conserva la copia local y mantiene las ediciones y eliminaciones que ya hiciste en la cuenta. Si faltan los recursos de los que depende una entrada local, el resultado la cuenta entre los registros sin cambios. En la primera importación confirmada se copian al espacio de esa cuenta en el navegador los planes e intentos locales vinculados a los temas importados o ya presentes. La biblioteca, las publicaciones y los resultados del dispositivo están disponibles al abrir la cuenta en otro navegador. Los planes y los intentos de práctica web se guardan en el navegador donde se crearon.

## Contrato HTTPS para el ESP32

Usa la URL pública HTTPS de la API, valida el certificado TLS del servidor y envía `Content-Type: application/json` en solicitudes con cuerpo. Las rutas marcadas como **cuenta** usan la sesión web mediante `Authorization: Bearer <token-de-cuenta>`. La solicitud inicial de vinculación es pública. La recogida usa `Authorization: Bearer <pollToken>`. Las rutas **equipo** usan `Authorization: Bearer <deviceToken>`.

### Vincular y revocar

| Método y ruta | Autenticación | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| `POST /devices/pairings` | Pública | `{"name":"Mi Atena"}` | `201` con `pairingId`, `code`, `pollToken`, `expiresAt` y `pollIntervalSeconds` |
| `POST /devices/pairings/claim` | Cuenta | `{"code":"ABCD2345"}` | `201` con `id`, `name` y `linkedAt` |
| `POST /devices/pairings/{pairingId}/credential` | `pollToken` | Sin cuerpo | `202` con `{"status":"pending"}` y `Retry-After: 5`, o `200` con `status: "linked"`, `deviceId` y `deviceToken` |
| `GET /devices` | Cuenta | Sin cuerpo | `200` con `{"devices":[...]}` |
| `DELETE /devices/{deviceId}` | Cuenta | Sin cuerpo | `204` y revocación inmediata en el servidor |

Muestra `code` en la pantalla del ESP32. Tiene ocho caracteres del alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, dura 10 minutos y la web puede canjearlo una vez. Conserva `pairingId` y `pollToken` en el dispositivo y consulta cada cinco segundos hasta recibir `deviceToken`. El mismo equipo puede repetir la recogida antes de la caducidad si pierde la respuesta. Al recibir la credencial, guárdala y úsala en las rutas `/devices/sync/…`. El historial ya sincronizado permanece en la cuenta después de revocar el equipo.

El límite es de 20 solicitudes de código por IP y 8 canjes por cuenta, por ventana de 10 minutos. Un código válido en formato que haya caducado, se haya usado o sea desconocido consume un intento de canje. El servidor responde `429 device_pair_limit` y `Retry-After: 600` al alcanzar el límite.

### Publicar, descargar y confirmar

| Método y ruta | Autenticación | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| `POST /devices/{deviceId}/decks` | Cuenta | `{"topicId":"topologias"}` | `201` con el manifiesto publicado |
| `GET /devices/sync/manifest` | Equipo | Sin cuerpo | `200` con `{"available":null,"confirmed":null}` antes de la primera publicación |
| `GET /devices/sync/decks/{version}` | Equipo | Sin cuerpo | `200` con el archivo JSON en UTF-8, `Content-Length` y `ETag` con el SHA-256 entre comillas |
| `POST /devices/sync/decks/{version}/confirm` | Equipo | `{"sha256":"<SHA-256 en 64 caracteres hexadecimales minúsculos>"}` | `200` con `version` y `confirmedAt` |

Cada equipo tiene su propia secuencia de versiones desde `1`. Puede descargar cualquiera de sus versiones publicadas. El mazo admite hasta 500 tarjetas y 1 MiB. `available` contiene el manifiesto más reciente. `confirmed` es `null` o un objeto con `version`, `confirmedAt` y `topic` de la versión confirmada más alta. `GET /devices` devuelve esos mismos datos por equipo en `published` y `confirmed`, junto con `id`, `name` y `linkedAt`.

Ejemplo de manifiesto con tamaño y huella ilustrativos:

```json
{"version":2,"subject":{"id":"redes","name":"Redes"},"topic":{"id":"topologias","name":"Topologías"},"cardCount":1,"sizeBytes":240,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","publishedAt":"2026-11-20T18:00:00Z"}
```

Contenido del paquete, mostrado con formato para facilitar la lectura:

```json
{
  "schemaVersion": 1,
  "version": 2,
  "subject": {"id": "redes", "name": "Redes"},
  "topic": {"id": "topologias", "name": "Topologías"},
  "cards": [{"id": "estrella", "question": "¿Qué conecta los nodos?", "answer": "Un conmutador."}]
}
```

Descarga con `Accept-Encoding: identity` y compara `sizeBytes` y `sha256` con el cuerpo recibido, antes de parsearlo o serializarlo de nuevo. Guarda el archivo y confirma con su SHA-256 verificado. Repetir la misma confirmación devuelve la fecha original. Una confirmación tardía de la versión 1 mantiene pendiente la versión 2 hasta que el equipo confirme esa versión.

### Enviar resultados de estudio

`POST /devices/sync/events` acepta de 1 a 100 eventos por lote y requiere la credencial del equipo. Conserva un UUID por intento real, incluidos los reenvíos. `studiedAt` es la fecha de estudio con zona horaria, en formato RFC 3339. `rating` admite `remembered` («La recordé») y `review` («Repasar»). La tarjeta debe estar en una versión confirmada de ese equipo.

```json
{"events":[{"id":"11bbd55d-1544-4674-aaa6-33407dab962b","cardId":"estrella","deckVersion":2,"rating":"remembered","studiedAt":"2026-11-20T18:15:00Z"}]}
```

La API devuelve `200 {"accepted":1,"duplicates":0}`. Reenviar el mismo evento devuelve `200 {"accepted":0,"duplicates":1}`. Un lote inválido se rechaza completo. Conserva los eventos en la cola del equipo hasta recibir `200`. `GET /devices/activity?after=0` usa sesión de cuenta y devuelve `events`, `nextCursor` como cadena decimal y `hasMore`. Para leer la siguiente página, reenvía `nextCursor` como `after`. Cada evento incluye `id`, `deviceId`, `deviceName`, `deckVersion`, `cardId`, `rating`, `studiedAt`, `topicId`, `topicName` y `question`.

| Código | Detalle y acción |
| --- | --- |
| `401` | `authentication_required` o `device_authentication_required`. Comprueba el tipo de credencial. Un equipo revocado necesita una vinculación nueva. |
| `404` | `device_code_unavailable`, `device_pairing_unavailable` o `resource_not_found`. Pide un código nuevo o consulta el manifiesto de nuevo, según la ruta. |
| `409` | `device_checksum_mismatch` o `device_event_conflict`. Descarga otra vez el paquete o revisa el evento que reutiliza un UUID con datos distintos. |
| `422` | `invalid_data`, `device_empty_deck`, `device_deck_too_large` o `device_event_card_unavailable`. Revisa el formato, el contenido del tema o la versión confirmada. |
| `429` | `device_pair_limit`. Espera el intervalo indicado por `Retry-After`. |
| `503` | `database_unavailable`. Conserva la cola y reintenta más tarde. |

## Desplegar en Render

1. Usa [render.yaml](render.yaml) como Blueprint. Define un servicio FastAPI con Python 3.13 y un sitio estático. El archivo selecciona un plan de pago para la API. [Referencia de Blueprints](https://render.com/docs/blueprint-spec).
2. En la API, configura `ALLOWED_ORIGINS` con el origen HTTPS del frontend y `DATABASE_URL` con la cadena TLS de la base de Atena en Neon. Biblioteca, dispositivos, mazos y eventos comparten esa base. Si los datos actuales están en otro PostgreSQL, transfiere y verifica la base completa en Neon antes de cambiar la URL. Render genera `SESSION_SECRET`. Conserva este valor para mantener las sesiones y credenciales de los dispositivos. [Conectar a Neon](https://neon.com/docs/connect/connect-from-any-app).
3. En el sitio estático, configura `VITE_API_URL` con la URL pública HTTPS de la API. Vite la incorpora durante `npm run build`, así que vuelve a desplegar el sitio si cambia.
4. Comprueba que `python -m alembic upgrade head` termina correctamente contra Neon antes de desplegar. En una instalación configurada manualmente, ejecuta ese mismo comando desde `backend` con `DATABASE_URL` apuntando a la base de destino. Render inicia Uvicorn en el `PORT` del servicio. [Guía de FastAPI en Render](https://render.com/docs/deploy-fastapi).
5. Abre `/health` en la URL pública de la API. En el frontend desplegado, crea una materia, un tema y una flashcard de prueba. Recarga, entra desde un segundo navegador con la misma cuenta y comprueba que otra cuenta tiene su propia biblioteca.
