// IMPORTS
import './style.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import html2canvas from 'html2canvas';

// --- STATE CONFIGURATIONS ---
let timerInterval = null;
let totalDuration = 0;
let timeRemaining = 0;
let map = null;
let planeMarker = null;
let flightPath = null;
let turbulenceIncidents = 0;

let activeFlightState = {
  flightNum: 'POMO',
  dep: 'BOM',
  arr: 'GOX',
  seat: '1A',
  durationText: '30m'
};

const API_KEY = import.meta.env.VITE_AIRLABS_API_KEY;

// --- DOM SELECTORS ---
const navHomeBtn = document.getElementById('nav-home-btn');
const navRadarBtn = document.getElementById('nav-radar-btn');
const navLogbookBtn = document.getElementById('nav-logbook-btn');
const ctaRadarBtn = document.getElementById('cta-radar-btn');

const homeView = document.getElementById('home-view');
const radarView = document.getElementById('radar-view');
const logbookView = document.getElementById('logbook-view');

const flightInput = document.getElementById('flight-input');
const searchBtn = document.getElementById('search-btn');
const startBtn = document.getElementById('start-btn');
const abortBtn = document.getElementById('abort-btn');
const statusDisplay = document.getElementById('flight-status');
const statusDot = document.getElementById('status-dot');

const timeLeftDisplay = document.getElementById('time-left');
const turbulenceCounter = document.getElementById('turbulence-counter');

// Environment & Audio Elements
const volumeInput = document.getElementById('volume');
const volumePct = document.getElementById('volume-pct');
const cabinNoise = document.getElementById('cabin-noise');

// Boarding Pass Modal Elements
const boardingPassModal = document.getElementById('boarding-pass-modal');
const closePassBtn = document.getElementById('close-pass-btn');
const sharePassBtn = document.getElementById('share-pass-btn');
const passFlightNum = document.getElementById('pass-flight-num');
const passDep = document.getElementById('pass-dep');
const passArr = document.getElementById('pass-arr');
const passDuration = document.getElementById('pass-duration');
const bpCatchyBroadcast = document.getElementById('bp-catchy-broadcast');

// Logbook Registry Elements
const logbookRows = document.getElementById('logbook-rows');
const logbookEmpty = document.getElementById('logbook-empty');
const clearLogBtn = document.getElementById('clear-log-btn');
const statTotalAirtime = document.getElementById('stat-total-airtime');
const statOtp = document.getElementById('stat-otp');
const statLongestSector = document.getElementById('stat-longest-sector');

// --- APP ARCHITECTURE NAVIGATION TRIPS ---
function switchView(target) {
  homeView.classList.add('hidden-view');
  radarView.classList.add('hidden-view');
  logbookView.classList.add('hidden-view');

  navHomeBtn.classList.remove('active-tab');
  navRadarBtn.classList.remove('active-tab');
  if (navLogbookBtn) navLogbookBtn.classList.remove('active-tab');

  if (target === 'home') {
    homeView.classList.remove('hidden-view');
    navHomeBtn.classList.add('active-tab');
  } else if (target === 'radar') {
    radarView.classList.remove('hidden-view');
    navRadarBtn.classList.add('active-tab');
    initializeRadarMap();
  } else if (target === 'logbook') {
    logbookView.classList.remove('hidden-view');
    if (navLogbookBtn) navLogbookBtn.add('active-tab');
    renderLogbookManifest();
  }
}

navHomeBtn.addEventListener('click', () => switchView('home'));
navRadarBtn.addEventListener('click', () => switchView('radar'));
if (navLogbookBtn) navLogbookBtn.addEventListener('click', () => switchView('logbook'));
if (ctaRadarBtn) ctaRadarBtn.addEventListener('click', () => switchView('radar'));

// --- AUDIO MIXER CONSOLE CONTROLS ---
volumeInput.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  cabinNoise.volume = value;
  volumePct.textContent = `${Math.round(value * 100)}%`;

  if (value > 0 && cabinNoise.paused) {
    cabinNoise.play().catch(err => console.log("Audio activation context deferred:", err));
  } else if (value === 0 && !cabinNoise.paused) {
    cabinNoise.pause();
  }
});

// --- TELEMETRY FLIGHT TRACK ROUTING ENGINE ---
searchBtn.addEventListener('click', async () => {
  const code = flightInput.value.trim().toUpperCase();
  if (!code) return;

  searchBtn.disabled = true;
  statusDot.className = 'status-dot searching';
  statusDisplay.textContent = `Pinging satellite transponders for vector route: ${code}...`;

  // Check Sandbox Presets
  if (['HOP', 'CRUISE', 'LONG HAUL'].includes(code) || code === 'MINI') {
    setTimeout(() => {
      let mins = 45;
      if (code === 'MINI') mins = 1;
      else if (code === 'HOP') mins = 90;
      else if (code === 'CRUISE') mins = 120;
      else if (code === 'LONG HAUL') mins = 180;

      setupFlightParameters(code, 'SAN', 'BOX', mins, "Simulation preset sandbox environment active.");
    }, 1200);
    return;
  }

  // Handle Live Aviation API Fetch Route
  try {
    const response = await fetch(`https://airlabs.co/api/v9/flight?flight_iata=${code}&api_key=${API_KEY}`);
    const data = await response.json();

    if (data.error || !data.response) {
      fallbackToSimulatedRoute(code, "Live route untracked. Instantiating synthetic transponder vector.");
    } else {
      const flight = data.response;
      const depCode = flight.dep_iata || 'DEP';
      const arrCode = flight.arr_iata || 'ARR';
      const durationMins = flight.duration || 75;

      setupFlightParameters(code, depCode, arrCode, durationMins, `Radar connection established with active flight ${code}.`);
    }
  } catch (err) {
    console.error("Satellite transmission error:", err);
    fallbackToSimulatedRoute(code, "Network grid timeout. Initializing backup simulation vector.");
  }
});

function fallbackToSimulatedRoute(code, statusMessage) {
  const mockHubs = ['LAX', 'HND', 'DXB', 'CDG', 'SIN', 'LHR', 'SFO', 'SYD'];
  const dep = mockHubs[Math.floor(Math.random() * mockHubs.length)];
  let arr = mockHubs[Math.floor(Math.random() * mockHubs.length)];
  while (arr === dep) {
    arr = mockHubs[Math.floor(Math.random() * mockHubs.length)];
  }
  setupFlightParameters(code, dep, arr, 60, statusMessage);
}

function setupFlightParameters(code, dep, arr, durationMins, message) {
  totalDuration = durationMins * 60;
  timeRemaining = totalDuration;

  activeFlightState = {
    flightNum: code,
    dep: dep,
    arr: arr,
    seat: `${Math.floor(Math.random() * 30) + 1}${['A', 'B', 'C', 'D', 'E', 'F'][Math.floor(Math.random() * 6)]}`,
    durationText: `${durationMins}m`
  };

  updateChronometerDisplay();
  statusDot.className = 'status-dot active';
  statusDisplay.textContent = message;
  searchBtn.disabled = false;
  startBtn.disabled = false;

  triggerBoardingPassModal();
}

// --- COCKPIT INTERFACES AND CHRONOMETERS ---
function updateChronometerDisplay() {
  const hrs = Math.floor(timeRemaining / 3600).toString().padStart(2, '0');
  const mins = Math.floor((timeRemaining % 3600) / 60).toString().padStart(2, '0');
  const secs = (timeRemaining % 60).toString().padStart(2, '0');
  timeLeftDisplay.textContent = `${hrs}:${mins}:${secs}`;
}

startBtn.addEventListener('click', () => {
  if (timerInterval) return;

  startBtn.classList.add('hidden');
  abortBtn.classList.remove('hidden');
  flightInput.disabled = true;
  searchBtn.disabled = true;
  turbulenceIncidents = 0;

  if (turbulenceCounter) {
    turbulenceCounter.classList.remove('hidden');
    turbulenceCounter.textContent = `⚠️ TURBULENCE STATUS: STABLE`;
    turbulenceCounter.style.color = '#10b981';
  }

  // Engage Visibility Anti-Distraction Trackers
  document.addEventListener('visibilitychange', trackAttentionDeflection);
  window.addEventListener('blur', registerAttentionSlip);

  playCockpitChime();
  speakCaptainsAnnouncement(`Ladies and gentlemen, this is your captain speaking. We have reached our cruising altitude, and the seatbelt sign has been turned off. You are cleared for deep focus execution.`);

  timerInterval = setInterval(() => {
    if (timeRemaining > 0) {
      timeRemaining--;
      updateChronometerDisplay();
      updateMapTelemetryVectors();
    } else {
      completeFlightMissionTrack();
    }
  }, 1000);
});

function abortFlightMissionVectors() {
  clearInterval(timerInterval);
  timerInterval = null;

  // Revoke Protection Watchers
  document.removeEventListener('visibilitychange', trackAttentionDeflection);
  window.removeEventListener('blur', registerAttentionSlip);

  appendRecordToHistoryManifest('ABORTED');

  playCockpitChime();
  alert(`Flight Aborted. Emergency vectors deployed. Focus session recorded as unfulfilled.`);

  resetCockpitControlDeck();
}

abortBtn.addEventListener('click', abortFlightMissionVectors);

function completeFlightMissionTrack() {
  clearInterval(timerInterval);
  timerInterval = null;

  document.removeEventListener('visibilitychange', trackAttentionDeflection);
  window.removeEventListener('blur', registerAttentionSlip);

  appendRecordToHistoryManifest('COMPLETED');

  playCockpitChime();
  speakCaptainsAnnouncement("Cabin crew, prepare for gate arrival. Welcome to your destination. Your focus mission has been recorded successfully in the permanent logbook.");
  alert(`Flight Completed successfully!`);

  resetCockpitControlDeck();
}

function resetCockpitControlDeck() {
  timeRemaining = 0;
  totalDuration = 0;
  updateChronometerDisplay();

  startBtn.classList.remove('hidden');
  startBtn.disabled = true;
  abortBtn.classList.add('hidden');
  flightInput.disabled = false;
  flightInput.value = '';
  searchBtn.disabled = false;

  statusDot.className = 'status-dot';
  statusDisplay.textContent = 'Awaiting flight initialization parameters...';
  if (turbulenceCounter) turbulenceCounter.classList.add('hidden');

  if (flightPath) flightPath.remove();
  if (planeMarker) planeMarker.remove();
}

// --- ANTI-DISTRACTION SHIELD PROTECTION LOGICS ---
function trackAttentionDeflection() {
  if (document.hidden) {
    registerAttentionSlip();
  }
}

function registerAttentionSlip() {
  if (!timerInterval) return;

  turbulenceIncidents++;
  if (turbulenceCounter) {
    turbulenceCounter.textContent = `⚠️ AMBIENT TURBULENCE DETECTED: INCIDENTS (${turbulenceIncidents})`;
    turbulenceCounter.style.color = '#f59e0b';
    turbulenceCounter.style.animation = 'pulse 0.4s 2';
  }
}

// --- RADAR NAVIGATION AND GEO-MAP VECTOR ENGINE ---
function initializeRadarMap() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
    return;
  }

  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
  }).addTo(map);
}

function updateMapTelemetryVectors() {
  if (!map || totalDuration <= 0) return;

  const progress = (totalDuration - timeRemaining) / totalDuration;
  document.getElementById('map-stat-track').textContent = `${(progress * 100).toFixed(2)}%`;

  const startCoords = [19.076, 72.877]; // BOM Coordinates Template
  const endCoords = [15.512, 73.832];   // GOX Coordinates Template

  const currentLat = startCoords[0] + (endCoords[0] - startCoords[0]) * progress;
  const currentLng = startCoords[1] + (endCoords[1] - startCoords[1]) * progress;

  if (flightPath) flightPath.remove();
  flightPath = L.polyline([startCoords, [currentLat, currentLng]], {
    color: '#38bdf8',
    weight: 2,
    dashArray: '5, 5'
  }).addTo(map);

  if (planeMarker) {
    planeMarker.setLatLng([currentLat, currentLng]);
  } else {
    const customIcon = L.divIcon({
      className: 'custom-plane-div-node',
      html: `
        <div class="radar-jet-wrapper">
          <svg class="radar-jet-svg" viewBox="0 0 24 24" style="color:#38bdf8; width:32px; height:32px;">
            <path fill="currentColor" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5l8 2.5Z"/>
          </svg>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    planeMarker = L.marker([currentLat, currentLng], { icon: customIcon }).addTo(map);
  }

  map.setView([currentLat, currentLng], map.getZoom(), { animate: true });
}

// --- BOARDING PASS MODAL ENGINE ---
function triggerBoardingPassModal() {
  passFlightNum.textContent = activeFlightState.flightNum;
  passDep.textContent = activeFlightState.dep;
  passArr.textContent = activeFlightState.arr;
  passDuration.textContent = activeFlightState.durationText;

  const logs = [
    "Locking coordinates focus configurations...",
    "Telemetry arrays armed and ready.",
    "Fuel allocations optimal. Safe flight.",
    "Broadband noise shielding enabled."
  ];
  bpCatchyBroadcast.textContent = logs[Math.floor(Math.random() * logs.length)];

  boardingPassModal.classList.remove('hidden');
}

closePassBtn.addEventListener('click', () => {
  boardingPassModal.classList.add('hidden');
});

sharePassBtn.addEventListener('click', async () => {
  const target = document.getElementById('boarding-pass');
  sharePassBtn.disabled = true;
  const originalText = sharePassBtn.innerHTML;
  sharePassBtn.innerHTML = '⚙️ <span>Generating...</span>';

  try {
    const canvas = await html2canvas(target, {
      backgroundColor: '#080a0f',
      scale: 2,
      useCORS: true,
      ignoreElements: (el) => el.id === 'close-pass-btn' || el.id === 'share-pass-btn'
    });

    const link = document.createElement('a');
    link.download = `V1-Pass-${activeFlightState.flightNum}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error("Canvas construction failed:", err);
  } finally {
    sharePassBtn.disabled = false;
    sharePassBtn.innerHTML = originalText;
  }
});

// --- PILOT REGISTRY LOGBOOK MANIFESTS ---
function fetchLocalStorageRegistry() {
  try {
    return JSON.parse(localStorage.getItem('v1_flight_logs')) || [];
  } catch (e) {
    return [];
  }
}

function appendRecordToHistoryManifest(status) {
  const logs = fetchLocalStorageRegistry();
  const entry = {
    id: Date.now(),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    flight: activeFlightState.flightNum,
    route: `${activeFlightState.dep} ➔ ${activeFlightState.arr}`,
    seat: activeFlightState.seat,
    duration: activeFlightState.durationText,
    rawDurationMins: Math.round(totalDuration / 60),
    status: status
  };

  logs.unshift(entry);
  localStorage.setItem('v1_flight_logs', JSON.stringify(logs));
}

function renderLogbookManifest() {
  const logs = fetchLocalStorageRegistry();

  if (logs.length === 0) {
    logbookEmpty.classList.remove('hidden');
    logbookRows.innerHTML = '';
    statTotalAirtime.textContent = '0.0 HRS';
    statOtp.textContent = '100.0%';
    statLongestSector.textContent = '-- MIN';
    return;
  }

  logbookEmpty.classList.add('hidden');

  let totalMins = 0;
  let completedCount = 0;
  let maxDuration = 0;

  logbookRows.innerHTML = logs.map(item => {
    const isCompleted = item.status === 'COMPLETED';
    if (isCompleted) {
      totalMins += item.rawDurationMins || 0;
      completedCount++;
      if (item.rawDurationMins > maxDuration) maxDuration = item.rawDurationMins;
    }

    const statusBadgeStyle = isCompleted
      ? 'background:rgba(34,197,94,0.1);color:#4ade80;border:1px solid rgba(34,197,94,0.15);'
      : 'background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.15);';

    return `
      <tr>
        <td class="log-date">${item.date}</td>
        <td class="log-flight">${item.flight}</td>
        <td class="log-route">${item.route}</td>
        <td style="font-family:'JetBrains Mono';">${item.seat}</td>
        <td class="log-duration">${item.duration}</td>
        <td>
          <span style="padding:4px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;${statusBadgeStyle}">
            ${item.status}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Dashboard Telemetry Recalculation
  statTotalAirtime.textContent = `${(totalMins / 60).toFixed(1)} HRS`;
  statOtp.textContent = `${((completedCount / logs.length) * 100).toFixed(1)}%`;
  statLongestSector.textContent = maxDuration > 0 ? `${maxDuration} MIN` : '-- MIN';
}

clearLogBtn.addEventListener('click', () => {
  if (confirm("Are you sure you want to purge all blackbox telemetry manifest archives? This cannot be undone.")) {
    localStorage.removeItem('v1_flight_logs');
    renderLogbookManifest();
  }
});

// --- AUDIO FREQUENCY CHIME AND ANNOUNCEMENTS ---
function playCockpitChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();

    // First high chime note (660Hz - E5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(660, ctx.currentTime);
    gain1.gain.setValueAtTime(0.1, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    // Harmonic balanced chime note delayed (554Hz - C#5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(554, ctx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.8);
    osc2.stop(ctx.currentTime + 0.9);
  } catch (e) {
    console.error("Frequency generation failure:", e);
  }
}

function speakCaptainsAnnouncement(phrase) {
  try {
    if (!('speechSynthesis' in window)) return;

    // Stop ongoing speech vectors before scheduling announcements
    window.speechSynthesis.cancel();

    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.volume = 0.8;
      utterance.rate = 0.92; // Slight drawl mimicking standard pilot announcement profiles
      utterance.pitch = 0.95;

      const voices = window.speechSynthesis.getVoices();
      const standardVoice = voices.find(v => v.lang.startsWith('en-US') && v.name.toLowerCase().includes('natural'))
        || voices.find(v => v.lang.startsWith('en'));
      if (standardVoice) utterance.voice = standardVoice;

      window.speechSynthesis.speak(utterance);
    }, 400);
  } catch (e) {
    console.error("Announcement audio system initialization mismatch:", e);
  }
}