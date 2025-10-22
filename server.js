import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';


const fsExistsSync = (p) => {
  try { return fs.existsSync(p); } catch { return false; }
};

// Load env
dotenv.config();

const app = express();
// Allow cross-origin requests and explicitly allow our custom TEST header
app.use(cors({ origin: true, allowedHeaders: ['Content-Type', 'X-TEST-TOKEN', 'Authorization'] }));
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
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
      if (!token || token !== TEST_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized - missing or invalid TEST_TOKEN' });
      }
    }

    const { question, history, prompt } = req.body;

    // Fallback: if client-side already sent a fully built prompt, use it; else build a small one
    const finalPrompt = prompt || `User: ${question}\n`;

    // Basic rate-limit not to abuse the API
    // Initialize genaiClient lazily and robustly (only if API key provided)
    if (!genaiClient && !USE_FALLBACK) {
      try {
        const mod = await import('@google/genai');
        // prefer named export GoogleGenAI if available, else fallback to default
        const GoogleGenAI = mod.GoogleGenAI || mod.default || mod;
        genaiClient = new GoogleGenAI({ apiKey: API_KEY });
      } catch (e) {
        console.error('Failed to initialize @google/genai client', e);
        return res.status(500).json({ error: 'AI client initialization failed' });
      }
    }
    // If we are in fallback mode, generate a canned response based on simple heuristics
    let response;
    if (USE_FALLBACK) {
      // Simple heuristic responder
      const lower = (question || '').toLowerCase();
      if (lower.includes('prezzo') || lower.includes('costo')) {
        response = { text: 'Prezzi principali:\n• ASIC intero: €7.450 (netto con detrazione: €2.607)\n• ½ ASIC: €3.810 (netto: €1.333)\n• MAP da €150.' };
      } else if (lower.includes('garanzia') || lower.includes('sicurezza')) {
        response = { text: 'Garanzie: Piena proprietà legale, contratto italiano, certificazione BDO, recesso 14 giorni.' };
      } else if (lower.includes('flexminer') || lower.includes('app')) {
        response = { text: 'Flexminer è l\'app di monitoraggio inclusa per controllare produzione, hashrate e statistiche in tempo reale.' };
      } else {
        response = { text: 'Mi dispiace, al momento stiamo eseguendo il server in modalità demo senza accesso AI esterno. Per informazioni dettagliate, contatta info@digitalforcemining.it' };
      }
    } else {
      // Call the GenAI client - use generateContent if available, else try alternative entrypoints
      if (genaiClient.models && typeof genaiClient.models.generateContent === 'function') {
        response = await genaiClient.models.generateContent({ model: 'gemini-2.5-flash', contents: finalPrompt });
      } else if (typeof genaiClient.generateText === 'function') {
        response = await genaiClient.generateText(finalPrompt);
      } else {
        // Last resort: try to call a generic method
        response = await genaiClient.call?.(finalPrompt) || response;
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

    console.log(`[chat] question="${(question||'').slice(0,120)}" len(response)=${text.length} fallback=${USE_FALLBACK}`);

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
