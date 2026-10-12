"""Teste headless do motor (Playwright Python + Chrome). Uso: python run.py <saida.png> [js extra] [espera_ms]
Serve a pasta do worktree em http://painel.test/ e o Three.js de THREE_LOCAL (ou da rede)."""
import sys, os, json, mimetypes, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
THREE = os.environ.get('THREE_LOCAL')
def serve(route):
    url = route.request.url
    if 'cdn.jsdelivr.net/npm/three@' in url and THREE:
        return route.fulfill(body=open(THREE, 'rb').read(), content_type='text/javascript')
    if url.startswith('http://painel.test/'):
        p = ROOT / url[len('http://painel.test/'):].split('?')[0]
        if p.is_file(): return route.fulfill(body=p.read_bytes(), content_type=mimetypes.guess_type(str(p))[0] or 'text/javascript')
        return route.fulfill(status=404, body='')
    return route.continue_()
def run(page_url, out, js=None, wait=1500, w=1390, h=880):
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu'])
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        errs, logs = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: (errs if m.type == 'error' else logs).append(m.text))
        pg.route('**/*', serve)
        pg.goto(page_url)
        pg.wait_for_function('window.READY === true', timeout=240000)
        pg.wait_for_timeout(wait)
        res = pg.evaluate(js) if js else None
        ck = pg.evaluate('window.__clickAt || null')
        if ck:
            pg.mouse.move(ck[0], ck[1]); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(300)
            res = {'js': res, 'click': ck, 'hits': pg.evaluate('window.HITS')}
        pg.wait_for_timeout(600)
        pg.screenshot(path=out)
        b.close()
        return {'errs': errs, 'logs': logs[-12:], 'res': res}
if __name__ == '__main__':
    out = sys.argv[1]; q = sys.argv[4] if len(sys.argv) > 4 else ''
    r = run('http://painel.test/painel/teste/motor.html' + q, out, sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None, int(sys.argv[3]) if len(sys.argv) > 3 else 1500)
    print(json.dumps(r, ensure_ascii=False, indent=1)[:6000])
