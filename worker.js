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
