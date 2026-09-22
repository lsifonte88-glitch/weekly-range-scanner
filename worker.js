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
  const response = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  const data = await response.json();
  return {
    httpStatus: response.status,
    data,
    creditsUsed: response.headers.get("api-credits-used"),
    creditsLeft: response.headers.get("api-credits-left")
  };
}

function cleanSymbols(value) {
  return [...new Set(String(value || "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean).filter(x => x !== "MSFT").filter(x => /^[A-Z0-9.-]+$/.test(x)))].slice(0, 8);
}

function normalizeBatch(symbols, raw) {
  const out = {};
  if (symbols.length === 1) { out[symbols[0]] = raw; return out; }
  for (const symbol of symbols) out[symbol] = raw?.[symbol] || { status: "error", message: "Twelve Data no devolvió datos para " + symbol };
  return out;
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
        const r = await fetch("https://raw.githubusercontent.com/lsifonte88-glitch/weekly-range-scanner/main/index.html", { cf: { cacheTtl: 60 } });
        if (!r.ok) return new Response("No se pudo cargar la aplicación.", { status: 502 });
        return new Response(await r.text(), { headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" } });
      }
      if (url.pathname === "/smart-money.js") {
        const r = await fetch("https://raw.githubusercontent.com/lsifonte88-glitch/weekly-range-scanner/main/smart-money.js", { cf: { cacheTtl: 60 } });
        if (!r.ok) return new Response("No se pudo cargar Smart Money.", { status: 502 });
        return new Response(await r.text(), { headers: { "content-type": "application/javascript; charset=UTF-8", "cache-control": "no-store" } });
      }
      if (url.pathname === "/health") return json({ status: "ok", service: "Weekly Range Scanner PRO", time: new Date().toISOString() });
      if (url.pathname === "/universe") {
        const symbols = await universe(env);
        return json({ status: "ok", count: symbols.length, symbols, generatedAt: new Date().toISOString() }, 200, { "cache-control": "public, max-age=21600" });
      }
            if (url.pathname === "/smart-money") {
        const symbols = cleanSymbols(url.searchParams.get("symbols") || url.searchParams.get("symbol"));
        if (!symbols.length) return json({status:"error",message:"Falta symbol o symbols."},400);
        const detail = url.searchParams.get("detail")==="1";
        let names={};
        try{
          const stocks=await td("/stocks?country=United%20States",env);
          for(const x of (stocks.data?.data||[])) names[String(x.symbol||"").toUpperCase()]=x.name||x.symbol;
          const etfs=await td("/etfs/list?country=United%20States&outputsize=1000",env);
          for(const x of (etfs.data?.result?.list||[])) names[String(x.symbol||"").toUpperCase()]=x.name||x.symbol;
        }catch(_){}
        const [institutionalSnap, secMap] = await Promise.all([institutionalSnapshot(env), secTickers(env)]);
        const data = await Promise.all(symbols.map(s => smartMoneyData(s,env,detail,institutionalSnap,names[s]||s,secMap)));
        return json({status:"ok",data,generatedAt:new Date().toISOString(),sources:{sec:true,twelveData:true,congress:Boolean(env.QUIVER_API_KEY||env.CONGRESS_API_URL),etf:Boolean(env.ETF_PROVIDER_URL||env.ETF_COMPOSITION_ENABLED==="true")}});
      }
if (url.pathname === "/api") {
        const symbols = cleanSymbols(url.searchParams.get("symbols") || url.searchParams.get("symbol"));
        if (!symbols.length) return json({ status: "error", message: "Falta symbol o symbols." }, 400);
        const path = "/time_series?symbol=" + encodeURIComponent(symbols.join(",")) + "&interval=1day&outputsize=5000&order=desc&timezone=America/New_York";
        const result = await td(path, env);
        if (result.httpStatus !== 200) return json({ status: "error", message: result.data?.message || "Error de Twelve Data.", details: result.data }, result.httpStatus);
        if (result.data?.status === "error") return json(result.data, 400);
        const data = normalizeBatch(symbols, result.data);
        return json({ status: "ok", data, fetchedAt: new Date().toISOString(), creditsUsed: result.creditsUsed, creditsLeft: result.creditsLeft }, 200, { "api-credits-used": result.creditsUsed || "", "api-credits-left": result.creditsLeft || "" });
      }
      return json({ status: "ok", service: "Weekly Range Scanner PRO", endpoints: ["/health", "/universe", "/api?symbol=NVDA", "/api?symbols=NVDA,META,AMZN"] });
    } catch (error) {
      return json({ status: "error", message: error?.message || String(error) }, 500);
    }
  }
};

const SEC = "https://data.sec.gov";
const SEC_WWW = "https://www.sec.gov";

async function secFetch(url, env) {
  const ua = env.SEC_USER_AGENT || "WeeklyRangeScannerPRO/1.0 contact@example.com";
  const r = await fetch(url, {headers:{accept:"application/json, application/xml, text/xml", "user-agent":ua}});
  const text = await r.text();
  return {status:r.status, text};
}

async function secTickers(env) {
  const r = await secFetch(SEC+"/files/company_tickers.json", env);
  if(r.status!==200) throw new Error("SEC ticker map HTTP "+r.status);
  const j=JSON.parse(r.text), map={};
  for(const k of Object.keys(j)){const x=j[k]; if(x?.ticker) map[String(x.ticker).toUpperCase()]=String(x.cik_str).padStart(10,"0");}
  return map;
}

function xmlText(xml, tag){const m=xml.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)</"+tag+">","i"));return m?m[1].replace(/<[^>]+>/g,"").trim():"";}
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
  for(let i=0;i<(r.form||[]).length && events.length<12;i++){
    if(!["4","3","5"].includes(r.form[i]))continue;
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
}


const INSTITUTIONAL_MANAGERS = [
  {cik:"0001067983",name:"Berkshire Hathaway"},
  {cik:"0000093751",name:"State Street"} // kept as fallback identifier; SEC submissions are validated before use
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
async function sec13fLatest(cik,env){
  const sub=await secFetch(SEC+"/submissions/CIK"+String(cik).padStart(10,"0")+".json",env);
  if(sub.status!==200)return null;
  const j=JSON.parse(sub.text), r=j.filings?.recent||{};
  for(let i=0;i<(r.form||[]).length;i++){
    if(r.form[i]!=="13F-HR")continue;
    const acc=r.accessionNumber[i], filingDate=r.filingDate[i], reportDate=r.reportDate?.[i]||"";
    const base=SEC_WWW+"/Archives/edgar/data/"+String(Number(cik))+"/"+acc.replaceAll("-","");
    const idx=await secFetch(base+"/index.json",env);
    let info="";
    if(idx.status===200){
      try{
        const ij=JSON.parse(idx.text);
        info=(ij.directory?.item||[]).map(x=>x.name||"").find(n=>/information.*table|infotable/i.test(n)&&/\.xml$/i.test(n))||"";
      }catch(_){}
    }
    if(!info){
      const hdr=await secFetch(base+"/index-headers.html",env);
      const m=hdr.text.match(/<FILENAME>([^<]*(?:information|info)[^<]*\.xml)/i);
      if(m)info=m[1];
    }
    if(!info)continue;
    const doc=await secFetch(base+"/"+info,env);
    if(doc.status!==200)continue;
    return {cik,manager:j.name||"Institutional manager",filingDate,reportDate,accession:acc,url:base+"/"+info,xml:doc.text};
  }
  return null;
}
function parse13f(xml){
  const rows=[...String(xml||"").matchAll(/<(?:ns1:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:ns1:)?infoTable>/gi)].map(m=>m[1]);
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
    const x=await sec13fLatest(m.cik,env);
    if(!x)continue;
    out.push({...x,rows:parse13f(x.xml)});
  }
  return out;
}
function institutionalForName(name,snap,detail=false){
  const events=[];
  for(const m of snap||[]){
    const matches=(m.rows||[]).filter(r=>nameMatches(r.issuer,name));
    for(const r of matches){
      events.push({
        source:"SEC 13F",type:"INSTITUTIONAL",actor:m.manager,action:r.putCall==="PUT"?"PUT":r.putCall==="CALL"?"CALL":"HOLDING",
        date:m.reportDate,filingDate:m.filingDate,value:r.value,shares:r.shares,issuer:r.issuer,url:m.url
      });
    }
  }
  const value=events.reduce((s,e)=>s+Number(e.value||0),0);
  return {signal:events.length?"HOLDING":"NEUTRAL",filers:new Set(events.map(e=>e.actor)).size,value,events:detail?events.slice(0,20):[],note:events.length?"Latest SEC 13F holdings; quarterly and not real-time.":"No matching 13F holding found in the configured manager sample."};
}

async function optionsFlowData(symbol,env){try{const ex=await td('/options/expiration?symbol='+encodeURIComponent(symbol),env);const dates=ex.data?.dates||ex.data?.values||ex.data?.data||[];const expiration=dates.map(x=>typeof x==='string'?x:(x.expiration_date||x.date||x.expiration)).filter(Boolean).sort()[0];if(!expiration)return {enabled:false,signal:'OFF',note:ex.data?.message||'Sin expiración de opciones disponible.'};const r=await td('/options/chain?symbol='+encodeURIComponent(symbol)+'&expiration_date='+encodeURIComponent(expiration),env);const raw=r.data?.options||r.data?.data||r.data?.values||r.data?.result||[];const rows=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?Object.values(raw).flat():[]);let callVolume=0,putVolume=0,callOI=0,putOI=0;for(const x of rows){const side=String(x.side||x.type||x.option_type||x.contract_type||'').toUpperCase(),vol=Number(x.volume??x.trade_volume??0)||0,oi=Number(x.open_interest??x.openInterest??x.oi??0)||0;if(side==='CALL'||side.includes('CALL')){callVolume+=vol;callOI+=oi}else if(side==='PUT'||side.includes('PUT')){putVolume+=vol;putOI+=oi}}const ratio=putVolume?callVolume/putVolume:null,oiRatio=putOI?callOI/putOI:null;let signal='NEUTRAL';if(ratio!=null&&ratio>=1.5&&oiRatio!=null&&oiRatio>=1)signal='CALL_HEAVY';else if(ratio!=null&&ratio<=.67&&oiRatio!=null&&oiRatio<=1)signal='PUT_HEAVY';else if(ratio!=null&&ratio>=1.75)signal='CALL_HEAVY';else if(ratio!=null&&ratio<=.57)signal='PUT_HEAVY';return {enabled:true,signal,expiration,contracts:rows.length,callVolume,putVolume,callOpenInterest:callOI,putOpenInterest:putOI,callPutRatio:ratio,callPutOIRatio:oiRatio,note:'Twelve Data options chain; primera expiración disponible',asOf:new Date().toISOString()}}catch(e){return {enabled:false,signal:'ERROR',note:'Opciones no disponibles: '+e.message}}}

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
async function unusualData(symbol,env){
  try{
    const r=await td("/time_series?symbol="+encodeURIComponent(symbol)+"&interval=1day&outputsize=25&order=desc&timezone=America/New_York",env);
    if(r.httpStatus!==200||r.data?.status==="error")return {signal:"NEUTRAL",score:0,error:r.data?.message||"Twelve Data error"};
    const v=Array.isArray(r.data?.values)?r.data.values.slice().reverse().map(x=>({open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)})):Array.isArray(r.data)?r.data:[];
    return unusualSignal(v);
  }catch(e){return {signal:"NEUTRAL",score:0,error:e.message};}
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

async function smartMoneyData(symbol,env,detail=false,institutionalSnap=[],issuerName="",secMap=null){
  const map=secMap||await secTickers(env), cik=map[symbol];
  let insider={signal:"NEUTRAL",count:0,netValue:0,events:[],error:cik?null:"Ticker not found in SEC map"};
  if(cik) insider=await insiderData(symbol,cik,env,detail);
  const institutional=institutionalForName(issuerName||symbol,institutionalSnap,detail);
  const congress=await congressData(symbol,env,detail);
  const unusual=await unusualData(symbol,env); const options=await optionsFlowData(symbol,env);
  const isEtf=Boolean(issuerName && /ETF|TRUST|FUND/i.test(issuerName)) || /^(SPY|QQQ|QQQM|IWM|DIA|XLF|XLK|VOO|VTI|SMH|SOXX|ARKK|TQQQ|SQQQ|SOXL|SOXS)$/i.test(symbol);
  const etf=isEtf?await etfData(symbol,env,detail):{signal:"N/A",holdings:[],note:"No es ETF o no aplica."};
  const technical={signal:unusual.signal==="UNUSUAL_UP"?"BULLISH_ACTIVITY":unusual.signal==="UNUSUAL_DOWN"?"BEARISH_ACTIVITY":"NEUTRAL"};
  let score=50;
  score += insider.signal==="BUY"?20:insider.signal==="SELL"?-20:0;
  score += institutional.signal==="HOLDING"?5:0;
  score += congress.signal==="BUY"?5:congress.signal==="SELL"?-5:0;
  score += unusual.score>0?Math.min(15,Math.round(unusual.score/3)):Math.max(-15,Math.round(unusual.score/3)); score += options.signal==="CALL_HEAVY"?10:options.signal==="PUT_HEAVY"?-10:0;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const quality=[cik?"SEC insider":"sin SEC insider",institutional.filers?institutional.filers+" institucionales":"sin match 13F",congress.count?congress.count+" Congreso":"sin Congreso",unusual.error?"sin unusual":"unusual OK"].join(" · ");
  return {symbol,score,insider,institutional,congress,unusual,options,etf,technical,dataQuality:quality,asOf:new Date().toISOString(),events:detail?[...(insider.events||[]),...(institutional.events||[]),...(congress.events||[])]:[]};
}
