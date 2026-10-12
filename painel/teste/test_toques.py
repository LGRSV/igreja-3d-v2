"""Toque em todas as luminárias e ares de cada cômodo (vista do cômodo com corte), via points() + project() + pickAt().
Uso: THREE_LOCAL=… python test_toques.py [png]"""
import sys, json
from run import run
JS = r"""(() => {
  const m = MOD, E = V.E, v = V.cut, keys = ['palco','plateia','hall','fachada','estacionamento','pastoral','recepcao','administrativo','circulacao','midia','voluntariado','cozinha','banheiros','ac_templo','ac_pastoral','ac_midia','ac_voluntariado','telao','som'];
  const res = { ok: 0, falhas: [], vistos: 0 };
  for (const [id, r] of Object.entries(m.ROOMS3D)) {
    v.frame(...r); v.cut(id); E._prep(v);
    const [w, h] = v._wh;
    for (const k of keys) for (const p of E.points(k)) {
      if (p[0] < r[0] - 0.05 || p[0] > r[2] + 0.05 || p[2] < r[1] - 0.05 || p[2] > r[3] + 0.05) continue;
      if (id === 'hall' && p[0] < 4.1 && p[2] > 44.0 && p[1] < 3.05) continue;   // sob a laje do mezanino (visível no Hall): coberta de verdade
      const [x, y] = v.project(p); if (x < 2 || y < 2 || x > w - 2 || y > h - 2) continue;
      res.vistos++;
      const g = v.pickAt(x, y);
      if (g && (g.key === k || (g.key || '').startsWith(k + '_'))) res.ok++; else res.falhas.push([id, k, p.map(n => +n.toFixed(2)), g && [g.kind, g.key]]);
    }
  }
  v.frame(...m.ROOMS3D.midia); v.cut('midia');
  return res;
})()"""
r = run('http://painel.test/painel/teste/motor.html', sys.argv[1] if len(sys.argv) > 1 else 'toques.png', JS, 1500)
x = r['res']; print('erros:', r['errs']); print(f"toques certos {x['ok']}/{x['vistos']}")
for f in x['falhas']: print('  FALHA', f)
sys.exit(1 if r['errs'] or x['falhas'] else 0)
