(() => {
  const $ = (id) => document.getElementById(id);
  const screens = ['welcome', 'mapStep', 'confirmStep', 'dataStep', 'resultStep'];
  const origin = 'https://punto-registro-interactivo.giuseppebambini.chatgpt.site/';
  const initial = { lat: 10.5001, lng: -66.8780 };
  let point = { ...initial };
  let map;
  let confirmMap;
  let place = { name: 'Casa de Ana', type: 'Casa', reference: '', id: 'PV-2847193', ...initial };
  let toastTimer;

  function notify(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function areaFor(p) {
    if (p.lat > 10.46 && p.lat < 10.55 && p.lng > -66.93 && p.lng < -66.82) return 'La Florida, Caracas';
    if (p.lat > 10.40 && p.lat < 10.57 && p.lng > -67.02 && p.lng < -66.75) return 'Caracas, Distrito Capital';
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }

  function makeTileLayer() {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors'
    });
  }

  function initMap() {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false })
        .setView([point.lat, point.lng], 15);
      makeTileLayer().addTo(map);
      map.on('moveend', () => {
        const center = map.getCenter();
        point = { lat: center.lat, lng: center.lng };
      });
    }
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView([point.lat, point.lng], map.getZoom(), { animate: false });
    });
  }

  function initConfirmMap() {
    if (!confirmMap) {
      confirmMap = L.map('confirmMap', {
        zoomControl: false, attributionControl: false, dragging: false,
        touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false,
        boxZoom: false, keyboard: false
      }).setView([point.lat, point.lng], 17);
      makeTileLayer().addTo(confirmMap);
    }
    requestAnimationFrame(() => {
      confirmMap.invalidateSize();
      confirmMap.setView([point.lat, point.lng], 17, { animate: false });
    });
    $('confirmedArea').textContent = areaFor(point) + '.';
  }

  function show(screen) {
    screens.forEach((id) => $(id).classList.toggle('active', id === screen));
    $('resultMenu').hidden = true;
    if (screen === 'mapStep') initMap();
    if (screen === 'confirmStep') initConfirmMap();
    if (screen === 'resultStep') renderResult();
  }

  function setType(type) {
    place.type = type;
    document.querySelectorAll('.type').forEach((button) => {
      const selected = button.dataset.type === type;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function shareURL() {
    const url = new URL(origin);
    url.searchParams.set('id', place.id);
    url.searchParams.set('n', place.name);
    url.searchParams.set('t', place.type);
    url.searchParams.set('lat', place.lat.toFixed(6));
    url.searchParams.set('lng', place.lng.toFixed(6));
    if (place.reference) url.searchParams.set('r', place.reference);
    return url.toString();
  }

  function renderResult() {
    $('resultName').textContent = place.name;
    $('resultArea').textContent = areaFor(place);
    $('resultId').textContent = place.id;
    if (window.PuntoQR) {
      window.PuntoQR.toDataURL(shareURL(), { margin: 1, width: 256, color: { dark: '#111820', light: '#ffffff' } })
        .then((data) => { $('qr').src = data; })
        .catch(() => { $('qr').src = 'qr.svg'; });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareURL());
      notify('Enlace copiado');
    } catch (_) {
      notify('Abre el menú de compartir para copiar el enlace');
    }
  }

  $('start').addEventListener('click', () => show('mapStep'));
  $('confirmPoint').addEventListener('click', () => show('confirmStep'));
  $('backToMap').addEventListener('click', () => show('mapStep'));
  $('continueToForm').addEventListener('click', () => show('dataStep'));
  $('backToConfirm').addEventListener('click', () => show('confirmStep'));
  $('locate').addEventListener('click', () => {
    if (!navigator.geolocation) return notify('Ubicación no disponible');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        point = { lat: coords.latitude, lng: coords.longitude };
        map.setView([point.lat, point.lng], 17, { animate: true });
        notify('Mueve el mapa para ajustar la entrada');
      },
      () => notify('No se pudo obtener tu ubicación'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
  document.querySelectorAll('.type').forEach((button) => button.addEventListener('click', () => setType(button.dataset.type)));
  $('reference').addEventListener('input', () => { $('refCount').textContent = $('reference').value.length; });
  $('refCount').textContent = $('reference').value.length;
  $('placeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('placeName').value.trim();
    if (!name) { $('placeName').focus(); return; }
    place = {
      name, type: place.type, reference: $('reference').value.trim(),
      id: `PV-${Math.floor(1000000 + Math.random() * 9000000)}`,
      lat: point.lat, lng: point.lng
    };
    localStorage.setItem('punto-place', JSON.stringify(place));
    show('resultStep');
  });
  $('share').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `${place.name} · ${place.id}`, text: 'Mi dirección digital en Punto', url: shareURL() }); }
      catch (error) { if (error.name !== 'AbortError') copyLink(); }
    } else copyLink();
  });
  $('more').addEventListener('click', () => { $('resultMenu').hidden = !$('resultMenu').hidden; });
  $('copyLink').addEventListener('click', () => { $('resultMenu').hidden = true; copyLink(); });
  $('viewMap').addEventListener('click', () => {
    window.open(`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=18/${place.lat}/${place.lng}`, '_blank', 'noopener');
    $('resultMenu').hidden = true;
  });
  $('newPlace').addEventListener('click', () => {
    $('resultMenu').hidden = true;
    $('placeName').value = '';
    $('reference').value = '';
    $('refCount').textContent = '0';
    setType('Casa');
    show('mapStep');
  });
  $('mobileView').addEventListener('click', () => {
    $('app').classList.remove('wide');
    $('mobileView').classList.add('active');
    $('desktopView').classList.remove('active');
    if (map) setTimeout(() => map.invalidateSize(), 100);
    if (confirmMap) setTimeout(() => confirmMap.invalidateSize(), 100);
  });
  $('desktopView').addEventListener('click', () => {
    $('app').classList.add('wide');
    $('desktopView').classList.add('active');
    $('mobileView').classList.remove('active');
    if (map) setTimeout(() => map.invalidateSize(), 100);
    if (confirmMap) setTimeout(() => confirmMap.invalidateSize(), 100);
  });
  $('mobileView').classList.add('active');

  const params = new URLSearchParams(location.search);
  const sharedId = params.get('id');
  const sharedLat = Number(params.get('lat'));
  const sharedLng = Number(params.get('lng'));
  if (/^PV-\d{7}$/.test(sharedId || '') && Number.isFinite(sharedLat) && Number.isFinite(sharedLng) &&
      Math.abs(sharedLat) <= 90 && Math.abs(sharedLng) <= 180) {
    place = {
      id: sharedId, name: (params.get('n') || 'Mi lugar').slice(0, 48),
      type: params.get('t') === 'Negocio' ? 'Negocio' : 'Casa',
      reference: (params.get('r') || '').slice(0, 100), lat: sharedLat, lng: sharedLng
    };
    point = { lat: place.lat, lng: place.lng };
    show('resultStep');
  }
})();
