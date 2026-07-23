// Submit a job and poll until done.

import fs from 'node:fs';
import path from 'node:path';
import { apiFetch } from './auth.mjs';

const TERMINAL = new Set(['completed', 'finished', 'failed', 'error', 'success', 'done', 'cancelled']);

// ── HARD CREDIT GUARD ────────────────────────────────────────────────────────
// Policy: a failed generation is tolerable, spending credits is NOT. Every
// submit must be use_unlim:true. If a submit ever returns a non-zero cost, or
// the wallet balance drops across it, a persistent kill-switch (.credit-lock)
// trips and blocks ALL further submissions until a human deletes it.
// Escape hatch for deliberate paid runs: HIGGS_ALLOW_CREDITS=1.
const CREDIT_LOCK = process.env.HIGGS_CREDIT_LOCK_FILE || path.join(process.cwd(), '.credit-lock');
const creditsAllowed = () => process.env.HIGGS_ALLOW_CREDITS === '1';

function tripCreditLock(reason, detail) {
  const msg = `[CREDIT GUARD] ${reason}\n${detail || ''}\ntripped_at=${new Date().toISOString()}\n` +
    `All submissions are BLOCKED until this file is deleted: ${CREDIT_LOCK}\n`;
  try { fs.writeFileSync(CREDIT_LOCK, msg); } catch {}
  const err = new Error(msg); err.creditGuard = true; throw err;
}

function assertSubmitAllowed(body) {
  if (creditsAllowed()) return;
  if (fs.existsSync(CREDIT_LOCK)) {
    const info = (() => { try { return fs.readFileSync(CREDIT_LOCK, 'utf8'); } catch { return ''; } })();
    const err = new Error(`[CREDIT GUARD] kill switch is tripped — refusing to submit.\n${info}`);
    err.creditGuard = true; throw err;
  }
  if (body?.use_unlim !== true || body?.params?.use_unlim === false) {
    const err = new Error('[CREDIT GUARD] refusing to submit: use_unlim !== true. ' +
      'This job would charge credits. Set HIGGS_ALLOW_CREDITS=1 only for a deliberate paid run.');
    err.creditGuard = true; throw err;
  }
}

async function walletBalances(page) {
  try {
    const w = (await apiFetch(page, { method: 'GET', path: '/workspaces/wallet' })).body || {};
    return { sub: w.subscription_balance ?? null, credits: w.credits_balance ?? null };
  } catch { return null; }
}

// Wrap a submit with pre-flight assertion + post-flight cost/wallet check.
async function guardedSubmit(page, doSubmit, body, label) {
  assertSubmitAllowed(body);
  const before = creditsAllowed() ? null : await walletBalances(page);
  const r = await doSubmit();
  if (!creditsAllowed() && r?.status >= 200 && r?.status < 300) {
    const cost = r.body?.job_sets?.[0]?.cost ?? r.body?.cost ?? null;
    if (typeof cost === 'number' && cost > 0) tripCreditLock(`submit ${label} returned cost=${cost} (> 0)`, JSON.stringify(r.body).slice(0, 500));
    const after = await walletBalances(page);
    if (before && after && ((before.sub != null && after.sub != null && after.sub < before.sub) ||
        (before.credits != null && after.credits != null && after.credits < before.credits))) {
      tripCreditLock(`wallet dropped across submit ${label}: sub ${before.sub}→${after.sub}, credits ${before.credits}→${after.credits}`);
    }
  }
  return r;
}

// Convert a snake_case job_set_type (e.g. "nano_banana_2") to its kebab-case URL
// slug used by the image realm (e.g. "nano-banana-2"). Numbers stay as digits;
// underscores become hyphens.
export function toKebabSlug(s) {
  return String(s).replace(/_/g, '-');
}

// Video realm: POST /jobs/v2/{snake_case}
export async function submitJob(page, jobSetType, body) {
  return guardedSubmit(page, () => apiFetch(page, { method: 'POST', path: `/jobs/v2/${jobSetType}`, body }), body, `video:${jobSetType}`);
}

// Image realm: POST /jobs/{kebab-case}
// Different endpoint, different body conventions:
//   - resolution is lowercase (e.g. "1k", not "1K")
//   - use_unlim:true must appear at BOTH top-level AND inside params
//   - use_seedream_bonus instead of use_free_gens
//   - no `model` field inside params
export async function submitImageJob(page, jobSetType, body) {
  const slug = toKebabSlug(jobSetType);
  return guardedSubmit(page, () => apiFetch(page, { method: 'POST', path: `/jobs/${slug}`, body }), body, `image:${slug}`);
}

// pollJob — poll /jobs/{id} until terminal status.
//
//   initialDelayMs : sleep BEFORE the first poll. Useful for slow models
//                    where polling at second 0 just burns API requests.
//                    e.g. Seedance video typically needs ≥60-90s before
//                    anything is ready.
//   intervalMs     : sleep between subsequent polls.
//   maxIters       : max polls AFTER the initial delay.
//   onTick         : called with { iter, ...job } after each poll.
//
// onTick still receives a `waiting` event at iter -1 if there is an initial
// delay, so the UI can show a meaningful state during the first wait.
export async function pollJob(page, jobId, {
  initialDelayMs = 0,
  intervalMs = 2500,
  maxIters = 240,
  onTick,
} = {}) {
  if (initialDelayMs > 0) {
    if (onTick) onTick({ iter: -1, status: `waiting (first poll in ${Math.round(initialDelayMs/1000)}s)` });
    await new Promise(res => setTimeout(res, initialDelayMs));
  }
  let last = null;
  for (let i = 0; i < maxIters; i++) {
    const r = await apiFetch(page, { method: 'GET', path: `/jobs/${jobId}` });
    last = r.body;
    if (onTick) onTick({ iter: i, ...last });
    const s = String(last?.status || '').toLowerCase();
    if (TERMINAL.has(s)) return { iters: i, terminal: s, body: last };
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return { timeout: true, body: last };
}

export async function getWallet(page) {
  const r = await apiFetch(page, { method: 'GET', path: '/workspaces/wallet' });
  return r.body;
}

export async function getUser(page) {
  const r = await apiFetch(page, { method: 'GET', path: '/user' });
  return r.body;
}
