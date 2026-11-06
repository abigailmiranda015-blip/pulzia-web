// La tele de la oficina y la ficha de abajo durante la llamada.
// Lee del CRM conectado (hoy monday) lo que está pendiente o hay que revisar, agrupado por etapa.
// Solo lectura: no cambia nada en el CRM.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const nice = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

// Cada tablero de ventas es una etapa (p. ej. Adjudicados → Para cotizar → Seguimiento).
// Pendiente = lo que no está terminado según su estado. Vencido = una fecha de próximo paso ya pasó.
export async function cargarPendientes(apiCall) {
  // El servidor aplica lo que el usuario eligió en «Lo que sabe tu asistente» (tableros y columnas).
  const d = await apiCall("/pendientes");
  return resumen(d.etapas || []);
}

function resumen(etapas) {
  const total = etapas.reduce((n, e) => n + e.items.length, 0);
  const texto = total
    ? `Hay ${total} pendientes en total.\n` +
      etapas.map((e) => {
        const v = e.items.filter((i) => i.vencido).length;
        const por = {};
        e.items.forEach((i) => i.estado && (por[i.estado] = (por[i.estado] || 0) + 1));
        const est = Object.entries(por).sort((a, z) => z[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} en "${k}"`).join(", ");
        return `- Etapa ${e.nombre}: ${e.items.length}${est ? " (" + est + ")" : ""}${v ? `, ${v} con fecha vencida` : ""}. Por ejemplo: ${e.items.slice(0, 4).map((i) => i.name + (i.vencido ? " (vencido)" : "")).join("; ")}.`;
      }).join("\n")
    : "No hay pendientes en el CRM ahora.";
  return { total, etapas, todos: etapas.flatMap((e) => e.items), texto };
}

export function buscar(datos, nombre) {
  const q = norm(nombre);
  if (!q || !datos) return null;
  const words = q.split(" ").filter((w) => w.length > 2);
  let best = null, score = 0;
  for (const it of datos.todos) {
    const n = norm(it.name);
    let s = n === q ? 100 : n.includes(q) ? 60 : 0;
    s += words.filter((w) => n.includes(w)).length * 10;
    if (s > score) { score = s; best = it; }
  }
  return score >= 10 ? best : null;
}

// Tele: va dentro de la escena de 960×540, encima de la pantalla del video donde Camila explica.
export function pintarTele(el, datos, etapa) {
  let etapas = datos?.etapas || [];
  if (etapa) {
    const q = norm(etapa);
    const f = etapas.filter((e) => norm(e.nombre).includes(q) || q.includes(norm(e.nombre)));
    if (f.length) etapas = f;
  }
  const total = etapas.reduce((n, e) => n + e.items.length, 0);
  const vis = etapas.slice(0, 4);
  el.innerHTML = `
    <div class="tv-head"><span>Pendientes por etapa</span><b>${total}</b></div>
    <div class="tv-grid n${vis.length || 1}">${
      vis.length
        ? vis.map((e, i) => `
      <div class="tv-card c${i}">
        <div class="tv-et"><span>${esc(e.nombre)}</span><b>${e.items.length}</b></div>
        ${e.items.slice(0, 2).map((it) => `<div class="tv-it${it.vencido ? " late" : ""}">${esc(it.name)}</div>`).join("")}
        ${e.items.length > 2 ? `<div class="tv-more">y ${e.items.length - 2} más</div>` : ""}
      </div>`).join("")
        : `<div class="tv-card c0"><div class="tv-et"><span>Todo al día</span><b>0</b></div></div>`
    }</div>
    ${etapas.length > 4 ? `<div class="tv-foot">y ${etapas.length - 4} etapas más</div>` : ""}`;
}

export function pintarFicha(el, it) {
  const campos = it.campos.filter(([k]) => norm(k) !== "name").slice(0, 10);
  el.innerHTML = `
    <button class="fx" type="button" aria-label="Cerrar ficha">×</button>
    <div class="fk">${esc(it.etapa)}${it.estado ? " · " + esc(it.estado) : ""}${it.vencido ? ' · <span class="late">fecha vencida</span>' : ""}</div>
    <h3>${esc(it.name)}</h3>
    <dl>${campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("") || "<div><dd>Sin más datos.</dd></div>"}</dl>`;
}

export function textoFicha(it) {
  return `${it.name} — etapa ${it.etapa}${it.estado ? ", estado " + it.estado : ""}${it.vencido ? ", tiene una fecha vencida" : ""}.\n` + it.campos.slice(0, 14).map(([k, v]) => `${k}: ${v}`).join("\n");
}
