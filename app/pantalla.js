// La tele de la oficina y la ficha de abajo durante la llamada.
// Lee del CRM conectado (hoy monday) lo que está pendiente o hay que revisar, agrupado por etapa.
// Solo lectura: no cambia nada en el CRM.

const DONE = /(listo|hecho|done|terminad|cerrad|ganad|perdid|entregad|complet|descartad|desiert|rechaz|archiv|pagad|finaliz|no aplica|deciert)/i;
const STAGE = /(etapa|estado|stage|status|fase)/i;
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export async function cargarPendientes(apiCall) {
  const query = `query { boards(limit: 10, order_by: used_at, state: active) {
    id name type items_count
    columns { id title type }
    groups { id title }
    items_page(limit: 100) { items { id name updated_at group { id title } column_values { id type text } } }
  } }`;
  const r = await apiCall("/crm/monday/api", { method: "POST", body: JSON.stringify({ query }) });
  if (r.errors?.length && !r.data) throw new Error(r.errors[0].message || "error del CRM");
  const boards = (r.data?.boards || []).filter((b) => (b.type || "board") === "board" && b.items_count > 0 && !/^(subelementos|subitems)/i.test(b.name));
  const hoy = today();
  const etapas = [];
  for (const b of boards) {
    const cols = Object.fromEntries((b.columns || []).map((c) => [c.id, c]));
    const statusCols = (b.columns || []).filter((c) => c.type === "status");
    const stageCol = statusCols.find((c) => STAGE.test(c.title)) || statusCols[0];
    const byGroups = (b.groups || []).length > 1;
    const porEtapa = new Map();
    for (const it of b.items_page?.items || []) {
      const val = (id) => (it.column_values || []).find((v) => v.id === id)?.text || "";
      const etapa = byGroups ? it.group?.title || "Sin etapa" : (stageCol && val(stageCol.id)) || it.group?.title || "Sin etapa";
      const estado = stageCol ? val(stageCol.id) : "";
      if (DONE.test(etapa) || DONE.test(estado)) continue;
      const fechas = (it.column_values || []).filter((v) => v.type === "date" && v.text).map((v) => v.text.slice(0, 10));
      const vencido = fechas.some((f) => f < hoy);
      const campos = (it.column_values || [])
        .filter((v) => v.text && v.type !== "subtasks" && v.type !== "board_relation" && v.text.length < 160)
        .map((v) => [cols[v.id]?.title || v.id, v.text]);
      if (!porEtapa.has(etapa)) porEtapa.set(etapa, []);
      porEtapa.get(etapa).push({ id: it.id, name: it.name, etapa, tablero: b.name, vencido, updated: it.updated_at, campos });
    }
    for (const [nombre, items] of porEtapa) {
      items.sort((a, z) => (z.vencido - a.vencido) || String(a.updated).localeCompare(String(z.updated)));
      etapas.push({ nombre, tablero: b.name, items });
    }
  }
  // Primero las etapas con más pendientes; como máximo 6 en la tele.
  etapas.sort((a, z) => z.items.length - a.items.length);
  const total = etapas.reduce((n, e) => n + e.items.length, 0);
  const todos = etapas.flatMap((e) => e.items);
  const varios = new Set(etapas.map((e) => e.tablero)).size > 1;
  const texto = total
    ? `Hay ${total} pendientes en total.\n` +
      etapas.slice(0, 8).map((e) => {
        const v = e.items.filter((i) => i.vencido).length;
        return `- ${e.nombre}${varios ? " (" + e.tablero + ")" : ""}: ${e.items.length}${v ? `, ${v} con fecha vencida` : ""}. Por ejemplo: ${e.items.slice(0, 4).map((i) => i.name + (i.vencido ? " (vencido)" : "")).join("; ")}.`;
      }).join("\n")
    : "No hay pendientes en el CRM ahora.";
  return { total, etapas, todos, varios, texto };
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
    <div class="fk">${esc(it.tablero)} · ${esc(it.etapa)}${it.vencido ? ' · <span class="late">fecha vencida</span>' : ""}</div>
    <h3>${esc(it.name)}</h3>
    <dl>${campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("") || "<div><dd>Sin más datos.</dd></div>"}</dl>`;
}

export function textoFicha(it) {
  return `${it.name} — tablero ${it.tablero}, etapa ${it.etapa}${it.vencido ? ", tiene una fecha vencida" : ""}.\n` + it.campos.slice(0, 14).map(([k, v]) => `${k}: ${v}`).join("\n");
}
