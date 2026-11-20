# Atena

Atena es un asistente de estudio. La aplicación web usa React y Vite y guarda la biblioteca en el navegador.

```sh
npm install
npm run dev
```

Abre la dirección que indica Vite. `npm run build` genera la versión de producción.

## Recorrido de estudio

1. En **Aprendizaje**, crea la materia «Redes» y el tema «Topologías». Añade una flashcard y un repaso de recuerdo activo desde el tema.
2. En **Repasos**, elige la materia, el tema o el tipo de actividad. Revela la respuesta de una flashcard y marca «La recordé» o «Repasar». También puedes practicar las preguntas de opción múltiple.
3. En **Planes**, programa una actividad eligiendo tema, días, hora local y duración. Abre la próxima sesión desde **Inicio**. Tras responder a todas las actividades, pulsa «Completar sesión programada» para registrarla como completada.
4. En **Dispositivo**, prepara una copia local del material. La disponibilidad en el ESP32 requiere confirmación del equipo. La sincronización física está pendiente.

Inicio calcula las métricas desde el lunes con la fecha local del navegador. Tres intentos con la misma flashcard cuentan como tres intentos y una tarjeta distinta. Las sesiones programadas completadas se contabilizan en el día en que se completan.

## Datos locales

La aplicación conserva los datos `repasito.v2.*` y sus identificadores. La ruta `#/temas` abre Aprendizaje. Los temas anteriores aparecen en «Por asignar». Puedes cambiar su materia en «Editar tema». Los planes antiguos conservan los días guardados y admiten una hora al editarlos. Si una instalación antigua usaba los temas o preguntas de ejemplo sin haberlos guardado, se recuperan al encontrar datos de la biblioteca, la agenda o el historial anteriores.

Los intentos antiguos se vinculan a su pregunta cuando coinciden el tema y el título y hay una sola coincidencia. El historial y el calendario conservan los intentos con coincidencias ambiguas. El navegador conserva los datos al recargar en el mismo origen, incluido el puerto. Borrar los datos del sitio elimina la biblioteca y el historial locales.
