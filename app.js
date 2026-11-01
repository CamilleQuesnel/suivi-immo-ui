"use strict";
const $ = (s) => document.querySelector(s);
const API = "https://api.github.com/repos/";
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
};
let state = null, tab = "sel";
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

async function load() {
  say("Chargement…");
  try {
    state = (await readFile("data/state.json")).data;
    say("");
    render();
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

function card(l) {
  const first = l.history && l.history[0] ? l.history[0].p : null;
  const delta = first && l.price && first !== l.price ? (l.price / first - 1) * 100 : null;
  const badges = el("div", { className: "badges" });
  if (l.status === "blocked") badges.append(badge("site protégé : vérifie à la main", "wa"));
  if (l.status === "gone") badges.append(badge("disparue", "ko"));
  if (delta !== null) badges.append(badge((delta > 0 ? "+" : "") + delta.toFixed(1) + " % depuis le suivi", delta < 0 ? "ok" : "ko"));
  badges.append(badge(l.garden ? "jardin" : "jardin ?", l.garden ? "ok" : "wa"), badge(l.garage ? "garage" : "garage ?", l.garage ? "ok" : "wa"));
  if (l.dvf) badges.append(badge((l.dvf.ecart_pct > 0 ? "+" : "") + l.dvf.ecart_pct + " % vs ventes réelles (≈ " + eur(l.dvf.estimation) + ")", l.dvf.ecart_pct > 10 ? "ko" : l.dvf.ecart_pct < -5 ? "ok" : ""));
  const pm2 = l.price && l.surface ? Math.round(l.price / l.surface).toLocaleString("fr-FR") + " €/m²" : null;
  const meta = [l.city, l.surface ? Math.round(l.surface) + " m²" : null, l.beds ? l.beds + " ch." : null, pm2, l.source, "suivie depuis le " + l.added].filter(Boolean).join(" · ");
  const actions = el("div", { className: "actions" });
  if (l.starred) actions.append(act("☆ Retirer de ma sélection", "unstar", l));
  else actions.append(act("⭐ Suivre", "star", l), act("Ignorer", "ignore", l));
  actions.append(act("🗑", "remove", l, "Supprimer définitivement cette annonce du suivi ?"), spark(l.history || []));
  return el("div", { className: "card" + (l.status === "gone" ? " gone" : "") },
    el("div", { className: "top" },
      el("a", { href: safeHref(l.url), target: "_blank", rel: "noopener noreferrer", textContent: l.title || l.url }),
      el("span", { className: "price", textContent: eur(l.price) })),
    el("div", { className: "meta", textContent: meta }), badges, actions);
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
$("#btn-save").onclick = () => {
  const repo = $("#in-repo").value.trim(), token = $("#in-token").value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || token.length < 20) return alert("Dépôt (pseudo/nom) et jeton requis.");
  store.set("repo", repo); store.set("token", token); $("#in-token").value = ""; load();
};
$("#btn-forget").onclick = () => { store.del("repo"); store.del("token"); state = null; $("#app").hidden = true; showSetup(); };
function showSetup() { $("#app").hidden = true; $("#setup").hidden = false; $("#in-repo").value = store.get("repo"); }

if (store.get("repo") && store.get("token")) load(); else showSetup();
