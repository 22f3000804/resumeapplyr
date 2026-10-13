/* resumeapplyr — page behaviour.
 *
 * The canvas file drove its copy from a DCLogic renderVals() block. What is left of it lives in
 * CONFIG below. The HTML carries the same text inline, so the page reads correctly with
 * JavaScript disabled — this only keeps the label in one place and wires the forms.
 */
(function () {
  'use strict';

  var CONFIG = {
    ctaLabel: 'Get my free CV',

    // Same-origin Pages Function (functions/api/signup.js) that stores the address in D1.
    signupEndpoint: '/api/signup',

    // Rows for the hero-ticker preview. Sample data, and the panel says so.
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

  var MESSAGES = {
    invalid: 'That doesn’t look like an email address yet.',
    pending: 'Sending…',
    closed: 'Signups aren’t switched on yet. Please try again soon.',
    failed: 'We couldn’t save that address. Try again in a moment.',
    offline: 'We couldn’t reach the server. Check your connection and try again.'
  };

  var TONE = {
    accent: 'var(--color-accent)',
    deep: 'var(--color-accent-700)',
    neutral: 'var(--color-neutral-700)'
  };

  // ── copy driven by the config ──────────────────────────────────────────

  function renderCopy() {
    each('[data-cta-label]', function (el) { el.textContent = CONFIG.ctaLabel; });
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
    var trap = form.querySelector('input[name="website"]');
    var button = form.querySelector('button[type="submit"]');
    var email = (input.value || '').trim();

    if (!EMAIL.test(email)) {
      input.setAttribute('aria-invalid', 'true');
      say(form, 'error', MESSAGES.invalid);
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');

    button.disabled = true;
    say(form, 'pending', MESSAGES.pending);

    send({
      email: email,
      source: form.getAttribute('data-source') || 'page',
      website: trap ? trap.value : ''
    })
      .then(function () {
        form.hidden = true;
        say(form, 'ok', 'You’re on the list. We’ll email ' + email + ' to start your free CV.');
      })
      .catch(function (err) {
        button.disabled = false;
        say(form, 'error', err && err.message ? err.message : MESSAGES.failed);
      });
  }

  // Every rejection carries one of MESSAGES, never the browser's own error text.
  function send(body) {
    return fetch(CONFIG.signupEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.ok) return;
      if (res.status === 400) throw new Error(MESSAGES.invalid);
      if (res.status === 503) throw new Error(MESSAGES.closed);
      throw new Error(MESSAGES.failed);
    }, function () {
      throw new Error(MESSAGES.offline);
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

  // ── sample ticker (hero direction B) ───────────────────────────────────

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

  // The design shows a moving feed, so the sample rows rotate: one comes in at the top every few
  // seconds and the oldest drops off. Paused when the tab is hidden or the visitor asked for
  // reduced motion. Nothing is counted — the rows are samples.
  function startFeed(list) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    var queue = CONFIG.ticker.slice();

    setInterval(function () {
      if (document.hidden || reduced.matches) return;

      // Take from the end: the row about to scroll off is the one that comes back in at the top,
      // so the feed rotates without ever showing a posting twice at once.
      var next = queue.pop();
      queue.unshift(next);

      var row = tickerRow(next);
      row.classList.add('is-new');
      list.insertBefore(row, list.firstChild);
      if (list.children.length > CONFIG.ticker.length) {
        list.removeChild(list.lastChild);
      }
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
