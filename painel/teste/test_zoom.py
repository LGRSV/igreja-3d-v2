#!/usr/bin/env python3
"""Paredes x zoom: na vista do cômodo/bloco, aproximar não pode derrubar mais paredes do que a vista sem zoom.
uso: <python com playwright> painel/teste/test_zoom.py <pasta-dos-pngs> [url]   (servir a raiz do repo por HTTP)"""
import sys, pathlib
from playwright.sync_api import sync_playwright
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
url = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8766/painel.html'
JS = """async ([id, z]) => { const c = window.__card, v = c._p3room; v.frame(...(window.__R[id])); v.setZoom(z);
  await new Promise(r => setTimeout(r, 900)); const E = window.__igrejaPainel3D;
  return E.segs.filter(s => s.cut).length; }"""
fal = 0
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_function('window.__pronto === true && window.__card && window.__card._p3room', timeout=90000); pg.wait_for_timeout(5000)
    pg.evaluate("async () => { const m = await import('./igreja-painel-3d.js?v=1.0.1'); window.__R = Object.assign({}, m.ROOMS3D, m.BLOCKS3D); }")
    for id in ['templo', 'operacional', 'hall', 'midia', 'pastoral']:
        ns = []
        for z in [1, 1.6, 2.5, 4]:
            ns.append(pg.evaluate(JS, [id, z]))
            pg.screenshot(path=str(out / f'zoom-{id}-{z}.png'))
        ok = all(n <= ns[0] for n in ns[1:])
        fal += not ok
        print(('ok  ' if ok else 'FALHA'), id, 'paredes cortadas por zoom 1/1.6/2.5/4:', ns)
    print('erros:', errs or 'nenhum'); b.close()
print(f'{fal} falha(s)'); sys.exit(1 if fal else 0)
