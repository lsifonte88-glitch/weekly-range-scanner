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
      if (url.pathname === "/health") return json({ status: "ok", service: "Weekly Range Scanner PRO", time: new Date().toISOString() });
      if (url.pathname === "/universe") {
        const symbols = await universe(env);
        return json({ status: "ok", count: symbols.length, symbols, generatedAt: new Date().toISOString() }, 200, { "cache-control": "public, max-age=21600" });
      }
            if (url.pathname === "/smart-money") {
        const symbols = cleanSymbols(url.searchParams.get("symbols") || url.searchParams.get("symbol"));
        if (!symbols.length) return json({status:"error",message:"Falta symbol o symbols."},400);
        const detail = url.searchParams.get("detail")==="1";
        const data=[];
        for (const s of symbols) data.push(await smartMoneyData(s,env,detail));
        return json({status:"ok",data,generatedAt:new Date().toISOString()});
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
async function smartMoneyData(symbol,env,detail=false){
  const map=await secTickers(env), cik=map[symbol];
  let insider={signal:"NEUTRAL",count:0,netValue:0,events:[],error:cik?null:"Ticker not found in SEC map"};
  if(cik) insider=await insiderData(symbol,cik,env,detail);
  const institutional={signal:"NEUTRAL",filers:0,events:[],note:"13F is quarterly; ticker-level aggregation requires a holdings dataset/provider."};
  const congress={signal:"NEUTRAL",count:0,events:[],note:env.CONGRESS_API_URL?"Provider configured but adapter not enabled yet.":"No congressional data provider configured."};
  const technical={signal:"NEUTRAL"};
  let score=50;
  score += insider.signal==="BUY"?20:insider.signal==="SELL"?-20:0;
  const quality=cik?"SEC insider data available":"SEC ticker mapping unavailable";
  return {symbol,score,insider,institutional,congress,technical,dataQuality:quality,asOf:new Date().toISOString(),events:detail?[...(insider.events||[])]:[]};
}
