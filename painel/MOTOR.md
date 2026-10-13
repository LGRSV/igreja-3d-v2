# igreja-painel-3d.js — motor 3D do painel dashboard

Gerado: `python3 build_painel.py` = `igreja3d-card.js` (cena inteira da igreja: pisos, paredes, decoração `rooms/*.js`, materiais,
luzes, telão, ares, portas, merge de malhas) sem os `export`/registro do elemento + `painel/motor.src.js` (camada P3).
Não edite o `igreja-painel-3d.js` à mão; rode o build de novo quando o cartão ou o `motor.src.js` mudar.

## API (contrato do PLANO.md)
```js
import { VERSION, ROOMS3D, BLOCKS3D, PLAN3D, IgrejaPainel3D } from './igreja-painel-3d.js?v=1.1.0';
const E = IgrejaPainel3D.shared({ night_vision: true, quality: 'auto' });   // window.__igrejaPainel3D; quality: auto|alta|media|leve|min
await E.ready();
const v = E.view(canvas, { interactive: true, safe: { l, t, r, b }, home: [giro, incl], state: () => estado, res: 1 });
const m = E.view(canvas2, { preview: true, state: () => estadoDaCena });   // v1.1.0: miniatura parada (veja Redesenho)
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
- Paredes e fachada ficam de pé por padrão (v1.0.1). Na vista recortada num cômodo (`cut`), as paredes dele entre a câmera e o retângulo
  enquadrado são cortadas a 0,9 m (com a decoração fina presa nelas); `view(…, { cuts: false })` desliga e `{ cuts: true }` corta
  também sem recorte (nenhuma vista do painel usa: os programas desse caso são aquecidos depois, na 1ª vista criada com ele).

## Redesenho (v1.1.0)
- **Cada vista só redesenha quando algo que muda a imagem dela muda**: tamanho em px, câmera (giro, inclinação, zoom/distância,
  alvo, área livre/deslocamento), retângulo enquadrado, corte (`cut`), `cuts`, `preview`, o `state()`, a escala do arrasto e uma época global.
  `render()` sem mudança custa só essa comparação (contadores `v.drawn` e `v.skipped`); um `hass` que não mexe na igreja não desenha nada.
- **A/C**: o relógio dos ares redesenha só as vistas ao vivo em que aparece uma unidade que anda (frustum da câmera com 4 m em
  volta da unidade — o jato do templo chega a ~3,8 m —, recorte do cômodo); quando o ar para, nada mais redesenha. Vista ao vivo
  escondida (aba do cartão fora) não desenha, mas perde a assinatura: ao voltar mostra o ar como está (não o quadro do meio do ligar).
  Um desenho pulado também religa o relógio da aleta (oscilação volta depois de trocar de aba). Vista de cima ↔ normal reaplica o
  visual dos ares (selos de modo e fluxo de cima não passam para as outras vistas).
- **Sombra e mezanino**: o mapa de sombra é um só. A passada segue o mezanino da vista desenhada (como no cartão: vista de cima,
  el ≥ 62, e corte dos WCs sem ele); se a última passada foi feita com o mezanino no outro estado, sai uma passada nova. O lote
  desenha primeiro as vistas no mesmo estado da última passada (no máximo uma passada nova por lote).
- **`preview: true`** (opcional, padrão `false`; uma vista não interativa sem ele continua animando, como a mini do `motor.html`):
  miniatura de uma cena. Desenha o estado dela com cada unidade de A/C direto no estado final (sem o ligar animado nem a aleta
  oscilando) e depois devolve à cena o estado ao vivo (integradores e sequência dos ares, porta), sem refazer as sombras da
  porta; dia/noite vale (sombra da lua certa). O relógio dos ares nunca redesenha uma miniatura. Antes, a troca miniatura ↔ vista ao
  vivo (Culto/Ensaio com o ar ligado, Chegada com a porta aberta) reiniciava o ligar do ar a cada desenho e tudo redesenhava sem parar.
- `E.invalidate()` redesenha todas as vistas (para quem mexe na cena por fora do `state()`). Voltar à aba, canvas 2D descartado pelo
  navegador (`contextrestored`) e contexto WebGL restaurado redesenham sozinhos.
- Desligar a comparação: `IgrejaPainel3D.shared({ liveSig: false })` (ou `window.__NOSKIP = true` nos testes).

## Arrasto, nitidez e luz do leve (v1.1.0)
- **Governador do arrasto**: girando, na pinça ou na roda, a vista grande (≥ 150 mil px² CSS: cômodo, Ambientes, Templo; a planta
  pequena desenha normal) desenha com 0,6 da resolução e desce (×0,85, até 0,35) enquanto o quadro (média móvel) passa de 40 ms.
  Cada descida tem que baixar o quadro ≥ 10 %; se não baixar (GPU limitada por vértices ou CPU), volta a escala anterior e para
  de descer naquele arrasto: menor só borraria. O quadro conta da 1ª amostra do dedo (pausa do dedo não conta como quadro lento).
  O canvas 2D fica do mesmo tamanho (a imagem menor é ampliada nele) e as partículas do ar mantêm o tamanho na tela.
- Enquanto uma vista está em movimento as outras esperam na fila (estado novo, A/C, `hass`) e o relógio dos ares não dá quadro
  extra à vista em movimento. Em movimento = até 0,3 s depois da última entrada e do quadro que ela pediu (`pointerup` perdido
  não trava nada). Ao soltar (`pointerup`, `pointercancel`, `lostpointercapture`; roda: 150 ms depois do último evento e do último
  quadro) ou com o dedo parado 0,3 s sai **um** quadro nítido (a escala entra na assinatura) e as vistas da fila desenham.
  `v.scale` = escala do último quadro (1 parado). Toque (tap), `pickAt`, `project` e pinos usam px CSS: não mudam.
- Medido (SwiftShader, leve, arrasto de 60 passos no cômodo do Início): quadro 447 → 187 ms no layout de tablet (1000×544, DPR 2,
  escala 0,68) e 264 → 153 ms em 1280×800; nenhuma outra vista desenha durante o arrasto (antes a planta entrava no meio) e sai
  exatamente um quadro na escala 1 ao soltar. Com custo fixo simulado (CPU) a escala volta a 0,6; com custo por pixel desce a 0,35.
- **Nitidez no tablet**: o desenho de 1280×800 é escalado por `transform` e o compositor reamostrava o canvas com bilinear mesmo
  quando ele já tinha os pixels da tela (~75 % da nitidez perdida). Quando o canvas bate 1:1 com os pixels da tela
  (|largura em px − largura na tela × devicePixelRatio| ≤ 1,5, com a pinça da página) a vista usa `image-rendering: pixelated`; senão
  fica suave (celular com `res` 0,8, DPR > 2, página ampliada). Tablet 1000×544 DPR 2: nitidez na tela 827 → 3373 (o canvas tem 3362).
- **Luz dos cômodos no leve/min**: o cômodo que a luz que segue o alvo já ilumina fica com metade da poça do piso (luz real + poça
  cheia estourava o branco sob a luminária nos cômodos cortados). Ambientes à noite, pixels estourados: Mídia 11012 → 3,
  Voluntariado 12719 → 1157, Administrativo 19371 → 5333 (media: 213, 635, 4834); brilho médio −3 a −8 %.

## Menos draw calls e shaders (v1.1.0)
- **Paredes inteiras**: além dos trechos (que cortam um a um), o motor junta todas as paredes numa cópia por material (o `matCanon` e o
  `mergeGeos` do cartão, como o `mergeStatic`). Vista sem nenhum trecho cortado (planta, bloco, Templo, miniaturas) desenha a cópia;
  com corte, os trechos. Planta ~853 → ~467 draw calls, templo ~556 → ~332, mini ~572 → ~337, Início inteiro (7 vistas) ~4790 →
  ~2760; passada de sombra do sol 335 → 156.
  Sombra, `pickAt` e vistas com corte iguais. Vidro e transparentes seguem por trecho (ordem de desenho) e materiais de aparelho não
  trocam pelo canônico. `shared({ wallAll: false })` (ou `window.__NOWALL = true` nos testes) fica só com os trechos.
- **Sombra do sol/lua justa**: a câmera de sombra cobre só a caixa de quem projeta sombra (+0,5 m, com a laje), refeita na troca
  dia/noite: ~59 × 59 m de dia (~65 × 54 m com a lua) e ~34–79 m de profundidade em vez de 76 × 76 m e 1–125 m (mesmo mapa;
  texel ~7,4 → ~5,7 cm). O bias é reescalado para a profundidade nova (`-0,0006 × 124 / (far − near)`): o mesmo valor em metros
  de antes, para não aparecer acne em GPU de celular (sem acne nem sombra solta nos closes de dia e de noite).
- **Aquecimento** (`ready()`): as combinações sem corte e com recorte do cômodo (com e sem parede cortada); parede cortada sem recorte
  (`cuts: true`) só depois, uma vez. No `media` o reflexo da noite já vai para os materiais brilhantes (e as cópias de corte deles)
  antes. leve 90 → 74 programas, nenhum compilado depois (planta, cômodos, Ambientes, dia); media 100 + 22 no uso → 88 + 2
  (a sombra das luzes pontuais, no 1º desenho).

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

## Velocidade e oscilação (M3)
- `estado.ac[chave] = { on, mode, fan, swing }` (também em `ac_templo_N`). Sem `fan`/`swing`, nada muda.
- `fan` (fan_mode do HA) → fator do fluxo: quiet 0,5 · low 0,6 · medium/auto 1,0 · high 1,5 · turbo 1,8; números por proporção
  (1…5, ou 0…100 %). O fluxo fica mais forte (intensidade 0,6 + 0,4 × fator) e mais rápido (relógio × fator); a troca é suave
  (~0,4 s), não reinicia o ligar, e o ar anda ~8 s para mostrar a velocidade nova. A velocidade é por entidade (a da 1ª unidade ligada).
- `swing` ≠ off (on/vertical/horizontal/both) com a unidade ligada → a aleta oscila devagar (~5 s por vaivém, ~35°–69°), por unidade.
  Com off, ela fica aberta na posição normal (0,9 rad). O relógio roda a ≤ 20 q/s e só enquanto uma unidade oscilando aparece
  em alguma vista ao vivo (frustum, corte no cômodo, canvas na página e com tamanho, aba visível; miniatura não conta), redesenhando
  só as vistas em que ela aparece; com prefers-reduced-motion fica parada.
