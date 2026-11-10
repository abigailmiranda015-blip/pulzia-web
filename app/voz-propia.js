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
// En iPhone, si el teléfono está en modo silencio, el sonido de la página se apaga.
// "play-and-record" le dice al iPhone que es una llamada: suena por el parlante aunque esté en silencio.
function sesionLlamada(tipo) {
  try { if (navigator.audioSession) navigator.audioSession.type = tipo; } catch {}
}
export function unlockAudio() {
  sesionLlamada("play-and-record");
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
  let job = null, queue = [], playing = null, muted = false, hablo = false;
  const history = [];
  const LOUD = 0.022, QUIET = 0.012, START_MS = 160, END_MS = 750;

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

  // En iPhone, con el micrófono abierto, el reproductor normal suena casi mudo (el sistema le baja el volumen).
  // Por eso la voz se reproduce por el mismo AudioContext del micrófono, con un poco de ganancia; si falla, se usa el reproductor normal.
  const b64aBuf = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  async function sonarWebAudio(part, reserva) {
    if (!ctx || ctx.state === "closed") throw new Error("sin ctx");
    if (ctx.state !== "running") await ctx.resume();
    if (ctx.state !== "running") throw new Error("ctx suspendido");
    const buf = await ctx.decodeAudioData(b64aBuf(part.wav_b64));
    if (playing !== reserva || stopped) return; // la interrumpieron mientras se decodificaba
    const src = ctx.createBufferSource(), g = ctx.createGain();
    g.gain.value = 1.8; src.buffer = buf; src.connect(g).connect(ctx.destination);
    const h = { pause: () => { try { src.stop(); } catch {} }, play: () => Promise.resolve() };
    src.onended = () => { if (playing === h) { playing = null; playNext(); } };
    playing = h; onMode?.("speaking"); hablo = true; src.start();
  }
  function playNext() {
    // Solo mueve la boca mientras de verdad suena su voz. Si todavía falta la respuesta: "pensando";
    // si ya habló y viene la siguiente frase, queda quieta escuchando (sin mover la boca).
    if (playing || !queue.length) { if (!playing && !queue.length) onMode?.(!job ? "listening" : hablo ? "pausa" : "thinking"); return; }
    const part = queue.shift();
    playing = { pause() {}, play: () => Promise.resolve() }; // reservado mientras se decodifica
    const reserva = playing;
    onSubtitle?.(part.text);
    sonarWebAudio(part, reserva).catch(() => {
      if (playing !== reserva) return; // la interrumpieron mientras tanto
      a.src = "data:audio/wav;base64," + part.wav_b64;
      a.volume = 1;
      playing = a;
      a.onended = () => { if (playing === a) playing = null; playNext(); };
      a.onerror = () => { if (playing === a) playing = null; playNext(); };
      a.play().then(() => { if (playing === a) { onMode?.("speaking"); hablo = true; } }).catch((e) => {
        if (e?.name === "NotAllowedError") { bloqueado = true; onError?.("Toca la pantalla para escuchar a tu asistente."); }
        else { playing = null; playNext(); }
      });
    });
  }

  async function sendTurn(blob) {
    const b64 = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
    if (!b64 || stopped) return;
    hablo = false;
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
      // En iPhone, al abrir el micrófono el AudioContext creado antes queda "interrumpido":
      // si no queda corriendo, se crea uno nuevo ahora (con el micrófono abierto el iPhone sí deja encenderlo).
      ctx = ctxDesbloqueado();
      if (ctx && ctx.state !== "running") { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]); } catch {} }
      if (!ctx || ctx.state !== "running") {
        try { ctx?.close(); } catch {}
        ctx = audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]); } catch {}
      }
      if (ctx.state !== "running") onError?.("Toca la pantalla una vez para activar el sonido.");
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      onMode?.("connected");
      loop();
      const paraTono = tonoLlamada();
      await esperarServidor();
      paraTono();
      if (stopped) return;
      onMode?.("lista");
      listo = true;
      // Saludo inicial: se pide como texto para que Camila salude primero.
      // Si llamó desde un botón de acceso rápido, se responde eso de inmediato.
      if (pedido) { history.push({ role: "user", content: pedido }); sendTextTurn("(La persona te llamó desde un botón de acceso rápido y te pide: «" + pedido + "». Salúdala muy corto por su nombre y respóndele eso.)"); }
      else sendTextTurn("(La persona acaba de llamarte. Salúdala como en una llamada entre conocidas, solo con «Hola» + su nombre + «¿cómo estás?», y nada más: no preguntes todavía en qué la ayudas. Cuando te conteste cómo está o te pregunte cómo estás tú, responde «Bien, gracias. Cuéntame, ¿qué necesitas?». No digas «perfecto». Nunca te despidas si ella no se despidió.)", true);
    } catch {
      onError?.("No pude usar el micrófono.");
      end();
    }
  })();

  // Tono de llamada (425 Hz, 1 s sonando y 3 s en silencio, como en Chile) mientras el servidor despierta.
  // Además confirma que el sonido funciona: si no se escucha, hay que tocar la pantalla.
  function tonoLlamada() {
    let parar = false, t = null;
    const sonar = () => {
      if (parar || stopped || !ctx || ctx.state === "closed") return;
      try {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 425; g.gain.value = 0;
        o.connect(g).connect(ctx.destination);
        const n = ctx.currentTime;
        g.gain.setTargetAtTime(0.12, n, 0.02); g.gain.setTargetAtTime(0, n + 1, 0.02);
        o.start(n); o.stop(n + 1.2);
      } catch {}
      t = setTimeout(sonar, 4000);
    };
    sonar();
    return () => { parar = true; clearTimeout(t); };
  }

  async function sendTextTurn(text, guardar) {
    hablo = false;
    onMode?.("thinking");
    try {
      const { id } = await api("/voice/turn", { method: "POST", body: JSON.stringify({ text, history, crm, contexto: (await getContexto?.()) || undefined }) });
      // La instrucción del saludo queda en el historial para que el resto de la llamada la recuerde.
      if (guardar) history.push({ role: "user", content: text });
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
      onError?.(e.status === 402 ? "Se acabaron tus minutos de llamada de este mes." : "No pude conectar la voz (" + (e.status || "sin red") + ": " + (e.message || "error") + ").");
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
    sesionLlamada("auto");
    onEnd?.();
  }

  return { endSession: end, setMicMuted: (m) => { muted = m; } };
}
