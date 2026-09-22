const SM_API = "https://weekly-range-api.changowalu.workers.dev/smart-money";

const SM_UNIVERSE = [
  "AAPL","NVDA","AMZN","GOOGL","META","AVGO","TSLA","AMD",
  "NFLX","ORCL","CRM","ADBE","CSCO","QCOM","MU","AMAT",
  "JPM","BAC","WFC","GS","V","MA","PYPL","COF","AXP","HOOD",
  "LLY","UNH","JNJ","ABBV","MRK","PFE","TMO","ABT","WMT",
  "COST","HD","LOW","MCD","NKE","KO","PEP","XOM","CVX",
  "COP","SLB","CAT","DE","GE","HON","BA","RTX","UBER","PLTR",
  "PANW","CRWD","NOW","SHOP","SPY","QQQ","IWM","DIA","XLF","XLK"
];

function smEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function smBadge(value) {
  const text = String(value || "NEUTRAL").toUpperCase();
  let cls = "yellow";
  if (text.includes("BUY") || text.includes("UP") || text.includes("CALL") || text.includes("HOLDING")) cls = "green";
  if (text.includes("SELL") || text.includes("DOWN") || text.includes("PUT")) cls = "red";
  return `<span class="${cls}"><b>${smEscape(text)}</b></span>`;
}

function smMoney(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

function smRenderRows(data) {
  const rows = document.getElementById("smRows");
  if (!rows) {
    console.error("No existe #smRows");
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    rows.innerHTML = '<tr><td colspan="12" class="loading">Sin datos.</td></tr>';
    return;
  }

  rows.innerHTML = data.map((x, i) => {
    const score = Number(x.score) || 0;
    const insider = x.insider || {};
    const institutional = x.institutional || {};
    const congress = x.congress || {};
    const unusual = x.unusual || {};
    const etf = x.etf || {};
    const options = x.options || {};

    return `
      <tr>
        <td><b>${i + 1}</b></td>
        <td><b>${smEscape(x.symbol)}</b></td>
        <td class="score ${score >= 70 ? "green" : score <= 30 ? "red" : "yellow"}">${score}</td>
        <td>${smBadge(insider.signal)}<br><span class="small">${insider.count || 0} eventos · ${smMoney(insider.netValue || 0)}</span></td>
        <td>${smBadge(institutional.signal)}<br><span class="small">${institutional.filers || 0} managers</span></td>
        <td>${smBadge(congress.signal)}<br><span class="small">${congress.count || 0} operaciones</span></td>
        <td>${smBadge(unusual.signal)}<br><span class="small">RVOL ${Number(unusual.rvol || 0).toFixed(2)}x · ${Number(unusual.priceChange || 0).toFixed(1)}%</span></td>
        <td>${smBadge(etf.signal)}</td>
        <td>${smBadge(options.signal || "OFF")}<br><span class="small">C/P ${options.callPutRatio == null ? "—" : Number(options.callPutRatio).toFixed(2) + "x"}</span></td>
        <td><span class="small">${smEscape(x.dataQuality || "")}</span></td>
        <td><span class="small">${smEscape(x.asOf || "")}</span></td>
        <td><button type="button" class="smDetailBtn" data-symbol="${smEscape(x.symbol)}">DETALLES</button></td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".smDetailBtn").forEach(button => {
    button.addEventListener("click", () => smDetails(button.dataset.symbol));
  });
}

async function smLoad() {
  const input = document.getElementById("symbols");
  const status = document.getElementById("smStatus");
  const rows = document.getElementById("smRows");

  if (!input || !status || !rows) {
    console.error("No se encontraron los elementos del Smart Money.");
    return;
  }

  const symbols = [...new Set(input.value.split(",").map(x => x.trim().toUpperCase()).filter(Boolean))].slice(0, 8);

  if (!symbols.length) {
    status.textContent = "Introduce al menos un símbolo.";
    return;
  }

  status.textContent = "Analizando Smart Money...";
  rows.innerHTML = '<tr><td colspan="12" class="loading">Consultando datos...</td></tr>';

  try {
    const response = await fetch(SM_API + "?symbols=" + encodeURIComponent(symbols.join(",")) + "&_=" + Date.now(), {
      method: "GET",
      cache: "no-store"
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("El servidor no devolvió JSON. HTTP " + response.status);
    }

    if (!response.ok || data.status !== "ok") {
      throw new Error(data.message || "Error HTTP " + response.status);
    }

    smRenderRows(data.data || []);
    status.textContent = "Smart Money terminado · " + (data.data || []).length + " símbolos";
  } catch (error) {
    console.error("SMART MONEY ERROR:", error);
    status.textContent = "ERROR: " + error.message;
    rows.innerHTML = `<tr><td colspan="12" class="red">${smEscape(error.message)}</td></tr>`;
  }
}

async function smDetails(symbol) {
  const status = document.getElementById("smStatus");
  const panel = document.getElementById("smDetail");
  if (!panel) return;

  status.textContent = "Cargando detalles de " + symbol + "...";

  try {
    const response = await fetch(SM_API + "?symbol=" + encodeURIComponent(symbol) + "&detail=1&_=" + Date.now(), {
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || data.status !== "ok") {
      throw new Error(data.message || "No se pudieron cargar los detalles.");
    }

    const x = Array.isArray(data.data) ? data.data[0] : data.data;
    if (!x) throw new Error("No hay datos para " + symbol);

    const events = Array.isArray(x.events) ? x.events : [];

    panel.classList.remove("hidden");
    panel.innerHTML = `
      <h3 class="section-title">${smEscape(symbol)} — Smart Money</h3>
      <div class="summary">
        <span class="badge">SCORE: <b>${Number(x.score) || 0}</b></span>
        <span class="badge">INSIDERS: ${smBadge(x.insider?.signal)}</span>
        <span class="badge">13F: ${smBadge(x.institutional?.signal)}</span>
        <span class="badge">CONGRESO: ${smBadge(x.congress?.signal)}</span>
        <span class="badge">UNUSUAL: ${smBadge(x.unusual?.signal)}</span>
        <span class="badge">OPCIONES: ${smBadge(x.options?.signal || "OFF")}</span>
      </div>
      <p class="small">
        RVOL: ${Number(x.unusual?.rvol || 0).toFixed(2)}x
        · Cambio 5D: ${Number(x.unusual?.priceChange || 0).toFixed(2)}%
        · ${smEscape(x.unusual?.reason || "")}
      </p>
      <div class="scroll">
        <table>
          <thead><tr><th>FUENTE</th><th>FECHA</th><th>TIPO</th><th>ACTOR</th><th>ACCIÓN</th><th>VALOR</th></tr></thead>
          <tbody>
            ${events.length ? events.map(e => `
              <tr>
                <td>${smEscape(e.source || "")}</td>
                <td>${smEscape(e.date || "")}</td>
                <td>${smEscape(e.type || "")}</td>
                <td>${smEscape(e.actor || "")}</td>
                <td>${smEscape(e.action || "")}</td>
                <td>${smEscape(e.value || "")}</td>
              </tr>`).join("") : '<tr><td colspan="6">Sin eventos detallados.</td></tr>'}
          </tbody>
        </table>
      </div>
      <p class="small">Institucional: ${smEscape(x.institutional?.note || "")}</p>
      <p class="small">Congreso: ${smEscape(x.congress?.note || "")}</p>
      <p class="small">ETF: ${smEscape(x.etf?.note || "")}</p>
    `;

    status.textContent = "Detalles cargados para " + symbol;
  } catch (error) {
    console.error("SMART MONEY DETAIL ERROR:", error);
    status.textContent = "ERROR: " + error.message;
  }
}

function smSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function smScanUniverse() {
  const status = document.getElementById("smStatus");
  const rows = document.getElementById("smRows");
  const button = document.getElementById("smUniverse");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");

  if (!status || !rows || !button) {
    console.error("No se encontraron los elementos del Smart Money Universo.");
    return;
  }

  button.disabled = true;
  rows.innerHTML = '<tr><td colspan="12" class="loading">Iniciando universo...</td></tr>';

  const results = [];

  try {
    /*
     * IMPORTANTE:
     * El Worker hace varias subconsultas por símbolo. Procesar 8 símbolos
     * en una sola invocación supera el límite de subrequests de Cloudflare.
     * Por eso el universo se procesa UNO POR UNO.
     */
    for (let i = 0; i < SM_UNIVERSE.length; i++) {
      const symbol = SM_UNIVERSE[i];
      const completed = i + 1;

      status.textContent = `Smart Money Universo · ${completed}/${SM_UNIVERSE.length} · ${symbol}`;

      const response = await fetch(
        SM_API + "?symbol=" + encodeURIComponent(symbol) + "&_=" + Date.now(),
        { cache: "no-store" }
      );

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("El Worker no devolvió JSON para " + symbol + ". HTTP " + response.status);
      }

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message || "Error HTTP " + response.status + " para " + symbol);
      }

      if (Array.isArray(data.data)) results.push(...data.data);

      results.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
      smRenderRows(results);

      if (progressBar) {
        progressBar.style.width = (completed / SM_UNIVERSE.length * 100) + "%";
      }

      if (progressText) {
        progressText.textContent = `Smart Money ${completed}/${SM_UNIVERSE.length}`;
      }

      /*
       * Twelve Data tiene límites de frecuencia en planes gratuitos.
       * Esperamos 61 s entre símbolos para evitar encadenar solicitudes
       * demasiado rápido. El primer símbolo se ejecuta inmediatamente.
       */
      if (i < SM_UNIVERSE.length - 1) {
        for (let seconds = 61; seconds > 0; seconds--) {
          status.textContent = `Smart Money ${symbol} terminado · siguiente en ${seconds}s · ${completed}/${SM_UNIVERSE.length}`;
          await smSleep(1000);
        }
      }
    }

    status.textContent = "Smart Money Universo terminado · " + results.length + " símbolos";
  } catch (error) {
    console.error("SMART MONEY UNIVERSO ERROR:", error);
    status.textContent = "ERROR: " + error.message;
    rows.innerHTML = `<tr><td colspan="12" class="red">${smEscape(error.message)}</td></tr>`;
  } finally {
    button.disabled = false;
  }
}

window.smLoad = smLoad;
window.smScanUniverse = smScanUniverse;
window.smDetails = smDetails;

console.log("SMART MONEY JS cargado correctamente.");
