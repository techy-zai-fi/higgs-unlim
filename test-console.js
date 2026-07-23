// Browser DevTools fallback: paste into the console on higgsfield.ai (signed in,
// with the "Unlimited mode" toggle ON) to submit a job straight from the real
// browser session — no CLI, no Playwright. Handy when bot-protection is blocking
// the automated paths but your logged-in tab works. Uses the current unlimited
// video model `seedance_2_0` (the old `seedance_unlimited` type now 403s).
(async () => {
  const jwt = await window.Clerk.session.getToken();
  const dd = (document.cookie.match(/datadome=([^;]+)/) || [])[1];
  const prompt = "Candid handheld phone video, warm Indian home at dusk, a woman doing a gentle stretch on a soft mat, plants around, golden light, natural skin, imperfect framing, no studio look, no AI sheen. Hinglish voiceover: Stress ho, neend chahiye, ya bas release — Ahoum ke gentle flows tumhare saath.";
  const body = {
    params: { model: "seedance_2_0", mode: "std", batch_size: 1, prompt, duration: 15, aspect_ratio: "9:16", resolution: "720p", width: 720, height: 1280, generate_audio: true, bitrate_mode: "high", medias: [] },
    use_unlim: true,
    use_free_gens: false,
  };
  const r = await fetch("https://fnf.higgsfield.ai/jobs/v2/seedance_2_0", {
    method: "POST",
    credentials: "include",
    headers: { "Authorization": "Bearer " + jwt, "Content-Type": "application/json", "x-datadome-clientid": dd || "" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log("status:", r.status);
  console.log("job id:", j?.job_sets?.[0]?.jobs?.[0]?.id);
  console.log(JSON.stringify(j, null, 2));
})();
