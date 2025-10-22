const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

async function run() {
  const url = process.env.API_URL || 'http://localhost:3001/api/chat';
  const token = process.env.TEST_TOKEN;
  const question = process.env.QUESTION || 'Ciao';

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-TEST-TOKEN'] = token;
  // Allow tests to simulate a browser Origin header by setting ORIGIN env var
  if (process.env.ORIGIN) headers['Origin'] = process.env.ORIGIN;

  try {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ question }), headers });
    const json = await res.json();
    console.log('Response:', json);
    process.exit(0);
  } catch (e) {
    console.error('Test failed', e);
    process.exit(2);
  }
}

run();
