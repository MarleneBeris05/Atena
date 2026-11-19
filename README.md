# Atena

Interfaz modular en React y Vite.

```sh
npm install
npm run dev
```

`npm run build` genera la versión de producción. Las variables globales de color están en `src/styles.css`.

La navegación utiliza rutas hash: `#/inicio`, `#/temas`, `#/repasos`, `#/planes` y `#/dispositivo`.

Los temas, repasos, planes, perfil, historial de actividad y preparación del dispositivo se guardan en localStorage con claves `repasito.v2.*`. El calendario muestra sesiones reales respondidas, incluidas las respuestas incorrectas. Los días se calculan con la fecha local del navegador. Los datos se conservan al recargar en el mismo navegador y origen (incluido el puerto); borrar los datos del sitio los elimina. La integración con base de datos y dispositivo físico está pendiente.
