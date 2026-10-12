# Igreja 3D — cartão Lovelace para Home Assistant

Demo: https://lgrsv.github.io/igreja-3d-v1/ · Repositório: https://github.com/LGRSV/igreja-3d-v1

Modelo 3D interativo da **Base Church** (802 Sul · Palmas-TO) em Three.js, ligado às entidades do
Home Assistant: gira, dá zoom e cada ambiente acende conforme o interruptor real. Clicar no ambiente,
na luminária ou no bloco do painel alterna a entidade. O telão mostra o que está tocando, os LEDs do
som e dos ares acendem com o estado e a porta de vidro abre quando o sensor da porta abre.
É o mesmo motor do cartão `casa3d-card` (repositório [casa-chefe](https://github.com/LGRSV/casa-chefe)),
refeito para a planta da igreja.

## Painel dashboard (`igreja-painel-card`) — novo

Painel de tela inteira para tablet ou TV, no mesmo modelo do painel da casa (aba Alexa 2 do `casa-petroleo-card`):
desenho 1280×800 que ocupa a área toda (sem tarjas), menu lateral e vistas 3D da igreja que respondem ao toque.
O 3D é o deste repositório: `igreja-painel-3d.js` é **gerado** do `igreja3d-card.js` (cena inteira, decoração, luzes,
telão, ares e portas), com uma camada por cima para várias vistas ao mesmo tempo, toque nos aparelhos e corte por cômodo.

- **Início**: resumo (presença, luzes acesas, ares, culto no ar), cenas (Culto, Ensaio, Chegada, Limpeza, Fechar tudo) com
  miniaturas 3D, bloco selecionado em 3D com os aparelhos, planta interativa com pinos e os 5 blocos com «Tudo».
- **Ambientes**: os cômodos por bloco; escolher um mostra a igreja cortada só nele, com lâmpadas e ar tocáveis.
- **Templo / Culto**: palco RGB (cores e brilho), plateia, telão, som e ar do templo.
- **Ares**: os 4 ares com modo e temperatura.
- **Alexa** (só com `alexa_device`): falar/anunciar, comandos, sons e status.

Demo com Home Assistant simulado: `painel.html` (abrir por HTTP, por exemplo `python3 -m http.server` e
`http://localhost:8000/painel.html`; por `file://` o navegador bloqueia os módulos).

### Instalação

1. Copie `igreja-painel-card.js` **e** `igreja-painel-3d.js` para a mesma pasta, por exemplo `/config/www/igreja3d/`
   (o cartão importa o motor da própria pasta).
2. Recurso do Lovelace (Módulo JavaScript): `/local/igreja3d/igreja-painel-card.js?v=1.0.0`. Suba o `v` a cada troca.
3. Uma vista do tipo **Painel** com o cartão:

   ```yaml
   title: Igreja
   path: igreja
   type: panel
   cards:
     - type: custom:igreja-painel-card
       title: Base Church
       entities:            # mesmas chaves do igreja3d-card (veja "Configuração completa")
         palco: light.SEU_PALCO
       # alexa_device: <id do Echo>   # mostra o menu Alexa
   ```

**Celular** (v1.3.0): em tela estreita (< 700 px) ou baixa (< 520 px) o painel vira uma coluna com rolagem, abas embaixo, seletores e janelas que sobem de baixo, e o 3D com resolução menor; dá para rolar a página por cima do 3D (arrastar na horizontal gira). `layout: celular | painel` força um dos dois.

Opções: `layout`, `entities`, `title`, `height`, `vista_3d: false` (sem 3D, planta 2D), `luz_3d: noite|dia`, `night_vision`,
`quality` (como no igreja3d-card), `toque: false` (vistas só de olhar), `corte_comodo: false`, `alexa_device`
(com `alexa_fala`, `alexa_anuncio`, `alexa_nao_incomodar` opcionais).

### Desenvolvimento

- `python3 build_painel.py` gera o `igreja-painel-3d.js` a partir do `igreja3d-card.js` + `painel/motor.src.js`.
  Rode de novo sempre que o cartão 3D mudar; não edite o arquivo gerado (API em `painel/MOTOR.md`).
- Testes (Playwright para Python com o Chrome instalado, sem Node):
  `python tools/painel/teste_cartao.py <saída> igreja-painel-3d.js` (cartão com o motor real) e
  `python painel/teste/test_motor.py <saída>` (motor).

## Novidades da v1.8.0 — blocos do dono, cena limpa, topo em lista suspensa e visual Apple

- **Blocos**: Templo (um cômodo só, com todos os aparelhos) · Operacional (Sala Gilvan, Administrativo, Circulação, Mídia, Voluntariado) · Banheiro (Depósito ao WC Fem., numa lista só) · Sala Pastoral (os fundos, numa lista só) · Hall de entrada (Hall, WCs, Estacionamento, Fachada). A Sala da Família saiu das listas.
- **Clicar no bloco** abre a janela lateral com os aparelhos dele (ligar/desligar e ⋯), mostrando todos — ligados e desligados.
- **Interruptor «Tudo»** em cada bloco e cômodo; **ares com Temperatura (− / +) e Oscilar**.
- **Cena mais limpa**: sem postes (a luz do estacionamento virou 2 refletores na fachada), sem árvores e sem ruas. Paredes da Sala Pastoral mais finas e baixas. **Sol corrigido** (nasce nos fundos, se põe na frente). Vista de cima inclinada para a frente do templo; tocar no Templo centraliza.
- **Sala da Família**: v1.8: a Sala da Família foi incorporada ao Hall (saem as paredes, os móveis e a luz `familia`/`light.sala_familia`; o abajur do mezanino acende com a luz do hall).
- **Topo**: sai o cartão da esquerda; um botão ⋯ à direita abre a lista suspensa (hora e simulação do sol, clima, Pessoa, Ir para… e opções).
- **Visual do app Casa da Apple** (igual à Casa v1.9): ícones Phosphor, bloco ligado claro, controles do iOS, vidro só em GPU forte.
- Ganchos: `setTopNav` aceita `templo · operacional · banheiro · pastoral · hall` (e os ids antigos).

## Novidades da v1.7.0 — painel da Casa v1.8 e 4 blocos com todas as automações por cômodo

- **4 blocos gerais**, iguais no painel e na Vista de cima: **Templo** (Palco, Plateia) · **Corredor direito** (Sala Gilvan, Administrativo, Circulação, Mídia, Voluntariado, Depósito, Área técnica, WCs) · **Fundos** (Pátio, Almoxarifado, Cozinha, Recepção, Sala Pastoral, Caixa d’água) · **Entrada** (Hall de entrada, Sala da Família, WCs, Estacionamento, Fachada). Cada bloco mostra «N de M ligados» e Ligar/Desligar tudo; dentro, cada cômodo com **todos** os aparelhos que dá para ligar/desligar (luzes, palco, telão, som, ares), cada um uma vez («também …» quando serve a mais de um cômodo). As automações do HA seguem a mesma divisão.
- **Painel novo** (o mesmo da Casa v1.8): coluna à **esquerda** com o título em cima e **borda arrastável** (compacta · padrão · larga, lembrada) no desktop e no tablet deitado; **folha de baixo com 3 alturas** no celular e no tablet em pé; resumo do que está ligado e filtro Ligados/Todos; o cômodo tocado aparece **no próprio painel** (sai o painel da esquerda da v1.6.1); paleta âmbar (ligado) + grafite; mais leve (sem desfoque no painel, um desenho por atualização do HA).
- **Sem piscadas pretas** ao mexer na tela (o canvas só muda de tamanho quando precisa e é redesenhado na hora).
- Tocar nos objetos continua em **2 toques** (balão com nome e estado; o 2º toque ou o botão executa), agora com a cena parada para o 2º toque acertar.
- Ganchos: `setTopNav(bloco, cômodo)` usa os blocos `templo · ala · fundos · entrada` (`hall` e `frente` viraram `entrada`).

## Novidades da v1.6.1 — painel do cômodo, Vista de cima de frente para o palco

- **Abre na Vista de cima** (nível 0) na demo e no HA; **Recentrar** volta a ela; sair pelo menu (Vista de cima) ou entrar na Pessoa funciona como antes (com `fachada: true` no YAML abre na maquete de sempre).
- **Vista de cima de frente para o palco**: o nível 0 olha o templo do lado da plateia (câmera em +x olhando para −x), alta e oblíqua (~38° acima do horizonte), com a largura do templo ocupando a tela (paisagem e retrato); bloco e cômodo continuam retos de cima, agora com o palco em cima também na paisagem (aproximar não dá meia-volta).
- **Painel do cômodo à esquerda** (no celular, folha compacta embaixo) nos níveis bloco e cômodo: título, "N de M ligados", **Ligar tudo** (só as luzes) / **Desligar tudo** (luzes, ar, telão e som) em uma chamada `homeassistant.turn_on/turn_off`, os aparelhos com estado, "Entrar aqui" e as **automações do HA do cômodo** (casadas pelo nome, com ativar/desativar e executar); no bloco, os cômodos com "N de M ligados". A trilha do topo ficou só com Voltar + migalhas, e a cena é enquadrada ao lado do painel.
- Na Vista de cima o **painel lateral direito recolhe** e volta ao sair (se estava aberto).
- **Painel lateral mais estreito e enxuto**: `clamp(260px, 26%, 320px)`, blocos e espaçamentos menores.
- **Clima minimalista**: no título, ao lado do relógio, só ícone + temperatura (condição no title/aria-label); os detalhes (cidade, condição, sensação, vento, atualizado) estão no topo do menu ☰. Sem rede: nada no título e "Clima indisponível" no menu. O cartão flutuante saiu.
- **Gestos de toque na maquete** (o mouse continua igual): 1 dedo gira com sensibilidade pela largura da tela e trava o eixo depois de ~10 px; solto com velocidade, o giro continua e desacelera; 2 dedos como num mapa (pinça = zoom no ponto entre os dedos, torção = gira, arrasto = pan), cada gesto com seu limiar; zoom e inclinação resistem nos limites e voltam ao soltar.
- **Selecionar antes de agir** na maquete: o 1º toque num ambiente/aparelho realça e mostra um balão com nome, estado e "Acender/Apagar" (ou Ligar/Desligar); o 2º toque no mesmo alvo em até 5 s ou o botão executa; Esc ou tocar no vazio limpa. Os blocos dos painéis continuam diretos; no modo Pessoa o toque no piso continua andando até lá.
- **Bonequinho "Andar"** com o nome ao lado (no celular só o ícone) e, no primeiro acesso, uma dica apontando para ele que só some quando ele é usado ou a dica é fechada (lembrada em `localStorage`, chave `igreja3d.dica_pessoa`); as dicas do título e do modo Pessoa somem na primeira interação, não por tempo.
- **Visão noturna** de dia: o item mostra "só à noite" (e o porquê no title).
- Demo: tocar nos blocos de sensor (presença, temperatura, porta) mostra um aviso com nome e estado; as chamadas em lote funcionam no `hass` simulado.

## Novidades da v1.6.0 — painel lateral e menu de opções

- **Painel lateral** no lugar do painel de baixo. Desktop/tablet: coluna à direita (abaixo dos botões do topo até o pé do cartão, largura ~34 %, entre 272 e 380 px), mesmo vidro escuro/âmbar, agora mais pesado (blur e sombra maiores). Cabeçalho com o contador "N de M luzes acesas" e o botão **→ recolher**; abas Ambientes · Automações · Atividade num segmentado; filtros por área (Todos, Templo, Entrada, Administração, Apoio) quebram em 2 linhas; blocos em grade de 2 colunas (ícone à esquerda); a folha de controle continua presa ao pé da coluna. Recolhido, sobra a aba **‹ Painel** na borda direita com o número de luzes acesas. A **cena é enquadrada à esquerda do painel** (deslocamento horizontal da câmera): a igreja e a Vista de cima não ficam escondidas atrás dele; a trilha da Vista de cima e a lista *Ir para…* também ficam à esquerda da coluna.
- **Celular** (cartão ≤ 640 px): o painel é uma **gaveta que entra pela direita** (até 88 % da largura, 360 px no máximo, da linha de baixo do cabeçalho até o pé), com véu escuro sobre a cena; começa recolhida (a aba "Painel" abre). Fecha pelo botão →, tocando no véu, com Esc ou **arrastando para a direita**: depois de ~10 px na horizontal a gaveta segue o dedo 1:1, além do aberto resiste (rubber band), ao soltar decide pela velocidade (projeção do movimento) e assenta com uma mola (feita à mão, sem biblioteca); dá para agarrar a gaveta no meio da animação. Não há reenquadramento no celular (a gaveta fica por cima). No modo Pessoa a gaveta fecha (no desktop a coluna fica).
- **Menu ☰ Opções** no canto superior direito no lugar da fileira de botões, em seções: **Ambiente** (Auto/Dia/Noite + Visão noturna) · **Vista** (Rótulos, Fachada, Vista de cima, Recentrar) · **Navegação** (Pessoa, Ir para um ambiente…) · **Painel** (Painel lateral). Liga/desliga com interruptor; nasce do botão (escala 0,96 → 1, sem passada). Fecha no clique de novo, Esc, clique fora e depois de Recentrar, Ir para… e de entrar na Pessoa. Teclado: Enter/↓ abre com o foco no 1º item, ↑/↓/Home/End andam, Tab sai; com o menu aberto o **Esc só fecha o menu** (não sai da Pessoa nem volta um nível na Vista de cima). Fora do menu ficam o **bonequinho** (arrastar até a maquete) e, no modo Pessoa, **Ir para…**. No celular o menu ocupa a largura e rola.
- **Clima** foi para o **canto inferior esquerdo** (o direito é do painel); some no modo Pessoa (lugar do joystick) e sob a gaveta do celular.
- Acessibilidade: `prefers-reduced-motion` troca deslize/mola/escala por um fade curto; `prefers-reduced-transparency` deixa painel/menu quase sólidos sem blur; `prefers-contrast: more` usa fundo sólido e borda clara. Retorno visual no toque (escala 0,97) nos botões.
- Teste novo: `tools/ui_test.mjs` (menu, painel, gaveta com toque via CDP); `tools/integ_test.mjs` usa os botões pelo menu.

## Novidades da v1.5.5 — Fachada automática no modo Pessoa

- Ao entrar na visão de **Pessoa** a **Fachada** liga sozinha: paredes altas, forro e telhado aparecem, então por fora se vê a fachada completa e por dentro o teto (some o céu sobre as salas). Ao sair, a Fachada volta a como estava. O botão Fachada continua valendo durante o passeio. Opção `fachada_pessoa: false` desliga esse comportamento.

## Novidades da v1.5.4 — escada do hall de volta ao lugar original

- A escada do hall voltou a ser a **escada em U no canto** (x 13,62–15,94 · z 44,2–49,55), com o jardim de seixos, a cica e a planta alta sob o lance 2, e o patamar de cima sobre a passagem dos banheiros. A escada reta da fachada saiu; lounge (parede x = 4,0), tríptico, café (fachada x 7,75–9,95), mesa bistrô, tapete redondo e planta grande voltaram aos lugares de antes.
- A **salinha** (mezanino sobre WC / WC PCD / Sala da Família) continua, agora com o guarda-corpo de vidro fechado em toda a borda do lado do hall. Sem escada até ela: no modo Pessoa chega-se pelo "Ir para… › Mezanino", pelo bonequinho ou clicando no piso da salinha (troca de andar com fade); de lá, clicar no piso de baixo desce direto.
- No modo Pessoa a escada em U é obstáculo; a passagem sob o patamar de cima continua livre.

## Novidades da v1.5.3 — animações do ar, das lâmpadas e das portas (maçaneta)

- **Maçaneta no modo Pessoa**: nas portas de madeira de giro a alavanca cromada desce (~41°) antes de a folha sair do batente e volta ao soltar; ao fechar, desce de novo perto do batente. Com `prefers-reduced-motion` a porta abre direto.
- **Portas**: giro em S com leve passada (~4 %) e assentamento; na de 2 folhas a segunda folha sai um pouco depois; as de correr e a principal de vidro freiam no fim.
- **Ar-condicionado**: ao ligar, o LED pisca 2 vezes, a aleta abre com passada e o fluxo cresce; ligado, a aleta balança de leve, o fluxo tem turbulência e uma névoa de pontos desce; ao desligar, o fluxo recolhe, a aleta fecha e o LED apaga (mantém a cor do modo).
- **Lâmpadas**: cada tipo com sua partida — tubo/LED linear com partida tremida (~0,6 s), lâmpadas quentes começam alaranjadas com o halo crescendo, palco RGB com transição suave de cor (luz, feixes, poça e emissivo). Nenhuma luz real ou shader novo.
- Teste novo: `tools/anim_test.mjs`.

## Novidades da v1.5.2 — painel redesenhado e detalhes de realismo

- **Painel**: vidro escuro com cantos maiores e sombra, centralizado no desktop e com alça no celular; abre deslizando e fecha animado (arrastar a barra das abas para baixo recolhe no toque). Abas em pílula com ícones, contador "N de M luzes acesas", filtros por área (Todos, Templo, Entrada, Administração, Apoio) com cabeçalho "N de M ativos". Cartões com ícone em chip, estado e tempo em linhas separadas, brilho na cor do aparelho quando ligado (palco roxo, luzes âmbar, ar azul, presença rosa) e barra de brilho nas dimerizáveis. O detalhe virou uma folha de controle presa ao pé do painel (interruptor, slider de brilho com %, cores, termostato com modos, desligar em 15/30/60 min; Esc fecha). Rotinas em cartões maiores; automações e atividade com ícones. Botão "Painel ▴" com o número de luzes acesas. Setas ←/→ trocam de aba; sem animação com `prefers-reduced-motion`.
- **Detalhes de realismo**: interruptores e tomadas junto às portas, blocos autônomos de emergência, suportes de controle dos splits, persianas rolô (Gilvan e Adm.), eletrocalha, régua e cabos sob a bancada da mídia, relógio e calendários, lixeiras, totem de álcool em gel, saboneteira e ralos nos WCs, púlpito de acrílico com a marca, Bíblia e garrafa d'água no palco, marcações de fita no piso, quadro de comando e gazofilácio no templo, porta-guarda-chuvas no hall, interfone na fachada (+3 draw calls).

## Novidades da v1.5.1 — porta dos fundos no canto do vaso; WC Feminino como antes

- A porta de madeira do pátio dos fundos para o corredor lateral da ala direita (PM01) foi para a parede x = 16,05 (z 11,25–12,15), no canto onde ficava o vaso de espada-de-são-jorge; o vaso foi para a frente da parede z = 11, onde era a porta (agora lisa). Capacho e placa de saída do corredor acompanharam a porta.
- A porta do WC Feminino voltou para a parede do hall dos banheiros (z = 44,3), com o pictograma, a cica, o espelho e o banco nos lugares de antes; a parede do hall de entrada ficou lisa.

## Novidades da v1.5.0 — escada e "salinha", porta do WC Feminino e Pessoa "tipo Street View"

- **Escada do hall no canto da fachada**: agora é **reta, encostada na parede da fachada** (x 4,1–9,2 · z 48,05–49,56), entre a Sala da
  Família e a porta principal, e sobe para a esquerda até o **mezanino / "salinha"** (piso em y = 3,05) que fica sobre o WC, o WC PCD e a
  Sala da Família. Mesma linguagem de antes: lance maciço grafite, degraus de madeira soltos com fita de LED, painel de vidro inclinado com
  corrimão preto e corrimão de parede. A salinha tem laje com testeira grafite, **guarda-corpo de vidro do lado do hall**, paredes altas com
  janela para a fachada, piso laminado com rodapé, 2 poltronas, mesinha com abajur (acende com a luz do hall), tapete e plantas. O espaço à
  direita (onde ficava a escada em U) ficou livre: o café e o bistrô foram para lá e o lounge foi para a parede do templo. A salinha some na
  **Vista de cima** (a planta continua mostrando os cômodos de baixo).
- **Porta do WC Feminino no hall de entrada**: a porta saiu da parede do hall dos banheiros (que virou parede lisa) e foi para a parede
  x = 16,05 do hall (z 48,35–49,25), no canto onde ficava o vaso; o vaso (cica) trocou de lugar com ela e o espelho e o banco subiram para
  liberar o giro da porta.
- **Pessoa "tipo Street View"**: no modo Pessoa, **clique ou toque num ponto do piso** e a pessoa caminha até lá (desvia das paredes,
  as portas abrem no caminho; se o ponto for inalcançável ela vai ao ponto alcançável mais perto). Um **anel âmbar** sob o cursor mostra
  o destino. **Clicar na escada ou no mezanino sobe até a salinha**; clicar no piso de baixo, estando lá em cima, desce. Também dá para
  subir e descer **andando** (setas/WASD/joystick): a altura dos olhos acompanha os degraus e o guarda-corpo segura a pessoa. Arrastar continua
  girando a cabeça; teclado ou joystick assumem o comando a qualquer momento; clicar num aparelho continua ligando/desligando.
- **Escolher em qual ambiente entrar** (como o bonequinho do Street View):
  - **Bonequinho** (ícone de pessoa âmbar ao lado de *Pessoa*, na órbita e na Vista de cima): **arraste e solte** num ponto do piso e a
    pessoa entra ali, a 1,6 m, olhando para o centro do cômodo (ou para o que importa nele: palco, portas do templo…). Enquanto arrasta,
    o cômodo sob o cursor é realçado e o nome aparece; soltar fora do piso (sobre os botões, fora do lote) cancela. No toque a mira fica
    acima do dedo. Um toque simples no bonequinho abre a lista *Ir para…*.
  - **Entrar aqui** (Vista de cima, no nível do cômodo, na trilha *Planta › Bloco › Cômodo*): entra no modo Pessoa num ponto livre do cômodo.
  - **Ir para…** (botão no modo Pessoa): lista os cômodos por bloco — com o **Mezanino (salinha)** — e leva a pessoa direto ao escolhido,
    com uma transição suave. Os pontos de entrada são sempre livres (sem parede nem móvel).
- Testes: `tools/street_test.mjs` (clique-para-andar, escada, marcador, bonequinho com mouse e toque, *Entrar aqui*, *Ir para…*, porta do WC Feminino).

## Novidades da v1.4.9 — saída de emergência na parede do palco

- Nova saída preta de 2 folhas na parede esquerda do templo (x = 0, z 13,8–15,4), perto do fundo, com guarnição de aço, barra antipânico cromada e placa SAÍDA verde; abre no modo Pessoa como as outras. O extintor que ficava ali foi para z 16,6.

## Novidades da v1.4.8 — fundo do templo sem saída

- A saída de vidro da parede do fundo do templo (z = 12,4, x 12,9–15,1) não existe na obra: virou parede preta lisa, e a placa de SAÍDA de cima dela saiu.

## Novidades da v1.4.7 — luz das salas à noite, sem estrelas, faixa da hora no celular

- Luz das salas à noite: cada cômodo aceso ganha uma "poça de luz" suave no piso, recortada nas paredes da sala (não é luz real: não pesa). As lâmpadas que eram só enfeite (WCs, depósito, circulação, almoxarifado, WC da pastoral) viram luz real no `alta` e entram no conjunto fixo de luzes do `media` (a quantidade de luzes não muda). No `leve`/`min` uma única luz acompanha o cômodo onde a pessoa (ou a câmera) está e acende junto com ele.
- Céu noturno sem estrelas.
- Demo no celular: a faixa da hora não fica mais no meio da tela — recolhida, vira uma pílula com a hora no canto do cartão do título; aberta, cobre só o cartão do título.

## Novidades da v1.4.6 — fundo do templo

- As folhas pretas de correr que ficavam estacionadas ao lado da saída de vidro do fundo do templo (parede z = 12,4) saíram, com puxador e trilho: ali agora é parede lisa. A saída de vidro continua.

## Novidades da v1.4.5 — portas conforme as fotos e portas que abrem no modo Pessoa

- **Modo Pessoa**: as portas abrem sozinhas quando a pessoa chega perto (~1,6 m) e fecham ~2,5 s depois que ela se afasta;
  também abrem com clique/toque ou Enter/E perto delas. Porta de giro gira para o lado livre (sem atravessar parede nem
  móvel), a de 2 folhas abre as duas. As folhas são instâncias de poucos InstancedMesh (~5 draw calls no prédio todo);
  fora do modo Pessoa ficam fechadas e iguais a antes. Parado, nada é redesenhado.
- **Portas (fotos do cliente)**: saíram a porta preta de correr do templo (com a placa de emergência) e a porta preta
  dupla para o hall dos banheiros (parede lisa); o WC masculino ficou com o vão aberto; a porta do hall de entrada para
  o templo virou 2 folhas de vidro.
- **Entorno**: saíram os dois prédios vizinhos e os muros brancos de divisa.
- **Demo**: a faixa da hora foi para o alto da tela.

## Novidades da v1.4.4 — cada ar liga na sua vez, com a câmera acompanhando

Voltou (e ficou melhor) a animação dos ares: **cada aparelho tem a sua própria sequência de ligar**, e ela vale em todas as vistas.
- **Por unidade:** o LED acende, a aleta abre (~0,6 s) e o fluxo de ar **nasce da aleta e cresce** até o comprimento cheio
  (~1 s); no piso o leque de ar também cresce. Depois o fluxo segue andando. Ao desligar, o fluxo recolhe e a aleta fecha.
  A cor continua seguindo o modo (azul-claro frio, laranja quente, neutro seco/ventilar).
- **Templo (5 splits):** as unidades ligam **em sequência**, uma a cada ~2,5 s, ao longo do templo (de z menor para maior).
  A câmera faz um **tour**: voa até cada split (~2,5 s parada em cada, com o aparelho e o fluxo nascendo) e termina num
  enquadramento da plateia inteira com os cinco ares ligados. **Arrastar, girar ou aproximar interrompe o tour** — as
  unidades que faltam continuam ligando, só a câmera para. Os outros ares (1 unidade) mantêm o voo até o aparelho.
- **Vale sempre** (clique no cartão, painel, Home Assistant ou automação; nunca na sincronização inicial da carga):
  - *Órbita normal:* o tour/voo acima.
  - *Vista de cima:* a planta **navega até o cômodo do ar** (no templo, a Plateia) e não sai da Vista de cima; o selo do modo
    **pulsa** na hora em que cada unidade liga e o leque no piso cresce, mais saturado e pulsando para ler de cima.
  - *Pessoa:* a pessoa não é teleportada; a sequência toca normalmente (dentro do templo ela vê cada unidade ligando).
- **Duração e custo:** a animação anda durante a sequência e por pelo menos 8 s depois da última unidade ligar (e enquanto a
  câmera estiver focada, como antes); depois o fluxo fica visível e parado — **0 redesenhos**. Respeita `prefers-reduced-motion`
  (sem tour: corte direto; as unidades acendem sem animação), aba oculta e cartão fora da tela. Sem luz nova e sem recompilar
  shader: o tempo de cada unidade vai num atributo de vértice + um uniform por entidade. Teste: `tools/air_test.mjs`.

## Novidades da v1.4 — Vista de cima navegável, Visão de pessoa e qualidade adaptativa

**Vista de cima navegável (blocos → cômodos → aparelhos).** O botão *Vista de cima* deixou de ser só uma foto da planta:
- **1º clique** num bloco (Templo · Hall / Família · Ala direita · Bloco dos fundos · Frente) aproxima a câmera, de cima, só nele;
  **2º clique** num cômodo enquadra só o cômodo; **dentro do cômodo** clicar na luminária, no ar, no telão ou no som liga e desliga
  (no piso, alterna a luz principal dele). O que está sob o mouse é realçado em âmbar e o nome aparece na trilha.
- Uma **trilha** mostra onde você está (`Planta › Ala direita › Mídia`) — cada item é clicável — e, no cômodo, uma fileira de
  **botões dos aparelhos** (luz, ar, telão, som…) com o estado; no celular a fileira rola na horizontal.
- **‹ Voltar** (ou Esc / Backspace) sobe um nível; na planta inteira, sai da Vista de cima. A câmera voa suave (3 s) e, com
  `prefers-reduced-motion`, corta direto. Os rótulos mostram só o que está dentro do bloco/cômodo. Redimensionar ou abrir o
  painel re-enquadra o **mesmo nível**. Ligar um ar na Vista de cima não tira você da planta (o selo do ar já mostra o estado).
- Ganchos: `setTopNav('ala', 'midia')` (liga a Vista de cima se preciso e navega direto; blocos `templo · ala · fundos · entrada` desde a v1.7)
  e `getTopNav()` → `{ level, block, room }`.

**Visão de pessoa (botão *Pessoa*).** Câmera na altura dos olhos (1,6 m; 1,0 m a mais em cima do palco), começando na calçada,
de frente para a porta principal:
- **PC:** `W A S D` ou setas andam (A/D e ← → andam de lado), **Shift** corre, `Q`/`E` giram, **arrastar** com o mouse vira a cabeça,
  **Esc** sai. **Celular/tablet:** **joystick** na tela (canto inferior esquerdo) anda e **arrastar** com outro dedo olha.
- **Colisão simples** com as paredes do modelo (deslizando ao longo delas): portas, vãos e a porta de vidro passam (a pessoa
  "abre" a porta, mesmo com o sensor `off`); vidros fixos, paredes e o portão fechado bloqueiam. O mobiliário não bloqueia.
- Luzes, ares, telão e som continuam clicáveis (toque curto ou clique). O painel se recolhe ao entrar e volta ao sair;
  *Vista de cima* e *Recentrar* também saem do modo, e o voo automático até o ar que ligou fica de fora enquanto você anda.
- Ganchos: `setWalk(true|false)`, `setWalkPose(x, z, yaw, pitch)` (yaw 0 olha para −z; + vira à esquerda) e `getWalkPose()`.

**Renderização maximizada em qualquer dispositivo — até numa torradeira.**
- Novo nível **`quality: min`** (automático em renderizador **por software** — SwiftShader/llvmpipe —, ≤ 2 GB ou ≤ 2 núcleos com ≤ 4 GB de
  RAM): sem sombras, pisos lisos (sem relevo nem AO), 5 luzes reais + telão, sem entorno; o resto da cena é o mesmo.
- **Governador de qualidade** em todos os níveis (`alta · media · leve · min`), pelo **tempo real de quadro**: enquanto você
  gira/anda a resolução sobe e desce sozinha (com histerese: 2 janelas de 300 ms lentas para baixar, 4 rápidas para subir);
  ao parar sai **um** quadro nítido — sempre na resolução cheia da tela, ou acima dela quando sobra fôlego (nunca acima de 3× o
  DPR nem de 4 Mpx) —, com o custo medido no quadro seguinte; o que se adapta é só o movimento (v1.4.1: antes a parada também
  podia cair abaixo da resolução cheia e a imagem ficava borrada). Parado continua **0 redesenhos**.
- Só no **`auto`**, se nem a resolução mínima aguenta (< 15 quadros/s por ~1,5 s; nunca nos 20 s após carregar), o governador
  desce uma escada: 1) some o entorno — e volta sozinho depois de ~6 s de movimento fluido; 2) menos luzes reais; 3) sem
  supersampling parado e escala mínima menor em movimento. Desde a v1.4.3 a **sombra do sol e a resolução cheia parada nunca
  caem** (antes a escada podia deixar a imagem borrada), o MSAA vale em toda GPU de verdade e o `media` voltou à sombra suave. Com
  `quality` manual (`alta|media|leve|min`) nada disso acontece — vale o que você escolheu (só a resolução se adapta).
  `getQuality()` mostra o estado (`{ tier, rung, moveScale, idleScale, lights, entorno }`).

## Novidades da v1.3 — ar por cômodo, Vista de cima e templo sem tesouras

- **Ar-condicionado em todo cômodo que aparece nos vídeos**: além do templo (5 splits) e da pastoral, agora a
  **sala de mídia** (`ac_midia`, split no fundo, vídeo v4) e o **voluntariado** (`ac_voluntariado`, split na parede de
  marmorato, vídeo v2) são entidades `climate` próprias, com bloco no painel, LED de modo e clique.
- **Animação do ar ao ligar**: a aleta abre e sai um fluxo de ar translúcido da unidade até o piso — azul-claro no
  frio, laranja no quente, neutro no seco/ventilar. Desligou, some. O fluxo anda (~16 quadros/s) só nos primeiros
  segundos depois de ligar ou enquanto a câmera está focada no ar, e só com o aparelho na tela; depois fica parado e
  visível. Com `prefers-reduced-motion` ou a aba oculta ele não anda, e sem ar ligado o cartão não redesenha nada.
- **A câmera voa até o ar que ligou**, venha o comando do cartão, do Home Assistant ou de uma automação: enquadra o
  aparelho e o fluxo; no templo faz o **tour pelos 5 splits** (v1.4.4) e fecha na plateia. Não voa na carga inicial; com
  vários ao mesmo tempo, vale o cômodo com mais unidades. Girar/aproximar interrompe o tour/solta o foco; **Recentrar**
  volta à vista padrão. Na Vista de cima navega até o cômodo; no modo Pessoa só a animação. Na demo, clicar num ar mostra tudo.
- **Botão "Vista de cima"**: planta vista de cima (quase a prumo), com o prédio inteiro, sem cobertura/fachada, todos
  os cômodos rotulados, as luzes acesas e um selo em cada ar ligado (❄ frio, chama quente, gota seco, hélice
  ventilar) — para conferir automações e animações de uma vez. **Recentrar** volta à vista normal. No celular os
  botões ficam em 2 linhas.
- **Templo sem as tesouras brancas**: a pedido do cliente saíram as tesouras/terças brancas da cobertura e as
  hastes/correntes; os **high-bays redondos, a fileira de lampadinhas e a treliça de luz da plateia ficam suspensos**
  no mesmo lugar e altura. A treliça preta do palco (sobre o telão) continua igual.

## Novidades da v1.2 — templo e acabamentos reais (fotos e vídeos do cliente)

A v1.2 refaz o templo e os acabamentos a partir da foto do templo e dos vídeos enviados pela igreja,
que passaram a ser a referência principal. A planta continua valendo para paredes e portas.

**Templo com o palco na parede lateral**
- **O palco agora fica na parede lateral longa (x = 0), a pedido do cliente.** Ele é "atravessado": tem 16,6 m
  de frente, 4,85 m de fundo e 1,0 m de altura, e a plateia fica virada para ele. A **sala de mídia fica de frente
  para o palco**, e pelo visor dela se vê o culto.
- A **parede do palco é preta e tem 8,5 m de altura** mesmo na vista de casinha de boneca, porque é o fundo do
  palco. As outras paredes do templo continuam com 3 m para deixar o interior à mostra, e as faces internas delas
  também são pretas.
- **O telão de LED tem 8,4 × 3,0 m** e fica logo acima do piso do palco. Ao lado dele há **duas telas brancas de
  projeção**, que acendem de leve com o telão.
- **A treliça preta fica acima do telão**, com os **4 moving heads** do `palco`, pares e barras de LED. Os feixes
  seguem a cor RGB. Há ainda **line arrays** pendurados por correntes (dois clusters por lado) e uma segunda
  treliça de luz sobre a plateia.
- **O palco segue a foto:**
  - piso de madeira clara com testeira preta;
  - escadas com corrimão inox nas duas pontas;
  - bateria Pearl sobre praticável preto;
  - teclado em suporte X, violão e baixo em pedestais;
  - microfones, retornos e pedaleiras.
- **A cobertura fica aparente**, com tesouras metálicas brancas a cada 5 m, pilares e vigas pretos, terças e um
  cordão de lampadinhas quentes no beiral. Os **12 high-bays redondos** da `plateia` ficam pendurados nas tesouras (tesouras retiradas na v1.3).
  No modo Fachada a cobertura interna some.
- **A plateia tem 414 cadeiras pretas estofadas de encosto alto** em 4 blocos. O corredor central fica alinhado
  com o centro do palco, e os blocos das pontas são levemente angulados, como nos vídeos. Os corredores deixam
  livres as portas, o visor da mídia e o acesso do hall.
- **O piso do templo é de porcelanato cinza-claro 0,9 × 0,9 polido**, que reflete as luzes.
- **Paredes do templo:** 5 ares grandes no alto, nenhum deles na parede do palco. Há também extintores com placa,
  placas de SAÍDA acesas e uma porta preta de correr com a placa "SAÍDA DE EMERGÊNCIA".

**Acabamentos do prédio**
- **Piso:**
  - laminado carvalho/mel com rodapé de madeira nos corredores, salas, mídia, voluntariado e escritórios;
  - porcelanato bege 0,9 × 0,9 nos banheiros.
- **Paredes:** internas em greige, com paredes de destaque em **marmorato** (cimento queimado).
- **Portas e janelas:** portas de **cedro** com guarnição de madeira e alavanca cromada; visores e janelas internas
  com caixilho preto e vidro fumê.
- **Mídia (v4):** placas acústicas grafite, bancada preta longa sob o visor, monitores, road case turquesa e
  cadeiras de operador com assento e encosto azuis.
- **Voluntariado (v2):** letreiro "FAÇAM TUDO COMO PARA O SENHOR", poltronas terracota, sofás cinza, cortina,
  buffet grafite com tampo de madeira e frigobar.
- **Depósito:** estantes de aço preto com caixas organizadoras.
- **Banheiros (v3):**
  - porcelanato cinza até 1,3 m, com **mármore marrom imperador** acima;
  - bancadas de quartzo com cubas de apoio e espelhos com moldura de LED que acendem com `banheiros`;
  - cabines de vidro fumê;
  - bebedouro inox;
  - faixa azul com a placa na entrada.
- **Hall e Sala da Família:** parede de marmorato no hall; WC e WC PCD no mesmo padrão dos banheiros; sala da
  família com marmorato, sofá cinza e cortinas.
- **A vista inicial ficou um pouco mais à direita.** Ela mostra o palco e o telão em diagonal sem perder o
  letreiro da fachada.

**Motor**
- **Materiais com padrão calculado no espaço** (`M.marmorato`, `M.acustico`, `M.porcelanatoCinza`,
  `M.marmoreMarrom`): repetem em metros em qualquer peça, sem textura nem sampler a mais.
- **Novos estilos de luminária:** `moving` (moving head de treliça) e `hang` (high-bay preso a uma estrutura; na v1.3 virou `susp`, suspenso sem haste).
- **Novas opções de parede:** revestimento por lado (`clad`) e porta preta de correr (`style: 'black'`).
- **Correção de desempenho:** o cache de materiais (`ctx.std`) serializava a imagem inteira de uma textura a
  cada chamada, o que custava cerca de 2,5 s por construção da cena. Agora usa o uuid da textura.

## Novidades da v1.1 — logo, renderização e decoração

**Logo da Base Church (fiel à foto da fachada)**
- Uma **única função de desenho** do logo oficial (anel espesso com o "B" bold; "BASE" e "CHURCH" com a mesma
  largura, CHURCH um pouco menor), com as proporções medidas na foto. A fonte é medida e ajustada no canvas,
  então sai igual no Windows, Android e Linux (sem depender de "Arial Black"). Todos os logos do cartão usam
  essa função: fachada, totem, telão, LED do palco, recepção, hall, capachos, placas e telas.
- O **painel ripado bege-rosado de 0 a 8,5 m com o letreiro BASE CHURCH em letras caixa prateadas** agora é
  visível **sempre** (não só no modo Fachada): o prédio preto é reconhecível da rua e na vista inicial.
  À noite as letras acendem com a luz `fachada`, com halo de retroiluminação e 4 embutidos lavando o ripado.
- Logo em **LED acima do telão** (acende com o `palco`), **totem de entrada** de 4 m na calçada com o logo
  em relevo e "802 SUL · PALMAS", paredão da marca no pátio, letreiros no hall, na recepção, no voluntariado e
  na plateia, adesivos jateados nas portas de vidro do templo e capachos com o logo.

**Renderização**
- Tone mapping **Neutral** (exposição 1,0): a "Igreja Preta" fica preta de verdade e o roxo do palco e o
  telão ficam saturados; preto da fachada com **juntas de painel** (sem textura extra).
- **Feixes de luz** nos 4 refletores do palco (seguem a cor RGB e o brilho de `palco`), telão com cores fiéis
  e halo de LED, vidro com reflexo do céu, menos luz "chapada" de dia (mais volume nas sombras).
- Emissivos da decoração (LEDs, letreiros, telas) **acompanham a entidade** — de dia e com tudo desligado o
  palco não fica mais "ligado".
- Rótulos com tamanho fixo na tela, escondidos atrás das paredes e com nível de detalhe (de longe, só os
  ambientes principais; no celular, só os maiores).
- Câmera inicial de frente, pelo estacionamento (fachada e logo legíveis, palco e telão visíveis); em
  retrato os botões quebram em duas linhas.
- Sombras das luzes desenhadas uma vez e em 256² (160 → 64 MB de GPU); `quality: auto` (padrão) usa o
  perfil leve em celular/tablet; salvaguarda automática em GPU com poucos uniforms/samplers.

**Decoração**
- Palco "black box" com cortinas de molton, logo no bumbo e no púlpito; plateia com painéis acústicos pretos,
  ripado com fita de LED, 504 lugares e **pendentes lineares de LED** em 2 trilhos de teto (corredor central livre).
- Entorno mais realista: gramado seco, vizinhos, muros de divisa, árvores com copa em cachos, postes de rua,
  paraciclo e carros com cabine afunilada; ipê-amarelo do pátio refeito com flores caídas.
- Mais detalhe em todos os ambientes (hall, Sala da Família, WCs, mídia, voluntariado, recepção, pastoral,
  caixa d'água, cozinha, pátio) — ver `rooms/*.js`.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `igreja3d-card.js` | **O cartão.** É o único arquivo que vai para o Home Assistant. |
| `index.html` | Demo standalone com estados simulados (noite de culto) — abre direto no navegador (duplo clique). |
| `demo.template.html` + `build.py` | Geram o `index.html` a partir do cartão (`python3 build.py`). |
| `rooms/*.js` + `integrate_rooms.py` | Fonte da decoração de cada área (uma função `room…(ctx)` por arquivo), colada no cartão pelo `integrate_rooms.py`. |
| `rooms/BRIEF.md` | Especificação da planta: coordenadas, paredes, aberturas, pilares, objetos do cartão e regras da decoração. |
| `tools/shot.mjs` | Screenshot da demo com Playwright (Chromium/SwiftShader), para conferir o cartão sem GPU. |
| `tools/lib.mjs` + `nav_test.mjs`, `walk_test.mjs`, `gov_test.mjs`, `integ_test.mjs`, `door_test.mjs`, `air_test.mjs`, `street_test.mjs` | Testes headless (Vista de cima navegável, visão de pessoa, governador, convivência, portas, ares, clique-para-andar / escada / bonequinho). `THREE_LOCAL=<three.module.min.js> node tools/nav_test.mjs index.html` |
| `hacs.json` | Permite instalar pelo HACS como repositório personalizado. |

## Instalação no Home Assistant

### Opção A — pelo GitHub (sem copiar arquivo)
Recurso do Lovelace apontando para o CDN do GitHub (jsDelivr):
`https://cdn.jsdelivr.net/gh/LGRSV/igreja-3d-v1@main/igreja3d-card.js` (tipo **Módulo JavaScript**).
Ou pelo HACS: *HACS → ⋮ → Repositórios personalizados → URL do repositório, categoria Dashboard*,
depois "Baixar" — o `hacs.json` já está no repositório (URL: `https://github.com/LGRSV/igreja-3d-v1`).
A demo fica publicada em `https://lgrsv.github.io/igreja-3d-v1/` (Settings → Pages → branch `main`, pasta `/`).

> O jsDelivr guarda cache do `@main` por até 12 h. Depois de atualizar o repositório, use
> `https://purge.jsdelivr.net/gh/LGRSV/igreja-3d-v1@main/igreja3d-card.js` ou fixe um commit/tag
> (`@<hash>`) na URL do recurso.

### Opção B — arquivo local

1. Copie `igreja3d-card.js` para `/config/www/igreja3d/igreja3d-card.js`
   (pelo Samba: `\\homeassistant\config\www\igreja3d\`, ou pelo File editor).
2. **Definições → Painéis → ⋮ (canto superior direito) → Recursos → Adicionar recurso**
   - URL: `/local/igreja3d/igreja3d-card.js?v=1`
   - Tipo: **Módulo JavaScript**
   - Se a opção "Recursos" não aparecer, ative o *Modo avançado* no seu perfil de usuário.
3. No dashboard, crie uma vista do tipo **Painel** e adicione o cartão em YAML:

   ```yaml
   type: custom:igreja3d-card
   title: Base Church
   entities:
     palco: light.SEU_PALCO     # troque pelos IDs reais — veja abaixo
   ```
4. Recarregue a página (Ctrl+F5; no app, feche e abra). Sempre que atualizar o arquivo,
   aumente o `?v=` do recurso para furar o cache.

## Configuração completa (tudo opcional)

> **Importante:** os IDs de entidade abaixo são **nomes de exemplo** (é o que a demo usa). Troque
> cada um pelo `entity_id` real da sua instalação (*Definições → Dispositivos e serviços → Entidades*).
> Uma entidade que não existe no HA aparece como "indisponível" no painel e o ambiente fica apagado.
> Pode apontar duas chaves para a mesma entidade (ex.: `recepcao` e `administrativo` no mesmo circuito).

```yaml
type: custom:igreja3d-card
title: Base Church
mode: auto            # auto = segue sun.sun | day | night
night_vision: true    # à noite, luz de lua + ambiente frio: a igreja inteira fica legível
labels: true          # nomes dos ambientes flutuando (somem no modo Fachada)
height: calc(100vh - 100px)   # numa vista com seções use algo como 560px
panel: true           # painel lateral aberto ao iniciar (false = recolhido); no celular a gaveta sempre começa recolhida
fachada: false        # começa no modo Fachada (paredes altas, cobertura e fachada completa)
quality: auto         # auto (padrão: alta com GPU dedicada; media em PC com vídeo integrado; leve em celular/tablet ou ≤ 4 GB de RAM;
                      #   min em renderizador por software, ≤ 2 GB ou ≤ 2 núcleos com ≤ 4 GB) · alta · media · leve · min
entorno: auto         # ruas, árvores de rua e postes: auto (some só no leve) · true · false
weather: true         # widget de clima ao vivo no canto inferior esquerdo (Open-Meteo, sem chave)
weather_city: 'Palmas, TO'
timezone: America/Sao_Paulo      # relógio e nascer/pôr do sol (no HA vale o fuso do próprio HA)
latitude: -10.27                 # clima (sempre) e posição do sol fora do HA — no HA o sol usa
longitude: -48.33                #  a localização configurada no próprio HA (hass.config)
orientation: 90       # sol: com 90 ele nasce nos fundos e se põe na frente (Base Church). Se o sol aparecer do lado errado, use 270
entities:
  # ---- Templo ----
  palco:          light.palco_rgb              # moving heads do palco (RGB + brilho)
  plateia:        light.templo_plateia         # luminárias da plateia (brilho)
  telao:          media_player.telao_led       # telão LED: acende e mostra o título tocando
  som:            switch.som_templo            # LEDs verdes nas quinas do palco
  ac_templo:      climate.ar_templo            # 5 splits do templo (LED azul = frio; aleta + fluxo de ar)
  presenca:       binary_sensor.presenca_templo  # só leitura
  temperatura:    sensor.temperatura_templo      # só leitura
  # ---- Entrada / frente ----
  hall:           light.hall_entrada
  fachada:        light.fachada_letreiro       # refletor do letreiro + arandelas
  estacionamento: light.estacionamento         # postes da frente + arandela do pátio
  porta:          binary_sensor.porta_principal  # porta de vidro abre no modelo quando "on"
  banheiros:      light.banheiros              # WCs, hall dos banheiros e depósito
  # ---- Administração / apoio ----
  pastoral:       light.sala_pastoral
  ac_pastoral:    climate.ar_sala_pastoral
  recepcao:       light.recepcao
  administrativo: light.administrativo         # Administrativo + Sala Gilvan
  circulacao:     light.circulacao             # corredores da ala direita
  midia:          light.sala_midia
  ac_midia:       climate.ar_midia             # split da sala de mídia (vídeo v4)
  voluntariado:   light.voluntariado
  ac_voluntariado: climate.ar_voluntariado     # split do voluntariado (vídeo v2)
  cozinha:        light.cozinha                # cozinha + almoxarifado
  sun:            sun.sun                      # dia/noite automático
```

Só precisa listar as chaves que quiser trocar; as que ficarem de fora usam o nome de exemplo acima.

## Como funciona

- **Luz / interruptor**: clique no ambiente, na luminária ou no bloco → `homeassistant.toggle` na
  entidade (resposta otimista, o HA confirma em seguida). A luz do palco segue a cor real
  (`rgb_color`) e o brilho; a plateia segue o brilho.
- **Telão, ares e sensores**: clique abre o *more-info* da entidade (o painel padrão do HA).
- **Ares (`climate`)**: um por cômodo que tem ar nos vídeos — templo (5 splits), mídia, voluntariado — e a pastoral.
  Ligado, a aleta abre e sai o fluxo de ar (cor pelo modo); o LED mostra o modo. Quando um ar liga (pelo cartão, pelo
  HA ou por automação, fora da carga inicial) cada unidade **liga na sua vez** (LED, aleta, fluxo nascendo; no templo uma a cada
  ~2,5 s) e a **câmera acompanha** (tour no templo, voo nos demais, navegação na Vista de cima); *Recentrar* volta.
- **Vista de cima**: o botão mostra a planta de cima, sem cobertura, com todos os cômodos rotulados e um selo em cada
  ar ligado (❄ frio · chama quente · gota seco · hélice ventilar · A auto). Dela dá para **descer por níveis** — clique num
  bloco, depois num cômodo, e ligue/desligue os aparelhos dele; **‹ Voltar** (ou Esc) sobe um nível. *Recentrar* volta à vista normal.
- **Pessoa**: o botão *Pessoa* põe a câmera na altura dos olhos, dentro do prédio: setas/WASD (ou o joystick na tela) andam,
  arrastar vira a cabeça, Shift corre, Esc sai. As paredes seguram a pessoa; portas e vãos passam. **Clique/toque no piso** (ou na
  escada / no mezanino) caminha até lá; o **bonequinho**, o *Entrar aqui* (Vista de cima) e o *Ir para…* escolhem o ambiente de entrada.
- **Porta principal**: as duas folhas de vidro abrem para fora quando `binary_sensor.porta_principal` fica `on`.
- **Sombras reais**: as paredes bloqueiam a luz (8 luminárias projetam sombra). As sombras só
  recalculam quando um estado muda, então o custo em repouso é baixo.
- **Dia/noite**: em `auto` segue o `sun.sun`; os botões Dia/Noite forçam. À noite a *visão noturna*
  (luz de lua + ambiente frio) mantém a igreja legível; desligue no botão para o visual escuro.
- **Tempo real**: data e hora no fuso de `timezone`, nascer e pôr do sol do dia e, em `mode: auto`,
  o sol real (elevação/azimute do `sun.sun`, ou calculados por latitude/longitude) move a sombra.
- **Fachada**: o botão *Fachada* mostra o prédio como ele é por fora — bloco preto de 8,5 m do templo
  e do hall, painel ripado de madeira clara com o logo "B / BASE CHURCH", ala direita de 4,5 m com o
  beiral de treliça e forro amadeirado, condensadoras no telhado, platibandas e coberturas. Desligado,
  volta a vista de casinha de boneca (paredes de 3 m, sem teto — exceto a parede preta de 8,5 m atrás do palco;
  sobre o templo só as luminárias suspensas, sem as tesouras brancas). O **painel ripado com o letreiro BASE
  CHURCH e o refletor ficam visíveis nos dois modos** (a identidade do prédio vista da rua); os rótulos dos
  ambientes somem enquanto o modo Fachada está ligado.
- **Entorno**: estacionamento frontal em intertravado cinza (espinha de peixe), sem carros, vagas PCD, cerca-viva e cicas na
  frente, totem de entrada com o logo, ruas da frente e dos fundos, árvores e postes — só contexto (vizinhos e muros de
  divisa saíram na v1.4.5).
- **Clima ao vivo (Palmas)**: widget no canto inferior esquerdo (some no modo Pessoa) com temperatura, condição, sensação
  térmica e vento — dados da [Open-Meteo](https://open-meteo.com/) (gratuita, sem chave), atualizados
  a cada 15 min, nas coordenadas `latitude`/`longitude` (padrão: Palmas-TO). Some quando o painel
  abre por cima e volta quando fecha. Desative com `weather: false`.
  Não funciona dentro do preview do Claude Artifact (o sandbox bloqueia requisições externas);
  funciona normalmente no GitHub Pages e no Home Assistant.

## Painel inferior (Ambientes · Automações · Atividade)

Barra na parte de baixo do cartão (recolhe pelo ˅ e volta pelo botão "Painel"). A câmera enquadra a
igreja na área que sobra acima dela.

- **Ambientes**: blocos agrupados por área (Templo, Entrada, Administração, Apoio), cada um com o
  dispositivo, o estado e há quanto tempo mudou; tocar alterna a entidade. O **⋯** abre os controles:
  cor e brilho do palco, brilho da plateia, modo e temperatura dos ares, tocar/pausar e volume do telão,
  e um **temporizador** ("desligar em 15/30/60 min") para qualquer luz/interruptor — ele roda no cartão,
  então só vale enquanto o painel estiver aberto (num tablet de parede, sempre). Presença, porta e
  temperatura são blocos só de leitura.
- **Automações**: *rotinas rápidas* do cartão (ações compostas — `SCENES` no topo do arquivo) e, abaixo,
  **todas as automações do seu Home Assistant** (`automation.*`), descobertas sozinhas: ativar/desativar,
  executar agora (▶, `automation.trigger`) e a última execução.
- **Atividade**: histórico do que ligou/desligou, disparos de automação, presença e porta, com hora e
  tempo relativo.

### Rotinas rápidas

| Rotina | O que chama |
|---|---|
| **Culto** | liga palco, plateia, som, hall, fachada e estacionamento; `media_player.turn_on` no telão; `climate.set_hvac_mode: cool` nos ares do templo e da mídia |
| **Louvor** | plateia a 30 %, palco roxo/azul (`rgb_color` 110,70,255) a 100 %, telão e som |
| **Pregação** | plateia a 80 %, palco branco quente (255,196,140) |
| **Ensaio da banda** | palco, som e telão ligados; plateia apagada |
| **Abrir a igreja** | fachada, estacionamento, hall, banheiros e recepção |
| **Expediente** | administrativo, pastoral, recepção, circulação e ar da pastoral em frio |
| **Fechar tudo** | todas as luzes, som e telão desligados; os ares de todos os cômodos (templo, pastoral, mídia, voluntariado) em `off` |

Elas não precisam existir no HA: o cartão chama os serviços direto (`homeassistant.turn_on/turn_off`,
`light.turn_on`, `media_player.*`, `climate.set_hvac_mode`). Para mudar, edite `SCENES` no cartão.

## Mapa dos ambientes

Coordenadas em metros (X → direita a partir do muro esquerdo, Z → frente; fachada em z ≈ 49,7).

| Área | Ambientes | Entidade ao clicar |
|---|---|---|
| Fundos (z 0–12,4) | Estacionamento interno e pátio · Almoxarifado · Cozinha · Recepção · Sala Pastoral (+ banheiro) · Caixa d'água · jardins | `estacionamento` · `cozinha` · `recepcao` · `pastoral` |
| Ala direita (x 16–20) | Corredor da entrada lateral · Sala Gilvan · Administrativo · Circulação · Mídia · Voluntariado · Depósito · Área técnica · WC Masc. · Hall dos banheiros · WC Fem. | `circulacao` · `administrativo` · `midia` (+ `ac_midia`) · `voluntariado` (+ `ac_voluntariado`) · `banheiros` |
| Templo (z 12,4–44) | Palco na parede lateral x = 0 com telão, telas de projeção, banda, treliça e line arrays · plateia de 414 cadeiras virada para −x · cobertura aparente | `plateia` (piso, high-bays), `palco` (moving heads), `telao`, `som`, `ac_templo` |
| Entrada (z 44–49,65) | Hall com café, lounge e escada até o mezanino (salinha) · WC · WC PCD | `hall` · `banheiros` |
| Frente (z > 49,7) | Jardins, calçada, estacionamento frontal com vagas PCD | `fachada` · `estacionamento` |

## Ajustando a planta

Tudo está em metros no topo de `igreja3d-card.js` (X → direita, Z → frente) e documentado em
`rooms/BRIEF.md`:

- `ZONES` — os pisos (ambientes), a textura de cada um e qual entidade o clique alterna.
- `ITEMS` — luminárias: posição `p`, intensidade `i` (cd), alcance `d` (m), estilo (refletor com feixe, moving head, pendente linear de LED,
  high-bay industrial, poste, arandela) e quais projetam sombra.
- `PILLARS_L` / `PILLARS_R` — pilares do templo nas paredes x = 0 e x = 16,05.
- `_buildWalls()` — paredes com portas (`door`), janelas (`window`), vidro (`glass`), porta de vidro de
  2 folhas (`glassdoor`), vãos (`open`) e portão (`gate`).
- `_buildFurniture()` — objetos ligados a entidades (telão, som, splits) e chamadas das funções de
  decoração (`roomTemploPalco`, `roomTemploPlateia`, `roomHall`, `roomAlaDireita`,
  `roomAdministrativo`, `roomServicoPatio`, `roomFachada`), coladas entre `@rooms-begin` e `@rooms-end`.
- Para refazer a decoração de uma área: edite `rooms/<área>.js` e rode `python3 integrate_rooms.py`.

Depois de editar, `python3 build.py` regenera a demo. Para conferir sem GPU:
`THREE_LOCAL=<three.module.min.js> WAIT=8000 node tools/shot.mjs index.html vista.png 1400 900 'document.querySelector("igreja3d-card").setFachada(true)'`
(ganchos: `setView([x,y,z],[tx,ty,tz])`, `setFachada(bool)`, `setMode('auto'|'day'|'night')`, `setSimTime(data)`, `setTopNav(bloco, cômodo)`/`getTopNav()`,
`setWalk(bool)`/`setWalkPose(x,z,yaw,pitch)`/`getWalkPose()`, `getQuality()`;
na demo, `window.demo.set('palco','on',{rgb_color:[255,0,0]})` e `window.demo.setAll(true)`).

## Desempenho

Medido na demo (Chromium, vista padrão 1400×900). A cena roda no dispositivo que abre o dashboard,
não no HA nem no GitHub.

- ~5.200 malhas (paredes, palco, móveis, fachada) são fundidas por material na inicialização:
  **5.152 → 250 draw calls** na cena + **171 → 12** no grupo da Fachada. As 414 cadeiras e a cobertura do templo
  já saem fundidas da própria decoração (4.418 peças → 14 malhas). No total, a vista padrão desenha **~405 draw
  calls por quadro** (com pisos, luminárias, rótulos, halos e feixes). A v1.1 desenhava ~419; a vista de topo
  caiu de 414 para 399 e o interior do templo de 237 para 221.
  Materiais simples praticamente iguais (±22/255 na cor, ±0,25 na rugosidade) são unificados antes da
  fusão; materiais **idênticos** com textura/emissivo/transparência também (ex.: as laterais de todas as
  letras caixa do logo), os halos da mesma entidade compartilham material e as peças de uma mesma
  luminária/entidade viram uma malha só.
- **26 luzes reais** (PointLight: 25 luminárias + a do telão); **8 com sombra** em `quality: alta`.
  As outras luminárias são só "brilho" (emissivo + halo), sem custo de luz.
- **`quality: media`** (v1.3, automático em PC com vídeo integrado — Intel, AMD APU): visual próximo do alta
  com custo perto do leve. Entorno visível (gramado Lambert sem o laço das lâmpadas); **conjunto fixo de 11 luzes
  reais (2 com sombra)** redistribuído às luminárias que importam no enquadramento quando a câmera para — de longe
  parece o leve, perto de um cômodo fica igual ao alta; environment map só nos materiais brilhantes (vidro, metal,
  porcelanato polido) e sonda SH para a luz difusa do céu; shaders compilados antes do primeiro quadro; resolução
  dinâmica durante o movimento. Medido no SwiftShader (1400 × 900): quadro ~550 ms (leve ~300–390, alta ~3.200).
- **`quality: leve`** (automático em celular/tablet, ex. Galaxy Tab S6 Lite): só **9 luzes reais** —
  palco 2, plateia 2, hall 1, fachada 1, estacionamento 2 e o telão (tabela `LITE_LIGHTS` no topo do
  arquivo) — mais fortes e com alcance maior para compensar; as demais viram brilho, **nenhuma lâmpada
  projeta sombra** (só o sol, 1024²); parado a imagem sai na resolução cheia da tela (até 2 Mpx). O visual é
  praticamente o mesmo; as salas pequenas ficam um pouco mais escuras à noite. Medido no SwiftShader:
  quadro ~1,7× mais rápido e atualização de sombras de 635 ms → 5 ms.
  Desde a v1.2.4 o leve também: fica **sem o reflexo do céu** (environment map, ~⅓ do custo de cada quadro),
  **esconde o entorno** (ruas, vizinhos, árvores de rua e postes; o gramado vira cor chapada — volta com
  `entorno: true`), **não anima o telão parado** (sem interação a cena não é redesenhada) e, enquanto
  você gira/aproxima, desenha com 55 % da resolução e faz um quadro nítido ao soltar. Medido no
  SwiftShader (1400 × 900): quadro 1914 → 390 ms (~5×) e carregamento 10,3 → 4,9 s.
  Em GPU com pouca margem (< 512 vetores de uniform no fragment ou < 16 samplers) as luzes fracas
  das salas viram só brilho (fica com 16 luzes reais, 3 com sombra) e o cartão avisa no console.
- **`quality: min`** (v1.4, automático em renderizador por software, ≤ 2 GB ou ≤ 2 núcleos com ≤ 4 GB): tudo do `leve` e mais
  **nenhuma sombra** (nem a do sol), pisos sem relevo/AO e só **5 luzes reais + telão** (`MIN_LIGHTS`). Medido no
  SwiftShader (1400 × 900, mesma sessão do `leve`): quadro **~0,6× o do `leve`** (171–240 ms contra 295–374 ms; `alta` ~3.200,
  `media` ~550), mesmas 390 chamadas e 222 mil triângulos, carga com shaders em cache em ~2,7 s (`leve`: 12–15 s, pelos shaders de sombra).
  Como o SwiftShader é software, o `auto` cai em `min` nele.
- **Governador de qualidade** (v1.4): a resolução em movimento parte de 100 % (alta), 60 % (media), 55 % (leve) ou 45 % (min)
  e desce até 50 / 35 / 35 / 30 % conforme o tempo de quadro (no SwiftShader chega ao piso em ≤ 3 s de arrasto); ao soltar sai
  exatamente **um** quadro nítido. Parado, 0 redesenhos (medido em 8 s: `media` 0 · `min` 0 · `leve` 1 do assentamento da câmera ·
  `alta` ≤ 8/s só com o telão tocando). A escada de rebaixamento (só no `auto`) foi exercitada forçando `media` + `auto` num arrasto
  de 30 s: degrau 1 (entorno some) → 2 (11 → 7 luzes reais) → 3 (resolução mínima menor), sem erros e sem travar a página.
- **Vista de cima e Pessoa** não redesenham parados; andar liga o mesmo caminho de resolução reduzida do governador
  (a flag de movimento do controle de câmera é espelhada pelo andador). A colisão usa ~90 segmentos de parede
  (`_walls`, registrados em `_wallSeg`) e custa microssegundos por quadro.
- Sombras das luzes em 256² (no `leve` não há sombra de lâmpadas): **~64 MB** de GPU no total, contra 160 MB antes. Elas são
  desenhadas **uma vez** (a geometria é estática) e só refeitas quando a porta do hall gira ou o modo
  Fachada muda; nas transições dia/noite e com o sol andando só a sombra do sol é refeita.
- Tone mapping Neutral (exposição 1,0): o preto da fachada fica preto e as cores do palco e do telão
  ficam fiéis. O telão não passa pelo tone mapping e tem um halo de LED em volta; os 4 refletores do
  palco (moving heads) têm feixe de luz falso (cone aditivo, 4 draw calls) que segue a cor RGB e o brilho da entidade.
- Construção da cena (`_build3D`): **~0,55 s** com os shaders já em cache (v1.1: ~0,58 s no mesmo teste) e
  ~10–11 s na primeira vez, quase tudo compilação de shader. A medição é em Chromium com SwiftShader (CPU, sem GPU);
  numa GPU real é bem menos. São **~252 mil triângulos** (v1.1: ~307 mil) e 33 programas de shader (v1.1: 29; os 4 a
  mais são os padrões em espaço de mundo). Cada material usa no máximo 13 das 16 unidades de textura
  (map + bump + ao + ambiente + 9 sombras).
- Sombras só recalculam quando um estado muda; nada é renderizado parado (só quando a câmera se
  move, um estado muda ou o telão está tocando, a 30 fps).
- Pixel ratio adaptativo (v1.4.1): parado, a imagem sai sempre na **resolução cheia** da tela (teto de 2,8 Mpx em `alta`, 3,5 com GPU
  dedicada; 2,4 em `media`; 2,0 em `leve`; 1,4 em `min`), com MSAA em toda GPU de verdade; só o movimento desenha uma fração disso.
- Parado, a cena não é redesenhada; com o telão tocando, a animação roda a no máximo ~8 quadros/s e para quando a aba ou o cartão saem da tela.
- Ligar/desligar luz não recompila shaders (todas as luzes ficam ativas com intensidade zero).
- No disco o cartão tem ~485 KB (a demo `index.html`, com o cartão embutido, ~497 KB).

## Observações

- A geometria é **aproximada** a partir da planta de layout do térreo (Uõma Arquitetura, NOV/2024,
  escala 1:100) — precisão de ~0,1 m, não é levantamento. Alturas externas (8,5 / 4,5 / 3,6 m) e a
  fachada vêm de uma foto; o mobiliário é ilustrativo.
- **Orientação** (`orientation`, padrão 90): na Base Church o sol nasce nos fundos e se põe na frente (corrigido na v1.8).
  Para outro prédio, gire em passos de 90 até o sol bater do lado certo.
- As entidades de `entities:` são exemplos — troque pelos IDs reais antes de usar.
- O Three.js é carregado do jsDelivr (`three@0.170.0`): o **dispositivo que abre o dashboard** precisa
  de internet; o HA em si não.
- Testado em Chromium desktop e layout de celular (retrato afasta a câmera para caber o prédio inteiro).
