/* 
   Yemen Geo-Demography Dashboard
   - Leaflet + Chart.js
   - UN/ESCWA style hooks in style.css
 */

const GEO_URL = "data/yemen_adm3_population.geojson";
const TS_URL  = "data/adm3_timeseries.json";
const CSV_URL = "data/adm3_population_timeseries.csv";
let SELECTED_YEAR = 2030;
let LAST_FEATURE = null;

// ---- globals ----
let map, admLayer, TS = {};
let q20=0, q40=0, q60=0, q80=0;
let pyramidChart, timeseriesChart;

//  Column order in CSV/JSON
const BUCKET_ORDER = [
  "pre_school",
  "school_age",
  "university_age",
  "working_age",
  "retirement_age",
  "eighty_plus",
];

const LABELS_ZH = {
  pre_school: "Pre-school (0–4)",
  school_age: "School age (5–14)",
  university_age: "University (15–24)",
  working_age: "Working (25–59)",
  retirement_age: "Retirement (60–79)",
  eighty_plus: "80+",
};

function fmt(n){ 
  if(n === null || n === undefined || isNaN(n)) return "0";
  return (+n).toLocaleString("en-US");
}
function pct(x){ return (x*100).toFixed(0) + "%"; }

// choropleth color ramp
function getColor(d){
  return d > q80 ? '#084081' :
         d > q60 ? '#0868ac' :
         d > q40 ? '#2b8cbe' :
         d > q20 ? '#4eb3d3' : '#7bccc4';
}

// initialize map
function initMap(){
  map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12,
    minZoom: 4,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

// render legend + quantiles
function renderLegend(values){
  const vals = values.filter(v => v>0).sort((a,b)=>a-b);
  const pick = p => vals[Math.floor(p*vals.length)] || 0;
  q20=pick(0.2); q40=pick(0.4); q60=pick(0.6); q80=pick(0.8);

  const scale = document.getElementById("legend-scale");
  scale.innerHTML = "";
  const stops = [q20, q40, q60, q80, vals.at(-1) || 0];
  const swatches = [
    {c:getColor(q20-1), t:`≤ ${fmt(q20)}`},
    {c:getColor((q20+q40)/2), t:`${fmt(q20+1)}–${fmt(q40)}`},
    {c:getColor((q40+q60)/2), t:`${fmt(q40+1)}–${fmt(q60)}`},
    {c:getColor((q60+q80)/2), t:`${fmt(q60+1)}–${fmt(q80)}`},
    {c:getColor(q80+1), t:`≥ ${fmt(q80)}`}
  ];
  swatches.forEach(s=>{
    const el = document.createElement("span");
    el.className = "swatch";
    el.title = s.t;
    el.style.background = s.c;
    scale.appendChild(el);
  });
  document.getElementById("legend").style.display = "block";
}

// fetch data + build layers
async function loadData(){

  const [geo, ts] = await Promise.all([
    fetch(GEO_URL).then(r => r.json()),
    fetch(TS_URL).then(r => r.json())
  ]);
  TS = ts; // store global time series

  // 1) initial density values for quantiles
  const densities = geo.features.map(f => f.properties?.density || 0);
  renderLegend(densities);

  // 2) admin layer
  admLayer = L.geoJSON(geo, {
    style: f => ({
      fillColor: getColor(f.properties?.density || 0),
      color: '#2f3b52', weight: 0.6,
      fillOpacity: 0.75
    }),
    onEachFeature: (f, layer) => {
      layer.on({
        mouseover: e => e.target.setStyle({weight: 2}),
        mouseout:  e => admLayer.resetStyle(e.target),
        click:     e => onSelect(f, layer)
      });
      // tooltip
      const name = f.properties.ADM3_EN || f.properties.adm3_en || f.properties.ADM3_PCODE;
      const dens = f.properties.density;
      layer.bindTooltip(
        `<div class="tooltip"><strong>${name}</strong><br/>Density: ${fmt(dens)} /km²</div>`,
        {sticky:true, direction:'top'}
      );
    }
  }).addTo(map);

  // 3) fit map to bounds
  map.fitBounds(admLayer.getBounds());

  // 4) select first feature as default
  const first = geo.features[0];
  if (first){ 
    LAST_FEATURE = first;
    onSelect(first, null, true);
  }

  // 5) year selector
  const yearSel = document.getElementById('year-select');
  yearSel.value = String(SELECTED_YEAR);
  yearSel.addEventListener('change', ()=>{
    SELECTED_YEAR = +yearSel.value;
    restyleMapForYear(SELECTED_YEAR);
    // refresh right panel for current selection
    if (LAST_FEATURE) onSelect(LAST_FEATURE, null, true);
  });

  // 6) initial restyle by year
  restyleMapForYear(SELECTED_YEAR);
}

// handle click → update charts & insight
function onSelect(feature, layer, silent=false){
  LAST_FEATURE = feature;
  const props = feature.properties || {};
  const pcode = props.ADM3_PCODE || props.adm3_pcode || props.ADM3_EN;
  const name  = props.ADM3_EN || props.adm3_en || pcode;

  const series = TS[pcode] || [];
  if(!series.length){ return; }

  // pick record for selected year; fallback to latest
  let rec = series.find(s => +s.year === +SELECTED_YEAR);
  if(!rec) rec = series.at(-1);

  // pyramid (percent)
  const pyramidValues = [
    rec.pre_school, rec.school_age, rec.university_age,
    rec.working_age, rec.retirement_age, rec.eighty_plus
  ];
  updatePyramidChart({
    labels: BUCKET_ORDER.map(k => LABELS_ZH[k]),
    values: pyramidValues,
    title: `${name} — ${rec.year}`
  });

  // time series (total population)
  updateTimeseriesChart({
    labels: series.map(s => s.year),
    values: series.map(s => s.total || 0),
    title: `${name} — Total Population`
  });

  // AI insight from first year to selected year (fallback to first if missing)
  setInsight(makeInsightAI(series, name, SELECTED_YEAR));

  // focus map to selected feature
  if(!silent && layer){
    map.fitBounds(layer.getBounds(), { maxZoom: 9, padding:[20,20] });
  }
}

// ---------- AI-Enhanced Insight (Detailed + Secondary Signals) ----------
function makeInsightAI(series, name, targetYear){
  if (!series.length) return `No data available for ${name}.`;

  const first = series[0];
  const last  = series.find(s => +s.year === +targetYear) || series.at(-1);

  // core metrics
  const youth0 = first.pre_school + first.school_age + first.university_age;
  const youth1 = last.pre_school  + last.school_age  + last.university_age;
  const work0  = first.working_age, work1 = last.working_age;
  const old0   = first.retirement_age + first.eighty_plus;
  const old1   = last.retirement_age  + last.eighty_plus;

  const t0 = Math.max(first.total || 1, 1);
  const t1 = Math.max(last.total  || 1, 1);

  const py = youth1 / t1;           // under 25
  const pw = work1  / t1;           // 25–59
  const po = old1   / t1;           // 60+
  const gy = (youth1 - youth0) / Math.max(youth0, 1);
  const go = (old1   - old0)   / Math.max(old0,   1);
  const gt = (t1 - t0) / t0;        // total population change

  // indices/categories
  const YI = py * (1 + gy);         // youth potential
  const AI = po * (1 + go);         // aging pressure
  const LI = pw;                    // labor advantage

  let category = "Labor Advantage";
  if (AI > YI && AI > LI) category = "Aging Pressure";
  else if (YI > AI && YI > LI) category = "Youth Potential";

  // secondary signals
  const notes = [];
  if (pw < 0.55) notes.push("limited working-age base (below 55%), absorption capacity may be constrained");
  if (po < 0.12 && go > 0.25) notes.push("early signs of aging (fast growth from a low base), plan long-term elderly care");
  if (py > 0.38 || gy > 0.20) notes.push("strong youth momentum requiring scaled education, TVET and entry-level jobs");
  if (gt < -0.05) notes.push("population contraction since " + first.year + ", protect essential services and productivity");
  if (gt > 0.10)  notes.push("rapid population increase, expand service capacity and infrastructure");

  // text templates
  const pct = n => (n*100).toFixed(1) + "%";
  const chg = n => (n*100).toFixed(1) + "%";
  const since = first.year;

  let head = "";
  if (category === "Youth Potential") {
    const pace = gy > 0.30 ? "rapidly expanding" : gy > 0.15 ? "steadily growing" : "stable";
    head = `${name}: Youth Potential — ${pace} youth share (${pct(py)} under 25, +${chg(gy)} since ${since}).`;
  } else if (category === "Aging Pressure") {
    const sev = go > 0.50 ? "rapidly" : go > 0.30 ? "significantly" : "gradually";
    head = `${name}: Aging Pressure — ${sev} rising elderly share (${pct(po)} aged 60+, +${chg(go)} since ${since}).`;
  } else {
    head = `${name}: Labor Advantage — large working-age base (${pct(pw)} aged 25–59).`;
  }

  // policy body (by category)
  let body = "";
  if (category === "Youth Potential") {
    body = "Priorities: expand quality schooling, digital & vocational skills; stimulate youth employment and entrepreneurship; align private-sector demand with training curricula.";
    if (pw < 0.55) body += " Build near-term absorption capacity in labor markets to avoid future NEET pressure.";
  } else if (category === "Aging Pressure") {
    body = "Priorities: scale primary healthcare and geriatric services; strengthen pensions and social protection; promote active aging and inter-generational support; foster age-friendly infrastructure.";
  } else { // Labor Advantage
    body = "Priorities: deepen job creation via SMEs and local value chains; boost female labor-force participation; invest in productivity and continuous upskilling to sustain the dividend.";
  }

  // append secondary signals
  let tail = "";
  if (notes.length){
    tail = " Secondary signals: " + notes.join("; ") + ".";
  }

  const msg = `${head} ${body}${tail}`;
  return msg.replace(/\s+/g, ' ').trim();
}

function setInsight(text){
  const el = document.getElementById("insight");
  el.textContent = text;

  // left colored bar by category
  const card = el.closest('.insight');
  if (!card) return;
  card.style.borderLeft = "6px solid transparent";
  const lower = text.toLowerCase();
  if (lower.includes("youth potential"))      card.style.borderLeft = "6px solid #4f83cc"; // blue
  else if (lower.includes("aging pressure"))  card.style.borderLeft = "6px solid #f28c38"; // orange
  else if (lower.includes("labor advantage")) card.style.borderLeft = "6px solid #49a078"; // green
}

// ---------- Chart.js ----------

// population pyramid (horizontal bars)
function makePyramidConfig(labels, values, title){
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Population',
        data: values,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,   // let it fill CSS-defined height
      animation: false,
      plugins: {
        title: { display: true, text: title, font: { size: 12 } },
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx)=> ctx.formattedValue } }
      },
      layout: { padding: { left: 6, right: 6, top: 4, bottom: 2 } },
      indexAxis: 'y',
      scales: {
        x: {
          min: 0, max: 100,                // 0–100% fixed
          grid: { display: false },
          ticks: { callback: v => v + '%', maxTicksLimit: 6 }
        },
        y: {
          grid: { display: false },
          ticks: { autoSkip: false, font: { size: 11 } }
        }
      }
    }
  }
}

function makeTimeseriesConfig(labels, values, title){
  return {
    type: 'line',
    data: { labels, datasets: [{ label: 'Total', data: values }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: title },
        legend: { display: false }
      },
      scales: {
        y: { ticks: { callback: (v)=> fmt(v) } }
      },
      elements: { point: { radius: 3 } }
    }
  };
}

function updatePyramidChart(payload){
  const canvas = document.getElementById("pyramidChart");
  if(!pyramidChart){
    pyramidChart = new Chart(canvas.getContext('2d'), makePyramidConfig([], [], "Population Pyramid"));
  }
  if(!payload){ pyramidChart.data.labels=[]; pyramidChart.data.datasets[0].data=[]; pyramidChart.update(); return; }
  // convert to percent
  const total = (payload.values || []).reduce((a,b)=>a+(+b||0), 0) || 1;
  const pctVals = payload.values.map(v => (v/total)*100);

  pyramidChart.data.labels = payload.labels;
  pyramidChart.data.datasets[0].data = pctVals;
  pyramidChart.options.plugins.title.text = payload.title + " — % of total";
  pyramidChart.options.scales.x = {
    min: 0, max: 100,
    ticks: { callback: v => v + "%" }
  };
  pyramidChart.options.plugins.tooltip = {
    callbacks: {
      label: (ctx) => {
        const pct = ctx.parsed.x ?? ctx.parsed.y;
        const idx = ctx.dataIndex;
        const abs = payload.values[idx] || 0;
        return `${pct.toFixed(1)}%  (${abs.toLocaleString("en-US")})`;
      }
    }
  };
  pyramidChart.update();
}

function niceMax(v){
  const m = Math.max(1, ...v);
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  return Math.ceil(m / p) * p;  // round up to a nice tick (1/2/5/10/…)
}

function updateTimeseriesChart(payload){
  const canvas = document.getElementById("timeseriesChart");
  if(!timeseriesChart){
    timeseriesChart = new Chart(canvas.getContext('2d'), makeTimeseriesConfig([], [], "Total Population"));
  }

  if(!payload){
    timeseriesChart.data.labels = [];
    timeseriesChart.data.datasets[0].data = [];
    timeseriesChart.update();
    return;
  }

  timeseriesChart.data.labels = payload.labels;
  timeseriesChart.data.datasets[0].data = payload.values;
  timeseriesChart.options.plugins.title.text = payload.title;

  // constrain Y range and compute a pleasant upper bound
  timeseriesChart.options.scales.y = {
    suggestedMin: 0,
    suggestedMax: niceMax(payload.values),
    grid: { display: false },
    ticks: { callback: v => (+v).toLocaleString('en-US') }
  };

  // layout & animation tweaks
  timeseriesChart.options.maintainAspectRatio = false;
  timeseriesChart.options.animation = false;
  timeseriesChart.options.layout = { padding: { left: 6, right: 6, top: 4, bottom: 2 } };

  timeseriesChart.update();
}

// ---------- UI: Tabs & Export ----------
function initTabs(){
  const tabPyr = document.getElementById("tab-pyr");
  const tabTs  = document.getElementById("tab-ts");
  const pyrCvs = document.getElementById("pyramidChart");
  const tsCvs  = document.getElementById("timeseriesChart");

  tabPyr.addEventListener("click", ()=>{
    tabPyr.classList.add("is-active");
    tabTs.classList.remove("is-active");
    pyrCvs.style.display = "block";
    tsCvs.style.display  = "none";
  });
  tabTs.addEventListener("click", ()=>{
    tabTs.classList.add("is-active");
    tabPyr.classList.remove("is-active");
    pyrCvs.style.display = "none";
    tsCvs.style.display  = "block";
  });
}

function initExport(){
  const btn = document.getElementById("btn-export");
  if(!btn) return;
  btn.addEventListener("click", ()=>{
    const a = document.createElement("a");
    a.href = CSV_URL;
    a.download = "adm3_population_timeseries.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", async ()=>{
  initMap();
  initTabs();
  initExport();
  await loadData();
});

function restyleMapForYear(year){
  // 1) compute densities for the selected year (for quantiles)
  const densities = [];
  admLayer.eachLayer(layer=>{
    const f = layer.feature;
    const props = f.properties || {};
    const pcode = props.ADM3_PCODE || props.adm3_pcode || props.ADM3_EN;
    const area = props.area_km2 || props.area || null;

    let total = 0;
    const series = TS[pcode] || [];
    const rec = series.find(s => +s.year === +year);
    if(rec) total = rec.total || 0;

    const density = (area && area>0) ? (total / area) : 0;
    // store on feature for later style updates
    f.properties._density_current = density;
    densities.push(density);
  });

  // 2) recompute legend thresholds
  renderLegend(densities);

  // 3) update fill color for each feature
  admLayer.eachLayer(layer=>{
    const d = layer.feature.properties._density_current || 0;
    layer.setStyle({
      fillColor: getColor(d),
      color: '#2f3b52', weight: 0.6, fillOpacity: 0.75
    });
  });
}
