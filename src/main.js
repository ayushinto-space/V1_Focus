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

const API_KEY = import.meta.env.VITE_AIRLABS_API_KEY;

// DOM SELECTORS
// Navigation Screen View
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
  return (bearing + 360) % 360; // Vector Normalization 
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
  if (['TEST', 'POMO', 'MARATHON'].includes(flightNum)) {
    console.log(`Initializing Sandbox Bypass: ${flightNum}`);

    let mockSecs = 60;
    let depCode = "DEL", arrCode = "BOM";
    let startPos = [28.5562, 77.1000], endPos = [19.0896, 72.8656];

    if (flightNum === 'POMO') {
      mockSecs = 1800; depCode = "BOM"; arrCode = "GOX";
      startPos = [19.0896, 72.8656]; endPos = [15.7292, 73.8644];
    } else if (flightNum === 'MARATHON') {
      mockSecs = 32400; depCode = "DEL"; arrCode = "LHR";
      startPos = [28.5562, 77.1000], endPos = [51.4700, -0.4543];
    }

    totalDuration = mockSecs;
    timeRemaining = totalDuration;

    passFlightNum.innerText = flightNum === 'TEST' ? "FT001" : flightNum;
    passDep.innerText = depCode;
    passArr.innerText = arrCode;
    passDuration.innerText = `${Math.round(mockSecs / 60)}m`;

    boardingPassModal.classList.remove('hidden');
    statusDisplay.innerText = "Boarding Pass Generated. Clear for Departure.";
    statusDot.className = "status-dot active";
    startBtn.disabled = false;

    setupFlightVisuals(startPos, endPos);
    return;
  }

  // LIVE TELEMETRY API VECTOR (NATIVE AIRLABS MULTI-STAGE SYNC)
  try {
    if (!API_KEY) {
      statusDisplay.innerText = "Configuration Error: API Key missing in environment.";
      statusDot.className = "status-dot";
      return;
    }

    // Query radar for active current aircraft transponder positions
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

      // Query AirLabs specialized global database for arrival coordinates
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
      console.log(`📍 Target destination established natively: ${airportInfo.name} (${endPos})`);

      // MATHEMATICAL HAVERSINE MEASUREMENT FROM CURRENT GPS POSITION TO DEST
      const R = 6371;
      const dLat = (endPos[0] - startPos[0]) * Math.PI / 180;
      const dLon = (endPos[1] - startPos[1]) * Math.PI / 180;

      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(startPos[0] * Math.PI / 180) * Math.cos(endPos[0] * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = R * c;

      // Native Raw Speed utilization 
      const liveSpeedKmh = flight.speed && flight.speed > 50 ? Math.round(flight.speed) : 850;
      console.log(`📡 Metrics Calculated: ${Math.round(distanceKm)} km left | Speed: ${liveSpeedKmh} km/h`);

      // Convert timeline parameters 
      const hoursRemaining = distanceKm / liveSpeedKmh;
      totalDuration = Math.round(hoursRemaining * 3600);

      if (totalDuration <= 0) totalDuration = 60;
      timeRemaining = totalDuration;

      // Populate layout voucher text data nodes
      passFlightNum.innerText = flightNum;
      passDep.innerText = flight.dep_iata || "???";
      passArr.innerText = destinationAirport;
      passDuration.innerText = `${Math.round(totalDuration / 60)}m`;

      // Open popup ticket view modal
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

  // Dashed tracking path map layer
  flightPath = L.polyline([startCoords, endCoords], {
    color: '#38bdf8',
    weight: 2,
    dashArray: '6, 8'
  }).addTo(map);

  // Direction angle vector from A to B
  const initialHeading = calculateBearing(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);

  // CSS transformations
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
  // Capture the log BEFORE UI is wiped
  appendAbortedFlightToLogbook();

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  statusDisplay.innerText = "Session Interrupted by Flight Deck.";
  statusDot.className = "status-dot";
  boardingPassModal.classList.add('hidden');

  // Clean up Map if it exists
  if (flightPath) map.removeLayer(flightPath);
  if (planeMarker) map.removeLayer(planeMarker);

  if (typeof sessionTeardown === 'function') {
    sessionTeardown("Flight Aborted.");
  }
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

  // Real time bearing angle transformationsas path matrices change
  const currentHeading = calculateBearing(currentLat, currentLng, end.lat, end.lng);

  // Smooth reposition of coordinates 
  planeMarker.setLatLng([currentLat, currentLng]);

  // Dynamically update the inline heading rotation parameter within the DOM layer
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

  // Hide the close button before capture
  const closeBtn = document.querySelector('.modal-close-trigger');
  closeBtn.style.display = 'none';

  // Capture the element
  const canvas = await html2canvas(passElement, {
    backgroundColor: '#0f131a', 
    scale: 2, // High res
    logging: false
  });

  closeBtn.style.display = 'block';

  // Convert to image and download
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
    // Populate input field
    flightInput.value = sharedFlight.toUpperCase();
    searchBtn.click();
  }
}

// Fire dynamic parsing checks once map assets settle
setTimeout(parseSharedFlightURL, 500);

// --- VIEW ROUTING CONTROL SYSTEM ---
function loadLogbook() {
  const logs = JSON.parse(localStorage.getItem('v1_flight_logs')) || [];
  logbookRows.innerHTML = '';

  // Calculate Blackbox Telemetry Dashboard Archive Analytics
  let totalMinutes = 0;
  let longestFlightMinutes = 0;
  let successfulFlightsCount = 0;

  logs.forEach(log => {
    // Text parsers converting down to integer values
    const parsedMinutes = parseInt(log.duration) || 0;
    totalMinutes += parsedMinutes;

    if (parsedMinutes > longestFlightMinutes) {
      longestFlightMinutes = parsedMinutes;
    }

    if (log.status === "COMPLETED") {
      successfulFlightsCount++;
    }
  });

  // Calculate your OTP
  // To keep track of aborted runs, evaluate total logs vs completed logs.
  const totalFlightsLoggedCount = logs.length;
  const computedOtpPercent = totalFlightsLoggedCount > 0
    ? ((successfulFlightsCount / totalFlightsLoggedCount) * 100).toFixed(1)
    : "100.0";

  // Format outputs and render elements straight to telemetry digital dashboard glass display panels
  const totalHoursLoggedDisplay = (totalMinutes / 60).toFixed(1);
  statTotalAirtime.innerText = `${totalHoursLoggedDisplay} HRS`;
  statOtp.innerText = `${computedOtpPercent}%`;
  statLongestSector.innerText = longestFlightMinutes > 0 ? `${longestFlightMinutes} MIN` : `-- MIN`;

  // Table Rendering System 
  if (logs.length === 0) {
    logbookEmpty.classList.remove('hidden');
    return;
  }
  logbookEmpty.classList.add('hidden');

  logs.forEach(log => {
    const tr = document.createElement('tr');

    // Status color configurations token selection routing 
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

  // Scrape text tokens straight out of your live card elements
  const currentFlightLog = {
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    flightNum: passFlightNum.innerText || "POMO",
    dep: passDep.innerText || "BOM",
    arr: passArr.innerText || "GOX",
    seat: document.querySelector('.meta-value.text-accent')?.innerText?.split('/')[1]?.trim() || "1A",
    duration: passDuration.innerText || "30m"
  };

  logs.unshift(currentFlightLog); // New mission at top
  localStorage.setItem('v1_flight_logs', JSON.stringify(logs));
  loadLogbook();
}

// Function for aborted flights
function appendAbortedFlightToLogbook() {
  const logs = JSON.parse(localStorage.getItem('v1_flight_logs')) || [];

  const minutesElapsedSoFar = totalDuration && timeRemaining
    ? Math.round((totalDuration - timeRemaining) / 60)
    : 0;

  const currentFlightLog = {
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    flightNum: passFlightNum.innerText || "POMO",
    dep: passDep.innerText || "BOM",
    arr: passArr.innerText || "GOX",
    seat: document.querySelector('.meta-value.text-accent')?.innerText?.split('/')[1]?.trim() || "1A",
    duration: `${minutesElapsedSoFar}m`,
    status: "ABORTED" // Matches the structure
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
  navRadarBtn.classList.add('active-tab');

  // Trigger Leaflet viewport dimensions recalibration maps
  setTimeout(() => {
    if (map) {
      map.invalidateSize();
    }
  }, 150); // Increased timeout buffer slightly to accommodate mobile engine rendering cycles safely
}

// Global window resize listener to auto-recalculate map sizing
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
  logbookView.classList.remove('hidden-view'); // Open logbook view

  navHomeBtn.classList.remove('active-tab');
  navRadarBtn.classList.remove('active-tab');
  navLogbookBtn.classList.add('active-tab');

  loadLogbook(); // Refresh layout numbers
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

// Load records immediately upon compilation boot check
loadLogbook();