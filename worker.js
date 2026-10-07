const TD = "https://api.twelvedata.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "api-credits-used,api-credits-left"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...CORS,
      ...extraHeaders
    }
  });
}

async function td(path, env) {
  const url = new URL(TD + path);
  url.searchParams.set("apikey", env.TWELVE_DATA_API_KEY);
  const response = await fetchWithTimeout(url, { method: "GET", headers: { accept: "application/json" } }, 5000);
  const data = await response.json();
  return {
    httpStatus: response.status,
    data,
    creditsUsed: response.headers.get("api-credits-used"),
    creditsLeft: response.headers.get("api-credits-left")
  };
}

async function fetchWithTimeout(url, options={}, timeoutMs=5000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try { return await fetch(url,{...options,signal:controller.signal}); }
  finally { clearTimeout(timer); }
}

function cleanSymbols(value) {
  return [...new Set(String(value || "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean).filter(x => x !== "MSFT").filter(x => /^[A-Z0-9.-]+$/.test(x)))].slice(0, 120);
}

function normalizeBatch(symbols, raw) {
  const out = {};
  if (symbols.length === 1) { out[symbols[0]] = raw; return out; }
  for (const symbol of symbols) out[symbol] = raw?.[symbol] || { status: "error", message: "Twelve Data no devolvió datos para " + symbol };
  return out;
}

async function yahooOne(symbol) {
  const now = Math.floor(Date.now()/1000);
  const period1 = now - 370 * 86400;
  const hosts = ["query1.finance.yahoo.com","query2.finance.yahoo.com"];
  for (const host of hosts) {
    try {
      const url = "https://" + host + "/v8/finance/chart/" + encodeURIComponent(symbol) +
        "?range=1y&interval=1d&events=history&includeAdjustedClose=true&includePrePost=false";
      const r = await fetchWithTimeout(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } }, 3500);
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      const ts = res?.timestamp || [];
      const adj = res?.indicators?.adjclose?.[0]?.adjclose || [];
      const values = ts.map((t,i) => ({
        datetime: new Date(t*1000).toISOString().slice(0,10),
        open: Number(q?.open?.[i]) || 0,
        high: Number(q?.high?.[i]) || 0,
        low: Number(q?.low?.[i]) || 0,
        close: Number(q?.close?.[i]) || Number(adj[i]) || 0,
        volume: Number(q?.volume?.[i]) || 0
      })).filter(x => x.close > 0);
      if (values.length) return { symbol, values };
    } catch (_) {}
  }
  return { symbol, values: [] };
}
async function yahooScreener(scrIds,count=250) {
  const hosts=["query1.finance.yahoo.com","query2.finance.yahoo.com"];
  for(const host of hosts){
    try{
      const url="https://"+host+"/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds="+encodeURIComponent(scrIds)+"&count="+count+"&corsDomain=finance.yahoo.com";
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),3000);
      const r=await fetch(url,{headers:{accept:"application/json","user-agent":"Mozilla/5.0"},signal:controller.signal});
      clearTimeout(timer);
      if(!r.ok)continue;
      const j=await r.json();
      const quotes=j?.finance?.result?.[0]?.quotes;
      if(Array.isArray(quotes)&&quotes.length)return quotes;
    }catch(_){ }
  }
  return [];
}
async function yahooMovers() {
  // Prefiltro orientado a ANTICIPACIÓN: no usa solo ganadores/perdedores.
  // Mezcla actividad, crecimiento y small caps para encontrar acumulación antes
  // de una ruptura. Los ganadores/perdedores siguen presentes como contexto.
  const sets=await Promise.all([
    yahooScreener("most_actives",250),
    yahooScreener("growth_technology_stocks",250),
    yahooScreener("aggressive_small_caps",250),
    yahooScreener("day_gainers",150),
    yahooScreener("day_losers",100)
  ]);
  const all=sets.flat();
  const bySymbol=new Map();
  for(const x of all){
    const symbol=String(x.symbol||"").toUpperCase();
    if(!symbol || symbol==="MSFT" || !/^[A-Z0-9.-]+$/.test(symbol)) continue;
    const ch=Number(x.regularMarketChangePercent||x.percentchange||0);
    const vol=Number(x.regularMarketVolume||x.volume||0);
    const avg=Number(x.averageDailyVolume3Month||x.averageDailyVolume10Day||0);
    const rvol=avg>0?vol/avg:0;
    // Preferimos movimiento todavía contenido + aceleración de volumen.
    // Penalizamos extremos para no llenar el radar con acciones que ya explotaron.
    let early=50;
    if(rvol>=1.15&&rvol<2.5) early+=20;
    else if(rvol>=2.5&&rvol<4) early+=8;
    else if(rvol>=4) early-=15;
    if(ch>=0&&ch<=3) early+=18;
    else if(ch>3&&ch<=6) early+=5;
    else if(ch>10) early-=25;
    else if(ch<-5) early-=10;
    if(Math.abs(ch)<=2&&rvol>=1.15) early+=8;
    if(!bySymbol.has(symbol) || early>bySymbol.get(symbol).early) bySymbol.set(symbol,{symbol,early});
  }
  return [...bySymbol.values()]
    .sort((a,b)=>b.early-a.early)
    .map(x=>x.symbol);
}
async function yahooTimeSeries(symbols) {
  const out = {};
  // Yahoo puede limitar lotes grandes; procesamos en grupos pequeños para evitar que
  // el proveedor devuelva cero datos a todos los símbolos por rate-limit.
  for (let i=0; i<symbols.length; i+=5) {
    const chunk = symbols.slice(i,i+5);
    const results = await Promise.all(chunk.map(yahooOne));
    for (const r of results) out[r.symbol] = r.values;
    if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function stooqOne(symbol) {
  try {
    const s=String(symbol).toLowerCase().replace(/\./g,'-')+'.us';
    const url='https://stooq.com/q/d/l/?s='+encodeURIComponent(s)+'&i=d&d1='+new Date(Date.now()-370*86400000).toISOString().slice(0,10)+'&d2='+new Date().toISOString().slice(0,10);
    const r=await fetchWithTimeout(url,{headers:{accept:'text/csv'}},3500);
    if(!r.ok)return {symbol,values:[]};
    const text=await r.text();
    const lines=text.trim().split(/\r?\n/);
    if(lines.length<2)return {symbol,values:[]};
    const values=lines.slice(1).map(line=>{
      const p=line.split(',');
      return {datetime:p[0],open:Number(p[1])||0,high:Number(p[2])||0,low:Number(p[3])||0,close:Number(p[4])||0,volume:Number(p[5])||0};
    }).filter(x=>x.close>0);
    return {symbol,values};
  }catch(_){return {symbol,values:[]}}
}
async function stooqTimeSeries(symbols){
  const out={};
  for(let i=0;i<symbols.length;i+=6){
    const results=await Promise.all(symbols.slice(i,i+6).map(stooqOne));
    for(const r of results)out[r.symbol]=r.values;
  }
  return out;
}

async function smartHistory(symbol, env, minBars=25){
  try{
    const s=await stooqOne(symbol);
    if(Array.isArray(s.values)&&s.values.length>=minBars) return {values:s.values,source:"Stooq"};
  }catch(_){}
  try{
    const y=await yahooOne(symbol);
    if(Array.isArray(y.values)&&y.values.length>=minBars) return {values:y.values,source:"Yahoo Finance"};
  }catch(_){}
  try{
    const r=await td("/time_series?symbol="+encodeURIComponent(symbol)+"&interval=1day&outputsize=90&order=desc&timezone=America/New_York",env);
    const v=Array.isArray(r.data?.values)?r.data.values.slice().reverse().map(x=>({datetime:x.datetime||"",open:Number(x.open)||0,high:Number(x.high)||0,low:Number(x.low)||0,close:Number(x.close)||0,volume:Number(x.volume)||0})):Array.isArray(r.data)?r.data:[];
    if(v.length>=minBars) return {values:v,source:"Twelve Data"};
  }catch(_){}
  return {values:[],source:"Unavailable"};
}


async function marketMovers(env, market, direction) {
  const r = await td("/market_movers/" + market + "?direction=" + direction + "&outputsize=50&country=USA", env);
  if (r.httpStatus !== 200) return { ok:false, status:r.httpStatus, message:r.data?.message || "Market movers no disponible." };
  const values = Array.isArray(r.data?.values) ? r.data.values : [];
  return { ok:true, values };
}

async function smartMoneyCandidates(env){
  // Universo amplio: acciones + ETFs. Smart Money debe comparar oportunidad,
  // no depender únicamente de los mayores ganadores/perdedores del día.
  const sets=await Promise.all([
    yahooScreener("day_gainers",150),
    yahooScreener("most_actives",150),
    yahooScreener("growth_technology_stocks",150),
    yahooScreener("aggressive_small_caps",150),
    yahooScreener("day_losers",100)
  ]);
  const candidates=sets.flat().map(x=>String(x.symbol||x.ticker||"").trim().toUpperCase())
    .filter(x=>x && x!=="MSFT" && /^[A-Z0-9.-]+$/.test(x));
  // ETFs líquidos incluidos en el mismo radar; no reciben puntuación especial.
  const etfs=["QQQM","QQQ","SPY","VOO","VTI","IWM","DIA","XLK","SMH","SOXX","XLF","ARKK","TQQQ","SQQQ","SOXL","SOXS"];
  const symbols=[...new Set([...candidates,...etfs])].slice(0,30);
  return {
    symbols,
    candidates:symbols.map(symbol=>({symbol,buckets:etfs.includes(symbol)?["ETF"]:["STOCK"],change:0,volume:0}))
  };
}

async function universe(env) {
  const [stocks, etfs] = await Promise.all([td("/stocks?country=United%20States", env), td("/etf", env)]);
  let stockList = Array.isArray(stocks.data?.data) ? stocks.data.data : [];
  let etfList = Array.isArray(etfs.data?.data) ? etfs.data.data : [];
  stockList = stockList.filter(x => String(x.country || "").toLowerCase() === "united states" && String(x.currency || "").toUpperCase() === "USD");
  const usEtfExchanges = new Set(["NASDAQ","NYSE","NYSE ARCA","NYSEARCA","AMEX","CBOE","CBOE BZX","CBOE EDGX","CBOE BYX","CBOE C2"]);
  etfList = etfList.filter(x => String(x.currency || "").toUpperCase() === "USD" && usEtfExchanges.has(String(x.exchange || "").toUpperCase()));
  return [...new Set([...stockList, ...etfList].map(x => String(x.symbol || "").trim().toUpperCase()).filter(Boolean).filter(x => x !== "MSFT").filter(x => /^[A-Z0-9.-]+$/.test(x)))].sort();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        const r = await fetch("https://raw.githubusercontent.com/lsifonte88-glitch/weekly-range-scanner/main/index.html?v=smfix", { cf: { cacheTtl: 0 } });
        if (!r.ok) return new Response("No se pudo cargar la aplicación.", { status: 502 });
        return new Response(await r.text(), { headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" } });
      }
      if (url.pathname === "/smart-money.js" || url.pathname === "/smart-money-v2.js") {
        const r = await fetch("https://raw.githubusercontent.com/lsifonte88-glitch/weekly-range-scanner/main/smart-money.js?v=12e6d5abefa9e16f6318cbe11cad86cfec940bc0", { cf: { cacheTtl: 0 } });
        if (!r.ok) return new Response("No se pudo cargar Smart Money.", { status: 502 });
        return new Response(await r.text(), { headers: { "content-type": "application/javascript; charset=UTF-8", "cache-control": "no-store" } });
      }
      if (url.pathname === "/health") return json({ status: "ok", service: "Weekly Range Scanner PRO", time: new Date().toISOString() });
      if (url.pathname === "/prefilter") {
        const symbols = await yahooMovers();
        if (symbols.length) {
          return json({status:"ok",count:symbols.length,symbols:symbols.slice(0,32),generatedAt:new Date().toISOString(),source:"Yahoo Finance screener",note:"Prefiltro dinámico orientado a anticipación: actividad + crecimiento + small caps; prioriza RVOL y movimiento contenido."},200,{"cache-control":"public, max-age=60"});
        }
        return json({status:"error",message:"No se pudieron detectar movimientos del mercado en Yahoo Finance."},502);
      }
      if (url.pathname === "/universe") {
        const symbols = await universe(env);
        return json({ status: "ok", count: symbols.length, symbols, generatedAt: new Date().toISOString() }, 200, { "cache-control": "public, max-age=21600" });
      }
      if (url.pathname === "/smart-money-candidates") {
        const out=await smartMoneyCandidates(env);
        if(!out.symbols.length)return json({status:"error",message:"No se detectaron movimientos de mercado."},502);
        return json({status:"ok",...out,generatedAt:new Date().toISOString(),source:"Yahoo Finance screeners",note:"Prefiltro orientado a anticipación: actividad + crecimiento + small caps, priorizando volumen acelerando con movimiento de precio todavía contenido."},200,{"cache-control":"no-store"});
      }
      if (url.pathname === "/smart-money") {
        const symbols = cleanSymbols(url.searchParams.get("symbols") || url.searchParams.get("symbol"));
        if (!symbols.length) return json({status:"error",message:"Falta symbol o symbols."},400);
        const detail = url.searchParams.get("detail")==="1";
        const data = [];
        if (!detail) {
        // FAST: radar ligero y estable. No ejecutamos SEC/13F global aquí:
        // esas consultas multiplican subrequests y pueden tumbar Cloudflare.
        // La confirmación institucional se reserva para /smart-money?detail=1.
        const fastSymbols=symbols.slice(0,8);
        const results=await Promise.allSettled(
          fastSymbols.map(s=>smartMoneyFastData(s,env,{},[]))
        );
        for(let i=0;i<results.length;i++){
          const r=results[i];
          if(r.status==="fulfilled") data.push(r.value);
          else data.push({
            symbol:fastSymbols[i],score:0,opportunityScore:0,earlyRawScore:0,
            smartMoneyScore:0,flowDirection:"MIXED",
            marketFlow:{signal:"UNAVAILABLE",score:0,rvol:0,priceChange5D:0,note:"Proveedor no disponible en este ciclo"},
            earlySmartMoney:{signal:"UNAVAILABLE",score:0},
            confluence:{confidence:"LOW"},
            reasons:["sin datos suficientes en este ciclo"],
            insider:{signal:"DEFERRED",count:0,netValue:0},
            institutional:{signal:"DEFERRED",filers:0,note:"13F disponible en DETALLES"},
            congress:{signal:"DEFERRED",count:0,note:"Congreso disponible en DETALLES"},
            unusual:{signal:"UNAVAILABLE",score:0,rvol:0},
            options:{signal:"DEFERRED",enabled:false},
            etf:{signal:"DEFERRED"},
            confirmation:{score:0,signal:"NO_CONFIRMATION",confidence:"LOW",evidence:[]},
            dataQuality:"fallo aislado de proveedor",
            asOf:new Date().toISOString()
          });
        }
        data.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
        return json({
          status:"ok",mode:"FAST_SUBREQUEST_SAFE",data,generatedAt:new Date().toISOString(),
          sources:{
            sec:false,
            marketHistoryFallbacks:["Stooq","Yahoo Finance","Twelve Data"],
            options:"deferred to detail",institutional13F:"detail only",
            congress:"detail only",confirmationTopN:0
          }
        });
      }
        // DETAIL_SAFE: un solo símbolo y solo dependencias acotadas.
        // No cargamos snapshots globales de 13F ni historial profundo de SEC aquí:
        // esas consultas pueden superar el límite de subrequests de Cloudflare.
        const detailSymbols = symbols.slice(0,1);
        let directory={}, resolvedSecMap={}, institutionalSnap=[];
        try{
          directory=await secTickerDirectory(env);
          for(const [ticker,x] of Object.entries(directory))resolvedSecMap[ticker]=x.cik;
        }catch(_){}
        try{ institutionalSnap=await institutionalSnapshot(env); }catch(_){}
        for (const s of detailSymbols) {
          try {
            const issuerName=directory[s]?.name||s;
            data.push(await smartMoneyData(s,env,true,institutionalSnap,issuerName,resolvedSecMap));
            const x=data[data.length-1];
            x.confirmation=confirmationFromSources(x.insider,x.institutional,x.congress,x.options);
            x.dataQuality=[x.dataQuality||"",x.confirmation.signal].filter(Boolean).join(" · ");
          } catch (e) {
            data.push({
              symbol:s,score:50,flowDirection:"MIXED",error:e?.message||String(e),mode:"DETAIL_SAFE",
              confirmation:{score:0,signal:"NO_CONFIRMATION",confidence:"LOW",evidence:[]}
            });
          }
        }
        return json({
          status:"ok",
          mode:"DETAIL_SAFE",
          data,
          requested:symbols.length,
          processed:detailSymbols.length,
          generatedAt:new Date().toISOString(),
          sources:{
            sec:Boolean(Object.keys(resolvedSecMap).length),
            marketHistoryFallbacks:["Stooq","Yahoo Finance","Twelve Data"],
            institutional13F:"SEC 13F managers: Berkshire, State Street, Vanguard, BlackRock",
            congress:Boolean(env.QUIVER_API_KEY)?"Quiver Quantitative":"not configured",
            options:"Twelve Data/Yahoo Finance"
          }
        });
      }
if (url.pathname === "/api") {
        const requestedSymbols = cleanSymbols(url.searchParams.get("symbols") || url.searchParams.get("symbol"));
        if (!requestedSymbols.length) return json({ status: "error", message: "Falta symbol o symbols." }, 400);
        const symbols = requestedSymbols.slice(0, 8);

        // Recuperación por símbolo: evita que un lote parcialmente bloqueado deje al
        // frontend sin datos aunque uno de los proveedores sí entregue históricos.
        const data = {};
        const providers = {};
        const pending = [...symbols];

        const stooq = await stooqTimeSeries(pending);
        for (const s of pending) {
          if (Array.isArray(stooq[s]) && stooq[s].length >= 60) {
            data[s] = stooq[s];
            providers[s] = "Stooq";
          }
        }

        let missing = symbols.filter(s => !data[s]);
        if (missing.length) {
          const yahoo = await yahooTimeSeries(missing);
          for (const s of missing) {
            if (Array.isArray(yahoo[s]) && yahoo[s].length >= 60) {
              data[s] = yahoo[s];
              providers[s] = "Yahoo Finance";
            }
          }
        }

        missing = symbols.filter(s => !data[s]);
        if (missing.length) {
          for (let i = 0; i < missing.length; i += 6) {
            const chunk = missing.slice(i, i + 6);
            try {
              const path = "/time_series?symbol=" + encodeURIComponent(chunk.join(",")) +
                "&interval=1day&outputsize=260&order=desc&timezone=America/New_York";
              const result = await td(path, env);
              if (result.httpStatus === 200 && result.data?.status !== "error") {
                const tdData = normalizeBatch(chunk, result.data);
                for (const s of chunk) {
                  const v = Array.isArray(tdData[s]?.values) ? tdData[s].values :
                    Array.isArray(tdData[s]) ? tdData[s] : [];
                  if (v.length >= 60) {
                    data[s] = v;
                    providers[s] = "Twelve Data";
                  }
                }
              }
            } catch (_) {}
          }
        }

        const usable = symbols.filter(s => Array.isArray(data[s]) && data[s].length >= 60);
        if (usable.length) {
          const counts = {};
          for (const s of usable) counts[providers[s]] = (counts[providers[s]] || 0) + 1;
          return json({
            status: "ok",
            data,
            fetchedAt: new Date().toISOString(),
            source: Object.entries(counts).map(([k,v]) => k + ": " + v).join(" + "),
            usable: usable.length,
            requested: requestedSymbols.length,
            processed: symbols.length
          }, 200, { "cache-control": "no-store" });
        }

        return json({
          status: "error",
          message: "No se pudieron obtener datos históricos de ningún proveedor.",
          requested: requestedSymbols.length,
          processed: symbols.length,
          providersTried: ["Stooq", "Yahoo Finance", "Twelve Data"]
        }, 502);
      }
      return json({ status: "ok", service: "Weekly Range Scanner PRO", build: "20261001-smartmoney-evidence-first-v1", endpoints: ["/health", "/universe", "/api?symbol=NVDA", "/api?symbols=NVDA,META,AMZN"] });
    } catch (error) {
      return json({ status: "error", message: error?.message || String(error) }, 500);
    }
  }
};

const SEC = "https://data.sec.gov";
const SEC_WWW = "https://www.sec.gov";

async function secFetch(url, env) {
  const ua = env.SEC_USER_AGENT || "WeeklyRangeScannerPRO/1.0 (https://github.com/lsifonte88-glitch/weekly-range-scanner)";
  const r = await fetch(url, {headers:{accept:"application/json, application/xml, text/xml", "user-agent":ua}});
  const text = await r.text();
  return {status:r.status, text};
}

async function secTickerDirectory(env) {
  const r = await secFetch(SEC_WWW+"/files/company_tickers.json", env);
  if(r.status!==200) throw new Error("SEC ticker map HTTP "+r.status);
  const j=JSON.parse(r.text), map={};
  for(const k of Object.keys(j)){
    const x=j[k];
    if(x?.ticker) map[String(x.ticker).toUpperCase()]={cik:String(x.cik_str).padStart(10,"0"),name:String(x.title||"").trim()};
  }
  return map;
}
async function secTickers(env) {
  const dir=await secTickerDirectory(env), map={};
  for(const [ticker,x] of Object.entries(dir)) map[ticker]=x.cik;
  return map;
}

function xmlText(xml, tag){const m=xml.match(new RegExp("<"+tag+"[^>]*>([\s\S]*?)</"+tag+">","i"));return m?m[1].replace(/<[^>]+>/g,"").trim():"";}
function xmlNum(xml, tag){const x=xmlText(xml,tag).replace(/[$,]/g,"");const n=Number(x);return Number.isFinite(n)?n:0;}
function xmlDate(xml,tag){return xmlText(xml,tag).slice(0,10);}
function insiderSignal(events){
  const buys=events.filter(e=>e.action==="BUY"), sells=events.filter(e=>e.action==="SELL");
  const buyValue=buys.reduce((s,e)=>s+(e.amount||0),0), sellValue=sells.reduce((s,e)=>s+(e.amount||0),0);
  if(buyValue>sellValue*1.5 && buyValue>0)return {signal:"BUY",count:events.length,netValue:buyValue-sellValue};
  if(sellValue>buyValue*1.5 && sellValue>0)return {signal:"SELL",count:events.length,netValue:buyValue-sellValue};
  return {signal:"NEUTRAL",count:events.length,netValue:buyValue-sellValue};
}
async function insiderData(symbol,cik,env,detail=false){
  const sub=await secFetch(SEC+"/submissions/CIK"+cik+".json",env);
  if(sub.status!==200)return {signal:"NEUTRAL",count:0,netValue:0,events:[],error:"SEC submissions HTTP "+sub.status};
  const j=JSON.parse(sub.text), r=j.filings?.recent||{}, events=[];
  for(let i=0;i<(r.form||[]).length && events.length<8 && i<4;i++){
    // Para mantener el radar dentro del límite de subrequests de Cloudflare,
    // usamos primero Form 4, que concentra las operaciones reportadas de insiders.
    if(r.form[i]!=="4")continue;
    const accession=r.accessionNumber[i], primary=r.primaryDocument[i], filingDate=r.filingDate[i], reportDate=r.reportDate?.[i]||filingDate;
    const url=SEC_WWW+"/Archives/edgar/data/"+String(Number(cik))+"/"+accession.replaceAll("-","")+"/"+primary;
    const doc=await secFetch(url,env);
    if(doc.status!==200)continue;
    const xml=doc.text;
    const names=[...xml.matchAll(/<issuerName[^>]*>([\s\S]*?)<\/issuerName>/gi)].map(m=>m[1].replace(/<[^>]+>/g,"").trim());
    const rows=[...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map(m=>m[1]);
    for(const row of rows.slice(0,6)){
      const code=xmlText(row,"transactionCode").toUpperCase(), shares=xmlNum(row,"transactionShares"), price=xmlNum(row,"transactionPricePerShare");
      let action=code==="P"?"BUY":code==="S"?"SELL":"OTHER";
      if(action==="OTHER")continue;
      events.push({source:"SEC Form "+r.form[i],date:reportDate,type:"INSIDER",actor:names[0]||symbol,action,shares,amount:shares*price,value:shares&&price?("$"+(shares*price).toFixed(0)):"",filingDate,url});
    }
  }
  const s=insiderSignal(events);
  return {...s,events:detail?events:[]};
}async function insiderFastData(symbol,cik,env){
  try{
    const sub=await secFetch(SEC+"/submissions/CIK"+cik+".json",env);
    if(sub.status!==200)return {signal:"UNAVAILABLE",count:0,netValue:0,events:[],note:"SEC submissions HTTP "+sub.status};
    const j=JSON.parse(sub.text), r=j.filings?.recent||{};
    let picked=-1;
    for(let i=0;i<(r.form||[]).length;i++){ if(r.form[i]==="4"){picked=i;break;} }
    if(picked<0)return {signal:"NEUTRAL",count:0,netValue:0,events:[],note:"SEC: sin Form 4 reciente."};
    const accession=r.accessionNumber[picked], primary=r.primaryDocument[picked], filingDate=r.filingDate[picked], reportDate=r.reportDate?.[picked]||filingDate;
    const url=SEC_WWW+"/Archives/edgar/data/"+String(Number(cik))+"/"+accession.replaceAll("-","")+"/"+primary;
    const doc=await secFetch(url,env);
    if(doc.status!==200)return {signal:"NEUTRAL",count:1,netValue:0,events:[],note:"SEC: Form 4 detectado, documento no disponible."};
    const xml=doc.text, rows=[...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map(m=>m[1]);
    const events=[];
    for(const row of rows.slice(0,8)){
      const code=xmlText(row,"transactionCode").toUpperCase(), shares=xmlNum(row,"transactionShares"), price=xmlNum(row,"transactionPricePerShare");
      const action=code==="P"?"BUY":code==="S"?"SELL":"OTHER";
      if(action==="OTHER")continue;
      events.push({source:"SEC Form 4",date:reportDate,type:"INSIDER",actor:symbol,action,shares,amount:shares*price,value:shares&&price?("$"+(shares*price).toFixed(0)):"",filingDate,url});
    }
    const s=insiderSignal(events);
    return {...s,events,note:events.length?"SEC Form 4: transacción reciente detectada.":"SEC Form 4 reciente sin compra/venta abierta P/S."};
  }catch(e){return {signal:"UNAVAILABLE",count:0,netValue:0,events:[],note:"SEC error: "+(e?.message||String(e))};}
}


const INSTITUTIONAL_MANAGERS = [
  {cik:"0001067983",name:"Berkshire Hathaway"},
  {cik:"0000093751",name:"State Street"},
  {cik:"0000102909",name:"Vanguard Group"},
  {cik:"0001086364",name:"BlackRock"}
];

function normName(s){
  return String(s||"").toUpperCase()
    .replace(/&/g," AND ").replace(/[^A-Z0-9]+/g," ")
    .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|PLC|LTD|LIMITED|HOLDINGS|HOLDING|CLASS|CL|THE)\b/g," ")
    .replace(/\s+/g," ").trim();
}
function nameMatches(a,b){
  const x=normName(a), y=normName(b);
  if(!x||!y)return false;
  if(x===y||x.includes(y)||y.includes(x))return true;
  const xa=new Set(x.split(" ").filter(w=>w.length>2)), ya=new Set(y.split(" ").filter(w=>w.length>2));
  let hit=0; for(const w of xa) if(ya.has(w)) hit++;
  return hit>=Math.min(3,Math.max(2,Math.ceil(Math.min(xa.size,ya.size)*0.6)));
}
async function sec13fRecent(cik,env,limit=2){
  const sub=await secFetch(SEC+"/submissions/CIK"+String(cik).padStart(10,"0")+".json",env);
  if(sub.status!==200)return [];
  let j; try{j=JSON.parse(sub.text);}catch(_){return [];}
  const r=j.filings?.recent||{}, out=[], seen=new Set();
  for(let i=0;i<(r.form||[]).length && out.length<limit;i++){
    if(r.form[i]!=="13F-HR")continue;
    const reportDate=r.reportDate?.[i]||"", acc=r.accessionNumber?.[i], filingDate=r.filingDate?.[i]||"";
    if(!reportDate||!acc||seen.has(reportDate))continue;
    const base=SEC_WWW+"/Archives/edgar/data/"+String(Number(cik))+"/"+acc.replaceAll("-","");
    // The SEC submission text contains the 13F information table itself.
    // Using the complete filing avoids guessing the auxiliary XML filename.
    const doc=await secFetch(base+"/"+acc+".txt",env);
    if(doc.status!==200)continue;
    const rows=parse13f(doc.text);
    if(!rows.length)continue;
    seen.add(reportDate);
    out.push({cik,manager:j.name||"Institutional manager",filingDate,reportDate,accession:acc,url:base+"/"+acc+".txt",xml:doc.text,rows});
  }
  return out;
}
function parse13f(xml){
  const text=String(xml||"");
  const rows=[...text.matchAll(/<(?:ns1:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:ns1:)?infoTable>/gi)].map(m=>m[1]);
  return rows.map(row=>{
    const issuer=xmlText(row,"nameOfIssuer")||xmlText(row,"issuerName");
    const value=xmlNum(row,"value");
    const shares=xmlNum(row,"sshPrnamt");
    const type=xmlText(row,"sshPrnamtType")||"SH";
    const putCall=xmlText(row,"putCall");
    return {issuer,value,shares,type,putCall};
  }).filter(x=>x.issuer);
}

async function institutionalSnapshot(env){
  const out=[];
  for(const m of INSTITUTIONAL_MANAGERS){
    const x=await sec13fRecent(m.cik,env,2);
    if(x.length)out.push(...x);
  }
  return out;
}
function institutionalForName(name,snap,detail=false){
  const byManager={};
  for(const m of snap||[]){
    const matches=(m.rows||[]).filter(r=>nameMatches(r.issuer,name));
    if(!matches.length)continue;
    const key=m.manager||m.cik;
    if(!byManager[key])byManager[key]=[];
    byManager[key].push({...m,matches});
  }
  const events=[], managers=[];
  let score=0;
  for(const [manager,arr] of Object.entries(byManager)){
    arr.sort((a,b)=>String(b.reportDate).localeCompare(String(a.reportDate)));
    const latest=arr[0], previous=arr[1];
    const cur=latest.matches.reduce((s,r)=>s+Number(r.value||0),0);
    const prev=previous?previous.matches.reduce((s,r)=>s+Number(r.value||0),0):0;
    let action="HOLDING", delta=0;
    if(!previous){ action=cur>0?"NEW":"HOLDING"; }
    else if(cur===0&&prev>0){ action="EXITED"; delta=-prev; }
    else if(cur>prev*1.10){ action=prev>0?"INCREASED":"NEW"; delta=cur-prev; }
    else if(cur<prev*0.90){ action=cur>0?"DECREASED":"EXITED"; delta=cur-prev; }
    else { action="HOLDING"; delta=cur-prev; }
    if(action==="INCREASED"||action==="NEW")score+=1;
    if(action==="DECREASED"||action==="EXITED")score-=1;
    managers.push({manager,action,currentValue:cur,previousValue:prev,delta,reportDate:latest.reportDate,previousReportDate:previous?.reportDate||""});
    const baseEvent={source:"SEC 13F",type:"INSTITUTIONAL",actor:manager,action,date:latest.reportDate,filingDate:latest.filingDate,value:cur,previousValue:prev,delta,issuer:latest.matches[0].issuer,url:latest.url};
    events.push(baseEvent);
  }
  const signal=score>0?"BUY":score<0?"SELL":events.length?"HOLDING":"NEUTRAL";
  return {signal,score,filers:managers.length,value:managers.reduce((s,m)=>s+m.currentValue,0),managers,events:detail?events.slice(0,20):[],note:events.length?"Cambio vs. 13F anterior; 13F sigue siendo un dato con rezago, no flujo en tiempo real.":"No matching 13F holding found in the configured manager sample."};
}

async function yahooOptionsFlow(symbol,env,detail=false){
  try{
    const url="https://query2.finance.yahoo.com/v7/finance/options/"+encodeURIComponent(symbol);
    const r=await fetch(url,{headers:{accept:"application/json","user-agent":"Mozilla/5.0"}});
    if(!r.ok)return null;
    const j=await r.json();
    const result=j?.optionChain?.result?.[0];
    const opt=result?.options?.[0];
    const calls=Array.isArray(opt?.calls)?opt.calls:[], puts=Array.isArray(opt?.puts)?opt.puts:[];
    if(!calls.length&&!puts.length)return null;
    const sum=(a,k)=>a.reduce((s,x)=>s+(Number(x?.[k])||0),0);
    const callVolume=sum(calls,"volume"),putVolume=sum(puts,"volume"),callOI=sum(calls,"openInterest"),putOI=sum(puts,"openInterest");
    const ratio=putVolume?callVolume/putVolume:null, oiRatio=putOI?callOI/putOI:null;
    let signal="NEUTRAL";
    if(ratio!=null&&ratio>=1.5)signal="CALL_HEAVY"; else if(ratio!=null&&ratio<=0.67)signal="PUT_HEAVY";
    return {enabled:true,signal,expiration:new Date((Number(result.expirationDates?.[0])||0)*1000).toISOString().slice(0,10),contracts:calls.length+puts.length,callVolume,putVolume,callOpenInterest:callOI,putOpenInterest:putOI,callPutRatio:ratio,callPutOIRatio:oiRatio,source:"Yahoo Finance",note:"Options chain; volumen y open interest, no distingue apertura/cierre.",asOf:new Date().toISOString()};
  }catch(_){return null}
}
async function optionsFlowData(symbol,env){
  try{
    const ex=await td('/options/expiration?symbol='+encodeURIComponent(symbol),env);
    const dates=ex.data?.dates||ex.data?.values||ex.data?.data||[];
    const expiration=dates.map(x=>typeof x==='string'?x:(x.expiration_date||x.date||x.expiration)).filter(Boolean).sort()[0];
    if(expiration){
      const r=await td('/options/chain?symbol='+encodeURIComponent(symbol)+'&expiration_date='+encodeURIComponent(expiration),env);
      const raw=r.data?.options||r.data?.data||r.data?.values||r.data?.result||[];
      const rows=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?Object.values(raw).flat():[]);
      let callVolume=0,putVolume=0,callOI=0,putOI=0;
      for(const x of rows){
        const side=String(x.side||x.type||x.option_type||x.contract_type||'').toUpperCase(),vol=Number(x.volume??x.trade_volume??0)||0,oi=Number(x.open_interest??x.openInterest??x.oi??0)||0;
        if(side==='CALL'||side.includes('CALL')){callVolume+=vol;callOI+=oi}
        else if(side==='PUT'||side.includes('PUT')){putVolume+=vol;putOI+=oi}
      }
      if(callVolume+putVolume+callOI+putOI>0){
        const ratio=putVolume?callVolume/putVolume:null,oiRatio=putOI?callOI/putOI:null;
        let signal='NEUTRAL'; if(ratio!=null&&ratio>=1.5)signal='CALL_HEAVY'; else if(ratio!=null&&ratio<=.67)signal='PUT_HEAVY';
        return {enabled:true,signal,expiration,contracts:rows.length,callVolume,putVolume,callOpenInterest:callOI,putOpenInterest:putOI,callPutRatio:ratio,callPutOIRatio:oiRatio,source:"Twelve Data",note:"Options chain; volumen y open interest, no distingue apertura/cierre.",asOf:new Date().toISOString()};
      }
    }
  }catch(_){}
  const yahoo=await yahooOptionsFlow(symbol,env);
  return yahoo || {enabled:false,signal:"UNAVAILABLE",expiration:"",contracts:0,callVolume:0,putVolume:0,callOpenInterest:0,putOpenInterest:0,callPutRatio:null,callPutOIRatio:null,source:"Unavailable",note:"No hay datos de opciones disponibles en los proveedores configurados",asOf:new Date().toISOString()};
}
function avg(values){const a=(values||[]).map(Number).filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}
function pct(current,previous){const c=Number(current),p=Number(previous);return Number.isFinite(c)&&Number.isFinite(p)&&p!==0?((c/p)-1)*100:0;}
function unusualSignal(v){
  const a=(v||[]).slice(-25); if(a.length<8)return {signal:"NEUTRAL",score:0,rvol:0,priceChange:0,volumeChange:0,reason:"Insufficient history"};
  const last=a.at(-1), prev=a.slice(0,-1), avgVol=avg(prev.slice(-20).map(x=>x.volume)), rv=avgVol?last.volume/avgVol:0;
  const p5=a.length>5?pct(last.close,a.at(-6).close):0;
  const p20=a.length>20?pct(last.close,a.at(-21).close):p5;
  const avgDollar=avg(prev.slice(-20).map(x=>x.close*x.volume)), dollar=last.close*last.volume, dv=avgDollar?dollar/avgDollar:0;
  let s=0,why=[];
  if(rv>=3){s+=35;why.push("RVOL ≥3x")}else if(rv>=2){s+=25;why.push("RVOL ≥2x")}else if(rv>=1.5){s+=15;why.push("RVOL ≥1.5x")}
  if(p5>=4){s+=25;why.push("subida 5D ≥4%")}else if(p5>=2){s+=15;why.push("subida 5D ≥2%")}else if(p5<=-4){s-=25;why.push("bajada 5D ≥4%")}else if(p5<=-2){s-=15;why.push("bajada 5D ≥2%")}
  if(dv>=2){s+=10*(p5>=0?1:-1);why.push("$ volumen ≥2x promedio")}else if(dv>=1.5){s+=5*(p5>=0?1:-1);why.push("$ volumen ≥1.5x promedio")}
  if(last.close>last.open&&rv>=1.5){s+=10;why.push("volumen confirma subida")}
  if(last.close<last.open&&rv>=1.5){s-=10;why.push("volumen confirma bajada")}
  s=Math.max(-100,Math.min(100,s));
  return {signal:s>=35?"UNUSUAL_UP":s<=-20?"UNUSUAL_DOWN":"NORMAL",score:s,rvol:rv,volumeChange:dv,priceChange:p5,priceChange20:p20,reason:why.join(" · ")||"Sin anomalía de volumen relevante"};
}
function unusualFromValues(v,source){
  const out=unusualSignal(v);
  return {...out,source,asOf:(v?.at(-1)?.datetime||"")};
}
async function unusualData(symbol,env,history=null){
  const h=history||await smartHistory(symbol,env,25);
  if(!h.values.length)return {signal:"UNAVAILABLE",score:0,rvol:0,source:h.source,note:"No hay histórico disponible"};
  return unusualFromValues(h.values.slice(-25),h.source);
}
async function providerGet(url,env,headers={}){
  if(!url)return null;
  try{const r=await fetch(url,{headers:{accept:"application/json",...headers}});const text=await r.text();if(!r.ok)return {error:"HTTP "+r.status};return JSON.parse(text);}catch(e){return {error:e.message};}
}
async function congressData(symbol,env,detail=false){
  if(env.QUIVER_API_KEY){
    const u="https://api.quiverquant.com/beta/historical/congresstrading/"+encodeURIComponent(symbol);
    const j=await providerGet(u,env,{authorization:"Bearer "+env.QUIVER_API_KEY});
    if(Array.isArray(j)){
      const events=j.slice(0,20).map(x=>({source:"Quiver Quantitative",type:"CONGRESS",actor:x.Representative||x.Politician||"",action:String(x.Transaction||"").toUpperCase().includes("SELL")?"SELL":"BUY",date:x.TransactionDate||x.TradeDate||"",filingDate:x.ReportDate||"",value:x.Amount||x.Range||"",chamber:x.House||x.Chamber||"",url:"https://api.quiverquant.com/beta/historical/congresstrading/"+encodeURIComponent(symbol)}));
      const buys=events.filter(e=>e.action==="BUY").length,sells=events.filter(e=>e.action==="SELL").length;
      return {signal:buys>sells?"BUY":sells>buys?"SELL":"NEUTRAL",count:events.length,buys,sells,events:detail?events:[],note:"Datos de divulgaciones del Congreso; pueden tener retraso de reporte."};
    }
  }
  if(env.CONGRESS_API_URL){
    const sep=env.CONGRESS_API_URL.includes("?")?"&":"?";
    const j=await providerGet(env.CONGRESS_API_URL+sep+"symbol="+encodeURIComponent(symbol),env);
    const events=Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[]);
    if(events.length)return {signal:"NEUTRAL",count:events.length,buys:0,sells:0,events:detail?events.slice(0,20):[],note:"Proveedor externo configurado; revisar esquema del proveedor."};
  }
  return {signal:"NEUTRAL",count:0,buys:0,sells:0,events:[],note:"Configura QUIVER_API_KEY o CONGRESS_API_URL para datos de Congreso."};
}
async function etfData(symbol,env,detail=false){
  if(!env.ETF_PROVIDER_URL && env.ETF_COMPOSITION_ENABLED!=="true")return {signal:"NEUTRAL",holdings:[],note:"ETF composition desactivada para evitar consumo alto de créditos."};
  if(env.ETF_PROVIDER_URL){
    const sep=env.ETF_PROVIDER_URL.includes("?")?"&":"?";
    const j=await providerGet(env.ETF_PROVIDER_URL+sep+"symbol="+encodeURIComponent(symbol),env);
    const holdings=Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:(j?.holdings||[]));
    return {signal:holdings.length?"EXPOSURE":"NEUTRAL",count:holdings.length,holdings:detail?holdings.slice(0,20):[],note:"Proveedor ETF configurado."};
  }
  try{
    const r=await td("/etfs/world/composition?symbol="+encodeURIComponent(symbol),env);
    if(r.httpStatus!==200||r.data?.status==="error")return {signal:"NEUTRAL",holdings:[],note:r.data?.message||"ETF composition unavailable"};
    const h=r.data?.etf?.composition?.top_holdings||[];
    return {signal:h.length?"EXPOSURE":"NEUTRAL",count:h.length,holdings:detail?h.slice(0,20):[],note:"Twelve Data ETF composition; endpoint premium de alto consumo."};
  }catch(e){return {signal:"NEUTRAL",holdings:[],note:e.message};}
}


async function unusualWhalesCapitalFlow(symbol, env) {
  const key = env.UNUSUAL_WHALES_API_KEY;
  if (!key) {
    return {
      enabled:false, score:0, signal:"UNAVAILABLE",
      optionsPremium:0, callPremium:0, putPremium:0,
      darkPoolPremium:0, darkPoolTrades:0,
      note:"UNUSUAL_WHALES_API_KEY no configurada."
    };
  }

  const base = "https://api.unusualwhales.com";
  async function uwGet(path) {
    const r = await fetchWithTimeout(base + path, {
      method:"GET",
      headers:{
        accept:"application/json",
        authorization:"Bearer " + key
      }
    }, 4500);
    if (!r.ok) return null;
    return await r.json();
  }

  try {
    const [flowResp, darkResp] = await Promise.all([
      uwGet("/api/stock/" + encodeURIComponent(symbol) + "/flow-recent"),
      uwGet("/api/darkpool/" + encodeURIComponent(symbol))
    ]);

    const flow = Array.isArray(flowResp?.data) ? flowResp.data : [];
    const dark = Array.isArray(darkResp?.data) ? darkResp.data : [];

    let callPremium=0, putPremium=0, callAsk=0, putBid=0, callBid=0, putAsk=0;
    for (const x of flow) {
      callPremium += Number(x.call_premium || 0);
      putPremium += Number(x.put_premium || 0);
      callAsk += Number(x.call_volume_ask_side || 0);
      putBid += Number(x.put_volume_bid_side || 0);
      callBid += Number(x.call_volume_bid_side || 0);
      putAsk += Number(x.put_volume_ask_side || 0);
    }

    let darkPoolPremium=0, darkPoolTrades=0, darkAboveAsk=0;
    for (const x of dark.slice(0,200)) {
      const premium=Number(x.premium || 0);
      const price=Number(x.price || 0);
      const ask=Number(x.nbbo_ask || 0);
      darkPoolPremium += premium;
      darkPoolTrades++;
      if (ask>0 && price>=ask) darkAboveAsk++;
    }

    const optionPremium = callPremium + putPremium;
    const callShare = optionPremium>0 ? callPremium/optionPremium : 0.5;
    const askBidPressure = (callAsk + putBid + callBid + putAsk)>0
      ? (callAsk + putBid)/(callAsk + putBid + callBid + putAsk)
      : 0.5;

    let score=50;
    score += (callShare-0.5)*45;
    score += (askBidPressure-0.5)*35;
    if (darkPoolPremium>0 && darkPoolTrades>0) {
      const darkPressure=darkAboveAsk/darkPoolTrades;
      score += (darkPressure-0.5)*20;
    }
    score=Math.max(0,Math.min(100,Math.round(score)));

    const signal=score>=70?"CAPITAL_INFLOW":score<=30?"CAPITAL_OUTFLOW":"CAPITAL_MIXED";
    return {
      enabled:true, score, signal,
      optionsPremium:optionPremium,
      callPremium, putPremium,
      callAsk, putBid, callBid, putAsk,
      darkPoolPremium, darkPoolTrades, darkAboveAsk,
      source:"Unusual Whales",
      note:"Options flow + dark-pool activity. Es flujo de mercado, no prueba por sí solo identidad institucional."
    };
  } catch (e) {
    return {
      enabled:true, score:0, signal:"ERROR",
      optionsPremium:0, callPremium:0, putPremium:0,
      darkPoolPremium:0, darkPoolTrades:0,
      source:"Unusual Whales",
      note:"Proveedor no disponible en este ciclo: " + (e?.message || String(e))
    };
  }
}

function marketFlowFromValues(v,source){
  if(!Array.isArray(v)||v.length<22)return {signal:"UNAVAILABLE",score:0,note:"Insufficient history",source};
  const last=v.at(-1), prev=v.slice(0,-1), av=avg(prev.slice(-20).map(x=>x.volume)), rvol=av?last.volume/av:0;
  const dollar=last.close*last.volume, adv=avg(prev.slice(-20).map(x=>x.close*x.volume)), dollarRel=adv?dollar/adv:0;
  const p5=pct(last.close,v.at(-6)?.close), p20=pct(last.close,v.at(-21)?.close);
  const upVol=v.slice(-20).filter(x=>x.close>x.open).reduce((s,x)=>s+x.volume,0), downVol=v.slice(-20).filter(x=>x.close<x.open).reduce((s,x)=>s+x.volume,0);
  const imbalance=(upVol+downVol)?(upVol-downVol)/(upVol+downVol):0;
  // El desequilibrio de volumen/dólares tiene más peso que el precio cuando hay divergencia.
  // Evita etiquetar como INFLOW una subida de precio acompañada por distribución clara.
  let score=0;
  score += p5>0?1:-1;
  score += p20>0?1:-1;
  if(imbalance>0.20) score+=2;
  else if(imbalance>0.10) score+=1;
  else if(imbalance<-0.20) score-=2;
  else if(imbalance<-0.10) score-=1;
  if(rvol>=1.5) score += p5>=0?1:-1;
  score=Math.max(-5,Math.min(5,score));

  let signal;
  // Divergencia real = actividad anormal. Un score 0 sin divergencia es simplemente neutral.
  if(imbalance<=-0.20 && p5>0) signal="ABNORMAL_ACTIVITY";
  else if(imbalance>=0.20 && p5<0) signal="ABNORMAL_ACTIVITY";
  else signal=score>=3?"STRONG_INFLOW":score>=1?"INFLOW":score<=-3?"STRONG_OUTFLOW":score<=-1?"OUTFLOW":"NEUTRAL";
  return {signal,score,rvol,dollarRel,priceChange5D:p5,priceChange20D:p20,volumeImbalance:imbalance,source,asOf:last.datetime||"",note:"Proxy precio + volumen; no identifica por sí solo al comprador institucional."};
}
async function marketFlowData(symbol,env,history=null){
  const h=history||await smartHistory(symbol,env,25);
  return marketFlowFromValues(h.values,h.source);
}
function confluenceScore(parts){
  const vals=[parts.market,parts.insider,parts.institutional,parts.congress,parts.options].filter(Number.isFinite);
  const s=vals.reduce((a,b)=>a+b,0);
  const aligned=vals.filter(x=>x>0).length, opposed=vals.filter(x=>x<0).length;
  const confidence=aligned+opposed<2?"LOW":(aligned>=3||opposed>=3)?"HIGH":"MEDIUM";
  return {raw:s,direction:s>=3?"INFLOW":s<=-3?"OUTFLOW":"MIXED",confidence,aligned,opposed};
}
function confirmationFromSources(insider={},institutional={},congress={},options={}){
  let raw=0,max=0,evidence=[];
  if(insider.signal==="BUY"){raw+=2;max+=2;evidence.push("INSIDER BUY");}
  else if(insider.signal==="SELL"){raw-=2;max+=2;evidence.push("INSIDER SELL");}
  if(Number(institutional.score)>0){raw+=Math.min(2,Number(institutional.score));max+=2;evidence.push("13F INCREASED/NEW");}
  else if(Number(institutional.score)<0){raw-=Math.min(2,Math.abs(Number(institutional.score)));max+=2;evidence.push("13F DECREASED/EXITED");}
  if(congress.signal==="BUY"){raw+=1;max+=1;evidence.push("CONGRESS BUY");}
  else if(congress.signal==="SELL"){raw-=1;max+=1;evidence.push("CONGRESS SELL");}
  if(options.signal==="CALL_HEAVY"){raw+=1;max+=1;evidence.push("CALL HEAVY");}
  else if(options.signal==="PUT_HEAVY"){raw-=1;max+=1;evidence.push("PUT HEAVY");}
  if(!max)return {score:0,signal:"NO_CONFIRMATION",confidence:"LOW",evidence:[],note:"No hay evidencia institucional/insider/opciones/Congreso confirmable en este ciclo."};
  const score=Math.max(0,Math.min(100,Math.round(50+(raw/max)*50)));
  const signal=raw>0?"CONFIRMED_INFLOW":raw<0?"CONFIRMED_OUTFLOW":"MIXED";
  const confidence=max>=4&&Math.abs(raw)>=3?"HIGH":max>=2?"MEDIUM":"LOW";
  return {score,signal,confidence,evidence,note:"Confirmación separada del Opportunity Score; 13F es trimestral y rezagado."};
}
function atrPercentFromValues(v, period=14) {
  if(!Array.isArray(v) || v.length<period+1) return {atr:0,atrPct:0};
  const trs=[];
  for(let i=1;i<v.length;i++){
    const h=Number(v[i].high)||0, l=Number(v[i].low)||0, pc=Number(v[i-1].close)||0;
    if(h<=0 || l<=0 || pc<=0) continue;
    trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
  }
  const recent=trs.slice(-period);
  const atr=recent.length?avg(recent):0;
  const close=Number(v.at(-1)?.close)||0;
  const atrPct=close>0?(atr/close)*100:0;
  return {atr,atrPct};
}

function earlySmartMoneyFromValues(v, source) {
  if (!Array.isArray(v) || v.length < 25) return {signal:"UNAVAILABLE",score:0,source,note:"Insufficient history"};
  const last=v.at(-1), prev=v.slice(0,-1);
  const avgVol20=avg(prev.slice(-20).map(x=>x.volume));
  const rvol=avgVol20?last.volume/avgVol20:0;
  const avgDollar20=avg(prev.slice(-20).map(x=>x.close*x.volume));
  const dollarRel=avgDollar20?(last.close*last.volume)/avgDollar20:0;
  const p3=pct(last.close,v.at(-4)?.close),p5=pct(last.close,v.at(-6)?.close),p10=pct(last.close,v.at(-11)?.close),p20=pct(last.close,v.at(-21)?.close);
  const atrInfo=atrPercentFromValues(v,14);
  const atr=atrInfo.atr, atrPct=atrInfo.atrPct;
  if(!Number.isFinite(atrPct) || atrPct<3){ return {signal:"DISCARDED_ATR",score:0,opportunityScore:0,atr,atrPct,rvol,dollarRel,source,reasons:["ATR(14) < 3%"],note:"Descartada: capacidad de movimiento insuficiente para el swing."}; }
  const last20=v.slice(-20);
  const totalPV=last20.reduce((s,x)=>s+(((x.high+x.low+x.close)/3)*x.volume),0);
  const totalVol=last20.reduce((s,x)=>s+x.volume,0);
  const vwap=totalVol?totalPV/totalVol:last.close;
  const vwapDistance=vwap?((last.close/vwap)-1)*100:0;
  const rangeHigh=Math.max(...last20.map(x=>Number(x.high)||0));
  const rangeLow=Math.min(...last20.map(x=>Number(x.low)||0));
  const rangeWidth=rangeHigh-rangeLow;
  const rangePosition=rangeWidth>0?((last.close-rangeLow)/rangeWidth)*100:50;
  const prior20=v.slice(-21,-1);
  const prior20High=prior20.length?Math.max(...prior20.map(x=>Number(x.high)||0)):rangeHigh;
  const breakoutExtension=prior20High>0?((last.close/prior20High)-1)*100:0;
  const recent=v.slice(-10);
  let upDollar=0,downDollar=0;
  for(const x of recent){
    const d=x.close*x.volume;
    if(x.close>x.open) upDollar+=d;
    else if(x.close<x.open) downDollar+=d;
  }
  const dollarImbalance=upDollar+downDollar>0?(upDollar-downDollar)/(upDollar+downDollar):0;
  const rvolSeries=[];
  for(let i=Math.max(1,v.length-6);i<v.length;i++){
    const h=v.slice(Math.max(0,i-20),i),av=avg(h.map(x=>x.volume));
    if(av>0) rvolSeries.push(v[i].volume/av);
  }
  const previousRVOL=avg(rvolSeries.slice(0,-1));
  const rvolAcceleration=previousRVOL>0?rvol/previousRVOL:1;

  let score=0;
  const reasons=[];

  if(dollarRel>=1.15&&dollarRel<=2.5){score+=18;reasons.push("$ volumen creciendo");}
  else if(dollarRel>2.5&&dollarRel<=4){score+=8;reasons.push("$ volumen ya acelerado");}
  else if(dollarRel>4){score-=8;reasons.push("$ volumen demasiado acelerado");}

  if(rvol>=1.15&&rvol<2){score+=12;reasons.push("RVOL temprano");}
  else if(rvol>=2&&rvol<=3){score+=7;reasons.push("RVOL confirmado");}
  else if(rvol>3){score-=6;reasons.push("RVOL tardío/extremo");}

  if(rvolAcceleration>=1.10&&rvolAcceleration<=1.60){score+=15;reasons.push("RVOL acelerando desde base");}
  else if(rvolAcceleration>1.60){score+=5;reasons.push("RVOL aceleración fuerte");}

  if(dollarImbalance>=.20){score+=18;reasons.push("acumulación compradora");}
  else if(dollarImbalance>=.10){score+=9;reasons.push("sesgo comprador");}
  else if(dollarImbalance<=-.20){score-=20;reasons.push("distribución");}
  else if(dollarImbalance<=-.10){score-=10;reasons.push("sesgo vendedor");}

  if(p5>=0&&p5<=3){score+=12;reasons.push("momentum temprano");}
  else if(p5>3&&p5<=6){score+=5;reasons.push("momentum en aceleración");}
  else if(p5>6&&p5<=10){score-=5;reasons.push("movimiento avanzado");}
  else if(p5>10){score-=18;reasons.push("movimiento demasiado extendido");}
  else if(p5<-4){score-=12;reasons.push("momentum débil");}

  if(p10>=0&&p10<=6){score+=8;reasons.push("avance 10D contenido");}
  else if(p10>10){score-=8;reasons.push("avance 10D avanzado");}

  if(p20>15){score-=15;reasons.push("subida 20D demasiado avanzada");}
  else if(p20>10){score-=8;reasons.push("subida 20D avanzada");}

  // Penalización estructural: evita confundir una acción que ya está en la parte
  // alta del rango con acumulación temprana, aunque su 5D todavía parezca moderado.
  if(rangePosition>=90 && p5>2){score-=16;reasons.push("parte alta del rango");}
  else if(rangePosition>=82 && p5>3){score-=10;reasons.push("rango avanzado");}
  if(breakoutExtension>=2){score-=14;reasons.push("ruptura ya extendida");}
  else if(breakoutExtension>=0.5){score-=6;reasons.push("sobre máximo previo");}

  if(vwapDistance>=-1&&vwapDistance<=2.5){score+=12;reasons.push("cerca de VWAP");}
  else if(vwapDistance>2.5&&vwapDistance<=5){score+=3;reasons.push("sobre VWAP moderadamente");}
  else if(vwapDistance>5&&vwapDistance<=7){score-=8;reasons.push("extendida sobre VWAP");}
  else if(vwapDistance>7){score-=18;reasons.push("muy extendida sobre VWAP");}
  else if(vwapDistance<-3){score-=5;reasons.push("bajo VWAP");}

  score=Math.max(0,Math.min(100,Math.round(score)));
  const signal=score>=75?"EARLY_ACCUMULATION":score>=60?"DEVELOPING":score<=35?"LATE_OR_WEAK":"NEUTRAL";
  return {signal,score,rvol,dollarRel,dollarImbalance,rvolAcceleration,priceChange3D:p3,priceChange5D:p5,priceChange10D:p10,priceChange20D:p20,atr,atrPct,vwap,vwapDistance,rangePosition,breakoutExtension,source,reasons,note:"Modelo de acumulación temprana + filtro duro ATR(14) >= 3%; prioriza acciones con capacidad real de movimiento para swings."};
}
async function smartMoneyFastData(symbol,env,secDirectory={},institutionalSnap=[]){
  // RADAR: el FAST debe detectar movimiento temprano usando precio/volumen.
  // La evidencia institucional/insider se mantiene separada y se confirma después.
  const issuerName=secDirectory?.[symbol]?.name||symbol;
  const cik=secDirectory?.[symbol]?.cik;
  const institutional=institutionalForName(issuerName,institutionalSnap,false);

  // Un histórico diario por símbolo. Stooq suele resolverlo en una sola petición;
  // Yahoo/Twelve Data quedan como fallback dentro de smartHistory().
  const history=await smartHistory(symbol,env,25);
  const values=Array.isArray(history.values)?history.values:[];
  const source=history.source||"Unavailable";
  const marketFlow=marketFlowFromValues(values,source);
  const unusual=values.length?unusualFromValues(values.slice(-25),source):{signal:"UNAVAILABLE",score:0,rvol:0,source,note:"No hay histórico disponible"};
  const earlySmartMoney=values.length?earlySmartMoneyFromValues(values,source):{signal:"UNAVAILABLE",score:0,source,note:"No hay histórico disponible"};
  // Capital Flow de pago (Unusual Whales) eliminado. El radar debe funcionar
  // completamente con fuentes gratuitas/publicas.
  const capitalFlow={
    enabled:false,score:0,signal:"FREE_MODEL",
    source:"Free price/volume model",
    note:"Sin Unusual Whales: la presión de capital se infiere con precio, volumen, RVOL, VWAP y estructura."
  };

  const insider={signal:"DEFERRED",count:0,netValue:0,events:[],note:"Form 4 se confirma solo en el Top 3."};
  const options={enabled:false,signal:"DEFERRED",expiration:"",contracts:0,callVolume:0,putVolume:0,callOpenInterest:0,putOpenInterest:0,callPutRatio:null,callPutOIRatio:null,source:"Deferred",note:"Opciones se confirman solo en el Top 3."};
  const congress={signal:"DEFERRED",count:0,buys:0,sells:0,events:[],note:"Congreso se confirma solo en el Top 3."};

  // 13F es evidencia institucional rezagada; no se mezcla con el detector temprano.
  const managers=Number(institutional.filers||0);
  const institutionalDelta=Number(institutional.score||0);
  let institutionalScore=0;
  if(managers>0){
    institutionalScore=50 + managers*7 + institutionalDelta*12;
    institutionalScore=Math.max(0,Math.min(100,Math.round(institutionalScore)));
  }

  // Opportunity = probabilidad/estructura de movimiento temprano basada en precio+volumen.
  // smartMoneyScore = evidencia institucional disponible. Son métricas distintas.
  const earlyScore=Number(earlySmartMoney.score||0);
  // Opportunity es una señal LONG de swing, no un score de actividad genérica.
  // Si el Market Flow contradice la dirección, la oportunidad debe bajar aunque
  // el modelo temprano detecte actividad. Esto evita casos como TOST:
  // Opportunity alto + STRONG_OUTFLOW.
  let opportunityScore=earlyScore;
  if(marketFlow.signal==="STRONG_OUTFLOW"){
    opportunityScore=Math.min(opportunityScore,35);
  } else if(marketFlow.signal==="OUTFLOW"){
    opportunityScore=Math.min(opportunityScore,50);
  } else if(marketFlow.signal==="STRONG_INFLOW"){
    opportunityScore=Math.min(100,opportunityScore+5);
  } else if(marketFlow.signal==="INFLOW"){
    opportunityScore=Math.min(100,opportunityScore+2);
  }
  opportunityScore=Math.max(0,Math.min(100,Math.round(opportunityScore)));
  const flowDirection=marketFlow.signal==="STRONG_INFLOW"||marketFlow.signal==="INFLOW"
    ?"INFLOW":marketFlow.signal==="STRONG_OUTFLOW"||marketFlow.signal==="OUTFLOW"
    ?"OUTFLOW":"MIXED";
  const reasons=[...(earlySmartMoney.reasons||[])];
  if(marketFlow.signal&&marketFlow.signal!=="UNAVAILABLE") reasons.push("Market Flow: "+marketFlow.signal);
  if(marketFlow.signal==="STRONG_OUTFLOW") reasons.push("OPPORTUNITY PENALIZADA: flujo contrario");
  else if(marketFlow.signal==="OUTFLOW") reasons.push("Opportunity limitada por flujo vendedor");
  if(institutional.filers) reasons.push("13F: "+institutional.filers+" managers · "+institutional.signal);
  reasons.push("Early raw "+earlyScore+" → Opportunity "+opportunityScore+" · modelo gratuito");
  if(!reasons.length) reasons.push("Sin datos suficientes en este ciclo");

  return {
    symbol,
    score:opportunityScore,
    opportunityScore,
    earlyRawScore:earlyScore,
    smartMoneyScore:institutionalScore,
    flowDirection,
    institutional,
    marketFlow,
    unusual,
    insider,
    congress,
    options,
    confirmation:{score:0,signal:"NO_CONFIRMATION",confidence:"LOW",evidence:[],note:"La confirmación SEC/Form 4, opciones y Congreso se ejecuta después sobre el Top 3."},
    reasons,
    etf:{signal:"DEFERRED",holdings:[],note:"Composición ETF no participa en el score."},
    technical:{signal:flowDirection==="INFLOW"?"BULLISH_FLOW":flowDirection==="OUTFLOW"?"BEARISH_FLOW":"MIXED"},
    earlySmartMoney,
    capitalFlow,
    freshness:{market:source==="Unavailable"?"UNAVAILABLE":"DAILY",insider:"DEFERRED",institutional:institutional.filers?"LAGGED":"UNAVAILABLE",congress:"DEFERRED",options:"DEFERRED"},
    dataQuality:[institutional.filers?institutional.filers+" 13F":"sin 13F","market flow "+(source!=="Unavailable"?source:"unavailable"),"Form 4 diferido","opciones diferidas","Congreso diferido"].join(" · "),
    mode:"FAST_EARLY_FLOW",
    asOf:new Date().toISOString(),
    events:[]
  };
}

async function smartMoneyData(symbol,env,detail=false,institutionalSnap=[],issuerName="",secMap=null){
  const map=secMap||await secTickers(env), cik=map[symbol];
  let insider={signal:"NEUTRAL",count:0,netValue:0,events:[],error:cik?null:"Ticker not found in SEC map"};
  if(cik) insider=await insiderData(symbol,cik,env,detail);
  const institutional=institutionalForName(issuerName||symbol,institutionalSnap,detail);
  const congress=await congressData(symbol,env,detail);
  const history=await smartHistory(symbol,env,25);
  const unusual=unusualData(symbol,env,history);
  const marketFlow=marketFlowData(symbol,env,history);
  const options=await optionsFlowData(symbol,env);
  const isEtf=Boolean(issuerName && /ETF|TRUST|FUND/i.test(issuerName)) || /^(SPY|QQQ|QQQM|IWM|DIA|XLF|XLK|VOO|VTI|SMH|SOXX|ARKK|TQQQ|SQQQ|SOXL|SOXS)$/i.test(symbol);
  const etf=isEtf?await etfData(symbol,env,detail):{signal:"N/A",holdings:[],note:"No es ETF o no aplica."};
  const technical={signal:marketFlow.signal.includes("INFLOW")?"BULLISH_FLOW":marketFlow.signal.includes("OUTFLOW")?"BEARISH_FLOW":"MIXED"};
  const component={
    market:0,
    insider:insider.signal==="BUY"?2:insider.signal==="SELL"?-2:0,
    institutional:Number(institutional.score||0),
    congress:congress.signal==="BUY"?1:congress.signal==="SELL"?-1:0,
    options:options.signal==="CALL_HEAVY"?1:options.signal==="PUT_HEAVY"?-1:0
  };
  const earlySmartMoney=earlySmartMoneyFromValues(history.values,history.source);
  const confluence=confluenceScore(component);

  // DETAIL score is evidence-first. Technical price/volume is context only.
  const managers=Number(institutional.filers||0);
  const institutionalDelta=Number(institutional.score||0);
  let institutionalScore=managers>0 ? 50 + managers*7 + institutionalDelta*12 : 0;
  institutionalScore=Math.max(0,Math.min(100,Math.round(institutionalScore)));

  const confirmation=confirmationFromSources(insider,institutional,congress,options);
  const confirmationScore=confirmation.signal==="NO_CONFIRMATION" ? 0 : Number(confirmation.score||0);
  let score=Math.round(institutionalScore*0.55 + confirmationScore*0.45);

  // No extension gate here: extension belongs to ANALIZAR, not Smart Money.
  const flowDirection=confluence.direction==="INFLOW"?"INFLOW":confluence.direction==="OUTFLOW"?"OUTFLOW":marketFlow.signal;
  const freshness={market:marketFlow.source==="Unavailable"?"UNAVAILABLE":"DAILY",insider:cik?"RECENT":"UNAVAILABLE",institutional:institutional.filers?"LAGGED":"UNAVAILABLE",congress:congress.count?"LAGGED":"UNAVAILABLE",options:options.enabled?"RECENT":"UNAVAILABLE"};
  const dataQuality=[cik?"SEC insider":"sin SEC insider",institutional.filers?institutional.filers+" 13F":"sin match 13F",congress.count?congress.count+" Congreso":"sin Congreso",options.enabled?"opciones OK":"sin opciones",marketFlow.signal!=="UNAVAILABLE"?"market flow "+marketFlow.source:"sin market flow"].join(" · ");
  const reasons=[];
  if(marketFlow.rvol>=1.5) reasons.push("RVOL "+marketFlow.rvol.toFixed(2)+"x");
  if(marketFlow.signal==="STRONG_INFLOW") reasons.push("flujo precio/volumen fuerte al alza");
  if(marketFlow.signal==="STRONG_OUTFLOW") reasons.push("flujo precio/volumen fuerte a la baja");
  if(insider.signal!=="NEUTRAL") reasons.push("insiders "+insider.signal);
  if(congress.signal!=="NEUTRAL") reasons.push("Congreso "+congress.signal);
  if(options.signal==="CALL_HEAVY"||options.signal==="PUT_HEAVY") reasons.push("opciones "+options.signal);
  if(!reasons.length) reasons.push("sin confluencia direccional suficiente");
  return {symbol,score,smartMoneyScore:score,flowDirection,marketFlow,earlySmartMoney,confluence,confirmation,reasons,insider,institutional,congress,unusual,options,etf,technical,freshness,dataQuality,asOf:new Date().toISOString(),events:detail?[...(insider.events||[]),...(institutional.events||[]),...(congress.events||[])]:[]};
}
// Deploy trigger: Smart Money FAST confirmation calls remain deferred to protect Worker subrequest budget.