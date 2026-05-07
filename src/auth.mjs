// Browser-context auth helper. Two operating modes:
//
//   1. STATE FILE MODE (preferred — default if HIGGS_STATE_FILE exists)
//      Uses Playwright `storageState` JSON. The script `chromium.launch()`es a
//      fresh Chromium each run and seeds it with cookies from
//      ~/.config/higgsfield/state.json. After every operation we write the
//      (possibly Clerk-refreshed) cookies back. Portable, copy-pastable, easy
//      to bootstrap from any browser.
//
//   2. PERSISTENT PROFILE MODE (legacy fallback)
//      Uses launchPersistentContext on a directory. Heavier on disk, ties the
//      script to one machine, but doesn't need any bootstrap import step.
//
// In either mode, every API call runs inside `page.evaluate()` so it inherits
// the page's cookies (Clerk __client/__session, datadome) and the Clerk SDK's
// auto-refreshed JWT.

// Use playwright-extra + the puppeteer-extra-plugin-stealth bundle so the
// launched browser doesn't leak the obvious "I'm an automation" tells that
// DataDome / Cloudflare / Imperva pin on. Patches WebGL vendor/renderer,
// navigator.plugins/languages, navigator.webdriver, chrome.runtime,
// permissions API quirks, canvas / audio context fingerprints, etc.
//
// Set HIGGS_STEALTH=0 to opt out (e.g. when debugging, or if a future
// stealth update breaks Higgsfield's own JS).
import { chromium as chromiumPlain } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

if (process.env.HIGGS_STEALTH !== '0') {
  chromiumExtra.use(StealthPlugin());
}
const chromium = process.env.HIGGS_STEALTH === '0' ? chromiumPlain : chromiumExtra;

const HF_DIR = path.join(os.homedir(), '.config', 'higgsfield');

export const STATE_FILE = process.env.HIGGS_STATE_FILE
  || path.join(HF_DIR, 'state.json');

export const PROFILE_DIR = process.env.HIGGS_PROFILE_DIR
  || path.join(HF_DIR, 'playwright-profile');

export const API = 'https://fnf.higgsfield.ai';

function hasStateFile() { return fs.existsSync(STATE_FILE); }

// Returns { browser, context } in state-file mode, or { context } only in
// persistent-profile mode. Caller should use the returned `closer` to clean up.
//
// HIGGS_CDP_URL — if set, ALL other modes are bypassed and we connect to an
// already-running Chrome via CDP. Use this when DataDome has flagged your
// automated session but your real browser still works:
//
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --user-data-dir=$HOME/chrome-cdp
//   # navigate to higgsfield.ai/ai/image, sign in
//   HIGGS_CDP_URL=http://localhost:9222 node src/index.mjs whoami
//
// In CDP mode we reuse the FIRST existing context (not a new one) so we
// inherit the trusted cookies the user has already accumulated.
export async function openContext({ headless = true, mode } = {}) {
  fs.mkdirSync(HF_DIR, { recursive: true });

  // ── CDP mode (highest priority) ───────────────────────────────────────────
  if (process.env.HIGGS_CDP_URL) {
    const browser = await chromium.connectOverCDP(process.env.HIGGS_CDP_URL);
    const ctxs = browser.contexts();
    const context = ctxs.length ? ctxs[0] : await browser.newContext();
    // Stealth init script, in case the existing context didn't get one
    await context.addInitScript(() => {
      try { window.__rawFetch ||= window.fetch.bind(window); } catch {}
    });
    return {
      context, mode: 'cdp',
      // Don't close the user's browser; just disconnect.
      async close() { try { await browser.close(); } catch {} },
    };
  }

  // Auto-pick: prefer state file if it exists, otherwise persistent dir.
  const resolvedMode = mode || (hasStateFile() ? 'state' : 'profile');

  // DataDome's bot fingerprinting trips on plain headless Chromium —
  // navigator.webdriver, missing chrome.runtime, suspicious UA, etc. These
  // flags + UA patch make the headless instance look like a regular Chrome.
  const launchOpts = {
    headless,
    channel: 'chrome',     // use installed Chrome if available; fingerprint matches
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  };
  // If Chrome isn't installed, fall back to bundled chromium silently.
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    delete launchOpts.channel;
    browser = await chromium.launch(launchOpts);
  }

  if (resolvedMode === 'state') {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      storageState: hasStateFile() ? STATE_FILE : undefined,
    });
    // Hide automation tells AND stash the unwrapped fetch before any page
    // script loads — Higgsfield wraps window.fetch via Sentry/soul.js and
    // those wrappers throw "Failed to fetch" in headless. We use __rawFetch
    // inside page.evaluate to bypass them while keeping the page's cookies +
    // Cloudflare clearance + the real browser fingerprint.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.__rawFetch = window.fetch.bind(window);
    });
    return {
      context, mode: 'state',
      async close(persistState = true) {
        try {
          if (persistState) {
            const state = await context.storageState();
            fs.writeFileSync(STATE_FILE, JSON.stringify(state));
          }
        } catch {}
        await context.close();
        await browser.close();
      },
    };
  }

  // Persistent profile mode (legacy)
  await browser.close();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...launchOpts,
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.__rawFetch = window.fetch.bind(window);
  });
  return {
    context, mode: 'profile',
    async close() { await context.close(); },
  };
}

export async function ensureLoggedIn(page, { land = 'video' } = {}) {
  // Land on /ai/image when image realm flows are coming, /ai/video otherwise.
  // Clerk hydration is faster on the page that the user actually wants to use,
  // and the datadome cookie matches that surface.
  const url = land === 'image'
    ? 'https://higgsfield.ai/ai/image?model=nano-banana-pro'
    : 'https://higgsfield.ai/ai/video';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => !!window.Clerk?.session);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// JSON fetch via the page's UNWRAPPED fetch (window.__rawFetch, stashed by
// addInitScript before any page JS loads). Using the page-level fetch keeps
// cookies, Cloudflare clearance, TLS fingerprint, etc. all matching the live
// session. Skipping the wrappers avoids the "Failed to fetch" they throw in
// headless contexts.
export async function apiFetch(page, { method = 'GET', path: p, body } = {}) {
  const result = await page.evaluate(async ({ method, p, body }) => {
    const sess = window.Clerk?.session;
    if (!sess) return { status: 0, body: { error: 'not_signed_in' } };
    const jwt = await sess.getToken();
    const dd = (document.cookie.match(/datadome=([^;]+)/) || [])[1];
    const headers = {
      'Authorization': 'Bearer ' + jwt,
      'x-datadome-clientid': dd || '',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Use the unwrapped fetch (stashed by addInitScript) — Higgsfield's Sentry
    // / soul.js wrappers throw "Failed to fetch" in headless contexts.
    const f = window.__rawFetch || window.fetch;
    const url = 'https://fnf.higgsfield.ai' + p;
    try {
      const r = await f(url, {
        method, credentials: 'include', headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const txt = await r.text();
      let parsed; try { parsed = JSON.parse(txt); } catch { parsed = txt; }
      return { status: r.status, body: parsed };
    } catch (e) {
      return { status: -1, body: { error: 'fetch_threw', message: String(e?.message || e) } };
    }
  }, { method, p, body });

  // Detect DataDome / Cloudflare HTML challenges and surface a clear error.
  if (result.status === 403 && typeof result.body === 'string'
      && /captcha-delivery|cf-chl|Just a moment/i.test(result.body)) {
    return {
      status: 403,
      body: { error: 'datadome_or_cloudflare', detail: 'IP/session is being challenged by bot protection. Open a visible browser and solve the captcha (HIGGS_HEADED=1), or wait 15-60 min for the trust score to recover.' },
    };
  }
  return result;
}
