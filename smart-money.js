const SM_API = "https://weekly-range-api.changowalu.workers.dev/smart-money";



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
  box.innerHTML=card("TOP OPORTUNIDAD · INFLOW",inflow,"green")+card("TOP OPORTUNIDAD · OUTFLOW",outflow,"red")+card("ACTIVIDAD ANORMAL",unusual,"yellow");
}
function smRenderRows(data){
  smRenderSummary(data);
  const rows=document.getElementById("smRows"); if(!rows)return;
  if(!Array.isArray(data)||!data.length){rows.innerHTML='<tr><td colspan="16" class="loading">Sin datos.</td></tr>';return;}
  rows.innerHTML=data.map((x,i)=>{
    const score=Number(x.score)||0, flow=x.flowDirection||"MIXED", mf=x.marketFlow||{}, insider=x.insider||{}, institutional=x.institutional||{}, congress=x.congress||{}, unusual=x.unusual||{}, etf=x.etf||{}, options=x.options||{}, conf=x.confluence||{}, confirmation=x.confirmation||{}, early=x.earlySmartMoney||{};
    return `<tr><td><b>${i+1}</b></td><td><b>${smEscape(x.symbol)}</b></td><td><span class="score ${score>=70?'green':score<=30?'red':'yellow'}">${score}</span><br><span class="small">OPPORTUNITY</span></td><td><span class="score ${Number(confirmation.score||0)>=70?'green':Number(confirmation.score||0)>=50?'yellow':'red'}">${Number(confirmation.score||0)}</span><br><span class="small">${smEscape(confirmation.signal||"NO_CONFIRMATION")}</span></td><td>${smBadge(flow)}<br><span class="small">conf. ${smEscape(conf.confidence||"—")}</span></td><td>${smBadge(mf.signal||"UNAVAILABLE")}<br><span class="small">RVOL ${Number(mf.rvol||0).toFixed(2)}x · 5D ${Number(mf.priceChange5D||0).toFixed(1)}%</span></td><td>${smBadge(insider.signal)}<br><span class="small">${insider.count||0} · ${smMoney(insider.netValue||0)}</span></td><td>${smBadge(institutional.signal)}<br><span class="small">${institutional.filers||0} managers · LAGGED</span></td><td>${smBadge(congress.signal)}<br><span class="small">${congress.count||0} ops</span></td><td>${smBadge(unusual.signal)}<br><span class="small">RVOL ${Number(unusual.rvol||0).toFixed(2)}x</span></td><td>${smBadge(x.earlySmartMoney?.signal||"UNAVAILABLE")}<br><span class="small">score ${Number(x.earlySmartMoney?.score||0)}</span></td><td>${smBadge(etf.signal)}</td><td>${smBadge(options.signal||"OFF")}<br><span class="small">C/P ${options.callPutRatio==null?'—':Number(options.callPutRatio).toFixed(2)+'x'}</span></td><td><span class="small">${smEscape((x.reasons||[]).join(" · "))}</span></td><td><span class="small">${smEscape((x.dataQuality||""))}</span></td><td><span class="small">${smEscape(x.asOf||"")}</span></td><td><button type="button" class="smDetailBtn" data-symbol="${smEscape(x.symbol)}">DETALLES</button></td></tr>`;
  }).join("");
  document.querySelectorAll(".smDetailBtn").forEach(b=>b.addEventListener("click",()=>smDetails(b.dataset.symbol)));
}
async function smFetchJson(url,timeoutMs=20000){
  const request=fetch(url,{cache:"no-store"}).then(async r=>({ok:r.ok,json:await r.json()}));
  const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error("Tiempo de espera agotado")),timeoutMs));
  return await Promise.race([request,timeout]);
}
async function smLoad(){
  const input=document.getElementById("symbols"),status=document.getElementById("smStatus"),rows=document.getElementById("smRows");
  if(!input||!status||!rows)return;
  status.textContent="Detectando dónde se está moviendo el dinero ahora…";
  rows.innerHTML='<tr><td colspan="16" class="loading">Buscando ganadores, perdedores y mayor actividad del mercado…</td></tr>';
  try{
    let dj;
    // Ruta crítica: /prefilter ya entrega ganadores, perdedores y mayor actividad
    // dinámicamente. No hacemos depender el radar de un proveedor lento.
    status.textContent="Radar: detectando movimientos del mercado…";
    const fallback=await smFetchJson(SM_API.replace("/smart-money","/prefilter")+"?_="+Date.now(),20000);
    dj=fallback.json;
    if(!fallback.ok||dj.status!=="ok")throw new Error(dj.message||"No se pudieron detectar movimientos del mercado.");
    const scanCandidates=dj.symbols||dj["símbolos"]||[];
    // Ampliamos el embudo: el prefilter descubre muchos candidatos y Smart Money
    // confirma un grupo mayor. 8 era demasiado estrecho para encontrar oportunidades
    // como ERO antes de que aparecieran entre los primeros ganadores.
    const scanList=[...new Set(scanCandidates.map(x=>String(x).toUpperCase().replace(/[^A-Z0-9.\\-]/g,"")).filter(Boolean))].slice(0,16);
    if(!scanList.length)throw new Error("El mercado no devolvió candidatos.");
    let all=[];
    for(let i=0;i<scanList.length;i+=8){
      const chunk=scanList.slice(i,i+8);
      const result=await smFetchJson(SM_API+"?symbols="+encodeURIComponent(chunk.join(","))+"&detail=0&_="+Date.now(),20000);
      const j=result.json;
      if(result.ok&&Array.isArray(j.data))all.push(...j.data);
      const pct=Math.min(100,Math.round((Math.min(i+8,scanList.length)/scanList.length)*100));
      status.textContent="Smart Money en tiempo real · analizando "+Math.min(i+8,scanList.length)+"/"+scanList.length+" candidatos ("+pct+"%)";
    }
    all.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
    const eligible=all.filter(x=>String(x.earlySmartMoney?.signal||"")!=="DISCARDED_ATR" && String(x.earlySmartMoney?.signal||"")!=="LATE_OR_WEAK" && Number(x.earlySmartMoney?.atr||0)>=3 && Number(x.opportunityScore??x.score??0)>0);
    smRenderRows(eligible.slice(0,25));
    status.textContent="Radar terminado · "+eligible.length+" candidatos elegibles · filtro interno ATR(14) ≥ $3 · ranking por Opportunity Score";
  }catch(e){console.error("SMART MONEY ERROR:",e);status.textContent="ERROR: "+e.message;rows.innerHTML=`<tr><td colspan="16" class="red">${smEscape(e.message)}</td></tr>`}
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
      <div class="summary"><span class="badge">OPPORTUNITY SCORE: <b>${Number(x.score)||0}</b></span><span class="badge">SMART MONEY CONFIRMATION: <b>${Number(x.confirmation?.score||0)}</b> · ${smEscape(x.confirmation?.signal||"NO_CONFIRMATION")}</span><span class="badge">FLUJO: ${smBadge(x.flowDirection)}</span><span class="badge">CONFIANZA: ${smEscape(x.confluence?.confidence||"—")}</span><span class="badge">INSIDERS: ${smBadge(x.insider?.signal)}</span><span class="badge">13F: ${smBadge(x.institutional?.signal)}</span><span class="badge">CONGRESO: ${smBadge(x.congress?.signal)}</span><span class="badge">OPCIONES: ${smBadge(x.options?.signal||"OFF")}</span><span class="badge">CAPITAL PRESSURE: ${smBadge(x.capitalFlow?.signal||"FREE_MODEL")} · ${Number(x.earlySmartMoney?.score||0)}</span></div><p class="small"><b>Confirmación:</b> ${smEscape((x.confirmation?.evidence||[]).join(" · ")||"Sin evidencia institucional/insider/opciones/Congreso confirmable.")} · ${smEscape(x.confirmation?.note||"")}</p>
      <p class="small"><b>Por qué:</b> ${smEscape((x.reasons||[]).join(" · "))}</p>
      <p class="small"><b>ACUMULACIÓN TEMPRANA:</b> <span class="score ${Number(x.earlySmartMoney?.score||0)>=75?'green':Number(x.earlySmartMoney?.score||0)>=60?'yellow':'red'}">${Number(x.earlySmartMoney?.score||0)}</span> · ${smEscape(x.earlySmartMoney?.signal||"UNAVAILABLE")} · ${smEscape((x.earlySmartMoney?.reasons||[]).join(" · ")||"Sin señales")}</p>
      <p class="small">Early model: ATR(14) ${Number(x.earlySmartMoney?.atr||0).toFixed(2)} · RVOL ${Number(x.earlySmartMoney?.rvol||0).toFixed(2)}x · aceleración ${Number(x.earlySmartMoney?.rvolAcceleration||0).toFixed(2)}x · $Vol ${Number(x.earlySmartMoney?.dollarRel||0).toFixed(2)}x · 5D ${Number(x.earlySmartMoney?.priceChange5D||0).toFixed(2)}% · 20D ${Number(x.earlySmartMoney?.priceChange20D||0).toFixed(2)}% · VWAP ${Number(x.earlySmartMoney?.vwapDistance||0).toFixed(2)}%</p>
            <p class="small">Market flow proxy: RVOL ${Number(x.marketFlow?.rvol||0).toFixed(2)}x · $Vol relativo ${Number(x.marketFlow?.dollarRel||0).toFixed(2)}x · 5D ${Number(x.marketFlow?.priceChange5D||0).toFixed(2)}% · ${smEscape(x.marketFlow?.note||"")}</p>
      <div class="scroll"><table><thead><tr><th>FUENTE</th><th>FECHA</th><th>TIPO</th><th>ACTOR</th><th>ACCIÓN</th><th>VALOR</th><th>REPORTE</th></tr></thead><tbody>${events.length?events.map(e=>`<tr><td>${smEscape(e.source||"")}</td><td>${smEscape(e.date||"")}</td><td>${smEscape(e.type||"")}</td><td>${smEscape(e.actor||"")}</td><td>${smEscape(e.action||"")}</td><td>${smEscape(e.value||e.amount||"")}</td><td>${smEscape(e.filingDate||"")}</td></tr>`).join(""):'<tr><td colspan="7">Sin eventos detallados.</td></tr>'}</tbody></table></div>
      <p class="small">13F: ${smEscape(x.institutional?.note||"")}</p><p class="small">Congreso: ${smEscape(x.congress?.note||"")}</p><p class="small">ETF: ${smEscape(x.etf?.note||"")}</p><p class="small">Calidad: ${smEscape(x.dataQuality||"")}</p>`;
    status.textContent="Detalles cargados para "+symbol;
  }catch(e){console.error("SMART MONEY DETAIL ERROR:",e);status.textContent="ERROR: "+e.message}
}
function smSleep(ms){return new Promise(r=>setTimeout(r,ms));}
window.smLoad=smLoad;
window.smDetails=smDetails;
