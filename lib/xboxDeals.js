const https = require("https");
const config = require("../config");

let cachedDeals = null;
let cachedAt = 0;

function fetchText(url, timeoutMs = config.xboxDeals.timeoutMs, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectsLeft <= 0) {
          reject(new Error(`Xbox retornou redirecionamento inválido ${response.statusCode}`));
          return;
        }

        const nextUrl = new URL(location, url).toString();
        fetchText(nextUrl, timeoutMs, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Xbox retornou HTTP ${response.statusCode}`));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Tempo esgotado ao buscar promoções Xbox"));
    });
    request.on("error", reject);
  });
}

function extractPreloadedState(html = "") {
  const marker = "window.__PRELOADED_STATE__ = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Estado da página Xbox não encontrado");

  const jsonStart = start + marker.length;
  const end = html.indexOf("window.env = ", jsonStart);
  if (end < 0) throw new Error("Fim do estado da página Xbox não encontrado");

  const raw = html.slice(jsonStart, end).replace(/;\s*$/, "").trim();
  return JSON.parse(raw);
}

function getChannelProducts(state) {
  const channels = state?.core2?.channels?.channelData || {};
  const channel = Object.values(channels).find((entry) => {
    return Array.isArray(entry?.data?.products);
  });

  return channel?.data?.products || [];
}

function getBestPrice(product) {
  const prices = product?.specificPrices?.purchaseable || [];
  return prices
    .filter((price) => Number.isFinite(price?.listPrice) && Number.isFinite(price?.msrp))
    .sort((a, b) => Number(b.discountPercentage || 0) - Number(a.discountPercentage || 0))[0] || null;
}

function formatMoney(value, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function getProductUrl(productId) {
  return `https://www.xbox.com/pt-BR/games/store/p/${productId}`;
}

function parseDealsFromState(state) {
  const summaries = state?.core2?.products?.productSummaries || {};
  const products = getChannelProducts(state);

  return products
    .map((item) => {
      const product = summaries[item.productId];
      const price = getBestPrice(product);
      if (!product || !price) return null;

      const discount = Math.round(Number(price.discountPercentage || 0));
      if (discount <= 0 || price.listPrice >= price.msrp) return null;

      return {
        id: product.productId,
        title: product.title,
        currentPrice: price.listPrice,
        originalPrice: price.msrp,
        currency: price.currency || "BRL",
        discount,
        endsAt: price.endDateUtc || "",
        url: getProductUrl(product.productId),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.discount - a.discount);
}

function parseDealsFromHtml(html) {
  return parseDealsFromState(extractPreloadedState(html));
}

function clampLimit(limit) {
  const value = Number(limit) || config.xboxDeals.defaultLimit;
  return Math.max(1, Math.min(config.xboxDeals.maxLimit, value));
}

function parseXboxDealsCommand(text = "") {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (String(parts[0] || "").toLowerCase() !== config.commands.xboxDeals) return null;
  if (parts.length !== 1) return { type: "invalid" };
  if (parts.length === 1) return { type: "deals", limit: config.xboxDeals.defaultLimit };
}

async function getXboxDeals(options = {}) {
  const now = options.now || Date.now();
  const force = Boolean(options.force);

  if (!force && cachedDeals && now - cachedAt < config.xboxDeals.cacheMs) {
    return { deals: cachedDeals, cached: true, fetchedAt: cachedAt };
  }

  const html = options.html || await fetchText(config.xboxDeals.url);
  const deals = parseDealsFromHtml(html);
  if (!deals.length) throw new Error("Nenhuma promoção Xbox encontrada");

  cachedDeals = deals;
  cachedAt = now;
  return { deals, cached: false, fetchedAt: cachedAt };
}

function formatXboxDeals(deals = [], options = {}) {
  const limit = clampLimit(options.limit);
  const selected = deals.slice(0, limit);
  if (!selected.length) {
    return `🎮 Não consegui listar promoções agora.\nVeja direto: ${config.xboxDeals.fallbackUrl}`;
  }

  const lines = [
    "╭─❰ 🎮 XBOX PROMO ❱─╮",
    "",
  ];

  selected.forEach((deal, index) => {
    const endsAt = formatDate(deal.endsAt);
    lines.push(`${index + 1}. ${deal.title}`);
    lines.push(`💸 ${formatMoney(deal.currentPrice, deal.currency)} ~~${formatMoney(deal.originalPrice, deal.currency)}~~`);
    lines.push(`🏷️ -${deal.discount}%${endsAt ? ` • até ${endsAt}` : ""}`);
    lines.push(`🔗 ${deal.url}`);
    lines.push("");
  });

  lines.push("╰━━━━━━━━━━━━╯");
  return lines.join("\n").trim();
}

function clearXboxDealsCache() {
  cachedDeals = null;
  cachedAt = 0;
}

module.exports = {
  clearXboxDealsCache,
  extractPreloadedState,
  formatXboxDeals,
  getXboxDeals,
  parseDealsFromHtml,
  parseDealsFromState,
  parseXboxDealsCommand,
};
