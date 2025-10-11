<<<<<<< HEAD
# orodigitale
=======
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1qnjFkiOMBFPHp_f-9Ne3InlQaeOaML1T

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.local.example` to `.env.local` and set your `GEMINI_API_KEY` value.
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Start the backend server (serves /api/chat and optionally the production build):
   ```powershell
   npm run start:server
   ```
5. In a separate terminal, start the Vite dev server for the front-end:
   ```powershell
   npm run dev
   ```

The front-end will proxy `/api` requests to the server if both are running locally. Ensure `.env.local` is not committed to git.

## Docker (opzionale)

Builda l'immagine e avvia il container (assicurati di avere `.env.local` con `GEMINI_API_KEY` nella root):

```powershell
docker build -t digital-force-ai-assistant .
docker run -p 3001:3001 --env-file .env.local digital-force-ai-assistant
```

La app sarà disponibile su `http://localhost:3001`.

## Deploy consigliato (Render / Vercel / Heroku)


Se vuoi, preparo la configurazione per uno di questi provider e la procedura passo-passo.

### Deploy rapido su Render (guida)

1. Vai su https://dashboard.render.com e crea un nuovo Web Service.
2. Collega il repository GitHub `fallerimirko-glitch/orodigitale`.
3. Imposta:
   - Branch: `main`
   - Build Command: `npm ci && npm run build`
   - Start Command: `node server.js`
4. Aggiungi le variabili d'ambiente (Environment) in Render: `GEMINI_API_KEY` e `TEST_TOKEN`.
5. Avvia il servizio; Render costruirà e pubblicherà l'URL pubblico sicuro (HTTPS).

Nota: mantieni il branch `work/orodigitale-local` per iterazioni e crea PR verso `main` quando sei pronto.

## Beta testing: protezione e limiti

Per condividere l'endpoint con beta tester in modo sicuro, usa la variabile d'ambiente `TEST_TOKEN` e imposta `GEMINI_API_KEY` sul server di produzione.

- `TEST_TOKEN`: stringa segreta condivisa con i tester. Se impostata, il server richiederà che le richieste contengano l'header `X-TEST-TOKEN` o il parametro `?token=` con lo stesso valore.
- Rate limiting: il server applica un limite di default di 12 richieste per minuto per IP su `/api/chat`.

Esempio di uso con curl (sostituisci URL e token):

```bash
curl -X POST https://your-service.onrender.com/api/chat \
   -H "Content-Type: application/json" \
   -H "X-TEST-TOKEN: tuo_test_token" \
   -d '{"question":"Quali sono i prezzi?"}'
```

Se non vuoi usare TEST_TOKEN in sviluppo, non impostarlo: il middleware lo salterà.
>>>>>>> origin/work/orodigitale-local
