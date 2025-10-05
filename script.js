// Carrega NEOs do feed da NASA, popula select com distância e risco, permite animação/registro.
const STORAGE_KEY = 'neo_sim_feed_v1';
const API_FEED = 'https://api.nasa.gov/neo/rest/v1/feed';
const EARTH_RADIUS_KM = 6371;

const map = L.map('map').setView([5,0],2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);

// DOM
const apiKeyInput = document.getElementById('apiKey');
const fetchBtn = document.getElementById('fetchNeos');
const refreshBtn = document.getElementById('refresh');
const asteroidType = document.getElementById('asteroidType');
const diameter = document.getElementById('diameter');
const velocity = document.getElementById('velocity');
const density = document.getElementById('density');
const diameterNum = document.getElementById('diameterNum');
const velocityNum = document.getElementById('velocityNum');
const densityNum = document.getElementById('densityNum');
const logList = document.getElementById('logList');
const clearBtn = document.getElementById('clear');
const centerBtn = document.getElementById('center');
const help = document.getElementById('help');
const summary = document.getElementById('summary');

let neos = [], logs = [];
const effects = L.layerGroup().addTo(map);

// utilidades
function energyToReadable(J){
  const kt = J / 4.184e12;
  if(kt < 1) return `${Math.round(kt*1000)} t TNT`;
  if(kt < 1000) return `${kt.toFixed(1)} kT TNT`;
  return `${(kt/1000).toFixed(2)} MT TNT`;
}
function estimateImpact(d_m, v_kms, rho){
  const r = d_m/2;
  const volume = (4/3)*Math.PI*Math.pow(r,3);
  const mass = volume * rho;
  const v = v_kms * 1000;
  const energy = 0.5 * mass * v * v;
  const crater = Math.max(6, 1.8 * Math.pow(energy, 0.25));
  const depth = Math.max(1, crater / 5);
  const devastRadius = crater * 4;
  return { mass, energy, crater, depth, devastRadius };
}
function impactRiskCategory(miss_km, hazardous){
  if(miss_km == null) return {label:'Desconhecido', reason:'Distância desconhecida'};
  const rCount = miss_km / EARTH_RADIUS_KM;
  if(miss_km <= 0) return {label:'Impacto provável', reason:`Trajetória indica contato (≈ ${Math.round(miss_km)} km)`};
  if(miss_km < EARTH_RADIUS_KM) return {label:'Muito Alto', reason:`Passagem dentro do raio da Terra ≈ ${Math.round(miss_km)} km (${rCount.toFixed(2)} R⊕)`};
  if(hazardous && miss_km < 100000) return {label:'Alto', reason:`Marcado potencialmente perigoso; aproximação ≈ ${Math.round(miss_km)} km`};
  if(miss_km < 384400) return {label:'Moderado', reason:`Dentro da distância Lunar ≈ ${Math.round(miss_km)} km`};
  if(miss_km < 1e6) return {label:'Baixo', reason:`Distante ≈ ${Math.round(miss_km)} km`};
  return {label:'Muito baixo', reason:`Muito distante ≈ ${Math.round(miss_km)} km`};
}

// bindings
function bindRange(rangeEl, numEl){
  rangeEl.addEventListener('input', ()=> numEl.value = rangeEl.value);
  numEl.addEventListener('input', ()=> {
    let v = Number(numEl.value) || 0;
    if(rangeEl.min) v = Math.max(v, Number(rangeEl.min));
    if(rangeEl.max) v = Math.min(v, Number(rangeEl.max));
    rangeEl.value = v; numEl.value = v; asteroidType.value = 'custom';
  });
}
bindRange(diameter, diameterNum);
bindRange(velocity, velocityNum);
bindRange(density, densityNum);

function updateInputsState(){
  const editable = asteroidType.value === 'custom';
  [diameter, velocity, density, diameterNum, velocityNum, densityNum].forEach(el=> el.disabled = !editable);
  help.textContent = editable ? 'Modo PERSONALIZADO: edite valores.' : 'NEO selecionado aplica valores.';
}

// fetch feed da NASA
async function fetchNeosFromApi(){
  const key = (apiKeyInput.value || 'DEMO_KEY').trim();
  asteroidType.innerHTML = `<option>Carregando...</option>`;
  try{
    const res = await fetch(`${API_FEED}?api_key=${encodeURIComponent(key)}`);
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const raw = data.near_earth_objects || {};
    const list = [];
    Object.values(raw).forEach(arr => arr.forEach(obj => {
      // escolher close approach mais próxima (se houver múltiplas)
      const cadArr = obj.close_approach_data || [];
      let best = null;
      cadArr.forEach(c=> {
        const miss = c.miss_distance && c.miss_distance.kilometers ? Number(c.miss_distance.kilometers) : null;
        if(best === null || (miss !== null && best.miss === null) || (miss !== null && miss < best.miss)) best = {cad: c, miss};
      });
      const estDiam = obj.estimated_diameter && obj.estimated_diameter.meters
        ? ((obj.estimated_diameter.meters.estimated_diameter_min + obj.estimated_diameter.meters.estimated_diameter_max) / 2)
        : 50;
      const vel = best && best.cad && best.cad.relative_velocity ? Number(best.cad.relative_velocity.kilometers_per_second) : null;
      const miss_km = best ? best.miss : null;
      const hazardous = !!obj.is_potentially_hazardous_asteroid;
      list.push({
        id: obj.id, name: obj.name, estDiam: Math.round(estDiam),
        velocity: vel !== null ? Number(vel.toFixed(2)) : null,
        miss_km, hazardous, jpl: obj.nasa_jpl_url
      });
    }));
    // dedupe e ordenar
    const mapById = new Map(); list.forEach(n=> mapById.set(n.id,n));
    neos = Array.from(mapById.values()).sort((a,b)=>a.name.localeCompare(b.name));
    populateAsteroidSelect();
    summary.innerHTML = `<strong>Resumo</strong><div class="summary-line">Carregados ${neos.length} NEOs do feed.</div>`;
  }catch(err){
    console.error('Erro fetch NEOs:', err);
    asteroidType.innerHTML = `<option>Erro ao carregar (ver console)</option>`;
    summary.innerHTML = `<strong>Erro</strong><div class="summary-line">Falha ao carregar NEOs. Verifique API key/rede.</div>`;
  }
}

function populateAsteroidSelect(){
  asteroidType.innerHTML = '';
  const optCustom = document.createElement('option');
  optCustom.value = 'custom';
  optCustom.dataset.d = 50; optCustom.dataset.v = 20; optCustom.dataset.den = 3000;
  optCustom.textContent = 'Personalizado';
  asteroidType.appendChild(optCustom);

  neos.forEach(n=>{
    const o = document.createElement('option');
    o.value = n.id;
    const missText = n.miss_km !== null ? `${Math.round(n.miss_km)} km` : 'dist. desconhecida';
    const risk = impactRiskCategory(n.miss_km, n.hazardous);
    o.textContent = `${n.name} — Ø≈${n.estDiam} m • ${missText} • ${risk.label}`;
    o.dataset.d = n.estDiam;
    if(n.velocity !== null) o.dataset.v = n.velocity;
    o.dataset.den = 3000;
    if(n.miss_km !== null) o.dataset.miss = String(Math.round(n.miss_km));
    o.dataset.hazard = String(n.hazardous);
    o.dataset.jpl = n.jpl;
    asteroidType.appendChild(o);
  });
  asteroidType.value = 'custom';
  updateInputsState();
}

// handlers
fetchBtn.addEventListener('click', fetchNeosFromApi);
refreshBtn.addEventListener('click', fetchNeosFromApi);
asteroidType.addEventListener('change', e=>{
  const opt = e.target.selectedOptions[0];
  if(opt){
    const d = Number(opt.dataset.d) || Number(diameter.value);
    const v = Number(opt.dataset.v) || Number(velocity.value);
    const den = Number(opt.dataset.den) || Number(density.value);
    diameter.value = d; diameterNum.value = d;
    velocity.value = v; velocityNum.value = v;
    density.value = den; densityNum.value = den;
  }
  updateInputsState();
});

// logs persistentes
function saveLogs(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)); }catch{} }
function loadLogs(){ try{ const raw = localStorage.getItem(STORAGE_KEY); logs = raw ? JSON.parse(raw) : []; }catch{ logs=[]; } renderLogs(); }
function renderLogs(){
  logList.innerHTML = '';
  if(!logs.length){ logList.innerHTML = '<div class="log-item">Sem impactos ainda.</div>'; return; }
  logs.slice().reverse().forEach(item=>{
    const el = document.createElement('div'); el.className='log-item';
    el.innerHTML = `<strong>${item.riskLabel} • ${item.level}</strong> — ${new Date(item.time).toLocaleString()}<br/>
      ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)} — Cratera ≈ ${Math.round(item.crater)} m<br/>
      Energia: ${item.energyReadable}<br/>
      Aproximação (feed): ${item.miss_km !== null ? `${Math.round(item.miss_km)} km (${(item.miss_km/EARTH_RADIUS_KM).toFixed(2)} R⊕)` : 'Desconhecida'}<br/>
      Fonte: ${item.source || 'local'}`;
    logList.appendChild(el);
  });
}
function addLog(obj){ logs.push(obj); saveLogs(); renderLogs(); }

// animação (simples visual)
function animateFallAndExplode(destLatLng, est, meta){
  const startLat = destLatLng.lat + Math.min(30, Math.abs(destLatLng.lat) + 12);
  const startLng = destLatLng.lng;
  const steps = 80; let i=0;
  const fallIcon = L.divIcon({className:'meteor-icon'});
  const fallingMarker = L.marker([startLat,startLng], {icon:fallIcon, interactive:false}).addTo(effects);
  const fallInterval = setInterval(()=>{
    const t = ++i/steps;
    const lat = startLat + (destLatLng.lat - startLat) * t;
    const lng = startLng + (destLatLng.lng - startLng) * t;
    fallingMarker.setLatLng([lat,lng]);
    const puff = L.circleMarker([lat,lng], {radius:2, color:'rgba(200,80,30,0.6)', fillOpacity:0.6}).addTo(effects);
    setTimeout(()=> effects.removeLayer(puff), 400);
    if(i>=steps){
      clearInterval(fallInterval);
      effects.removeLayer(fallingMarker);
      const explosion = L.circle(destLatLng, {radius:10, color:'#ffb86b', weight:2, fillColor:'#ffb86b', fillOpacity:0.36}).addTo(effects);
      let ex=0, max=30;
      const exI = setInterval(()=>{
        ex++;
        const r = (est.devastRadius/2)*(ex/max);
        explosion.setRadius(r);
        explosion.setStyle({fillOpacity: Math.max(0.04, 0.36*(1-ex/max))});
        if(ex>=max){
          clearInterval(exI);
          effects.removeLayer(explosion);
          const devastated = L.circle(destLatLng, {radius: est.devastRadius, color:'#9b1c1c', weight:2, fillColor:'#9b1c1c', fillOpacity:0.18}).addTo(effects);
          const entry = {
            time: Date.now(),
            lat: destLatLng.lat, lng: destLatLng.lng,
            type: meta.type,
            crater: est.crater,
            energyReadable: meta.energyReadable,
            level: meta.level,
            miss_km: meta.miss_km !== undefined ? meta.miss_km : null,
            riskLabel: meta.riskLabel,
            riskReason: meta.riskReason,
            source: meta.source || 'feed'
          };
          addLog(entry);
          summary.innerHTML = `<strong>Impacto concluído</strong><div class="summary-line">Cratera ≈ ${Math.round(est.crater)} m — Energia: ${meta.energyReadable}<br/>Risco: ${meta.riskLabel} — ${meta.riskReason}</div>`;
        }
      },30);
    }
  },25);
}

// clique no mapa -> popup com distância e risco (dados do feed se selecionado)
map.on('click', e=>{
  const d = Number(diameter.value), v = Number(velocity.value), den = Number(density.value);
  const est = estimateImpact(d,v,den);
  const energyReadable = energyToReadable(est.energy);
  const opt = asteroidType.selectedOptions[0];
  const miss_km = opt && opt.dataset && opt.dataset.miss ? Number(opt.dataset.miss) : null;
  const hazardousFlag = opt && opt.dataset && opt.dataset.hazard ? (opt.dataset.hazard === 'true') : false;
  const risk = impactRiskCategory(miss_km, hazardousFlag);

  const container = document.createElement('div'); container.className='impact-popup';
  const info = document.createElement('div'); info.style.fontSize='13px';
  const missText = miss_km !== null ? `${Math.round(miss_km)} km (${(miss_km/EARTH_RADIUS_KM).toFixed(2)} R⊕)` : 'Desconhecida';
  info.innerHTML = `<strong>${opt ? opt.textContent : 'Personalizado'}</strong><br/>${d} m • ${v} km/s<br/>Cratera ≈ ${Math.round(est.crater)} m • Energia: ${energyReadable}<br/>Aproximação: ${missText}<br/>Risco: ${risk.label}`;
  const row = document.createElement('div'); row.className='row';
  const btnDetails = document.createElement('button'); btnDetails.className='impact-btn'; btnDetails.textContent='Detalhes';
  const btnLaunch = document.createElement('button'); btnLaunch.className='launch-btn'; btnLaunch.textContent='Lançar Meteoro';
  row.appendChild(btnDetails); row.appendChild(btnLaunch);
  container.appendChild(info); container.appendChild(row);
  L.popup({maxWidth:420}).setLatLng(e.latlng).setContent(container).openOn(map);

  btnDetails.addEventListener('click', ()=>{
    const dmg = impactRiskCategory(miss_km, hazardousFlag);
    summary.innerHTML = `<strong>Detalhes do impacto</strong>
      <table class="detail-table">
        <tr><td>Energia</td><td>${est.energy.toExponential(3)} J (${energyReadable})</td></tr>
        <tr><td>Diâmetro cratera</td><td>${Math.round(est.crater)} m</td></tr>
        <tr><td>Profundidade</td><td>${Math.round(est.depth)} m</td></tr>
        <tr><td>Área devastada (visual)</td><td>${Math.round(est.devastRadius)} m</td></tr>
        <tr><td>Aproximação (feed)</td><td>${missText}</td></tr>
        <tr><td>Flag NASA</td><td>${hazardousFlag ? 'Sim' : 'Não'}</td></tr>
        <tr><td>Risco de colisão (simples)</td><td>${dmg.label} — ${dmg.reason}</td></tr>
      </table>`;
  });

  btnLaunch.addEventListener('click', ()=>{
    map.closePopup();
    const dmg = impactRiskCategory(miss_km, hazardousFlag);
    const meta = { type: asteroidType.selectedOptions[0] ? asteroidType.selectedOptions[0].text : 'Personalizado', energyReadable, level: dmg.label, miss_km, riskLabel: dmg.label, riskReason: dmg.reason, source: 'feed' };
    animateFallAndExplode(e.latlng, est, meta);
    summary.innerHTML = `<strong>Impacto em andamento</strong><div class="summary-line">Lançando meteoro... Aguarde animação.</div>`;
  });
});

// limpar/centralizar/iniciar
clearBtn.addEventListener('click', ()=>{ effects.clearLayers(); logs=[]; try{ localStorage.removeItem(STORAGE_KEY); }catch{} renderLogs(); summary.innerHTML = `<strong>Resumo</strong><div class="summary-line">Sem eventos.</div>`; });
centerBtn.addEventListener('click', ()=> map.setView([5,0],2));

loadLogs();
updateInputsState();