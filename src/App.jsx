import { useState, useEffect, useCallback } from "react";

const WORKER = import.meta.env.VITE_WORKER_URL || "https://YOUR-WORKER.workers.dev";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const BANKROLL = 500;
const CATEGORIES = {
  ALL:        { label: "All Markets",  color: "#e2e8f0", icon: "◈" },
  SPORTS:     { label: "Sports",       color: "#00ff87", icon: "⚡" },
  ESPORTS:    { label: "Esports",      color: "#a78bfa", icon: "🎮" },
  POPCULTURE: { label: "Pop Culture",  color: "#f59e0b", icon: "🎬" },
  HIGHEDGE:   { label: "High-Edge",    color: "#06b6d4", icon: "📊" },
};

// Fallback markets if APIs are unavailable
const FALLBACK_MARKETS = [
  { id:"f1", platform:"Kalshi",     category:"SPORTS",     title:"Will the Knicks win the NBA Championship 2026?",        yesPrice:0.09, volume:"$512K", closes:"Jun 20 2026", tags:["NBA","Knicks"] },
  { id:"f2", platform:"Polymarket", category:"ESPORTS",    title:"Will T1 win MSI 2026?",                                 yesPrice:0.31, volume:"$89K",  closes:"May 18 2026", tags:["LoL","T1","MSI"] },
  { id:"f3", platform:"Kalshi",     category:"SPORTS",     title:"Will Ravens make AFC Championship Game 2026-27?",       yesPrice:0.44, volume:"$320K", closes:"Jan 20 2027", tags:["NFL","Ravens"] },
  { id:"f4", platform:"Polymarket", category:"ESPORTS",    title:"Will Sentinels qualify for VCT Masters 2 2026?",        yesPrice:0.21, volume:"$67K",  closes:"Apr 15 2026", tags:["VCT","Sentinels"] },
  { id:"f5", platform:"Polymarket", category:"POPCULTURE", title:"Will Sinners win Best Picture at 2027 Oscars?",         yesPrice:0.14, volume:"$180K", closes:"Mar 15 2027", tags:["Oscars","Film"] },
  { id:"f6", platform:"Kalshi",     category:"HIGHEDGE",   title:"Will Fed cut rates in Q2 2026?",                       yesPrice:0.54, volume:"$1.2M", closes:"Jun 30 2026", tags:["Fed","Rates"] },
  { id:"f7", platform:"Polymarket", category:"POPCULTURE", title:"Will GTA VI release before Dec 31 2026?",              yesPrice:0.72, volume:"$2.1M", closes:"Dec 31 2026", tags:["Gaming","GTA"] },
  { id:"f8", platform:"Polymarket", category:"ESPORTS",    title:"Will NAVI win IEM Dallas 2026?",                       yesPrice:0.18, volume:"$155K", closes:"Jun 1 2026",  tags:["CS2","NAVI"] },
  { id:"f9", platform:"Kalshi",     category:"HIGHEDGE",   title:"Will US CPI be above 3% in April 2026?",               yesPrice:0.38, volume:"$890K", closes:"May 15 2026", tags:["Macro","CPI"] },
  { id:"f10",platform:"Polymarket", category:"SPORTS",     title:"Will a team outside the top 4 seeds win NBA Finals?",  yesPrice:0.22, volume:"$430K", closes:"Jun 20 2026", tags:["NBA","Upset"] },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function halfKelly(trueProb, marketPrice, bankroll = BANKROLL, maxPct = 0.05) {
  const p = trueProb / 100;
  const q = 1 - p;
  const b = (1 / marketPrice) - 1;
  const kelly = (b * p - q) / b;
  const half = Math.max(0, kelly * 0.5);
  return Math.min(half * bankroll, maxPct * bankroll).toFixed(2);
}

function edgeColor(edge) {
  if (edge >= 10) return "#00ff87";
  if (edge >= 5)  return "#f59e0b";
  if (edge >= 0)  return "#94a3b8";
  return "#ef4444";
}

function sentimentColor(s) {
  return s === "BULLISH" ? "#00ff87" : s === "BEARISH" ? "#ef4444" : "#6b7280";
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function callAnthropic(prompt) {
  const res = await fetch(`${WORKER}/anthropic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "{}";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function fetchKalshiMarkets() {
  const res = await fetch(`${WORKER}/markets?limit=10&status=open`);
  return res.json();
}

async function fetchPolymarketMarkets() {
  const res = await fetch(`${WORKER}/polymarket/markets?limit=20&active=true&closed=false&order=volume&ascending=false`);
  return res.json();
}

async function fetchKalshiBalance() {
  const res = await fetch(`${WORKER}/balance`);
  return res.json();
}

async function analyzeMarket(market) {
  const prompt = `You are a sharp prediction market trader. Analyze this market using social signals and statistical edge.

Market: "${market.title}"
Platform: ${market.platform}
Category: ${market.category}
YES Price: ${(market.yesPrice * 100).toFixed(1)}%
Tags: ${market.tags?.join(", ")}

Return ONLY valid JSON, no markdown:
{
  "trueProb": <0-100>,
  "edge": <trueProb minus market implied prob>,
  "recommendation": "YES" | "NO" | "PASS",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "socialSignal": {
    "reddit": { "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": <1-10>, "summary": "<12 words max>" },
    "xTwitter": { "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": <1-10>, "summary": "<12 words max>" },
    "overall": "BULLISH"|"BEARISH"|"NEUTRAL",
    "socialEdge": <-5 to 5, how much social signals adjust your edge>
  },
  "keyFactors": ["<factor>", "<factor>", "<factor>"],
  "esportsFactors": ${market.category === "ESPORTS" ? '["<roster>", "<recent form>", "<meta/patch>"]' : "null"},
  "riskFlags": ["<risk>", "<risk>"],
  "stake": "<dollar amount using half-Kelly on $500 bankroll>",
  "rationale": "<2 sharp sentences on your thesis>"
}`;
  return callAnthropic(prompt);
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Tag({ label, color }) {
  return (
    <span style={{
      fontSize: 8, letterSpacing: 1, padding: "1px 5px",
      border: `1px solid ${color}44`, color, borderRadius: 2,
      fontFamily: "'IBM Plex Mono', monospace",
    }}>{label}</span>
  );
}

function Pill({ label, value, valueColor }) {
  return (
    <div style={{
      background: "#060d1a", border: "1px solid #1a2535",
      borderRadius: 4, padding: "6px 10px", textAlign: "center", flex: 1,
    }}>
      <div style={{ fontSize: 7, color: "#374151", letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: valueColor || "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace" }}>{value}</div>
    </div>
  );
}

function SocialRow({ platform, data }) {
  const sc = sentimentColor(data.sentiment);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 8, color: "#4b5563", width: 56, flexShrink: 0 }}>{platform}</span>
      <span style={{
        fontSize: 8, padding: "1px 6px", borderRadius: 2, letterSpacing: 1,
        background: sc + "18", border: `1px solid ${sc}44`, color: sc,
      }}>
        {data.sentiment === "BULLISH" ? "↑" : data.sentiment === "BEARISH" ? "↓" : "→"} {data.sentiment}
      </span>
      <span style={{ fontSize: 8, color: sc, fontWeight: 700 }}>{data.score}/10</span>
      <span style={{ fontSize: 8, color: "#4b5563", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {data.summary}
      </span>
    </div>
  );
}

function MarketCard({ market, onAnalyze, analysis, loading, decision, onDecision }) {
  const cat = CATEGORIES[market.category] || CATEGORIES.ALL;
  const implied = (market.yesPrice * 100).toFixed(1);
  const hasAnalysis = !!analysis;
  const stake = hasAnalysis ? halfKelly(analysis.trueProb, market.yesPrice) : null;

  return (
    <div style={{
      background: "#080f1c",
      border: `1px solid ${
        decision === "YES" ? "#00ff8755"
        : decision === "NO" ? "#ef444455"
        : decision === "PASS" ? "#374151"
        : "#111e30"
      }`,
      borderRadius: 6,
      padding: 16,
      transition: "border-color 0.2s",
      animation: "fadeIn 0.3s ease",
    }}>
      {/* Market Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
            <Tag label={cat.icon + " " + cat.label} color={cat.color} />
            <Tag label={market.platform.toUpperCase()} color="#374151" />
            {market.tags?.slice(0, 2).map(t => <Tag key={t} label={t} color="#1e3a5f" />)}
          </div>
          <div style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 600, lineHeight: 1.45, fontFamily: "'IBM Plex Sans', sans-serif" }}>
            {market.title}
          </div>
          <div style={{ fontSize: 9, color: "#374151", marginTop: 4 }}>
            Vol: {market.volume} · Closes: {market.closes}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#e2e8f0", lineHeight: 1, fontFamily: "'IBM Plex Mono', monospace" }}>
            {implied}%
          </div>
          <div style={{ fontSize: 8, color: "#374151", marginTop: 2 }}>YES IMPLIED</div>
        </div>
      </div>

      {/* Analyze CTA */}
      {!hasAnalysis && (
        <button
          onClick={() => onAnalyze(market)}
          disabled={loading}
          style={{
            width: "100%", padding: "9px 0",
            background: loading ? "#0d1628" : "#0a1628",
            border: `1px solid ${loading ? "#1a2535" : "#1e3a5f"}`,
            borderRadius: 4, cursor: loading ? "not-allowed" : "pointer",
            color: loading ? "#374151" : "#60a5fa",
            fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: 2, transition: "all 0.15s",
          }}
        >
          {loading ? "⟳  SCANNING SIGNALS..." : "▶  RUN ANALYSIS"}
        </button>
      )}

      {/* Analysis */}
      {hasAnalysis && (
        <div>
          <div style={{ borderTop: "1px solid #111e30", paddingTop: 12, marginTop: 4 }}>
            {/* Stats Row */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <Pill label="TRUE PROB"   value={`${analysis.trueProb.toFixed(1)}%`} valueColor="#e2e8f0" />
              <Pill label="EDGE"        value={`${analysis.edge > 0 ? "+" : ""}${analysis.edge.toFixed(1)}%`} valueColor={edgeColor(analysis.edge)} />
              <Pill label="CONFIDENCE"  value={analysis.confidence} valueColor={analysis.confidence === "HIGH" ? "#00ff87" : analysis.confidence === "MEDIUM" ? "#f59e0b" : "#ef4444"} />
              <Pill label="HALF-KELLY"  value={`$${stake}`} valueColor="#f59e0b" />
            </div>

            {/* Social Signals */}
            <div style={{ background: "#060d1a", borderRadius: 4, padding: 10, marginBottom: 10, border: "1px solid #111e30" }}>
              <div style={{ fontSize: 8, color: "#374151", letterSpacing: 2, marginBottom: 8 }}>SOCIAL SIGNALS</div>
              <SocialRow platform="Reddit" data={analysis.socialSignal.reddit} />
              <SocialRow platform="X / Twitter" data={analysis.socialSignal.xTwitter} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px solid #111e30" }}>
                <span style={{ fontSize: 8, color: "#4b5563" }}>SOCIAL EDGE ADJUSTMENT</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: edgeColor(analysis.socialSignal.socialEdge * 2), fontFamily: "'IBM Plex Mono', monospace" }}>
                  {analysis.socialSignal.socialEdge > 0 ? "+" : ""}{analysis.socialSignal.socialEdge}%
                </span>
              </div>
            </div>

            {/* Key Factors */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: "#374151", letterSpacing: 2, marginBottom: 6 }}>KEY FACTORS</div>
              {analysis.keyFactors?.map((f, i) => (
                <div key={i} style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3, display: "flex", gap: 6 }}>
                  <span style={{ color: "#1e3a5f", flexShrink: 0 }}>▸</span>{f}
                </div>
              ))}
            </div>

            {/* Esports Factors */}
            {analysis.esportsFactors && (
              <div style={{ background: "#060d1a", borderRadius: 4, padding: 10, marginBottom: 10, border: "1px solid #2d1b69" }}>
                <div style={{ fontSize: 8, color: "#7c3aed", letterSpacing: 2, marginBottom: 6 }}>ESPORTS FACTORS</div>
                {analysis.esportsFactors.map((f, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3, display: "flex", gap: 6 }}>
                    <span style={{ color: "#7c3aed", flexShrink: 0 }}>▸</span>{f}
                  </div>
                ))}
              </div>
            )}

            {/* Risk Flags */}
            {analysis.riskFlags?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 8, color: "#374151", letterSpacing: 2, marginBottom: 6 }}>RISK FLAGS</div>
                {analysis.riskFlags.map((f, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#ef4444", marginBottom: 3, display: "flex", gap: 6 }}>
                    <span style={{ flexShrink: 0 }}>⚠</span>{f}
                  </div>
                ))}
              </div>
            )}

            {/* Rationale */}
            <div style={{
              background: "#060d1a", borderRadius: 4, padding: 10, marginBottom: 12,
              borderLeft: "2px solid #1e3a5f",
            }}>
              <div style={{ fontSize: 10, color: "#7dd3fc", lineHeight: 1.6, fontStyle: "italic", fontFamily: "'IBM Plex Sans', sans-serif" }}>
                {analysis.rationale}
              </div>
            </div>

            {/* Decision Flow */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {["YES", "PASS", "NO"].map(d => {
                const active = decision === d;
                const color = d === "YES" ? "#00ff87" : d === "NO" ? "#ef4444" : "#6b7280";
                return (
                  <button key={d} onClick={() => onDecision(market.id, d)} style={{
                    padding: "9px 0",
                    background: active ? color + "18" : "transparent",
                    border: `1px solid ${active ? color : "#1a2535"}`,
                    borderRadius: 4, cursor: "pointer", color: active ? color : "#374151",
                    fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 700, letterSpacing: 2, transition: "all 0.15s",
                  }}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [markets, setMarkets]     = useState(FALLBACK_MARKETS);
  const [analyses, setAnalyses]   = useState({});
  const [loading, setLoading]     = useState({});
  const [decisions, setDecisions] = useState({});
  const [filter, setFilter]       = useState("ALL");
  const [balance, setBalance]     = useState(null);
  const [liveStatus, setLiveStatus] = useState({ kalshi: false, poly: false });
  const [refreshing, setRefreshing] = useState(false);

  // Try to load live markets on mount
  useEffect(() => { loadLiveMarkets(); }, []);

  async function loadLiveMarkets() {
    setRefreshing(true);
    let kalshiLive = false, polyLive = false;
    const liveMarkets = [];

    // Kalshi balance
    try {
      const bal = await fetchKalshiBalance();
      if (bal?.balance !== undefined) {
        setBalance((bal.balance / 100).toFixed(2));
        kalshiLive = true;
      }
    } catch {}

    // Kalshi markets
    try {
      const kData = await fetchKalshiMarkets();
      if (kData?.markets?.length) {
        kData.markets.slice(0, 5).forEach((m, i) => {
          const yes = m.yes_ask ? m.yes_ask / 100 : 0.5;
          liveMarkets.push({
            id: `k_${i}`, platform: "Kalshi", category: detectCategory(m.title || ""),
            title: m.title || m.ticker,
            yesPrice: yes, volume: `$${((m.volume || 0) / 100).toFixed(0)}`,
            closes: m.close_time ? new Date(m.close_time).toLocaleDateString() : "TBD",
            tags: [m.series_ticker || "Kalshi"],
          });
        });
        kalshiLive = true;
      }
    } catch {}

    // Polymarket
    try {
      const pData = await fetchPolymarketMarkets();
      const items = pData?.data || pData || [];
      if (items.length) {
        items.slice(0, 5).forEach((m, i) => {
          const yes = m.tokens?.find(t => t.outcome === "Yes")?.price || 0.5;
          liveMarkets.push({
            id: `p_${i}`, platform: "Polymarket", category: detectCategory(m.question || ""),
            title: m.question,
            yesPrice: parseFloat(yes), volume: `$${((m.volume || 0)).toFixed(0)}`,
            closes: m.end_date_iso ? new Date(m.end_date_iso).toLocaleDateString() : "TBD",
            tags: ["Polymarket"],
          });
        });
        polyLive = true;
      }
    } catch {}

    if (liveMarkets.length > 0) {
      setMarkets([...liveMarkets, ...FALLBACK_MARKETS]);
    }
    setLiveStatus({ kalshi: kalshiLive, poly: polyLive });
    setRefreshing(false);
  }

  function detectCategory(title) {
    const t = title.toLowerCase();
    if (/(valorant|vct|league of legends|lol|cs2|counter.strike|esport|riot|navi|t1|sentinels|fnatic)/i.test(t)) return "ESPORTS";
    if (/(nba|nfl|mlb|nhl|knicks|lakers|ravens|chiefs|super bowl|championship|playoffs|mvp|basketball|football|baseball)/i.test(t)) return "SPORTS";
    if (/(oscar|grammy|emmy|movie|film|album|box office|celebrity|award|gta|game release)/i.test(t)) return "POPCULTURE";
    return "HIGHEDGE";
  }

  const handleAnalyze = useCallback(async (market) => {
    setLoading(prev => ({ ...prev, [market.id]: true }));
    try {
      const result = await analyzeMarket(market);
      setAnalyses(prev => ({ ...prev, [market.id]: result }));
    } catch (e) {
      console.error("Analysis error:", e);
    } finally {
      setLoading(prev => ({ ...prev, [market.id]: false }));
    }
  }, []);

  const handleDecision = (id, d) => setDecisions(prev => ({ ...prev, [id]: d }));

  const filtered = filter === "ALL" ? markets : markets.filter(m => m.category === filter);
  const yesMarkets = Object.entries(decisions).filter(([, d]) => d === "YES");
  const totalStaked = yesMarkets.reduce((acc, [id]) => {
    const m = markets.find(x => x.id === id);
    const a = analyses[id];
    if (!m || !a) return acc;
    return acc + parseFloat(halfKelly(a.trueProb, m.yesPrice));
  }, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#050b14" }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        button:hover { opacity: 0.85; }
      `}</style>

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "#060d1a", borderBottom: "1px solid #0f1f35",
        padding: "12px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: "#e2e8f0" }}>
            ▸ DESKSIDE MARKETS
          </div>
          <div style={{ fontSize: 8, color: "#374151", letterSpacing: 2, marginTop: 1 }}>
            PREDICTION MARKET ADVISOR · SOCIAL-FIRST EDGE
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {/* Live status */}
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: "KAL", live: liveStatus.kalshi },
              { label: "POLY", live: liveStatus.poly },
            ].map(s => (
              <span key={s.label} style={{
                fontSize: 8, padding: "2px 6px", borderRadius: 2, letterSpacing: 1,
                background: s.live ? "#00ff8715" : "#1a2535",
                border: `1px solid ${s.live ? "#00ff8740" : "#1a2535"}`,
                color: s.live ? "#00ff87" : "#374151",
              }}>
                {s.live ? "●" : "○"} {s.label}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
            {balance && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 7, color: "#374151", letterSpacing: 1 }}>KALSHI BAL</div>
                <div style={{ color: "#00ff87", fontWeight: 700 }}>${balance}</div>
              </div>
            )}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 7, color: "#374151", letterSpacing: 1 }}>BANKROLL</div>
              <div style={{ color: "#f59e0b", fontWeight: 700 }}>${BANKROLL}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 7, color: "#374151", letterSpacing: 1 }}>STAKED</div>
              <div style={{ color: "#ef4444", fontWeight: 700 }}>${totalStaked.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 7, color: "#374151", letterSpacing: 1 }}>YES</div>
              <div style={{ color: "#00ff87", fontWeight: 700 }}>{yesMarkets.length}</div>
            </div>
          </div>
          <button
            onClick={loadLiveMarkets}
            disabled={refreshing}
            style={{
              padding: "5px 10px", background: "transparent",
              border: "1px solid #1a2535", borderRadius: 3,
              color: refreshing ? "#374151" : "#60a5fa",
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
              cursor: refreshing ? "not-allowed" : "pointer", letterSpacing: 1,
            }}
          >
            {refreshing ? "⟳" : "↺"} REFRESH
          </button>
        </div>
      </div>

      {/* Category Filter */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #0f1f35", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(CATEGORIES).map(([key, cat]) => {
          const active = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)} style={{
              padding: "4px 12px", background: active ? cat.color + "18" : "transparent",
              border: `1px solid ${active ? cat.color : "#1a2535"}`,
              borderRadius: 3, cursor: "pointer",
              color: active ? cat.color : "#374151",
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1,
            }}>
              {cat.icon} {cat.label}
            </button>
          );
        })}
      </div>

      {/* Methodology Banner */}
      <div style={{ padding: "6px 20px", background: "#060d1a", borderBottom: "1px solid #0f1f35" }}>
        <div style={{ fontSize: 8, color: "#1e3a5f", letterSpacing: 1 }}>
          ◈ METHODOLOGY · Single markets only · No parlays · Half-Kelly sizing · Social signal edge weighting · Kalshi + Polymarket
        </div>
      </div>

      {/* Market List */}
      <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 760, margin: "0 auto" }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#374151", fontSize: 11, padding: 40 }}>
            No markets in this category
          </div>
        )}
        {filtered.map(market => (
          <MarketCard
            key={market.id}
            market={market}
            onAnalyze={handleAnalyze}
            analysis={analyses[market.id]}
            loading={loading[market.id]}
            decision={decisions[market.id]}
            onDecision={handleDecision}
          />
        ))}
      </div>
    </div>
  );
}
