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
    return `<tr><td><b>${i+1}</b></td><td><b>${smEscape(x.symbol)}</b></td><td><span class="score ${score>=70?'green':score<=30?'red':'yellow'}">${score}</span><br><span class="small">OPPORTUNITY</span></td><td><span class="score ${Number(confirmation.score||0)>=70?'green':Number(confirmation.score||0)>=50?'yellow':'red'}">${Number(confirmation.score||0)}</span><br><span class="small">${smEscape(confirmation.signal||"NO_CONFIRMATION")}</span></td><td>${smBadge(flow)}<br><span class="small">conf. ${smEscape(conf.confidence||"—")}</span></td><td>${smBadge(mf.signal||"UNAVAILABLE")}<br><span class="small">RVOL ${Number(mf.rvol||0).toFixed(2)}x · 5D ${Number(mf.priceChange5D||0).toFixed(1)}%</span></td><td>${smBadge(insider.signal)}<br><span class="small">${insider.count||0} · ${smMoney(insider.netValue||0)}</span></td><td>${smBadge(institutional.signal)}<br><span class="small">${institutional.filers||0} managers · LAGGED</span></td><td>${smBadge(congress.signal)}<br><span class="small">${congress.count||0} ops</span></td><td>${smBadge(unusual.signal)}<br><span class="small">RVOL ${Number(unusual.rvol||0).toFixed(2)}x</span></td><td>${smBadge(x.earlySmartMoney?.signal||"UNAVAILABLE")}<br><span class="small">score ${Number(x.earlySmartMoney?.score||0)} · ${smEscape(({UPTREND_ABOVE_EMA200:"ALCISTA > EMA200",ABOVE_EMA200:"SOBRE EMA200",RECOVERY_BELOW_EMA200:"RECUPERACIÓN < EMA200",BELOW_EMA200:"BAJO EMA200"})[x.earlySmartMoney?.trendState]||"TENDENCIA S/D")}</span></td><td>${smBadge(etf.signal)}</td><td>${smBadge(options.signal||"OFF")}<br><span class="small">C/P ${options.callPutRatio==null?'—':Number(options.callPutRatio).toFixed(2)+'x'}</span></td><td><span class="small">${smEscape((x.reasons||[]).join(" · "))}</span></td><td><span class="small">${smEscape((x.dataQuality||""))}</span></td><td><span class="small">${smEscape(x.asOf||"")}</span></td><td><button type="button" class="smDetailBtn" data-symbol="${smEscape(x.symbol)}">DETALLES</button></td></tr>`;
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
    // M y MUU se prueban siempre, aunque no aparezcan entre los movers principales.
    const scanList=[...new Set(["M","MUU",...scanCandidates.map(x=>String(x).toUpperCase().replace(/[^A-Z0-9.\\-]/g,"")).filter(Boolean)])].slice(0,16);
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
    const eligible=all.filter(x=>String(x.earlySmartMoney?.signal||"")!=="LATE_OR_WEAK" && Number(x.opportunityScore??x.score??0)>0);
    smRenderRows(eligible.slice(0,25));
    status.textContent="Radar terminado · "+scanList.length+" candidatos analizados (M y MUU incluidos) · "+eligible.length+" oportunidades con score positivo · ATR informativo, sin umbral fijo en dólares";
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
      <p class="small"><b>ACUMULACIÓN / ETAPA:</b> <span class="score ${Number(x.earlySmartMoney?.score||0)>=75?'green':Number(x.earlySmartMoney?.score||0)>=60?'yellow':'red'}">${Number(x.earlySmartMoney?.score||0)}</span> · ${smEscape(x.earlySmartMoney?.signal||"UNAVAILABLE")} · Régimen: ${smEscape(({UPTREND_ABOVE_EMA200:"ALCISTA SOBRE EMA200",ABOVE_EMA200:"SOBRE EMA200",RECOVERY_BELOW_EMA200:"RECUPERACIÓN TÁCTICA BAJO EMA200",BELOW_EMA200:"BAJO EMA200"})[x.earlySmartMoney?.trendState]||"SIN DATOS")} · EMA200 ${Number(x.earlySmartMoney?.ema200||0).toFixed(2)} · ${smEscape((x.earlySmartMoney?.reasons||[]).join(" · ")||"Sin señales")}</p>
      <p class="small">Early model: ATR(14) ${Number(x.earlySmartMoney?.atr||0).toFixed(2)} · RVOL ${Number(x.earlySmartMoney?.rvol||0).toFixed(2)}x · aceleración ${Number(x.earlySmartMoney?.rvolAcceleration||0).toFixed(2)}x · $Vol ${Number(x.earlySmartMoney?.dollarRel||0).toFixed(2)}x · 5D ${Number(x.earlySmartMoney?.priceChange5D||0).toFixed(2)}% · 20D ${Number(x.earlySmartMoney?.priceChange20D||0).toFixed(2)}% · VWAP ${Number(x.earlySmartMoney?.vwapDistance||0).toFixed(2)}%</p>
            <p class="small">Market flow proxy: RVOL ${Number(x.marketFlow?.rvol||0).toFixed(2)}x · $Vol relativo ${Number(x.marketFlow?.dollarRel||0).toFixed(2)}x · 5D ${Number(x.marketFlow?.priceChange5D||0).toFixed(2)}% · ${smEscape(x.marketFlow?.note||"")}</p>
      <div class="scroll"><table><thead><tr><th>FUENTE</th><th>FECHA</th><th>TIPO</th><th>ACTOR</th><th>ACCIÓN</th><th>VALOR</th><th>REPORTE</th></tr></thead><tbody>${events.length?events.map(e=>`<tr><td>${smEscape(e.source||"")}</td><td>${smEscape(e.date||"")}</td><td>${smEscape(e.type||"")}</td><td>${smEscape(e.actor||"")}</td><td>${smEscape(e.action||"")}</td><td>${smEscape(e.value||e.amount||"")}</td><td>${smEscape(e.filingDate||"")}</td></tr>`).join(""):'<tr><td colspan="7">Sin eventos detallados.</td></tr>'}</tbody></table></div>
      <p class="small">13F: ${smEscape(x.institutional?.note||"")}</p><p class="small">Congreso: ${smEscape(x.congress?.note||"")}</p><p class="small">ETF: ${smEscape(x.etf?.note||"")}</p><p class="small">Calidad: ${smEscape(x.dataQuality||"")}</p>`;
    status.textContent="Detalles cargados para "+symbol;
  }catch(e){console.error("SMART MONEY DETAIL ERROR:",e);status.textContent="ERROR: "+e.message}
}
function smSleep(ms){return new Promise(r=>setTimeout(r,ms));}
window.smLoad=smLoad;
async function smOptionsFlow(){
 const status=document.getElementById("ofStatus"),rows=document.getElementById("ofRows"),btn=document.getElementById("ofAnalyze");
 if(btn)btn.disabled=true;if(status)status.textContent="Consultando proveedor de opciones…";
 try{
  const r=await fetch("https://weekly-range-api.changowalu.workers.dev/options-flow?limit=75",{cache:"no-store"});
  const j=await r.json();
  if(!r.ok){if(status)status.textContent=j.message||("Error Options Flow: HTTP "+r.status);if(rows)rows.innerHTML='<tr><td colspan="10">Feed no disponible. No se muestran datos inventados.</td></tr>';return;}
  let d=j.data;let a=Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:(Array.isArray(d?.rows)?d.rows:(Array.isArray(d?.results)?d.results:(Array.isArray(d?.items)?d.items:[]))));
  if(status)status.textContent="Proveedor: "+(j.provider||"OptionsBell")+" · Actualizado: "+(j.retrievedAt||"—")+" · Filas: "+a.length+" · Prima estimada; no confirma por sí sola compra institucional.";
  const esc=smEscape;
  if(rows)rows.innerHTML=a.length?a.map(x=>{const sym=x.symbol||x.underlying_symbol||x.ticker||"—";const contract=x.option_symbol||x.contract||x.optionSymbol||"—";const typ=x.type||x.option_type||x.right||"—";const exp=x.expiration||x.expiry||x.expiration_date||"—";const prem=x.premium??x.total_value??x.estimated_premium??x.premium_estimate;const vol=x.volume??x.total_volume??x.trade_volume;const oi=x.open_interest??x.openInterest??x.oi;const ratio=x.volume_oi_ratio??x.vol_oi??x.volume_oi;const sent=x.sentiment||x.side||x.direction||"—";const dt=x.timestamp||x.generated_at||x.date||x.as_of||"—";return '<tr><td><b>'+esc(sym)+'</b></td><td>'+esc(contract)+'</td><td>'+esc(typ)+'</td><td>'+esc(exp)+'</td><td>'+esc(prem==null?"—":smMoney(Number(prem)))+'</td><td>'+esc(vol??"—")+'</td><td>'+esc(oi??"—")+'</td><td>'+esc(ratio==null?"—":Number(ratio).toFixed(2)+"x")+'</td><td>'+smBadge(sent)+'</td><td>'+esc(dt)+'</td></tr>'}).join(""):'<tr><td colspan="10">El proveedor no devolvió filas con estos datos. Revisa el esquema/API del plan.</td></tr>';
 }catch(e){if(status)status.textContent="Error Options Flow: "+e.message;if(rows)rows.innerHTML='<tr><td colspan="10">No se pudo consultar el feed.</td></tr>';}
 finally{if(btn)btn.disabled=false;}
}
window.smOptionsFlow=smOptionsFlow;

window.smDetails=smDetails;


function ofParseCsv(text){
 const raw=String(text||"").replace(/^\uFEFF/,"").trim();
 if(!raw)throw new Error("El archivo está vacío.");
 const lines=raw.split(/\r?\n/).filter(x=>x.trim());
 if(lines.length<2)throw new Error("El archivo no contiene operaciones.");
 function split(line,delimiter){let out=[],cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'&&q&&line[i+1]==='"'){cur+='"';i++;}else if(c==='"')q=!q;else if(c===delimiter&&!q){out.push(cur.trim());cur="";}else cur+=c;}out.push(cur.trim());return out;}
 const first=lines[0],comma=(first.match(/,/g)||[]).length,pipe=(first.match(/\|/g)||[]).length,delimiter=pipe>comma?"|":",";
 const norm=s=>String(s||"").trim().toLowerCase().replace(/^\uFEFF/,"").replace(/[\u00a0]/g," ").replace(/[%]/g," %").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
 const headers=split(first,delimiter).map(norm);
 const inferredSymbolHeader=headers.find(h=>/^[a-z][a-z0-9.]* px$/.test(h));
 const inferredSymbol=inferredSymbolHeader?inferredSymbolHeader.replace(/ px$/,"").toUpperCase():"";
 const rows=lines.slice(1).map(x=>split(x,delimiter));
 const aliases={
  symbol:["ticker","symbol","underlying","underlying symbol","root"],
  contract:["contract","option symbol","option symbol ticker","option contract","option contract ticker"],
  type:["call/put","put call","option type","right","type","tipo"],
  strike:["strike","strike price","precio strike"],
  expiration:["expiry","expiration","expiration date","exp","venc","vencimiento"],
  dte:["dte","days to expiry","days to expiration"],
  stock:["stock","underlying price","spot"],
  premium:["premium","estimated premium","premium estimated","premium $","prima$","total premium"],
  size:["size","contracts","contract size","cont","cantidad"],
  volume:["volume","trade volume","total volume"],
  oi:["oi","open interest","open interest "],
  ratio:["vol/oi","vol / oi","vol oi","volume/oi","volume oi","volume / oi","vol oi ratio"],
  side:["side","lado","trade side"],
  fill:["fill","price","trade price","execution price","precio"],
  bid:["bid","bid price"],
  ask:["ask","ask price"],
  spread:["spread"],
  askpct:["ask perc","ask percentage","ask %"],
  bidpct:["bid perc","bid percentage","bid %"],
  timestamp:["time (et)","time","timestamp","date","datetime","hora"],
  sweep:["is sweep","sweep"],
  cross:["is cross","cross"],
  floor:["is floor","floor"],
  unusual:["unusual","is unusual"],
  fillpos:["fill pos","fill position","fill pos %"],
  opening:["possible opening","possible opening ","posible apertura","opening"],
  flags:["flags","tags","trade codes","trade code","tags "],
  exchange:["exchange","exch"]
 };
 const idx={};for(const [key,names] of Object.entries(aliases))idx[key]=headers.findIndex(h=>names.includes(h));
 const get=(r,key)=>idx[key]<0?"":String(r[idx[key]]??"").trim();
 const number=v=>{let z=String(v??"").trim().replace(/[$,%\s]/g,"").replace(/,/g,"");if(!z||z==="—"||z==="-"||z.toLowerCase()==="null")return null;const m=z.match(/^(-?\d*\.?\d+)\s*([KMB])?$/i);if(!m)return null;const mult=({K:1e3,M:1e6,B:1e9})[(m[2]||"").toUpperCase()]||1;return Number(m[1])*mult;};
 const truth=v=>/^(true|1|yes|y|sí|si)$/i.test(String(v||"").trim());
 return rows.map(r=>{
  const symbol=(get(r,"symbol")||inferredSymbol).toUpperCase(),rawContract=get(r,"contract"),rawType=get(r,"type").toUpperCase();
  const strike=number(get(r,"strike")),expiration=get(r,"expiration");
  const contract=rawContract||(symbol&&rawType&&strike!=null?[symbol,rawType,strike,expiration].filter(Boolean).join(" "):"");
  const type=/CALL|LLAMAR|\bC\b/.test(rawType)?"CALL":/PUT|PONER|\bP\b/.test(rawType)?"PUT":"—";
  const side=get(r,"side").toLowerCase();
  const size=number(get(r,"size")),volume=number(get(r,"volume")),oi=number(get(r,"oi")),ratio=number(get(r,"ratio"));
  const fill=number(get(r,"fill")),bid=number(get(r,"bid")),ask=number(get(r,"ask"));
  let premium=number(get(r,"premium"));if(premium==null&&fill!=null&&size!=null)premium=fill*size*100;
  const flags=(get(r,"flags")+" "+get(r,"exchange")).toUpperCase();
  const isSweep=truth(get(r,"sweep"))||/\bSWEEP\b/.test(flags),isCross=truth(get(r,"cross"))||/\bCROSS\b/.test(flags),isFloor=truth(get(r,"floor"))||/\bFLOOR\b/.test(flags),isUnusual=truth(get(r,"unusual"))||/\bUNUSUAL\b/.test(flags);
  const width=bid!=null&&ask!=null?ask-bid:null,position=width>0&&fill!=null?(fill-bid)/width:null;
  let score=0,reasons=[];
  if(premium>=1000000){score+=30;reasons.push("prima ≥ $1M");}
  else if(premium>=250000){score+=24;reasons.push("prima ≥ $250K");}
  else if(premium>=100000){score+=18;reasons.push("prima ≥ $100K");}
  else if(premium>=25000){score+=10;reasons.push("prima ≥ $25K");}
  if(ratio>=10){score+=25;reasons.push("Vol/OI ≥ 10");}
  else if(ratio>=5){score+=20;reasons.push("Vol/OI ≥ 5");}
  else if(ratio>=2){score+=12;reasons.push("Vol/OI ≥ 2");}
  else if(ratio>=1){score+=6;reasons.push("Vol/OI ≥ 1");}
  if(isUnusual){score+=15;reasons.push("marcada unusual por Xynth");}
  if(isSweep){score+=10;reasons.push("sweep");}
  if(isFloor){score+=8;reasons.push("floor");}
  if(isCross){score+=4;reasons.push("cross");}
  if(position!=null&&position>=0.8){score+=10;reasons.push("ejecución cerca del ask");}
  else if(position!=null&&position<=0.2){score+=4;reasons.push("ejecución cerca del bid");}
  const dte=number(get(r,"dte"));
  score=Math.min(100,score);
  const isIndex=/^(SPXW?|SPX|XSP|NDX|RUT|VIX|OEX|DJX)$/.test(symbol);
  return {symbol,contract,type,strike,expiration,dte,stock:number(get(r,"stock"))??(inferredSymbolHeader?number(r[headers.indexOf(inferredSymbolHeader)]):null),premium,size,volume,open_interest:oi,volume_oi_ratio:ratio,side,fill,bid,ask,spread:number(get(r,"spread")),timestamp:get(r,"timestamp"),isSweep,isCross,isFloor,isUnusual,tags:get(r,"flags"),exchange:get(r,"exchange"),score,reasons,isIndex,delimiter};
 }).filter(x=>x.symbol);
}
function smLoadOptionsCsv(file){
 const status=document.getElementById("ofStatus"),rows=document.getElementById("ofRows");
 const reader=new FileReader();
 reader.onload=()=>{
  try{
   const a=ofParseCsv(reader.result);
   if(!a.length)throw new Error("No se reconoció la columna Ticker/Symbol. Exporta el CSV original de Xynth.");
   const esc=smEscape;
   const ranked=[...a].sort((x,y)=>y.score-x.score);
   rows.innerHTML=ranked.map(x=>{
    const signal=x.score>=65?"ACTIVIDAD MUY INUSUAL":x.score>=40?"REVISAR":x.score>=20?"MODERADA":"BAJA";
    const dir=x.side||"SIN LADO";
    const label=x.isIndex?"ÍNDICE · NO ACCIÓN":signal;
    return '<tr><td><b>'+esc(x.symbol)+'</b></td><td>'+esc(x.contract||"—")+'</td><td>'+esc(x.type)+'<br><span class="small">'+esc(dir)+'</span></td><td>'+esc(x.expiration||"—")+(x.dte!=null?' · '+esc(x.dte)+' DTE':"")+'</td><td>'+esc(x.premium==null?"—":smMoney(x.premium))+'</td><td>'+esc(x.size??"—")+' contratos<br><span class="small">Vol. mercado '+esc(x.volume??"—")+'</span></td><td>'+esc(x.open_interest??"—")+'</td><td>'+esc(x.volume_oi_ratio==null?"—":Number(x.volume_oi_ratio).toFixed(2)+"x")+'</td><td><b class="'+(x.isIndex?"yellow":x.score>=65?"green":x.score>=40?"yellow":"")+'">'+esc(label)+" · "+x.score+'/100</b><br><span class="small">'+esc(x.reasons.join(" · ")||"Sin criterios fuertes")+'</span></td><td>'+esc(x.timestamp||"—")+'</td></tr>';
   }).join("");
   const strong=ranked.filter(x=>x.score>=40).length,top=ranked[0];
   status.textContent="CSV analizado: "+a.length+" operaciones · delimitador "+(a[0].delimiter==="|"?"|":"coma")+" · "+strong+" candidatas a revisar (score ≥40). "+(top?"Mayor score: "+top.symbol+" "+top.score+"/100. ":"")+"Score heurístico experimental; no confirma entrada institucional ni dirección neta.";
  }catch(e){status.textContent="No se pudo leer el CSV: "+e.message;}
 };
 reader.onerror=()=>{status.textContent="Error al leer el archivo CSV."};
 reader.readAsText(file);
}
document.addEventListener("DOMContentLoaded",()=>{
 const input=document.getElementById("ofCsvFile");
 if(input)input.addEventListener("change",()=>{if(input.files&&input.files[0])smLoadOptionsCsv(input.files[0]);});
});

