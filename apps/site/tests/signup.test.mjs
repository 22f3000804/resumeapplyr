import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequestPost } from '../functions/api/signup.js';
import { createFakeD1 } from './fake-d1.mjs';

const post = (body, env, type = 'application/json') =>
  onRequestPost({
    request: new Request('https://example.test/api/signup', {
      method: 'POST',
      headers: { 'content-type': type },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    env
  });

test('stores a valid address, lowercased, with its source', async () => {
  const db = createFakeD1();
  const res = await post({ email: '  Ro@Example.com ', source: 'hero' }, { DB: db });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(db.rows.get('ro@example.com').source, 'hero');
});

test('a repeat signup succeeds without a second row', async () => {
  const db = createFakeD1();
  await post({ email: 'a@b.co' }, { DB: db });
  const res = await post({ email: 'A@B.co' }, { DB: db });
  assert.equal(res.status, 200);
  assert.equal(db.rows.size, 1);
});

test('rejects something that is not an email', async () => {
  const db = createFakeD1();
  const res = await post({ email: 'not-an-email' }, { DB: db });
  assert.equal(res.status, 400);
  assert.equal(db.rows.size, 0);
});

test('rejects malformed JSON', async () => {
  const res = await post('{nope', { DB: createFakeD1() });
  assert.equal(res.status, 400);
});

test('the honeypot answers ok and stores nothing', async () => {
  const db = createFakeD1();
  const res = await post({ email: 'bot@spam.co', website: 'http://spam' }, { DB: db });
  assert.equal(res.status, 200);
  assert.equal(db.rows.size, 0);
});

test('without a database binding it answers 503 instead of pretending', async () => {
  const res = await post({ email: 'a@b.co' }, {});
  assert.equal(res.status, 503);
});

test('an unknown source is stored as "page"', async () => {
  const db = createFakeD1();
  await post({ email: 'a@b.co', source: '<script>' }, { DB: db });
  assert.equal(db.rows.get('a@b.co').source, 'page');
});

test('accepts a plain form post too', async () => {
  const db = createFakeD1();
  const res = await post('email=form%40example.com&source=footer', { DB: db }, 'application/x-www-form-urlencoded');
  assert.equal(res.status, 200);
  assert.equal(db.rows.get('form@example.com').source, 'footer');
});
