/**
 * FX·INTEL — Binance Proxy Server
 * Handles CORS + HMAC-SHA256 request signing for Binance API.
 * Deployed on Render — Run: node server/server.js
 */

import http from "http";
import https from "https";
import crypto from "crypto";
import { parse } from "url";

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const BINANCE_BASE = "api.binance.com";

// ── CORS headers ──────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── HMAC-SHA256 signature ─────────────────────────────────────────────────────
function sign(secret, queryString) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

// ── Public Binance request (no auth) ─────────────────────────────────────────
function binancePublic(path, params) {
  return new Promise((resolve, reject) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const fullPath = path + qs;
    const options = {
      hostname: BINANCE_BASE,
      port: 443,
      path: fullPath,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };
    console.log(`[Binance Public] GET https://${BINANCE_BASE}${fullPath}`);
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        console.log(`[Binance Public] Status: ${res.statusCode} | Body: ${data.slice(0, 200)}`);
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: "Parse error", raw: data }); }
      });
    });
    req.on("error", (err) => { console.error("[Binance Public] Error:", err.message); reject(err); });
    req.end();
  });
}

// ── Authenticated Binance request ─────────────────────────────────────────────
function binanceRequest(method, path, params, apiKey, apiSecret, body = null) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const allParams = { ...params, timestamp };
    const queryString = new URLSearchParams(allParams).toString();
    const signature = sign(apiSecret, body ? queryString + body : queryString);

    const fullPath = `${path}?${queryString}&signature=${signature}`;

    const options = {
      hostname: BINANCE_BASE,
      port: 443,
      path: fullPath,
      method,
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    console.log(`[Binance Auth] ${method} https://${BINANCE_BASE}${fullPath}`);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`[Binance Auth] Status: ${res.statusCode} | Body: ${data.slice(0, 300)}`);
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { error: "Parse error", raw: data } }); }
      });
    });

    req.on("error", (err) => { console.error("[Binance Auth] Error:", err.message); reject(err); });
    if (body && method === "POST") req.write(body);
    req.end();
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = parse(req.url, true);
  const route = parsed.pathname;
  console.log(`[Server] ${req.method} ${route}`);

  // Read body
  let bodyRaw = "";
  req.on("data", (chunk) => (bodyRaw += chunk));
  await new Promise((r) => req.on("end", r));
  let bodyJson = {};
  try { bodyJson = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch {}

  res.setHeader("Content-Type", "application/json");

  try {

    // ── GET / — health ping ───────────────────────────────────────────────────
    if (route === "/" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        service: "FX·INTEL Binance Proxy",
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now(),
      }));
      return;
    }

    // ── GET /ticker?symbols=BTCUSDT,ETHUSDT ──────────────────────────────────
    if (route === "/ticker" && req.method === "GET") {
      const symbols = (parsed.query.symbols || "BTCUSDT")
        .split(",").map(s => s.trim()).filter(Boolean);

      const results = await Promise.all(
        symbols.map(s =>
          binancePublic("/api/v3/ticker/24hr", { symbol: s })
            .catch(err => ({ error: err.message }))
        )
      );

      const tickers = results.map((r, i) => ({
        symbol: symbols[i],
        price: r.lastPrice ?? null,
        change24h: r.priceChangePercent ? (parseFloat(r.priceChangePercent) / 100).toString() : null,
        high24h: r.highPrice ?? null,
        low24h: r.lowPrice ?? null,
        volume24h: r.volume ?? null,
        error: r.error ?? null,
      }));

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, tickers }));
      return;
    }

    // ── GET /orderbook?symbol=BTCUSDT ────────────────────────────────────────
    if (route === "/orderbook" && req.method === "GET") {
      const symbol = parsed.query.symbol || "BTCUSDT";
      const data = await binancePublic("/api/v3/depth", { symbol, limit: 5 });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, data: { b: data.bids, a: data.asks } }));
      return;
    }

    // ── POST /balance { apiKey, apiSecret } ──────────────────────────────────
    if (route === "/balance" && req.method === "POST") {
      const { apiKey, apiSecret } = bodyJson;
      if (!apiKey || !apiSecret) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: "apiKey and apiSecret required" }));
        return;
      }
      const result = await binanceRequest("GET", "/api/v3/account", {}, apiKey, apiSecret);
      if (result.status !== 200) {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false, error: result.data.msg || "Binance API error", raw: result.data }));
        return;
      }
      const balances = (result.data.balances || [])
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => ({
          coin: b.asset,
          available: b.free,
          locked: b.locked,
          total: (parseFloat(b.free) + parseFloat(b.locked)).toString(),
          usdValue: null,
        }));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, balances }));
      return;
    }

    // ── POST /order ──────────────────────────────────────────────────────────
    if (route === "/order" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, side, orderType, qty, price } = bodyJson;
      if (!apiKey || !apiSecret || !symbol || !side || !qty) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: "Missing required fields" }));
        return;
      }

      const params = {
        symbol,
        side: side.toUpperCase(),
        type: orderType.toUpperCase(),
        quantity: qty,
      };

      if (orderType.toUpperCase() === "LIMIT") {
        if (!price) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "Price required for LIMIT orders" }));
          return;
        }
        params.price = price;
        params.timeInForce = "GTC";
      }

      const result = await binanceRequest("POST", "/api/v3/order", params, apiKey, apiSecret);
      const ok = result.status === 200 || result.status === 201;
      res.writeHead(200);
      res.end(JSON.stringify({
        ok,
        orderId: result.data.orderId?.toString(),
        data: result.data,
        error: ok ? null : (result.data.msg || "Order failed"),
      }));
      return;
    }

    // ── POST /orders/open ────────────────────────────────────────────────────
    if (route === "/orders/open" && req.method === "POST") {
      const { apiKey, apiSecret, symbol } = bodyJson;
      const params = symbol ? { symbol } : {};
      const result = await binanceRequest("GET", "/api/v3/openOrders", params, apiKey, apiSecret);
      const orders = (result.data || []).map(o => ({
        orderId: o.orderId?.toString(),
        symbol: o.symbol,
        side: o.side,
        qty: o.origQty,
        price: o.price,
        orderType: o.type,
        orderStatus: o.status,
        time: o.time,
      }));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, orders }));
      return;
    }

    // ── POST /order/cancel ───────────────────────────────────────────────────
    if (route === "/order/cancel" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, orderId } = bodyJson;
      if (!symbol || !orderId) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: "symbol and orderId required" }));
        return;
      }
      const result = await binanceRequest("DELETE", "/api/v3/order", { symbol, orderId }, apiKey, apiSecret);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: result.status === 200, data: result.data }));
      return;
    }

    // ── POST /orders/history ─────────────────────────────────────────────────
    if (route === "/orders/history" && req.method === "POST") {
      const { apiKey, apiSecret, symbol } = bodyJson;
      const sym = symbol || "BTCUSDT";
      const result = await binanceRequest(
        "GET", "/api/v3/allOrders",
        { symbol: sym, limit: 20 },
        apiKey, apiSecret
      );
      const orders = (Array.isArray(result.data) ? result.data : [])
        .reverse()
        .slice(0, 20)
        .map(o => ({
          orderId: o.orderId?.toString(),
          symbol: o.symbol,
          side: o.side,
          qty: o.origQty,
          price: o.price,
          orderType: o.type,
          orderStatus: o.status,
          time: o.time,
        }));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, orders }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: "Unknown route: " + route }));

  } catch (err) {
    console.error(`[Server] Unhandled error on ${route}:`, err);
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   FX·INTEL Binance Proxy — Running ✓    ║
  ║   Port: ${PORT}                              ║
  ║                                          ║
  ║   Routes:                                ║
  ║   GET  /           ← health ping         ║
  ║   GET  /ticker?symbols=BTCUSDT           ║
  ║   GET  /orderbook?symbol=BTCUSDT         ║
  ║   POST /balance                          ║
  ║   POST /order                            ║
  ║   POST /orders/open                      ║
  ║   POST /order/cancel                     ║
  ║   POST /orders/history                   ║
  ╚══════════════════════════════════════════╝

  Your API keys never leave this server.
  Press Ctrl+C to stop.
  `);
});

// ── Keep-alive self-ping for Render free tier ─────────────────────────────────
// Prevents the service from sleeping after 15 minutes of inactivity.
// RENDER_EXTERNAL_URL is set automatically by Render in production.
if (process.env.RENDER_EXTERNAL_URL) {
  const selfPingUrl = new URL("/", process.env.RENDER_EXTERNAL_URL);
  setInterval(() => {
    https.get(selfPingUrl.href, (res) => {
      console.log(`[Keep-alive] Ping → ${res.statusCode}`);
    }).on("error", (err) => {
      console.warn("[Keep-alive] Ping failed:", err.message);
    });
  }, 10 * 60 * 1000); // every 10 minutes
  console.log(`  [Keep-alive] Self-ping active → ${selfPingUrl.href}`);
}
