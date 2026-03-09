# DESKSIDE MARKETS — DEPLOY GUIDE
# Total time: ~5 minutes

## STEP 1 — Update Your Cloudflare Worker
1. Go to https://dash.cloudflare.com → Workers & Pages → your existing worker
2. Click "Edit Code"
3. Replace ALL existing code with the contents of worker.js
4. Go to Settings → Variables → add these 3 secrets (use "Encrypt" for all):
   - KALSHI_API_KEY_ID  = your Kalshi key ID (the short identifier, not the PEM)
   - KALSHI_PRIVATE_KEY = your full Kalshi private key (paste the entire PEM block,
                          including -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY-----)
   - ANTHROPIC_API_KEY  = your Anthropic key
   NOTE: No Polymarket key needed — it's a public API
5. Click "Save and Deploy"
6. Copy your Worker URL (looks like https://xxx.workers.dev)

## STEP 2 — Configure the React App
1. In the deskside-markets folder, rename .env.example to .env
2. Open .env and replace YOUR-WORKER-NAME.YOUR-SUBDOMAIN with your actual Worker URL
   Example: VITE_WORKER_URL=https://deskside-proxy.mike.workers.dev

## STEP 3 — Deploy to Vercel (free, 2 minutes)
Option A — Drag & Drop (easiest):
  1. Go to https://vercel.com → New Project → "Deploy without Git"
  2. Drag the entire deskside-markets folder into Vercel
  3. Under Environment Variables, add: VITE_WORKER_URL = your worker URL
  4. Click Deploy → done

Option B — GitHub (best for updates):
  1. Push deskside-markets folder to a GitHub repo
  2. Go to https://vercel.com → Import Git Repository
  3. Select your repo, add VITE_WORKER_URL env var
  4. Deploy

## STEP 4 — You're live
- Vercel gives you a free URL like https://deskside-markets.vercel.app
- Markets auto-load from Kalshi + Polymarket on page open
- Hit RUN ANALYSIS on any card to get the full Claude breakdown
- YES/NO/PASS to track your decisions

## TROUBLESHOOTING
- Markets not loading? Check Worker is deployed and keys are set
- CORS error? Make sure worker.js CORS headers include your Vercel domain
- Anthropic errors? Verify ANTHROPIC_API_KEY is set in Worker variables (NOT in .env)
