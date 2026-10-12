"""Ares: carga sem animação, um split do templo sozinho anima (só ele), desligar fecha, todos ligam escalonados; points/pickAt por unidade.
Uso: THREE_LOCAL=… python test_ar.py [png]"""
import sys, json
from run import run
JS = r"""(async () => {
  const E = V.E, H = E.host, rt = H._items.get('ac_templo'), U = rt.airUnits, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => U.map((u) => [+u.led.toFixed(2), +u.f.toFixed(2), +u.g.toFixed(2)]);
  const idx = (n) => E._unitIdx('ac_templo', n), go = () => { V.room.render(); V.plan.render(); };
  const out = {};
  out.carga = { anim: E._airAnim ? E._airAnim.size : 0, u: snap() };            // carga com o ar ligado: todas abertas, sem animação
  window.S.ac = { ac_templo: { on: false } }; go(); await sleep(150);
  out.desligando = { anim: E._airAnim.size, u: snap() };
  await sleep(2600); out.desligado = snap();
  window.S.ac = { ac_templo: { on: false }, ac_templo_2: { on: true, mode: 'cool' } }; go();
  await sleep(250); out.um_250ms = snap();
  await sleep(500); out.um_750ms = snap();
  await sleep(2800); out.um_3s = snap(); out.idx2 = idx(2);
  out.ordem = [1, 2, 3, 4, 5].map((n) => E.points('ac_templo_' + n)[0].map((x) => +x.toFixed(2)));
  V.cut.frame(...MOD.ROOMS3D.templo); V.cut.cut('templo'); E._prep(V.cut); out.pick = [1, 2, 3, 4, 5].map((n) => { const [px, py] = V.cut.project(E.points('ac_templo_' + n)[0]); const h = V.cut.pickAt(px, py); return h && h.key; });
  window.S.ac = { ac_templo: { on: true, mode: 'heat' } }; go();
  await sleep(1300); out.todos_1300ms = snap();
  await sleep(11500); out.todos_13s = snap(); out.anim_fim = E._airAnim.size;
  await sleep(9000); out.anim_depois = E._airAnim.size;
  // M3 — velocidade: fan low × high (força = uI, rapidez = quanto o relógio do fluxo anda em 1 s)
  const fl = rt.airMesh.material.uniforms, rate = async () => { const a = fl.uT.value; await sleep(1000); return +(fl.uT.value - a).toFixed(3); };
  window.S.ac = { ac_templo: { on: true, mode: 'heat', fan: 'low' } }; go(); await sleep(2500);
  out.low = { uI: +fl.uI.value.toFixed(3), rate: await rate(), sem_reiniciar: snap().every((u) => u[1] > 0.95) };
  window.S.ac = { ac_templo: { on: true, mode: 'heat', fan: 'high' } }; go(); await sleep(2500);
  out.high = { uI: +fl.uI.value.toFixed(3), rate: await rate(), sem_reiniciar: snap().every((u) => u[1] > 0.95) };
  // M3 — aleta: swing no split 2 (oscila), os outros parados; off → para aberta
  const i2 = idx(2), ang = () => rt.flaps.map((f) => +f.rotation.x.toFixed(3));
  window.S.ac = { ac_templo: { on: true, mode: 'heat' }, ac_templo_2: { on: true, mode: 'heat', swing: 'vertical' } }; go(); await sleep(400);
  const a1 = ang(); await sleep(1300); const a2 = ang();
  out.swing = { a1, a2, i2, raf: !!E._airRaf };
  window.S.ac = { ac_templo: { on: true, mode: 'heat' }, ac_templo_2: { on: true, mode: 'heat', swing: 'off' } }; go(); await sleep(600);
  const b1 = ang(); await sleep(1300); out.swing_off = { b1, b2: ang() };
  // oscilando mas fora de todas as vistas: o relógio para
  window.S.ac = { ac_templo: { on: true, mode: 'heat', swing: 'on' } }; go(); await sleep(300);
  for (const v of [V.plan, V.room, V.cut, V.mini]) { v.frame(...MOD.ROOMS3D.midia); v.cut('midia'); }
  await sleep(10500); out.fora = { raf: !!E._airRaf, anim: E._airAnim.size };
  V.room.frame(...MOD.ROOMS3D.templo); V.room.cut(null); await sleep(400); out.volta = !!E._airRaf;
  return out;
})()"""
r = run('http://painel.test/painel/teste/motor.html', sys.argv[1] if len(sys.argv) > 1 else 'ar.png', JS, 800)
x = r['res']; fails = []
def ck(n, c, i=''):
    print(('ok   ' if c else 'FALHA') + ' ' + n + ('' if c else f'  {i}'))
    if not c: fails.append(n)
on = lambda u: u[0] > 0.5 and u[1] > 0.5 and u[2] > 0.5
off = lambda u: u[0] < 0.05 and u[1] < 0.05 and u[2] < 0.05
ck('sem erros', not r['errs'], r['errs'])
ck('carga: 5 unidades abertas e nenhuma animação', x['carga']['anim'] == 0 and all(on(u) for u in x['carga']['u']), x['carga'])
ck('desligar anima (fechando)', x['desligando']['anim'] == 1 and any(not off(u) for u in x['desligando']['u']), x['desligando'])
i2 = x['idx2']
ck('desligado: tudo fechado', all(off(u) for u in x['desligado']), x['desligado'])
ck('um split: as outras não reagem (250 ms)', all(off(u) for k, u in enumerate(x['um_250ms']) if k != i2), x['um_250ms'])
ck('um split: só o 2 começou (LED aceso, 750 ms)', x['um_750ms'][i2][0] > 0.5 and all(off(u) for k, u in enumerate(x['um_750ms']) if k != i2), x['um_750ms'])
ck('um split: só o 2 aberto e com fluxo (3 s)', on(x['um_3s'][i2]) and all(off(u) for k, u in enumerate(x['um_3s']) if k != i2), x['um_3s'])
zs = [p[2] for p in x['ordem']]
ck('numeração da esquerda para a direita (z crescente)', zs == sorted(zs), x['ordem'])
ck('pickAt em cada split → ac_templo_N', x['pick'] == ['ac_templo_%d' % n for n in range(1, 6)], x['pick'])
ck('todos: escalonados (1,3 s: 1 ou 2 com LED)', 1 <= sum(1 for u in x['todos_1300ms'] if u[0] > 0.5) <= 2, x['todos_1300ms'])
ck('todos: abertos depois de 13 s', all(on(u) for u in x['todos_13s']), x['todos_13s'])
ck('animação para sozinha depois', x['anim_depois'] == 0, x['anim_depois'])
lo, hi = x['low'], x['high']
ck('fan high: fluxo mais forte que low', hi['uI'] > lo['uI'] * 1.2, [lo, hi])
ck('fan high: fluxo mais rápido que low', hi['rate'] > lo['rate'] * 1.8, [lo, hi])
ck('trocar o fan não reinicia o ligar (aletas abertas)', lo['sem_reiniciar'] and hi['sem_reiniciar'], [lo, hi])
sw = x['swing']; j = sw['i2']
ck('swing on: a aleta do split 2 muda de ângulo', abs(sw['a1'][j] - sw['a2'][j]) > 0.05, sw)
ck('swing on: as outras aletas paradas', all(abs(sw['a1'][k] - sw['a2'][k]) < 1e-3 for k in range(5) if k != j), sw)
so = x['swing_off']
ck('swing off: aleta parada aberta na posição normal', all(abs(a - b) < 1e-3 and abs(a - 0.9) < 0.02 for a, b in zip(so['b1'], so['b2'])), so)
ck('oscilação fora de todas as vistas: relógio parado', not x['fora']['raf'], x['fora'])
ck('volta a oscilar quando aparece numa vista', x['volta'], x['volta'])
print('\n' + ('TUDO OK' if not fails else f'{len(fails)} FALHA(S)')); sys.exit(1 if fails else 0)
