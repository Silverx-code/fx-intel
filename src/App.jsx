import { useState, useEffect, useRef, useCallback } from "react";

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

function generatePriceHistory(base, points = 80) {
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
  if (score >= 2) return { action: "BUY", color: "#00ffaa", confidence: parseFloat(confidence.toFixed(1)), reasons };
  if (score <= -2) return { action: "SELL", color: "#ff3366", confidence: parseFloat(confidence.toFixed(1)), reasons };
  return { action: "HOLD", color: "#ffcc00", confidence: parseFloat(confidence.toFixed(1)), reasons };
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

// ── Full-size SVG price chart ──────────────────────────────────────────────────
function PriceChart({ data, color, width = 600, height = 200, showLabels = true }) {
  const prices = data.map(d => d.price);
  const min = Math.min(...prices) * 0.999;
  const max = Math.max(...prices) * 1.001;
  const range = max - min || 1;
  const pad = { top: 20, right: 16, bottom: showLabels ? 32 : 8, left: showLabels ? 64 : 8 };
  const W = width - pad.left - pad.right;
  const H = height - pad.top - pad.bottom;

  const pts = prices.map((p, i) => {
    const x = pad.left + (i / (prices.length - 1)) * W;
    const y = pad.top + H - ((p - min) / range) * H;
    return `${x},${y}`;
  });

  const areaPoints = `${pad.left},${pad.top + H} ${pts.join(" ")} ${pad.left + W},${pad.top + H}`;
  const gradId = `grad_${color.replace("#", "")}`;
  const lastPrice = prices.at(-1);
  const firstPrice = prices[0];
  const isUp = lastPrice >= firstPrice;

  // y-axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = min + (i / yTicks) * range;
    return { y: pad.top + H - (i / yTicks) * H, val };
  });

  // x-axis labels - show every Nth
  const step = Math.max(1, Math.floor(prices.length / 6));
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={pad.left} y1={l.y} x2={pad.left + W} y2={l.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4,4" />
          {showLabels && (
            <text x={pad.left - 6} y={l.y + 4} fill="rgba(255,255,255,0.35)" fontSize="11" textAnchor="end" fontFamily="'DM Mono', monospace">
              {l.val >= 100 ? l.val.toFixed(0) : l.val >= 1 ? l.val.toFixed(3) : l.val.toFixed(5)}
            </text>
          )}
        </g>
      ))}

      {/* Area fill */}
      <polygon points={areaPoints} fill={`url(#${gradId})`} />

      {/* Price line */}
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glow)"
      />

      {/* Last price dot */}
      {pts.length > 0 && (() => {
        const [lx, ly] = pts.at(-1).split(",").map(Number);
        return (
          <g>
            <circle cx={lx} cy={ly} r="5" fill={color} filter="url(#glow)" />
            <circle cx={lx} cy={ly} r="10" fill={color} fillOpacity="0.2" />
          </g>
        );
      })()}

      {/* X-axis labels */}
      {showLabels && xLabels.map((d, i) => {
        const idx = data.indexOf(d);
        const x = pad.left + (idx / (prices.length - 1)) * W;
        return (
          <text key={i} x={x} y={height - 4} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle" fontFamily="'DM Mono', monospace">
            {d.time}
          </text>
        );
      })}
    </svg>
  );
}

// ── Mini sparkline ────────────────────────────────────────────────────────────
function MiniChart({ data, color, width = 120, height = 48 }) {
  const prices = data.map(d => d.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) =>
    `${(i / (prices.length - 1)) * width},${height - ((p - min) / range) * height}`
  ).join(" ");
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`mg${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#mg${color.replace("#", "")})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ order, onConfirm, onCancel, loading }) {
  if (!order) return null;
  const isBuy = order.side === "Buy";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, backdropFilter: "blur(8px)" }}>
      <div style={{ background: "#0a0f1e", border: `2px solid ${isBuy ? "rgba(0,255,170,0.4)" : "rgba(255,51,102,0.4)"}`, borderRadius: 24, padding: 40, width: 440, boxShadow: `0 0 60px ${isBuy ? "rgba(0,255,170,0.15)" : "rgba(255,51,102,0.15)"}` }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>Confirm Order</div>
        <div style={{ fontSize: 32, fontWeight: 900, color: isBuy ? "#00ffaa" : "#ff3366", marginBottom: 24, fontFamily: "'Syne', sans-serif" }}>
          {isBuy ? "▲ BUY" : "▼ SELL"} {order.symbol}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          {[["Exchange","Binance"],["Symbol",order.symbol],["Side",order.side],["Order Type",order.orderType],["Quantity",`${order.qty} ${order.base}`],order.orderType==="Limit"?["Limit Price",`$${order.price}`]:["Price","Market (best available)"]].map(([k,v])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:15, padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ color:"rgba(255,255,255,0.45)" }}>{k}</span>
              <span style={{ color:"#fff", fontWeight:700 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ background:"rgba(255,204,0,0.08)", border:"1px solid rgba(255,204,0,0.25)", borderRadius:12, padding:"12px 16px", fontSize:13, color:"rgba(255,204,0,0.9)", marginBottom:24 }}>
          ⚠️ This places a REAL order on your Binance account using real funds.
        </div>
        <div style={{ display:"flex", gap:12 }}>
          <button onClick={onCancel} style={{ flex:1, background:"transparent", border:"1px solid rgba(255,255,255,0.15)", color:"rgba(255,255,255,0.6)", borderRadius:12, padding:14, cursor:"pointer", fontSize:15, fontFamily:"inherit" }}>Cancel</button>
          <button onClick={onConfirm} disabled={loading} style={{ flex:2, background:isBuy?"rgba(0,255,170,0.18)":"rgba(255,51,102,0.18)", border:`2px solid ${isBuy?"rgba(0,255,170,0.6)":"rgba(255,51,102,0.6)"}`, color:isBuy?"#00ffaa":"#ff3366", borderRadius:12, padding:14, cursor:loading?"not-allowed":"pointer", fontSize:16, fontWeight:800, fontFamily:"inherit", letterSpacing:2 }}>
            {loading?"Placing…":`Confirm ${order.side.toUpperCase()}`}
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
        return <div key={i} style={{ display:"flex", gap:10, marginTop:6 }}><span style={{ color:"#00ffaa", flexShrink:0 }}>▸</span><span>{renderInline(line.trim().slice(2))}</span></div>;
      if (line.startsWith("### ")) return <div key={i} style={{ fontSize:15, fontWeight:700, color:"#00ffaa", marginTop:14, marginBottom:6 }}>{line.slice(4)}</div>;
      if (line.startsWith("## ")) return <div key={i} style={{ fontSize:17, fontWeight:700, color:"#fff", marginTop:16, marginBottom:8, borderBottom:"1px solid rgba(255,255,255,0.1)", paddingBottom:6 }}>{line.slice(3)}</div>;
      if (line === "") return <div key={i} style={{ height:8 }} />;
      return <div key={i} style={{ marginTop:3 }}>{renderInline(line)}</div>;
    });
  }
  function renderInline(text) {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} style={{ color:"#fff" }}>{part.slice(2,-2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background:"rgba(0,255,170,0.12)", color:"#00ffaa", padding:"2px 6px", borderRadius:5, fontSize:12 }}>{part.slice(1,-1)}</code>;
      return part;
    });
  }
  return (
    <div style={{ display:"flex", gap:14, flexDirection:isUser?"row-reverse":"row", alignItems:"flex-start", marginBottom:24, animation:"fadeIn 0.3s ease" }}>
      <div style={{ width:42, height:42, borderRadius:12, flexShrink:0, background:isUser?"rgba(255,255,255,0.08)":"rgba(0,255,170,0.12)", border:isUser?"1px solid rgba(255,255,255,0.12)":"1px solid rgba(0,255,170,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>
        {isUser?"👤":"⬡"}
      </div>
      <div style={{ maxWidth:"78%", background:isUser?"rgba(255,255,255,0.06)":"rgba(0,255,170,0.05)", border:isUser?"1px solid rgba(255,255,255,0.1)":"1px solid rgba(0,255,170,0.18)", borderRadius:isUser?"18px 4px 18px 18px":"4px 18px 18px 18px", padding:"16px 20px", fontSize:15, lineHeight:1.7, color:"rgba(255,255,255,0.9)" }}>
        {msg.loading
          ? <div style={{ display:"flex", gap:6, alignItems:"center", padding:"4px 0" }}>
              {[0,1,2].map(i=><div key={i} style={{ width:9, height:9, borderRadius:"50%", background:"#00ffaa", animation:`dotBounce 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
            </div>
          : renderText(msg.content)}
        {msg.timestamp && !msg.loading && <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:10, textAlign:isUser?"right":"left" }}>{msg.timestamp}</div>}
      </div>
    </div>
  );
}

// ══ MAIN APP ══════════════════════════════════════════════════════════════════
export default function FXIntelligence() {
  const [tab, setTab] = useState("dashboard");
  const [selectedPair, setSelectedPair] = useState("USD/NGN");
  const [priceData, setPriceData] = useState({});
  const [signals, setSignals] = useState({});
  const [ticker, setTicker] = useState(0);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsError, setCredsError] = useState("");

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
  const [proxyStatus, setProxyStatus] = useState("checking");
  const proxyOnline = proxyStatus === "online";

  const [chatMessages, setChatMessages] = useState([{
    role:"assistant",
    content:"Hello! I'm your FX Intelligence AI analyst, connected to **Binance**.\n\nAdd your Binance API keys in the **Trade** tab to view your balance and place orders. I have live access to prices, signals, and market news.\n\n**What would you like to analyse?**",
    timestamp: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }),
  }]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

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
          const last = arr.at(-1).price;
          const newPrice = parseFloat((last + (Math.random() - 0.495) * last * 0.002).toFixed(4));
          arr.push({ time: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }), price:newPrice, vol:Math.floor(Math.random()*800+200) });
          if (arr.length > 100) arr.shift();
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
      s[pair] = { ...generateSignal(rsi, macd, prices.at(-1), boll, Math.random()-0.45), rsi, macd, bollinger:boll };
    });
    setSignals(s);
  }, [ticker]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      setProxyStatus(prev => prev === "online" ? "online" : "checking");
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        if (attempt > 0) { setProxyStatus("waking"); await new Promise(r => setTimeout(r, 5000)); }
        try {
          const r = await fetch(`${PROXY}/`, { signal: AbortSignal.timeout(15000) });
          if (r.ok) { if (!cancelled) setProxyStatus("online"); return; }
        } catch {}
      }
      if (!cancelled) setProxyStatus("offline");
    };
    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!proxyOnline) return;
    const symbols = TRADE_SYMBOLS.map(s => s.value).join(",");
    const poll = () => {
      fetch(`${PROXY}/ticker?symbols=${symbols}`).then(r=>r.json()).then(data => {
        if (data.ok) { const map = {}; data.tickers.forEach(t => { map[t.symbol] = t; }); setLiveTickerData(map); }
      }).catch(()=>{});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [proxyOnline]);

  useEffect(() => {
    if (!proxyOnline) return;
    const poll = () => {
      fetch(`${PROXY}/orderbook?symbol=${selectedSymbol.value}`).then(r=>r.json()).then(data=>{if(data.ok) setOrderBook(data.data);}).catch(()=>{});
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [proxyOnline, selectedSymbol]);

  const connectBinance = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) { setCredsError("Both fields required."); return; }
    setBalanceLoading(true); setCredsError("");
    try {
      const res = await fetch(`${PROXY}/balance`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ apiKey:apiKey.trim(), apiSecret:apiSecret.trim() }) });
      const data = await res.json();
      if (data.ok) { setBalances(data.balances); setCredsSaved(true); fetchOpenOrders(); fetchOrderHistory(); }
      else { setCredsError("Connection failed: " + (data.error || "Check your API keys.")); }
    } catch { setCredsError("Could not reach proxy. Check your Render deployment."); }
    setBalanceLoading(false);
  };

  const fetchOpenOrders = async () => {
    try {
      const res = await fetch(`${PROXY}/orders/open`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({apiKey,apiSecret}) });
      const data = await res.json();
      if (data.ok) setOpenOrders(data.orders);
    } catch {}
  };

  const fetchOrderHistory = async () => {
    try {
      const res = await fetch(`${PROXY}/orders/history`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({apiKey,apiSecret,symbol:selectedSymbol.value}) });
      const data = await res.json();
      if (data.ok) setOrderHistory(data.orders);
    } catch {}
  };

  const handlePlaceOrder = () => {
    if (!orderQty || parseFloat(orderQty) <= 0) return;
    if (orderType === "Limit" && (!orderPrice || parseFloat(orderPrice) <= 0)) return;
    setConfirmOrder({ symbol:selectedSymbol.value, side:orderSide, orderType, qty:orderQty, price:orderPrice, base:selectedSymbol.base });
  };

  const executeOrder = async () => {
    setOrderLoading(true);
    try {
      const res = await fetch(`${PROXY}/order`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ apiKey, apiSecret, symbol:confirmOrder.symbol, side:confirmOrder.side, orderType:confirmOrder.orderType, qty:confirmOrder.qty, price:confirmOrder.orderType==="Limit"?confirmOrder.price:undefined }) });
      const data = await res.json();
      setOrderResult(data); setConfirmOrder(null);
      if (data.ok) { setOrderQty(""); setOrderPrice(""); setTimeout(()=>{fetchOpenOrders();fetchOrderHistory();},1500); setTimeout(()=>setOrderResult(null),6000); }
    } catch(err) { setOrderResult({ok:false,error:err.message}); }
    setOrderLoading(false);
  };

  const cancelOrder = async (symbol, orderId) => {
    try {
      await fetch(`${PROXY}/order/cancel`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({apiKey,apiSecret,symbol,orderId}) });
      fetchOpenOrders();
    } catch {}
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatMessages]);

  const buildContext = useCallback(() => {
    const pairLines = CURRENCIES.map(pair => {
      const arr = priceData[pair]; if (!arr) return `${pair}: loading`;
      const price = arr.at(-1).price, prev = arr.at(-2)?.price || price;
      const sig = signals[pair];
      return `${pair}: ${price.toFixed(4)} (${((price-prev)/prev*100).toFixed(3)}%) | Signal: ${sig?.action||"N/A"} ${sig?.confidence||0}% | RSI:${sig?.rsi||"N/A"} MACD:${sig?.macd?.toFixed(5)||"N/A"}`;
    }).join("\n");
    const binanceLines = Object.entries(liveTickerData).map(([sym,t])=>`${sym}: $${t.price} (24h: ${(parseFloat(t.change24h||0)*100).toFixed(2)}%)`).join("\n") || "Not connected";
    const balLines = balances.map(b=>`${b.coin}: ${b.available} free, ${b.locked} locked`).join("\n") || "Not connected";
    return `You are FX·INTEL, an expert FX and crypto trading analyst. Be direct, data-driven, and concise. Use **bold** for key numbers, - bullet points for lists, ### for section headers. Always end with a clear bottom-line recommendation.\n\n== FX PAIRS (simulated) ==\n${pairLines}\n== BINANCE LIVE PRICES ==\n${binanceLines}\n== BINANCE BALANCE ==\n${balLines}\n== NEWS ==\n${NEWS_SENTIMENT.map(n=>`[${n.sentiment>0?"+":""}${n.sentiment}] ${n.headline}`).join("\n")}\n== TIME == ${new Date().toLocaleString()}\n\nGive grounded, actionable analysis. Always add a brief risk disclaimer when suggesting trades.`;
  }, [priceData, signals, liveTickerData, balances]);

  const sendMessage = useCallback(async (text) => {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatMessages(prev => [...prev,
      { role:"user", content:msg, timestamp:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) },
      { role:"assistant", content:"", loading:true },
    ]);
    setChatInput(""); setChatLoading(true);
    try {
      const history = chatMessages.filter(m=>!m.loading).slice(-10).map(m=>({role:m.role,content:m.content}));
      const res = await fetch(`${PROXY}/ai`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ system:buildContext(), messages:[...history,{role:"user",content:msg}] }),
      });
      const data = await res.json();
      setChatMessages(prev=>[...prev.slice(0,-1),{ role:"assistant", content: data.ok ? (data.text || "No response.") : ("⚠️ " + (data.error || "AI error.")), timestamp:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) }]);
    } catch {
      setChatMessages(prev=>[...prev.slice(0,-1),{ role:"assistant", content:"⚠️ Connection error. Please try again.", timestamp:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) }]);
    }
    setChatLoading(false);
    setTimeout(()=>inputRef.current?.focus(),100);
  }, [chatInput, chatLoading, chatMessages, buildContext]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const NAV_TABS = [
    { id:"dashboard", icon:"◈", label:"Dashboard" },
    { id:"trade",     icon:"⬡", label:"Trade" },
    { id:"signals",   icon:"◉", label:"Signals" },
    { id:"sentiment", icon:"◈", label:"Sentiment" },
    { id:"calendar",  icon:"◷", label:"Calendar" },
    { id:"ai",        icon:"✦", label:"AI Analyst" },
  ];

  const proxyStatusCfg = {
    checking:{ color:"#ffcc00", label:"Checking…" },
    waking:  { color:"#ffcc00", label:"Waking…" },
    online:  { color:"#00ffaa", label:"Online" },
    offline: { color:"#ff3366", label:"Offline" },
  }[proxyStatus];

  const impactColor = (i) => i==="HIGH"?"#ff3366":i==="MED"?"#ffcc00":"#00ffaa";

  const card = { background:"rgba(255,255,255,0.035)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:24 };
  const input = { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:12, padding:"14px 18px", color:"#e2e8f0", fontSize:16, fontFamily:"inherit", width:"100%", outline:"none", boxSizing:"border-box" };
  const select = { background:"#080d1a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:12, padding:"14px 18px", color:"#e2e8f0", fontSize:16, fontFamily:"inherit", cursor:"pointer", width:"100%" };
  const btn = { background:"rgba(0,255,170,0.14)", border:"1px solid rgba(0,255,170,0.4)", color:"#00ffaa", borderRadius:12, padding:"14px 24px", cursor:"pointer", fontSize:15, fontFamily:"inherit", letterSpacing:1, transition:"all 0.2s" };
  const label = { fontSize:12, color:"rgba(255,255,255,0.38)", letterSpacing:3, textTransform:"uppercase", marginBottom:8, display:"block" };

  return (
    <div style={{ minHeight:"100vh", background:"#060a14", fontFamily:"'DM Mono','Fira Code',monospace", color:"#e2e8f0", overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Syne:wght@700;800;900&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dotBounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-8px);opacity:1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 20px rgba(0,255,170,0.15)} 50%{box-shadow:0 0 40px rgba(0,255,170,0.3)} }
        * { box-sizing:border-box; }
        button:hover { filter:brightness(1.2); transform:translateY(-1px); transition:all 0.15s; }
        input:focus, select:focus { border-color:rgba(0,255,170,0.5)!important; box-shadow:0 0 0 2px rgba(0,255,170,0.1); }
        ::-webkit-scrollbar{width:4px; height:4px} ::-webkit-scrollbar-track{background:#0a0f1e} ::-webkit-scrollbar-thumb{background:#1a3a2a;border-radius:4px}
        ::placeholder { color: rgba(255,255,255,0.25); }
      `}</style>

      {/* Background decoration */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        <div style={{ position:"absolute", top:"-20%", right:"-10%", width:700, height:700, borderRadius:"50%", background:"radial-gradient(circle, rgba(0,255,170,0.04) 0%, transparent 70%)" }} />
        <div style={{ position:"absolute", bottom:"-20%", left:"-10%", width:600, height:600, borderRadius:"50%", background:"radial-gradient(circle, rgba(0,100,255,0.04) 0%, transparent 70%)" }} />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background:"rgba(6,10,20,0.97)", borderBottom:"1px solid rgba(0,255,170,0.12)", padding:"0 32px", display:"flex", alignItems:"center", justifyContent:"space-between", height:72, position:"sticky", top:0, zIndex:100, backdropFilter:"blur(20px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:28, color:"#00ffaa", filter:"drop-shadow(0 0 8px rgba(0,255,170,0.5))" }}>⬡</span>
          <span style={{ fontFamily:"'Syne',sans-serif", fontSize:26, fontWeight:900, color:"#00ffaa", letterSpacing:3 }}>FX<span style={{ color:"rgba(255,255,255,0.3)" }}>·</span>INTEL</span>
          <div style={{ background:"rgba(0,255,170,0.12)", border:"1px solid rgba(0,255,170,0.35)", color:"#00ffaa", fontSize:11, padding:"3px 12px", borderRadius:20, letterSpacing:3, animation:"pulse 2s infinite" }}>● LIVE</div>
          <div style={{ fontSize:12, color:proxyStatusCfg.color, background:`${proxyStatusCfg.color}18`, border:`1px solid ${proxyStatusCfg.color}35`, padding:"3px 12px", borderRadius:20 }}>
            {proxyStatusCfg.label === "Online" ? "⬡" : "○"} Binance {proxyStatusCfg.label}
          </div>
        </div>

        <nav style={{ display:"flex", gap:6 }}>
          {NAV_TABS.map(({id,icon,label:lbl})=>(
            <button key={id} onClick={()=>setTab(id)} style={{
              background: tab===id?"rgba(0,255,170,0.14)":"transparent",
              color: tab===id?"#00ffaa":"rgba(255,255,255,0.5)",
              border: tab===id?"1px solid rgba(0,255,170,0.4)":"1px solid transparent",
              borderRadius:10, padding:"8px 20px", cursor:"pointer", fontSize:14, fontFamily:"inherit",
              letterSpacing:0.5, transition:"all 0.2s",
              boxShadow: tab===id?"0 0 20px rgba(0,255,170,0.1)":"none",
            }}>
              {icon} {lbl}
            </button>
          ))}
        </nav>

        <div style={{ fontSize:13, color:"rgba(255,255,255,0.38)", fontVariantNumeric:"tabular-nums" }}>
          {new Date().toLocaleString()}
        </div>
      </div>

      {/* ── Ticker tape ───────────────────────────────────────────────────── */}
      <div style={{ background:"rgba(0,255,170,0.04)", borderBottom:"1px solid rgba(0,255,170,0.08)", padding:"10px 0", overflow:"hidden" }}>
        <div style={{ display:"flex", gap:56, animation:"ticker 40s linear infinite", whiteSpace:"nowrap", width:"max-content" }}>
          {[...CURRENCIES,...CURRENCIES].map((pair,i)=>{
            const arr = priceData[pair];
            const price = arr ? arr.at(-1).price : BASE_RATES[pair];
            const prev = arr ? arr.at(-2)?.price || price : price;
            const up = price >= prev;
            return (
              <span key={i} style={{ fontSize:14, color:"rgba(255,255,255,0.65)", display:"flex", gap:12, alignItems:"center" }}>
                <span style={{ fontSize:17 }}>{CURRENCY_ICONS[pair]}</span>
                <span style={{ color:"rgba(255,255,255,0.45)" }}>{pair}</span>
                <span style={{ color:"#fff", fontWeight:600 }}>{price.toFixed(4)}</span>
                <span style={{ color:up?"#00ffaa":"#ff3366", fontWeight:600 }}>{up?"▲":"▼"} {Math.abs(((price-prev)/prev*100)).toFixed(3)}%</span>
              </span>
            );
          })}
        </div>
      </div>

      <ConfirmModal order={confirmOrder} onConfirm={executeOrder} onCancel={()=>setConfirmOrder(null)} loading={orderLoading} />

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ padding:"28px 32px", maxWidth:"100%", position:"relative", zIndex:1 }}>

        {/* ════ DASHBOARD ════════════════════════════════════════════════════ */}
        {tab === "dashboard" && (
          <div style={{ display:"grid", gap:24 }}>
            {/* Top KPI row */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:16 }}>
              {CURRENCIES.map(pair=>{
                const arr = priceData[pair];
                const price = arr ? arr.at(-1).price : BASE_RATES[pair];
                const prev = arr ? arr.at(-2)?.price || price : price;
                const chg = ((price-prev)/prev*100);
                const up = chg >= 0;
                const sig = signals[pair];
                return (
                  <button key={pair} onClick={()=>setSelectedPair(pair)} style={{
                    background: selectedPair===pair?"rgba(0,255,170,0.1)":"rgba(255,255,255,0.03)",
                    border: selectedPair===pair?"1px solid rgba(0,255,170,0.4)":"1px solid rgba(255,255,255,0.07)",
                    borderRadius:20, padding:20, cursor:"pointer", textAlign:"left",
                    color:"#e2e8f0", fontFamily:"inherit", transition:"all 0.2s",
                    boxShadow: selectedPair===pair?"0 0 30px rgba(0,255,170,0.1)":"none",
                  }}>
                    <div style={{ fontSize:20, marginBottom:6 }}>{CURRENCY_ICONS[pair]}</div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", marginBottom:4, letterSpacing:1 }}>{pair}</div>
                    <div style={{ fontSize:22, fontWeight:700, color:"#fff", marginBottom:6, fontVariantNumeric:"tabular-nums" }}>
                      {price >= 1 ? price.toFixed(2) : price.toFixed(4)}
                    </div>
                    <div style={{ fontSize:13, color:up?"#00ffaa":"#ff3366", fontWeight:600 }}>
                      {up?"▲":"▼"} {Math.abs(chg).toFixed(3)}%
                    </div>
                    {sig && <div style={{ display:"inline-flex", marginTop:8, fontSize:12, fontWeight:700, color:sig.color, background:`${sig.color}18`, border:`1px solid ${sig.color}35`, borderRadius:8, padding:"2px 10px", letterSpacing:2 }}>{sig.action}</div>}
                    {arr && <div style={{ marginTop:10 }}><MiniChart data={arr.slice(-20)} color={up?"#00ffaa":"#ff3366"} width={140} height={48} /></div>}
                  </button>
                );
              })}
            </div>

            {/* Main chart + indicators */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:20 }}>
              <div style={{ ...card }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
                  <div>
                    <div style={{ fontSize:28, fontWeight:900, fontFamily:"'Syne',sans-serif", color:"#fff" }}>
                      {CURRENCY_ICONS[selectedPair]} {selectedPair}
                    </div>
                    {(() => {
                      const arr = priceData[selectedPair];
                      const price = arr ? arr.at(-1).price : 0;
                      const prev = arr ? arr.at(-2)?.price || price : 0;
                      const chg = price-prev;
                      const up = chg>=0;
                      const pct = prev ? ((chg/prev)*100) : 0;
                      return (
                        <div style={{ display:"flex", alignItems:"baseline", gap:16, marginTop:10 }}>
                          <div style={{ fontSize:44, fontWeight:900, fontFamily:"'Syne',sans-serif", color:"#fff", fontVariantNumeric:"tabular-nums" }}>
                            {price >= 1 ? price.toFixed(4) : price.toFixed(6)}
                          </div>
                          <div style={{ fontSize:20, color:up?"#00ffaa":"#ff3366", fontWeight:700 }}>
                            {up?"▲":"▼"} {Math.abs(pct).toFixed(3)}%
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {signals[selectedPair] && (
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:32, fontWeight:900, fontFamily:"'Syne',sans-serif", color:signals[selectedPair].color, background:`${signals[selectedPair].color}18`, border:`2px solid ${signals[selectedPair].color}45`, borderRadius:16, padding:"10px 28px", letterSpacing:3, boxShadow:`0 0 30px ${signals[selectedPair].color}25` }}>
                        {signals[selectedPair].action}
                      </div>
                      <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", marginTop:8 }}>
                        Confidence: <strong style={{ color:"#fff" }}>{signals[selectedPair].confidence}%</strong>
                      </div>
                    </div>
                  )}
                </div>
                {priceData[selectedPair] && (
                  <PriceChart
                    data={priceData[selectedPair].slice(-60)}
                    color={(() => { const arr = priceData[selectedPair]; return arr.at(-1).price >= arr.at(-2)?.price ? "#00ffaa" : "#ff3366"; })()}
                    width={900} height={280} showLabels={true}
                  />
                )}
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {/* Technical indicators */}
                {signals[selectedPair] && (
                  <div style={card}>
                    <span style={label}>Technical Indicators</span>
                    <div style={{ display:"flex", flexDirection:"column", gap:12, marginTop:8 }}>
                      {[
                        ["RSI (14)", signals[selectedPair].rsi, signals[selectedPair].rsi < 35?"#00ffaa":signals[selectedPair].rsi>65?"#ff3366":"#ffcc00", `${signals[selectedPair].rsi < 35?"Oversold":signals[selectedPair].rsi>65?"Overbought":"Neutral"}`],
                        ["MACD", signals[selectedPair].macd?.toFixed(6), signals[selectedPair].macd>0?"#00ffaa":"#ff3366", signals[selectedPair].macd>0?"Bullish":"Bearish"],
                        ["BB Mid", signals[selectedPair].bollinger?.mid?.toFixed(4), "#88aaff", "Bollinger"],
                        ["BB Upper", signals[selectedPair].bollinger?.upper?.toFixed(4), "rgba(255,255,255,0.5)", "Resistance"],
                        ["BB Lower", signals[selectedPair].bollinger?.lower?.toFixed(4), "rgba(255,255,255,0.5)", "Support"],
                      ].map(([k,v,c,note])=>(
                        <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10 }}>
                          <div>
                            <div style={{ fontSize:12, color:"rgba(255,255,255,0.38)", letterSpacing:2 }}>{k}</div>
                            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{note}</div>
                          </div>
                          <div style={{ fontSize:18, fontWeight:700, color:c, fontVariantNumeric:"tabular-nums" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Signal reasons */}
                {signals[selectedPair]?.reasons?.length > 0 && (
                  <div style={card}>
                    <span style={label}>Signal Reasons</span>
                    <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
                      {signals[selectedPair].reasons.map((r,i)=>(
                        <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"8px 12px", background:r.bull?"rgba(0,255,170,0.05)":"rgba(255,51,102,0.05)", borderRadius:10, border:`1px solid ${r.bull?"rgba(0,255,170,0.12)":"rgba(255,51,102,0.12)"}` }}>
                          <span style={{ fontSize:16 }}>{r.icon}</span>
                          <span style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.4 }}>{r.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* All pairs mini charts */}
            <div style={{ ...card }}>
              <span style={label}>All Pairs — Price History</span>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:20, marginTop:16 }}>
                {CURRENCIES.map(pair => {
                  const arr = priceData[pair];
                  if (!arr) return null;
                  const price = arr.at(-1).price;
                  const prev = arr[0].price;
                  const up = price >= prev;
                  const pct = ((price-prev)/prev*100);
                  return (
                    <div key={pair} onClick={()=>setSelectedPair(pair)} style={{ cursor:"pointer", padding:16, background:"rgba(255,255,255,0.025)", borderRadius:14, border:`1px solid ${selectedPair===pair?"rgba(0,255,170,0.3)":"rgba(255,255,255,0.06)"}`, transition:"all 0.2s" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                        <div>
                          <div style={{ fontSize:16, fontWeight:700 }}>{CURRENCY_ICONS[pair]} {pair}</div>
                          <div style={{ fontSize:22, fontWeight:900, fontFamily:"'Syne',sans-serif", color:"#fff", marginTop:4, fontVariantNumeric:"tabular-nums" }}>
                            {price>=1?price.toFixed(2):price.toFixed(4)}
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:15, color:up?"#00ffaa":"#ff3366", fontWeight:700 }}>{up?"+":""}{pct.toFixed(3)}%</div>
                          {signals[pair] && <div style={{ fontSize:13, color:signals[pair].color, fontWeight:700, marginTop:4, letterSpacing:2 }}>{signals[pair].action}</div>}
                        </div>
                      </div>
                      <PriceChart data={arr.slice(-40)} color={up?"#00ffaa":"#ff3366"} width={360} height={100} showLabels={false} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ════ TRADE ════════════════════════════════════════════════════════ */}
        {tab === "trade" && (
          <div style={{ display:"grid", gap:24 }}>
            <div style={{ fontSize:28, fontFamily:"'Syne',sans-serif", fontWeight:900, color:"#fff" }}>⬡ Trade on Binance</div>

            {proxyStatus === "offline" && (
              <div style={{ ...card, background:"rgba(255,51,102,0.06)", border:"1px solid rgba(255,51,102,0.3)" }}>
                <div style={{ fontSize:18, fontWeight:700, color:"#ff3366", marginBottom:8 }}>⚠️ Proxy Not Reachable</div>
                <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", lineHeight:2 }}>URL: <code style={{ background:"rgba(0,0,0,0.3)", color:"#00ffaa", padding:"6px 14px", borderRadius:8 }}>{PROXY}</code></div>
              </div>
            )}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:20 }}>
              {/* API Keys */}
              <div style={card}>
                <span style={label}>🔑 Binance API Credentials</span>
                {credsSaved ? (
                  <div>
                    <div style={{ fontSize:18, color:"#00ffaa", marginBottom:16, fontWeight:700 }}>✓ Connected to Binance</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:260, overflowY:"auto" }}>
                      {balances.length > 0 ? balances.map(b=>(
                        <div key={b.coin} style={{ display:"flex", justifyContent:"space-between", fontSize:15, padding:"12px 16px", background:"rgba(255,255,255,0.04)", borderRadius:12 }}>
                          <span style={{ fontWeight:700, fontSize:16 }}>{b.coin}</span>
                          <span style={{ fontVariantNumeric:"tabular-nums" }}>{parseFloat(b.available).toFixed(6)}</span>
                          <span style={{ color:"rgba(255,255,255,0.35)", fontSize:13 }}>🔒 {parseFloat(b.locked).toFixed(4)}</span>
                        </div>
                      )) : <div style={{ fontSize:15, color:"rgba(255,255,255,0.4)" }}>No balances found</div>}
                    </div>
                    <button style={{ ...btn, marginTop:16, width:"100%" }} onClick={()=>{fetchOpenOrders();fetchOrderHistory();}}>↺ Refresh</button>
                    <button style={{ background:"transparent", border:"1px solid rgba(255,51,102,0.35)", color:"#ff3366", borderRadius:12, padding:14, cursor:"pointer", fontSize:14, fontFamily:"inherit", width:"100%", marginTop:10 }} onClick={()=>{setCredsSaved(false);setApiKey("");setApiSecret("");setBalances([]);}}>Disconnect</button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", marginBottom:20, lineHeight:2 }}>
                      Your keys go only to your Render proxy — never to any third party.<br/>
                      Enable <strong style={{ color:"#ffcc00" }}>Read Info</strong> + <strong style={{ color:"#ffcc00" }}>Spot Trading</strong> on your Binance API key.
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                      <div><span style={label}>API Key</span><input style={input} type="text" placeholder="Paste your Binance API Key" value={apiKey} onChange={e=>setApiKey(e.target.value)} /></div>
                      <div><span style={label}>Secret Key</span><input style={input} type="password" placeholder="Paste your Binance Secret Key" value={apiSecret} onChange={e=>setApiSecret(e.target.value)} /></div>
                      {credsError && <div style={{ fontSize:14, color:"#ff3366", background:"rgba(255,51,102,0.08)", padding:"12px 16px", borderRadius:10, lineHeight:1.7 }}>{credsError}</div>}
                      <button style={{ ...btn, width:"100%", fontSize:16 }} onClick={connectBinance} disabled={balanceLoading}>{balanceLoading?"Connecting…":"Connect Binance Account"}</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Order placement */}
              {credsSaved && (
                <div style={card}>
                  <span style={label}>Place Order</span>
                  {orderResult && (
                    <div style={{ padding:"14px 18px", borderRadius:12, marginBottom:18, background:orderResult.ok?"rgba(0,255,170,0.1)":"rgba(255,51,102,0.1)", border:`1px solid ${orderResult.ok?"rgba(0,255,170,0.35)":"rgba(255,51,102,0.35)"}`, fontSize:15, color:orderResult.ok?"#00ffaa":"#ff3366" }}>
                      {orderResult.ok?`✓ Order placed! ID: ${orderResult.orderId}`:`✗ Failed: ${orderResult.data?.msg||orderResult.error}`}
                    </div>
                  )}
                  <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                    <div><span style={label}>Symbol</span>
                      <select style={select} value={selectedSymbol.value} onChange={e=>setSelectedSymbol(TRADE_SYMBOLS.find(s=>s.value===e.target.value))}>
                        {TRADE_SYMBOLS.map(s=><option key={s.value} value={s.value}>{s.label}{liveTickerData[s.value]?" — $"+parseFloat(liveTickerData[s.value].price).toLocaleString():""}</option>)}
                      </select>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      {["Buy","Sell"].map(side=>(
                        <button key={side} onClick={()=>setOrderSide(side)} style={{ padding:"16px", borderRadius:14, cursor:"pointer", fontFamily:"inherit", fontWeight:800, fontSize:16, letterSpacing:2, transition:"all 0.2s", border:orderSide===side?`2px solid ${side==="Buy"?"rgba(0,255,170,0.7)":"rgba(255,51,102,0.7)"}`:"1px solid rgba(255,255,255,0.1)", background:orderSide===side?(side==="Buy"?"rgba(0,255,170,0.16)":"rgba(255,51,102,0.16)"):"rgba(255,255,255,0.03)", color:orderSide===side?(side==="Buy"?"#00ffaa":"#ff3366"):"rgba(255,255,255,0.4)", boxShadow:orderSide===side?`0 0 20px ${side==="Buy"?"rgba(0,255,170,0.15)":"rgba(255,51,102,0.15)"}`:"none" }}>
                          {side==="Buy"?"▲ BUY":"▼ SELL"}
                        </button>
                      ))}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      {["Market","Limit"].map(type=>(
                        <button key={type} onClick={()=>setOrderType(type)} style={{ padding:"12px", borderRadius:12, cursor:"pointer", fontFamily:"inherit", fontSize:15, transition:"all 0.2s", border:orderType===type?"1px solid rgba(0,255,170,0.45)":"1px solid rgba(255,255,255,0.08)", background:orderType===type?"rgba(0,255,170,0.1)":"rgba(255,255,255,0.03)", color:orderType===type?"#00ffaa":"rgba(255,255,255,0.5)" }}>{type}</button>
                      ))}
                    </div>
                    <div>
                      <span style={label}>Quantity ({selectedSymbol.base})</span>
                      <input style={input} type="number" placeholder="e.g. 0.001" value={orderQty} onChange={e=>setOrderQty(e.target.value)} />
                      {liveTickerData[selectedSymbol.value] && orderQty && <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:8 }}>≈ ${(parseFloat(orderQty||0)*parseFloat(liveTickerData[selectedSymbol.value]?.price||0)).toLocaleString(undefined,{maximumFractionDigits:2})} USDT</div>}
                    </div>
                    {orderType==="Limit" && <div><span style={label}>Limit Price (USDT)</span><input style={input} type="number" placeholder="Price" value={orderPrice} onChange={e=>setOrderPrice(e.target.value)} /></div>}
                    <button onClick={handlePlaceOrder} disabled={!orderQty||(orderType==="Limit"&&!orderPrice)} style={{ padding:"18px", borderRadius:14, cursor:!orderQty?"not-allowed":"pointer", fontFamily:"inherit", fontWeight:800, fontSize:17, letterSpacing:2, transition:"all 0.2s", background:!orderQty?"rgba(255,255,255,0.04)":(orderSide==="Buy"?"rgba(0,255,170,0.18)":"rgba(255,51,102,0.18)"), border:!orderQty?"1px solid rgba(255,255,255,0.08)":`2px solid ${orderSide==="Buy"?"rgba(0,255,170,0.6)":"rgba(255,51,102,0.6)"}`, color:!orderQty?"rgba(255,255,255,0.2)":(orderSide==="Buy"?"#00ffaa":"#ff3366"), boxShadow:orderQty?`0 0 30px ${orderSide==="Buy"?"rgba(0,255,170,0.15)":"rgba(255,51,102,0.15)"}`:"none" }}>
                      {orderSide==="Buy"?"▲":"▼"} REVIEW {orderSide.toUpperCase()} ORDER
                    </button>
                  </div>
                </div>
              )}

              {/* Live price + order book */}
              {credsSaved && (
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  <div style={card}>
                    <span style={label}>Live Price</span>
                    <select style={select} value={selectedSymbol.value} onChange={e=>setSelectedSymbol(TRADE_SYMBOLS.find(s=>s.value===e.target.value))}>
                      {TRADE_SYMBOLS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    {liveTickerData[selectedSymbol.value] ? (
                      <div style={{ marginTop:14 }}>
                        <div style={{ fontSize:38, fontWeight:900, fontFamily:"'Syne',sans-serif", color:"#fff", fontVariantNumeric:"tabular-nums" }}>
                          ${parseFloat(liveTickerData[selectedSymbol.value].price).toLocaleString()}
                        </div>
                        <div style={{ fontSize:16, color:parseFloat(liveTickerData[selectedSymbol.value].change24h)>=0?"#00ffaa":"#ff3366", marginTop:6, fontWeight:700 }}>
                          {parseFloat(liveTickerData[selectedSymbol.value].change24h)>=0?"▲":"▼"} {(Math.abs(parseFloat(liveTickerData[selectedSymbol.value].change24h||0))*100).toFixed(2)}% 24h
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:14 }}>
                          {[["High 24h",`$${parseFloat(liveTickerData[selectedSymbol.value].high24h||0).toLocaleString()}`],["Low 24h",`$${parseFloat(liveTickerData[selectedSymbol.value].low24h||0).toLocaleString()}`],["Volume",parseFloat(liveTickerData[selectedSymbol.value].volume24h||0).toFixed(2)]].map(([k,v])=>(
                            <div key={k} style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"12px 14px" }}>
                              <div style={{ fontSize:11, color:"rgba(255,255,255,0.38)", letterSpacing:2, marginBottom:4 }}>{k}</div>
                              <div style={{ fontSize:15, fontWeight:700 }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <div style={{ fontSize:15, color:"rgba(255,255,255,0.3)", marginTop:12 }}>Waiting for data…</div>}
                  </div>

                  {orderBook && (
                    <div style={card}>
                      <span style={label}>Order Book — {selectedSymbol.label}</span>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginTop:12 }}>
                        <div>
                          <div style={{ fontSize:12, color:"#00ffaa", marginBottom:8, letterSpacing:2 }}>BIDS</div>
                          {(orderBook.b||[]).slice(0,6).map(([px,qty],i)=>(
                            <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:14, padding:"6px 0", borderBottom:"1px solid rgba(0,255,170,0.06)" }}>
                              <span style={{ color:"#00ffaa", fontVariantNumeric:"tabular-nums" }}>{parseFloat(px).toLocaleString()}</span>
                              <span style={{ color:"rgba(255,255,255,0.4)" }}>{parseFloat(qty).toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize:12, color:"#ff3366", marginBottom:8, letterSpacing:2 }}>ASKS</div>
                          {(orderBook.a||[]).slice(0,6).map(([px,qty],i)=>(
                            <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:14, padding:"6px 0", borderBottom:"1px solid rgba(255,51,102,0.06)" }}>
                              <span style={{ color:"#ff3366", fontVariantNumeric:"tabular-nums" }}>{parseFloat(px).toLocaleString()}</span>
                              <span style={{ color:"rgba(255,255,255,0.4)" }}>{parseFloat(qty).toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Open orders + history */}
            {credsSaved && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                <div style={card}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                    <span style={label}>Open Orders ({openOrders.length})</span>
                    <button style={{ ...btn, fontSize:13, padding:"8px 16px" }} onClick={fetchOpenOrders}>↺ Refresh</button>
                  </div>
                  {openOrders.length===0
                    ? <div style={{ fontSize:15, color:"rgba(255,255,255,0.3)", textAlign:"center", padding:"24px 0" }}>No open orders</div>
                    : openOrders.map(o=>(
                      <div key={o.orderId} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:15, padding:"14px 16px", background:"rgba(255,255,255,0.03)", borderRadius:12, marginBottom:8 }}>
                        <div>
                          <span style={{ color:o.side==="BUY"?"#00ffaa":"#ff3366", fontWeight:700, fontSize:16 }}>{o.side} </span>
                          <span>{o.symbol}</span>
                          <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:4 }}>{o.qty} @ ${parseFloat(o.price||0).toLocaleString()}</div>
                        </div>
                        <button onClick={()=>cancelOrder(o.symbol,o.orderId)} style={{ background:"transparent", border:"1px solid rgba(255,51,102,0.35)", color:"#ff3366", borderRadius:10, padding:"8px 16px", cursor:"pointer", fontSize:13, fontFamily:"inherit" }}>Cancel</button>
                      </div>
                    ))
                  }
                </div>
                <div style={card}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                    <span style={label}>Recent Orders — {selectedSymbol.label}</span>
                    <button style={{ ...btn, fontSize:13, padding:"8px 16px" }} onClick={fetchOrderHistory}>↺ Refresh</button>
                  </div>
                  <div style={{ maxHeight:280, overflowY:"auto" }}>
                    {orderHistory.length===0
                      ? <div style={{ fontSize:15, color:"rgba(255,255,255,0.3)", textAlign:"center", padding:"24px 0" }}>No history for {selectedSymbol.label}</div>
                      : orderHistory.map(o=>(
                        <div key={o.orderId} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:14, padding:"12px 14px", background:"rgba(255,255,255,0.02)", borderRadius:10, marginBottom:6 }}>
                          <div>
                            <span style={{ color:o.side==="BUY"?"#00ffaa":"#ff3366", fontWeight:700 }}>{o.side} </span>
                            <span style={{ color:"rgba(255,255,255,0.7)" }}>{o.symbol}</span>
                            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginTop:2 }}>{o.qty} · {o.orderType}</div>
                          </div>
                          <span style={{ fontSize:13, fontWeight:700, color:o.orderStatus==="FILLED"?"#00ffaa":o.orderStatus==="CANCELED"?"#ff3366":"#ffcc00" }}>{o.orderStatus}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ SIGNALS ══════════════════════════════════════════════════════ */}
        {tab === "signals" && (
          <div>
            <div style={{ fontSize:28, fontFamily:"'Syne',sans-serif", fontWeight:900, marginBottom:24, color:"#fff" }}>◈ All Signals</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:20 }}>
              {CURRENCIES.map(pair=>{
                const arr = priceData[pair];
                const price = arr ? arr.at(-1).price : BASE_RATES[pair];
                const sig = signals[pair];
                if (!sig) return null;
                const prev = arr ? arr.at(-2)?.price||price : price;
                const up = price >= prev;
                return (
                  <div key={pair} style={{ ...card, border:`1px solid ${sig.color}30`, boxShadow:`0 0 30px ${sig.color}10` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                      <div>
                        <div style={{ fontSize:22, fontWeight:700 }}>{CURRENCY_ICONS[pair]} {pair}</div>
                        <div style={{ fontSize:28, fontWeight:900, fontFamily:"'Syne',sans-serif", color:"#fff", marginTop:6, fontVariantNumeric:"tabular-nums" }}>
                          {price>=1?price.toFixed(4):price.toFixed(6)}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:24, fontWeight:900, fontFamily:"'Syne',sans-serif", color:sig.color, background:`${sig.color}18`, border:`2px solid ${sig.color}45`, borderRadius:14, padding:"8px 20px", letterSpacing:3 }}>{sig.action}</div>
                        <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", marginTop:8 }}>{sig.confidence}% conf.</div>
                      </div>
                    </div>
                    {arr && <PriceChart data={arr.slice(-40)} color={up?"#00ffaa":"#ff3366"} width={500} height={140} showLabels={false} />}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginTop:16 }}>
                      {[["RSI",sig.rsi],["MACD",sig.macd?.toFixed(4)],["Conf.",`${sig.confidence}%`]].map(([k,v])=>(
                        <div key={k} style={{ textAlign:"center", padding:"12px", background:"rgba(255,255,255,0.03)", borderRadius:12 }}>
                          <div style={{ fontSize:11, color:"rgba(255,255,255,0.38)", letterSpacing:2, marginBottom:4 }}>{k}</div>
                          <div style={{ fontSize:20, fontWeight:700, color:sig.color }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════ SENTIMENT ════════════════════════════════════════════════════ */}
        {tab === "sentiment" && (
          <div>
            <div style={{ fontSize:28, fontFamily:"'Syne',sans-serif", fontWeight:900, marginBottom:24, color:"#fff" }}>◉ News & Sentiment</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {NEWS_SENTIMENT.map((n,i)=>(
                <div key={i} style={{ ...card, display:"flex", gap:20, alignItems:"flex-start", border:`1px solid ${n.sentiment>0?"rgba(0,255,170,0.15)":"rgba(255,51,102,0.15)"}` }}>
                  <div style={{ width:60, height:60, borderRadius:16, background:n.sentiment>0?"rgba(0,255,170,0.12)":"rgba(255,51,102,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>{n.sentiment>0?"📈":"📉"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:18, color:"#e2e8f0", marginBottom:8, lineHeight:1.5 }}>{n.headline}</div>
                    <div style={{ display:"flex", gap:16 }}>
                      <span style={{ fontSize:14, color:"rgba(255,255,255,0.4)" }}>{n.time}</span>
                      <span style={{ fontSize:14, color:n.sentiment>0?"#00ffaa":"#ff3366", fontWeight:700 }}>Sentiment: {n.sentiment>0?"+":""}{n.sentiment.toFixed(2)}</span>
                      <span style={{ fontSize:14, color:"rgba(255,255,255,0.4)" }}>Impact: {n.impact}</span>
                    </div>
                  </div>
                  <div style={{ width:160, flexShrink:0 }}>
                    <div style={{ height:8, background:"rgba(255,255,255,0.06)", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(Math.abs(n.sentiment)*100)}%`, background:n.sentiment>0?"#00ffaa":"#ff3366", borderRadius:4 }} />
                    </div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:6, textAlign:"right" }}>{(Math.abs(n.sentiment)*100).toFixed(0)}% strength</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════ CALENDAR ══════════════════════════════════════════════════════ */}
        {tab === "calendar" && (
          <div>
            <div style={{ fontSize:28, fontFamily:"'Syne',sans-serif", fontWeight:900, marginBottom:24, color:"#fff" }}>◷ Economic Calendar</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {ECONOMIC_EVENTS.map((ev,i)=>(
                <div key={i} style={{ ...card, display:"flex", alignItems:"center", gap:24 }}>
                  <div style={{ width:80, textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:700, fontVariantNumeric:"tabular-nums" }}>{ev.time}</div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:4 }}>Today</div>
                  </div>
                  <div style={{ width:6, height:60, background:impactColor(ev.impact), borderRadius:3, boxShadow:`0 0 12px ${impactColor(ev.impact)}60` }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>{ev.event}</div>
                    <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                      <span style={{ fontSize:14, background:"rgba(255,255,255,0.07)", padding:"4px 14px", borderRadius:10 }}>Affects: {ev.currency}</span>
                      <span style={{ fontSize:14, color:impactColor(ev.impact), fontWeight:700 }}>● {ev.impact} IMPACT</span>
                    </div>
                  </div>
                  <div style={{ fontSize:16, color:"rgba(255,255,255,0.4)", fontVariantNumeric:"tabular-nums" }}>In {ev.hours}h</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════ AI ANALYST ════════════════════════════════════════════════════ */}
        {tab === "ai" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:20, height:"calc(100vh - 220px)", minHeight:620 }}>
            <div style={{ ...card, display:"flex", flexDirection:"column", padding:0, overflow:"hidden" }}>
              <div style={{ padding:"20px 28px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", gap:16, background:"rgba(0,255,170,0.04)" }}>
                <div style={{ width:48, height:48, borderRadius:14, background:"rgba(0,255,170,0.12)", border:"1px solid rgba(0,255,170,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>⬡</div>
                <div>
                  <div style={{ fontSize:20, fontWeight:700, color:"#fff", fontFamily:"'Syne',sans-serif" }}>FX·INTEL AI Analyst</div>
                  <div style={{ fontSize:13, color:"#00ffaa", marginTop:4 }}>✦ Gemini AI · {CURRENCIES.length} FX pairs · Binance{credsSaved?" · Connected":""}</div>
                </div>
                <button style={{ ...btn, marginLeft:"auto", fontSize:13, padding:"8px 18px" }} onClick={()=>setChatMessages([{role:"assistant",content:"Cleared. Ready for fresh analysis.",timestamp:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}])}>↺ Clear</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"24px 28px 12px" }}>
                {chatMessages.map((msg,i)=><ChatMessage key={i} msg={msg} />)}
                <div ref={chatEndRef} />
              </div>
              <div style={{ padding:"16px 20px", borderTop:"1px solid rgba(255,255,255,0.06)", background:"rgba(0,0,0,0.25)" }}>
                <div style={{ display:"flex", gap:12, alignItems:"flex-end" }}>
                  <textarea ref={inputRef} value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder="Ask about any pair, signals, balance, macro risks…" rows={2} style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"14px 18px", color:"#e2e8f0", fontSize:15, fontFamily:"inherit", resize:"none", outline:"none", lineHeight:1.6 }} />
                  <button onClick={()=>sendMessage()} disabled={chatLoading||!chatInput.trim()} style={{ width:52, height:52, borderRadius:14, background:chatLoading||!chatInput.trim()?"rgba(0,255,170,0.06)":"rgba(0,255,170,0.18)", border:`1px solid ${chatLoading||!chatInput.trim()?"rgba(0,255,170,0.1)":"rgba(0,255,170,0.5)"}`, color:chatLoading||!chatInput.trim()?"rgba(0,255,170,0.3)":"#00ffaa", cursor:chatLoading||!chatInput.trim()?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
                    {chatLoading?"⟳":"↑"}
                  </button>
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:8, textAlign:"center" }}>Enter to send · Shift+Enter for new line</div>
              </div>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <div style={card}>
                <span style={label}>✦ Quick Prompts</span>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:12 }}>
                  {SUGGESTED_PROMPTS.map((p,i)=>(
                    <button key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"14px 16px", cursor:"pointer", textAlign:"left", color:"rgba(255,255,255,0.75)", fontSize:15, fontFamily:"inherit", display:"flex", gap:12, alignItems:"center", transition:"all 0.2s" }} onClick={()=>sendMessage(p.text)}>
                      <span style={{ fontSize:20 }}>{p.icon}</span>
                      <span style={{ flex:1 }}>{p.label}</span>
                      <span style={{ color:"#00ffaa", opacity:0.6, fontSize:18 }}>→</span>
                    </button>
                  ))}
                </div>
              </div>
              {credsSaved && balances.length > 0 && (
                <div style={card}>
                  <span style={label}>Binance Balance</span>
                  <div style={{ maxHeight:220, overflowY:"auto", marginTop:8 }}>
                    {balances.map(b=>(
                      <div key={b.coin} style={{ display:"flex", justifyContent:"space-between", fontSize:15, padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ fontWeight:700 }}>{b.coin}</span>
                        <span style={{ color:"rgba(255,255,255,0.65)", fontVariantNumeric:"tabular-nums" }}>{parseFloat(b.available).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={card}>
                <span style={label}>Live Signals Snapshot</span>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
                  {CURRENCIES.map(pair => {
                    const sig = signals[pair];
                    if (!sig) return null;
                    return (
                      <div key={pair} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10 }}>
                        <span style={{ fontSize:14 }}>{CURRENCY_ICONS[pair]} {pair}</span>
                        <span style={{ fontSize:14, fontWeight:700, color:sig.color, letterSpacing:2 }}>{sig.action}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}