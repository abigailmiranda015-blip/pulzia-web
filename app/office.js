// Oficina de Camila en la llamada: videos apilados que se funden entre sí, sin cortes ni pantalla negra.
//   trabaja (sentada, ida y vuelta), habla (le habla sentada), presenta (se para y va a la tele),
//   explica (de pie junto a la tele, ida y vuelta) y vuelve (vuelve a su escritorio).
// Poses que calzan: inicio de trabaja = inicio de habla y de presenta; mitad de trabaja = fin de habla y de vuelve;
// fin de presenta = inicio/mitad/fin de explica = inicio de vuelve. Solo se cambia de video en esas poses.
// En la llamada Camila se queda en la tele hasta que se le pide volver (backToDesk).

const FADE = 550;
const FILES = { trabaja: "trabaja-pp.mp4", habla: "habla.mp4", presenta: "presenta.mp4", vuelve: "vuelve.mp4", explica: "explica-pp.mp4" };

export function createOffice(stage, base = "office/") {
  const vids = {};
  for (const [k, f] of Object.entries(FILES)) {
    const v = document.createElement("video");
    v.src = base + f;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.preload = "auto";
    v.setAttribute("aria-hidden", "true");
    v.dataset.k = k;
    stage.append(v);
    vids[k] = v;
  }
  let vid = vids.trabaja, mode = "trabaja", layer = 1, leaving = null, talking = false, wantTv = false, alive = false;
  const listeners = new Set();
  const standing = () => mode === "presenta" || mode === "explica";
  const half = (v) => (v.duration || 4.6) / 2;
  const emit = () => listeners.forEach((f) => f(mode));

  function show(m, pos) {
    const next = vids[m], prev = vid;
    mode = m; vid = next; leaving = null;
    next._end = false; next.loop = false; next.playbackRate = 1;
    try { next.currentTime = pos || 0; } catch {}
    const ready = () => {
      if (prev === next) return next.classList.add("on");
      next.style.zIndex = String(++layer);
      next.style.transition = `opacity ${FADE}ms linear`;
      next.classList.add("on");
      setTimeout(() => { if (vid !== prev) { prev.classList.remove("on"); prev.pause(); } }, FADE + 40);
    };
    next.play().then(ready).catch(ready);
    watchEnd(next);
    emit();
  }
  function exitTo(cb) {
    const v = vid;
    if (v !== vids.trabaja && v !== vids.explica) return cb();
    const D = half(v), t = v.currentTime || 0, x = t < D ? t : 2 * D - t;
    let goal;
    if (v === vids.trabaja || x < D - x) {
      if (t < D) try { v.currentTime = 2 * D - t; } catch {}
      goal = 2 * D - 0.04;
    } else {
      if (t > D) try { v.currentTime = 2 * D - t; } catch {}
      goal = D;
    }
    v.playbackRate = 1.6;
    leaving = { v, goal, cb };
    const look = () => {
      if (!leaving || leaving.v !== v) return;
      if (v.currentTime >= leaving.goal - (FADE / 1000) * v.playbackRate || v.ended) {
        const f = leaving.cb; leaving = null; v.playbackRate = 1; return f();
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }
  function watchEnd(v) {
    const look = () => {
      if (v !== vid || !alive) return;
      if (!leaving && !v._end && v.duration && v.currentTime >= v.duration - FADE / 1000) { v._end = true; return ended(v); }
      if (!v.ended) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }
  Object.values(vids).forEach((v) => v.addEventListener("ended", () => { if (v === vid && !v._end && !leaving) { v._end = true; ended(v); } }));
  function ended(v) {
    if (v !== vid || leaving || !alive) return;
    if (mode === "trabaja") {
      if (wantTv) return show("presenta", 0);
      if (talking) return show("habla", 0);
      show("trabaja", 0);
    } else if (mode === "explica" || mode === "presenta") {
      if (!wantTv) show("vuelve", 0);
      else show("explica", 0);
    } else if (mode === "habla") {
      // Al final de habla está en la pose de la mitad de trabaja.
      show("trabaja", half(vids.trabaja) - FADE / 1000);
    } else if (mode === "vuelve") show("trabaja", half(vids.trabaja) - FADE / 1000);
  }

  return {
    get mode() { return mode; },
    standing,
    onChange: (f) => listeners.add(f),
    start() {
      alive = true; talking = false; wantTv = false; leaving = null;
      Object.values(vids).forEach((v) => { v.classList.remove("on"); v.pause(); });
      vid = vids.trabaja; mode = "trabaja";
      try { vid.currentTime = 0; } catch {}
      vid.classList.add("on");
      vid.play().catch(() => {});
      watchEnd(vid);
      emit();
    },
    stop() { alive = false; leaving = null; Object.values(vids).forEach((v) => v.pause()); },
    // Se para y va a la tele.
    present() {
      wantTv = true;
      if (standing()) return;
      if (mode === "trabaja") exitTo(() => show("presenta", 0));
      // Si está hablando sentada o volviendo, va a la tele apenas llegue a la pose de trabaja.
    },
    backToDesk() {
      wantTv = false;
      if (mode === "explica") exitTo(() => show("vuelve", 0));
    },
    speaking(on) {
      talking = on;
      if (on && mode === "trabaja" && !wantTv) exitTo(() => (wantTv ? show("presenta", 0) : show("habla", 0)));
    },
  };
}
