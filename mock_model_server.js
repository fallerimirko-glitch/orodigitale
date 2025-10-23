import http from 'http';

const port = process.env.MOCK_MODEL_PORT || 9000;

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && (req.url === '/predict' || req.url === '/predict/')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const j = body ? JSON.parse(body) : {};
      const prompt = j.prompt || (j.inputs ? j.inputs : (j.instances && j.instances[0] && j.instances[0].input) || '');
      const text = `MOCK RESPONSE: ricevuto prompt di lunghezza ${String(prompt).length}. Esempio di risposta per test.`;
      const out = { text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid-json' }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, () => console.log(`Mock model server listening on http://127.0.0.1:${port}/predict`));
