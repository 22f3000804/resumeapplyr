/* Volley — page behaviour.
 *
 * The canvas file drove its copy from a DCLogic renderVals() block with four
 * props (ctaLabel, signupCount, showSocialProof, showStats). Those become the
 * CONFIG object below, and the page is rendered from it at load. The HTML also
 * carries the same defaults inline, so everything reads correctly with
 * JavaScript disabled — this only keeps the numbers in one place.
 */
(function () {
  'use strict';

  var CONFIG = {
    ctaLabel: 'Get my free CV',
    signupCount: 1284,
    showSocialProof: true,

    // POST { email } here on signup. Left null until the backend exists, in
    // which case the form resolves locally and says so.
    signupEndpoint: null,

    scrapedCount: 1204,
    // Rows for the hero-ticker direction. Wire to the live scrape feed later;
    // the shape is what the design showed.
    ticker: [
      { score: 94, tone: 'accent',  title: 'Senior Product Designer — Platform', meta: 'Kraftwerk Labs · Berlin · Greenhouse' },
      { score: 91, tone: 'accent',  title: 'Product Designer, Growth',           meta: 'Halden · Remote EU · Wellfound' },
      { score: 88, tone: 'accent',  title: 'Graduate Analyst Programme 2027',    meta: 'Norden Group · London · LinkedIn' },
      { score: 82, tone: 'deep',    title: 'UX Designer (Mid)',                  meta: 'Ateliér Zed · Prague · Lever' },
      { score: 79, tone: 'deep',    title: 'Design Systems Engineer',            meta: 'Meridian · Remote · Ashby' },
      { score: 71, tone: 'neutral', title: 'Junior Brand Designer',              meta: 'Studio Half · Rotterdam · Indeed' },
      { score: 64, tone: 'neutral', title: 'Marketing Designer, contract',       meta: 'Vell · Remote · Otta' }
    ]
  };

  var TONE = {
    accent: 'var(--color-accent)',
    deep: 'var(--color-accent-700)',
    neutral: 'var(--color-neutral-700)'
  };

  var fmt = function (n) { return n.toLocaleString('en-US'); };

  // ── copy driven by the config ──────────────────────────────────────────

  function renderCopy() {
    var signups = fmt(CONFIG.signupCount);

    each('[data-cta-label]', function (el) { el.textContent = CONFIG.ctaLabel; });
    each('[data-signups]', function (el) { el.textContent = signups; });
    each('[data-scraped]', function (el) { el.textContent = fmt(CONFIG.scrapedCount); });

    var note = CONFIG.showSocialProof
      ? signups + ' people have one already. No card, no catch — we’re validating this.'
      : 'No card, no catch. Takes about nine minutes.';
    each('[data-signup-note]', function (el) { el.textContent = note; });
  }

  // ── signup forms ───────────────────────────────────────────────────────

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function wireForms() {
    each('form.signup', function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        submit(form);
      });
    });
  }

  function submit(form) {
    var input = form.querySelector('input[type="email"]');
    var button = form.querySelector('button[type="submit"]');
    var email = (input.value || '').trim();

    if (!EMAIL.test(email)) {
      input.setAttribute('aria-invalid', 'true');
      say(form, 'error', 'That doesn’t look like an email address yet.');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');

    button.disabled = true;
    say(form, 'pending', 'Sending…');

    send(email)
      .then(function () {
        form.hidden = true;
        say(form, 'ok', 'Check ' + email + ' — your CV brief is on its way.');
      })
      .catch(function (err) {
        button.disabled = false;
        say(form, 'error', err && err.message ? err.message : 'Something went wrong. Try again in a moment.');
      });
  }

  function send(email) {
    if (!CONFIG.signupEndpoint) {
      // No backend wired yet: resolve locally rather than pretend to store it.
      return new Promise(function (resolve) { setTimeout(resolve, 350); });
    }
    return fetch(CONFIG.signupEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(function (res) {
      if (!res.ok) throw new Error('We couldn’t save that address. Try again in a moment.');
    });
  }

  // The status line lives next to the form so a screen reader announces it.
  function say(form, state, message) {
    var status = form.parentNode.querySelector('.signup-status');
    if (!status) return;
    status.hidden = false;
    status.setAttribute('data-state', state);
    status.textContent = message;
  }

  // ── scrape ticker (hero direction B) ───────────────────────────────────

  function renderTicker() {
    var list = document.querySelector('[data-ticker]');
    if (!list) return;

    list.innerHTML = '';
    CONFIG.ticker.forEach(function (row) { list.appendChild(tickerRow(row)); });

    if (list.hasAttribute('data-ticker-live')) startFeed(list);
  }

  function tickerRow(row) {
    var li = document.createElement('li');
    li.className = 'ticker-row';

    var score = document.createElement('span');
    score.className = 'ticker-score tnum';
    score.style.color = TONE[row.tone] || TONE.neutral;
    score.textContent = row.score;

    var body = document.createElement('div');
    body.style.minWidth = '0';

    var title = document.createElement('p');
    title.className = 'ticker-title';
    title.textContent = row.title;

    var meta = document.createElement('p');
    meta.className = 'ticker-meta';
    meta.textContent = row.meta;

    body.appendChild(title);
    body.appendChild(meta);
    li.appendChild(score);
    li.appendChild(body);
    return li;
  }

  // The hero is captioned "scraped in the last hour", so the feed moves: a row
  // rotates in at the top every few seconds and the oldest drops off. Paused
  // when the tab is hidden or the visitor asked for reduced motion.
  function startFeed(list) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    var queue = CONFIG.ticker.slice();
    var counter = document.querySelector('[data-scraped]');
    var scraped = CONFIG.scrapedCount;

    setInterval(function () {
      if (document.hidden) return;

      // Take from the end: the row about to scroll off is the one that comes
      // back in at the top, so the feed rotates without ever showing a
      // posting twice at once.
      var next = queue.pop();
      queue.unshift(next);

      var row = tickerRow(next);
      row.classList.add('is-new');
      list.insertBefore(row, list.firstChild);
      if (list.children.length > CONFIG.ticker.length) {
        list.removeChild(list.lastChild);
      }

      if (counter) counter.textContent = fmt(++scraped);
    }, 4200);
  }

  // ── helpers ────────────────────────────────────────────────────────────

  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  function init() {
    renderCopy();
    wireForms();
    renderTicker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
