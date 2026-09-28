const SM_API = "https://weekly-range-api.changowalu.workers.dev/smart-money";

const SM_UNIVERSE = [
  "AAPL","NVDA","AMZN","GOOGL","META","AVGO","TSLA","AMD","NFLX","ORCL","CRM","ADBE","CSCO","QCOM","MU","AMAT",
  "JPM","BAC","WFC","GS","V","MA","PYPL","COF","AXP","HOOD","LLY","UNH","JNJ","ABBV","MRK","PFE",
  "TMO","ABT","WMT","COST","HD","LOW","MCD","NKE","KO","PEP","XOM","CVX","COP","SLB","CAT","DE",
  "GE","HON","BA","RTX","UBER","PLTR","PANW","CRWD","NOW","SHOP","SPY","QQQ","IWM","DIA","XLF","XLK"
];

function smEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function smBadge(value) {
  const text=String(value||"NEUTRAL").toUpperCase();
  let cls="yellow";
  if(text.includes("BUY")||text.includes("UP")||text.includes("CALL")||text.includes("HOLDING"))cls="green";
  if(text.includes("SELL")||text.includes("DOWN")||text.includes("PUT"))cls="red";
  return `<span class="${cls}"><b>${smEscape(text)}</b></span>`;
}
function smMoney(value){const n=Number(value)||0;if(n>=1e9)return "$"+(n/1e9).toFixed(2)+"B";if(n>=1e6)return "$"+(n/1e6).toFixed(2)+"M";if(n>=1e3)return "$"+(n/1e3).toFixed(1)+"K";return "$"+n.toFixed(0)}

function smRenderSummary(data){
  const host=document.getElementById("smRows")?.closest(".panel");
  if(!host)return;
  let box=document.getElementById("smSummary");
  if(!box){
    box=document.createElement("div");
    box.id="smSummary";
    box.className="summary";
    box.style.margin="12px 0";
    const table=host.querySelector(".scroll");
    host.insertBefore(box,table);
  }
  const arr=Array.isArray(data)?data:[];
  const inflow=arr.filter(x=>String(x.flowDirection||"").toUpperCase()==="INFLOW").sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)).slice(0,5);
  const outflow=arr.filter(x=>String(x.flowDirection||"").toUpperCase()==="OUTFLOW").sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)).slice(0,5);
  const unusual=arr.filter(x=>String(x.flowDirection||"").toUpperCase()==="ABNORMAL_ACTIVITY"||String(x.unusual?.signal||"").toUpperCase().includes("UNUSUAL")).sort((a,b)=>(Number(b.unusual?.score)||0)-(Number(a.unusual?.score)||0)).slice(0,5);
  const card=(title,list,cls)=>'<div class="badge" style="flex:1;min-width:280px"><b>'+title+'</b><div class="small" style="margin-top:6px">'+(list.length?list.map(x=>'<span class="'+cls+'"><b>'+smEscape(x.symbol)+'</b> '+(Number(x.score)||0)+'</span>').join(" · "):"Sin señales")+'</div></div>';
  box.innerHTML=card("TOP ENTRADA DE DINERO",inflow,"green")+card("TOP SALIDA DE DINERO",outflow,"red")+card("ACTIVIDAD ANORMAL",unusual,"yellow");
}
function smRenderRows(data){
  smRenderSummary(data);
  const rows=document.getElementById("smRows"); if(!rows)return;
  if(!Array.isArray(data)||!data.length){rows.innerHTML='<tr><td colspan="15" class="loading">Sin datos.</td></tr>';return;}
  rows.innerHTML=data.map((x,i)=>{
    const score=Number(x.score)||0, flow=x.flowDirection||"MIXED", mf=x.marketFlow||{}, insider=x.insider||{}, institutional=x.institutional||{}, congress=x.congress||{}, unusual=x.unusual||{}, etf=x.etf||{}, options=x.options||{}, conf=x.confluence||{};
    return `<tr><td><b>${i+1}</b></td><td><b>${smEscape(x.symbol)}</b></td><td><span class="score ${score>=70?'green':score<=30?'red':'yellow'}">${score}</span></td><td>${smBadge(flow)}<br><span class="small">conf. ${smEscape(conf.confidence||"—")}</span></td><td>${smBadge(mf.signal||"UNAVAILABLE")}<br><span class="small">RVOL ${Number(mf.rvol||0).toFixed(2)}x · 5D ${Number(mf.priceChange5D||0).toFixed(1)}%</span></td><td>${smBadge(insider.signal)}<br><span class="small">${insider.count||0} · ${smMoney(insider.netValue||0)}</span></td><td>${smBadge(institutional.signal)}<br><span class="small">${institutional.filers||0} managers · LAGGED</span></td><td>${smBadge(congress.signal)}<br><span class="small">${congress.count||0} ops</span></td><td>${smBadge(unusual.signal)}<br><span class="small">RVOL ${Number(unusual.rvol||0).toFixed(2)}x</span></td><td>${smBadge(etf.signal)}</td><td>${smBadge(options.signal||"OFF")}<br><span class="small">C/P ${options.callPutRatio==null?'—':Number(options.callPutRatio).toFixed(2)+'x'}</span></td><td><span class="small">${smEscape((x.reasons||[]).join(" · "))}</span></td><td><span class="small">${smEscape((x.dataQuality||""))}</span></td><td><span class="small">${smEscape(x.asOf||"")}</span></td><td><button type="button" class="smDetailBtn" data-symbol="${smEscape(x.symbol)}">DETALLES</button></td></tr>`;
  }).join("");
  document.querySelectorAll(".smDetailBtn").forEach(b=>b.addEventListener("click",()=>smDetails(b.dataset.symbol)));
}
async function smLoad(){
  const input=document.getElementById("symbols"),status=document.getElementById("smStatus"),rows=document.getElementById("smRows");
  if(!input||!status||!rows)return;
  status.textContent="Detectando dónde se está moviendo el dinero ahora…";
  rows.innerHTML='<tr><td colspan="15" class="loading">Buscando ganadores, perdedores y mayor actividad del mercado…</td></tr>';
  try{
    const d=await fetch(SM_API.replace("/smart-money","/smart-money-candidates")+"?_="+Date.now(),{cache:"no-store"});
    const dj=await d.json();
    if(!d.ok||dj.status!=="ok")throw new Error(dj.message||"No se pudieron detectar candidatos.");
    const candidates=[...new Set((dj.symbols||[]).map(x=>String(x).toUpperCase()).filter(Boolean))].slice(0,32);
    if(!candidates.length)throw new Error("El mercado no devolvió candidatos.");
    let all=[];
    for(let i=0;i<candidates.length;i+=8){
      const chunk=candidates.slice(i,i+8);
      const r=await fetch(SM_API+"?symbols="+encodeURIComponent(chunk.join(","))+"&detail=0&_="+Date.now(),{cache:"no-store"});
      const j=await r.json();
      if(Array.isArray(j.data))all.push(...j.data);
      const pct=Math.min(100,Math.round((Math.min(i+8,candidates.length)/candidates.length)*100));
      status.textContent="Smart Money en tiempo real · analizando "+Math.min(i+8,candidates.length)+"/"+candidates.length+" candidatos ("+pct+"%)";
    }
    all.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
    smRenderRows(all.slice(0,25));
    status.textContent="Radar terminado · "+all.length+" movimientos relevantes detectados · mostrando Top 25";
  }catch(e){console.error("SMART MONEY ERROR:",e);status.textContent="ERROR: "+e.message;rows.innerHTML=`<tr><td colspan="15" class="red">${smEscape(e.message)}</td></tr>`}
}

async function smDetails(symbol){
  const status=document.getElementById("smStatus"),panel=document.getElementById("smDetail");if(!panel)return;status.textContent="Cargando detalles de "+symbol+"...";
  try{
    const r=await fetch(SM_API+"?symbol="+encodeURIComponent(symbol)+"&detail=1&_="+Date.now(),{cache:"no-store"});
    const data=await r.json(); if(!r.ok||data.status!=="ok")throw new Error(data.message||"No se pudieron cargar los detalles.");
    const x=Array.isArray(data.data)?data.data[0]:data.data;if(!x)throw new Error("No hay datos para "+symbol);
    const events=Array.isArray(x.events)?x.events:[];
    panel.classList.remove("hidden");
    panel.innerHTML=`<h3 class="section-title">${smEscape(symbol)} — RADAR DE CAPITAL</h3>
      <div class="summary"><span class="badge">SCORE: <b>${Number(x.score)||0}</b></span><span class="badge">FLUJO: ${smBadge(x.flowDirection)}</span><span class="badge">CONFIANZA: ${smEscape(x.confluence?.confidence||"—")}</span><span class="badge">INSIDERS: ${smBadge(x.insider?.signal)}</span><span class="badge">13F: ${smBadge(x.institutional?.signal)}</span><span class="badge">CONGRESO: ${smBadge(x.congress?.signal)}</span><span class="badge">OPCIONES: ${smBadge(x.options?.signal||"OFF")}</span></div>
      <p class="small"><b>Por qué:</b> ${smEscape((x.reasons||[]).join(" · "))}</p>
      <p class="small">Market flow proxy: RVOL ${Number(x.marketFlow?.rvol||0).toFixed(2)}x · $Vol relativo ${Number(x.marketFlow?.dollarRel||0).toFixed(2)}x · 5D ${Number(x.marketFlow?.priceChange5D||0).toFixed(2)}% · ${smEscape(x.marketFlow?.note||"")}</p>
      <div class="scroll"><table><thead><tr><th>FUENTE</th><th>FECHA</th><th>TIPO</th><th>ACTOR</th><th>ACCIÓN</th><th>VALOR</th><th>REPORTE</th></tr></thead><tbody>${events.length?events.map(e=>`<tr><td>${smEscape(e.source||"")}</td><td>${smEscape(e.date||"")}</td><td>${smEscape(e.type||"")}</td><td>${smEscape(e.actor||"")}</td><td>${smEscape(e.action||"")}</td><td>${smEscape(e.value||e.amount||"")}</td><td>${smEscape(e.filingDate||"")}</td></tr>`).join(""):'<tr><td colspan="7">Sin eventos detallados.</td></tr>'}</tbody></table></div>
      <p class="small">13F: ${smEscape(x.institutional?.note||"")}</p><p class="small">Congreso: ${smEscape(x.congress?.note||"")}</p><p class="small">ETF: ${smEscape(x.etf?.note||"")}</p><p class="small">Calidad: ${smEscape(x.dataQuality||"")}</p>`;
    status.textContent="Detalles cargados para "+symbol;
  }catch(e){console.error("SMART MONEY DETAIL ERROR:",e);status.textContent="ERROR: "+e.message}
}
function smSleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function smScanUniverse(){
  const status=document.getElementById("smStatus");
  const tbody=document.querySelector("#smTable tbody");
  if(!status||!tbody)return;
  status.textContent="Analizando universo Smart Money por bloques de 8…";
  tbody.innerHTML="";
  let all=[];
  const chunks=[];
  for(let i=0;i<SM_UNIVERSE.length;i+=8) chunks.push(SM_UNIVERSE.slice(i,i+8));
  for(let i=0;i<chunks.length;i++){
    try{
      const url=SM_API+"?symbols="+encodeURIComponent(chunks[i].join(","))+"&detail=0";
      const r=await fetch(url,{cache:"no-store"});
      const j=await r.json();
      if(Array.isArray(j.data)) all.push(...j.data);
      smRenderRows(all);
      status.textContent="Smart Money: bloque "+(i+1)+"/"+chunks.length+" · "+all.length+" símbolos";
    }catch(e){
      status.textContent="Smart Money: bloque "+(i+1)+"/"+chunks.length+" con error · continuando";
    }
  }
  smRenderRows(all);
  status.textContent="Smart Money terminado: "+all.length+" símbolos";
}