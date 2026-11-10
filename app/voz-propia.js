// Llamada con la voz propia de Pulzia (servidor a pedido en RunPod, a través de api.pulzia.app).
// La persona habla → se detecta cuándo empieza y cuándo termina → se manda ese trozo →
// llega lo que entendió, la respuesta y el audio frase por frase → se reproduce.
// Si la persona habla mientras Camila habla, Camila se calla (interrupción) y se corta la respuesta en curso.

export const API = "https://pulzia-api.abigailmiranda015.workers.dev";

// En celulares (sobre todo iPhone) el navegador solo deja sonar audio que se "desbloqueó" con un toque.
// Por eso se usa un único reproductor, desbloqueado en el mismo toque de «Llamar», para toda la llamada.
const SILENCIO = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
let reproductor = null, audioCtx = null;
// El AudioContext (con el que se mide si la persona está hablando) también tiene que nacer en el toque:
// en iPhone, si se crea después, queda "suspendido" y el micrófono se lee como silencio (no te escucha).
function ctxDesbloqueado() {
  try {
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.().catch(() => {});
  } catch {}
  return audioCtx;
}
export function unlockAudio() {
  ctxDesbloqueado();
  if (!reproductor) reproductor = new Audio();
  reproductor.playsInline = true;
  reproductor.src = SILENCIO;
  reproductor.play().catch(() => {});
  return reproductor;
}

export async function voiceStatus(getToken) {
  try {
    const r = await fetch(API + "/voice", { headers: { Authorization: "Bearer " + (await getToken()) } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export function startOwnVoiceCall({ getToken, crm = "ninguno", pedido, getContexto, onMode, onSubtitle, onHeard, onAccion, onError, onEnd }) {
  let stopped = false, ctx, stream, analyser, rec, chunks = [], speakingSince = 0, silentSince = 0, recording = false;
  let job = null, queue = [], playing = null, muted = false;
  const history = [];
  const LOUD = 0.035, QUIET = 0.018, START_MS = 160, END_MS = 750;

  const api = async (path, init = {}) => {
    const r = await fetch(API + path, { ...init, headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await getToken()) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "error"), { status: r.status });
    return j;
  };
  const camilaTalking = () => !!playing || queue.length > 0;
  // El servidor de voz se apaga solo cuando no se usa y tarda ~50 s en despertar: se espera a que esté listo antes de saludar y de escuchar.
  let listo = false;
  async function esperarServidor() {
    // Máximo ~75 s esperando: si el servidor no avisa que está listo, igual se saluda (el pedido queda en fila).
    const hasta = Date.now() + 75000;
    try {
      onSubtitle?.("Despertando a tu asistente, un momento…");
      onMode?.("despertando");
      const w = await api("/voice/warm", { method: "POST", body: "{}" });
      if (!w?.id) return;
      while (!stopped && Date.now() < hasta) {
        const r = await api("/voice/warm/" + w.id).catch(() => ({}));
        if (r.ready || r.done || ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(r.status)) return;
        await new Promise((ok) => setTimeout(ok, 2000));
      }
    } catch {}
  }

  const a = reproductor || unlockAudio();
  // Si el navegador igual bloquea el sonido, el próximo toque en la pantalla lo vuelve a intentar.
  let bloqueado = false;
  const reintentar = () => {
    if (ctx && ctx.state !== "running") ctx.resume?.().catch(() => {});
    if (bloqueado && playing) { bloqueado = false; playing.play().catch(() => {}); }
  };
  document.addEventListener("pointerdown", reintentar);

  function stopCamila() {
    queue = [];
    if (playing) { try { playing.pause(); } catch {} playing = null; }
    if (job) { api("/voice/cancel/" + job, { method: "POST" }).catch(() => {}); job = null; }
    onMode?.("listening");
  }

  function playNext() {
    if (playing || !queue.length) { if (!playing && !queue.length && !job) onMode?.("listening"); return; }
    const part = queue.shift();
    a.src = "data:audio/wav;base64," + part.wav_b64;
    playing = a;
    onMode?.("speaking");
    onSubtitle?.(part.text);
    a.onended = () => { if (playing === a) playing = null; playNext(); };
    a.onerror = () => { if (playing === a) playing = null; playNext(); };
    a.play().catch((e) => {
      if (e?.name === "NotAllowedError") { bloqueado = true; onError?.("Toca la pantalla para escuchar a tu asistente."); }
      else { playing = null; playNext(); }
    });
  }

  async function sendTurn(blob) {
    const b64 = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
    if (!b64 || stopped) return;
    onMode?.("thinking");
    let id;
    try { id = (await api("/voice/turn", { method: "POST", body: JSON.stringify({ audio_b64: b64, history, crm, contexto: (await getContexto?.()) || undefined }) })).id; }
    catch (e) { onMode?.("listening"); return onError?.(e.status === 402 ? "Se acabaron tus minutos de llamada de este mes." : "No pude escucharte bien, ¿me lo repites?"); }
    job = id;
    let heard = "", reply = "";
    for (let tries = 0; tries < 375 && job === id && !stopped; tries++) {
      await new Promise((r) => setTimeout(r, tries < 10 ? 250 : 400));
      let s;
      try { s = await api("/voice/stream/" + id); } catch { continue; }
      for (const it of s.items || []) {
        if (it.type === "heard") { heard = it.text; onHeard?.(heard); }
        else if (it.type === "accion") onAccion?.(it);
        else if (it.type === "reply") reply = it.text;
        else if (it.type === "audio" && job === id) { queue.push(it); playNext(); }
        else if (it.type === "done") tries = 1e9;
      }
      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(s.status)) break;
    }
    if (job === id) job = null;
    if (heard) history.push({ role: "user", content: heard });
    if (reply) history.push({ role: "assistant", content: reply });
    if (!camilaTalking()) onMode?.("listening");
  }

  function startRec() {
    chunks = [];
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => { const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" }); if (blob.size > 3000) sendTurn(blob); };
    rec.start();
    recording = true;
    onMode?.("oyendo");
  }

  function loop() {
    if (stopped) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    // Mientras Camila habla se pide más volumen para no confundir su propia voz con la de la persona.
    const loud = rms > (camilaTalking() ? LOUD * 2.2 : LOUD);
    if (!muted && listo && loud) {
      silentSince = 0;
      if (!speakingSince) speakingSince = now;
      if (!recording && now - speakingSince > START_MS) { if (camilaTalking() || job) stopCamila(); startRec(); }
    } else if (rms < QUIET || muted) {
      speakingSince = 0;
      if (recording) {
        if (!silentSince) silentSince = now;
        if (now - silentSince > END_MS) { recording = false; try { rec.stop(); } catch {} }
      }
    }
    requestAnimationFrame(loop);
  }

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      ctx = ctxDesbloqueado() || new AudioContext();
      if (ctx.state !== "running") { try { await ctx.resume(); } catch {} }
      if (ctx.state !== "running") onError?.("Toca la pantalla para que " + "te pueda escuchar.");
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      onMode?.("connected");
      loop();
      await esperarServidor();
      if (stopped) return;
      listo = true;
      // Saludo inicial: se pide como texto para que Camila salude primero.
      // Si llamó desde un botón de acceso rápido, se responde eso de inmediato.
      if (pedido) { history.push({ role: "user", content: pedido }); sendTextTurn("(La persona te llamó desde un botón de acceso rápido y te pide: «" + pedido + "». Salúdala muy corto por su nombre y respóndele eso.)"); }
      else sendTextTurn("(La persona acaba de llamarte. Salúdala corto por su nombre y pregúntale en qué la ayudas.)");
    } catch {
      onError?.("No pude usar el micrófono.");
      end();
    }
  })();

  async function sendTextTurn(text) {
    onMode?.("thinking");
    try {
      const { id } = await api("/voice/turn", { method: "POST", body: JSON.stringify({ text, history, crm, contexto: (await getContexto?.()) || undefined }) });
      job = id;
      for (let tries = 0; tries < 375 && job === id && !stopped; tries++) {
        await new Promise((r) => setTimeout(r, 400));
        const s = await api("/voice/stream/" + id).catch(() => ({}));
        for (const it of s.items || []) {
          if (it.type === "accion") onAccion?.(it);
          else if (it.type === "reply") history.push({ role: "assistant", content: it.text });
          else if (it.type === "audio" && job === id) { queue.push(it); playNext(); }
          else if (it.type === "done") tries = 1e9;
        }
      }
      if (job === id) job = null;
      if (!camilaTalking()) onMode?.("listening");
    } catch (e) {
      onError?.(e.status === 402 ? "Se acabaron tus minutos de llamada de este mes." : "El servidor de voz se está encendiendo, intenta en unos segundos.");
      onMode?.("listening");
    }
  }

  function end() {
    if (stopped) return;
    stopped = true;
    stopCamila();
    document.removeEventListener("pointerdown", reintentar);
    try { rec?.state === "recording" && rec.stop(); } catch {}
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.suspend?.().catch(() => {});
    onEnd?.();
  }

  return { endSession: end, setMicMuted: (m) => { muted = m; } };
}
