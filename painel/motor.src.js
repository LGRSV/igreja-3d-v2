
// ===========================================================================
// Igreja Painel 3D — motor das vistas 3D do igreja-painel-card (v1.0.0)
// Gerado por build_painel.py: acima deste ponto vem o igreja3d-card.js (helpers, materiais, decoração dos cômodos e os
// métodos de construção da cena de Igreja3DCard) sem o registro do elemento. Aqui embaixo fica só o que é do painel:
// um WebGLRenderer para várias vistas (cada uma copia para o seu canvas 2D), enquadramento por retângulo, toque nos
// aparelhos (pickAt), cortes de parede entre a câmera e o foco (casa de boneca) e o corte só no cômodo (cut).
// Coordenadas em metros como no cartão: X → direita (muro x = 0 até 20,1), Z → frente (fachada em z ≈ 49,7), Y para cima.
// ===========================================================================
export const VERSION = '1.0.1';
const P3_CUT = 0.9;   // altura das paredes cortadas (abaixo dos peitoris de 1,0 m: a tampa cobre as janelas)
const P3_DEG = Math.PI / 180;
const P3_TUNE = { ty: 0.2, grid: 0.5, maxN: 24, ins: 0.15, part: 0.6, overview: 0.3 };
// enquadramento [x0, z0, x1, z1, giro, inclinação]; giro 90 = câmera do lado da ala direita (+x) olhando o palco (−x)
const P3_ANG = { templo: [90, 42], gilvan: [180, 55], administrativo: [90, 55], circulacao: [90, 55], midia: [90, 52], voluntariado: [90, 52],
  deposito: [90, 58], tecnica: [90, 60], wc_masc: [90, 58], hall_banheiros: [90, 55], wc_fem: [0, 55], patio: [0, 52], almoxarifado: [0, 55],
  cozinha: [0, 55], recepcao: [0, 55], pastoral: [0, 52], caixa_dagua: [0, 58], hall: [0, 45], wcs: [0, 58], estac_frontal: [0, 40], fachada: [0, 25] };
const _p3box = (rs) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z, w, d] of rs) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + w); z1 = Math.max(z1, z + d); } return [x0, z0, x1, z1]; };
const _p3rects = (r) => r.rects || [].concat(...(r.zones || []).map((z) => (ZONES[z] ? ZONES[z].rects : [])));
const _p3round = (a) => a.map((v) => Math.round(v * 100) / 100);
export const ROOMS3D = {};
for (const b of Object.values(BLOCKS)) for (const r of b.rooms) ROOMS3D[r.id] = _p3round([...(r.frame || _p3box(_p3rects(r))), ...(P3_ANG[r.id] || [90, 55])]);
export const BLOCKS3D = {};
for (const [id, b] of Object.entries(BLOCKS)) BLOCKS3D[id] = _p3round([...b.box, ...(id === 'pastoral' ? [0, 52] : id === 'hall' ? [0, 42] : id === 'templo' ? [90, 45] : [90, 52])]);
export const PLAN3D = [-3, 0, 23, 60, 90, 58];
// cômodo de um ponto do piso (primeiro que contém; os blocos de lista têm cômodos sem sobreposição)
const P3_ROOMS = [];
for (const [bid, b] of Object.entries(BLOCKS)) for (const r of b.rooms) P3_ROOMS.push({ id: r.id, block: bid, rects: _p3rects(r) });
function p3RoomAt(x, z) {
  for (const r of P3_ROOMS) for (const [rx, rz, w, d] of r.rects) if (x >= rx - 0.08 && x <= rx + w + 0.08 && z >= rz - 0.08 && z <= rz + d + 0.08) return r.id;
  return null;
}
const P3_KIND = { light: 'light', climate: 'ac', media: 'telao', switch: 'som' };
// v1.1: splits do templo controláveis um a um — 'ac_templo_1' … 'ac_templo_5', numerados da esquerda para a direita de quem está no palco
// olhando a plateia (+x): a esquerda é z menor. Cada chave individual no estado manda na sua unidade; sem ela vale 'ac_templo'.
const P3_UNITS = { ac_templo: 5 };
// fan_mode do HA → fator do fluxo (velocidade e força); números por proporção (1…5 ou 0…100 %); sem fan = 1
const P3_FAN = { quiet: 0.5, silent: 0.5, low: 0.6, middle: 1, medium: 1, mid: 1, auto: 1, high: 1.5, strong: 1.5, turbo: 1.8, max: 1.8, highest: 1.8, lowest: 0.5 };
function p3Fan(f) {
  if (f == null || f === '') return 1;
  const k = String(f).toLowerCase().trim(); if (P3_FAN[k] != null) return P3_FAN[k];
  const v = parseFloat(k); if (isNaN(v)) return 1;
  return v <= 5 ? Math.max(0.5, Math.min(1.8, 0.5 + 1.3 * (v - 1) / 4)) : Math.max(0.5, Math.min(1.8, 0.5 + 1.3 * Math.min(v, 100) / 100));
}
const p3Unit = (k) => { const m = /^(ac_[a-z]+)_(\d)$/.exec(k || ''); return m && P3_UNITS[m[1]] && +m[2] >= 1 && +m[2] <= P3_UNITS[m[1]] ? { base: m[1], n: +m[2] } : null; };

class P3View {
  constructor(E, canvas, o = {}) {
    this.E = E; this.c = canvas; this.o = o; this.g2 = canvas.getContext('2d');
    this.cam = new THREE.PerspectiveCamera(o.fov || 32, 1, 0.1, 600);
    this.az = 90; this.el = 58; this.zoom = 1; this.dist = 60; this.target = new THREE.Vector3(); this.rect = PLAN3D.slice(0, 4);
    this.state = o.state || null; this._cam = null; this._click = null; this._cutRoom = null; this._clip = null; this._h = [];
    // M4: vista inativa não desenha nem anima (setActive); miniatura (thumb: true, ou vista não interativa) não anima, desenha
    // menor e só refaz quando o estado dela muda (debounce de 500 ms)
    this.active = o.active !== false; this.thumb = o.thumb != null ? !!o.thumb : !o.interactive;
    if (o.home) { this.az = o.home[0]; this.el = o.home[1]; }
    if (o.interactive) this._bind();
  }
  // onCam(fn) / onClick(fn) — também aceitam atribuição (view.onClick = fn), como no motor da casa
  get onCam() { const f = (fn) => { this._cam = fn; return this; }; return f; }
  set onCam(fn) { this._cam = fn; }
  get onClick() { const f = (fn) => { this._click = fn; return this; }; return f; }
  set onClick(fn) { this._click = fn; }
  _size() {
    const el = this.c.parentElement || this.c, w = el.clientWidth, h = el.clientHeight;
    const r = el.getBoundingClientRect(); return { w, h, s: w ? r.width / w : 1 };
  }
  _safe(w, h) { const s = typeof this.o.safe === 'function' ? this.o.safe(w, h) : this.o.safe; return Object.assign({ l: 4, t: 4, r: 4, b: 4 }, s || {}); }
  frame(x0, z0, x1, z1, az, el, keepZoom = false) {
    this.rect = [x0, z0, x1, z1]; if (az != null) this.az = az; if (el != null) this.el = el; if (!keepZoom) this.zoom = 1;
    this._fit(); this.render(); return this;
  }
  _fit() {
    const { w, h } = this._size(); if (!w || !h) { this._pendingFit = true; return; }
    this._pendingFit = false;
    const [x0, z0, x1, z1] = this.rect, hy = this.o.hy != null ? this.o.hy : 1.2;
    this.target.set((x0 + x1) / 2, this.o.ty != null ? this.o.ty : 0.3, (z0 + z1) / 2);
    const pts = [];
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, hy]) pts.push(new THREE.Vector3(x, y, z));
    // parede do palco (x = 0, z 12,4–44,0, 8,5 m): entra no enquadramento quando aparece nele
    if (x0 < 0.6 && z1 > 12.4 && z0 < 44.0) for (const z of [Math.max(z0, 12.4), Math.min(z1, 44.0)]) pts.push(new THREE.Vector3(0, SPEC.H_TEMPLO, z));
    const s = this._safe(w, h), _v = new THREE.Vector3();
    const search = () => {
      let lo = 0.5, hi = 900;
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2; this.dist = m; this._place(w, h, 1);
        let ok = true;
        for (const p of pts) { _v.copy(p).project(this.cam); const a = (_v.x + 1) / 2 * w, b = (1 - _v.y) / 2 * h; if (_v.z > 1 || a < s.l || a > w - s.r || b < s.t || b > h - s.b) { ok = false; break; } }
        if (ok) hi = m; else lo = m;
      }
      this.dist = hi; this._place(w, h, 1);
    };
    // centraliza o que aparece (não o alvo) na área livre: mede a caixa projetada e desloca a vista; 2 passadas
    this._shift = [0, 0];
    for (let k = 0; k < 2; k++) {
      search();
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (const p of pts) { _v.copy(p).project(this.cam); const a = (_v.x + 1) / 2 * w, b = (1 - _v.y) / 2 * h; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const ex = (s.l + w - s.r) / 2 - (a0 + a1) / 2, ey = (s.t + h - s.b) / 2 - (b0 + b1) / 2;
      if (Math.abs(ex) < 1 && Math.abs(ey) < 1) break;
      this._shift = [this._shift[0] + ex, this._shift[1] + ey];
    }
    search(); this._place(w, h);
  }
  _place(w, h, z = this.zoom) {
    const az = this.az * P3_DEG, el = this.el * P3_DEG, d = this.dist / z, t = this.target;
    this.cam.position.set(t.x + d * Math.cos(el) * Math.sin(az), t.y + d * Math.sin(el), t.z + d * Math.cos(el) * Math.cos(az));
    this.cam.up.set(0, 1, 0); this.cam.lookAt(t);
    const s = this._safe(w, h), sh = this._shift || [0, 0], dx = (s.l + w - s.r) / 2 - w / 2 + sh[0], dy = (s.t + h - s.b) / 2 - h / 2 + sh[1];
    const fw = w + 2 * Math.abs(dx), fh = h + 2 * Math.abs(dy);
    this.cam.aspect = fw / fh;
    this.cam.setViewOffset(fw, fh, Math.abs(dx) - dx, Math.abs(dy) - dy, w, h);
    this.cam.far = d * 4 + 120; this.cam.near = Math.max(0.1, d * 0.02);
    this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld();
    this._wh = [w, h];
  }
  _sync() { const { w, h } = this._size(); if (!w || !h) return false; if (this._pendingFit || !this._wh || this._wh[0] !== w || this._wh[1] !== h) this._fit(); return true; }
  // ponto do mundo → px (CSS) dentro do elemento da vista
  project(p) {
    if (!this._sync()) return [-999, -999];
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.cam), [w, h] = this._wh;
    return v.z > 1 ? [-999, -999] : [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
  }
  // px (CSS) → ponto no chão [x, z]
  pick(px, py) {
    if (!this._sync()) return null; const [w, h] = this._wh;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(px / w * 2 - 1, 1 - py / h * 2), this.cam);
    const o = rc.ray.origin, d = rc.ray.direction; if (Math.abs(d.y) < 1e-6) return null;
    const k = -o.y / d.y; return k > 0 ? [o.x + d.x * k, o.z + d.z * k] : null;
  }
  // px (CSS) → o que está sob o dedo: { kind: 'light'|'ac'|'telao'|'som'|'room', key, room } ou null
  pickAt(px, py) { return this.E._pickAt(this, px, py); }
  // corte só no cômodo (ou bloco): o resto do prédio some (planos de recorte globais nesta vista); null volta ao prédio inteiro
  cut(id) {
    const r = id ? (ROOMS3D[id] || BLOCKS3D[id]) : null;
    this._cutRoom = r ? id : null;
    if (!r) { this._clip = null; this._clipBox = null; }
    else {
      const m = 0.22, [x0, z0, x1, z1] = r;
      this._clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -(x0 - m)), new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1 + m),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -(z0 - m)), new THREE.Plane(new THREE.Vector3(0, 0, -1), z1 + m)];
      this._clipBox = [x0 - m, z0 - m, x1 + m, z1 + m];
    }
    this.render(); return this;
  }
  render(force) { this.E._queue(this, force); }
  setActive(on) { on = !!on; const was = this.active; this.active = on; if (on && !was) { this._sig = null; this.render(true); } else if (!on) this.E._dirty.delete(this); return this; }
  setZoom(z) { this.zoom = Math.max(0.6, Math.min(4, z)); if (this._sync()) this._place(...this._wh); this._moved(); }
  _moved() { this.render(); if (this._cam) this._cam(this); }
  _on(t, f, o) { this.c.addEventListener(t, f, o); this._h.push([t, f, o]); }
  _bind() {
    const c = this.c, P = new Map(); let drag = null, pinch = null;
    const loc = (e) => { const r = c.getBoundingClientRect(), s = c.clientWidth ? r.width / c.clientWidth : 1; return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; };
    this._on('pointerdown', (e) => {
      if (e.button > 0) return; P.set(e.pointerId, loc(e)); try { c.setPointerCapture(e.pointerId); } catch (_) {}
      if (P.size === 1) drag = { p: loc(e), az: this.az, el: this.el, moved: false };
      else if (P.size === 2) { const [a, b] = [...P.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom }; drag = null; }
    });
    this._on('pointermove', (e) => {
      if (!P.has(e.pointerId)) return; P.set(e.pointerId, loc(e));
      if (pinch && P.size === 2) { const [a, b] = [...P.values()]; this.setZoom(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(10, pinch.d)); return; }
      if (!drag) return; const p = loc(e), dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; c.parentElement && c.parentElement.classList.add('p3drag');
      this.az = drag.az - dx * 0.45; this.el = Math.max(18, Math.min(88, drag.el + dy * 0.3));
      if (this._sync()) this._place(...this._wh); this._moved();
    });
    const up = (e) => {
      if (!P.has(e.pointerId)) return; P.delete(e.pointerId);
      c.parentElement && c.parentElement.classList.remove('p3drag');
      if (drag && !drag.moved && this._click) { const p = loc(e); this._click(p[0], p[1], this.pickAt(p[0], p[1])); }
      if (P.size < 2) pinch = null; drag = null;
    };
    this._on('pointerup', up); this._on('pointercancel', up);
    this._on('wheel', (e) => { e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    this._on('dblclick', () => { this.frame(...this.rect, this.o.home ? this.o.home[0] : this.az, this.o.home ? this.o.home[1] : this.el); this._moved(); });
  }
  dispose() { for (const [t, f, o] of this._h) this.c.removeEventListener(t, f, o); this._h = []; this._cam = this._click = null; this.E.drop(this); }
}

export class IgrejaPainel3D {
  static shared(opts) { if (!window.__igrejaPainel3D) window.__igrejaPainel3D = new IgrejaPainel3D(opts); return window.__igrejaPainel3D; }
  constructor(opts = {}) {
    this.opts = opts; this.views = new Set(); this._dirty = new Map(); this.segs = []; this._gen = 0;
    // aba escondida: nada desenha nem anima; ao voltar, as vistas ativas que ficaram para trás desenham uma vez
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (document.hidden || !this.scene) return;
      this.views.forEach((v) => { if (v.active && v._stale) v.render(true); });
      if (this._airAnim && this._airAnim.size) this._airLoop(); else this._swingCheck();
    });
    this.version = VERSION;
  }
  ready() {
    if (!this._ready) this._ready = new Promise((res, rej) => setTimeout(() => {
      try { this._build(); } catch (e) { rej(e); return; }
      this._precompile().then(() => { this.views.forEach((v) => v.render()); res(this); });
    }, 20));
    return this._ready;
  }
  view(canvas, o) { const v = new P3View(this, canvas, o); this.views.add(v); if (this.scene) v.render(); return v; }
  drop(v) { this.views.delete(v); this._dirty.delete(v); }
  // posições [x, y, z] das luminárias/aparelhos de uma entidade (para os pinos)
  points(key) {
    const un = p3Unit(key);
    if (un) { const rt = this.host && this.host._items.get(un.base), i = this._unitIdx(un.base, un.n); return rt && rt.airUnits && i != null ? [[rt.airUnits[i].p.x, rt.airUnits[i].p.y, rt.airUnits[i].p.z]] : []; }
    const it = ITEMS.find((x) => x.key === key); if (!it) return [];
    if (it.fixtures) return it.fixtures.filter((f) => !f.hidden && !f.ext).map((f) => [f.p[0], f.p[1], f.p[2]]);
    const rt = this.host && this.host._items.get(key);
    if (it.kind === 'climate') return rt && rt.airUnits ? rt.airUnits.map((u) => [u.p.x, u.p.y, u.p.z]) : [];
    if (key === 'telao') return [[0.25, 2.65, 28.1]];
    if (key === 'som') return [[4.9, 1.065, 19.8], [4.9, 1.065, 36.4]];
    if (key === 'porta') return [[12.0, 1.1, 49.65]];
    if (key === 'presenca' || key === 'temperatura') return [[10.8, 2.6, 28.1]];
    return [];
  }

  // ---- construção: a mesma cena do igreja3d-card (_build3D), sem câmera/órbita/DOM, numa maquete escura ----
  _build() {
    const opts = this.opts;
    const H0 = Object.create(Igreja3DCard.prototype); this.host = H0;
    H0._config = Object.assign({}, DEFAULT_CONFIG, { entities: opts.entities || {}, entorno: true });
    let q = H0._qualityFor(opts.quality || 'auto');
    H0._q = q; H0._lite = q === 'leve' || q === 'min'; H0._min = q === 'min';
    H0._nightVision = opts.night_vision !== false; H0._reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; H0._state = {}; H0._lastChanged = {}; H0._activity = [];
    H0._items = new Map(); H0._clickables = []; H0._labels = []; H0._zoneMeshes = {}; H0._nLights = 0; H0._nShadows = 0; H0._topView = false;
    const M = materials();
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Igreja3DCard._gpuInfo().soft, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.localClippingEnabled = true;
    const caps = renderer.capabilities;
    H0._tight = caps.maxFragmentUniforms < 512 || caps.maxTextures < 16;
    renderer.shadowMap.enabled = !H0._min;
    renderer.shadowMap.type = q === 'alta' || q === 'media' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x0a0f1e, 1);
    this.renderer = renderer; H0._renderer = renderer;
    const scene = new THREE.Scene(); this.scene = scene; H0._scene = scene;
    H0._buildSky(scene, renderer);
    for (const s of [H0._skyNight, H0._skyDay, H0._skyDusk]) if (s) s.visible = false;   // maquete: fundo liso (cor do painel)

    const C = new THREE.Vector3(LOT.cx, 0, LOT.cz);
    H0._hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a8070, 1.6); scene.add(H0._hemi);
    H0._amb = new THREE.AmbientLight(0x4a5a80, 0.25); scene.add(H0._amb);
    H0._sun = new THREE.DirectionalLight(0xfff0d2, 3.2);
    H0._sunDist = 60;
    H0._sunPos = new THREE.Vector3(-0.42, 1, 0.55).normalize();
    H0._moonPos = C.clone().addScaledVector(new THREE.Vector3(11, 20, -9).normalize(), H0._sunDist);
    H0._sun.position.copy(C).addScaledVector(H0._sunPos, H0._sunDist); H0._sun.target.position.copy(C);
    H0._sun.castShadow = !H0._min;
    H0._sun.shadow.mapSize.set(H0._lite ? 1024 : 2048, H0._lite ? 1024 : 2048);
    const sc = H0._sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 125;
    H0._sun.shadow.bias = -0.0006; H0._sun.shadow.normalBias = 0.04;
    scene.add(H0._sun, H0._sun.target);

    // base da maquete: laje do lote (gramado seco por cima, lados escuros)
    const TX = textures();
    const gmap = TX.grassDry.clone(); const gw = LOT.x1 - LOT.x0 + 1, gd = LOT.z1 - LOT.z0 + 1; gmap.repeat.set(gw / 2.2, gd / 2.2);
    const side = new THREE.MeshStandardMaterial({ color: 0x1a2232, roughness: 0.9 }), top = new THREE.MeshStandardMaterial({ color: 0xd8d6c8, map: gmap, roughness: 0.95 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.45, gd), [side, side, top, side, side, side]);
    slab.position.set((LOT.x0 + LOT.x1) / 2, -0.03 - 0.225, (LOT.z0 + LOT.z1) / 2); slab.receiveShadow = true; slab.userData.noMerge = true; slab.userData.ground = true;
    scene.add(slab); this.slab = slab;

    // pisos das zonas (igual ao _build3D, sem os rótulos)
    const ROUGH = { tileGray: 0.5, tileLight: 0.6, tileCool: 0.45, wood: 0.72, herring: 0.95, paversGray: 0.95, paversDark: 0.9, laminate: 0.44, porcelainBeige: 0.3, porcelainGray: 0.13 };
    const BUMP = { tileGray: 0.3, laminate: 0.25, porcelainBeige: 0.15, porcelainGray: 0.08 }, ENVI = { porcelainGray: 0.6, porcelainBeige: 0.8, laminate: 0.8 };
    for (const [id, z] of Object.entries(ZONES)) {
      const tk = z.floor || 'concrete', tile = z.tile || 3, list = H0._zoneMeshes[id] = [];
      for (const [x, zz, w, d, edges = 'nsew'] of z.rects) {
        const map = TX[tk].clone(); map.repeat.set(w / tile, d / tile); map.offset.set(x / tile, -(zz + d) / tile);
        const tint = ['grass', 'concrete'].includes(tk) ? 0xdedede : 0xffffff;
        const mat = new THREE.MeshStandardMaterial({ color: tint, map, roughness: ROUGH[tk] || 0.9, bumpMap: H0._min ? null : map, bumpScale: BUMP[tk] != null ? BUMP[tk] : 0.6,
          aoMap: edges && !H0._min ? H0._makeAO(w, d, edges) : null, aoMapIntensity: 1.0, envMapIntensity: ENVI[tk] != null ? ENVI[tk] : 1 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
        m.rotation.x = -Math.PI / 2; m.position.set(x + w / 2, 0.004, zz + d / 2); m.receiveShadow = true;
        m.userData = { item: z.item || null, zone: id }; scene.add(m); list.push(m);
        if (z.item) H0._clickables.push(m);
      }
    }
    // paredes: cada _wallSeg vira um trecho cortável (as peças dele ficam fora do mergeStatic)
    const segs = this.segs, wallSeg = Igreja3DCard.prototype._wallSeg;
    H0._wallSeg = function (sc2, M2, axis, c, a0, a1, ops, o = {}) {
      const n0 = sc2.children.length;
      wallSeg.call(this, sc2, M2, axis, c, a0, a1, ops, o);
      segs.push({ axis, c, a0, a1, ops: ops || [], h: o.h || H, t: o.t || T, meshes: sc2.children.slice(n0), cut: false, i: segs.length });
    };
    const nW = scene.children.length;
    H0._buildWalls(scene, M);
    // pilares (soltos no _buildWalls) entram no trecho em que estão encostados
    const inSeg = new Set(); for (const s of segs) for (const m of s.meshes) inSeg.add(m);
    const bb = new THREE.Box3(), ctr = new THREE.Vector3();
    for (const o of scene.children.slice(nW)) {
      if (inSeg.has(o)) continue;
      bb.setFromObject(o); bb.getCenter(ctr);
      const s = segs.find((g) => (g.axis === 'x' ? Math.abs(ctr.z - g.c) < 0.4 && ctr.x >= g.a0 - 0.3 && ctr.x <= g.a1 + 0.3 : Math.abs(ctr.x - g.c) < 0.4 && ctr.z >= g.a0 - 0.3 && ctr.z <= g.a1 + 0.3));
      if (s) s.meshes.push(o);
    }
    if (!STAIR.off) H0._walls.push({ axis: 'x', c: STAIR.Z0, a0: MEZZ.x1, a1: STAIR.XE + STAIR.GO, t: 0.06, h: 1.0 });
    else H0._walls.push({ axis: 'z', c: 14.78, a0: 46.24, a1: 49.54, t: 2.32, h: 1.5 });
    // rodapés (igual ao _build3D)
    for (const z of Object.values(ZONES)) {
      if (!z.inside) continue;
      const bm = z.floor === 'laminate' ? M.baseboardWood : z.floor === 'porcelainGray' ? M.baseboardGray : M.baseboard, hb = bm === M.baseboard ? 0.09 : 0.07;
      for (const [x, zz, w, d, edges = 'nsew'] of z.rects) {
        const back = zz + d < 11.01, io = (c) => (!back ? T / 2 : c < 0.01 || c > 20.09 ? 0 : TF / 2) + 0.02;
        const iw = io(x), ie = io(x + w), inn = io(zz), is = io(zz + d);
        if (edges.includes('n')) scene.add(box(w - iw - ie, hb, 0.02, bm, x + (w + iw - ie) / 2, hb / 2, zz + inn, { cast: false }));
        if (edges.includes('s')) scene.add(box(w - iw - ie, hb, 0.02, bm, x + (w + iw - ie) / 2, hb / 2, zz + d - is, { cast: false }));
        if (edges.includes('w')) scene.add(box(0.02, hb, d - inn - is, bm, x + iw, hb / 2, zz + (d + inn - is) / 2, { cast: false }));
        if (edges.includes('e')) scene.add(box(0.02, hb, d - inn - is, bm, x + w - ie, hb / 2, zz + (d + inn - is) / 2, { cast: false }));
      }
    }
    for (const o of scene.children) o.userData.arch = true;
    H0._ext = new THREE.Group(); H0._ext.name = 'fachada'; H0._ext.userData.keep = true; H0._ext.visible = false; scene.add(H0._ext);
    for (const m of H0._wallHi || []) H0._ext.add(m);
    H0._mezz = new THREE.Group(); H0._mezz.name = 'mezanino'; H0._mezz.userData.keep = true; scene.add(H0._mezz);
    H0._buildFurniture(scene, M);
    H0._snapThin(scene);
    H0._buildFixtures(scene, M);
    H0._buildPools(scene);
    mergeItems(scene, H0._clickables, H0._items); mergeItems(H0._ext, H0._clickables, H0._items);
    H0._buildDoors(scene);
    this._clipUp = [new THREE.Plane(new THREE.Vector3(0, -1, 0), P3_CUT)];
    this._doorsToSegs(scene);
    this._decoToSegs(scene);
    this._mergeSegs(scene, M);
    const stats = mergeStatic(scene, true);
    mergeStatic(H0._ext, true); mergeStatic(H0._mezz, true);
    if (q === 'media') H0._midMaterials(scene);
    scene.fog = null;
    // o que não respeita os planos de recorte (sprites, ShaderMaterial, Points): some à mão fora do cômodo cortado
    this._free = []; const c3 = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o.material; if (!(o.isSprite || o.isPoints || (o.isMesh && m && !Array.isArray(m) && m.isShaderMaterial))) return;
      if (o.isSprite) o.getWorldPosition(c3); else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); c3.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld); }
      this._free.push({ o, x: c3.x, z: c3.z, r: 0 });
      if (o.isMesh || o.isPoints) this._clipShader(m);
    });
    // estado inicial: tudo desligado
    for (const it of ITEMS) H0._setItemState(it.key, { state: 'off', attrs: {} });
    H0._activitySeeded = true;
    this._key = null; this._cutSig = null; this._nlApplied = null;
    renderer.shadowMap.needsUpdate = true;
    console.info(`[igreja-painel-3d] v${VERSION} · qualidade ${q} · ${stats.after} malhas estáticas · ${segs.length} trechos de parede · ${H0._nLights} luzes`);
  }
  // as folhas das portas (InstancedMesh do cartão, animadas no modo Pessoa) viram malhas fixas do trecho de parede delas (cortam junto)
  _doorsToSegs(scene) {
    const H0 = this.host, m4 = new THREE.Matrix4();
    for (const im of H0._doorMeshes || []) {
      for (let i = 0; i < im.count; i++) {
        const d = im.userData.owners[i]; im.getMatrixAt(i, m4);
        const m = new THREE.Mesh(im.geometry, im.material); m4.decompose(m.position, m.quaternion, m.scale);
        m.castShadow = im.castShadow; m.receiveShadow = im.receiveShadow;
        const s = this.segs.find((g) => g.axis === d.axis && Math.abs(g.c - d.c) < 0.02 && d.a >= g.a0 - 0.2 && d.b <= g.a1 + 0.2);
        scene.add(m); if (s) s.meshes.push(m); else m.userData.noMerge = false;
      }
      scene.remove(im);
    }
    H0._doorMeshes = [];
  }
  // decoração fina presa numa parede (painéis, quadros, placas, ripados, prateleiras rasas) corta junto com ela
  _decoToSegs(scene) {
    const bb = new THREE.Box3(), list = [];
    const skip = (o) => o.userData.item || o.userData.keep || o.userData.arch || o.userData.noMerge || o.userData.zone;
    const walk = (o) => {
      if (skip(o)) return;
      if (o.isMesh && !o.isInstancedMesh) { list.push(o); return; }
      for (const ch of o.children) walk(ch);
    };
    for (const o of scene.children) if (o !== this.host._ext && o !== this.host._mezz) walk(o);
    scene.updateMatrixWorld(true);
    let n = 0;
    for (const o of list) {
      const m = o.material; if (!m || Array.isArray(m) || m.isShaderMaterial || m.blending === THREE.AdditiveBlending) continue;
      bb.setFromObject(o); if (bb.isEmpty() || bb.max.y < P3_CUT + 0.05) continue;
      let best = null, bd = 9;
      for (const s of this.segs) {
        const nk = s.axis === 'x' ? 'z' : 'x', uk = s.axis === 'x' ? 'x' : 'z';
        if (bb.max[nk] - bb.min[nk] > 0.3) continue;
        if (bb.max[uk] <= s.a0 + 0.02 || bb.min[uk] >= s.a1 - 0.02) continue;
        const d = Math.min(Math.abs(bb.min[nk] - s.c), Math.abs(bb.max[nk] - s.c)) - s.t / 2;
        if (d <= 0.12 && d < bd) { bd = d; best = s; }
      }
      if (!best) continue;
      if (o.parent !== scene) scene.attach(o);
      best.meshes.push(o); n++;
    }
    this._decoN = n;
  }
  // junta as peças de cada trecho por material (menos draw calls) e cria a tampa escura do corte (fora das portas e vãos)
  _mergeSegs(scene, M) {
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.85 });
    const _v = new THREE.Matrix4();
    for (const s of this.segs) {
      const groups = new Map(), out = [];
      for (const o of s.meshes) {
        if (!o.isMesh || Array.isArray(o.material) || !o.geometry.attributes.normal || !o.geometry.attributes.uv || o.parent !== scene) { if (o.parent === scene) { o.userData.noMerge = true; out.push(o); } continue; }
        const key = o.material.uuid + (o.castShadow ? 'c' : 'n') + (o.receiveShadow ? 'r' : '');
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o);
      }
      for (const ms of groups.values()) {
        let total = 0; const parts = ms.map((o) => { o.updateMatrix(); const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix); total += g.attributes.position.count; return g; });
        const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2); let off = 0;
        for (const g of parts) { const n = g.attributes.position.count; pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3); uv.set(g.attributes.uv.array, off * 2); off += n; g.dispose(); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.computeBoundingSphere(); geo.computeBoundingBox();
        const m = new THREE.Mesh(geo, ms[0].material); m.castShadow = ms[0].castShadow; m.receiveShadow = ms[0].receiveShadow; m.matrixAutoUpdate = false; m.userData.noMerge = true; m.userData.arch = true;
        for (const o of ms) { scene.remove(o); if (!o.geometry.userData.shared) { /* a geometria das portas é compartilhada */ } }
        scene.add(m); out.push(m);
      }
      s.meshes = out;
      // corte: a peça troca para uma cópia do material com o plano y < P3_CUT (o original segue nos trechos inteiros)
      for (const m of out) { m.userData.seg = s.i; if (m.material && !Array.isArray(m.material)) { m.userData.mFull = m.material; m.userData.mCut = this._cutVariant(m.material); } }
      // tampa do corte (só nos trechos cheios: fora de portas, vidros, vãos e portões; as janelas têm parede abaixo do peitoril)
      const gaps = s.ops.filter((o) => o.t !== 'window' || (o.sill != null ? o.sill : 1.0) < P3_CUT).map((o) => [o.a, o.b]).sort((a, b) => a[0] - b[0]);
      const spans = []; let cur = s.a0;
      for (const [a, b] of gaps) { if (a > cur) spans.push([cur, a]); cur = Math.max(cur, b); }
      if (s.a1 > cur) spans.push([cur, s.a1]);
      const caps = [];
      for (const [a, b] of spans) {
        if (b - a < 0.02) continue;
        const cp = s.axis === 'x' ? box(b - a, 0.03, s.t + 0.02, cutMat, (a + b) / 2, P3_CUT + 0.015, s.c, { cast: false }) : box(s.t + 0.02, 0.03, b - a, cutMat, s.c, P3_CUT + 0.015, (a + b) / 2, { cast: false });
        cp.receiveShadow = false; cp.visible = false; cp.userData.noMerge = true; cp.userData.cap = true; scene.add(cp); caps.push(cp);
      }
      s.caps = caps;
    }
  }
  _precompile() {
    const r = this.renderer, cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 600); cam.position.set(60, 60, 30); cam.lookAt(10, 0, 30); cam.updateMatrixWorld();
    for (const s of this.segs) for (const c of s.caps) c.visible = true;
    let p;
    try { p = r.extensions.has('KHR_parallel_shader_compile') ? r.compileAsync(this.scene, cam) : (r.compile(this.scene, cam), Promise.resolve()); } catch (e) { p = Promise.resolve(); }
    for (const s of this.segs) for (const c of s.caps) c.visible = false;
    return p.catch(() => {}).then(() => this._warm(cam));
  }
  // Aquece os programas de todas as combinações que as vistas usam (paredes cortadas × recorte do cômodo), desenhando 1×1 px:
  // sem isso o primeiro corte/cômodo de cada vista compilava dezenas de shaders na hora (picos de 0,2–0,6 s)
  _warm(cam) {
    const r = this.renderer, big = 1e4, keep = [new THREE.Plane(new THREE.Vector3(1, 0, 0), big), new THREE.Plane(new THREE.Vector3(-1, 0, 0), big),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), big), new THREE.Plane(new THREE.Vector3(0, 0, -1), big)];
    const hidden = []; this.scene.traverse((o) => { if (!o.visible && (o.isMesh || o.isSprite || o.isPoints)) { o.visible = true; hidden.push(o); } });
    const t0 = performance.now();
    try {
      r.setScissorTest(true);
      for (const cut of [false, true]) for (const clip of [false, true]) {
        for (const s of this.segs) this._setCut(s, cut);
        r.clippingPlanes = clip ? keep : [];
        r.setViewport(0, 0, 1, 1); r.setScissor(0, 0, 1, 1); r.render(this.scene, cam);
      }
    } catch (e) { console.warn('igreja-painel-3d: aquecimento', e); }
    r.clippingPlanes = []; for (const s of this.segs) this._setCut(s, false); for (const o of hidden) o.visible = false;
    r.shadowMap.needsUpdate = true; this._key = null; this._warmMs = Math.round(performance.now() - t0);
  }


  // Corta (por vista) os trechos de parede entre a câmera e o retângulo em foco: raio câmera → ponto do foco (altura ty) atravessa o trecho
  // (extensão e altura reais)? Divisórias dentro do foco são sempre cortadas, exceto na visão geral.
  _applyCuts(v) {
    const C = v.cam.position, ins = P3_TUNE.ins, ty = P3_TUNE.ty;
    // com zoom só conta o que está na tela: o retângulo encolhe em volta do alvo (1/zoom); assim aproximar não derruba paredes
    // que nem aparecem (antes os pontos de amostra cobriam o retângulo inteiro e a câmera mais perto cortava mais trechos)
    const zr = Math.max(1, v.zoom || 1), tx = v.target.x, tz = v.target.z;
    const [x0, z0, x1, z1] = zr > 1 ? [tx + (v.rect[0] - tx) / zr, tz + (v.rect[1] - tz) / zr, tx + (v.rect[2] - tx) / zr, tz + (v.rect[3] - tz) / zr] : v.rect;
    const lotA = (LOT.x1 - LOT.x0) * (LOT.z1 - LOT.z0), overview = (v.rect[2] - v.rect[0]) * (v.rect[3] - v.rect[1]) > P3_TUNE.overview * lotA;
    const nx = Math.max(3, Math.min(P3_TUNE.maxN, Math.ceil((x1 - x0) / P3_TUNE.grid) + 1)), nz = Math.max(3, Math.min(P3_TUNE.maxN, Math.ceil((z1 - z0) / P3_TUNE.grid) + 1));
    let sig = '';
    // v1.0.1: paredes e fachada ficam de pé por padrão (como no igreja3d-card); o corte automático só vale com { cuts: true }
    // ou na vista recortada num cômodo (Ambientes), onde só as paredes do próprio cômodo poderiam tapar a vista
    const cutsOn = v.o.cuts === true || (!!v._clipBox && v.o.cuts !== false);
    for (const W of this.segs) {
      const ax = W.axis === 'x', [p0, p1, q0, q1] = ax ? [z0, z1, x0, x1] : [x0, x1, z0, z1];
      let hit = !cutsOn ? false : !overview && W.c > p0 + P3_TUNE.part && W.c < p1 - P3_TUNE.part && Math.min(W.a1, q1) - Math.max(W.a0, q0) > 0.4;
      if (v._clipBox && !hit) {   // corte no cômodo: só os trechos que sobram dentro da caixa contam
        const [bx0, bz0, bx1, bz1] = v._clipBox, inBox = ax ? W.c > bz0 && W.c < bz1 && W.a1 > bx0 && W.a0 < bx1 : W.c > bx0 && W.c < bx1 && W.a1 > bz0 && W.a0 < bz1;
        if (!inBox) { sig += '0'; this._setCut(W, false); continue; }
      }
      const cu = ax ? C.z : C.x, ca = ax ? C.x : C.z, d0 = cu - W.c;
      if (!hit && cutsOn && Math.abs(d0) > W.t / 2 && (d0 > 0 ? p0 < W.c : p1 > W.c)) {
        for (let i = 0; i < nx && !hit; i++) for (let j = 0; j < nz && !hit; j++) {
          const px = x0 + ins + (x1 - x0 - 2 * ins) * i / (nx - 1), pz = z0 + ins + (z1 - z0 - 2 * ins) * j / (nz - 1);
          const pa = ax ? px : pz, pu = ax ? pz : px, d1 = pu - W.c;
          if (d0 * d1 >= 0) continue;
          const t = d0 / (d0 - d1), a = ca + t * (pa - ca), y = C.y + t * (ty - C.y);
          if (y < W.h && a > W.a0 + 0.02 && a < W.a1 - 0.02) hit = true;
        }
      }
      this._setCut(W, hit); sig += hit ? '1' : '0';
    }
    this._cutSig = sig;
  }
  _setCut(W, on) {
    if (W.cut === on) return; W.cut = on;
    for (const c of W.caps || []) c.visible = on;
    for (const m of W.meshes) if (m.userData.mCut) m.material = on ? m.userData.mCut : m.userData.mFull;
  }
  // cópia do material com o recorte (o clone perde o onBeforeCompile dos padrões em espaço de mundo: vai junto)
  _cutVariant(m) {
    this._cutMats = this._cutMats || new Map();
    let c = this._cutMats.get(m); if (c) return c;
    c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
    c.clippingPlanes = this._clipUp; c.clipShadows = false; c.userData = Object.assign({}, m.userData);
    this._cutMats.set(m, c); return c;
  }

  // toque → aparelho ou cômodo; ignora o que está cortado/recortado na vista, vidro, halos e feixes
  _pickAt(v, px, py) {
    if (!this.scene || !v._sync()) return null; const [w, h] = v._wh;
    this._prep(v);
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(px / w * 2 - 1, 1 - py / h * 2), v.cam);
    const vis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    const cb = v._clipBox;
    for (const it of rc.intersectObjects(this.scene.children, true)) {
      const o = it.object, m = o.material, p = it.point;
      const mm = Array.isArray(m) && it.face ? m[it.face.materialIndex] : m;
      if (o.isSprite || o.isLine || o.isPoints || !vis(o) || !mm || mm.visible === false || mm.isShaderMaterial || mm.blending === THREE.AdditiveBlending || (mm.transparent && mm.opacity < 0.35)) continue;
      if (cb && (p.x < cb[0] || p.x > cb[2] || p.z < cb[1] || p.z > cb[3])) continue;
      if (o.userData.seg != null && this.segs[o.userData.seg].cut && p.y > P3_CUT + 0.02) continue;
      let key = null, zone = null;
      for (let q = o; q && q !== this.scene; q = q.parent) { if (q.userData.zone) zone = q.userData.zone; if (q.userData.item && !key) key = q.userData.item; }
      const n = it.face && !o.userData.ground ? it.face.normal.clone().transformDirection(o.matrixWorld) : null;
      const gx = n && Math.abs(n.y) < 0.5 ? p.x + n.x * 0.15 : p.x, gz = n && Math.abs(n.y) < 0.5 ? p.z + n.z * 0.15 : p.z;
      let room = p3RoomAt(gx, gz);
      if (o.userData.seg != null) {   // v1.0.1: tocou numa parede em pé → vale o cômodo do chão sob o dedo (o que a pessoa está apontando)
        const g = v.pick(px, py), r2 = g && p3RoomAt(g[0], g[1]); if (r2) room = r2;
      }
      if (v._cutRoom && ROOMS3D[v._cutRoom] && room !== v._cutRoom) room = v._cutRoom;   // corte no cômodo: o que sobra é dele
      if (key && !zone) {
        const itm = ITEMS.find((x) => x.key === key), kind = itm && P3_KIND[itm.kind];
        if (kind) return { kind, key: this._unitKey(key, p), room, point: [p.x, p.y, p.z] };
      }
      // carcaça/suporte de um aparelho (moving head, campânula, corpo do split…): o aparelho mais próximo a até 0,45 m
      const near = this._nearItem(p);
      if (near) { const itm = ITEMS.find((x) => x.key === near); return { kind: P3_KIND[itm.kind], key: this._unitKey(near, p), room: room || p3RoomAt(p.x, p.z), point: [p.x, p.y, p.z] }; }
      if (!room) return null;
      return { kind: 'room', key: zone ? (ZONES[zone] && ZONES[zone].item) || null : key, room, point: [p.x, p.y, p.z] };
    }
    const g = v.pick(px, py); if (!g || (cb && (g[0] < cb[0] || g[0] > cb[2] || g[1] < cb[1] || g[1] > cb[3]))) return null;
    const room = p3RoomAt(g[0], g[1]);
    return room ? { kind: 'room', key: null, room, point: [g[0], 0, g[1]] } : null;
  }

  _unitIdx(base, n) {
    const rt = this.host && this.host._items.get(base); if (!rt || !rt.airUnits) return null;
    const ord = rt.airUnits.map((u, i) => i).sort((a, b) => (rt.airUnits[a].p.z - rt.airUnits[b].p.z) || (rt.airUnits[a].p.x - rt.airUnits[b].p.x));
    return ord[n - 1] != null ? ord[n - 1] : null;
  }
  // aparelho do templo tocado → a unidade mais próxima do ponto ('ac_templo_N')
  _unitKey(key, p) {
    if (!P3_UNITS[key]) return key;
    let best = 1, bd = 1e9;
    for (let n = 1; n <= P3_UNITS[key]; n++) { const q = this.points(key + '_' + n)[0]; if (!q) continue; const d = Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]); if (d < bd) { bd = d; best = n; } }
    return key + '_' + best;
  }
  _nearItem(p) {
    if (!this._itemPts) { this._itemPts = []; for (const it of ITEMS) if (P3_KIND[it.kind]) for (const q of this.points(it.key)) this._itemPts.push([it.key, q]); }
    let best = null, bd = 0.45;
    for (const [k, q] of this._itemPts) { const d = Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]); if (d < bd) { bd = d; best = k; } }
    return best;
  }

  // ShaderMaterial do cartão (poças de luz no piso, feixes, fluxo dos ares) passa a respeitar os planos de recorte da vista:
  // sem isso a poça de uma entidade espalhada por vários cômodos (banheiros, circulação) vazava fora do corte
  _clipShader(m) {
    if (!m || !m.isShaderMaterial || m.userData.p3clip) return; m.userData.p3clip = true;
    const vs = m.vertexShader, fs = m.fragmentShader, iv = vs.lastIndexOf('}'), mf = fs.indexOf('void main(){');
    if (iv < 0 || mf < 0 || !/void main\(\)\{/.test(vs)) return;
    m.vertexShader = '#include <clipping_planes_pars_vertex>\n' + vs.slice(0, iv) + ' { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n#include <clipping_planes_vertex>\n }\n' + vs.slice(iv);
    m.fragmentShader = '#include <clipping_planes_pars_fragment>\n' + fs.slice(0, mf + 12) + '\n#include <clipping_planes_fragment>\n' + fs.slice(mf + 12);
    m.clipping = true; m.needsUpdate = true;
  }

  // estado → entidades do cartão (mesmo _setItemState) → luzes/materiais (sem animação: nível = alvo)
  // st = { lights:{chave:bool}, palco:{on,rgb,bri}, plateia:{on,bri}, telao:{on,title}, som, ac:{chave:{on,mode}}, porta, night }
  _apply(st) {
    st = st || {};
    const key = JSON.stringify(st); if (key === this._key) return; this._key = key;
    const H0 = this.host, L = (st.lights || {}), bri = (b) => (b == null ? null : b > 100 ? b : Math.round(b * 2.55));
    for (const it of ITEMS) {
      let s = 'off', a = {};
      if (it.key === 'palco') { const p = st.palco || {}; const on = p.on != null ? p.on : L.palco; s = on ? 'on' : 'off'; if (p.rgb) a.rgb_color = p.rgb; if (p.bri != null) a.brightness = bri(p.bri); }
      else if (it.key === 'plateia') { const p = st.plateia || {}; const on = p.on != null ? p.on : L.plateia; s = on ? 'on' : 'off'; if (p.bri != null) a.brightness = bri(p.bri); }
      else if (it.kind === 'light') s = L[it.key] ? 'on' : 'off';
      else if (it.key === 'telao') { const tv = st.telao || {}; s = tv.on ? (tv.title ? 'playing' : 'on') : 'off'; if (tv.title) a.media_title = tv.title; }
      else if (it.key === 'som') s = st.som ? 'on' : 'off';
      else if (it.kind === 'climate') { const w = this._acWants(st, it.key); s = w.some((u) => u.on) ? (w.find((u) => u.on).mode || 'cool') : 'off'; }
      else if (it.key === 'porta') s = st.porta ? 'on' : 'off';
      else continue;
      H0._setItemState(it.key, { state: s, attrs: a });
    }
    // dia/noite (fórmulas do _frame do cartão, sem transição)
    const nl = st.night === false ? 0 : 1, nv = H0._nightVision ? 1 : 0, Lr = THREE.MathUtils.lerp, Cc = (h) => new THREE.Color(h);
    H0._nightLevel = nl;
    H0._hemi.intensity = Lr(0.85, Lr(0.22, 0.66, nv), nl); H0._hemi.color.setHex(0xe4ecf5).lerp(Cc(0x4a5f92), nl); H0._hemi.groundColor.setHex(0xa08c70).lerp(Cc(0x1c2130), nl);
    H0._amb.intensity = Lr(0.12, Lr(0.14, 0.36, nv), nl); H0._amb.color.setHex(0xdde4ee).lerp(Cc(0x6b7aa8), nl);
    const C = H0._sun.target.position, sunPos = C.clone().addScaledVector(H0._sunPos, H0._sunDist);
    H0._sun.intensity = Lr(3.2, Lr(0.5, 1.15, nv), nl); H0._sun.position.lerpVectors(sunPos, H0._moonPos, nl); H0._sun.color.setHex(0xfff0d2).lerp(Cc(0x8fa6d8), nl);
    if (this._nlApplied !== nl) { this._nlApplied = nl; H0._sun.shadow.needsUpdate = true; this.renderer.shadowMap.needsUpdate = true; }
    const envI = Lr(0.9, Lr(0.35, 0.7, nv), nl);
    if (H0._probe) { H0._probe.sh.copy(H0._shDay).lerp(H0._shNight, nl); H0._probe.intensity = envI; }
    if (H0._envDay) {
      const env = nl > 0.5 ? H0._envNight : H0._envDay;
      if (H0._envMats) for (const m of H0._envMats) { m.envMap = env; m.envMapIntensity = envI; }
      else { this.scene.environment = env; this.scene.environmentIntensity = envI; }
    }
    this.renderer.setClearColor(nl ? 0x0a0f1e : 0x16212e, 1);
    const dayScale = Lr(0.45, 1, nl), now = performance.now();
    for (const it of ITEMS) {
      const rt = H0._items.get(it.key); if (!rt) continue;
      const lv = rt.target * (rt.brightScale || 1), col = rt.color;
      rt.level = lv; rt.lv = lv; if (rt.cbase) rt.cbase.copy(col); if (rt.cshow) rt.cshow.copy(col);
      for (const { L: pl, i } of rt.lights || []) { pl.intensity = i * lv * dayScale; pl.color.copy(col); }
      if (it.kind === 'light') for (const f of rt.fixtures || []) if (f.material && f.material.emissive) f.material.emissiveIntensity = lv * 1.6;
      if (rt.emisMat && it.rgb) rt.emisMat.emissive.copy(col);
      for (const { sp, base, gs } of rt.glows || []) { sp.material.opacity = lv * base * Lr(0.35, 1, nl); sp.material.color.copy(col); sp.visible = lv > 0.01; if (gs && sp.scale.x !== gs) sp.scale.set(gs, gs, 1); }
      if (rt.pool) { const pu = rt.pool.material.uniforms; pu.uI.value = lv * H0._poolK * Lr(0.12, 1, nl); pu.uC.value.copy(col); rt.pool.visible = lv > 0.01; }
      for (const b of rt.beams || []) { b.material.uniforms.uI.value = lv * Lr(0.18, 0.55, nl); b.material.uniforms.uC.value.copy(col); b.visible = lv > 0.01; }
      for (const b of rt.emisBind || []) b.mat.emissiveIntensity = b.max * (b.min + (1 - b.min) * lv);
      for (const hm of rt.halos || []) { hm.opacity = lv * hm.userData.base * Lr(hm.userData.day, 1, nl); hm.visible = lv > 0.01; }
      if (it.key === 'telao' && rt.screenMat) {
        const pulse = rt.playing ? 1 : 0.7;
        rt.screenMat.emissiveIntensity = pulse * lv; rt.light.intensity = pulse * lv * 9 * Lr(0.6, 1, nl);
        if (rt.bloom) { rt.bloom.material.opacity = pulse * lv * 0.35 * Lr(0.4, 1, nl); rt.bloom.visible = lv > 0.01; }
      }
      if (it.key === 'som' && rt.ledMats) for (const m of rt.ledMats) m.emissiveIntensity = lv * 2.6;
      if (it.kind === 'climate' && rt.ledMats) this._acApply(st, it.key, rt, nl, now);
      if (it.key === 'porta' && rt.leaves) {
        for (const lf of rt.leaves) { const ry = lf.base - lf.dir * lv * 1.25; if (lf.g.rotation.y !== ry) { lf.g.rotation.y = ry; H0._refreshPointShadows('hall'); H0._sun.shadow.needsUpdate = true; } }
      }
    }
    this._dayScale = dayScale;
    if (H0._needShadow) { this.renderer.shadowMap.needsUpdate = true; H0._needShadow = false; }
  }

  // ligado/modo/velocidade/oscilação de cada unidade do ar: chave individual (ac_templo_N) manda na unidade; senão vale a da entidade
  _acWants(st, key) {
    const ac = st.ac || {}, rt = this.host._items.get(key), n = rt && rt.airUnits ? rt.airUnits.length : 1, all = ac[key] || {};
    const pick = (u, d) => ({ on: !!u.on, mode: u.mode || d.mode, fan: u.fan != null ? u.fan : d.fan, swing: u.swing != null ? u.swing : d.swing });
    const out = Array.from({ length: n }, () => pick(all, {}));
    if (P3_UNITS[key]) for (let k = 1; k <= P3_UNITS[key]; k++) { const u = ac[key + '_' + k], i = this._unitIdx(key, k); if (u && i != null) out[i] = pick(u, all); }
    return out;
  }
  // Ar → unidades. Na 1ª vez (carga) fica como está, sem animar. Depois, unidade que liga entra na sua vez (como o _airStart do
  // cartão: 0,6 s + 2,5 s por unidade no templo; 0,4 s com uma só) e a que desliga fecha — tudo pelo _airStep do cartão, via rt.seq.
  // M3: fan (fan_mode do HA) deixa o fluxo mais forte e rápido (troca suave, sem reiniciar o ligar); swing ≠ off faz a aleta oscilar.
  _acApply(st, key, rt, nl, now) {
    const H0 = this.host, W = this._acWants(st, key), w = W.map((u) => u.on), hv = rt.hvacOn || rt.hvac;
    const col = hv === 'cool' ? 0x67d3ff : hv === 'heat' ? 0xff8a5b : 0x8ef0b0;
    this._acPrev = this._acPrev || new Map(); this._airCol = this._airCol || new Map(); this._airCol.set(key, col); this._nl = nl;
    if (this._thumbMode) {   // miniatura: o ar aparece como fica no fim, sem animar (o estado real volta no _acRestore)
      rt.on = w.some(Boolean); rt.p3sp = rt.p3spc = p3Fan((W.find((u) => u.on) || W[0] || {}).fan); rt.p3swing = W.map(() => false);
      rt.seq = { t0: now, off: w.map((on) => (on ? -1e9 : Infinity)) }; rt.snap = true; H0._airStep(rt, col, now, 0, nl, key); this._airPost(rt, now); return;
    }
    const prev = this._acPrev.get(key); this._acPrev.set(key, w);
    rt.on = w.some(Boolean);
    const first = W.find((u) => u.on) || W[0] || {}, sp = p3Fan(first.fan);
    const spChanged = rt.p3sp != null && Math.abs(sp - rt.p3sp) > 1e-3;
    rt.p3sp = sp; if (rt.p3spc == null || !prev) rt.p3spc = sp;   // alvo e valor atual (anda até o alvo no _airLoop)
    rt.p3swing = W.map((u) => !!u.on && u.swing != null && u.swing !== 'off' && u.swing !== false);
    if (!prev) { rt.seq = { t0: now, off: w.map((on) => (on ? -1e9 : Infinity)) }; rt.snap = true; H0._airStep(rt, col, now, 0, nl, key); this._airPost(rt, now); this._swingCheck(); return; }
    const same = prev.length === w.length && prev.every((x, i) => x === w[i]);
    if (same) {
      H0._airStep(rt, col, now, 0, nl, key); this._airPost(rt, now);
      if (spChanged && rt.on) { rt.airUntil = Math.max(rt.airUntil || 0, now + 8000); (this._airAnim = this._airAnim || new Set()).add(key); this._airLoop(); }   // o ar anda um pouco para mostrar a nova velocidade
      this._swingCheck(); return;
    }
    const lead = H0._reduced ? 0 : 600, stag = H0._reduced ? 0 : 2500;
    const fresh = (rt.airOrder || w.map((_, i) => i)).filter((i) => w[i] && !prev[i]), many = fresh.length > 1;
    const off = w.map((on, i) => (!on ? Infinity : fresh.includes(i) ? (many ? lead + fresh.indexOf(i) * stag : (H0._reduced ? 0 : 400)) : -1e9));
    rt.seq = { t0: now, off };
    const end = Math.max(0, ...off.filter((x) => x > -1e8 && x < Infinity));
    rt.airUntil = Math.max(rt.airUntil || 0, now + end + 2600 + 8000);
    (this._airAnim = this._airAnim || new Set()).add(key);
    this._airLoop(); this._swingCheck();
  }
  // depois do _airStep: intensidade pela velocidade e aleta oscilando (unidade ligada, aleta já aberta, sem reduced motion)
  _airPost(rt, now) {
    const k = rt.p3spc == null ? 1 : rt.p3spc, gain = 0.6 + 0.4 * k;
    if (rt.airMesh) rt.airMesh.material.uniforms.uI.value *= gain;
    if (rt.airPts) rt.airPts.material.uniforms.uI.value *= gain;
    if (!rt.p3swing || !rt.airUnits) return;
    const red = this.host._reduced;
    rt.airUnits.forEach((u, i) => {
      const fl = rt.flaps && rt.flaps[i]; if (!fl || u.f < 1 || !u.on) return;
      fl.rotation.x = rt.p3swing[i] && !red ? 0.9 + 0.3 * Math.sin(now * 0.00125 + i * 1.7) : 0.9;   // oscilando: ~5 s por vaivém (~35°–69°) · off: parada aberta
    });
  }
  // há unidade oscilando que aparece em alguma vista? (frustum + recorte do cômodo + canvas na página + aba visível)
  _swingVisible() {
    if (this.host._reduced || (typeof document !== 'undefined' && document.hidden)) return false;
    const vv = new THREE.Vector3();
    for (const key of AC_KEYS) {
      const rt = this.host._items.get(key); if (!rt || !rt.p3swing || !rt.p3swing.some(Boolean)) continue;
      for (const v of this.views) {
        if (!v.active || v.thumb || !v.c.isConnected || !v._wh) continue; const cb = v._clipBox;
        for (let i = 0; i < rt.airUnits.length; i++) {
          if (!rt.p3swing[i]) continue; const p = rt.airUnits[i].p;
          if (cb && (p.x < cb[0] || p.x > cb[2] || p.z < cb[1] || p.z > cb[3])) continue;
          vv.copy(p).project(v.cam); if (vv.z < 1 && Math.abs(vv.x) <= 1.05 && Math.abs(vv.y) <= 1.05) return true;
        }
      }
    }
    return false;
  }
  _swingCheck() { if (!this._airRaf && this._swingVisible()) this._airLoop(true); }
  // relógio dos ares (≤ 20 q/s): avança o _airStep do cartão (ligar/desligar), o fluxo andando na velocidade do fan e a aleta
  // oscilando; redesenha as vistas e para sozinho quando nada mais anda (a oscilação só conta se aparece em alguma vista)
  _airLoop(force) {
    if (this._airRaf || (!force && (!this._airAnim || !this._airAnim.size))) return;
    const H0 = this.host; this._airAnim = this._airAnim || new Set();
    const step = () => {
      const now = performance.now();
      if (typeof document !== 'undefined' && document.hidden) { this._airRaf = 0; this._airLast = 0; return; }   // volta no visibilitychange
      let more = this._airAnim.size > 0;
      if (now - (this._airLast || 0) >= 50) {
        const dt = Math.min((now - (this._airLast || now)) / 1000, 0.1); this._airLast = now;
        const swingOn = this._swingVisible(), pts = [], ended = [];
        for (const key of AC_KEYS) {
          const rt = H0._items.get(key); if (!rt || !rt.airUnits) continue;
          const anim = this._airAnim.has(key), sw = swingOn && rt.p3swing && rt.p3swing.some(Boolean);
          if (!anim && !sw) continue;
          if (rt.p3sp != null) rt.p3spc += (rt.p3sp - rt.p3spc) * (1 - Math.exp(-dt * 2.5));   // troca de velocidade suave
          const busy = H0._airStep(rt, this._airCol.get(key), now, dt, this._nl == null ? 1 : this._nl, key);
          this._airPost(rt, now);
          rt.p3t = ((rt.p3t || 0) + dt * (rt.p3spc || 1)) % 1000;   // relógio do fluxo na velocidade do fan
          if (rt.airMesh) rt.airMesh.material.uniforms.uT.value = rt.p3t; if (rt.airPts) rt.airPts.material.uniforms.uT.value = rt.p3t;
          rt.airUnits.forEach((u, i) => { if (anim || (rt.p3swing && rt.p3swing[i])) pts.push(u.p); });
          if (anim && !busy && now > (rt.airUntil || 0) && Math.abs((rt.p3sp || 1) - (rt.p3spc || 1)) < 0.01) { this._airAnim.delete(key); ended.push(key); }
        }
        more = this._airAnim.size > 0 || swingOn;
        const vv = new THREE.Vector3();
        for (const v of this.views) {
          if (v.thumb || !v._wh || !v.c.isConnected) continue;
          const cb = v._clipBox, sees = pts.some((p) => { if (cb && (p.x < cb[0] || p.x > cb[2] || p.z < cb[1] || p.z > cb[3])) return false; vv.copy(p).project(v.cam); return vv.z < 1 && Math.abs(vv.x) <= 1.05 && Math.abs(vv.y) <= 1.05; });
          if (!sees) continue;
          if (v.active) this._queueNow(v, true); else v._stale = true;
        }
        if (ended.length) for (const v of this.views) if (v.thumb) { if (v.active) this._queueNow(v, true); else v._stale = true; }   // miniaturas: uma vez no fim
      }
      if (more) this._airRaf = requestAnimationFrame(step); else { this._airRaf = 0; this._airLast = 0; }
    };
    this._airRaf = requestAnimationFrame(step);
  }

  // estado da vista (luzes, mezanino, luz que segue o cômodo, conjunto de luzes do media) e cortes
  _prep(v) {
    const H0 = this.host;
    H0._camera = v.cam; H0._topView = v.el >= 62;
    if (H0._mezz) H0._mezz.visible = !H0._topView && !(v._cutRoom && ['wcs'].includes(v._cutRoom));
    for (const f of this._free) if (f.hid) { f.o.visible = true; f.hid = false; }
    this._apply(v.state ? v.state() : { lights: {}, night: true });
    const cb = v._clipBox;
    if (cb) for (const f of this._free) if (f.o.visible && (f.x < cb[0] - f.r || f.x > cb[2] + f.r || f.z < cb[1] - f.r || f.z > cb[3] + f.r)) { f.o.visible = false; f.hid = true; }
    if (H0._roomLight) { H0._orbit = { target: v.target }; H0._walkOn = false; H0._roomLightTick(this._dayScale || 1); }
    if (H0._pool) { H0._assignPool(); for (const it of ITEMS) { const rt = H0._items.get(it.key); if (rt && rt.cands) for (const { L, i } of rt.lights) { L.intensity = i * (rt.lv || 0) * (this._dayScale || 1); L.color.copy(rt.color); } } }
    if (H0._needShadow) { this.renderer.shadowMap.needsUpdate = true; H0._needShadow = false; }
    this._applyCuts(v);
    if (this._cutMats) for (const [o, c] of this._cutMats) {
      if (o.emissive) { c.emissive.copy(o.emissive); c.emissiveIntensity = o.emissiveIntensity; }
      c.opacity = o.opacity; c.visible = o.visible; if (c.envMap !== o.envMap) { c.envMap = o.envMap; c.needsUpdate = true; } c.envMapIntensity = o.envMapIntensity;
    }
  }

  _queue(v, force) {
    if (!v.active || (typeof document !== 'undefined' && document.hidden)) { v._stale = true; return; }
    if (v.thumb && v.drawn && !force) {   // miniatura: junta as mudanças por 500 ms
      if (!v._tq) v._tq = setTimeout(() => { v._tq = 0; this._queueNow(v, false); }, 500);
      return;
    }
    this._queueNow(v, force);
  }
  _queueNow(v, force) {
    if (!v.active) { v._stale = true; return; }
    this._dirty.set ? null : (this._dirty = new Map());
    this._dirty.set(v, !!(force || this._dirty.get(v)));
    if (!this._raf) this._raf = requestAnimationFrame(() => {
      this._raf = 0; const L = [...this._dirty]; this._dirty.clear();
      for (const [x, f] of L) { try { this._draw(x, f); } catch (e) { console.warn('igreja-painel-3d: render', e); } }
    });
  }
  // assinatura do que a vista mostra: sem mudança de estado, câmera, tamanho ou corte, não redesenha (repouso = custo zero)
  _sigOf(v, pw, ph) {
    const e = v.cam.matrixWorld.elements, st = v.state ? v.state() : null;
    return JSON.stringify(st) + '|' + e.map((x) => x.toFixed(4)).join(',') + '|' + pw + 'x' + ph + '|' + (v._cutRoom || '') + '|' + v.zoom + '|' + this._gen;
  }
  _draw(v, force) {
    if (!this.scene || !v.c.isConnected || !v.active) return;
    if (!v._sync()) return;
    const [w, h] = v._wh, s = v._size().s || 1, dpr = window.devicePixelRatio || 1;
    // resolução: até 1,5× nas vistas grandes, até 1× nas miniaturas (que também podem ir menores com res < 1)
    let k = v.thumb ? Math.min(1, s * dpr) * Math.min(1, v.o.res || 1) : s * Math.min(1.5, dpr) * Math.min(v.o.res || 1, 1.5);
    const maxW = v.o.maxPx || 1800; if (w * k > maxW) k = maxW / w;
    const pw = Math.max(2, Math.round(w * k)), ph = Math.max(2, Math.round(h * k));
    const sig = this._sigOf(v, pw, ph);
    if (!force && sig === v._sig && !v._stale) return;
    v._sig = sig; v._stale = false;
    if (v.c.width !== pw || v.c.height !== ph) { v.c.width = pw; v.c.height = ph; }
    const R = this.renderer, cv = R.domElement;
    if (cv.width < pw || cv.height < ph) R.setSize(Math.max(cv.width, pw), Math.max(cv.height, ph), false);
    const saved = v.thumb ? this._acSave() : null;   // miniatura com estado de cena: o ar dela não pode disparar/atrapalhar a animação das outras
    if (saved) this._thumbMode = true;
    try {
      this._prep(v);
      R.clippingPlanes = v._clip || [];
      R.setViewport(0, 0, pw, ph); R.setScissor(0, 0, pw, ph); R.setScissorTest(true);
      R.render(this.scene, v.cam);
      R.clippingPlanes = [];
    } finally { if (saved) { this._thumbMode = false; this._acRestore(saved); } }
    v.g2.clearRect(0, 0, pw, ph);
    v.g2.drawImage(cv, 0, cv.height - ph, pw, ph, 0, 0, pw, ph);
    v.drawn = (v.drawn || 0) + 1;
    if (!this._airRaf && this._acPrev && !v.thumb) this._swingCheck();
  }
  // estado temporal dos ares (o resto do _apply é instantâneo): guardado em volta do desenho de uma miniatura
  _acSave() {
    const H0 = this.host, out = { keys: [], prev: this._acPrev ? new Map(this._acPrev) : null, key: this._key };
    for (const key of AC_KEYS) {
      const rt = H0._items.get(key); if (!rt || !rt.airUnits) continue;
      out.keys.push([key, rt, { U: rt.airUnits.map((u) => [u.led, u.f, u.g, u.on, u.ign]), seq: rt.seq, on: rt.on, hvac: rt.hvac, hvacOn: rt.hvacOn,
        p3sp: rt.p3sp, p3spc: rt.p3spc, p3swing: rt.p3swing, airUntil: rt.airUntil, col: this._airCol && this._airCol.get(key) }]);
    }
    return out;
  }
  _acRestore(sv) {
    const H0 = this.host, now = performance.now();
    for (const [key, rt, d] of sv.keys) {
      rt.airUnits.forEach((u, i) => { [u.led, u.f, u.g, u.on, u.ign] = d.U[i]; });
      Object.assign(rt, { seq: d.seq, on: d.on, hvac: d.hvac, hvacOn: d.hvacOn, p3sp: d.p3sp, p3spc: d.p3spc, p3swing: d.p3swing, airUntil: d.airUntil, snap: false });
      if (d.col != null) { this._airCol.set(key, d.col); H0._airStep(rt, d.col, now, 0, this._nl == null ? 1 : this._nl, key); this._airPost(rt, now); }
    }
    if (sv.prev) this._acPrev = sv.prev;
    this._key = null;   // a próxima vista normal reaplica as luzes do estado dela
  }
  }
}
