// Videollamada con la asistente: clips verticales tipo selfie (Google Flow) que parten y terminan en la misma pose,
// así que se pueden encadenar y repetir sin saltos. Estados de fondo (se repiten): escucha, piensa, habla.
// Gestos de una vez (vuelven solos al estado de fondo): saludo, celebra, despide.

const FADE = 120;
const FILES = { escucha: "escucha.mp4", piensa: "piensa.mp4", habla: "habla.mp4", saludo: "saludo.mp4", celebra: "celebra.mp4", despide: "despide.mp4" };
const ONCE = new Set(["saludo", "celebra", "despide"]);

export function createVideoCall(box, base = "videollamada/") {
  const vids = {};
  for (const [k, f] of Object.entries(FILES)) {
    const v = document.createElement("video");
    v.src = base + f + "?v=5";
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.preload = "auto";
    v.setAttribute("aria-hidden", "true");
    v.dataset.k = k;
    box.append(v);
    vids[k] = v;
  }
  let cur = null, fondo = "escucha", layer = 1, alive = false, onceDone = null;

  function show(k) {
    const next = vids[k], prev = cur;
    if (next === prev && !ONCE.has(k)) return;
    cur = next;
    next.loop = !ONCE.has(k);
    // Los gestos parten del inicio; los de fondo (hablar, escuchar) siguen donde quedaron, para que la boca reaccione al tiro.
    if (ONCE.has(k)) { try { next.currentTime = 0; } catch {} }
    const ready = () => {
      next.style.zIndex = String(++layer);
      next.classList.add("on");
      if (prev && prev !== next) setTimeout(() => { if (cur !== prev) { prev.classList.remove("on"); prev.pause(); } }, FADE + 40);
    };
    next.play().then(ready).catch(ready);
  }
  // Al terminar un gesto, vuelve al estado de fondo (todos los clips terminan en la misma pose).
  Object.entries(vids).forEach(([k, v]) => {
    if (!ONCE.has(k)) return;
    v.addEventListener("ended", () => {
      if (v !== cur) return;
      const f = onceDone; onceDone = null;
      if (f) return f();
      if (alive) show(fondo);
    });
  });
  const enGesto = () => cur && ONCE.has(cur.dataset.k) && !cur.ended;
  function setFondo(k) {
    fondo = k;
    if (!alive) return;
    // Si está hablando, corta el gesto; si no, deja que el gesto termine y después pasa al fondo.
    if (k === "habla" || !enGesto()) show(k);
  }

  return {
    start() {
      alive = true; fondo = "escucha"; onceDone = null;
      Object.values(vids).forEach((v) => { v.classList.remove("on"); v.pause(); });
      cur = null;
      show("saludo");
    },
    listen: () => setFondo("escucha"),
    think: () => setFondo("piensa"),
    talk: (on) => setFondo(on ? "habla" : "escucha"),
    celebrate() { if (alive && fondo !== "habla" && !enGesto()) show("celebra"); },
    // Se despide y avisa cuando terminó (máximo 3,5 s para no hacer esperar).
    bye() {
      return new Promise((res) => {
        if (!alive) return res();
        alive = false;
        let listo = false;
        const fin = () => { if (!listo) { listo = true; res(); } };
        onceDone = fin;
        show("despide");
        setTimeout(fin, 3500);
      });
    },
    stop() { alive = false; onceDone = null; Object.values(vids).forEach((v) => { v.pause(); v.classList.remove("on"); }); cur = null; },
  };
}
