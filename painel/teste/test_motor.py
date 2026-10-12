"""Teste headless do motor igreja-painel-3d.js (Playwright Python + Chrome instalado).
Uso: THREE_LOCAL=/caminho/three.module.min.js python test_motor.py [pasta-dos-pngs]
Verifica: API do contrato exportada, planta + cômodo + corte renderizados sem erro, pickAt numa luminária/ar/telão/som/piso,
clique real com onClick, corte no cômodo (nada fora dele é tocável) e as qualidades leve/min."""
import sys, json, pathlib
from run import run
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.'); out.mkdir(parents=True, exist_ok=True)
URL = 'http://painel.test/painel/teste/motor.html'
JS = (pathlib.Path(__file__).parent / 'pick.js').read_text()
API = """(() => { const m = MOD, E = V.E, v = V.plan; return {
  exports: ['VERSION','ROOMS3D','BLOCKS3D','PLAN3D','IgrejaPainel3D'].filter(k => !(k in m)),
  blocks: Object.keys(m.BLOCKS3D).sort(), rooms: Object.keys(m.ROOMS3D).length, plan: m.PLAN3D,
  shared: m.IgrejaPainel3D.shared() === E && window.__igrejaPainel3D === E,
  viewApi: ['frame','project','pick','pickAt','setZoom','onCam','onClick','cut','dispose'].filter(k => typeof v[k] !== 'function'),
  drawn: [V.plan.drawn, V.room.drawn, V.cut.drawn, V.mini.drawn], proj: v.project([10, 0, 30]).map(Math.round) }; })()"""
fails = []
def check(name, cond, info=''):
    print(('ok   ' if cond else 'FALHA') + ' ' + name + (f'  {info}' if info and not cond else ''))
    if not cond: fails.append(name)

r = run(URL, str(out / 'motor-alta.png'), API, 1500)
a = r['res']; check('sem erros (alta)', not r['errs'], r['errs'])
check('exports do contrato', a['exports'] == [], a['exports'])
check('BLOCKS3D = 5 blocos v1.8', a['blocks'] == sorted(['templo', 'operacional', 'banheiro', 'pastoral', 'hall']), a['blocks'])
check('singleton shared()', a['shared'])
check('métodos da P3View', a['viewApi'] == [], a['viewApi'])
check('4 vistas desenhadas', all(d and d >= 1 for d in a['drawn']), a['drawn'])
r = run(URL, str(out / 'motor-pick.png'), JS, 1500)
p = r['res']['js']; h = lambda k: p[k]['hit'] or {}
check('pickAt luminária da plateia', h('room_highbay').get('kind') == 'light' and h('room_highbay').get('key') == 'plateia', p['room_highbay'])
check('pickAt moving head do palco', h('room_moving').get('key') == 'palco', p['room_moving'])
check('pickAt telão', h('room_telao').get('kind') == 'telao', p['room_telao'])
check('pickAt ar do templo', h('room_ac').get('kind') == 'ac' and (h('room_ac').get('key') or '').startswith('ac_templo_'), p['room_ac'])
check('pickAt som', h('room_som').get('kind') == 'som', p['room_som'])
check('pickAt piso = cômodo', h('room_piso').get('kind') == 'room' and h('room_piso').get('room') == 'templo', p['room_piso'])
check('pickAt luz do hall na planta', h('plan_hall_luz').get('key') == 'hall', p['plan_hall_luz'])
check('pickAt cômodo na planta', h('plan_voluntariado').get('room') == 'voluntariado' and h('plan_cozinha').get('room') == 'cozinha')
check('corte: luz e ar da mídia', h('cut_midia_luz').get('key') == 'midia' and h('cut_ac_midia').get('key') == 'ac_midia', [p['cut_midia_luz'], p['cut_ac_midia']])
hits = r['res']['hits']
check('clique real → onClick(px, py, hit)', hits and hits[-1][0] == 'plan' and (hits[-1][1] or {}).get('key') == 'hall', hits)
check('points(): 12 high-bays e 5 ares', p['points_plateia'] == 12 and len(p['points_ac']) == 5)
CUT = """(() => { const v = V.cut, [w, h] = v._wh; let fora = 0, n = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) { const g = v.pickAt(w * (i + 0.5) / 12, h * (j + 0.5) / 8); if (g) { n++; if (g.room !== 'cozinha') fora++; } }
  return { n, fora }; })()"""
r = run(URL + '?q=leve&dia=1&room=cozinha', str(out / 'motor-leve-cozinha.png'), CUT, 1500)
check('sem erros (leve, dia)', not r['errs'], r['errs'])
check('corte no cômodo: só a cozinha é tocável', r['res']['n'] > 10 and r['res']['fora'] == 0, r['res'])
r = run(URL + '?q=min&room=hall', str(out / 'motor-min-hall.png'), '1', 1500)
check('sem erros (min)', not r['errs'], r['errs'])
print('\n' + ('TUDO OK' if not fails else f'{len(fails)} FALHA(S): ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
