#!/usr/bin/env python3
"""Testa o igreja-painel-card com hass simulado (nada real é chamado) no Chrome instalado.
uso: ~/igreja-3d/.orquestra/venv/bin/python tools/painel/teste_cartao.py [pasta-de-saida] [motor.js]
Roda duas vezes: com o motor (stub, ou o arquivo indicado) e sem motor (planta 2D de reserva). Grava screenshots e sai com erro se algo falhar."""
import sys, pathlib, shutil, tempfile, threading, functools, http.server, json
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent; ROOT = HERE.parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='igp-')); OUT.mkdir(parents=True, exist_ok=True)
MOTOR = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / 'igreja-painel-3d.stub.js'
fails = []
def ok(c, msg):
    print(('ok   ' if c else 'FALHA ') + msg)
    if not c: fails.append(msg)

def serve(d):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Q, directory=str(d))
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

def run(mode):
    d = pathlib.Path(tempfile.mkdtemp(prefix='igp-www-'))
    shutil.copy(ROOT / 'igreja-painel-card.js', d); shutil.copy(HERE / 'teste.html', d)
    if mode == 'motor': shutil.copy(MOTOR, d / 'igreja-painel-3d.js')
    srv = serve(d); base = f'http://127.0.0.1:{srv.server_address[1]}/teste.html?cfg=' + '{"alexa_device":"dev1","height":"100vh"}'
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800}); logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}')); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.goto(base)
        try: pg.wait_for_function('window.__ready', timeout=8000)
        except Exception: print('\n'.join(logs)); raise
        pg.wait_for_timeout(2500)
        E = lambda js: pg.evaluate(js)
        R = "window.__card.shadowRoot"
        ok(any('IGREJA-PAINEL-CARD' in l for l in logs), f'[{mode}] carregou e imprimiu a versão')
        eng = E("window.__card._p3 === window.__igrejaFlat2D ? 'flat' : 'motor'")
        ok(eng == ('flat' if mode == 'flat' else 'motor'), f'[{mode}] motor em uso: {eng}')
        if mode == 'motor': ok(E("(window.__stubLog||[]).filter(x=>x[0]==='view').length") in (9, None) or MOTOR.name != 'igreja-painel-3d.stub.js', f'[{mode}] 9 vistas criadas no motor')
        # encaixe: ocupa a área toda
        fit = E(f"(()=>{{const a={R}.getElementById('app').getBoundingClientRect();return [a.width,a.height]}})()")
        ok(abs(fit[0] - 1280) < 2 and abs(fit[1] - 800) < 2, f'[{mode}] 1280×800 ocupa tudo {fit}')
        pg.screenshot(path=str(OUT / f'{mode}-inicio.png'))
        # cena Culto
        E("window.__calls.length=0"); E(f"{R}.querySelector('.scene[data-s=culto]').click()")
        calls = E("window.__calls")
        ok(any(c[0] == 'light' and c[1] == 'turn_on' and c[2].get('entity_id') == 'light.palco_rgb' and c[2].get('rgb_color') for c in calls), f'[{mode}] Culto acende o palco com cor')
        ok(any(c[0] == 'climate' and c[1] == 'set_hvac_mode' and c[2]['entity_id'] == 'climate.ar_templo' for c in calls), f'[{mode}] Culto liga o ar do templo')
        ok(any(c[0] == 'media_player' and c[1] == 'turn_on' for c in calls) and any(c[0] == 'switch' and c[2]['entity_id'] == 'switch.som_templo' for c in calls), f'[{mode}] Culto liga telão e som')
        ok(E(f"{R}.querySelector('.scene[data-s=culto]').classList.contains('on')"), f'[{mode}] cena marcada como ativa')
        pg.wait_for_timeout(800)
        ok(E("window.__card.S.on.palco && window.__card.S.on.ac_templo"), f'[{mode}] estado confirmado pelo hass')
        # aparelho do bloco selecionado (Templo) e modal do palco
        E("window.__calls.length=0"); E(f"{R}.querySelector('#ctrls [data-t=som]').click()")
        ok(E("window.__calls.some(c=>c[1]==='turn_off'&&c[2].entity_id==='switch.som_templo')"), f'[{mode}] interruptor do som desliga')
        E(f"{R}.querySelector('#ctrls .gl[data-k=palco]').click()")
        ok(E(f"{R}.getElementById('mbg').classList.contains('open') && !!{R}.querySelector('#sheet [data-c=Azul]')"), f'[{mode}] modal do palco abre')
        E("window.__calls.length=0"); E(f"{R}.querySelector('#sheet [data-c=Azul]').click()")
        ok(E("window.__calls.some(c=>c[0]==='light'&&JSON.stringify(c[2].rgb_color)==='[40,110,255]')"), f'[{mode}] cor Azul no palco')
        pg.screenshot(path=str(OUT / f'{mode}-modal.png'))
        E(f"{R}.querySelector('#sheet [data-close]').click()")
        ok(not E(f"{R}.getElementById('mbg').classList.contains('open')"), f'[{mode}] modal fecha')
        # blocos: aba e "Tudo"
        E(f"{R}.querySelector('.tab[data-b=operacional]').click()")
        ok(E(f"{R}.getElementById('room-name').textContent") == 'Operacional', f'[{mode}] aba Operacional')
        E("window.__calls.length=0"); E(f"{R}.querySelector('#blist [data-blk=pastoral]').click()")
        c = E("window.__calls"); ok(any(x[2].get('entity_id') == 'light.sala_pastoral' for x in c), f'[{mode}] Tudo do bloco Pastoral')
        # toque na planta seleciona o cômodo da mídia
        xy = E("(()=>{const v=window.__card._p3plan,[a,b]=v.project([17.5,0,25.6]),r=v.cv?v.cv.getBoundingClientRect():null;return [a,b]})()")
        cv = pg.locator('igreja-painel-card').locator('#plan-pv canvas.p3')
        if mode == 'flat' or MOTOR.name == 'igreja-painel-3d.stub.js':
            cv.click(position={'x': xy[0], 'y': xy[1]}); pg.wait_for_timeout(200)
            ok(E(f"{R}.getElementById('room-name').textContent") == 'Mídia', f'[{mode}] toque na planta abre Mídia ({E(R + ".getElementById(\'room-name\').textContent")})')
            if mode == 'motor': ok(E("window.__stubLog.some(x=>x[0]==='cut'&&x[1]==='room-pv'&&x[2]==='midia')"), f'[{mode}] corte só no cômodo')
        # toque num aparelho na vista do cômodo liga/desliga
        if mode == 'flat' or MOTOR.name == 'igreja-painel-3d.stub.js':
            xy = E("window.__card._p3room.project(window.__card._p3.points('midia')[0])"); E("window.__calls.length=0")
            pg.locator('igreja-painel-card').locator('#room-pv canvas.p3').click(position={'x': xy[0], 'y': xy[1]})
            ok(E("window.__calls.some(c=>c[2].entity_id==='light.sala_midia')"), f'[{mode}] toque na luz da mídia na vista 3D')
        pg.screenshot(path=str(OUT / f'{mode}-inicio-midia.png'))
        # páginas
        for nav, sec in [('rooms', 'amb'), ('templo', 'tpl'), ('ares', 'ares'), ('alexa', 'alx')]:
            E(f"{R}.querySelector('[data-nav={nav}]').click()"); pg.wait_for_timeout(500)
            vis = E(f"getComputedStyle({R}.getElementById('{sec}')).display")
            box = E(f"(()=>{{const m={R}.querySelector('.main').getBoundingClientRect(),s={R}.getElementById('{sec}').getBoundingClientRect();return [s.bottom<=m.bottom+1,s.right<=m.right+1,Math.round(s.height)]}})()")
            ok(vis == 'grid' and box[0] and box[1] and box[2] > 300, f'[{mode}] página {nav} visível e dentro da área {box}')
            ok(E(f"getComputedStyle({R}.querySelector('.lower')).display") == 'none', f'[{mode}] {nav} esconde o Início')
            pg.screenshot(path=str(OUT / f'{mode}-{nav}.png'))
            if nav == 'rooms':
                E(f"{R}.querySelector('[data-rsel=voluntariado]').click()")
                ok(E(f"{R}.getElementById('amb-name').textContent") == 'Voluntariado', f'[{mode}] Ambientes seleciona Voluntariado')
                ok(E(f"{R}.querySelector('#alist [data-t=ac_voluntariado]').classList.contains('na')"), f'[{mode}] ar indisponível aparece apagado')
            if nav == 'templo':
                E("window.__calls.length=0"); pg.locator('igreja-painel-card').locator('#c-plateia input[data-bri]').fill('40')
                ok(E("window.__calls.some(c=>c[2].entity_id==='light.templo_plateia'&&c[2].brightness_pct===40)"), f'[{mode}] brilho da plateia 40%')
            if nav == 'ares':
                E("window.__calls.length=0"); E(f"{R}.querySelector('[data-tmp=ac_midia][data-d=\"1\"]').click()"); pg.wait_for_timeout(900)
                ok(E("window.__calls.some(c=>c[1]==='set_temperature'&&c[2].entity_id==='climate.ar_midia'&&c[2].temperature===22)"), f'[{mode}] ar da mídia 21→22 °C')
                E("window.__calls.length=0"); E(f"{R}.querySelector('[data-ack=ac_pastoral][data-m=Seco]').click()")
                ok(E("window.__calls.some(c=>c[1]==='set_hvac_mode'&&c[2].hvac_mode==='dry')"), f'[{mode}] modo Seco')
            if nav == 'alexa':
                pg.wait_for_timeout(300)
                ok('Conectada' in E(f"{R}.getElementById('alx-kv').textContent"), f'[{mode}] status da Echo')
                E("window.__calls.length=0"); pg.locator('igreja-painel-card').locator('#say-t').fill('Culto em 5 minutos'); E(f"{R}.getElementById('say-an').click()"); pg.wait_for_timeout(200)
                ok(E("window.__calls.some(c=>c[0]==='notify'&&c[2].entity_id==='notify.echo_anuncio'&&c[2].message==='Culto em 5 minutos')"), f'[{mode}] anúncio pela Alexa')
                E("window.__calls.length=0"); E(f"{R}.querySelector('[data-snd]').click()")
                ok(E("window.__calls.some(c=>c[0]==='alexa_devices'&&c[1]==='send_sound'&&c[2].device_id==='dev1')"), f'[{mode}] som na Echo')
        E(f"{R}.querySelector('[data-nav=home]').click()")
        E("window.__calls.length=0"); E(f"{R}.getElementById('act-off').click()")
        ok(E("window.__calls.filter(c=>c[1]==='turn_off').length") >= 19, f'[{mode}] Fechar tudo desliga tudo ({E("window.__calls.length")} chamadas)')
        # outras proporções: ocupa a área sem tarjas
        for w, h in [(1600, 700), (1000, 900), (820, 1180)]:
            pg.set_viewport_size({'width': w, 'height': h}); pg.wait_for_timeout(400)
            a = E(f"(()=>{{const a={R}.getElementById('app').getBoundingClientRect();return [Math.round(a.width),Math.round(a.height)]}})()")
            ok(abs(a[0] - w) <= 2 and abs(a[1] - h) <= 2, f'[{mode}] {w}×{h} sem tarjas {a}')
            pg.screenshot(path=str(OUT / f'{mode}-{w}x{h}.png'))
        errs = [l for l in logs if l.startswith('[pageerror]') or (l.startswith('[error]') and 'igreja-painel-3d' not in l and '404' not in l)]
        ok(not errs, f'[{mode}] console sem erros {errs[:3]}')
        b.close()
    srv.shutdown()

run('motor'); run('flat')
print(f'\n{len(fails)} falha(s). Screenshots em {OUT}')
sys.exit(1 if fails else 0)
