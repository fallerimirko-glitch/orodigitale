Testing the app locally with a mock model

This repository now includes a mock model server so you can run a working local test without external API keys.

Steps:

1) Start the mock model server (runs on 9000):

   node mock_model_server.js

2) Start the app server (in project root):

   node server.js

3) Open the admin UI locally to see runtime config (optional):

   http://127.0.0.1:3001/admin

4) Test the chat endpoint with a sample request (PowerShell):

   $h = @{ 'Content-Type' = 'application/json'; 'X-TEST-TOKEN' = 'devtest' }
   $body = @{ question = 'Ping mock' } | ConvertTo-Json
   Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/chat' -Method Post -Headers $h -Body $body

You should see a response starting with "MOCK RESPONSE: ..." indicating the mock is used.

To integrate with the real model later:
- Replace EXTERNAL_MODEL_URL in `.env.local` with the programmatic endpoint and set EXTERNAL_API_KEY.
- Restart the app server.

Security:
- Admin UI is protected by `ADMIN_PASSWORD` set in `.env.local`.
- The insecure one-time admin endpoint has been removed.
