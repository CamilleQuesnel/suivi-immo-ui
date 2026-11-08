"use strict";
const $ = (s) => document.querySelector(s);
const API = "https://api.github.com/repos/";
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
};
let state = null, tab = "sel";
let lbc = {}, lbcSha = null, importNew = []; // détails des annonces (data/lbc.json : Leboncoin, Bien'ici, autres sites), remplis via le favori « 📥 Suivi immo »
const pending = { remove: new Set(), ignore: new Set(), star: new Set(), unstar: new Set() };

const eur = (v) => (v ? Math.round(v).toLocaleString("fr-FR") + " €" : "—");
const say = (t, err) => { const m = $("#msg"); m.textContent = t || ""; m.className = err ? "err" : ""; };

function headers() {
  return { Authorization: "Bearer " + store.get("token"), Accept: "application/vnd.github+json" };
}
function b64enc(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }
function b64dec(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0))); }

async function readFile(path) {
  const r = await fetch(API + store.get("repo") + "/contents/" + path + "?t=" + Date.now(), { headers: headers(), cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 404 ? "Jeton ou dépôt invalide (" + r.status + ")" : "Erreur GitHub " + r.status);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
}

async function readOpt(path, empty) {
  try { return await readFile(path); } catch (e) { if (/\(404\)/.test(e.message)) return { sha: null, data: empty }; throw e; }
}
async function writeFile(path, sha, data, message) {
  const body = { message, content: b64enc(JSON.stringify(data) + "\n") };
  if (sha) body.sha = sha;
  return fetch(API + store.get("repo") + "/contents/" + path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
}

// --- Favori « 📥 Suivi immo » : il ouvre cette page avec #lbc=<annonces encodées> ---
// Clé d'une annonce : n° Leboncoin, "bi:<id>" pour Bien'ici, "u:<site/chemin>" pour les autres sites.
const isLbc = (u) => /leboncoin\.fr\//.test(u || "");
function lbcId(u) {
  let m = /leboncoin\.fr\/.*?(\d{9,12})/.exec(u || ""); if (m) return m[1];
  m = /bienici\.com\/annonce\/(?:[^?#]*\/)?([^/?#]+)/.exec(u || ""); if (m) return "bi:" + decodeURIComponent(m[1]);
  try { const x = new URL(u); return "u:" + x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, ""); } catch (e) { return null; }
}
function decodeLbc(b64) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const ads = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  if (!Array.isArray(ads)) throw new Error("format");
  return ads.filter((a) => a && /^(\d{6,14}|bi:[\w.-]{2,100}|u:[^\s]{3,400})$/.test(String(a.id))).map((a) => ({
    id: String(a.id), src: String(a.src || "").slice(0, 40), t: String(a.t || "").slice(0, 200), u: /^https:\/\/\S+$/.test(a.u || "") ? a.u : "",
    p: +a.p || null, s: +a.s || null, land: +a.land || null, r: +a.r || null, b: +a.b || null,
    type: a.type ? String(a.type).slice(0, 40) : null,
    dpe: /^[A-G]$/.test(a.dpe) ? a.dpe : null, ges: /^[A-G]$/.test(a.ges) ? a.ges : null,
    city: a.city ? String(a.city).slice(0, 80) : null, zip: a.zip ? String(a.zip).slice(0, 10) : null,
    img: (Array.isArray(a.img) ? a.img : []).filter((x) => /^https:\/\/\S+$/.test(x || "")).slice(0, 6),
    d: String(a.d || "").slice(0, 1500), date: /^\d{4}-\d\d-\d\d$/.test(a.date) ? a.date : null, pro: typeof a.pro === "boolean" ? a.pro : null,
    garden: a.garden === true, year: +a.year || null, heat: a.heat ? String(a.heat).slice(0, 60) : null,
    at: new Date().toISOString().slice(0, 10),
  }));
}
async function importLbc(b64) {
  let ads;
  try { ads = decodeLbc(b64); } catch (e) { return say("Lien du favori illisible — reclique sur le favori.", true); }
  say("Enregistrement de " + ads.length + " annonce(s)…");
  for (let i = 0; i < 3; i++) {
    const cur = await readOpt("data/lbc.json", {});
    const data = cur.data;
    ads.forEach((a) => { if (data[a.id] && a.p && data[a.id].p && data[a.id].p !== a.p) a.prev = data[a.id].p; data[a.id] = a; });
    const r = await writeFile("data/lbc.json", cur.sha, data, "Détails d'annonces (" + ads.length + ")");
    if (r.ok) {
      lbc = data; lbcSha = (await r.json()).content.sha;
      const tracked = new Set(state.listings.map((l) => lbcId(l.url)).filter(Boolean));
      const known = ads.filter((a) => tracked.has(a.id)).length;
      importNew = ads.filter((a) => !tracked.has(a.id) && a.u);
      say(ads.length + " annonce(s) enregistrée(s) avec leurs détails, dont " + known + " déjà dans ton suivi.");
      return render();
    }
    if (r.status !== 409 && r.status !== 422) return say("Écriture refusée (" + r.status + ") — le jeton a-t-il le droit « Contents : Read and write » ?", true);
  }
  say("Conflit d'écriture, reclique sur le favori.", true);
}

// Ajoute une demande dans inbox.json ; le moteur la traite à son prochain passage (≈1-2 min).
async function sendAction(kind, value) {
  for (let i = 0; i < 3; i++) {
    const { sha, data } = await readFile("data/inbox.json");
    (data[kind] = data[kind] || []).push(value);
    const r = await fetch(API + store.get("repo") + "/contents/data/inbox.json", {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ message: "Action depuis la page", sha, content: b64enc(JSON.stringify(data, null, 1) + "\n") }),
    });
    if (r.ok) return;
    if (r.status !== 409 && r.status !== 422) throw new Error("Écriture refusée (" + r.status + ") — le jeton a-t-il le droit « Contents : Read and write » ?");
  }
  throw new Error("Conflit d'écriture, réessaie.");
}

async function sendMany(kind, values) {
  for (let i = 0; i < 3; i++) {
    const { sha, data } = await readFile("data/inbox.json");
    (data[kind] = data[kind] || []).push(...values);
    const r = await writeFile("data/inbox.json", sha, data, "Ajout groupé depuis le favori");
    if (r.ok) return;
    if (r.status !== 409 && r.status !== 422) throw new Error("Écriture refusée (" + r.status + ")");
  }
  throw new Error("Conflit d'écriture, réessaie.");
}

async function load() {
  say("Chargement…");
  try {
    const [st, lb] = await Promise.all([readFile("data/state.json"), readOpt("data/lbc.json", {})]);
    state = st.data; lbc = lb.data || {}; lbcSha = lb.sha;
    say("");
    render();
    const m = /[#&]lbc=([\w-]+)/.exec(location.hash);
    if (m) { history.replaceState(null, "", location.pathname + location.search); await importLbc(m[1]); }
  } catch (e) { say(e.message, true); }
}

function safeHref(u) { return /^https:\/\//.test(u || "") ? u : "#"; }
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props || {});
  kids.flat().forEach((k) => k != null && n.append(k));
  return n;
}
function badge(text, cls) { return el("span", { className: "badge " + (cls || ""), textContent: text }); }

function spark(hist) {
  if (hist.length < 2) return null;
  const ps = hist.map((h) => h.p), lo = Math.min(...ps), hi = Math.max(...ps), W = 80, H = 24;
  const pts = ps.map((p, i) => (i / (ps.length - 1)) * W + "," + (hi === lo ? H / 2 : H - 3 - ((p - lo) / (hi - lo)) * (H - 6))).join(" ");
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 " + W + " " + H); s.setAttribute("width", W); s.setAttribute("height", H); s.setAttribute("class", "spark");
  const p = document.createElementNS(ns, "polyline");
  p.setAttribute("points", pts); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2");
  s.append(p);
  return s;
}

function act(label, kind, l, extra) {
  return el("button", {
    textContent: label,
    onclick: async (ev) => {
      if (extra && !confirm(extra)) return;
      ev.target.disabled = true;
      try {
        await sendAction(kind, l.id);
        pending[kind].add(l.id);
        say("Pris en compte — la mise à jour complète arrive dans 1 à 2 minutes.");
        render();
      } catch (e) { say(e.message, true); ev.target.disabled = false; }
    },
  });
}

function lbcBlock(x) {
  const box = el("div", { className: "lbc" });
  if (x.img.length) {
    const g = el("div", { className: "photos" });
    x.img.forEach((src) => g.append(el("a", { href: src, target: "_blank", rel: "noopener noreferrer" },
      el("img", { src, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }))));
    box.append(g);
  }
  if (x.d) {
    const short = x.d.length > 260 ? x.d.slice(0, 260).replace(/\s+\S*$/, "") + "…" : x.d;
    const p = el("p", { className: "desc", textContent: short });
    if (short !== x.d) {
      const more = el("button", { className: "link", textContent: "Lire la suite" });
      more.onclick = () => { p.textContent = x.d; more.remove(); };
      box.append(p, more);
    } else box.append(p);
  }
  return box;
}

function card(l) {
  const x = lbc[lbcId(l.url)];
  if (x) {
    l = { ...l };
    l.title = l.title && !/^https?:/.test(l.title) && l.status !== "blocked" ? l.title : x.t || l.title;
    l.price = l.price || x.p; l.surface = l.surface || x.s; l.beds = l.beds || x.b;
    l.city = l.city || [x.city, x.zip].filter(Boolean).join(" ");
    if (x.land || x.garden) l.garden = true;
    if (/garage/i.test(x.t + " " + x.d)) l.garage = true;
  }
  const first = l.history && l.history[0] ? l.history[0].p : null;
  const delta = first && l.price && first !== l.price ? (l.price / first - 1) * 100 : null;
  const badges = el("div", { className: "badges" });
  if (x) badges.append(badge("infos " + (x.src || "Leboncoin") + " du " + x.at.split("-").reverse().join("/"), ""));
  else if (l.status === "blocked") badges.append(badge(isLbc(l.url) ? "site protégé : clique 📥 sur la page Leboncoin" : "site protégé : vérifie à la main", "wa"));
  if (x && x.dpe) badges.append(badge("DPE " + x.dpe + (x.ges ? " · GES " + x.ges : ""), "AB".includes(x.dpe) ? "ok" : "EFG".includes(x.dpe) ? "ko" : ""));
  if (x && x.prev && x.p) badges.append(badge((x.p < x.prev ? "baisse" : "hausse") + " depuis le favori : " + eur(x.prev) + " → " + eur(x.p), x.p < x.prev ? "ok" : "ko"));
  if (l.status === "gone") badges.append(badge("disparue", "ko"));
  if (delta !== null) badges.append(badge((delta > 0 ? "+" : "") + delta.toFixed(1) + " % depuis le suivi", delta < 0 ? "ok" : "ko"));
  badges.append(badge(l.garden ? "jardin" : "jardin ?", l.garden ? "ok" : "wa"), badge(l.garage ? "garage" : "garage ?", l.garage ? "ok" : "wa"));
  if (l.dvf) badges.append(badge((l.dvf.ecart_pct > 0 ? "+" : "") + l.dvf.ecart_pct + " % vs ventes réelles (≈ " + eur(l.dvf.estimation) + ")", l.dvf.ecart_pct > 10 ? "ko" : l.dvf.ecart_pct < -5 ? "ok" : ""));
  const pm2 = l.price && l.surface ? Math.round(l.price / l.surface).toLocaleString("fr-FR") + " €/m²" : null;
  const meta = [l.city, x && x.type, l.surface ? Math.round(l.surface) + " m²" : null, x && x.land ? "terrain " + Math.round(x.land).toLocaleString("fr-FR") + " m²" : null,
    x && x.r ? x.r + " pièces" : null, l.beds ? l.beds + " ch." : null, pm2, x && x.date ? "publiée le " + x.date.split("-").reverse().join("/") : null, x && x.pro === true ? "agence" : x && x.pro === false ? "particulier" : null, x && x.year ? "construite en " + x.year : null, x && x.heat ? "chauffage " + x.heat : null, l.source, "suivie depuis le " + l.added].filter(Boolean).join(" · ");
  const actions = el("div", { className: "actions" });
  if (l.starred) actions.append(act("☆ Retirer de ma sélection", "unstar", l));
  else actions.append(act("⭐ Suivre", "star", l), act("Ignorer", "ignore", l));
  actions.append(act("🗑", "remove", l, "Supprimer définitivement cette annonce du suivi ?")); const sp = spark(l.history || []); if (sp) actions.append(sp);
  return el("div", { className: "card" + (l.status === "gone" ? " gone" : "") },
    el("div", { className: "top" },
      el("a", { href: safeHref(l.url), target: "_blank", rel: "noopener noreferrer", textContent: l.title || l.url }),
      el("span", { className: "price", textContent: eur(l.price) })),
    el("div", { className: "meta", textContent: meta }), badges, x ? lbcBlock(x) : null, actions);
}

function visible(l) {
  return !l.ignored && !pending.remove.has(l.id) && !pending.ignore.has(l.id);
}
function isStarred(l) {
  return pending.star.has(l.id) ? true : pending.unstar.has(l.id) ? false : l.starred;
}

function render() {
  $("#setup").hidden = true; $("#app").hidden = false;
  const all = state.listings.filter(visible).map((l) => ({ ...l, starred: isStarred(l) }));
  const groups = {
    sel: all.filter((l) => l.starred && l.status !== "gone"),
    new: all.filter((l) => !l.starred && l.status !== "gone"),
    gone: all.filter((l) => l.status === "gone"),
  };
  for (const k of Object.keys(groups)) $("#c-" + k).textContent = groups[k].length;
  const st = state.stats, dv = state.dvf, box = $("#stats");
  box.replaceChildren();
  const stat = (t, v) => box.append(el("div", { className: "stat" }, el("small", { textContent: t }), el("b", { textContent: v })));
  if (st) { stat("Prix médian (ma sélection)", eur(st.med)); stat("Prix moyen / m²", eur(st.m2)); stat("Baisses cumulées", eur(st.baisse_cumulee)); }
  if (dv) stat("Ventes réelles / m² (DVF)", eur(dv.median_m2_80_160));
  const imp = $("#import");
  imp.replaceChildren();
  if (importNew.length) {
    const b = el("button", { className: "primary", textContent: "Ajouter les " + importNew.length + " annonce(s) non suivie(s)" });
    b.onclick = async () => {
      b.disabled = true;
      try { await sendMany("add", importNew.map((a) => a.u)); say(importNew.length + " annonce(s) ajoutée(s) — elles apparaîtront dans « Trouvées » d'ici 1 à 2 minutes, avec leurs détails."); importNew = []; render(); }
      catch (e) { say(e.message, true); b.disabled = false; }
    };
    const no = el("button", { textContent: "Non merci", onclick: () => { importNew = []; render(); } });
    imp.append(el("p", { className: "meta", textContent: "Cette page contenait aussi des annonces que tu ne suis pas encore :" }), el("div", { className: "row" }, b, no));
  }
  const list = $("#list");
  list.replaceChildren(...groups[tab].map(card));
  if (!groups[tab].length) list.append(el("p", { className: "meta", textContent: tab === "sel" ? "Aucune annonce suivie : colle un lien ci-dessus ou ⭐ une annonce trouvée." : "Rien ici pour l'instant." }));
  $("#foot").textContent = "Dernière mise à jour des données : " + (state.last_run || "jamais");
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
}

$("#tabs").addEventListener("click", (e) => { const t = e.target.closest("button"); if (t) { tab = t.dataset.tab; render(); } });
$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#in-url").value.trim();
  if (!/^https:\/\/\S+$/.test(url)) return say("Le lien doit commencer par https://", true);
  try { await sendAction("add", url); $("#in-url").value = ""; say("Ajoutée — elle apparaîtra d'ici 1 à 2 minutes (↻ pour recharger)."); }
  catch (err) { say(err.message, true); }
});
$("#btn-refresh").onclick = () => store.get("token") ? load() : showSetup();
$("#btn-settings").onclick = showSetup;
$("#btn-back").onclick = () => (state ? render() : load());
$("#btn-save").onclick = () => {
  const repo = $("#in-repo").value.trim(), token = $("#in-token").value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || token.length < 20) return alert("Dépôt (pseudo/nom) et jeton requis.");
  store.set("repo", repo); store.set("token", token); $("#in-token").value = ""; load();
};
$("#btn-forget").onclick = () => { store.del("repo"); store.del("token"); state = null; $("#app").hidden = true; showSetup(); };
function showSetup() { $("#app").hidden = true; $("#setup").hidden = false; $("#in-repo").value = store.get("repo"); }

if (store.get("repo") && store.get("token")) load(); else showSetup();
// Si l'onglet Suivi immo est déjà ouvert, le favori ne change que le #lbc=… : on l'importe sans recharger.
window.addEventListener("hashchange", () => {
  const m = /[#&]lbc=([\w-]+)/.exec(location.hash);
  if (!m) return;
  if (!state) return load(); // load() lit et nettoie lui-même le #lbc=…
  history.replaceState(null, "", location.pathname + location.search);
  importLbc(m[1]);
});
