"""Desempenho do motor por qualidade: tempo do ready(), draw calls/triângulos e tempo de quadro por vista (média de 10 desenhos).
Uso: THREE_LOCAL=… python test_perf.py"""
import sys, json
from run import run
JS = r"""(() => {
  const E = V.E, R = E.renderer, out = { ready: Math.round(window.T_READY), luzes: E.host._nLights, vistas: {} };
  for (const [n, v] of Object.entries({ planta: V.plan, templo: V.room, corte: V.cut, mini: V.mini })) {
    E._draw(v); const ts = [];
    for (let i = 0; i < 10; i++) { v.az += 3; v._place(...v._wh); const t = performance.now(); E._draw(v); R.getContext().finish(); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    out.vistas[n] = { px: [v.c.width, v.c.height], ms_med: +ts[5].toFixed(1), ms_max: +ts[9].toFixed(1), calls: R.info.render.calls, tris: R.info.render.triangles };
  }
  out.programas = R.info.programs.length; out.geom = R.info.memory.geometries; out.tex = R.info.memory.textures;
  return out;
})()"""
res = {}
for q in ['alta', 'media', 'leve', 'min']:
    r = run(f'http://painel.test/painel/teste/motor.html?q={q}', f'perf-{q}.png', JS, 1200)
    res[q] = r['res']; print(q, 'erros:', r['errs'][:2]); print(json.dumps(r['res'], ensure_ascii=False))
