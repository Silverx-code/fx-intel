/**
 * FX·INTEL — Binance + Gemini Proxy Server
 * Handles CORS + HMAC-SHA256 signing for Binance, and proxies Gemini AI calls.
 *
 * Required env vars (set in Render dashboard):
 *   GEMINI_API_KEY      — from aistudio.google.com (free, no credit card)
 *
 * Optional:
 *   PORT                — defaults to 3001
 *   RENDER_EXTERNAL_URL — set automatically by Render; enables keep-alive ping
 */

import http from "http";
import https from "https";
import crypto from "crypto";
import { parse } from "url";

const PORT = process.env.PORT || 3001;
const BINANCE_BASE = "api.binance.com";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

if (!GEMINI_KEY) {
  console.warn("WARNING: GEMINI_API_KEY env var is not set — /ai endpoint will fail.");
}

// ── CORS ──────────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── HMAC-SHA256 ───────────────────────────────────────────────────────────────
function sign(secret, queryString) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

// ── Generic HTTPS request helper ──────────────────────────────────────────────
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { error: "Parse error", raw: data } }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Public Binance request ────────────────────────────────────────────────────
function binancePublic(path, params) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return httpsRequest({
    hostname: BINANCE_BASE, port: 443, path: path + qs, method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
  }).then(r => r.data);
}

// ── Authenticated Binance request ─────────────────────────────────────────────
function binanceAuth(method, path, params, apiKey, apiSecret) {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const queryString = new URLSearchParams(allParams).toString();
  const signature = sign(apiSecret, queryString);
  const fullPath = `${path}?${queryString}&signature=${signature}`;
  return httpsRequest({
    hostname: BINANCE_BASE, port: 443, path: fullPath, method,
    headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
  });
}

// ── Google Gemini request ─────────────────────────────────────────────────────
// Converts {role, content} messages to Gemini contents format.
// Gemini roles: "user" | "model"  (not "assistant")
function geminiRequest(system, messages) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const bodyObj = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
  };
  const bodyStr = JSON.stringify(bodyObj);

  return httpsRequest({
    hostname: "generativelanguage.googleapis.com",
    port: 443,
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
    },
  }, bodyStr);
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
  console.log(`[${new Date().toISOString()}] ${req.method} ${route}`);

  let bodyRaw = "";
  req.on("data", (c) => (bodyRaw += c));
  await new Promise((r) => req.on("end", r));
  let body = {};
  try { body = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch {}

  res.setHeader("Content-Type", "application/json");

  const send = (status, payload) => {
    res.writeHead(status);
    res.end(JSON.stringify(payload));
  };

  try {

    // GET / — health ping
    if ((route === "/" || route === "") && (req.method === "GET" || req.method === "HEAD")) {
      return send(200, { ok: true, service: "FX-INTEL Proxy", uptime: Math.floor(process.uptime()), ts: Date.now() });
    }

    // GET /ticker?symbols=BTCUSDT,...
    if (route === "/ticker" && req.method === "GET") {
      const symbols = (parsed.query.symbols || "BTCUSDT").split(",").map(s => s.trim()).filter(Boolean);
      const results = await Promise.all(
        symbols.map(s => binancePublic("/api/v3/ticker/24hr", { symbol: s }).catch(e => ({ error: e.message })))
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
      return send(200, { ok: true, tickers });
    }

    // GET /orderbook?symbol=BTCUSDT
    if (route === "/orderbook" && req.method === "GET") {
      const symbol = parsed.query.symbol || "BTCUSDT";
      const data = await binancePublic("/api/v3/depth", { symbol, limit: 5 });
      return send(200, { ok: true, data: { b: data.bids, a: data.asks } });
    }

    // POST /balance
    if (route === "/balance" && req.method === "POST") {
      const { apiKey, apiSecret } = body;
      if (!apiKey || !apiSecret) return send(400, { ok: false, error: "apiKey and apiSecret required" });
      const result = await binanceAuth("GET", "/api/v3/account", {}, apiKey, apiSecret);
      if (result.status !== 200) return send(200, { ok: false, error: result.data.msg || "Binance API error", raw: result.data });
      const balances = (result.data.balances || [])
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => ({ coin: b.asset, available: b.free, locked: b.locked, total: (parseFloat(b.free) + parseFloat(b.locked)).toString() }));
      return send(200, { ok: true, balances });
    }

    // POST /order
    if (route === "/order" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, side, orderType, qty, price } = body;
      if (!apiKey || !apiSecret || !symbol || !side || !qty) return send(400, { ok: false, error: "Missing required fields" });
      const params = { symbol, side: side.toUpperCase(), type: orderType.toUpperCase(), quantity: qty };
      if (orderType.toUpperCase() === "LIMIT") {
        if (!price) return send(400, { ok: false, error: "Price required for LIMIT orders" });
        params.price = price;
        params.timeInForce = "GTC";
      }
      const result = await binanceAuth("POST", "/api/v3/order", params, apiKey, apiSecret);
      const ok = result.status === 200 || result.status === 201;
      return send(200, { ok, orderId: result.data.orderId?.toString(), data: result.data, error: ok ? null : (result.data.msg || "Order failed") });
    }

    // POST /orders/open
    if (route === "/orders/open" && req.method === "POST") {
      const { apiKey, apiSecret, symbol } = body;
      const result = await binanceAuth("GET", "/api/v3/openOrders", symbol ? { symbol } : {}, apiKey, apiSecret);
      const orders = (result.data || []).map(o => ({
        orderId: o.orderId?.toString(), symbol: o.symbol, side: o.side,
        qty: o.origQty, price: o.price, orderType: o.type, orderStatus: o.status, time: o.time,
      }));
      return send(200, { ok: true, orders });
    }

    // POST /order/cancel
    if (route === "/order/cancel" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, orderId } = body;
      if (!symbol || !orderId) return send(400, { ok: false, error: "symbol and orderId required" });
      const result = await binanceAuth("DELETE", "/api/v3/order", { symbol, orderId }, apiKey, apiSecret);
      return send(200, { ok: result.status === 200, data: result.data });
    }

    // POST /orders/history
    if (route === "/orders/history" && req.method === "POST") {
      const { apiKey, apiSecret, symbol } = body;
      const sym = symbol || "BTCUSDT";
      const result = await binanceAuth("GET", "/api/v3/allOrders", { symbol: sym, limit: 20 }, apiKey, apiSecret);
      const orders = (Array.isArray(result.data) ? result.data : []).reverse().slice(0, 20).map(o => ({
        orderId: o.orderId?.toString(), symbol: o.symbol, side: o.side,
        qty: o.origQty, price: o.price, orderType: o.type, orderStatus: o.status, time: o.time,
      }));
      return send(200, { ok: true, orders });
    }

    // POST /ai — Gemini proxy
    // Body: { system: string, messages: [{role, content}] }
    if (route === "/ai" && req.method === "POST") {
      if (!GEMINI_KEY) return send(500, { ok: false, error: "GEMINI_API_KEY not configured on server." });

      const { system, messages } = body;
      if (!messages || !Array.isArray(messages)) return send(400, { ok: false, error: "messages array required" });

      const result = await geminiRequest(system || "", messages);

      if (result.status !== 200) {
        console.error("[Gemini] Error:", JSON.stringify(result.data));
        return send(200, { ok: false, error: result.data?.error?.message || "Gemini error" });
      }

      // Extract text from Gemini response and return simple {ok, text} shape
      const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
      return send(200, { ok: true, text });
    }

    // 404
    send(404, { ok: false, error: "Unknown route: " + route });

  } catch (err) {
    console.error(`[Server] Error on ${route}:`, err);
    send(500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`
  FX-INTEL Proxy running on port ${PORT}

  Routes:
    GET  /              health ping
    GET  /ticker        Binance prices
    GET  /orderbook     Binance order book
    POST /balance       Binance account balance
    POST /order         Place order
    POST /orders/open   Open orders
    POST /order/cancel  Cancel order
    POST /orders/history Order history
    POST /ai            Gemini AI proxy

  GEMINI_API_KEY: ${GEMINI_KEY ? "SET" : "MISSING - add it in Render > Environment"}
  `);
});

// Keep-alive self-ping to prevent Render free tier sleep
if (process.env.RENDER_EXTERNAL_URL) {
  const pingUrl = new URL("/", process.env.RENDER_EXTERNAL_URL).href;
  setInterval(() => {
    https.get(pingUrl, res => console.log(`[Keep-alive] ${res.statusCode}`))
         .on("error", err => console.warn("[Keep-alive] Failed:", err.message));
  }, 10 * 60 * 1000);
  console.log(`  Keep-alive pinging ${pingUrl} every 10 min`);
}