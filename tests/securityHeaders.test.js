const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

test('security headers are included in API responses', async () => {
  const { server, url } = await startServer();

  try {
    const response = await fetch(`${url}/health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-dns-prefetch-control'), 'off');
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
