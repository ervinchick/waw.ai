(() => {
  "use strict";
  const COLORS = ["#ffffff", "#111111", "#ff4d5e", "#ffc542", "#3ddc97", "#4aa8ff", "#b07bff"];
  const ICON = {
    draw: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    crop: '<path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  };
  const svg = (p) => '<svg viewBox="0 0 24 24">' + p + "</svg>";
  const st = { base: null, ops: [], undo: [], tool: "draw", color: COLORS[2], size: 6, crop: null, cur: null, done: null };
  let ui = null, cv, ctx;

  const scale = () => cv.width / 700;
  const rect = (c) => ({ x: Math.min(c.x0, c.x1), y: Math.min(c.y0, c.y1), w: Math.abs(c.x1 - c.x0), h: Math.abs(c.y1 - c.y0) });

  function paint(g, ops) {
    g.lineCap = g.lineJoin = "round";
    ops.forEach((o) => {
      if (o.t === "s") {
        g.strokeStyle = o.c; g.lineWidth = o.w; g.beginPath();
        g.moveTo(o.p[0][0], o.p[0][1]);
        o.p.forEach((q) => g.lineTo(q[0], q[1]));
        if (o.p.length === 1) g.lineTo(o.p[0][0] + 0.01, o.p[0][1]);
        g.stroke();
      } else {
        g.font = "700 " + o.s + "px Inter, system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.lineWidth = o.s / 7; g.strokeStyle = o.c === "#111111" ? "#fff" : "#000";
        g.strokeText(o.text, o.x, o.y);
        g.fillStyle = o.c; g.fillText(o.text, o.x, o.y);
      }
    });
  }

  function render() {
    const b = st.base;
    if (!b) return;
    if (cv.width !== b.width || cv.height !== b.height) { cv.width = b.width; cv.height = b.height; }
    ctx.drawImage(b, 0, 0);
    paint(ctx, st.ops);
    if (st.tool === "crop" && st.crop) {
      const r = rect(st.crop);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill("evenodd");
      ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, cv.width / 300);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }

  function setTool(t) {
    st.tool = t; st.crop = null; st.cur = null;
    ui.root.querySelectorAll("[data-t]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
    ui.style.hidden = t === "crop";
    ui.text.hidden = t !== "text";
    ui.crop.hidden = t !== "crop";
    render();
  }

  function refreshSw() {
    ui.root.querySelectorAll(".ed-sw").forEach((s) => s.classList.toggle("active", s.dataset.c === st.color));
  }

  function undoLast() {
    const u = st.undo.pop();
    if (!u) return;
    if (u.t === "op") st.ops.pop(); else { st.base = u.base; st.ops = u.ops; }
    st.crop = null; render();
  }

  function applyCrop() {
    const r = st.crop && rect(st.crop);
    if (!r || r.w < 20 || r.h < 20) return;
    const out = document.createElement("canvas");
    out.width = Math.round(r.w); out.height = Math.round(r.h);
    const g = out.getContext("2d");
    g.translate(-r.x, -r.y);
    g.drawImage(st.base, 0, 0);
    paint(g, st.ops);
    st.undo.push({ t: "crop", base: st.base, ops: st.ops });
    st.base = out; st.ops = []; st.crop = null;
    render();
  }

  function exportImage() {
    const out = document.createElement("canvas");
    out.width = st.base.width; out.height = st.base.height;
    const g = out.getContext("2d");
    g.drawImage(st.base, 0, 0);
    paint(g, st.ops);
    return out.toDataURL("image/jpeg", 0.88);
  }

  function finish(v) {
    ui.root.classList.remove("open");
    const d = st.done;
    st.done = null; st.base = null; st.ops = []; st.undo = [];
    if (d) d(v);
  }

  function build() {
    if (ui) return;
    const root = document.createElement("div");
    root.className = "ed-scrim";
    root.innerHTML =
      '<div class="ed-top">' +
        '<button class="waw-modal-btn" data-a="cancel" type="button">Отмена</button><span class="sp"></span>' +
        '<button class="icon-btn" data-a="undo" type="button" aria-label="Отменить действие">' + svg(ICON.undo) + "</button>" +
        '<button class="waw-modal-btn primary" data-a="done" type="button">Готово</button>' +
      "</div>" +
      '<div class="ed-stage"><canvas></canvas></div>' +
      '<div class="ed-bar">' +
        '<div class="ed-row" data-r="style"><span class="ed-row" data-r="sw"></span>' +
          '<input type="range" min="2" max="24" value="6" data-r="size" aria-label="Размер"></div>' +
        '<div class="ed-row" data-r="text" hidden><label class="field" style="margin:0;flex:1;min-width:0">' +
          '<input type="text" maxlength="80" placeholder="Текст, затем тап по фото"></label></div>' +
        '<div class="ed-row" data-r="crop" hidden><button class="waw-modal-btn" data-a="apply" type="button">Обрезать по рамке</button></div>' +
        '<div class="ed-row">' +
          '<button class="pill-toggle" data-t="draw" type="button">' + svg(ICON.draw) + "<span>Рисовать</span></button>" +
          '<button class="pill-toggle" data-t="text" type="button">' + svg(ICON.text) + "<span>Текст</span></button>" +
          '<button class="pill-toggle" data-t="crop" type="button">' + svg(ICON.crop) + "<span>Обрезка</span></button>" +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    const q = (r) => root.querySelector('[data-r="' + r + '"]');
    q("sw").innerHTML = COLORS.map((c) => '<button class="ed-sw" type="button" data-c="' + c + '" style="--sw:' + c + '" aria-label="Цвет"></button>').join("");
    ui = { root: root, style: q("style"), text: q("text"), crop: q("crop"), input: q("text").querySelector("input") };
    cv = root.querySelector("canvas");
    ctx = cv.getContext("2d");

    q("size").addEventListener("input", (e) => { st.size = +e.target.value; });

    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a],[data-t],.ed-sw");
      if (!b) return;
      if (b.dataset.t) return setTool(b.dataset.t);
      if (b.classList.contains("ed-sw")) { st.color = b.dataset.c; return refreshSw(); }
      const a = b.dataset.a;
      if (a === "cancel") finish(null);
      else if (a === "done") finish(exportImage());
      else if (a === "undo") undoLast();
      else if (a === "apply") applyCrop();
    });

    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) * cv.width) / r.width;
      const y = ((e.clientY - r.top) * cv.height) / r.height;
      return [Math.max(0, Math.min(cv.width, x)), Math.max(0, Math.min(cv.height, y))];
    };

    cv.addEventListener("pointerdown", (e) => {
      if (!st.base) return;
      const [x, y] = pt(e);
      if (st.tool === "text") {
        const s = ui.input.value.trim();
        if (!s) { ui.input.focus(); return; }
        st.ops.push({ t: "x", c: st.color, x: x, y: y, s: (st.size * 2 + 14) * scale(), text: s });
        st.undo.push({ t: "op" });
        render();
        return;
      }
      cv.setPointerCapture(e.pointerId);
      if (st.tool === "draw") {
        st.cur = { t: "s", c: st.color, w: st.size * scale(), p: [[x, y]] };
        st.ops.push(st.cur);
      } else {
        st.crop = { x0: x, y0: y, x1: x, y1: y };
        st.cur = st.crop;
      }
      render();
    });
    cv.addEventListener("pointermove", (e) => {
      if (!st.cur) return;
      const [x, y] = pt(e);
      if (st.tool === "draw") st.cur.p.push([x, y]); else { st.cur.x1 = x; st.cur.y1 = y; }
      render();
    });
    const up = () => {
      if (st.cur && st.tool === "draw") st.undo.push({ t: "op" });
      st.cur = null;
      render();
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    // перехват в фазе захвата: Escape не должен закрывать сайдбар и т.п.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("open")) {
        e.stopPropagation();
        e.preventDefault();
        finish(null);
      }
    }, true);
  }

  function open(dataUrl) {
    build();
    if (st.done) st.done(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const b = document.createElement("canvas");
        b.width = img.naturalWidth; b.height = img.naturalHeight;
        b.getContext("2d").drawImage(img, 0, 0);
        Object.assign(st, { base: b, ops: [], undo: [], crop: null, cur: null, done: resolve });
        ui.root.classList.add("open");
        setTool("draw");
        refreshSw();
      };
      img.src = dataUrl;
    });
  }

  window.WAWEditor = { open: open };
})();
