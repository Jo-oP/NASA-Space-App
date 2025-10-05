// STORAGE
const STORAGE_KEY = 'meteor_sim_detailed_v1';

// mapa
const map = L.map('map').setView([0,0],2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);

// DOM
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

let logs = [];
const effects = L.layerGroup().addTo(map);
let lastClickLatLng = null;

// util legíveis
function energyToReadable(J){
  const kt = J / 4.184e12;
  if(kt < 0.001) return `${(kt*1e6).toFixed(0)} gT TNT`;
  if(kt < 1) return `${(kt*1000).toFixed(0)} t TNT`;
  if(kt < 1000) return `${kt.toFixed(1)} kT TNT`;
  return `${(kt/1000).toFixed(2)} MT TNT`;
}
function damageLevel(energy, crater){
  if(energy < 1e12 && crater < 50) return {label:'Baixo', text:'Danos locais: feridos, janelas quebradas', severity: 'ok'};
  if(energy < 1e14 || crater < 500) return {label:'Médio', text:'Danos regionais: edifícios danificados, incêndios', severity: 'warn'};
  return {label:'Alto', text:'Danos extensos: cidades em risco, impacto sério', severity: 'danger'};
}

// física simples
function estimateImpact(d_m, v_kms, rho){
  const r = d_m/2;
  const volume = (4/3)*Math.PI*Math.pow(r,3);
  const mass = volume * rho;
  const v = v_kms * 1000;
  const energy = 0.5 * mass * v * v;
  const crater = Math.max(6, 1.8 * Math.pow(energy, 0.25)); // m
  const depth = Math.max(1, crater / 5);
  // devastação: múltiplo do raio da cratera (apenas visual/educacional)
  const devastRadius = crater * 4; // metros
  return {mass, energy, crater, depth, devastRadius};
}

// sincronizar inputs
function bindRange(rangeEl, numEl){
  rangeEl.addEventListener('input', ()=> numEl.value = rangeEl.value);
  numEl.addEventListener('input', ()=> {
    let v = Number(numEl.value) || 0;
    if(rangeEl.min) v = Math.max(v, Number(rangeEl.min));
    if(rangeEl.max) v = Math.min(v, Number(rangeEl.max));
    rangeEl.value = v; numEl.value = v;
    asteroidType.value = 'custom';
  });
}
bindRange(diameter, diameterNum);
bindRange(velocity, velocityNum);
bindRange(density, densityNum);

// aplicar tipo
function applyValuesFromOption(opt){
  const d = Number(opt.dataset.d) || Number(diameter.value);
  const v = Number(opt.dataset.v) || Number(velocity.value);
  const den = Number(opt.dataset.den) || Number(density.value);
  diameter.value = d; diameterNum.value = d;
  velocity.value = v; velocityNum.value = v;
  density.value = den; densityNum.value = den;
  updateInputsState();

  // mostrar informação adicional quando opção vier da NASA
  const miss = opt.dataset.miss ? Number(opt.dataset.miss) : null;
  const hazard = opt.dataset.hazard === 'true';
  if(miss){
    help.textContent = `Distância de aproximação ≈ ${Math.round(miss).toLocaleString()} km — ${hazard ? 'Potencialmente perigoso' : 'Sem risco significativo'}`;
  } else {
    help.textContent = asteroidType.value === 'custom' ? 'Modo PERSONALIZADO: edite valores.' : 'Dados do objeto sem aproximação disponível.';
  }
}
function updateInputsState(){
  const editable = asteroidType.value === 'custom';
  [diameter, velocity, density, diameterNum, velocityNum, densityNum].forEach(el => el.disabled = !editable);
  if(editable) help.textContent = 'Modo PERSONALIZADO: edite valores.';
}
asteroidType.addEventListener('change', e => { applyValuesFromOption(e.target.selectedOptions[0]); });

// --- NOVO: carregar NEOs da API da NASA e popular select ---
async function loadNasaNeos(){
  const API = 'https://api.nasa.gov/neo/rest/v1/feed?api_key=DEMO_KEY';
  try{
    const res = await fetch(API);
    const data = await res.json();
    const objs = [];
    Object.values(data.near_earth_objects || {}).forEach(arr => {
      arr.forEach(n => {
        const ca = (n.close_approach_data && n.close_approach_data[0]) || null;
        const estDia = (n.estimated_diameter && n.estimated_diameter.meters)
          ? (n.estimated_diameter.meters.estimated_diameter_min + n.estimated_diameter.meters.estimated_diameter_max) / 2
          : 50;
        const v = ca ? Number(ca.relative_velocity.kilometers_per_second) : 20;
        const miss = ca ? Number(ca.miss_distance.kilometers) : null;
        const hazard = !!n.is_potentially_hazardous_asteroid;
        objs.push({id: n.id, name: n.name, estDia, v, miss, hazard});
      });
    });
    // dedupe por id
    const seen = new Set();
    const unique = objs.filter(o => { if(seen.has(o.id)) return false; seen.add(o.id); return true; });

    // manter a opção "custom" no topo
    const customOpt = asteroidType.querySelector('option[value="custom"]');
    asteroidType.innerHTML = '';
    if(customOpt) asteroidType.appendChild(customOpt);

    unique.slice(0,80).forEach(o => {
      const opt = document.createElement('option');
      opt.value = `neo-${o.id}`;
      opt.textContent = `${o.name} — ${o.miss ? Math.round(o.miss).toLocaleString() + ' km' : 'dist. desconhecida'} — ${o.hazard ? 'Risco' : 'Seguro'}`;
      opt.dataset.d = Math.round(o.estDia);
      opt.dataset.v = Number(o.v).toFixed(2);
      opt.dataset.den = o.hazard ? 3000 : 2500; // heurística para densidade
      if(o.miss) opt.dataset.miss = Math.round(o.miss);
      opt.dataset.hazard = o.hazard;
      asteroidType.appendChild(opt);
    });

    // manter seleção inicial em custom
    applyValuesFromOption(asteroidType.selectedOptions[0]);
  }catch(err){
    console.error('Falha ao carregar NEOs da NASA', err);
    help.textContent = 'Não foi possível carregar NEOs da NASA. Usando valores locais.';
  }
}
// --- fim do novo ---

// logs
function saveLogs(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)); }catch{} }
function loadLogs(){ try{ const raw = localStorage.getItem(STORAGE_KEY); logs = raw ? JSON.parse(raw) : []; }catch{ logs=[];} renderLogs(); }
function renderLogs(){
  logList.innerHTML = '';
  if(!logs.length){ logList.innerHTML = '<div class="log-item">Sem impactos ainda.</div>'; return; }
  logs.slice().reverse().forEach(item=>{
    const el = document.createElement('div'); el.className='log-item';
    el.innerHTML = `<strong>${item.level}</strong> — ${new Date(item.time).toLocaleString()}<br/>
      ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)} • Cratera ≈ ${Math.round(item.crater)} m<br/>
      Energia: ${item.energyReadable}<br/>Tipo: ${item.type}`;
    logList.appendChild(el);
  });
}
function addLog(obj){ logs.push(obj); saveLogs(); renderLogs(); }

// animação de queda e explosão
function animateFallAndExplode(destLatLng, est, meta){
  // inicio muito ao norte para visual (10°)
  const startLat = destLatLng.lat + Math.min(30, Math.abs(destLatLng.lat) + 10);
  const startLng = destLatLng.lng;
  const steps = 80;
  let i = 0;
  const fallIcon = L.divIcon({className:'meteor-icon'});
  const fallingMarker = L.marker([startLat, startLng], {icon:fallIcon, interactive:false}).addTo(effects);

  const fallInterval = setInterval(()=>{
    const t = ++i / steps;
    const lat = startLat + (destLatLng.lat - startLat) * t;
    const lng = startLng + (destLatLng.lng - startLng) * t;
    fallingMarker.setLatLng([lat,lng]);
    // trail
    const puff = L.circleMarker([lat,lng], {radius:2, color:'rgba(200,80,30,0.6)', fillOpacity:0.6}).addTo(effects);
    setTimeout(()=> effects.removeLayer(puff), 400);
    if(i >= steps){
      clearInterval(fallInterval);
      effects.removeLayer(fallingMarker);
      // explosão animada: expand circle então devastação
      const explosion = L.circle(destLatLng, {radius:10, color:'#ffb86b', weight:2, fillColor:'#ffb86b', fillOpacity:0.35}).addTo(effects);
      let exStep = 0, exMax = 30;
      const exInterval = setInterval(()=>{
        exStep++;
        const r = (est.devastRadius / 2) * (exStep / exMax);
        explosion.setRadius(r);
        explosion.setStyle({fillOpacity: Math.max(0.05, 0.35 * (1 - exStep/exMax))});
        if(exStep >= exMax){
          clearInterval(exInterval);
          // remover explosão temporária e desenhar a região devastada
          effects.removeLayer(explosion);
          const devastated = L.circle(destLatLng, {radius: est.devastRadius, color:'#b91c1c', weight:2, fillColor:'#b91c1c', fillOpacity:0.18}).addTo(effects);
          // persiste desastre em logs (meta passed)
          const entry = {
            time: Date.now(),
            lat: destLatLng.lat,
            lng: destLatLng.lng,
            type: meta.type,
            crater: est.crater,
            energyReadable: meta.energyReadable,
            level: meta.level
          };
          addLog({ ...entry, energyReadable: meta.energyReadable, level: meta.level });
        }
      }, 30);
    }
  }, 25);
}

// quando clicar no mapa, mostrar popup com opção detalhar e lançar
map.on('click', e => {
  lastClickLatLng = e.latlng;
  const d = Number(diameter.value), v = Number(velocity.value), den = Number(density.value);
  const est = estimateImpact(d, v, den);
  const energyReadable = energyToReadable(est.energy);
  const dmg = damageLevel(est.energy, est.crater);
  // criar popup com botões
  const container = document.createElement('div');
  container.className = 'impact-popup';
  const info = document.createElement('div'); info.style.fontSize='13px';

  // tentar obter dados NASA da opção selecionada
  const sel = asteroidType.selectedOptions[0];
  const miss = sel.dataset.miss ? Number(sel.dataset.miss) : null;
  const hazard = sel.dataset.hazard === 'true';
  const missText = miss ? `${Math.round(miss).toLocaleString()} km` : 'dist. desconhecida';
  info.innerHTML = `<strong>${sel.textContent}</strong><br/>${d} m • ${v} km/s<br/>Cratera ≈ ${Math.round(est.crater)} m • Energia: ${energyReadable}<br/>Aproximação: ${missText} • ${hazard ? 'Potencialmente perigoso' : 'Sem risco'}`;

  const btnDetails = document.createElement('button'); btnDetails.className='impact-btn'; btnDetails.textContent='Ver detalhes';
  const btnLaunch = document.createElement('button'); btnLaunch.className='launch-btn'; btnLaunch.textContent='Lançar Meteoro';
  container.appendChild(info); container.appendChild(btnDetails); container.appendChild(btnLaunch);

  const popup = L.popup({maxWidth:420}).setLatLng(e.latlng).setContent(container).openOn(map);

  btnDetails.addEventListener('click', () => {
    // preencher painel summary com dados detalhados
    summary.innerHTML = `<strong>Detalhes do impacto</strong>
      <table class="detail-table">
        <tr><td>Massa estimada</td><td>${(est.mass/1e6).toFixed(2)} x10^6 kg</td></tr>
        <tr><td>Energia</td><td>${est.energy.toExponential(3)} J (${energyReadable})</td></tr>
        <tr><td>Diâmetro da cratera</td><td>${Math.round(est.crater)} m</td></tr>
        <tr><td>Profundidade aproximada</td><td>${Math.round(est.depth)} m</td></tr>
        <tr><td>Raio da área devastada (visual)</td><td>${Math.round(est.devastRadius)} m</td></tr>
        <tr><td>Nível de dano</td><td>${dmg.label} — ${dmg.text}</td></tr>
        <tr><td>Aproximação</td><td>${miss ? Math.round(miss).toLocaleString() + ' km' : 'desconhecida'}</td></tr>
        <tr><td>Risco de colisão</td><td>${hazard ? 'Potencialmente perigoso' : 'Sem risco significativo'}</td></tr>
      </table>
      <div class="summary-line">Para ver a destruição no mapa, clique em "Lançar Meteoro".</div>`;
  });

  btnLaunch.addEventListener('click', () => {
    map.closePopup();
    // animação e zona devastada
    const meta = { type: asteroidType.selectedOptions[0].text, energyReadable, level: dmg.label };
    animateFallAndExplode(e.latlng, est, meta);
    // atualizar resumo imediatamente
    summary.innerHTML = `<strong>Impacto em andamento</strong><div class="summary-line">Lançando meteoro... Aguarde animação.</div>`;
  });
});

// limpar e centralizar
clearBtn.addEventListener('click', ()=>{ effects.clearLayers(); logs=[]; try{ localStorage.removeItem(STORAGE_KEY); }catch{} renderLogs(); });
centerBtn.addEventListener('click', ()=> map.setView([0,0],2));

// inicializar
applyValuesFromOption(asteroidType.selectedOptions[0]);
updateInputsState();
loadLogs();
loadNasaNeos();