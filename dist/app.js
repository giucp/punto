(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const C = window.PuntoCode;

  const TYPES = {
    casa: { label: 'Casa', icon: 'i-house' },
    edificio: { label: 'Edificio', icon: 'i-building' },
    negocio: { label: 'Negocio', icon: 'i-store' }
  };
  const DEFAULT_VIEW = { lat: 10.5001, lng: -66.8780, zoom: 14 }; // La Florida, Caracas
  const MIN_ZOOM_TO_PICK = 17;
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const MAP_HINT = 'Ubica el punto exacto de tu casa, negocio<br>o lugar.';

  const state = {
    draft: null,     // { code, lat, lng, area } mientras se registra un lugar
    type: 'casa',
    current: null,   // lugar mostrado en la pantalla final
    justSaved: false,
    satellite: false,
    locatedOnce: false
  };

  /* ---------- Utilidades ---------- */

  let toastTimer;
  function notify(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    }
  };

  /* ---------- Supabase (registro central) ---------- */

  const cfg = window.PUNTO_CONFIG || {};
  const cloud = {
    enabled: Boolean(cfg.supabaseUrl && cfg.supabaseKey),
    async call(fn, args) {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      if (!res.ok) throw new Error(`${fn}: ${res.status}`);
      return res.status === 204 ? null : res.json();
    }
  };

  // Clave propia de este teléfono: permite ver, editar y borrar sus lugares en la nube.
  function deviceSecret() {
    let secret = store.get('punto:secret', '');
    if (typeof secret !== 'string' || secret.length < 32) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      store.set('punto:secret', secret);
    }
    return secret;
  }

  const cloudArgs = (p) => ({
    p_secret: deviceSecret(), p_code: p.code, p_name: p.name, p_type: TYPES[p.type] ? p.type : 'casa',
    p_unit: p.unit || '', p_ref: p.ref || '', p_area: p.area || '', p_state: p.state || ''
  });

  async function pushPlace(p) {
    if (!cloud.enabled || !p.name || p.received) return; // lo que te compartieron no se sube como tuyo
    try {
      await cloud.call('punto_save', cloudArgs(p));
      markSynced(p, true);
    } catch (_) { markSynced(p, false); } // se reintenta al abrir la app
  }

  async function syncWithCloud() {
    if (!cloud.enabled) return;
    try {
      for (const p of myPlaces().filter((m) => m.synced === false)) await pushPlace(p);
      const remote = await cloud.call('punto_mine', { p_secret: deviceSecret() });
      const local = myPlaces();
      const keys = new Set(local.map(placeKey));
      const added = remote.filter((r) => !keys.has(placeKey(r))).map((r) => ({ ...r, synced: true, saved: Date.parse(r.created_at) || Date.now() }));
      if (added.length) {
        store.set('punto:places', [...local, ...added].slice(0, 50));
        renderWelcome();
      }
    } catch (_) { /* Sin conexión: se usa lo guardado en el teléfono. */ }
  }

  /* ---------- Mis puntos ---------- */

  const placeKey = (p) => [p.code, p.unit, p.name].map((v) => (v || '').trim().toLowerCase()).join('|');
  const myPlaces = () => store.get('punto:places', []).filter((p) => p && !C.decode(p.code || '').error);
  const isMine = (p) => myPlaces().some((m) => placeKey(m) === placeKey(p));

  function markSynced(p, synced) {
    store.set('punto:places', myPlaces().map((m) => (placeKey(m) === placeKey(p) ? { ...m, synced } : m)));
  }

  function savePlace(p) {
    const { lat, lng, ...data } = p; // la ubicación se recalcula siempre desde el código
    const list = myPlaces().filter((m) => placeKey(m) !== placeKey(p));
    list.unshift({ ...data, saved: Date.now(), synced: false });
    const ok = store.set('punto:places', list.slice(0, 50));
    pushPlace(p);
    return ok;
  }
  function removePlace(p) {
    store.set('punto:places', myPlaces().filter((m) => placeKey(m) !== placeKey(p)));
    if (cloud.enabled) {
      cloud.call('punto_delete', { p_secret: deviceSecret(), p_code: p.code, p_unit: p.unit || '' }).catch(() => {});
    }
  }

  // Enlace corto: solo el código (y la unidad si varios lugares comparten entrada).
  // Nombre y referencia se buscan en Supabase, así el enlace no los expone.
  const placeHash = (p) => `#${p.code}${p.unit ? '?u=' + encodeURIComponent(p.unit) : ''}`;
  const placeURL = (p) => `${location.origin}${location.pathname}${placeHash(p)}`;

  const shareTitle = (p) => [p.name || 'Mi Punto', p.unit].filter(Boolean).join(' · ');
  const shareText = (p) => `📍 ${shareTitle(p)} · ${C.format(p.code, p.state)}`;

  async function copy(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      notify(okMessage);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      notify(ok ? okMessage : 'No se pudo copiar');
    }
  }

  // "search" abre el pin exacto tanto en la app de Google Maps como en la web;
  // desde ahí "Cómo llegar" ya conoce el destino.
  const latLng = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const gmapsURL = (p) => `https://www.google.com/maps/search/?api=1&query=${latLng(p)}`;
  const wazeURL = (p) => `https://waze.com/ul?ll=${latLng(p)}&navigate=yes`;

  /* ---------- Nombres de zona (OpenStreetMap / Nominatim) ---------- */

  const areaCache = new Map();

  function areaFromAddress(a = {}) {
    const local = a.neighbourhood || a.suburb || a.quarter || a.residential || a.hamlet || a.village;
    const city = a.city || a.town || a.municipality || a.county || a.state;
    return [local, city].filter((v, i, arr) => v && arr.indexOf(v) === i).join(', ');
  }

  // Zona legible, estado (letra ISO 3166-2:VE) y país del punto.
  // Se guarda la promesa: consultas simultáneas del mismo punto comparten una sola petición.
  function reverseInfo(lat, lng) {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (!areaCache.has(key)) {
      const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=17&accept-language=es&lat=${lat}&lon=${lng}`;
      const request = fetch(url)
        .then((res) => { if (!res.ok) throw new Error('reverse'); return res.json(); })
        .then(({ address = {} }) => ({
          area: areaFromAddress(address),
          state: C.stateFromISO(address['ISO3166-2-lvl4']),
          country: address.country_code || ''
        }))
        .catch((err) => { areaCache.delete(key); throw err; });
      areaCache.set(key, request);
    }
    return areaCache.get(key);
  }
  const reverseArea = async (lat, lng) => (await reverseInfo(lat, lng)).area;

  // Solo territorio venezolano reconocido. Sin conexión no se puede comprobar y se permite.
  const outsideVenezuela = (info) => Boolean(info?.country) && info.country !== 've';

  /* ---------- Mapas ---------- */

  function baseLayer(satellite) {
    return satellite
      ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 20, maxNativeZoom: 18, attribution: 'Imágenes © Esri, Maxar'
        })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 20, maxNativeZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        });
  }

  const maps = [];
  function newMap(id, options = {}) {
    const map = L.map(id, { zoomControl: false, ...options });
    map.attributionControl?.setPrefix(false);
    map._base = baseLayer(state.satellite).addTo(map);
    map.getContainer().classList.toggle('muted', !state.satellite);
    maps.push(map);
    return map;
  }

  function setSatellite(on) {
    state.satellite = on;
    store.set('punto:satellite', on);
    maps.forEach((map) => {
      map.removeLayer(map._base);
      map._base = baseLayer(on).addTo(map);
      map.getContainer().classList.toggle('muted', !on);
    });
    $('layer').setAttribute('aria-pressed', String(on));
    $('layer').setAttribute('aria-label', on ? 'Vista de mapa' : 'Vista satélite');
  }

  const dotIcon = L.divIcon({ className: '', html: '<div class="dot-marker"></div>', iconSize: [48, 48], iconAnchor: [24, 24] });
  const userIcon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });

  /* ---------- 2 · Mover el mapa hasta la entrada ---------- */

  let map;
  let userMarker;
  let areaTimer;

  function initMap() {
    if (map) return;
    const last = store.get('punto:lastView', DEFAULT_VIEW);
    map = newMap('map', { maxZoom: 20 }).setView([last.lat, last.lng], last.zoom);
    map.on('movestart', () => { $('mapStep').classList.add('moving'); $('searchResults').hidden = true; });
    map.on('moveend', () => {
      $('mapStep').classList.remove('moving');
      updateMapHint();
      const c = map.getCenter();
      store.set('punto:lastView', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      clearTimeout(areaTimer);
      areaTimer = setTimeout(updatePill, 700); // respeta el límite de uso de Nominatim
    });
    map.on('zoomend', updateMapHint);
  }

  function updateMapHint() {
    const c = map.getCenter();
    const hint = $('mapHint');
    const btn = $('confirmPoint');
    hint.classList.remove('warn');
    if (!C.inCoverage(c.lat, c.lng)) {
      hint.textContent = 'Punto por ahora solo funciona dentro de Venezuela.';
      hint.classList.add('warn');
      btn.disabled = true;
    } else if (map.getZoom() < MIN_ZOOM_TO_PICK) {
      hint.textContent = 'Acércate más al mapa para marcar la entrada exacta.';
      btn.disabled = true;
    } else {
      hint.innerHTML = MAP_HINT;
      btn.disabled = false;
    }
  }

  async function updatePill() {
    const c = map.getCenter();
    if (!C.inCoverage(c.lat, c.lng)) { $('pillText').textContent = 'Fuera de Venezuela'; return; }
    if (map.getZoom() < 13) return;
    try {
      const info = await reverseInfo(c.lat, c.lng);
      if (outsideVenezuela(info)) {
        $('pillText').textContent = 'Fuera de Venezuela';
        showOutside();
        return;
      }
      if (info.area) $('pillText').textContent = info.area;
    } catch (_) { /* Se conserva el último nombre. */ }
  }

  function showOutside() {
    $('mapHint').textContent = 'Esta ubicación está fuera del territorio venezolano.';
    $('mapHint').classList.add('warn');
    $('confirmPoint').disabled = true;
  }

  function locate({ quiet = false } = {}) {
    if (!navigator.geolocation) { if (!quiet) notify('Ubicación no disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const at = [coords.latitude, coords.longitude];
        if (!userMarker) userMarker = L.marker(at, { icon: userIcon, interactive: false, keyboard: false }).addTo(map);
        else userMarker.setLatLng(at);
        map.setView(at, 19);
        notify(coords.accuracy > 25 ? 'Ubicación aproximada: mueve el mapa hasta tu puerta' : 'Mueve el mapa para ajustar la entrada');
      },
      (err) => {
        if (quiet && err.code === err.PERMISSION_DENIED) return;
        notify(err.code === err.PERMISSION_DENIED ? 'Permiso de ubicación denegado. Toca la zona para buscar.' : 'No se pudo obtener tu ubicación');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  function openSearch(open) {
    $('pill').hidden = open;
    $('searchForm').hidden = !open;
    if (open) { $('searchInput').value = ''; $('searchInput').focus(); }
    else $('searchResults').hidden = true;
  }

  async function search(query) {
    const list = $('searchResults');
    const status = document.createElement('li');
    status.className = 'empty';
    status.textContent = 'Buscando…';
    list.replaceChildren(status);
    list.hidden = false;
    try {
      const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=ve&limit=6&accept-language=es&q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('search');
      const results = await res.json();
      if (!results.length) { status.textContent = 'Sin resultados. Prueba con el nombre de la urbanización o barrio.'; return; }
      list.replaceChildren(...results.map((r) => {
        const [title, ...rest] = r.display_name.split(', ');
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = title;
        const small = document.createElement('small');
        small.textContent = rest.filter((s) => s !== 'Venezuela').join(', ');
        b.append(small);
        b.addEventListener('click', () => {
          openSearch(false);
          $('pillText').textContent = title;
          map.setView([+r.lat, +r.lon], r.place_rank >= 26 ? 18 : 16);
        });
        li.append(b);
        return li;
      }));
    } catch (_) {
      status.textContent = 'No se pudo buscar. Revisa tu conexión.';
    }
  }

  /* ---------- 3 · Aquí está ---------- */

  let confirmMap;
  function renderConfirm() {
    const d = state.draft;
    if (!confirmMap) {
      confirmMap = newMap('confirmMap', {
        dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false
      });
    }
    confirmMap.setView([d.lat, d.lng], 18, { animate: false });
    $('confirmedArea').textContent = (d.area || 'Venezuela') + '.';
    if (!d.area) {
      reverseArea(d.lat, d.lng).then((area) => {
        if (state.draft !== d || !area) return;
        d.area = area;
        $('confirmedArea').textContent = area + '.';
      }).catch(() => {});
    }
  }

  /* ---------- 4 · Datos del lugar ---------- */

  function setType(type) {
    state.type = type;
    document.querySelectorAll('.type').forEach((b) => {
      const on = b.dataset.type === type;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('unitField').hidden = type === 'casa';
    $('placeUnit').placeholder = type === 'negocio' ? 'Ej. Local 12, planta baja' : 'Ej. Piso 4, apto 4-B';
  }

  function resetForm() {
    $('placeForm').reset();
    $('refCount').textContent = '0';
    $('nameError').hidden = true;
    $('placeName').removeAttribute('aria-invalid');
    setType('casa');
  }

  /* ---------- 5 · Dirección digital ---------- */

  let miniMap;
  let miniMarker;
  let qrToken = 0;

  function renderResult(p) {
    state.current = p;
    const entry = myPlaces().find((m) => placeKey(m) === placeKey(p));
    const saved = Boolean(entry);          // está en "Mis puntos"
    const mine = saved && !entry.received; // lo registró este teléfono
    const page = $('resultStep');
    page.classList.toggle('received', !mine);

    if (saved && !mine) {
      $('resultTitle').textContent = 'Punto guardado.';
      $('resultSub').textContent = 'Ábrelo en tu app de mapas para llegar.';
    } else if (state.justSaved) {
      $('resultTitle').textContent = 'Tu dirección digital está lista.';
      $('resultSub').textContent = 'Fácil de compartir. Difícil de perder.';
    } else if (mine) {
      $('resultTitle').textContent = 'Tu dirección digital.';
      $('resultSub').textContent = 'Fácil de compartir. Difícil de perder.';
    } else {
      $('resultTitle').textContent = 'Te compartieron un Punto.';
      $('resultSub').textContent = 'Ábrelo en tu app de mapas para llegar.';
    }
    state.justSaved = false;

    $('resultName').textContent = p.name || (TYPES[p.type]?.label ?? 'Punto');
    const areaText = () => [p.unit, p.area].filter(Boolean).join(' · ');
    $('resultArea').textContent = areaText() || 'Venezuela';
    $('resultId').textContent = C.format(p.code, p.state);
    $('resultRef').hidden = !p.ref;
    $('resultRef').textContent = p.ref ? `“${p.ref}”` : '';

    // Completa zona y estado si faltan (lugares anteriores o códigos escritos a mano).
    if (!p.area || !p.state) {
      reverseInfo(p.lat, p.lng).then((info) => {
        if (state.current !== p) return;
        p.area = p.area || info.area;
        p.state = p.state || info.state;
        $('resultArea').textContent = areaText() || 'Venezuela';
        $('resultId').textContent = C.format(p.code, p.state);
        if (mine && info.state && !entry.state) savePlace({ ...entry, state: info.state });
      }).catch(() => {});
    }

    $('gmaps').href = gmapsURL(p);
    $('waze').href = wazeURL(p);
    $('mSave').hidden = saved;
    $('mDelete').hidden = !saved;
    $('mNew').hidden = !mine;
    $('mPlaque').hidden = !mine;

    if (mine) {
      const token = ++qrToken;
      window.PuntoQR.toDataURL(placeURL(p), { margin: 1, width: 256, color: { dark: '#111820', light: '#ffffff' } })
        .then((data) => { if (token === qrToken) $('qr').src = data; });
    } else {
      requestAnimationFrame(() => {
        if (!miniMap) {
          miniMap = newMap('miniMap', { maxZoom: 20, attributionControl: false });
          miniMarker = L.marker([p.lat, p.lng], { icon: dotIcon, interactive: false, keyboard: false }).addTo(miniMap);
        }
        miniMap.invalidateSize();
        miniMarker.setLatLng([p.lat, p.lng]);
        miniMap.setView([p.lat, p.lng], 17, { animate: false });
      });
    }
  }

  function toggleMenu(open) {
    const menu = $('resultMenu');
    menu.hidden = open === undefined ? !menu.hidden : !open;
    $('more').setAttribute('aria-expanded', String(!menu.hidden));
  }

  async function downloadPlaque(p) {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const font = (w, s) => `${w} ${s}px Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

    ctx.fillStyle = '#fffefa';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#15181c';
    ctx.font = font(800, 66);
    ctx.textAlign = 'center';
    const bw = ctx.measureText('Punto').width;
    ctx.fillText('Punto', W / 2 - 12, 150);
    ctx.fillStyle = '#1454e8';
    ctx.beginPath();
    ctx.arc(W / 2 - 12 + bw / 2 + 20, 106, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#15181c';
    ctx.font = font(700, 64);
    const full = p.name || 'Mi Punto';
    let name = full;
    while (ctx.measureText(name).width > W - 160 && name.length > 4) name = name.slice(0, -1);
    ctx.fillText(name === full ? name : name + '…', W / 2, 290);
    ctx.fillStyle = '#69707a';
    ctx.font = font(500, 36);
    ctx.fillText([p.unit, p.area].filter(Boolean).join(' · ') || 'Venezuela', W / 2, 346);

    ctx.fillStyle = '#e7edfc';
    ctx.beginPath();
    ctx.roundRect((W - 760) / 2, 400, 760, 124, 62);
    ctx.fill();
    ctx.fillStyle = '#20365d';
    ctx.font = font(800, 76);
    ctx.fillText(C.format(p.code, p.state), W / 2, 488);

    const qr = document.createElement('canvas');
    await window.PuntoQR.toCanvas(qr, placeURL(p), { width: 560, margin: 0, color: { dark: '#111820', light: '#ffffff' } });
    ctx.drawImage(qr, (W - 560) / 2, 580, 560, 560);

    ctx.fillStyle = '#48515d';
    ctx.font = font(500, 36);
    ctx.fillText('Escanea para llegar', W / 2, 1220);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const filename = `punto-${C.format(p.code, p.state)}.png`;
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file], title: 'Mi placa Punto' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- Hojas: código y mis puntos ---------- */

  function openSheet(id, list, title) {
    closeSheets();
    $('scrim').hidden = false;
    $(id).hidden = false;
    if (id === 'codeSheet') {
      $('codeError').textContent = '';
      setTimeout(() => $('codeInput').focus(), 50);
    }
    if (id === 'placesSheet') {
      $('placesTitle').textContent = title || 'Mis puntos';
      $('placesSub').textContent = list ? 'Elige a cuál vas.' : 'Guardados en este teléfono y en tu registro Punto.';
      renderPlacesList(list || myPlaces());
    }
  }
  function closeSheets() {
    $('scrim').hidden = true;
    $('codeSheet').hidden = true;
    $('placesSheet').hidden = true;
  }

  function renderPlacesList(list) {
    $('placesList').replaceChildren(...list.map((p) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = `<svg><use href="#${(TYPES[p.type] || TYPES.casa).icon}"/></svg>`;
      const txt = document.createElement('span');
      txt.className = 'txt';
      const name = document.createElement('b');
      name.textContent = [p.name, p.unit].filter(Boolean).join(' · ');
      const code = document.createElement('small');
      code.textContent = C.format(p.code, p.state);
      txt.append(name, code);
      b.append(icon, txt);
      b.addEventListener('click', () => { closeSheets(); go(placeHash(p)); });
      li.append(b);
      return li;
    }));
  }

  function renderWelcome() {
    const n = myPlaces().length;
    $('openPlaces').hidden = !n;
    $('placesCount').textContent = n ? `(${n})` : '';
  }

  /* ---------- Navegación ---------- */

  function go(hash, replace = false) {
    if (replace) location.replace(hash);
    else location.hash = hash;
  }

  function parseRoute() {
    const [path, query = ''] = location.hash.slice(1).split('?');
    if (/^[0-9a-z]{9}$/i.test(path)) {
      const decoded = C.decode(path);
      if (decoded.error) return { screen: 'welcome', codeError: decoded.error };
      const unit = (new URLSearchParams(query).get('u') || '').slice(0, 30);
      const at = { code: decoded.code, lat: decoded.lat, lng: decoded.lng };
      const same = (p) => p.code === decoded.code && (p.unit || '').toLowerCase() === unit.toLowerCase();
      const saved = myPlaces().find(same) || (!unit && myPlaces().find((p) => p.code === decoded.code));
      if (saved) return { screen: 'resultStep', place: { ...saved, ...at } };
      return { screen: 'resultStep', place: { ...at, name: '', type: '', unit, ref: '', area: '' } };
    }
    if (path.startsWith('/p/')) { // enlaces largos anteriores
      const decoded = C.decode(decodeURIComponent(path.slice(3)));
      if (decoded.error) return { screen: 'welcome', codeError: decoded.error };
      const q = new URLSearchParams(query);
      const at = { code: decoded.code, lat: decoded.lat, lng: decoded.lng };
      // Si solo llegó el código y ese lugar está guardado aquí, se muestran sus datos.
      if (!q.get('n')) {
        const saved = myPlaces().find((p) => p.code === decoded.code);
        if (saved) return { screen: 'resultStep', place: { ...saved, ...at } };
      }
      const type = q.get('t');
      return {
        screen: 'resultStep',
        place: {
          ...at,
          name: (q.get('n') || '').slice(0, 48),
          type: TYPES[type] ? type : '',
          unit: (q.get('u') || '').slice(0, 30),
          ref: (q.get('r') || '').slice(0, 100),
          area: (q.get('a') || '').slice(0, 80)
        }
      };
    }
    if (path === '/mapa') return { screen: 'mapStep' };
    if (path === '/aqui') return state.draft ? { screen: 'confirmStep' } : { redirect: '#/mapa' };
    if (path === '/datos') return state.draft ? { screen: 'dataStep' } : { redirect: '#/mapa' };
    return { screen: 'welcome' };
  }

  function show(screen) {
    document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === screen));
    $(screen).scrollTop = 0;
    toggleMenu(false);
    closeSheets();
  }

  function route() {
    const r = parseRoute();
    if (r.redirect) return go(r.redirect, true);
    show(r.screen);

    if (r.screen === 'welcome') {
      renderWelcome();
      if (r.codeError) { openSheet('codeSheet'); $('codeError').textContent = r.codeError; }
    } else if (r.screen === 'mapStep') {
      initMap();
      openSearch(false);
      setTimeout(() => { map.invalidateSize(); updateMapHint(); updatePill(); }, 30);
      if (!state.locatedOnce) { state.locatedOnce = true; locate({ quiet: true }); }
    } else if (r.screen === 'confirmStep') {
      renderConfirm();
      requestAnimationFrame(() => { confirmMap.invalidateSize(); confirmMap.setView([state.draft.lat, state.draft.lng], 18, { animate: false }); });
    } else if (r.screen === 'resultStep') {
      renderResult(r.place);
      if (!r.place.name) lookupCode(r.place);
    }
  }

  // Solo llegó el código (dictado o escrito): se buscan sus datos en el registro central.
  async function lookupCode(p) {
    if (!cloud.enabled) return;
    $('resultName').textContent = 'Buscando…';
    let found = [];
    try { found = await cloud.call('punto_lookup', { p_code: p.code }); } catch (_) { /* sin conexión */ }
    if (state.current !== p) return;
    if (!found.length) {
      $('resultName').textContent = 'Punto';
      $('resultSub').textContent = 'Nadie registró datos en esta entrada, pero la ubicación es exacta.';
      return;
    }
    const withCoords = found.map((f) => ({ ...f, lat: p.lat, lng: p.lng }));
    const exact = p.unit && withCoords.find((f) => f.unit.toLowerCase() === p.unit.toLowerCase());
    if (exact) { renderResult(exact); return; }
    if (withCoords.length === 1) { renderResult(withCoords[0]); return; }
    // Varios lugares comparten la entrada (apartamentos, locales): se elige uno.
    renderResult(withCoords[0]);
    openSheet('placesSheet', withCoords, `${withCoords.length} lugares en esta entrada`);
  }

  /* ---------- Eventos ---------- */

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  $('start').addEventListener('click', () => { state.draft = null; resetForm(); go('#/mapa'); });
  $('openCode').addEventListener('click', () => openSheet('codeSheet'));
  $('openPlaces').addEventListener('click', () => openSheet('placesSheet'));
  $('scrim').addEventListener('click', closeSheets);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheets(); toggleMenu(false); openSearch(false); } });

  $('codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('codeInput').value.trim();
    if (!value) { $('codeError').textContent = 'Escribe el código que te enviaron.'; return; }
    const linkHash = value.match(/#(\/p\/.+|[0-9a-z]{9}(\?.*)?)$/i); // también acepta el enlace completo pegado
    const decoded = linkHash ? null : C.decode(value);
    if (decoded?.error) { $('codeError').textContent = decoded.error; return; }
    $('codeInput').value = '';
    closeSheets();
    go(linkHash ? linkHash[0] : `#${decoded.code}`);
  });
  $('codeInput').addEventListener('input', () => { $('codeError').textContent = ''; });

  $('pill').addEventListener('click', () => openSearch(true));
  $('searchInput').addEventListener('blur', () => setTimeout(() => {
    if (!$('searchInput').value.trim() && $('searchResults').hidden) openSearch(false);
  }, 150));
  function runSearch() {
    const q = $('searchInput').value.trim();
    if (q.length >= 3) search(q);
  }
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
  $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });

  $('locate').addEventListener('click', () => locate());
  $('layer').addEventListener('click', () => setSatellite(!state.satellite));

  $('confirmPoint').addEventListener('click', async () => {
    const c = map.getCenter();
    const code = C.encode(c.lat, c.lng);
    if (!code) return;
    const { lat, lng } = C.decode(code); // centro de la celda: igual a lo que verá quien reciba el código
    const btn = $('confirmPoint');
    btn.disabled = true;
    // Comprueba país y estado antes de seguir (máx. 5 s; sin conexión se continúa).
    const info = await Promise.race([
      reverseInfo(lat, lng).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000))
    ]);
    btn.disabled = false;
    if (outsideVenezuela(info)) { showOutside(); return; }
    state.draft = { code, lat, lng, area: info?.area || '', state: info?.state || '' };
    go('#/aqui');
  });

  document.querySelectorAll('.type').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  $('reference').addEventListener('input', () => { $('refCount').textContent = $('reference').value.length; });
  $('placeName').addEventListener('input', () => { $('nameError').hidden = true; $('placeName').removeAttribute('aria-invalid'); });

  $('placeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('placeName').value.trim().replace(/\s+/g, ' ');
    if (!name) {
      $('nameError').hidden = false;
      $('placeName').setAttribute('aria-invalid', 'true');
      $('placeName').focus();
      return;
    }
    const place = {
      ...state.draft,
      name,
      type: state.type,
      unit: state.type === 'casa' ? '' : $('placeUnit').value.trim(),
      ref: $('reference').value.trim().replace(/\s+/g, ' ')
    };
    if (!savePlace(place)) notify('No se pudo guardar en este teléfono, pero puedes compartir el enlace');
    state.draft = null;
    state.justSaved = true;
    resetForm();
    go(placeHash(place), true);
  });

  $('resultId').addEventListener('click', () => copy(C.format(state.current.code, state.current.state), 'Código copiado'));

  $('share').addEventListener('click', async () => {
    const p = state.current;
    if (navigator.share) {
      try { await navigator.share({ title: shareTitle(p), text: shareText(p), url: placeURL(p) }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    copy(`${shareText(p)}\n${placeURL(p)}`, 'Dirección copiada para compartir');
  });

  $('more').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => { if (!$('resultMenu').hidden && !$('resultMenu').contains(e.target)) toggleMenu(false); });
  const menuAction = (id, fn) => $(id).addEventListener('click', () => { toggleMenu(false); fn(state.current); });
  menuAction('mCopyCode', (p) => copy(C.format(p.code, p.state), 'Código copiado'));
  menuAction('mCopyLink', (p) => copy(placeURL(p), 'Enlace copiado'));
  menuAction('mWhatsapp', (p) => window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText(p)}\n${placeURL(p)}`)}`, '_blank', 'noopener'));
  menuAction('mGmaps', (p) => window.open(gmapsURL(p), '_blank', 'noopener'));
  menuAction('mWaze', (p) => window.open(wazeURL(p), '_blank', 'noopener'));
  menuAction('mPlaque', (p) => downloadPlaque(p).catch(() => notify('No se pudo crear la placa')));
  menuAction('mNew', () => $('start').click());
  menuAction('mSave', (p) => {
    if (!savePlace({ ...p, received: true })) { notify('No se pudo guardar en este navegador'); return; }
    notify('Guardado en tus puntos');
    renderResult(p);
  });
  menuAction('mDelete', (p) => {
    if (!confirm('¿Eliminar este lugar de tus puntos? El código sigue funcionando para quien ya lo tenga.')) return;
    removePlace(p);
    notify('Eliminado de tus puntos');
    go('#/');
  });

  /* ---------- Arranque ---------- */

  state.satellite = store.get('punto:satellite', false) === true;
  $('layer').setAttribute('aria-pressed', String(state.satellite));
  window.addEventListener('hashchange', route);
  route();
  syncWithCloud();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
