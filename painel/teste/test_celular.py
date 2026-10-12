#!/usr/bin/env python3
"""Layout de celular do igreja-painel-card (v1.3.0): coluna com rolagem, abas embaixo, sem rolagem lateral, gavetas.
uso: <python com playwright> painel/teste/test_celular.py <pasta-dos-pngs> [url]   (servir a raiz do repo por HTTP)"""
import sys, pathlib
from playwright.sync_api import sync_playwright
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
url = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8766/painel.html'
R = "window.__card.shadowRoot"; fal = 0
def ok(c, msg):
    global fal; fal += not c; print(('ok   ' if c else 'FALHA'), msg)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist'])
    for nome, (w, h) in {'retrato': (390, 844), 'deitado': (844, 390), 'pequeno': (360, 640)}.items():
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_function('window.__pronto === true && window.__card && window.__card._p3room', timeout=120000); pg.wait_for_timeout(3000)
        app = f"{R}.getElementById('app')"
        ok(pg.evaluate(f"{app}.classList.contains('m')"), f'[{nome}] modo celular ligado')
        for n, sec in [('home', 'stats'), ('rooms', 'amb'), ('templo', 'tpl'), ('ares', 'ares')]:
            pg.evaluate(f"{R}.querySelector('[data-nav={n}]').click()"); pg.wait_for_timeout(700)
            vis = pg.evaluate(f"getComputedStyle({R}.querySelector('.{sec}')).display !== 'none'")
            over = pg.evaluate(f"{app}.scrollWidth - {app}.clientWidth")
            ok(vis and over <= 1, f'[{nome}] aba {n}: seção visível e sem rolagem lateral (sobra {over}px)')
            pg.screenshot(path=str(out / f'{nome}-{n}.png'))
        nav = pg.evaluate(f"(()=>{{const r={R}.querySelector('.side').getBoundingClientRect();return [r.top,r.bottom]}})()")
        ok(abs(nav[1] - h) <= 1, f'[{nome}] abas presas embaixo {nav}')
        pg.evaluate(f"{R}.querySelector('[data-pop=fan]').click()"); pg.wait_for_timeout(400)
        pr = pg.evaluate(f"(()=>{{const r={R}.getElementById('pop').getBoundingClientRect();return [r.left,r.right,r.top,r.bottom]}})()")
        ok(pr[0] >= 0 and pr[1] <= w and pr[2] >= 0 and pr[3] <= h, f'[{nome}] seletor de velocidade dentro da tela {[round(x) for x in pr]}')
        ok(not errs, f'[{nome}] sem erros {errs[:1]}'); ctx.close()
    # desktop continua no desenho 1280×800 escalado
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}); pg = ctx.new_page()
    pg.goto(url); pg.wait_for_function('window.__pronto === true && window.__card && window.__card._p3room', timeout=120000); pg.wait_for_timeout(2000)
    ok(not pg.evaluate(f"{R}.getElementById('app').classList.contains('m')"), '[desktop] layout de painel (sem modo celular)')
    b.close()
print(f'{fal} falha(s)'); sys.exit(1 if fal else 0)
