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

// ── Public Binance request ────────────────────────────────────────────────────
function binancePublic(path, params) {
  return new Promise((resolve, reject) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const options = {
      hostname: BINANCE_BASE,
      port: 443,
      path: path + qs,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: "Parse error", raw: data });
        }
      });
    });

    req.on("error", reject);
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

    const options = {
      hostname: BINANCE_BASE,
      port: 443,
      path: `${path}?${queryString}&signature=${signature}`,
      method,
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { error: "Parse error", raw: data } });
        }
      });
    });

    req.on("error", reject);
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

  // Read body
  let bodyRaw = "";
  req.on("data", (chunk) => (bodyRaw += chunk));
  await new Promise((r) => req.on("end", r));

  let bodyJson = {};
  try {
    bodyJson = bodyRaw ? JSON.parse(bodyRaw) : {};
  } catch {}

  res.setHeader("Content-Type", "application/json");

  try {
    // ── ✅ ROOT HEALTH CHECK (FIXED) ──────────────────────────────────────────
    if (route === "/" && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        status: "FX·INTEL proxy running",
      }));
      return;
    }

    // ── GET /ticker ───────────────────────────────────────────────────────────
    if (route === "/ticker" && req.method === "GET") {
      const symbols = (parsed.query.symbols || "BTCUSDT")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      const results = await Promise.all(
        symbols.map(s =>
          binancePublic("/api/v3/ticker/24hr", { symbol: s })
            .catch(err => ({ error: err.message }))
        )
      );

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        tickers: results,
      }));
      return;
    }

    // ── GET /orderbook ────────────────────────────────────────────────────────
    if (route === "/orderbook" && req.method === "GET") {
      const symbol = parsed.query.symbol || "BTCUSDT";
      const data = await binancePublic("/api/v3/depth", { symbol, limit: 5 });

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        data: { bids: data.bids, asks: data.asks },
      }));
      return;
    }

    // ── POST /balance ─────────────────────────────────────────────────────────
    if (route === "/balance" && req.method === "POST") {
      const { apiKey, apiSecret } = bodyJson;

      if (!apiKey || !apiSecret) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: "apiKey and apiSecret required" }));
        return;
      }

      const result = await binanceRequest("GET", "/api/v3/account", {}, apiKey, apiSecret);

      res.writeHead(200);
      res.end(result);
      return;
    }

    // ── POST /order ───────────────────────────────────────────────────────────
    if (route === "/order" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, side, orderType, qty } = bodyJson;

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

      const result = await binanceRequest("POST", "/api/v3/order", params, apiKey, apiSecret);

      res.writeHead(200);
      res.end(result);
      return;
    }

    // ── 404 ───────────────────────────────────────────────────────────────────
    res.writeHead(404);
    res.end(JSON.stringify({
      ok: false,
      error: "Unknown route: " + route,
    }));

  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({
      ok: false,
      error: err.message,
    }));
  }
});

server.listen(PORT, () => {
  console.log(`FX·INTEL Binance Proxy running on port ${PORT}`);
});

// ── Keep-alive for Render ─────────────────────────────────────────────────────
if (process.env.RENDER_EXTERNAL_URL) {
  const selfPingUrl = new URL("/", process.env.RENDER_EXTERNAL_URL);

  setInterval(() => {
    https.get(selfPingUrl.href).on("error", () => {});
  }, 10 * 60 * 1000);
}