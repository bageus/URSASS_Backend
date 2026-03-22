const test = require('node:test');
const assert = require('node:assert/strict');

const { registerHandlers } = require('../bot');

test('registerHandlers subscribes bot to Telegram Stars payment events', () => {
  const events = [];
  const textHandlers = [];
  const fakeBot = {
    on(event, handler) {
      events.push({ event, handler });
      return this;
    },
    onText(pattern, handler) {
      textHandlers.push({ pattern, handler });
      return this;
    }
  };

  registerHandlers(fakeBot);

  const eventNames = events.map((item) => item.event);
  assert.ok(eventNames.includes('pre_checkout_query'));
  assert.ok(eventNames.includes('successful_payment'));
  assert.ok(eventNames.includes('message'));
  assert.ok(textHandlers.length >= 2);
});
