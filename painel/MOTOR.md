# igreja-painel-3d.js — motor 3D do painel dashboard

Gerado: `python3 build_painel.py` = `igreja3d-card.js` (cena inteira da igreja: pisos, paredes, decoração `rooms/*.js`, materiais,
luzes, telão, ares, portas, merge de malhas) sem os `export`/registro do elemento + `painel/motor.src.js` (camada P3).
Não edite o `igreja-painel-3d.js` à mão; rode o build de novo quando o cartão ou o `motor.src.js` mudar.

## API (contrato do PLANO.md)
```js
import { VERSION, ROOMS3D, BLOCKS3D, PLAN3D, IgrejaPainel3D } from './igreja-painel-3d.js?v=1.0.0';
const E = IgrejaPainel3D.shared({ night_vision: true, quality: 'auto' });   // window.__igrejaPainel3D; quality: auto|alta|media|leve|min
await E.ready();
const v = E.view(canvas, { interactive: true, safe: { l, t, r, b }, home: [giro, incl], state: () => estado, res: 1 });
v.frame(...ROOMS3D.midia); v.cut('midia');            // corte só no cômodo (ou bloco: v.cut('templo')); v.cut(null) volta
v.onClick((px, py, hit) => …);                        // hit = pickAt(px, py); também aceita v.onClick = fn
v.onCam((v) => …);                                    // girou/aproximou (para reposicionar pinos com v.project)
```
- `ROOMS3D[id]` / `BLOCKS3D[id]` / `PLAN3D` = `[x0, z0, x1, z1, giro, incl]` (ids de cômodo e bloco do `BLOCKS` do cartão v1.8).
- `pickAt(px, py)` → `{ kind: 'light'|'ac'|'telao'|'som'|'room', key, room, point:[x,y,z] }` ou `null`.
  `key` = chave da entidade (no `room`: a luz da zona tocada, ou `null`); `room` = id do cômodo. Tocar perto (0,45 m) da carcaça
  de um aparelho conta como o aparelho. Paredes cortadas acima de 0,9 m, vidro, halos e o que está fora do corte não contam.
- `points(chave)` → posições `[x, y, z]` das luminárias/aparelhos (pinos).
- `estado` = `{ lights:{chave:bool}, palco:{on, rgb:[r,g,b], bri 0–100}, plateia:{on, bri}, telao:{on, title}, som:bool,
  ac:{chave:{on, mode:'cool'|'heat'|…}}, porta:bool, night:bool }`.
- Paredes entre a câmera e o retângulo enquadrado são cortadas a 0,9 m (com a decoração fina presa nelas); `view(…, { cuts: false })` desliga.

## Teste
`THREE_LOCAL=…/three.module.min.js <python com playwright> painel/teste/test_motor.py <pasta-dos-pngs>` (Chrome instalado, sem Node).

## Ares (M2)
- **Animação ao ligar/desligar** (a do igreja3d-card, pelo próprio `_airStep` dele): cada unidade liga na sua vez — LED pisca,
  aleta abre, fluxo nasce (no templo uma a cada ~2,5 s, começando 0,6 s depois; com uma unidade só, 0,4 s) — e ao desligar o
  fluxo recolhe e a aleta fecha. O ar anda ~8 s depois e para. **Nunca anima no primeiro desenho** (carga: fica como está).
  Sem câmera acompanhando. Respeita `prefers-reduced-motion` (sem animação).
- **Splits do templo um a um**: `estado.ac` aceita `ac_templo_1` … `ac_templo_5` (`{on, mode}`); a chave individual manda
  na unidade dela, senão vale `ac_templo` para todas. `points('ac_templo_N')` → `[[x, y, z]]`; `pickAt` num split do templo
  devolve `key: 'ac_templo_N'` (a entidade `ac_templo` continua em `points('ac_templo')`, as 5 posições).
- Numeração da **esquerda para a direita de quem está no palco olhando a plateia** (z crescente):

| N | posição (x, y, z) | onde |
|---|---|---|
| 1 | 7,95 · 2,6 · 12,63 | ponta dos fundos (parede z = 12,4) |
| 2 | 15,83 · 2,6 · 15,3 | parede da ala direita (x = 16,05) |
| 3 | 15,83 · 2,6 · 30,9 | parede da ala direita, acima da janela |
| 4 | 15,83 · 2,6 · 37,6 | parede da ala direita |
| 5 | 7,95 · 2,6 · 43,78 | ponta do hall (parede z = 44,0) |

- O fluxo de ar é um shader por entidade: a cor segue o modo da primeira unidade ligada (modos diferentes por unidade
  mudam o LED só pela entidade).
- Teste: `painel/teste/test_ar.py` (carga sem animação, um split sozinho anima e os outros não, desligar fecha, todos escalonados, pickAt por unidade).
