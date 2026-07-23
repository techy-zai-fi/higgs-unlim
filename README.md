# higgs-unlim

CLI for [Higgsfield AI](https://higgsfield.ai) video / image generation that **honors your workspace's Unlimited entitlement** and supports **start / end frame inputs and inline `<<<image_N>>>` tagging**.

The official `@higgsfield/cli` talks to a different API surface (`/agents/*`) that ignores `use_unlim:true` and bills against a separate, much smaller credit pool. This script talks to the same `/jobs/v2/*` endpoints the web app uses and rides your real workspace subscription — verified end-to-end on a team plan with `has_flex_unlim:true`.

```text
$ higgs-unlim gen seedance1_5 --prompt "the guy saying hi" --duration 8 --res 480p --audio
wallet before: { sub: 509087, credits: 0 }
submitting:    seedance1_5 use_unlim: true medias: []
job id:        97f9e65d-59bb-4318-8c39-34fc5941b92c
  iter 39 status=completed
video:         https://d8j0ntlcm91z4.cloudfront.net/.../97f9e65d-….mp4
wallet after:  { sub: 509087, credits: 0 }
diff:          { sub: 0, credits: 0 }      ← zero cost on Unlimited
```

---

## Table of contents

1. [Status & verification](#status--verification)
2. [⚠️ The web UI's "Generate" billing trap](#-the-web-uis-generate-billing-trap)
3. [Quickstart (video)](#quickstart-video)
4. [Quickstart (image)](#quickstart-image)
5. [Why this exists](#why-this-exists)
6. [Commands](#commands)
7. [Video vs image realms](#video-vs-image-realms)
8. [`gen` options (video)](#gen-options-video)
9. [`image` options](#image-options)
10. [Image inputs (video realm)](#image-inputs)
11. [Per-model schema](#per-model-schema)
12. [Job set types](#job-set-types)
13. [API reference](#api-reference)
14. [How it works](#how-it-works)
15. [Architecture](#architecture)
16. [Troubleshooting](#troubleshooting)
17. [FAQ](#faq)
18. [Limits & disclaimers](#limits--disclaimers)

---

## Status & verification

| Capability                                           | Status      | Evidence (job id)                            |
| ---------------------------------------------------- | ----------- | -------------------------------------------- |
| `seedance1_5` text-to-video, 480p, audio, unlimited  | ✅ verified | `97f9e65d-59bb-4318-8c39-34fc5941b92c`        |
| `seedance1_5` start + end image, 720p, unlimited     | ✅ verified | `5b11f7df-1c10-4af3-8819-3c0d69da1079`        |
| `seedance1_5` `<<<image_1>>>` / `<<<image_2>>>` inline tagging | ✅ verified | `5b11f7df-1c10-4af3-8819-3c0d69da1079` |
| Wallet diff = 0 with `use_unlim:true`                | ✅ verified | wallet 509087 → 509087 (twice in a row)       |
| Wallet diff > 0 with `use_unlim:false` (web default) | ✅ observed | 8,000 credits charged on a single 1080p Seedance 2.0 click |
| `seedance1_5` `medias` cap                           | ✅ verified | server returns `422 too_long` at 3 items     |
| Three-step media upload (`/media/batch` → S3 → confirm) | ✅ verified | media id `963ede9e-a75f-4d5a-9869-da266044f651` |
| `seedance_2_0` text-to-video, 720p/1080p, unlimited  | ✅ verified | 200 + real job, wallet 180000→180000; **this is the working unlimited video model** (`seedance_unlimited` now 403s) — see 2026-07 update |
| `seedance_unlimited` job type                        | ❌ removed  | returns `403 unlimited_generation_not_allowed`; use `seedance_2_0` |
| Profile-mode POST on Linux (on-demand, no always-on Chrome) | ✅ verified | `da897712-…` created + cancelled, wallet unchanged |
| Credit guard (`.credit-lock` kill-switch, `use_unlim` enforcement) | ✅ built-in | blocks any non-unlim submit before the network; verified live |
| Kling / Veo / Sora / Wan models                      | ⚠️ unverified | should work — same `/jobs/v2/{type}` shape, but each model has its own param schema |
| Nano Banana Pro image realm slug = `nano-banana-2`   | ✅ verified | server returns `405` for `nano-banana-pro`, `403` (DataDome) for `nano-banana-2` — the latter is the real route |
| Image realm body shape (`use_unlim` doubled, `use_seedream_bonus`, lowercase `1k`) | ✅ verified | request 574 captured from live web Generate click, body printed in the README |
| Image submission via API end-to-end                  | ⚠️ pending  | DataDome challenge interrupted the test mid-session; the script's headless profile (separate from the test browser) shouldn't trip it |

Workspace tested: `f113ce73-37cd-4be0-98ea-4331b1fd2b49` (Ahoum design team plan), `has_flex_unlim:true`.

---

## ⚠️ The web UI's "Generate" billing trap

**The Generate button on higgsfield.ai/ai/video does NOT default to Unlimited mode.** Look at the button before clicking:

| Button label              | Meaning                                              |
| ------------------------- | ---------------------------------------------------- |
| `Generate ⚡ <number>`    | **Charges credits.** Number = cost of this single job. |
| `Generate ⚡ Unlimited`   | Free under your entitlement.                         |

In our tests, a single Seedance 2.0 1080p click with the toggle off cost **8,000 credits** (~½ day's worth on a small plan). The toggle that flips this is somewhere in the form's secondary controls — find it before you click. **This script always sends `use_unlim:true` by default** so you can't make this mistake from the CLI; pass `--no-unlim` to opt out.

---

## 2026-07 update — auth modes, the submit-path reality, and the credit guard

A long verification session (fresh IP, one clean submit+cancel per config) nailed down
exactly what works. Read this before anything else — it corrects a couple of older
assumptions in this README.

### The one correction that matters: use `seedance_2_0`, not `seedance_unlimited`

The `seedance_unlimited` job type now returns **`403 unlimited_generation_not_allowed`**.
The Unlimited entitlement is only honoured through the **web-app's own submission shape**:

```
POST /jobs/v2/seedance_2_0
{
  "params": { "model": "seedance_2_0", "mode": "std", "batch_size": 1,
              "duration": 15, "aspect_ratio": "9:16", "resolution": "720p",
              "width": 720, "height": 1280, "generate_audio": false,
              "bitrate_mode": "high", "prompt": "…", "medias": [] },
  "use_unlim": true, "use_free_gens": false
}
```

Verified live: **200, cost `null`, wallet unchanged** — a real job created. `width`/`height`
are required. (`seedance_2` is not a valid type; `seedance_2_0`, `seedance_2_0_fast`,
`seedance_2_0_mini` are.)

### Auth modes — pick one via env

| Mode | How to select | Needs a browser? | Use when |
| --- | --- | --- | --- |
| **CDP** (real Chrome) | `HIGGS_CDP_URL=http://localhost:9222` | Yes — a persistent real Chrome you already signed into | The most reliable for POSTs. A long-lived session that has cleared bot-protection once keeps working. |
| **State file** | `HIGGS_STATE_FILE=./state.json` (default) | Launches a headless/headed Chromium seeded from cookies | Portable, but **cookies-only can't POST** (see below) — fine for GETs. |
| **Profile** | `HIGGS_PROFILE_DIR=/path/to/chrome-profile` (no CDP/state) | Launches Chrome on a full user-data-dir | On-demand alternative to an always-on CDP Chrome. **This works for POSTs on Linux** (carries device-trust). |
| **Token** | `HIGGS_TOKEN=<bearer>` (+ `HIGGS_DATADOME`, `HIGGS_CF_BM`) | No — pure `fetch()` | GETs / Clerk only. **Cannot POST jobs** — Cloudflare's managed challenge fingerprints Node's TLS. |
| `HIGGS_HEADED=1` | modifier on state/profile | forces a visible window | to solve a captcha by hand once |

### What actually clears bot protection (the submit-path map)

The video **POST** (`fnf.higgsfield.ai/jobs`) sits behind **two** independent layers —
Cloudflare's managed challenge (checks TLS/JA3 fingerprint) **and** DataDome (scores the
live session/fingerprint, not just cookies). GETs (`whoami`, wallet, `/user`) are ungated;
only the POST is. Results, all on a fresh IP, same instant:

| Path | Result |
| --- | --- |
| **CDP — real persistent Chrome** | ✅ 200 |
| **Profile mode (full profile) on Linux** | ✅ login restores + GETs 200; POST works (may need a one-time captcha, see below) |
| Headless / headed with **cookies-only** `state.json` | ❌ 403 DataDome (fingerprint) |
| **Token / Node `fetch`** (browserless) | ❌ 403 Cloudflare "Just a moment" (JA3 fingerprint) |

Takeaways:
- **Browserless auth is fine, browserless *submit* is not.** You can mint a fresh Clerk JWT
  with no browser (POST the long-lived `__client` cookie to
  `clerk.higgsfield.ai/v1/client/sessions/{sid}/tokens`), but the job POST needs a real
  browser fingerprint.
- **Cookies-only isn't enough for a fresh session** — Playwright `storageState` captures
  `origins: 0` (no localStorage/IndexedDB), which is where DataDome/Clerk device-trust
  lives. Profile mode carries the full profile, so it restores login and submits.
- **macOS can't test profile mode** (cookies are Keychain-encrypted + Playwright uses
  `--use-mock-keychain`). Linux profiles are portable — test/deploy there.

### The captcha is periodic, not per-request

A profile-mode POST sometimes returns a **DataDome interactive captcha** (an HTML page
whose body contains `#cmsg`) — solve it **once** in a visible browser (`HIGGS_HEADED=1`,
or a noVNC view of the headed Chrome) and the session clears; subsequent POSTs go straight
through until DataDome next challenges. It does **not** captcha every request. A cleared
CDP session that stays alive is why the always-on CDP setup "just works".

### Credit guard (built in)

`src/jobs.mjs` now routes every submit through `guardedSubmit()`:
- refuses any body where `use_unlim !== true` **before** it hits the network,
- verifies `cost` is 0/null and the wallet didn't drop **after** an accepted submit,
- trips a persistent **`.credit-lock`** file that blocks *all* further submissions if
  credits were ever charged (delete the file to reset).

Deliberate paid runs require `HIGGS_ALLOW_CREDITS=1`. This makes "spend credits by
accident" impossible from the CLI — failure is tolerable, a charge is not.

### Verified Unlimited entitlement matrix (Max plan)

The "top models" (Seedance 2.0 Fast/Mini, Kling 3.0, Nano Banana Pro/2, GPT Image 2,
Seedream 5 Pro, …) are **excluded** from Unlimited mode. What *is* covered:

| Model | 480p | 720p | 1080p | 4K |
| --- | --- | --- | --- | --- |
| `seedance_2_0` (video) | 4–15s | 4–15s | **4–8s only** | ✗ |
| `seedance_2_0_mini` (video) | 4–15s | 4–15s | ✗ | ✗ |
| Image (365-unlimited roster) | `nano_banana` (plain), `seedream_v5_lite`, `seedream_v4_5`, Kling O1 Image, GPT Image, Flux.2 Pro (1K) | | | |

Bitrate does not gate the entitlement (verified at `bitrate_mode:"high"`). Probe method:
submit `use_unlim:true` and instantly cancel (`PUT /jobs/{id}/cancel`) — 200 = covered,
403 = would charge.

---

## Quickstart (video)

Requires **Node 18+** and a Higgsfield account with the Unlimited entitlement (`has_flex_unlim:true` or `has_unlim:true` on `/user`). Tested on macOS / Linux.

```bash
git clone git@github.com:techy-zai-fi/higgs-unlim.git
cd higgs-unlim
npm install                                 # also runs `playwright install chromium`

node src/index.mjs login                    # opens a real browser, sign in once
node src/index.mjs whoami                   # confirm session + entitlements
```

```bash
# 1. Plain text-to-video
node src/index.mjs gen seedance1_5 \
  --prompt "the guy saying hi" --duration 8 --res 480p --audio

# 2. Start-frame conditioned (auto-uploads the local file)
node src/index.mjs gen seedance1_5 \
  --prompt "slow dolly forward" --duration 4 --res 720p \
  --width 1280 --height 720 \
  --start-image ./first.png

# 3. Start + end frame morph with inline image tagging in the prompt
node src/index.mjs gen seedance1_5 \
  --prompt "monkey meditates in <<<image_1>>> and walks left into <<<image_2>>>" \
  --duration 8 --res 720p --ar 3:4 --width 720 --height 960 --audio \
  --start-image ./scene_a.png --end-image ./scene_b.png

# 4. Pure first-last-frame morph on Kling (no inline tags needed)
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 --res 720p \
  --start-image ./first.png --end-image ./last.png
```

Every run prints the wallet diff at the end, so you always see whether unlimited was honored.

### Quickstart (image)

```bash
# Text-to-image — Nano Banana Pro (UI label) = job_set_type "nano_banana_2"
node src/index.mjs image nano_banana_2 \
  --prompt "minimalist line art ahoum logo, white background, vector style" \
  --ar 1:1 --res 1k --width 1024 --height 1024 --batch 1

# Image-to-image — auto-uploads ./ref.png and adds it to params.input_images[]
node src/index.mjs image nano_banana_2 \
  --prompt "redraw <<<image_1>>> in cyberpunk neon style" \
  --input-image ./ref.png \
  --ar 1:1 --res 1k --width 1024 --height 1024

# Multiple inputs (composable references)
node src/index.mjs image nano_banana_2 \
  --prompt "<<<image_1>>> wearing the outfit from <<<image_2>>>" \
  --input-image ./person.png --input-image ./outfit.png \
  --ar 3:4 --res 1k --width 768 --height 1024

# Pre-uploaded inputs (faster on repeated runs)
node src/index.mjs image nano_banana_2 \
  --prompt "redraw <<<image_1>>>" \
  --input-image-id  abc-123-… \
  --input-image-url https://d2ol7oe51mr4n9.cloudfront.net/.../abc-123-….png
```

---

## Why this exists

Higgsfield runs **two parallel APIs** under the same `fnf.higgsfield.ai` host:

|                       | CLI realm                                | Web realm                                                 |
| --------------------- | ---------------------------------------- | --------------------------------------------------------- |
| URL prefix            | `/agents/*`                              | `/jobs/v2/*`, `/workspaces/*`, `/media/*`                 |
| Used by               | `@higgsfield/cli` Go binary              | higgsfield.ai web app                                     |
| Auth issuer           | `fnf-device-auth.higgsfield.ai` (device-flow, long-lived) | `clerk.higgsfield.ai` (session JWT, ~5 min, auto-refreshed) |
| Credit pool           | small "agents" balance                   | workspace `subscription_balance` (your real sub)          |
| `use_unlim:true`      | ignored                                  | **honored**                                               |
| Param validation      | strict schema; unknown fields rejected   | permissive (server-side `pydantic` 422 only when truly invalid) |
| Multi-image / tagging | not exposed                              | full support (`medias[]`, `<<<image_N>>>`, character refs) |
| Upload flow           | hidden in binary                         | `/media/batch` → presigned S3 PUT → `/media/{id}/upload`  |

The web's "Generate Unlimited" button hits `POST /jobs/v2/{job_set_type}` with `{ "use_unlim": true, ... }`. This script replicates that exactly, including auth and bot-protection headers, so you can drive video generation from a terminal at the same cost as the web UI (i.e. zero, on Unlimited plans).

---

## Commands

| Command                          | What it does                                            |
| -------------------------------- | ------------------------------------------------------- |
| `login`                          | Open a real Chromium, sign in, write cookies to `~/.config/higgsfield/state.json`. **One-time.** |
| `whoami`                         | Print user, plan, entitlements, wallet snapshot.        |
| `doctor`                         | Diagnose setup: state file, deps, Clerk session, wallet GET, jobs GET. Run this first when something breaks. |
| `upload <file> [--surface <s>]`  | Three-step upload to Higgsfield's media store. Prints `{id, url}`. |
| `gen <job_set_type> [opts]`      | Submit a **video** job — `POST /jobs/v2/{snake_case}`. Polls to done. |
| `image <job_set_type> [opts]`    | Submit an **image** job — `POST /jobs/{kebab-case}`. Different endpoint, different body shape. |

Run any command with no args for inline usage.

### Video vs image realms

Higgsfield splits the API into two job realms with different conventions:

|                       | Video (`gen`)                                  | Image (`image`)                                                          |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| URL                   | `POST /jobs/v2/{job_set_type}`                | `POST /jobs/{kebab-slug}` (script auto-converts `_` → `-`)              |
| `job_set_type` casing | snake_case (e.g. `seedance1_5`, `seedance_2_0`) | snake_case CLI input → kebab-case URL (`nano_banana_2` → `nano-banana-2`) |
| Resolution            | `"480p"`, `"720p"`, `"1080p"`                 | `"1k"`, `"2k"`, `"4k"` (lowercase!)                                      |
| Conditioning images   | `params.medias[]` with `role`                  | `params.input_images[]` (no role field)                                  |
| `use_unlim:true`      | top-level only                                 | **both top-level AND inside `params`**                                   |
| Free-tier toggle      | `use_free_gens`                                | `use_seedream_bonus`                                                     |
| Other params          | `duration`, `aspect_ratio`, `medias`, `model`  | `batch_size`, `is_storyboard`, `is_zoom_control`, no `model`             |

**UI display name → API slug** can be confusing:

| Web UI label          | API job_set_type    | URL slug              |
| --------------------- | ------------------- | --------------------- |
| Nano Banana Pro       | `nano_banana_2`     | `nano-banana-2`       |
| Nano Banana           | `nano_banana`       | `nano-banana`         |
| Nano Banana Flash     | `nano_banana_flash` | `nano-banana-flash`   |
| Seedance 2.0          | `seedance_2_0`      | (video, uses `/v2/`)  |
| Seedance 1.5 Pro      | `seedance1_5`       | (video, uses `/v2/`)  |

The "Pro" / "Flash" / "v2" naming in the UI doesn't match the API in obvious ways — `nano-banana-pro` returns 405 from the server; the actual slug is `nano-banana-2`. Verified via 405 vs 403 probe (404 = no route, 403 = route exists but DataDome blocking).

---

## `gen` options (video)

| Flag                              | Default       | Notes                                                 |
| --------------------------------- | ------------- | ----------------------------------------------------- |
| `--prompt "<text>"`               | `"test"`      | Text prompt. Can include `<<<image_N>>>` placeholders and reference UUIDs. |
| `--duration <seconds>`            | `4`           | Integer seconds. Each model has its own valid range.  |
| `--res <480p\|720p\|1080p>`       | `480p`        | Resolution tier. **Seedance 1.5 caps at 720p.**       |
| `--ar <16:9\|9:16\|1:1\|3:4\|4:3\|…>` | `16:9`    | Aspect ratio.                                         |
| `--width <px>`                    | model-default | Pixel width. **Required by Seedance 1.5** (e.g. 720 for 720p 3:4). |
| `--height <px>`                   | model-default | Pixel height. **Required by Seedance 1.5** (e.g. 960 for 720p 3:4). |
| `--audio`                         | off           | `generate_audio:true`. Honored by audio-capable models (Seedance, Veo, Sora). |
| `--fixed-lens`                    | off           | `fixed_lens:true`. Locks camera (Seedance et al.).    |
| `--seed <int>`                    | random        | For reproducible runs.                                |
| `--start-image <path>`            | —             | Local file → auto-uploaded → `medias[].role=start_image`. |
| `--start-image-id <uuid>`         | —             | Pre-uploaded media id (use with `--start-image-url`). |
| `--start-image-url <url>`         | —             | Pre-uploaded media URL.                               |
| `--end-image <path>`              | —             | Local file → auto-uploaded → `medias[].role=end_image`. |
| `--end-image-id <uuid>`           | —             | Pre-uploaded media id (use with `--end-image-url`).   |
| `--end-image-url <url>`           | —             | Pre-uploaded media URL.                               |
| `--no-unlim`                      | off           | Force `use_unlim:false` (charges credits).            |
| `--free-gens`                     | off           | `use_free_gens:true` (consumes free-gen pool first).  |
| `--extra k=v`                     | —             | Push arbitrary key into `params`. Repeatable. Booleans / ints / floats are auto-coerced. |
| `--param-extra k=v`               | —             | Push arbitrary key into the **top-level** body (next to `use_unlim`). Repeatable. |

---

## `image` options

For text-to-image / image-to-image jobs (Nano Banana Pro et al.). Distinct from `gen` because the image realm uses a different endpoint and body shape.

| Flag                              | Default       | Notes                                                 |
| --------------------------------- | ------------- | ----------------------------------------------------- |
| `--prompt "<text>"`               | `"test"`      | Prompt. Can include `<<<image_N>>>` placeholders for input images and `<<<uuid>>>` for saved character references. |
| `--ar <1:1\|3:4\|4:3\|9:16\|16:9>` | `1:1`        | Aspect ratio.                                         |
| `--res <1k\|2k\|4k>`              | `1k`          | Resolution. **Lowercase** (server validates).         |
| `--width <px>`                    | `1024`        | Pixel width.                                          |
| `--height <px>`                   | `1024`        | Pixel height.                                         |
| `--batch <N>`                     | `1`           | `batch_size` — number of variations to generate (typically 1–4). |
| `--seed <int>`                    | random        | For reproducible runs.                                |
| `--input-image <path>`            | —             | Local file → auto-uploaded → appended to `params.input_images[]`. **Repeatable.** |
| `--input-image-id <uuid>`         | —             | Pre-uploaded media id (use with `--input-image-url`). Repeatable; pair with matching `--input-image-url` in the same order. |
| `--input-image-url <url>`         | —             | Pre-uploaded media URL.                               |
| `--storyboard`                    | off           | `is_storyboard:true`. Used for multi-shot composition. |
| `--zoom-control`                  | off           | `is_zoom_control:true`. Used by `nano_banana_2_zooms`. |
| `--no-unlim`                      | off           | Force `use_unlim:false` (charges credits). Mirrors the same flag everywhere. |
| `--seedream-bonus`                | off           | `use_seedream_bonus:true` (image realm's free-pool toggle). |
| `--extra k=v`                     | —             | Push arbitrary key into `params`. Repeatable.         |
| `--param-extra k=v`               | —             | Push arbitrary key into the top-level body. Repeatable. |

`<<<image_N>>>` placeholders inside `--prompt` map to `params.input_images[N-1]` — same 1-based indexing convention as the video realm's `medias`.

---

## Image inputs

> This section is about **video** jobs that take conditioning images (start/end frames, references). For pure text-to-image or image-to-image with Nano Banana / Seedream / etc., see [`image` options](#image-options) above and the [Quickstart (image)](#quickstart-image).

Higgsfield video jobs accept conditioning images via the `medias` array:

```json
"medias": [
  {"role": "start_image", "data": {"id": "<uuid>", "url": "<cdn url>", "type": "media_input"}},
  {"role": "end_image",   "data": {"id": "<uuid>", "url": "<cdn url>", "type": "media_input"}}
]
```

### Local files (auto-upload)

```bash
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 \
  --start-image ./first.png \
  --end-image   ./last.png
```

Internally this runs the same three-step flow as the web UI:

1. `POST /media/batch` → reserve a media id + presigned S3 PUT URL.
2. `PUT  <presigned URL>` → upload raw file bytes directly to S3.
3. `POST /media/{id}/upload` → confirm; the server kicks off async IP / NSFW checks.

### Pre-uploaded media (faster on repeated runs)

```bash
# Upload once
node src/index.mjs upload ./first.png
# {
#   "id": "963ede9e-…",
#   "url": "https://d2ol7oe51mr4n9.cloudfront.net/user_…/963ede9e-….png",
#   "content_type": "image/png"
# }

# Reuse across many gens
node src/index.mjs gen seedance1_5 \
  --prompt "..." --duration 4 \
  --start-image-id  963ede9e-… \
  --start-image-url https://d2ol7oe51mr4n9.cloudfront.net/user_…/963ede9e-….png
```

### Inline image tagging in the prompt: `<<<image_N>>>`

The web UI's `@Image 1` / `@Image 2` mentions translate to `<<<image_N>>>` placeholders in the prompt body, where `N` is the **1-based index of the image in the `medias` array**.

```bash
node src/index.mjs gen seedance1_5 \
  --prompt "monkey is sitting in meditation in <<<image_1>>> and walks left into <<<image_2>>>" \
  --duration 8 --res 720p --ar 3:4 --width 720 --height 960 --audio \
  --start-image ./scene_a.png \
  --end-image   ./scene_b.png
```

| Placeholder       | Resolves to                                       |
| ----------------- | ------------------------------------------------- |
| `<<<image_1>>>`   | first item in `medias[]` (regardless of `role`)  |
| `<<<image_2>>>`   | second item in `medias[]`                         |
| `<<<image_N>>>`   | N-th item                                         |
| `<<<<uuid>>>>`    | a saved character / reference element by UUID. The web inserts these when you `@`-mention a saved character. |

Seedance 1.5 has no `reference_elements` parameter slot, so character UUIDs survive only as text in the prompt. Seedance 2.0 honors them more thoroughly via a server-side resolver.

---

## Per-model schema

Server-enforced caps and required fields, observed via 422 responses.

| Model                                                                    | Max `medias` | Roles                                  | Resolutions       | Required extras    |
| ------------------------------------------------------------------------ | ------------ | -------------------------------------- | ----------------- | ------------------ |
| `seedance1_5`                                                            | **2**        | `start_image`, `end_image`             | `480p`, `720p`    | `width`, `height`  |
| `seedance_2_0`                                                           | 3+           | `start_image`, `end_image`, `image`    | up to `1080p`     | —                  |
| `kling_omni_flf`, `kling_o3_flf`                                         | 2            | `start_image`, `end_image`             | varies            | —                  |
| `kling_omni_image_reference`, `kling_video_reference`, `kling_o3_image_reference` | varies | `image` (ref), sometimes `start_image` | varies            | —                  |
| `veo3`, `veo3_1`, `veo3_1_lite`                                          | 1            | `start_image`                          | model-fixed       | —                  |
| `sora2_video`                                                            | 1–2          | `start_image`, `end_image`             | model-fixed       | —                  |
| `wan2_5_video`, `wan2_6`, `wan2_7`                                       | 1–2          | `start_image`, `end_image`             | varies            | —                  |

If you blow the cap (e.g. send 3 medias to `seedance1_5`), the server returns:
```json
{"detail":[{"type":"too_long","loc":["medias"],"msg":"List should have at most 2 items after validation, not 3"}]}
```

---

## Job set types

Pulled from the web client's `/jobs/accessible` enumeration. Each model has its own quirks; consult the web UI for which params it actually respects.

| Category            | Job set types                                              | start | end  | audio |
| ------------------- | ---------------------------------------------------------- | ----- | ---- | ----- |
| Seedance            | `seedance1_5`, `seedance_2_0`                              | ✓     | ✓    | ✓     |
| Kling first-last    | `kling_omni_flf`, `kling_o3_flf`                           | ✓     | ✓    |       |
| Kling reference     | `kling_omni_image_reference`, `kling_video_reference`, `kling_o3_image_reference` | ✓ | | |
| Kling motion        | `kling2_6_motion_control`, `kling3_0_motion_control`       | ✓     |      |       |
| Kling base          | `kling`, `kling2_6`, `kling3_0`, `kling_transition`        | ✓     | ✓ (transition) |   |
| Wan                 | `wan2_2_video`, `wan2_5_video`, `wan2_6`, `wan2_7`, `wan2_2_animate*` | ✓ | | |
| Veo                 | `veo3`, `veo3_1`, `veo3_1_lite`, `veo3_fast`               | ✓     |      | ✓     |
| Sora                | `sora2_video`, `sora2_video_deflicker`, `sora2_video_upscale` | ✓ |  | ✓     |
| Cinematic           | `cinematic_studio_video`, `cinematic_studio_video_v2`, `cinematic_studio_3_0`, `cinematic_studio_video_3_5` | ✓ | | |
| Other               | `grok_video`, `grok_video_edit`, `dubbing_lipsync`, `voice_change_merge`, `concat_videos`, `viral_transform_video`, `beat_fit`, `outfit_matchcut`, `sticker_matchcut`, `happy_horse_video`, `hf_fnf_video`, `image2video`, `image2video_mix`, `minimax_hailuo` | varies | varies | varies |

(Capability columns are best-effort. If a flag isn't supported the server typically ignores it — check the web UI for ground truth.)

---

## API reference

All requests are sent from inside the persistent browser context, with these headers:

```
Authorization: Bearer <Clerk session JWT>          (5-min lifetime, auto-refreshed by Clerk SDK)
Content-Type: application/json
x-datadome-clientid: <datadome cookie value>       (DataDome bot protection)
Origin: https://higgsfield.ai
```

### `POST /jobs/v2/{job_set_type}`
Submit a job. **The endpoint we care about.**

```jsonc
// Request
{
  "params": {
    "prompt": "the guy saying hi",
    "duration": 8,
    "aspect_ratio": "16:9",
    "resolution": "480p",
    "width": 854,        // required by some models (e.g. seedance1_5)
    "height": 480,
    "generate_audio": true,
    "fixed_lens": false,
    "seed": 12345,
    "medias": [
      {"role": "start_image", "data": {"id": "...", "url": "...", "type": "media_input"}},
      {"role": "end_image",   "data": {"id": "...", "url": "...", "type": "media_input"}}
    ],
    "model": "seedance1_5"
  },
  "use_unlim": true,
  "use_free_gens": false
}

// Response (200)
{
  "id": "<project_id>",
  "job_sets": [{
    "id": "<job_set_id>",
    "type": "seedance1_5",
    "jobs": [{ "id": "<job_id>", "status": "queued", ... }],
    ...
  }],
  "has_more": false
}
```

### `POST /jobs/{kebab-slug}` (image realm)
Submit an image-generation job. Distinct from `/jobs/v2/*` — different body shape.

```jsonc
// Request — captured live from "Nano Banana Pro" Generate click
{
  "params": {
    "prompt": "test ahoum logo",
    "input_images": [],         // optional image-to-image refs (media_input shape)
    "width": 896,
    "height": 1200,
    "batch_size": 1,
    "aspect_ratio": "3:4",
    "is_storyboard": false,
    "is_zoom_control": false,
    "use_unlim": true,          // ← duplicated inside params
    "resolution": "1k"          // ← lowercase!
  },
  "use_unlim": true,            // ← also at top level
  "use_seedream_bonus": false
}

// Response (200) — same shape as the video realm
{
  "id": "<project_id>",
  "job_sets": [{ "id":"...", "type":"nano_banana_2", "jobs":[{ "id":"...", "status":"queued" }], ... }],
  "has_more": false
}
```

### `GET /jobs/{job_id}`
Full job details + result. Poll this until `status` is terminal.

```jsonc
// Response (200, completed)
{
  "id": "<job_id>",
  "status": "completed",          // queued | in_progress | completed | failed | error
  "results": {
    "raw":  {"type":"video", "url":"https://d8j…/<file>.mp4", "thumbnail_url":"…"},
    "min":  {"type":"video", "url":"…", "thumbnail_url":"…"}
  },
  ...
}
```

### `GET /jobs/{job_id}/status`
Lightweight poll endpoint (just status field).

### `GET /workspaces/wallet`
Wallet snapshot for the active workspace.

```jsonc
{
  "workspace_id": "f113ce73-…",
  "credits_balance": 0,
  "subscription_balance": 509087,
  "wallet_created_at": "2026-05-04T10:19:16.802669Z",
  "next_credit_allocation_date": "2026-06-03T10:16:13Z",
  "total_credits": 600000
}
```

### `GET /user`
User entitlements. Check `has_flex_unlim` / `has_unlim`.

### Media upload (3 calls)

```text
POST /media/batch
  body: {"mimetypes":["image/png"], "source":"user_upload", "surface":"seedance_2", "force_ip_check":true}
  → [{ "id":"<uuid>", "url":"<cdn url>", "upload_url":"<presigned S3 PUT>", "content_type":"image/png" }]

PUT <upload_url>
  headers: { "Content-Type": "<mime>" }
  body:    raw bytes
  → 200 OK (no body)

POST /media/{id}/upload
  body: {"filename":"foo.png","force_nsfw_check":true,"force_ip_check":true,"surface":"seedance_2"}
  → { "id":"<uuid>", "status":"uploaded", "ip_check_finished":false }
```

---

## How it works

```
~/.config/higgsfield/state.json   (Playwright storageState — cookies + origins)
        │
        ▼
chromium.launch({ headless, channel: 'chrome', anti-fingerprint flags })
        │
        ▼
context.newContext({ storageState })   ← imports the cookies
        │
        ▼
context.addInitScript(...)             ← stash window.__rawFetch BEFORE page JS,
                                         hide navigator.webdriver, normalize languages
        │
        ▼
page.goto("https://higgsfield.ai/ai/video" or "/ai/image")
        │ (Clerk SDK hydrates, datadome cookie is minted, cf_clearance lands)
        ▼
page.evaluate(async () => {
   const jwt = await window.Clerk.session.getToken();          // auto-refreshed by SDK
   const dd  = document.cookie.match(/datadome=([^;]+)/)[1];   // bot-protection token
   const f   = window.__rawFetch || window.fetch;              // bypass Sentry/soul.js wrappers
   return f("https://fnf.higgsfield.ai/jobs/v2/... or /jobs/...", {
     method: "POST", credentials: "include",
     headers: { Authorization: "Bearer " + jwt, "x-datadome-clientid": dd, ... },
     body: JSON.stringify({ params, use_unlim: true, ... }),
   });
})
        │
        ▼
on close: context.storageState() → state.json   (refreshed cookies persisted)
```

By running every API call from inside `page.evaluate()`, we inherit:

1. **All cookies** the web app uses (`__client`, `__session`, `datadome`, etc.).
2. **The Clerk SDK's session machinery** — `getToken()` mints a fresh JWT each time and silently refreshes whenever the cached one is near expiry.
3. **The page's origin context** — `Origin: https://higgsfield.ai` and `Referer:` headers are filled by the browser automatically.

Outside a browser context, the Clerk JWT lifetime (5 minutes) makes a pure-curl wrapper impractical without re-implementing Clerk's session refresh dance. Headless Chromium with a persistent profile sidesteps that entirely.

---

## Architecture

```
src/
├── auth.mjs        Persistent Chromium context, ensureLoggedIn(), apiFetch()
├── upload.mjs      Three-step media upload, mediaEntry() helper
├── jobs.mjs        submitJob(), pollJob(), getWallet(), getUser()
└── index.mjs       CLI: arg parsing, login / whoami / upload / gen
```

| File          | Responsibility                                                                         |
| ------------- | -------------------------------------------------------------------------------------- |
| `auth.mjs`    | Owns the browser context. `apiFetch(page, {method, path, body})` is the only API call surface; everything else uses it. |
| `upload.mjs`  | `uploadFile(page, path)` returns `{id, url}`. `mediaEntry({role, id, url})` shapes it for `medias[]`. |
| `jobs.mjs`    | Thin wrappers around `apiFetch`. `pollJob` waits for terminal status (`completed`, `failed`, etc.). |
| `index.mjs`   | CLI plumbing only. Parses flags, calls into the modules, prints results.               |

The browser context is opened once per command and closed at the end, so commands are stateless. The persistent profile dir on disk carries auth between invocations — it's the only state that matters.

---

## Troubleshooting

**`Not signed in. Run \`higgs-unlim login\` first.`**
The state file at `~/.config/higgsfield/state.json` doesn't have a Clerk session, or the cookies expired. Run `node src/index.mjs login` — a Chromium window opens, you sign in once, the script writes a fresh `state.json` and closes. You only do this once per workstation.

**`Cannot find package 'playwright'`**
You skipped `npm install` after cloning. From the repo root:
```bash
npm install         # installs deps + runs `playwright install chromium` via postinstall
```

**Submit returns HTTP 401**
Either the profile is corrupted (rare) or higgsfield invalidated your session. Delete the profile dir and re-login:
```bash
rm -rf ~/.config/higgsfield/playwright-profile
node src/index.mjs login
```

**Wallet diff is non-zero with `use_unlim:true`**
Your account doesn't have `has_flex_unlim:true` or `has_unlim:true`. Run `whoami` to confirm. The flag flips fine on the request, but the billing layer only honors it for accounts with the entitlement.

**Submit returns HTTP 422 with `pydantic` validation errors**
The model rejected one or more params. Read the `loc` array in the response — it tells you exactly which field is wrong. Most common:
- `"loc":["medias"]` `"too_long"` → exceeded the model's `medias` cap. See [Per-model schema](#per-model-schema).
- `"loc":["width"]` / `"loc":["height"]` `"missing"` → Seedance 1.5 needs explicit `--width` and `--height`.
- `"loc":["resolution"]` → unsupported resolution tier for that model.

**Submit returns HTTP 403 with body `{"error":"datadome_or_cloudflare", ...}`**
Bot protection (DataDome or Cloudflare) is challenging the request. The script auto-detects the HTML challenge response and translates it into this clean error so you know it's a network-trust issue, not a bug in your params.

Three ways out, fastest first:

1. **Re-run with `HIGGS_HEADED=1`**: opens a visible Chromium. If a captcha appears, solve it once; the resulting cookie clears the block for ~5–60 min. The script then writes the refreshed `state.json` automatically on close.
   ```bash
   HIGGS_HEADED=1 node src/index.mjs image nano_banana_2 --prompt "..."
   ```
2. **Wait it out.** DataDome trust scores recover after 15–60 min of no activity. GETs (`whoami`, `doctor`) usually still work during this window — only the POSTs are gated. Don't keep retrying; that just resets the cooldown.
3. **Run from a residential IP.** DataDome scores datacenter / VPN IPs more harshly. If you're SSH'd into a cloud box, run the CLI from your laptop instead.

Symptom check: response body contains `geo.captcha-delivery.com` (DataDome) or `cf-chl` / `Just a moment` (Cloudflare). The JSON `{"detail":"..."}` shape is a real API rejection (different problem — see 422 / 405 below).

**Submit returns HTTP 405 `Method Not Allowed`**
The job_set_type slug doesn't exist on the server. The image realm uses kebab-case slugs that don't always match the UI label — e.g. "Nano Banana Pro" is `nano_banana_2`, not `nano_banana_pro`. See the [UI label → API slug](#video-vs-image-realms) table.

**Submit returns HTTP 503 with `{"detail":"blocked-by-test"}`**
That's a self-test artifact, not a real response — it means an old fetch interceptor is still installed in the page. Restart with a fresh `node` invocation.

**Job stuck in `in_progress` for >5 minutes**
Some models (Veo, Sora, Seedance 1.5 Pro 720p+audio) can queue 2–4 minutes before they even start rendering. The default poll cap is 240 iterations × 2.5s = 10 minutes. Increase by editing `pollJob`'s defaults in `src/jobs.mjs`.

**Override the profile location**
```bash
HIGGS_PROFILE_DIR=/path/to/profile node src/index.mjs whoami
```

---

## FAQ

**Q: Can I use this without `has_flex_unlim:true`?**
Yes — pass `--no-unlim`. The script will submit with `use_unlim:false` and credits will be deducted exactly like the web UI. You don't need Unlimited mode to use the rest of the script (start/end frames, inline tagging, etc.).

**Q: Why headless Chromium? Isn't that overkill?**
Clerk session JWTs live 5 minutes. Refreshing them outside the browser means re-implementing Clerk's full client-side state machine (`__client` cookie → `/v1/client/sessions/<id>/touch` → handle device cookies). That's fragile and breaks when Clerk updates. A persistent Chromium profile + `Clerk.session.getToken()` is one line, and it just works.

**Q: Can I run multiple commands in parallel?**
Each command opens its own browser context against the same persistent profile dir. Playwright handles concurrent reads of the profile fine, but if both write to it (e.g. cookie refresh) at the same instant you can hit a lock. For now run sequentially. PRs welcome.

**Q: How do I know if a model supports `--audio` or `--end-image`?**
Easiest: open the web UI, configure the model with those flags, click Generate, and watch the network tab — the request body tells you what fields the model accepts. Or just submit and read the 422 response.

**Q: What happens if I delete the playwright profile?**
You lose your saved login. Re-run `login`. Nothing else is stored locally — the script is stateless except for the cookies.

**Q: Is this against Higgsfield ToS?**
Probably not — you're driving the same web app you're entitled to use, just from a script. But there's no explicit blessing either. Use it on accounts you control. If Higgsfield publishes an official SDK that exposes Unlimited mode, switch to that.

---

## Limits & disclaimers

- **Not a fork or patch** of `@higgsfield/cli`. It uses an entirely different API surface.
- **Not a way to bypass billing.** It rides a workspace's existing Unlimited entitlement. On accounts without it, jobs charge credits exactly as the web UI does.
- **Not stable.** Higgsfield can change endpoint shapes, header requirements, or the Clerk integration at any time. There's no public contract for `/jobs/v2/*`. If something breaks, open the network tab on higgsfield.ai/ai/video, capture the new shape, update the script.
- **Not endorsed** by Higgsfield. If they publish an official SDK that exposes Unlimited mode, switch to that.
- **Not exhaustive.** Only `seedance1_5` and `seedance_2_0` have been verified end-to-end. Other models should work with the same pattern but may need per-model param tweaks.

---

## License

Private repo. No license granted; do not redistribute.
