import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';


const fsExistsSync = (p) => {
  try { return fs.existsSync(p); } catch { return false; }
};
// Load environment from .env if present
try { dotenv.config(); } catch (e) {}
// Runtime config overlay (in-memory) and persistence file
const RUNTIME_CONFIG_PATH = path.join(process.cwd(), '.env.local');
let runtimeConfig = {};
try {
  if (fsExistsSync(RUNTIME_CONFIG_PATH)) {
    const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8');
    raw.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([^=\s]+)=(.*)$/);
      if (m) runtimeConfig[m[1]] = m[2];
    });
  }
} catch (e) {
  console.error('Failed to load runtime .env.local', e?.message || e);
}

const getConfig = (key) => {
  if (runtimeConfig && Object.prototype.hasOwnProperty.call(runtimeConfig, key)) return runtimeConfig[key];
  return process.env[key];
};

// Top-level config getters (allow runtime overrides via .env.local)
const PORT = parseInt(getConfig('PORT') || process.env.PORT || '3001', 10);
const API_KEY = getConfig('API_KEY') || process.env.API_KEY;
const USE_FALLBACK = !!(getConfig('USE_FALLBACK') === '1' || getConfig('USE_FALLBACK') === 'true');
const TEST_TOKEN = getConfig('TEST_TOKEN') || process.env.TEST_TOKEN || 'devtest';

const app = express();
app.use(cors());
app.use(express.json());

// Chat API endpoint
app.post('/api/chat', async (req, res) => {
  try {
    // simple auth for beta testers: require TEST_TOKEN if set
    const tokenEnv = getConfig('TEST_TOKEN') || process.env.TEST_TOKEN || '';
    if (tokenEnv) {
      const token = (req.headers['x-test-token'] || req.query.token || '').toString();
      // Allow same-origin browser requests (so we don't need to expose the token in client)
      const origin = (req.headers.origin || req.headers.referer || '').toString();
      const host = (req.get('host') || '').toString();
      const allowSameOrigin = origin && host && origin.includes(host);
      if (!token || token !== tokenEnv) {
        if (!allowSameOrigin) {
          return res.status(401).json({ error: 'Unauthorized - missing or invalid TEST_TOKEN' });
        } else {
          console.log('[auth] allowing same-origin request without token', { origin, host });
        }
      }
    }

    const { question, history: clientHistory, prompt } = req.body || {};

    // Session handling: create or read a sessionId cookie, track short conversation history in-memory
    const cookies = (req.headers.cookie || '').split(';').map(c => c.trim()).filter(Boolean);
    let sessionId = null;
    for (const c of cookies) {
      const [k,v] = c.split('='); if (k === 'sessionId') { sessionId = v; break; }
    }
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      // set a session cookie (HttpOnly)
      res.setHeader('Set-Cookie', `sessionId=${sessionId}; Path=/; HttpOnly`);
    }

    // in-memory session store (small, ephemeral)
    if (!global.__orodigitale_sessions) global.__orodigitale_sessions = new Map();
    const sessions = global.__orodigitale_sessions;
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    const sessionHistory = sessions.get(sessionId);

    // Fallback: if client-side already sent a fully built prompt, use it; else build a small one
    const finalPrompt = prompt || `User: ${question || ''}\n`;

    // Basic rate-limit not to abuse the API
    let response;

    // Read external model runtime config once before using it
    const EXTERNAL_MODEL_URL = getConfig('EXTERNAL_MODEL_URL');
    const EXTERNAL_API_KEY = getConfig('EXTERNAL_API_KEY');
    const EXTERNAL_API_HEADER = getConfig('EXTERNAL_API_HEADER') || 'Authorization';
    const EXTERNAL_API_KEY_PREFIX = getConfig('EXTERNAL_API_KEY_PREFIX') || 'Bearer ';
    const TEST_TOKEN = getConfig('TEST_TOKEN') || 'devtest';
    const ADMIN_PASSWORD = getConfig('ADMIN_PASSWORD') || process.env.ADMIN_PASSWORD;
    const USE_FALLBACK = !!(getConfig('USE_FALLBACK') === '1' || getConfig('USE_FALLBACK') === 'true');

    if (EXTERNAL_MODEL_URL) {
      try {
        const basePayload = {
          prompt: finalPrompt,
          history: Array.isArray(sessionHistory) ? sessionHistory.slice(-10) : (clientHistory || []),
          sessionId,
        };
        const headers = { 'Content-Type': 'application/json' };
        if (EXTERNAL_API_KEY) headers[EXTERNAL_API_HEADER] = EXTERNAL_API_KEY_PREFIX + EXTERNAL_API_KEY;

        // Helper to try a single POST with given body and return {ok, text, json, status}
        // Try a POST to the given url using multiple common header variants when an API key is present.
        // Returns the first successful (ok & not-HTML) response, or the last attempt result.
        const tryPost = async (url, bodyObj) => {
          const baseHeaders = { 'Content-Type': 'application/json' };
          const attempts = [];

          // Always try the base headers first
          attempts.push(baseHeaders);

          // If an external API key is configured, try common header shapes
          if (EXTERNAL_API_KEY) {
            // Respect configured header name first
            const configured = { ...baseHeaders };
            configured[EXTERNAL_API_HEADER] = EXTERNAL_API_KEY_PREFIX + EXTERNAL_API_KEY;
            attempts.push(configured);

            // Authorization: Bearer
            attempts.push({ ...baseHeaders, Authorization: `Bearer ${EXTERNAL_API_KEY}` });

            // x-api-key common header
            attempts.push({ ...baseHeaders, 'x-api-key': EXTERNAL_API_KEY });
          }

          let lastResult = { ok: false, status: 0, text: null, json: null, error: 'no-attempts' };
          for (const hdrs of attempts) {
            try {
              const res = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(bodyObj), timeout: 15000 });
              const txt = await res.text().catch(() => null);
              let j = null;
              try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
              lastResult = { ok: res.ok, status: res.status, text: txt, json: j, usedHeaders: hdrs };

              // if we got a 2xx and it's not HTML, return immediately
              if (res.ok && !(txt || '').trim().startsWith('<')) return lastResult;
              // otherwise continue to try other header shapes
            } catch (e) {
              lastResult = { ok: false, status: 0, text: null, json: null, error: e?.message || String(e), usedHeaders: hdrs };
            }
          }

          return lastResult;
        };

        // First try: common payload shapes against the configured URL
        const payloadVariants = [
          { prompt: finalPrompt, history: basePayload.history, sessionId },
          { input: { text: finalPrompt }, history: basePayload.history, sessionId },
          { instances: [{ input: finalPrompt }], history: basePayload.history, sessionId },
          { inputs: finalPrompt, history: basePayload.history, sessionId },
          { messages: [{ role: 'user', content: finalPrompt }], history: basePayload.history, sessionId },
          { text: finalPrompt, history: basePayload.history, sessionId },
        ];

        let usedExternal = false;
        let lastAttemptInfo = null;

        for (const bodyShape of payloadVariants) {
          const attempt = await tryPost(EXTERNAL_MODEL_URL, bodyShape);
          lastAttemptInfo = { url: EXTERNAL_MODEL_URL, status: attempt.status, bodyPreview: (attempt.text||'').slice(0,1200) };
          try { global.__orodigitale_last_external = { timestamp: Date.now(), url: EXTERNAL_MODEL_URL, status: attempt.status, bodyPreview: (attempt.text||'').slice(0,2000) }; } catch(e){}
          if (attempt.ok && !(attempt.text||'').trim().startsWith('<')) {
            // good JSON-like response
            response = attempt.json?.text ? { text: attempt.json.text } : (attempt.json?.output ? { text: attempt.json.output.text || JSON.stringify(attempt.json.output) } : (attempt.json || attempt.text));
            usedExternal = true;
            break;
          }
        }

        // If still not found, try alternative candidate endpoints (ai.studio patterns)
        if (!usedExternal) {
          console.error('[proxy] initial attempts to EXTERNAL_MODEL_URL returned no JSON or returned HTML', lastAttemptInfo);
          const candidates = [];
          try {
            const parsed = new URL(EXTERNAL_MODEL_URL);
            const hostname = parsed.hostname;
            const pathname = parsed.pathname || '';
            const appMatch = pathname.match(/\/apps\/(.+?)(?:\/|$)/);
            const appId = appMatch ? appMatch[1] : null;
            if (appId) {
              candidates.push(`https://api.ai.studio/apps/${appId}/predict`);
              candidates.push(`https://api.ai.studio/v1/apps/${appId}/predict`);
              candidates.push(`https://ai.studio/api/apps/${appId}/predict`);
              candidates.push(`https://ai.studio/v1/apps/${appId}/predict`);
              candidates.push(`https://${hostname}/api/apps/${appId}/predict`);
            }
            if (!hostname.includes('api.ai.studio')) {
              candidates.push(EXTERNAL_MODEL_URL.replace(hostname, 'api.ai.studio'));
            }
            candidates.push(EXTERNAL_MODEL_URL + (EXTERNAL_MODEL_URL.endsWith('/') ? 'predict' : '/predict'));
            candidates.push(EXTERNAL_MODEL_URL + (EXTERNAL_MODEL_URL.endsWith('/') ? 'invoke' : '/invoke'));
          } catch (e) {}

          for (const alt of candidates) {
            for (const bodyShape of payloadVariants) {
              const attempt = await tryPost(alt, bodyShape);
              try { global.__orodigitale_last_external = { timestamp: Date.now(), url: alt, status: attempt.status, bodyPreview: (attempt.text||'').slice(0,2000) }; } catch(e){}
              if (attempt.ok && !(attempt.text||'').trim().startsWith('<')) {
                response = attempt.json?.text ? { text: attempt.json.text } : (attempt.json?.output ? { text: attempt.json.output.text || JSON.stringify(attempt.json.output) } : (attempt.json || attempt.text));
                usedExternal = true;
                console.log('[proxy] alternative endpoint and body shape succeeded', alt);
                break;
              }
            }
            if (usedExternal) break;
          }
        }

        if (!usedExternal) {
          // record the failed attempt, but allow fallback to run below when configured
          const errObj = { error: 'external_model_error', status: lastAttemptInfo?.status || 0, bodyPreview: lastAttemptInfo?.bodyPreview || '' };
          // If fallback mode is enabled, clear response so the fallback canned replies run
          if (USE_FALLBACK) {
            response = null;
          } else {
            response = errObj;
          }
        }
      } catch (e) {
        console.error('External model call failed', e);
      }
      // (legacy fallback block removed - new tryPost / candidates logic above handles probing)
    }

    // 2) If no response yet, try Google GenAI client (only if API key present)
    if (!response && !USE_FALLBACK) {
      if (!genaiClient) {
        try {
          const mod = await import('@google/genai');
          const GoogleGenAI = mod.GoogleGenAI || mod.default || mod;
          genaiClient = new GoogleGenAI({ apiKey: API_KEY });
        } catch (e) {
          console.error('Failed to initialize @google/genai client', e);
        }
      }

      if (genaiClient && !response) {
        try {
          if (genaiClient.models && typeof genaiClient.models.generateContent === 'function') {
            response = await genaiClient.models.generateContent({ model: 'gemini-2.5-flash', contents: finalPrompt });
          } else if (typeof genaiClient.generateText === 'function') {
            response = await genaiClient.generateText(finalPrompt);
          } else {
            response = await genaiClient.call?.(finalPrompt) || response;
          }
        } catch (e) {
          console.error('GenAI client call failed', e);
        }
      }
    }

    // 3) If still no response, and we're in fallback mode (no API key & no external model result), use canned replies
    if (!response && USE_FALLBACK) {
      const lower = (question || '').toLowerCase();
      // Topic-specific canned replies
      if (lower.includes('prezzo') || lower.includes('costo')) {
        response = { text: 'Prezzi principali:\n• ASIC intero: €7.450 (netto con detrazione: €2.607)\n• ½ ASIC: €3.810 (netto: €1.333)\n• MAP da €150.' };
      } else if (lower.includes('garanzia') || lower.includes('sicurezza')) {
        response = { text: 'Garanzie: Piena proprietà legale, contratto italiano, certificazione BDO, recesso 14 giorni.' };
      } else if (lower.includes('flexminer') || lower.includes('app')) {
        response = { text: 'Flexminer è l\'app di monitoraggio inclusa per controllare produzione, hashrate e statistiche in tempo reale.' };
      } else if (lower.includes('servizi') || lower.includes('offrite') || lower.includes('cosa fate') || lower.includes('che servizi')) {
        response = { text: 'Offriamo: 1) Vendita quote ASIC; 2) Hosting & gestione; 3) Monitoraggio e report; 4) Supporto legale per fiscalità.' };
      } else if (lower.trim().length === 0 || lower.includes('ciao') || lower.includes('salve') || lower.includes('come va') || lower.includes('come funziona')) {
        // Friendly generic greeting/intro
        response = { text: 'Ciao! Sono l\'assistente di Digital Force Mining. Posso aiutarti con informazioni su prezzi, garanzie, servizi di hosting e l\'app Flexminer. Per dettagli o preventivi scrivi a info@digitalforcemining.it o lascia qui la tua domanda specifica.' };
      } else {
        // Generic fallback with contact and next-steps
        response = { text: 'Mi dispiace, al momento non ho accesso diretto al modello esterno. Per assistenza rapida: 1) scrivi a info@digitalforcemining.it, 2) indica il tuo numero di telefono per essere ricontattato, oppure 3) prova a fare una domanda più specifica (es. "Qual è il prezzo di ½ ASIC?").' };
      }
    }

    // The library may return different shapes; try common fields
    let text = response?.text || response?.output || (Array.isArray(response?.candidates) ? response.candidates[0]?.content : undefined) || '';
    if (!text && Array.isArray(response)) text = JSON.stringify(response[0]);

    // If we still don't have a string, try to stringify safely
    if (typeof text !== 'string') {
      try { text = String(text || ''); } catch (e) { text = ''; }
    }

    // Basic sanitization: strip HTML tags and limit length to avoid flooding the client
    try {
      // remove any HTML tags
      text = text.replace(/<[^>]*>/g, '');
      // truncate to 3000 chars (feel free to lower this)
      if (text.length > 3000) text = text.slice(0, 3000) + '\n\n[Output truncated]';
    } catch (e) {
      // ignore sanitization errors
    }

    // store in session history (truncate to last 10)
    try {
      sessionHistory.push({ q: question || '', a: text.slice(0, 2000) });
      if (sessionHistory.length > 10) sessionHistory.shift();
    } catch (e) {}

    console.log(`[chat] session=${sessionId} question="${(question||'').slice(0,120)}" len(response)=${text.length} fallback=${USE_FALLBACK}`);

    res.json({ text });
  } catch (err) {
    console.error('Error in /api/chat', err);
    res.status(500).json({ error: err?.message || 'Server error' });
  }
});

// Apply rate limiter specifically to /api/chat
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 12, // limit each IP to 12 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/chat', chatLimiter);

// Debug endpoint: return whether X-TEST-TOKEN header was received (mask actual value)
app.get('/api/debug', (req, res) => {
  try {
    const received = !!(req.headers['x-test-token']);
    // Return a minimal safe payload for client-side debugging
    return res.json({ received, origin: req.headers.origin || null, ua: req.headers['user-agent'] || null });
  } catch (e) {
    return res.status(500).json({ error: 'debug-failed' });
  }
});

// Admin endpoint to view last external model response preview
app.get('/api/admin/external-preview', (req, res) => {
  try {
    // same-origin or valid TEST_TOKEN required
    const origin = (req.headers.origin || req.headers.referer || '').toString();
    const host = (req.get('host') || '').toString();
    const allowSameOrigin = origin && host && origin.includes(host);
    const token = (req.headers['x-test-token'] || req.query.token || '').toString();
    if (!allowSameOrigin && token !== TEST_TOKEN) return res.status(401).json({ error: 'unauthorized' });

    const last = global.__orodigitale_last_external || null;
    return res.json({ last });
  } catch (e) {
    return res.status(500).json({ error: 'admin-failed' });
  }
});

// Simple admin UI to set runtime EXTERNAL_MODEL_URL and EXTERNAL_API_KEY
app.get('/admin', (req, res) => {
  try {
    const adminPath = path.join(process.cwd(), 'public', 'admin.html');
    // debug: log computed path and existence
    try { console.log('[admin] adminPath=', adminPath, 'exists=', fsExistsSync(adminPath)); } catch(e){}
    if (fsExistsSync(adminPath)) return res.sendFile(adminPath);
    return res.status(404).send('Admin UI not found');
  } catch (e) {
    return res.status(500).send('admin-error');
  }
});

// POST /api/admin/config - set runtime config (protected by ADMIN_PASSWORD)
app.use(express.json());
app.post('/api/admin/config', (req, res) => {
  try {
    const ADMIN_PASSWORD = getConfig('ADMIN_PASSWORD') || process.env.ADMIN_PASSWORD;
    const provided = (req.headers['x-admin-password'] || req.body.password || '').toString();
    if (!ADMIN_PASSWORD || provided !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });

    const { EXTERNAL_MODEL_URL, EXTERNAL_API_KEY, EXTERNAL_API_HEADER, EXTERNAL_API_KEY_PREFIX } = req.body || {};
    if (!EXTERNAL_MODEL_URL && !EXTERNAL_API_KEY) return res.status(400).json({ error: 'missing' });

    // update in-memory
    if (EXTERNAL_MODEL_URL) runtimeConfig.EXTERNAL_MODEL_URL = EXTERNAL_MODEL_URL;
    if (EXTERNAL_API_KEY) runtimeConfig.EXTERNAL_API_KEY = EXTERNAL_API_KEY;
    if (EXTERNAL_API_HEADER) runtimeConfig.EXTERNAL_API_HEADER = EXTERNAL_API_HEADER;
    if (EXTERNAL_API_KEY_PREFIX) runtimeConfig.EXTERNAL_API_KEY_PREFIX = EXTERNAL_API_KEY_PREFIX;

    // persist to .env.local (append or replace keys)
    try {
      let existing = {};
      if (fsExistsSync(RUNTIME_CONFIG_PATH)) {
        const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8');
        raw.split(/\r?\n/).forEach(line => {
          const m = line.match(/^\s*([^=\s]+)=(.*)$/);
          if (m) existing[m[1]] = m[2];
        });
      }
      const merged = { ...existing, ...runtimeConfig };
      const out = Object.keys(merged).map(k => `${k}=${merged[k]}`).join('\n');
      fs.writeFileSync(RUNTIME_CONFIG_PATH, out, { encoding: 'utf8' });
    } catch (e) {
      console.error('Failed to persist .env.local', e?.message || e);
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'admin-save-failed' });
  }
});

// Insecure one-time admin endpoint for local setup
// (insecure admin endpoint removed) - use the protected POST /api/admin/config or the admin UI at /admin

// Serve static build for preview if available
// Prefer serving a static landing page if present in /public or in /dist
const landingPublicPath = path.join(process.cwd(), 'public', 'landing.html');
const landingDistPath = path.join(process.cwd(), 'dist', 'landing.html');
app.get('/', (req, res, next) => {
  try {
    if (fsExistsSync(landingPublicPath)) {
      return res.sendFile(landingPublicPath);
    }
    if (fsExistsSync(landingDistPath)) {
      return res.sendFile(landingDistPath);
    }
  } catch (e) {
    // ignore and fall through to static
  }
  next();
});

app.use(express.static(path.join(process.cwd(), 'dist')));

// Startup debug: print cwd and whether admin file exists
try {
  const adminCheckPath = path.join(process.cwd(), 'public', 'admin.html');
  console.log(`[startup] cwd=${process.cwd()} adminExists=${fsExistsSync(adminCheckPath)} adminPath=${adminCheckPath}`);
} catch (e) {}

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
