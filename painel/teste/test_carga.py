"""Carga do motor por segundo (o que pesa no PC): desenhos/s e ms de render/s (CPU + GPU, com finish) em repouso, durante a
animação de ligar o ar e com o swing oscilando; com e sem vistas inativas. Uso: THREE_LOCAL=… python test_carga.py [alta,media]"""
import sys, json
from run import run
JS = r"""(async () => {
  const E = V.E, R = E.renderer, gl = R.getContext(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let n = 0, ms = 0; const d0 = E._draw.bind(E);
  E._draw = (v, f) => { const t = performance.now(); const r = d0(v, f); gl.finish(); ms += performance.now() - t; n++; return r; };
  const win = async (t) => { n = 0; ms = 0; await sleep(t); return { draws_s: +(n * 1000 / t).toFixed(1), ms_s: +(ms * 1000 / t).toFixed(1) }; };
  const all = [V.plan, V.room, V.cut, V.mini], tick = () => all.forEach((v) => v.render());
  const hass = setInterval(tick, 1000);   // o cartão chama render() a cada atualização do HA (aqui 1/s, sem mudança de estado)
  await sleep(500);
  const out = {};
  out.repouso = await win(3000);
  window.S.ac = { ac_templo: { on: false } }; tick(); await sleep(2800);
  window.S.ac = { ac_templo: { on: true, mode: 'cool' } }; tick();
  out.animando = await win(3000);
  await sleep(11000);
  window.S.ac = { ac_templo: { on: true, mode: 'cool', swing: 'vertical' } }; tick(); await sleep(500);
  out.swing = await win(3000);
  if (V.plan.setActive) { V.plan.setActive(false); V.mini.setActive(false); await sleep(300); out.swing_2inativas = await win(3000); }
  clearInterval(hass);
  return out;
})()"""
for q in (sys.argv[1] if len(sys.argv) > 1 else 'alta,media').split(','):
    r = run(f'http://painel.test/painel/teste/motor.html?q={q}', f'carga-{q}.png', JS, 800)
    print(q, 'erros:', r['errs'][:2], json.dumps(r['res']))
