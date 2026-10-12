// Stub do motor igreja-painel-3d.js (mesma API do contrato no PLANO.md) para testar o cartão sem o motor de verdade.
// Desenha a planta 2D do próprio cartão (window.__igrejaFlatEngine) e registra as chamadas em window.__stubLog.
export const VERSION = '0.0.0-stub';
export const PLAN3D = [-3, 0, 23, 60, 90, 58];
export const ROOMS3D = { templo: [0, 12.4, 16.05, 44.0, 90, 46], midia: [16.05, 23.3, 18.9, 28.0, 0, 55], pastoral: [12.75, 0, 20.1, 11.0, 0, 55] };
export const BLOCKS3D = { templo: [0, 12.4, 16.05, 44.0, 90, 46], operacional: [16.05, 11.0, 20.1, 33.9, 90, 55], banheiro: [16.05, 33.9, 20.1, 49.5, 90, 55],
  pastoral: [0, 0, 20.1, 12.4, 0, 55], hall: [-3, 44.0, 23, 60, 90, 50] };
const log = (...a) => (window.__stubLog = window.__stubLog || []).push(a);
export class IgrejaPainel3D {
  static shared(opts) { return window.__igrejaPainel3D || (window.__igrejaPainel3D = new IgrejaPainel3D(opts)); }
  constructor(opts) { this.opts = opts; log('shared', opts); this.flat = window.__igrejaFlatEngine.shared(); }
  ready() { return Promise.resolve(this); }
  view(canvas, o) {
    const v = this.flat.view(canvas, o), frame = v.frame.bind(v), cut = v.cut.bind(v);
    v.frame = (...f) => { log('frame', canvas.parentNode && canvas.parentNode.id, f); frame(...f); };
    v.cut = (id) => { log('cut', canvas.parentNode && canvas.parentNode.id, id); cut(id); };
    log('view', canvas.parentNode && canvas.parentNode.id, !!o.interactive); return v;
  }
  points(k) { return this.flat.points(k); }
}
