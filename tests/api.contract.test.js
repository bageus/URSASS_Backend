const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const mongoose = require('mongoose');
const { createApp } = require('../app');

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test.beforeEach(() => {
  Player.find = () => ({
    sort: () => ({ limit: () => ({ select: async () => [] }) })
  });
  Player.findOne = () => ({ select: async () => null });
  Player.countDocuments = async () => 0;
  AccountLink.find = async () => [];
  AccountLink.findOne = async () => null;
});

test('contract: GET /health returns stable shape', async () => {
  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(typeof body.status, 'string');
  assert.ok(body.timestamp);
  assert.equal(typeof body.mongodb, 'string');
  assert.equal(typeof body.mongodbDetails, 'object');

  await server.close();
});

test('contract: GET /api/leaderboard/top public payload shape', async () => {
  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/leaderboard/top`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(body.leaderboard));
  assert.ok('playerPosition' in body);

  await server.close();
});

test('contract: GET /api/game/config default payload shape', async () => {
  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/game/config`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(typeof body.mode, 'string');
  assert.equal(typeof body.preset, 'string');
  assert.equal(typeof body.authRequired, 'boolean');
  assert.equal(typeof body.rides, 'object');
  assert.equal(typeof body.activeEffects, 'object');

  await server.close();
});
