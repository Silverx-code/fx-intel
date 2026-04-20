/**
 * FX·INTEL — Bybit Proxy Server
 * Handles CORS + request signing so the browser app can trade safely.
 * Run: node server.js
 */

import http from "http";
import https from "https";
import crypto from "crypto";
import { parse } from "url";

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = 3001;
const BYBIT_BASE = "api.bybit.com";

// ── CORS headers for every response ──────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Bybit request signing (HMAC-SHA256) ───────────────────────────────────────
function sign(apiSecret, timestamp, apiKey, recvWindow, payload) {
  const raw = `${timestamp}${apiKey}${recvWindow}${payload}`;
  return crypto.createHmac("sha256", apiSecret).update(raw).digest("hex");
}

// ── Public market data (no auth needed) ───────────────────────────────────────
function bybitPublic(path, params) {
  return new Promise((resolve, reject) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const fullPath = path + qs;

    const options = {
      hostname: BYBIT_BASE,
      port: 443,
      path: fullPath,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    console.log(`[Bybit Public] GET https://${BYBIT_BASE}${fullPath}`);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        console.log(`[Bybit Public] Status: ${res.statusCode} | Body: ${data.slice(0, 200)}`);
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: "Parse error", raw: data });
        }
      });
    });

    req.on("error", (err) => {
      console.error(`[Bybit Public] Request error:`, err.message);
      reject(err);
    });

    req.end();
  });
}

// ── Authenticated Bybit request ───────────────────────────────────────────────
function bybitRequest(method, path, body, apiKey, apiSecret) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const payload = method === "GET" ? "" : JSON.stringify(body || {});
    const signature = sign(apiSecret, timestamp, apiKey, recvWindow, payload);

    const queryString = method === "GET" && body
      ? "?" + new URLSearchParams(body).toString()
      : "";

    const fullPath = path + queryString;

    const options = {
      hostname: BYBIT_BASE,
      port: 443,
      path: fullPath,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-BAPI-API-KEY": apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "X-BAPI-SIGN": signature,
      },
    };

    console.log(`[Bybit Auth] ${method} https://${BYBIT_BASE}${fullPath}`);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`[Bybit Auth] Status: ${res.statusCode} | Body: ${data.slice(0, 300)}`);
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: "Failed to parse Bybit response", raw: data });
        }
      });
    });

    req.on("error", (err) => {
      console.error(`[Bybit Auth] Request error:`, err.message);
      reject(err);
    });

    if (method === "POST") req.write(payload);
    req.end();
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = parse(req.url, true);
  const route = parsed.pathname;

  console.log(`[Server] ${req.method} ${route}`);

  // Read request body
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  await new Promise((r) => req.on("end", r));
  let bodyJson = {};
  try { bodyJson = body ? JSON.parse(body) : {}; } catch {}

  res.setHeader("Content-Type", "application/json");

  try {

    // ── GET /ticker?symbols=BTCUSDT,ETHUSDT ──────────────────────────────────
    if (route === "/ticker" && req.method === "GET") {
      const symbols = (parsed.query.symbols || "BTCUSDT")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const results = await Promise.all(
        symbols.map((s) =>
          bybitPublic("/v5/market/tickers", { category: "spot", symbol: s })
            .catch((err) => ({ error: err.message }))
        )
      );

      const tickers = results.map((r, i) => {
        const item = r?.result?.list?.[0];
        return {
          symbol: symbols[i],
          price: item?.lastPrice ?? null,
          change24h: item?.price24hPcnt ?? null,
          high24h: item?.highPrice24h ?? null,
          low24h: item?.lowPrice24h ?? null,
          volume24h: item?.volume24h ?? null,
          error: r?.error ?? null,
        };
      });

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, tickers }));
      return;
    }

    // ── GET /orderbook?symbol=BTCUSDT ────────────────────────────────────────
    if (route === "/orderbook" && req.method === "GET") {
      const symbol = parsed.query.symbol || "BTCUSDT";
      const data = await bybitPublic("/v5/market/orderbook", {
        category: "spot",
        symbol,
        limit: "5",
      });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, data: data.result ?? null }));
      return;
    }

    // ── POST /balance  { apiKey, apiSecret } ─────────────────────────────────
    if (route === "/balance" && req.method === "POST") {
      const { apiKey, apiSecret } = bodyJson;
      if (!apiKey || !apiSecret) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: "apiKey and apiSecret required" }));
        return;
      }
      const data = await bybitRequest(
        "GET",
        "/v5/account/wallet-balance",
        { accountType: "UNIFIED" },
        apiKey,
        apiSecret
      );
      const coins = data.result?.list?.[0]?.coin || [];
      const balances = coins
        .filter((c) => parseFloat(c.walletBalance) > 0)
        .map((c) => ({
          coin: c.coin,
          available: c.availableToWithdraw,
          total: c.walletBalance,
          usdValue: c.usdValue,
        }));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, balances }));
      return;
    }

    // ── POST /order ──────────────────────────────────────────────────────────
    if (route === "/order" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, side, qty, orderType, price } = bodyJson;
      if (!apiKey || !apiSecret || !symbol || !side || !qty) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: "Missing required fields" }));
        return;
      }
      const orderBody = {
        category: "spot",
        symbol,
        side,
        orderType,
        qty: String(qty),
        timeInForce: "GTC",
      };
      if (orderType === "Limit" && price) orderBody.price = String(price);

      const data = await bybitRequest("POST", "/v5/order/create", orderBody, apiKey, apiSecret);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: data.retCode === 0, data, orderId: data.result?.orderId }));
      return;
    }

    // ── POST /orders/open ────────────────────────────────────────────────────
    if (route === "/orders/open" && req.method === "POST") {
      const { apiKey, apiSecret, symbol } = bodyJson;
      const params = { category: "spot" };
      if (symbol) params.symbol = symbol;
      const data = await bybitRequest("GET", "/v5/order/realtime", params, apiKey, apiSecret);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, orders: data.result?.list || [] }));
      return;
    }

    // ── POST /order/cancel ───────────────────────────────────────────────────
    if (route === "/order/cancel" && req.method === "POST") {
      const { apiKey, apiSecret, symbol, orderId } = bodyJson;
      const data = await bybitRequest(
        "POST",
        "/v5/order/cancel",
        { category: "spot", symbol, orderId },
        apiKey,
        apiSecret
      );
      res.writeHead(200);
      res.end(JSON.stringify({ ok: data.retCode === 0, data }));
      return;
    }

    // ── POST /orders/history ─────────────────────────────────────────────────
    if (route === "/orders/history" && req.method === "POST") {
      const { apiKey, apiSecret } = bodyJson;
      const data = await bybitRequest(
        "GET",
        "/v5/order/history",
        { category: "spot", limit: "20" },
        apiKey,
        apiSecret
      );
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, orders: data.result?.list || [] }));
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
  ║   FX·INTEL Bybit Proxy — Running ✓      ║
  ║   http://localhost:${PORT}                  ║
  ║                                          ║
  ║   Routes:                                ║
  ║   GET  /ticker?symbols=BTCUSDT           ║
  ║   GET  /orderbook?symbol=BTCUSDT         ║
  ║   POST /balance                          ║
  ║   POST /order                            ║
  ║   POST /orders/open                      ║
  ║   POST /order/cancel                     ║
  ║   POST /orders/history                   ║
  ╚══════════════════════════════════════════╝

  Your API keys never leave your machine.
  Press Ctrl+C to stop.
  `);
});
