// POST /api/signup — stores one email address in the D1 database bound as `DB` (wrangler.jsonc).
// Any other method on this path falls through to static assets and gets the site's 404.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const SOURCES = new Set(['hero', 'footer', 'ticker', 'poster', 'page']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return request.json();
  return Object.fromEntries(await request.formData());
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    return json(400, { error: 'Send JSON like {"email":"you@example.com"}.' });
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    return json(400, { error: 'That doesn’t look like an email address.' });
  }

  // Honeypot: people never see this field and bots fill it. Answer as if it worked.
  if (String(body?.website ?? '').trim()) {
    return json(200, { ok: true });
  }

  if (!env.DB) {
    return json(503, { error: 'Signups are not connected to a database yet.' });
  }

  const source = SOURCES.has(body?.source) ? body.source : 'page';
  try {
    // A repeat signup is a success too, so the response never reveals who is already on the list.
    await env.DB.prepare('INSERT INTO signups (email, source) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING')
      .bind(email, source)
      .run();
  } catch (error) {
    console.error('signup insert failed', error);
    return json(500, { error: 'Could not save that address.' });
  }

  return json(200, { ok: true });
}
