// Source lisible du favori « 📥 Suivi immo » (la version minifiée est dans index.html).
// - Leboncoin : page de résultats ou annonce (lit __NEXT_DATA__ déjà chargé par la page).
// - Bien'ici  : page de résultats ou annonce (relit les données JSON que la page a chargées).
// - Autres sites : page d'une annonce (données structurées JSON-LD, og:image, texte de la page).
(async () => {
  const U = "https://camillequesnel.github.io/suivi-immo-ui/";
  const H = location.hostname;
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; };
  const day = (s) => (s || "").slice(0, 10);
  let ads = [];

  if (/leboncoin\.fr$/.test(H)) {
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
    ads = found.map((a) => {
      const t = {};
      (a.attributes || []).forEach((x) => { t[x.key] = x.value; t[x.key + "_l"] = x.value_label; });
      const im = a.images || {};
      return {
        src: "Leboncoin", id: String(a.list_id), t: a.subject, u: a.url,
        p: num(Array.isArray(a.price) ? a.price[0] : a.price),
        s: num(t.square), land: num(t.land_plot_surface), r: num(t.rooms), b: num(t.bedrooms),
        type: t.real_estate_type_l || null,
        dpe: (t.energy_rate || "").toUpperCase() || null, ges: (t.ges || "").toUpperCase() || null,
        city: a.location && a.location.city, zip: a.location && a.location.zipcode,
        img: (im.urls_large || im.urls || im.urls_thumb || []).slice(0, 6),
        d: (a.body || "").slice(0, 1500), date: day(a.first_publication_date),
        pro: a.owner && a.owner.type === "pro",
      };
    });
  } else if (/bienici\.com$/.test(H)) {
    const TYPES = { house: "Maison", flat: "Appartement", terrain: "Terrain", loft: "Loft", castle: "Château", townhouse: "Maison de ville" };
    const conv = (a) => ({
      src: "Bien'ici", id: "bi:" + a.id, t: a.title || [TYPES[a.propertyType], a.roomsQuantity && a.roomsQuantity + " pièces", a.city].filter(Boolean).join(" "),
      u: (() => { const l = [...document.querySelectorAll('a[href*="/annonce/"]')].find((x) => x.pathname.endsWith("/" + a.id)); return l ? l.origin + l.pathname : m ? location.origin + location.pathname : ""; })(),
      p: num(Array.isArray(a.price) ? a.price[0] : a.price), s: num(a.surfaceArea), land: num(a.landSurfaceArea),
      r: num(a.roomsQuantity), b: num(a.bedroomsQuantity), type: TYPES[a.propertyType] || a.propertyType || null,
      dpe: a.energyClassification || null, ges: a.greenhouseGazClassification || null,
      city: a.city, zip: a.postalCode, img: (a.photos || []).map((p) => p.url || p.url_photo).filter(Boolean).slice(0, 6),
      d: (a.description || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").slice(0, 1500),
      date: day(a.publicationDate), pro: !!a.adCreatedByPro, garden: !!a.hasGarden,
      year: num(a.yearOfConstruction), heat: a.heating || null,
    });
    const m = location.pathname.match(/\/annonce\/.*?([^/]+)\/?$/);
    try {
      if (m) {
        const a = await fetch("/realEstateAd.json?id=" + encodeURIComponent(decodeURIComponent(m[1]))).then((r) => r.json());
        ads = [conv(a)];
      } else {
        const res = performance.getEntriesByType("resource").map((x) => x.name).filter((n) => /\/realEstateAds\.json\?/.test(n));
        if (!res.length) return alert("Attends que les annonces soient affichées, puis reclique.");
        const j = await fetch(res[res.length - 1]).then((r) => r.json());
        ads = (j.realEstateAds || []).map(conv);
      }
    } catch (e) { return alert("Impossible de lire les données Bien'ici sur cette page."); }
  } else {
    // Autre site : une annonce à la fois.
    const ld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { [].concat(JSON.parse(s.textContent)).forEach((x) => { ld.push(x); if (x && x["@graph"]) ld.push(...x["@graph"]); }); } catch (e) { /* ignoré */ }
    });
    const meta = (n) => { const e = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return e ? e.content : null; };
    let p = null, desc = null, title = null, imgs = [];
    ld.forEach((x) => {
      if (!x || typeof x !== "object") return;
      const o = x.offers ? [].concat(x.offers)[0] : null;
      if (o && !p) p = num(o.price || (o.priceSpecification && o.priceSpecification.price));
      if (x.description && !desc) desc = String(x.description);
      if (x.name && !title) title = String(x.name);
      if (x.image) [].concat(x.image).forEach((i) => imgs.push(typeof i === "string" ? i : i && (i.url || i.contentUrl)));
    });
    if (meta("og:image")) imgs.unshift(meta("og:image"));
    [...document.images].filter((i) => i.naturalWidth >= 500 && i.naturalHeight >= 300).forEach((i) => imgs.push(i.currentSrc || i.src));
    const txt = document.body.innerText;
    const rx = (r) => { const m = txt.match(r); return m ? num(m[1]) : null; };
    p = p || num(meta("product:price:amount")) || rx(/(\d{2,3}[\s  .]\d{3})\s*€/);
    const dpe = (txt.match(/(?:DPE|classe [ée]nerg[ée]tique|[ée]tiquette [ée]nergie)\s*:?\s*\b([A-G])\b/i) || [])[1];
    ads = [{
      src: H.replace(/^www\./, ""), id: "u:" + H.replace(/^www\./, "") + location.pathname.replace(/\/$/, ""),
      t: title || meta("og:title") || document.title, u: location.origin + location.pathname, p,
      s: rx(/surface[^\d\n]{0,25}(\d{2,3}(?:[.,]\d+)?)\s*m/i) || rx(/(\d{2,3}(?:[.,]\d+)?)\s*m(?:²|2)\b/),
      land: rx(/terrain[^\d\n]{0,25}(\d[\d\s  .]{1,7})\s*m/i), r: rx(/(\d{1,2})\s*pi[eè]ces?/i), b: rx(/(\d{1,2})\s*chambres?/i),
      dpe: dpe ? dpe.toUpperCase() : null, img: [...new Set(imgs.filter((u) => /^https:\/\//.test(u || "")))].slice(0, 6),
      d: (desc || meta("og:description") || meta("description") || "").slice(0, 1500),
    }];
  }

  if (!ads.length) return alert("Aucune annonce trouvée sur cette page.");
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(ads)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.open(U + "#lbc=" + b64, "suiviimmo");
})();
