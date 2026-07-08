// IMPORTS
import './style.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import html2canvas from 'html2canvas';

// STATE MACHINE CONFIGS
let timerInterval = null;
let totalDuration = 0;
let timeRemaining = 0;
let map, planeMarker, flightPath;

// Data logs
let activeFlightState = {
  flightNum: 'POMO',
  dep: 'BOM',
  arr: 'GOX',
  seat: '1A',
  durationText: '30m'
};

const API_KEY = import.meta.env.VITE_AIRLABS_API_KEY;

// DOM SELECTORS
const navHomeBtn = document.getElementById('nav-home-btn');
const navRadarBtn = document.getElementById('nav-radar-btn');
const ctaRadarBtn = document.getElementById('cta-radar-btn');
const homeView = document.getElementById('home-view');
const radarView = document.getElementById('radar-view');
const flightInput = document.getElementById('flight-input');
const searchBtn = document.getElementById('search-btn');
const startBtn = document.getElementById('start-btn');
const abortBtn = document.getElementById('abort-btn');
const timeLeftDisplay = document.getElementById('time-left');
const statusDisplay = document.getElementById('flight-status');
const statusDot = document.getElementById('status-dot');
const sharePassBtn = document.getElementById('share-pass-btn');

// Logbook
const navLogbookBtn = document.getElementById('nav-logbook-btn');
const logbookView = document.getElementById('logbook-view');
const logbookRows = document.getElementById('logbook-rows');
const logbookEmpty = document.getElementById('logbook-empty');
const clearLogBtn = document.getElementById('clear-log-btn');

// Statistics  
const statTotalAirtime = document.getElementById('stat-total-airtime');
const statOtp = document.getElementById('stat-otp');
const statLongestSector = document.getElementById('stat-longest-sector');

// Popup Modal DOM Elements
const boardingPassModal = document.getElementById('boarding-pass-modal');
const closePassBtn = document.getElementById('close-pass-btn');

const passFlightNum = document.getElementById('pass-flight-num');
const passDep = document.getElementById('pass-dep');
const passArr = document.getElementById('pass-arr');
const passDuration = document.getElementById('pass-duration');
const groundTrackDisplay = document.getElementById('map-stat-track');
const cabinNoise = document.getElementById('cabin-noise');
const volumeSlider = document.getElementById('volume');
const volumePct = document.getElementById('volume-pct');

// INITIALIZE RADAR ENVIRONMENT
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([22.0, 78.0], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
}

// MATHEMATICAL DIRECTION ANGLES (HEADING CALCULATIONS)
function calculateBearing(startLat, startLng, endLat, endLng) {
  const dLng = (endLng - startLng) * Math.PI / 180;
  const lat1 = startLat * Math.PI / 180;
  const lat2 = endLat * Math.PI / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// GLOBAL SEARCH ROUTING (API vs SANDBOX)
searchBtn.addEventListener('click', async () => {
  const flightNum = flightInput.value.trim().toUpperCase();
  if (!flightNum) return alert('Enter a validation vector.');

  statusDisplay.innerText = "Scanning radar feeds...";
  statusDot.className = "status-dot searching";
  boardingPassModal.classList.add('hidden');
  startBtn.disabled = true;

  // DEV MODE SANDBOX INTERCEPTOR
  if (['HOP', 'CRUISE', 'LONG HAUL'].includes(flightNum)) {
    let mockSecs = 5400;
    let depCode = "BOM", arrCode = "GOA";
    let startPos = [19.0896, 72.8656], endPos = [15.7322, 73.8680];

    if (flightNum === 'CRUISE') {
      mockSecs = 7200; depCode = "BOM"; arrCode = "DEL";
      startPos = [19.0896, 72.8656]; endPos = [28.5561, 77.1002];
    } else if (flightNum === 'LONG HAUL') {
      mockSecs = 10800; depCode = "BOM"; arrCode = "CCU";
      startPos = [19.0896, 72.8656], endPos = [22.6547, 88.4467];
    }

    totalDuration = mockSecs;
    timeRemaining = totalDuration;

    // Save strictly to clean variable memory track instead of lazy DOM scraping patterns
    activeFlightState = {
      flightNum: flightNum,
      dep: depCode,
      arr: arrCode,
      seat: "1A",
      durationText: `${Math.round(mockSecs / 60)}m`
    };

    passFlightNum.innerText = activeFlightState.flightNum;
    passDep.innerText = activeFlightState.dep;
    passArr.innerText = activeFlightState.arr;
    passDuration.innerText = activeFlightState.durationText;

    boardingPassModal.classList.remove('hidden');
    statusDisplay.innerText = "Boarding Complete. Clear for Departure.";
    statusDot.className = "status-dot active";
    startBtn.disabled = false;

    setupFlightVisuals(startPos, endPos);
    return;
  }

  // LIVE TELEMETRY API VECTOR
  try {
    if (!API_KEY) {
      statusDisplay.innerText = "Configuration Error: API Key missing in environment.";
      statusDot.className = "status-dot";
      return;
    }

    statusDisplay.innerText = "Tracking active live transponder coordinates...";
    const radarResponse = await fetch(`https://airlabs.co/api/v9/flights?api_key=${API_KEY}&flight_iata=${flightNum}`);
    const radarData = await radarResponse.json();

    if (radarData.response && radarData.response.length > 0) {
      const flight = radarData.response[0];
      const startPos = [flight.lat, flight.lng];
      const destinationAirport = flight.arr_iata;

      if (!destinationAirport) {
        statusDisplay.innerText = "Active flight found but, destination registry is unlisted.";
        statusDot.className = "status-dot";
        return;
      }

      statusDisplay.innerText = `Resolving terminal coordinates for ${destinationAirport}...`;
      const airportResponse = await fetch(`https://airlabs.co/api/v9/airports?api_key=${API_KEY}&iata_code=${destinationAirport}`);
      const airportData = await airportResponse.json();

      if (!airportData.response || airportData.response.length === 0) {
        statusDisplay.innerText = `Unable to verify terminal mapping for airport: ${destinationAirport}`;
        statusDot.className = "status-dot";
        return;
      }

      const airportInfo = airportData.response[0];
      const endPos = [parseFloat(airportInfo.lat), parseFloat(airportInfo.lng)];

      // OPTIMIZATION: Replacing tedious high-compute Haversine formula with native Leaflet engine methods
      const distanceKm = L.latLng(startPos).distanceTo(L.latLng(endPos)) / 1000;

      const liveSpeedKmh = flight.speed && flight.speed > 50 ? Math.round(flight.speed) : 850;
      const hoursRemaining = distanceKm / liveSpeedKmh;
      totalDuration = Math.round(hoursRemaining * 3600);

      if (totalDuration <= 0) totalDuration = 60;
      timeRemaining = totalDuration;

      activeFlightState = {
        flightNum: flightNum,
        dep: flight.dep_iata || "???",
        arr: destinationAirport,
        seat: "1A",
        durationText: `${Math.round(totalDuration / 60)}m`
      };

      passFlightNum.innerText = activeFlightState.flightNum;
      passDep.innerText = activeFlightState.dep;
      passArr.innerText = activeFlightState.arr;
      passDuration.innerText = activeFlightState.durationText;

      boardingPassModal.classList.remove('hidden');
      statusDisplay.innerText = "Passenger Manifest Verified. Clear for Takeoff.";
      statusDot.className = "status-dot active";
      startBtn.disabled = false;

      setupFlightVisuals(startPos, endPos);
    } else {
      statusDisplay.innerText = "Flight is currently offline or at the gate.";
      statusDot.className = "status-dot";
    }
  } catch (err) {
    console.error("Critical Network Error Loop:", err);
    statusDisplay.innerText = "Transmission error. Check terminal console logs.";
    statusDot.className = "status-dot";
  }
});

// RENDER VISUAL TRAJECTORIES
function setupFlightVisuals(startCoords, endCoords) {
  if (flightPath) map.removeLayer(flightPath);
  if (planeMarker) map.removeLayer(planeMarker);

  flightPath = L.polyline([startCoords, endCoords], {
    color: '#38bdf8',
    weight: 2,
    dashArray: '6, 8'
  }).addTo(map);

  const initialHeading = calculateBearing(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);

  const planeIcon = L.divIcon({
    html: `
      <div class="radar-jet-wrapper" style="transform: rotate(${initialHeading}deg);">
        <svg class="radar-jet-svg" viewBox="0 0 24 24">
          <path fill="#38bdf8" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5l8 2.5Z"/>
        </svg>
      </div>
    `,
    className: 'custom-plane-div-node',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  planeMarker = L.marker(startCoords, { icon: planeIcon }).addTo(map);
  map.fitBounds(flightPath.getBounds(), { padding: [50, 50] });

  groundTrackDisplay.innerText = "0.00%";
  updateChronometerDisplay();
}

// MASTER COUNTDOWN
startBtn.addEventListener('click', () => {
  cabinNoise.volume = volumeSlider.value;
  cabinNoise.currentTime = 0;
  cabinNoise.play().catch(() => console.log('Audio engine waiting for UI trigger window focus.'));

  startBtn.classList.add('hidden');
  abortBtn.classList.remove('hidden');
  flightInput.disabled = true;
  searchBtn.disabled = true;
  statusDisplay.innerText = "In Flight ✈️ Cockpit Isolation Active";

  timerInterval = setInterval(() => {
    timeRemaining--;
    updateChronometerDisplay();
    updateSpatialTelemetry();

    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      appendFlightToLogbook();
      sessionTeardown("Wheels Down. Welcome to your destination! 🎉");
    }
  }, 1000);
});

// ABORT OPERATIONS
abortBtn.addEventListener('click', () => {
  // FIXED: Aborted log executes first using memory cache safely before DOM layouts get cleared out
  appendAbortedFlightToLogbook();

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Clean up Map elements safely
  if (flightPath) map.removeLayer(flightPath);
  if (planeMarker) map.removeLayer(planeMarker);

  sessionTeardown("Flight Aborted.");
});

function sessionTeardown(messageString) {
  cabinNoise.pause();
  startBtn.classList.remove('hidden');
  abortBtn.classList.add('hidden');
  flightInput.disabled = false;
  searchBtn.disabled = false;
  startBtn.disabled = true;
  boardingPassModal.classList.add('hidden');
  statusDisplay.innerText = messageString;
  statusDot.className = "status-dot";
}

function updateChronometerDisplay() {
  const hours = Math.floor(timeRemaining / 3600);
  const minutes = Math.floor((timeRemaining % 3600) / 60);
  const seconds = timeRemaining % 60;
  timeLeftDisplay.innerText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateSpatialTelemetry() {
  if (!flightPath || !planeMarker) return;

  const pct = (totalDuration - timeRemaining) / totalDuration;
  groundTrackDisplay.innerText = `${(pct * 100).toFixed(2)}%`;

  const coords = flightPath.getLatLngs();
  const start = coords[0];
  const end = coords[1];

  const currentLat = start.lat + (end.lat - start.lat) * pct;
  const currentLng = start.lng + (end.lng - start.lng) * pct;

  const currentHeading = calculateBearing(currentLat, currentLng, end.lat, end.lng);

  planeMarker.setLatLng([currentLat, currentLng]);

  const jetContainer = planeMarker.getElement()?.querySelector('.radar-jet-wrapper');
  if (jetContainer) {
    jetContainer.style.transform = `rotate(${currentHeading}deg)`;
  }
}

// VISUAL MODAL INTERACTIVE
closePassBtn.addEventListener('click', () => {
  boardingPassModal.classList.add('hidden');
});

boardingPassModal.addEventListener('click', (e) => {
  if (e.target === boardingPassModal) {
    boardingPassModal.classList.add('hidden');
  }
});

volumeSlider.addEventListener('input', (e) => {
  const targetVal = e.target.value;
  cabinNoise.volume = targetVal;
  volumePct.innerText = `${Math.round(targetVal * 100)}%`;
});

// SNAPSHOT ENGINE
sharePassBtn.addEventListener('click', async () => {
  const passElement = document.getElementById('boarding-pass');
  const closeBtn = document.querySelector('.modal-close-trigger');
  closeBtn.style.display = 'none';

  const canvas = await html2canvas(passElement, {
    backgroundColor: '#0f131a',
    scale: 2,
    logging: false
  });

  closeBtn.style.display = 'block';

  const link = document.createElement('a');
  link.download = 'focus-flight-pass.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

initMap();

// DEEP LINK QUERY PARSER
function parseSharedFlightURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedFlight = urlParams.get('flight');

  if (sharedFlight) {
    flightInput.value = sharedFlight.toUpperCase();
    searchBtn.click();
  }
}

setTimeout(parseSharedFlightURL, 500);

// --- VIEW ROUTING CONTROL SYSTEM ---
function loadLogbook() {
  const logs = JSON.parse(localStorage.getItem('v1_flight_logs')) || [];
  logbookRows.innerHTML = '';

  let totalMinutes = 0;
  let longestFlightMinutes = 0;
  let successfulFlightsCount = 0;

  logs.forEach(log => {
    const parsedMinutes = parseInt(log.duration) || 0;
    totalMinutes += parsedMinutes;

    if (parsedMinutes > longestFlightMinutes) {
      longestFlightMinutes = parsedMinutes;
    }

    if (log.status === "COMPLETED") {
      successfulFlightsCount++;
    }
  });

  const totalFlightsLoggedCount = logs.length;
  const computedOtpPercent = totalFlightsLoggedCount > 0
    ? ((successfulFlightsCount / totalFlightsLoggedCount) * 100).toFixed(1)
    : "100.0";

  const totalHoursLoggedDisplay = (totalMinutes / 60).toFixed(1);
  statTotalAirtime.innerText = `${totalHoursLoggedDisplay} HRS`;
  statOtp.innerText = `${computedOtpPercent}%`;
  statLongestSector.innerText = longestFlightMinutes > 0 ? `${longestFlightMinutes} MIN` : `-- MIN`;

  if (logs.length === 0) {
    logbookEmpty.classList.remove('hidden');
    return;
  }
  logbookEmpty.classList.add('hidden');

  logs.forEach(log => {
    const tr = document.createElement('tr');
    const badgeMarkupStyleClass = log.status === "ABORTED" ? "badge-status-red" : "badge-status-green";
    const displayedStatusTextValue = log.status || "COMPLETED";

    tr.innerHTML = `
      <td class="log-date">${log.date}</td>
      <td class="log-flight">${log.flightNum}</td>
      <td class="log-route">${log.dep} ➔ ${log.arr}</td>
      <td><span style="opacity: 0.7;">Focus Elite /</span> <strong>${log.seat}</strong></td>
      <td class="log-duration">${log.duration}</td>
      <td><span class="${badgeMarkupStyleClass}" style="margin:0; padding:2px 8px; font-size:0.65rem;">${displayedStatusTextValue}</span></td>
    `;
    logbookRows.appendChild(tr);
  });
}

function appendFlightToLogbook() {
  const logs = JSON.parse(localStorage.getItem('v1_flight_logs')) || [];

  // FIXED: No longer scrapes dangerous raw text values from vulnerable DOM nodes
  const currentFlightLog = {
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    flightNum: activeFlightState.flightNum,
    dep: activeFlightState.dep,
    arr: activeFlightState.arr,
    seat: activeFlightState.seat,
    duration: activeFlightState.durationText,
    status: "COMPLETED"
  };

  logs.unshift(currentFlightLog);
  localStorage.setItem('v1_flight_logs', JSON.stringify(logs));
  loadLogbook();
}

function appendAbortedFlightToLogbook() {
  const logs = JSON.parse(localStorage.getItem('v1_flight_logs')) || [];

  const minutesElapsedSoFar = totalDuration && timeRemaining
    ? Math.round((totalDuration - timeRemaining) / 60)
    : 0;

  // FIXED: Relying strictly on our active state memory tracking wrapper
  const currentFlightLog = {
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    flightNum: activeFlightState.flightNum,
    dep: activeFlightState.dep,
    arr: activeFlightState.arr,
    seat: activeFlightState.seat,
    duration: `${minutesElapsedSoFar}m`,
    status: "ABORTED"
  };

  logs.unshift(currentFlightLog);
  localStorage.setItem('v1_flight_logs', JSON.stringify(logs));
  loadLogbook();
}

function openRadarView() {
  homeView.classList.add('hidden-view');
  logbookView.classList.add('hidden-view');
  radarView.classList.remove('hidden-view');

  navHomeBtn.classList.remove('active-tab');
  navLogbookBtn.classList.remove('active-tab');

  // FIX: Changed from .add() to .classList.add() to prevent script crashes
  navRadarBtn.classList.add('active-tab');

  // Forces Leaflet to re-draw and align tiles perfectly with the container bounds
  setTimeout(() => {
    if (map) {
      map.invalidateSize();
    }
  }, 200);
}

window.addEventListener('resize', () => {
  if (map && !radarView.classList.contains('hidden-view')) {
    map.invalidateSize();
  }
});

function openHomeView() {
  radarView.classList.add('hidden-view');
  logbookView.classList.add('hidden-view');
  homeView.classList.remove('hidden-view');

  navRadarBtn.classList.remove('active-tab');
  navLogbookBtn.classList.remove('active-tab');
  navHomeBtn.classList.add('active-tab');
}

function openLogbookView() {
  homeView.classList.add('hidden-view');
  radarView.classList.add('hidden-view');
  logbookView.classList.remove('hidden-view');

  navHomeBtn.classList.remove('active-tab');
  navRadarBtn.classList.remove('active-tab');
  navLogbookBtn.classList.add('active-tab');

  loadLogbook();
}

// Bind Navigation Triggers
navRadarBtn.addEventListener('click', openRadarView);
ctaRadarBtn.addEventListener('click', openRadarView);
navHomeBtn.addEventListener('click', openHomeView);
navLogbookBtn.addEventListener('click', openLogbookView);

clearLogBtn.addEventListener('click', () => {
  if (confirm('Are you clear to scrub the official flight manifest logbook logs? This cannot be undone.')) {
    localStorage.removeItem('v1_flight_logs');
    loadLogbook();
  }
});

loadLogbook();