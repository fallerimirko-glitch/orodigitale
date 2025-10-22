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

// Load env
dotenv.config();

const app = express();
// Allow cross-origin requests and explicitly allow our custom TEST header
// Allow credentials so same-origin fetches can use cookies
app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'X-TEST-TOKEN', 'Authorization'] }));
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
const EXTERNAL_MODEL_URL = process.env.EXTERNAL_MODEL_URL || '';
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || '';
// Name of header to pass the key in (default Authorization)
const EXTERNAL_API_HEADER = process.env.EXTERNAL_API_HEADER || 'Authorization';
const EXTERNAL_API_KEY_PREFIX = process.env.EXTERNAL_API_KEY_PREFIX || 'Bearer ';
const USE_FALLBACK = !API_KEY; // if no API key provided, use local fallback responses
const TEST_TOKEN = process.env.TEST_TOKEN || '';

if (USE_FALLBACK) {
  console.warn('GEMINI_API_KEY not set - starting server in FALLBACK mode (no external AI calls).');
}

// Lazy import of google genai client to keep startup fast when not needed
let genaiClient;


app.post('/api/chat', async (req, res) => {
  try {
    // simple auth for beta testers: require TEST_TOKEN if set
    if (TEST_TOKEN) {
      const token = (req.headers['x-test-token'] || req.query.token || '').toString();
      // Allow same-origin browser requests (so we don't need to expose the token in client)
      const origin = (req.headers.origin || req.headers.referer || '').toString();
      const host = (req.get('host') || '').toString();
      const allowSameOrigin = origin && host && origin.includes(host);
      if (!token || token !== TEST_TOKEN) {
        if (!allowSameOrigin) {
          return res.status(401).json({ error: 'Unauthorized - missing or invalid TEST_TOKEN' });
        } else {
          console.log('[auth] allowing same-origin request without token', { origin, host });
        }
      }
    }

    const { question, history: clientHistory, prompt } = req.body;

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
    const finalPrompt = prompt || `User: ${question}\n`;

    // Basic rate-limit not to abuse the API
    // We'll attempt the external model proxy first if configured. If that fails, and an API key
    // is available, we'll fall back to the GenAI client. Finally, if nothing else is available
    // we'll use the lightweight canned responses.
    let response;

    // 1) Try external model endpoint if configured (use regardless of GEMINI_API_KEY presence)
    if (EXTERNAL_MODEL_URL) {
      try {
        const payload = {
          prompt: finalPrompt,
          history: Array.isArray(sessionHistory) ? sessionHistory.slice(-10) : (clientHistory || []),
          sessionId,
        };
        const headers = { 'Content-Type': 'application/json' };
        if (EXTERNAL_API_KEY) headers[EXTERNAL_API_HEADER] = EXTERNAL_API_KEY_PREFIX + EXTERNAL_API_KEY;

        const fetchRes = await fetch(EXTERNAL_MODEL_URL, { method: 'POST', headers, body: JSON.stringify(payload), timeout: 15000 });
        const json = await fetchRes.json();
        // Try common fields for text
        response = json?.text ? { text: json.text } : (json?.output ? { text: json.output.text || JSON.stringify(json.output) } : json);
      } catch (e) {
        console.error('External model call failed', e);
        // continue to try other options
      }
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
      if (lower.includes('prezzo') || lower.includes('costo')) {
        response = { text: 'Prezzi principali:\n• ASIC intero: €7.450 (netto con detrazione: €2.607)\n• ½ ASIC: €3.810 (netto: €1.333)\n• MAP da €150.' };
      } else if (lower.includes('garanzia') || lower.includes('sicurezza')) {
        response = { text: 'Garanzie: Piena proprietà legale, contratto italiano, certificazione BDO, recesso 14 giorni.' };
      } else if (lower.includes('flexminer') || lower.includes('app')) {
        response = { text: 'Flexminer è l\'app di monitoraggio inclusa per controllare produzione, hashrate e statistiche in tempo reale.' };
      } else if (lower.includes('servizi') || lower.includes('offrite') || lower.includes('cosa fate') || lower.includes('che servizi')) {
        response = { text: 'Offriamo: 1) Vendita quote ASIC; 2) Hosting & gestione; 3) Monitoraggio e report; 4) Supporto legale per fiscalita\u00e0.' };
      } else {
        response = { text: 'Mi dispiace, al momento stiamo eseguendo il server in modalità demo senza accesso AI esterno. Per informazioni dettagliate, contatta info@digitalforcemining.it' };
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

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
