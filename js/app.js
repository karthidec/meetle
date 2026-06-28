// ═══════════════════════════════════════════════════════════════
//  Meetle — app.js
//  Smart meeting points for any group, anywhere.
// ═══════════════════════════════════════════════════════════════

// ── GLOBALS ─────────────────────────────────────────────────────
let map;
let autocompletes       = [];
let personCount         = 0;
let markers             = [];
let directionsRenderers = [];
let isochronePolygons   = [];
let overlapPolygon      = null;
let lastSearchData      = null;
let topMarkerData       = [];   // [{marker, infoWindow}] for top-N results

const AVATARS     = ['🔴','🔵','🟢','🟡','🟣'];
const COLORS      = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa'];
const PLACE_ICONS = {
  restaurant:'🍽', cafe:'☕', bar:'🍺', park:'🌳', gym:'🏋',
  shopping_mall:'🛍', library:'📚', movie_theater:'🎬',
  museum:'🏛', art_gallery:'🎨', spa:'💆', night_club:'🎵',
  bowling_alley:'🎳', amusement_park:'🎡', hotel:'🏨', stadium:'🏟',
};
const AVG_SPEED   = { DRIVING: 35, WALKING: 5, TRANSIT: 20 };
const NUM_SPOKES  = 20;
const TOP_N       = 3;
const RECENT_KEY  = 'meetle_recent';
const FAV_KEY     = 'meetle_favs';
const GROUPS_KEY  = 'meetle_groups';
const DARK_KEY    = 'meetle_dark';

// ── FRIENDLY ERROR MAP ───────────────────────────────────────────
const API_ERROR_MAP = {
  MAX_DIMENSIONS_EXCEEDED : 'Too many place options to compare at once. Try selecting fewer place types.',
  MAX_ELEMENTS_EXCEEDED   : 'Too many route combinations. Try fewer people or fewer place types.',
  OVER_DAILY_LIMIT        : 'Daily map usage limit reached. Please try again tomorrow.',
  OVER_QUERY_LIMIT        : 'Too many requests right now — wait a moment and try again.',
  REQUEST_DENIED          : 'Map access denied. The API key may be invalid or missing.',
  INVALID_REQUEST         : 'An address wasn\'t recognised. Try re-selecting from the dropdown.',
  ZERO_RESULTS            : 'No route could be found between these locations.',
  NOT_FOUND               : 'One of the addresses couldn\'t be located on the map.',
  UNKNOWN_ERROR           : 'The map service returned an unexpected error. Please try again.',
};
function friendlyError(raw) {
  const msg = (raw?.message || raw || '').toString().toUpperCase();
  for (const [code, text] of Object.entries(API_ERROR_MAP)) {
    if (msg.includes(code)) return text;
  }
  return 'Something went wrong. Please check your locations and try again.';
}

// ════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════
function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 20, lng: 0 }, zoom: 2,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
  });
  applyDarkMode();
  addPerson();
  addPerson();
  loadFromURL();
  renderRecentSearches();
  renderSavedGroups();
  setDefaultDeparture();
  wireUI();
}

// ════════════════════════════════════════════════════════════════
//  DARK MODE
// ════════════════════════════════════════════════════════════════
function applyDarkMode() {
  const dark = localStorage.getItem(DARK_KEY) === '1';
  document.body.classList.toggle('dark', dark);
  document.getElementById('dark-mode-btn').textContent = dark ? '☀️' : '🌙';
}
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem(DARK_KEY, isDark ? '1' : '0');
  document.getElementById('dark-mode-btn').textContent = isDark ? '☀️' : '🌙';
}

// ════════════════════════════════════════════════════════════════
//  PERSON MANAGEMENT
// ════════════════════════════════════════════════════════════════
function addPerson(prefill) {
  if (personCount >= 5) return;
  const idx = personCount;
  const container = document.getElementById('inputs-container');
  const row = document.createElement('div');
  row.className = 'person-row';
  row.id = `person-row-${idx}`;
  row.innerHTML = `
    <div class="person-row-top">
      <span class="person-avatar">${AVATARS[idx]}</span>
      <div class="person-fields">
        <input class="person-name-input" id="name-${idx}" type="text"
          placeholder="Their name (e.g. Alex)" autocomplete="off" />
        <input class="person-input" id="input-${idx}" type="text"
          placeholder="Location" autocomplete="off" />
      </div>
      <button class="remove-btn" onclick="removePerson(${idx})">×</button>
    </div>
    <div class="person-modes">
      <button class="person-mode-btn active" data-mode="DRIVING">🚗 Drive</button>
      <button class="person-mode-btn" data-mode="WALKING">🚶 Walk</button>
      <button class="person-mode-btn" data-mode="TRANSIT">🚌 Transit</button>
    </div>`;
  container.appendChild(row);

  row.querySelectorAll('.person-mode-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      row.querySelectorAll('.person-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );

  const input = document.getElementById(`input-${idx}`);
  const ac = new google.maps.places.Autocomplete(input, {
    fields: ['geometry', 'name', 'formatted_address'],
  });
  ac.addListener('place_changed', () => {
    fitMapToLocations();
    markInputValid(input);
  });
  input.addEventListener('input', () => resetInputStyle(input));
  autocompletes[idx] = ac;

  if (prefill) input.value = prefill;
  personCount++;
  document.getElementById('add-person-btn').disabled = personCount >= 5;
}

function removePerson(idx) {
  document.getElementById(`person-row-${idx}`)?.remove();
  autocompletes[idx] = null;
  document.getElementById('add-person-btn').disabled = false;
}

function markInputValid(input) {
  input.style.color = '#34a853'; input.style.fontWeight = '600';
}
function resetInputStyle(input) {
  input.style.color = ''; input.style.fontWeight = '';
}

function getPersons() {
  const out = [];
  for (let i = 0; i < autocompletes.length; i++) {
    const ac = autocompletes[i];
    if (!ac) continue;
    const place = ac.getPlace();
    if (!place?.geometry) continue;
    const row = document.getElementById(`person-row-${i}`);
    if (!row) continue;
    const customName = document.getElementById(`name-${i}`)?.value?.trim();
    const resolvedName = customName || place.name || place.formatted_address;
    out.push({
      name: resolvedName,
      displayName: customName || (place.name || place.formatted_address).split(',')[0],
      location: place.geometry.location,
      travelMode: row.querySelector('.person-mode-btn.active')?.dataset.mode || 'DRIVING',
      inputIdx: i,
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
//  MAP HELPERS
// ════════════════════════════════════════════════════════════════
function fitMapToLocations() {
  const persons = getPersons();
  if (!persons.length) return;
  if (persons.length === 1) { map.panTo(persons[0].location); map.setZoom(12); return; }
  const bounds = new google.maps.LatLngBounds();
  persons.forEach(p => bounds.extend(p.location));
  map.fitBounds(bounds, { padding: 80 });
}
function computeCenter(locs) {
  const n = locs.length;
  const s = locs.reduce((a, l) => ({ lat: a.lat + l.lat(), lng: a.lng + l.lng() }), { lat: 0, lng: 0 });
  return { lat: s.lat / n, lng: s.lng / n };
}
function clearMap() {
  markers.forEach(m => m.setMap(null)); markers = [];
  directionsRenderers.forEach(r => r.setMap(null)); directionsRenderers = [];
  isochronePolygons.forEach(p => p.setMap(null)); isochronePolygons = [];
  if (overlapPolygon) { overlapPolygon.setMap(null); overlapPolygon = null; }
  topMarkerData.forEach(d => d?.infoWindow?.close()); topMarkerData = [];
  document.getElementById('isochrone-legend').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════════
//  CANDIDATE SEARCH
// ════════════════════════════════════════════════════════════════
function getSelectedTypes()     { return [...document.querySelectorAll('.chip.active')].map(c => c.dataset.type); }
function getMinRating()         { return parseFloat(document.querySelector('[data-rating].active')?.dataset.rating || 0); }
function getSelectedPrice()     { return parseInt(document.querySelector('[data-price].active')?.dataset.price ?? -1, 10); }
function isOpenNowOnly()        { return document.getElementById('open-now-toggle').checked; }

function findCandidatePlaces(center, maxResults) {
  return new Promise(resolve => {
    const svc    = new google.maps.places.PlacesService(map);
    const types  = getSelectedTypes();
    const openNow = isOpenNowOnly();
    if (!types.length) { resolve([]); return; }
    const all = []; let pending = types.length;
    types.forEach(type => {
      const req = { location: center, radius: 8000, type };
      if (openNow) req.openNow = true;
      svc.nearbySearch(req, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          results.forEach(r => {
            if (r.geometry?.location) {
              all.push({
                name:       r.name,
                location:   r.geometry.location,
                placeId:    r.place_id,
                rating:     r.rating    || null,
                priceLevel: r.price_level != null ? r.price_level : -1,
                type,
                photos:     r.photos || [],
              });
            }
          });
        }
        if (--pending === 0) resolve(all.slice(0, maxResults));
      });
    });
  });
}

function getPlacePhotoUrl(candidate) {
  if (candidate.photos?.length) {
    try { return candidate.photos[0].getUrl({ maxWidth: 400, maxHeight: 160 }); }
    catch { return null; }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
//  DISTANCE MATRIX
// ════════════════════════════════════════════════════════════════
function getTravelMatrix(origins, destinations, mode) {
  return new Promise((resolve, reject) => {
    const svc = new google.maps.DistanceMatrixService();
    svc.getDistanceMatrix({
      origins, destinations,
      travelMode: google.maps.TravelMode[mode || 'DRIVING'],
      drivingOptions: mode === 'DRIVING'
        ? { departureTime: getDepartureTime(), trafficModel: google.maps.TrafficModel.BEST_GUESS }
        : undefined,
      transitOptions: mode === 'TRANSIT'
        ? { departureTime: getDepartureTime() }
        : undefined,
      unitSystem: google.maps.UnitSystem.METRIC,
    }, (resp, status) => {
      if (status !== 'OK') { reject(new Error(status)); return; }
      resolve(resp.rows.map(row => row.elements.map(el => el.status === 'OK' ? el.duration.value : Infinity)));
    });
  });
}

async function getMixedMatrix(persons, destinations) {
  const modes = persons.map(p => p.travelMode);
  if (modes.every(m => m === modes[0]))
    return getTravelMatrix(persons.map(p => p.location), destinations, modes[0]);
  const rows = await Promise.all(
    persons.map(p => getTravelMatrix([p.location], destinations, p.travelMode).then(m => m[0]))
  );
  return rows;
}

// ════════════════════════════════════════════════════════════════
//  SCORING
// ════════════════════════════════════════════════════════════════
function scoreCandidates(candidates, matrix, mode, persons) {
  const minRating    = getMinRating();
  const priceFilter  = getSelectedPrice();
  const useMaxTravel = document.getElementById('use-max-travel').checked;
  const maxMins      = useMaxTravel ? parseInt(document.getElementById('max-travel-slider').value, 10) : Infinity;

  const scored = candidates.map((c, j) => {
    const times   = persons.map((_, i) => matrix[i][j]);
    const maxTime = Math.max(...times);
    const sumTime = times.reduce((a, b) => a + b, 0);
    const tooFar  = useMaxTravel && maxTime / 60 > maxMins;
    const badRate = minRating > 0 && (!c.rating || c.rating < minRating);
    const badPrice= priceFilter > 0 && c.priceLevel !== -1 && c.priceLevel !== priceFilter;
    return { ...c, times, maxTime, sumTime, score: mode === 'minimax' ? maxTime : sumTime,
             filtered: tooFar || badRate || badPrice };
  });
  const valid = scored.filter(c => !c.filtered);
  return (valid.length >= TOP_N ? valid : scored).sort((a, b) => a.score - b.score);
}

// ════════════════════════════════════════════════════════════════
//  FAIRNESS INSIGHT
// ════════════════════════════════════════════════════════════════
function fairnessInsight(candidate, persons) {
  const times     = candidate.times;
  const maxT      = Math.max(...times);
  const minT      = Math.min(...times);
  const spread    = Math.round((maxT - minT) / 60);
  const worstName = persons[times.indexOf(maxT)]?.displayName || 'Someone';
  const bestName  = persons[times.indexOf(minT)]?.displayName || 'Someone';

  if (spread <= 3) return '✅ Nearly equal travel time for everyone';
  if (spread <= 8) return `⚖️ ${worstName} travels ${spread} min more than ${bestName}`;
  return `⚠️ ${worstName} travels ${spread} min more than ${bestName} — try Fairest mode`;
}

// ════════════════════════════════════════════════════════════════
//  ARRIVE TOGETHER — per-person departure times
// ════════════════════════════════════════════════════════════════
function getArriveTogether() { return document.getElementById('arrive-together').checked; }

function buildArriveTogetherBlock(candidate, persons) {
  const arrivalTime = getDepartureTime(); // in arrive-together mode this is the TARGET arrival time
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => {
    const h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${pad(m)} ${ampm}`;
  };
  const rows = persons.map((p, i) => {
    const leaveMs = arrivalTime.getTime() - candidate.times[i] * 1000;
    const leaveAt = new Date(leaveMs);
    return `<div class="at-row">${AVATARS[p.inputIdx ?? i]} <strong>${p.displayName}</strong> — leave by <strong>${fmt(leaveAt)}</strong></div>`;
  }).join('');
  return `<div class="arrive-together-block">
    <div class="at-label">🕐 Leave by (to arrive together at ${fmt(arrivalTime)})</div>
    ${rows}
  </div>`;
}

// ════════════════════════════════════════════════════════════════
//  MAIN SEARCH
// ════════════════════════════════════════════════════════════════
async function findMeetingPoint() {
  const btn = document.getElementById('find-btn');
  document.getElementById('error-box').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  clearMap();

  const persons = getPersons();
  if (persons.length < 2) {
    showError('Please enter at least 2 locations and select each one from the dropdown suggestions — don\'t just type.');
    return;
  }
  if (!getSelectedTypes().length) { showError('Please select at least one place type.'); return; }

  btn.disabled = true;
  document.getElementById('find-btn-text').textContent = '⏳ Searching…';

  try {
    const center = computeCenter(persons.map(p => p.location));
    // Google Distance Matrix: max 25 destinations, max 100 elements
    const maxCandidates = Math.min(25, Math.floor(100 / persons.length));

    const candidates = await findCandidatePlaces(center, maxCandidates);
    if (!candidates.length) {
      showError('No places found near the group. Try different place types or locations.');
      return;
    }

    const matrix = await getMixedMatrix(persons, candidates.map(c => c.location));
    const mode   = document.querySelector('input[name="mode"]:checked').value;
    const scored = scoreCandidates(candidates, matrix, mode, persons);
    const topN   = scored.slice(0, TOP_N);

    renderResults(topN, persons, mode);
    plotMarkers(persons, topN, scored);
    drawRoutes(persons, topN[0]);
    maybeShowInstallBanner();
    map.panTo(topN[0].location);
    drawIsochrones(persons).catch(() => {});

    lastSearchData = { scored, persons, topN, mode };
    saveRecentSearch(persons);

  } catch (err) {
    showError(friendlyError(err));
    console.error('[Meetle]', err);
  } finally {
    btn.disabled = false;
    document.getElementById('find-btn-text').textContent = 'Find Meeting Point';
  }
}

// ════════════════════════════════════════════════════════════════
//  RENDER RESULT CARDS
// ════════════════════════════════════════════════════════════════
const RANK_EMOJI  = ['🥇','🥈','🥉'];
const PRICE_LABEL = ['', '$', '$$', '$$$', '$$$$'];
const TYPE_ICON   = t => PLACE_ICONS[t] || '📍';

function renderResults(topN, persons, mode) {
  const container = document.getElementById('result-cards');
  container.innerHTML = '';
  const favs     = loadFavorites();
  const showAT   = getArriveTogether();

  topN.forEach((c, rank) => {
    const photoUrl  = getPlacePhotoUrl(c);
    const isFav     = favs.some(f => f.placeId === c.placeId);
    const maxMins   = Math.round(c.maxTime / 60);
    const totalMins = Math.round(c.sumTime / 60);
    const scoreLabel = mode === 'minimax' ? `Worst trip: ${maxMins} min` : `Total: ${totalMins} min`;
    const insight   = fairnessInsight(c, persons);
    const priceTxt  = c.priceLevel > 0 ? PRICE_LABEL[c.priceLevel] : '';
    const ratingTxt = c.rating ? `⭐ ${c.rating}` : '';
    const meta      = [ratingTxt, priceTxt, c.type?.replace(/_/g,' ')].filter(Boolean).join(' · ');
    const typeIcon  = TYPE_ICON(c.type);

    const pills = persons.map((p, i) => `
      <div class="time-pill" title="Get directions for ${p.displayName}"
           onclick="openDirections('${encodeURIComponent(p.location.lat() + ',' + p.location.lng())}','${encodeURIComponent(c.name)}')">
        <div class="dot" style="background:${COLORS[i]}"></div>
        ${AVATARS[p.inputIdx ?? i]} ${p.displayName} ${Math.round(c.times[i] / 60)} min
      </div>`).join('');

    const atBlock = showAT ? buildArriveTogetherBlock(c, persons) : '';

    const card = document.createElement('div');
    card.className = `result-card rank-${rank + 1}`;
    card.innerHTML = `
      ${photoUrl
        ? `<div class="place-photo-wrap"><img class="place-photo" src="${photoUrl}" alt="${c.name}" loading="lazy" /></div>`
        : `<div class="place-photo-placeholder">${typeIcon}</div>`}
      <div class="result-card-body">
        <div class="result-card-header">
          <span class="result-rank">${RANK_EMOJI[rank]}</span>
          <div class="result-info">
            <div class="result-name" title="${c.name}">${c.name}</div>
            <div class="result-meta">${meta}</div>
          </div>
          <button class="fav-btn" title="${isFav ? 'Remove from saved' : 'Save this spot'}"
                  onclick="toggleFav(event,'${c.placeId}','${c.name.replace(/'/g,"\\'")}')">
            ${isFav ? '⭐' : '☆'}
          </button>
        </div>
        <div class="result-times">${pills}</div>
        ${atBlock}
        <div class="fairness-insight">${insight}</div>
        <div class="result-card-footer">
          <span class="score-badge">${scoreLabel}</span>
          <div class="card-action-row">
            <button class="mini-btn maps"     onclick="openInMaps(event,'${encodeURIComponent(c.name)}','${c.placeId}')" title="Open in Google Maps">📍 Open in Maps</button>
            <button class="mini-btn directions" onclick="getDirectionsToVenue(event,'${c.placeId}','${c.name.replace(/'/g,"\\'")}')" title="Get directions from your location">🧭 Directions</button>
            <button class="mini-btn calendar" onclick="exportCalendar(event,'${c.name.replace(/'/g,"\\'")}')">📅 Calendar</button>
          </div>
        </div>
      </div>`;

    card.addEventListener('click', () => focusResult(rank));
    container.appendChild(card);
  });

  document.getElementById('results-section').classList.remove('hidden');
}

// ════════════════════════════════════════════════════════════════
//  SURPRISE ME
// ════════════════════════════════════════════════════════════════
function surpriseMe() {
  if (!lastSearchData?.topN?.length) { showToast('Search first, then let me surprise you! 🎲'); return; }
  // Remove previous surprise highlight
  document.querySelectorAll('.surprise-pick').forEach(el => el.classList.remove('surprise-pick'));

  const pick = lastSearchData.topN[Math.floor(Math.random() * lastSearchData.topN.length)];
  const cards = document.querySelectorAll('.result-card');
  const rank  = lastSearchData.topN.indexOf(pick);
  if (cards[rank]) {
    cards[rank].classList.add('surprise-pick');
    cards[rank].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  map.panTo(pick.location);
  showToast(`🎲 Going with ${pick.name}!`);
}

// ════════════════════════════════════════════════════════════════
//  VENUE VOTING (via WhatsApp / share)
// ════════════════════════════════════════════════════════════════
function voteOnThis() {
  if (!lastSearchData?.topN?.length) { showToast('Run a search first!'); return; }
  const { topN, persons } = lastSearchData;
  const nums = ['1️⃣','2️⃣','3️⃣'];
  const lines = topN.map((c, i) => {
    const times = persons.map(p => `${p.displayName} ${Math.round(c.times[persons.indexOf(p)] / 60)}min`).join(' · ');
    return `${nums[i]} *${c.name}*\n${times}`;
  });
  const msg = `📍 Help us pick a meeting spot!\n\n${lines.join('\n\n')}\n\nReply with 1, 2, or 3 👇`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// ════════════════════════════════════════════════════════════════
//  FOCUS RESULT — syncs card highlight ↔ map info window
// ════════════════════════════════════════════════════════════════
function focusResult(rank) {
  // Close all top info windows
  topMarkerData.forEach(d => d?.infoWindow?.close());
  // Open the one for this rank
  const d = topMarkerData[rank];
  if (d) {
    d.infoWindow.open(map, d.marker);
    map.panTo(d.marker.getPosition());
  }
  // Highlight the matching sidebar card
  document.querySelectorAll('.result-card').forEach((card, i) => {
    card.classList.toggle('active-card', i === rank);
  });
}

// ════════════════════════════════════════════════════════════════
//  MARKERS
// ════════════════════════════════════════════════════════════════
function plotMarkers(persons, topN, allScored) {
  persons.forEach((p, i) => {
    markers.push(new google.maps.Marker({
      position: p.location, map,
      label: { text: AVATARS[p.inputIdx ?? i], fontSize: '18px' },
      title: p.name, zIndex: 10,
    }));
  });

  allScored.slice(TOP_N, TOP_N + 5).forEach((c, i) => {
    const m = new google.maps.Marker({
      position: c.location, map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#ccc', fillOpacity: .85, strokeColor: '#fff', strokeWeight: 2 },
      label: { text: String(TOP_N + i + 1), color: '#fff', fontSize: '10px', fontWeight: 'bold' },
      zIndex: 4,
    });
    const iw = new google.maps.InfoWindow({ content: `<strong>${c.name}</strong>` });
    m.addListener('click', () => iw.open(map, m));
    markers.push(m);
  });

  topMarkerData = [];
  topN.forEach((c, rank) => {
    const colors = ['#34a853','#1e88e5','#fb8c00'];
    const m = new google.maps.Marker({
      position: c.location, map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: rank === 0 ? 15 : 11, fillColor: colors[rank], fillOpacity: .95, strokeColor: '#fff', strokeWeight: 3 },
      label: { text: RANK_EMOJI[rank], fontSize: rank === 0 ? '14px' : '12px' },
      zIndex: 100 - rank,
    });
    const rating    = c.rating ? ` · ⭐ ${c.rating}` : '';
    const priceText = c.priceLevel > 0 ? ` · ${PRICE_LABEL[c.priceLevel]}` : '';
    const iw = new google.maps.InfoWindow({
      content: `<div style="font-family:sans-serif;max-width:200px">
        <strong style="font-size:13px">${RANK_EMOJI[rank]} ${c.name}</strong>
        <div style="font-size:11px;color:#666;margin:3px 0 5px">${c.type?.replace(/_/g,' ') || ''}${rating}${priceText}</div>
        ${c.times.map((t, i) => `<div style="font-size:12px">${AVATARS[persons[i]?.inputIdx ?? i]} ${persons[i]?.displayName || ''}: <strong>${Math.round(t/60)} min</strong></div>`).join('')}
      </div>`,
    });
    // Clicking the map marker also highlights the sidebar card
    m.addListener('click', () => focusResult(rank));
    topMarkerData[rank] = { marker: m, infoWindow: iw };
    markers.push(m);
  });
  // Open info window for rank-0 by default
  focusResult(0);
}

// ════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════
function drawRoutes(persons, destination) {
  directionsRenderers.forEach(r => r.setMap(null)); directionsRenderers = [];
  const svc = new google.maps.DirectionsService();
  persons.forEach((p, i) => {
    const renderer = new google.maps.DirectionsRenderer({
      map, suppressMarkers: true,
      polylineOptions: { strokeColor: COLORS[i], strokeOpacity: .65, strokeWeight: 4 },
    });
    directionsRenderers.push(renderer);
    svc.route({
      origin: p.location, destination: destination.location,
      travelMode: google.maps.TravelMode[p.travelMode || 'DRIVING'],
    }, (result, status) => { if (status === 'OK') renderer.setDirections(result); });
  });
}

// ════════════════════════════════════════════════════════════════
//  ISOCHRONES
// ════════════════════════════════════════════════════════════════
function genSpokes(latLng, mins, mode) {
  const speed = AVG_SPEED[mode] || 35;
  const rKm   = (speed * mins) / 60;
  const lat0  = latLng.lat(), lng0 = latLng.lng();
  return Array.from({ length: NUM_SPOKES }, (_, i) => {
    const a = (i / NUM_SPOKES) * 2 * Math.PI;
    return { lat: lat0 + (rKm / 111) * Math.cos(a), lng: lng0 + (rKm / (111 * Math.cos(lat0 * Math.PI / 180))) * Math.sin(a) };
  });
}

async function computeIsochrone(person, mins) {
  const spokes = genSpokes(person.location, mins, person.travelMode);
  const matrix = await getTravelMatrix([person.location], spokes, person.travelMode);
  const budget = mins * 60;
  const lat0 = person.location.lat(), lng0 = person.location.lng();
  const boundary = spokes.map((pt, i) => {
    const actual = matrix[0][i];
    if (!actual || actual === Infinity) return pt;
    const scale = Math.min(budget / actual, 2.0);
    return { lat: lat0 + (pt.lat - lat0) * scale, lng: lng0 + (pt.lng - lng0) * scale };
  });
  boundary.push(boundary[0]);
  return boundary;
}

async function drawIsochrones(persons) {
  isochronePolygons.forEach(p => p.setMap(null)); isochronePolygons = [];
  if (overlapPolygon) { overlapPolygon.setMap(null); overlapPolygon = null; }

  const mins      = parseInt(document.querySelector('.iso-btn.active').dataset.mins, 10);
  const visible   = document.getElementById('show-isochrones').checked;
  const legendEl  = document.getElementById('isochrone-legend');
  const legendItems = document.getElementById('legend-items');
  legendItems.innerHTML = '';
  legendEl.classList.remove('hidden');

  const isoSets  = await Promise.all(persons.map(p => computeIsochrone(p, mins)));
  const turfPolys = [];

  isoSets.forEach((pts, i) => {
    const color = COLORS[i];
    isochronePolygons.push(new google.maps.Polygon({
      paths: pts, map: visible ? map : null,
      fillColor: color, fillOpacity: .12, strokeColor: color, strokeOpacity: .65, strokeWeight: 2, zIndex: 1,
    }));
    legendItems.innerHTML += `<div class="legend-item"><div class="legend-swatch" style="background:${color}"></div><span>${AVATARS[persons[i].inputIdx ?? i]} ${persons[i].displayName} — ${mins} min by ${persons[i].travelMode.toLowerCase()}</span></div>`;
    turfPolys.push(turf.polygon([pts.map(p => [p.lng, p.lat])]));
  });

  let intersection = turfPolys[0];
  for (let i = 1; i < turfPolys.length; i++) {
    try { intersection = turf.intersect(intersection, turfPolys[i]); } catch { intersection = null; }
    if (!intersection) break;
  }

  const overlapEl = document.getElementById('overlap-status');
  if (!intersection) {
    overlapEl.className = 'no-overlap';
    overlapEl.textContent = '⚠️ No shared zone — try a larger time budget.';
    return;
  }
  const coords = intersection.geometry.type === 'Polygon'
    ? intersection.geometry.coordinates[0]
    : intersection.geometry.coordinates[0][0];

  overlapPolygon = new google.maps.Polygon({
    paths: coords.map(([lng, lat]) => ({ lat, lng })),
    map: visible ? map : null,
    fillColor: '#34a853', fillOpacity: .22, strokeColor: '#1b5e20', strokeOpacity: .9, strokeWeight: 2.5, zIndex: 2,
  });
  overlapEl.className = 'has-overlap';
  overlapEl.textContent = '✅ Green zone = where everyone can meet within the time limit.';
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS
// ════════════════════════════════════════════════════════════════
function openInMaps(e, name, placeId) {
  e.stopPropagation();
  // Opens venue in Google Maps app on mobile, or Maps website on desktop
  const url = `https://www.google.com/maps/search/?api=1&query=${name}&query_place_id=${placeId}`;
  window.open(url, '_blank');
}

function getDirectionsToVenue(e, placeId, venueName) {
  e.stopPropagation();
  // Opens Google Maps with navigation to the venue from user's current location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const url = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination_place_id=${placeId}&destination=${encodeURIComponent(venueName)}`;
      window.open(url, '_blank');
    }, () => {
      // Fallback: open venue without origin
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName)}&query_place_id=${placeId}`, '_blank');
    });
  } else {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName)}&query_place_id=${placeId}`, '_blank');
  }
}
function openDirections(originEncoded, destEncoded) {
  const origin = decodeURIComponent(originEncoded);
  const dest   = decodeURIComponent(destEncoded);
  window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`, '_blank');
}
function exportCalendar(e, name) {
  e.stopPropagation();
  const dep   = getDepartureTime();
  const start = dep.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  const end   = new Date(dep.getTime() + 3600000).toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  window.open(`https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent('Meet at '+name)}&location=${encodeURIComponent(name)}&dates=${start}/${end}`, '_blank');
}
function shareWhatsApp() {
  if (!lastSearchData) { showToast('Run a search first!'); return; }
  const best  = lastSearchData.topN[0];
  const lines = lastSearchData.persons.map((p, i) =>
    `${AVATARS[p.inputIdx ?? i]} ${p.displayName}: ${Math.round(best.times[i]/60)} min`
  );
  const msg = `📍 Meetle found our meeting spot!\n\n🏆 ${best.name}\n\n${lines.join('\n')}\n\n🔗 ${window.location.href}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}
function shareLink() {
  const url = buildShareURL();
  navigator.clipboard.writeText(window.location.origin + url)
    .then(() => showToast('🔗 Link copied!'));
}

// ════════════════════════════════════════════════════════════════
//  FAVOURITES
// ════════════════════════════════════════════════════════════════
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }

function toggleFav(e, placeId, name) {
  e.stopPropagation();
  const favs = loadFavorites();
  const idx  = favs.findIndex(f => f.placeId === placeId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    e.target.textContent = '☆';
    showToast('Removed from saved spots');
  } else {
    favs.push({ placeId, name });
    e.target.textContent = '⭐';
    showToast('⭐ Saved to your spots!');
  }
  saveFavorites(favs);
}

// ════════════════════════════════════════════════════════════════
//  SAVED GROUPS
// ════════════════════════════════════════════════════════════════
function loadGroups() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch { return []; }
}
function saveGroups(groups) { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); }

function openSaveGroupModal() {
  const persons = getPersons();
  if (persons.length < 2) { showToast('Add at least 2 locations first'); return; }
  const modal = document.getElementById('group-modal');
  const input = document.getElementById('group-name-input');
  input.value = persons.map(p => p.displayName).join(' + ');
  modal.classList.remove('hidden');
  input.focus(); input.select();
}

function confirmSaveGroup() {
  const name    = document.getElementById('group-name-input').value.trim();
  if (!name) return;
  const addresses = [];
  for (let i = 0; i < autocompletes.length; i++) {
    const input = document.getElementById(`input-${i}`);
    if (input?.value) addresses.push({ address: input.value, name: document.getElementById(`name-${i}`)?.value?.trim() || '' });
  }
  const groups = loadGroups().filter(g => g.name !== name);
  groups.unshift({ name, addresses });
  saveGroups(groups.slice(0, 8));
  document.getElementById('group-modal').classList.add('hidden');
  renderSavedGroups();
  showToast(`💾 Group "${name}" saved!`);
}

function renderSavedGroups() {
  const groups  = loadGroups();
  const section = document.getElementById('groups-section');
  const chips   = document.getElementById('group-chips');
  if (!groups.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  chips.innerHTML = groups.map((g, i) =>
    `<button class="group-chip" onclick="loadGroup(${i})" title="${g.addresses.map(a=>a.address).join(', ')}">
       👥 ${g.name}
       <span class="group-chip-del" onclick="deleteGroup(event,${i})" title="Remove">×</span>
     </button>`
  ).join('');
}

function loadGroup(idx) {
  const groups = loadGroups();
  const g = groups[idx];
  if (!g) return;
  const container = document.getElementById('inputs-container');
  container.innerHTML = '';
  autocompletes = []; personCount = 0;
  g.addresses.forEach(a => {
    addPerson(a.address);
    // Pre-fill name if saved
    if (a.name) {
      const nameInput = document.getElementById(`name-${personCount - 1}`);
      if (nameInput) nameInput.value = a.name;
    }
  });
  document.getElementById('add-person-btn').disabled = personCount >= 5;
  showToast(`👥 Loaded group: ${g.name}`);
}

function deleteGroup(e, idx) {
  e.stopPropagation();
  const groups = loadGroups();
  groups.splice(idx, 1);
  saveGroups(groups);
  renderSavedGroups();
  showToast('Group removed');
}

// ════════════════════════════════════════════════════════════════
//  RECENT SEARCHES
// ════════════════════════════════════════════════════════════════
function saveRecentSearch(persons) {
  const label = persons.map(p => p.displayName).join(' + ');
  const addresses = [];
  for (let i = 0; i < autocompletes.length; i++) {
    const input = document.getElementById(`input-${i}`);
    if (input?.value) addresses.push(input.value);
  }
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  recents = recents.filter(r => r.label !== label);
  recents.unshift({ label, addresses });
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, 5)));
  renderRecentSearches();
}

function renderRecentSearches() {
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  const section = document.getElementById('recent-section');
  const chips   = document.getElementById('recent-chips');
  if (!recents.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  chips.innerHTML = recents.map((r, i) =>
    `<button class="recent-chip" title="${r.addresses.join(', ')}" onclick="loadRecent(${i})">
       <span class="chip-label">${r.label}</span>
       <span class="chip-del" onclick="deleteRecent(event,${i})" title="Remove">×</span>
     </button>`
  ).join('');
}

function deleteRecent(e, idx) {
  e.stopPropagation();
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  recents.splice(idx, 1);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  renderRecentSearches();
}

function loadRecent(idx) {
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  const r = recents[idx];
  if (!r) return;
  const container = document.getElementById('inputs-container');
  container.innerHTML = ''; autocompletes = []; personCount = 0;
  r.addresses.forEach(addr => addPerson(addr));
  showToast('Loaded recent search');
}

// ════════════════════════════════════════════════════════════════
//  URL STATE (share link only — NOT auto-loaded on plain refresh)
// ════════════════════════════════════════════════════════════════
function buildShareURL() {
  const p = new URLSearchParams();
  p.set('shared', '1');
  for (let i = 0; i < autocompletes.length; i++) {
    const input = document.getElementById(`input-${i}`);
    if (input?.value) p.set(`p${i}`, input.value);
  }
  return `${window.location.pathname}?${p}`;
}

function loadFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.has('shared')) return;
  let i = 0;
  while (p.has(`p${i}`) && i < 5) {
    if (i < personCount) {
      const input = document.getElementById(`input-${i}`);
      if (input) input.value = p.get(`p${i}`);
    } else { addPerson(p.get(`p${i}`)); }
    i++;
  }
}

// ════════════════════════════════════════════════════════════════
//  DEPARTURE TIME
// ════════════════════════════════════════════════════════════════
function getDepartureTime() {
  const val = document.getElementById('departure-datetime').value;
  if (val) {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d > new Date()) return d;
  }
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}
function setDefaultDeparture() {
  const d   = new Date();
  d.setHours(9, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('departure-datetime').value =
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T09:00`;
}

// ════════════════════════════════════════════════════════════════
//  TOAST + ERROR
// ════════════════════════════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 300); }, 2800);
}
function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = '⚠️ ' + msg;
  box.classList.remove('hidden');
}

// ════════════════════════════════════════════════════════════════
//  API KEY LOADING
//  Priority: 1) chrome.storage.sync (extension)  2) config.js (standalone)
// ════════════════════════════════════════════════════════════════
// ── API key storage helpers ──────────────────────────────────────
const API_KEY_STORAGE = 'meetle_api_key';

function getSavedKey() {
  // Priority: 1) localStorage (user entered in-app)  2) config.js (developer)
  return localStorage.getItem(API_KEY_STORAGE) || window.MEETLE_CONFIG?.MAPS_API_KEY || '';
}

function saveKeyAndReload(key) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
  window.location.reload();
}

async function loadMapsAPI() {
  const key = getSavedKey();
  if (!key) { showOnboarding(); return; }

  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=initMap`;
  s.async = true; s.defer = true;
  s.onerror = () => showOnboarding('That API key didn\'t work. Please check it and try again.');
  document.head.appendChild(s);
}

function showOnboarding(errorMsg) {
  document.body.innerHTML = `
    <div style="min-height:100vh;background:#f7f9ff;display:flex;align-items:center;
                justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
      <div style="background:#fff;border:1px solid #e4e8f0;border-radius:16px;
                  padding:36px 32px;max-width:480px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.09)">

        <!-- Brand -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
          <div style="width:44px;height:44px;background:#34a853;border-radius:11px;
                      display:flex;align-items:center;justify-content:center;
                      font-size:22px;font-weight:800;color:#fff">M</div>
          <div>
            <div style="font-size:22px;font-weight:800;color:#1a2e6b">Meetle</div>
            <div style="font-size:12px;color:#888">Smart meeting points for any group</div>
          </div>
        </div>

        <!-- Welcome text -->
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:8px">
          Welcome! One quick setup step 👋
        </div>
        <p style="font-size:13px;color:#555;line-height:1.7;margin-bottom:22px">
          Meetle uses Google Maps to calculate travel times. You need a free API key —
          Google gives every account <strong>$200 free credit/month</strong>, which covers
          thousands of searches.
        </p>

        ${errorMsg ? `<div style="background:#fce8e6;border:1px solid #f4b8b5;border-radius:8px;
          padding:10px 14px;font-size:12.5px;color:#c5221f;margin-bottom:16px">⚠️ ${errorMsg}</div>` : ''}

        <!-- Key input -->
        <label style="display:block;font-size:12px;font-weight:700;color:#444;
                      text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
          Your Google Maps API Key
        </label>
        <input id="onboard-key" type="text" placeholder="AIzaSy..."
          style="width:100%;border:1.5px solid #e4e8f0;border-radius:8px;padding:11px 14px;
                 font-size:14px;font-family:monospace;color:#1a1a1a;outline:none;
                 transition:border-color .15s;margin-bottom:12px"
          onfocus="this.style.borderColor='#1a2e6b'"
          onblur="this.style.borderColor='#e4e8f0'"
          onkeydown="if(event.key==='Enter')startWithKey()" />

        <button onclick="startWithKey()"
          style="width:100%;background:#1a2e6b;color:#fff;border:none;border-radius:8px;
                 padding:13px;font-size:15px;font-weight:700;cursor:pointer;
                 transition:background .15s;margin-bottom:20px"
          onmouseover="this.style.background='#2a3f8f'"
          onmouseout="this.style.background='#1a2e6b'">
          🚀 Start using Meetle
        </button>

        <!-- How to get key -->
        <details style="font-size:12.5px;color:#555">
          <summary style="cursor:pointer;font-weight:600;color:#1a2e6b;margin-bottom:8px">
            📋 How to get a free API key (2 minutes)
          </summary>
          <ol style="padding-left:18px;line-height:2.2;margin-top:8px">
            <li>Go to <a href="https://console.cloud.google.com" target="_blank"
                style="color:#1a2e6b;font-weight:600">console.cloud.google.com</a></li>
            <li>Create a new project (e.g. "Meetle")</li>
            <li>Go to <em>APIs & Services → Library</em>, enable:<br>
              &nbsp;• Maps JavaScript API<br>
              &nbsp;• Distance Matrix API<br>
              &nbsp;• Places API</li>
            <li>Go to <em>Credentials → Create → API key</em></li>
            <li>Copy and paste it above</li>
          </ol>
        </details>

      </div>
    </div>`;

  // Pre-fill if user had a bad key (so they can edit it)
  const saved = localStorage.getItem(API_KEY_STORAGE) || '';
  if (saved) document.getElementById('onboard-key').value = saved;
}

function startWithKey() {
  const key = document.getElementById('onboard-key')?.value?.trim();
  if (!key) { alert('Please paste your API key first.'); return; }
  if (!key.startsWith('AIza')) { alert('That doesn\'t look like a valid Google Maps key (should start with "AIza").'); return; }
  saveKeyAndReload(key);
}

// ════════════════════════════════════════════════════════════════
//  PWA INSTALL BANNER
// ════════════════════════════════════════════════════════════════
let _deferredInstallPrompt = null;
const INSTALL_DISMISSED_KEY = 'meetle_install_dismissed';

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
});

function maybeShowInstallBanner() {
  // Don't show if: already installed, dismissed before, or no prompt available
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const dismissed    = localStorage.getItem(INSTALL_DISMISSED_KEY);
  if (isStandalone || dismissed || !_deferredInstallPrompt) return;

  // Show banner after a short delay so it doesn't compete with results
  setTimeout(() => {
    let banner = document.getElementById('pwa-install-banner');
    if (banner) return; // already showing
    banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div id="pwa-banner-content">
        <div id="pwa-banner-icon">📲</div>
        <div id="pwa-banner-text">
          <strong>Add Meetle to your home screen</strong>
          <span>One tap access, works like a native app</span>
        </div>
        <button id="pwa-install-btn">Install</button>
        <button id="pwa-dismiss-btn" title="Dismiss">✕</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (!_deferredInstallPrompt) return;
      _deferredInstallPrompt.prompt();
      const { outcome } = await _deferredInstallPrompt.userChoice;
      _deferredInstallPrompt = null;
      banner.remove();
      if (outcome === 'accepted') showToast('Meetle installed! 🎉');
    });

    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      banner.remove();
    });
  }, 2000);
}

// Kick off
loadMapsAPI();

// ════════════════════════════════════════════════════════════════
//  BEST TIME TO MEET
// ════════════════════════════════════════════════════════════════
async function findBestTime() {
  const persons = getPersons();
  if (persons.length < 2 || persons.some(p => !p.location)) {
    showToast('Please enter at least 2 locations first.'); return;
  }

  const btn = document.getElementById('best-time-btn');
  const resultBox = document.getElementById('best-time-result');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning time slots…';
  resultBox.classList.add('hidden');

  // Build candidate time slots: next 3 days × 4 slots per day
  const slots = [];
  const now = new Date();
  for (let d = 0; d < 3; d++) {
    for (const hour of [9, 12, 15, 18]) {
      const t = new Date(now);
      t.setDate(t.getDate() + d);
      t.setHours(hour, 0, 0, 0);
      if (t > now) slots.push(t);
    }
  }

  const service = new google.maps.DistanceMatrixService();
  const origins = persons.map(p => p.location);
  const center  = {
    lat: origins.reduce((s, o) => s + o.lat(), 0) / origins.length,
    lng: origins.reduce((s, o) => s + o.lng(), 0) / origins.length
  };

  // Score each slot by total travel time to center
  const scored = [];
  for (const slot of slots) {
    try {
      const res = await new Promise((resolve, reject) => {
        service.getDistanceMatrix({
          origins,
          destinations: [center],
          travelMode: google.maps.TravelMode[persons[0].travelMode] || google.maps.TravelMode.DRIVING,
          drivingOptions: { departureTime: slot, trafficModel: google.maps.TrafficModel.BEST_GUESS }
        }, (r, s) => s === 'OK' ? resolve(r) : reject(s));
      });
      const times = res.rows.map(row => row.elements[0]?.duration_in_traffic?.value || row.elements[0]?.duration?.value || 9999);
      const total = times.reduce((a, b) => a + b, 0);
      const max   = Math.max(...times);
      scored.push({ slot, total, max, times });
    } catch { /* skip failed slots */ }
  }

  btn.disabled = false;
  btn.textContent = '⏰ Best Time to Meet';

  if (!scored.length) { showToast('Could not fetch time slot data. Try again.'); return; }

  scored.sort((a, b) => a.total - b.total);
  const best = scored[0];

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const fmt = t => {
    const h = t.getHours();
    return `${days[t.getDay()]} ${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
  };

  const rows = scored.slice(0, 5).map((s, i) => {
    const totalMins = Math.round(s.total / 60);
    const maxMins   = Math.round(s.max / 60);
    const isBest    = i === 0;
    return `<div class="bt-row ${isBest ? 'bt-best' : ''}">
      <span class="bt-slot">${isBest ? '🏆 ' : ''}${fmt(s.slot)}</span>
      <span class="bt-stats">Total ${totalMins}min · Max ${maxMins}min</span>
    </div>`;
  }).join('');

  // Auto-set the departure datetime picker to the best slot
  const iso = best.slot.toISOString().slice(0, 16);
  const picker = document.getElementById('departure-datetime');
  if (picker) picker.value = iso;

  resultBox.innerHTML = `
    <div class="bt-header">📊 Best slots for your group</div>
    ${rows}
    <div class="bt-note">✅ Departure set to best slot: <strong>${fmt(best.slot)}</strong></div>
  `;
  resultBox.classList.remove('hidden');
}

// ════════════════════════════════════════════════════════════════
//  WIRE ALL UI
// ════════════════════════════════════════════════════════════════
function wireUI() {
  document.getElementById('add-person-btn').addEventListener('click', () => addPerson());
  document.getElementById('find-btn').addEventListener('click', findMeetingPoint);
  document.getElementById('best-time-btn').addEventListener('click', findBestTime);

  // Dark mode
  document.getElementById('dark-mode-btn').addEventListener('click', toggleDarkMode);

  // Sidebar collapse
  document.getElementById('sidebar-toggle').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('collapsed')
  );

  // Place type chips
  document.querySelectorAll('.chip').forEach(c =>
    c.addEventListener('click', () => c.classList.toggle('active'))
  );

  // Rating buttons (single-select)
  document.querySelectorAll('[data-rating]').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-rating]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );

  // Price level buttons (single-select)
  document.querySelectorAll('[data-price]').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-price]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );

  // Isochrone time budget
  document.querySelectorAll('.iso-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.iso-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );

  // Show isochrones toggle
  document.getElementById('show-isochrones').addEventListener('change', e => {
    const v = e.target.checked;
    isochronePolygons.forEach(p => p.setVisible(v));
    if (overlapPolygon) overlapPolygon.setVisible(v);
  });

  // Isochrone collapsible
  document.getElementById('iso-toggle').addEventListener('click', function () {
    this.classList.toggle('open');
    document.getElementById('iso-body').classList.toggle('hidden');
  });

  // Max travel
  const maxToggle = document.getElementById('use-max-travel');
  const maxRow    = document.getElementById('max-travel-row');
  const maxSlider = document.getElementById('max-travel-slider');
  const maxLabel  = document.getElementById('max-travel-label');
  maxToggle.addEventListener('change', () => maxRow.classList.toggle('hidden', !maxToggle.checked));
  maxSlider.addEventListener('input', () => { maxLabel.textContent = maxSlider.value + ' min'; });

  // Share + WhatsApp
  document.getElementById('share-btn').addEventListener('click', shareLink);
  document.getElementById('whatsapp-btn').addEventListener('click', shareWhatsApp);

  // Surprise Me + Vote
  document.getElementById('surprise-btn').addEventListener('click', surpriseMe);
  document.getElementById('vote-btn').addEventListener('click', voteOnThis);

  // Save group
  document.getElementById('save-group-btn').addEventListener('click', openSaveGroupModal);
  document.getElementById('group-save-confirm').addEventListener('click', confirmSaveGroup);
  document.getElementById('group-save-cancel').addEventListener('click', () =>
    document.getElementById('group-modal').classList.add('hidden')
  );
  document.getElementById('group-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmSaveGroup();
    if (e.key === 'Escape') document.getElementById('group-modal').classList.add('hidden');
  });
}
