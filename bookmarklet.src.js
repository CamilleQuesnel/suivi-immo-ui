// Source lisible du favori « 📥 Suivi immo » (la version minifiée est dans index.html).
// À cliquer sur une page Leboncoin (résultats de recherche OU annonce) : récupère les
// infos que Leboncoin a déjà chargées dans la page et les envoie à la page Suivi immo.
(() => {
  const U = "https://camillequesnel.github.io/suivi-immo-ui/";
  if (!/leboncoin\.fr$/.test(location.hostname)) return alert("À utiliser sur une page leboncoin.fr");
  let d;
  try { d = JSON.parse(document.getElementById("__NEXT_DATA__").textContent); }
  catch (e) { return alert("Données Leboncoin introuvables sur cette page (recharge-la puis réessaie)."); }
  const found = [], seen = new Set();
  const walk = (o, k) => {
    if (!o || typeof o !== "object" || k > 14) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, k + 1));
    if (o.list_id && o.subject && !seen.has(o.list_id)) { seen.add(o.list_id); found.push(o); return; }
    for (const v of Object.values(o)) walk(v, k + 1);
  };
  walk(d.props, 0);
  if (!found.length) return alert("Aucune annonce trouvée sur cette page.");
  const num = (v) => { const n = parseFloat(String(v || "").replace(",", ".")); return isFinite(n) ? n : null; };
  const ads = found.map((a) => {
    const t = {};
    (a.attributes || []).forEach((x) => { t[x.key] = x.value; t[x.key + "_l"] = x.value_label; });
    const im = a.images || {};
    return {
      id: String(a.list_id), t: a.subject, u: a.url,
      p: num(Array.isArray(a.price) ? a.price[0] : a.price),
      s: num(t.square), land: num(t.land_plot_surface), r: num(t.rooms), b: num(t.bedrooms),
      type: t.real_estate_type_l || null,
      dpe: (t.energy_rate || "").toUpperCase() || null, ges: (t.ges || "").toUpperCase() || null,
      city: a.location && a.location.city, zip: a.location && a.location.zipcode,
      img: (im.urls_large || im.urls || im.urls_thumb || []).slice(0, 4),
      d: (a.body || "").slice(0, 1500),
      date: (a.first_publication_date || "").slice(0, 10),
      pro: a.owner && a.owner.type === "pro",
    };
  });
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(ads)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.open(U + "#lbc=" + b64, "suiviimmo");
})();
