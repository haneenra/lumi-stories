(function () {
  "use strict";

  const W = 210, H = 86, GH = 62, GX = 40, GY = 150, PAD = 70;
  const NS = "http://www.w3.org/2000/svg";
  const ENDINGS = {
    happy:   { label: "نهاية سعيدة",   icon: "😊" },
    lesson:  { label: "نهاية فيها درس", icon: "💡" },
    sad:     { label: "نهاية حزينة",   icon: "😢" },
    neutral: { label: "نهاية مفتوحة",  icon: "🌙" },
  };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ekey = (a, b) => a + ">" + b;
  const AR = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

  const state = {
    story: null, L: null,
    mode: "map",          // hall | map | play
    selected: null,       // node id
    focusEnding: null,    // ending id highlighted from list
    play: [],             // node ids visited in play mode
    page: 0,              // page inside the current scene (play mode)
    view: { x: 0, y: 0, k: 1 },
    els: { nodes: {}, edges: {}, labels: {} },
  };

  /* ---------------- layout ---------------- */
  function kindOf(story, id) {
    const n = story.nodes[id];
    if (n.ending) return ENDINGS[n.ending] ? n.ending : "neutral";
    if (id === story.start) return "start";
    return "choice";
  }

  function layout(story) {
    const children = {}, parent = {}, depth = {}, visited = new Set();
    const treeEdges = [], extraEdges = [], missing = [], endings = [], ghosts = {};

    (function build(id, d) {
      visited.add(id); depth[id] = d; children[id] = [];
      const n = story.nodes[id];
      if (n.ending) endings.push(id);
      (n.choices || []).forEach((c) => {
        if (!story.nodes[c.to]) { missing.push(`"${id}" → "${c.to}"`); return; }
        if (visited.has(c.to)) {
          const g = "~" + ekey(id, c.to);
          extraEdges.push({ from: id, to: c.to, choice: c, ghost: g });
          ghosts[g] = c.to; depth[g] = d + 1; children[g] = [];
          treeEdges.push({ from: id, to: g, real: c.to, choice: c });
          children[id].push(g);
          return;
        }
        treeEdges.push({ from: id, to: c.to, choice: c });
        parent[c.to] = { from: id, choice: c };
        children[id].push(c.to);
        build(c.to, d + 1);
      });
    })(story.start, 0);

    const sw = {};
    (function width(id) {
      const k = children[id];
      sw[id] = k.length ? k.reduce((s, c) => s + width(c), 0) + GX * (k.length - 1) : W;
      sw[id] = Math.max(sw[id], W);
      return sw[id];
    })(story.start);

    const pos = {};
    let maxDepth = 0;
    (function place(id, left) {
      const k = children[id];
      const inner = k.reduce((s, c) => s + sw[c], 0) + GX * Math.max(0, k.length - 1);
      let cur = left + (sw[id] - inner) / 2;
      k.forEach((c) => { place(c, cur); cur += sw[c] + GX; });
      pos[id] = { x: left + sw[id] / 2, y: PAD + depth[id] * (H + GY) };
      maxDepth = Math.max(maxDepth, depth[id]);
    })(story.start, PAD);

    const width = sw[story.start] + PAD * 2;
    // mirror horizontally so the first choice sits on the right (RTL reading)
    Object.values(pos).forEach((p) => (p.x = width - p.x));
    // flip vertically: the story starts at the bottom and grows upward like a tree
    Object.values(pos).forEach((p) => (p.y = 2 * PAD + maxDepth * (H + GY) - p.y));

    const unreachable = Object.keys(story.nodes).filter((id) => !visited.has(id));
    const deadEnds = [...visited].filter((id) => !story.nodes[id].ending && !(story.nodes[id].choices || []).length);
    return {
      pos, parent, children, depth, treeEdges, ghosts, extraEdges, endings, missing, unreachable, deadEnds,
      width, height: PAD * 2 + maxDepth * (H + GY) + H,
      decisions: [...visited].filter((id) => (story.nodes[id].choices || []).length > 1).length,
      scenes: visited.size,
    };
  }

  function pathTo(id) {
    const nodes = [id]; let cur = id;
    while (state.L.parent[cur]) { cur = state.L.parent[cur].from; nodes.unshift(cur); }
    return nodes;
  }
  function choiceBetween(a, b) {
    return (state.story.nodes[a].choices || []).find((c) => c.to === b);
  }

  /* ---------------- tree rendering ---------------- */
  function renderTree() {
    const { story, L } = state;
    const stage = $("#stage");
    stage.innerHTML = "";
    stage.style.width = L.width + "px";
    stage.style.height = L.height + "px";
    state.els = { nodes: {}, edges: {}, labels: {}, edgeTo: {} };

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", L.width); svg.setAttribute("height", L.height);
    stage.appendChild(svg);

    const addPath = (d, cls) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d); p.setAttribute("class", cls);
      svg.appendChild(p); return p;
    };
    L.treeEdges.forEach((e) => {
      const a = L.pos[e.from], b = L.pos[e.to];
      const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y + H, my = (y1 + y2) / 2;
      const key = ekey(e.from, e.real || e.to);
      state.els.edgeTo[key] = e.to;
      state.els.edges[key] = addPath(`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, "edge");
      const lab = document.createElement("div");
      lab.className = "edge-label";
      lab.textContent = e.choice.label;
      lab.style.left = x2 + "px"; lab.style.top = y2 + GY * 0.38 + "px";
      stage.appendChild(lab);
      state.els.labels[key] = lab;
    });
    // dashed connector from each "continues at" marker to the real scene
    L.extraEdges.forEach((e) => {
      const g = L.pos[e.ghost], t = L.pos[e.to], dir = t.x > g.x ? 1 : -1;
      const x1 = g.x + dir * W / 2, y1 = g.y + H - GH / 2, x2 = t.x - dir * W / 2, y2 = t.y + H / 2;
      const d = `M${x1},${y1} C${x1 + dir * 80},${y1} ${x2 - dir * 80},${y2} ${x2},${y2}`;
      state.els.edges[e.ghost] = addPath(d, "edge extra");
      state.els.edgeTo[e.ghost] = e.ghost;
    });

    let endNo = 0;
    const order = Object.keys(L.pos).sort((a, b) => L.depth[a] - L.depth[b] || L.pos[b].x - L.pos[a].x);
    order.forEach((id) => {
      if (L.ghosts[id]) {
        const t = L.ghosts[id], p = L.pos[id], el = document.createElement("div");
        el.className = "node ghost";
        el.style.left = p.x - W / 2 + "px"; el.style.top = p.y + H - GH + "px";
        el.style.width = W + "px"; el.style.height = GH + "px";
        el.innerHTML = `<div class="n-meta">🔀 يكمل في مشهد:</div><div class="n-title">${esc(story.nodes[t].title)}</div>`;
        el.addEventListener("click", () => { if (!drag.moved) selectNode(t); });
        stage.appendChild(el);
        state.els.nodes[id] = el;
        return;
      }
      const n = story.nodes[id], kind = kindOf(story, id), p = L.pos[id];
      const el = document.createElement("div");
      el.className = "node " + kind;
      el.style.left = p.x - W / 2 + "px"; el.style.top = p.y + "px";
      el.style.width = W + "px"; el.style.height = H + "px";
      let meta, num = "";
      if (n.ending) {
        endNo = L.endings.indexOf(id) + 1;
        num = `<span class="n-num">نهاية ${endNo}</span>`;
        meta = `${ENDINGS[kind].icon} ${ENDINGS[kind].label}`;
      } else if (kind === "start") {
        num = `<span class="n-num">البداية</span>`;
        meta = (n.choices || []).length > 1 ? `◆ ${(n.choices || []).length} اختيارات` : "⟶ يكمل";
      } else {
        meta = (n.choices || []).length > 1 ? `◆ ${(n.choices || []).length} اختيارات` : "⟶ يكمل";
      }
      if (n.tag) meta += ` · ${esc(n.tag)}`;
      const more = (n.choices || []).length ? `<span class="n-more">▲ اضغط لتشوف الاختيارات</span>` : "";
      el.innerHTML = `${num}${more}<div class="n-title">${esc(n.title)}</div><div class="n-meta">${meta}</div>`;
      el.addEventListener("click", () => { if (!drag.moved) selectNode(id); });
      stage.appendChild(el);
      state.els.nodes[id] = el;
      n._endNo = n.ending ? endNo : null;
    });
  }

  function applyHighlight() {
    const { els } = state;
    let pathNodes = null;
    if (state.mode === "play") pathNodes = state.play;
    else if (state.focusEnding) pathNodes = pathTo(state.focusEnding);
    else if (state.selected) pathNodes = pathTo(state.selected);

    const onN = new Set(pathNodes || []);
    const onE = new Set();
    if (pathNodes) for (let i = 1; i < pathNodes.length; i++) onE.add(ekey(pathNodes[i - 1], pathNodes[i]));
    const hasPath = !!pathNodes && pathNodes.length > 0;

    const V = new Set(state.mode === "play" ? state.play : state.revealed);
    Object.keys(state.L.ghosts).forEach((g) => { if (onE.has(g.slice(1))) { onN.add(g); onE.add(g); V.add(g); } });
    state.visible = V;
    const C = state.L.children;
    Object.entries(els.nodes).forEach(([id, el]) => {
      el.classList.toggle("hidden", !V.has(id));
      el.classList.toggle("collapsed", state.mode === "map" && (C[id] || []).some((c) => !V.has(c)));
      el.classList.toggle("on", onN.has(id));
      el.classList.toggle("dim", hasPath && !onN.has(id) && state.mode === "play");
      el.classList.toggle("selected", state.mode === "map" && state.selected === id);
      el.classList.toggle("current", state.mode === "play" && id === pathNodes[pathNodes.length - 1]);
    });
    [els.edges, els.labels].forEach((group) =>
      Object.entries(group).forEach(([k, el]) => {
        el.classList.toggle("hidden", !V.has(els.edgeTo[k]));
        el.classList.toggle("on", onE.has(k));
        const fromSel = state.mode === "map" && state.selected && (k.startsWith(state.selected + ">") || k.startsWith("~" + state.selected + ">"));
        el.classList.toggle("dim", hasPath && !onE.has(k) && !fromSel);
      })
    );
  }

  /* ---------------- pan & zoom ---------------- */
  const drag = { active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
  function applyView() {
    const v = state.view;
    $("#stage").style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
  }
  function fit(smooth) {
    if (state.mode !== "map") return; // الخريطة مخفية بالبهو وبالقراءة
    const vp = $("#viewport").getBoundingClientRect(), L = state.L, M = 70, TOP = 44;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    (state.visible || new Set([state.story.start])).forEach((id) => {
      const p = L.pos[id]; if (!p) return;
      x0 = Math.min(x0, p.x - W / 2); x1 = Math.max(x1, p.x + W / 2);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + H);
    });
    x0 -= M; x1 += M; y0 -= M; y1 += M;
    const k = Math.min(vp.width / (x1 - x0), (vp.height - TOP) / (y1 - y0), 1);
    state.view = { k, x: (vp.width - (x0 + x1) * k) / 2, y: TOP + (vp.height - TOP - (y0 + y1) * k) / 2 };
    const st = $("#stage");
    if (smooth) { st.style.transition = "transform .45s ease"; setTimeout(() => (st.style.transition = ""), 460); }
    applyView();
  }
  function zoomAt(factor, mx, my) {
    const v = state.view, nk = Math.min(2.2, Math.max(0.15, v.k * factor));
    v.x = mx - (mx - v.x) * (nk / v.k); v.y = my - (my - v.y) * (nk / v.k); v.k = nk;
    applyView();
  }
  function centerOn(id, smooth) {
    const vp = $("#viewport").getBoundingClientRect(), p = state.L.pos[id], v = state.view;
    v.x = vp.width / 2 - p.x * v.k; v.y = vp.height / 2 - (p.y + H / 2) * v.k;
    const st = $("#stage");
    if (smooth) { st.style.transition = "transform .45s ease"; setTimeout(() => (st.style.transition = ""), 460); }
    applyView();
  }
  function bindViewport() {
    const vp = $("#viewport");
    vp.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    vp.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".zoom")) return;
      Object.assign(drag, { active: true, moved: false, sx: e.clientX, sy: e.clientY, ox: state.view.x, oy: state.view.y });
    });
    window.addEventListener("pointermove", (e) => {
      if (!drag.active) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; vp.classList.add("dragging");
      state.view.x = drag.ox + dx; state.view.y = drag.oy + dy; applyView();
    });
    window.addEventListener("pointerup", () => {
      drag.active = false; vp.classList.remove("dragging");
      setTimeout(() => (drag.moved = false), 0);
    });
    vp.addEventListener("click", (e) => {
      if (drag.moved || e.target.closest(".node, .zoom")) return;
      if (state.mode === "map") { state.selected = null; state.focusEnding = null; renderPanel(); applyHighlight(); }
    });
    const mid = () => { const r = vp.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    $("#zoomIn").onclick = () => zoomAt(1.25, ...mid());
    $("#zoomOut").onclick = () => zoomAt(0.8, ...mid());
    $("#zoomFit").onclick = () => fit(true);
  }

  /* ---------------- panel ---------------- */
  // صح ولا غلط: السعيدة والمفتوحة صح، والي فيها درس والحزينة غلط. أي نهاية بتقدر تغيّرها بـ verdict: "right" | "wrong".
  const isRight = (n) => (n.verdict ? n.verdict === "right" : n.ending === "happy" || n.ending === "neutral");
  const verdictTag = (n) => (isRight(n) ? "✅ صح" : "❌ غلط");
  function endingBadge(n) {
    const k = ENDINGS[n.ending] ? n.ending : "neutral";
    return `<span class="badge c-${k}">${ENDINGS[k].icon} ${ENDINGS[k].label}</span> <span class="badge v-${isRight(n) ? "right" : "wrong"}">${verdictTag(n)}</span>`;
  }

  function pathStepsHTML(nodes) {
    const s = state.story;
    return `<ol class="path-steps">${nodes.map((id, i) => {
      const n = s.nodes[id];
      const next = nodes[i + 1];
      const c = next ? choiceBetween(id, next) : null;
      return `<li><button class="link" data-go="${esc(id)}">${esc(n.title)}</button>${c ? `<br><span class="pick">↙ ${esc(c.label)}</span>` : ""}</li>`;
    }).join("")}</ol>`;
  }

  function renderOverview() {
    const { story, L } = state;
    const counts = {};
    L.endings.forEach((id) => { const k = kindOf(story, id); counts[k] = (counts[k] || 0) + 1; });
    const warnings = [
      ...L.missing.map((m) => `اختيار يشير لمشهد غير موجود: ${esc(m)}`),
      ...L.unreachable.map((id) => `مشهد لا يمكن الوصول إليه: "${esc(id)}"`),
      ...L.deadEnds.map((id) => `مشهد بدون اختيارات وليس نهاية: "${esc(id)}"`),
    ];
    return `
      <h1>${esc(story.title)}</h1>
      ${story.age ? `<div class="muted">العمر: ${esc(story.age)}</div>` : ""}
      <p style="margin-top:10px">${esc(story.summary || "")}</p>
      ${story.notes ? `<div class="lesson-box" style="white-space:pre-line"><b>📝 ملاحظة للعرض</b>${esc(story.notes)}</div>` : ""}
      <div class="stats">
        <div class="stat"><b>${L.scenes}</b><span>مشهد</span></div>
        <div class="stat"><b>${L.decisions}</b><span>لحظة اختيار</span></div>
        <div class="stat"><b>${L.endings.length}</b><span>نهاية</span></div>
      </div>
      <div class="row">
        <button class="btn primary" data-act="play">▶️ عيش القصة من البداية</button>
        <button class="btn" data-act="all">🌳 اكشف كل الشجرة</button>
        <button class="btn" data-act="collapse">⟲ خبّي الفروع</button>
      </div>
      <h2>كل النهايات — اضغط على نهاية لترى الطريق إليها</h2>
      <div class="ending-list">
        ${L.endings.map((id) => {
          const n = story.nodes[id], k = kindOf(story, id);
          return `<button class="ending-item c-${k}${state.focusEnding === id ? " active" : ""}" data-ending="${esc(id)}">
            <b>${verdictTag(n)} · نهاية ${n._endNo}: ${esc(n.title)}</b>
            <small>${pathTo(id).length - 1} خطوات · ${esc(n.lesson || ENDINGS[k].label)}</small>
          </button>`;
        }).join("")}
      </div>
      ${state.focusEnding ? `<h2>الطريق إلى هذه النهاية</h2>${pathStepsHTML(pathTo(state.focusEnding))}` : ""}
      ${warnings.length ? `<div class="warn"><b>تنبيهات في بيانات القصة:</b><br>${warnings.join("<br>")}</div>` : ""}
      <p class="muted" style="margin-top:18px;font-size:13px">القصة بتبدأ من تحت وبتطلع لفوق. اضغط على أي مشهد عشان تقرأه وتطلع الاختيارات الي بعده. اسحب الخريطة للتحريك، واستخدم عجلة الماوس للتكبير.</p>
    `;
  }

  function renderNode(id) {
    const { story, L } = state, n = story.nodes[id], k = kindOf(story, id);
    const p = pathTo(id);
    const incoming = L.extraEdges.filter((e) => e.to === id);
    return `
      <button class="link" data-act="overview">→ نظرة عامة على القصة</button>
      <h2>${k === "start" ? "البداية" : n.ending ? `نهاية ${n._endNo}` : `مشهد · الخطوة ${p.length}`}</h2>
      <h1>${esc(n.title)}</h1>
      ${n.tag ? `<div class="muted" style="margin-bottom:6px">${esc(n.tag)}</div>` : ""}
      ${n.ending ? endingBadge(n) : ""}
      <p class="scene-text" style="margin-top:12px">${esc(n.text || "")}</p>
      ${n.ending && n.lesson ? `<div class="lesson-box"><b>💡 القيمة / الدرس</b>${esc(n.lesson)}</div>` : ""}
      ${(n.choices || []).length ? `<h2>${esc(n.question || (n.choices.length > 1 ? "الاختيارات من هنا" : "يكمل إلى"))}</h2>
        <div class="choice-btns">${n.choices.map((c) =>
          `<button class="choice-btn" data-go="${esc(c.to)}">${esc(c.label)} <span class="muted">← ${esc(story.nodes[c.to]?.title || "؟")}</span></button>`).join("")}</div>` : ""}
      ${p.length > 1 ? `<h2>كيف نصل إلى هنا</h2>${pathStepsHTML(p)}` : ""}
      ${incoming.length ? `<div class="lesson-box"><b>🔀 يمكن الوصول لهذا المشهد أيضًا من:</b>${incoming.map((e) =>
        `<div>• <button class="link" data-go="${esc(e.from)}">${esc(story.nodes[e.from].title)}</button> — «${esc(e.choice.label)}»</div>`).join("")}</div>` : ""}
    `;
  }

  /* ---------------- reader (عيش القصة) ---------------- */
  // الشخصيات المعروفة. كل قصة بتقدر تضيف شخصياتها بـ cast.
  const CAST = {
    "لومي":  { icon: "🦊", color: "#fdecdc" },
    "الطفل": { icon: "🧒", color: "#fff3cf", label: "أنت", me: true },
  };
  const castOf = () => Object.assign({}, CAST, state.story.cast || {});
  const nameRe = {};
  // الاسم بعد «إلى/من/عن…» أو بعد اسم متل «معصم الطفل» هو مفعول، مش الي بيحكي.
  const NOT_SUBJECT = /(^|\s)(إلى|الى|على|عن|من|مع|بجانب|جانب|حول|نحو|أمام|خلف|معصم|فانوس|يد|وجه|ل)\s*$/;
  function findName(str, cast) {
    let best = null, at = Infinity;
    Object.keys(cast).forEach((nm) => {
      const re = nameRe[nm] || (nameRe[nm] = new RegExp(`(^|[\\s،.«(])${nm}(?=$|[\\s،.:؟!»)])`, "g"));
      re.lastIndex = 0; let m;
      while ((m = re.exec(str))) {
        if (NOT_SUBJECT.test(str.slice(0, m.index + m[1].length))) continue;
        if (m.index < at) { at = m.index; best = nm; }
        break;
      }
    });
    return best;
  }

  // بيقسم نص المشهد لأسطر: سرد، أو كلام شخصية (يبدأ بـ «).
  function parseScene(text, cast) {
    const items = []; let pending = null, note = "", prev = null;
    String(text || "").split("\n").forEach((raw) => {
      const line = raw.trim();
      if (!line) { items.push({ type: "gap" }); return; }
      if (line.startsWith("«")) {
        const fixed = (state.story.speakers || []).find(([q]) => line.includes(q));
        if (fixed) { prev = { type: "say", text: line, who: fixed[1] || null, note }; items.push(prev); pending = null; note = ""; return; }
        const tail = line.slice(line.lastIndexOf("»") + 1);
        const self = (line.match(/أنا\s+([^\s.،!؟»]+)/) || [])[1];
        const who = pending || findName(tail, cast)
          || (prev && prev.type === "line" ? findName(prev.text, cast) : null)
          || (self && cast[self] ? self : null);
        prev = { type: "say", text: line, who, note };
        items.push(prev); pending = null; note = "";
        return;
      }
      if (line.endsWith(":")) {
        // بس الجملة الأخيرة: «اقترب الطفل من الباب. سمع صوتًا بعيدًا:» مش الطفل الي بيحكي
        const who = findName(line.slice(line.lastIndexOf(".") + 1), cast);
        if (who) {
          pending = who;
          if (line.length <= 24) { // «قال ريشو:» بنخفيها، والاسم بيطلع فوق الفقاعة
            note = line.replace(/:$/, "").replace(who, "")
              .replace(/^\s*(و?قالت|و?قال|ردّت|ردّ|رد|همست|همس|و?أضافت|و?أضاف|سألت|سأل)\s*/, "")
              .replace(/^[\s،]+|[\s،]+$/g, "");
            return;
          }
        }
      } else { pending = null; note = ""; }
      prev = { type: "line", text: line };
      items.push(prev);
    });
    return items;
  }

  // صفحات قصيرة: تقريبًا ٤ لـ٦ أسطر بالصفحة.
  const pageCache = {};
  function pagesOf(id) {
    const key = state.story.id + "/" + id;
    if (pageCache[key]) return pageCache[key];
    const items = parseScene(state.story.nodes[id].text, castOf());
    const pages = []; let cur = [], w = 0;
    const flush = () => { if (cur.length) pages.push({ items: cur, w }); cur = []; w = 0; };
    items.forEach((it) => {
      if (it.type === "gap") { if (w >= 150) flush(); return; }
      const len = it.text.length + 30;
      const last = cur[cur.length - 1];
      const glued = it.type === "say" && last && last.type === "line" && /:$/.test(last.text);
      if (w + len > 340 && cur.length >= 2 && !glued) flush();
      cur.push(it); w += len;
    });
    flush();
    if (pages.length > 1 && pages[pages.length - 1].w < 90) {
      const lp = pages.pop(); pages[pages.length - 1].items.push(...lp.items);
    }
    return (pageCache[key] = pages.length ? pages.map((p) => p.items) : [[]]);
  }

  function itemHTML(it, cast) {
    if (it.type === "line") {
      const t = it.text;
      if (/^نهاية (القصة|المغامرة)/.test(t)) return `<p class="r-the-end">✨ ${esc(t)} ✨</p>`;
      const sfx = t.length <= 24 && (/…$/.test(t) || /!$/.test(t));
      return `<p class="r-line${sfx ? " r-sfx" : ""}">${esc(t)}</p>`;
    }
    const c = it.who ? cast[it.who] : null;
    const who = c ? `<span class="r-who">${c.icon || "💬"} ${esc(c.label || it.who)}${it.note ? ` <small>· ${esc(it.note)}</small>` : ""}</span>` : "";
    return `<div class="r-say${c && c.me ? " me" : ""}" style="--b:${(c && c.color) || "#eef1f5"}">${who}<div class="r-bubble">${esc(it.text)}</div></div>`;
  }

  /* النهايات الي اكتشفها القارئ (بس على هاد الجهاز) */
  const foundKey = (sid) => "story-tree-found-" + sid;
  function getFound(sid) { try { return JSON.parse(localStorage.getItem(foundKey(sid)) || "[]"); } catch (e) { return []; } }
  function addFound(sid, id) {
    const f = getFound(sid); if (f.includes(id)) return;
    f.push(id); try { localStorage.setItem(foundKey(sid), JSON.stringify(f)); } catch (e) {}
  }
  function endingsOf(story) { return Object.keys(story.nodes).filter((k) => story.nodes[k].ending); }

  function doorChip(story) {
    const d = story.door;
    return d ? `<span class="r-door" style="--d:${d.color}">🚪 ${esc(d.name)} · المغامرة ${AR(d.n)}</span>` : "";
  }

  function summaryHTML(id) {
    const { story } = state, n = story.nodes[id], k = kindOf(story, id), E = ENDINGS[k];
    addFound(story.id, id);
    const found = getFound(story.id), all = endingsOf(story);
    const steps = [];
    state.play.forEach((pid, i) => {
      const pn = story.nodes[pid], next = state.play[i + 1];
      if (!next || (pn.choices || []).length < 2) return;
      const chosen = pn.choices.find((c) => c.to === next);
      const others = pn.choices.filter((c) => c.to !== next);
      steps.push(`<li><div class="r-q">${esc(pn.question || "اختيار")}</div>
        <div class="r-chosen">✓ ${esc(chosen ? chosen.label : "")}</div>
        ${others.map((c) => `<button class="r-retry" data-retry="${i}|${esc(c.to)}">🔁 لو اخترت: ${esc(c.label)}</button>`).join("")}</li>`);
    });
    const ok = isRight(n);
    return `
      <div class="r-verdict ${ok ? "right" : "wrong"}">
        <div class="r-verdict-mark">${ok ? "✅" : "❌"}</div>
        <div class="r-verdict-word">${ok ? "صح!" : "غلط!"}</div>
        <div class="r-verdict-sub">${ok ? "اختياراتك وصّلتك لنهاية حلوة 🎉" : "في طريق أحسن. غيّر اختيار من «لو اخترت…» تحت وجرّب مرة ثانية 👇"}</div>
      </div>
      <div class="r-ending c-${k}">
        <div class="r-ending-icon">${E.icon}</div>
        <div><small>${E.label}</small><b>${esc(n.title)}</b></div>
      </div>
      ${n.lesson ? `<div class="lesson-box"><b>💡 القيمة / الدرس</b>${esc(n.lesson)}</div>` : ""}
      ${steps.length ? `<h2>🧭 طريقك: الاختيارات الي عملتها</h2><ol class="r-steps">${steps.join("")}</ol>
        <p class="muted r-hint">اكبس على «لو اخترت…» لترجع لهديك اللحظة وتجرّب الطريق الثاني.</p>` : ""}
      <h2>🏆 النهايات الي اكتشفتها: ${AR(all.filter((e) => found.includes(e)).length)} من ${AR(all.length)}</h2>
      <div class="r-found">${all.map((e) => {
        const has = found.includes(e), ek = kindOf(story, e);
        return `<span class="r-found-i c-${ek}${has ? " has" : ""}${e === id ? " now" : ""}">${has ? ENDINGS[ek].icon + " " + esc(story.nodes[e].title) : "❔ لسا ما اكتشفتها"}</span>`;
      }).join("")}</div>`;
  }

  function renderPlay() {
    const { story } = state, id = state.play[state.play.length - 1], n = story.nodes[id];
    const pages = pagesOf(id), last = pages.length - 1, cast = castOf();
    const onSummary = n.ending && state.page > last;
    const total = pages.length + (n.ending ? 1 : 0);
    const choiceNo = state.play.slice(0, -1).filter((pid) => (story.nodes[pid].choices || []).length > 1).length;
    const canBack = state.page > 0 || state.play.length > 1;
    let body, nav;
    if (onSummary) {
      body = summaryHTML(id);
      nav = `<button class="btn primary r-big" data-act="restart">⟲ اقرأها من الأول</button>
             <button class="btn r-big" data-act="hall">🚪 ارجع للبهو</button>`;
    } else {
      const atEnd = state.page === last;
      body = pages[state.page].map((it) => itemHTML(it, cast)).join("");
      if (atEnd && !n.ending) {
        const many = (n.choices || []).length > 1;
        body += many
          ? `<div class="r-choose"><h2>🤔 ${esc(n.question || "شو بتختار؟")}</h2><div class="choice-btns">${n.choices.map((c, i) =>
              `<button class="choice-btn r-choice" data-pick="${esc(c.to)}"><span class="r-num">${AR(i + 1)}</span>${esc(c.label)}</button>`).join("")}</div></div>`
          : "";
      }
      const nextBtn = !atEnd ? `<button class="btn primary r-big" data-act="next">التالي ←</button>`
        : n.ending ? `<button class="btn primary r-big" data-act="next">شوف النهاية ✨</button>`
        : (n.choices || []).length === 1 ? `<button class="btn primary r-big" data-pick="${esc(n.choices[0].to)}">${esc(n.choices[0].label)} ←</button>` : "";
      nav = `${canBack ? `<button class="btn r-big" data-act="prev">→ رجوع</button>` : ""}${nextBtn}`;
    }
    return `<div class="reader">
      <div class="r-top">${doorChip(story)}<span class="muted">المشهد ${AR(state.play.length)}${choiceNo ? ` · عملت ${AR(choiceNo)} ${choiceNo === 1 ? "اختيار" : "اختيارات"}` : ""}</span></div>
      <div class="r-card">
        <h1 class="r-title">${esc(n.title)}</h1>
        ${n.tag && !onSummary ? `<div class="r-tag">${esc(n.tag)}</div>` : ""}
        <div class="r-dots">${Array.from({ length: total }, (_, i) => `<i class="${i === Math.min(state.page, total - 1) ? "on" : i < state.page ? "done" : ""}"></i>`).join("")}</div>
        <div class="r-body">${body}</div>
      </div>
      <div class="r-nav">${nav}</div>
      <div class="r-foot">
        <button class="link" data-act="restart">⟲ من البداية</button>
        <button class="link" data-act="tomap">🗺️ شوف خريطة القصة</button>
        <button class="link" data-act="hall">🚪 بهو الأبواب</button>
      </div>
    </div>`;
  }

  /* ---------------- بهو الأبواب ---------------- */
  function renderHall() {
    const doors = STORIES.filter((s) => s.door).sort((a, b) => a.door.n - b.door.n);
    const others = STORIES.filter((s) => !s.door);
    const doorHTML = (s) => {
      const all = endingsOf(s), f = getFound(s.id).filter((e) => all.includes(e)).length;
      return `<div class="h-door" style="--d:${s.door.color}">
        <button class="h-door-shape" data-read="${esc(s.id)}" aria-label="افتح ${esc(s.door.name)}">
          <span class="h-door-n">${AR(s.door.n)}</span><span class="h-door-icon">${s.door.icon || "✨"}</span><span class="h-knob"></span>
        </button>
        <b>${esc(s.door.name)}</b>
        <span class="h-door-title">${esc(s.title)}</span>
        <span class="muted h-door-found">${f ? `🏆 ${AR(f)} من ${AR(all.length)} نهايات` : `${AR(all.length)} نهايات`}</span>
        <div class="h-door-btns">
          <button class="btn primary" data-read="${esc(s.id)}">📖 افتح الباب</button>
          <button class="btn" data-map="${esc(s.id)}">🗺️ الخريطة</button>
        </div>
      </div>`;
    };
    return `<div class="hall">
      <div class="h-intro">
        <div class="h-compass">🧭</div>
        <h1>بهو الأبواب</h1>
        <p>كل مغامرة مع لومي 🦊 بتبدأ من هون: بهو دائري، فيه بوصلة إبرتها بتختار باب.<br>
        ورا كل باب عالم جديد. <b>ومع كل مغامرة جديدة، بينفتح باب جديد بالبهو.</b></p>
      </div>
      <div class="h-doors">
        ${doors.map(doorHTML).join("")}
        <div class="h-door h-next">
          <div class="h-door-shape h-locked"><span class="h-door-icon">＋</span></div>
          <b>الباب ${AR(doors.length + 1)}</b>
          <span class="h-door-title">المغامرة الجاية</span>
          <span class="muted h-door-found">بينفتح لما تنكتب القصة</span>
        </div>
      </div>
      ${others.length ? `<h2>📚 قصص ثانية (مش من بهو الأبواب)</h2><div class="h-others">${others.map((s) =>
        `<div class="h-other"><b>${esc(s.title)}</b><span><button class="link" data-read="${esc(s.id)}">📖 اقرأ</button> · <button class="link" data-map="${esc(s.id)}">🗺️ الخريطة</button></span></div>`).join("")}</div>` : ""}
    </div>`;
  }

  function renderPanel() {
    const panel = $("#panel");
    if (state.mode === "hall") panel.innerHTML = renderHall();
    else if (state.mode === "play") panel.innerHTML = renderPlay();
    else if (state.selected) panel.innerHTML = renderNode(state.selected);
    else panel.innerHTML = renderOverview();
    panel.scrollTop = 0; window.scrollTo(0, 0);
  }

  /* ---------------- actions ---------------- */
  function reveal(ids) { ids.forEach((i) => state.revealed.add(i)); }
  function selectNode(id) {
    if (state.mode === "play") setMode("map");
    reveal(pathTo(id)); reveal(state.L.children[id] || []);
    state.selected = id; state.focusEnding = null;
    renderPanel(); applyHighlight(); fit(true);
  }
  function setMode(m) {
    if (m === "map" && state.mode === "play") state.revealed = new Set(state.play);
    state.mode = m;
    $("#modeHall").classList.toggle("active", m === "hall");
    $("#modeMap").classList.toggle("active", m === "map");
    $("#modePlay").classList.toggle("active", m === "play");
    document.body.classList.toggle("reading", m !== "map");
    document.body.classList.toggle("in-hall", m === "hall");
    if (m === "play") { state.play = [state.story.start]; state.page = 0; state.selected = null; state.focusEnding = null; }
    const want = m === "hall" ? "" : state.story.id + (m === "play" ? "/read" : "");
    if (decodeURIComponent(location.hash.slice(1)) !== want) { try { history.replaceState(null, "", want ? "#" + want : location.pathname); } catch (e) {} }
    renderPanel(); applyHighlight(); requestAnimationFrame(() => fit(m === "map"));
  }

  function turn(dir) {
    const id = state.play[state.play.length - 1], n = state.story.nodes[id];
    const max = pagesOf(id).length - 1 + (n.ending ? 1 : 0);
    if (dir > 0 && state.page < max) state.page++;
    else if (dir < 0 && state.page > 0) state.page--;
    else if (dir < 0 && state.play.length > 1) { state.play.pop(); state.page = pagesOf(state.play[state.play.length - 1]).length - 1; }
    else return;
    renderPanel(); applyHighlight();
  }

  function bindPanel() {
    $("#panel").addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.ending) {
        state.focusEnding = state.focusEnding === t.dataset.ending ? null : t.dataset.ending;
        if (state.focusEnding) reveal(pathTo(state.focusEnding));
        renderPanel(); applyHighlight(); fit(true);
      } else if (t.dataset.go) {
        selectNode(t.dataset.go);
      } else if (t.dataset.pick) {
        state.play.push(t.dataset.pick); state.page = 0; renderPanel(); applyHighlight();
      } else if (t.dataset.retry) {
        const [i, to] = t.dataset.retry.split("|");
        state.play = state.play.slice(0, +i + 1).concat(to); state.page = 0; renderPanel(); applyHighlight();
      } else if (t.dataset.read || t.dataset.map) {
        const sid = t.dataset.read || t.dataset.map;
        if (sid !== state.story.id) loadStory(sid);
        setMode(t.dataset.read ? "play" : "map");
      } else if (t.dataset.act) {
        const a = t.dataset.act;
        if (a === "play" || a === "restart") setMode("play");
        else if (a === "tomap") setMode("map");
        else if (a === "all") { reveal(Object.keys(state.L.pos)); applyHighlight(); renderPanel(); fit(true); }
        else if (a === "collapse") { state.revealed = new Set([state.story.start]); state.selected = null; state.focusEnding = null; renderPanel(); applyHighlight(); fit(true); }
        else if (a === "overview") { state.selected = null; renderPanel(); applyHighlight(); }
        else if (a === "back") { state.play.pop(); renderPanel(); applyHighlight(); fit(true); }
        else if (a === "next") turn(1);
        else if (a === "prev") turn(-1);
        else if (a === "hall") setMode("hall");
      }
    });
  }

  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) { if (!state.story) loadStory(STORIES[0] && STORIES[0].id); setMode("hall"); return; }
    const [sid, view] = h.split("/");
    if (!state.story || state.story.id !== sid) loadStory(sid);
    setMode(view === "read" ? "play" : "map");
  }

  function loadStory(id) {
    const story = STORIES.find((s) => s.id === id) || STORIES[0];
    if (!story) { $("#panel").innerHTML = `<div class="empty">لا توجد قصص بعد.</div>`; return; }
    state.story = story; state.L = layout(story);
    state.selected = null; state.focusEnding = null; state.mode = "map";
    state.revealed = new Set([story.start]);
    $("#modeMap").classList.add("active"); $("#modePlay").classList.remove("active");
    $("#storySelect").value = story.id;
    document.title = `${story.title} · شجرة القصص`;
    const st = $("#stage");
    st.classList.add("instant"); // no fade-out of hidden branches on first draw
    renderTree(); renderPanel(); applyHighlight(); fit();
    requestAnimationFrame(() => requestAnimationFrame(() => st.classList.remove("instant")));
  }

  function init() {
    const sel = $("#storySelect");
    sel.innerHTML = STORIES.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join("");
    sel.onchange = () => (location.hash = sel.value);
    window.addEventListener("hashchange", route);
    $("#modeHall").onclick = () => setMode("hall");
    $("#modeMap").onclick = () => setMode("map");
    $("#modePlay").onclick = () => setMode("play");
    document.addEventListener("keydown", (e) => {
      if (state.mode !== "play" || /SELECT|INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft") turn(1); else if (e.key === "ArrowRight") turn(-1);
    });
    bindViewport(); bindPanel();
    window.addEventListener("resize", () => state.L && fit());
    route();
  }
  init();
})();
