async function kalshiHeaders(env, method, path) {
  const timestamp = Date.now().toString();
  const pathWithoutQuery = path.split('?')[0];
  const msgString = timestamp + method.toUpperCase() + pathWithoutQuery;
  const pemContents = env.KALSHI_API_SECRET
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    privateKey, new TextEncoder().encode(msgString)
  );
  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": env.KALSHI_API_KEY,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": btoa(String.fromCharCode(...new Uint8Array(sig))),
  };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    // ANTHROPIC PROXY — add ANTHROPIC_API_KEY to your Worker secrets
    if (url.pathname === "/anthropic") {
      try {
        const body = await req.text();
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body,
        });
        const data = await res.text();
        return new Response(data, {
          status: res.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // POLYMARKET PROXY — no auth
    if (url.pathname.startsWith("/polymarket/")) {
      const polyPath = url.pathname.replace("/polymarket", "");
      const polyUrl = "https://gamma-api.polymarket.com" + polyPath + url.search;
      try {
        const res = await fetch(polyUrl, { headers: { "Content-Type": "application/json" } });
        const data = await res.text();
        return new Response(data, {
          status: res.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
    }

    // KALSHI PROXY — signed auth
    try {
      const kalshiPath = "/trade-api/v2" + url.pathname + url.search;
      const kalshiUrl = "https://api.elections.kalshi.com" + kalshiPath;
      const headers = await kalshiHeaders(env, req.method, kalshiPath);
      const body = req.method === "POST" ? await req.text() : undefined;
      const res = await fetch(kalshiUrl, { method: req.method, headers, body });
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
  }
};
