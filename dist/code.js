/*
 * Código Punto: convierte una coordenada dentro de Venezuela en un código corto
 * y viceversa, sin servidor. El mismo punto siempre da el mismo código.
 *
 *   PV-3F7-K2M-9QA
 *      └──────┘ └ dígito de control (detecta errores al escribir o dictar)
 *      8 caracteres = 40 bits = 20 bits de latitud + 20 de longitud
 *
 * Con 20 bits por eje, cada celda mide ~1,3 m × 1,7 m: suficiente para
 * distinguir la puerta de una casa de la de su vecina.
 * Los bits se intercalan (orden Z), así que los puntos cercanos comparten
 * el inicio del código: todos los de una misma zona empiezan parecido.
 */
(function (root) {
  'use strict';

  // Rectángulo que cubre Venezuela continental, sus islas cercanas y la Guayana Esequiba.
  const BOUNDS = { south: 0.5, north: 12.7, west: -73.5, east: -57.5 };
  const BITS = 20;
  const CELLS = 2 ** BITS;
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32: sin I, L, O, U
  const DATA_LEN = 8;

  const latSpan = BOUNDS.north - BOUNDS.south;
  const lngSpan = BOUNDS.east - BOUNDS.west;

  function inCoverage(lat, lng) {
    return lat >= BOUNDS.south && lat < BOUNDS.north && lng >= BOUNDS.west && lng < BOUNDS.east;
  }

  function checkChar(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += (i + 1) * ALPHABET.indexOf(data[i]);
    return ALPHABET[sum % 31];
  }

  function encode(lat, lng) {
    if (!inCoverage(lat, lng)) return null;
    const y = Math.min(CELLS - 1, Math.floor(((lat - BOUNDS.south) / latSpan) * CELLS));
    const x = Math.min(CELLS - 1, Math.floor(((lng - BOUNDS.west) / lngSpan) * CELLS));
    let value = 0;
    for (let bit = BITS - 1; bit >= 0; bit--) {
      value = value * 4 + ((y >> bit) & 1) * 2 + ((x >> bit) & 1);
    }
    let data = '';
    for (let i = 0; i < DATA_LEN; i++) {
      data = ALPHABET[value % 32] + data;
      value = Math.floor(value / 32);
    }
    return data + checkChar(data);
  }

  // Estados según ISO 3166-2:VE (la letra oficial) con una sigla legible de 3 letras.
  // La sigla es solo de lectura: el código real son los 9 caracteres y no depende de límites políticos.
  const STATES = {
    A: ['DCA', 'Distrito Capital'], B: ['ANZ', 'Anzoátegui'], C: ['APU', 'Apure'], D: ['ARA', 'Aragua'],
    E: ['BAR', 'Barinas'], F: ['BOL', 'Bolívar'], G: ['CAR', 'Carabobo'], H: ['COJ', 'Cojedes'],
    I: ['FAL', 'Falcón'], J: ['GUA', 'Guárico'], K: ['LAR', 'Lara'], L: ['MER', 'Mérida'],
    M: ['MIR', 'Miranda'], N: ['MON', 'Monagas'], O: ['NES', 'Nueva Esparta'], P: ['POR', 'Portuguesa'],
    R: ['SUC', 'Sucre'], S: ['TAC', 'Táchira'], T: ['TRU', 'Trujillo'], U: ['YAR', 'Yaracuy'],
    V: ['ZUL', 'Zulia'], W: ['DEP', 'Dependencias Federales'], X: ['LGU', 'La Guaira'],
    Y: ['DAM', 'Delta Amacuro'], Z: ['AMA', 'Amazonas']
  };
  const ABBRS = new Set(Object.values(STATES).map(([abbr]) => abbr));

  // Acepta minúsculas, espacios, guiones, el prefijo PV, la sigla del estado y
  // confusiones típicas (O→0, I/L→1).
  function normalize(input) {
    let s = String(input || '').toUpperCase().replace(/[\s\-_.·]/g, '');
    if (s.startsWith('PV')) s = s.slice(2);
    if (s.length === DATA_LEN + 4 && ABBRS.has(s.slice(0, 3))) s = s.slice(3);
    s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
    return s;
  }

  // Devuelve { code, lat, lng } o { error } con un mensaje para la persona.
  function decode(input) {
    const s = normalize(input);
    if (s.length !== DATA_LEN + 1) return { error: 'El código tiene 9 caracteres después de PV.' };
    for (const ch of s) if (!ALPHABET.includes(ch)) return { error: `“${ch}” no es un carácter válido.` };
    const data = s.slice(0, DATA_LEN);
    if (checkChar(data) !== s[DATA_LEN]) return { error: 'Revisa el código: parece tener un error.' };

    let value = 0;
    for (const ch of data) value = value * 32 + ALPHABET.indexOf(ch);
    let x = 0;
    let y = 0;
    for (let bit = 0; bit < BITS; bit++) {
      x |= (value % 2) << bit; value = Math.floor(value / 2);
      y |= (value % 2) << bit; value = Math.floor(value / 2);
    }
    return {
      code: s,
      lat: BOUNDS.south + ((y + 0.5) / CELLS) * latSpan,
      lng: BOUNDS.west + ((x + 0.5) / CELLS) * lngSpan
    };
  }

  // state: letra ISO del estado (opcional). PV·DCA-PS1-ZTJ-QEW o PV-PS1-ZTJ-QEW.
  function format(code, state) {
    const abbr = STATES[state]?.[0];
    return `PV${abbr ? '·' + abbr : ''}-${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 9)}`;
  }

  // "VE-A" → "A"; cualquier otra cosa → ''.
  function stateFromISO(iso) {
    const m = /^VE-([A-Z])$/.exec(iso || '');
    return m && STATES[m[1]] ? m[1] : '';
  }

  const api = { encode, decode, format, normalize, inCoverage, stateFromISO, STATES, BOUNDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuntoCode = api;
})(this);
