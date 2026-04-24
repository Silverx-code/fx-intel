import { useState, useEffect, useRef, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
// 👇 Replace with your actual Render proxy URL after deploying server.js
const PROXY = "https://fx-intel-1.onrender.com";

const CURRENCIES = ["USD/NGN", "EUR/USD", "GBP/USD", "EUR/NGN", "GBP/NGN", "USD/ZAR"];
const BASE_RATES = {
  "USD/NGN": 1580, "EUR/USD": 1.085, "GBP/USD": 1.27,
  "EUR/NGN": 1714, "GBP/NGN": 2005, "USD/ZAR": 18.4,
};
const CURRENCY_ICONS = {
  "USD/NGN": "🇺🇸🇳🇬", "EUR/USD": "🇪🇺🇺🇸", "GBP/USD": "🇬🇧🇺🇸",
  "EUR/NGN": "🇪🇺🇳🇬", "GBP/NGN": "🇬🇧🇳🇬", "USD/ZAR": "🇺🇸🇿🇦",
};

const TRADE_SYMBOLS = [
  { label: "BTC/USDT", value: "BTCUSDT", base: "BTC", quote: "USDT" },
  { label: "ETH/USDT", value: "ETHUSDT", base: "ETH", quote: "USDT" },
  { label: "SOL/USDT", value: "SOLUSDT", base: "SOL", quote: "USDT" },
  { label: "XRP/USDT", value: "XRPUSDT", base: "XRP", quote: "USDT" },
  { label: "BNB/USDT", value: "BNBUSDT", base: "BNB", quote: "USDT" },
  { label: "DOGE/USDT", value: "DOGEUSDT", base: "DOGE", quote: "USDT" },
];

// ── Simulated FX price helpers ────────────────────────────────────────────────
function generatePriceHistory(base, points = 60) {
  const data = [];
  let price = base * (0.97 + Math.random() * 0.06);
  for (let i = points; i >= 0; i--) {
    price += (Math.random() - 0.495) * base * 0.003;
    price = Math.max(base * 0.92, Math.min(base * 1.08, price));
    const ts = new Date(Date.now() - i * 3600000);
    data.push({
      time: ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      price: parseFloat(price.toFixed(4)),
      vol: Math.floor(Math.random() * 800 + 200),
    });
  }
  return data;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  return parseFloat((100 - 100 / (1 + gains / (losses || 0.001))).toFixed(1));
}

function calcMACD(prices) {
  const ema = (arr, n) => {
    const k = 2 / (n + 1);
    return arr.reduce((acc, v, i) => i === 0 ? [v] : [...acc, v * k + acc[i - 1] * (1 - k)], []);
  };
  return parseFloat((ema(prices, 12).at(-1) - ema(prices, 26).at(-1)).toFixed(6));
}

function calcBollinger(prices, period = 20) {
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
  return { upper: mean + 2 * std, lower: mean - 2 * std, mid: mean };
}

function generateSignal(rsi, macd, price, bollinger, sentiment) {
  let score = 0;
  const reasons = [];
  if (rsi < 35) { score += 2; reasons.push({ icon: "📉", text: `RSI ${rsi} — oversold territory`, bull: true }); }
  else if (rsi > 65) { score -= 2; reasons.push({ icon: "📈", text: `RSI ${rsi} — overbought territory`, bull: false }); }
  if (macd > 0) { score += 1; reasons.push({ icon: "⚡", text: "MACD bullish crossover", bull: true }); }
  else { score -= 1; reasons.push({ icon: "⚡", text: "MACD bearish crossover", bull: false }); }
  if (price < bollinger.lower) { score += 2; reasons.push({ icon: "📊", text: "Price below lower Bollinger Band", bull: true }); }
  else if (price > bollinger.upper) { score -= 2; reasons.push({ icon: "📊", text: "Price above upper Bollinger Band", bull: false }); }
  if (sentiment > 0.3) { score += 1; reasons.push({ icon: "🗞️", text: "Positive market sentiment", bull: true }); }
  else if (sentiment < -0.3) { score -= 1; reasons.push({ icon: "🗞️", text: "Negative sentiment detected", bull: false }); }
  const confidence = Math.min(95, Math.abs(score) * 15 + 35 + Math.random() * 10);
  if (score >= 2) return { action: "BUY", color: "#00ff88", confidence: parseFloat(confidence.toFixed(1)), reasons };
  if (score <= -2) return { action: "SELL", color: "#ff4466", confidence: parseFloat(confidence.toFixed(1)), reasons };
  return { action: "HOLD", color: "#ffaa00", confidence: parseFloat(confidence.toFixed(1)), reasons };
}

const NEWS_SENTIMENT = [
  { headline: "CBN raises MPR by 50bps to curb inflation", sentiment: -0.6, time: "2h ago", impact: "NGN" },
  { headline: "US Fed signals potential rate pause in Q2", sentiment: 0.7, time: "4h ago", impact: "USD" },
  { headline: "Nigeria oil exports hit 3-month high", sentiment: 0.8, time: "6h ago", impact: "NGN" },
  { headline: "EUR weakens on poor Eurozone manufacturing data", sentiment: -0.5, time: "8h ago", impact: "EUR" },
  { headline: "GBP rallies after strong UK employment figures", sentiment: 0.6, time: "10h ago", impact: "GBP" },
];

const ECONOMIC_EVENTS = [
  { time: "09:00", event: "CBN MPC Rate Decision", currency: "NGN", impact: "HIGH", hours: 2 },
  { time: "13:30", event: "US CPI Inflation Report", currency: "USD", impact: "HIGH", hours: 5 },
  { time: "10:00", event: "Eurozone GDP Release", currency: "EUR", impact: "MED", hours: 3 },
  { time: "15:00", event: "Fed Chair Powell Speech", currency: "USD", impact: "HIGH", hours: 7 },
];

const SUGGESTED_PROMPTS = [
  { label: "Best opportunity", text: "Which pair has the strongest signal right now and why?", icon: "🎯" },
  { label: "Portfolio review", text: "Review my open trades and tell me which ones look risky.", icon: "📊" },
  { label: "Macro risks", text: "What are the biggest macro risks to watch in FX today?", icon: "⚠️" },
  { label: "USD/NGN outlook", text: "What's your analysis of USD/NGN right now?", icon: "🇳🇬" },
];

// ── Mini sparkline chart ──────────────────────────────────────────────────────
function MiniChart({ data, color, width = 120, height = 40 }) {
  const prices = data.map(d => d.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) =>
    `${(i / (prices.length - 1)) * width},${height - ((p - min) / range) * height}`
  ).join(" ");
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`g${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#g${color.replace("#", "")})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Order confirmation modal ──────────────────────────────────────────────────
function ConfirmModal({ order, onConfirm, onCancel, loading }) {
  if (!order) return null;
  const isBuy = order.side === "Buy";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, backdropFilter: "blur(4px)" }}>
      <div style={{ background: "#0d1420", border: `1px solid ${isBuy ? "rgba(0,255,136,0.3)" : "rgba(255,68,102,0.3)"}`, borderRadius: 20, padding: 32, width: 380 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, marginBottom: 8 }}>CONFIRM ORDER</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: isBuy ? "#00ff88" : "#ff4466", marginBottom: 20, fontFamily: "'Syne', sans-serif" }}>
          {isBuy ? "▲ BUY" : "▼ SELL"} {order.symbol}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {[
            ["Exchange", "Binance"],
            ["Symbol", order.symbol],
            ["Side", order.side],
            ["Order Type", order.orderType],
            ["Quantity", `${order.qty} ${order.base}`],
            ...(order.orderType === "Limit" ? [["Limit Price", `$${order.price}`]] : [["Price", "Market (best available)"]]),
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{k}</span>
              <span style={{ color: "#fff", fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "rgba(255,170,0,0.8)", marginBottom: 20 }}>
          ⚠️ This will place a REAL order on your Binance account using real funds.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)", borderRadius: 10, padding: 12, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} style={{ flex: 2, background: isBuy ? "rgba(0,255,136,0.2)" : "rgba(255,68,102,0.2)", border: `1px solid ${isBuy ? "rgba(0,255,136,0.5)" : "rgba(255,68,102,0.5)"}`, color: isBuy ? "#00ff88" : "#ff4466", borderRadius: 10, padding: 12, cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", letterSpacing: 1 }}>
            {loading ? "Placing..." : `Confirm ${order.side.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────
function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  function renderText(text) {
    return text.split("\n").map((line, i) => {
      if (line.trim().startsWith("- ") || line.trim().startsWith("• "))
        return <div key={i} style={{ display: "flex", gap: 8, marginTop: 4 }}><span style={{ color: "#00ff88", flexShrink: 0 }}>▸</span><span>{renderInline(line.trim().slice(2))}</span></div>;
      if (line.startsWith("### ")) return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#00ff88", marginTop: 12, marginBottom: 4 }}>{line.slice(4)}</div>;
      if (line.startsWith("## ")) return <div key={i} style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 14, marginBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 4 }}>{line.slice(3)}</div>;
      if (line === "") return <div key={i} style={{ height: 6 }} />;
      return <div key={i} style={{ marginTop: 2 }}>{renderInline(line)}</div>;
    });
  }
  function renderInline(text) {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} style={{ color: "#fff" }}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background: "rgba(0,255,136,0.1)", color: "#00ff88", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>{part.slice(1, -1)}</code>;
      return part;
    });
  }
  return (
    <div style={{ display: "flex", gap: 12, flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-start", marginBottom: 20 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: isUser ? "rgba(255,255,255,0.08)" : "rgba(0,255,136,0.12)", border: isUser ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,255,136,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
        {isUser ? "👤" : "⬡"}
      </div>
      <div style={{ maxWidth: "78%", background: isUser ? "rgba(255,255,255,0.06)" : "rgba(0,255,136,0.05)", border: isUser ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,255,136,0.15)", borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px", padding: "12px 16px", fontSize: 13, lineHeight: 1.65, color: "rgba(255,255,255,0.88)" }}>
        {msg.loading
          ? <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff88", animation: `dotBounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
            </div>
          : renderText(msg.content)}
        {msg.timestamp && !msg.loading && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 8, textAlign: isUser ? "right" : "left" }}>{msg.timestamp}</div>}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function FXIntelligence() {
  const [tab, setTab] = useState("trade");
  const [selectedPair, setSelectedPair] = useState("USD/NGN");
  const [priceData, setPriceData] = useState({});
  const [signals, setSignals] = useState({});
  const [ticker, setTicker] = useState(0);

  // Binance credentials
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsError, setCredsError] = useState("");

  // Trading state
  const [balances, setBalances] = useState([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [liveTickerData, setLiveTickerData] = useState({});
  const [selectedSymbol, setSelectedSymbol] = useState(TRADE_SYMBOLS[0]);
  const [orderSide, setOrderSide] = useState("Buy");
  const [orderType, setOrderType] = useState("Market");
  const [orderQty, setOrderQty] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [confirmOrder, setConfirmOrder] = useState(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [openOrders, setOpenOrders] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  const [orderBook, setOrderBook] = useState(null);

  // Proxy status: "checking" | "online" | "offline" | "waking"
  const [proxyStatus, setProxyStatus] = useState("checking");
  const proxyOnline = proxyStatus === "online";

  // Chat
  const [chatMessages, setChatMessages] = useState([{
    role: "assistant",
    content: "Hello! I'm your FX Intelligence AI analyst, now connected to **Binance**.\n\nAdd your Binance API keys in the **Trade** tab to see your balance and place orders. I have live access to prices, signals, and market news.\n\n**What would you like to analyse?**",
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // ── Simulated FX price feed ───────────────────────────────────────────────
  useEffect(() => {
    const init = {};
    CURRENCIES.forEach(p => { init[p] = generatePriceHistory(BASE_RATES[p]); });
    setPriceData(init);
  }, []);

  useEffect(() => {
    if (!Object.keys(priceData).length) return;
    const interval = setInterval(() => {
      setPriceData(prev => {
        const next = { ...prev };
        CURRENCIES.forEach(pair => {
          const arr = [...prev[pair]];
          const last = arr[arr.length - 1].price;
          const newPrice = parseFloat((last + (Math.random() - 0.495) * last * 0.002).toFixed(4));
          arr.push({ time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), price: newPrice, vol: Math.floor(Math.random() * 800 + 200) });
          if (arr.length > 80) arr.shift();
          next[pair] = arr;
        });
        return next;
      });
      setTicker(t => t + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, [priceData]);

  useEffect(() => {
    if (!Object.keys(priceData).length) return;
    const s = {};
    CURRENCIES.forEach(pair => {
      const arr = priceData[pair];
      const prices = arr.map(d => d.price);
      const rsi = calcRSI(prices), macd = calcMACD(prices), boll = calcBollinger(prices);
      s[pair] = { ...generateSignal(rsi, macd, prices.at(-1), boll, Math.random() - 0.45), rsi, macd, bollinger: boll };
    });
    setSignals(s);
  }, [ticker]);

  // ── Proxy health check with retry logic for Render cold starts ────────────
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      setProxyStatus(prev => prev === "online" ? "online" : "checking");

      // Up to 3 attempts with 5s gaps — handles Render's ~30s cold start
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        if (attempt > 0) {
          setProxyStatus("waking");
          await new Promise(r => setTimeout(r, 5000));
        }
        try {
          const r = await fetch(`${PROXY}/`, {
            signal: AbortSignal.timeout(15000),
          });
          if (r.ok) {
            if (!cancelled) setProxyStatus("online");
            return;
          }
        } catch {
          // timeout or network error — try again
        }
      }
      if (!cancelled) setProxyStatus("offline");
    };

    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Live Binance ticker polling ───────────────────────────────────────────
  useEffect(() => {
    if (!proxyOnline) return;
    const symbols = TRADE_SYMBOLS.map(s => s.value).join(",");
    const poll = () => {
      fetch(`${PROXY}/ticker?symbols=${symbols}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok) {
            const map = {};
            data.tickers.forEach(t => { map[t.symbol] = t; });
            setLiveTickerData(map);
          }
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [proxyOnline]);

  // ── Order book polling ────────────────────────────────────────────────────
  useEffect(() => {
    if (!proxyOnline) return;
    const poll = () => {
      fetch(`${PROXY}/orderbook?symbol=${selectedSymbol.value}`)
        .then(r => r.json())
        .then(data => { if (data.ok) setOrderBook(data.data); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [proxyOnline, selectedSymbol]);

  // ── Connect Binance ───────────────────────────────────────────────────────
  const connectBinance = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) { setCredsError("Both fields required."); return; }
    setBalanceLoading(true);
    setCredsError("");
    try {
      const res = await fetch(`${PROXY}/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setBalances(data.balances);
        setCredsSaved(true);
        fetchOpenOrders();
        fetchOrderHistory();
      } else {
        setCredsError("Connection failed: " + (data.error || "Check your API keys and permissions."));
      }
    } catch {
      setCredsError("Could not reach proxy. Check your Render deployment.");
    }
    setBalanceLoading(false);
  };

  const fetchOpenOrders = async () => {
    try {
      const res = await fetch(`${PROXY}/orders/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      const data = await res.json();
      if (data.ok) setOpenOrders(data.orders);
    } catch {}
  };

  const fetchOrderHistory = async () => {
    try {
      const res = await fetch(`${PROXY}/orders/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, symbol: selectedSymbol.value }),
      });
      const data = await res.json();
      if (data.ok) setOrderHistory(data.orders);
    } catch {}
  };

  const handlePlaceOrder = () => {
    if (!orderQty || parseFloat(orderQty) <= 0) return;
    if (orderType === "Limit" && (!orderPrice || parseFloat(orderPrice) <= 0)) return;
    setConfirmOrder({ symbol: selectedSymbol.value, side: orderSide, orderType, qty: orderQty, price: orderPrice, base: selectedSymbol.base });
  };

  const executeOrder = async () => {
    setOrderLoading(true);
    try {
      const res = await fetch(`${PROXY}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey, apiSecret,
          symbol: confirmOrder.symbol,
          side: confirmOrder.side,
          orderType: confirmOrder.orderType,
          qty: confirmOrder.qty,
          price: confirmOrder.orderType === "Limit" ? confirmOrder.price : undefined,
        }),
      });
      const data = await res.json();
      setOrderResult(data);
      setConfirmOrder(null);
      if (data.ok) {
        setOrderQty("");
        setOrderPrice("");
        setTimeout(() => { fetchOpenOrders(); fetchOrderHistory(); }, 1500);
        setTimeout(() => setOrderResult(null), 6000);
      }
    } catch (err) {
      setOrderResult({ ok: false, error: err.message });
    }
    setOrderLoading(false);
  };

  const cancelOrder = async (symbol, orderId) => {
    try {
      await fetch(`${PROXY}/order/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, symbol, orderId }),
      });
      fetchOpenOrders();
    } catch {}
  };

  // ── AI Chat ───────────────────────────────────────────────────────────────
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const buildContext = useCallback(() => {
    const pairLines = CURRENCIES.map(pair => {
      const arr = priceData[pair]; if (!arr) return `${pair}: loading`;
      const price = arr.at(-1).price, prev = arr.at(-2)?.price || price;
      const sig = signals[pair];
      return `${pair}: ${price.toFixed(4)} (${((price - prev) / prev * 100).toFixed(3)}%) | Signal: ${sig?.action || "N/A"} ${sig?.confidence || 0}% | RSI:${sig?.rsi || "N/A"} MACD:${sig?.macd?.toFixed(5) || "N/A"}`;
    }).join("\n");
    const binanceLines = Object.entries(liveTickerData).map(([sym, t]) =>
      `${sym}: $${t.price} (24h: ${(parseFloat(t.change24h || 0) * 100).toFixed(2)}%)`
    ).join("\n") || "Not connected";
    const balLines = balances.map(b => `${b.coin}: ${b.available} free, ${b.locked} locked`).join("\n") || "Not connected";
    return `You are FX·INTEL, an expert FX and crypto trading analyst connected to Binance. Be direct and data-driven. Use **bold**, - bullet points, ### headers. Always give a clear bottom line.

== FX PAIRS (simulated) ==\n${pairLines}
== BINANCE LIVE PRICES ==\n${binanceLines}
== BINANCE BALANCE ==\n${balLines}
== NEWS ==\n${NEWS_SENTIMENT.map(n => `[${n.sentiment > 0 ? "+" : ""}${n.sentiment}] ${n.headline}`).join("\n")}
== TIME == ${new Date().toLocaleString()}

Give grounded, actionable analysis. Always add a brief risk disclaimer when suggesting trades.`;
  }, [priceData, signals, liveTickerData, balances]);

  const sendMessage = useCallback(async (text) => {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatMessages(prev => [...prev,
      { role: "user", content: msg, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      { role: "assistant", content: "", loading: true },
    ]);
    setChatInput("");
    setChatLoading(true);
    try {
      const history = chatMessages.filter(m => !m.loading).slice(-10).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildContext(),
          messages: [...history, { role: "user", content: msg }],
        }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev.slice(0, -1), {
        role: "assistant",
        content: data.content?.[0]?.text || "Error getting response.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    } catch {
      setChatMessages(prev => [...prev.slice(0, -1), {
        role: "assistant",
        content: "⚠️ Connection error. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    }
    setChatLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [chatInput, chatLoading, chatMessages, buildContext]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    app: { minHeight: "100vh", background: "#080c14", fontFamily: "'DM Mono','Fira Code',monospace", color: "#e2e8f0", overflowX: "hidden" },
    header: { background: "rgba(10,15,25,0.95)", borderBottom: "1px solid rgba(0,255,136,0.15)", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)" },
    logo: { fontSize: 18, fontWeight: 700, color: "#00ff88", letterSpacing: 2, display: "flex", alignItems: "center", gap: 10 },
    liveTag: { background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.4)", color: "#00ff88", fontSize: 10, padding: "2px 8px", borderRadius: 20, letterSpacing: 2, animation: "pulse 2s infinite" },
    navBar: { display: "flex", gap: 4, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 4 },
    navBtn: (active) => ({ background: active ? "rgba(0,255,136,0.15)" : "transparent", color: active ? "#00ff88" : "rgba(255,255,255,0.5)", border: active ? "1px solid rgba(0,255,136,0.3)" : "1px solid transparent", padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit", transition: "all 0.2s" }),
    main: { padding: 24, maxWidth: 1400, margin: "0 auto" },
    card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 },
    label: { fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 },
    input: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 14px", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", width: "100%", outline: "none", boxSizing: "border-box" },
    select: { background: "#0d1420", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 14px", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", cursor: "pointer" },
    btn: { background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.4)", color: "#00ff88", borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", letterSpacing: 1, transition: "all 0.2s" },
    divider: { height: 1, background: "rgba(255,255,255,0.06)", margin: "16px 0" },
    signalBadge: (color) => ({ display: "inline-flex", alignItems: "center", gap: 8, background: `${color}22`, border: `1px solid ${color}55`, color, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, letterSpacing: 2 }),
    pairBtn: (active) => ({ background: active ? "rgba(0,255,136,0.12)" : "rgba(255,255,255,0.03)", border: active ? "1px solid rgba(0,255,136,0.4)" : "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 16px", cursor: "pointer", color: active ? "#00ff88" : "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "inherit", width: "100%", textAlign: "left", transition: "all 0.2s" }),
    bigNum: { fontSize: 32, fontWeight: 700, letterSpacing: -1, color: "#fff" },
  };

  const livePx = liveTickerData[selectedSymbol.value];
  const impactColor = (i) => i === "HIGH" ? "#ff4466" : i === "MED" ? "#ffaa00" : "#00ff88";

  // ── Proxy status badge ────────────────────────────────────────────────────
  const ProxyBadge = () => {
    const cfg = {
      checking: { color: "#ffaa00", bg: "rgba(255,170,0,0.1)", border: "rgba(255,170,0,0.25)", label: "○ Checking…" },
      waking:   { color: "#ffaa00", bg: "rgba(255,170,0,0.1)", border: "rgba(255,170,0,0.25)", label: "⟳ Waking proxy…" },
      online:   { color: "#00ff88", bg: "rgba(0,255,136,0.1)",  border: "rgba(0,255,136,0.25)", label: "⬡ Binance Online" },
      offline:  { color: "#ff4466", bg: "rgba(255,68,102,0.1)", border: "rgba(255,68,102,0.2)", label: "○ Proxy Offline" },
    }[proxyStatus];
    return (
      <div style={{ fontSize: 10, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, padding: "2px 8px", borderRadius: 20 }}>
        {cfg.label}
      </div>
    );
  };

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeSlideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dotBounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-6px);opacity:1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing:border-box; }
        button:hover { filter:brightness(1.15); }
        input:focus,select:focus { border-color:rgba(0,255,136,0.4)!important; outline:none; }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0a0f18} ::-webkit-scrollbar-thumb{background:#1e3a2f;border-radius:4px}
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          <span style={{ fontSize: 22 }}>⬡</span>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 20 }}>FX<span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>INTEL</span>
          <div style={s.liveTag}>● LIVE</div>
          <ProxyBadge />
        </div>
        <div style={s.navBar}>
          {[["trade","⬡ Trade"],["dashboard","◈ Dashboard"],["signals","◈ Signals"],["sentiment","◉ Sentiment"],["calendar","◷ Calendar"],["ai","✦ AI Analyst"]].map(([id, label]) => (
            <button key={id} style={s.navBtn(tab === id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{new Date().toLocaleString()}</div>
      </div>

      {/* Ticker tape */}
      <div style={{ background: "rgba(0,255,136,0.05)", borderBottom: "1px solid rgba(0,255,136,0.1)", padding: "6px 0", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 40, animation: "ticker 30s linear infinite", whiteSpace: "nowrap", width: "max-content" }}>
          {[...CURRENCIES, ...CURRENCIES].map((pair, i) => {
            const arr = priceData[pair];
            const price = arr ? arr.at(-1).price : BASE_RATES[pair];
            const prev = arr ? arr.at(-2)?.price || price : price;
            const up = price >= prev;
            return (
              <span key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", display: "flex", gap: 8 }}>
                <span style={{ color: "rgba(255,255,255,0.3)" }}>{CURRENCY_ICONS[pair]}</span>
                <span>{pair}</span>
                <span style={{ color: "#fff", fontWeight: 500 }}>{price.toFixed(4)}</span>
                <span style={{ color: up ? "#00ff88" : "#ff4466" }}>{up ? "▲" : "▼"} {Math.abs(((price - prev) / prev * 100)).toFixed(3)}%</span>
              </span>
            );
          })}
        </div>
      </div>

      <ConfirmModal order={confirmOrder} onConfirm={executeOrder} onCancel={() => setConfirmOrder(null)} loading={orderLoading} />

      <div style={s.main}>

        {/* ═══ TRADE TAB ═══ */}
        {tab === "trade" && (
          <div>
            <div style={{ fontSize: 20, fontFamily: "'Syne',sans-serif", marginBottom: 4, color: "#fff" }}>⬡ Trade on Binance</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>Spot trading via your Binance API keys</div>

            {/* Proxy status banner */}
            {proxyStatus === "offline" && (
              <div style={{ ...s.card, marginBottom: 20, background: "rgba(255,68,102,0.06)", border: "1px solid rgba(255,68,102,0.25)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#ff4466", marginBottom: 8 }}>⚠️ Proxy Not Reachable</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.8 }}>
                  Your Render proxy is offline or the URL is wrong. Current URL:<br />
                  <code style={{ background: "rgba(0,0,0,0.3)", color: "#00ff88", padding: "8px 14px", borderRadius: 8, display: "inline-block", marginTop: 8, fontSize: 13 }}>{PROXY}</code>
                </div>
              </div>
            )}
            {(proxyStatus === "checking" || proxyStatus === "waking") && (
              <div style={{ ...s.card, marginBottom: 20, background: "rgba(255,170,0,0.04)", border: "1px solid rgba(255,170,0,0.2)" }}>
                <div style={{ fontSize: 13, color: "#ffaa00", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
                  {proxyStatus === "waking"
                    ? "Waking up Render proxy — this can take up to 30 seconds on the free tier…"
                    : "Connecting to proxy…"}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>

              {/* API Keys card */}
              <div style={{ ...s.card, gridColumn: credsSaved ? "auto" : "1 / span 2" }}>
                <div style={s.label}>🔑 Binance API Credentials</div>
                {credsSaved ? (
                  <div>
                    <div style={{ fontSize: 13, color: "#00ff88", marginBottom: 12 }}>✓ Connected to Binance</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                      {balances.length > 0 ? balances.map(b => (
                        <div key={b.coin} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                          <span style={{ fontWeight: 700 }}>{b.coin}</span>
                          <span>{parseFloat(b.available).toFixed(6)}</span>
                          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>🔒 {parseFloat(b.locked).toFixed(4)}</span>
                        </div>
                      )) : <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>No balances found</div>}
                    </div>
                    <button style={{ ...s.btn, marginTop: 12, width: "100%", fontSize: 11 }} onClick={() => { fetchOpenOrders(); fetchOrderHistory(); }}>↺ Refresh</button>
                    <button style={{ background: "transparent", border: "1px solid rgba(255,68,102,0.3)", color: "#ff4466", borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", width: "100%", marginTop: 8 }} onClick={() => { setCredsSaved(false); setApiKey(""); setApiSecret(""); setBalances([]); }}>Disconnect</button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14, lineHeight: 1.8 }}>
                      Your keys are sent only to your Render proxy — never to any third party.<br />
                      Make sure your Binance API key has <strong style={{ color: "#ffaa00" }}>Read Info</strong> + <strong style={{ color: "#ffaa00" }}>Spot Trading</strong> enabled.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <div style={{ ...s.label, marginBottom: 6 }}>API Key</div>
                        <input style={s.input} type="text" placeholder="Paste your Binance API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ ...s.label, marginBottom: 6 }}>Secret Key</div>
                        <input style={s.input} type="password" placeholder="Paste your Binance Secret Key" value={apiSecret} onChange={e => setApiSecret(e.target.value)} />
                      </div>
                      {credsError && <div style={{ fontSize: 12, color: "#ff4466", background: "rgba(255,68,102,0.08)", padding: "8px 12px", borderRadius: 8, lineHeight: 1.6 }}>{credsError}</div>}
                      <button style={{ ...s.btn, width: "100%" }} onClick={connectBinance} disabled={balanceLoading}>
                        {balanceLoading ? "Connecting..." : "Connect Binance Account"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Live price */}
              {credsSaved && (
                <div style={s.card}>
                  <div style={s.label}>Live Price</div>
                  <select style={{ ...s.select, width: "100%", marginBottom: 12 }} value={selectedSymbol.value} onChange={e => setSelectedSymbol(TRADE_SYMBOLS.find(s => s.value === e.target.value))}>
                    {TRADE_SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  {livePx ? (
                    <>
                      <div style={s.bigNum}>${parseFloat(livePx.price).toLocaleString()}</div>
                      <div style={{ fontSize: 13, color: parseFloat(livePx.change24h) >= 0 ? "#00ff88" : "#ff4466", marginTop: 4 }}>
                        {parseFloat(livePx.change24h) >= 0 ? "▲" : "▼"} {(Math.abs(parseFloat(livePx.change24h || 0)) * 100).toFixed(2)}% 24h
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                        {[["High 24h", `$${parseFloat(livePx.high24h || 0).toLocaleString()}`], ["Low 24h", `$${parseFloat(livePx.low24h || 0).toLocaleString()}`], ["Volume", parseFloat(livePx.volume24h || 0).toFixed(2)]].map(([k, v]) => (
                          <div key={k} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{k}</div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Waiting for data...</div>}
                </div>
              )}

              {/* Order book */}
              {credsSaved && orderBook && (
                <div style={s.card}>
                  <div style={s.label}>Order Book — {selectedSymbol.label}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#00ff88", marginBottom: 6 }}>BIDS</div>
                      {(orderBook.b || []).slice(0, 5).map(([px, qty], i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,255,136,0.05)" }}>
                          <span style={{ color: "#00ff88" }}>{parseFloat(px).toLocaleString()}</span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>{parseFloat(qty).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#ff4466", marginBottom: 6 }}>ASKS</div>
                      {(orderBook.a || []).slice(0, 5).map(([px, qty], i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(255,68,102,0.05)" }}>
                          <span style={{ color: "#ff4466" }}>{parseFloat(px).toLocaleString()}</span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>{parseFloat(qty).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Order placement */}
            {credsSaved && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={s.card}>
                  <div style={s.label}>Place Order</div>
                  {orderResult && (
                    <div style={{ padding: "12px 16px", borderRadius: 10, marginBottom: 16, background: orderResult.ok ? "rgba(0,255,136,0.1)" : "rgba(255,68,102,0.1)", border: `1px solid ${orderResult.ok ? "rgba(0,255,136,0.3)" : "rgba(255,68,102,0.3)"}`, fontSize: 12, color: orderResult.ok ? "#00ff88" : "#ff4466" }}>
                      {orderResult.ok ? `✓ Order placed! ID: ${orderResult.orderId}` : `✗ Failed: ${orderResult.data?.msg || orderResult.error}`}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <div style={s.label}>Symbol</div>
                      <select style={{ ...s.select, width: "100%" }} value={selectedSymbol.value} onChange={e => setSelectedSymbol(TRADE_SYMBOLS.find(s => s.value === e.target.value))}>
                        {TRADE_SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label} — {liveTickerData[s.value] ? "$" + parseFloat(liveTickerData[s.value].price).toLocaleString() : "..."}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {["Buy", "Sell"].map(side => (
                        <button key={side} onClick={() => setOrderSide(side)} style={{ padding: "12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, letterSpacing: 1, transition: "all 0.2s", border: orderSide === side ? `1px solid ${side === "Buy" ? "rgba(0,255,136,0.6)" : "rgba(255,68,102,0.6)"}` : "1px solid rgba(255,255,255,0.1)", background: orderSide === side ? (side === "Buy" ? "rgba(0,255,136,0.18)" : "rgba(255,68,102,0.18)") : "rgba(255,255,255,0.03)", color: orderSide === side ? (side === "Buy" ? "#00ff88" : "#ff4466") : "rgba(255,255,255,0.4)" }}>
                          {side === "Buy" ? "▲ BUY" : "▼ SELL"}
                        </button>
                      ))}
                    </div>
                    <div>
                      <div style={s.label}>Order Type</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {["Market", "Limit"].map(type => (
                          <button key={type} onClick={() => setOrderType(type)} style={{ padding: "8px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, transition: "all 0.2s", border: orderType === type ? "1px solid rgba(0,255,136,0.4)" : "1px solid rgba(255,255,255,0.08)", background: orderType === type ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.03)", color: orderType === type ? "#00ff88" : "rgba(255,255,255,0.5)" }}>
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={s.label}>Quantity ({selectedSymbol.base})</div>
                      <input style={s.input} type="number" placeholder="e.g. 0.001" value={orderQty} onChange={e => setOrderQty(e.target.value)} min="0" step="any" />
                      {livePx && orderQty && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
                          ≈ ${(parseFloat(orderQty || 0) * parseFloat(livePx.price || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT
                        </div>
                      )}
                    </div>
                    {orderType === "Limit" && (
                      <div>
                        <div style={s.label}>Limit Price (USDT)</div>
                        <input style={s.input} type="number" placeholder={livePx ? `Market: $${parseFloat(livePx.price).toLocaleString()}` : "Price"} value={orderPrice} onChange={e => setOrderPrice(e.target.value)} min="0" step="any" />
                      </div>
                    )}
                    <button onClick={handlePlaceOrder} disabled={!orderQty || (orderType === "Limit" && !orderPrice)} style={{ padding: "14px", borderRadius: 12, cursor: !orderQty ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 15, letterSpacing: 2, transition: "all 0.2s", background: !orderQty ? "rgba(255,255,255,0.04)" : (orderSide === "Buy" ? "rgba(0,255,136,0.2)" : "rgba(255,68,102,0.2)"), border: !orderQty ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${orderSide === "Buy" ? "rgba(0,255,136,0.5)" : "rgba(255,68,102,0.5)"}`, color: !orderQty ? "rgba(255,255,255,0.2)" : (orderSide === "Buy" ? "#00ff88" : "#ff4466") }}>
                      {orderSide === "Buy" ? "▲" : "▼"} REVIEW {orderSide.toUpperCase()} ORDER
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={s.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={s.label}>Open Orders ({openOrders.length})</div>
                      <button style={{ ...s.btn, fontSize: 10, padding: "4px 10px" }} onClick={fetchOpenOrders}>↺</button>
                    </div>
                    {openOrders.length === 0
                      ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "16px 0" }}>No open orders</div>
                      : openOrders.map(o => (
                        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 6 }}>
                          <div>
                            <span style={{ color: o.side === "BUY" ? "#00ff88" : "#ff4466", fontWeight: 700 }}>{o.side} </span>
                            <span>{o.symbol}</span>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{o.qty} @ ${parseFloat(o.price || 0).toLocaleString()}</div>
                          </div>
                          <button onClick={() => cancelOrder(o.symbol, o.orderId)} style={{ background: "transparent", border: "1px solid rgba(255,68,102,0.3)", color: "#ff4466", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>Cancel</button>
                        </div>
                      ))
                    }
                  </div>
                  <div style={{ ...s.card, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={s.label}>Recent Orders — {selectedSymbol.label}</div>
                      <button style={{ ...s.btn, fontSize: 10, padding: "4px 10px" }} onClick={fetchOrderHistory}>↺</button>
                    </div>
                    <div style={{ maxHeight: 250, overflowY: "auto" }}>
                      {orderHistory.length === 0
                        ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "16px 0" }}>No history for {selectedSymbol.label}</div>
                        : orderHistory.map(o => (
                          <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6, marginBottom: 4 }}>
                            <div>
                              <span style={{ color: o.side === "BUY" ? "#00ff88" : "#ff4466" }}>{o.side} </span>
                              <span style={{ color: "rgba(255,255,255,0.7)" }}>{o.symbol}</span>
                              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{o.qty} · {o.orderType}</div>
                            </div>
                            <span style={{ fontSize: 10, color: o.orderStatus === "FILLED" ? "#00ff88" : o.orderStatus === "CANCELED" ? "#ff4466" : "#ffaa00" }}>{o.orderStatus}</span>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
            <div style={s.card}>
              <div style={s.label}>Currency Pairs</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {CURRENCIES.map(pair => {
                  const arr = priceData[pair];
                  const price = arr ? arr.at(-1).price : BASE_RATES[pair];
                  const prev = arr ? arr.at(-2)?.price || price : price;
                  const up = price >= prev;
                  const sig2 = signals[pair];
                  return (
                    <button key={pair} style={s.pairBtn(selectedPair === pair)} onClick={() => setSelectedPair(pair)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{CURRENCY_ICONS[pair]} {pair}</div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{price.toFixed(4)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {sig2 && <div style={{ fontSize: 10, color: sig2.color, fontWeight: 700 }}>{sig2.action}</div>}
                          <div style={{ fontSize: 10, color: up ? "#00ff88" : "#ff4466" }}>{up ? "+" : ""}{((price - prev) / prev * 100).toFixed(3)}%</div>
                        </div>
                      </div>
                      {arr && <div style={{ marginTop: 6 }}><MiniChart data={arr.slice(-20)} color={up ? "#00ff88" : "#ff4466"} width={170} height={28} /></div>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={s.card}>
              <div style={s.label}>{selectedPair} · Live Price</div>
              {(() => {
                const arr = priceData[selectedPair];
                const price = arr ? arr.at(-1).price : 0;
                const prev = arr ? arr.at(-2)?.price || price : 0;
                const chg = price - prev;
                const sig = signals[selectedPair];
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                        <div style={s.bigNum}>{price.toFixed(4)}</div>
                        <div style={{ color: chg >= 0 ? "#00ff88" : "#ff4466", fontSize: 14 }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(4)}</div>
                      </div>
                      {sig && <div style={s.signalBadge(sig.color)}>{sig.action} · {sig.confidence}%</div>}
                    </div>
                    {sig && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
                        {[["RSI (14)", sig.rsi, sig.rsi < 35 ? "#00ff88" : sig.rsi > 65 ? "#ff4466" : "#ffaa00"], ["MACD", sig.macd?.toFixed(6), sig.macd > 0 ? "#00ff88" : "#ff4466"], ["Bollinger Mid", sig.bollinger?.mid?.toFixed(4), "#aaa"]].map(([k, v, c]) => (
                          <div key={k} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={s.label}>{k}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: c }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ═══ SIGNALS ═══ */}
        {tab === "signals" && (
          <div>
            <div style={{ fontSize: 20, fontFamily: "'Syne',sans-serif", marginBottom: 20, color: "#fff" }}>◈ All Signals</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {CURRENCIES.map(pair => {
                const arr = priceData[pair];
                const price = arr ? arr.at(-1).price : BASE_RATES[pair];
                const sig2 = signals[pair];
                if (!sig2) return null;
                return (
                  <div key={pair} style={{ ...s.card, border: `1px solid ${sig2.color}33` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{CURRENCY_ICONS[pair]} {pair}</div>
                        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{price.toFixed(4)}</div>
                      </div>
                      <div style={s.signalBadge(sig2.color)}>{sig2.action}</div>
                    </div>
                    {arr && <MiniChart data={arr.slice(-25)} color={sig2.color} width={250} height={50} />}
                    <div style={s.divider} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[["RSI", sig2.rsi], ["MACD", sig2.macd?.toFixed(4)], ["Conf.", `${sig2.confidence}%`]].map(([k, v]) => (
                        <div key={k} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{k}</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: sig2.color }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ SENTIMENT ═══ */}
        {tab === "sentiment" && (
          <div>
            <div style={{ fontSize: 20, fontFamily: "'Syne',sans-serif", marginBottom: 20, color: "#fff" }}>◉ News & Sentiment</div>
            <div style={s.card}>
              <div style={s.label}>Latest Market-Moving News</div>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {NEWS_SENTIMENT.map((n, i) => (
                  <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: `1px solid ${n.sentiment > 0 ? "rgba(0,255,136,0.1)" : "rgba(255,68,102,0.1)"}` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: n.sentiment > 0 ? "rgba(0,255,136,0.15)" : "rgba(255,68,102,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{n.sentiment > 0 ? "📈" : "📉"}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: "#e2e8f0" }}>{n.headline}</div>
                      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{n.time}</span>
                        <span style={{ fontSize: 10, color: n.sentiment > 0 ? "#00ff88" : "#ff4466", fontWeight: 600 }}>Sentiment: {n.sentiment > 0 ? "+" : ""}{n.sentiment.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ CALENDAR ═══ */}
        {tab === "calendar" && (
          <div>
            <div style={{ fontSize: 20, fontFamily: "'Syne',sans-serif", marginBottom: 20, color: "#fff" }}>◷ Economic Calendar</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ECONOMIC_EVENTS.map((ev, i) => (
                <div key={i} style={{ ...s.card, display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 60, textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{ev.time}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Today</div>
                  </div>
                  <div style={{ width: 4, height: 50, background: impactColor(ev.impact), borderRadius: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{ev.event}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                      <span style={{ fontSize: 10, background: "rgba(255,255,255,0.08)", padding: "2px 10px", borderRadius: 10 }}>Affects: {ev.currency}</span>
                      <span style={{ fontSize: 10, color: impactColor(ev.impact), fontWeight: 700 }}>● {ev.impact} IMPACT</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>In {ev.hours}h</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ AI ANALYST ═══ */}
        {tab === "ai" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, height: "calc(100vh - 180px)", minHeight: 600 }}>
            <div style={{ ...s.card, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12, background: "rgba(0,255,136,0.04)" }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(0,255,136,0.12)", border: "1px solid rgba(0,255,136,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⬡</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne',sans-serif" }}>FX·INTEL AI Analyst</div>
                  <div style={{ fontSize: 10, color: "#00ff88", marginTop: 2 }}>● Binance · {CURRENCIES.length} FX pairs · {TRADE_SYMBOLS.length} crypto pairs{credsSaved ? " · Account connected" : ""}</div>
                </div>
                <button style={{ ...s.btn, marginLeft: "auto", fontSize: 10, padding: "4px 12px" }} onClick={() => setChatMessages([{ role: "assistant", content: "Cleared. Ready for fresh analysis.", timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }])}>↺ Clear</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 10px" }}>
                {chatMessages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
                <div ref={chatEndRef} />
              </div>
              <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <textarea ref={inputRef} value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Ask about any pair, signals, balance, macro risks..." rows={2} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", resize: "none", outline: "none", lineHeight: 1.5 }} />
                  <button onClick={() => sendMessage()} disabled={chatLoading || !chatInput.trim()} style={{ width: 42, height: 42, borderRadius: 10, background: chatLoading || !chatInput.trim() ? "rgba(0,255,136,0.06)" : "rgba(0,255,136,0.18)", border: `1px solid ${chatLoading || !chatInput.trim() ? "rgba(0,255,136,0.1)" : "rgba(0,255,136,0.4)"}`, color: chatLoading || !chatInput.trim() ? "rgba(0,255,136,0.3)" : "#00ff88", cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                    {chatLoading ? "⟳" : "↑"}
                  </button>
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 6, textAlign: "center" }}>Enter to send · Shift+Enter for new line</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={s.card}>
                <div style={s.label}>✦ Quick Prompts</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
                  {SUGGESTED_PROMPTS.map((p, i) => (
                    <button key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "9px 12px", cursor: "pointer", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "inherit", display: "flex", gap: 8, alignItems: "center" }} onClick={() => sendMessage(p.text)}>
                      <span style={{ fontSize: 14 }}>{p.icon}</span><span>{p.label}</span><span style={{ marginLeft: "auto", color: "#00ff88", opacity: 0.6 }}>→</span>
                    </button>
                  ))}
                </div>
              </div>
              {credsSaved && balances.length > 0 && (
                <div style={s.card}>
                  <div style={s.label}>Binance Balance</div>
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    {balances.map(b => (
                      <div key={b.coin} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontWeight: 700 }}>{b.coin}</span>
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{parseFloat(b.available).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
