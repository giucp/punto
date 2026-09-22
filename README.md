# Punto

Direcciones digitales para Venezuela. Cada entrada (casa, edificio, negocio) recibe un
código corto como `PV-PS1-ZTR-20P` que se puede dictar, escribir o compartir.

## Pantallas (según `mockup.png`)
1. **Bienvenida**: Comenzar · ¿Te pasaron un código? · Mis puntos.
2. **Mueve el mapa hasta la entrada**: toca la zona para buscar, ubícate con GPS o cambia a satélite.
3. **Aquí está**: confirma el punto y muestra la zona real (OpenStreetMap).
4. **Cuéntanos sobre tu lugar**: nombre, tipo (casa, edificio, negocio), piso/apto y referencia.
5. **Tu dirección digital está lista**: código, QR y Compartir. En el menú •••: WhatsApp,
   copiar, Google Maps, Waze y descargar una placa con QR para la puerta.

Quien recibe un enlace o escribe un código ve el mismo diseño con un mapa y botones para llegar.

## El código
`code.js` convierte la coordenada de la puerta en 8 caracteres (celdas de ~1,3 × 1,7 m) más un
dígito de control que detecta errores de tipeo. No requiere servidor: el código *es* la ubicación.
Acepta minúsculas, espacios y confusiones típicas (O→0, I/L→1). Nombre y referencia viajan en el
enlace después de `#`, así que no llegan a ningún servidor.

## Archivos
- `index.html`, `style.css`, `app.js`, `code.js`: la app.
- `assets/avila.png` y `assets/firma.png`: ilustración y firma recortadas de `mockup.png`.
- `sw.js`, `manifest.webmanifest`: instalar en el teléfono y abrir sin conexión.
- `dist/`: copia para el hosting de `.openai/hosting.json`.

## Probar en local
```
npx http-server -p 5173 -c-1
```

## Límites
- Los puntos guardados viven en el teléfono (no hay cuentas ni base central).
- Corregir la entrada cambia el código, porque el código es la ubicación.
- La búsqueda usa Nominatim (1 consulta/segundo); para uso masivo hace falta un servicio propio.
