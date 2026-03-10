import { useState, useEffect, useCallback } from "react";

const WORKER = import.meta.env?.VITE_WORKER_URL || "https://YOUR-WORKER.workers.dev";
const BANKROLL = 500;
const MAX_BET_PCT = 0.05;

// ─── CATEGORY DETECTION ───────────────────────────────────────────────────────
function detectCategory(title = "") {
  const t = title.toLowerCase();
  if (/(valorant|vct|league of legends|\blol\b|cs2|counter.strike|esport|riot|navi|\bt1\b|sentinels|fnatic|nrg|loud|team liquid|faze|g2|natus|dota|dota 2|cloud9|\bc9\b|100 thieves|evil geniuses|\beg\b)/i.test(t))
    return "ESPORTS";
  if (/(nba|nfl|mlb|nhl|ncaa|ncaaf|ncaab|knicks|lakers|celtics|warriors|ravens|chiefs|super bowl|championship|playoffs|mvp|basketball|football|baseball|hockey|stanley cup|tennis|wimbledon|us open|french open|australian open|formula 1|\bf1\b|grand prix|mls|soccer|premier league|world cup)/i.test(t))
    return "SPORTS";
  if (/(oscar|grammy|emmy|golden globe|bafta|movie|film|album|box office|celebrity|award|gta|game release|streaming|taylor swift|beyonce|kardashian|reality tv|snl)/i.test(t))
    return "POPCULTURE";
  return "HIGHEDGE";
}

// ─── PARLAY KILLER ────────────────────────────────────────────────────────────
// Returns true = discard this market
function isParlay(title = "") {
  const t = title.toLowerCase();
  if ((t.match(/\band\b/g) || []).length >= 2) return true;
  if (/both .+ and .+/.test(t)) return true;
  if (/same game parlay|sgp|multi.leg|multileg|\bparlay\b/i.test(t)) return true;
  if (/score .+ and .+ win/i.test(t)) return true;
  if (/\+ .+ \+ .+/.test(t)) return true;
  return false;
}

// ─── EDGE OPPORTUNITY SCORE (0–100) ───────────────────────────────────────────
function edgeScore(market) {
  let score = 0;

  // Volume → liquidity → real edge
  const raw = parseFloat((market.volume || "0").replace(/[$,]/g, "")) || 0;
  const str = (market.volume || "").toLowerCase();
  const volK = str.includes("m") ? raw * 1000 : str.includes("k") ? raw : raw / 1000;
  score += Math.min(volK / 80, 25); // up to 25pts

  // Closing urgency
  try {
    const days = (new Date(market.closes) - Date.now()) / 86400000;
    if (days >= 0 && days <= 1)  score += 28;
    else if (days <= 3)          score += 20;
    else if (days <= 7)          score += 12;
    else if (days <= 30)         score += 4;
  } catch {}

  // Price near 50/50 = most mispricing opportunity
  const p = market.yesPrice || 0.5;
  const dist = Math.abs(p - 0.5);
  if (dist < 0.1)       score += 20;
  else if (dist < 0.2)  score += 13;
  else if (dist < 0.35) score += 6;

  // Category bonuses
  if (market.category === "ESPORTS") score += 10;
  if (market.category === "SPORTS")  score += 7;

  return Math.min(Math.round(score), 100);
}

// ─── HALF-KELLY ───────────────────────────────────────────────────────────────
function halfKelly(trueProb, marketPrice) {
  const p = trueProb / 100;
  const q = 1 - p;
  const b = (1 / Math.max(marketPrice, 0.01)) - 1;
  const kelly = (b * p - q) / b;
  return Math.min(Math.max(kelly * 0.5, 0) * BANKROLL, MAX_BET_PCT * BANKROLL).toFixed(2);
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const edgeCol  = e => e >= 12 ? "#00ff87" : e >= 6 ? "#f59e0b" : e >= 0 ? "#94a3b8" : "#ef4444";
const sentCol  = s => s === "BULLISH" ? "#00ff87" : s === "BEARISH" ? "#ef4444" : "#4b5563";
const catColor = c => c === "ESPORTS" ? "#a78bfa" : c === "SPORTS" ? "#00ff87" : c === "POPCULTURE" ? "#f59e0b" : "#06b6d4";
const catIcon  = c => c === "ESPORTS" ? "🎮" : c === "SPORTS" ? "⚡" : c === "POPCULTURE" ? "🎬" : "📊";

// ─── RAW FETCHES ──────────────────────────────────────────────────────────────
async function fetchKalshiRaw() {
  const r = await fetch(`${WORKER}/markets?limit=100&status=open`);
  if (!r.ok) throw new Error("Kalshi API error");
  return r.json();
}
async function fetchPolyRaw() {
  const r = await fetch(`${WORKER}/polymarket/markets?limit=100&active=true&closed=false&order=volume&ascending=false`);
  if (!r.ok) throw new Error("Polymarket API error");
  return r.json();
}
async function fetchBalance() {
  const r = await fetch(`${WORKER}/balance`);
  if (!r.ok) throw new Error("Balance error");
  return r.json();
}

// ─── AI ANALYSIS ──────────────────────────────────────────────────────────────
async function runAnalysis(market) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const implied = (market.yesPrice * 100).toFixed(1);

  const system = `You are a sharp, disciplined prediction market trader. Today is ${today}.
You identify mispriced markets using statistical analysis, recent form, and community signals (Reddit, X/Twitter chatter).
You ONLY trade single binary markets. Half-Kelly sizing on $${BANKROLL} bankroll.
Respond ONLY with minified valid JSON. No markdown. No text outside the JSON object.`;

  const prompt = `Analyze this prediction market:

Title: "${market.title}"
Platform: ${market.platform}
Category: ${market.category}
YES Price: ${implied}%
Volume: ${market.volume}
Closes: ${market.closes}

Return exactly this JSON structure — no deviations:
{
  "trueProb": <number 0-100>,
  "edge": <trueProb minus ${implied}, negative means market is correctly priced or overpriced>,
  "recommendation": "YES" | "NO" | "PASS",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "social": {
    "reddit": { "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": <1-10>, "note": "<10 words max>" },
    "xTwitter": { "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": <1-10>, "note": "<10 words max>" },
    "communityEdge": <number -5 to 5>
  },
  "factors": ["<factor 1>", "<factor 2>", "<factor 3>"],
  "esportsFactors": ${market.category === "ESPORTS" ? '["<roster/lineup note>","<recent tournament form>","<meta or patch note>"]' : "null"},
  "risks": ["<risk 1>", "<risk 2>"],
  "thesis": "<2 sharp sentences: your core thesis and why this market is mispriced>",
  "action": "<1 direct sentence: exactly what I should do right now and why>"
}`;

  const res = await fetch(`${WORKER}/anthropic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "{}";
  return JSON.parse(text.replace(/```[\s\S]*?```/g, "").trim());
}

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────
function Tag({ label, color }) {
  return (
    <span style={{
      fontSize: 7, padding: "1px 5px", borderRadius: 2, whiteSpace: "nowrap",
      border: `1px solid ${color}40`, color, fontFamily: "monospace", flexShrink: 0,
    }}>{label}</span>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, background: "#030810", border: "1px solid #090f1e",
      borderRadius: 3, padding: "5px 6px", textAlign: "center",
    }}>
      <div style={{ fontSize: 6, color: "#162030", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: color || "#b8c8dc", fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

function SentRow({ label, data }) {
  if (!data) return null;
  const c = sentCol(data.sentiment);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
      <span style={{ fontSize: 7, color: "#243040", width: 50, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: c + "14", border: `1px solid ${c}30`, color: c, flexShrink: 0 }}>
        {data.sentiment === "BULLISH" ? "▲" : data.sentiment === "BEARISH" ? "▼" : "●"} {data.sentiment}
      </span>
      <span style={{ fontSize: 7, color: c, fontWeight: 700, flexShrink: 0 }}>{data.score}/10</span>
      <span style={{ fontSize: 7, color: "#243040", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {data.note}
      </span>
    </div>
  );
}

function ScoreBar({ score }) {
  const c = score >= 65 ? "#00ff87" : score >= 40 ? "#f59e0b" : score >= 20 ? "#374151" : "#111e2e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ flex: 1, height: 2, background: "#090f1e", borderRadius: 1 }}>
        <div style={{ width: `${score}%`, height: "100%", background: c, borderRadius: 1 }} />
      </div>
      <span style={{ fontSize: 6, color: c, fontFamily: "monospace", width: 16, textAlign: "right", flexShrink: 0 }}>{score}</span>
    </div>
  );
}

// ─── MARKET CARD ──────────────────────────────────────────────────────────────
function MarketCard({ market, onAnalyze, analysis, isLoading, decision, onDecision }) {
  const cc = catColor(market.category);
  const implied = (market.yesPrice * 100).toFixed(1);
  const score = market._score || 0;

  const borderCol = decision === "YES" ? "#00ff8755"
    : decision === "NO" ? "#ef444445"
    : decision === "PASS" ? "#37415122"
    : "#090f1e";

  return (
    <div style={{
      background: "linear-gradient(155deg,#060f1c 0%,#040b16 100%)",
      border: `1px solid ${borderCol}`, borderRadius: 6, padding: "13px 14px",
      transition: "border-color 0.2s",
    }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
            <Tag label={`${catIcon(market.category)} ${market.category}`} color={cc} />
            <Tag label={market.platform.toUpperCase()} color="#1a2a3e" />
          </div>
          <div style={{ fontSize: 12, color: "#b8c8dc", fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>
            {market.title}
          </div>
          <div style={{ fontSize: 7, color: "#162030", marginBottom: 5 }}>
            Vol {market.volume} · Closes {market.closes}
          </div>
          <ScoreBar score={score} />
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#d0dce8", lineHeight: 1, fontFamily: "monospace" }}>
            {implied}<span style={{ fontSize: 10, color: "#162030", fontWeight: 400 }}>%</span>
          </div>
          <div style={{ fontSize: 6, color: "#162030", letterSpacing: 0.8, marginTop: 2 }}>YES IMPLIED</div>
        </div>
      </div>

      {/* ── CTA ── */}
      {!analysis && (
        <button onClick={() => onAnalyze(market)} disabled={isLoading} style={{
          width: "100%", padding: "8px 0", background: "transparent",
          border: `1px solid ${isLoading ? "#090f1e" : "#162a40"}`, borderRadius: 3,
          cursor: isLoading ? "not-allowed" : "pointer",
          color: isLoading ? "#162030" : "#3a7ab8",
          fontSize: 8, fontFamily: "monospace", letterSpacing: 2,
        }}>
          {isLoading ? "⟳  READING SIGNALS..." : "▶  ANALYZE EDGE"}
        </button>
      )}

      {/* ── ANALYSIS ── */}
      {analysis && (
        <div style={{ borderTop: "1px solid #090f1e", paddingTop: 10, marginTop: 4 }}>

          {/* Recommendation banner */}
          {(() => {
            const rec = analysis.recommendation;
            const rc = rec === "YES" ? "#00ff87" : rec === "NO" ? "#ef4444" : "#374151";
            return (
              <div style={{
                marginBottom: 9, padding: "6px 10px",
                background: rc + "0d", border: `1px solid ${rc}28`, borderRadius: 3,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, letterSpacing: 2, color: rc }}>
                  {rec === "YES" ? "▲ BUY YES" : rec === "NO" ? "▼ BUY NO" : "— PASS"}
                </span>
                <span style={{ fontSize: 7, color: "#243040", fontFamily: "monospace" }}>
                  {analysis.confidence} CONFIDENCE
                </span>
              </div>
            );
          })()}

          {/* Stats row */}
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <Stat label="TRUE PROB"   value={`${Number(analysis.trueProb).toFixed(1)}%`} />
            <Stat label="EDGE"
              value={`${analysis.edge > 0 ? "+" : ""}${Number(analysis.edge).toFixed(1)}%`}
              color={edgeCol(analysis.edge)} />
            <Stat label="½-KELLY"
              value={`$${halfKelly(analysis.trueProb, market.yesPrice)}`}
              color="#f59e0b" />
            <Stat label="COMM. EDGE"
              value={`${(analysis.social?.communityEdge || 0) > 0 ? "+" : ""}${analysis.social?.communityEdge || 0}%`}
              color={edgeCol((analysis.social?.communityEdge || 0) * 2)} />
          </div>

          {/* Community signals */}
          <div style={{ background: "#030810", border: "1px solid #090f1e", borderRadius: 3, padding: "7px 9px", marginBottom: 8 }}>
            <div style={{ fontSize: 6, color: "#162030", letterSpacing: 1.5, marginBottom: 6 }}>COMMUNITY SIGNALS</div>
            <SentRow label="Reddit" data={analysis.social?.reddit} />
            <SentRow label="X / Twitter" data={analysis.social?.xTwitter} />
          </div>

          {/* Key factors */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 6, color: "#162030", letterSpacing: 1.5, marginBottom: 5 }}>KEY FACTORS</div>
            {(analysis.factors || []).map((f, i) => (
              <div key={i} style={{ fontSize: 9, color: "#607080", marginBottom: 3, display: "flex", gap: 6, lineHeight: 1.45 }}>
                <span style={{ color: "#0e1e30", flexShrink: 0 }}>▸</span>{f}
              </div>
            ))}
          </div>

          {/* Esports factors */}
          {Array.isArray(analysis.esportsFactors) && analysis.esportsFactors.length > 0 && (
            <div style={{ background: "#050310", border: "1px solid #14082a", borderRadius: 3, padding: "7px 9px", marginBottom: 8 }}>
              <div style={{ fontSize: 6, color: "#3a1a70", letterSpacing: 1.5, marginBottom: 5 }}>ESPORTS FACTORS</div>
              {analysis.esportsFactors.map((f, i) => (
                <div key={i} style={{ fontSize: 9, color: "#607080", marginBottom: 3, display: "flex", gap: 6 }}>
                  <span style={{ color: "#3a1a70", flexShrink: 0 }}>▸</span>{f}
                </div>
              ))}
            </div>
          )}

          {/* Risk flags */}
          {(analysis.risks || []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 6, color: "#162030", letterSpacing: 1.5, marginBottom: 5 }}>RISK FLAGS</div>
              {analysis.risks.map((r, i) => (
                <div key={i} style={{ fontSize: 9, color: "#7a2a2a", marginBottom: 3, display: "flex", gap: 6 }}>
                  <span style={{ flexShrink: 0 }}>⚠</span>{r}
                </div>
              ))}
            </div>
          )}

          {/* Thesis + action */}
          <div style={{ background: "#030810", borderLeft: "2px solid #0e2540", borderRadius: "0 3px 3px 0", padding: "8px 10px", marginBottom: 9 }}>
            <div style={{ fontSize: 9, color: "#4a7aaa", lineHeight: 1.7, fontStyle: "italic", marginBottom: 5 }}>
              {analysis.thesis}
            </div>
            <div style={{ fontSize: 9, color: "#2a5a80", lineHeight: 1.5, fontWeight: 600 }}>
              → {analysis.action}
            </div>
          </div>

          {/* Decision buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
            {[
              { key: "YES",  label: "▲ YES",  sub: "buy yes position",  color: "#00ff87" },
              { key: "PASS", label: "— PASS", sub: "skip this market",  color: "#4b5563" },
              { key: "NO",   label: "▼ NO",   sub: "buy no position",   color: "#ef4444" },
            ].map(({ key, label, sub, color }) => {
              const active = decision === key;
              return (
                <button key={key} onClick={() => onDecision(market.id, key)} style={{
                  padding: "8px 0", background: active ? color + "16" : "transparent",
                  border: `1px solid ${active ? color + "70" : "#0e1e2e"}`,
                  borderRadius: 3, cursor: "pointer", color: active ? color : "#243040",
                  fontSize: 9, fontFamily: "monospace", fontWeight: 700, letterSpacing: 1.5,
                }}>
                  {label}
                  <div style={{ fontSize: 6, fontWeight: 400, letterSpacing: 0.3, marginTop: 2, color: active ? color + "88" : "#0e1e2e" }}>
                    {sub}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const CATS = ["ALL", "SPORTS", "ESPORTS", "POPCULTURE", "HIGHEDGE"];
const CAT_META = {
  ALL:        { label: "All Markets", color: "#4b5563" },
  SPORTS:     { label: "⚡ Sports",   color: "#00ff87" },
  ESPORTS:    { label: "🎮 Esports",  color: "#a78bfa" },
  POPCULTURE: { label: "🎬 Pop",      color: "#f59e0b" },
  HIGHEDGE:   { label: "📊 Edge",     color: "#06b6d4" },
};

export default function App() {
  const [markets, setMarkets]         = useState([]);
  const [analyses, setAnalyses]       = useState({});
  const [loadingMap, setLoadingMap]   = useState({});
  const [decisions, setDecisions]     = useState({});
  const [catFilter, setCatFilter]     = useState("ALL");
  const [balance, setBalance]         = useState(null);
  const [connStatus, setConnStatus]   = useState({ kalshi: false, poly: false });
  const [scanning, setScanning]       = useState(false);
  const [scanError, setScanError]     = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [rawStats, setRawStats]       = useState({ pulled: 0, killed: 0 });

  useEffect(() => { scan(); }, []);

  async function scan() {
    setScanning(true);
    setScanError(null);
    const raw = [];
    let kOk = false, pOk = false, killed = 0;

    // Balance
    try {
      const b = await fetchBalance();
      if (b?.balance != null) setBalance((b.balance / 100).toFixed(2));
    } catch {}

    // Kalshi
    try {
      const kd = await fetchKalshiRaw();
      for (const m of (kd?.markets || [])) {
        if (isParlay(m.title)) { killed++; continue; }
        const yes = m.yes_ask ? m.yes_ask / 100 : 0.5;
        raw.push({
          id: `k_${m.ticker || Math.random().toString(36).slice(2)}`,
          platform: "Kalshi",
          category: detectCategory(m.title || ""),
          title: (m.title || m.ticker || "").trim(),
          yesPrice: Math.min(Math.max(yes, 0.01), 0.99),
          volume: `$${Math.round((m.volume || 0) / 100).toLocaleString()}`,
          closes: m.close_time
            ? new Date(m.close_time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "TBD",
        });
      }
      kOk = true;
    } catch (e) { console.warn("Kalshi:", e.message); }

    // Polymarket
    try {
      const pd = await fetchPolyRaw();
      const arr = pd?.data || (Array.isArray(pd) ? pd : []);
      for (const m of arr) {
        if (!m.question || isParlay(m.question)) { killed++; continue; }
        const yes = parseFloat(m.tokens?.find(t => t.outcome === "Yes")?.price ?? 0.5);
        raw.push({
          id: `p_${m.id || Math.random().toString(36).slice(2)}`,
          platform: "Polymarket",
          category: detectCategory(m.question),
          title: m.question.trim(),
          yesPrice: Math.min(Math.max(yes, 0.01), 0.99),
          volume: `$${Math.round(m.volume || 0).toLocaleString()}`,
          closes: m.end_date_iso
            ? new Date(m.end_date_iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "TBD",
        });
      }
      pOk = true;
    } catch (e) { console.warn("Polymarket:", e.message); }

    if (raw.length === 0) {
      setScanError("No markets returned from APIs. Check your Worker URL and API keys, then retry.");
      setScanning(false);
      return;
    }

    // Score → sort → top 50
    const top50 = raw
      .map(m => ({ ...m, _score: edgeScore(m) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 50);

    setMarkets(top50);
    setConnStatus({ kalshi: kOk, poly: pOk });
    setRawStats({ pulled: raw.length, killed });
    setLastUpdate(new Date());
    setScanning(false);
  }

  const handleAnalyze = useCallback(async (market) => {
    setLoadingMap(p => ({ ...p, [market.id]: true }));
    try {
      const result = await runAnalysis(market);
      setAnalyses(p => ({ ...p, [market.id]: result }));
    } catch (e) {
      console.error("Analysis:", e);
    } finally {
      setLoadingMap(p => ({ ...p, [market.id]: false }));
    }
  }, []);

  const handleDecision = (id, d) =>
    setDecisions(p => ({ ...p, [id]: p[id] === d ? undefined : d }));

  const filtered = catFilter === "ALL"
    ? markets
    : markets.filter(m => m.category === catFilter);

  const yesIds = Object.entries(decisions).filter(([, d]) => d === "YES").map(([id]) => id);
  const totalStaked = yesIds.reduce((sum, id) => {
    const m = markets.find(x => x.id === id);
    const a = analyses[id];
    return m && a ? sum + parseFloat(halfKelly(a.trueProb, m.yesPrice)) : sum;
  }, 0);

  const catCounts = CATS.reduce((acc, c) => {
    acc[c] = c === "ALL" ? markets.length : markets.filter(m => m.category === c).length;
    return acc;
  }, {});

  return (
    <div style={{ minHeight: "100vh", background: "#020810" }}>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        *{box-sizing:border-box;margin:0;padding:0}
        button:hover:not(:disabled){opacity:.75}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-track{background:#020810}
        ::-webkit-scrollbar-thumb{background:#090f1e;border-radius:2px}
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "#03091a", borderBottom: "1px solid #080e1e",
        padding: "9px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
      }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, color: "#b8c8dc", fontFamily: "monospace" }}>
            ▸ DESKSIDE MARKETS
          </div>
          <div style={{ fontSize: 6, color: "#0c1a2a", letterSpacing: 2, marginTop: 1 }}>
            LIVE EDGE ENGINE · TOP 50 PLAYS
          </div>
        </div>

        {/* Connection + scan stats */}
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {[{ l: "KAL", v: connStatus.kalshi }, { l: "POLY", v: connStatus.poly }].map(s => (
            <span key={s.l} style={{
              fontSize: 6, padding: "2px 5px", borderRadius: 2,
              background: s.v ? "#00ff870c" : "#08121e",
              border: `1px solid ${s.v ? "#00ff8722" : "#080e1e"}`,
              color: s.v ? "#00ff87" : "#0c1a2a", fontFamily: "monospace",
            }}>
              {s.v ? "●" : "○"} {s.l}
            </span>
          ))}
          {rawStats.pulled > 0 && (
            <span style={{ fontSize: 6, color: "#0c1a2a", fontFamily: "monospace" }}>
              {rawStats.pulled} raw · {rawStats.killed} filtered · {markets.length} shown
            </span>
          )}
        </div>

        {/* Right: stats + refresh */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              balance    && { l: "BAL",      v: `$${balance}`,             c: "#00ff87" },
                           { l: "BANKROLL",  v: `$${BANKROLL}`,            c: "#f59e0b" },
                           { l: "STAKED",    v: `$${totalStaked.toFixed(2)}`, c: "#ef4444" },
                           { l: "YES",       v: yesIds.length,              c: "#00ff87" },
            ].filter(Boolean).map(s => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 6, color: "#0c1a2a" }}>{s.l}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: s.c, fontFamily: "monospace" }}>{s.v}</div>
              </div>
            ))}
          </div>
          <button onClick={scan} disabled={scanning} style={{
            padding: "5px 9px", background: "transparent",
            border: `1px solid ${scanning ? "#080e1e" : "#14243a"}`,
            borderRadius: 3, color: scanning ? "#0c1a2a" : "#3a7ab8",
            fontSize: 7, fontFamily: "monospace", cursor: scanning ? "not-allowed" : "pointer", letterSpacing: 1,
          }}>
            {scanning ? "⟳ SCANNING" : "↺ REFRESH"}
          </button>
        </div>
      </div>

      {/* ═══ CATEGORY FILTER ═══ */}
      <div style={{
        padding: "6px 16px", background: "#03091a", borderBottom: "1px solid #080e1e",
        display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center",
      }}>
        {CATS.map(c => {
          const { label, color } = CAT_META[c];
          const active = catFilter === c;
          const n = catCounts[c];
          return (
            <button key={c} onClick={() => setCatFilter(c)} style={{
              padding: "3px 9px", background: active ? color + "12" : "transparent",
              border: `1px solid ${active ? color + "55" : "#080e1e"}`,
              borderRadius: 3, cursor: "pointer",
              color: active ? color : "#1a2a3a",
              fontSize: 7, fontFamily: "monospace", letterSpacing: 0.8,
            }}>
              {label} {n > 0 && <span style={{ opacity: 0.45 }}>{n}</span>}
            </button>
          );
        })}
        {lastUpdate && (
          <span style={{ marginLeft: "auto", fontSize: 6, color: "#0c1a2a", fontFamily: "monospace" }}>
            {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* ═══ METHOD STRIP ═══ */}
      <div style={{ padding: "3px 16px", borderBottom: "1px solid #050c18" }}>
        <div style={{ fontSize: 6, color: "#08121e", letterSpacing: 0.8, fontFamily: "monospace" }}>
          LIVE DATA ONLY · NO FALLBACKS · NO PARLAYS · HALF-KELLY SIZING · ▲ YES = BUY YES · ▼ NO = BUY NO POSITION
        </div>
      </div>

      {/* ═══ MARKET LIST ═══ */}
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 7, maxWidth: 700, margin: "0 auto" }}>

        {/* Loading state */}
        {scanning && markets.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 24, color: "#1a3050", animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 12 }}>⟳</div>
            <div style={{ fontSize: 10, color: "#1a3050", fontFamily: "monospace", letterSpacing: 2 }}>SCANNING LIVE MARKETS...</div>
          </div>
        )}

        {/* Error state */}
        {!scanning && scanError && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 10, color: "#4b3030", fontFamily: "monospace", marginBottom: 12, lineHeight: 1.6 }}>{scanError}</div>
            <button onClick={scan} style={{
              padding: "7px 16px", background: "transparent",
              border: "1px solid #1a3050", borderRadius: 3,
              color: "#3a7ab8", fontSize: 8, fontFamily: "monospace", cursor: "pointer", letterSpacing: 1,
            }}>↺ RETRY</button>
          </div>
        )}

        {/* Empty filtered */}
        {!scanning && !scanError && filtered.length === 0 && markets.length > 0 && (
          <div style={{ textAlign: "center", padding: 40, fontSize: 9, color: "#1a2a3a", fontFamily: "monospace" }}>
            NO MARKETS IN THIS CATEGORY
          </div>
        )}

        {/* Cards */}
        {filtered.map((m, i) => (
          <div key={m.id} style={{ animation: `fadeIn 0.2s ease ${Math.min(i * 0.02, 0.4)}s both` }}>
            <MarketCard
              market={m}
              onAnalyze={handleAnalyze}
              analysis={analyses[m.id]}
              isLoading={!!loadingMap[m.id]}
              decision={decisions[m.id]}
              onDecision={handleDecision}
            />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: 16, textAlign: "center", fontSize: 6, color: "#060e1a", fontFamily: "monospace", letterSpacing: 1 }}>
        DESKSIDE MARKETS · LIVE DATA ONLY · HALF-KELLY · $500 BANKROLL · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
