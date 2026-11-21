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
5. Comprueba que `http://127.0.0.1:8000/health` responde HTTP 200 con `{"status":"ok"}`. El endpoint devuelve 503 cuando PostgreSQL o el esquema de biblioteca no están disponibles. La API expone su contrato en `/docs`.

Las pruebas de integración usan PostgreSQL. Instala `backend/requirements-test.txt`, ejecuta las migraciones en una **base de pruebas separada** y configura `ATENA_TEST_DATABASE_URL` con su URL. Desde `backend`, ejecuta `python -m unittest discover -s tests -v`. Las pruebas crean cuentas y contenido de prueba en esa base.

## Recorrido de estudio

1. En **Aprendizaje**, crea la materia «Redes» y el tema «Topologías». Añade una flashcard y un repaso de recuerdo activo desde el tema.
2. En **Repasos**, elige la materia, el tema o el tipo de actividad. Revela la respuesta de una flashcard y marca «La recordé» o «Repasar». También puedes practicar las preguntas de opción múltiple.
3. En **Planes**, programa una actividad eligiendo tema, días, hora local y duración. Abre la próxima sesión desde **Inicio**. Tras responder a todas las actividades, pulsa «Completar sesión programada» para registrarla como completada.
4. En **Dispositivo**, prepara una copia local del material. La disponibilidad en el ESP32 requiere confirmación del equipo. La sincronización física está pendiente.

Con la API configurada, abre **Iniciar sesión** y crea una cuenta con correo y contraseña. Guarda «Redes → Topologías» y una flashcard. Recarga la página y comprueba que sigue en el tema. Después, abre la web en otra sesión del navegador o en tu teléfono e inicia sesión con la misma cuenta.

## Generar flashcards con Gemini

1. Configura `GEMINI_API_KEY` y `GEMINI_MODEL` en el entorno del proceso FastAPI. En Render, agrégalas al servicio **atena-api**. En local, usa [backend/.env.example](backend/.env.example) como referencia. El modelo inicial es `gemini-3.5-flash-lite`. [Ficha del modelo](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite).
2. Ejecuta `python -m alembic upgrade head` desde `backend` para crear la tabla de límites por cuenta. Render ejecuta ese comando en el predespliegue.
3. Inicia sesión y abre **Aprendizaje → Materia → Tema → Generar con IA**. Pega hasta 12 000 caracteres y solicita entre 1 y 10 tarjetas. Atena envía a Gemini el texto pegado y las instrucciones de generación. El límite es de 5 intentos por cuenta cada 10 minutos, incluidos los fallos del proveedor.
4. Revisa el fragmento citado, edita las preguntas y respuestas y marca las tarjetas que quieras conservar. **Guardar seleccionadas** incorpora ese contenido a tu biblioteca.

Las pruebas automáticas simulan el modelo `gemini-3.5-flash-lite`, incluido el transporte HTTP del SDK oficial. Para verificar una generación real, configura la clave en el backend y usa apuntes de prueba con datos ficticios. La generación se activa al configurar ambas variables. La creación manual funciona de forma independiente.

Si los logs indican `http_status=503 provider_status=UNAVAILABLE`, Gemini informó que el servicio no estaba disponible. Cada solicitud de Atena realiza un intento. Si el fallo persiste en `gemini-3.8-flash`, prueba `gemini-3.5-flash-lite` cambiando `GEMINI_MODEL` en **atena-api → Environment** de Render y vuelve a desplegar la API. Comprueba el cambio con apuntes ficticios antes de usarlo con material de estudio. [Errores de la API de Gemini](https://aistudio.google.com/docs/api-errors).

Inicio calcula las métricas desde el lunes con la fecha local del navegador. Tres intentos con la misma flashcard cuentan como tres intentos y una tarjeta distinta. Las sesiones programadas completadas se contabilizan en el día en que se completan.

## Datos locales

La aplicación conserva los datos `repasito.v2.*` y sus identificadores. La ruta `#/temas` abre Aprendizaje. Los temas anteriores aparecen en «Por asignar». Puedes cambiar su materia en «Editar tema». Los planes antiguos conservan los días guardados y admiten una hora al editarlos. Si una instalación antigua usaba los temas o preguntas de ejemplo sin haberlos guardado, se recuperan al encontrar datos de la biblioteca, la agenda o el historial anteriores.

Los intentos antiguos se vinculan a su pregunta cuando coinciden el tema y el título y hay una sola coincidencia. El historial y el calendario conservan los intentos con coincidencias ambiguas. El navegador conserva los datos al recargar en el mismo origen, incluido el puerto. Borrar los datos del sitio elimina la biblioteca y el historial locales.

Con la sesión abierta, **Aprendizaje → Importar biblioteca local** copia materias, temas y actividades a la cuenta y conserva los IDs. La importación conserva la copia local y mantiene las ediciones y eliminaciones que ya hiciste en la cuenta. Si faltan los recursos de los que depende una entrada local, el resultado la cuenta entre los registros sin cambios. En la primera importación confirmada se copian a la cuenta en ese navegador los planes e intentos locales vinculados a los temas importados o ya presentes. Los planes, el historial y la preparación del dispositivo se guardan por cuenta en ese navegador. La biblioteca sí está disponible en otros dispositivos.

## Desplegar en Render

1. Usa [render.yaml](render.yaml) como Blueprint. Define un servicio FastAPI con Python 3.13, un sitio estático y PostgreSQL 17 con acceso privado. El archivo selecciona planes de pago para la API y PostgreSQL. [Referencia de Blueprints](https://render.com/docs/blueprint-spec).
2. En la API, configura `ALLOWED_ORIGINS` con el origen HTTPS del frontend. Separa los orígenes con comas si tienes varios. Render proporciona `DATABASE_URL` desde el PostgreSQL vinculado y genera `SESSION_SECRET`. Ambas variables se usan solo en la API.
3. En el sitio estático, configura `VITE_API_URL` con la URL pública HTTPS de la API. Vite la incorpora durante `npm run build`, así que vuelve a desplegar el sitio si cambia.
4. Comprueba que el paso `python -m alembic upgrade head` del predespliegue termina correctamente. En una instalación configurada manualmente, ejecuta ese mismo comando desde `backend` con `DATABASE_URL` apuntando a la base de destino. Render inicia Uvicorn en el `PORT` del servicio. [Guía de FastAPI en Render](https://render.com/docs/deploy-fastapi).
5. Abre `/health` en la URL pública de la API. En el frontend desplegado, crea una materia, un tema y una flashcard de prueba. Recarga, entra desde un segundo navegador con la misma cuenta y comprueba que otra cuenta tiene su propia biblioteca.

## Desplegar el frontend en Vercel

La configuración de `vercel.json` fija Vite, Node.js 22 (mediante `package.json`), `npm ci`, `npm run build` y la salida `dist`. La interfaz y la lógica de la aplicación no requieren cambios. Las rutas actuales utilizan `#/...`, por lo que no necesitan reglas de reescritura.

1. Importa el repositorio `MarleneBeris05/Atena` en Vercel y selecciona la raíz del repositorio como **Root Directory** (`.`). Conserva la configuración incluida en el repositorio.
2. Para conectar cuentas, biblioteca remota y generación con IA, agrega **VITE_API_URL** en **Settings → Environment Variables**, con la URL pública HTTPS de la API existente (por ejemplo, `https://TU-API.onrender.com`, sin `/docs` ni `/health`). Selecciona Production y los entornos Preview que vayas a utilizar. Sin esta variable, se conserva el modo local de la app.
3. Despliega. En la API de Render, agrega el origen exacto del frontend a **ALLOWED_ORIGINS**, por ejemplo `https://TU-PROYECTO.vercel.app`. Conserva los orígenes existentes separándolos con comas. Reinicia o vuelve a desplegar la API tras cambiar esa variable. Para un dominio personalizado o un Preview, agrega también su origen exacto; la API actual no admite comodines.
4. Si cambia `VITE_API_URL`, vuelve a desplegar el frontend: Vite incorpora esta variable durante la compilación.
5. Verifica `https://TU-API.onrender.com/health`, abre el frontend y prueba iniciar sesión, crear una tarjeta y recuperarla tras recargar. Las claves de Gemini, la conexión PostgreSQL y `SESSION_SECRET` permanecen exclusivamente en el backend.

Este despliegue publica el frontend en Vercel y conserva FastAPI/PostgreSQL en Render, según la arquitectura existente. `.vercelignore` excluye el backend y los archivos locales de las subidas mediante CLI; el directorio servido por Vercel es únicamente `dist`. El almacenamiento local continúa asociado al navegador y al dominio: los datos de localhost no se trasladan automáticamente al nuevo dominio.

Para desplegar por CLI, desde la raíz ejecuta `npx vercel` (Preview) o `npx vercel --prod` (Production) después de configurar las variables en el proyecto. Estos comandos publican el sitio; no son necesarios para validar la compilación local.

Referencia: [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite) y [configuración de vercel.json](https://vercel.com/docs/project-configuration/vercel-json).
