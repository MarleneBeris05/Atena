# Atena

Atena es un asistente de estudio. La web usa React y Vite. Al iniciar sesión, la biblioteca se guarda en PostgreSQL mediante la API de FastAPI y se puede abrir desde otro navegador. El modo local sigue disponible en el mismo navegador.

```sh
npm install
npm run dev
```

Abre la dirección que indica Vite. `npm run build` genera la versión de producción.

## Ejecutar la API en local

1. Crea una base PostgreSQL vacía y un usuario con permisos para migrarla. Instala las dependencias con `python -m pip install -r backend/requirements.txt` en un entorno virtual.
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

Inicio calcula las métricas desde el lunes con la fecha local del navegador. Tres intentos con la misma flashcard cuentan como tres intentos y una tarjeta distinta. Las sesiones programadas completadas se contabilizan en el día en que se completan.

## Datos locales

La aplicación conserva los datos `repasito.v2.*` y sus identificadores. La ruta `#/temas` abre Aprendizaje. Los temas anteriores aparecen en «Por asignar». Puedes cambiar su materia en «Editar tema». Los planes antiguos conservan los días guardados y admiten una hora al editarlos. Si una instalación antigua usaba los temas o preguntas de ejemplo sin haberlos guardado, se recuperan al encontrar datos de la biblioteca, la agenda o el historial anteriores.

Los intentos antiguos se vinculan a su pregunta cuando coinciden el tema y el título y hay una sola coincidencia. El historial y el calendario conservan los intentos con coincidencias ambiguas. El navegador conserva los datos al recargar en el mismo origen, incluido el puerto. Borrar los datos del sitio elimina la biblioteca y el historial locales.

Con la sesión abierta, **Aprendizaje → Importar biblioteca local** copia materias, temas y actividades a la cuenta y conserva los IDs. La importación conserva la copia local y mantiene las ediciones y eliminaciones que ya hiciste en la cuenta. Si faltan los recursos de los que depende una entrada local, el resultado la cuenta entre los registros sin cambios. En la primera importación confirmada se copian a la cuenta en ese navegador los planes e intentos locales vinculados a los temas importados o ya presentes. Los planes, el historial y la preparación del dispositivo se guardan por cuenta en ese navegador. La biblioteca sí está disponible en otros dispositivos.

## Desplegar en Render

1. Usa [render.yaml](render.yaml) como Blueprint. Define un servicio FastAPI, un sitio estático y PostgreSQL 17 con acceso privado. El archivo selecciona planes de pago para la API y PostgreSQL. [Referencia de Blueprints](https://render.com/docs/blueprint-spec).
2. En la API, configura `ALLOWED_ORIGINS` con el origen HTTPS del frontend. Separa los orígenes con comas si tienes varios. Render proporciona `DATABASE_URL` desde el PostgreSQL vinculado y genera `SESSION_SECRET`. Ambas variables se usan solo en la API.
3. En el sitio estático, configura `VITE_API_URL` con la URL pública HTTPS de la API. Vite la incorpora durante `npm run build`, así que vuelve a desplegar el sitio si cambia.
4. Comprueba que el paso `python -m alembic upgrade head` del predespliegue termina correctamente. En una instalación configurada manualmente, ejecuta ese mismo comando desde `backend` con `DATABASE_URL` apuntando a la base de destino. Render inicia Uvicorn en el `PORT` del servicio. [Guía de FastAPI en Render](https://render.com/docs/deploy-fastapi).
5. Abre `/health` en la URL pública de la API. En el frontend desplegado, crea una materia, un tema y una flashcard de prueba. Recarga, entra desde un segundo navegador con la misma cuenta y comprueba que otra cuenta tiene su propia biblioteca.
