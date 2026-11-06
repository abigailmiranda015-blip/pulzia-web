// La tele de la oficina y la ficha de abajo durante la llamada.
// Lee del CRM conectado (hoy monday) lo que está pendiente o hay que revisar, agrupado por etapa.
// Solo lectura: no cambia nada en el CRM.

const DONE = /(listo|hecho|done|terminad|cerrad|ganad|perdid|entregad|complet|descartad|desiert|deciert|rechaz|archiv|pagad|finaliz|no aplica|acept|compr[oó] con|enviado a |derivad|lista negra)/i;
const SKIP_BOARD = /(cat[aá]logo|art[ií]culo|producto|inventario|ficha|proveedor|plantilla|template|prueba|demo|subelementos|subitems)/i;
const DUE = /(pr[oó]xim|venc|v[aá]lid|l[ií]mite|plazo|llamad|saldo|seguimiento|recordar)/i;
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const nice = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

// Cada tablero de ventas es una etapa (p. ej. Adjudicados → Para cotizar → Seguimiento).
// Pendiente = lo que no está terminado según su estado. Vencido = una fecha de próximo paso ya pasó.
export async function cargarPendientes(apiCall) {
  const q = (query) => apiCall("/crm/monday/api", { method: "POST", body: JSON.stringify({ query }) }).then((r) => {
    if (r.errors?.length && !r.data) throw new Error(r.errors[0].message || "error del CRM");
    return r.data;
  });
  const lista = await q(`query { boards(limit: 40, order_by: used_at, state: active) { id name type items_count columns { id title type } } }`);
  const cand = (lista?.boards || [])
    .filter((b) => b.type === "board" && b.items_count > 0 && b.items_count <= 800 && !SKIP_BOARD.test(b.name) && (b.columns || []).some((c) => c.type === "status"))
    .slice(0, 6);
  if (!cand.length) return resumen([]);
  const det = await q(`query { boards(ids: [${cand.map((b) => b.id).join(",")}]) { id items_page(limit: 100) { items { id name updated_at group { title } column_values { id type text } } } } }`);
  const hoy = today(), etapas = [];
  for (const b of cand) {
    const items = (det?.boards || []).find((x) => String(x.id) === String(b.id))?.items_page?.items || [];
    const cols = Object.fromEntries(b.columns.map((c) => [c.id, c]));
    const st = b.columns.filter((c) => c.type === "status");
    const main = st.find((c) => /etapa/i.test(c.title)) || st.find((c) => /^estado$/i.test(c.title.trim())) || st.find((c) => /estado|status/i.test(c.title)) || st[0];
    const estados = st.filter((c) => c === main || /^estado/i.test(c.title.trim()));
    const pend = [];
    for (const it of items) {
      const cv = Object.fromEntries((it.column_values || []).map((v) => [v.id, v]));
      if (DONE.test(it.group?.title || "") || estados.some((c) => DONE.test(cv[c.id]?.text || ""))) continue;
      if (/^(agregar elemento|nuevo elemento|new item|elemento|item|sin nombre)$/i.test((it.name || "").trim())) continue; // filas vacías de monday
      const vencido = b.columns.some((c) => c.type === "date" && DUE.test(c.title) && (cv[c.id]?.text || "9999").slice(0, 10) < hoy);
      const campos = (it.column_values || [])
        .filter((v) => v.text && !["subtasks", "board_relation", "mirror", "file", "doc", "button", "link"].includes(v.type) && v.text.length < 160)
        .map((v) => [cols[v.id]?.title || v.id, v.text]);
      pend.push({ id: it.id, name: it.name, etapa: nice(b.name), tablero: nice(b.name), estado: (main && cv[main.id]?.text) || "", vencido, updated: it.updated_at, campos });
    }
    if (!pend.length) continue;
    pend.sort((a, z) => (z.vencido - a.vencido) || String(a.updated).localeCompare(String(z.updated)));
    etapas.push({ nombre: nice(b.name), tablero: nice(b.name), items: pend });
  }
  return resumen(etapas);
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
