#!/usr/bin/env python3
"""Gera igreja-painel-3d.js (motor das vistas 3D do painel dashboard) a partir do igreja3d-card.js.
O cartão entra inteiro (helpers, materiais, decoração dos cômodos, métodos de construção da cena de Igreja3DCard),
sem os `export` e sem o registro do elemento; por cima entra a camada P3 de painel/motor.src.js.
Uso: python3 build_painel.py   (rodar de novo sempre que o igreja3d-card.js ou o motor.src.js mudar)."""
import re
from pathlib import Path
here = Path(__file__).parent
card = (here / 'igreja3d-card.js').read_text(encoding='utf-8')
src = (here / 'painel' / 'motor.src.js').read_text(encoding='utf-8')

def once(s, old, new):
    n = s.count(old)
    if n != 1: raise SystemExit(f'!! trecho aparece {n}x no cartão: {old[:60]!r}')
    return s.replace(old, new)

m = re.search(r"export const VERSION = '([^']+)';", card)
card_ver = m.group(1)
card = once(card, m.group(0), f"const CARD_VERSION = '{card_ver}';")
for name in ('DEFAULT_ENTITIES', 'ITEMS'):
    card = once(card, f'export const {name} =', f'const {name} =')
card = once(card, 'export class Igreja3DCard extends HTMLElement', 'class Igreja3DCard extends HTMLElement')
i = card.index("if (!customElements.get('igreja3d-card'))")
card = card[:i].rstrip() + '\n'
if re.search(r'^\s*export ', card, re.M): raise SystemExit('!! sobrou export no cartão')
head = ('/*\n * igreja-painel-3d.js — GERADO por build_painel.py (não editar à mão).\n'
        f' * Base: igreja3d-card.js v{card_ver} (cena da Base Church) + painel/motor.src.js (vistas do painel).\n */\n')
out = head + card + src
(here / 'igreja-painel-3d.js').write_text(out, encoding='utf-8')
print(f'igreja-painel-3d.js gerado ({len(out):,} bytes; cartão v{card_ver})')
