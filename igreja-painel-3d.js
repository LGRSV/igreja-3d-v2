/*
 * igreja-painel-3d.js — GERADO por build_painel.py (não editar à mão).
 * Base: igreja3d-card.js v1.8.0 (cena da Base Church) + painel/motor.src.js (vistas do painel).
 */
/*
 * Igreja 3D — cartão Lovelace para Home Assistant (+ demo standalone)
 * Modelo 3D da Base Church (802 Sul · Palmas-TO) em Three.js. As luzes, o telão,
 * o som e os ares acendem conforme o estado das entidades do HA; clicar num
 * ambiente (ou num bloco do painel) alterna a entidade.
 * Motor derivado do casa3d-card (repositório casa-chefe).
 *
 * Instalação: veja o README.md ao lado deste arquivo.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const CARD_VERSION = '1.8.0';

// Única fonte de verdade para as opções do cartão — usada tanto no construtor (antes de
// qualquer setConfig, caso do próprio elemento já presente no HTML ao carregar o módulo)
// quanto em setConfig().
const DEFAULT_CONFIG = {
  title: 'Base Church', labels: true, mode: 'auto', night_vision: true, panel: true, roof: false,
  quality: 'auto', entities: {},   // auto | alta | media | leve | min
  entorno: 'auto',                 // gramado com textura: auto (chapado só no leve) | true | false (v1.8: sem ruas, árvores e postes)
  latitude: -10.27, longitude: -48.33, timezone: 'America/Sao_Paulo', orientation: 90,
  weather: true, weather_city: 'Palmas, TO',
  fachada_pessoa: true,            // v1.5.5: a visão de Pessoa liga a Fachada sozinha (e volta ao sair)
};

// ---------------------------------------------------------------------------
// Entidades (sobrescreva no YAML do cartão em `entities:`) — nomes de exemplo
// ---------------------------------------------------------------------------
const DEFAULT_ENTITIES = {
  palco:          'light.palco_rgb',
  plateia:        'light.templo_plateia',
  telao:          'media_player.telao_led',
  som:            'switch.som_templo',
  ac_templo:      'climate.ar_templo',
  hall:           'light.hall_entrada',
  fachada:        'light.fachada_letreiro',
  estacionamento: 'light.estacionamento',
  pastoral:       'light.sala_pastoral',
  ac_pastoral:    'climate.ar_sala_pastoral',
  recepcao:       'light.recepcao',
  administrativo: 'light.administrativo',
  circulacao:     'light.circulacao',
  midia:          'light.sala_midia',
  ac_midia:       'climate.ar_midia',
  voluntariado:   'light.voluntariado',
  ac_voluntariado:'climate.ar_voluntariado',
  cozinha:        'light.cozinha',
  banheiros:      'light.banheiros',
  presenca:       'binary_sensor.presenca_templo',
  porta:          'binary_sensor.porta_principal',
  temperatura:    'sensor.temperatura_templo',
  sun:            'sun.sun',
};

// ---------------------------------------------------------------------------
// Itens controláveis: luminárias (posição em metros, X→direita, Z→frente)
// i = intensidade (cd), d = alcance (m), shadow = projeta sombra nas paredes
// Estilos: (padrão) pendente · spot = refletor de palco (com feixe; aim 'wall' = lava a fachada, 'out' = da fachada para o estacionamento) · moving = moving head de treliça (feixe para +x/baixo)
// · highbay = pendente industrial grande (susp = redondo menor do templo, suspenso no ar, sem haste — o cliente pediu a cobertura sem as tesouras) · linear = pendente linear de LED 2,4 m (cabos até o trilho do teto, y 6,43) · sconce = arandela · lamp = abajur.
// glowOnly = só lâmpada + halo + emissivo (sem PointLight — economiza luzes reais).
// liteShadow = mantém a sombra em GPU com margem pequena (_tight). Em `quality: leve` nenhuma lâmpada projeta sombra (só o sol).
// ext = a luminária só aparece no modo Fachada (a luz em si vale sempre).
// ---------------------------------------------------------------------------
// quality leve: quantas luzes reais cada item mantém (as outras viram só brilho). Total ≈ 8 + telão.
const LITE_LIGHTS = { palco: 2, plateia: 2, hall: 1, fachada: 1, estacionamento: 2 };
// quality media (PC com vídeo integrado): um conjunto FIXO de luzes reais (quantidade constante → nenhum shader recompila)
// redistribuído às luminárias que importam no enquadramento quando a câmera para; as primeiras MID_SHADOWS projetam sombra.
const MID_LIGHTS = 10, MID_SHADOWS = 2;
// quality min (aparelho muito fraco: sem GPU real, ≤ 2 GB, ou ≤ 2 núcleos com ≤ 4 GB): 1 luz real por item principal, sem sombras. Total ≈ 5 + telão.
const MIN_LIGHTS = { palco: 1, plateia: 1, hall: 1, fachada: 1, estacionamento: 1 };
// Governador de qualidade (ver _govFrame): por nível, a escala de resolução em movimento (move; min–max) e parado (idleMin–idleMax,
// >1 = supersampling quando sobra fôlego). Trocar luzes/sombras/materiais recompila shaders, então o nível é fixo na construção.
const GOV = {
  alta:  { move: 1.0,  min: 0.5,  max: 1.0,  idleMax: 1.5,  idleMin: 1 },   // parado nunca abaixo da resolução cheia (v1.4.1):
  media: { move: 0.6,  min: 0.35, max: 0.75, idleMax: 1.25, idleMin: 1 },   // o quadro nítido é um só; a leveza fica no movimento
  leve:  { move: 0.55, min: 0.35, max: 0.55, idleMax: 1.15, idleMin: 1 },
  min:   { move: 0.45, min: 0.3,  max: 0.5,  idleMax: 1.0,  idleMin: 1 },
};
// ordem em que o governador tira luzes reais (as menos importantes primeiro) ao descer de nível
const SHRINK_ORDER = ['circulacao', 'administrativo', 'recepcao', 'cozinha', 'banheiros', 'midia', 'voluntariado', 'pastoral', 'estacionamento', 'hall', 'plateia', 'palco'];

const ITEMS = [
  { key: 'palco', label: 'Palco (RGB)', short: 'Luz RGB', kind: 'light', icon: 'spot', rgb: true, dim: true, color: 0xb88cff,
    fixtures: [
      // 4 moving heads pendurados na treliça preta acima do telão (parede do palco x = 0), mirando o palco (+x e para baixo)
      { p: [0.8, 6.05, 23.9], i: 70, d: 14, moving: true, shadow: true },
      { p: [0.8, 6.05, 26.7], i: 70, d: 14, moving: true },
      { p: [0.8, 6.05, 29.5], i: 70, d: 14, moving: true },
      { p: [0.8, 6.05, 32.3], i: 70, d: 14, moving: true, shadow: true },
    ] },
  { key: 'plateia', label: 'Plateia', short: 'Luz', kind: 'light', icon: 'bulb', dim: true, color: 0xffe2bd,
    fixtures: [
      // high-bays redondos suspensos sobre a plateia (x 6,3–15,5), na altura de antes (y 7,2) — sem as tesouras brancas e
      // sem hastes (pedido do cliente); a linha de z 28,5 (sobre o corredor central, frente da mídia) fica sem luminária
      { p: [7.2, 7.2, 23.5], i: 120, d: 20, highbay: true, susp: true, shadow: true, liteShadow: true },
      { p: [14.0, 7.2, 23.5], i: 120, d: 20, highbay: true, susp: true },
      { p: [7.2, 7.2, 33.5], i: 120, d: 20, highbay: true, susp: true },
      { p: [14.0, 7.2, 33.5], i: 120, d: 20, highbay: true, susp: true, shadow: true },
      ...[[10.6, 23.5], [10.6, 33.5], [7.2, 18.5], [10.6, 18.5], [14.0, 18.5], [7.2, 38.5], [10.6, 38.5], [14.0, 38.5]]
        .map(([x, z]) => ({ p: [x, 7.2, z], highbay: true, susp: true, glowOnly: true })),
    ] },
  { key: 'telao', label: 'Telão LED', short: 'Telão', kind: 'media', icon: 'tv' },
  { key: 'som', label: 'Som do templo', short: 'Som', kind: 'switch', icon: 'speaker' },
  { key: 'ac_templo', label: 'Ar do templo', short: 'Ar', kind: 'climate', icon: 'ac' },
  { key: 'hall', label: 'Hall de entrada', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xffe7c8,
    fixtures: [
      { p: [7.5, 2.7, 46.8], i: 30, d: 8, shadow: true, liteShadow: true },
      { p: [11.5, 2.7, 46.8], i: 30, d: 8 },
      { p: [3.27, 3.95, 46.45], i: 10, d: 5.5, hidden: true },   // abajur da mesinha do mezanino (desenhado em rooms/hall.js; v1.8: era da luz da Sala da Família)
    ] },
  { key: 'fachada', label: 'Fachada / letreiro', short: 'Luz', kind: 'light', icon: 'sign', color: 0xffd9a8,
    fixtures: [
      { p: [8.9, 8.05, 50.35], i: 60, d: 11, spot: true, aim: 'wall' },   // no topo do painel ripado (sempre visível), acima do logo
      { p: [14.6, 2.8, 49.85], i: 14, d: 6, sconce: true },
      { p: [5.0, 2.8, 49.85], sconce: true, glowOnly: true },
    ] },
  { key: 'estacionamento', label: 'Estacionamento', short: 'Luz', kind: 'light', icon: 'car', color: 0xfff1dc,
    fixtures: [
      // v1.8: sem postes — 2 refletores discretos na fachada mirando o estacionamento (`l` = a luz fica sobre as vagas, não colada na parede)
      { p: [1.6, 2.6, 49.97], l: [1.6, 3.4, 53.6], i: 120, d: 16, spot: true, aim: 'out' },
      { p: [18.6, 2.6, 49.82], l: [18.6, 3.4, 53.6], i: 120, d: 16, spot: true, aim: 'out' },
      { p: [0.085, 2.1, 6.2], sconce: true, glowOnly: true },   // arandela no muro x = 0 (face interna em x 0,012), abaixo do topo (HB)
    ] },
  { key: 'pastoral', label: 'Sala Pastoral', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xffe0b8,
    fixtures: [
      { p: [14.9, 2.1, 4.6], i: 30, d: 8, shadow: true, liteShadow: true },   // fundos: pendentes baixos — cúpula e haste abaixo do topo das paredes (HB)
      { p: [18.5, 2.1, 7.0], glowOnly: true },
    ] },
  { key: 'ac_pastoral', label: 'Ar da pastoral', short: 'Ar', kind: 'climate', icon: 'ac' },
  { key: 'recepcao', label: 'Recepção', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xfff1dc,
    fixtures: [{ p: [11.1, 2.1, 7.6], i: 20, d: 5.5 }] },
  { key: 'administrativo', label: 'Administrativo', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xfff5e6,
    fixtures: [
      { p: [18.6, 2.7, 12.6], i: 18, d: 5 },
      { p: [18.6, 2.7, 16.6], i: 22, d: 6 },
    ] },
  { key: 'circulacao', label: 'Circulação', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xfff1dc,
    fixtures: [
      { p: [18.0, 2.7, 21.1], i: 20, d: 6 },
      { p: [16.6, 2.7, 14.8], glowOnly: true },
      { p: [19.5, 2.7, 25.6], glowOnly: true },
      { p: [16.6, 2.7, 35.5], glowOnly: true },
    ] },
  { key: 'midia', label: 'Sala de mídia', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xd8e6ff,
    fixtures: [{ p: [17.5, 2.7, 25.6], i: 18, d: 5.5 }] },
  { key: 'ac_midia', label: 'Ar da mídia', short: 'Ar', kind: 'climate', icon: 'ac' },
  { key: 'voluntariado', label: 'Voluntariado', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xffe9cc,
    fixtures: [{ p: [18.1, 2.7, 30.9], i: 26, d: 7, shadow: true }] },
  { key: 'ac_voluntariado', label: 'Ar do voluntariado', short: 'Ar', kind: 'climate', icon: 'ac' },
  { key: 'cozinha', label: 'Cozinha / almox.', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xfff5e4,
    fixtures: [
      { p: [10.7, 2.1, 1.95], i: 22, d: 6 },
      { p: [6.75, 2.1, 1.95], glowOnly: true },
    ] },
  { key: 'banheiros', label: 'Banheiros', short: 'Luz', kind: 'light', icon: 'bulb', color: 0xfff7ea,
    fixtures: [
      { p: [18.1, 2.7, 42.5], i: 18, d: 5.5 },
      { p: [18.6, 2.7, 46.9], i: 18, d: 5.5 },
      { p: [18.6, 2.7, 38.9], glowOnly: true },
      { p: [0.95, 2.7, 45.1], glowOnly: true },
      { p: [2.95, 2.7, 45.1], glowOnly: true },
      { p: [18.6, 2.7, 34.9], glowOnly: true },
    ] },
  { key: 'presenca', label: 'Presença', kind: 'sensor', icon: 'motion' },
  { key: 'porta', label: 'Porta principal', kind: 'sensor', icon: 'door' },
  { key: 'temperatura', label: 'Temperatura', kind: 'sensor', icon: 'thermo' },
];


/* Ícones: Phosphor Icons 2.1.1 (@phosphor-icons/core), viewBox 0 0 256 256, path data embutido.
 * MIT License
 *
 * Copyright (c) 2023 Phosphor Icons
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Ícones (Phosphor 2.1.1, viewBox 256): r = regular (desligado, navegação), f = fill (ligado; o CSS troca)
const ICONS = {
  bulb: { r: 'M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z', f: 'M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-32.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z' },
  ac: { r: 'M223.77,150.09a8,8,0,0,1-5.86,9.68l-24.64,6,6.46,24.11a8,8,0,0,1-5.66,9.8A8.25,8.25,0,0,1,192,200a8,8,0,0,1-7.72-5.93l-7.72-28.8L136,141.86v46.83l21.66,21.65a8,8,0,0,1-11.32,11.32L128,203.31l-18.34,18.35a8,8,0,0,1-11.32-11.32L120,188.69V141.86L79.45,165.27l-7.72,28.8A8,8,0,0,1,64,200a8.25,8.25,0,0,1-2.08-.27,8,8,0,0,1-5.66-9.8l6.46-24.11-24.64-6a8,8,0,0,1,3.82-15.54l29.45,7.23L112,128,71.36,104.54l-29.45,7.23A7.85,7.85,0,0,1,40,112a8,8,0,0,1-1.91-15.77l24.64-6L56.27,66.07a8,8,0,0,1,15.46-4.14l7.72,28.8L120,114.14V67.31L98.34,45.66a8,8,0,0,1,11.32-11.32L128,52.69l18.34-18.35a8,8,0,0,1,11.32,11.32L136,67.31v46.83l40.55-23.41,7.72-28.8a8,8,0,0,1,15.46,4.14l-6.46,24.11,24.64,6A8,8,0,0,1,216,112a7.85,7.85,0,0,1-1.91-.23l-29.45-7.23L144,128l40.64,23.46,29.45-7.23A8,8,0,0,1,223.77,150.09Z', f: 'M227.65,149.14a12,12,0,0,1-8.79,14.51l-20.67,5.08,5.4,20.16a12,12,0,0,1-23.18,6.22l-7.29-27.2L140,148.78V187l20.48,20.48a12,12,0,0,1-17,17L128,209l-15.51,15.52a12,12,0,0,1-17-17L116,187V148.78L82.88,167.91l-7.29,27.2a12,12,0,0,1-23.18-6.22l5.4-20.16-20.67-5.08a12,12,0,1,1,5.72-23.3l27.89,6.85L104,128,70.75,108.8l-27.89,6.85A11.8,11.8,0,0,1,40,116a12,12,0,0,1-2.85-23.65l20.67-5.08-5.4-20.16a12,12,0,0,1,23.18-6.22l7.29,27.2L116,107.21V69L95.52,48.48a12,12,0,0,1,17-17L128,47l15.51-15.52a12,12,0,1,1,17,17L140,69v38.24l33.12-19.12,7.29-27.2a12,12,0,0,1,23.18,6.22l-5.4,20.16,20.67,5.08A12,12,0,0,1,216,116a11.8,11.8,0,0,1-2.87-.35l-27.89-6.85L152,128l33.25,19.2,27.89-6.85A12,12,0,0,1,227.65,149.14Z' },
  tv: { r: 'M216,64H147.31l34.35-34.34a8,8,0,1,0-11.32-11.32L128,60.69,85.66,18.34A8,8,0,0,0,74.34,29.66L108.69,64H40A16,16,0,0,0,24,80V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm0,136H40V80H216V200Z', f: 'M216,64H147.31l34.35-34.34a8,8,0,1,0-11.32-11.32L128,60.69,85.66,18.34A8,8,0,0,0,74.34,29.66L108.69,64H40A16,16,0,0,0,24,80V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm0,136H40V80H216V200ZM200,100v80a4,4,0,0,1-4,4H60a4,4,0,0,1-4-4V100a4,4,0,0,1,4-4H196A4,4,0,0,1,200,100Z' },
  speaker: { r: 'M192,24H64A16,16,0,0,0,48,40V216a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V40A16,16,0,0,0,192,24Zm0,192H64V40H192ZM116,76a12,12,0,1,1,12,12A12,12,0,0,1,116,76Zm12,116a40,40,0,1,0-40-40A40,40,0,0,0,128,192Zm0-64a24,24,0,1,1-24,24A24,24,0,0,1,128,128Z', f: 'M152,160a24,24,0,1,1-24-24A24,24,0,0,1,152,160ZM208,40V216a16,16,0,0,1-16,16H64a16,16,0,0,1-16-16V40A16,16,0,0,1,64,24H192A16,16,0,0,1,208,40ZM116,68a12,12,0,1,0,12-12A12,12,0,0,0,116,68Zm52,92a40,40,0,1,0-40,40A40,40,0,0,0,168,160Z' },
  spot: { r: 'M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z', f: 'M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z' },
  sign: { r: 'M232,96a7.89,7.89,0,0,0-.3-2.2L217.35,43.6A16.07,16.07,0,0,0,202,32H54A16.07,16.07,0,0,0,38.65,43.6L24.31,93.8A7.89,7.89,0,0,0,24,96h0v16a40,40,0,0,0,16,32v72a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V144a40,40,0,0,0,16-32V96ZM54,48H202l11.42,40H42.61Zm50,56h48v8a24,24,0,0,1-48,0Zm-16,0v8a24,24,0,0,1-35.12,21.26,7.88,7.88,0,0,0-1.82-1.06A24,24,0,0,1,40,112v-8ZM200,208H56V151.2a40.57,40.57,0,0,0,8,.8,40,40,0,0,0,32-16,40,40,0,0,0,64,0,40,40,0,0,0,32,16,40.57,40.57,0,0,0,8-.8Zm4.93-75.8a8.08,8.08,0,0,0-1.8,1.05A24,24,0,0,1,168,112v-8h48v8A24,24,0,0,1,204.93,132.2Z', f: 'M231.69,93.81,217.35,43.6A16.07,16.07,0,0,0,202,32H54A16.07,16.07,0,0,0,38.65,43.6L24.31,93.81A7.94,7.94,0,0,0,24,96v16a40,40,0,0,0,16,32v72a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V144a40,40,0,0,0,16-32V96A7.94,7.94,0,0,0,231.69,93.81ZM88,112a24,24,0,0,1-35.12,21.26,7.88,7.88,0,0,0-1.82-1.06A24,24,0,0,1,40,112v-8H88Zm64,0a24,24,0,0,1-48,0v-8h48Zm64,0a24,24,0,0,1-11.07,20.2,8.08,8.08,0,0,0-1.8,1.05A24,24,0,0,1,168,112v-8h48Z' },
  car: { r: 'M240,104H229.2L201.42,41.5A16,16,0,0,0,186.8,32H69.2a16,16,0,0,0-14.62,9.5L26.8,104H16a8,8,0,0,0,0,16h8v80a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16V184h96v16a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V120h8a8,8,0,0,0,0-16ZM69.2,48H186.8l24.89,56H44.31ZM64,200H40V184H64Zm128,0V184h24v16Zm24-32H40V120H216ZM56,144a8,8,0,0,1,8-8H80a8,8,0,0,1,0,16H64A8,8,0,0,1,56,144Zm112,0a8,8,0,0,1,8-8h16a8,8,0,0,1,0,16H176A8,8,0,0,1,168,144Z', f: 'M240,104H229.2L201.42,41.5A16,16,0,0,0,186.8,32H69.2a16,16,0,0,0-14.62,9.5L26.8,104H16a8,8,0,0,0,0,16h8v80a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16v-8h96v8a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V120h8a8,8,0,0,0,0-16ZM80,152H56a8,8,0,0,1,0-16H80a8,8,0,0,1,0,16Zm120,0H176a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16ZM44.31,104,69.2,48H186.8l24.89,56Z' },
  motion: { r: 'M128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152Zm73.71,7.14a80,80,0,0,1-14.08,22.2,8,8,0,0,1-11.92-10.67,63.95,63.95,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67,80.08,80.08,0,0,1,14.08,84.47ZM69,103.09a64,64,0,0,0,11.26,67.58,8,8,0,0,1-11.92,10.67,79.93,79.93,0,0,1,0-106.67A8,8,0,1,1,80.29,85.34,63.77,63.77,0,0,0,69,103.09ZM248,128a119.58,119.58,0,0,1-34.29,84,8,8,0,1,1-11.42-11.2,103.9,103.9,0,0,0,0-145.56A8,8,0,1,1,213.71,44,119.58,119.58,0,0,1,248,128ZM53.71,200.78A8,8,0,1,1,42.29,212a119.87,119.87,0,0,1,0-168,8,8,0,1,1,11.42,11.2,103.9,103.9,0,0,0,0,145.56Z', f: 'M168,128a40,40,0,1,1-40-40A40,40,0,0,1,168,128Zm40,0a79.74,79.74,0,0,0-20.37-53.33,8,8,0,1,0-11.92,10.67,64,64,0,0,1,0,85.33,8,8,0,0,0,11.92,10.67A79.79,79.79,0,0,0,208,128ZM80.29,85.34A8,8,0,1,0,68.37,74.67a79.94,79.94,0,0,0,0,106.67,8,8,0,0,0,11.92-10.67,63.95,63.95,0,0,1,0-85.33Zm158.28-4A119.48,119.48,0,0,0,213.71,44a8,8,0,1,0-11.42,11.2,103.9,103.9,0,0,1,0,145.56A8,8,0,1,0,213.71,212,120.12,120.12,0,0,0,238.57,81.29ZM32.17,168.48A103.9,103.9,0,0,1,53.71,55.22,8,8,0,1,0,42.29,44a119.87,119.87,0,0,0,0,168,8,8,0,1,0,11.42-11.2A103.61,103.61,0,0,1,32.17,168.48Z' },
  door: { r: 'M232,216H208V40a16,16,0,0,0-16-16H64A16,16,0,0,0,48,40V216H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16ZM64,40H192V216H64Zm104,92a12,12,0,1,1-12-12A12,12,0,0,1,168,132Z', f: 'M232,216H208V40a16,16,0,0,0-16-16H64A16,16,0,0,0,48,40V216H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16Zm-64,0H64V40H168Zm-40-84a12,12,0,1,1,12,12A12,12,0,0,1,128,132Z' },
  thermo: { r: 'M136,153V88a8,8,0,0,0-16,0v65a32,32,0,1,0,16,0Zm-8,47a16,16,0,1,1,16-16A16,16,0,0,1,128,200Zm40-66V48a40,40,0,0,0-80,0v86a64,64,0,1,0,80,0Zm-40,98a48,48,0,0,1-27.42-87.4A8,8,0,0,0,104,138V48a24,24,0,0,1,48,0v90a8,8,0,0,0,3.42,6.56A48,48,0,0,1,128,232Z', f: 'M160,146.08V40a32,32,0,0,0-64,0V146.08a56,56,0,1,0,64,0ZM128,24a16,16,0,0,1,16,16v64H112V40A16,16,0,0,1,128,24Z' },
  auto: { r: 'M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17ZM109.37,214l10.47-52.38a8,8,0,0,0-5-9.06L62,132.71l84.62-90.66L136.16,94.43a8,8,0,0,0,5,9.06l52.8,19.8Z', f: 'M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z' },
  home: { r: 'M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z' },
  moon: { r: 'M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z' },
  power: { r: 'M120,128V48a8,8,0,0,1,16,0v80a8,8,0,0,1-16,0Zm60.37-78.7a8,8,0,0,0-8.74,13.4C194.74,77.77,208,101.57,208,128a80,80,0,0,1-160,0c0-26.43,13.26-50.23,36.37-65.3a8,8,0,0,0-8.74-13.4C47.9,67.38,32,96.06,32,128a96,96,0,0,0,192,0C224,96.06,208.1,67.38,180.37,49.3Z' },
  church: { r: 'M228.12,145.14,192,123.47V104a8,8,0,0,0-4-7L136,67.36V48h16a8,8,0,0,0,0-16H136V16a8,8,0,0,0-16,0V32H104a8,8,0,0,0,0,16h16V67.36L68,97.05a8,8,0,0,0-4,7v19.47L27.88,145.14A8,8,0,0,0,24,152v64a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V168a8,8,0,0,1,16,0v48a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V152A8,8,0,0,0,228.12,145.14ZM40,156.53l24-14.4V208H40ZM128,144a24,24,0,0,0-24,24v40H80V108.64l48-27.43,48,27.43V208H152V168A24,24,0,0,0,128,144Zm88,64H192V142.13l24,14.4Z' },
  music: { r: 'M212.92,17.69a8,8,0,0,0-6.86-1.45l-128,32A8,8,0,0,0,72,56V166.08A36,36,0,1,0,88,196V110.25l112-28v51.83A36,36,0,1,0,216,164V24A8,8,0,0,0,212.92,17.69ZM52,216a20,20,0,1,1,20-20A20,20,0,0,1,52,216ZM88,93.75V62.25l112-28v31.5ZM180,184a20,20,0,1,1,20-20A20,20,0,0,1,180,184Z' },
  mic: { r: 'M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z' },
  key: { r: 'M216.57,39.43A80,80,0,0,0,83.91,120.78L28.69,176A15.86,15.86,0,0,0,24,187.31V216a16,16,0,0,0,16,16H72a8,8,0,0,0,8-8V208H96a8,8,0,0,0,8-8V184h16a8,8,0,0,0,5.66-2.34l9.56-9.57A79.73,79.73,0,0,0,160,176h.1A80,80,0,0,0,216.57,39.43ZM224,98.1c-1.09,34.09-29.75,61.86-63.89,61.9H160a63.7,63.7,0,0,1-23.65-4.51,8,8,0,0,0-8.84,1.68L116.69,168H96a8,8,0,0,0-8,8v16H72a8,8,0,0,0-8,8v16H40V187.31l58.83-58.82a8,8,0,0,0,1.68-8.84A63.72,63.72,0,0,1,96,95.92c0-34.14,27.81-62.8,61.9-63.89A64,64,0,0,1,224,98.1ZM192,76a12,12,0,1,1-12-12A12,12,0,0,1,192,76Z' },
  briefcase: { r: 'M216,56H176V48a24,24,0,0,0-24-24H104A24,24,0,0,0,80,48v8H40A16,16,0,0,0,24,72V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V72A16,16,0,0,0,216,56ZM96,48a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96ZM216,72v41.61A184,184,0,0,1,128,136a184.07,184.07,0,0,1-88-22.38V72Zm0,128H40V131.64A200.19,200.19,0,0,0,128,152a200.25,200.25,0,0,0,88-20.37V200ZM104,112a8,8,0,0,1,8-8h32a8,8,0,0,1,0,16H112A8,8,0,0,1,104,112Z' },
  timer: { r: 'M128,40a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,40Zm0,176a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,216ZM173.66,90.34a8,8,0,0,1,0,11.32l-40,40a8,8,0,0,1-11.32-11.32l40-40A8,8,0,0,1,173.66,90.34ZM96,16a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,16Z' },
  tag: { r: 'M243.31,136,144,36.69A15.86,15.86,0,0,0,132.69,32H40a8,8,0,0,0-8,8v92.69A15.86,15.86,0,0,0,36.69,144L136,243.31a16,16,0,0,0,22.63,0l84.68-84.68a16,16,0,0,0,0-22.63Zm-96,96L48,132.69V48h84.69L232,147.31ZM96,84A12,12,0,1,1,84,72,12,12,0,0,1,96,84Z' },
  plan: { r: 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V96H40V56ZM40,112H96v88H40Zm176,88H112V112H216v88Z' },
  recenter: { r: 'M232,120h-8.34A96.14,96.14,0,0,0,136,32.34V24a8,8,0,0,0-16,0v8.34A96.14,96.14,0,0,0,32.34,120H24a8,8,0,0,0,0,16h8.34A96.14,96.14,0,0,0,120,223.66V232a8,8,0,0,0,16,0v-8.34A96.14,96.14,0,0,0,223.66,136H232a8,8,0,0,0,0-16Zm-96,87.6V200a8,8,0,0,0-16,0v7.6A80.15,80.15,0,0,1,48.4,136H56a8,8,0,0,0,0-16H48.4A80.15,80.15,0,0,1,120,48.4V56a8,8,0,0,0,16,0V48.4A80.15,80.15,0,0,1,207.6,120H200a8,8,0,0,0,0,16h7.6A80.15,80.15,0,0,1,136,207.6ZM128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152Z' },
  pin: { r: 'M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z' },
  side: { r: 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,56H80V200H40ZM216,200H96V56H216V200Z' },
  walk: { r: 'M152,80a32,32,0,1,0-32-32A32,32,0,0,0,152,80Zm0-48a16,16,0,1,1-16,16A16,16,0,0,1,152,32Zm64,112a8,8,0,0,1-8,8c-35.31,0-52.95-17.81-67.12-32.12-2.74-2.77-5.36-5.4-8-7.84l-13.43,30.88,37.2,26.57A8,8,0,0,1,160,176v56a8,8,0,0,1-16,0V180.12l-31.07-22.2L79.34,235.19A8,8,0,0,1,72,240a7.84,7.84,0,0,1-3.19-.67,8,8,0,0,1-4.15-10.52l54.08-124.37c-9.31-1.65-20.92,1.2-34.7,8.58a163.88,163.88,0,0,0-30.57,21.77,8,8,0,0,1-10.95-11.66c2.5-2.35,61.69-57.23,98.72-25.08,3.83,3.32,7.48,7,11,10.57C166.19,122.7,179.36,136,208,136A8,8,0,0,1,216,144Z' },
  person: { r: 'M100,36a28,28,0,1,1,28,28A28,28,0,0,1,100,36ZM215.42,140.78l-45.25-51.3a28,28,0,0,0-21-9.48H106.83a28,28,0,0,0-21,9.48l-45.25,51.3a16,16,0,0,0,22.56,22.69L89,142.7l-19.7,74.88a16,16,0,0,0,29.08,13.35L128,180l29.58,51a16,16,0,0,0,29.08-13.35L167,142.7l25.9,20.77a16,16,0,0,0,22.56-22.69Z' },   // person-fill: o bonequinho da Pessoa
  chevl: { r: 'M168.49,199.51a12,12,0,0,1-17,17l-80-80a12,12,0,0,1,0-17l80-80a12,12,0,0,1,17,17L97,128Z' },
  chevr: { r: 'M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z' },
  play: { r: 'M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z' },
  pause: { r: 'M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z' },
  more: { r: 'M144,128a16,16,0,1,1-16-16A16,16,0,0,1,144,128ZM60,112a16,16,0,1,0,16,16A16,16,0,0,0,60,112Zm136,0a16,16,0,1,0,16,16A16,16,0,0,0,196,112Z' },
  close: { r: 'M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z' },
  sun: { r: 'M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z' },
  cloudsun: { r: 'M164,72a76.2,76.2,0,0,0-20.26,2.73,55.63,55.63,0,0,0-9.41-11.54l9.51-13.57a8,8,0,1,0-13.11-9.18L121.22,54A55.9,55.9,0,0,0,96,48c-.59,0-1.16,0-1.74,0L91.37,31.71a8,8,0,1,0-15.75,2.77L78.5,50.82A56.1,56.1,0,0,0,55.23,65.67L41.61,56.14a8,8,0,1,0-9.17,13.11L46,78.77A55.55,55.55,0,0,0,40,104c0,.57,0,1.15,0,1.72L23.71,108.6a8,8,0,0,0,1.38,15.88,8.24,8.24,0,0,0,1.39-.12l16.32-2.88a55.74,55.74,0,0,0,5.86,12.42A52,52,0,0,0,84,224h80a76,76,0,0,0,0-152ZM92.92,120.76a52.14,52.14,0,0,0-31,4.17,40,40,0,0,1,66.62-44.17A76.26,76.26,0,0,0,92.92,120.76Z' },
  cloud: { r: 'M160.06,40A88.1,88.1,0,0,0,81.29,88.67h0A87.48,87.48,0,0,0,72,127.73,8.18,8.18,0,0,1,64.57,136,8,8,0,0,1,56,128a103.66,103.66,0,0,1,5.34-32.92,4,4,0,0,0-4.75-5.18A64.09,64.09,0,0,0,8,152c0,35.19,29.75,64,65,64H160a88.09,88.09,0,0,0,87.93-91.48C246.11,77.54,207.07,40,160.06,40Z' },
  fog: { r: 'M168,232a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16h56A8,8,0,0,1,168,232Zm-40-32a8,8,0,0,0-8-8H72a8,8,0,0,0,0,16h48A8,8,0,0,0,128,200Zm56-8H160a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Zm47.87-96.45a76,76,0,0,0-151.78.73A8.18,8.18,0,0,1,72,104l-.6,0A8.14,8.14,0,0,1,64,95.39a92.48,92.48,0,0,1,2.33-16.51,4,4,0,0,0-5-4.78A52.09,52.09,0,0,0,24,124.36C24.2,153.07,48.12,176,76.84,176H156A76.08,76.08,0,0,0,231.87,95.55Z' },
  rain: { r: 'M158.66,196.44l-32,48a8,8,0,1,1-13.32-8.88l32-48a8,8,0,0,1,13.32,8.88ZM231.87,87.55a76,76,0,0,0-151.78.73A8.18,8.18,0,0,1,72,96l-.6,0A8.14,8.14,0,0,1,64,87.39a92.48,92.48,0,0,1,2.33-16.51,4,4,0,0,0-5-4.78A52.09,52.09,0,0,0,24,116.36C24.2,145.07,48.12,168,76.84,168h36.21L89.34,203.56a8,8,0,0,0,13.32,8.88L132.28,168H156A76.08,76.08,0,0,0,231.87,87.55Z' },
  storm: { r: 'M156,168H132.53l-14.4,24H144a8,8,0,0,1,6.86,12.12l-24,40a8,8,0,0,1-13.72-8.24L129.87,208H104a8,8,0,0,1-6.86-12.12L113.87,168h-37C48.12,168,24.2,145.07,24,116.36A52.09,52.09,0,0,1,61.35,66.1a4,4,0,0,1,5,4.78A92.48,92.48,0,0,0,64,87.39,8.14,8.14,0,0,0,71.41,96l.6,0a8.18,8.18,0,0,0,8.08-7.72A76,76,0,1,1,156,168Z' },
  snow: { r: 'M88,196a12,12,0,1,1-12-12A12,12,0,0,1,88,196Zm28,4a12,12,0,1,0,12,12A12,12,0,0,0,116,200Zm48-16a12,12,0,1,0,12,12A12,12,0,0,0,164,184ZM68,224a12,12,0,1,0,12,12A12,12,0,0,0,68,224Zm88,0a12,12,0,1,0,12,12A12,12,0,0,0,156,224ZM231.87,87.55a76,76,0,0,0-151.78.73A8.18,8.18,0,0,1,72,96l-.6,0A8.14,8.14,0,0,1,64,87.39a92.48,92.48,0,0,1,2.33-16.51,4,4,0,0,0-5-4.78A52.09,52.09,0,0,0,24,116.36C24.2,145.07,48.12,168,76.84,168H156A76.08,76.08,0,0,0,231.87,87.55Z' },
  night: { r: 'M240,96a8,8,0,0,1-8,8H216v16a8,8,0,0,1-16,0V104H184a8,8,0,0,1,0-16h16V72a8,8,0,0,1,16,0V88h16A8,8,0,0,1,240,96ZM144,56h8v8a8,8,0,0,0,16,0V56h8a8,8,0,0,0,0-16h-8V32a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16Zm65.14,94.33A88.07,88.07,0,0,1,105.67,46.86a8,8,0,0,0-10.6-9.06A96,96,0,1,0,218.2,160.93a8,8,0,0,0-9.06-10.6Z' },
  cloudnight: { r: 'M172,72a76.35,76.35,0,0,0-12.36,1A71.93,71.93,0,0,0,104.17,9.83a8,8,0,0,0-9.59,9.58A56.05,56.05,0,0,1,40,88a56.45,56.45,0,0,1-12.59-1.42,8,8,0,0,0-9.59,9.59,72.22,72.22,0,0,0,32.29,45.06A52,52,0,0,0,92,224h80a76,76,0,0,0,0-152ZM37.37,104c.87,0,1.75,0,2.63,0a72.08,72.08,0,0,0,72-72c0-.89,0-1.78,0-2.67a55.64,55.64,0,0,1,32,48.05A76.4,76.4,0,0,0,101,120.78a52.38,52.38,0,0,0-9-.78,51.69,51.69,0,0,0-30,9.59A56.22,56.22,0,0,1,37.37,104Z' },
};

// Códigos WMO (Open-Meteo) → ícone + descrição em pt-BR
const WEATHER_CODE = {
  0: ['sun', 'Céu limpo'], 1: ['cloudsun', 'Poucas nuvens'], 2: ['cloudsun', 'Parcialmente nublado'], 3: ['cloud', 'Nublado'],
  45: ['fog', 'Neblina'], 48: ['fog', 'Neblina com geada'],
  51: ['rain', 'Garoa fraca'], 53: ['rain', 'Garoa'], 55: ['rain', 'Garoa forte'],
  56: ['rain', 'Garoa congelante'], 57: ['rain', 'Garoa congelante forte'],
  61: ['rain', 'Chuva fraca'], 63: ['rain', 'Chuva'], 65: ['rain', 'Chuva forte'],
  66: ['rain', 'Chuva congelante'], 67: ['rain', 'Chuva congelante forte'],
  71: ['snow', 'Neve fraca'], 73: ['snow', 'Neve'], 75: ['snow', 'Neve forte'], 77: ['snow', 'Grãos de neve'],
  80: ['rain', 'Pancadas fracas'], 81: ['rain', 'Pancadas de chuva'], 82: ['rain', 'Pancadas fortes'],
  85: ['snow', 'Pancadas de neve fracas'], 86: ['snow', 'Pancadas de neve fortes'],
  95: ['storm', 'Trovoada'], 96: ['storm', 'Trovoada com granizo'], 99: ['storm', 'Trovoada forte com granizo'],
};

// Rotinas rápidas: ações compostas disparadas pelo cartão (não precisam existir no HA)
// ares-condicionados por cômodo (vídeos: templo, mídia, voluntariado; + pastoral)
const AC_KEYS = ITEMS.filter((i) => i.kind === 'climate').map((i) => i.key);
const LIGHT_KEYS = ['palco', 'plateia', 'hall', 'fachada', 'estacionamento', 'pastoral', 'recepcao', 'administrativo', 'circulacao', 'midia', 'voluntariado', 'cozinha', 'banheiros'];
const SCENES = [
  { id: 'culto', icon: 'church', name: 'Culto', desc: 'Palco, plateia, telão, som, ares do templo e da mídia, hall, fachada e estacionamento',
    run: (c) => [c.on('palco'), c.on('plateia'), c.call('media_player', 'turn_on', c.e('telao')), c.on('som'),
      c.call('climate', 'set_hvac_mode', c.e('ac_templo'), { hvac_mode: 'cool' }), c.call('climate', 'set_hvac_mode', c.e('ac_midia'), { hvac_mode: 'cool' }),
      c.on('hall'), c.on('fachada'), c.on('estacionamento')] },
  { id: 'louvor', icon: 'music', name: 'Louvor', desc: 'Plateia a 30%, palco roxo/azul, telão e som',
    run: (c) => [c.call('light', 'turn_on', c.e('plateia'), { brightness_pct: 30 }), c.call('light', 'turn_on', c.e('palco'), { rgb_color: [110, 70, 255], brightness_pct: 100 }),
      c.call('media_player', 'turn_on', c.e('telao')), c.on('som')] },
  { id: 'pregacao', icon: 'mic', name: 'Pregação', desc: 'Plateia a 80%, palco em branco quente',
    run: (c) => [c.call('light', 'turn_on', c.e('plateia'), { brightness_pct: 80 }), c.call('light', 'turn_on', c.e('palco'), { rgb_color: [255, 196, 140], brightness_pct: 100 })] },
  { id: 'ensaio', icon: 'spot', name: 'Ensaio da banda', desc: 'Palco, som e telão; plateia apagada',
    run: (c) => [c.on('palco'), c.on('som'), c.call('media_player', 'turn_on', c.e('telao')), c.off('plateia')] },
  { id: 'abrir', icon: 'key', name: 'Abrir a igreja', desc: 'Fachada, estacionamento, hall, banheiros e recepção',
    run: (c) => ['fachada', 'estacionamento', 'hall', 'banheiros', 'recepcao'].map((k) => c.on(k)) },
  { id: 'expediente', icon: 'briefcase', name: 'Expediente', desc: 'Administrativo, pastoral, recepção, circulação e ar da pastoral',
    run: (c) => ['administrativo', 'pastoral', 'recepcao', 'circulacao'].map((k) => c.on(k)).concat([c.call('climate', 'set_hvac_mode', c.e('ac_pastoral'), { hvac_mode: 'cool' })]) },
  { id: 'fechar', icon: 'power', name: 'Fechar tudo', desc: 'Todas as luzes, telão, som e os ares de todos os cômodos desligados',
    run: (c) => LIGHT_KEYS.map((k) => c.off(k)).concat([c.off('som'), c.call('media_player', 'turn_off', c.e('telao')),
      ...AC_KEYS.map((k) => c.call('climate', 'set_hvac_mode', c.e(k), { hvac_mode: 'off' }))]) },
];
const LED_PRESETS = [['Quente', [255, 180, 110]], ['Branco', [255, 244, 229]], ['Vermelho', [255, 40, 40]], ['Azul', [40, 110, 255]], ['Verde', [40, 200, 90]], ['Roxo', [140, 60, 230]]];
// cor do fluxo de ar por modo (neutro para seco/ventilar)
const AIR_COL = { cool: 0x9fdcff, heat_cool: 0xb8e6ff, auto: 0xb8e6ff, heat: 0xffa15c, dry: 0xe8eef4, fan_only: 0xe8eef4 };
const HVAC_PT = { off: 'Desligado', cool: 'Frio', heat: 'Quente', heat_cool: 'Auto', auto: 'Auto', fan_only: 'Ventilar', dry: 'Seco' };
const MEDIA_PT = { playing: 'Tocando', paused: 'Pausado', idle: 'Ociosa', off: 'Desligada', standby: 'Standby', on: 'Ligada', unavailable: 'indisponível', unknown: '—' };
// Elevação/azimute do sol para uma data e um ponto (graus). Azimute: 0 = norte, 90 = leste.
function solarPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 - 10957.5;
  const g = ((357.529 + 0.98560028 * d) % 360) * rad;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = ((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  let H = ((gmst * 15 + lon - RA) % 360 + 540) % 360 - 180;
  const Hr = H * rad, la = lat * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(Hr));
  const az = Math.atan2(-Math.sin(Hr), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(Hr));
  return { elevation: alt / rad, azimuth: (az / rad + 360) % 360 };
}
function fmtClock(ts, tz) {
  try { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }); }
  catch (_) { try { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (__) { return ''; } }
}
function fmtRel(ts, now = Date.now()) {   // espaços inseparáveis: "há 3 d" nunca quebra no meio
  const d = Math.max(0, (now - new Date(ts).getTime()) / 1000);
  if (d < 45) return 'agora'; if (d < 3600) return `há\u00a0${Math.round(d / 60)}\u00a0min`; if (d < 86400) return `há\u00a0${Math.round(d / 3600)}\u00a0h`;
  const days = Math.round(d / 86400); return days === 1 ? 'ontem' : `há\u00a0${days}\u00a0d`;
}
const iconSvg = (k, i = ICONS[k] || ICONS.bulb) => `<svg viewBox="0 0 256 256" width="15" height="15" fill="currentColor" aria-hidden="true"><path${i.f ? ' class="r"' : ''} d="${i.r}"/>${i.f ? `<path class="f" d="${i.f}"/>` : ''}</svg>`;   // r = regular (desligado), f = fill (ligado; o CSS troca)

// ---------------------------------------------------------------------------
// Planta (metros) — medida na planta de layout do térreo (Uõma Arquitetura,
// NOV/2024, 1:100); precisão ~0,1 m. X → direita, Z → frente (fachada em z ≈ 49,7).
// Cada zona = piso clicável; `item` = qual entidade o clique alterna.
// `rects` = [x, z, largura, profundidade, lados] — áreas em L viram vários retângulos
// sem sobreposição. `lados` (opcional) diz quais bordas encostam em parede (sombra de
// canto + rodapé): n = z mínimo, s = z máximo, w = x mínimo, e = x máximo (padrão 'nsew').
// `floor` = textura do piso, `tile` = tamanho do bloco da textura (m), `inside` = rodapé.
// ---------------------------------------------------------------------------
const H = 3.0;      // pé-direito no modo "casinha de boneca" (todas as paredes)
const T = 0.15;     // espessura das paredes
const TF = 0.05;   // bloco dos fundos (z 0–12,4, a Sala Pastoral): paredes finas (v1.8: 7,5 → 5 cm, pedido do dono)
const HB = 2.4;    // e mais baixas na maquete e na Vista de cima (v1.8): acima das portas e dos vidros (2,25); com a Fachada (e na Pessoa) voltam a H
const SPEC = { H_TEMPLO: 8.5, H_ALA: 4.5, H_FUNDOS: 3.6 };   // alturas externas (modo Fachada)
// Pilares do templo (z): parede x = 0 e parede x = 16,05 (+ x 5,4 / 10,5 em z 12,4 e 44,0)
const PILLARS_L = [12.4, 16.9, 21.4, 25.9, 30.4, 35.0, 39.5, 44.0];
const PILLARS_R = [12.4, 18.3, 23.2, 28.0, 33.7, 39.3, 44.0];

const ZONES = {
  // ---- Fundos: estacionamento interno, pátio, almoxarifado, cozinha, recepção, pastoral ----
  estac_interno: { rects: [[0, 0, 4.9, 12.4, '']], floor: 'paversGray', tile: 2.4, label: 'Estacionamento interno', lp: [2.45, 6.2], item: 'estacionamento' },
  patio:         { rects: [[4.9, 3.9, 2.6, 8.5, ''], [7.5, 3.9, 1.95, 1.9, ''], [9.45, 3.9, 3.3, 2.0, ''], [10.3, 9.25, 2.45, 0.95, ''],
                           [7.5, 10.2, 5.25, 0.8, ''], [7.5, 11.0, 8.55, 1.4, '']], floor: 'paversGray', tile: 2.4, label: 'Pátio', lp: [6.2, 8.0], item: 'estacionamento', main: true },
  almoxarifado:  { rects: [[4.9, 0, 3.7, 3.9]], floor: 'tileLight', tile: 1.8, label: 'Almoxarifado', lp: [6.75, 1.95], item: 'cozinha', inside: true, ls: 0.8 },
  cozinha:       { rects: [[8.6, 0, 4.15, 3.9]], floor: 'tileCool', tile: 1.2, label: 'Cozinha', lp: [10.7, 1.95], item: 'cozinha', inside: true, ls: 0.8 },
  jardim_interno:{ rects: [[7.5, 5.8, 1.95, 4.4, ''], [9.45, 9.25, 0.85, 0.95, '']], floor: 'grass', tile: 2.2, label: null },
  recepcao:      { rects: [[9.45, 5.9, 3.3, 3.35]], floor: 'laminate', tile: 2.4, label: 'Recepção', lp: [11.1, 7.6], item: 'recepcao', inside: true, ls: 0.8 },
  pastoral:      { rects: [[12.75, 0, 4.25, 4.9, 'nwe'], [12.75, 4.9, 7.35, 4.35, 'swe']], floor: 'laminate', tile: 2.4, label: 'Sala Pastoral', lp: [15.0, 6.6], item: 'pastoral', inside: true, main: true },
  caixa_dagua:   { rects: [[17.0, 0, 3.1, 3.1]], floor: 'concrete', tile: 3, label: 'Caixa d’água', lp: [18.55, 1.55], inside: false, ls: 0.75 },
  wc_pastoral:   { rects: [[17.0, 3.1, 3.1, 1.8]], floor: 'porcelainBeige', tile: 1.8, label: null, item: 'pastoral', inside: true },
  jardim_pastoral:{ rects: [[12.75, 9.25, 7.35, 1.75, '']], floor: 'grass', tile: 2.2, label: null },
  // ---- Ala direita (x 16,05–20,1) ----
  corredor:      { rects: [[16.05, 11.0, 1.05, 8.0]], floor: 'laminate', tile: 2.4, label: null, item: 'circulacao', inside: true },
  gilvan:        { rects: [[17.1, 11.0, 3.0, 3.2]], floor: 'laminate', tile: 2.4, label: 'Sala Gilvan', lp: [18.6, 12.6], item: 'administrativo', inside: true, ls: 0.75 },
  administrativo:{ rects: [[17.1, 14.2, 3.0, 4.8]], floor: 'laminate', tile: 2.4, label: 'Administrativo', lp: [18.6, 16.6], item: 'administrativo', inside: true, ls: 0.75 },
  circulacao:    { rects: [[16.05, 19.0, 4.05, 4.3, 'nwe'], [18.9, 23.3, 1.2, 4.7, 'swe']], floor: 'laminate', tile: 2.4, label: 'Circulação', lp: [18.1, 21.1], item: 'circulacao', inside: true, ls: 0.75 },
  midia:         { rects: [[16.05, 23.3, 2.85, 4.7]], floor: 'laminate', tile: 2.4, label: 'Mídia', lp: [17.5, 25.6], item: 'midia', inside: true, ls: 0.75, main: true },
  voluntariado:  { rects: [[16.05, 28.0, 4.05, 5.9]], floor: 'laminate', tile: 2.4, label: 'Voluntariado', lp: [18.1, 30.9], item: 'voluntariado', inside: true, ls: 0.75 },
  circ2:         { rects: [[16.05, 33.9, 1.05, 3.1, 'nwe']], floor: 'laminate', tile: 2.4, label: null, item: 'circulacao', inside: true },
  deposito:      { rects: [[17.1, 33.9, 3.0, 2.0]], floor: 'laminate', tile: 2.4, label: 'Depósito', lp: [18.6, 34.9], item: 'banheiros', inside: true, ls: 0.7 },
  tecnica:       { rects: [[17.1, 35.9, 3.0, 1.1]], floor: 'concrete', tile: 3, label: null, inside: false },
  wc_masc:       { rects: [[17.1, 37.0, 3.0, 3.8]], floor: 'porcelainBeige', tile: 1.8, label: 'WC Masc.', lp: [18.6, 38.9], item: 'banheiros', inside: true, ls: 0.7 },
  hall_banheiros:{ rects: [[16.05, 40.8, 4.05, 3.5, 'swe'], [16.05, 37.0, 1.05, 3.8, 'nwe']], floor: 'porcelainBeige', tile: 1.8, label: 'Hall dos banheiros', lp: [18.1, 42.5], item: 'banheiros', inside: true, ls: 0.75 },
  wc_fem:        { rects: [[16.05, 44.3, 4.05, 5.2, 'swe']], floor: 'porcelainBeige', tile: 1.8, label: 'WC Fem.', lp: [18.6, 46.9], item: 'banheiros', inside: true, ls: 0.7 },
  // ---- Templo, hall e frente ----
  templo:        { rects: [[0, 12.4, 16.05, 31.6]], floor: 'porcelainGray', tile: 1.8, label: 'Templo', lp: [10.8, 28.1], item: 'plateia', inside: true, ls: 1.5, main: true },
  hall:          { rects: [[4.0, 44.0, 12.05, 5.65, 'nse'], [0, 46.3, 4.0, 3.35, 'nsw']], floor: 'tileGray', tile: 1.8, label: 'Hall de entrada', lp: [12.4, 46.8], item: 'hall', inside: true, main: true },
  wc1:           { rects: [[0, 44.0, 1.9, 2.3]], floor: 'porcelainBeige', tile: 1.8, label: 'WC', lp: [0.95, 45.1], item: 'banheiros', inside: true, ls: 0.6 },
  wc_pcd:        { rects: [[1.9, 44.0, 2.1, 2.3]], floor: 'porcelainBeige', tile: 1.8, label: 'WC PCD', lp: [2.95, 45.1], item: 'banheiros', inside: true, ls: 0.6 },
  jardim_frontal:{ rects: [[0.1, 49.73, 10.5, 1.12, ''], [13.3, 49.73, 2.7, 1.12, '']], floor: 'grass', tile: 2.2, label: null, item: 'fachada' },
  calcada:       { rects: [[-3, 49.73, 3.1, 1.27, ''], [0.1, 50.85, 10.5, 0.15, ''], [10.6, 49.73, 2.7, 1.27, ''], [13.3, 50.85, 2.7, 0.15, ''], [16.0, 49.58, 7.0, 1.42, '']],
                   floor: 'paversDark', tile: 2.4, label: null, item: 'fachada' },
  estac_frontal: { rects: [[-3, 51.0, 26.0, 9.0, '']], floor: 'herring', tile: 1.6, label: 'Estacionamento', lp: [4.0, 57.5], ly: 1.2, item: 'estacionamento', ls: 1.2, main: true },   // baixo e à esquerda: não cobre o letreiro da fachada
};
const LOT = { x0: -3, x1: 23, z0: 0, z1: 60, cx: 10, cz: 30 };   // área modelada (lote + estacionamento frontal)

// Escada reta do hall (v1.4.6) ao longo da parede da fachada (z = 49,65), subindo para −x até o MEZANINO ("salinha", y 3,05) sobre os
// WCs e o canto do hall. Única fonte da geometria: a decoração (rooms/hall.js) a desenha e a visão de Pessoa sobe por ela.
// Degrau i (1…17) tem o topo em y = i·R e ocupa x ∈ [XS + (17 − i)·GO, XS + (18 − i)·GO]; o degrau 18 é o piso do mezanino.
// off (v1.5.4): a escada reta da fachada saiu (a escada em U voltou ao canto do hall, sem ligação com a salinha) — o mezanino
// continua, mas sem subida a pé: chega-se nele pelo "Ir para…"/bonequinho e clicando no piso (troca de andar com fade)
const STAIR = { XS: 4.1, GO: 0.3, N: 18, Y: 3.05, Z0: 48.05, Z1: 49.563, off: true };
STAIR.R = STAIR.Y / STAIR.N; STAIR.XE = STAIR.XS + 17 * STAIR.GO;   // XE = borda de baixo do degrau 1 (x = 9,2)
// piso do mezanino (interior das paredes) e a passagem da escada; MZ_SPOT = ponto de entrada livre da salinha (poltronas e mesinha ficam junto ao guarda-corpo)
const MEZZ = { x0: 0.087, x1: 4.075, z0: 44.075, z1: 49.563 };
const stairNose = (x) => STAIR.R * (18 - (x - STAIR.XS) / STAIR.GO);                                  // altura da linha dos bocéis em x
const inChan = (x, z) => !STAIR.off && x >= MEZZ.x1 && x <= STAIR.XE + STAIR.GO && z >= STAIR.Z0 && z <= STAIR.Z1;   // passagem da escada (rampa)
const inMezz = (x, z) => x >= MEZZ.x0 && x <= STAIR.XS && z >= MEZZ.z0 && z <= MEZZ.z1;               // piso do mezanino
// para onde a pessoa olha ao entrar num cômodo (x, y, z do mundo); sem entrada aqui: rumo ao canto mais fundo do cômodo
const ROOM_FOCUS = { templo: [1.0, 1.6, 28.1], hall: [11.85, 1.6, 44.0], mezanino: [4.6, 1.6, 45.6] };   // templo: de frente para o palco

// Vista de cima navegável e painel: blocos → cômodos → aparelhos. `box` = [x0, z0, x1, z1] do bloco (enquadramento e sobra do _hit); cada
// cômodo junta zonas de ZONES (ou tem `rects` próprios) e lista os aparelhos (chaves de ITEMS) — _buildBlocks() ainda acrescenta os que têm
// luminária/aparelho de ar dentro do cômodo (`noauto` desliga). `frame` = [x0, z0, x1, z1] força o enquadramento do cômodo. `flat` = no
// painel e na Vista de cima o bloco é uma lista só: abre inteiro, sem os cômodos como subtítulos nem como nível. `lp` = [x, z] do rótulo do
// bloco na planta. v1.8 (pedido do dono): Templo (um cômodo só) · Operacional · Banheiro · Sala Pastoral · Hall de entrada; a Sala da Família foi incorporada ao Hall
const BLOCKS = {
  templo: { label: 'Templo', flat: true, box: [0, 12.4, 16.05, 44.0], lp: [10.8, 28.1], rooms: [
    { id: 'templo', label: 'Templo', zones: ['templo'], items: ['palco', 'plateia', 'telao', 'som', 'ac_templo', 'presenca', 'temperatura'], noauto: true }] },
  operacional: { label: 'Operacional', box: [16.05, 11.0, 20.1, 33.9], lp: [18.1, 22.4], rooms: [
    { id: 'gilvan', label: 'Sala Gilvan', zones: ['gilvan'], items: ['administrativo'] },
    { id: 'administrativo', label: 'Administrativo', zones: ['administrativo'], items: ['administrativo'] },
    { id: 'circulacao', label: 'Circulação', zones: ['circulacao', 'corredor', 'circ2'], items: ['circulacao'], frame: [16.05, 19.0, 20.1, 28.0] },
    { id: 'midia', label: 'Mídia', zones: ['midia'], items: ['midia', 'ac_midia'] },
    { id: 'voluntariado', label: 'Voluntariado', zones: ['voluntariado'], items: ['voluntariado', 'ac_voluntariado'] }] },
  banheiro: { label: 'Banheiro', flat: true, box: [16.05, 33.9, 20.1, 49.5], lp: [18.6, 44.0], rooms: [   // rótulo sobre os WCs: no meio encostava no ar do templo (z 37,6)
    { id: 'deposito', label: 'Depósito', zones: ['deposito'], items: ['banheiros'] },
    { id: 'tecnica', label: 'Área técnica', zones: ['tecnica'], items: [] },
    { id: 'wc_masc', label: 'WC Masc.', zones: ['wc_masc'], items: ['banheiros'] },
    { id: 'hall_banheiros', label: 'Hall dos banheiros', zones: ['hall_banheiros'], items: ['banheiros'] },
    { id: 'wc_fem', label: 'WC Fem.', zones: ['wc_fem'], items: ['banheiros'] }] },
  pastoral: { label: 'Sala Pastoral', flat: true, box: [0, 0, 20.1, 12.4], lp: [10.0, 6.2], rooms: [
    { id: 'patio', label: 'Pátio', zones: ['estac_interno', 'patio', 'jardim_interno'], items: ['estacionamento'] },
    { id: 'almoxarifado', label: 'Almoxarifado', zones: ['almoxarifado'], items: ['cozinha'] },
    { id: 'cozinha', label: 'Cozinha', zones: ['cozinha'], items: ['cozinha'] },
    { id: 'recepcao', label: 'Recepção', zones: ['recepcao'], items: ['recepcao'] },
    { id: 'pastoral', label: 'Sala Pastoral', zones: ['pastoral', 'wc_pastoral', 'jardim_pastoral'], items: ['pastoral', 'ac_pastoral'] },
    { id: 'caixa_dagua', label: 'Caixa d’água', zones: ['caixa_dagua'], items: [] }] },
  hall: { label: 'Hall de entrada', box: [-3, 44.0, 23, 60], lp: [10.0, 47.0], rooms: [
    { id: 'hall', label: 'Hall', zones: ['hall'], items: ['hall', 'porta'] },
    { id: 'wcs', label: 'WCs da frente', zones: ['wc1', 'wc_pcd'], items: ['banheiros'] },
    { id: 'estac_frontal', label: 'Estacionamento', zones: ['estac_frontal'], items: ['estacionamento'] },
    { id: 'fachada', label: 'Fachada', zones: ['jardim_frontal', 'calcada'], items: ['fachada'] }] },
};
// ids de antes (setTopNav e README): blocos da v1.6/v1.7 e cômodos que viraram outro
const BLOCK_ALIAS = { ala: 'operacional', fundos: 'pastoral', entrada: 'hall', frente: 'hall' }, ROOM_ALIAS = { palco: 'templo', plateia: 'templo', familia: 'hall' };   // v1.8: a Sala da Família virou parte do Hall
// aparelho de vários cômodos → o cômodo em que ele aparece no painel (nos outros: "também …"); os demais ficam no 1º cômodo que os tem
const HOME = { administrativo: 'administrativo', banheiros: 'hall_banheiros', cozinha: 'cozinha', estacionamento: 'estac_frontal' };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const clamp = THREE.MathUtils.clamp;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Texturas procedurais (canvas) — nada externo para baixar
// ---------------------------------------------------------------------------
function makeTex(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function grain(g, size, seed, count, alpha, tint = [255, 255, 255]) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const v = rnd(); const c = tint.map((x) => Math.floor(x * (0.5 + v)));
    g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(rnd() * alpha).toFixed(3)})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
}
function shade(hex, v) {
  const r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255;
  return `rgb(${Math.min(255, r * v) | 0},${Math.min(255, gg * v) | 0},${Math.min(255, b * v) | 0})`;
}
const TEX = {};
function textures() {
  if (TEX.wood) return TEX;
  // Tábuas de madeira (6 por bloco de 2,4 m)
  TEX.wood = makeTex(512, (g, s) => {
    const rnd = mulberry32(5), ph = s / 6;
    for (let r = 0; r < 6; r++) {
      const y = r * ph, v = 0.86 + rnd() * 0.26;
      g.fillStyle = shade(0xb98d5c, v); g.fillRect(0, y, s, ph);
      g.strokeStyle = 'rgba(70,40,15,0.16)'; g.lineWidth = 1;
      for (let k = 0; k < 26; k++) {
        const yy = y + rnd() * ph; g.beginPath(); g.moveTo(0, yy);
        for (let x = 0; x <= s; x += 24) g.lineTo(x, yy + Math.sin(x / 60 + k) * 1.6 + (rnd() - 0.5));
        g.stroke();
      }
      g.fillStyle = 'rgba(45,28,12,0.6)'; g.fillRect(0, y, s, 2);
      g.fillRect(((r % 2) * s / 2 + rnd() * 60) % s, y, 2, ph);
    }
    grain(g, s, 9, 5000, 0.08, [120, 80, 40]);
  });
  const tiles = (base, grout, n, seed) => makeTex(256, (g, s) => {
    g.fillStyle = grout; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(seed), t = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = shade(base, 0.93 + rnd() * 0.1); g.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3); }
    grain(g, s, seed + 1, 2500, 0.05);
  });
  TEX.tileWarm = tiles(0xe0dacc, '#b8b09f', 4, 2);   // porcelanato bege
  TEX.tileCool = tiles(0xd7e0e3, '#9fadb3', 6, 3);   // banheiro
  TEX.concrete = makeTex(256, (g, s) => { g.fillStyle = '#818079'; g.fillRect(0, 0, s, s); grain(g, s, 6, 22000, 0.22, [90, 90, 88]); grain(g, s, 7, 3000, 0.12, [200, 200, 196]); });
  TEX.grass = makeTex(256, (g, s) => {
    g.fillStyle = '#3c5c2f'; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(12);
    for (let i = 0; i < 9000; i++) { const v = 0.75 + rnd() * 0.6; g.fillStyle = shade(0x4a7038, v); g.fillRect(rnd() * s, rnd() * s, 1, 2 + rnd() * 3); }
    grain(g, s, 13, 2000, 0.1, [30, 50, 20]);
  });
  // Gramado do entorno (terreno geral): mais seco e menos saturado, como os lotes de Palmas na seca
  TEX.grassDry = makeTex(256, (g, s) => {
    g.fillStyle = '#5c6537'; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(14), cols = [0x6d7a40, 0x7d8a4a, 0x8f8a52, 0x5d6b35, 0x9a9160];
    for (let i = 0; i < 9000; i++) { g.fillStyle = shade(cols[(rnd() * cols.length) | 0], 0.8 + rnd() * 0.4); g.fillRect(rnd() * s, rnd() * s, 1, 2 + rnd() * 3); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(150,130,90,${(0.06 + rnd() * 0.08).toFixed(3)})`; g.beginPath(); g.arc(rnd() * s, rnd() * s, 6 + rnd() * 18, 0, Math.PI * 2); g.fill(); }
    grain(g, s, 15, 2000, 0.1, [60, 55, 30]);
  });
  TEX.pavers = makeTex(256, (g, s) => {
    g.fillStyle = '#a89373'; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(21), w = s / 2, h = s / 4;
    for (let r = 0; r < 4; r++) for (let c = -1; c < 3; c++) { const x = c * w + (r % 2) * w / 2; g.fillStyle = shade(0xd2bc93, 0.92 + rnd() * 0.14); g.fillRect(x + 2, r * h + 2, w - 4, h - 4); }
    grain(g, s, 22, 4000, 0.08, [120, 100, 70]);
  });
  TEX.plaster = makeTex(256, (g, s) => { g.fillStyle = '#e8e2d6'; g.fillRect(0, 0, s, s); grain(g, s, 31, 9000, 0.07, [120, 110, 100]); }, [2, 1]);
  // Porcelanato cinza grande (templo/hall) e claro (salas/circulação)
  TEX.tileGray = tiles(0x9a9b9e, '#76777b', 2, 51);
  TEX.tileLight = tiles(0xe6e3dc, '#c4bfb4', 2, 52);
  // Intertravado retangular cinza (pátio) e grafite (calçada da fachada)
  const pav = (base, joint, seed) => makeTex(256, (g, s) => {
    g.fillStyle = joint; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(seed), w = s / 4, h = s / 8;
    for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) { const x = c * w + (r % 2) * w / 2; g.fillStyle = shade(base, 0.9 + rnd() * 0.16); g.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3); }
    grain(g, s, seed + 1, 4000, 0.07, [90, 90, 90]);
  });
  // Laminado de madeira carvalho/mel (vídeos v1/v2/v4/v5): réguas de 1,2 × 0,2 m correndo ao longo de z,
  // topos desencontrados e variação de tom régua a régua. Bloco de 2,4 × 2,4 m (tile 2,4) → 12 colunas × 2 réguas.
  TEX.laminate = makeTex(512, (g, s) => {
    const rnd = mulberry32(61), n = 12, cw = s / n, rl = s / 2;
    const tones = [0xc08b5b, 0xb98456, 0xc79462, 0xb47e51, 0xbd8a5a, 0xae7a4e];
    for (let c = 0; c < n; c++) {
      const off = rnd() * rl;
      for (let k = -1; k < 3; k++) {
        const y0 = off + k * rl, base = tones[(rnd() * tones.length) | 0], v = 0.95 + rnd() * 0.08;
        g.fillStyle = shade(base, v); g.fillRect(c * cw, y0, cw, rl);
        // veio: linhas finas ao longo da régua, levemente onduladas
        g.lineWidth = 1;
        for (let q = 0; q < 7; q++) {
          const x = c * cw + 2 + rnd() * (cw - 4), a = 0.05 + rnd() * 0.08;
          g.strokeStyle = rnd() < 0.5 ? `rgba(90,52,22,${a.toFixed(3)})` : `rgba(235,190,130,${(a * 0.8).toFixed(3)})`;
          g.beginPath(); g.moveTo(x, y0);
          for (let y = y0; y <= y0 + rl; y += 16) g.lineTo(x + Math.sin(y / 37 + q * 1.7) * 1.3, y);
          g.stroke();
        }
        g.fillStyle = 'rgba(55,32,14,0.55)'; g.fillRect(c * cw, y0, cw, 1.5);   // topo da régua
      }
      g.fillStyle = 'rgba(55,32,14,0.5)'; g.fillRect(c * cw, 0, 1.2, s);     // junta lateral
    }
    grain(g, s, 62, 6000, 0.05, [110, 70, 35]);
  });
  TEX.laminate.anisotropy = 8;
  // Porcelanato 0,9 × 0,9 com rejunte fino (bloco de 1,8 m = 2 × 2 placas): bege claro (WCs) e cinza-claro polido (templo)
  const porcelain = (base, grout, seed, cloud) => makeTex(512, (g, s) => {
    g.fillStyle = grout; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(seed), t = s / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = shade(base, 0.97 + rnd() * 0.05); g.fillRect(i * t + 1, j * t + 1, t - 2, t - 2);
      // manchas suaves (nuvem) dentro da placa
      for (let k = 0; k < 14; k++) {
        const cx = i * t + rnd() * t, cy = j * t + rnd() * t, r = 20 + rnd() * 70;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        const tone = rnd() < 0.5 ? '255,255,255' : cloud;
        gr.addColorStop(0, `rgba(${tone},${(0.025 + rnd() * 0.035).toFixed(3)})`); gr.addColorStop(1, `rgba(${tone},0)`);
        g.save(); g.beginPath(); g.rect(i * t + 1, j * t + 1, t - 2, t - 2); g.clip(); g.fillStyle = gr; g.fillRect(cx - r, cy - r, 2 * r, 2 * r); g.restore();
      }
    }
    grain(g, s, seed + 1, 5000, 0.035);
  });
  TEX.porcelainBeige = porcelain(0xe4dccb, '#c9bfae', 71, '170,150,120');
  TEX.porcelainGray = porcelain(0xc4c4c1, '#abaaa6', 72, '140,140,138');
  TEX.porcelainGray.anisotropy = 8;
  // Cedro (portas internas): veio vertical sutil (o v da face da porta corre na altura)
  TEX.cedar = makeTex(256, (g, s) => {
    g.fillStyle = '#b06c33'; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(81);
    for (let k = 0; k < 70; k++) {
      const x = rnd() * s, a = 0.04 + rnd() * 0.09, w = 0.6 + rnd() * 1.6;
      g.strokeStyle = rnd() < 0.6 ? `rgba(110,55,20,${a.toFixed(3)})` : `rgba(230,160,100,${(a * 0.7).toFixed(3)})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= s; y += 8) g.lineTo(x + Math.sin(y / 29 + k) * 2.2 + Math.sin(y / 83 + k * 0.3) * 3, y); g.stroke();
    }
    grain(g, s, 82, 2500, 0.05, [120, 70, 30]);
  });
  TEX.paversGray = pav(0xa3a19b, '#77756f', 23);
  TEX.paversDark = pav(0x5d5f63, '#3e4043', 24);
  // Intertravado cinza (bloquete de concreto) em espinha de peixe — estacionamento frontal (só ele usa esta textura).
  // Padrão 90°: período de 4×4 módulos (tijolo = 2×1 módulo); o canvas tem 4 períodos.
  TEX.herring = makeTex(512, (g, s) => {
    g.fillStyle = '#6c6b68'; g.fillRect(0, 0, s, s);
    const rnd = mulberry32(25), u = s / 16, gap = 1.6;
    const brick = (cx, cy, w, h) => {
      const v = 0.84 + rnd() * 0.26, t = rnd();
      const base = t < 0.18 ? 0x93918c : t < 0.36 ? 0x9f9d97 : 0xaeaca6;   // cinza de concreto (tom próximo do paversGray)
      g.fillStyle = shade(base, v); g.fillRect(cx * u + gap, cy * u + gap, w * u - 2 * gap, h * u - 2 * gap);
    };
    for (let sft = -24; sft <= 24; sft += 4) for (let t = -20; t <= 20; t++) {
      brick(t + sft, t, 2, 1);          // tijolo deitado
      brick(t + sft, t + 1, 1, 2);      // tijolo em pé
    }
    grain(g, s, 26, 9000, 0.08, [60, 60, 58]);
  });
  TEX.glow = makeTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(0.6, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  TEX.glow.wrapS = TEX.glow.wrapT = THREE.ClampToEdgeWrapping;
  TEX.skyDay = makeTex(256, (g, s) => { const r = g.createLinearGradient(0, s, 0, 0); r.addColorStop(0, '#e6eef6'); r.addColorStop(0.18, '#b7d3ee'); r.addColorStop(0.6, '#5f9bdc'); r.addColorStop(1, '#3f7fc9'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
  TEX.skyDusk = makeTex(256, (g, s) => { const r = g.createLinearGradient(0, s, 0, 0); r.addColorStop(0, '#ffb070'); r.addColorStop(0.12, '#f0805a'); r.addColorStop(0.3, '#8a5a8c'); r.addColorStop(0.6, '#2c3a70'); r.addColorStop(1, '#121a3a'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
  TEX.skyNight = makeTex(256, (g, s) => { const r = g.createLinearGradient(0, s, 0, 0); r.addColorStop(0, '#18213a'); r.addColorStop(0.2, '#0f1629'); r.addColorStop(0.6, '#070b17'); r.addColorStop(1, '#03050c'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
  for (const k of ['skyDay', 'skyNight', 'skyDusk']) { TEX[k].wrapS = TEX[k].wrapT = THREE.ClampToEdgeWrapping; }
  return TEX;
}

// ---------------------------------------------------------------------------
// Logo oficial da Base Church — ÚNICA função de desenho (fachada, totem, telão, palco,
// recepção, hall…). Proporções medidas na foto da fachada, em unidades da largura de
// "BASE" (= 1): anel com raio externo 0,29 e traço de 0,046, "B" com 85 % do vão interno;
// "BASE" com altura de maiúscula 0,33 e "CHURCH" com 0,235, as duas palavras com a mesma
// largura (justificadas), como as letras caixa do letreiro. A fonte é medida no canvas
// (altura de maiúscula e largura exatas), então o desenho não depende da fonte instalada:
// Arial/Helvetica/Liberation/Roboto Bold dão o mesmo tamanho.
// Layouts: full (anel em cima + BASE/CHURCH) · mark (só anel + B) · wide (anel à esquerda,
// texto à direita) · text (só BASE/CHURCH).
// ---------------------------------------------------------------------------
const LOGO_FONT = 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", "Nimbus Sans", Roboto, "Segoe UI", sans-serif';
const LOGO_LAYOUTS = {
  full: { w: 1, h: 1.255, ring: [0.5, 0.29, 0.29], text: [0, 0.64] },
  mark: { w: 0.58, h: 0.58, ring: [0.29, 0.29, 0.29] },
  wide: { w: 1.87, h: 0.75, ring: [0.375, 0.375, 0.375], text: [0.87, 0.0675] },
  text: { w: 1, h: 0.615, text: [0, 0] },
};
const logoAspect = (layout = 'full') => { const L = LOGO_LAYOUTS[layout] || LOGO_LAYOUTS.full; return L.h / L.w; };
const cssColor = (c, fb = '#f4f5f7') => c == null ? fb : typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : String(c);
let _capRatio = 0;
// Desenha o logo em qualquer contexto 2D: canto superior esquerdo (x, y), largura total w (px).
// opts: { layout, color, weight (reforço de traço, fração da altura da letra; padrão 0,025) }. Devolve a altura (px).
function drawLogo(g, x, y, w, opts = {}) {
  const L = LOGO_LAYOUTS[opts.layout] || LOGO_LAYOUTS.full, u = w / L.w, col = cssColor(opts.color);
  const weight = opts.weight != null ? opts.weight : 0.025;
  if (!_capRatio) { g.save(); g.font = `700 100px ${LOGO_FONT}`; const m = g.measureText('H'); _capRatio = (m.actualBoundingBoxAscent || 72) / 100; g.restore(); }
  g.save(); g.fillStyle = col; g.strokeStyle = col; g.lineJoin = 'round'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  // texto com altura de maiúscula `cap` e largura exata `tw` (esticado na horizontal se a fonte for estreita)
  const word = (txt, left, top, cap, tw) => {
    const fs = cap / _capRatio; g.font = `700 ${fs}px ${LOGO_FONT}`;
    const m = g.measureText(txt), mw = (m.actualBoundingBoxRight != null ? m.actualBoundingBoxRight + (m.actualBoundingBoxLeft || 0) : m.width) || m.width;
    const sx = tw ? tw / mw : 1, x0 = tw ? left + (m.actualBoundingBoxLeft || 0) * sx : left - mw / 2 + (m.actualBoundingBoxLeft || 0);
    g.save(); g.translate(x0, top + cap); g.scale(sx, 1);
    g.lineWidth = weight * cap / sx; if (weight > 0) g.strokeText(txt, 0, 0); g.fillText(txt, 0, 0);
    g.restore();
  };
  if (L.ring) {
    const [cx, cy, R] = L.ring.map((v) => v * u), sw = R * 0.16;
    g.lineWidth = sw; g.beginPath(); g.arc(x + cx, y + cy, R - sw / 2, 0, Math.PI * 2); g.stroke();
    const cap = R * 1.43; word('B', x + cx, y + cy - cap / 2, cap, 0);
  }
  if (L.text) {
    const tx = x + L.text[0] * u, ty = y + L.text[1] * u;
    word('BASE', tx, ty, 0.33 * u, u); word('CHURCH', tx, ty + 0.38 * u, 0.235 * u, u);
  }
  g.restore();
  return L.h * u;
}
// Textura do logo (canvas com a proporção do layout, fundo transparente por padrão).
// opts: { layout, color, bg (cor de fundo ou null), glow (0–1: halo desfocado, p/ LED/neon), size (px da maior dimensão), pad (margem, fração) }
const _logoTexCache = new Map();
function logoTex(opts = {}) {
  const layout = LOGO_LAYOUTS[opts.layout] ? opts.layout : 'full', size = opts.size || 1024, pad = opts.pad != null ? opts.pad : (opts.glow ? 0.08 : 0.02);
  const key = JSON.stringify([layout, cssColor(opts.color), opts.bg == null ? null : cssColor(opts.bg), opts.glow || 0, size, pad, opts.weight]);
  if (_logoTexCache.has(key)) return _logoTexCache.get(key);
  const L = LOGO_LAYOUTS[layout], tw = L.w * (1 + 2 * pad), th = L.h + 2 * pad * L.w, k = size / Math.max(tw, th);
  const c = document.createElement('canvas'); c.width = Math.round(tw * k); c.height = Math.round(th * k);
  const g = c.getContext('2d');
  if (opts.bg != null) { g.fillStyle = cssColor(opts.bg); g.fillRect(0, 0, c.width, c.height); }
  const lw = L.w * k, lx = pad * L.w * k, ly = pad * L.w * k;
  if (opts.glow) {
    g.save(); g.shadowColor = cssColor(opts.color); g.shadowBlur = 0.05 * lw * opts.glow; g.globalAlpha = 0.9;
    drawLogo(g, lx, ly, lw, { layout, color: opts.color, weight: opts.weight }); drawLogo(g, lx, ly, lw, { layout, color: opts.color, weight: opts.weight }); g.restore();
  }
  drawLogo(g, lx, ly, lw, { layout, color: opts.color, weight: opts.weight });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.userData.aspect = c.height / c.width; t.userData.layout = layout;
  _logoTexCache.set(key, t); return t;
}
// Plano pronto (virado para +z, centro na origem). Sem `h`, a altura sai da proporção do layout.
// opts (além dos de logoTex): { emissive (intensidade; 0 = sem brilho próprio), emissiveColor, roughness, metalness,
//   envMapIntensity, opacity (<1 → transparente; senão alphaTest 0,5), side, offset (polygonOffset p/ colar em parede/piso; padrão true), cast }
function logoMesh(w, h, opts = {}) {
  const tex = logoTex(opts); if (!h) h = w * tex.userData.aspect;
  const transp = opts.opacity != null && opts.opacity < 1;
  const mo = { color: 0xffffff, map: tex, roughness: opts.roughness != null ? opts.roughness : 0.45, metalness: opts.metalness || 0,
    side: opts.side || THREE.FrontSide };
  if (opts.envMapIntensity != null) mo.envMapIntensity = opts.envMapIntensity;
  if (transp) Object.assign(mo, { transparent: true, opacity: opts.opacity, depthWrite: false }); else mo.alphaTest = 0.5;
  if (opts.offset !== false) Object.assign(mo, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  if (opts.emissive) Object.assign(mo, { emissive: opts.emissiveColor != null ? opts.emissiveColor : 0xffffff, emissiveMap: tex, emissiveIntensity: opts.emissive });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial(mo));
  m.castShadow = !!opts.cast; m.receiveShadow = !transp; m.userData.logo = true;
  return m;
}
// Letreiro em letras caixa: camadas empilhadas (laterais escuras + face prateada), largura w,
// virado para +z, fundo encostado em z = 0 (cole direto na parede) e centro em x = y = 0.
// opts: { layout, depth (0,08 m), layers (4), color (face, 0xf4f5f7), sideColor (0x8a8d92), drop (deslocamento
//   da lateral, [x, y] em m, p/ o relevo aparecer de frente), emissive (brilho da face), metalness, roughness }
// Devolve um Group com userData.face (material da face: use ctx.bindEmissive(key, face, max)).
function logoRelief(w, opts = {}) {
  const layout = LOGO_LAYOUTS[opts.layout] ? opts.layout : 'full';
  const depth = opts.depth != null ? opts.depth : 0.08, n = Math.max(2, opts.layers || 4);
  const tex = logoTex({ layout, color: '#ffffff', size: opts.size || 1024, weight: opts.weight });
  const h = w * tex.userData.aspect, geo = new THREE.PlaneGeometry(w, h);
  const side = new THREE.MeshStandardMaterial({ color: opts.sideColor != null ? opts.sideColor : 0x8a8d92, map: tex, alphaTest: 0.5, roughness: 0.55, metalness: 0.4 });
  const fo = { color: opts.color != null ? opts.color : 0xf4f5f7, map: tex, alphaTest: 0.5, roughness: opts.roughness != null ? opts.roughness : 0.3,
    metalness: opts.metalness != null ? opts.metalness : 0.35, envMapIntensity: 1.2, emissive: opts.emissiveColor != null ? opts.emissiveColor : 0xfff4e6, emissiveMap: tex, emissiveIntensity: opts.emissive || 0 };
  const face = new THREE.MeshStandardMaterial(fo);
  const [dx, dy] = opts.drop || [0.005 * w, -0.007 * w];
  const grp = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const last = i === n - 1, kk = (n - 1 - i) / (n - 1), m = new THREE.Mesh(geo, last ? face : side);
    m.position.set(dx * kk, dy * kk, 0.004 + depth * i / (n - 1)); m.castShadow = last; m.receiveShadow = false; grp.add(m);
  }
  grp.userData = { face, side, w, h, logo: true };
  return grp;
}

const MAT = {};
function materials() {
  if (MAT.wall) return MAT;
  const T = textures();
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
  MAT.wall     = std({ color: 0xebedf2, map: T.plaster, roughness: 0.95 });   // × reboco ≈ greige #d6d2cb (paredes internas, vídeos)
  MAT.wallDark = std({ color: 0x25262c, roughness: 0.8 });   // fachada/muros pretos (como na foto): preto fosco com juntas
  // Juntas dos painéis em espaço de mundo (verticais a cada 1,25 m, horizontais a cada 3 m): sem textura
  // nem sampler a mais, e sem esticar ao longo das paredes de 49 m. noShare: o merge não troca por outro preto.
  MAT.wallDark.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float wu = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
        float sd = abs(fract(wu / 1.25 + 0.5) - 0.5) * 1.25;
        float seam = 1.0 - smoothstep(0.006, 0.02, sd);
        float hz = 1.0 - smoothstep(0.004, 0.014, abs(fract(vWP.y / 3.0 + 0.5) - 0.5) * 3.0);
        diffuseColor.rgb *= (1.0 - 0.6 * max(seam, hz * step(abs(vWN.y), 0.5))) * (0.96 + 0.04 * sin(wu * 0.7 + vWP.y * 0.3));`);
  };
  MAT.wallDark.customProgramCacheKey = () => 'wallDarkSeams';
  MAT.wallDark.userData.noShare = true;
  MAT.wallDarkCap = std({ color: 0x232326, roughness: 0.8 });
  MAT.lowWall  = std({ color: 0xd6ccb8, map: T.plaster, roughness: 0.95 });
  MAT.ground   = std({ color: 0x9fb08c, map: T.grass, roughness: 1 });
  MAT.doorPanel = std({ color: 0x5a3b28, roughness: 0.75 });
  MAT.baseboard = std({ color: 0xf4f1ea, roughness: 0.7 });
  // vidro: Standard (sem os defines do Physical) com reflexo do céu forte — rasante reflete, de frente fica transparente
  MAT.glass    = new THREE.MeshStandardMaterial({ color: 0xcfe2ef, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
  MAT.wood     = std({ color: 0xa5692a, roughness: 0.7 });
  MAT.woodLite = std({ color: 0x8a6a3f, roughness: 0.7 });
  MAT.white    = std({ color: 0xe9ebee, roughness: 0.6 });
  MAT.steel    = std({ color: 0xcfd4d8, roughness: 0.35, metalness: 0.6 });
  MAT.dark     = std({ color: 0x262626, roughness: 0.6 });
  MAT.mattress = std({ color: 0xd9d5cf });
  MAT.red      = std({ color: 0x8b2f2f });
  MAT.blue     = std({ color: 0x7ea6c9 });
  MAT.tan      = std({ color: 0xb0a080 });
  MAT.chair    = std({ color: 0x5a4a3a });
  MAT.plant    = std({ color: 0x2f6b34, roughness: 1 });
  MAT.pot      = std({ color: 0x7a5236 });
  MAT.car      = std({ color: 0x3b4a6b, roughness: 0.4, metalness: 0.3 });
  MAT.tire     = std({ color: 0x151515 });
  MAT.fixture  = std({ color: 0xf2efe8, roughness: 0.5 });
  MAT.woodDark = std({ color: 0x5a3f2c, roughness: 0.7 });
  MAT.frame    = std({ color: 0xf7f4ee, roughness: 0.6 });
  MAT.frameDark = std({ color: 0x18181a, roughness: 0.45, metalness: 0.3 });   // caixilho preto (porta de vidro da fachada)
  MAT.wallCap  = std({ color: 0xd4cdbf, roughness: 0.9 });
  MAT.pillar   = std({ color: 0xebedf2, map: T.plaster, roughness: 0.9 });
  MAT.cushion  = std({ color: 0xe6dfd3, roughness: 0.95 });
  MAT.navy     = std({ color: 0x3b4a6b, roughness: 0.9 });
  MAT.leaf2    = std({ color: 0x3f7d3a, roughness: 1 });
  MAT.trunk    = std({ color: 0x6b4a2f, roughness: 1 });
  MAT.soil     = std({ color: 0x3d2b1c, roughness: 1 });
  MAT.chrome   = std({ color: 0xdfe3e8, roughness: 0.25, metalness: 0.9 });
  MAT.glassDark = new THREE.MeshStandardMaterial({ color: 0x1a2430, transparent: true, opacity: 0.6, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.2 });
  MAT.mirror   = std({ color: 0xdfe6ee, roughness: 0.05, metalness: 1 });
  MAT.screenOff = std({ color: 0x0b0b0b, emissive: 0x1d3350, emissiveIntensity: 0.35, roughness: 0.3 });
  MAT.lightRed = std({ color: 0xc81e1e, emissive: 0xff3030, emissiveIntensity: 0.5 });
  MAT.lightWhite = std({ color: 0xfff6dd, emissive: 0xfff1d0, emissiveIntensity: 0.35 });
  MAT.graphite = std({ color: 0x3a3b3f, roughness: 0.55, metalness: 0.2 });   // luminárias/refletores
  MAT.concrete = std({ color: 0xb9b6ae, map: T.concrete, roughness: 1 });
  MAT.book     = [0x8b2f2f, 0x2f5f8b, 0x3f7d3a, 0xc9a24a, 0x6b4a2f, 0xe6dfd3].map((c) => std({ color: c, roughness: 0.9 }));
  // ---- Acabamentos reais (fotos e vídeos do cliente) ----
  // portas internas de cedro com veio (lisas, sem almofada), batente/guarnição de madeira
  MAT.door      = std({ color: 0xf0d2b8, map: T.cedar, roughness: 0.55 });   // × textura ≈ #a8662f
  MAT.doorFrame = std({ color: 0x9a5c2a, roughness: 0.6 });
  MAT.baseboardWood = std({ color: 0x9c6a3c, roughness: 0.6 });                // rodapé de madeira no laminado
  MAT.baseboardGray = std({ color: 0xbdbcb8, roughness: 0.4 });                // rodapé de porcelanato no templo
  // vidro levemente fumê dos visores/janelas internas (caixilho preto)
  MAT.glassSmoke = new THREE.MeshStandardMaterial({ color: 0x7d8790, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
  // preto fosco das paredes/pilares do templo (não é unificado com outros pretos no merge)
  MAT.pretoFosco = std({ color: 0x151517, roughness: 0.9 }); MAT.pretoFosco.userData.noShare = true;
  // treliça/tesoura branca da cobertura do templo
  MAT.aluminioBranco = std({ color: 0xeeeeec, roughness: 0.4, metalness: 0.3 });
  // Padrões em espaço de MUNDO (sem textura e sem depender das UVs da caixa): repetem em metros em qualquer
  // peça. `pattern` é GLSL que lê `wp2` (coordenadas no plano da face, m) e altera `diffuseColor`.
  const WS_HEAD = `varying vec3 vWP; varying vec3 vWN;
    float wsH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float wsN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(wsH(i), wsH(i + vec2(1.0, 0.0)), f.x), mix(wsH(i + vec2(0.0, 1.0)), wsH(i + vec2(1.0, 1.0)), f.x), f.y); }
    float wsF(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * wsN(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    float wsJ(vec2 q, vec2 cell, float w){ vec2 l = fract(q / cell) * cell; vec2 d = min(l, cell - l); return 1.0 - smoothstep(0.0, w, min(d.x, d.y)); }`;
  const worldPattern = (mat, key, pattern) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WS_HEAD)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 an = abs(vWN); vec2 wp2 = an.y > 0.5 ? vWP.xz : (an.x > 0.5 ? vWP.zy : vWP.xy);
          ${pattern}`);
    };
    mat.customProgramCacheKey = () => 'ws_' + key;
    return mat;
  };
  // marmorato / cimento queimado cinza manchado (paredes de destaque, pilares)
  MAT.marmorato = worldPattern(std({ color: 0xb4b2ac, roughness: 0.62 }), 'marmorato', `
    float m1 = wsF(wp2 * 0.9), m2 = wsF(wp2 * 3.1 + 7.3), m3 = wsN(wp2 * 22.0);
    diffuseColor.rgb *= 0.68 + 0.5 * m1 + 0.16 * (m2 - 0.5) + 0.05 * (m3 - 0.5);`);
  // placa acústica grafite 0,5 × 0,5 com juntas (sala de mídia)
  MAT.acustico = worldPattern(std({ color: 0x3c3d40, roughness: 0.97 }), 'acustico', `
    vec2 cid = floor(wp2 / 0.5);
    diffuseColor.rgb *= (0.9 + 0.14 * wsH(cid + 3.1)) * (0.96 + 0.08 * wsN(wp2 * 70.0)) * (1.0 - 0.55 * wsJ(wp2, vec2(0.5), 0.012));`);
  // porcelanato cinza-claro 0,9 × 0,9 (meia parede dos banheiros; serve para piso/parede)
  MAT.porcelanatoCinza = worldPattern(std({ color: 0xcfceca, roughness: 0.22 }), 'porcelanatoCinza', `
    vec2 pid = floor(wp2 / 0.9);
    diffuseColor.rgb *= (0.97 + 0.05 * wsH(pid + 1.3)) * (0.95 + 0.07 * wsF(wp2 * 1.6 + pid)) * (1.0 - 0.3 * wsJ(wp2, vec2(0.9), 0.004));`);
  // mármore "marrom imperador" com veios claros, placas de 0,9 × 0,9 (meia parede superior dos banheiros)
  // (veios finos, claros e interrompidos, com leve névoa em volta; fundo marrom-café mesclado — sem "curvas de nível")
  MAT.marmoreMarrom = worldPattern(std({ color: 0x5c4234, roughness: 0.2 }), 'marmoreMarrom', `
    vec2 mid = floor(wp2 / 0.9); vec2 mq = wp2 + mid * 3.7;
    float mn = wsF(mq * 1.3), mv = wsF(mq * 0.6 + 11.0), mb = wsF(mq * 4.0 + 5.0);
    float w1 = abs(sin((mq.x * 1.1 + mq.y * 0.7 + mn * 2.2) * 2.6));
    float w2 = abs(sin((mq.x * -0.6 + mq.y * 1.4 + mv * 3.0) * 4.1));
    float vein = (1.0 - smoothstep(0.0, 0.035, w1)) * smoothstep(0.4, 0.7, mv);
    float vein2 = (1.0 - smoothstep(0.0, 0.02, w2)) * smoothstep(0.45, 0.75, mn);
    float haze = (1.0 - smoothstep(0.0, 0.25, w1)) * smoothstep(0.4, 0.7, mv);
    diffuseColor.rgb *= 0.72 + 0.38 * mn + 0.1 * (mb - 0.5);
    diffuseColor.rgb *= 1.0 + 0.3 * haze;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.49, 0.41), clamp(vein * 0.45 + vein2 * 0.25, 0.0, 0.6));
    diffuseColor.rgb *= 1.0 - 0.35 * wsJ(wp2, vec2(0.9), 0.003);`);
  for (const k of ['marmorato', 'acustico', 'porcelanatoCinza', 'marmoreMarrom']) MAT[k].userData.noShare = true;
  return MAT;
}

function box(w, h, d, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

// ---------------------------------------------------------------------------
// Mobiliário procedural: cada função devolve um Group com origem no centro da
// base (x → largura, z → profundidade, y → altura). Tudo feito de primitivas.
// ---------------------------------------------------------------------------
function cyl(rt, rb, h, mat, x, y, z, seg = 16, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function sph(r, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function furniture(M) {
  const G = () => new THREE.Group();
  const F = {
    bed(w, l, blanket) {
      const g = G();
      g.add(box(w, 0.22, l, M.woodDark, 0, 0.16, 0));
      g.add(box(w - 0.08, 0.2, l - 0.08, M.mattress, 0, 0.37, 0));
      g.add(box(w - 0.12, 0.07, l * 0.6, blanket, 0, 0.5, l * 0.18));
      if (w >= 1.2) { g.add(box(w * 0.4, 0.1, 0.4, M.white, -w * 0.24, 0.52, -l / 2 + 0.35)); g.add(box(w * 0.4, 0.1, 0.4, M.white, w * 0.24, 0.52, -l / 2 + 0.35)); }
      else g.add(box(w * 0.6, 0.1, 0.4, M.white, 0, 0.52, -l / 2 + 0.35));
      g.add(box(w + 0.06, 0.9, 0.07, M.woodDark, 0, 0.5, -l / 2 - 0.03));
      return g;
    },
    nightstand(lamp = true) {
      const g = G();
      g.add(box(0.45, 0.5, 0.42, M.woodDark, 0, 0.25, 0));
      g.add(box(0.14, 0.02, 0.02, M.chrome, 0, 0.32, 0.22));
      if (lamp) { g.add(cyl(0.02, 0.03, 0.22, M.chrome, 0, 0.61, 0, 8)); g.add(cyl(0.07, 0.12, 0.14, M.cushion, 0, 0.78, 0, 12, true)); }
      return g;
    },
    wardrobe(w, h = 2.0, d = 0.6, doors = 2) {
      const g = G();
      g.add(box(w, h, d, M.wood, 0, h / 2, 0));
      g.add(box(w + 0.02, 0.04, d + 0.02, M.woodDark, 0, h + 0.02, 0));
      for (let i = 1; i < doors; i++) g.add(box(0.01, h - 0.1, 0.01, M.woodDark, -w / 2 + (i * w) / doors, h / 2, d / 2));
      for (let i = 0; i < doors; i++) { const cx = -w / 2 + ((i + 0.5) * w) / doors + (i < doors / 2 ? 0.06 : -0.06); g.add(cyl(0.008, 0.008, 0.14, M.chrome, cx, h * 0.5, d / 2 + 0.015, 6)); }
      return g;
    },
    desk(w, d, withMonitor = true) {
      const g = G();
      g.add(box(w, 0.04, d, M.woodLite, 0, 0.74, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.025, 0.025, 0.72, M.dark, sx * (w / 2 - 0.06), 0.36, sz * (d / 2 - 0.06), 8));
      if (withMonitor) {
        g.add(box(0.6, 0.36, 0.03, M.dark, 0, 1.02, -d / 2 + 0.14));
        const scr = box(0.55, 0.31, 0.006, M.screenOff, 0, 1.02, -d / 2 + 0.16); scr.castShadow = false; g.add(scr);
        g.add(cyl(0.02, 0.02, 0.1, M.dark, 0, 0.8, -d / 2 + 0.14, 8)); g.add(cyl(0.1, 0.11, 0.015, M.dark, 0, 0.765, -d / 2 + 0.14, 16));
        g.add(box(0.42, 0.02, 0.14, M.dark, 0, 0.77, 0.06)); g.add(box(0.06, 0.02, 0.1, M.dark, 0.32, 0.77, 0.06));
      }
      return g;
    },
    officeChair() {
      const g = G();
      g.add(box(0.48, 0.08, 0.46, M.dark, 0, 0.47, 0));
      g.add(box(0.46, 0.5, 0.06, M.dark, 0, 0.78, -0.22));
      g.add(box(0.05, 0.03, 0.3, M.dark, -0.24, 0.66, 0)); g.add(box(0.05, 0.03, 0.3, M.dark, 0.24, 0.66, 0));
      g.add(cyl(0.025, 0.025, 0.4, M.chrome, 0, 0.23, 0, 8));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const sp = box(0.3, 0.03, 0.04, M.dark, Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15); sp.rotation.y = -a; g.add(sp); g.add(sph(0.03, M.dark, Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3)); }
      return g;
    },
    bookshelf(w, h, d = 0.3, levels = 4, seed = 1) {
      const g = G(); const rnd = mulberry32(seed);
      g.add(box(0.03, h, d, M.woodLite, -w / 2, h / 2, 0)); g.add(box(0.03, h, d, M.woodLite, w / 2, h / 2, 0));
      g.add(box(w, 0.02, d, M.woodLite, 0, h, 0)); g.add(box(w, h, 0.02, M.woodLite, 0, h / 2, -d / 2));
      for (let i = 0; i < levels; i++) {
        const y = (i * h) / levels + 0.02; g.add(box(w, 0.025, d, M.woodLite, 0, y, 0));
        let x = -w / 2 + 0.06;
        while (x < w / 2 - 0.1) { const bw = 0.03 + rnd() * 0.04, bh = 0.16 + rnd() * 0.1; if (rnd() < 0.85) g.add(box(bw, bh, d * 0.7, M.book[Math.floor(rnd() * M.book.length)], x + bw / 2, y + bh / 2 + 0.012, 0)); x += bw + 0.005; }
      }
      return g;
    },
    sofa(w, d, fabric) {
      const g = G();
      g.add(box(w, 0.38, d, fabric, 0, 0.19, 0));
      g.add(box(w, 0.42, 0.2, fabric, 0, 0.59, -d / 2 + 0.1));
      g.add(box(0.18, 0.56, d, fabric, -w / 2 + 0.09, 0.28, 0)); g.add(box(0.18, 0.56, d, fabric, w / 2 - 0.09, 0.28, 0));
      const n = Math.max(1, Math.round((w - 0.36) / 0.7)), cw = (w - 0.36) / n;
      for (let i = 0; i < n; i++) g.add(box(cw - 0.05, 0.12, d - 0.32, M.cushion, -w / 2 + 0.18 + cw * (i + 0.5), 0.44, 0.08));
      return g;
    },
    diningTable(rx, rz) {
      const g = G();
      const top = cyl(1, 1, 0.05, M.tan, 0, 0.75, 0, 36); top.scale.set(rx, 1, rz); g.add(top);
      g.add(cyl(0.08, 0.08, 0.7, M.woodDark, 0, 0.36, 0, 12));
      const base = cyl(0.45, 0.5, 0.04, M.woodDark, 0, 0.02, 0, 24); base.scale.set(rx / rz, 1, 1); g.add(base);
      return g;
    },
    chair(fabric) {
      const g = G();
      g.add(box(0.42, 0.05, 0.42, M.woodLite, 0, 0.45, 0)); g.add(box(0.38, 0.04, 0.38, fabric, 0, 0.495, 0));
      g.add(box(0.03, 0.45, 0.03, M.woodLite, -0.18, 0.7, -0.19)); g.add(box(0.03, 0.45, 0.03, M.woodLite, 0.18, 0.7, -0.19));
      g.add(box(0.4, 0.16, 0.03, M.woodLite, 0, 0.84, -0.19));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.02, 0.02, 0.44, M.woodLite, sx * 0.18, 0.22, sz * 0.18, 8));
      return g;
    },
    fridge() {
      const g = G();
      g.add(box(0.75, 1.85, 0.7, M.steel, 0, 0.925, 0));
      g.add(box(0.73, 0.012, 0.01, M.dark, 0, 1.25, 0.352));
      g.add(box(0.02, 0.4, 0.025, M.chrome, 0.28, 1.5, 0.37)); g.add(box(0.02, 0.7, 0.025, M.chrome, 0.28, 0.75, 0.37));
      return g;
    },
    stove() {
      const g = G();
      g.add(box(0.6, 0.88, 0.6, M.white, 0, 0.44, 0)); g.add(box(0.6, 0.02, 0.6, M.dark, 0, 0.89, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.08, 0.08, 0.012, M.chrome, sx * 0.14, 0.905, sz * 0.14, 16));
      g.add(box(0.52, 0.4, 0.012, M.steel, 0, 0.4, 0.305)); g.add(box(0.36, 0.14, 0.006, M.dark, 0, 0.42, 0.313));
      g.add(box(0.5, 0.02, 0.025, M.chrome, 0, 0.64, 0.32));
      for (let i = 0; i < 4; i++) g.add(cyl(0.015, 0.015, 0.03, M.chrome, -0.2 + i * 0.13, 0.78, 0.31, 8));
      return g;
    },
    hood() {
      const g = G();
      g.add(box(0.7, 0.08, 0.5, M.steel, 0, 0.04, 0)); g.add(box(0.3, 0.6, 0.3, M.steel, 0, 0.38, -0.1));
      return g;
    },
    cabinet(w, h, d, doors, mat) {
      const g = G(); mat = mat || M.wood;
      g.add(box(w, h, d, mat, 0, h / 2, 0));
      g.add(box(w + 0.02, 0.03, d + 0.02, M.woodDark, 0, h + 0.015, 0));
      for (let i = 1; i < doors; i++) g.add(box(0.008, h - 0.08, 0.01, M.woodDark, -w / 2 + (i * w) / doors, h / 2, d / 2));
      for (let i = 0; i < doors; i++) g.add(cyl(0.007, 0.007, 0.1, M.chrome, -w / 2 + ((i + 0.5) * w) / doors, h * 0.55, d / 2 + 0.012, 6));
      return g;
    },
    sink(w = 0.5, d = 0.4) {
      const g = G();
      g.add(box(w, 0.03, d, M.steel, 0, 0.0, 0)); g.add(box(w - 0.08, 0.02, d - 0.08, M.dark, 0, 0.005, 0));
      g.add(cyl(0.014, 0.014, 0.22, M.chrome, 0, 0.11, -d / 2 + 0.05, 8)); g.add(box(0.025, 0.025, 0.16, M.chrome, 0, 0.22, -d / 2 + 0.12));
      return g;
    },
    toilet() {
      const g = G();
      g.add(box(0.38, 0.38, 0.17, M.white, 0, 0.58, -0.2)); g.add(box(0.34, 0.02, 0.1, M.chrome, 0, 0.78, -0.2));
      const bowl = cyl(0.19, 0.14, 0.38, M.white, 0, 0.19, 0.05, 16); bowl.scale.set(1, 1, 1.25); g.add(bowl);
      const seat = cyl(0.2, 0.2, 0.04, M.white, 0, 0.4, 0.05, 16); seat.scale.set(1, 1, 1.25); g.add(seat);
      return g;
    },
    shower(s) {
      const g = G();
      g.add(box(s, 0.06, s, M.white, 0, 0.03, 0)); g.add(cyl(0.04, 0.04, 0.005, M.chrome, 0, 0.065, 0, 12));
      const p1 = box(0.02, 2.0, s, M.glass, s / 2, 1.0, 0, { cast: false, receive: false }); const p2 = box(s, 2.0, 0.02, M.glass, 0, 1.0, s / 2, { cast: false, receive: false }); g.add(p1, p2);
      g.add(box(0.03, 2.0, 0.03, M.chrome, s / 2, 1.0, s / 2)); g.add(box(0.03, 0.03, s, M.chrome, s / 2, 2.0, 0)); g.add(box(s, 0.03, 0.03, M.chrome, 0, 2.0, s / 2));
      g.add(cyl(0.015, 0.015, 1.9, M.chrome, -s / 2 + 0.06, 0.98, -s / 2 + 0.06, 8)); g.add(box(0.02, 0.02, 0.3, M.chrome, -s / 2 + 0.06, 1.95, -s / 2 + 0.2)); g.add(cyl(0.08, 0.08, 0.02, M.chrome, -s / 2 + 0.06, 1.95, -s / 2 + 0.35, 12));
      return g;
    },
    washbasin() {
      const g = G();
      g.add(box(0.6, 0.78, 0.45, M.white, 0, 0.39, 0)); g.add(box(0.64, 0.04, 0.48, M.steel, 0, 0.8, 0));
      g.add(cyl(0.17, 0.13, 0.1, M.white, 0, 0.86, 0.02, 16)); g.add(cyl(0.012, 0.012, 0.18, M.chrome, 0, 0.9, -0.16, 8)); g.add(box(0.02, 0.02, 0.12, M.chrome, 0, 0.99, -0.1));
      g.add(box(0.5, 0.6, 0.02, M.mirror, 0, 1.5, -0.235));
      return g;
    },
    shelves(w, h, d, levels, seed = 3) {
      const g = G(); const rnd = mulberry32(seed);
      g.add(box(0.03, h, d, M.woodLite, -w / 2, h / 2, 0)); g.add(box(0.03, h, d, M.woodLite, w / 2, h / 2, 0));
      for (let i = 0; i <= levels; i++) {
        const y = 0.1 + (i * (h - 0.1)) / levels; g.add(box(w, 0.025, d, M.woodLite, 0, y, 0));
        if (i < levels) { let x = -w / 2 + 0.08; while (x < w / 2 - 0.12) { const iw = 0.08 + rnd() * 0.1, ih = 0.1 + rnd() * 0.16; if (rnd() < 0.5) g.add(cyl(iw / 2, iw / 2, ih, M.book[Math.floor(rnd() * 6)], x + iw / 2, y + ih / 2 + 0.012, 0, 10)); else g.add(box(iw, ih, iw, M.book[Math.floor(rnd() * 6)], x + iw / 2, y + ih / 2 + 0.012, 0)); x += iw + 0.04 + rnd() * 0.06; } }
      }
      return g;
    },
    car() {
      // sedã: carroceria com capô/porta-malas, cabine afunilada de vidro escuro, teto, para-lamas e faróis
      const g = G();
      g.add(box(1.72, 0.46, 4.2, M.car, 0, 0.56, 0));
      g.add(box(1.66, 0.1, 1.15, M.car, 0, 0.83, -1.45));   // capô levemente elevado
      const cg = new THREE.BoxGeometry(1.52, 0.46, 2.1), P = cg.attributes.position;
      for (let i = 0; i < P.count; i++) if (P.getY(i) > 0) { P.setX(i, P.getX(i) * 0.84); P.setZ(i, P.getZ(i) * (P.getZ(i) < 0 ? 0.62 : 0.8) + 0.08); }
      cg.computeVertexNormals();
      const cab = new THREE.Mesh(cg, M.glassDark); cab.position.set(0, 1.02, 0.1); cab.castShadow = true; cab.receiveShadow = false; g.add(cab);
      g.add(box(1.24, 0.04, 1.44, M.car, 0, 1.26, 0.24));   // teto
      g.add(box(1.36, 0.4, 0.07, M.car, 0, 1.03, 0.2, { cast: false }));   // coluna central
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const wh = cyl(0.33, 0.33, 0.24, M.tire, sx * 0.8, 0.33, sz * 1.35, 18); wh.rotation.z = Math.PI / 2; g.add(wh);
        const hub = cyl(0.17, 0.17, 0.25, M.chrome, sx * 0.8, 0.33, sz * 1.35, 12); hub.rotation.z = Math.PI / 2; g.add(hub);
        const fe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 16, 1, true, -Math.PI / 2, Math.PI), M.car);
        fe.rotation.z = Math.PI / 2; fe.position.set(sx * 0.78, 0.36, sz * 1.35); fe.castShadow = true; g.add(fe);
      }
      g.add(box(1.76, 0.16, 0.12, M.dark, 0, 0.38, -2.1)); g.add(box(1.76, 0.16, 0.12, M.dark, 0, 0.38, 2.1));   // para-choques
      g.add(box(0.36, 0.1, 0.03, M.lightWhite, -0.6, 0.66, -2.1)); g.add(box(0.36, 0.1, 0.03, M.lightWhite, 0.6, 0.66, -2.1));
      g.add(box(0.4, 0.09, 0.03, M.lightRed, -0.6, 0.68, 2.1)); g.add(box(0.4, 0.09, 0.03, M.lightRed, 0.6, 0.68, 2.1));
      g.add(box(0.1, 0.07, 0.14, M.car, -0.9, 0.98, -0.62)); g.add(box(0.1, 0.07, 0.14, M.car, 0.9, 0.98, -0.62));   // retrovisores
      return g;
    },
    plant(size = 1, seed = 1) {
      const g = G(); const rnd = mulberry32(seed);
      g.add(cyl(0.2, 0.15, 0.32, M.pot, 0, 0.16, 0, 12)); g.add(cyl(0.18, 0.18, 0.02, M.soil, 0, 0.32, 0, 12));
      g.add(cyl(0.03, 0.045, 0.5, M.trunk, 0, 0.56, 0, 8));
      for (let i = 0; i < 6; i++) { const a = rnd() * Math.PI * 2, r = 0.1 + rnd() * 0.16; g.add(sph(0.2 + rnd() * 0.1, i % 2 ? M.plant : M.leaf2, Math.cos(a) * r, 0.9 + rnd() * 0.25, Math.sin(a) * r)); }
      g.scale.setScalar(size); return g;
    },
    lounger(fabric) {
      const g = G();
      g.add(box(0.65, 0.04, 1.9, M.white, 0, 0.34, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.04, 0.32, 0.04, M.white, sx * 0.29, 0.16, sz * 0.85));
      g.add(box(0.6, 0.08, 1.15, fabric, 0, 0.4, 0.33));
      const back = box(0.6, 0.08, 0.75, fabric, 0, 0.6, -0.6); back.rotation.x = -0.75; g.add(back);
      return g;
    },
    parasol() {
      const g = G();
      g.add(cyl(0.02, 0.02, 2.3, M.chrome, 0, 1.15, 0, 8)); g.add(cyl(0.22, 0.25, 0.06, M.dark, 0, 0.03, 0, 12));
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.34, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xf1e3c8, roughness: 0.95, side: THREE.DoubleSide })); c.position.y = 2.28; c.castShadow = true; g.add(c);
      return g;
    },
    roundTable(r = 0.45) {
      const g = G();
      g.add(cyl(r, r, 0.04, M.woodLite, 0, 0.72, 0, 24)); g.add(cyl(0.04, 0.04, 0.7, M.chrome, 0, 0.36, 0, 8)); g.add(cyl(0.25, 0.28, 0.03, M.chrome, 0, 0.015, 0, 16));
      return g;
    },
    rug(w, d, color) {
      const g = G(); const m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
      const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 1 });
      g.add(box(w + 0.16, 0.01, d + 0.16, dark, 0, 0.005, 0, { cast: false })); g.add(box(w, 0.012, d, m, 0, 0.012, 0, { cast: false }));
      return g;
    },
  };
  return F;
}

// ---------------------------------------------------------------------------
// Desempenho: funde as malhas estáticas por material (um draw call por material).
// `root` = onde procurar (e onde o resultado fica). Com `skipKeep`, os subgrupos
// marcados com userData.keep (ex.: o grupo da Fachada) ficam de fora — eles são
// fundidos à parte, chamando mergeStatic(grupo) depois.
// ---------------------------------------------------------------------------
// Materiais "quase iguais" (mesmo tipo e opções, cor a ±22/255 por canal, rugosidade e
// metalicidade a ±0,25) viram um só no merge: as decorações criam muitas variações de
// preto/grafite/madeira que ninguém distingue, e cada variação custaria um draw call.
// Só entram materiais simples — sem mapas, sem transparência e sem emissivo (os emissivos
// podem ser animados pelo cartão, então ficam sempre separados).
const MAT_TOL_C = 22 / 255, MAT_TOL_R = 0.25;
// Materiais IDÊNTICOS (mesmas texturas — o mesmo objeto —, cores e opções) também viram um só, mesmo com
// mapa, emissivo ou transparência: ex. as laterais das letras caixa (ctx.logo.relief) e placas com a
// mesma textura criadas em vários lugares. Nunca entram os que o cartão anima (userData.noShare:
// ctx.bindEmissive, LEDs do som/ar, tela do telão) nem os com shader modificado (onBeforeCompile).
const _texId = (t) => t ? t.uuid : '';
function matExactSig(m) {
  if (m.userData.noShare || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || !(m.isMeshStandardMaterial || m.isMeshBasicMaterial)) return null;
  const hx = (c) => c ? c.getHex() : '';
  return [m.type, hx(m.color), hx(m.emissive), m.emissiveIntensity, _texId(m.map), _texId(m.emissiveMap), _texId(m.bumpMap), m.bumpScale, _texId(m.aoMap), m.aoMapIntensity,
    _texId(m.alphaMap), _texId(m.normalMap), _texId(m.roughnessMap), _texId(m.metalnessMap), _texId(m.lightMap), _texId(m.envMap), m.roughness, m.metalness, m.envMapIntensity,
    m.transparent, m.opacity, m.alphaTest, m.side, m.depthWrite, m.depthTest, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.blending,
    m.toneMapped, m.fog, m.vertexColors, m.flatShading, m.wireframe, m.visible, m.colorWrite].join('|');
}
function matCanon(reps, m) {
  if (m.map || m.emissiveMap || m.transparent || m.bumpMap || m.alphaTest || m.polygonOffset || (m.emissive && m.emissive.getHex() !== 0)) {
    const sig = matExactSig(m); if (!sig) return m;
    reps.exact = reps.exact || new Map();
    const r = reps.exact.get(sig); if (r) return r;
    reps.exact.set(sig, m); return m;
  }
  if (m.type !== 'MeshStandardMaterial' || m.transparent || m.opacity < 1 || m.alphaTest || m.vertexColors || m.wireframe
    || m.map || m.emissiveMap || m.normalMap || m.bumpMap || m.roughnessMap || m.metalnessMap || m.alphaMap || m.aoMap || m.lightMap || m.envMap
    || (m.emissive && m.emissive.getHex() !== 0) || m.polygonOffset || m.userData.noShare) return m;
  const sig = [m.side, m.flatShading, m.depthWrite, m.depthTest, m.fog, m.toneMapped, m.envMapIntensity].join('|');
  const c = m.color;
  for (const r of reps) {
    if (r.sig !== sig) continue;
    if (Math.abs(r.m.color.r - c.r) > r.tr || Math.abs(r.m.color.g - c.g) > r.tg || Math.abs(r.m.color.b - c.b) > r.tb) continue;
    if (Math.abs(r.m.roughness - m.roughness) > MAT_TOL_R || Math.abs(r.m.metalness - m.metalness) > MAT_TOL_R) continue;
    return r.m;
  }
  // tolerância medida em sRGB (a cor fica em linear dentro do material)
  const s = c.clone().convertLinearToSRGB();
  const tol = (v) => { const lo = new THREE.Color(Math.max(0, v - MAT_TOL_C), 0, 0).convertSRGBToLinear().r, hi = new THREE.Color(Math.min(1, v + MAT_TOL_C), 0, 0).convertSRGBToLinear().r; return (hi - lo) / 2; };
  reps.push({ m, sig, tr: tol(s.r), tg: tol(s.g), tb: tol(s.b) });
  return m;
}
// Junta as geometrias de `meshes` (coordenadas relativas a `inv`) numa só BufferGeometry.
// Escreve direto nos arrays finais (sem clonar/desindexar cada peça): com ~6 mil peças
// isso corta o tempo de fusão pela metade.
function mergeGeos(meshes, inv) {
  let total = 0;
  for (const o of meshes) total += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3();
  let off = 0;
  for (const o of meshes) {
    const g = o.geometry, idx = g.index, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    m4.multiplyMatrices(inv, o.matrixWorld); n3.getNormalMatrix(m4);
    const e = m4.elements, q = n3.elements;
    const n = idx ? idx.count : P.count;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx.getX(k) : k, j = (off + k) * 3;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = N.getX(i), b = N.getY(i), c = N.getZ(i);
      let nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1; nor[j] = nx / l; nor[j + 1] = ny / l; nor[j + 2] = nz / l;
      uv[(off + k) * 2] = U.getX(i); uv[(off + k) * 2 + 1] = U.getY(i);
    }
    off += n;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  return merged;
}
function mergeStatic(root, skipKeep = true) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map(), reps = [];
  root.traverse((o) => {
    if (o === root || !o.isMesh || o.isSprite || o.userData.item || o.userData.zone || o.userData.keep || o.userData.noMerge) return;
    for (let q = o.parent; q && q !== root; q = q.parent) if (q.userData && (q.userData.item || (skipKeep && q.userData.keep))) return;
    const g = o.geometry, m0 = o.material;
    if (Array.isArray(m0) || !g.attributes.position || !g.attributes.normal || !g.attributes.uv) return;
    const m = matCanon(reps, m0);
    // quem projeta sombra fica separado de quem não projeta (custo das sombras);
    // receber sombra não separa: o grupo recebe se qualquer peça recebia
    const key = m.uuid + (o.castShadow ? ':c' : ':n');
    if (!groups.has(key)) groups.set(key, { mat: m, meshes: [] });
    groups.get(key).meshes.push(o);
  });
  // Peças rente ao chão (tapetes, faixas, capachos, marcações: topo ≤ 0,1 m) que não projetam sombra
  // entram no grupo das que projetam, quando ele existe: a sombra delas é invisível e economiza 1 draw call.
  const _bb = new THREE.Box3();
  for (const [key, grp] of groups) {
    if (!key.endsWith(':n')) continue;
    const cg = groups.get(key.slice(0, -2) + ':c'); if (!cg) continue;
    if (grp.meshes.every((o) => { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); return _bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).max.y <= 0.1; })) {
      cg.meshes.push(...grp.meshes); groups.delete(key);
    }
  }
  let before = 0, after = 0;
  for (const { mat, meshes } of groups.values()) {
    before += meshes.length;
    if (meshes.length < 2) { after += meshes.length; meshes[0].material = mat; continue; }
    const mesh = new THREE.Mesh(mergeGeos(meshes, inv), mat);
    mesh.castShadow = meshes[0].castShadow; mesh.receiveShadow = meshes.some((o) => o.receiveShadow); mesh.matrixAutoUpdate = false; mesh.renderOrder = meshes[0].renderOrder;
    for (const o of meshes) { o.parent.remove(o); o.geometry.dispose(); }
    root.add(mesh); after += 1;
  }
  return { before, after };
}

// Remendos de shader do modo media (onBeforeCompile). O laço das luzes pontuais custa por pixel e por luz: o gramado
// (longe das lâmpadas) fica sem ele. Nos materiais com reflexo do céu fica só o especular do environment
// map — a luz difusa do céu vem da sonda (LightProbe), que custa quase nada.
const NO_POINT = THREE.ShaderChunk.lights_fragment_begin.replace(/#if \( NUM_POINT_LIGHTS > 0 \)[\s\S]*?#pragma unroll_loop_end\s*#endif/, '');
const ENV_SPEC = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');
function patchNoPoint(m) {
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', NO_POINT); };
  m.customProgramCacheKey = () => 'nopoint'; return m;
}
function patchEnvSpec(m) {
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', ENV_SPEC); };
  m.customProgramCacheKey = () => 'envspec'; return m;
}
// Sonda de luz (harmônicos esféricos) com a mesma luz difusa que o environment map do alta dá: o domo do céu (textura
// em canvas, mapeamento da SphereGeometry, raio 130) visto pelas câmeras do PMREM (far 100) — só aparece nas diagonais
// (profundidade 130·max|d| < 100); no resto fica a cor de fundo do renderer. De dia soma o disco do sol.
function skySH(tex, sun) {
  const W = 32, Hh = 64, g = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  g.canvas.width = W; g.canvas.height = Hh; g.drawImage(tex.image, 0, 0, W, Hh);
  const px = g.getImageData(0, 0, W, Hh).data, sh = new THREE.SphericalHarmonics3(), basis = new Array(9), col = new THREE.Color(), dir = new THREE.Vector3();
  const bg = new THREE.Color(0x0a0f1e), add = (c, w) => { THREE.SphericalHarmonics3.getBasisAt(dir, basis); for (let i = 0; i < 9; i++) sh.coefficients[i].x += c.r * basis[i] * w, sh.coefficients[i].y += c.g * basis[i] * w, sh.coefficients[i].z += c.b * basis[i] * w; };
  const dA = (Math.PI / Hh) * (2 * Math.PI / W);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const th = (y + 0.5) / Hh * Math.PI, ph = (x + 0.5) / W * Math.PI * 2, k = (y * W + x) * 4;
    dir.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
    const seen = 130 * Math.max(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)) < 100;
    add(seen ? col.setRGB(px[k] / 255, px[k + 1] / 255, px[k + 2] / 255, THREE.SRGBColorSpace) : bg, Math.sin(th) * dA);
  }
  if (sun) { dir.set(-45, 90, 35); const r = dir.length(); dir.normalize(); add(col.setRGB(1, 1, 1), Math.PI * (6 / r) ** 2); }
  return sh;
}

// Funde as peças de luminária/objeto ligadas à mesma entidade que usam o mesmo material
// (lentes, campânulas, cúpulas): continuam clicáveis e acendendo juntas, com 1 draw call.
// Só peças soltas direto na cena/grupo (as folhas da porta, que giram, ficam de fora).
function mergeItems(holder, clickables, items) {
  holder.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  const groups = new Map();
  for (const o of holder.children) {
    if (!o.isMesh || !o.userData.item || o.userData.zone || Array.isArray(o.material) || !o.geometry.attributes.uv) continue;
    const key = o.userData.item + '|' + o.material.uuid + (o.castShadow ? ':c' : ':n');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const o0 = meshes[0], mesh = new THREE.Mesh(mergeGeos(meshes, inv), o0.material);
    mesh.castShadow = o0.castShadow; mesh.receiveShadow = meshes.some((o) => o.receiveShadow);
    mesh.userData = { item: o0.userData.item };
    const set = new Set(meshes);
    const rt = items.get(o0.userData.item);
    if (rt && rt.fixtures && rt.fixtures.some((f) => set.has(f))) rt.fixtures = rt.fixtures.filter((f) => !set.has(f)).concat([mesh]);
    if (clickables.some((c) => set.has(c))) { for (let i = clickables.length - 1; i >= 0; i--) if (set.has(clickables[i])) clickables.splice(i, 1); clickables.push(mesh); }
    for (const o of meshes) { holder.remove(o); o.geometry.dispose(); }
    holder.add(mesh);
  }
}

// ---------------------------------------------------------------------------
// Controle de órbita (mínimo, sem dependências): arrastar gira, roda/pinça
// aproxima, botão direito / dois dedos / Shift arrasta o alvo.
// v1.6.1 — toque (o mouse segue como antes): 1 dedo gira com sensibilidade pela largura do canvas e, passados ~10 px, trava o eixo
// (de lado: só gira · em pé: só inclina · diagonal: os dois); solto com velocidade, o giro continua e desacelera (projeção 0,998).
// 2 dedos estilo mapa: pinça = zoom no ponto entre os dedos, torção = gira, arrasto paralelo = pan — cada um só entra depois do seu limiar.
// Zoom e inclinação resistem além dos limites (rubber band) e voltam ao soltar.
// ---------------------------------------------------------------------------
const rubber = (v, lo, hi, dl, dh) => v < lo ? lo - (lo - v) * dl * 0.55 / (dl + 0.55 * (lo - v)) : v > hi ? hi + (v - hi) * dh * 0.55 / (dh + 0.55 * (v - hi)) : v;
const angWrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
class Orbit {
  constructor(camera, dom, target) {
    this.camera = camera; this.dom = dom;
    this.target = target.clone(); this.targetGoal = target.clone();
    this.sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
    this.goal = this.sph.clone();
    this.minDist = 3; this.maxDist = 150; this.minPolar = 0.02; this.maxPolar = 1.45;   // 0,02: dá para olhar reto de cima (Vista de cima)
    this.speed = 9; this.userAt = 0;   // speed: suavização (menor = voo mais lento); userAt: último gesto do usuário
    this.pointers = new Map(); this.moved = 0; this.multi = false; this.two = null; this.spin = 0; this.touched = false;   // spin: inércia do giro (rad/s)
    this.onClick = null; this.onHover = null; this.enabled = true;   // enabled = false na visão de pessoa (o Walker assume os gestos)
    this._down = (e) => this.down(e); this._move = (e) => this.move(e);
    this._up = (e) => this.up(e); this._wheel = (e) => this.wheel(e);
    dom.addEventListener('pointerdown', this._down);
    dom.addEventListener('pointermove', this._move);
    dom.addEventListener('pointerup', this._up);
    dom.addEventListener('pointercancel', this._up);
    dom.addEventListener('wheel', this._wheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.dirty = true;
  }
  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._down); d.removeEventListener('pointermove', this._move);
    d.removeEventListener('pointerup', this._up); d.removeEventListener('pointercancel', this._up);
    d.removeEventListener('wheel', this._wheel);
  }
  down(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture(e.pointerId);
    this.spin = 0;   // qualquer toque segura a inércia
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, b: e.button, shift: e.shiftKey, touch: e.pointerType !== 'mouse', axis: null, h: [] });
    if (this.pointers.size === 1) { this.moved = 0; this.multi = false; } else this.multi = true;
    this.two = this.pointers.size === 2 ? this._twoNow() : null;
  }
  // dois dedos: distância, ângulo e ponto médio (os de partida ficam em d0/a0/mx0/my0 para os limiares)
  _twoNow() {
    const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return { d, a: ang, mx, my, d0: d, a0: ang, mx0: mx, my0: my, r: this.goal.radius, zoom: false, rot: false, pan: false };
  }
  move(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) { if (this.onHover) this.onHover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY; this.touched = true; this.userAt = performance.now(); this.speed = 9;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (p.touch) {
      if (this.pointers.size === 2 && this.two) this._twoMove();
      else if (this.pointers.size === 1) this._oneMove(p, e, dx, dy);
    } else if (p.b === 2 || p.b === 1 || p.shift) {
      this.pan(dx, dy);
    } else {
      this.goal.theta -= dx * 0.0055;
      this.goal.phi = clamp(this.goal.phi - dy * 0.0055, this.minPolar, this.maxPolar);
    }
    this.dirty = true;
  }
  _oneMove(p, e, dx, dy) {
    if (!p.axis) {
      const ax = e.clientX - p.sx, ay = e.clientY - p.sy; if (Math.hypot(ax, ay) < 10) return;
      const r = Math.abs(ay) / Math.max(Math.abs(ax), 1e-3);
      p.axis = r < 0.5 ? 'x' : r > 2 ? 'y' : 'xy'; p.raw = this.goal.phi; return;   // daqui em diante segue o dedo 1:1
    }
    const k = 2 * Math.PI / (1.5 * (this.dom.clientWidth || 800));   // 1,5 largura de tela = uma volta
    if (p.axis !== 'y') this.goal.theta -= dx * k;
    if (p.axis !== 'x') { p.raw -= dy * k; this.goal.phi = rubber(p.raw, this.minPolar, this.maxPolar, this.minPolar * 0.9, 0.12); }
    p.h.push([e.clientX, e.timeStamp]); if (p.h.length > 8) p.h.shift();   // hora do evento (não a do handler): velocidade ao soltar
  }
  _twoMove() {
    const t = this.two, n = this._twoNow();
    if (!t.zoom && Math.abs(n.d / t.d0 - 1) > 0.04) t.zoom = true;   // pinça > 4 %
    if (!t.rot && Math.abs(angWrap(n.a - t.a0)) > 0.105) t.rot = true;   // torção > 6°
    if (!t.pan && Math.hypot(n.mx - t.mx0, n.my - t.my0) > 12) t.pan = true;   // arrasto > 12 px
    if (t.zoom && n.d > 0) {
      const r0 = this.goal.radius; t.r *= t.d / n.d;
      this.goal.radius = rubber(t.r, this.minDist, this.maxDist, this.minDist * 0.5, this.maxDist * 0.3);
      const P = this._ground(n.mx, n.my);   // o ponto do piso entre os dedos fica parado na tela
      if (P) { this.targetGoal.lerp(P, 1 - this.goal.radius / r0); this.pan(0, 0); }
    }
    if (t.rot) this.goal.theta += angWrap(n.a - t.a);
    if (t.pan) this.pan(n.mx - t.mx, n.my - t.my);
    Object.assign(t, { d: n.d, a: n.a, mx: n.mx, my: n.my });
  }
  // ponto do piso (y = 0) sob (cx, cy) na tela
  _ground(cx, cy) {
    const r = this.dom.getBoundingClientRect(), rc = this._rc || (this._rc = new THREE.Raycaster()), v = this._ndc || (this._ndc = new THREE.Vector2());
    v.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); rc.setFromCamera(v, this.camera);
    const ray = rc.ray; if (ray.direction.y > -0.05) return null;
    return ray.origin.clone().addScaledVector(ray.direction, -ray.origin.y / ray.direction.y);
  }
  up(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (p && this.moved < 6 && p.b === 0 && !this.multi && this.onClick) this.onClick(e);
    if (p && p.touch && this.pointers.size === 1) { const q = [...this.pointers.values()][0]; q.sx = q.x; q.sy = q.y; q.axis = null; q.h = []; }   // 2 → 1 dedo: recomeça o limiar (sem pulo)
    if (p && p.touch && !this.pointers.size) {
      const b = p.h[p.h.length - 1], a = b && (p.h.find((q) => q[1] >= b[1] - 100 && q !== b) || p.h[p.h.length - 2]);   // velocidade dos últimos ~100 ms
      const v = a && b[1] > a[1] && e.timeStamp - b[1] < 150 ? (b[0] - a[0]) / (b[1] - a[1]) * 1000 : 0;   // px/s (dedo parado antes de soltar: 0)
      if (!this.multi && p.axis && p.axis !== 'y' && Math.abs(v) > 60) this.spin = -v * 2 * Math.PI / (1.5 * (this.dom.clientWidth || 800));
      this.goal.phi = clamp(this.goal.phi, this.minPolar, this.maxPolar); this.goal.radius = clamp(this.goal.radius, this.minDist, this.maxDist);   // além do limite: volta suave
      this.dirty = true;
    }
    this.two = this.pointers.size === 2 ? this._twoNow() : null;
  }
  wheel(e) { e.preventDefault(); if (!this.enabled) return; this.touched = true; this.userAt = performance.now(); this.speed = 9; this.zoomBy(Math.exp(e.deltaY * 0.0012)); this.dirty = true; }
  zoomBy(f) { this.goal.radius = clamp(this.goal.radius * f, this.minDist, this.maxDist); }
  pan(dx, dy) {
    const k = this.goal.radius * 0.0016;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    this.targetGoal.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
    this.targetGoal.x = clamp(this.targetGoal.x, LOT.x0 - 6, LOT.x1 + 6);
    this.targetGoal.z = clamp(this.targetGoal.z, LOT.z0 - 6, LOT.z1 + 6);
  }
  reset(pos, target) {
    this.spin = 0;
    this.goal.setFromVector3(pos.clone().sub(target)); this.targetGoal.copy(target); this.dirty = true;
    // gira pelo lado mais curto (theta acumula voltas quando o usuário arrasta)
    const d = this.goal.theta - this.sph.theta; this.goal.theta = this.sph.theta + (((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  }
  // voo suave até a pose (mais lento que o arrasto; qualquer gesto do usuário volta ao normal)
  fly(pos, target, speed = 2.6) { this.reset(pos, target); this.speed = speed; }
  update(dt) {
    if (this.spin) {   // inércia do giro: decai como a rolagem (0,998 por ms); conta como gesto para o governador de qualidade
      this.goal.theta += this.spin * dt; this.spin *= Math.pow(0.998, dt * 1000); this.userAt = performance.now();
      if (Math.abs(this.spin) < 0.02) this.spin = 0;
    }
    const k = 1 - Math.exp(-dt * this.speed);
    const s = this.sph;
    s.theta += (this.goal.theta - s.theta) * k;
    s.phi += (this.goal.phi - s.phi) * k;
    s.radius += (this.goal.radius - s.radius) * k;
    this.target.lerp(this.targetGoal, k);
    const moving = Math.abs(this.goal.theta - s.theta) + Math.abs(this.goal.phi - s.phi) + Math.abs(this.goal.radius - s.radius) + this.target.distanceTo(this.targetGoal) > 1e-4 || !!this.spin;
    this.camera.position.setFromSpherical(s).add(this.target);
    this.camera.lookAt(this.target);
    const wasDirty = this.dirty; this.dirty = moving; this.moving = moving;
    if (!moving) this.speed = 9;
    return wasDirty || moving;
  }
}

const _dm1 = new THREE.Matrix4(), _dm2 = new THREE.Matrix4(), _dm3 = new THREE.Matrix4();   // temporários das portas (_doorApply)
const _rsz = new THREE.Vector2();   // temporário do _resize
const _lbl = new THREE.Vector3();   // temporário do _updateLabels
// Acender/apagar das lâmpadas (sem alocar por quadro): up/dn = velocidade da subida/descida (1/s, exponencial), warm = quanto começa alaranjado
// (filamento/HID esquentando: cor e halo crescem junto), tube = tremida de partida de tubo fluorescente/LED linear (só onde faz sentido)
const _WARM = new THREE.Color(1.0, 0.5, 0.18);
const LAMP_FX = {
  palco: { up: 11, dn: 7, warm: 0, tube: 0 }, plateia: { up: 5.5, dn: 4.5, warm: 0.35, tube: 0 }, hall: { up: 3.2, dn: 4.5, warm: 0.8, tube: 0 },
  fachada: { up: 2.4, dn: 3.2, warm: 0.55, tube: 0 }, estacionamento: { up: 1.5, dn: 2.2, warm: 0.7, tube: 0 }, pastoral: { up: 3, dn: 4, warm: 0.9, tube: 0 },
  recepcao: { up: 3.4, dn: 4.5, warm: 0.6, tube: 0 }, administrativo: { up: 16, dn: 12, warm: 0, tube: 1 }, circulacao: { up: 16, dn: 12, warm: 0, tube: 1 },
  midia: { up: 16, dn: 12, warm: 0, tube: 1 }, voluntariado: { up: 3.6, dn: 5, warm: 0.6, tube: 0 }, cozinha: { up: 16, dn: 12, warm: 0, tube: 1 },
  banheiros: { up: 16, dn: 12, warm: 0, tube: 1 },
};
const _TUBE = [[0.07, 0.85], [0.13, 0.05], [0.21, 0.7], [0.3, 0.1], [0.38, 0.95], [0.45, 0.25], [0.52, 1], [0.58, 0.6], [0.62, 1]];   // (até quando, brilho)
const tubeFlick = (a) => { for (const [u, v] of _TUBE) if (a < u) return v; return 1; };

// ---------------------------------------------------------------------------
// Visão de pessoa: câmera a 1,6 m do piso; setas/WASD ou joystick andam, arrastar vira a cabeça (Q/E também), Shift corre.
// Colisão simples com as paredes do modelo (card._walkCollide); portas e vãos passam. Espelha o estado nas flags do Orbit
// (moving/dirty/userAt/touched), que o resto do cartão (governador de qualidade, rótulos, ares) já lê.
// ---------------------------------------------------------------------------
class Walker {
  constructor(card, camera, dom) {
    this.card = card; this.camera = camera; this.dom = dom;
    this.pos = new THREE.Vector3(12.0, 1.6, 52.0);   // começa na calçada, de frente para a porta principal do hall
    this.yaw = 0; this.pitch = 0;                     // frente = (−sin yaw, 0, −cos yaw): yaw 0 olha para −z (para dentro)
    this.vel = new THREE.Vector3(); this.keys = new Set(); this.joy = { x: 0, y: 0 };
    this.on = false; this.moving = false; this.dirty = false; this.head = false; this.gesture = false;
    this.look = null; this.moved = 0; this.lx = 0; this.ly = 0; this.btn = 0; this.used = false;
    this.high = false; this.path = null;   // up: no andar do mezanino/escada · path: caminhada até o ponto clicado { pts, i, … }
    this._pd = (e) => this.down(e); this._pm = (e) => this.move(e); this._pu = (e) => this.up(e);
    this._kd = (e) => this.key(e, true); this._ku = (e) => this.key(e, false); this._blur = () => this.keys.clear();
    this._wheel = (e) => e.preventDefault();
    this._joyReset = () => {}; this._joyBind();
  }
  enable() {
    if (this.on) return; this.on = true; this.dirty = true;
    const d = this.dom;
    d.addEventListener('pointerdown', this._pd); d.addEventListener('pointermove', this._pm);
    d.addEventListener('pointerup', this._pu); d.addEventListener('pointercancel', this._pu);
    d.addEventListener('wheel', this._wheel, { passive: false });
    window.addEventListener('keydown', this._kd, true); window.addEventListener('keyup', this._ku, true);   // captura: os atalhos do HA (E, C, A…) não disparam enquanto anda
    window.addEventListener('blur', this._blur);   // trocou de janela com tecla apertada: solta tudo
  }
  disable() {
    if (!this.on) return; this.on = false;
    const d = this.dom;
    d.removeEventListener('pointerdown', this._pd); d.removeEventListener('pointermove', this._pm);
    d.removeEventListener('pointerup', this._pu); d.removeEventListener('pointercancel', this._pu);
    d.removeEventListener('wheel', this._wheel);
    window.removeEventListener('keydown', this._kd, true); window.removeEventListener('keyup', this._ku, true); window.removeEventListener('blur', this._blur);
    this.keys.clear(); this.look = null; this._joyReset(); this.vel.set(0, 0, 0);
  }
  reset(x, z, yaw = 0, pitch = 0, up = false) {
    this.path = null; this.high = this.card._walkUp(x, z, up);
    this.pos.set(x, this.card._walkFloor(x, z, this.high) + 1.6, z); this.yaw = yaw; this.pitch = pitch; this.vel.set(0, 0, 0); this.dirty = true;
  }
  // interrompe a caminhada até o ponto clicado (teclado/joystick assumem, chegou ou travou)
  stop(arrived) { if (!this.path) return; this.path = null; this.card._walkStopped(arrived); }
  down(e) {
    if (this.look != null) return;   // um dedo olha por vez (o outro pode estar no joystick)
    this.look = e.pointerId; this.moved = 0; this.lx = e.clientX; this.ly = e.clientY; this.btn = e.button;
    try { this.dom.setPointerCapture(e.pointerId); } catch (_) {}
  }
  move(e) {
    if (e.pointerId !== this.look) { if (this.look == null && e.pointerType === 'mouse') this.card._onHover(e); return; }
    const dx = e.clientX - this.lx, dy = e.clientY - this.ly; this.lx = e.clientX; this.ly = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.yaw += dx * 0.005; this.pitch = clamp(this.pitch + dy * 0.005, -1.2, 1.2);   // como no Street View: o mundo acompanha o dedo
    this.head = this.gesture = true;
  }
  up(e) {
    if (e.pointerId !== this.look) return;
    this.look = null; try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (this.moved < 6 && this.btn === 0 && e.type === 'pointerup') this.card._onClick(e);   // toque curto = clique (luz, ar, telão…)
  }
  key(e, down) {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;   // digitando em outro campo da página
    if (t && t.closest && t.closest('.sizer')) return;   // ←/→ na borda do painel mexem a largura, não a pessoa
    const c = e.code;
    if (down && this.card._menuOn) return;   // v1.6.0: menu de opções aberto — Esc fecha só o menu, setas andam pelos itens
    if (c === 'Escape') { if (down) { e.stopPropagation(); this.card._setWalk(false); } return; }
    if (c === 'Enter' || c === 'KeyF') {   // interagir: abre/fecha a porta mais perto e à frente (E já é "girar")
      if (t && t !== this.card._canvas && t !== document.body && t !== document.documentElement) return;   // Enter em botões/links/diálogos da página segue normal
      if (down && !e.repeat) this.card._doorInteract();
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(c)) {
      if (down) { this.keys.add(c); this.gesture = true; } else this.keys.delete(c);
      if (!c.startsWith('Shift')) { e.preventDefault(); e.stopPropagation(); }   // a página não rola e os atalhos do HA não disparam
    }
  }
  // joystick na tela: zona morta 0,15; o vetor (x direita, y frente) vai em this.joy
  _joyBind() {
    const el = this.card._joy; if (!el) return;
    const knob = el.firstElementChild; let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect(), R = r.width / 2;
      let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R; const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
      const m = Math.hypot(dx, dy), s = m < 0.15 ? 0 : (m - 0.15) / 0.85;   // zona morta; depois cresce até 1
      this.joy.x = m ? dx / m * s : 0; this.joy.y = m ? -dy / m * s : 0; this.gesture = true;
    };
    el.addEventListener('pointerdown', (e) => { if (id != null) return; id = e.pointerId; try { el.setPointerCapture(id); } catch (_) {} e.stopPropagation(); e.preventDefault(); set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.stopPropagation(); set(e); } });
    const end = (e) => { if (e.pointerId !== id) return; e.stopPropagation(); id = null; this._joyReset(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    this._joyReset = () => { this.joy.x = this.joy.y = 0; knob.style.transform = ''; };
  }
  update(dt) {
    const c = this.card, o = c._orbit, k = this.keys, now = performance.now();
    const wasDirty = this.dirty || o.dirty; this.dirty = false; o.dirty = false;
    // entrada: teclado (−1…1) + joystick
    let iy = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.joy.y;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.joy.x;
    const turn = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
    if (this.path && (iy || ix || turn)) this.stop(false);   // o teclado / joystick assume o comando
    if (turn) { this.yaw += turn * 1.6 * dt; this.head = true; }
    const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);   // frente e direita no piso
    const sp = 1.6 * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : 1);
    let gx = (fx * iy + rx * ix) * sp, gz = (fz * iy + rz * ix) * sp;
    // caminhada até o ponto clicado (estilo Street View): vira o corpo para o rumo e anda pelos pontos do caminho (já livre de paredes)
    const P = this.path; let can = false;
    if (P) {
      const [tx, tz] = P.pts[P.i], dx = tx - this.pos.x, dz = tz - this.pos.z, dd = Math.hypot(dx, dz), lastPt = P.i === P.pts.length - 1;
      if (dd < (lastPt ? 0.1 : 0.16)) { P.i++; if (P.i >= P.pts.length) this.stop(true); }
      else {
        let err = Math.atan2(-dx, -dz) - this.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
        if (this.look == null) { const st = clamp(err, -4.5 * dt, 4.5 * dt); this.yaw += st; err -= st; this.head = true; }
        const ali = Math.max(0, Math.cos(err)), spd = 1.75 * (lastPt ? clamp(dd * 2.5, 0.3, 1) : 1) * (ali > 0.8 ? 1 : ali * ali);
        gx = dx / dd * spd; gz = dz / dd * spd; can = ali > 0.8;
      }
    }
    const kv = 1 - Math.exp(-dt * 10);
    this.vel.x += (gx - this.vel.x) * kv; this.vel.z += (gz - this.vel.z) * kv;
    if (!gx && !gz && Math.hypot(this.vel.x, this.vel.z) < 0.02) this.vel.set(0, 0, 0);
    const walking = this.vel.x !== 0 || this.vel.z !== 0;
    if (walking) { const r = c._walkCollide(this.pos.x, this.pos.z, this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt, this.high); this.pos.x = r[0]; this.pos.z = r[1]; this.high = c._walkUp(r[0], r[1], this.high); }
    if (this.path) {   // travou numa parede / móvel do caminho: para onde deu para chegar
      const Q = this.path; if (can) Q.t += dt; else Q.t = 0;
      if (Q.t > 0.6) {
        if (Math.hypot(this.pos.x - Q.px, this.pos.z - Q.pz) < 0.07) { if (Q.tries++ < 3) c._walkReplan(); else this.stop(true); }   // roçou numa quina: refaz o caminho daqui
        Q.px = this.pos.x; Q.pz = this.pos.z; Q.t = 0;
      }
    }
    // altura dos olhos: piso (palco a 1 m, escada e mezanino) + 1,6 m, com subida suave
    const ty = c._walkFloor(this.pos.x, this.pos.z, this.high) + 1.6, dy = ty - this.pos.y; let rising = false;
    if (Math.abs(dy) > 0.002) { this.pos.y += dy * (1 - Math.exp(-dt * 8)); rising = true; } else this.pos.y = ty;
    const moving = walking || this.head || rising;
    // câmera
    const cp = Math.cos(this.pitch), cam = this.camera;
    cam.position.copy(this.pos);
    cam.lookAt(this.pos.x + fx * cp, this.pos.y + Math.sin(this.pitch), this.pos.z + fz * cp);
    // espelha nas flags do Orbit (governador, rótulos, ares e pool de luzes leem estas)
    o.moving = moving; o.touched = true;
    if (this.gesture || moving) o.userAt = now;
    o.target.set(this.pos.x + fx * 4, this.pos.y, this.pos.z + fz * 4); o.targetGoal.copy(o.target);
    this.head = this.gesture = false; this.moving = moving;
    return wasDirty || moving;
  }
}

// @rooms-begin
function roomTemploPalco(ctx) {
  // ---------------------------------------------------------------------------
  // PALCO DO TEMPLO — na PAREDE LATERAL LONGA x = 0 (correção do cliente; plateia olha para −x)
  // Fiel à foto templo_foto.jpg e aos vídeos v6/v8:
  //  · plataforma x 0,15–5,0 · z 19,6–36,6 · topo y 1,0 — piso claro (compensado/madeira clara), testeira preta;
  //  · escadas pretas com corrimão inox: ponta z baixo à frente da testeira (sobe para −x); ponta z alto na lateral
  //    do palco, junto à parede (sobe para −z) — pedido do cliente;
  //  · 2 caixinhas pretas no piso à frente; retornos (wedges) no palco;
  //  · bateria Pearl (pele de resposta branca) sobre praticável preto no lado z baixo (direita de quem olha o palco),
  //    teclado em suporte X no lado z alto, violão e baixo em pedestais, pedestais de microfone, pedaleiras, banco alto;
  //  · barra de fixação do telão (grampos pretos acima da moldura); 2 telas brancas de projeção no alto da parede;
  //  · treliça preta tipo escada acima do telão (segura os 4 moving heads do cartão) + 2 barras de LED + 3 pares;
  //  · line arrays (2 clusters por lado, um reto e um angulado) pendurados por correntes até barras de rigging
  //    presas sob as tesouras brancas da cobertura (z 18,5–23,5 e 33,5–38,5);
  //  · perfis pretos verticais na parede alta (fora dos módulos das tesouras).
  // Objetos do cartão NÃO recriados: telão (painel x 0,12–0,24 · z 23,85–32,35 · y 1,10–4,20), moving heads
  // (x 0,8 · y 6,05 · z 23,9/26,7/29,5/32,3, grampo até y 6,30), LEDs do som (x 4,9 · z 19,8/36,4).
  // Nada alto (> y 2,5) na faixa dos feixes (x 0,8–4,6 × z de cada cabeça ± 1 m).
  // Emissivos: telas brancas → 'telao'; pares/barras de LED → 'palco'.
  // ---------------------------------------------------------------------------
  const THREE = ctx.THREE, M = ctx.M;
  const box = (...a) => ctx.box(...a), cyl = (...a) => ctx.cyl(...a), sph = (...a) => ctx.sph(...a);
  const place = (...a) => ctx.place(...a), std = (o) => ctx.std(o);
  const put = (m) => { ctx.add(m); return m; };
  const G = () => new THREE.Group();
  const rot = (m, x = 0, y = 0, z = 0) => { m.rotation.set(x, y, z); return m; };
  const nc = { cast: false };
  const HP = Math.PI / 2;
  const up = new THREE.Vector3(0, 1, 0);
  // barra cilíndrica entre dois pontos (tubos, correntes, pedestais inclinados)
  const bar = (x1, y1, z1, x2, y2, z2, r, mat, seg = 6, parent = null) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const d = b.clone().sub(a), len = d.length();
    const m = cyl(r, r, len, mat, 0, 0, 0, seg);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    m.castShadow = r > 0.015;
    if (parent) parent.add(m); else put(m);
    return m;
  };

  // ---------------- Materiais (mesmas opções → mesmo material → funde no merge) ----------------
  const deckMat  = std({ color: 0xd9c9ab, roughness: 0.5 });                          // piso do palco: madeira clara / bege
  const deckSeam = std({ color: 0x9c8c70, roughness: 0.8 });                          // juntas das chapas
  const blk      = std({ color: 0x131315, roughness: 0.82 });                         // testeira / praticável / escadas
  const blkSeam  = std({ color: 0x0a0a0b, roughness: 1 });
  const steelBlk = std({ color: 0x1c1d20, roughness: 0.45, metalness: 0.55 });        // treliça / perfis pretos
  const inox     = std({ color: 0xc9cdd2, roughness: 0.22, metalness: 0.9 });         // corrimãos
  const matte    = std({ color: 0x1b1b1e, roughness: 0.8 });                          // caixas de som
  const grille   = std({ color: 0x2c2d31, roughness: 0.95 });
  const rigGray  = std({ color: 0x5a5c62, roughness: 0.4, metalness: 0.7 });          // ferragens
  const chain    = std({ color: 0x8d9096, roughness: 0.35, metalness: 0.8 });         // correntes / cabos de aço
  const cable    = std({ color: 0x0b0b0c, roughness: 0.8 });
  const rubber   = std({ color: 0x101011, roughness: 1 });
  const chromeK  = M.chrome;
  const cymbal   = std({ color: 0xc9a24a, roughness: 0.3, metalness: 0.85 });
  const shell    = std({ color: 0x2b2c31, roughness: 0.3, metalness: 0.5 });          // cascos cinza-grafite (Pearl Export)
  const headW    = std({ color: 0xf0ede6, roughness: 0.7 });
  const keysW    = std({ color: 0xf4f2ec, roughness: 0.5 });
  const woodGtr  = std({ color: 0xd08a3a, roughness: 0.45 });                         // violão (tampo mel/laranja, foto)
  const woodDk   = std({ color: 0x5b3a22, roughness: 0.5 });
  const natural  = std({ color: 0xc8a676, roughness: 0.45 });                         // baixo natural (foto)
  const cream    = std({ color: 0xd8cfb8, roughness: 0.7 });
  const pedalC   = [std({ color: 0xc2410c, roughness: 0.5 }), std({ color: 0x2f7d4a, roughness: 0.5 }),
                    std({ color: 0xd9b21c, roughness: 0.5 }), std({ color: 0x2f5f9b, roughness: 0.5 })];
  const redSign  = std({ color: 0xc81e1e, roughness: 0.6 });
  const whiteP   = std({ color: 0xf4f4f2, roughness: 0.7 });
  // emissivos ligados às entidades
  const screenMat = std({ color: 0xeeeeec, roughness: 0.85, emissive: 0xf2f0ff, emissiveIntensity: 0.3 });   // telas de projeção
  const lensMat   = std({ color: 0x3a3642, roughness: 0.3, emissive: 0xd8c8ff, emissiveIntensity: 1.0 });    // lente dos pares
  const ledBarMat = std({ color: 0xd8d6cc, roughness: 0.35, emissive: 0xfff4e0, emissiveIntensity: 1.0 });   // barras de LED (brancas na foto)
  const ledG      = std({ color: 0x1e5a2e, emissive: 0x3ee07a, emissiveIntensity: 0.7 });
  ctx.bindEmissive('telao', screenMat, 0.32, { min: 0 });
  ctx.bindEmissive('palco', lensMat, 1.3, { min: 0 });
  ctx.bindEmissive('palco', ledBarMat, 1.1, { min: 0 });
  ctx.bindEmissive('som', ledG, 0.7);

  // ======================= PLATAFORMA =======================
  const X0 = 0.15, X1 = 5.0, Z0 = 19.6, Z1 = 36.6, SY = 1.0, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
  const DT = 0.04;                                           // espessura do tampo (borda clara aparente na frente)
  put(box(X1 - X0, SY - DT, Z1 - Z0, blk, CX, (SY - DT) / 2, CZ));
  put(box(X1 - X0, DT, Z1 - Z0, deckMat, CX, SY - DT / 2, CZ));
  // juntas das chapas (1,22 × 2,44): ao longo de z a cada 1,22 m; ao longo de x a cada 2,44 m
  for (let z = Z0 + 1.22; z < Z1 - 0.2; z += 1.22) put(box(X1 - X0 - 0.04, 0.002, 0.006, deckSeam, CX, SY + 0.001, z, nc));
  put(box(0.006, 0.002, Z1 - Z0 - 0.04, deckSeam, X1 - 2.44, SY + 0.001, CZ, nc));
  // testeira preta: faixa de sombra sob o tampo + juntas verticais dos painéis
  put(box(0.012, 0.05, Z1 - Z0, blkSeam, X1 + 0.006, SY - DT - 0.03, CZ, nc));
  for (let z = Z0 + 2.44; z < Z1 - 0.3; z += 2.44) put(box(0.008, SY - DT - 0.08, 0.012, blkSeam, X1 + 0.004, (SY - DT - 0.08) / 2 + 0.02, z, nc));
  put(box(0.02, 0.05, Z1 - Z0 - 0.02, rubber, X1 - 0.03, 0.025, CZ, nc));    // rodapé recuado

  // ======================= ESCADAS DO PALCO + CORRIMÃO INOX =======================
  // 6 espelhos de 1/6 m, 5 pisos de 0,26 m (1,3 m de projeção), largura 1,1 m. Montada num grupo com a face do palco
  // em x local 0 e subindo para −x local: a da ponta z baixo fica à frente da testeira (sobe para −x); a da ponta
  // z alto (lado esquerdo de quem olha o palco) foi para a lateral do palco, junto à parede (pedido do cliente).
  const NR = 6, RISE = SY / NR, RUN = 0.26, SW = 1.1;
  const stair = () => {
    const g = G();
    const add = (m) => { g.add(m); return m; };
    for (let k = 1; k < NR; k++) {
      const h = k * RISE, xb = (NR - k) * RUN;
      add(box(xb, h, SW, blk, xb / 2, h / 2, 0));
      add(box(0.03, 0.012, SW, rigGray, xb - 0.015, h - 0.006, 0, nc));             // cantoneira do bocel
    }
    // corrimão inox nos dois lados (2 tubos: mão + intermediário), montantes em baixo, no meio e em cima
    for (const sd of [-1, 1]) {
      const z = sd * (SW / 2 - 0.04);
      const xb = (NR - 1) * RUN - 0.1, xt = 0.07;                                    // 1,2 → 0,07 da face do palco
      const yb = RISE, yt = (NR - 1) * RISE;                                          // degrau 1 e degrau 5
      const xm = (xb + xt) / 2, ym = RISE * Math.floor(NR - xm / RUN), yr = yb + (yt - yb) * (xb - xm) / (xb - xt);
      bar(xb, yb, z, xb, yb + 0.95, z, 0.02, inox, 10, g);
      bar(xm, ym, z, xm, yr + 0.95, z, 0.018, inox, 10, g);
      bar(xt, yt, z, xt, yt + 0.95, z, 0.02, inox, 10, g);
      bar(xb, yb + 0.95, z, xt, yt + 0.95, z, 0.021, inox, 10, g);                    // mão
      bar(xb, yb + 0.45, z, xt, yt + 0.45, z, 0.013, inox, 8, g);                     // intermediário
      // grade de barras verticais finas (como na foto)
      for (let i = 1; i < 7; i++) {
        const t = i / 7, x = xb + (xt - xb) * t, yl = yb + (yt - yb) * t;
        bar(x, yl + 0.47, z, x, yl + 0.93, z, 0.006, inox, 5, g);
      }
    }
    return g;
  };
  place(stair(), X1, Z0 + 0.6, 0);           // frente, ponta z baixo: x 5,0–6,3 · z 19,65–20,75
  place(stair(), X0 + 0.7, Z1, -HP);         // lateral z alto, junto à parede: x 0,3–1,4 · z 36,6–37,9

  // ======================= CAIXAS NO PISO À FRENTE (front fill) =======================
  const floorBox = () => {
    const g = G();
    g.add(box(0.56, 0.5, 0.46, matte, 0, 0.25, 0));
    g.add(box(0.5, 0.42, 0.012, grille, 0, 0.26, 0.232, nc));
    g.add(box(0.1, 0.012, 0.004, rigGray, 0.19, 0.06, 0.238, nc));
    return g;
  };
  place(floorBox(), 5.38, 25.3, HP);
  place(floorBox(), 5.38, 30.9, HP);

  // ======================= RETORNOS (wedges) =======================
  const wedgeGeo = (() => {
    const sh = new THREE.Shape();
    sh.moveTo(0.22, 0); sh.lineTo(-0.2, 0); sh.lineTo(-0.2, 0.1); sh.lineTo(0.1, 0.3); sh.lineTo(0.22, 0.3); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.54, bevelEnabled: false });
    geo.rotateY(HP); geo.translate(-0.27, 0, 0);
    return geo;
  })();
  const wedge = () => {
    const g = G();
    const body = new THREE.Mesh(wedgeGeo, matte); body.castShadow = true; body.receiveShadow = true; g.add(body);
    const f = box(0.46, 0.3, 0.01, grille, 0, 0.207, 0.054, nc); f.rotation.x = -0.98; g.add(f);
    return g;
  };
  // pontas (angulados para o centro) — longe dos LEDs do som (x 4,85–4,95)
  place(wedge(), 4.15, 20.75, -0.93, SY);
  place(wedge(), 4.15, 35.45, -2.21, SY);
  // retornos baixos na borda da frente (caixas pretas compridas da foto), virados para os músicos (−x)
  const lowWedge = () => {
    const g = G();
    const b = box(0.95, 0.15, 0.34, matte, 0, 0.09, 0); b.rotation.x = -0.12; g.add(b);
    const f = box(0.88, 0.1, 0.01, grille, 0, 0.1, 0.17, nc); f.rotation.x = -0.12; g.add(f);
    return g;
  };
  place(lowWedge(), 4.62, 26.0, -HP, SY);
  place(lowWedge(), 4.62, 30.0, -HP, SY);

  // ======================= BATERIA PEARL SOBRE PRATICÁVEL PRETO (lado z baixo) =======================
  const RX0 = 0.55, RX1 = 3.05, RZ0 = 22.0, RZ1 = 24.8, RH = 0.25;
  put(box(RX1 - RX0, RH, RZ1 - RZ0, blk, (RX0 + RX1) / 2, SY + RH / 2, (RZ0 + RZ1) / 2));
  put(box(0.012, 0.02, RZ1 - RZ0, blkSeam, RX1 + 0.006, SY + RH - 0.03, (RZ0 + RZ1) / 2, nc));
  // pele de resposta branca com "Pearl" e furo de porta (textura de canvas; logo da marca)
  const pearlTex = ctx.makeTex(256, (g, s) => {
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#1a1a1a'; g.font = 'italic bold 58px Georgia, "Times New Roman", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Pearl', s * 0.5, s * 0.3);
    g.beginPath(); g.arc(s * 0.68, s * 0.68, s * 0.09, 0, Math.PI * 2); g.fillStyle = '#2a2320'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#8a8580'; g.stroke();
  });
  const pearlMat = std({ color: 0xffffff, map: pearlTex, roughness: 0.6 });
  const drumKit = () => {
    const g = G();                       // local: +z = frente (plateia), x = largura
    g.add(box(1.6, 0.006, 1.5, std({ color: 0x2a2a2d, roughness: 1 }), 0, 0.003, -0.05, nc));   // tapete
    // bumbo 22" (deitado, pele de resposta para +z)
    g.add(rot(cyl(0.28, 0.28, 0.42, shell, 0, 0.29, 0.2, 22), HP));
    g.add(rot(cyl(0.285, 0.285, 0.024, chromeK, 0, 0.29, 0.405, 22), HP));
    g.add(rot(cyl(0.285, 0.285, 0.024, chromeK, 0, 0.29, -0.005, 22), HP));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.272, 28), pearlMat);
    face.position.set(0, 0.29, 0.419); face.castShadow = false; g.add(face);
    for (const sx of [-1, 1]) bar(sx * 0.2, 0.1, 0.35, sx * 0.3, 0.0, 0.45, 0.01, chromeK, 5, g);   // esporas
    // caixa, tons (sobre o bumbo), surdo
    const drum = (r, h, x, y, z, tilt = 0) => {
      const d = G(); d.position.set(x, y, z); d.rotation.x = tilt;
      d.add(cyl(r, r, h, shell, 0, 0, 0, 18)); d.add(cyl(r - 0.005, r - 0.005, 0.006, headW, 0, h / 2 + 0.003, 0, 18));
      d.add(cyl(r + 0.006, r + 0.006, 0.014, chromeK, 0, h / 2 - 0.007, 0, 18));
      g.add(d);
    };
    drum(0.18, 0.14, -0.32, 0.62, -0.1, 0.12);                        // caixa
    bar(-0.32, 0, -0.1, -0.32, 0.55, -0.1, 0.01, chromeK, 5, g);
    drum(0.13, 0.19, -0.14, 0.78, 0.12, 0.35); drum(0.15, 0.2, 0.16, 0.8, 0.12, 0.35);   // tons
    drum(0.2, 0.36, 0.46, 0.42, -0.16);                                // surdo
    for (const [x, z] of [[0.34, -0.31], [0.58, -0.31], [0.46, -0.01]]) g.add(cyl(0.008, 0.008, 0.24, chromeK, x, 0.12, z, 5));
    // chimbal
    bar(-0.64, 0, -0.14, -0.64, 0.86, -0.14, 0.012, chromeK, 6, g);
    for (let i = 0; i < 3; i++) { const a = i * 2.094; bar(-0.64, 0.25, -0.14, -0.64 + Math.cos(a) * 0.2, 0, -0.14 + Math.sin(a) * 0.2, 0.008, chromeK, 5, g); }
    g.add(cyl(0.18, 0.18, 0.008, cymbal, -0.64, 0.86, -0.14, 20)); g.add(cyl(0.18, 0.18, 0.008, cymbal, -0.64, 0.88, -0.14, 20));
    // pratos: ataque, condução, china (pedestais com tripé; topo ≤ 1,12 acima do praticável)
    for (const [x, y, z, r] of [[-0.46, 1.1, 0.25, 0.2], [0.62, 1.02, 0.12, 0.23], [0.2, 1.12, 0.32, 0.17]]) {
      const bx = x * 0.9, bz = z - 0.2;
      bar(bx, 0, bz, x, y - 0.02, z, 0.01, chromeK, 5, g);
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; bar(bx, 0.3, bz, bx + Math.cos(a) * 0.22, 0, bz + Math.sin(a) * 0.22, 0.008, chromeK, 5, g); }
      g.add(rot(cyl(r, r, 0.008, cymbal, x, y, z, 20), 0.2 * Math.sign(z), 0, -0.12 * Math.sign(x)));
    }
    // banco do baterista
    g.add(cyl(0.17, 0.17, 0.08, M.dark, 0, 0.52, -0.52, 16));
    g.add(cyl(0.02, 0.02, 0.48, chromeK, 0, 0.24, -0.52, 6));
    for (let i = 0; i < 3; i++) { const a = i * 2.094; bar(0, 0.12, -0.52, Math.cos(a) * 0.22, 0, -0.52 + Math.sin(a) * 0.22, 0.01, chromeK, 5, g); }
    return g;
  };
  place(drumKit(), 1.95, 23.45, HP, SY + RH);          // de frente para a plateia (+x)

  // ======================= INSTRUMENTOS EM PEDESTAIS =======================
  const gtrStand = (bodyMat, kind) => {
    const g = G();                       // instrumento virado para +z local
    bar(0, 0.02, -0.1, 0, 0.66, -0.06, 0.009, M.dark, 5, g);
    for (const sx of [-1, 1]) bar(sx * 0.17, 0, 0.12, 0, 0.18, 0.02, 0.009, M.dark, 5, g);
    bar(0, 0, -0.16, 0, 0.18, 0.02, 0.009, M.dark, 5, g);
    g.add(box(0.34, 0.03, 0.06, M.dark, 0, 0.16, 0.06));
    const ins = G(); ins.position.set(0, 0.14, 0.02); ins.rotation.x = -0.2;
    if (kind === 'violao') {
      const b1 = rot(cyl(0.19, 0.19, 0.1, bodyMat, 0, 0.22, 0, 22), HP); ins.add(b1);
      const b2 = rot(cyl(0.15, 0.15, 0.1, bodyMat, 0, 0.47, 0, 22), HP); ins.add(b2);
      ins.add(rot(cyl(0.045, 0.045, 0.004, M.dark, 0, 0.38, 0.051, 14), HP));
      ins.add(box(0.1, 0.012, 0.03, woodDk, 0, 0.25, 0.055, nc));
      ins.add(box(0.05, 0.5, 0.03, woodDk, 0, 0.84, 0)); ins.add(box(0.08, 0.16, 0.025, woodDk, 0, 1.16, -0.005));
    } else {
      const k = 1.1;
      ins.add(rot(cyl(0.17 * k, 0.17 * k, 0.045, bodyMat, 0, 0.24 * k, 0, 18), HP));
      ins.add(rot(cyl(0.125 * k, 0.125 * k, 0.045, bodyMat, 0.015, 0.42 * k, 0, 16), HP));
      ins.add(rot(box(0.05, 0.16, 0.045, bodyMat, -0.1 * k, 0.52 * k, 0), 0, 0, 0.35));
      ins.add(box(0.14, 0.18, 0.006, M.dark, 0.03, 0.34 * k, 0.025, nc));
      ins.add(box(0.07, 0.02, 0.012, chromeK, 0, 0.2 * k, 0.028, nc));
      ins.add(box(0.045, 0.78, 0.025, woodDk, 0, 0.55 + 0.39, 0));
      ins.add(box(0.07, 0.17, 0.02, M.dark, 0, 0.55 + 0.78 + 0.08, 0));
    }
    g.add(ins);
    return g;
  };
  place(gtrStand(natural, 'baixo'), 2.35, 25.25, HP, SY);
  place(gtrStand(woodGtr, 'violao'), 1.6, 29.55, HP, SY);

  // ======================= TECLADO EM SUPORTE X (lado z alto) + BANCO ALTO =======================
  {
    const g = G();                       // teclas ao longo de x local, músico em −z local
    for (const s of [-1, 1]) {           // X no plano do comprimento
      bar(-0.36, 0.02, s * 0.2, 0.36, 0.84, s * 0.2, 0.017, M.dark, 8, g);
      bar(0.36, 0.02, s * 0.2, -0.36, 0.84, s * 0.2, 0.017, M.dark, 8, g);
    }
    for (const x of [-0.37, 0.37]) g.add(box(0.05, 0.03, 0.46, M.dark, x, 0.015, 0));    // pés
    for (const x of [-0.36, 0.36]) g.add(box(0.05, 0.03, 0.44, M.dark, x, 0.85, 0));     // braços
    g.add(cyl(0.025, 0.025, 0.1, chromeK, 0, 0.43, 0, 10));                               // pino do X
    const kb = G(); kb.position.set(0, 0.87, 0);
    kb.add(box(1.3, 0.09, 0.32, M.dark, 0, 0.045, 0));
    kb.add(box(1.2, 0.022, 0.15, keysW, 0, 0.09, -0.07, nc));
    for (let i = 0; i < 26; i++) if ([1, 2, 4, 5, 6].includes(i % 7)) kb.add(box(0.012, 0.012, 0.09, M.dark, -0.585 + i * 0.045, 0.106, -0.045, nc));
    kb.add(box(0.3, 0.004, 0.05, M.screenOff, 0.25, 0.092, 0.09, nc));
    g.add(kb);
    // pedal de sustain + cabo
    g.add(box(0.08, 0.03, 0.2, M.dark, 0.25, 0.015, -0.45));
    place(g, 1.75, 31.4, HP, SY);                        // local +z → +x: músico (−z local) fica do lado da parede
  }
  {
    // banco alto preto (como na foto, junto à parede à esquerda do telão)
    const g = G();
    g.add(box(0.36, 0.035, 0.36, M.dark, 0, 0.76, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(rot(box(0.03, 0.78, 0.03, M.dark, sx * 0.15, 0.38, sz * 0.15), sz * 0.05, 0, -sx * 0.05));
    g.add(box(0.33, 0.02, 0.02, M.dark, 0, 0.28, 0.15)); g.add(box(0.33, 0.02, 0.02, M.dark, 0, 0.28, -0.15));
    g.add(box(0.02, 0.02, 0.33, M.dark, 0.15, 0.28, 0)); g.add(box(0.02, 0.02, 0.33, M.dark, -0.15, 0.28, 0));
    place(g, 0.7, 32.95, 0, SY);
  }

  // ======================= PEDESTAIS DE MICROFONE =======================
  const micStand = (h = 1.35, boom = 0) => {
    const g = G();
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; bar(0, 0.12, 0, Math.cos(a) * 0.26, 0.005, Math.sin(a) * 0.26, 0.008, M.dark, 5, g); }
    bar(0, 0.12, 0, 0, h, 0, 0.011, M.dark, 6, g);
    const top = boom ? [0, h + 0.18, 0.42] : [0, h, 0];
    if (boom) bar(0, h - 0.05, -0.15, 0, h + 0.18, 0.42, 0.008, M.dark, 5, g);
    g.add(rot(cyl(0.022, 0.014, 0.17, M.dark, top[0], top[1] + 0.05, top[2] + 0.02, 10), 0.5));
    g.add(sph(0.026, M.graphite, top[0], top[1] + 0.12, top[2] + 0.06));
    return g;
  };
  place(micStand(1.15, 1), 3.35, 26.2, HP, SY);          // topo ≤ y 2,5
  place(micStand(1.3), 3.55, 28.1, 0, SY);               // vocal central
  place(micStand(1.3), 3.25, 29.1, 0, SY);
  place(micStand(1.1, 1), 2.35, 32.15, -2.4, SY);        // boom do tecladista

  // ======================= PEDALEIRAS, DI, CABOS =======================
  const pedalboard = (n, w, baseMat = M.dark) => {
    const g = G();
    g.add(box(w, 0.045, 0.3, baseMat, 0, 0.0225, 0));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.08 + i * (w - 0.16) / Math.max(1, n - 1);
      g.add(box(0.075, 0.035, 0.12, pedalC[i % 4], x, 0.062, 0.02));
      g.add(sph(0.007, ledG, x, 0.082, -0.03));
    }
    return g;
  };
  place(pedalboard(4, 0.6), 3.15, 25.75, -HP, SY);
  place(pedalboard(3, 0.5), 3.35, 28.55, -HP, SY);
  {
    // multiefeito claro (caixa bege/metálica da foto) + DI
    const g = G();
    g.add(box(0.62, 0.07, 0.28, cream, 0, 0.035, 0));
    g.add(box(0.5, 0.004, 0.06, M.screenOff, 0, 0.072, -0.07, nc));
    for (let i = 0; i < 5; i++) g.add(box(0.07, 0.015, 0.07, rigGray, -0.22 + i * 0.11, 0.078, 0.06, nc));
    place(g, 3.2, 27.45, -HP, SY);
    put(box(0.12, 0.06, 0.16, rigGray, 2.9, SY + 0.03, 26.85));
  }
  const floorCable = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; bar(ax, SY + 0.008, az, bx, SY + 0.008, bz, 0.007, cable, 4); } };
  floorCable([[3.55, 28.1], [3.2, 27.7], [2.6, 27.2], [0.6, 27.0]]);
  floorCable([[3.35, 26.2], [2.9, 26.85], [2.6, 27.2]]);
  floorCable([[3.25, 29.1], [2.8, 28.7], [2.6, 27.2]]);
  floorCable([[1.75, 31.4], [1.2, 30.4], [0.6, 30.0]]);
  floorCable([[3.15, 25.75], [2.6, 25.4], [2.35, 25.25]]);

  // ======================= TELÃO: BARRA DE FIXAÇÃO + GRAMPOS (acima da moldura, sem encostar) =======================
  // painel do cartão: x 0,12–0,24 · y 1,10–4,20 · z 23,85–32,35 → barra em y 4,36 (≥ 0,1 m de folga)
  bar(0.2, 4.36, 23.7, 0.2, 4.36, 32.5, 0.025, steelBlk, 8);
  for (let i = 0; i <= 10; i++) put(box(0.07, 0.05, 0.05, steelBlk, 0.2, 4.34, 23.95 + i * 0.815, nc));
  for (const z of [24.1, 28.1, 32.1]) {
    put(box(0.12, 0.04, 0.04, steelBlk, 0.145, 4.36, z, nc));                         // mão-francesa até a parede
    put(box(0.012, 0.16, 0.12, steelBlk, 0.093, 4.36, z, nc));                        // chapa na parede
  }

  // ======================= TELAS BRANCAS DE PROJEÇÃO =======================
  // 3,2 × 2,4 m, y 3,9–6,3, na face da parede (x ≈ 0,12). A tela do lado z alto foi deslocada para z 33,7–36,9
  // para não bater no pilar da tesoura de z 33,5 (os pilares/tesouras são da decoração da plateia).
  for (const [za, zb] of [[19.9, 23.1], [33.7, 36.9]]) {
    const zc = (za + zb) / 2;
    put(box(0.03, 2.4, zb - za, screenMat, 0.115, 5.1, zc, nc));
    put(box(0.02, 2.44, 0.02, rigGray, 0.11, 5.1, za - 0.01, nc));
    put(box(0.02, 2.44, 0.02, rigGray, 0.11, 5.1, zb + 0.01, nc));
    put(box(0.02, 0.02, zb - za + 0.04, rigGray, 0.11, 6.31, zc, nc));
    put(box(0.02, 0.02, zb - za + 0.04, rigGray, 0.11, 3.89, zc, nc));
  }

  // ======================= TRELIÇA PRETA TIPO ESCADA ACIMA DO TELÃO =======================
  // z 23,1–33,1 (como na foto: termina ~0,8 m além das bordas do telão, entre as telas brancas).
  // Seção 0,30 × 0,30: banzos em x 0,65 / 0,95 · y 6,325 / 6,60 (banzo inferior encosta no grampo dos moving heads, y 6,30).
  const TZ0 = 23.1, TZ1 = 33.1, TXA = 0.65, TXB = 0.95, TYB = 6.325, TYT = 6.6, TR = 0.022;
  const HEADS = [23.9, 26.7, 29.5, 32.3];
  for (const x of [TXA, TXB]) for (const y of [TYB, TYT]) bar(x, y, TZ0, x, y, TZ1, TR, steelBlk, 8);
  // degraus (montantes verticais nas duas faces + travessas em cima), longe das cabeças (≥ 0,3 m em z)
  const nb = 25;
  for (let i = 0; i <= nb; i++) {
    const z = TZ0 + (TZ1 - TZ0) * i / nb;
    if (HEADS.some((h) => Math.abs(h - z) < 0.3)) continue;
    for (const x of [TXA, TXB]) put(box(0.025, TYT - TYB, 0.025, steelBlk, x, (TYB + TYT) / 2, z));
    put(box(TXB - TXA, 0.02, 0.02, steelBlk, (TXA + TXB) / 2, TYT, z, nc));
  }
  for (const z of [TZ0, TZ1]) put(box(TXB - TXA + 0.05, TYT - TYB + 0.05, 0.02, steelBlk, (TXA + TXB) / 2, (TYB + TYT) / 2, z));
  // travessas inferiores nos pontos de fixação dos moving heads (apoio do grampo, fundo em y 6,30)
  for (const z of HEADS) put(box(TXB - TXA + 0.04, 0.04, 0.05, steelBlk, (TXA + TXB) / 2, 6.32, z, nc));
  // mãos-francesas até a parede (x 0,087) + chapas
  for (const z of [23.3, 25.3, 28.1, 30.9, 32.9]) {
    put(box(TXA - 0.09, 0.05, 0.05, steelBlk, (TXA + 0.09) / 2, 6.46, z));
    bar(0.095, 6.05, z, TXA, 6.44, z, 0.012, steelBlk, 5);
    put(box(0.012, 0.6, 0.14, steelBlk, 0.094, 6.25, z, nc));
  }
  // cabo de alimentação ao longo do banzo superior
  bar(0.7, TYT + 0.03, TZ0 + 0.1, 0.7, TYT + 0.03, TZ1 - 0.1, 0.01, cable, 5);

  // Pares LED (3) e barras de LED (2) penduradas na treliça, entre as cabeças (foto: par·MH·barra·MH·par·MH·barra·MH·par)
  const par = () => {
    const g = G();                                   // aponta para +x e para baixo
    g.add(box(0.05, 0.08, 0.05, steelBlk, 0, 0.23, 0));                     // grampo
    for (const s of [-1, 1]) g.add(box(0.2, 0.025, 0.02, steelBlk, 0.02, 0.15, s * 0.11, nc));
    for (const s of [-1, 1]) g.add(box(0.02, 0.17, 0.02, steelBlk, 0.0, 0.07, s * 0.11, nc));
    const can = G(); can.rotation.z = 0.85;
    can.add(cyl(0.085, 0.095, 0.24, M.dark, 0, 0, 0, 16));
    const lens = cyl(0.075, 0.075, 0.012, lensMat, 0, -0.123, 0, 16); lens.castShadow = false; can.add(lens);
    g.add(can);
    return g;
  };
  for (const z of [23.35, 28.1, 32.85]) place(par(), 0.8, z, 0, 6.04);
  const ledBar = () => {
    const g = G();                                   // barra horizontal ao longo de z, face para +x (inclinada p/ baixo)
    g.add(box(0.05, 0.08, 0.05, steelBlk, 0, 0.19, 0));
    const b = G(); b.rotation.z = -0.5;
    b.add(box(0.1, 0.14, 0.62, M.dark, 0, 0, 0));
    b.add(box(0.012, 0.1, 0.56, ledBarMat, 0.056, 0, 0, nc));
    g.add(b);
    for (const s of [-1, 1]) g.add(box(0.02, 0.14, 0.02, steelBlk, 0, 0.1, s * 0.28, nc));
    return g;
  };
  for (const z of [25.3, 30.9]) place(ledBar(), 0.8, z, 0, 6.1);

  // ======================= LINE ARRAYS (2 clusters por lado, correntes até as tesouras) =======================
  // Barras de rigging pretas em x 1,6, y 7,5, presas sob o banzo inferior (y 7,6) das tesouras de z 18,5–23,5 e 33,5–38,5.
  const RIGY = 7.5;
  for (const [za, zb] of [[18.4, 23.6], [33.4, 38.6]]) {
    put(box(0.08, 0.08, zb - za, steelBlk, 1.6, RIGY, (za + zb) / 2));
    for (const z of [za + 0.1, zb - 0.1]) put(box(0.14, 0.03, 0.14, rigGray, 1.6, RIGY + 0.055, z, nc));   // grampos na tesoura
  }
  const lineArray = () => {
    const g = G();                                   // face para +z local; topo do bumper em y 0
    g.add(box(0.82, 0.06, 0.6, steelBlk, 0, -0.03, -0.04));
    for (const sx of [-1, 1]) g.add(box(0.03, 0.1, 0.6, steelBlk, sx * 0.4, 0.02, -0.04));
    const angs = [0, 2, 4.5, 8].map((a) => a * Math.PI / 180);
    let py = -0.06, pz = 0;
    for (let i = 0; i < angs.length; i++) {
      const a = angs[i], hh = 0.25;
      const dy = -Math.cos(a) * hh / 2, dz = -Math.sin(a) * hh / 2;
      const cy = py + dy, cz = pz + dz;
      const cab = G(); cab.position.set(0, cy, cz); cab.rotation.x = a;
      cab.add(box(0.74, 0.235, 0.48, matte, 0, 0, -0.03));
      cab.add(box(0.7, 0.19, 0.012, grille, 0, 0, 0.216, nc));
      for (const sx of [-1, 1]) cab.add(box(0.02, 0.235, 0.46, rigGray, sx * 0.38, 0, -0.03, nc));
      g.add(cab);
      py = cy + dy; pz = cz + dz;
    }
    return g;
  };
  // [z, ry] — ry = π/2 → de frente para a plateia; os internos angulados para fora (como na foto)
  const arrays = [[20.45, HP], [22.3, 2.3], [34.0, 0.84], [36.15, HP]];
  const LAY = 6.12;
  for (const [z, ry] of arrays) {
    place(lineArray(), 1.6, z, ry, LAY);
    // correntes do bumper até a barra de rigging (duas por cluster)
    const s = Math.sin(ry), c = Math.cos(ry);
    for (const k of [-0.3, 0.3]) {
      const x = 1.6 + k * c, zz = z - k * s;
      bar(x, LAY, zz, 1.6, RIGY - 0.04, zz, 0.009, chain, 5);
      put(box(0.04, 0.05, 0.02, chain, x, LAY + 0.03, zz, nc));
    }
  }

  // ======================= PERFIS PRETOS NA PAREDE ALTA =======================
  // Montantes metálicos marcando os módulos da parede (fora das linhas das tesouras 13,5/18,5/23,5/…, que são da plateia).
  for (const z of [16.0, 41.0]) {
    put(box(0.06, 8.4, 0.12, steelBlk, 0.118, 4.2, z));
    put(box(0.02, 8.4, 0.05, blkSeam, 0.155, 4.2, z, nc));
  }

  // ======================= SINALIZAÇÃO (placa do extintor, como na foto) =======================
  put(box(0.01, 0.3, 0.2, redSign, 0.093, SY + 0.95, 34.6, nc));
  put(box(0.004, 0.12, 0.05, whiteP, 0.1, SY + 0.97, 34.6, nc));
  put(box(0.004, 0.03, 0.14, whiteP, 0.1, SY + 0.86, 34.6, nc));

  // ======================= DETALHES DE REALISMO (v1.5.1) =======================
  // Púlpito de acrílico com a marca, Bíblia e garrafa d'água (frente do palco, z 28,1 — fora dos feixes dos moving heads,
  // z 26,7 ± 1 e 29,5 ± 1), fitas de marcação no piso e a folha do repertório ao pé do microfone vocal.
  {
    const acryl = std({ color: 0xe6eef2, roughness: 0.08, transparent: true, opacity: 0.35 });   // (mesmas opções do vidro da ala → mesmo material)
    const PX = 4.35, PZ = 28.1;
    put(box(0.4, 0.02, 0.5, acryl, PX, SY + 0.01, PZ, nc));                                  // base
    put(box(0.02, 1.12, 0.6, acryl, PX + 0.2, SY + 0.58, PZ, nc));                            // painel frontal (voltado para a plateia, +x)
    put(box(0.36, 1.05, 0.02, acryl, PX, SY + 0.545, PZ, nc));                                // alma central
    const top = box(0.44, 0.02, 0.6, acryl, PX - 0.02, SY + 1.16, PZ, nc); top.rotation.z = 0.22; put(top);   // tampo inclinado para quem fala
    const lg = ctx.logo.mesh(0.28, 0, { layout: 'mark', color: '#f4f5f7', roughness: 0.4, cast: false }); lg.rotation.y = HP; lg.position.set(PX + 0.215, SY + 0.66, PZ); put(lg);
    // Bíblia aberta sobre o tampo (capa preta, miolo claro) e garrafa d'água
    const bib = G(); bib.add(box(0.26, 0.012, 0.19, blk, 0, 0.006, 0)); bib.add(box(0.245, 0.022, 0.175, whiteP, 0, 0.023, 0)); bib.add(box(0.004, 0.026, 0.19, blk, 0, 0.022, 0));
    bib.rotation.z = 0.22; bib.position.set(PX - 0.05, SY + 1.176, PZ + 0.02); put(bib);
    put(cyl(0.03, 0.028, 0.2, acryl, PX + 0.08, SY + 1.29, PZ - 0.22, 10)); put(cyl(0.016, 0.016, 0.02, blk, PX + 0.08, SY + 1.4, PZ - 0.22, 10));
    // fitas de marcação (X brancos) nas posições dos músicos, rente ao piso do palco
    for (const [x, z] of [[3.9, 22.4], [3.9, 33.9], [2.1, 27.0]]) for (const a of [0.785, -0.785]) { const t = box(0.24, 0.005, 0.04, whiteP, x, SY + 0.0045, z, nc); t.rotation.y = a; put(t); }
    // repertório (folha A4) no piso, ao pé do pedestal do vocal (3,55; 28,1)
    { const s = box(0.21, 0.004, 0.297, whiteP, 3.35, SY + 0.004, 28.5, nc); s.rotation.y = 0.2; put(s); }
  }
}

function roomTemploPlateia(ctx) {
  // ---------------------------------------------------------------------------
  // TEMPLO — PLATEIA + COBERTURA APARENTE (x 0–16,05 · z 12,4–44,0), fiel às fotos/vídeos v6–v8.
  // CORREÇÃO DO CLIENTE: o palco fica na parede lateral longa x = 0 (x 0,15–5,0 · z 19,6–36,6);
  // a plateia olha para −x e a mídia (visor na parede x = 16,05) fica de frente para o palco.
  // Visual real: paredes pretas e porcelanato cinza polido (o cartão cria). As tesouras metálicas BRANCAS
  // das fotos foram retiradas a pedido do cliente (a vista de cima fica limpa; as luminárias ficam suspensas).
  // · Cadeiras pretas estofadas de encosto alto (estrutura de aço preto), 414 lugares em 4 blocos:
  //   2 centrais retos de 12 × 10 (corredor central de 1,76 m em z ≈ 28,1, alinhado com o centro do palco)
  //   e 2 das pontas levemente angulados (≈ 8,6°) para o centro; corredores laterais que recebem as
  //   escadas do palco (frente, z ≈ 19,3–20,9; a da ponta z alto fica na lateral do palco), corredores junto às paredes z = 12,4 / 44 e passagem
  //   de ~1,25 m ao longo da parede x = 16,05 (porta preta de correr, visor da mídia), como em v7/v8.
  //   (≈ 500 não cabem com essas passagens: 8,5 m de fundo × 10 fileiras de 0,85 m.)
  // · Cobertura: SEM as tesouras/terças brancas e sem hastes/correntes (pedido do cliente): os high-bays do
  //   cartão (y 7,2) e a 2ª treliça de luz (preta) sobre a plateia ficam suspensos no lugar; ficam os
  //   pilares/perfis pretos na parede do palco (módulos z 13,5 / 18,5 / 23,5 / 28,5 / 33,5 / 38,5 / 43,3), vigas
  //   e o cordão de lampadinhas quentes nos beirais. No modo Fachada a cobertura interna some.
  // · Paredes: perfis pretos, extintores vermelhos com placa, placas de SAÍDA verdes (acesas),
  //   placa vermelha "SAÍDA DE EMERGÊNCIA" sobre a porta preta de correr (cartão) e folhas pretas de
  //   correr (abertas) na saída de vidro da parede z = 12,4.
  // Sem luzes reais e sem InstancedMesh: as peças repetidas são fundidas aqui mesmo, uma malha por
  // material (as cadeiras viram 2 malhas). Nada do cartão é recriado nem coberto.
  // ---------------------------------------------------------------------------
  const THREE = ctx.THREE, M = ctx.M;
  const std = (o) => ctx.std(o);

  // ---- materiais (mesmas opções → mesmo material → menos draw calls) ----
  const chairFrame = std({ color: 0x121214, roughness: 0.42, metalness: 0.55 });   // aço preto das cadeiras
  const uphol      = std({ color: 0x1f2023, roughness: 0.96 });                     // tecido preto estofado
  const steelBlk   = std({ color: 0x0d0d0f, roughness: 0.38, metalness: 0.55 });   // pilares, vigas, perfis, treliça de luz
  const redExt     = std({ color: 0xc4201b, roughness: 0.3, metalness: 0.1 });
  const blackPl    = std({ color: 0x1a1a1c, roughness: 0.55 });                     // válvula/mangueira, carcaças
  // lampadinhas quentes do beiral (acendem com a plateia; ficam num mínimo aceso como nos vídeos)
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb45a, emissiveIntensity: 0, roughness: 0.4 });
  ctx.bindEmissive('plateia', bulbMat, 2.4, { min: 0.3 });
  // lentes dos moving heads da treliça da plateia (acendem com o palco)
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x10141c, emissive: 0xfff0e0, emissiveIntensity: 0, roughness: 0.1, metalness: 0.3 });
  ctx.bindEmissive('palco', lensMat, 1.6, { min: 0.0 });

  // ---- placas (texturas de canvas, uma por tipo) ----
  // desenha num canvas quadrado que será esticado num plano w × h: escala o eixo y para não distorcer
  const signTex = (w, h, draw) => ctx.makeTex(256, (g, S) => { g.save(); g.scale(1, w / h); draw(g, S, S * h / w); g.restore(); });
  const texExit = signTex(0.4, 0.15, (g, W, H) => {                    // SAÍDA verde com homem correndo e seta
    g.fillStyle = '#0c8a3e'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e9fff1'; g.lineWidth = 2; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = '#ffffff'; g.font = `bold ${Math.round(H * 0.5)}px Arial, Helvetica, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SAÍDA', W * 0.58, H * 0.54);
    const cx = W * 0.14, cy = H * 0.5, k = H / 60;                     // pictograma (cabeça + corpo em traços)
    g.beginPath(); g.arc(cx + 4 * k, cy - 17 * k, 5 * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 5 * k; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + 2 * k, cy - 9 * k); g.lineTo(cx - 3 * k, cy + 6 * k); g.lineTo(cx + 7 * k, cy + 19 * k);
    g.moveTo(cx - 3 * k, cy + 6 * k); g.lineTo(cx - 12 * k, cy + 18 * k);
    g.moveTo(cx - 10 * k, cy - 3 * k); g.lineTo(cx + 1 * k, cy - 7 * k); g.lineTo(cx + 10 * k, cy + 1 * k); g.stroke();
    g.beginPath(); g.moveTo(W * 0.86, cy - 9 * k); g.lineTo(W * 0.95, cy); g.lineTo(W * 0.86, cy + 9 * k); g.closePath(); g.fill();
    g.fillRect(W * 0.8, cy - 3 * k, W * 0.07, 6 * k);
  });
  const texExt = signTex(0.2, 0.28, (g, W, H) => {                     // placa do extintor (vermelha, pictograma branco)
    g.fillStyle = '#c8201c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; const k = W / 100;
    g.fillRect(40 * k, 34 * k, 22 * k, 62 * k);                         // cilindro
    g.beginPath(); g.arc(51 * k, 34 * k, 11 * k, Math.PI, 0); g.fill();
    g.fillRect(46 * k, 16 * k, 10 * k, 9 * k); g.fillRect(40 * k, 12 * k, 26 * k, 5 * k);   // válvula + gatilho
    g.lineWidth = 4 * k; g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(58 * k, 18 * k); g.quadraticCurveTo(80 * k, 22 * k, 74 * k, 60 * k); g.stroke();
    g.beginPath(); g.moveTo(20 * k, 104 * k); g.quadraticCurveTo(12 * k, 88 * k, 22 * k, 74 * k); g.quadraticCurveTo(24 * k, 86 * k, 30 * k, 88 * k);
    g.quadraticCurveTo(28 * k, 76 * k, 34 * k, 68 * k); g.quadraticCurveTo(36 * k, 96 * k, 34 * k, 104 * k); g.closePath(); g.fill();   // chama
    g.font = `bold ${Math.round(13 * k)}px Arial, Helvetica, sans-serif`; g.textAlign = 'center'; g.fillText('EXTINTOR', 50 * k, 124 * k);
  });
  const signMat = (tex, glow) => new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.5,
    emissive: glow ? 0xffffff : 0x000000, emissiveMap: glow ? tex : null, emissiveIntensity: glow ? 0.55 : 0 });
  const exitMat = signMat(texExit, true), extSignMat = signMat(texExt, false);

  // ---- fusão local: peças repetidas viram UMA malha por material ----
  const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  const batches = [];
  const batch = (mat, cast = true, parent = null) => { const b = { mat, cast, parent, items: [] }; batches.push(b); return b; };
  const geoCache = new Map();
  const boxGeo = (w, h, d) => { const k = `b${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)}`; let g = geoCache.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); } return g; };
  const cylGeo = (r, h, seg = 8) => { const k = `c${r.toFixed(4)},${h.toFixed(4)},${seg}`; let g = geoCache.get(k); if (!g) { g = new THREE.CylinderGeometry(r, r, h, seg); geoCache.set(k, g); } return g; };
  const sphGeo = (r) => { const k = `s${r}`; let g = geoCache.get(k); if (!g) { g = new THREE.SphereGeometry(r, 8, 6); geoCache.set(k, g); } return g; };
  const planeGeo = (w, h) => { const k = `p${w},${h}`; let g = geoCache.get(k); if (!g) { g = new THREE.PlaneGeometry(w, h); geoCache.set(k, g); } return g; };
  const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), ONE);
  const put = (b, geo, m, P) => { if (P) m.premultiply(P); b.items.push([geo, m]); };
  const bx = (b, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, P = null) => put(b, boxGeo(w, h, d), mat4(x, y, z, rx, ry, rz), P);
  const cy = (b, r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 8, P = null) => put(b, cylGeo(r, h, seg), mat4(x, y, z, rx, ry, rz), P);
  const pl = (b, w, h, x, y, z, ry) => put(b, planeGeo(w, h), mat4(x, y, z, 0, ry, 0));
  // barra entre dois pontos (quadrada, ou redonda com round = true)
  const bar = (b, a, c, t, round = false, P = null) => {
    const va = new THREE.Vector3(a[0], a[1], a[2]), vc = new THREE.Vector3(c[0], c[1], c[2]);
    const d = vc.clone().sub(va), L = d.length();
    const m = new THREE.Matrix4().compose(va.clone().add(vc).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), ONE);
    put(b, round ? cylGeo(t, L, 6) : boxGeo(t, L, t), m, P);
  };
  const flush = () => {
    const n3 = new THREE.Matrix3();
    for (const b of batches) {
      if (!b.items.length) continue;
      let total = 0;
      for (const [g] of b.items) total += g.index ? g.index.count : g.attributes.position.count;
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
      let off = 0;
      for (const [g, m] of b.items) {
        n3.getNormalMatrix(m);
        const e = m.elements, q = n3.elements, P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array, idx = g.index;
        const n = idx ? idx.count : P.length / 3;
        for (let k = 0; k < n; k++) {
          const i = idx ? idx.getX(k) : k, j = (off + k) * 3;
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
          pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const a = N[i * 3], bb = N[i * 3 + 1], c = N[i * 3 + 2];
          let nx = q[0] * a + q[3] * bb + q[6] * c, ny = q[1] * a + q[4] * bb + q[7] * c, nz = q[2] * a + q[5] * bb + q[8] * c;
          const l = Math.hypot(nx, ny, nz) || 1; nor[j] = nx / l; nor[j + 1] = ny / l; nor[j + 2] = nz / l;
          uv[(off + k) * 2] = U[i * 2]; uv[(off + k) * 2 + 1] = U[i * 2 + 1];
        }
        off += n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = true;
      if (b.parent) { mesh.matrixAutoUpdate = false; mesh.updateMatrix(); b.parent.add(mesh); } else ctx.add(mesh);
    }
    for (const g of geoCache.values()) g.dispose();
  };

  // Faces internas das paredes do templo (revestimento preto do cartão a 0,087 m do eixo)
  const FX0 = 0.087, FX1 = 16.05 - 0.087, FZ0 = 12.4 + 0.087, FZ1 = 44.0 - 0.087;

  // =====================================================================================
  // 1) CADEIRAS — pretas, estofadas, encosto alto, estrutura de aço preto (v6/v8, foto do templo)
  //    Local: assento centrado na origem, virada para −x (para o palco). 8 peças por cadeira.
  // =====================================================================================
  const bSeat = batch(uphol), bFrame = batch(chairFrame);
  const chair = (x, z, yaw) => {
    const P = mat4(x, 0, z, 0, yaw, 0);
    bx(bSeat, 0.46, 0.085, 0.47, -0.01, 0.465, 0, 0, 0, 0, P);                 // assento
    bx(bSeat, 0.062, 0.6, 0.47, 0.262, 0.865, 0, 0, 0, -0.12, P);               // encosto alto, levemente reclinado
    for (const s of [-1, 1]) {
      bx(bFrame, 0.022, 0.43, 0.022, -0.19, 0.215, s * 0.215, 0, 0, 0, P);     // pé dianteiro
      bx(bFrame, 0.022, 0.47, 0.022, 0.235, 0.235, s * 0.215, 0, 0, 0.09, P);  // pé traseiro (abre para trás)
      bx(bFrame, 0.42, 0.018, 0.018, 0.02, 0.11, s * 0.215, 0, 0, 0, P);        // travessa lateral
    }
    bx(bFrame, 0.02, 0.02, 0.43, -0.19, 0.12, 0, 0, 0, 0, P);                  // travessa dianteira
  };
  // Footprint local da cadeira: x −0,23…+0,35 (encosto), z ±0,245
  const FOOT = [[-0.23, -0.245], [-0.23, 0.245], [0.35, -0.245], [0.35, 0.245]];
  const fits = (x, z, yaw, zMin, zMax) => FOOT.every(([u, v]) => {
    const wx = x + u * Math.cos(yaw) + v * Math.sin(yaw), wz = z - u * Math.sin(yaw) + v * Math.cos(yaw);
    return wx >= 5.75 && wx <= 14.72 && wz >= zMin && wz <= zMax;
  });
  const RP = 0.85, SP = 0.53, ROWS = 10, X0 = 6.62;    // passo entre fileiras, entre cadeiras, nº de fileiras, 1ª fileira
  let seats = 0;
  // Blocos centrais (retos): 12 cadeiras × 10 fileiras cada, corredor central de 1,76 m (z 27,22–28,98);
  // os corredores laterais (z ≈ 19,3–20,9 e 35,3–36,9) recebem as escadas das pontas do palco
  for (const zc of [21.145, 29.225]) {
    for (let r = 0; r < ROWS; r++) for (let s = 0; s < 12; s++) { chair(X0 + r * RP, zc + s * SP, 0); seats++; }
  }
  // Blocos das pontas: levemente angulados para o centro (≈ 8,6°), fileiras recortadas pelos corredores
  // laterais (parede z = 12,4 com a porta de vidro; parede z = 44 com o acesso do hall)
  const AN = 0.15;
  for (const [sg, px, pz, zMin, zMax] of [[1, 6.5, 19.0, 13.72, 19.3], [-1, 6.5, 37.2, 36.9, 42.55]]) {
    const a = AN * sg, ca = Math.cos(a), sa = Math.sin(a);
    for (let r = 0; r < ROWS + 1; r++) for (let s = 0; s < 13; s++) {
      const x = px + r * RP * ca - s * SP * sa * sg, z = pz - r * RP * sa - s * SP * ca * sg;
      if (fits(x, z, a, zMin, zMax)) { chair(x, z, a); seats++; }
    }
  }

  // =====================================================================================
  // 2) COBERTURA APARENTE — grupo à parte que some no modo Fachada (o telhado de lá é mais baixo)
  // =====================================================================================
  const cover = new THREE.Group(); cover.name = 'templo-cobertura'; cover.userData.keep = true;
  let coverOn = true;
  Object.defineProperty(cover, 'visible', { configurable: true, get: () => coverOn && !(ctx.ext && ctx.ext.visible), set: (v) => { coverOn = !!v; } });
  ctx.add(cover);
  const bBlk = batch(steelBlk, true, cover), bBulb = batch(bulbMat, false, cover);
  const bLens = batch(lensMat, false, cover), bCable = batch(blackPl, false, cover);

  // Estrutura: as tesouras brancas e os pilares/vigas da lateral x = 16,05 saíram; ficam os perfis da parede do palco

  // Pilares/perfis pretos na parede do palco (x = 0, 8,5 m). Nos trechos do telão e das telas brancas
  // só há tocos acima da viga (y ≥ 6,95); ao lado do telão os perfis nascem no piso do palco (y 1,0).
  const PC = FX0 + 0.08;
  for (const [z, y0, y1] of [[13.5, 0, 8.6], [18.5, 0, 8.6], [23.55, 1.0, 8.6], [28.5, 6.95, 8.6], [32.65, 1.0, 6.8],
    [33.5, 6.95, 8.6], [38.5, 0, 8.6], [43.3, 0, 8.6]]) bx(bBlk, 0.16, y1 - y0, 0.24, FX0 + 0.08, (y0 + y1) / 2, z);
  bx(bBlk, 0.12, 0.15, FZ1 - FZ0 - 0.02, FX0 + 0.06, 6.875, (FZ0 + FZ1) / 2);   // viga horizontal preta (~7 m)
  bx(bBlk, 0.2, 0.12, FZ1 - FZ0, 0.1, 8.56, (FZ0 + FZ1) / 2);                    // frechal no topo da parede alta
  // Lateral x = 16,05: os pilares pretos acima da parede de 3 m e as 2 vigas saíram (pedido do cliente); o cordão de
  // lampadinhas desse lado fica suspenso no mesmo lugar

  // Cordão de lampadinhas quentes nos dois beirais (v6/v8). O do lado x = 15,86 (solto, sem parede alta) some na Vista de cima:
  // inclinada para o palco, ela o projetava como um risco no meio dos bancos (v1.8)
  const side = new THREE.Group(); side.userData.keep = true; cover.add(side);
  Object.defineProperty(side, 'visible', { configurable: true, get: () => !(ctx.top && ctx.top()), set: () => {} });
  const sCable = batch(blackPl, false, side), sBulb = batch(bulbMat, false, side);
  for (const [x, y, bc, bb] of [[0.26, 8.3, bCable, bBulb], [15.86, 8.3, sCable, sBulb]]) {
    bx(bc, 0.012, 0.012, FZ1 - FZ0 - 0.3, x, y + 0.05, (FZ0 + FZ1) / 2);
    for (let z = FZ0 + 0.3; z <= FZ1 - 0.25; z += 0.62) put(bb, sphGeo(0.036), mat4(x, y, z));
  }

  // 2ª treliça de luz (preta, box truss 0,3 × 0,3) sobre a plateia, paralela ao palco, suspensa (sem correntes)
  const LX = 5.55, LY0 = 6.72, LY1 = 7.0, LZ0 = 19.9, LZ1 = 36.3, LH = 0.14;
  for (const dx of [-LH, LH]) for (const y of [LY0, LY1]) bar(bBlk, [LX + dx, y, LZ0], [LX + dx, y, LZ1], 0.024, true);
  const NL = Math.round((LZ1 - LZ0) / 0.5), dzl = (LZ1 - LZ0) / NL;
  for (let i = 0; i < NL; i++) {
    const za = LZ0 + i * dzl, zb = za + dzl, f = i % 2;
    bar(bBlk, [LX - LH, f ? LY0 : LY1, za], [LX - LH, f ? LY1 : LY0, zb], 0.016);   // face do palco
    bar(bBlk, [LX + LH, f ? LY0 : LY1, za], [LX + LH, f ? LY1 : LY0, zb], 0.016);   // face da plateia
    bar(bBlk, [f ? LX - LH : LX + LH, LY0, za], [f ? LX + LH : LX - LH, LY0, zb], 0.016);
    bar(bBlk, [f ? LX - LH : LX + LH, LY1, za], [f ? LX + LH : LX - LH, LY1, zb], 0.016);
  }
  for (const z of [LZ0, LZ1]) { bar(bBlk, [LX - LH, LY0, z], [LX + LH, LY0, z], 0.02); bar(bBlk, [LX - LH, LY1, z], [LX + LH, LY1, z], 0.02); bar(bBlk, [LX - LH, LY0, z], [LX - LH, LY1, z], 0.02); bar(bBlk, [LX + LH, LY0, z], [LX + LH, LY1, z], 0.02); }
  // moving heads e pares pendurados, mirando o palco (−x) e para baixo
  const tilt = 0.75;   // inclinação do eixo do refletor (rad a partir da vertical para −x)
  for (const z of [21.2, 24.4, 27.1, 29.1, 31.8, 35.0]) {
    bx(bBlk, 0.1, 0.06, 0.1, LX, LY0 - 0.05, z);                       // grampo
    bx(bBlk, 0.3, 0.13, 0.26, LX, LY0 - 0.15, z);                      // base
    for (const s of [-1, 1]) bx(bBlk, 0.05, 0.28, 0.04, LX, LY0 - 0.34, z + s * 0.15);   // garfo
    const hx = LX, hy = LY0 - 0.42;
    cy(bBlk, 0.12, 0.3, hx, hy, z, 0, 0, -tilt, 12);                   // cabeça
    const lx = hx - Math.sin(tilt) * 0.155, ly = hy - Math.cos(tilt) * 0.155;
    cy(bLens, 0.09, 0.012, lx, ly, z, 0, 0, -tilt, 16);                // lente
  }
  for (const z of [22.8, 25.8, 30.4, 33.4]) {
    bx(bBlk, 0.05, 0.14, 0.04, LX - LH, LY0 - 0.09, z);
    cy(bBlk, 0.085, 0.26, LX - LH, LY0 - 0.26, z, 0, 0, -0.6, 10);    // par LED
    cy(bLens, 0.07, 0.01, LX - LH - Math.sin(0.6) * 0.13, LY0 - 0.26 - Math.cos(0.6) * 0.13, z, 0, 0, -0.6, 12);
  }

  // =====================================================================================
  // 3) PAREDES — extintores com placa, placas de saída
  // =====================================================================================
  const bRed = batch(redExt), bPl = batch(blackPl);
  const bExit = batch(exitMat, false), bExtSign = batch(extSignMat, false);
  // parede: 'x0' (face x = 0,087, olha +x), 'x1' (face 15,963, olha −x), 'z0' (face 12,487, olha +z), 'z1' (face 43,913, olha −z)
  const WALL = { x0: [1, 0, Math.PI / 2], x1: [-1, 0, -Math.PI / 2], z0: [0, 1, 0], z1: [0, -1, Math.PI] };
  const onWall = (w, t, off) => (w === 'x0' ? [FX0 + off, t] : w === 'x1' ? [FX1 - off, t] : w === 'z0' ? [t, FZ0 + off] : [t, FZ1 - off]);
  const extintor = (w, t) => {
    const [nx, nz, ry] = WALL[w];
    const [cx, cz] = onWall(w, t, 0.1), [px, pz] = onWall(w, t, 0.01), [sx, sz] = onWall(w, t, 0.004);
    bx(bPl, 0.12, 0.14, 0.02, px, 1.28, pz, 0, ry, 0);                 // suporte na parede
    cy(bRed, 0.085, 0.5, cx, 1.05, cz, 0, 0, 0, 14);                    // cilindro (topo 1,30)
    cy(bRed, 0.06, 0.04, cx, 1.32, cz, 0, 0, 0, 10);
    cy(bPl, 0.028, 0.08, cx, 1.38, cz, 0, 0, 0, 8);                     // válvula
    bx(bPl, 0.14, 0.02, 0.03, cx, 1.43, cz, 0, ry, 0);                  // gatilho
    bar(bPl, [cx + nz * 0.07, 1.37, cz + nx * 0.07], [cx + nz * 0.1 + nx * 0.05, 0.95, cz + nx * 0.1 + nz * 0.05], 0.012, true);   // mangueira
    pl(bExtSign, 0.2, 0.28, sx, 1.85, sz, ry);                          // placa acima (v6_12, v7_01)
  };
  // parede x = 16,05 (fora do vidro z 19,2–22,6, visor 23,6–28,4, janela 29,9–31,9, sem portas desde a v1.4.5)
  extintor('x1', 17.3); extintor('x1', 29.3); extintor('x1', 36.7);
  // parede do hall (z = 44): dos dois lados do acesso de vidro x 10,6–13,1 (pilar em x 10,5)
  extintor('z1', 9.8); extintor('z1', 13.75);
  // parede z = 12,4 e parede do palco, fora do palco e das escadas
  extintor('z0', 9.8); extintor('z0', 4.6);
  extintor('x0', 16.6); extintor('x0', 42.0);   // (o de z 15,0 foi para 16,6: ali entrou a saída preta)

  // Placas de SAÍDA verdes (acesas) sobre as saídas (a porta preta de correr da parede x = 16,05 saiu na v1.4.5)
  { const [x, z] = onWall('z1', 11.85, 0.006); pl(bExit, 0.4, 0.15, x, 2.62, z, WALL.z1[2]); }
  { const [x, z] = onWall('x0', 14.6, 0.006); pl(bExit, 0.4, 0.15, x, 2.62, z, WALL.x0[2]); }   // saída preta de 2 folhas (z 13,8–15,4)

  // Parede z = 12,4: a saída de vidro (x 12,9–15,1) não existe na obra — parede preta lisa, sem placa de SAÍDA (v1.4.8);
  // as folhas pretas de correr que ficavam ao lado já tinham saído na v1.4.6

  // =====================================================================================
  // 4) DETALHES DE REALISMO (v1.5.1) — blocos autônomos de emergência nas saídas, suportes dos controles
  //    dos ares na parede x = 16,05, quadro de comando das luzes e gazofilácio (caixa de ofertas) no fundo, junto ao hall.
  // =====================================================================================
  const bWht = batch(std({ color: 0xf1efea, roughness: 0.5 })), bGray = batch(std({ color: 0xb8bcc0, roughness: 0.5, metalness: 0.3 }));
  const bOak = batch(std({ color: 0xcfa97c, roughness: 0.7 }));
  const bloco = (w, t, y) => {
    const [nx, nz, ry] = WALL[w];
    const [cx, cz] = onWall(w, t, 0.05), [hx, hz] = onWall(w, t, 0.11);
    bx(bWht, 0.3, 0.1, 0.09, cx, y, cz, 0, ry, 0);
    for (const k of [-0.09, 0.09]) bx(bPl, 0.06, 0.05, 0.03, hx + nz * k, y - 0.02, hz + nx * k, 0, ry, 0);
  };
  bloco('x0', 15.95, 2.45);     // ao lado da saída preta de 2 folhas (z 13,8–15,4)
  bloco('z1', 13.4, 2.5);       // ao lado das portas de vidro do hall
  // suportes de controle remoto dos ares da parede x = 16,05 (ao lado de cada unidade, y 1,45)
  for (const z of [16.3, 32.35, 42.5]) {
    const [nx, nz, ry] = WALL.x1;
    const [ax, az] = onWall('x1', z, 0.015), [bxx, bz] = onWall('x1', z, 0.037), [cx, cz] = onWall('x1', z, 0.046);
    bx(bWht, 0.06, 0.16, 0.03, ax, 1.45, az, 0, ry, 0); bx(bWht, 0.045, 0.15, 0.014, bxx, 1.47, bz, 0, ry, 0); bx(bPl, 0.03, 0.06, 0.004, cx, 1.525, cz, 0, ry, 0);
  }
  // quadro de comando (luzes/som) cinza na parede do hall, entre a placa do extintor (x 13,75) e o canto
  { const [x, z] = onWall('z1', 14.6, 0.05), [hx, hz] = onWall('z1', 14.75, 0.105);
    bx(bGray, 0.4, 0.6, 0.1, x, 1.5, z, 0, WALL.z1[2], 0); bx(bPl, 0.03, 0.08, 0.01, hx, 1.5, hz, 0, WALL.z1[2], 0); }
  // gazofilácio: coluna preta com tampo de madeira clara e fenda, no canto x 15,3 · z 43,55 (fora da passagem de 1,25 m)
  bx(bPl, 0.35, 1.05, 0.35, 15.3, 0.525, 43.55); bx(bOak, 0.4, 0.05, 0.4, 15.3, 1.075, 43.55); bx(bPl, 0.16, 0.012, 0.03, 15.3, 1.105, 43.55);
  bx(bWht, 0.16, 0.05, 0.004, 15.3, 0.7, 43.373);

  flush();
}

function roomHall(ctx) {
  // ---------------------------------------------------------------------------
  // HALL DE ENTRADA (x 4,0–16,05 · z 44,0–49,65, mais o canto x 0–4,0 · z 46,3–49,65 —
  // v1.8: a Sala da Família foi incorporada ao Hall) + WC (x 0–1,9) e WC PCD (x 1,9–4,0) · z 44,0–46,3.
  // Paleta da fachada: preto, ripado de madeira clara, branco e grafite, com
  // acentos âmbar/terracota. Acabamentos reais (fotos/vídeos do cliente):
  // parede de destaque em marmorato (x = 4,0, do lado do hall),
  // WCs no padrão dos banheiros (v3): porcelanato cinza até 1,2 m + mármore
  // "marrom imperador" na parede da bancada / marmorato nas outras, bancada branca
  // com cuba de apoio, torneira de parede, espelho com moldura de LED e lixeira
  // inox de pedal; faixa azul-marinho no acesso aos banheiros.
  // Livres: rota porta principal → portas de vidro do templo (x 10,3–13,6),
  // portas em x = 4,0 e a porta do WC (z = 46,3). (A porta do WC Feminino voltou para o hall dos banheiros na v1.5.1.)
  // Escada em U (x 13,62–15,94 · z 44,2–49,55): lance 1 maciço subindo para +z, patamar intermediário (y 1,5) junto à fachada,
  // lance 2 de degraus soltos voltando para −z e patamar/mezanino em y 3,0 sobre a passagem dos banheiros (v1.5.4: voltou ao lugar
  // original, a pedido do cliente; a escada reta da fachada saiu). O MEZANINO ("salinha", piso em y = 3,05) sobre o WC / WC PCD /
  // canto do hall continua (laje, guarda-corpo de vidro fechado do lado do hall, janela para a fachada, poltronas, mesinha com
  // abajur, tapete e plantas) — sem escada até ele: chega-se pelo "Ir para…". Peças do mezanino no grupo `ctx.addMezz`.
  // Objetos do cartão (pendentes do hall, arandelas) NÃO são recriados.
  // ---------------------------------------------------------------------------
  const THREE = ctx.THREE, M = ctx.M;
  const box = (...a) => ctx.box(...a), cyl = (...a) => ctx.cyl(...a), sph = (...a) => ctx.sph(...a);
  const place = (...a) => ctx.place(...a), std = (o) => ctx.std(o), rnd = () => ctx.rnd();
  const put = (m) => { ctx.add(m); return m; };
  const G = () => new THREE.Group();
  const rot = (m, x = 0, y = 0, z = 0) => { m.rotation.set(x, y, z); return m; };
  const nc = { cast: false };

  // Materiais locais (mesmas opções → mesmo material → menos draw calls)
  const slat     = std({ color: 0xd3b08e, roughness: 0.7 });                      // ripado madeira clara (tom da fachada)
  const felt     = std({ color: 0x19191b, roughness: 1 });                        // fundo preto do ripado
  const black    = std({ color: 0x141416, roughness: 0.45, metalness: 0.45 });    // metal preto
  const quartz   = std({ color: 0x1d1d20, roughness: 0.25, metalness: 0.1 });     // tampo preto
  const mass     = std({ color: 0x3a3b3f, roughness: 0.8 });                      // grafite (escada maciça)
  const uphol    = std({ color: 0x55585f, roughness: 0.97 });                     // estofado grafite
  const terra    = std({ color: 0xa65a3a, roughness: 0.95 });                     // terracota
  const amber    = std({ color: 0xc98a3c, roughness: 0.6, metalness: 0.2 });
  const caramel  = std({ color: 0x9a6a44, roughness: 0.85 });                     // couro caramelo
  const potBlack = std({ color: 0x1c1c1e, roughness: 0.55 });
  const frond    = std({ color: 0x2f5a2a, roughness: 0.9 });
  const frond2   = std({ color: 0x3d6e34, roughness: 0.9 });
  const trunk    = std({ color: 0x5b4632, roughness: 1 });
  const pebble   = std({ color: 0xe9e7e1, roughness: 0.9 });
  const ceramic  = std({ color: 0xf4f4f2, roughness: 0.3 });
  const paper    = std({ color: 0xf6f1e6, roughness: 0.9 });
  const coffee   = std({ color: 0x3b2417, roughness: 0.4 });
  // LED âmbar (degraus, balcão, testeira): material próprio (não compartilhado com outras salas),
  // aceso junto com a luz do hall
  const ledWarm  = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb866, emissiveIntensity: 0.9, roughness: 0.5 });
  ctx.bindEmissive('hall', ledWarm, 1.0, { min: 0.1 });
  const frost    = std({ color: 0xf1f3f4, roughness: 0.85, transparent: true, opacity: 0.55 });   // vidro jateado
  const rugHall  = std({ color: 0x4a4b50, roughness: 1 });
  const rugEdge  = std({ color: 0x8a6a4c, roughness: 1 });
  const mat      = std({ color: 0x232325, roughness: 1 });
  const whiteF   = std({ color: 0xf1efea, roughness: 0.6 });
  const mustard  = std({ color: 0xd9a53a, roughness: 0.95 });                     // quadro mostarda (mezanino)
  // Acabamentos reais do cartão (padrão em espaço de mundo: NÃO clonar, só reusar)
  const MARM = M.marmorato, PORC = M.porcelanatoCinza, MARR = M.marmoreMarrom;
  // WCs
  const grabBar  = std({ color: 0xd9dde1, roughness: 0.25, metalness: 0.85 });
  const alarm    = std({ color: 0xc4201b, roughness: 0.4 });
  const quartzW  = std({ color: 0xefeae0, roughness: 0.28 });                     // bancada de quartzo branco
  const basinIn  = std({ color: 0xdedcd6, roughness: 0.2 });                      // fundo da cuba
  const navy     = std({ color: 0x1b2d4f, roughness: 0.7 });                      // faixa azul-marinho (acesso aos banheiros)
  // moldura de LED dos espelhos (luz fria, v3) — acende com a luz dos banheiros
  const ledCool  = new THREE.MeshStandardMaterial({ color: 0xd8f7ff, emissive: 0x7fe6ff, emissiveIntensity: 1.1, roughness: 0.4 });
  ctx.bindEmissive('banheiros', ledCool, 1.3, { min: 0.12 });

  // ------------------------------------------------------------ utilidades
  // Funde várias caixas numa só geometria (ripados etc.) — item: [w, h, d, x, y, z, rx, ry, rz]
  const mergeBoxes = (list, material, cast = true) => {
    const pos = [], nor = [], uv = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const [w, h, d, x, y, z, rx = 0, ry = 0, rz = 0] of list) {
      const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      g.applyMatrix4(m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s1));
      for (const v of g.attributes.position.array) pos.push(v);
      for (const v of g.attributes.normal.array) nor.push(v);
      for (const v of g.attributes.uv.array) uv.push(v);
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material); m.castShadow = cast; m.receiveShadow = true; return m;
  };
  // Quadrilátero plano (painéis de vidro inclinados da escada)
  const quad = (a, b, c, d, material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.castShadow = false; m.receiveShadow = false; return m;
  };
  // Barra cilíndrica entre dois pontos (corrimãos, barras de apoio)
  const up = new THREE.Vector3(0, 1, 0);
  const bar = (x1, y1, z1, x2, y2, z2, r, material, seg = 8) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const m = cyl(r, r, a.distanceTo(b), material, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, seg);
    m.quaternion.setFromUnitVectors(up, b.sub(a).normalize()); return m;
  };
  // Placa com textura de canvas (letreiros e telas). aspect = largura/altura da placa;
  // o canvas do makeTex é quadrado, então o desenho é feito num espaço virtual
  // (largura × altura) e esticado para caber — na placa ele volta à proporção certa.
  const canvasMat = (aspect, draw, glow = 0.8, transparent = false) => {
    const tex = ctx.makeTex(1024, (g, s) => {
      const W = aspect >= 1 ? s : s * aspect, Hh = aspect >= 1 ? s / aspect : s;
      g.save(); g.scale(s / W, s / Hh); draw(g, W, Hh); g.restore();
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow, roughness: 0.5, transparent, alphaTest: transparent ? 0.02 : 0 });
  };
  const plane = (w, h, material, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = false; m.receiveShadow = false; return put(m);
  };
  // Plano que mostra só uma faixa (linhas v0–v1) de uma textura-atlas
  const atlasPlane = (w, h, material, v0, v1, u0 = 0, u1 = 1) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0); uv.setX(i, uv.getX(i) > 0.5 ? u1 : u0); }
    uv.needsUpdate = true;
    const m = new THREE.Mesh(g, material); m.castShadow = false; m.receiveShadow = false; return m;
  };
  // Revestimento de parede (12 mm) colado na face f de uma parede. axis 'x' = parede com x fixo (corre em z),
  // 'z' = parede com z fixo (corre em x); dir = lado do ambiente (±1); a–b = trecho ao longo da parede; y0–y1.
  const CL = 0.012;
  const clad = (axis, f, dir, a, b, y0, y1, material) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return null;
    const c = f + dir * CL / 2, m = (a + b) / 2, y = (y0 + y1) / 2;
    return put(axis === 'x' ? box(CL, y1 - y0, b - a, material, c, y, m, nc) : box(b - a, y1 - y0, CL, material, m, y, c, nc));
  };
  // Parede de banheiro no padrão real: porcelanato cinza até 1,2 m + (mármore marrom | marmorato) em cima.
  // cuts = vãos [a, b] (portas, já com a folga de 0,1 m); acima de yTop do vão o revestimento superior continua.
  const wcWall = (axis, f, dir, a, b, upper, y0 = 0.09, cuts = [], yCut = 2.28) => {
    let cur = a;
    for (const [ca, cb] of cuts) { clad(axis, f, dir, cur, ca, y0, 1.2, PORC); clad(axis, f, dir, cur, ca, 1.2, 2.99, upper); cur = cb; }
    clad(axis, f, dir, cur, b, y0, 1.2, PORC); clad(axis, f, dir, cur, b, 1.2, 2.99, upper);
    for (const [ca, cb] of cuts) clad(axis, f, dir, ca, cb, yCut, 2.99, upper);
    // filete de acabamento (inox escovado) na junta das duas placas
    let c2 = a;
    for (const [ca, cb] of cuts) { if (ca - c2 > 0.02) put(axis === 'x' ? box(0.006, 0.008, ca - c2, M.steel, f + dir * (CL + 0.002), 1.2, (c2 + ca) / 2, nc) : box(ca - c2, 0.008, 0.006, M.steel, (c2 + ca) / 2, 1.2, f + dir * (CL + 0.002), nc)); c2 = cb; }
    if (b - c2 > 0.02) put(axis === 'x' ? box(0.006, 0.008, b - c2, M.steel, f + dir * (CL + 0.002), 1.2, (c2 + b) / 2, nc) : box(b - c2, 0.008, 0.006, M.steel, (c2 + b) / 2, 1.2, f + dir * (CL + 0.002), nc));
  };
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const FONT = '"Montserrat","Helvetica Neue",Arial,sans-serif';

  // ======================= BUILDERS (origem no centro da base; frente = +z) =======================
  // Cica (Cycas revoluta) em vaso preto alto — como as da fachada
  const cycas = (potH = 0.75, span = 0.62, seed = 1) => {
    const g = G(); let k = seed * 7.13;
    const r2 = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
    g.add(cyl(0.19, 0.15, potH, potBlack, 0, potH / 2, 0, 16));
    g.add(cyl(0.175, 0.175, 0.02, M.soil, 0, potH - 0.02, 0, 14));
    g.add(cyl(0.07, 0.09, 0.22, trunk, 0, potH + 0.1, 0, 10));
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r2() * 0.3, len = span * (0.8 + r2() * 0.35), tilt = 0.55 + r2() * 0.5;
      const pv = G(); pv.position.set(0, potH + 0.2, 0); pv.rotation.y = a;
      const f = box(0.14, 0.012, len, i % 2 ? frond : frond2, 0, Math.sin(tilt) * len / 2, Math.cos(tilt) * len / 2);
      f.rotation.x = -tilt; f.castShadow = true; pv.add(f); g.add(pv);
    }
    return g;
  };
  // Planta grande (tipo ficus-lira) em vaso preto cilíndrico
  const bigPlant = (h = 1.8, spread = 0.32, seed = 2) => {
    const g = G(); let k = seed * 3.7;
    const r2 = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
    g.add(cyl(0.21, 0.18, 0.55, potBlack, 0, 0.275, 0, 16));
    g.add(cyl(0.195, 0.195, 0.02, M.soil, 0, 0.535, 0, 14));
    g.add(cyl(0.025, 0.035, h - 0.7, trunk, 0, 0.55 + (h - 0.7) / 2, 0, 8));
    for (let i = 0; i < 7; i++) {
      const a = r2() * Math.PI * 2, rr2 = spread * (0.35 + r2() * 0.65), y = 1.0 + (i / 6) * (h - 1.1);
      const s = sph(0.2 + r2() * 0.08, i % 2 ? frond : frond2, Math.cos(a) * rr2, y, Math.sin(a) * rr2);
      s.scale.set(1, 0.75, 1); g.add(s);
    }
    return g;
  };
  // Poltrona moderna (encosto em −z)
  const armchair = (fab, cush) => {
    const g = G();
    g.add(box(0.74, 0.26, 0.74, fab, 0, 0.28, 0));
    g.add(box(0.74, 0.44, 0.16, fab, 0, 0.63, -0.29));
    for (const sx of [-1, 1]) g.add(box(0.12, 0.2, 0.74, fab, sx * 0.31, 0.51, 0));
    g.add(box(0.48, 0.1, 0.54, M.cushion, 0, 0.46, 0.06));
    if (cush) g.add(rot(box(0.34, 0.32, 0.09, cush, 0, 0.66, -0.17), -0.18, 0.1));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.014, 0.01, 0.15, black, sx * 0.31, 0.075, sz * 0.31, 6));
    return g;
  };
  // Sofá 3 lugares grafite (encosto em −z)
  const sofa3 = (w) => {
    const g = G();
    g.add(box(w, 0.26, 0.84, uphol, 0, 0.28, 0));
    g.add(box(w, 0.46, 0.18, uphol, 0, 0.64, -0.33));
    for (const sx of [-1, 1]) g.add(box(0.14, 0.24, 0.84, uphol, sx * (w / 2 - 0.07), 0.53, 0));
    const n = 3, cw = (w - 0.28) / n;
    for (let i = 0; i < n; i++) g.add(box(cw - 0.03, 0.1, 0.6, M.cushion, -w / 2 + 0.14 + cw * (i + 0.5), 0.46, 0.08));
    g.add(rot(box(0.38, 0.36, 0.1, terra, -w / 2 + 0.4, 0.68, -0.18), -0.15, 0.2));
    g.add(rot(box(0.36, 0.34, 0.1, amber, w / 2 - 0.4, 0.67, -0.18), -0.15, -0.2));
    g.add(box(w - 0.1, 0.03, 0.7, black, 0, 0.135, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.014, 0.01, 0.13, black, sx * (w / 2 - 0.08), 0.065, sz * 0.34, 6));
    return g;
  };

  // =====================================================================
  // HALL — parede do letreiro (face do hall da parede z = 44,0)
  // =====================================================================
  const WZ = 44.075;   // face da parede templo↔hall do lado do hall
  // Planta grande perto do café (o balcão, o painel ripado e o letreiro da parede do templo foram retirados)
  place(bigPlant(1.7, 0.28, 5), 7.3, 49.02);

  // Parede de destaque em MARMORATO (vídeos): face do hall da parede x = 4,0 (porta com 0,1 m de folga,
  // o revestimento continua acima dela) e o trecho da parede z = 44,0 até o pilar de x 5,2
  {
    const F4 = 4.075;
    for (const [a, b] of [[44.075, 44.3], [45.4, 46.375]]) clad('x', F4, 1, a, b, 0.09, 2.99, MARM);   // v1.8: a parede acaba em z 46,375 (a sala virou hall)
    clad('x', F4, 1, 44.3, 45.4, 2.28, 2.99, MARM);
    clad('z', 44.075, 1, 4.087, 5.19, 0.09, 2.99, MARM);
  }
  // Banco de madeira ripada na parede x = 4,0 (ao lado da porta do WC PCD) + quadro
  {
    const S = [];
    const BZ = 45.88;                                                             // v1.8: 7 cm para dentro (a parede acaba em z 46,375)
    for (let i = 0; i < 6; i++) S.push([0.055, 0.04, 1.0, 4.19 + i * 0.065, 0.45, BZ]);
    put(mergeBoxes(S, slat));
    for (const z of [BZ - 0.4, BZ + 0.4]) { put(box(0.36, 0.43, 0.04, black, 4.35, 0.215, z)); }
    put(box(0.03, 0.8, 0.95, black, 4.102, 1.55, BZ));
    put(box(0.012, 0.7, 0.85, slat, 4.123, 1.55, BZ, nc));
    put(box(0.014, 0.28, 0.28, felt, 4.134, 1.55, BZ, nc));
    put(cyl(0.07, 0.07, 0.016, amber, 4.141, 1.55, BZ, 20)).rotation.z = Math.PI / 2;
  }

  // Lounge: sofá grafite na parede x = 4,0, mesa de centro, 2 poltronas caramelo e tapete
  {
    const R = G();
    R.add(box(2.3, 0.008, 2.1, rugEdge, 0, 0.008, 0, nc));
    R.add(box(2.18, 0.01, 1.98, rugHall, 0, 0.012, 0, nc));
    place(R, 6.0, 48.5);
    place(sofa3(1.8), 4.6, 48.5, Math.PI / 2);
    const T2 = G();
    T2.add(cyl(0.42, 0.42, 0.04, slat, 0, 0.4, 0, 28));
    T2.add(cyl(0.34, 0.34, 0.02, black, 0, 0.12, 0, 24));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; T2.add(cyl(0.012, 0.012, 0.38, black, Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3, 6)); }
    T2.add(box(0.24, 0.03, 0.18, terra, -0.1, 0.435, 0.05));                    // livros
    T2.add(box(0.2, 0.025, 0.15, paper, -0.1, 0.46, 0.05));
    T2.add(cyl(0.06, 0.05, 0.12, ceramic, 0.14, 0.48, -0.08, 12));
    place(T2, 5.72, 48.5);
    place(armchair(caramel, felt), 6.62, 47.98, -Math.PI / 2 - 0.12);
    place(armchair(caramel, terra), 6.62, 49.02, -Math.PI / 2 + 0.12);
  }

  // Tapete redondo grafite com borda âmbar sob o pendente do hall (marca a área de encontro)
  {
    const r1 = cyl(1.12, 1.12, 0.008, rugEdge, 8.35, 0.008, 46.85, 40); r1.castShadow = false; put(r1);
    const r2 = cyl(1.05, 1.05, 0.01, rugHall, 8.35, 0.012, 46.85, 40); r2.castShadow = false; put(r2);
  }

  // Café / aparador na parede da fachada (x 7,75–9,95 · z 49,05–49,55)
  {
    const X0 = 7.75, X1 = 9.95, cx = (X0 + X1) / 2, L = X1 - X0, zc = 49.3, fz = 49.563;
    put(box(L, 0.84, 0.46, black, cx, 0.46, zc));
    for (let i = 1; i < 4; i++) put(box(0.008, 0.76, 0.01, felt, X0 + (i * L) / 4, 0.46, zc + 0.232, nc));
    for (let i = 0; i < 4; i++) put(box(0.12, 0.012, 0.012, amber, X0 + ((i + 0.5) * L) / 4, 0.78, zc + 0.24));
    put(box(L, 0.04, 0.48, slat, cx, 0.9, zc));
    for (const x of [X0 + 0.08, X1 - 0.08]) put(box(0.05, 0.04, 0.05, black, x, 0.02, zc));
    // Máquina de espresso (inox) com xícara
    const ex = X0 + 0.35;
    put(box(0.42, 0.4, 0.34, M.steel, ex, 1.12, zc - 0.03));
    put(box(0.42, 0.06, 0.36, black, ex, 1.35, zc - 0.03));
    put(box(0.34, 0.12, 0.02, black, ex, 1.22, zc + 0.15, nc));
    put(cyl(0.035, 0.035, 0.05, M.chrome, ex - 0.08, 0.98, zc + 0.12, 10));
    put(cyl(0.035, 0.035, 0.05, M.chrome, ex + 0.08, 0.98, zc + 0.12, 10));
    put(cyl(0.035, 0.028, 0.06, ceramic, ex - 0.08, 0.95, zc + 0.12, 10));
    put(box(0.3, 0.012, 0.12, M.chrome, ex, 0.926, zc + 0.12));
    // Moedor
    put(box(0.16, 0.28, 0.2, black, ex + 0.36, 1.06, zc - 0.05));
    put(cyl(0.07, 0.05, 0.16, std({ color: 0x3a2a20, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.8 }), ex + 0.36, 1.28, zc - 0.05, 12));
    // Garrafas térmicas (preta, âmbar, preta)
    [black, amber, black].forEach((mt, i) => {
      const x = cx + 0.05 + i * 0.2;
      put(cyl(0.07, 0.075, 0.3, mt, x, 1.07, zc - 0.07, 14));
      put(cyl(0.05, 0.06, 0.06, black, x, 1.25, zc - 0.07, 12));
      put(box(0.1, 0.02, 0.03, black, x, 1.29, zc - 0.07));
    });
    // Pilhas de copos, xícaras, açucareiro, guardanapos
    for (let i = 0; i < 3; i++) put(cyl(0.04, 0.03, 0.22 - i * 0.04, paper, X1 - 0.35 + i * 0.1, 1.03 - i * 0.02, zc + 0.1, 12));
    for (let i = 0; i < 4; i++) {
      const x = X1 - 0.55 + (i % 2) * 0.1, z = zc - 0.12 + Math.floor(i / 2) * 0.1;
      put(cyl(0.035, 0.028, 0.065, ceramic, x, 0.953, z, 10));
    }
    put(cyl(0.045, 0.045, 0.1, ceramic, X1 - 0.18, 0.97, zc - 0.12, 12));
    put(cyl(0.03, 0.03, 0.02, amber, X1 - 0.18, 1.03, zc - 0.12, 10));
    put(box(0.14, 0.03, 0.14, paper, X1 - 0.15, 0.935, zc + 0.08));
    put(box(0.34, 0.03, 0.24, slat, cx - 0.2, 0.935, zc + 0.08));                // bandeja com biscoitos
    for (let i = 0; i < 5; i++) put(cyl(0.028, 0.028, 0.012, caramel, cx - 0.32 + i * 0.06, 0.957, zc + 0.08 + (i % 2) * 0.05, 10));
    // Prateleira com canecas + quadro "Café da Base" na parede
    put(box(0.95, 0.04, 0.22, slat, cx + 0.6, 1.72, fz - 0.11));
    for (const x of [cx + 0.2, cx + 1.0]) put(box(0.02, 0.12, 0.18, black, x, 1.65, fz - 0.1));
    for (let i = 0; i < 5; i++) put(cyl(0.04, 0.035, 0.1, i % 3 === 1 ? terra : (i % 3 === 2 ? black : ceramic), cx + 0.24 + i * 0.18, 1.79, fz - 0.11, 12));
    put(box(0.94, 0.62, 0.03, black, cx - 0.45, 1.6, fz - 0.015));
    const menu = canvasMat(0.88 / 0.56, (g, W, Hh) => {
      g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, W, Hh);
      g.strokeStyle = 'rgba(240,179,106,0.9)'; g.lineWidth = Hh * 0.012; g.strokeRect(W * 0.04, Hh * 0.06, W * 0.92, Hh * 0.88);
      g.fillStyle = '#f4efe6'; g.textAlign = 'center'; g.textBaseline = 'middle';
      ctx.logo.draw(g, W * 0.1, Hh * 0.12, Hh * 0.2, { layout: 'mark', color: '#f4efe6' });
      g.font = `800 ${Hh * 0.15}px ${FONT}`; g.fillText('CAFÉ DA BASE', W * 0.56, Hh * 0.22);
      g.fillStyle = '#f0b36a'; g.fillRect(W * 0.35, Hh * 0.33, W * 0.3, Hh * 0.012);
      g.fillStyle = '#e8e2d6'; g.font = `500 ${Hh * 0.085}px ${FONT}`; g.textAlign = 'left';
      const rows = [['Espresso', 'R$ 5'], ['Cappuccino', 'R$ 8'], ['Café coado', 'grátis'], ['Chá gelado', 'R$ 6']];
      rows.forEach(([a, b], i) => { const y = Hh * (0.46 + i * 0.12); g.textAlign = 'left'; g.fillText(a, W * 0.12, y); g.textAlign = 'right'; g.fillText(b, W * 0.88, y); });
    }, 0.45);
    plane(0.88, 0.56, menu, cx - 0.45, 1.6, fz - 0.032, Math.PI);
  }
  // Mesa bistrô alta com 2 banquetas
  {
    const x = 8.75, z = 47.95;
    put(cyl(0.32, 0.32, 0.035, quartz, x, 1.04, z, 24));
    put(cyl(0.03, 0.03, 1.0, black, x, 0.52, z, 8));
    put(cyl(0.22, 0.24, 0.025, black, x, 0.013, z, 18));
    put(cyl(0.04, 0.03, 0.08, ceramic, x + 0.08, 1.1, z - 0.05, 10));
    for (const a of [2.2, 4.1]) {
      const sx = x + Math.cos(a) * 0.55, sz = z + Math.sin(a) * 0.55;
      put(cyl(0.17, 0.17, 0.05, caramel, sx, 0.72, sz, 14));
      put(cyl(0.02, 0.02, 0.7, black, sx, 0.36, sz, 8));
      put(cyl(0.18, 0.2, 0.02, black, sx, 0.01, sz, 14));
    }
  }

  // Totem de avisos (TV vertical) ao lado da rota, virado para a entrada
  {
    const x = 9.95, z = 47.25;
    put(box(0.5, 0.03, 0.36, black, x, 0.015, z));
    put(box(0.1, 0.25, 0.06, black, x, 0.15, z - 0.02));
    put(box(0.64, 1.14, 0.06, black, x, 1.3, z));
    const tot = canvasMat(0.58 / 1.04, (g, W, Hh) => {
      const bg = g.createLinearGradient(0, 0, 0, Hh); bg.addColorStop(0, '#16171a'); bg.addColorStop(1, '#0b0b0d');
      g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      ctx.logo.draw(g, W * 0.08, Hh * 0.035, W * 0.5, { layout: 'wide', color: '#f4efe6' });
      g.fillStyle = '#f0b36a'; g.font = `800 ${W * 0.075}px ${FONT}`; g.fillText('AVISOS DA SEMANA', W * 0.08, Hh * 0.178);
      const cards = [
        ['#6e46ff', 'CULTO DE CELEBRAÇÃO', 'Domingo · 9h e 18h'],
        ['#c98a3c', 'BASE KIDS', 'Check-in no balcão'],
        ['#2e8b57', 'CÉLULAS', 'Quartas · 20h'],
        ['#a65a3a', 'CAFÉ COM O PASTOR', 'Sábado · 8h30'],
      ];
      cards.forEach(([c, t, s], i) => {
        const y = Hh * (0.205 + i * 0.16), h = Hh * 0.14;
        g.fillStyle = 'rgba(255,255,255,0.06)'; rr(g, W * 0.06, y, W * 0.88, h, W * 0.03); g.fill();
        g.fillStyle = c; rr(g, W * 0.06, y, W * 0.035, h, W * 0.015); g.fill();
        g.fillStyle = '#ffffff'; g.font = `700 ${W * 0.062}px ${FONT}`; g.fillText(t, W * 0.14, y + h * 0.42);
        g.fillStyle = '#c9c4ba'; g.font = `400 ${W * 0.055}px ${FONT}`; g.fillText(s, W * 0.14, y + h * 0.78);
      });
      // "QR code" de inscrição
      const q = W * 0.2, qx = W * 0.08, qy = Hh * 0.86;
      g.fillStyle = '#ffffff'; g.fillRect(qx, qy, q, q * 0.9);
      g.fillStyle = '#111'; let k = 7;
      for (let i = 0; i < 9; i++) for (let j = 0; j < 8; j++) { k = (k * 9301 + 49297) % 233280; if (k / 233280 > 0.5) g.fillRect(qx + q * 0.05 + i * q * 0.1, qy + q * 0.05 + j * q * 0.1, q * 0.1, q * 0.1); }
      g.fillStyle = '#f4efe6'; g.font = `500 ${W * 0.05}px ${FONT}`; g.fillText('Inscreva-se', W * 0.33, qy + q * 0.4);
      g.fillStyle = '#f0b36a'; g.fillText('basechurch.app', W * 0.33, qy + q * 0.7);
    }, 0.9);
    ctx.bindEmissive('hall', tot, 0.9, { min: 0.3 });
    plane(0.58, 1.04, tot, x, 1.3, z + 0.032);
  }

  // Capacho na entrada e placas "TEMPLO" (sobre as portas de vidro) e "Banheiros"
  // Capacho de borracha grafite com o logo (anel à esquerda, BASE/CHURCH à direita) logo depois da porta
  put(box(2.16, 0.012, 1.18, mat, 12.0, 0.006, 48.9, nc));
  {
    const cap = ctx.logo.mesh(2.04, 0, { layout: 'wide', color: '#d9d4ca', bg: '#1a1a1c', pad: 0.12, roughness: 1 });
    cap.rotation.x = -Math.PI / 2; cap.position.set(12.0, 0.0135, 48.9); cap.receiveShadow = true; ctx.add(cap);
  }
  put(box(1.2, 0.26, 0.02, felt, 11.85, 2.62, WZ + 0.012, nc));
  const tpl = canvasMat(1.16 / 0.22, (g, W, Hh) => {
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = '#f4efe6'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${Hh * 0.55}px ${FONT}`;
    g.fillText('T E M P L O', W / 2, Hh * 0.54);
  }, 0.7, true);
  plane(1.16, 0.22, tpl, 11.85, 2.62, WZ + 0.024);
  ctx.bindEmissive('hall', tpl, 0.7, { min: 0.25 });
  // Extintor (pó ABC) com placa, entre as portas de vidro do templo e a escada
  {
    const x = 13.38, z = 44.175;
    put(box(0.12, 0.06, 0.04, black, x, 1.6, 44.095));                            // suporte
    put(cyl(0.085, 0.085, 0.52, alarm, x, 1.25, z, 16));
    put(sph(0.085, alarm, x, 1.51, z)).scale.y = 0.5;
    put(cyl(0.02, 0.025, 0.08, black, x, 1.57, z, 8));
    put(box(0.12, 0.025, 0.03, black, x + 0.03, 1.62, z));                       // gatilho
    put(bar(x + 0.06, 1.55, z + 0.03, x + 0.1, 1.15, z + 0.06, 0.012, black));   // mangueira
    put(box(0.18, 0.18, 0.006, alarm, x, 1.9, 44.078, nc));                        // placa
    put(box(0.05, 0.1, 0.004, whiteF, x, 1.9, 44.083, nc));
  }
  // Placa de SAÍDA (verde, sempre acesa) sobre a porta principal, lado do hall
  {
    const ex = canvasMat(0.42 / 0.16, (g, W, Hh) => {
      g.fillStyle = '#0f8a3c'; g.fillRect(0, 0, W, Hh);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${Hh * 0.56}px ${FONT}`; g.fillText('SAÍDA', W * 0.58, Hh * 0.54);
      g.beginPath(); g.moveTo(W * 0.08, Hh * 0.5); g.lineTo(W * 0.2, Hh * 0.25); g.lineTo(W * 0.2, Hh * 0.75); g.closePath(); g.fill();
    }, 0.9);
    put(box(0.44, 0.18, 0.03, whiteF, 12.0, 2.52, 49.548));
    plane(0.42, 0.16, ex, 12.0, 2.52, 49.532, Math.PI);
  }

  // Placas pretas sobre as portas (atlas numa textura só; a linha 0 ficou livre na v1.8): WC PCD e WC
  {
    const tex = ctx.makeTex(1024, (g, s) => {
      const rh = s / 3;
      const row = (i, draw) => { g.save(); g.translate(0, i * rh); g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, s, rh);
        g.strokeStyle = 'rgba(240,179,106,0.55)'; g.lineWidth = 4; g.strokeRect(10, 10, s - 20, rh - 20); draw(); g.restore(); };
      const txt = (t1, t2) => {
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillStyle = '#f4efe6'; g.font = `800 ${rh * 0.3}px ${FONT}`; g.fillText(t1, rh * 1.05, rh * 0.4);
        g.fillStyle = '#f0b36a'; g.font = `500 ${rh * 0.19}px ${FONT}`; g.fillText(t2, rh * 1.05, rh * 0.72);
      };
      row(1, () => {
        g.fillStyle = '#1f5fae'; rr(g, rh * 0.16, rh * 0.14, rh * 0.72, rh * 0.72, rh * 0.08); g.fill();
        g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineCap = 'round'; g.lineWidth = rh * 0.06;
        const ox = rh * 0.16, oy = rh * 0.14, u = rh * 0.72;
        g.beginPath(); g.arc(ox + u * 0.45, oy + u * 0.18, u * 0.08, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(ox + u * 0.43, oy + u * 0.3); g.lineTo(ox + u * 0.45, oy + u * 0.55); g.lineTo(ox + u * 0.68, oy + u * 0.55); g.lineTo(ox + u * 0.78, oy + u * 0.8); g.stroke();
        g.beginPath(); g.moveTo(ox + u * 0.44, oy + u * 0.42); g.lineTo(ox + u * 0.62, oy + u * 0.42); g.stroke();
        g.beginPath(); g.arc(ox + u * 0.42, oy + u * 0.66, u * 0.2, -Math.PI * 0.15, Math.PI * 1.25); g.stroke();
        txt('WC PCD', 'acessível · barras de apoio');
      });
      row(2, () => {
        g.fillStyle = '#f4efe6';
        for (const [cx, fem] of [[rh * 0.36, false], [rh * 0.68, true]]) {
          g.beginPath(); g.arc(cx, rh * 0.3, rh * 0.08, 0, Math.PI * 2); g.fill();
          if (fem) { g.beginPath(); g.moveTo(cx, rh * 0.42); g.lineTo(cx - rh * 0.13, rh * 0.78); g.lineTo(cx + rh * 0.13, rh * 0.78); g.closePath(); g.fill(); }
          else g.fillRect(cx - rh * 0.08, rh * 0.42, rh * 0.16, rh * 0.38);
        }
        txt('WC', 'unissex');
      });
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 });
    ctx.bindEmissive('hall', pm, 0.35, { min: 0.1 });
    const sign = (i, x, y, z, ry) => {
      const b = box(0.56, 0.2, 0.02, black, x, y, z); b.rotation.y = ry; put(b);
      const p = atlasPlane(0.54, 0.18, pm, 1 - (i + 1) / 3, 1 - i / 3);
      p.position.set(x + Math.sin(ry) * 0.0115, y, z + Math.cos(ry) * 0.0115); p.rotation.y = ry; put(p);
    };
    sign(1, 4.099, 2.42, 44.85, Math.PI / 2);      // hall → WC PCD
    sign(2, 0.9, 2.42, 46.387, 0);                 // hall → WC
  }

  // Tríptico (foto de culto: silhuetas de mãos erguidas contra a luz âmbar do palco) na parede x = 0 (v1.8: a parede x = 4,0 do lounge saiu)
  {
    const art = canvasMat(1.5 / 0.7, (g, W, Hh) => {
      const bg = g.createLinearGradient(0, 0, 0, Hh); bg.addColorStop(0, '#22140e'); bg.addColorStop(0.55, '#7a3f1f'); bg.addColorStop(0.8, '#d98c3f'); bg.addColorStop(1, '#2a1a12');
      g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
      const sun = g.createRadialGradient(W * 0.52, Hh * 0.62, 0, W * 0.52, Hh * 0.62, W * 0.35);
      sun.addColorStop(0, 'rgba(255,226,170,0.95)'); sun.addColorStop(0.35, 'rgba(255,170,90,0.45)'); sun.addColorStop(1, 'rgba(255,140,60,0)');
      g.fillStyle = sun; g.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 7; i++) {                              // feixes
        const x = W * (0.1 + i * 0.13), gr = g.createLinearGradient(x, 0, W * 0.52, Hh * 0.62);
        gr.addColorStop(0, 'rgba(255,220,170,0.28)'); gr.addColorStop(1, 'rgba(255,220,170,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(x - W * 0.012, 0); g.lineTo(x + W * 0.012, 0); g.lineTo(W * 0.52, Hh * 0.62); g.closePath(); g.fill();
      }
      let k = 11; const r2 = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,${190 + (r2() * 50) | 0},140,${0.12 + r2() * 0.3})`; g.beginPath(); g.arc(r2() * W, r2() * Hh * 0.6, 3 + r2() * 14, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#120b08';                                     // plateia em silhueta
      for (let i = 0; i < 17; i++) {
        const x = W * (0.02 + i * 0.061 + (r2() - 0.5) * 0.02), hy = Hh * (0.8 + r2() * 0.05);
        g.beginPath(); g.arc(x, hy, Hh * 0.045, 0, Math.PI * 2); g.fill();
        g.fillRect(x - Hh * 0.07, hy + Hh * 0.03, Hh * 0.14, Hh);
        if (r2() > 0.45) { g.save(); g.translate(x + Hh * 0.05, hy); g.rotate(0.15 + r2() * 0.25); g.fillRect(-Hh * 0.012, -Hh * 0.28, Hh * 0.024, Hh * 0.28); g.beginPath(); g.arc(0, -Hh * 0.29, Hh * 0.02, 0, Math.PI * 2); g.fill(); g.restore(); }
        if (r2() > 0.6) { g.save(); g.translate(x - Hh * 0.05, hy); g.rotate(-0.15 - r2() * 0.25); g.fillRect(-Hh * 0.012, -Hh * 0.26, Hh * 0.024, Hh * 0.26); g.beginPath(); g.arc(0, -Hh * 0.27, Hh * 0.02, 0, Math.PI * 2); g.fill(); g.restore(); }
      }
    }, 0.12);
    [49.11, 48.55, 47.99].forEach((z, i) => {
      put(box(0.03, 0.72, 0.52, black, 0.102, 1.68, z));
      const p = atlasPlane(0.48, 0.68, art, 0, 1, i / 3, (i + 1) / 3);
      p.position.set(0.119, 1.68, z); p.rotation.y = Math.PI / 2; put(p);
    });
  }

  // Totem de álcool em gel ao lado da porta principal
  {
    const x = 10.38, z = 49.22;
    put(cyl(0.16, 0.17, 0.02, black, x, 0.01, z, 18));
    put(cyl(0.022, 0.022, 1.05, black, x, 0.54, z, 8));
    put(box(0.13, 0.22, 0.1, whiteF, x, 1.15, z + 0.02));
    put(box(0.11, 0.05, 0.02, black, x, 1.1, z + 0.075));
    put(box(0.14, 0.02, 0.1, black, x, 0.62, z + 0.03));
  }

  // =====================================================================
  // ESCADA EM U (x 13,62–15,94 · z 44,21–49,54) até o mezanino (y 3,0)
  // =====================================================================
  {
    const R = 3.0 / 18, GO = 0.26;                 // espelho e piso do degrau
    const A0 = 13.62, A1 = 14.76, B0 = 14.82, B1 = 15.94, ZF = 46.24, ZL = ZF + 8 * GO;   // ZL = 48,32
    const ZE = 49.54, ZT = 44.21;
    // Lance 1 (maciço, grafite + piso de madeira), sobe para +z; fita de LED sob cada bocel
    for (let i = 1; i <= 8; i++) {
      const z0 = ZF + (i - 1) * GO, top = i * R;
      put(box(A1 - A0, top - 0.03, GO, mass, (A0 + A1) / 2, (top - 0.03) / 2, z0 + GO / 2));
      put(box(A1 - A0 + 0.02, 0.03, GO + 0.03, slat, (A0 + A1) / 2, top - 0.015, z0 + GO / 2 - 0.015));
      put(box(A1 - A0 - 0.1, 0.012, 0.012, ledWarm, (A0 + A1) / 2, top - 0.04, z0 - 0.004, nc));
    }
    // Patamar intermediário (y 1,5) junto à fachada: maciço sob o lance 1, laje sob o lance 2
    put(box(A1 - A0, 1.47, ZE - ZL, mass, (A0 + A1) / 2, 0.735, (ZL + ZE) / 2));
    put(box(B1 - B0 + 0.06, 0.16, ZE - ZL, mass, (B0 + B1) / 2 - 0.03, 1.39, (ZL + ZE) / 2));
    put(box(B1 - A0 + 0.02, 0.03, ZE - ZL + 0.02, slat, (A0 + B1) / 2, 1.485, (ZL + ZE) / 2 - 0.01));
    // Lance 2 (degraus soltos de madeira sobre 2 longarinas pretas), volta para −z
    for (let j = 1; j <= 8; j++) {
      const z1 = ZL - (j - 1) * GO, top = 1.5 + j * R;
      put(box(B1 - B0, 0.05, GO + 0.03, slat, (B0 + B1) / 2, top - 0.025, z1 - GO / 2 + 0.015));
    }
    const ang = Math.atan2(1.5, ZL - ZF), slen = Math.hypot(1.5, ZL - ZF);
    for (const x of [B0 + 0.03, B1 - 0.02]) {
      const s = box(0.03, 0.26, slen, black, x, 1.5 + 0.75 - 0.19, (ZF + ZL) / 2); s.rotation.x = ang; put(s);
    }
    // Patamar superior / mezanino (y 3,0) sobre a passagem para os banheiros (vão livre ≈ 2,8 m)
    put(box(B1 - A0, 0.16, ZF - ZT, mass, (A0 + B1) / 2, 2.9, (ZT + ZF) / 2));
    put(box(B1 - A0 + 0.02, 0.025, ZF - ZT, slat, (A0 + B1) / 2, 2.99, (ZT + ZF) / 2));
    put(box(0.03, 0.2, ZF - ZT, black, A0 - 0.015, 2.9, (ZT + ZF) / 2));             // testeira preta
    put(box(B1 - A0, 0.2, 0.03, black, (A0 + B1) / 2, 2.9, ZF + 0.015));
    put(box(B1 - A0 - 0.2, 0.012, 0.03, ledWarm, (A0 + B1) / 2, 2.81, ZF - 0.02, nc)); // LED sob a testeira
    // Guarda-corpos de vidro com corrimão preto
    const nose1 = (z) => R + ((z - ZF) / GO) * R;                 // linha dos bocéis do lance 1
    const nose2 = (z) => 1.5 + R + ((ZL - z) / GO) * R;           // idem, lance 2
    const GL = M.glass, HR = 0.95;
    // lance 1 — lado do hall (x = A0) + patamar intermediário
    put(quad([A0 - 0.01, 0.03, ZF], [A0 - 0.01, 1.3, ZL], [A0 - 0.01, 1.5 + HR, ZL], [A0 - 0.01, nose1(ZF) + HR, ZF], GL));
    put(quad([A0 - 0.01, 1.3, ZL], [A0 - 0.01, 1.3, ZE - 0.02], [A0 - 0.01, 1.5 + HR, ZE - 0.02], [A0 - 0.01, 1.5 + HR, ZL], GL));
    put(bar(A0 - 0.01, nose1(ZF) + HR + 0.02, ZF, A0 - 0.01, 1.5 + HR + 0.02, ZL, 0.022, black));
    put(bar(A0 - 0.01, 1.5 + HR + 0.02, ZL, A0 - 0.01, 1.5 + HR + 0.02, ZE - 0.02, 0.022, black));
    // entre os lances (x = 14,79): do lance 1 até 0,95 m acima do lance 2
    const XM = (A1 + B0) / 2;
    put(quad([XM, nose1(ZF) - 0.1, ZF], [XM, 1.45, ZL], [XM, nose2(ZL) + HR, ZL], [XM, 3.0 + HR, ZF], GL));
    put(bar(XM, nose2(ZL) + HR + 0.02, ZL, XM, 3.0 + HR + 0.02, ZF, 0.022, black));
    // corrimão de parede do lance 2 (x ≈ 15,9) com 3 suportes
    const XW = B1 - 0.05;
    put(bar(XW, nose2(ZL) + 0.9, ZL, XW, nose2(ZF) + 0.9, ZF, 0.02, black));
    for (const t of [0.15, 0.5, 0.85]) { const z = ZL - t * (ZL - ZF); put(box(0.07, 0.02, 0.02, black, B1 - 0.02, nose2(z) + 0.87, z)); }
    // mezanino: bordas x = A0 e z = ZF (sobre o início do lance 1)
    put(quad([A0 - 0.01, 2.84, ZT], [A0 - 0.01, 2.84, ZF], [A0 - 0.01, 3.0 + HR, ZF], [A0 - 0.01, 3.0 + HR, ZT], GL));
    put(quad([A0, 2.84, ZF + 0.035], [XM, 2.84, ZF + 0.035], [XM, 3.0 + HR, ZF + 0.035], [A0, 3.0 + HR, ZF + 0.035], GL));
    put(bar(A0 - 0.01, 3.0 + HR + 0.02, ZT, A0 - 0.01, 3.0 + HR + 0.02, ZF + 0.035, 0.022, black));
    put(bar(A0 - 0.01, 3.0 + HR + 0.02, ZF + 0.035, XM, 3.0 + HR + 0.02, ZF + 0.035, 0.022, black));
    // montantes pretos nas quinas dos vidros
    for (const [x, y0, z, h] of [[A0 - 0.01, 0, ZF, nose1(ZF) + HR], [A0 - 0.01, 1.3, ZL, HR + 0.2], [A0 - 0.01, 2.84, ZF + 0.035, HR + 0.16], [A0 - 0.01, 2.84, ZT + 0.02, HR + 0.16]])
      put(box(0.035, h, 0.035, black, x, y0 + h / 2, z));
    // Jardim de seixos brancos sob o lance 2 e o patamar, com cica e planta alta
    const PZ0 = 46.34, PZ1 = 49.48, PX0 = B0 + 0.06, PX1 = B1 - 0.02;
    put(box(PX1 - PX0, 0.1, 0.03, black, (PX0 + PX1) / 2, 0.05, PZ0));
    put(box(PX1 - PX0, 0.1, 0.03, black, (PX0 + PX1) / 2, 0.05, PZ1));
    put(box(0.03, 0.1, PZ1 - PZ0, black, PX0, 0.05, (PZ0 + PZ1) / 2));
    put(box(PX1 - PX0 - 0.03, 0.07, PZ1 - PZ0 - 0.03, pebble, (PX0 + PX1) / 2, 0.035, (PZ0 + PZ1) / 2, nc));
    for (let i = 0; i < 14; i++) { const s = sph(0.035 + rnd() * 0.03, i % 3 ? pebble : mass, PX0 + 0.08 + rnd() * (PX1 - PX0 - 0.16), 0.07, PZ0 + 0.1 + rnd() * (PZ1 - PZ0 - 0.2)); s.scale.y = 0.55; put(s); }
    place(cycas(0.45, 0.5, 4), (PX0 + PX1) / 2, 48.85);
    place(bigPlant(1.75, 0.26, 7), (PX0 + PX1) / 2, 47.05);
  }

  // =====================================================================
  // MEZANINO / "salinha" (y 3,05) sobre WC / WC PCD / canto do hall — sem escada até ele (v1.5.4)
  // =====================================================================
  const SX = ctx.STAIR, MZ = ctx.MEZZ;
  const mz = (m) => ctx.addMezz(m);                      // peças do mezanino: grupo próprio (some na Vista de cima)
  // ---- Mezanino: laje sobre WC / WC PCD / canto do hall (x 0,087–4,075 · z 44,075–49,563), piso em y = 3,05 ----
  {
    const YF = SX.Y, x0 = MZ.x0, x1 = MZ.x1, z0 = MZ.z0, z1 = MZ.z1, WT = 5.92;
    // laje (face de baixo = forro dos cômodos de baixo) e testeira grafite com fita de LED no lado do hall
    mz(box(4.125, 0.12, 5.75, M.wall, 2.0125, 2.97, 46.825));
    mz(box(0.05, 0.23, z1 - z0, mass, 4.1, 2.955, (z0 + z1) / 2));
    mz(box(0.012, 0.012, z1 - z0 - 0.2, ledWarm, 4.1, 2.83, (z0 + z1) / 2, nc));
    mz(box(0.15, 0.3, z1 - 46.375, M.wall, 4.0, 2.76, (46.375 + z1) / 2));                 // v1.8: viga sob a borda da laje (sem a parede x = 4,0 da Sala da Família), da ponta da parede do WC PCD à fachada
    // piso laminado (mesma textura e escala dos pisos do cartão)
    {
      const tile = 2.4, fw = 4.1 - x0, fd = z1 - z0, map = ctx.TEX.laminate.clone();
      map.repeat.set(fw / tile, fd / tile); map.offset.set(x0 / tile, -z1 / tile);
      const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.44, bumpMap: map, bumpScale: 0.25, envMapIntensity: 0.8 });
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), fm);
      fl.rotation.x = -Math.PI / 2; fl.position.set(x0 + fw / 2, YF, z0 + fd / 2); fl.receiveShadow = true; mz(fl);
    }
    // rodapé de madeira (oeste, norte, sul) — o piso e o rodapé seguem o padrão dos cômodos de laminado
    mz(box(0.02, 0.07, z1 - z0, M.baseboardWood, x0 + 0.01, YF + 0.035, (z0 + z1) / 2, nc));
    mz(box(4.0 - x0, 0.07, 0.02, M.baseboardWood, (x0 + 4.0) / 2, YF + 0.035, z0 + 0.01, nc));
    mz(box(4.0 - x0, 0.07, 0.02, M.baseboardWood, (x0 + 4.0) / 2, YF + 0.035, z1 - 0.01, nc));
    // paredes acima da laje (o resto do cartão tem paredes de 3 m): preto por fora, greige por dentro, tampa escura
    const wy0 = 3.03, wh = WT - wy0, wcy = wy0 + wh / 2;
    mz(box(0.15, wh, 5.8, M.wallDark, 0, wcy, 46.825));                                    // x = 0
    mz(box(0.012, wh, z1 - z0, M.wall, 0.081, wcy, (z0 + z1) / 2, nc));
    mz(box(4.0, wh, 0.15, M.wallDark, 2.075, wcy, 44.0));                                   // z = 44,0 (parede do templo)
    mz(box(4.0 - x0, wh, 0.012, M.wall, (x0 + 4.075) / 2, wcy, z0 + 0.006, nc));
    const WX0 = 0.7, WX1 = 3.2, WY0 = YF + 0.9, WY1 = WY0 + 1.25;                          // janela da fachada (mesmo vão da janela de baixo)
    for (const [a, b, ya, yb] of [[0.075, 4.075, wy0, WY0], [0.075, 4.075, WY1, WT], [0.075, WX0, WY0, WY1], [WX1, 4.075, WY0, WY1]]) {
      mz(box(b - a, yb - ya, 0.15, M.wallDark, (a + b) / 2, (ya + yb) / 2, 49.65));
      const ia = Math.max(a, x0), ib = Math.min(b, 4.075);
      if (ib > ia) mz(box(ib - ia, yb - ya, 0.012, M.wall, (ia + ib) / 2, (ya + yb) / 2, 49.569, nc));
    }
    const fr = M.frameDark;                                                                  // caixilho preto + vidro fumê
    mz(box(WX1 - WX0, 0.06, 0.2, fr, (WX0 + WX1) / 2, WY0 + 0.03, 49.65)); mz(box(WX1 - WX0, 0.06, 0.2, fr, (WX0 + WX1) / 2, WY1 - 0.03, 49.65));
    for (const x of [WX0 + 0.03, (WX0 + WX1) / 2, WX1 - 0.03]) mz(box(0.06, WY1 - WY0, 0.2, fr, x, (WY0 + WY1) / 2, 49.65));
    mz(box(WX1 - WX0 - 0.1, WY1 - WY0 - 0.1, 0.02, M.glassSmoke, (WX0 + WX1) / 2, (WY0 + WY1) / 2, 49.65, { cast: false, receive: false }));
    for (const [cx, cz, lx, lz] of [[0, 46.825, 0.15, 5.8], [2.075, 44.0, 4.0, 0.15]]) mz(box(cx === 0 ? 0.18 : lx, 0.03, cx === 0 ? lz : 0.18, M.wallDarkCap, cx, WT + 0.015, cz, { cast: false }));
    mz(box(4.0, 0.03, 0.18, M.wallDarkCap, 2.075, WT + 0.015, 49.65, { cast: false }));
    // guarda-corpo de vidro do lado do hall (x = 4,06): 2 painéis, corrimão preto e montantes
    const RX = 4.06, GH = YF + 1.0;
    for (const [za, zb] of [[z0 + 0.06, 46.1], [46.16, 47.8], [47.86, z1 - 0.06]]) mz(quad([RX, YF + 0.09, za], [RX, YF + 0.09, zb], [RX, GH - 0.03, zb], [RX, GH - 0.03, za], M.glass));
    mz(bar(RX, GH, z0 + 0.06, RX, GH, z1 - 0.06, 0.024, black));
    mz(box(0.05, 0.05, z1 - z0 - 0.08, black, RX, YF + 0.045, (z0 + z1) / 2));
    for (const z of [z0 + 0.06, 46.13, 47.83, z1 - 0.06]) mz(box(0.04, 1.0, 0.04, black, RX, YF + 0.5, z));
    mz(box(0.02, 0.07, z1 - z0, M.baseboardWood, 4.04, YF + 0.035, (z0 + z1) / 2, nc));   // rodapé do lado do guarda-corpo

    // ---- mobília mínima: 2 poltronas, mesinha de canto, tapete, planta e quadros ----
    const rugM = box(2.3, 0.012, 1.9, rugHall, 2.95, YF + 0.008, 46.35, nc); mz(rugM);
    mz(box(2.18, 0.006, 1.78, rugEdge, 2.95, YF + 0.014, 46.35, nc));
    const chair = (x, z, ry, cush) => { const c = armchair(caramel, cush); c.position.set(x, YF, z); c.rotation.y = ry; return mz(c); };
    chair(3.05, 45.2, 0.4, terra); chair(3.05, 47.5, Math.PI - 0.4, felt);
    { const T2 = G();                                                                    // mesinha redonda com livros e vaso
      T2.add(cyl(0.3, 0.3, 0.035, slat, 0, 0.5, 0, 24)); T2.add(cyl(0.03, 0.03, 0.48, black, 0, 0.25, 0, 8)); T2.add(cyl(0.2, 0.22, 0.02, black, 0, 0.01, 0, 20));
      T2.add(box(0.2, 0.03, 0.15, terra, -0.08, 0.535, 0.05)); T2.add(box(0.17, 0.025, 0.13, paper, -0.08, 0.56, 0.05));
      T2.add(cyl(0.05, 0.04, 0.1, ceramic, 0.1, 0.57, -0.05, 10));
      T2.position.set(3.15, YF, 46.35); mz(T2); }
    { const L = G();                                                                     // abajur (a luz real vem do cartão: fixture escondida da luz do hall)
      L.add(cyl(0.06, 0.07, 0.025, black, 0, 0.0125, 0, 14)); L.add(cyl(0.01, 0.01, 0.3, black, 0, 0.175, 0, 6));
      L.add(cyl(0.085, 0.13, 0.17, ledWarm, 0, 0.4, 0, 18));
      L.position.set(3.27, YF + 0.5175, 46.45); mz(L); }
    { const c = cycas(0.5, 0.55, 5); c.position.set(0.55, YF, 48.95); mz(c); }
    { const c = bigPlant(1.6, 0.24, 3); c.position.set(0.55, YF, 44.65); mz(c); }
    [[45.6, 0.5, mustard], [46.3, 0.42, terra]].forEach(([z, s, c]) => { mz(box(0.03, s, s, black, x0 + 0.02, YF + 1.5, z)); mz(box(0.012, s - 0.08, s - 0.08, c, x0 + 0.04, YF + 1.5, z, nc)); });
  }

  // =====================================================================
  // BANHEIROS (padrão real, v3): builders com origem na face da parede, frente = +z
  // =====================================================================
  // Bancada de quartzo branco (tampo grosso de 12 cm) com cuba(s) de apoio retangular(es), torneira de parede
  // cromada, espelho com moldura de LED fria e "spots" lavando o mármore (planos de brilho da luz dos banheiros)
  const vanity = (len, depth, top, basins, mw, mh, my0) => {
    const g = G();
    g.add(box(len, 0.12, depth, quartzW, 0, top - 0.06, depth / 2));
    g.add(box(len, 0.18, 0.02, quartzW, 0, top + 0.09, 0.01));                  // espelho de bancada
    for (const bx of basins) {
      const bz = depth * 0.56;
      g.add(box(0.4, 0.13, 0.32, ceramic, bx, top + 0.065, bz));
      g.add(box(0.34, 0.006, 0.26, basinIn, bx, top + 0.128, bz, nc));
      const cn = cyl(0.028, 0.028, 0.012, M.chrome, bx, top + 0.3, 0.026, 12); cn.rotation.x = Math.PI / 2; g.add(cn);   // canopla
      const sp = cyl(0.013, 0.013, 0.2, M.chrome, bx, top + 0.3, 0.12, 8); sp.rotation.x = Math.PI / 2; g.add(sp);
      g.add(cyl(0.013, 0.01, 0.05, M.chrome, bx, top + 0.28, 0.215, 8));
      g.add(box(0.016, 0.07, 0.016, M.chrome, bx + 0.07, top + 0.33, 0.05));      // alavanca
      g.add(cyl(0.03, 0.03, 0.13, M.steel, bx + 0.26 * (bx <= 0 ? 1 : -1), top + 0.065, depth * 0.5, 10));   // saboneteira
    }
    // espelho retangular com moldura de LED embutida (4 filetes)
    const yc = my0 + mh / 2;
    g.add(box(mw, mh, 0.012, M.mirror, 0, yc, 0.008, nc));
    const e = 0.055, t = 0.022;
    g.add(box(mw - 2 * e, t, 0.004, ledCool, 0, my0 + e, 0.016, nc));
    g.add(box(mw - 2 * e, t, 0.004, ledCool, 0, my0 + mh - e, 0.016, nc));
    g.add(box(t, mh - 2 * e, 0.004, ledCool, -mw / 2 + e, yc, 0.016, nc));
    g.add(box(t, mh - 2 * e, 0.004, ledCool, mw / 2 - e, yc, 0.016, nc));
    // halo frio do espelho + "spots" do forro lavando a parede de mármore
    const hm = ctx.glowPlane(mw + 0.35, mh + 0.35, 'banheiros', { color: 0x9feeff, base: 0.3, day: 0.12, tex: 'frame' });
    hm.position.set(0, yc, 0.02); g.add(hm);
    const n = Math.max(1, Math.round(len / 0.75));
    for (let i = 0; i < n; i++) {
      const w = ctx.glowPlane(0.7, 0.9, 'banheiros', { color: 0xffe2bc, base: 0.28, day: 0.1 });
      w.position.set(-len / 2 + (len / n) * (i + 0.5), 2.5, 0.006); g.add(w);
    }
    return g;
  };
  // Lixeira inox com pedal
  const binSteel = (r = 0.13, h = 0.45) => {
    const g = G();
    g.add(cyl(r, r * 0.93, h, M.steel, 0, h / 2 + 0.02, 0, 18));
    g.add(cyl(r + 0.005, r + 0.005, 0.03, M.chrome, 0, h + 0.035, 0, 18));
    g.add(cyl(r * 0.95, r * 0.95, 0.02, black, 0, 0.01, 0, 18));
    g.add(box(0.1, 0.02, 0.07, black, 0, 0.03, r + 0.02));
    return g;
  };

  // =====================================================================
  // WC (x 0,087–1,825 · z 44,075–46,225) — porta na parede z = 46,3 (x 0,5–1,3)
  // =====================================================================
  {
    // revestimentos: bancada na parede x = 0 (mármore marrom em cima); marmorato nas outras
    wcWall('x', 0.087, 1, 44.212, 46.225, MARR);                                  // parede x = 0 (face 0,087)
    wcWall('z', 44.075, 1, 0.212, 1.825, MARM);                                   // parede z = 44,0
    wcWall('x', 1.825, -1, 44.087, 46.225, MARM);                                 // parede x = 1,9
    wcWall('z', 46.225, -1, 0.099, 1.813, MARM, 0.09, [[0.4, 1.4]]);              // parede da porta (z = 46,3)
    // pilar do canto (x 0–0,2 · z 43,8–44,2) encapado no mesmo padrão
    put(box(0.125, 1.11, 0.137, PORC, 0.1495, 0.645, 44.1435, nc));
    put(box(0.125, 1.79, 0.137, MARR, 0.1495, 2.095, 44.1435, nc));
    // bancada (x 0,099–0,599 · z 44,32–45,22), cuba de apoio e espelho de LED
    place(vanity(0.9, 0.5, 0.86, [0], 0.72, 0.86, 1.28), 0.099, 44.77, Math.PI / 2);
    place(ctx.F.toilet(), 1.38, 44.39, 0);
    // papeleira preta e ducha higiênica na parede x = 1,9; dispenser de papel-toalha e lixeira de pedal
    put(box(0.03, 0.1, 0.12, black, 1.8, 0.72, 44.72));
    put(cyl(0.055, 0.055, 0.1, paper, 1.735, 0.69, 44.72, 12)).rotation.x = Math.PI / 2;
    put(box(0.04, 0.08, 0.05, M.chrome, 1.79, 0.62, 44.3));
    put(box(0.1, 0.3, 0.26, whiteF, 0.155, 1.4, 45.52));
    put(box(0.004, 0.08, 0.16, M.screenOff, 0.207, 1.33, 45.52, nc));
    place(binSteel(0.12, 0.42), 1.62, 45.15);
    // vasinho com planta sobre a bancada
    put(cyl(0.045, 0.035, 0.09, ceramic, 0.22, 0.905, 45.12, 10));
    for (let i = 0; i < 3; i++) put(sph(0.045, frond2, 0.22 + (i - 1) * 0.025, 0.99 + (i % 2) * 0.02, 45.12));
  }

  // =====================================================================
  // WC PCD (x 1,975–3,925 · z 44,075–46,225) — porta na parede x = 4,0 (z 44,4–45,3)
  // =====================================================================
  {
    wcWall('z', 44.075, 1, 1.975, 3.925, MARR);                                   // parede da bancada (z = 44,0)
    wcWall('x', 1.975, 1, 44.087, 46.225, MARM);                                  // parede x = 1,9
    wcWall('z', 46.225, -1, 1.987, 3.913, MARM);                                  // parede z = 46,3 (atrás do vaso)
    wcWall('x', 3.925, -1, 44.087, 46.213, MARM, 0.09, [[44.3, 45.4]]);           // parede da porta (x = 4,0)
    place(ctx.F.toilet(), 2.45, 45.88, Math.PI);
    // barras de apoio: lateral (parede x = 1,9), de fundo (z = 46,3) e vertical
    const XW = 1.987, XS = XW + 0.05, ZW = 46.213, ZB = ZW - 0.05;
    put(bar(XS, 0.76, 45.2, XS, 0.76, 46.05, 0.017, grabBar));
    for (const z of [45.2, 46.05]) put(bar(XW, 0.76, z, XS, 0.76, z, 0.015, grabBar));
    put(bar(XS, 0.9, 45.1, XS, 1.6, 45.1, 0.017, grabBar));
    for (const y of [0.9, 1.6]) put(bar(XW, y, 45.1, XS, y, 45.1, 0.015, grabBar));
    put(bar(2.1, 0.9, ZB, 2.9, 0.9, ZB, 0.017, grabBar));
    for (const x of [2.1, 2.9]) put(bar(x, 0.9, ZW, x, 0.9, ZB, 0.015, grabBar));
    // bancada suspensa acessível (tampo a 0,80 m, sem gabinete) com cuba de apoio baixa e barras em U
    const LX = 2.5, ZF = 44.087;
    place(vanity(0.7, 0.46, 0.8, [0], 0.6, 0.9, 1.05), LX, ZF, 0);
    for (const sx of [-1, 1]) put(bar(LX + sx * 0.42, 0.76, ZF, LX + sx * 0.42, 0.76, ZF + 0.56, 0.016, grabBar));
    put(bar(LX - 0.42, 0.76, ZF + 0.56, LX + 0.42, 0.76, ZF + 0.56, 0.016, grabBar));
    // alarme de emergência (cordão), lixeira de pedal, papeleira e dispenser
    put(box(0.03, 0.1, 0.1, alarm, XW + 0.015, 0.45, 45.62));
    put(box(0.02, 0.4, 0.02, alarm, XW + 0.035, 0.22, 45.64));
    place(binSteel(0.12, 0.42), 3.62, 45.98);
    put(box(0.03, 0.12, 0.12, black, XW + 0.015, 0.95, 45.55));
    put(cyl(0.055, 0.055, 0.1, paper, XW + 0.08, 0.9, 45.55, 12)).rotation.x = Math.PI / 2;
    put(box(0.26, 0.3, 0.1, whiteF, 3.35, 1.4, ZF + 0.05));
    // símbolo de acessibilidade na parede da bancada
    put(box(0.2, 0.2, 0.006, std({ color: 0x1f5fae, roughness: 0.5 }), 3.35, 1.85, ZF + 0.003, nc));
  }

  // =====================================================================
  // DETALHES DE REALISMO (v1.5.1): interruptores e tomadas junto às portas, blocos autônomos de
  // emergência sobre as saídas, porta-guarda-chuvas na entrada e ralos dos WCs. Placas 4×2" a ≥ 3 mm
  // da face da parede (sem z-fighting); nada no giro das portas nem no caminho das pessoas.
  // =====================================================================
  {
    // placa 4×2" na parede — axis 'x': parede paralela a x (face em z = f); axis 'z': face em x = f. dir = lado da sala.
    const plate = (axis, f, dir, t, y, kind) => {
      const d = 0.012, c = f + dir * d / 2, dd = 0.006, cc = f + dir * (d + dd / 2);
      if (axis === 'x') {
        put(box(0.075, 0.12, d, whiteF, t, y, c, nc));
        put(kind === 'sw' ? box(0.03, 0.045, dd, ceramic, t, y + 0.01, cc, nc) : box(0.034, 0.034, dd, felt, t, y, cc, nc));
      } else {
        put(box(d, 0.12, 0.075, whiteF, c, y, t, nc));
        put(kind === 'sw' ? box(dd, 0.045, 0.03, ceramic, cc, y + 0.01, t, nc) : box(dd, 0.034, 0.034, felt, cc, y, t, nc));
      }
    };
    // bloco autônomo de emergência (2 faróis) — mesma convenção de eixos
    const emergLight = (axis, f, dir, t, y) => {
      const c = f + dir * 0.045, h = f + dir * 0.105;
      if (axis === 'x') { put(box(0.3, 0.1, 0.09, whiteF, t, y, c)); for (const k of [-0.09, 0.09]) put(box(0.06, 0.05, 0.03, black, t + k, y - 0.02, h, nc)); }
      else { put(box(0.09, 0.1, 0.3, whiteF, c, y, t)); for (const k of [-0.09, 0.09]) put(box(0.03, 0.05, 0.06, black, h, y - 0.02, t + k, nc)); }
    };
    // ralo quadrado de inox com grelha escura, rente ao porcelanato (y 0,004)
    const drain = (x, z) => { put(box(0.1, 0.006, 0.1, M.steel, x, 0.008, z, nc)); put(box(0.08, 0.004, 0.08, felt, x, 0.013, z, nc)); };

    // Hall: interruptores ao lado da porta principal (face interna z 49,575), tomadas baixas, blocos autônomos
    plate('x', 49.575, -1, 10.45, 1.15, 'sw'); plate('x', 49.575, -1, 10.35, 1.15, 'sw');
    plate('x', 44.075, 1, 9.0, 0.3, 'out');
    emergLight('x', 44.075, 1, 11.85, 2.5);                                     // sobre as portas de vidro do templo
    emergLight('x', 49.575, -1, 9.75, 2.55);                                    // ao lado do portal da entrada
    // porta-guarda-chuvas preto entre o café e o portal (x 10,25–10,45)
    put(cyl(0.1, 0.09, 0.5, black, 10.35, 0.25, 49.42, 16));
    put(cyl(0.085, 0.085, 0.01, felt, 10.35, 0.505, 49.42, 16));
    for (const [dx, dz, ry] of [[-0.03, 0.02, 0.2], [0.035, -0.015, -0.35]]) { const u = cyl(0.014, 0.02, 0.62, caramel, 10.35 + dx, 0.62, 49.42 + dz, 8); u.rotation.z = ry * 0.4; u.rotation.x = ry * 0.3; put(u); }
    // WC / WC PCD: ralos
    drain(1.35, 45.0); drain(3.4, 45.4);
  }
}

function roomAlaDireita(ctx) {
  // ---------------------------------------------------------------------------
  // ALA DIREITA (x 16,05–20,1 · z 11,0–49,5): corredor da entrada lateral,
  // circulação, sala de mídia, voluntariado, circ./depósito/área técnica,
  // WC masculino, hall dos banheiros e WC feminino.
  // REFERÊNCIA MÁXIMA = vídeos do cliente: v4 (mídia: placas acústicas grafite,
  // bancada preta no visor, road case turquesa, cadeiras azul/preto e plásticas),
  // v2 (voluntariado: cortina, sofás cinza, letreiro "FAÇAM TUDO…", poltronas
  // capitonê terracota, parede de marmorato com split (do cartão), prateleiras, buffet
  // grafite + frigobar; depósito com estantes pretas e caixas organizadoras),
  // v3 (banheiros: porcelanato cinza até 1,3 m e marrom imperador acima, bancada
  // branca com cubas de apoio, espelhos com moldura de LED fria, bebedouro inox,
  // entrada com faixa azul-escura e pictograma), v1/v5 (corredores: fundo em
  // marmorato, placa vermelha "SAÍDA DE EMERGÊNCIA").
  // Pisos, rodapés, portas e caixilhos são do cartão. Nada de luzes.
  // Faces internas das paredes: x 16,125 (templo) · 17,025/17,175 · 18,825/18,975
  // · 20,013 (muro, com revestimento) · z 19,075 · 23,225/23,375 · 27,925/28,075
  // · 33,825/33,975 · 35,825/35,975 · 36,925/37,075 · 40,725/40,875 ·
  // 44,225/44,375 · 49,413. Pilares do templo (lado claro até x 16,25) em
  // z 12,4 · 18,3 · 23,2 · 28,0 · 33,7 · 39,3 · 44,0 (±0,2).
  // ---------------------------------------------------------------------------
  const { THREE, box, cyl, sph, place, add, std, rnd, M } = ctx;
  const PI = Math.PI, HPI = PI / 2;
  const G = () => new THREE.Group();
  const nc = { cast: false };

  // ---- materiais (ctx.std com as mesmas opções → mesmo material → merge) ----
  const woodL   = std({ color: 0xcfa97c, roughness: 0.7 });                 // madeira clara
  const woodM   = std({ color: 0xa87c52, roughness: 0.72 });                // madeira média (pés, molduras)
  const black   = std({ color: 0x18181b, roughness: 0.5, metalness: 0.2 }); // estrutura preta
  const blackGl = std({ color: 0x151517, roughness: 0.22 });                 // plástico preto brilhante
  const graph   = std({ color: 0x3a3b3f, roughness: 0.6 });                 // cinza grafite
  const graphL  = std({ color: 0x5b5d63, roughness: 0.7 });
  const hpl     = std({ color: 0x45474c, roughness: 0.45 });                // divisórias das cabines
  const white   = std({ color: 0xf1f0ec, roughness: 0.5 });
  const quartz  = std({ color: 0xf4f2ee, roughness: 0.25 });                // bancada de quartzo branco
  const china   = std({ color: 0xf7f7f5, roughness: 0.18 });                // louça sanitária
  const smoke   = std({ color: 0x1c2126, roughness: 0.08, metalness: 0.5 }); // vidro fumê/preto (portas das cabines)
  const inox    = std({ color: 0xc4c9cd, roughness: 0.3, metalness: 0.75 }); // aço inox escovado
  const benchTop = std({ color: 0x1d1d20, roughness: 0.32 });               // tampo preto da bancada da mídia
  const blueSeat = std({ color: 0x27406e, roughness: 0.85 });               // tecido azul das cadeiras de operador
  const turq    = std({ color: 0x1fa3c2, roughness: 0.35, metalness: 0.2 }); // road case azul-turquesa
  const padBlue = std({ color: 0x2c4fa0, roughness: 0.8 });
  const terraV  = std({ color: 0xb4531e, roughness: 0.82 });                // veludo terracota (poltronas)
  const terraD  = std({ color: 0x7a3413, roughness: 0.9 });                 // botões do capitonê
  const sofaG   = std({ color: 0x9e9e9b, roughness: 0.97 });                // sofá cinza
  const sofaG2  = std({ color: 0xaaaaa7, roughness: 0.97 });
  sofaG.userData.noShare = true; sofaG2.userData.noShare = true;                // o merge não troca o cinza do sofá por outro tom
  const pilDk   = std({ color: 0x46474b, roughness: 0.97 });                // almofada cinza-escuro
  const curtain = std({ color: 0xc9c8c4, roughness: 1 });                   // cortina cinza-claro
  const slate   = std({ color: 0x4b525c, roughness: 0.6 });                 // buffet cinza-grafite (azulado)
  const shelfG  = std({ color: 0x5d636b, roughness: 0.55 });                // prateleiras flutuantes
  const gold    = std({ color: 0xc9a24f, roughness: 0.3, metalness: 0.85 }); // puxadores dourados
  const redCup  = std({ color: 0xc62222, roughness: 0.4 });
  const greenGl = std({ color: 0x4d7a52, roughness: 0.15, transparent: true, opacity: 0.75 });
  const clearGl = std({ color: 0xe6eef2, roughness: 0.08, transparent: true, opacity: 0.35 });
  const clearBx = std({ color: 0xdfe6ea, roughness: 0.2, transparent: true, opacity: 0.42 }); // caixa organizadora transparente
  const lidG    = std({ color: 0x7c8087, roughness: 0.5 });
  const redExt  = std({ color: 0xc4201b, roughness: 0.35, metalness: 0.1 });
  const pvc     = std({ color: 0xe9e9e4, roughness: 0.6 });
  const copper  = std({ color: 0xb8733f, roughness: 0.35, metalness: 0.7 });
  const potBlk  = std({ color: 0x1c1c1e, roughness: 0.55 });
  const frond   = std({ color: 0x2f5a2a, roughness: 0.9 });
  const frond2  = std({ color: 0x3d6e34, roughness: 0.9 });
  const trunk   = std({ color: 0x5b4632, roughness: 1 });
  const ledG    = std({ color: 0x0f2a18, emissive: 0x22c55e, emissiveIntensity: 1.2 });
  const ledR    = std({ color: 0x3a0a0a, emissive: 0xff3030, emissiveIntensity: 1.2 });
  const ledB    = std({ color: 0x0a1a3a, emissive: 0x3aa0ff, emissiveIntensity: 1.2 });
  const ledA    = std({ color: 0x3a2a0a, emissive: 0xffb040, emissiveIntensity: 1.2 });
  const lampW   = std({ color: 0xf4f4f0, roughness: 0.3 });                 // luminária de emergência / placas
  // moldura de LED fria dos espelhos (v3): acende com a luz dos banheiros
  const ledCold = ctx.bindEmissive('banheiros', std({ color: 0xe8f7ff, emissive: 0xbfeaff, emissiveIntensity: 1, roughness: 0.4 }), 1.4, { min: 0.12 });
  // plafon quadrado dos corredores: acende com a circulação
  const plafMat = ctx.bindEmissive('circulacao', std({ color: 0xf7f5ef, emissive: 0xfff4e0, emissiveIntensity: 1, roughness: 0.4 }), 1.1, { min: 0.05 });
  const bins    = [graphL, std({ color: 0x2f5f8b, roughness: 0.6 }), std({ color: 0xc98a3c, roughness: 0.85 }), std({ color: 0x3f7d3a, roughness: 0.7 }), redCup, white];

  // ---- utilidades ------------------------------------------------------------
  const rod = (r, len, mat, x, y, z, axis, seg = 8) => {
    const m = cyl(r, r, len, mat, x, y, z, seg);
    if (axis === 'x') m.rotation.z = HPI; else if (axis === 'z') m.rotation.x = HPI;
    return add(m);
  };
  // Material com CanvasTexture desenhada num espaço virtual W×100 (W = 100·aspecto)
  const texMat = (aspect, draw, glow = 0, size = 256) => {
    const W = 100 * aspect, Hv = 100;
    const tex = ctx.makeTex(size, (g, s) => { g.save(); g.scale(s / W, s / Hv); draw(g, W, Hv); g.restore(); });
    return glow ? new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow, roughness: 0.35 })
      : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  };
  const text = (g, str, x, y, px, color, weight = 'bold', align = 'center') => {
    g.font = `${weight} ${px}px Arial, Helvetica, sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(str, x, y);
  };
  // Revestimento de 12 mm numa parede: axis 'z' = parede ao longo de Z (face em f, sala para o lado dir),
  // 'x' = parede ao longo de X. (a, b) = trecho ao longo da parede, (y0, y1) = alturas.
  const clad = (axis, f, dir, a, b, y0, y1, mat, t = 0.012) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return null;
    const c = f + dir * t / 2, ym = (y0 + y1) / 2;
    return add(axis === 'z' ? box(t, y1 - y0, b - a, mat, c, ym, (a + b) / 2, nc) : box(b - a, y1 - y0, t, mat, (a + b) / 2, ym, c, nc));
  };
  // meia parede dos banheiros: porcelanato cinza até 1,3 m e marrom imperador (ou marmorato) acima
  const WAIN = 1.3, YB = 0.095, YT = 2.985;
  const wetWall = (axis, f, dir, a, b, upper) => { clad(axis, f, dir, a, b, YB, WAIN, M.porcelanatoCinza); clad(axis, f, dir, a, b, WAIN, YT, upper); };
  // Cica em vaso preto (como na fachada)
  const cica = (x, z, reach = 0.45, s = 1) => {
    const g = G();
    g.add(cyl(0.19, 0.15, 0.46, potBlk, 0, 0.23, 0, 16));
    g.add(cyl(0.175, 0.175, 0.02, M.soil, 0, 0.45, 0, 14));
    g.add(cyl(0.06, 0.085, 0.24, trunk, 0, 0.56, 0, 8));
    const n = 10, a0 = rnd() * PI;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * PI * 2 + rnd() * 0.25, t = 0.6 + rnd() * 0.45, L = reach * (0.85 + rnd() * 0.25);
      const f = box(0.1, 0.012, L, i % 2 ? frond : frond2, 0, 0, 0);
      f.rotation.order = 'YXZ'; f.rotation.set(-t, a, 0);
      f.position.set(Math.cos(t) * Math.sin(a) * L / 2, 0.66 + Math.sin(t) * L / 2, Math.cos(t) * Math.cos(a) * L / 2);
      g.add(f);
    }
    g.scale.setScalar(s);
    return place(g, x, z, 0);
  };
  // Placa do extintor (fundo vermelho, pictograma branco)
  const extSign = texMat(0.77, (g, W, Hh) => {
    g.fillStyle = '#c4201b'; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = '#f7f1e6'; g.lineWidth = 2.2; g.strokeRect(4, 4, W - 8, Hh - 8);
    g.fillStyle = '#f7f1e6'; const cx = W / 2;
    g.beginPath(); g.moveTo(cx - 11, 30); g.lineTo(cx + 11, 30); g.lineTo(cx + 11, 72); g.quadraticCurveTo(cx + 11, 78, cx + 5, 78);
    g.lineTo(cx - 5, 78); g.quadraticCurveTo(cx - 11, 78, cx - 11, 72); g.closePath(); g.fill();
    g.fillRect(cx - 4, 20, 8, 10); g.fillRect(cx - 12, 16, 22, 5);
    g.lineWidth = 3; g.beginPath(); g.moveTo(cx + 9, 18); g.quadraticCurveTo(cx + 24, 22, cx + 20, 46); g.stroke();
    text(g, 'EXTINTOR', cx, 89, 10, '#f7f1e6');
  });
  const extintor = (xf, z, dir) => {
    const xc = xf + dir * 0.09;
    add(box(0.01, 0.5, 0.2, black, xf + dir * 0.005, 0.62, z));
    add(cyl(0.075, 0.075, 0.46, redExt, xc, 0.55, z, 14));
    add(cyl(0.076, 0.076, 0.05, black, xc, 0.36, z, 14));
    add(cyl(0.03, 0.04, 0.08, black, xc, 0.82, z, 10));
    add(box(0.12, 0.02, 0.03, black, xf + dir * 0.1, 0.87, z));
    add(cyl(0.01, 0.01, 0.34, black, xc + dir * 0.03, 0.66, z - 0.085, 6));
    add(box(0.006, 0.26, 0.2, extSign, xf + dir * 0.004, 1.42, z, nc));
  };
  const plaque = (axis, c, t, y, w, h, mat) => add(axis === 'z' ? box(0.01, h, w, mat, c, y, t, nc) : box(w, h, 0.01, mat, t, y, c, nc));
  const doorSign = (label) => texMat(2.2, (g, W, Hh) => {
    g.fillStyle = '#141416'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#c98a3c'; g.fillRect(12, 70, 40, 4);
    text(g, label, 12, 42, 24, '#f3efe6', 'bold', 'left');
    ctx.logo.draw(g, W - 40, 26, 30, { layout: 'mark', color: '#8d8f95' });
  }, 0, 512);
  // Placa verde de SAÍDA (bloco autônomo, sempre acesa). arrow: -1 esquerda, 0 nenhuma, 1 direita
  const exitMat = (arrow) => texMat(2.6, (g, W, Hh) => {
    g.fillStyle = '#0f7a3a'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#f2fff4';
    const mx = arrow < 0 ? W - 48 : 28;
    g.save(); if (arrow < 0) { g.translate(2 * mx + 8, 0); g.scale(-1, 1); }
    g.beginPath(); g.arc(mx + 10, 24, 7, 0, PI * 2); g.fill();
    g.lineWidth = 7; g.lineCap = 'round'; g.strokeStyle = '#f2fff4';
    g.beginPath(); g.moveTo(mx + 6, 36); g.lineTo(mx - 2, 62); g.moveTo(mx + 6, 36); g.lineTo(mx + 20, 48); g.moveTo(mx - 2, 62); g.lineTo(mx - 12, 84);
    g.moveTo(mx - 2, 62); g.lineTo(mx + 14, 72); g.lineTo(mx + 16, 86); g.moveTo(mx + 5, 40); g.lineTo(mx - 10, 46); g.stroke();
    g.restore();
    text(g, 'SAÍDA', W / 2 + (arrow < 0 ? -12 : 14), 52, 34, '#f2fff4');
    if (arrow) {
      const ax = arrow < 0 ? 18 : W - 18, s = arrow;
      g.beginPath(); g.moveTo(ax + s * 14, 50); g.lineTo(ax - s * 4, 30); g.lineTo(ax - s * 4, 70); g.closePath(); g.fill();
    }
  }, 0.9);
  const exitSign = (axis, f, t, y, dir, arrow = 0) => {
    const m = exitMat(arrow);
    if (axis === 'x') { add(box(0.36, 0.15, 0.03, lampW, t, y, f + dir * 0.015)); add(box(0.33, 0.125, 0.004, m, t, y, f + dir * 0.032, nc)); }
    else { add(box(0.03, 0.15, 0.36, lampW, f + dir * 0.015, y, t)); add(box(0.004, 0.125, 0.33, m, f + dir * 0.032, y, t, nc)); }
  };
  const emerg = (axis, f, t, y, dir) => {
    const g = G();
    g.add(box(0.32, 0.075, 0.06, lampW, 0, 0, 0.03));
    for (const sx of [-0.1, 0.1]) { const h = cyl(0.028, 0.034, 0.05, lampW, sx, -0.02, 0.075, 12); h.rotation.x = HPI + 0.5; g.add(h); }
    g.add(box(0.03, 0.01, 0.004, ledG, 0, 0.012, 0.062, nc));
    if (axis === 'x') place(g, t, f, dir > 0 ? 0 : PI, y); else place(g, f, t, dir > 0 ? HPI : -HPI, y);
  };
  // Plano virado para +z (logo/brilho) → posiciona e gira em torno de Y
  const at = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; return add(m); };
  // Pictograma dos banheiros (placa curva de alumínio sobre a porta, v3): fem = mulher, senão homem
  const picto = (fem) => texMat(1.6, (g, W, Hh) => {
    g.fillStyle = '#e9ebed'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#2a2b2f'; const cx = W / 2;
    g.beginPath(); g.arc(cx, 18, 8, 0, PI * 2); g.fill();
    if (fem) { g.beginPath(); g.moveTo(cx, 28); g.lineTo(cx + 15, 62); g.lineTo(cx - 15, 62); g.closePath(); g.fill(); g.fillRect(cx - 7, 62, 5, 14); g.fillRect(cx + 2, 62, 5, 14); }
    else { g.fillRect(cx - 11, 29, 22, 30); g.fillRect(cx - 10, 58, 8, 18); g.fillRect(cx + 2, 58, 8, 18); }
    text(g, fem ? 'MULHER' : 'HOMEM', cx, 88, 11, '#2a2b2f');
  });
  const doorPicto = (axis, f, t, dir, fem) => {
    const m = picto(fem);
    if (axis === 'z') { add(box(0.03, 0.2, 0.34, inox, f + dir * 0.015, 2.36, t)); add(box(0.004, 0.18, 0.3, m, f + dir * 0.032, 2.36, t, nc)); }
    else { add(box(0.34, 0.2, 0.03, inox, t, 2.36, f + dir * 0.015)); add(box(0.3, 0.18, 0.004, m, t, 2.36, f + dir * 0.032, nc)); }
  };
  // Espelho com moldura de LED fria. face = parede; ry = rotação que leva +z para a sala
  const ledMirror = (x, y, z, w, h, ry) => {
    const g = G();
    g.add(box(w, h, 0.012, M.mirror, 0, 0, 0.006, nc));
    const s = 0.018;
    g.add(box(w + s * 2, s, 0.012, ledCold, 0, h / 2 + s / 2, 0.012, nc)); g.add(box(w + s * 2, s, 0.012, ledCold, 0, -h / 2 - s / 2, 0.012, nc));
    g.add(box(s, h, 0.012, ledCold, -w / 2 - s / 2, 0, 0.012, nc)); g.add(box(s, h, 0.012, ledCold, w / 2 + s / 2, 0, 0.012, nc));
    place(g, x, z, ry, y);
    const halo = ctx.glowPlane(w + 0.34, h + 0.34, 'banheiros', { color: 0xcdefff, base: 0.5, day: 0.25, tex: 'frame' });
    const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    at(halo, x + n.x * 0.02, y, z + n.z * 0.02, ry);
  };
  // Cuba de apoio retangular branca com torneira de mesa cromada (frente = +z local)
  const vessel = () => {
    const g = G();
    g.add(box(0.46, 0.12, 0.34, china, 0, 0.06, 0));
    g.add(box(0.4, 0.004, 0.28, std({ color: 0xdfe3e6, roughness: 0.2 }), 0, 0.119, 0, nc));
    g.add(cyl(0.014, 0.018, 0.3, M.chrome, 0, 0.15, -0.23, 10));
    g.add(box(0.022, 0.022, 0.15, M.chrome, 0, 0.3, -0.165));
    return g;
  };

  // =====================================================================
  // CORREDOR DA ENTRADA LATERAL (x 16,05–17,1 · z 11,0–19,0)
  // Portas em x=17,1: Gilvan z 12,9–13,8 · Adm. z 14,4–15,3; porta PM01 (do pátio) em x=16,05, z 11,25–12,15 (v1.5.1).
  // =====================================================================
  // v1.5.1: a porta lateral (PM01) saiu da parede z = 11 e foi para a parede x = 16,05 (z 11,25–12,15) — capacho e placa foram junto
  add(box(0.62, 0.012, 0.8, std({ color: 0x1a1a1c, roughness: 0.92 }), 16.47, 0.008, 11.7, nc));   // capacho grafite com a marca
  { const m = ctx.logo.mesh(0.44, 0, { layout: 'mark', color: '#bdb6a8', roughness: 1, cast: false }); m.rotation.set(-HPI, 0, -HPI); m.position.set(16.47, 0.0155, 11.7); add(m); }
  // placa vermelha "SAÍDA DE EMERGÊNCIA" sobre a porta lateral (v5)
  const sosMat = texMat(1.45, (g, W, Hh) => {
    g.fillStyle = '#c21d1d'; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeRect(4, 4, W - 8, Hh - 8);
    g.fillStyle = '#ffffff'; g.fillRect(12, 12, W - 24, 34);
    text(g, 'SAÍDA', W / 2, 30, 26, '#c21d1d', '900');
    text(g, 'DE', W / 2, 60, 15, '#ffffff');
    text(g, 'EMERGÊNCIA', W / 2, 80, 15, '#ffffff');
  }, 0, 512);
  add(box(0.008, 0.25, 0.36, sosMat, 16.132, 2.5, 11.7, nc));
  emerg('z', 17.025, 16.25, 2.45, -1);
  extintor(17.025, 12.1, -1);
  plaque('z', 17.018, 12.62, 1.6, 0.3, 0.13, doorSign('SALA GILVAN'));
  plaque('z', 17.018, 14.17, 1.6, 0.3, 0.13, doorSign('ADMINISTRATIVO'));
  // plafons quadrados embutidos (forro): só a placa de LED
  for (const z of [12.9, 16.3]) add(box(0.32, 0.02, 0.32, plafMat, 16.58, 2.975, z, nc));
  // cartazes emoldurados na parede do templo (entre os pilares de z 12,4 e 18,3)
  const poster1 = texMat(0.72, (g, W, Hh) => {
    const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#1b1b1f'); gr.addColorStop(1, '#3a2a1f');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    ctx.logo.draw(g, W / 2 - 9, 8, 18, { layout: 'mark', color: '#f4f5f7' });
    g.fillStyle = '#c98a3c'; g.fillRect(W / 2 - 10, 33, 20, 1.2);
    text(g, 'SÉRIE', W / 2, 42, 6, '#cfcfd4');
    text(g, 'RAÍZES', W / 2, 55, 15, '#f4f5f7', '900');
    g.strokeStyle = '#c98a3c'; g.lineWidth = 1.2;
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(W / 2, 64); g.quadraticCurveTo(W / 2 + i * 4, 72, W / 2 + i * 8, 82 - Math.abs(i)); g.stroke(); }
    text(g, 'DOMINGOS · 9H E 18H', W / 2, 92, 4.6, '#cfcfd4');
  }, 0, 512);
  const poster2 = texMat(0.72, (g, W, Hh) => {
    g.fillStyle = '#c98a3c'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#141416'; g.fillRect(0, 58, W, Hh - 58);
    text(g, 'BASE', 6, 22, 17, '#141416', '900', 'left');
    text(g, 'JOVEM', 6, 40, 17, '#141416', '900', 'left');
    text(g, 'SEXTAS · 20H', 6, 52, 6, '#141416', 'bold', 'left');
    ctx.logo.draw(g, W / 2 - 16, 64, 32, { layout: 'wide', color: '#f4f5f7' });
    text(g, '802 SUL · PALMAS', W / 2, 90, 4.4, '#8d8f95');
  }, 0, 512);
  [[13.9, poster1], [15.6, poster2]].forEach(([z, pm]) => {
    add(box(0.03, 0.9, 0.66, black, 16.14, 1.55, z));
    add(box(0.006, 0.84, 0.6, white, 16.157, 1.55, z, nc));
    add(box(0.004, 0.76, 0.54, pm, 16.161, 1.55, z, nc));
  });

  // =====================================================================
  // CIRCULAÇÃO (x 16,05–20,1 · z 19,0–23,3) + corredor x 18,9–20,1 · z 23,3–28,0
  // Fundo em marmorato: parede x = 20,1 (circulação + corredor da mídia) e a parede
  // da mídia (z 23,3) vista de quem entra pelo corredor lateral.
  // =====================================================================
  clad('z', 20.013, -1, 19.075, 27.925, 0.075, 2.985, M.marmorato);
  clad('x', 23.225, -1, 16.26, 17.8, 0.075, 2.985, M.marmorato);
  for (const [x, z] of [[18.1, 20.4], [18.1, 22.1], [19.5, 26.6]]) add(box(0.32, 0.02, 0.32, plafMat, x, 2.975, z, nc));
  // Aparador + quadro de avisos na parede z=19
  {
    const g = G();
    g.add(box(1.2, 0.04, 0.4, woodL, 0, 0.8, 0));
    g.add(box(1.14, 0.2, 0.36, black, 0, 0.68, 0));
    for (const sx of [-0.3, 0.3]) g.add(box(0.2, 0.012, 0.01, woodL, sx, 0.68, 0.181, nc));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.03, 0.58, 0.03, black, sx * 0.55, 0.29, sz * 0.16));
    g.add(cyl(0.07, 0.09, 0.22, potBlk, -0.38, 0.93, 0, 12));
    g.add(sph(0.14, frond2, -0.38, 1.12, 0)); g.add(sph(0.1, frond, -0.32, 1.2, 0.04));
    g.add(box(0.21, 0.02, 0.15, white, 0.05, 0.83, 0.05));
    g.add(box(0.17, 0.05, 0.24, black, 0.38, 0.845, 0.0));                                   // Bíblia
    place(g, 18.9, 19.37, 0);
    add(box(1.24, 0.84, 0.03, woodM, 18.9, 1.62, 19.09));                                    // quadro de avisos
    add(box(1.16, 0.76, 0.012, std({ color: 0xb98e5e, roughness: 1 }), 18.9, 1.62, 19.111, nc));
    const papers = [white, std({ color: 0xf3d77a, roughness: 1 }), std({ color: 0xa9cbe6, roughness: 1 })];
    for (let i = 0; i < 6; i++) {
      const p = box(0.2, 0.25, 0.004, papers[i % 3], 18.5 + (i % 3) * 0.4 + rnd() * 0.04, 1.8 - Math.floor(i / 3) * 0.36, 19.119, nc);
      p.rotation.z = (rnd() - 0.5) * 0.12; add(p);
    }
  }
  // Banco ripado na parede de marmorato (sala de espera)
  {
    const g = G();
    for (let i = 0; i < 5; i++) g.add(box(0.066, 0.035, 1.6, woodL, -0.16 + i * 0.08, 0.45, 0));
    for (const sz of [-0.62, 0.62]) {
      g.add(box(0.4, 0.03, 0.05, black, 0, 0.418, sz));
      g.add(box(0.035, 0.42, 0.035, black, -0.17, 0.21, sz)); g.add(box(0.035, 0.42, 0.035, black, 0.17, 0.21, sz));
    }
    place(g, 19.72, 20.85, 0);
  }
  // quadros no marmorato, acima do banco
  [[20.3, 0xcfa97c], [21.35, 0x8d8f95]].forEach(([z, c]) => {
    add(box(0.03, 0.62, 0.46, black, 19.985, 1.55, z));
    add(box(0.006, 0.56, 0.4, white, 19.967, 1.55, z, nc));
    add(box(0.006, 0.36, 0.22, std({ color: c, roughness: 0.9 }), 19.963, 1.57, z, nc));
  });
  exitSign('x', 19.075, 17.55, 2.45, 1, -1);                                                  // SAÍDA ← (corredor lateral)
  emerg('x', 23.213, 16.75, 2.5, -1);
  // Corredor da mídia: TV com a agenda da semana (parede x=20,1) e quadros (parede x=18,9)
  const agenda = texMat(1.75, (g, W, Hh) => {
    const gr = g.createLinearGradient(0, 0, W, Hh); gr.addColorStop(0, '#15151a'); gr.addColorStop(1, '#2a2230');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#c98a3c'; g.fillRect(10, 12, 4, 16);
    text(g, 'AGENDA DA SEMANA', 20, 20, 11, '#f3efe6', 'bold', 'left');
    const rows = [['DOM', '9h e 18h', 'Cultos de celebração'], ['QUA', '20h', 'Culto de ensino'], ['SEX', '20h', 'Base Jovem'], ['SÁB', '16h', 'Ensaio do louvor']];
    rows.forEach(([d, h, t], i) => {
      const y = 42 + i * 15;
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(10, y - 6, W - 20, 12);
      text(g, d, 14, y, 8, '#c98a3c', 'bold', 'left'); text(g, h, 36, y, 7.5, '#f3efe6', 'bold', 'left'); text(g, t, 78, y, 7.5, '#cfcfd4', 'normal', 'left');
    });
    ctx.logo.draw(g, W - 40, 84, 28, { layout: 'wide', color: '#8d8f95' });
  }, 0.8, 512);
  ctx.bindEmissive('circulacao', agenda, 0.8, { min: 0.12 });
  add(box(0.04, 0.6, 1.04, black, 19.978, 1.6, 25.1));
  add(box(0.004, 0.55, 0.98, agenda, 19.956, 1.6, 25.1, nc));
  [[24.3, 0xb3643f, 0xc98a3c], [26.6, 0xcfa97c, 0xb3643f]].forEach(([z, a, b]) => {
    add(box(0.03, 0.72, 0.52, black, 18.99, 1.6, z));
    add(box(0.006, 0.64, 0.44, white, 19.007, 1.6, z, nc));
    add(box(0.008, 0.46, 0.12, std({ color: a, roughness: 0.9 }), 19.012, 1.6, z - 0.1, nc));
    add(box(0.008, 0.2, 0.2, std({ color: b, roughness: 0.9 }), 19.014, 1.72, z + 0.1, nc));
  });

  // =====================================================================
  // MÍDIA (x 16,05–18,9 · z 23,3–28,0) — v4. Piso laminado do cartão.
  // Placas acústicas grafite em todas as paredes; bancada preta longa sob o visor
  // J12 (de frente para o palco); cadeiras de operador azul/preto; cadeiras
  // plásticas pretas na parede oposta; gabinete com impressora; câmera (o split é do cartão).
  // Porta x 17,9–18,8 (z=23,3) → giro x 17,9–18,8 · z 23,4–24,3 livre.
  // =====================================================================
  const AC = M.acustico, AY0 = 0.08, AY1 = 2.98;
  clad('z', 16.125, 1, 23.41, 27.79, 2.2, AY1, AC, 0.04);                                   // acima do visor
  clad('z', 16.125, 1, 23.41, 27.79, AY0, 1.05, AC, 0.04);                                  // abaixo do peitoril
  clad('x', 23.375, 1, 16.26, 17.8, AY0, AY1, AC, 0.04);                                    // parede da porta
  clad('x', 23.375, 1, 17.8, 18.785, 2.3, AY1, AC, 0.04);                                   // acima da porta
  clad('z', 18.825, -1, 23.415, 27.885, AY0, AY1, AC, 0.04);                                // parede oposta ao visor
  clad('x', 27.925, -1, 16.26, 18.785, AY0, AY1, AC, 0.04);                                 // fundo (split + câmera)
  add(box(0.04, 2.9, 0.085, AC, 16.27, 1.53, 27.8425, nc));                                 // pilar revestido
  // Telas (CanvasTexture): multiview, transmissão, slides e DAW
  const stage = (g, x, y, w, h, kind) => {
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#120b24'); gr.addColorStop(1, '#3b1f5e');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    if (kind === 'plateia') {
      g.fillStyle = '#3a2a1a'; g.fillRect(x, y, w, h);
      g.fillStyle = '#1a1210';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) { g.beginPath(); g.arc(x + (c + 0.5 + (r % 2) * 0.4) * w / 9, y + h * (0.35 + r * 0.18), w * 0.035 + r * 0.6, 0, PI * 2); g.fill(); }
      g.fillStyle = '#5a3fd0'; g.fillRect(x + w * 0.35, y + h * 0.05, w * 0.3, h * 0.18);
      return;
    }
    if (kind === 'close') {
      g.fillStyle = '#e8c9a8'; g.beginPath(); g.arc(x + w / 2, y + h * 0.42, h * 0.2, 0, PI * 2); g.fill();
      g.fillStyle = '#18181b'; g.beginPath(); g.ellipse(x + w / 2, y + h * 1.02, w * 0.3, h * 0.42, 0, 0, PI * 2); g.fill();
      g.fillStyle = '#2a1f1a'; g.beginPath(); g.arc(x + w / 2, y + h * 0.34, h * 0.2, PI, 0); g.fill();
      return;
    }
    g.fillStyle = '#6d4fe0'; g.fillRect(x + w * 0.28, y + h * 0.1, w * 0.44, h * 0.34);
    g.fillStyle = 'rgba(255,220,160,0.25)';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + w * (0.2 + i * 0.2), y); g.lineTo(x + w * (0.12 + i * 0.2), y + h * 0.7); g.lineTo(x + w * (0.28 + i * 0.2), y + h * 0.7); g.fill(); }
    g.fillStyle = '#0c0c0e'; g.fillRect(x, y + h * 0.72, w, h * 0.28);
    g.fillStyle = '#050506';
    const n = kind === 'wide' ? 5 : 1;
    for (let i = 0; i < n; i++) { const px = x + w * (n === 1 ? 0.5 : 0.18 + i * 0.16); g.fillRect(px - w * 0.02, y + h * 0.5, w * 0.04, h * 0.23); g.beginPath(); g.arc(px, y + h * 0.47, w * 0.022, 0, PI * 2); g.fill(); }
  };
  const camMat = texMat(1.7778, (g, W, Hh) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
    const kinds = ['wide', 'close', 'plateia', 'pulpito'], w = W / 2, h = Hh / 2;
    kinds.forEach((k, i) => {
      const x = (i % 2) * w, y = Math.floor(i / 2) * h;
      stage(g, x + 1, y + 1, w - 2, h - 2, k);
      g.lineWidth = 2; g.strokeStyle = i === 0 ? '#ff2a2a' : i === 1 ? '#22c55e' : '#333'; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 4, y + h - 12, 26, 8);
      text(g, 'CAM ' + (i + 1), x + 17, y + h - 8, 6, '#fff');
    });
  }, 0.85, 512);
  const liveMat = texMat(1.7778, (g, W, Hh) => {
    stage(g, 0, 0, W, Hh, 'wide');
    g.fillStyle = '#e02424'; g.fillRect(6, 6, 30, 11); text(g, '● AO VIVO', 21, 11.5, 6.5, '#fff');
    g.fillStyle = 'rgba(20,20,24,0.85)'; g.fillRect(10, 74, 110, 14); g.fillStyle = '#c98a3c'; g.fillRect(10, 74, 3, 14);
    text(g, 'Culto de Celebração · Base Church', 17, 81, 6.5, '#fff', 'bold', 'left');
    ctx.logo.draw(g, W - 20, 5, 13, { layout: 'mark', color: '#ffffff' });
  }, 0.85, 512);
  const waveMat = texMat(1.7778, (g, W, Hh) => {
    g.fillStyle = '#16181c'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#23262c'; g.fillRect(0, 0, W, 8);
    const cols = ['#e0703a', '#3aa0ff', '#22c55e', '#c98a3c', '#b06cff', '#e04a6a'];
    for (let t = 0; t < 6; t++) {
      const y0 = 10 + t * 14.5, mid = y0 + 6.5;
      g.fillStyle = '#20232a'; g.fillRect(0, y0, W, 13.5);
      g.fillStyle = cols[t]; g.fillRect(0, y0, 18, 13.5);
      g.strokeStyle = cols[t]; g.lineWidth = 0.6; g.beginPath();
      for (let x = 20; x < W - 2; x += 0.8) { const a = (Math.sin(x * 0.07 + t) * 0.5 + 0.6) * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.9 + t * 3))) * 5.5; g.moveTo(x, mid - a); g.lineTo(x, mid + a); }
      g.stroke();
    }
    g.fillStyle = '#fff'; g.fillRect(W * 0.62, 8, 0.8, Hh - 8);
  }, 0.85, 512);
  const slidesMat = texMat(1.7778, (g, W, Hh) => {
    const gr = g.createRadialGradient(W / 2, Hh / 2, 5, W / 2, Hh / 2, W * 0.7); gr.addColorStop(0, '#2a1d3f'); gr.addColorStop(1, '#07060b');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    text(g, 'Grande é o Senhor', W / 2, 40, 13, '#ffffff');
    text(g, 'e mui digno de louvor', W / 2, 58, 13, '#ffffff');
    ctx.logo.draw(g, W / 2 - 13, 78, 26, { layout: 'wide', color: '#c98a3c' });
  }, 0.85, 512);
  for (const m of [camMat, liveMat, slidesMat]) ctx.bindEmissive('telao', m, 0.85, { min: 0.1 });
  ctx.bindEmissive('som', waveMat, 0.85, { min: 0.1 });
  // Monitor em pedestal, tela para +z local
  const monitor = (w, h, mat, lift = 0.1) => {
    const g = G();
    g.add(box(0.22, 0.012, 0.16, black, 0, 0.006, 0));
    g.add(box(0.05, lift + h * 0.4, 0.03, black, 0, (lift + h * 0.4) / 2, -0.035));
    g.add(box(w + 0.02, h + 0.02, 0.025, black, 0, lift + h / 2, -0.005));
    g.add(box(w, h, 0.004, mat, 0, lift + h / 2, 0.0095, nc));
    return g;
  };
  // ---- bancada preta longa sob o visor (x 16,2–16,9 · z 23,45–27,75, tampo y 0,78) ----
  const DT = 0.78;
  add(box(0.7, 0.035, 4.3, benchTop, 16.55, DT - 0.0175, 25.6));
  add(box(0.02, 0.1, 4.3, black, 16.89, DT - 0.085, 25.6));                                 // testeira
  for (const z of [23.47, 25.6, 27.73]) add(box(0.64, DT - 0.035, 0.03, black, 16.53, (DT - 0.035) / 2, z));
  add(box(0.02, 0.5, 4.3, black, 16.215, 0.5, 25.6));                                        // fundo (esconde os cabos)
  for (const z of [24.25, 26.95]) {                                                          // gabinetes dos PCs no chão
    add(box(0.42, 0.44, 0.2, black, 16.47, 0.22, z));
    add(box(0.004, 0.012, 0.012, ledB, 16.682, 0.4, z + 0.06, nc));
  }
  // monitores (costas para o vidro, telas para os operadores)
  place(monitor(0.56, 0.33, camMat), 16.4, 23.95, HPI, DT);
  place(monitor(0.56, 0.33, liveMat), 16.4, 24.62, HPI, DT);
  place(monitor(0.5, 0.3, slidesMat), 16.4, 25.4, HPI, DT);
  place(monitor(0.5, 0.3, waveMat), 16.4, 27.3, HPI, DT);
  // teclados, mouses e mouse pads azuis
  const kb = (x, z, len = 0.44) => { add(box(0.15, 0.022, len, black, x, DT + 0.011, z)); add(box(0.12, 0.004, len - 0.04, graph, x, DT + 0.024, z, nc)); };
  kb(16.72, 24.28); kb(16.72, 25.4); kb(16.68, 26.95, 0.46);
  for (const [z, pad] of [[24.72, true], [25.8, true], [27.3, false]]) {
    if (pad) add(box(0.26, 0.003, 0.3, padBlue, 16.74, DT + 0.0015, z, nc));
    const ms = sph(0.03, black, 16.74, DT + 0.013, z); ms.scale.set(1.5, 0.5, 1); add(ms);
  }
  // road case azul-turquesa (fechado, sobre a bancada)
  {
    const x = 16.52, z = 26.2, w = 0.44, h = 0.26, L = 0.64, y = DT + h / 2;
    add(box(w, h, L, turq, x, y, z));
    add(box(w + 0.006, 0.018, L + 0.006, M.chrome, x, y + 0.03, z));                         // perfil da tampa
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-1, 1]) add(box(0.05, 0.05, 0.05, M.chrome, x + sx * (w / 2 - 0.02), y + sy * (h / 2 - 0.02), z + sz * (L / 2 - 0.02))); // cantoneiras
    for (const sz of [-0.16, 0.16]) add(box(0.012, 0.05, 0.07, M.chrome, x + w / 2 + 0.006, y + 0.03, z + sz));           // fechos
    const lbl = texMat(2.2, (g, W, Hh) => { g.fillStyle = '#1b8fac'; g.fillRect(0, 0, W, Hh); text(g, 'MÍDIA · BASE', W / 2, 52, 30, '#e8f7fb', '900'); });
    add(box(0.004, 0.07, 0.3, lbl, x + w / 2 + 0.003, y - 0.04, z, nc));
  }
  // difusor de varetas (vidro + 4 varetas de madeira), perto do vidro
  {
    const x = 16.33, z = 26.72;
    add(cyl(0.035, 0.04, 0.1, clearGl, x, DT + 0.05, z, 12));
    add(cyl(0.032, 0.036, 0.05, std({ color: 0xe0c070, roughness: 0.3, transparent: true, opacity: 0.6 }), x, DT + 0.026, z, 12));
    for (let i = 0; i < 4; i++) {
      const a = i * HPI + 0.4, st = cyl(0.004, 0.004, 0.3, woodL, x + Math.cos(a) * 0.04, DT + 0.22, z + Math.sin(a) * 0.04, 5);
      st.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18); add(st);
    }
  }
  // switcher/processador de vídeo preto com botões (painel frontal para o operador)
  {
    add(box(0.3, 0.07, 0.44, black, 16.72, DT + 0.035, 27.5));
    const pnl = texMat(6.3, (g, W, Hh) => {
      g.fillStyle = '#141416'; g.fillRect(0, 0, W, Hh);
      g.fillStyle = '#2f5d7a'; g.fillRect(40, 20, 90, 55);                                  // visor
      for (let i = 0; i < 10; i++) { g.fillStyle = i === 2 ? '#ff5050' : i === 6 ? '#58e07a' : '#d9dce0'; g.fillRect(170 + (i % 5) * 46, i < 5 ? 14 : 56, 34, 30); }
      g.fillStyle = '#9a9ca2'; g.beginPath(); g.arc(W - 70, 50, 26, 0, PI * 2); g.fill();
      g.fillStyle = '#ff3030'; g.fillRect(W - 24, 40, 10, 20);
    }, 0.6, 512);
    add(box(0.004, 0.066, 0.43, pnl, 16.872, DT + 0.035, 27.5, nc));
  }
  add(box(0.13, 0.05, 0.09, black, 16.4, DT + 0.025, 26.85));                                // conversor / carregadores
  add(box(0.004, 0.006, 0.02, ledG, 16.466, DT + 0.035, 26.85, nc));
  // cadeiras de operador: estrutura preta, assento e encosto azuis (frente = +z local)
  const opChair = () => {
    const g = G();
    for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; const sp = box(0.3, 0.03, 0.04, black, Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15); sp.rotation.y = -a; g.add(sp); g.add(sph(0.028, black, Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29)); }
    g.add(cyl(0.025, 0.025, 0.36, M.chrome, 0, 0.25, 0, 8));
    g.add(box(0.46, 0.04, 0.44, black, 0, 0.44, 0));
    g.add(box(0.46, 0.07, 0.44, blueSeat, 0, 0.495, 0.01));
    g.add(box(0.05, 0.36, 0.04, black, 0, 0.62, -0.23));
    const bk = box(0.44, 0.44, 0.06, blueSeat, 0, 0.84, -0.25); bk.rotation.x = -0.1; g.add(bk);
    for (const sx of [-1, 1]) { g.add(box(0.03, 0.2, 0.03, black, sx * 0.24, 0.56, -0.02)); g.add(box(0.06, 0.03, 0.26, black, sx * 0.24, 0.67, 0.0)); }
    return g;
  };
  for (const [z, r] of [[24.3, 0.12], [25.5, -0.08], [26.95, 0.18]]) place(opChair(), 17.32, z, -HPI + r);
  // cadeiras plásticas pretas (monobloco) na parede oposta, viradas para a sala
  const plasticChair = () => {
    const g = G();
    g.add(box(0.44, 0.035, 0.42, blackGl, 0, 0.44, 0.01));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = cyl(0.02, 0.016, 0.44, blackGl, sx * 0.19, 0.22, sz * 0.18, 8); l.rotation.set(sz * 0.08, 0, -sx * 0.08); g.add(l); }
    for (const sx of [-1, 1]) { const u = box(0.035, 0.44, 0.03, blackGl, sx * 0.19, 0.67, -0.2); u.rotation.x = -0.14; g.add(u); }
    const tr = box(0.42, 0.06, 0.035, blackGl, 0, 0.89, -0.235); tr.rotation.x = -0.14; g.add(tr);
    for (const sx of [-0.07, 0.07]) { const s = box(0.04, 0.36, 0.02, blackGl, sx, 0.66, -0.205); s.rotation.x = -0.14; g.add(s); }
    return g;
  };
  for (const z of [24.75, 25.35, 25.95]) place(plasticChair(), 18.5, z, -HPI);
  // gabinete preto com impressora, spray e papéis
  add(box(0.42, 0.78, 0.6, black, 18.55, 0.39, 26.65));
  add(box(0.004, 0.7, 0.004, graph, 18.338, 0.4, 26.65, nc));
  add(box(0.02, 0.12, 0.02, M.chrome, 18.33, 0.55, 26.57));
  add(box(0.36, 0.17, 0.4, graph, 18.56, 0.865, 26.56));                                    // impressora
  add(box(0.3, 0.012, 0.3, white, 18.56, 0.956, 26.56, nc));
  add(box(0.2, 0.004, 0.28, white, 18.4, 0.84, 26.56, nc));
  add(cyl(0.03, 0.03, 0.2, std({ color: 0xe8e4d8, roughness: 0.4 }), 18.62, 0.88, 26.87, 10)); // spray
  add(cyl(0.031, 0.031, 0.04, std({ color: 0x35a043, roughness: 0.4 }), 18.62, 1.0, 26.87, 10));
  // caixa de som/case no chão junto ao fundo
  add(box(0.36, 0.5, 0.3, graph, 17.95, 0.27, 27.7));
  add(box(0.3, 0.4, 0.006, std({ color: 0x2a2c30, roughness: 1 }), 17.95, 0.3, 27.547, nc));
  for (const sx of [-0.14, 0.14]) add(cyl(0.02, 0.02, 0.03, black, 17.95 + sx, 0.015, 27.62, 8));
  // receptor sem fio preto com LEDs na parede (v4_01)
  add(box(0.04, 0.26, 0.07, black, 18.765, 1.35, 24.5));
  add(box(0.004, 0.18, 0.012, ledR, 18.743, 1.35, 24.5, nc));
  // câmera de segurança no canto (o split branco do fundo — x 17,1–18,0, y 2,42–2,70 — é do cartão: `ac_midia`)
  const secCam = (x, y, z, ry) => {
    const g = G();
    g.add(box(0.08, 0.04, 0.03, white, 0, 0, -0.015));
    g.add(box(0.025, 0.08, 0.025, white, 0, -0.04, 0.02));
    const b = cyl(0.035, 0.04, 0.14, white, 0, -0.09, 0.07, 12); b.rotation.x = HPI + 0.35; g.add(b);
    const ln = cyl(0.028, 0.028, 0.004, black, 0, -0.114, 0.137, 12); ln.rotation.x = HPI + 0.35; g.add(ln);
    place(g, x, z, ry, y);
  };
  secCam(18.65, 2.88, 27.885, PI);
  emerg('x', 23.415, 16.95, 2.5, 1);

  // =====================================================================
  // VOLUNTARIADO (x 16,05–20,1 · z 28,0–33,9) — v2.
  // Portas: z=28 x 19,0–19,9 · z=33,9 x 16,2–17,0 (giros livres); janela p/ o templo
  // z 29,9–31,9 coberta pela cortina. Parede x=20,1 em marmorato.
  // =====================================================================
  // cortina cinza-claro do piso ao teto ao longo da parede do templo (pregas em zigue-zague)
  {
    const z0 = 28.24, z1 = 32.94, x = 16.295, step = 0.088, Hc = 2.92;
    add(box(0.05, 0.035, z1 - z0 + 0.06, graph, x, 2.965, (z0 + z1) / 2));                   // trilho
    let i = 0;
    for (let z = z0 + step / 2; z < z1; z += step, i++) { const p = box(0.1, Hc, 0.012, curtain, x, 0.02 + Hc / 2, z); p.rotation.y = HPI + (i % 2 ? 0.52 : -0.52); add(p); }
  }
  // sofás cinza (2, em fila junto à cortina), frente para +x
  const pilGeo = texMat(1, (g, W, Hh) => {
    g.fillStyle = '#f4f3ee'; g.fillRect(0, 0, W, Hh);
    const cols = ['#f2c230', '#1d1d1f', '#f4f3ee', '#f2c230', '#8e8f92', '#1d1d1f'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = c * 25, y = r * 25, k = (r * 3 + c * 5) % cols.length;
      g.fillStyle = cols[k]; g.beginPath();
      if ((r + c) % 2) { g.moveTo(x, y); g.lineTo(x + 25, y); g.lineTo(x, y + 25); } else { g.moveTo(x + 25, y); g.lineTo(x + 25, y + 25); g.lineTo(x, y + 25); }
      g.closePath(); g.fill();
      g.fillStyle = cols[(k + 2) % cols.length]; g.beginPath(); g.moveTo(x + 12.5, y + 5); g.lineTo(x + 20, y + 20); g.lineTo(x + 5, y + 20); g.closePath(); g.fill();
    }
  });
  const sofa = (L, pillows) => {
    const g = G(), D = 0.9;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.05, 0.06, 0.05, woodM, sx * (L / 2 - 0.08), 0.03, sz * (D / 2 - 0.08)));
    g.add(box(L, 0.28, D, sofaG, 0, 0.2, 0));
    g.add(box(L, 0.38, 0.16, sofaG, 0, 0.53, -D / 2 + 0.08));                              // encosto (estrutura)
    for (const sx of [-1, 1]) g.add(box(0.2, 0.3, D, sofaG, sx * (L / 2 - 0.1), 0.49, 0));  // braços
    const cw = (L - 0.44) / 2;
    for (const sx of [-1, 1]) {
      g.add(box(cw - 0.02, 0.15, D - 0.2, sofaG2, sx * cw / 2, 0.415, 0.08));                // assentos
      const bc = box(cw - 0.03, 0.42, 0.18, sofaG2, sx * cw / 2, 0.66, -D / 2 + 0.22); bc.rotation.x = -0.14; g.add(bc); // almofadas do encosto
    }
    pillows.forEach(([px, mat, ry]) => { const p = box(0.42, 0.42, 0.12, mat, px, 0.68, -D / 2 + 0.36); p.rotation.set(-0.3, ry, 0); g.add(p); });
    return g;
  };
  place(sofa(2.05, [[-0.72, pilDk, 0.1], [0.62, pilGeo, -0.12]]), 16.81, 29.4, HPI);
  place(sofa(2.05, [[-0.7, pilGeo, 0.12], [-0.3, pilDk, -0.05], [0.7, pilDk, 0.1]]), 16.81, 31.6, HPI);
  // letreiro 3D preto na parede z=28: "FAÇAM TUDO / COMO PARA / O SENHOR" (camadas empilhadas = letra caixa)
  {
    const Wm = 1.62, Hm = 0.86, A = Wm / Hm;
    const tex = ctx.makeTex(1024, (g, s) => {
      g.clearRect(0, 0, s, s); g.save(); g.scale(s / (100 * A), s / 100);
      const lines = ['FAÇAM  TUDO', 'COMO  PARA', 'O  SENHOR'];
      g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.font = '900 30px "Arial Black", "Arial Narrow", Arial, Helvetica, sans-serif';
      const sx = (100 * A - 4) / g.measureText(lines[0]).width;
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.6; g.lineJoin = 'round';
      lines.forEach((t, i) => { g.save(); g.translate(2, 27 + i * 33.5); g.scale(sx, 1); g.fillText(t, 0, 0); g.strokeText(t, 0, 0); g.restore(); });
      g.restore();
    });
    const geo = new THREE.PlaneGeometry(Wm, Hm);
    const side = new THREE.MeshStandardMaterial({ map: tex, color: 0x3a3a3d, alphaTest: 0.5, roughness: 0.6 });
    const face = new THREE.MeshStandardMaterial({ map: tex, color: 0x161618, alphaTest: 0.5, roughness: 0.45 });
    [[0.004, side], [0.011, side], [0.018, side], [0.025, face]].forEach(([dz, m]) => {
      const p = new THREE.Mesh(geo, m); p.position.set(17.66, 2.08, 28.075 + dz); p.receiveShadow = true; add(p);
    });
  }
  // 2 poltronas capitonê terracota com pés de madeira, sob o letreiro (frente = +z)
  const armchair = () => {
    const g = G();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = cyl(0.022, 0.014, 0.22, woodM, sx * 0.27, 0.11, sz * 0.24, 8); l.rotation.set(sz * 0.12, 0, -sx * 0.12); g.add(l); }
    g.add(box(0.66, 0.2, 0.6, terraV, 0, 0.32, 0));
    g.add(box(0.5, 0.09, 0.5, terraV, 0, 0.465, 0.03));
    const bk = box(0.66, 0.56, 0.13, terraV, 0, 0.7, -0.24); bk.rotation.x = -0.08; g.add(bk);
    for (const sx of [-1, 1]) g.add(box(0.09, 0.2, 0.58, terraV, sx * 0.285, 0.52, 0.0));
    for (const [bx, by] of [[-0.16, 0.6], [0, 0.6], [0.16, 0.6], [-0.08, 0.78], [0.08, 0.78]]) g.add(sph(0.014, terraD, bx, by, -0.168 - (by - 0.6) * 0.08));
    return g;
  };
  place(armchair(), 17.62, 28.52, 0.04);
  place(armchair(), 18.34, 28.52, -0.04);
  secCam(16.4, 2.88, 28.075, 0.6);
  // parede x = 20,1 em marmorato (face da sala); o split no alto (z 29,05–29,95, y 2,43–2,73) é do cartão: `ac_voluntariado`
  clad('z', 20.013, -1, 28.075, 33.825, 0.075, 2.985, M.marmorato);
  // 2 prateleiras flutuantes cinza com quadros e planta pendente
  for (const y of [1.72, 2.2]) add(box(0.22, 0.04, 1.55, shelfG, 19.9, y, 31.25));
  const art = [std({ color: 0xe8e2d4, roughness: 0.9 }), std({ color: 0xd9cdb4, roughness: 0.9 })];
  [[30.7, 0.3, 0.24, 0], [31.0, 0.34, 0.26, 1], [31.55, 0.28, 0.24, 0]].forEach(([z, h, w, k]) => {
    const f = box(0.025, h, w, woodL, 19.93, 1.74 + h / 2, z); f.rotation.z = 0.08; add(f);
    const a = box(0.004, h - 0.05, w - 0.05, art[k], 19.915, 1.74 + h / 2, z, nc); a.rotation.z = 0.08; add(a);
  });
  add(box(0.004, 0.14, 0.1, black, 19.9, 1.8, 31.0, nc)).rotation.z = 0.08;                // silhueta no quadro
  add(cyl(0.035, 0.03, 0.09, black, 19.88, 1.785, 31.85, 10));                               // porta-lápis
  add(box(0.08, 0.07, 0.07, woodM, 19.9, 1.775, 32.0));                                       // casinha decorativa
  {
    add(cyl(0.07, 0.06, 0.12, white, 19.88, 2.28, 31.92, 12));                                // planta pendente
    for (let i = 0; i < 14; i++) {
      const t = i / 13, lf = sph(0.038 - t * 0.012, i % 2 ? frond : frond2, 19.83 - rnd() * 0.07, 2.3 - t * 0.62, 31.92 + (rnd() - 0.5) * 0.2 + t * 0.07);
      lf.scale.set(0.5, 1.3, 1); add(lf);
    }
  }
  // buffet cinza-grafite (2 módulos sobre rodízios) com tampo de madeira e puxadores dourados
  const buffet = (z0, z1) => {
    const L = z1 - z0, zc = (z0 + z1) / 2, x0 = 19.5, D = 0.46, xc = x0 + D / 2;
    add(box(D, 0.8, L, slate, xc, 0.46, zc));
    add(box(D + 0.03, 0.03, L + 0.02, woodL, xc - 0.015, 0.875, zc));
    add(box(0.004, 0.006, L - 0.04, black, x0 - 0.002, 0.68, zc, nc));                        // junta das gavetas
    const nd = 3, dw = L / nd;
    for (let i = 0; i < nd; i++) {
      const zd = z0 + dw * (i + 0.5);
      if (i) add(box(0.004, 0.76, 0.006, black, x0 - 0.002, 0.46, z0 + dw * i, nc));
      add(sph(0.017, gold, x0 - 0.012, 0.78, zd));
      add(sph(0.017, gold, x0 - 0.012, 0.58, zd + (i === 1 ? -0.1 : 0.1)));
    }
    for (const sz of [-1, 1]) for (const sx of [0.08, D - 0.08]) add(cyl(0.025, 0.025, 0.04, black, x0 + sx, 0.03, zc + sz * (L / 2 - 0.08), 10)).rotation.x = HPI;
  };
  buffet(29.1, 30.65); buffet(30.65, 32.2);
  // sobre o buffet: jarra, taças verdes, copos vermelhos, bandeja com café, caixa de lenços
  const TY = 0.89;
  add(cyl(0.06, 0.055, 0.22, clearGl, 19.74, TY + 0.11, 29.95, 14));
  for (const dz of [0.18, 0.3]) { add(cyl(0.035, 0.02, 0.07, greenGl, 19.72, TY + 0.13, 29.95 + dz, 12)); add(cyl(0.006, 0.006, 0.08, greenGl, 19.72, TY + 0.05, 29.95 + dz, 6)); add(cyl(0.03, 0.03, 0.008, greenGl, 19.72, TY + 0.004, 29.95 + dz, 12)); }
  for (const dz of [0, 0.1]) add(cyl(0.035, 0.03, 0.1, redCup, 19.66, TY + 0.05, 30.95 + dz, 12));
  add(box(0.3, 0.02, 0.42, black, 19.74, TY + 0.01, 31.45));                                 // bandeja
  add(cyl(0.055, 0.055, 0.26, black, 19.78, TY + 0.15, 31.35, 12));                           // garrafa térmica
  add(box(0.1, 0.12, 0.1, std({ color: 0x5a3a24, roughness: 0.6 }), 19.7, TY + 0.08, 31.55)); // pote de café
  add(box(0.16, 0.1, 0.24, white, 19.74, TY + 0.05, 32.0));                                   // caixa de lenços
  // frigobar inox ao lado e poltrona preta no canto
  add(box(0.48, 0.85, 0.5, inox, 19.73, 0.43, 32.53));
  add(box(0.004, 0.006, 0.46, black, 19.488, 0.7, 32.53, nc));
  add(box(0.02, 0.3, 0.02, black, 19.475, 0.5, 32.35));
  {
    const g = G(), tub = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.34, 0.5, 20, 1, true, PI * 0.65, PI * 1.7), blackGl);
    tub.position.y = 0.6; tub.castShadow = true; tub.receiveShadow = true; g.add(tub);
    g.add(cyl(0.34, 0.33, 0.14, blackGl, 0, 0.42, 0, 20));
    for (let i = 0; i < 4; i++) { const a = i * HPI + PI / 4, l = cyl(0.012, 0.012, 0.36, black, Math.cos(a) * 0.24, 0.17, Math.sin(a) * 0.24, 6); l.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2); g.add(l); }
    place(g, 19.36, 33.28, -2.2);
  }
  emerg('x', 33.825, 17.9, 2.5, -1);

  // =====================================================================
  // CIRC. (x 16,05–17,1 · z 33,9–37,0) — passagem: extintor e sinalização
  // =====================================================================
  extintor(17.025, 36.55, -1);
  const wcSign = texMat(3, (g, W, Hh) => {
    g.fillStyle = '#141416'; g.fillRect(0, 0, W, Hh);
    text(g, 'BANHEIROS', 20, 52, 34, '#f3efe6', 'bold', 'left');
    g.fillStyle = '#c98a3c'; g.beginPath(); g.moveTo(W - 44, 30); g.lineTo(W - 14, 50); g.lineTo(W - 44, 70); g.closePath(); g.fill(); g.fillRect(W - 70, 44, 28, 12);
  });
  plaque('z', 17.018, 36.1, 1.95, 0.42, 0.14, wcSign);

  // =====================================================================
  // DEPÓSITO (x 17,1–20,1 · z 33,9–35,9) — v2: estantes de aço preto com caixas
  // organizadoras (transparentes/cinza com tampa), caixa preta de parede, mesinha.
  // Porta em x=17,1 (z 34,6–35,4) → x 17,18–18,1 livre.
  // =====================================================================
  const rack = (x0, x1, z0, D, h, levels) => {
    const w = x1 - x0, xc = (x0 + x1) / 2, zc = z0 + D / 2;
    for (const sx of [x0 + 0.015, x1 - 0.015]) for (const sz of [z0 + 0.015, z0 + D - 0.015]) add(box(0.03, h, 0.03, black, sx, h / 2, sz));
    for (let i = 0; i < levels; i++) {
      const y = 0.08 + (i * (h - 0.12)) / (levels - 1);
      add(box(w, 0.02, D, black, xc, y, zc));
      if (i === levels - 1) { if (rnd() < 0.7) add(box(0.5, 0.26, D - 0.06, rnd() < 0.5 ? lidG : std({ color: 0xd8cdb4, roughness: 0.9 }), xc - 0.1, y + 0.14, zc)); continue; }
      let px = x0 + 0.04;
      const gap = (h - 0.12) / (levels - 1) - 0.05;
      while (px < x1 - 0.25) {
        const bw = Math.min(0.26 + rnd() * 0.18, x1 - 0.04 - px), bh = Math.min(gap - 0.02, 0.2 + rnd() * 0.12);
        if (bw < 0.2) break;
        const bxc = px + bw / 2, by = y + 0.01 + bh / 2;
        if (rnd() < 0.62) {
          add(box(bw, bh, D - 0.06, clearBx, bxc, by, zc, nc));                                 // caixa transparente
          add(box(bw * 0.8, bh * 0.6, D - 0.14, bins[Math.floor(rnd() * bins.length)], bxc, y + 0.01 + bh * 0.3, zc)); // conteúdo
          add(box(bw + 0.012, 0.022, D - 0.05, rnd() < 0.5 ? lidG : white, bxc, by + bh / 2 + 0.011, zc)); // tampa
        } else {
          add(box(bw, bh, D - 0.06, rnd() < 0.5 ? graph : lidG, bxc, by, zc));                  // caixa cinza
          add(box(bw + 0.012, 0.022, D - 0.05, graph, bxc, by + bh / 2 + 0.011, zc));
        }
        px += bw + 0.03;
      }
    }
  };
  rack(18.2, 19.08, 34.02, 0.45, 1.95, 5);
  rack(19.1, 19.98, 34.02, 0.45, 1.95, 5);
  add(box(0.06, 0.5, 0.36, black, 19.98, 1.55, 35.25));                                        // caixa preta de parede
  add(box(0.012, 0.06, 0.03, M.chrome, 19.947, 1.5, 35.1));
  {                                                                                            // mesinha preta de apoio
    add(box(0.42, 0.025, 0.34, black, 19.7, 0.74, 35.6));
    for (const sz of [-0.15, 0.15]) { add(box(0.4, 0.025, 0.025, black, 19.7, 0.06, 35.6 + sz)); add(box(0.025, 0.72, 0.025, black, 19.505, 0.37, 35.6 + sz)); add(box(0.025, 0.72, 0.025, black, 19.895, 0.37, 35.6 + sz)); }
  }
  // caixas organizadoras empilhadas no chão (transparentes)
  for (const [x, y, h, c] of [[18.55, 0.12, 0.24, 1], [18.55, 0.36, 0.2, 5], [19.05, 0.13, 0.26, 3]]) {
    add(box(0.46, h, 0.36, clearBx, x, y + 0.005, 35.6, nc));
    add(box(0.38, h * 0.6, 0.28, bins[c], x, y - h * 0.18, 35.6));
    add(box(0.47, 0.02, 0.37, white, x, y + h / 2 + 0.015, 35.6));
  }

  // =====================================================================
  // ÁREA TÉCNICA / SHAFT (x 17,1–20,1 · z 35,9–37,0): quadros e tubulações
  // =====================================================================
  add(box(0.55, 0.8, 0.12, std({ color: 0xc9ccd0, roughness: 0.5, metalness: 0.3 }), 17.75, 1.55, 36.04));
  add(box(0.12, 0.08, 0.004, std({ color: 0xf2c200, roughness: 0.6 }), 17.75, 1.8, 36.103, nc));
  add(box(0.5, 0.6, 0.25, black, 18.5, 1.7, 36.1));
  add(box(0.004, 0.012, 0.3, ledG, 18.5, 1.75, 36.227, nc));
  add(box(2.7, 0.06, 0.12, M.steel, 18.6, 2.72, 36.06));
  rod(0.018, 1.0, graphL, 17.75, 2.2, 36.04, 'y'); rod(0.018, 0.8, graphL, 18.5, 2.3, 36.1, 'y');
  for (const [x, z, r] of [[19.8, 36.7, 0.075], [19.58, 36.75, 0.05]]) rod(r, 2.96, pvc, x, 1.48, z, 'y', 14);
  for (const x of [19.35, 19.42]) rod(0.028, 2.9, black, x, 1.45, 36.8, 'y', 8);
  rod(0.02, 2.5, copper, 19.55, 1.3, 36.3, 'y');

  // =====================================================================
  // BANHEIROS — v3: porcelanato cinza até 1,3 m e marrom imperador (ou marmorato)
  // acima; bancadas de quartzo branco com cubas de apoio retangulares; espelhos com
  // moldura de LED fria; cabines com portas de vidro fumê e ferragens pretas.
  // =====================================================================
  // Cabines: faixa x xa–xb, parede do fundo em zw, frente em zf, n cabines.
  const cabins = (xa, xb, zw, zf, n, sides, cut = 0) => {
    const sg = Math.sign(zf - zw), w = (xb - xa) / n, PY0 = 0.12, PH = 1.95, py = PY0 + PH / 2;
    const zw2 = zw + sg * cut, len = Math.abs(zf - zw2), zc = (zf + zw2) / 2;
    for (let i = 0; i <= n; i++) {
      if ((i === 0 && !sides[0]) || (i === n && !sides[1])) continue;
      const x = xa + i * w;
      add(box(0.025, PH, len, hpl, x, py, zc));
      if (cut) add(box(0.025, 1.4, cut, hpl, x, PY0 + 0.7, zw + sg * cut / 2));
      add(box(0.03, 0.05, 0.03, black, x, 0.06, zf - sg * 0.02));                            // pé
    }
    const dw = Math.min(0.64, w - 0.16), pl = (w - dw) / 2;
    for (let i = 0; i < n; i++) {
      const x0 = xa + i * w, c = x0 + w / 2;
      add(box(pl - 0.008, PH, 0.025, smoke, x0 + pl / 2, py, zf));
      add(box(pl - 0.008, PH, 0.025, smoke, x0 + w - pl / 2, py, zf));
      add(box(dw - 0.008, PH - 0.06, 0.02, smoke, c, py + 0.02, zf));                         // porta de vidro fumê
      for (const hy of [0.4, 1.75]) add(box(0.05, 0.08, 0.034, black, c - dw / 2 + 0.03, hy, zf)); // dobradiças
      add(box(0.02, 0.2, 0.05, black, c + dw / 2 - 0.07, 1.0, zf));                           // puxador/tarjeta
      const t = new THREE.Group();
      t.add(box(0.36, 0.4, 0.2, china, 0, 0.2, -0.05)); t.add(box(0.38, 0.05, 0.5, china, 0, 0.42, 0.08)); t.add(box(0.36, 0.34, 0.14, white, 0, 0.62, -0.2));
      place(t, c, zw + sg * 0.3, sg > 0 ? 0 : PI);
      add(box(0.13, 0.12, 0.09, black, c + 0.3, 0.72, zw + sg * 0.05));                       // papeleira preta
    }
    add(box(xb - xa, 0.03, 0.04, black, (xa + xb) / 2, PY0 + PH + 0.015, zf));               // travessa superior
  };
  const urinal = (xf, z) => {
    add(box(0.1, 0.62, 0.34, china, xf - 0.05, 0.86, z));
    const bowl = cyl(0.16, 0.13, 0.52, china, xf - 0.17, 0.83, z, 16); bowl.scale.set(0.8, 1, 1); add(bowl);
    add(cyl(0.02, 0.02, 0.2, M.chrome, xf - 0.06, 1.27, z, 8));
  };

  // ---- WC MASCULINO (x 17,1–20,1 · z 37,0–40,8) — porta em z=40,8 (x 18,2–19,0) ----
  wetWall('z', 20.013, -1, 37.075, 40.725, M.marmoreMarrom);
  cabins(17.175, 19.45, 37.075, 38.45, 2, [false, true]);
  add(box(0.5, 0.04, 1.15, quartz, 19.75, 0.86, 37.72));                                     // bancada de quartzo
  add(box(0.02, 0.12, 1.15, quartz, 19.49, 0.8, 37.72));
  place(vessel(), 19.72, 37.72, -HPI, 0.88);
  ledMirror(19.995, 1.6, 37.72, 0.55, 0.8, -HPI);
  for (const z of [38.85, 39.55, 40.25]) urinal(20.0, z);
  for (const z of [39.2, 39.9]) add(box(0.42, 0.85, 0.02, smoke, 19.79, 1.0, z));
  { const g = G();                                                                             // secador de mãos
    g.add(box(0.28, 0.34, 0.2, inox, 0, 0, 0.1)); g.add(box(0.2, 0.02, 0.1, black, 0, -0.17, 0.12));
    place(g, 17.175, 39.4, HPI, 1.2); }
  add(cyl(0.14, 0.12, 0.45, inox, 17.45, 0.225, 40.45, 14));
  doorPicto('x', 40.887, 18.6, 1, false);

  // ---- HALL DOS BANHEIROS (x 16,05–20,1 · z 40,8–44,3 + faixa x 16,05–17,1 · z 37,0–40,8) ----
  wetWall('z', 20.013, -1, 40.875, 44.225, M.marmoreMarrom);                                 // parede do bebedouro
  wetWall('x', 44.225, -1, 17.25, 20.013, M.marmoreMarrom);                                  // parede da bancada (porta do WC fem. em x 16,25–17,15)
  doorPicto('x', 44.225, 16.7, -1, true);
  wetWall('x', 40.875, 1, 17.1, 18.1, M.marmorato);                                          // parede da porta do WC masc.
  wetWall('x', 40.875, 1, 19.1, 20.013, M.marmorato);
  clad('x', 40.875, 1, 18.1, 19.1, 2.3, YT, M.marmorato);
  wetWall('z', 16.125, 1, 37.0, 39.08, M.marmorato);                                         // parede do templo (pilar em z 39,3)
  wetWall('z', 16.125, 1, 39.52, 44.225, M.marmorato);                                        // parede do templo (sem porta desde a v1.4.5)
  wetWall('z', 17.025, -1, 37.0, 40.8, M.marmorato);                                         // faixa de circulação
  // bancada branca de quartzo com 3 cubas de apoio retangulares e espelhos com LED
  add(box(2.6, 0.04, 0.5, quartz, 18.66, 0.86, 43.96));
  add(box(2.6, 0.13, 0.02, quartz, 18.66, 0.775, 43.72));
  for (const x of [17.8, 18.66, 19.52]) { place(vessel(), x, 43.98, PI, 0.88); ledMirror(x, 1.62, 44.213, 0.56, 0.82, PI); }
  add(box(0.1, 0.34, 0.26, white, 19.945, 1.35, 43.35));                                       // papel-toalha
  // bebedouro industrial inox (4 torneiras, calha) + lixeiras inox com pedal + porta-copos
  {
    const g = G(), L = 1.2;                                                                    // frente = +z local
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, 0.1, 0.04, inox, sx * (L / 2 - 0.04), 0.05, sz * 0.15 - 0.05));
    g.add(box(L, 1.0, 0.38, inox, 0, 0.6, -0.05));
    g.add(box(L + 0.02, 0.03, 0.4, inox, 0, 1.115, -0.05));
    g.add(box(L - 0.06, 0.07, 0.2, inox, 0, 0.8, 0.24));                                      // calha
    g.add(box(L - 0.1, 0.004, 0.16, std({ color: 0x8a9096, roughness: 0.3, metalness: 0.6 }), 0, 0.834, 0.24, nc));
    for (let i = 0; i < 4; i++) { const tx = -0.42 + i * 0.28; g.add(box(0.03, 0.03, 0.08, M.chrome, tx, 0.95, 0.18)); g.add(cyl(0.012, 0.012, 0.05, M.chrome, tx, 0.93, 0.22, 8)); }
    g.add(box(0.16, 0.2, 0.004, white, -0.35, 0.6, 0.142, nc));                                // etiqueta
    for (let i = 0; i < 5; i++) g.add(box(0.28, 0.012, 0.004, graphL, 0.3, 0.45 + i * 0.03, 0.142, nc)); // grelha
    add(g); g.position.set(19.75, 0, 42.0); g.rotation.y = -HPI;
  }
  for (const z of [42.95, 43.3]) {
    add(cyl(0.13, 0.12, 0.5, inox, 19.82, 0.25, z, 16));
    add(cyl(0.132, 0.132, 0.03, black, 19.82, 0.515, z, 16));
    add(box(0.08, 0.02, 0.06, black, 19.66, 0.02, z));
  }
  add(box(0.08, 0.32, 0.1, black, 19.97, 1.32, 41.2));                                         // porta-copos
  add(cyl(0.035, 0.035, 0.18, white, 19.93, 1.4, 41.2, 10));
  emerg('x', 40.887, 17.55, 2.5, 1);
  // ---- WC FEMININO (x 16,05–20,1 · z 44,3–49,5) — sem antecâmara ----
  // Porta na parede z = 44,3 (x 16,25–17,15), vinda do hall dos banheiros → área de giro x 16,1–17,3 · z 44,3–45,3 livre.
  wetWall('z', 20.013, -1, 44.375, 49.413, M.marmoreMarrom);
  cabins(18.05, 20.013, 44.375, 45.85, 2, [true, false]);
  cabins(17.175, 20.013, 49.413, 47.75, 3, [false, false], 0.08);
  add(box(0.8, 0.3, 0.04, graph, 17.6, 0.8, 44.395));                                        // fraldário
  add(box(0.8, 0.1, 0.46, white, 17.6, 0.9, 44.645));
  add(box(0.7, 0.03, 0.38, std({ color: 0xc98a3c, roughness: 0.85 }), 17.6, 0.965, 44.65));
  add(box(0.5, 0.04, 1.6, quartz, 19.75, 0.86, 46.8));                                       // bancada de quartzo
  add(box(0.02, 0.12, 1.6, quartz, 19.49, 0.8, 46.8));
  for (const z of [46.4, 47.2]) { place(vessel(), 19.72, z, -HPI, 0.88); ledMirror(19.995, 1.62, z, 0.52, 0.8, -HPI); }
  { const g = G();                                                                             // vaso com flores na bancada
    g.add(cyl(0.05, 0.04, 0.14, white, 0, 0.07, 0, 12));
    for (const [dx, dz, dy] of [[0, 0, 0.26], [0.04, 0.02, 0.23], [-0.03, 0.03, 0.24]]) { g.add(cyl(0.004, 0.004, dy, frond, dx * 0.5, 0.14 + dy / 2 - 0.04, dz * 0.5, 5)); g.add(sph(0.028, dy > 0.25 ? redCup : white, dx, 0.12 + dy, dz)); }
    place(g, 19.86, 46.8, 0, 0.88); }
  add(cyl(0.12, 0.1, 0.4, inox, 19.8, 0.2, 45.98, 14));
  // parede x = 16,05 (lado do WC) em marmorato; espelho de corpo inteiro, banco e cica
  wetWall('z', 16.125, 1, 44.375, 49.413, M.marmorato);
  add(box(0.012, 1.62, 0.62, black, 16.132, 1.2, 46.2));
  add(box(0.008, 1.54, 0.54, M.mirror, 16.141, 1.2, 46.2, nc));
  {
    const g = G();
    for (let i = 0; i < 4; i++) g.add(box(0.075, 0.035, 1.3, woodL, -0.135 + i * 0.09, 0.45, 0));
    for (const sz of [-0.5, 0.5]) { g.add(box(0.38, 0.03, 0.05, black, 0, 0.418, sz)); g.add(box(0.035, 0.42, 0.035, black, -0.16, 0.21, sz)); g.add(box(0.035, 0.42, 0.035, black, 0.16, 0.21, sz)); }
    place(g, 16.4, 47.75, 0);
  }
  cica(16.6, 49.02, 0.32);

  // =====================================================================
  // DETALHES DE REALISMO (v1.5.1): interruptores/tomadas junto às portas, persianas rolô nas janelas
  // J13/J05, calha de cabos + régua sob a bancada da mídia, suportes de controle dos splits, relógio do
  // voluntariado, lixeira da circulação, totem de álcool em gel, saboneteira e ralo do WC masculino.
  // Placas a ≥ 3 mm das faces (as com placa acústica/marmorato consideram o revestimento de 12 mm).
  // =====================================================================
  {
    const plate = (axis, f, dir, t, y, kind) => {
      const d = 0.012, c = f + dir * d / 2, dd = 0.006, cc = f + dir * (d + dd / 2);
      if (axis === 'x') {
        add(box(0.075, 0.12, d, white, t, y, c, nc));
        add(kind === 'sw' ? box(0.03, 0.045, dd, china, t, y + 0.01, cc, nc) : box(0.034, 0.034, dd, black, t, y, cc, nc));
      } else {
        add(box(d, 0.12, 0.075, white, c, y, t, nc));
        add(kind === 'sw' ? box(dd, 0.045, 0.03, china, cc, y + 0.01, t, nc) : box(dd, 0.034, 0.034, black, cc, y, t, nc));
      }
    };
    // suporte de parede do controle remoto do split (berço branco + controle)
    const remote = (axis, f, dir, t, y) => {
      if (axis === 'x') { add(box(0.06, 0.16, 0.03, white, t, y, f + dir * 0.015, nc)); add(box(0.045, 0.15, 0.014, lampW, t, y + 0.02, f + dir * 0.037, nc)); add(box(0.03, 0.06, 0.004, smoke, t, y + 0.055, f + dir * 0.046, nc)); }
      else { add(box(0.03, 0.16, 0.06, white, f + dir * 0.015, y, t, nc)); add(box(0.014, 0.15, 0.045, lampW, f + dir * 0.037, y + 0.02, t, nc)); add(box(0.004, 0.06, 0.03, smoke, f + dir * 0.046, y + 0.055, t, nc)); }
    };
    // persiana rolô (tubo grafite + tecido meio baixado) — axis 'x': janela na parede paralela a x (face z = f)
    const blind = (axis, f, dir, a, b, yTop, drop) => {
      const L = b - a + 0.1, c = (a + b) / 2;
      if (axis === 'x') { const tb = cyl(0.035, 0.035, L, graph, c, yTop + 0.1, f + dir * 0.06, 12); tb.rotation.z = HPI; add(tb); add(box(L - 0.04, drop, 0.008, curtain, c, yTop + 0.1 - 0.035 - drop / 2, f + dir * 0.04, nc)); }
      else { const tb = cyl(0.035, 0.035, L, graph, f + dir * 0.06, yTop + 0.1, c, 12); tb.rotation.x = HPI; add(tb); add(box(0.008, drop, L - 0.04, curtain, f + dir * 0.04, yTop + 0.1 - 0.035 - drop / 2, c, nc)); }
    };
    const drain = (x, z) => { add(box(0.1, 0.006, 0.1, inox, x, 0.008, z, nc)); add(box(0.08, 0.004, 0.08, black, x, 0.013, z, nc)); };
    // saboneteira de parede (branca, bico cromado) — face x = f
    const soap = (f, dir, z, y) => { add(box(0.05, 0.18, 0.1, white, f + dir * 0.025, y, z, nc)); add(box(0.03, 0.02, 0.02, inox, f + dir * 0.055, y - 0.07, z, nc)); };

    // Corredor lateral: interruptor na parede do templo (face 16,125), antes dos cartazes (z 13,9 / 15,6) e fora do trecho z 11–13
    plate('z', 16.125, 1, 13.3, 1.15, 'sw');
    // Sala Gilvan: interruptor ao lado da porta (z 12,9–13,8) e persiana na janela J13 (parede z = 11, x 17,9–19,9)
    plate('z', 17.175, 1, 12.55, 1.15, 'sw');
    blind('x', 11.075, 1, 17.9, 19.9, 2.15, 0.55);
    // Administrativo: interruptor ao lado da porta (z 14,4–15,3), persiana no visor J05 (x = 17,1 · z 16,8–18,3), tomada baixa
    plate('z', 17.175, 1, 15.6, 1.15, 'sw'); plate('z', 17.175, 1, 16.4, 0.3, 'out');
    blind('z', 17.175, 1, 16.8, 18.3, 2.15, 0.55);
    // Circulação: lixeira preta com tampa inox no canto junto à parede do templo (fora do aparador z 19,37 e do banco)
    add(cyl(0.14, 0.13, 0.55, black, 16.4, 0.275, 19.45, 16)); add(cyl(0.145, 0.145, 0.03, inox, 16.4, 0.565, 19.45, 16));
    plate('x', 19.075, 1, 17.6, 0.3, 'out');
    // Mídia: interruptor junto à porta (placa acústica na face z 23,375 + 12 mm), calha de cabos e régua sob a bancada,
    // cabos descendo até a régua, suporte do controle do split (parede z = 28, à direita do aparelho)
    plate('x', 23.387, 1, 17.5, 1.15, 'sw');
    add(box(0.1, 0.05, 4.2, black, 16.3, 0.62, 25.6));                                        // calha de cabos (eletrocalha preta)
    add(box(0.06, 0.04, 0.45, white, 16.34, 0.02, 25.0));                                     // régua de tomadas
    for (const dz of [-0.14, -0.05, 0.04, 0.13]) add(box(0.02, 0.006, 0.05, black, 16.34, 0.041, 25.0 + dz, nc));
    for (const z of [24.6, 24.92, 25.08, 26.8]) add(box(0.012, 0.56, 0.012, black, 16.34, 0.32, z, nc));
    add(box(0.7, 0.012, 0.012, black, 16.65, 0.006, 26.9, nc)); add(box(0.012, 0.012, 0.5, black, 16.99, 0.006, 26.65, nc));   // cabo solto no piso
    remote('x', 27.913, -1, 18.55, 1.45);
    // Voluntariado: interruptor junto à porta (x 19,0–19,9 · parede z = 28), controle do split no marmorato (x = 20,1), relógio na parede z = 33,9
    plate('x', 28.075, 1, 18.65, 1.15, 'sw'); plate('x', 28.075, 1, 17.2, 0.3, 'out');
    remote('z', 20.001, -1, 30.4, 1.45);
    { const cx = 17.45, cy0 = 2.1, zf = 33.825;
      const body = cyl(0.16, 0.16, 0.03, black, cx, cy0, zf - 0.015, 24); body.rotation.x = HPI; add(body);
      const face = cyl(0.145, 0.145, 0.006, white, cx, cy0, zf - 0.033, 24); face.rotation.x = HPI; face.castShadow = false; add(face);
      add(box(0.012, 0.1, 0.006, black, cx, cy0 + 0.04, zf - 0.039, nc));
      const hand = box(0.012, 0.07, 0.006, black, cx - 0.025, cy0 - 0.012, zf - 0.039, nc); hand.rotation.z = 2.1; add(hand); }
    // Circ. dos banheiros: bloco autônomo na parede do templo e interruptor do depósito ao lado da porta (z 34,6–35,4)
    emerg('z', 16.125, 35.6, 2.45, 1);
    plate('z', 17.025, -1, 35.75, 1.15, 'sw');
    // Sala Gilvan: tomada baixa atrás da cadeira (parede x = 20,1)
    plate('z', 20.013, -1, 13.3, 0.3, 'out');
    // WC masculino: ralo e saboneteira junto à bancada (o WC feminino fica como está)
    drain(18.6, 39.2); soap(20.013, -1, 38.55, 1.12);
    plate('x', 40.725, -1, 17.85, 1.15, 'sw');                                               // interruptor ao lado da porta (x 18,2–19,0)
    // Hall dos banheiros: totem de álcool em gel com pedal, junto à parede z = 40,8 (fora do giro da porta do WC masc.)
    add(cyl(0.15, 0.15, 0.02, black, 17.55, 0.01, 41.05, 16));
    add(cyl(0.018, 0.018, 1.0, black, 17.55, 0.52, 41.05, 8));
    add(box(0.1, 0.22, 0.1, white, 17.55, 1.08, 41.05)); add(box(0.04, 0.03, 0.05, inox, 17.55, 0.95, 41.11, nc));
    add(box(0.08, 0.02, 0.14, black, 17.55, 0.04, 41.18));
  }
}

function roomAdministrativo(ctx) {
  // ---------------------------------------------------------------------------
  // BLOCO ADMINISTRATIVO — fundos (z 0–9,25) e começo da ala direita (z 11,0–19,0)
  //  · Sala Pastoral (x 12,75–20,1 · z 0–9,25, em L): estação de café na parede z=0 com
  //    frigobar, mesa redonda de reunião (6 lugares), aparador, estar (tapete, sofá,
  //    2 poltronas, mesas de centro), 2 mesas de atendimento com estante alta na parede
  //    x=20,1, painel com cruz, quadros e plantas.
  //  · Banheiro pastoral (x 17,0–20,1 · z 3,1–4,9): bancada com cuba, vaso e box.
  //  · Caixa d'água (x 17,0–20,1 · z 0–3,1): 2 reservatórios de 1000 L sobre base,
  //    barrilete em PVC, motobomba e quadro elétrico.
  //  · Recepção (x 9,45–12,75 · z 5,9–9,25): parede ripada do piso ao teto com o LOGO
  //    oficial em letras caixa prateadas (ctx.logo.relief, retroiluminado com a luz
  //    'recepcao'), balcão ripado com a marca "B" e fita de LED, 3 poltronas, bebedouro.
  //  · Sala Gilvan (x 17,1–20,1 · z 11,0–14,2) e Administrativo (z 14,2–19,0): estações
  //    com monitores (papel de parede com o logo), prateleiras, mural, logo na parede.
  //  · Placas de porta (recepção / sala pastoral) na face externa da parede z = 9,25.
  // Logo: SEMPRE via ctx.logo (mesma função de desenho do cartão). Telas, abajures e
  // LEDs acompanham a luz do ambiente (ctx.bindEmissive).
  // Paleta: preto, madeira clara (ripado), branco e grafite, acentos âmbar/terracota.
  // Livres: giros das portas (recepção, pastoral, banheiro, Gilvan, Adm.), split da
  // pastoral (14,9; ctx.HB − 0,18; 0,125) e as luminárias do cartão (y ≈ 2,7; nos fundos 2,1).
  // v1.8: no bloco dos fundos as paredes têm ctx.HB de altura (2,4 m) e 5 cm de espessura; as faces abaixo são as de 7,5 cm —
  // o cartão (_snapThin) encosta na face nova o que estiver a até 15 cm dela.
  // Faces internas — bloco dos fundos (paredes finas, 7,5 cm): x 9,4875 · 12,7125/12,7875 · 16,9625/17,0375
  // · 20,088 (muro revestido, z < 11) · z 0,012 · 3,0625/3,1375 · 4,8625/4,9375 · 5,9375 · 9,2125/9,2875.
  // Ala direita: x 17,175 · 20,013 · z 11,075 · 14,125/14,275 · 18,925.
  // ---------------------------------------------------------------------------
  const THREE = ctx.THREE, M = ctx.M;
  const box = (...a) => ctx.box(...a), cyl = (...a) => ctx.cyl(...a), sph = (...a) => ctx.sph(...a);
  const std = (o) => ctx.std(o), rnd = () => ctx.rnd();
  const place = (g, x, z, ry = 0, y = 0) => ctx.place(g, x, z, ry, y);
  const put = (m) => { ctx.add(m); return m; };
  const G = () => new THREE.Group();
  const nc = { cast: false };
  const PI = Math.PI;
  // rotações: frente (+z local) virada para +z / +x / −x / −z
  const FZ = 0, FX = PI / 2, FNX = -PI / 2, FNZ = PI;

  // ---- materiais (mesmas opções → mesmo material → menos draw calls) ----------
  const woodL    = std({ color: 0xd2b08a, roughness: 0.65 });                    // madeira clara (tampos)
  const slat     = std({ color: 0xcfa97c, roughness: 0.7 });                     // ripado
  const ripaB    = std({ color: 0xd9b8a0, roughness: 0.68 });                    // ripado bege-rosado (igual ao da fachada)
  const blackM   = std({ color: 0x1b1b1d, roughness: 0.55 });                    // marcenaria preta
  const metalBk  = std({ color: 0x141416, roughness: 0.45, metalness: 0.45 });   // metal preto (pés, perfis)
  const whiteTop = std({ color: 0xf1efea, roughness: 0.4 });                     // tampo branco / quartzo
  const graph    = std({ color: 0x3a3b3f, roughness: 0.6, metalness: 0.2 });     // grafite
  const uphDark  = std({ color: 0x2c2d31, roughness: 0.95 });                    // estofado preto (cadeiras)
  const uphGray  = std({ color: 0x5b5e66, roughness: 0.97 });                    // estofado grafite
  const linen    = std({ color: 0xcdc6b8, roughness: 0.97 });                    // linho (sofá)
  const linenLt  = std({ color: 0xe2dccf, roughness: 0.97 });
  const caramel  = std({ color: 0x9a6a44, roughness: 0.8 });                     // couro caramelo
  const terra    = std({ color: 0xa65a3a, roughness: 0.95 });                    // terracota
  const amber    = std({ color: 0xc98a3c, roughness: 0.6, metalness: 0.15 });    // âmbar
  const sand     = std({ color: 0xe3d3b8, roughness: 0.95 });
  const potBlack = std({ color: 0x1c1c1e, roughness: 0.55 });
  const frond    = std({ color: 0x2f5a2a, roughness: 0.9 });
  const frond2   = std({ color: 0x3d6e34, roughness: 0.9 });
  const soil     = std({ color: 0x3d2b1c, roughness: 1 });
  const ceramic  = std({ color: 0xf4f4f2, roughness: 0.3 });
  const paper    = std({ color: 0xf6f3ec, roughness: 0.9 });
  const coffee   = std({ color: 0x3b2417, roughness: 0.35 });
  const glassTn  = std({ color: 0xd8e4ea, roughness: 0.1, transparent: true, opacity: 0.45 });
  const rugEdge  = std({ color: 0x6f6456, roughness: 1 });
  const rugField = std({ color: 0xc9bca6, roughness: 1 });
  const rugLine  = std({ color: 0xa78f70, roughness: 1 });
  const tileW    = std({ color: 0xe6e7e4, roughness: 0.35 });                    // revestimento do banheiro
  const tankBlue = std({ color: 0x2d6fb3, roughness: 0.55 });                    // reservatório de polietileno
  const tankLid  = std({ color: 0x255f9c, roughness: 0.5 });
  const pvc      = std({ color: 0xf0f0ee, roughness: 0.5 });                     // tubo PVC branco
  const pvcBrown = std({ color: 0x8b5a2b, roughness: 0.6 });                     // tubo soldável marrom
  const pumpBlue = std({ color: 0x3b6fa8, roughness: 0.45, metalness: 0.3 });
  const panelGr  = std({ color: 0xb8bcc0, roughness: 0.5, metalness: 0.3 });
  const waterJug = std({ color: 0x7fb2dc, roughness: 0.1, transparent: true, opacity: 0.6 });
  const book = [0x8b2f2f, 0x2f4f6b, 0x3f6d3a, 0xc9a24a, 0x6b4a2f, 0xe6dfd3, 0x1f1f22, 0xa65a3a].map((c) => std({ color: c, roughness: 0.9 }));
  const cork     = std({ color: 0xb68c5c, roughness: 1 });
  const spruce   = std({ color: 0xe2c28e, roughness: 0.45 });                    // tampo do violão
  const rosewood = std({ color: 0x5a3320, roughness: 0.5 });                     // laterais/braço
  const hoseGr   = std({ color: 0x2f7a3a, roughness: 0.6 });                     // mangueira
  const steelBr  = std({ color: 0xb9bcc0, roughness: 0.3, metalness: 0.8 });     // inox escovado

  // ---- emissivos ligados às luzes dos ambientes (1 material por entidade → 1 draw call) ----
  // Abajures / luminárias de mesa: cúpula de linho que acende com a luz do ambiente.
  const shade = (key) => ctx.bindEmissive(key, new THREE.MeshStandardMaterial({ color: 0xe8e1d2, roughness: 0.9,
    emissive: 0xffd9a8, emissiveIntensity: 0, side: THREE.DoubleSide }), 0.85, { min: 0 });
  const shadePast = shade('pastoral'), shadeAdm = shade('administrativo');
  // Fita de LED (luz quente) — sancas e balcão
  const led = (key, max = 1.4) => ctx.bindEmissive(key, new THREE.MeshStandardMaterial({ color: 0xfff1dc, roughness: 0.5,
    emissive: 0xffe2b8, emissiveIntensity: 0 }), max, { min: 0 });
  const ledRec = led('recepcao'), ledPast = led('pastoral', 1.1);
  // Papel de parede dos monitores: degradê grafite/roxo (Base Music) com o logo oficial.
  // A tela é 16:9 e a textura é quadrada: desenha com escala horizontal = altura/largura.
  const SCR_A = 0.56;
  const wallTex = ctx.makeTex(512, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, s);
    gr.addColorStop(0, '#221d2e'); gr.addColorStop(0.55, '#35295a'); gr.addColorStop(1, '#141219');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.save(); g.scale(SCR_A, 1);
    const W = s / SCR_A, lw = s * 0.34;
    g.globalAlpha = 0.08; g.fillStyle = '#b88cff';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(W * (0.1 + i * 0.2), 0); g.lineTo(W * (0.18 + i * 0.2), 0); g.lineTo(W * (0.02 + i * 0.22), s); g.lineTo(W * (-0.06 + i * 0.22), s); g.fill(); }
    g.globalAlpha = 1;
    ctx.logo.draw(g, W / 2 - lw / 2, s * 0.2, lw, { layout: 'full', color: '#f4f5f7' });
    g.fillStyle = 'rgba(8,8,10,0.85)'; g.fillRect(0, s * 0.93, W, s * 0.07);                   // barra de tarefas
    g.fillStyle = '#c9c4d6'; for (let i = 0; i < 6; i++) g.fillRect(W / 2 - 0.2 * s + i * 0.075 * s, s * 0.947, 0.04 * s, 0.035 * s);
    g.restore();
  });
  wallTex.wrapS = wallTex.wrapT = THREE.ClampToEdgeWrapping;
  const screen = (key) => ctx.bindEmissive(key, new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallTex, roughness: 0.22,
    emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.1 }), 0.95, { min: 0.1 });
  const scrPast = screen('pastoral'), scrRec = screen('recepcao'), scrAdm = screen('administrativo');

  // ---- utilidades ------------------------------------------------------------
  // tubo reto alinhado a um eixo, de a até b ([x, y, z])
  const pipe = (a, b, r = 0.025, mat = pvc) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    const m = cyl(r, r, L, mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 10);
    if (Math.abs(dx) > 1e-6) m.rotation.z = PI / 2; else if (Math.abs(dz) > 1e-6) m.rotation.x = PI / 2;
    return put(m);
  };

  // ======================= BUILDERS (origem no centro da base; frente = +z) =======================
  // Aparador: rodapé recuado, corpo preto, portas de madeira clara, puxadores pretos e tampo
  const credenza = (w, d, h, doors, top = woodL, body = blackM, front = woodL) => {
    const g = G();
    g.add(box(w - 0.08, 0.08, d - 0.08, metalBk, 0, 0.04, -0.01));
    g.add(box(w, h - 0.11, d, body, 0, 0.08 + (h - 0.11) / 2, 0));
    g.add(box(w + 0.02, 0.03, d + 0.02, top, 0, h - 0.015, 0));
    const dw = (w - 0.04) / doors;
    for (let i = 0; i < doors; i++) {
      const cx = -w / 2 + 0.02 + dw * (i + 0.5);
      g.add(box(dw - 0.012, h - 0.17, 0.018, front, cx, 0.08 + (h - 0.11) / 2, d / 2 + 0.009));
      g.add(box(0.012, 0.16, 0.02, metalBk, cx + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), 0.08 + (h - 0.11) * 0.62, d / 2 + 0.028));
    }
    return g;
  };
  // Cadeira de reunião / visita: concha estofada e pés pretos finos levemente abertos
  const shellChair = (fab) => {
    const g = G();
    g.add(box(0.44, 0.06, 0.44, fab, 0, 0.46, 0.01));
    const back = box(0.44, 0.38, 0.05, fab, 0, 0.73, -0.2); back.rotation.x = -0.12; g.add(back);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const l = cyl(0.012, 0.009, 0.45, metalBk, sx * 0.18, 0.215, sz * 0.17, 6);
      l.rotation.z = sx * 0.06; l.rotation.x = -sz * 0.06; g.add(l);
    }
    return g;
  };
  // Cadeira giratória de escritório (base estrela de 5 pés)
  const officeChair = (fab = uphDark) => {
    const g = G();
    g.add(box(0.5, 0.08, 0.48, fab, 0, 0.49, 0.02));
    const back = box(0.46, 0.56, 0.06, fab, 0, 0.87, -0.23); back.rotation.x = -0.08; g.add(back);
    g.add(box(0.06, 0.22, 0.03, metalBk, 0, 0.58, -0.23));
    for (const sx of [-1, 1]) g.add(box(0.04, 0.2, 0.3, metalBk, sx * 0.25, 0.6, -0.02));                      // braços (lâmina)
    g.add(cyl(0.025, 0.025, 0.36, M.chrome, 0, 0.27, 0, 8));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      const sp = box(0.3, 0.035, 0.05, metalBk, Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15); sp.rotation.y = -a; g.add(sp);
    }
    return g;
  };
  // Poltrona: base + almofada + encosto + braços, pés de madeira
  const armchair = (fab, cushion = fab, w = 0.74, d = 0.76, feet = woodL) => {
    const g = G();
    g.add(box(w, 0.22, d, fab, 0, 0.27, 0));
    g.add(box(w - 0.2, 0.1, d - 0.2, cushion, 0, 0.43, 0.07));
    const back = box(w - 0.02, 0.44, 0.16, fab, 0, 0.6, -d / 2 + 0.09); back.rotation.x = -0.08; g.add(back);
    for (const sx of [-1, 1]) g.add(box(0.1, 0.25, d - 0.12, fab, sx * (w / 2 - 0.05), 0.5, 0.06));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.022, 0.016, 0.16, feet, sx * (w / 2 - 0.07), 0.08, sz * (d / 2 - 0.07), 8));
    return g;
  };
  // Sofá de 3 lugares com almofadas de acento
  const sofa3 = (w, d, fab, seat) => {
    const g = G();
    g.add(box(w, 0.24, d, fab, 0, 0.26, 0));
    const back = box(w, 0.46, 0.2, fab, 0, 0.6, -d / 2 + 0.1); back.rotation.x = -0.06; g.add(back);
    for (const sx of [-1, 1]) g.add(box(0.16, 0.3, d, fab, sx * (w / 2 - 0.08), 0.53, 0));
    const n = 3, cw = (w - 0.32) / n;
    for (let i = 0; i < n; i++) g.add(box(cw - 0.03, 0.12, d - 0.26, seat, -w / 2 + 0.16 + cw * (i + 0.5), 0.44, 0.1));
    const p1 = box(0.42, 0.36, 0.12, terra, -w / 2 + 0.42, 0.66, -d / 2 + 0.3); p1.rotation.set(-0.25, 0.2, 0); g.add(p1);
    const p2 = box(0.4, 0.34, 0.12, amber, w / 2 - 0.42, 0.66, -d / 2 + 0.3); p2.rotation.set(-0.25, -0.2, 0); g.add(p2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.05, 0.14, 0.05, metalBk, sx * (w / 2 - 0.08), 0.07, sz * (d / 2 - 0.08)));
    return g;
  };
  // Monitor em pedestal (frente +z)
  const monitor = (w = 0.6, scr = null) => {
    const g = G();
    g.add(box(0.22, 0.012, 0.16, metalBk, 0, 0.006, 0));
    g.add(box(0.04, 0.3, 0.025, metalBk, 0, 0.16, -0.04));
    g.add(box(w, w * 0.58, 0.028, metalBk, 0, 0.3, -0.02));
    if (scr) {                                                                   // tela com o papel de parede do logo
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.024, w * 0.58 - 0.024), scr);
      p.position.set(0, 0.3, -0.0055); p.castShadow = false; g.add(p);
    } else g.add(box(w - 0.03, w * 0.58 - 0.03, 0.006, M.screenOff, 0, 0.3, -0.004, nc));
    return g;
  };
  // Luminária de mesa articulada (base, 2 hastes, cúpula que acende com a luz do ambiente)
  const deskLamp = (sh) => {
    const g = G();
    g.add(cyl(0.07, 0.075, 0.02, metalBk, 0, 0.01, 0, 14));
    const a1 = box(0.014, 0.36, 0.014, metalBk, 0, 0.19, 0.04); a1.rotation.x = 0.25; g.add(a1);
    const a2 = box(0.014, 0.3, 0.014, metalBk, 0, 0.4, 0.17); a2.rotation.x = 1.1; g.add(a2);
    const c = cyl(0.035, 0.075, 0.1, sh, 0, 0.47, 0.3, 14, true); c.rotation.x = 0.35; g.add(c);
    return g;
  };
  // Mesa de trabalho (frente +z = quem senta): tampo claro, laterais pretas, gaveteiro branco
  const workDesk = (w, d, pc = true, seed = 1, scr = null, lampSh = null) => {
    const g = G();
    g.add(box(w, 0.03, d, woodL, 0, 0.745, 0));
    for (const sx of [-1, 1]) g.add(box(0.04, 0.73, d - 0.04, metalBk, sx * (w / 2 - 0.04), 0.365, 0));
    g.add(box(w - 0.12, 0.34, 0.02, blackM, 0, 0.52, -d / 2 + 0.05));
    g.add(box(0.4, 0.56, d - 0.2, whiteTop, w / 2 - 0.3, 0.29, 0.03));
    for (let i = 0; i < 2; i++) g.add(box(0.2, 0.012, 0.012, metalBk, w / 2 - 0.3, 0.2 + i * 0.24, d / 2 - 0.06));
    if (lampSh) { const lp = deskLamp(lampSh); lp.position.set(-w / 2 + 0.14, 0.76, -d / 2 + 0.1); lp.rotation.y = 0.5; g.add(lp); }
    if (pc) {
      const mon = monitor(0.58, scr); mon.position.set(-0.05, 0.76, -d / 2 + 0.16); g.add(mon);
      g.add(box(0.42, 0.018, 0.14, graph, -0.05, 0.769, 0.06));
      const mouse = sph(0.03, metalBk, 0.28, 0.772, 0.07); mouse.scale.set(1, 0.55, 1.4); g.add(mouse);
      g.add(box(0.21, 0.012, 0.297, paper, -w / 2 + 0.25, 0.766, 0.02));
      g.add(cyl(0.04, 0.035, 0.09, seed % 2 ? ceramic : terra, w / 2 - 0.18, 0.805, -0.08, 12));
    } else {
      g.add(box(0.33, 0.018, 0.23, graph, 0, 0.769, 0.05));                      // notebook fechado
      g.add(box(0.21, 0.012, 0.297, paper, -w / 2 + 0.3, 0.766, 0.0));
    }
    return g;
  };
  // Mesa redonda (tampo claro, coluna e base pretas)
  const roundTable = (r, h = 0.75) => {
    const g = G();
    g.add(cyl(r, r, 0.035, woodL, 0, h - 0.0175, 0, 40));
    g.add(cyl(0.05, 0.05, h - 0.06, metalBk, 0, (h - 0.06) / 2 + 0.02, 0, 12));
    g.add(cyl(r * 0.45, r * 0.5, 0.03, metalBk, 0, 0.015, 0, 24));
    return g;
  };
  // Cica / planta tropical em vaso preto (upright = folhas mais em pé, para cantos)
  const plant = (potH = 0.45, span = 0.55, seed = 1, potR = 0.19, upright = false) => {
    const g = G(); let k = seed * 7.13;
    const r2 = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
    g.add(cyl(potR, potR * 0.78, potH, potBlack, 0, potH / 2, 0, 16));
    g.add(cyl(potR - 0.015, potR - 0.015, 0.02, soil, 0, potH - 0.015, 0, 14));
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + r2() * 0.35, len = span * (0.75 + r2() * 0.4), tilt = upright ? 0.95 + r2() * 0.45 : 0.5 + r2() * 0.6;
      const pv = G(); pv.position.set(0, potH, 0); pv.rotation.y = a;
      const f = box(0.1, 0.012, len, i % 2 ? frond : frond2, 0, Math.sin(tilt) * len / 2, Math.cos(tilt) * len / 2);
      f.rotation.x = -tilt; pv.add(f); g.add(pv);
    }
    return g;
  };
  // Quadro emoldurado (moldura preta, passe-partout, arte abstrata em 2 blocos) — frente +z
  const frame = (w, h, a, b) => {
    const g = G();
    g.add(box(w, h, 0.03, metalBk, 0, 0, 0, nc));
    g.add(box(w - 0.05, h - 0.05, 0.006, paper, 0, 0, 0.016, nc));
    g.add(box((w - 0.16) * 0.6, h - 0.16, 0.006, a, -(w - 0.16) * 0.2, 0, 0.02, nc));
    g.add(box((w - 0.16) * 0.4, (h - 0.16) * 0.55, 0.006, b, (w - 0.16) * 0.3, -(h - 0.16) * 0.225, 0.02, nc));
    return g;
  };
  // Pilha de livros deitados / fileira de livros em pé
  const books = (g, x, y, z, width, seed, depth = 0.22, maxH = 0.26) => {
    let k = seed * 3.7; const r2 = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
    let px = x - width / 2;
    while (px < x + width / 2 - 0.03) {
      const bw = 0.04 + r2() * 0.04, bh = maxH * (0.62 + r2() * 0.38);
      g.add(box(bw, bh, depth * (0.8 + r2() * 0.2), book[Math.floor(r2() * book.length)], px + bw / 2, y + bh / 2, z));
      px += bw + 0.004;
    }
  };
  // Estação de café: cafeteira, 2 garrafas térmicas, bandeja com xícaras e açucareiro
  const coffeeSet = (g, x, y, z) => {
    g.add(box(0.26, 0.36, 0.3, metalBk, x, y + 0.18, z - 0.02));
    g.add(cyl(0.065, 0.07, 0.15, glassTn, x, y + 0.085, z + 0.08, 14));
    g.add(cyl(0.06, 0.065, 0.06, coffee, x, y + 0.04, z + 0.08, 14));
    for (let i = 0; i < 2; i++) {
      g.add(cyl(0.055, 0.06, 0.28, i ? M.steel : metalBk, x + 0.28 + i * 0.14, y + 0.14, z - 0.04, 14));
      g.add(cyl(0.035, 0.045, 0.05, metalBk, x + 0.28 + i * 0.14, y + 0.305, z - 0.04, 12));
    }
    g.add(box(0.44, 0.015, 0.26, woodL, x + 0.72, y + 0.0075, z + 0.02));
    for (let i = 0; i < 4; i++) g.add(cyl(0.035, 0.03, 0.07, ceramic, x + 0.58 + (i % 2) * 0.12 + Math.floor(i / 2) * 0.16, y + 0.05, z - 0.03 + (i % 2) * 0.1, 12));
  };
  // Tapete em 3 camadas (borda escura, faixa, campo) — pisos em y 0,004
  const rug = (x, z, w, d) => {
    put(box(w, 0.008, d, rugEdge, x, 0.009, z, nc));
    put(box(w - 0.14, 0.008, d - 0.14, rugLine, x, 0.011, z, nc));
    put(box(w - 0.26, 0.008, d - 0.26, rugField, x, 0.013, z, nc));
    for (const t of [-1, 1]) put(box(w - 0.6, 0.004, 0.035, rugLine, x, 0.018, z + t * (d / 2 - 0.45), nc));
  };

  // =====================================================================
  // SALA PASTORAL
  // =====================================================================
  // ---- frigobar preto (canto x=12,75 / z=0) ----
  {
    const g = G();
    g.add(box(0.48, 0.84, 0.5, metalBk, 0, 0.44, 0));
    g.add(box(0.46, 0.012, 0.01, graph, 0, 0.62, 0.252, nc));
    g.add(box(0.02, 0.22, 0.03, M.chrome, 0.19, 0.5, 0.265));
    g.add(cyl(0.035, 0.03, 0.1, ceramic, -0.08, 0.91, -0.05, 12));             // caneca
    g.add(box(0.2, 0.02, 0.14, woodL, 0.08, 0.87, 0.0));                        // porta-copos
    place(g, 13.09, 0.325);
  }
  // ---- aparador para café na parede z=0 (x 13,5–16,0) + itens ----
  {
    const g = credenza(2.5, 0.46, 0.86, 4);
    coffeeSet(g, -0.9, 0.86, 0);
    g.add(cyl(0.09, 0.07, 0.22, ceramic, 0.95, 0.97, -0.05, 14));              // vaso branco
    for (let i = 0; i < 3; i++) { const a = i * 2.1; const st = box(0.012, 0.36, 0.012, frond, 0.95 + Math.cos(a) * 0.03, 1.22, -0.05 + Math.sin(a) * 0.03); st.rotation.set(Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25); g.add(st); }
    g.add(box(0.3, 0.05, 0.22, amber, 0.35, 0.885, 0.0));                       // caixa de biscoitos
    place(g, 14.75, 0.265, FZ);
    // quadros na parede do café (fora do split x 14,45–15,35)
    const q1 = frame(0.5, 0.66, terra, sand); place(q1, 13.95, 0.03, FZ, 1.68);
    const q2 = frame(0.5, 0.66, uphGray, amber); place(q2, 15.9, 0.03, FZ, 1.68);
  }
  // ---- mesa redonda de reunião (centro 14,9; 2,1) com 6 cadeiras ----
  {
    place(roundTable(0.75), 14.9, 2.1);
    for (let i = 0; i < 6; i++) {
      const a = PI / 6 + (i * PI) / 3, r = 1.0;
      place(shellChair(uphGray), 14.9 + Math.sin(a) * r, 2.1 + Math.cos(a) * r, a + PI);
    }
    // centro de mesa: bíblia aberta, caderno e vaso baixo
    put(box(0.3, 0.035, 0.22, blackM, 14.72, 0.77, 2.02));
    put(box(0.28, 0.01, 0.2, paper, 14.72, 0.792, 2.02, nc));
    put(box(0.21, 0.012, 0.29, paper, 15.3, 0.758, 2.35));
    put(cyl(0.1, 0.08, 0.12, terra, 15.05, 0.81, 1.85, 14));
    put(sph(0.09, frond2, 15.05, 0.92, 1.85));
  }
  // ---- painel com cruz na parede x=12,75 (de frente para a mesa) ----
  {
    const g = G();
    g.add(box(1.0, 1.7, 0.03, blackM, 0, 0, 0, nc));
    for (let i = 0; i < 9; i++) g.add(box(0.05, 1.62, 0.02, slat, -0.44 + i * 0.11, 0, 0.025, nc));
    g.add(box(0.1, 1.15, 0.05, whiteTop, 0, 0.02, 0.06));
    g.add(box(0.62, 0.1, 0.05, whiteTop, 0, 0.22, 0.06));
    place(g, 12.8025, 2.1, FX, 1.55);
  }
  // ---- aparador de apoio (z ≈ 4,2), aberto, atrás do sofá ----
  {
    const g = G();
    g.add(box(2.3, 0.035, 0.4, woodL, 0, 0.765, 0));
    g.add(box(2.2, 0.025, 0.34, woodL, 0, 0.2, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.035, 0.75, 0.035, metalBk, sx * 1.1, 0.375, sz * 0.17));
    for (const sx of [-1, 1]) g.add(box(0.035, 0.035, 0.34, metalBk, sx * 1.1, 0.19, 0));
    // em cima: luminária de mesa, livros deitados, vaso âmbar; embaixo: cestos
    g.add(cyl(0.07, 0.08, 0.03, metalBk, -0.85, 0.797, 0, 14));
    g.add(cyl(0.012, 0.012, 0.36, metalBk, -0.85, 0.99, 0, 6));
    g.add(cyl(0.09, 0.14, 0.18, shadePast, -0.85, 1.2, 0, 16, true));
    g.add(box(0.3, 0.04, 0.22, terra, 0.1, 0.803, 0.02)); g.add(box(0.26, 0.04, 0.2, sand, 0.1, 0.843, 0.02)); g.add(box(0.24, 0.035, 0.19, blackM, 0.1, 0.88, 0.02));
    g.add(cyl(0.07, 0.1, 0.28, amber, 0.7, 0.92, 0, 14));
    for (const sx of [-0.6, 0.45]) g.add(box(0.36, 0.22, 0.28, caramel, sx, 0.325, 0));
    place(g, 14.6, 4.2, FNZ);
  }
  // ---- estar: tapete, sofá, 2 poltronas, mesas de centro e mesa lateral ----
  rug(14.45, 6.3, 2.5, 3.0);
  place(sofa3(2.05, 0.9, linen, linenLt), 14.6, 5.02, FZ);
  place(armchair(caramel, caramel), 14.1, 7.28, FNZ);
  place(armchair(caramel, caramel), 15.1, 7.28, FNZ);
  {
    place(roundTable(0.36, 0.4), 14.35, 6.3);
    place(roundTable(0.25, 0.33), 15.0, 6.2);
    put(box(0.26, 0.04, 0.2, blackM, 14.3, 0.42, 6.3));                          // livro
    put(cyl(0.05, 0.045, 0.14, ceramic, 14.5, 0.47, 6.18, 12));
    put(sph(0.06, frond, 14.5, 0.56, 6.18));
    put(cyl(0.12, 0.11, 0.02, woodL, 15.0, 0.34, 6.2, 16));                     // bandeja
  }
  {
    const g = roundTable(0.21, 0.55);                                            // mesa lateral + abajur
    g.add(cyl(0.07, 0.09, 0.03, metalBk, 0, 0.565, 0, 12));
    g.add(cyl(0.012, 0.012, 0.3, metalBk, 0, 0.72, 0, 6));
    g.add(cyl(0.1, 0.15, 0.2, shadePast, 0, 0.94, 0, 16, true));
    place(g, 13.2, 5.05);
  }
  place(plant(0.5, 0.5, 3), 13.35, 3.5);
  place(plant(0.42, 0.55, 5, 0.18, true), 16.52, 0.52);
  // ---- 2 mesas de atendimento (lado direito) + cadeiras de visita ----
  for (const [zc, s] of [[6.0, 1], [8.2, 2]]) {
    place(workDesk(1.5, 0.72, true, s, scrPast, shadePast), 17.85, zc, FX);
    place(officeChair(), 18.66, zc, FNX);
    place(shellChair(uphGray), 16.98, zc - 0.3, FX);
    place(shellChair(uphGray), 16.98, zc + 0.3, FX);
  }
  // ---- estante alta na parede x=20,1 (z 5,0–9,0): 2 módulos pretos, fundo ripado ----
  {
    const g = G(); const L = 4.0, h = 2.2, d = 0.36;
    g.add(box(L, h, 0.02, slat, 0, h / 2, -d / 2 + 0.01));
    for (const sx of [-1, 0, 1]) g.add(box(0.035, h, d, blackM, sx * (L / 2 - 0.0175), h / 2, 0));
    const lv = [0.06, 0.62, 1.02, 1.42, 1.82, h - 0.015];
    for (const y of lv) g.add(box(L, 0.03, d, blackM, 0, y, 0));
    for (let i = 0; i < 4; i++) {                                                // portas de baixo
      const cx = -L / 2 + 0.035 + (i + 0.5) * ((L - 0.07) / 4);
      g.add(box((L - 0.1) / 4 - 0.02, 0.52, 0.018, woodL, cx, 0.34, d / 2 - 0.005));
      g.add(box(0.14, 0.012, 0.02, metalBk, cx, 0.54, d / 2 + 0.012));
    }
    // nichos: livros, caixas, vasos e porta-retratos
    const cells = [];
    for (let m = 0; m < 2; m++) for (let r = 1; r < 5; r++) cells.push([m, r]);
    cells.forEach(([m, r], i) => {
      const x0 = -L / 2 + m * (L / 2) + 0.05, y = lv[r] + 0.015, cw = L / 2 - 0.1;
      const t = (i * 5 + m) % 4;
      if (t === 0 || t === 2) { books(g, x0 + 0.4, y, 0.0, 0.6, i + 11); if (t === 0) g.add(cyl(0.07, 0.06, 0.2, ceramic, x0 + 1.35, y + 0.1, 0.0, 12)); else { g.add(box(0.3, 0.2, 0.26, caramel, x0 + 1.25, y + 0.1, 0)); g.add(box(0.3, 0.2, 0.26, sand, x0 + 1.6, y + 0.1, 0)); } }
      else if (t === 1) { books(g, x0 + cw - 0.35, y, 0.0, 0.45, i + 21); const pf = frame(0.22, 0.28, terra, sand); pf.position.set(x0 + 0.35, y + 0.14, -0.06); pf.rotation.x = -0.1; g.add(pf); }
      else { g.add(cyl(0.09, 0.07, 0.26, amber, x0 + 0.4, y + 0.13, 0, 14)); g.add(box(0.28, 0.05, 0.22, book[0], x0 + 1.0, y + 0.025, 0)); g.add(box(0.26, 0.05, 0.2, book[3], x0 + 1.0, y + 0.075, 0)); books(g, x0 + 1.55, y, 0, 0.3, i + 31); }
    });
    place(g, 19.875, 7.0, FNX);
  }
  // quadro com o LOGO sobre o estar, na parede x=12,75: tela preta, moldura de madeira clara
  // (filete) e o logo oficial em champanhe, com uma arandela de LED acima
  {
    const g = G();
    g.add(box(0.74, 0.96, 0.035, woodL, 0, 0, 0, nc));
    g.add(box(0.7, 0.92, 0.04, blackM, 0, 0, 0.004, nc));
    place(g, 12.8075, 6.4, FX, 1.62);
    const lg = ctx.logo.mesh(0.44, 0, { layout: 'full', color: '#dcc49a', roughness: 0.35, metalness: 0.5 });
    lg.rotation.y = FX; lg.position.set(12.8335, 1.63, 6.4); put(lg);
    // arandela linear (preta) com fita de LED voltada para o quadro
    put(box(0.07, 0.035, 0.6, metalBk, 12.8325, 2.2, 6.4));
    put(box(0.02, 0.006, 0.54, ledPast, 12.8525, 2.18, 6.4, nc));
  }
  // persiana rolô de linho na parede de vidro (x 14,2–16,6), meio abaixada
  {
    put(box(2.56, 0.1, 0.09, blackM, 15.4, 2.33, 9.1575));                          // caixa (bandô)
    put(box(2.46, 0.52, 0.008, linenLt, 15.4, 2.02, 9.1375, nc));                    // tecido
    put(box(2.46, 0.03, 0.02, metalBk, 15.4, 1.75, 9.1375, nc));                     // barra de peso
    put(cyl(0.004, 0.004, 0.7, metalBk, 16.52, 1.9, 9.1175, 4));                    // corrente
  }
  // violão no suporte (canto entre o aparador e a porta do banheiro) — ministério Base Music
  {
    const g = G();
    // suporte em A preto
    for (const sx of [-1, 1]) { const l = box(0.02, 0.5, 0.02, metalBk, sx * 0.14, 0.24, 0.05); l.rotation.z = sx * 0.2; g.add(l); }
    g.add(box(0.3, 0.02, 0.05, metalBk, 0, 0.2, 0.12));
    g.add(box(0.02, 0.62, 0.02, metalBk, 0, 0.31, -0.1));
    const v = G(); v.position.set(0, 0.2, 0.08); v.rotation.x = -0.24;         // violão inclinado para trás
    const lower = cyl(0.18, 0.18, 0.1, rosewood, 0, 0.19, 0, 24); lower.rotation.x = PI / 2; v.add(lower);
    const upper = cyl(0.135, 0.135, 0.1, rosewood, 0, 0.42, 0, 24); upper.rotation.x = PI / 2; v.add(upper);
    const top1 = cyl(0.175, 0.175, 0.006, spruce, 0, 0.19, 0.051, 24); top1.rotation.x = PI / 2; v.add(top1);
    const top2 = cyl(0.13, 0.13, 0.006, spruce, 0, 0.42, 0.051, 24); top2.rotation.x = PI / 2; v.add(top2);
    const hole = cyl(0.048, 0.048, 0.004, blackM, 0, 0.33, 0.055, 18); hole.rotation.x = PI / 2; v.add(hole);
    v.add(box(0.1, 0.02, 0.012, rosewood, 0, 0.12, 0.057));                     // cavalete
    v.add(box(0.05, 0.42, 0.03, rosewood, 0, 0.72, 0.02));                       // braço
    v.add(box(0.052, 0.4, 0.006, blackM, 0, 0.72, 0.037));                     // escala
    v.add(box(0.08, 0.16, 0.025, rosewood, 0, 1.0, 0.012));                    // mão
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const t = cyl(0.008, 0.008, 0.03, M.chrome, sx * 0.05, 0.95 + i * 0.045, 0.012, 6); t.rotation.z = PI / 2; v.add(t); }
    g.add(v);
    place(g, 16.4, 4.72, FNX + 0.35);
  }

  // =====================================================================
  // BANHEIRO PASTORAL (x 17,0–20,1 · z 3,1–4,9) — porta em x=17 (z 3,4–4,2)
  // =====================================================================
  {
    put(box(1.85, 1.2, 0.012, tileW, 18.12, 0.6, 4.8555, nc));                   // revestimento atrás da pia/vaso
    // bancada suspensa preta com cuba branca, espelho redondo
    const g = G();
    g.add(box(0.6, 0.36, 0.44, blackM, 0, 0.66, 0));
    g.add(box(0.62, 0.03, 0.46, whiteTop, 0, 0.855, 0));
    g.add(cyl(0.17, 0.14, 0.1, ceramic, 0, 0.92, 0.03, 18));
    g.add(cyl(0.012, 0.012, 0.2, metalBk, 0, 0.97, -0.16, 8));
    g.add(box(0.02, 0.02, 0.12, metalBk, 0, 1.07, -0.11));
    const mir = cyl(0.26, 0.26, 0.02, M.mirror, 0, 1.55, -0.21, 28); mir.rotation.x = PI / 2; g.add(mir);
    const rim = cyl(0.275, 0.275, 0.015, metalBk, 0, 1.55, -0.222, 28); rim.rotation.x = PI / 2; g.add(rim);
    place(g, 17.52, 4.6175, FNZ);
    // vaso sanitário contra a parede z=4,9
    place(ctx.F.toilet(), 18.38, 4.5375, FNZ);
    put(box(0.04, 0.12, 0.1, metalBk, 18.78, 0.7, 4.8075));                        // papeleira
    put(cyl(0.055, 0.055, 0.1, paper, 18.78, 0.66, 4.7575, 12)).rotation.z = PI / 2;
    // box de vidro com perfil preto (x 19,1–20,0)
    put(box(0.9, 0.05, 1.5, whiteTop, 19.55, 0.025, 4.0));
    put(box(0.012, 1.95, 0.75, M.glass, 19.08, 1.03, 3.6, { cast: false, receive: false }));
    put(box(0.012, 1.95, 0.72, M.glass, 19.1, 1.03, 4.4, { cast: false, receive: false }));
    put(box(0.03, 0.03, 1.5, metalBk, 19.09, 2.02, 4.0));
    put(box(0.03, 1.98, 0.03, metalBk, 19.09, 1.0, 3.24));
    put(cyl(0.012, 0.012, 1.0, metalBk, 20.015, 1.55, 4.3, 8));
    put(box(0.3, 0.02, 0.03, metalBk, 19.895, 2.05, 4.3));
    put(cyl(0.1, 0.1, 0.015, metalBk, 19.755, 2.03, 4.3, 16));
    // toalha na parede z=3,1
    put(box(0.5, 0.02, 0.02, metalBk, 18.3, 1.35, 3.1625));
    put(box(0.42, 0.55, 0.04, sand, 18.3, 1.08, 3.1775));
    // espelho com LED atrás (halo que acende com a luz da pastoral), saboneteira e plantinha
    const halo = cyl(0.3, 0.3, 0.008, ledPast, 17.52, 1.55, 4.8435, 32); halo.rotation.x = PI / 2; halo.castShadow = false; put(halo);
    put(cyl(0.035, 0.035, 0.14, blackM, 17.33, 0.94, 4.7375, 12));                   // saboneteira líquida
    put(cyl(0.01, 0.01, 0.04, blackM, 17.33, 1.03, 4.7375, 6));
    put(cyl(0.05, 0.04, 0.08, ceramic, 17.73, 0.91, 4.7575, 12));                   // vasinho
    put(sph(0.055, frond2, 17.73, 0.99, 4.7575));
    // toalheiro de argola ao lado da bancada, com toalha de rosto
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 20), metalBk);
    ring.position.set(17.97, 1.12, 4.8375); put(ring);
    put(box(0.2, 0.3, 0.025, linenLt, 17.97, 0.98, 4.8325));
    // lixeira com pedal (inox) ao lado do vaso
    put(cyl(0.1, 0.09, 0.3, steelBr, 18.78, 0.15, 4.6575, 16));
    put(cyl(0.102, 0.102, 0.02, metalBk, 18.78, 0.31, 4.6575, 16));
    // box: ralo linear, prateleira com frascos e tapete de banho
    put(box(0.6, 0.004, 0.06, steelBr, 19.55, 0.052, 4.72, nc));
    put(box(0.12, 0.02, 0.36, steelBr, 20.02, 1.09, 3.56));                     // prateleira de canto
    for (let i = 0; i < 3; i++) put(cyl(0.025, 0.025, 0.16 - i * 0.02, [amber, ceramic, terra][i], 20.02, 1.1 + (0.16 - i * 0.02) / 2, 3.46 + i * 0.1, 10));
    put(box(0.3, 0.012, 0.5, sand, 18.86, 0.012, 3.85, nc));
  }

  // =====================================================================
  // CAIXA D'ÁGUA (x 17,0–20,1 · z 0–3,1)
  // =====================================================================
  {
    put(box(2.65, 0.25, 1.95, M.concrete, 18.62, 0.125, 1.45));                 // base de concreto
    for (const x of [17.98, 19.28]) {
      put(cyl(0.6, 0.52, 0.82, tankBlue, x, 0.66, 1.45, 28));
      put(cyl(0.62, 0.62, 0.05, tankLid, x, 1.09, 1.45, 28));
      put(cyl(0.34, 0.6, 0.16, tankLid, x, 1.19, 1.45, 28));
      put(cyl(0.1, 0.1, 0.04, tankBlue, x, 1.29, 1.45, 14));
      // entrada pela tampa (boia) e saída na lateral de baixo
      pipe([x, 1.2, 0.95], [x, 1.5, 0.95], 0.022);
      pipe([x, 0.35, 1.95], [x, 0.35, 2.45], 0.025, pvcBrown);
      put(cyl(0.04, 0.04, 0.08, pvcBrown, x, 0.35, 2.3, 10)).rotation.x = PI / 2;   // registro de gaveta
      put(cyl(0.008, 0.008, 0.08, M.chrome, x, 0.42, 2.3, 6));                      // haste + volante vermelho
      const wh = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 6, 16), M.red);
      wh.rotation.x = PI / 2; wh.position.set(x, 0.465, 2.3); put(wh);
      // frisos horizontais do reservatório e trava da tampa
      for (const y of [0.45, 0.75]) { const r = 0.532 + (y - 0.25) * 0.0976; put(cyl(r, r, 0.03, tankLid, x, y, 1.45, 28)); }
      put(box(0.06, 0.05, 0.03, tankLid, x + 0.6, 1.07, 1.45));
    }
    // extravasor (ladrão): liga os dois reservatórios e sai pelo muro x = 20,1
    pipe([18.56, 0.98, 1.45], [18.7, 0.98, 1.45], 0.02);
    pipe([19.86, 0.98, 1.45], [20.075, 0.98, 1.45], 0.02);
    put(cyl(0.035, 0.035, 0.01, pvc, 20.08, 0.98, 1.45, 12)).rotation.z = PI / 2;   // espelho da saída
    put(cyl(0.07, 0.07, 0.006, steelBr, 18.6, 0.008, 2.75, 16));                 // ralo
    // mangueira enrolada no suporte (parede z = 3,1) e escada de alumínio encostada no muro z = 0
    {
      const reel = cyl(0.2, 0.2, 0.1, hoseGr, 17.55, 1.15, 2.9875, 20); reel.rotation.x = PI / 2; put(reel);
      const hub = cyl(0.08, 0.08, 0.12, metalBk, 17.55, 1.15, 2.9875, 12); hub.rotation.x = PI / 2; put(hub);
      put(box(0.04, 0.2, 0.05, metalBk, 17.55, 1.0, 3.0275));
      put(box(0.03, 0.9, 0.03, hoseGr, 17.42, 0.62, 2.9375));                     // ponta pendurada
      const lad = G();
      for (const sx of [-1, 1]) lad.add(box(0.05, 2.1, 0.025, steelBr, sx * 0.2, 1.05, 0));
      for (let i = 0; i < 6; i++) lad.add(box(0.4, 0.03, 0.02, steelBr, 0, 0.3 + i * 0.3, 0));
      lad.rotation.x = -0.1; place(lad, 17.62, 0.275, 0);
    }
    pipe([17.6, 1.5, 0.95], [19.8, 1.5, 0.95], 0.025);                          // barrilete de entrada
    pipe([19.8, 1.5, 0.95], [19.8, 1.5, 0.125], 0.025);
    pipe([19.8, 1.5, 0.125], [19.8, (ctx.HB || 2.7) - 0.08, 0.125], 0.025);   // até logo abaixo do topo da parede (v1.8)
    pipe([17.7, 0.35, 2.45], [19.6, 0.35, 2.45], 0.03, pvcBrown);               // barrilete de saída
    for (const x of [17.98, 19.28]) put(sph(0.035, pvcBrown, x, 0.35, 2.45));
    // motobomba sobre base, recalque subindo pela parede z=3,1
    put(box(0.6, 0.08, 0.38, M.concrete, 19.55, 0.04, 2.78));
    const mot = cyl(0.1, 0.1, 0.28, pumpBlue, 19.45, 0.2, 2.78, 16); mot.rotation.z = PI / 2; put(mot);
    const cap = cyl(0.08, 0.08, 0.06, metalBk, 19.28, 0.2, 2.78, 12); cap.rotation.z = PI / 2; put(cap);
    put(cyl(0.09, 0.09, 0.12, pumpBlue, 19.68, 0.2, 2.78, 14));
    pipe([19.6, 0.35, 2.45], [19.6, 0.35, 2.62], 0.03, pvcBrown);
    pipe([19.68, 0.28, 2.78], [19.68, (ctx.HB || 2.48) - 0.08, 2.78], 0.025);
    // quadro elétrico na parede x=20,1
    put(box(0.12, 0.42, 0.32, panelGr, 20.025, 1.6, 2.5));
    put(box(0.012, 0.08, 0.1, M.red, 19.96, 1.72, 2.5, nc));
    pipe([20.025, 1.39, 2.5], [20.025, 0.9, 2.5], 0.015, graph);
  }

  // =====================================================================
  // RECEPÇÃO (x 9,45–12,75 · z 5,9–9,25)
  // =====================================================================
  {
    // balcão: frente ripada virada para a espera (−x), tampo branco do lado de dentro
    put(box(0.62, 0.03, 1.6, whiteTop, 11.3, 0.745, 7.1));
    put(box(0.04, 1.06, 1.6, blackM, 10.99, 0.53, 7.1));
    put(box(0.26, 0.03, 1.66, woodL, 10.96, 1.075, 7.1));
    for (let i = 0; i < 12; i++) put(box(0.022, 0.96, 0.07, ripaB, 10.958, 0.5, 6.37 + i * 0.1327));
    for (const z of [6.32, 7.88]) put(box(0.62, 0.73, 0.04, blackM, 11.3, 0.365, z));
    put(box(0.34, 0.55, 0.5, whiteTop, 11.4, 0.28, 7.55));                      // gaveteiro
    const mon = monitor(0.5, scrRec); place(mon, 11.12, 7.25, FX, 0.76);
    put(box(0.14, 0.018, 0.4, graph, 11.4, 0.769, 7.25));                        // teclado
    put(box(0.2, 0.012, 0.28, paper, 11.35, 0.766, 6.65));
    put(cyl(0.035, 0.03, 0.09, terra, 11.5, 0.805, 6.45, 12));
    put(box(0.2, 0.06, 0.12, metalBk, 10.97, 1.12, 6.6));                         // porta-folhetos
    put(box(0.012, 0.2, 0.14, amber, 10.95, 1.2, 6.6, nc)).rotation.z = 0.2;
    place(officeChair(), 12.1, 7.15, FNX);
    // marca "B" em acrílico preto na frente ripada do balcão + fita de LED sob o tampo alto
    const mk = ctx.logo.mesh(0.34, 0, { layout: 'mark', color: '#161618', roughness: 0.3 });
    mk.rotation.y = FNX; mk.position.set(10.944, 0.6, 7.1); put(mk);
    put(box(0.012, 0.008, 1.56, ledRec, 10.87, 1.056, 7.1, nc));
    // telefone e porta-canetas no tampo de dentro
    put(box(0.16, 0.05, 0.2, metalBk, 11.45, 0.785, 6.9)); put(box(0.05, 0.03, 0.18, graph, 11.4, 0.822, 6.9));
    put(cyl(0.03, 0.03, 0.1, metalBk, 11.5, 0.81, 7.8, 10));
    // capacho com o logo (grafite, logo claro) logo depois da porta da recepção (x 11,8–12,6)
    const cap = ctx.logo.mesh(0.9, 0, { layout: 'wide', color: '#d9d4ca', bg: '#1a1a1c', pad: 0.12, roughness: 1 });
    cap.rotation.x = -PI / 2; cap.position.set(12.2, 0.014, 8.72); put(cap);
  }
  // PAREDE DA MARCA (x = 12,75, atrás do balcão): ripado de madeira clara do rodapé à sanca,
  // como o painel da fachada, com o LOGO oficial em letras caixa prateadas (ctx.logo.relief)
  // retroiluminadas — o halo e o brilho das letras acompanham a luz 'recepcao'.
  {
    const Z0 = 6.45, Z1 = 8.05, ZC = (Z0 + Z1) / 2, n = 16, pitch = (Z1 - Z0) / n;
    const YT = (ctx.HB || 2.8) - 0.02;                                              // topo da sanca, abaixo do topo da parede (v1.8)
    put(box(0.012, YT - 0.06, Z1 - Z0 + 0.04, blackM, 12.7025, (YT + 0.06) / 2, ZC, nc));   // fundo preto (sombra entre ripas)
    for (let i = 0; i < n; i++) put(box(0.03, YT - 0.16, pitch * 0.62, ripaB, 12.6775, (YT - 0.08) / 2, Z0 + pitch * (i + 0.5)));
    put(box(0.05, 0.08, Z1 - Z0 + 0.04, metalBk, 12.6875, 0.04, ZC));               // rodapé preto
    put(box(0.09, 0.08, Z1 - Z0 + 0.04, metalBk, 12.6675, YT - 0.04, ZC));          // sanca preta
    put(box(0.012, 0.008, Z1 - Z0 - 0.04, ledRec, 12.6375, YT - 0.083, ZC, nc));     // fita de LED lavando o ripado
    const L = ctx.logo.relief(0.7, { layout: 'full', depth: 0.045, layers: 4 });
    L.rotation.y = FNX; L.position.set(12.6595, YT - 0.96, ZC); put(L);
    ctx.bindEmissive('recepcao', L.userData.face, 0.45, { min: 0.25 });
    const halo = ctx.glowPlane(1.5, 1.6, 'recepcao', { color: 0xfff1dc, base: 0.32, day: 0.15 });
    halo.rotation.y = FNX; halo.position.set(12.6605, YT - 0.96, ZC); put(halo);
  }
  // 3 poltronas de espera na parede x=9,45, mesinha, planta, bebedouro e quadro
  for (const z of [6.42, 7.22, 8.02]) place(armchair(caramel, caramel, 0.66, 0.7, metalBk), 9.9125, z, FX);
  place(plant(0.5, 0.4, 7, 0.16, true), 9.8125, 8.82);
  {
    const g = G();                                                               // bebedouro com galão
    g.add(box(0.3, 0.95, 0.32, whiteTop, 0, 0.475, 0));
    g.add(box(0.3, 0.04, 0.32, graph, 0, 0.97, 0));
    g.add(cyl(0.13, 0.13, 0.42, waterJug, 0, 1.2, 0, 16));
    g.add(cyl(0.05, 0.08, 0.06, waterJug, 0, 1.44, 0, 12));
    g.add(box(0.18, 0.1, 0.03, graph, 0, 0.72, 0.17));
    for (const sx of [-1, 1]) g.add(box(0.02, 0.04, 0.03, sx < 0 ? M.blue : M.red, sx * 0.05, 0.8, 0.175));
    place(g, 12.4975, 6.1625, FNZ);
  }
  place(frame(0.8, 0.56, terra, amber), 10.55, 9.1975, FNZ, 1.65);

  // ---- placas de porta (acrílico preto, marca + nome) na face externa da parede z = 9,25 ----
  // Uma textura só (2 linhas) → 1 material → 1 draw call; cada placa usa a sua faixa de UV.
  {
    const PW = 0.26, PH = 0.1, rowH = Math.round(512 * PH / PW);
    const names = [['RECEPÇÃO'], ['SALA', 'PASTORAL']];
    const tex = ctx.makeTex(512, (g, s) => {
      g.fillStyle = '#0f0f11'; g.fillRect(0, 0, s, s);
      names.forEach((t, i) => {
        const y0 = i * rowH, pad = rowH * 0.18;
        g.fillStyle = '#17171a'; g.fillRect(0, y0, s, rowH);
        ctx.logo.draw(g, pad, y0 + pad, rowH - 2 * pad, { layout: 'mark', color: '#f4f5f7' });
        g.fillStyle = '#f4f5f7'; g.textBaseline = 'middle'; g.textAlign = 'left';
        let fs = rowH * (t.length > 1 ? 0.27 : 0.32); g.font = `700 ${fs}px ${ctx.logo.font}`;
        const maxW = s - rowH - pad * 1.2, w0 = Math.max(...t.map((l) => g.measureText(l).width));
        if (w0 > maxW) { fs *= maxW / w0; g.font = `700 ${fs}px ${ctx.logo.font}`; }
        t.forEach((l, k) => g.fillText(l, rowH * 0.98, y0 + rowH / 2 + (k - (t.length - 1) / 2) * fs * 1.12));
      });
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.1 });
    const plate = (i, x) => {
      const geo = new THREE.PlaneGeometry(PW, PH), uv = geo.attributes.uv;
      const v1 = 1 - (i * rowH) / 512, v0 = 1 - ((i + 1) * rowH) / 512;
      for (let k = 0; k < uv.count; k++) uv.setY(k, v0 + uv.getY(k) * (v1 - v0));
      const m = new THREE.Mesh(geo, mat); m.position.set(x, 1.6, 9.3005); m.castShadow = false; put(m);
      put(box(PW + 0.01, PH + 0.01, 0.01, metalBk, x, 1.6, 9.2935, nc));
    };
    plate(0, 11.52);                                                             // porta da recepção (x 11,8–12,6)
    plate(1, 14.0);                                                              // porta da pastoral (x 12,9–13,8)
  }

  // =====================================================================
  // SALA GILVAN (x 17,1–20,1 · z 11,0–14,2) — porta em x=17,1 (z 12,9–13,8)
  // =====================================================================
  {
    const g = credenza(2.0, 0.4, 0.74, 3);                                      // aparador de apoio sob a janela
    books(g, -0.68, 0.74, 0, 0.36, 41, 0.2, 0.24);
    g.add(cyl(0.07, 0.06, 0.16, ceramic, 0.05, 0.82, 0, 12)); g.add(sph(0.08, frond, 0.05, 0.94, 0));
    const pf = frame(0.2, 0.26, amber, sand); pf.position.set(0.55, 0.87, -0.05); pf.rotation.x = -0.12; g.add(pf);
    g.add(box(0.28, 0.08, 0.2, graph, 0.8, 0.78, 0));
    place(g, 18.9, 11.36, FZ);
    place(workDesk(1.3, 0.68, true, 3, scrAdm, shadeAdm), 18.6, 12.5, FX);
    place(officeChair(), 19.45, 12.5, FNX);
    place(shellChair(caramel), 17.85, 12.07, FX);
    place(shellChair(caramel), 17.85, 12.62, FX);
    place(plant(0.42, 0.4, 9, 0.16, true), 19.68, 13.8);
    place(frame(0.7, 0.5, blackM, terra), 18.6, 14.1, FNZ, 1.65);
    // 2 prateleiras flutuantes (madeira clara, mão-francesa oculta) na parede x = 20,1, atrás da cadeira:
    // livros, bíblia, porta-retrato, plantinha e um bloco de madeira com a marca "B"
    const sh = G();
    for (const y of [1.45, 1.85]) sh.add(box(0.24, 0.035, 1.3, woodL, 0, y, 0));
    books(sh, 0, 1.4675, 0, 0.5, 51, 0.18, 0.24);                              // fileira ao longo de z (girada abaixo)
    sh.children.slice(2).forEach((bk) => { const x0 = bk.position.x; bk.position.x = bk.position.z + 0.01; bk.position.z = x0 - 0.3; bk.rotation.y = PI / 2; });
    sh.add(box(0.2, 0.05, 0.28, blackM, 0.0, 1.492, 0.38)); sh.add(box(0.19, 0.012, 0.26, amber, 0.0, 1.521, 0.38));
    sh.add(cyl(0.06, 0.05, 0.12, ceramic, 0.0, 1.927, -0.45, 12)); sh.add(sph(0.08, frond2, 0.0, 2.04, -0.45));
    sh.add(box(0.05, 0.24, 0.24, woodL, -0.02, 1.987, 0.05));
    const bm = ctx.logo.mesh(0.19, 0, { layout: 'mark', color: '#1b1b1d', roughness: 0.4 });
    bm.rotation.y = FNX; bm.position.set(-0.047, 1.987, 0.05); sh.add(bm);
    const pf2 = frame(0.18, 0.24, sand, terra); pf2.rotation.y = FNX; pf2.rotation.z = 0; pf2.position.set(-0.02, 1.99, 0.42); sh.add(pf2);
    place(sh, 19.88, 12.55, 0);
    // cabideiro de pé no canto da porta
    const cb = G();
    cb.add(cyl(0.18, 0.2, 0.025, metalBk, 0, 0.0125, 0, 20));
    cb.add(cyl(0.016, 0.016, 1.72, metalBk, 0, 0.87, 0, 8));
    for (let i = 0; i < 4; i++) { const hk = box(0.16, 0.016, 0.016, metalBk, Math.cos(i * PI / 2) * 0.07, 1.68, Math.sin(i * PI / 2) * 0.07); hk.rotation.y = -i * PI / 2; hk.rotation.z = 0.35 * (i % 2 ? 1 : 1); cb.add(hk); }
    cb.add(box(0.34, 0.62, 0.1, graph, 0.1, 1.36, 0.03));                      // blazer pendurado
    cb.add(box(0.24, 0.3, 0.06, caramel, -0.07, 1.42, -0.1));                   // bolsa
    place(cb, 17.45, 11.4, 0.6);
  }

  // =====================================================================
  // ADMINISTRATIVO (x 17,1–20,1 · z 14,2–19,0) — porta em x=17,1 (z 14,4–15,3)
  // =====================================================================
  {
    // aparador da impressora na parede z=14,2
    const g = credenza(1.5, 0.48, 0.74, 3, woodL, blackM, woodL);
    g.add(box(0.5, 0.3, 0.42, whiteTop, 0.25, 0.89, 0));                       // multifuncional
    g.add(box(0.5, 0.06, 0.42, graph, 0.25, 1.07, -0.0));
    g.add(box(0.36, 0.012, 0.22, paper, 0.25, 0.9, 0.23));
    g.add(box(0.12, 0.012, 0.08, metalBk, 0.42, 1.101, 0.1));
    g.add(box(0.3, 0.12, 0.22, paper, -0.45, 0.8, 0.02));                       // resmas
    g.add(box(0.08, 0.28, 0.25, book[1], -0.2, 0.88, 0)); g.add(box(0.08, 0.28, 0.25, book[6], -0.11, 0.88, 0));
    place(g, 19.2, 14.6, FZ);
    // logo 'wide' em acrílico preto (letras caixa finas) na parede z = 14,2, acima da multifuncional
    const LW = ctx.logo.relief(0.95, { layout: 'wide', depth: 0.018, layers: 3, color: 0x1b1b1d, sideColor: 0x0d0d0f, metalness: 0.25, roughness: 0.35 });
    LW.position.set(19.2, 1.74, 14.279); put(LW);
    // 2 estações de trabalho
    for (const [zc, s] of [[15.95, 4], [17.8, 5]]) {
      place(workDesk(1.3, 0.68, true, s, scrAdm), 18.6, zc, FX);
      place(officeChair(), 19.45, zc, FNX);
      place(shellChair(caramel), 17.95, zc, FX);
    }
    // aparador para café na parede x=17,1 (entre a porta e a janela J05)
    const c = credenza(1.25, 0.4, 0.86, 2);
    coffeeSet(c, -0.4, 0.86, 0);
    place(c, 17.42, 16.08, FX);
    // arquivo de aço de 4 gavetas na parede z=19
    const a = G();
    a.add(box(0.47, 1.33, 0.58, graph, 0, 0.665, 0));
    for (let i = 0; i < 4; i++) {
      a.add(box(0.43, 0.3, 0.012, graph, 0, 0.17 + i * 0.325, 0.296));
      a.add(box(0.16, 0.02, 0.025, M.chrome, 0, 0.26 + i * 0.325, 0.31));
      a.add(box(0.08, 0.035, 0.005, paper, 0, 0.29 + i * 0.325, 0.304, nc));
    }
    a.add(cyl(0.08, 0.06, 0.18, ceramic, 0.08, 1.42, 0, 12)); a.add(sph(0.1, frond2, 0.08, 1.56, 0));
    place(a, 17.8, 18.6, FNZ);
    place(plant(0.42, 0.4, 13, 0.16, true), 19.68, 18.6);
    // mural de cortiça (escala do culto, avisos) na parede x = 20,1, entre as estações
    {
      const g2 = G();
      g2.add(box(1.1, 0.78, 0.03, metalBk, 0, 0, 0));
      g2.add(box(1.04, 0.72, 0.012, cork, 0, 0, 0.018, nc));
      const notes = [[-0.36, 0.18, 0.21, 0.297, paper], [-0.1, 0.2, 0.18, 0.18, sand], [0.16, 0.16, 0.21, 0.297, paper], [0.4, 0.2, 0.15, 0.15, amber],
        [-0.34, -0.17, 0.26, 0.18, linenLt], [-0.04, -0.16, 0.21, 0.297, paper], [0.24, -0.17, 0.2, 0.14, terra], [0.42, -0.18, 0.1, 0.14, paper]];
      notes.forEach(([x, y, w, h, m], i) => {
        const n = box(w, h, 0.004, m, x, y, 0.027, nc); n.rotation.z = ((i * 37) % 7 - 3) * 0.015; g2.add(n);
        g2.add(sph(0.012, i % 2 ? M.red : amber, x, y + h / 2 - 0.025, 0.032));
      });
      place(g2, 19.995, 16.88, FNX, 1.58);
    }
    // relógio de parede na parede z=19
    const clk = cyl(0.16, 0.16, 0.03, metalBk, 18.9, 2.05, 18.9, 24); clk.rotation.x = PI / 2; put(clk);
    const face = cyl(0.145, 0.145, 0.006, ceramic, 18.9, 2.05, 18.882, 24); face.rotation.x = PI / 2; face.castShadow = false; put(face);
    put(box(0.012, 0.1, 0.006, metalBk, 18.9, 2.09, 18.876, nc));
    const hand = box(0.012, 0.07, 0.006, metalBk, 18.925, 2.04, 18.876, nc); hand.rotation.z = -2.0; put(hand);
  }

  // =====================================================================
  // DETALHES DE REALISMO (v1.5.1): interruptores/tomadas junto às portas, tomada da estação de café,
  // calendários de parede (Gilvan e Adm.), cestos de lixo sob as mesas, ralo do banheiro pastoral.
  // Placas a ≥ 3 mm das faces internas (bloco dos fundos: paredes de 7,5 cm).
  // =====================================================================
  {
    const plate = (axis, f, dir, t, y, kind) => {
      const d = 0.012, c = f + dir * d / 2, dd = 0.006, cc = f + dir * (d + dd / 2);
      if (axis === 'x') {
        put(box(0.075, 0.12, d, whiteTop, t, y, c, nc));
        put(kind === 'sw' ? box(0.03, 0.045, dd, ceramic, t, y + 0.01, cc, nc) : box(0.034, 0.034, dd, blackM, t, y, cc, nc));
      } else {
        put(box(d, 0.12, 0.075, whiteTop, c, y, t, nc));
        put(kind === 'sw' ? box(dd, 0.045, 0.03, ceramic, cc, y + 0.01, t, nc) : box(dd, 0.034, 0.034, blackM, cc, y, t, nc));
      }
    };
    // calendário de parede (folha branca, cabeçalho âmbar, grade de dias em grafite) — parede paralela a x, face z = f
    const calendar = (f, dir, x, y) => {
      put(box(0.3, 0.42, 0.006, paper, x, y, f + dir * 0.003, nc));
      put(box(0.3, 0.1, 0.004, amber, x, y + 0.16, f + dir * 0.008, nc));
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) if ((r * 7 + c) % 3 !== 1) put(box(0.026, 0.026, 0.003, graph, x - 0.12 + c * 0.04, y + 0.05 - r * 0.045, f + dir * 0.0085, nc));
      put(cyl(0.006, 0.006, 0.02, metalBk, x, y + 0.225, f + dir * 0.01, 8));
    };
    const bin = (x, z) => { put(cyl(0.12, 0.1, 0.28, metalBk, x, 0.14, z, 14)); put(box(0.14, 0.02, 0.14, paper, x, 0.27, z, nc)); };
    const drain = (x, z) => { put(box(0.1, 0.006, 0.1, steelBr, x, 0.008, z, nc)); put(box(0.08, 0.004, 0.08, blackM, x, 0.013, z, nc)); };

    // Sala Pastoral: interruptores ao lado das portas (z = 9,25 · x 12,9–13,8 e x = 12,75 · z 8,2–9,1), tomada sobre a estação de café
    plate('x', 9.2125, -1, 14.1, 1.15, 'sw'); plate('z', 12.7875, 1, 7.85, 1.15, 'sw');
    plate('x', 0.012, 1, 15.2, 1.1, 'out'); plate('x', 0.012, 1, 14.2, 1.1, 'out');
    drain(18.25, 3.95);                                                                        // banheiro pastoral
    // Recepção: interruptor ao lado da porta (x 11,8–12,6)
    plate('x', 9.2125, -1, 11.45, 1.15, 'sw');
    // Sala Gilvan: calendário na parede z = 14,2 (ao lado do quadro) e cesto ao pé da mesa
    calendar(14.125, -1, 19.5, 1.7);
    bin(18.05, 13.1);
    // Administrativo: calendário na parede z = 19 (à direita do relógio) e cesto entre as estações
    calendar(18.925, -1, 19.5, 1.7);
    bin(18.05, 16.9);
  }
}

function roomServicoPatio(ctx) {
  // ---------------------------------------------------------------------------
  // FUNDOS / SERVIÇO (z 0–12,4)
  //  · Estacionamento interno (x 0–4,9): 2 sedãs ao longo de z (centros x 2,4 · z 3,8 e 8,8),
  //    faixas de vaga pintadas, batentes de roda, torneira com mangueira no muro x=0 e a
  //    coleta seletiva (4 lixeiras + placa) perto do portão, na face externa do almoxarifado.
  //    O portão de correr (parede z=0) e a arandela do pátio (0,085; 2,8; 6,2) são do cartão.
  //  · Almoxarifado (x 4,9–8,6 · z 0–3,9): 3 estantes de aço com caixas e organizadores,
  //    cases de som (rack com rodízios, mesa de som, caixas) com estêncil "BASE MUSIC",
  //    caixa de som PA, pilhas de cadeiras empilháveis, escada de alumínio, balde com rodo.
  //  · Cozinha (x 8,6–12,75 · z 0–3,9): bancada em L (madeira clara + granito preto), cuba,
  //    cooktop com forno e coifa, armários aéreos brancos, geladeira inox, micro-ondas,
  //    garrafões de café, escorredor, mesa de apoio inox, purificador, lixeira e lousa
  //    "Café da Base" com o logo oficial na parede x=12,75.
  //    Janela (x 9,2–10,8) e porta (x 11,6–12,5) da parede z=3,9 ficam livres.
  //  · Pátio: PAREDÃO DA MARCA na face externa do almoxarifado (z=3,9 · x 5,0–7,3): ripado de
  //    madeira clara como o da fachada, logo oficial em letras caixa (ctx.logo.relief), sanca
  //    com fita de LED, halo e floreira preta com uplights. Medalhão com o "B" no piso
  //    (x 11,1 · z 10,85), no caminho recepção → templo. Banco ripado com LED sob o assento,
  //    bicicletário com 2 bicicletas, abrigo de gás, cicas em vasos pretos na porta do templo.
  //  · Jardim interno (x 7,5–9,45 · z 5,8–10,2): meio-fio, cica, arbustos,
  //    forração, pedras brancas e spots de chão (só emissivo, sem luz real).
  //  · Jardim pastoral (x 12,75–20,1 · z 9,25–11,0): pisantes de concreto ligando a porta
  //    da pastoral e o pátio à porta PM01, canteiros com forração, buxinhos e moreias (v1.8: sem árvores).
  // Livres: rotas das portas (PM01, recepção, pastoral, vidro do templo, cozinha, almox.),
  // luminárias do cartão (cozinha 10,7/6,75 · y 2,7 · z 1,95) e a arandela do pátio.
  // Brilhos da decoração (spots, LEDs do paredão e do banco, logo) seguem 'estacionamento'
  // (a luz externa dos fundos) via ctx.bindEmissive — apagados de dia, acesos à noite.
  // ---------------------------------------------------------------------------
  const { THREE, M, box, cyl, sph, place, add, std, rnd } = ctx;
  const G = () => new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const PI = Math.PI;
  const j = (k) => (rnd() - 0.5) * 2 * k;                          // jitter determinístico ±k
  const nc = { cast: false };
  const flat = (m) => { m.castShadow = false; return m; };          // peças rasteiras não projetam sombra
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };

  // ---- materiais (mesmas opções → mesmo material → menos draw calls) ---------------------
  const P = {
    paint: std({ color: 0xeceae3, roughness: 0.85 }), yellow: std({ color: 0xd9a930, roughness: 0.8 }),
    steelG: std({ color: 0x8d9298, roughness: 0.5, metalness: 0.5 }), steelDk: std({ color: 0x4a4e53, roughness: 0.55, metalness: 0.4 }),
    card: std({ color: 0xb08c5a, roughness: 1 }), card2: std({ color: 0x9c7a4c, roughness: 1 }),
    binW: std({ color: 0xe4e2dc, roughness: 0.7 }), binAmber: std({ color: 0xd08a3a, roughness: 0.7 }), binGray: std({ color: 0x5f6368, roughness: 0.7 }),
    caseBlk: std({ color: 0x1d1d20, roughness: 0.7 }), alu: std({ color: 0xb7bcc2, roughness: 0.35, metalness: 0.8 }),
    grille: std({ color: 0x2c2d30, roughness: 0.95 }),
    chairBlk: std({ color: 0x1f2022, roughness: 0.55, metalness: 0.3 }), upholst: std({ color: 0x3b3d42, roughness: 0.95 }),
    woodL: std({ color: 0xd2b08a, roughness: 0.65 }), granite: std({ color: 0x1e1f22, roughness: 0.3, metalness: 0.1 }),
    splash: std({ color: 0xdadddd, roughness: 0.5 }), cabW: std({ color: 0xf2f0ea, roughness: 0.6 }),
    glassBlk: std({ color: 0x121315, roughness: 0.15, metalness: 0.3 }), burner: std({ color: 0x3a3a3c, roughness: 0.5 }),
    trim: std({ color: 0x141416, roughness: 0.6 }),
    carWhite: std({ color: 0xe9e9e6, roughness: 0.3, metalness: 0.3 }), carGray: std({ color: 0x44484e, roughness: 0.3, metalness: 0.5 }),
    carGlass: std({ color: 0x1b232c, roughness: 0.1, metalness: 0.6 }), rim: std({ color: 0xb9bec4, roughness: 0.3, metalness: 0.8 }),
    plate: std({ color: 0xf0f0ea, roughness: 0.6 }), plateBlue: std({ color: 0x1f4ea3, roughness: 0.6 }),
    binBlue: std({ color: 0x2f5f9e, roughness: 0.7 }), binRed: std({ color: 0xb23a2e, roughness: 0.7 }),
    binGreen: std({ color: 0x2f7a3e, roughness: 0.7 }), binYel: std({ color: 0xd9a82a, roughness: 0.7 }),
    potBlk: std({ color: 0x1f1f21, roughness: 0.7 }), hose: std({ color: 0x3e7a3f, roughness: 0.8 }),
    bikeT: std({ color: 0xb85c38, roughness: 0.5, metalness: 0.3 }), bikeK: std({ color: 0x26282b, roughness: 0.5, metalness: 0.3 }),
    leafDk: std({ color: 0x24512a, roughness: 1 }), leafLt: std({ color: 0x6b9a3e, roughness: 1 }), palm: std({ color: 0x4d8a3c, roughness: 0.9 }),
    cyca: std({ color: 0x35612b, roughness: 0.9 }), forr: std({ color: 0x4f7d33, roughness: 1 }), strap: std({ color: 0x5f8f4a, roughness: 0.9 }),
    flowerY: std({ color: 0xf0c040, roughness: 0.9 }), flowerT: std({ color: 0xc8643c, roughness: 0.9 }),
    pebble: std({ color: 0xeceae4, roughness: 0.95 }), pebble2: std({ color: 0xd9d5cb, roughness: 0.95 }),
    rock: std({ color: 0x8f8b82, roughness: 0.95 }), slab: std({ color: 0xbdb9b0, roughness: 0.95 }),
    spotBody: std({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.4 }),
    // emissivos com opções exclusivas (o cache de std é do cartão inteiro): acendem com 'estacionamento'
    spotLens: std({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 0.6, roughness: 0.39 }),
    led: std({ color: 0xfff0d8, emissive: 0xffd49a, emissiveIntensity: 0.1, roughness: 0.43 }),
    ripa: std({ color: 0xd9b8a0, roughness: 0.72 }), ripaFundo: std({ color: 0xa8876f, roughness: 0.85 }),
    medal: std({ color: 0x2b2c30, roughness: 0.85 }),
    gasDoor: std({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 }), thermoR: std({ color: 0x8b2f2f, roughness: 0.5 }),
    fruitO: std({ color: 0xe08a2a, roughness: 0.7 }), fruitG: std({ color: 0x7ca23a, roughness: 0.7 }),
  };
  // spots de chão, fitas de LED e uplights: quase apagados de dia, acesos com a luz externa dos fundos
  if (ctx.bindEmissive) { ctx.bindEmissive('estacionamento', P.spotLens, 1.5); ctx.bindEmissive('estacionamento', P.led, 1.8); }
  const logo = ctx.logo;

  // ---- builders locais ------------------------------------------------------------------------
  // cilindro entre dois pontos (tubos de bicicleta, bicicletário, galhos, cabo do rodo)
  const tube = (g, a, b, r, mat, seg = 8) => {
    const A = V(...a), B = V(...b), d = B.clone().sub(A);
    const m = cyl(r, r, d.length(), mat, 0, 0, 0, seg);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    g.add(m); return m;
  };
  // toro (rodas de bicicleta, mangueira, carretel de cabo)
  const torus = (r, t, mat, x, y, z, rx = 0, ry = 0, seg = 20) => {
    const m = mk(new THREE.TorusGeometry(r, t, 8, seg), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); return m;
  };
  // folha comprida saindo de (cx,cy,cz): ângulo `a` no plano, inclinação `t` (positivo = caindo)
  const frond = (g, cx, cy, cz, len, w, a, t, mat) => {
    const m = box(len, 0.02, w, mat, 0, 0, 0), L = len / 2, ct = Math.cos(t);
    m.position.set(cx + L * ct * Math.cos(a), cy - L * Math.sin(t), cz - L * ct * Math.sin(a));
    m.rotation.set(0, a, -t);
    g.add(m); return m;
  };
  // perfil lateral (s = z do carro, y) extrudado na largura (eixo x), centrado em x = 0
  const extrudeX = (pts, width, mat, bevel = 0.04) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 4) sh.absarc(p[0], p[1], p[2], 0, p[3], false); else sh.lineTo(p[0], p[1]);
    }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 10 });
    geo.rotateY(-PI / 2); geo.translate(width / 2 - bevel, 0, 0);
    return mk(geo, mat);
  };

  // =============================== ESTACIONAMENTO INTERNO ===============================
  // Sedã (frente em −z local): carroceria extrudada com caixas de roda, estufa de vidro fumê,
  // teto, rodas com aro, faróis, lanternas, grade, placas Mercosul, retrovisores e maçanetas.
  const sedan = (paint) => {
    const g = G();
    g.add(extrudeX([[-2.3, 0.34], [-2.36, 0.52], [-2.32, 0.7], [-1.9, 0.8], [-1.0, 0.9], [1.4, 0.93], [2.2, 0.9], [2.32, 0.78], [2.34, 0.5], [2.28, 0.34],
      [1.8, 0.34], [1.38, 0.3, 0.42, PI], [-0.96, 0.34], [-1.38, 0.3, 0.42, PI], [-2.3, 0.34]], 1.74, paint, 0.06));
    g.add(extrudeX([[-1.0, 0.86], [-0.22, 1.36], [0.78, 1.38], [1.42, 0.9]], 1.42, P.carGlass, 0.04));
    g.add(box(1.34, 0.04, 0.96, paint, 0, 1.415, 0.28));                         // teto
    g.add(box(1.44, 0.42, 0.08, paint, 0, 1.13, 0.3));                           // coluna B
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const t = cyl(0.31, 0.31, 0.22, P.trim, sx * 0.74, 0.31, sz * 1.38, 18); t.rotation.z = PI / 2; g.add(t);
      const r = cyl(0.19, 0.19, 0.226, P.rim, sx * 0.74, 0.31, sz * 1.38, 14); r.rotation.z = PI / 2; g.add(r);
    }
    for (const sx of [-1, 1]) {
      g.add(box(0.36, 0.1, 0.12, M.lightWhite, sx * 0.56, 0.72, -2.29));         // faróis
      g.add(box(0.4, 0.1, 0.1, M.lightRed, sx * 0.55, 0.8, 2.31));               // lanternas
      g.add(box(0.08, 0.1, 0.18, paint, sx * 0.93, 0.98, -0.78));                // retrovisores
      g.add(box(0.02, 0.025, 0.14, M.chrome, sx * 0.875, 0.84, -0.15));          // maçanetas dianteiras
    }
    g.add(box(0.8, 0.14, 0.06, P.trim, 0, 0.5, -2.39));                          // grade
    for (const sz of [-1, 1]) {
      g.add(box(1.66, 0.1, 0.08, P.trim, 0, 0.38, sz * 2.35));                   // para-choques
      g.add(box(0.52, 0.12, 0.02, P.plate, 0, 0.52, sz * 2.42));                 // placas
      g.add(box(0.52, 0.03, 0.024, P.plateBlue, 0, 0.565, sz * 2.42));           // faixa azul Mercosul
    }
    return g;
  };
  place(sedan(P.carWhite), 2.4, 3.8, 0);        // de ré, frente para o portão
  place(sedan(P.carGray), 2.4, 8.8, PI);        // de frente, nariz para o fundo

  // Faixas de vaga pintadas (2 vagas de 2,5 × 5,3 m) e batentes de roda amarelos
  for (const x of [1.15, 3.65]) add(box(0.1, 0.006, 10.7, P.paint, x, 0.01, 6.3, nc));
  for (const z of [0.95, 6.3, 11.65]) add(box(2.6, 0.006, 0.1, P.paint, 2.4, 0.01, z, nc));
  for (const z of [5.62, 10.62]) {
    add(box(1.3, 0.1, 0.15, P.yellow, 2.4, 0.05, z));
    for (const x of [1.95, 2.85]) add(box(0.22, 0.102, 0.152, P.trim, x, 0.05, z));   // listras pretas
  }
  // Torneira com mangueira enrolada no muro x=0 (fundo do estacionamento; face interna em x 0,012)
  add(box(0.06, 0.34, 0.3, P.steelDk, 0.045, 0.85, 11.8));
  add(torus(0.14, 0.028, P.hose, 0.135, 0.85, 11.8, 0, PI / 2, 22));
  add(cyl(0.02, 0.02, 0.1, M.chrome, 0.065, 1.12, 11.8, 8));

  // ===================================== ALMOXARIFADO =====================================
  // Estante de aço (4 colunas, `levels` prateleiras) com caixas de papelão e organizadores
  const rack = (w, d, h, levels) => {
    const g = G();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.035, h, 0.035, P.steelG, sx * (w / 2 - 0.018), h / 2, sz * (d / 2 - 0.018)));
    const step = (h - 0.12) / (levels - 1);
    for (let i = 0; i < levels; i++) {
      const y = 0.08 + i * step;
      g.add(box(w, 0.025, d, P.steelG, 0, y, 0));
      const top = i === levels - 1;
      let x = -w / 2 + 0.05;
      while (x < w / 2 - 0.25) {
        const bw = 0.26 + rnd() * 0.18, bh = top ? 0.2 + rnd() * 0.1 : 0.18 + rnd() * 0.15, t = rnd();
        if (x + bw > w / 2 - 0.03) break;
        if (t < 0.88) {
          const mat = t < 0.5 ? (rnd() < 0.5 ? P.card : P.card2) : t < 0.7 ? P.binW : t < 0.8 ? P.binAmber : P.binGray;
          g.add(box(bw, bh, d - 0.08 - rnd() * 0.06, mat, x + bw / 2, y + 0.0125 + bh / 2, j(0.02)));
        }
        x += bw + 0.03 + rnd() * 0.05;
      }
    }
    return g;
  };
  place(rack(1.2, 0.45, 2.0, 5), 5.75, 0.315);
  place(rack(1.2, 0.45, 2.0, 5), 7.05, 0.315);
  place(rack(1.2, 0.45, 2.0, 5), 8.2575, 1.42, PI / 2);

  // Case de transporte (flight case): corpo preto, frisos e cantoneiras de alumínio, alças
  const flightCase = (w, h, d, casters = false) => {
    const g = G(), y0 = casters ? 0.08 : 0;
    g.add(box(w, h, d, P.caseBlk, 0, y0 + h / 2, 0));
    for (const y of [y0 + 0.015, y0 + h - 0.015]) g.add(box(w + 0.012, 0.03, d + 0.012, P.alu, 0, y, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.03, h - 0.06, 0.03, P.alu, sx * (w / 2 - 0.01), y0 + h / 2, sz * (d / 2 - 0.01)));
    for (const sx of [-1, 1]) g.add(box(0.03, 0.03, Math.min(0.18, d * 0.4), P.alu, sx * (w / 2 + 0.012), y0 + h * 0.6, 0));
    if (casters) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.035, 0.035, 0.03, P.trim, sx * (w / 2 - 0.07), 0.04, sz * (d / 2 - 0.07), 10));
    return g;
  };
  place(flightCase(0.6, 0.62, 0.62, true), 5.42, 1.25);                          // rack de amplificadores
  place(flightCase(0.72, 0.16, 0.56), 5.42, 1.25, PI / 2, 0.71);                 // mesa de som em cima
  place(flightCase(0.52, 0.5, 0.5), 5.36, 2.05);                                 // caixas de retorno
  place(flightCase(0.46, 0.4, 0.44), 5.36, 2.05, 0.08, 0.51);
  // Estêncil branco "BASE MUSIC" (logo oficial) nos cases: lateral do rack, tampa da mesa de som e case de cima
  const stencilTex = ctx.makeTex(256, (g2, s) => {
    g2.clearRect(0, 0, s, s);
    logo.draw(g2, s * 0.25, s * 0.04, s * 0.5, { layout: 'mark', color: '#ecebe6' });
    g2.fillStyle = '#ecebe6'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.font = `700 ${Math.round(s * 0.15)}px ${logo.font}`; g2.fillText('BASE', s / 2, s * 0.68);
    g2.font = `700 ${Math.round(s * 0.1)}px ${logo.font}`; g2.fillText('M U S I C', s / 2, s * 0.84);
  });
  const stencilMat = new THREE.MeshStandardMaterial({ map: stencilTex, alphaTest: 0.5, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stencil = (sz, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), stencilMat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.receiveShadow = true; add(m); return m; };
  stencil(0.24, 5.7235, 0.26, 1.25, 0, PI / 2);                                   // lateral do rack (abaixo da alça)
  stencil(0.3, 5.42, 0.8715, 1.25, -PI / 2, PI / 2);                              // tampa da mesa de som
  stencil(0.26, 5.36, 0.9115, 2.05, -PI / 2, 0.08);                               // case de retorno de cima
  // Caixa de som PA (grade frontal voltada para a sala)
  add(box(0.44, 0.72, 0.38, P.caseBlk, 5.32, 0.36, 2.78));
  add(box(0.012, 0.6, 0.32, P.grille, 5.546, 0.38, 2.78, nc));
  add(box(0.03, 0.03, 0.16, P.alu, 5.32, 0.735, 2.78));
  // Carretel de cabo e pedestais de microfone deitados no chão
  add(torus(0.16, 0.05, P.trim, 6.05, 0.21, 1.3, 0, PI / 2, 18));
  const reel = cyl(0.1, 0.1, 0.14, P.binAmber, 6.05, 0.21, 1.3, 14); reel.rotation.z = PI / 2; add(reel);
  for (const dx of [-0.05, 0.05]) {                                           // 2 pedestais dobrados no chão
    const s = cyl(0.012, 0.012, 1.0, P.trim, 6.1 + dx, 0.03, 2.05, 8); s.rotation.x = PI / 2; add(s);
    add(cyl(0.02, 0.02, 0.1, P.trim, 6.1 + dx, 0.03, 1.52, 8)).rotation.x = PI / 2;
  }

  // Pilhas de cadeiras empilháveis (estrutura preta, assento/encosto grafite; encosto para +z)
  const chairStack = (n) => {
    const g = G(), dy = 0.055, top = 0.45 + (n - 1) * dy;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.025, top, 0.025, P.chairBlk, sx * 0.21, top / 2, sz * 0.2));
    const backTop = top + 0.47;
    for (const sx of [-1, 1]) g.add(box(0.025, backTop - top, 0.025, P.chairBlk, sx * 0.21, (top + backTop) / 2, -0.23 - (n - 1) * 0.01));
    for (let i = 0; i < n; i++) {
      const y = 0.45 + i * dy;
      g.add(box(0.46, 0.05, 0.44, P.upholst, 0, y, 0.02));
      g.add(box(0.44, 0.32, 0.04, P.upholst, 0, y + 0.3, -0.22 - i * 0.01));
    }
    return g;
  };
  place(chairStack(8), 6.15, 3.3, PI);
  place(chairStack(5), 6.72, 3.3, PI);

  // Escada de alumínio (tesoura fechada) encostada na parede x=8,6
  const ladder = () => {
    const g = G(), h = 1.8;
    for (const sz of [-1, 1]) {
      g.add(box(0.04, h, 0.07, P.alu, 0, h / 2, sz * 0.21));                    // montantes
      g.add(box(0.03, h - 0.1, 0.05, P.alu, -0.06, (h - 0.1) / 2, sz * 0.2));   // pernas traseiras fechadas
      g.add(box(0.07, 0.04, 0.09, P.trim, -0.02, 0.02, sz * 0.21));             // sapatas
    }
    for (let i = 0; i < 5; i++) g.add(box(0.1, 0.03, 0.42, P.alu, 0.01, 0.3 + i * 0.3, 0));
    g.add(box(0.14, 0.06, 0.5, P.trim, -0.02, h + 0.03, 0));                     // topo
    return g;
  };
  const lad = place(ladder(), 8.1975, 2.42); lad.rotation.z = -0.155;
  // Balde com rodo no canto perto da porta
  add(cyl(0.14, 0.12, 0.28, P.binBlue, 7.15, 0.14, 3.55, 14));
  const mopG = G(); tube(mopG, [7.15, 0.05, 3.55], [7.3, 1.35, 3.62], 0.012, P.woodL); add(mopG);
  add(box(0.34, 0.04, 0.06, P.trim, 7.15, 0.04, 3.55));

  // ======================================== COZINHA ========================================
  // Bancada em L: trecho ao longo de z=0 (x 8,72–11,72) + perna ao longo de x=8,6 (z 0,645–2,225)
  const RUN = { x0: 8.7225, x1: 11.72, z: 0.345, d: 0.6 }, runL = RUN.x1 - RUN.x0, runC = (RUN.x0 + RUN.x1) / 2;
  add(box(runL, 0.1, RUN.d - 0.08, P.trim, runC, 0.05, RUN.z - 0.02));                        // rodapé recuado
  add(box(runL, 0.76, RUN.d - 0.02, P.woodL, runC, 0.48, RUN.z - 0.01));                       // gabinetes
  add(box(runL + 0.02, 0.04, RUN.d + 0.02, P.granite, runC, 0.88, RUN.z));                     // tampo de granito
  const LEG = { x: 9.0225, z0: 0.645, z1: 2.225 }, legL = LEG.z1 - LEG.z0, legC = (LEG.z0 + LEG.z1) / 2;
  add(box(0.52, 0.1, legL, P.trim, LEG.x - 0.02, 0.05, legC));
  add(box(0.58, 0.76, legL, P.woodL, LEG.x - 0.01, 0.48, legC));
  add(box(0.62, 0.04, legL + 0.02, P.granite, LEG.x, 0.88, legC + 0.01));
  // frentes: frisos e puxadores pretos (o módulo do forno fica sem porta)
  const fz = RUN.z + 0.29;
  for (let i = 1; i < 6; i++) add(box(0.006, 0.7, 0.01, P.trim, RUN.x0 + (runL * i) / 6, 0.48, fz + 0.001, nc));
  for (let i = 0; i < 6; i++) { const cx = RUN.x0 + (runL * (i + 0.5)) / 6; if (Math.abs(cx - 11.1) > 0.3) add(box(0.22, 0.018, 0.02, P.trim, cx, 0.8, fz + 0.012)); }
  for (let i = 1; i < 3; i++) add(box(0.01, 0.7, 0.006, P.trim, LEG.x + 0.285, 0.48, LEG.z0 + (legL * i) / 3, nc));
  for (let i = 0; i < 3; i++) add(box(0.02, 0.018, 0.22, P.trim, LEG.x + 0.297, 0.8, LEG.z0 + (legL * (i + 0.5)) / 3));
  // revestimento (backsplash) nas duas paredes
  add(box(runL, 0.58, 0.012, P.splash, runC, 1.19, 0.019, nc));
  add(box(0.012, 0.58, 2.2, P.splash, 8.6455, 1.19, 1.125, nc));
  // Cuba inox com misturador
  place(ctx.F.sink(0.62, 0.42), 9.95, RUN.z, 0, 0.905);
  // Cooktop (vidro preto, 4 bocas) + forno de embutir + coifa inox
  add(box(0.6, 0.012, 0.5, P.glassBlk, 11.1, 0.906, RUN.z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(flat(cyl(0.075, 0.075, 0.004, P.burner, 11.1 + sx * 0.14, 0.914, RUN.z + sz * 0.12, 16)));
  add(box(0.58, 0.56, 0.012, M.steel, 11.1, 0.48, fz + 0.012));
  add(box(0.46, 0.26, 0.006, P.glassBlk, 11.1, 0.44, fz + 0.021));
  add(box(0.44, 0.02, 0.025, M.chrome, 11.1, 0.7, fz + 0.03));
  place(ctx.F.hood(), 11.1, 0.285, 0, 1.62);
  // Armários aéreos brancos (x 8,72–10,66), portas com frisos e puxadores
  add(box(1.94, 0.7, 0.35, P.cabW, 9.6925, 1.85, 0.205));
  for (let i = 1; i < 4; i++) add(box(0.006, 0.66, 0.01, P.trim, 8.7225 + (1.94 * i) / 4, 1.85, 0.381, nc));
  for (let i = 0; i < 4; i++) add(box(0.018, 0.16, 0.02, P.trim, 8.7225 + (1.94 * (i + 0.5)) / 4 + (i % 2 ? -0.18 : 0.18), 1.62, 0.39));
  // Geladeira inox no canto (x 11,88–12,63)
  place(ctx.F.fridge(), 12.2525, 0.395);
  // Micro-ondas na perna do L (porta para +x)
  add(box(0.36, 0.28, 0.5, P.trim, 8.9625, 1.04, 1.875));
  add(box(0.006, 0.2, 0.32, P.glassBlk, 9.1455, 1.04, 1.815));
  add(box(0.006, 0.22, 0.1, P.steelDk, 9.1455, 1.04, 2.055));
  // Estação de café: garrafão elétrico inox + 2 garrafas térmicas
  add(cyl(0.13, 0.13, 0.42, M.steel, 9.0125, 1.11, 0.345, 18));
  add(cyl(0.1, 0.13, 0.06, P.trim, 9.0125, 1.35, 0.345, 18));
  add(box(0.04, 0.05, 0.06, P.trim, 9.0125, 0.97, 0.495));
  for (const [x, m] of [[9.3025, P.thermoR], [9.4625, P.trim]]) { add(cyl(0.07, 0.07, 0.3, m, x, 1.05, 0.225, 14)); add(cyl(0.05, 0.06, 0.06, P.trim, x, 1.23, 0.225, 12)); }
  // Escorredor com pratos ao lado da cuba
  add(box(0.4, 0.02, 0.3, M.chrome, 10.48, 0.91, RUN.z));
  for (let i = 0; i < 4; i++) { const pl = cyl(0.11, 0.11, 0.012, M.white, 10.36 + i * 0.07, 1.02, RUN.z, 16); pl.rotation.z = PI / 2; add(pl); }
  // Tábua e fruteira na perna do L
  const tb = add(box(0.26, 0.02, 0.4, P.woodL, 9.0425, 0.91, 1.225)); tb.rotation.y = 0.1;
  add(cyl(0.14, 0.09, 0.07, P.trim, 9.0425, 0.935, 0.875, 16));
  for (const [dx, dz, m] of [[-0.04, 0.03, P.fruitO], [0.05, -0.02, P.fruitO], [0.0, -0.06, P.fruitG]]) add(sph(0.045, m, 9.0425 + dx, 1.0, 0.875 + dz));
  // Mesa de apoio inox junto à parede x=12,75 (com prateleira inferior)
  add(box(0.55, 0.03, 1.2, M.steel, 12.3575, 0.88, 1.85));
  add(box(0.5, 0.02, 1.14, M.steel, 12.3575, 0.2, 1.85));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cyl(0.018, 0.018, 0.86, M.steel, 12.3575 + sx * 0.24, 0.43, 1.85 + sz * 0.56, 8));
  add(cyl(0.17, 0.17, 0.28, M.steel, 12.3375, 1.035, 1.5, 18));                    // panelão
  add(cyl(0.175, 0.175, 0.02, M.chrome, 12.3375, 1.185, 1.5, 18));
  add(box(0.4, 0.04, 0.3, M.steel, 12.3375, 0.915, 2.15));                        // assadeiras
  add(box(0.36, 0.04, 0.28, M.steel, 12.3375, 0.955, 2.15));
  add(box(0.4, 0.26, 0.34, P.binW, 12.3575, 0.34, 1.55));                        // caixas plásticas embaixo
  add(box(0.4, 0.22, 0.34, P.binAmber, 12.3575, 0.32, 2.15));
  // Purificador de água na parede x=8,6 e lixeira de pedal no canto
  add(box(0.1, 0.36, 0.26, P.cabW, 8.6925, 1.4, 2.95));
  add(cyl(0.012, 0.012, 0.06, M.chrome, 8.7525, 1.2, 2.95, 8));
  add(cyl(0.15, 0.14, 0.46, M.steel, 8.8925, 0.23, 3.5975, 16));
  add(cyl(0.155, 0.155, 0.03, P.trim, 8.8925, 0.475, 3.5975, 16));
  // Lousa "Café da Base" com o logo oficial na parede x=12,75 (acima da mesa inox, virada para −x)
  {
    const BW = 0.66, BH = 0.5, A = BH / BW;
    const boardTex = ctx.makeTex(512, (g2, s) => {
      g2.fillStyle = '#26282a'; g2.fillRect(0, 0, s, s);
      g2.save(); g2.scale(1, 1 / A);                                                // área lógica s × s·A
      const hh = s * A, chalk = '#ebe8df';
      logo.draw(g2, s * 0.14, hh * 0.08, s * 0.72, { layout: 'wide', color: chalk });
      g2.fillStyle = chalk; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillRect(s * 0.14, hh * 0.52, s * 0.72, 3);
      g2.font = `700 ${Math.round(s * 0.075)}px ${logo.font}`; g2.fillText('CAFÉ DA BASE', s / 2, hh * 0.64);
      g2.font = `400 ${Math.round(s * 0.05)}px ${logo.font}`; g2.fillText('domingo · 8h30 · 10h30 · 18h', s / 2, hh * 0.78);
      g2.fillText('quarta · 19h30', s / 2, hh * 0.9);
      g2.restore();
    });
    add(box(0.02, BH + 0.04, BW + 0.04, P.woodL, 12.7015, 1.74, 1.85, nc));
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.9 }));
    bm.position.set(12.6895, 1.74, 1.85); bm.rotation.y = -PI / 2; bm.receiveShadow = true; add(bm);
  }

  // ========================================= PÁTIO =========================================
  // Coleta seletiva perto do portão, encostada na face externa do almoxarifado (x = 4,8625), frente para −x
  const recBin = (mat) => {
    const g = G();
    g.add(box(0.42, 0.78, 0.44, mat, 0, 0.43, 0));
    const lid = box(0.46, 0.05, 0.48, mat, 0, 0.845, 0.01); g.add(lid);
    g.add(box(0.24, 0.16, 0.01, P.binW, 0, 0.6, 0.225, nc));                    // etiqueta
    g.add(box(0.36, 0.03, 0.04, P.trim, 0, 0.8, -0.24));                         // alça
    for (const sx of [-1, 1]) { const w = cyl(0.05, 0.05, 0.04, P.trim, sx * 0.19, 0.05, -0.17, 12); w.rotation.z = PI / 2; g.add(w); }
    return g;
  };
  [P.binBlue, P.binRed, P.binGreen, P.binYel].forEach((m, i) => place(recBin(m), 4.5175, 1.0 + i * 0.5, -PI / 2));
  // placa "COLETA SELETIVA" (sinalização)
  const signTex = ctx.makeTex(512, (g2, s) => {
    g2.fillStyle = '#f2f0ea'; g2.fillRect(0, 0, s, s);
    g2.save(); g2.scale(1, s / (s * 0.1875)); g2.fillStyle = '#1e1f22'; g2.font = 'bold 44px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText('COLETA SELETIVA', s / 2, (s * 0.1875) / 2); g2.restore();
    ['#2f5f9e', '#b23a2e', '#2f7a3e', '#d9a82a'].forEach((c, i) => { g2.fillStyle = c; g2.fillRect((i * s) / 4, s * 0.86, s / 4, s * 0.14); });
  });
  // placa acima da janela do almoxarifado (verga em y 2,15), virada para −x — cabe abaixo do topo da parede (ctx.HB, v1.8)
  const SY = (ctx.HB || 2.7) - 0.12;
  add(box(0.02, 0.22, 1.16, P.trim, 4.8515, SY, 1.75, nc));
  const signM = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.2), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }));
  signM.position.set(4.8395, SY, 1.75); signM.rotation.y = -PI / 2; add(signM);

  // ---- PAREDÃO DA MARCA (face externa do almoxarifado, z = 3,9375, virado para o pátio) ----
  // Ripado de madeira clara igual ao da fachada + logo oficial em letras caixa prateadas.
  // Fica de frente para a câmera inicial (que olha de +z/+x) e vira o "ponto de foto" do pátio.
  {
    const x0 = 5.02, x1 = 7.3, W = x1 - x0, cx = (x0 + x1) / 2, y0 = 0.02, y1 = (ctx.HB || 2.94) - 0.1, Hh = y1 - y0, ym = (y0 + y1) / 2;   // até logo abaixo do topo da parede
    add(box(W, Hh, 0.02, P.ripaFundo, cx, ym, 3.9495, nc));                                   // fundo
    const n = Math.floor((W - 0.03) / 0.075);
    for (let i = 0; i <= n; i++) add(box(0.046, Hh, 0.035, P.ripa, x0 + 0.03 + i * 0.075 + (W - 0.06 - n * 0.075) / 2, ym, 3.977));
    // sanca preta no topo com fita de LED embaixo (lava o ripado de cima para baixo)
    add(box(W + 0.06, 0.06, 0.16, P.trim, cx, y1 + 0.03, 4.0125));
    add(box(W - 0.06, 0.012, 0.025, P.led, cx, y1 - 0.006, 4.0625, nc));
    for (const sx of [-1, 1]) add(box(0.03, Hh + 0.06, 0.07, P.trim, cx + sx * (W / 2 + 0.015), ym + 0.03, 3.9725));   // perfis laterais
    // logo oficial (anel + B + BASE/CHURCH) em relevo, acende de leve à noite
    const L = logo.relief(1.08, { depth: 0.05, layers: 4 });
    L.position.set(cx, y1 - 0.75, 3.9965); add(L);
    if (ctx.bindEmissive) ctx.bindEmissive('estacionamento', L.userData.face, 0.6, { min: 0.3 });   // de dia fica branco-prata, à noite brilha
    if (ctx.glowPlane) { const h = ctx.glowPlane(W + 0.3, Hh + 0.3, 'estacionamento', { color: 0xffc98f, base: 0.55, day: 0.12 }); h.position.set(cx, ym + 0.1, 4.0625); add(h); }
    // floreira preta ao pé do painel: grama-preta (moreia/ráfis) e 2 uplights
    add(box(W, 0.4, 0.36, P.potBlk, cx, 0.2, 4.2075));
    add(box(W - 0.06, 0.02, 0.3, M.soil, cx, 0.39, 4.2075, nc));
    for (let k = 0; k < 7; k++) {
      const px = x0 + 0.2 + k * (W - 0.4) / 6;
      if (k === 1 || k === 5) { add(cyl(0.035, 0.04, 0.05, P.spotBody, px, 0.425, 4.1225, 10)); add(flat(cyl(0.028, 0.028, 0.006, P.spotLens, px, 0.452, 4.1225, 10))); continue; }
      // touceira de grama-preta: lâminas finas abrindo em leque a partir do centro
      const tuft = G();
      for (let i = 0; i < 8; i++) frond(tuft, px + j(0.02), 0.4, 4.2075 + j(0.02), 0.34 + rnd() * 0.16, 0.028, (i / 8) * PI * 2 + j(0.3), -(0.75 + rnd() * 0.45), i % 3 ? P.strap : P.leafDk);
      add(tuft);
    }
  }

  // ---- Medalhão com o "B" no piso do pátio (concreto grafite + logo claro + aro de aço) ----
  {
    const mx = 11.1, mz = 10.85;
    add(flat(cyl(0.72, 0.72, 0.012, P.medal, mx, 0.01, mz, 40)));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.755, 48), P.alu); ring.rotation.x = -PI / 2; ring.position.set(mx, 0.0165, mz); ring.receiveShadow = true; add(ring);
    const mk2 = logo.mesh(1.12, 1.12, { layout: 'mark', color: '#e3dfd5', roughness: 0.8 }); mk2.rotation.x = -PI / 2; mk2.position.set(mx, 0.0175, mz); add(mk2);
  }

  // (v1.8: o ipê-amarelo saiu — pedido do dono: nenhuma árvore)

  // Banco ripado de madeira clara com pés pretos (de frente para o jardim interno)
  const bench = (L) => {
    const g = G();
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - 0.12);
      g.add(box(0.05, 0.42, 0.05, P.chairBlk, x, 0.21, 0.17)); g.add(box(0.05, 0.8, 0.05, P.chairBlk, x, 0.4, -0.2));
      g.add(box(0.05, 0.04, 0.42, P.chairBlk, x, 0.41, -0.01));
      const bk = box(0.05, 0.42, 0.04, P.chairBlk, x, 0.72, -0.21); bk.rotation.x = -0.12; g.add(bk);
    }
    for (let i = 0; i < 5; i++) g.add(box(L, 0.03, 0.075, P.woodL, 0, 0.445, 0.17 - i * 0.085));
    for (let i = 0; i < 3; i++) { const s = box(L, 0.075, 0.025, P.woodL, 0, 0.62 + i * 0.11, -0.225 - i * 0.013); s.rotation.x = -0.12; g.add(s); }
    g.add(box(L - 0.34, 0.01, 0.02, P.led, 0, 0.422, 0.15, nc));                // fita de LED sob o assento
    return g;
  };
  place(bench(1.6), 7.02, 9.0, PI / 2);

  // Bicicletário junto à parede do templo (z=12,4): 3 arcos galvanizados + 2 bicicletas
  const hoops = G();
  for (const x of [5.95, 6.6, 7.25]) {
    for (const z of [11.15, 11.85]) tube(hoops, [x, 0, z], [x, 0.72, z], 0.024, P.steelG, 10);
    tube(hoops, [x, 0.72, 11.15], [x, 0.72, 11.85], 0.024, P.steelG, 10);
  }
  add(hoops);
  const bicycle = (mat) => {
    const g = G(), R = [0, 0.345, 0.52], Fw = [0, 0.345, -0.52], BB = [0, 0.3, 0.08], S = [0, 0.84, 0.25], Hb = [0, 0.7, -0.4], Hh = [0, 0.86, -0.35];
    for (const w of [R, Fw]) { g.add(torus(0.32, 0.025, M.tire, w[0], w[1], w[2], 0, PI / 2, 24)); const hub = cyl(0.03, 0.03, 0.08, P.alu, w[0], w[1], w[2], 8); hub.rotation.z = PI / 2; g.add(hub); }
    for (const [a, b] of [[BB, S], [BB, Hb], [S, Hh], [BB, R], [S, R], [Hb, Fw], [Hb, Hh]]) tube(g, a, b, 0.016, mat);
    tube(g, S, [0, 0.96, 0.28], 0.012, M.chrome);
    g.add(box(0.12, 0.05, 0.26, P.trim, 0, 0.98, 0.3));                          // selim
    const bar = cyl(0.012, 0.012, 0.5, P.trim, 0, 0.93, -0.38, 8); bar.rotation.z = PI / 2; g.add(bar);
    return g;
  };
  const b1 = place(bicycle(P.bikeT), 6.05, 11.4); b1.rotation.z = -0.05;
  const b2 = place(bicycle(P.bikeK), 7.15, 11.42); b2.rotation.z = 0.05;

  // Abrigo de gás (2 P13) entre a porta do almoxarifado e a janela da cozinha
  add(box(0.5, 1.15, 0.44, M.concrete, 8.9, 0.575, 4.2525));
  add(box(0.54, 0.04, 0.48, P.steelDk, 8.9, 1.17, 4.2525));
  add(box(0.4, 0.9, 0.012, P.gasDoor, 8.9, 0.55, 4.4785));
  for (let i = 0; i < 4; i++) add(box(0.32, 0.03, 0.02, P.steelDk, 8.9, 0.3 + i * 0.16, 4.4885));

  // Cica (Cycas) em vaso preto — mesma planta da fachada
  // (pot = false: plantada direto no chão)
  const cycaPot = (s = 1, pot = true) => {
    const g = G(), y0 = pot ? 0 : -0.55 * s;
    if (pot) {
      g.add(cyl(0.3 * s, 0.24 * s, 0.6 * s, P.potBlk, 0, 0.3 * s, 0, 18));
      g.add(cyl(0.27 * s, 0.27 * s, 0.02, M.soil, 0, 0.59 * s, 0, 18));
    }
    g.add(cyl(0.09 * s, 0.11 * s, 0.25 * s, M.trunk, 0, y0 + 0.7 * s, 0, 10));
    const n = 12;
    for (let i = 0; i < n; i++) frond(g, 0, y0 + 0.82 * s, 0, (0.55 + rnd() * 0.15) * s, 0.12 * s, (i / n) * PI * 2 + j(0.12), (i % 2 ? 0.15 : -0.25) + j(0.08), i % 3 ? P.cyca : P.palm);
    g.add(sph(0.07 * s, P.leafLt, 0, y0 + 0.84 * s, 0));
    return g;
  };
  place(cycaPot(1), 12.2, 11.6);
  // Espada-de-são-jorge em vaso preto alto diante da parede z = 11 do corredor lateral (onde era a porta PM01)
  const sansevieria = () => {
    const g = G();
    g.add(cyl(0.22, 0.18, 0.62, P.potBlk, 0, 0.31, 0, 16));
    g.add(cyl(0.2, 0.2, 0.02, M.soil, 0, 0.61, 0, 16));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2 + j(0.2), r = 0.05 + rnd() * 0.07, h = 0.5 + rnd() * 0.35;
      const b = box(0.06, h, 0.012, i % 3 ? P.strap : P.leafDk, Math.cos(a) * r, 0.6 + h / 2, Math.sin(a) * r);
      b.rotation.set(Math.sin(a) * 0.15, -a, -Math.cos(a) * 0.15); g.add(b);
    }
    return g;
  };
  place(sansevieria(), 16.6, 10.62);   // v1.5.1: trocou de lugar com a porta PM01 (agora na parede x = 16,05, onde o vaso ficava)

  // Spot de chão (embutido, só emissivo — sem luz real)
  const spot = (x, z) => { add(cyl(0.055, 0.06, 0.05, P.spotBody, x, 0.03, z, 12)); add(flat(cyl(0.04, 0.04, 0.008, P.spotLens, x, 0.058, z, 12))); };

  // ==================================== JARDIM INTERNO ====================================
  // Meio-fio de concreto (os lados x=9,45 e z=9,25 são paredes da recepção)
  add(box(0.1, 0.14, 4.4, M.concrete, 7.55, 0.07, 8.0));
  add(box(1.83, 0.14, 0.1, M.concrete, 8.505, 0.07, 5.85));
  add(box(2.85, 0.14, 0.1, M.concrete, 8.875, 0.07, 10.15));
  add(box(0.1, 0.14, 0.81, M.concrete, 10.25, 0.07, 9.695));
  // Pedras brancas: faixa junto ao meio-fio + rodas de pedra + seixos soltos
  add(box(0.32, 0.02, 4.2, P.pebble, 7.77, 0.012, 8.0, nc));
  add(box(2.45, 0.02, 0.32, P.pebble, 9.0, 0.013, 9.94, nc));
  add(flat(cyl(0.5, 0.5, 0.02, P.pebble, 8.45, 0.014, 6.75, 20)));
  add(flat(cyl(0.45, 0.45, 0.02, P.pebble, 8.35, 0.014, 8.85, 20)));
  for (let i = 0; i < 9; i++) {
    const onW = i < 5, x = onW ? 7.66 + rnd() * 0.22 : 7.9 + rnd() * 2.2, z = onW ? 6.0 + rnd() * 4.0 : 9.83 + rnd() * 0.22;
    const s = sph(0.03 + rnd() * 0.025, i % 3 ? P.pebble : P.pebble2, x, 0.026, z); s.scale.y = 0.55; s.castShadow = false; add(s);
  }
  // Pedras ornamentais
  for (const [x, z, r] of [[8.0, 7.55, 0.16], [9.1, 7.3, 0.12], [9.75, 9.7, 0.14]]) { const s = sph(r, P.rock, x, r * 0.35, z); s.scale.set(1.3, 0.6, 1); add(s); }
  // (v1.8: as 2 palmeiras saíram — nenhuma árvore; as rodas de pedra ficam como canteiro)
  place(cycaPot(0.6, false), 9.85, 9.8);
  // Arbustos (buxinhos) e forração baixa junto à parede da recepção
  const shrub = (x, z, s, m1, m2) => {
    add(sph(0.3 * s, m1, x, 0.26 * s, z)); add(sph(0.22 * s, m2, x - 0.16 * s, 0.22 * s, z + 0.14 * s)); add(sph(0.2 * s, P.leafLt, x + 0.12 * s, 0.28 * s, z - 0.15 * s));
  };
  shrub(9.0, 6.25, 0.9, P.leafDk, M.leaf2); shrub(7.95, 9.6, 0.8, M.plant, P.leafDk); shrub(9.05, 8.2, 0.75, P.leafDk, M.plant);
  for (const z of [7.0, 7.6]) { const f = sph(0.3, P.forr, 9.02, 0.05, z); f.scale.y = 0.3; add(f); }
  for (let i = 0; i < 6; i++) add(sph(0.035, P.flowerT, 8.95 + rnd() * 0.3, 0.12, 6.8 + rnd() * 1.0));
  spot(7.95, 6.75); spot(8.8, 9.3); spot(9.95, 9.45);

  // =================================== JARDIM PASTORAL ===================================
  // Pisantes de concreto: porta da pastoral → pátio (a porta PM01 fica no pátio, parede x = 16,05)
  for (const z of [9.62, 10.2, 10.75]) add(flat(box(0.8, 0.04, 0.4, P.slab, 13.35, 0.02, z)));
  for (const x of [14.1, 14.75, 15.4]) add(flat(box(0.5, 0.04, 0.55, P.slab, x, 0.02, 10.6)));   // (daqui se entra no pátio e na porta PM01, x = 16,05)
  // Canteiros com borda metálica preta e forração (grama-amendoim com florzinhas amarelas)
  const bed = (x0, x1, z0, z1) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    add(box(w - 0.02, 0.05, d - 0.02, P.forr, cx, 0.03, cz, nc));
    for (const z of [z0, z1]) add(box(w, 0.08, 0.012, P.trim, cx, 0.04, z, nc));
    for (const x of [x0, x1]) add(box(0.012, 0.08, d, P.trim, x, 0.04, cz, nc));
    const n = Math.round(w * d * 2.8);
    for (let i = 0; i < n; i++) add(flat(sph(0.022, P.flowerY, x0 + 0.08 + rnd() * (w - 0.16), 0.06, z0 + 0.08 + rnd() * (d - 0.16))));
  };
  bed(13.9, 17.05, 9.4, 10.05);
  bed(17.15, 20.005, 9.4, 10.85);
  // Buxinhos em frente ao vidro da pastoral e moreias
  for (const x of [14.35, 15.05, 15.75, 16.55]) { const r = 0.22 + j(0.03); add(sph(r, x === 15.05 ? M.leaf2 : P.leafDk, x, r * 0.95, 9.72)); }
  const G_loose = G(); add(G_loose);                                             // folhas soltas das moreias
  const moreia = (x, z) => {
    for (let i = 0; i < 6; i++) frond(G_loose, x, 0.05, z, 0.42 + rnd() * 0.12, 0.035, (i / 6) * PI * 2 + j(0.2), -1.2 + rnd() * 0.2, P.strap);
    add(sph(0.03, P.binW, x + 0.05, 0.42, z));
  };
  moreia(14.7, 9.72); moreia(16.15, 9.72);
  // Canteiro leste: buxinhos e touceiras floridas terracota diante da janela J13
  shrub(17.65, 10.3, 0.85, P.leafDk, M.leaf2); shrub(18.55, 9.8, 0.7, M.plant, P.leafDk); shrub(19.25, 10.45, 0.75, P.leafDk, M.plant);
  for (const [x, z] of [[18.1, 10.55], [18.95, 10.1]]) {
    add(sph(0.18, M.leaf2, x, 0.16, z));
    for (let i = 0; i < 5; i++) add(sph(0.04, P.flowerT, x + j(0.14), 0.28 + rnd() * 0.06, z + j(0.14)));
  }
  moreia(17.45, 9.75);
  spot(15.4, 9.95); spot(18.2, 9.55); spot(19.55, 10.4);

  // =====================================================================
  // DETALHES DE REALISMO (v1.5.1): tomadas do frontão da cozinha, interruptores junto às portas da
  // cozinha e do almoxarifado e extintor da cozinha.
  // Placas a ≥ 3 mm das faces (bloco dos fundos: paredes de 7,5 cm).
  // =====================================================================
  {
    const plate = (axis, f, dir, t, y, kind) => {
      const d = 0.012, c = f + dir * d / 2, dd = 0.006, cc = f + dir * (d + dd / 2);
      if (axis === 'x') {
        add(box(0.075, 0.12, d, P.cabW, t, y, c, nc));
        add(kind === 'sw' ? box(0.03, 0.045, dd, P.paint, t, y + 0.01, cc, nc) : box(0.034, 0.034, dd, P.trim, t, y, cc, nc));
      } else {
        add(box(d, 0.12, 0.075, P.cabW, c, y, t, nc));
        add(kind === 'sw' ? box(dd, 0.045, 0.03, P.paint, cc, y + 0.01, t, nc) : box(dd, 0.034, 0.034, P.trim, cc, y, t, nc));
      }
    };
    // Cozinha: 2 tomadas no frontão (parede z = 0, face 0,012, abaixo dos aéreos) e interruptor junto à porta (x 11,6–12,5)
    plate('x', 0.012, 1, 9.4, 1.15, 'out'); plate('x', 0.012, 1, 11.05, 1.15, 'out');
    plate('x', 3.8625, -1, 11.3, 1.15, 'sw');
    // porta-papel-toalha sob os aéreos (rolo em suporte de alumínio), entre as garrafas e a cuba
    for (const dx of [-0.13, 0.13]) add(box(0.02, 0.03, 0.1, P.alu, 9.55 + dx, 1.33, 0.06, nc));
    { const roll = cyl(0.055, 0.055, 0.24, P.paint, 9.55, 1.33, 0.1, 14); roll.rotation.z = PI / 2; add(roll); }
    add(box(0.22, 0.14, 0.004, P.paint, 9.55, 1.2, 0.157, nc));
    // extintor de pó (vermelho) em suporte na parede x = 12,75 (face 12,7125), perto da porta
    const redExt = std({ color: 0xc4201b, roughness: 0.35, metalness: 0.1 });
    add(box(0.02, 0.14, 0.12, P.trim, 12.7025, 1.28, 3.2));
    add(cyl(0.08, 0.08, 0.5, redExt, 12.61, 1.05, 3.2, 14)); add(cyl(0.055, 0.055, 0.04, redExt, 12.61, 1.32, 3.2, 10));
    add(cyl(0.026, 0.026, 0.08, P.trim, 12.61, 1.38, 3.2, 8)); add(box(0.03, 0.02, 0.14, P.trim, 12.61, 1.43, 3.2, nc));
    // Almoxarifado: interruptor junto à porta (x 7,5–8,4)
    plate('x', 3.8625, -1, 7.12, 1.15, 'sw');
  }
}

function roomFachada(ctx) {
  const { THREE, M, F, box, cyl, sph, place, add, addExt, std, rnd, makeTex, SPEC, logo, bindEmissive, glowPlane } = ctx;
  const G = () => new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const j = (k) => (rnd() - 0.5) * 2 * k;                      // jitter determinístico ±k
  const flat = (m) => { m.castShadow = false; return m; };     // peças rasteiras não projetam sombra
  const HT = (SPEC && SPEC.H_TEMPLO) || 8.5, HA = (SPEC && SPEC.H_ALA) || 4.5, HF = (SPEC && SPEC.H_FUNDOS) || 3.6;

  // Paleta local (poucos materiais: tudo é fundido por material depois)
  const P = {
    // ripado bege-rosado claro como na foto (duas tonalidades de ripa, sorteadas, quebram a uniformidade)
    ripa: std({ color: 0xd6b39b, roughness: 0.72 }), ripa2: std({ color: 0xc29b82, roughness: 0.75 }), ripaFundo: std({ color: 0x9c7a64, roughness: 0.85 }),
    mono: std({ color: 0x1b1b1e, roughness: 0.7 }), plate: std({ color: 0x121214, roughness: 0.4, metalness: 0.3 }),   // preto liso (totem, placas)
    alu: std({ color: 0x9a9da2, roughness: 0.35, metalness: 0.7 }),
    upLens: std({ color: 0xfff4dc, emissive: 0xffd9a8, emissiveIntensity: 0.1, roughness: 0.3 }),                    // embutidos no piso (ligados à 'fachada')
    black: M.wallDark || std({ color: 0x2b2b2e, roughness: 0.85 }), cap: M.wallDarkCap || std({ color: 0x232326, roughness: 0.8 }),
    frame: M.frameDark || std({ color: 0x18181a, roughness: 0.45, metalness: 0.3 }),
    vase: std({ color: 0x141416, roughness: 0.32, metalness: 0.15 }),
    leafB: std({ color: 0x4c7f3c, roughness: 1 }),
    cyca: std({ color: 0x3d6f2c, roughness: 0.85 }), cyca2: std({ color: 0x2c5a22, roughness: 0.85 }), cycaTrunk: std({ color: 0x5b4632, roughness: 1 }),
    pebble: std({ color: 0xf1f0ec, roughness: 0.95 }), pebble2: std({ color: 0xcfccc4, roughness: 0.95 }), curbW: std({ color: 0xdedbd3, roughness: 0.9 }),
    paint: std({ color: 0xf3f3ef, roughness: 0.8 }), yellow: std({ color: 0xe2b633, roughness: 0.8 }),
    stop: std({ color: 0x9d9a93, roughness: 0.95 }), curb: std({ color: 0xbcb8b0, roughness: 0.95 }),
    carSilver: std({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.5 }),
    cream: std({ color: 0xe7dcc5, roughness: 0.55, metalness: 0.15 }),   // treliça, calha e tubos (como na foto)
    unit: std({ color: 0xe8e8e4, roughness: 0.5 }), grille: std({ color: 0x2a2b2e, roughness: 0.6, metalness: 0.2 }),
    slab: std({ color: 0xa4a19a, roughness: 0.95 }), tank: std({ color: 0x2f6db3, roughness: 0.45 }),
  };

  // ---- texturas procedurais (canvas) ----------------------------------------------------------
  // Telha termoacústica trapezoidal: 4 ondas por metro, correndo no sentido do caimento (x)
  const roofTex = makeTex(256, (g, s) => {
    g.fillStyle = '#aeb3b8'; g.fillRect(0, 0, s, s);
    const p = s / 4;
    for (let i = 0; i < 4; i++) {
      const y = i * p;
      g.fillStyle = '#c9cdd1'; g.fillRect(0, y, s, p * 0.22);                 // crista
      g.fillStyle = '#8f959b'; g.fillRect(0, y + p * 0.22, s, p * 0.1);       // aba de sombra
      g.fillStyle = '#b8bcc0'; g.fillRect(0, y + p * 0.9, s, p * 0.1);        // aba de luz
    }
  }, [1, 37]);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: roofTex, roughness: 0.5, metalness: 0.45 });
  // Revestimento amadeirado da lateral alta (acima da ala direita) e forro do beiral
  const cladTex = makeTex(256, (g, s) => {
    const rr = mulberry(9), ph = s / 8;
    for (let i = 0; i < 8; i++) {
      const v = 0.85 + rr() * 0.25;
      g.fillStyle = `rgb(${(122 * v) | 0},${(86 * v) | 0},${(58 * v) | 0})`; g.fillRect(0, i * ph, s, ph);
      g.fillStyle = 'rgba(40,24,14,0.55)'; g.fillRect(0, i * ph + ph - 3, s, 3);
      for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${rr() < 0.5 ? '70,45,28' : '160,120,85'},${(rr() * 0.25).toFixed(2)})`; g.fillRect(rr() * s, i * ph + rr() * ph, 8 + rr() * 40, 1 + rr() * 2); }
    }
  }, [15, 2]);
  const cladMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cladTex, roughness: 0.8 });
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---- builders locais ------------------------------------------------------------------------
  // barra (caixa) entre dois pontos — treliças e tubos retos
  const bar = (put, a, b, w, mat) => {
    const A = V(...a), B = V(...b), d = B.clone().sub(A);
    const m = box(d.length(), w, w, mat, 0, 0, 0);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(1, 0, 0), d.normalize());
    return put(m);
  };
  // folha comprida saindo de (cx,cy,cz): ângulo `a` no plano, inclinação `t` (positivo = caindo); devolve a ponta
  const frond = (g, cx, cy, cz, len, w, a, t, mat) => {
    const m = box(len, 0.018, w, mat, 0, 0, 0), L = len / 2, ct = Math.cos(t);
    m.position.set(cx + L * ct * Math.cos(a), cy - L * Math.sin(t), cz - L * ct * Math.sin(a));
    m.rotation.set(0, a, -t); m.castShadow = true; g.add(m);
    return [cx + len * ct * Math.cos(a), cy - len * Math.sin(t), cz - len * ct * Math.sin(a)];
  };
  // painel ripado de madeira clara (x 7,2–10,66, saliente em z 49,73–49,83) entre y0 e y1
  const ripado = (put, y0, y1) => {
    const x0 = 7.2, x1 = 10.66, h = y1 - y0, ym = (y0 + y1) / 2;
    put(box(x1 - x0, h, 0.05, P.ripaFundo, (x0 + x1) / 2, ym, 49.755));
    const n = Math.floor((x1 - x0 - 0.03) / 0.075);
    for (let i = 0; i <= n; i++) put(box(0.046, h, 0.04, rnd() < 0.3 ? P.ripa2 : P.ripa, x0 + 0.035 + i * 0.075, ym, 49.8));
  };

  // =================================================================================================
  // (a) MODO NORMAL — frente térrea, jardins e estacionamento
  // =================================================================================================

  // ---- Painel ripado de 0 a 8,5 m + letreiro BASE CHURCH: SEMPRE visíveis (a identidade do prédio vista da rua) ----
  const Y0 = 3.0, LX = 8.93;
  ripado(add, 0, HT);
  add(box(3.46, HT - Y0, 0.1, P.mono, LX, (HT + Y0) / 2, 49.69));   // contra-placa preta (quem olha do hall vê preto; embutida na parede alta no modo Fachada)
  add(box(3.54, 0.06, 0.24, P.cap, LX, HT + 0.03, 49.74));                                 // tampa no topo
  for (const x of [7.185, 10.675]) add(box(0.03, HT, 0.2, P.cap, x, HT / 2, 49.74));       // perfis laterais do painel
  // letreiro em letras caixa prateadas (logo oficial), afastadas do ripado; a face acende com a luz 'fachada'
  const LOGO_W = 2.4, LOGO_Y = 4.9;                                                        // BASE ≈ 70 % da largura do painel; y 3,4–6,4 (foto)
  const sign = logo.relief(LOGO_W, { depth: 0.09, layers: 4, weight: 0.045 });
  sign.position.set(LX, LOGO_Y, 49.822); add(sign);
  bindEmissive('fachada', sign.userData.face, 0.9);
  const halo = glowPlane(3.3, 3.9, 'fachada', { color: 0xffe9cc, base: 0.45, day: 0.1 });   // retroiluminação (halo atrás das letras)
  halo.position.set(LX, LOGO_Y, 49.826); add(halo);
  // embutidos de piso no pedrisco lavando o ripado de baixo para cima (faixas de luz verticais à noite)
  bindEmissive('fachada', P.upLens, 1.6);
  for (const x of [7.88, 8.63, 9.38, 10.12]) {
    add(flat(cyl(0.065, 0.065, 0.03, P.grille, x, 0.045, 49.97, 14)));
    add(flat(cyl(0.048, 0.048, 0.008, P.upLens, x, 0.062, 49.97, 14)));
    const w = glowPlane(0.7, 3.4, 'fachada', { color: 0xffc98a, base: 0.5, day: 0.05 }); w.position.set(x, 1.45, 49.828); add(w);
  }

  // ---- Porta principal: portal preto em volta do vão + bandeira de vidro escuro sobre as folhas ----
  for (const x of [10.78, 13.22]) add(box(0.2, 3.0, 0.22, P.frame, x, 1.5, 49.83));        // ombreiras do portal (fora do vão 10,9–13,1)
  add(box(2.22, 0.66, 0.02, M.glassDark, 12.0, 2.63, 49.74, { cast: false, receive: false }));   // bandeira
  add(box(2.22, 0.05, 0.05, P.frame, 12.0, 2.3, 49.75, { cast: false }));
  add(box(2.22, 0.05, 0.05, P.frame, 12.0, 2.96, 49.75, { cast: false }));
  // adesivo branco (logo horizontal) na bandeira de vidro, como o vinil das portas de vidro das igrejas
  const vin = logo.mesh(1.2, 0, { layout: 'wide', color: '#f1f1ee', opacity: 0.92, cast: false }); vin.position.set(12.0, 2.63, 49.757); add(vin);

  // ---- Jardineiras: cerca-viva densa + faixa de pedrisco branco + guia branca ----
  // folhagem miúda da cerca-viva podada (textura de folhas + relevo pela própria textura)
  const leafTex = makeTex(256, (g, s) => {
    g.fillStyle = '#23411f'; g.fillRect(0, 0, s, s);
    const rr = mulberry(31), cols = ['#2f5a29', '#3a6a30', '#4c7f3c', '#5f9147', '#27481f', '#436f35'];
    for (let i = 0; i < 2600; i++) {
      const x = rr() * s, y = rr() * s, a = rr() * Math.PI;
      g.fillStyle = cols[(rr() * cols.length) | 0];
      for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { g.beginPath(); g.ellipse(x + dx, y + dy, 2.5 + rr() * 3.5, 1.4 + rr() * 1.8, a, 0, Math.PI * 2); g.fill(); }
    }
  });
  const hedge = (x0, x1, z0, z1, h) => {
    const t = leafTex.clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) / 0.45, h / 0.45);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, bumpMap: t, bumpScale: 3, roughness: 1 });
    add(box(x1 - x0, h - 0.05, z1 - z0, mat, (x0 + x1) / 2, (h - 0.05) / 2, (z0 + z1) / 2));
    // tufos irregulares (a poda nunca é perfeita): quebram a silhueta no topo e na frente
    const n = Math.round((x1 - x0) * 5);
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.1 + rnd() * (x1 - x0 - 0.2), top = rnd() < 0.55, r = 0.12 + rnd() * 0.08;
      const m = top ? sph(r, mat, x, h - 0.07, z0 + 0.12 + rnd() * (z1 - z0 - 0.24)) : sph(r, mat, x, 0.2 + rnd() * (h - 0.4), z1 - 0.05);
      if (top) m.scale.set(1.4, 0.5, 1); else m.scale.set(1.3, 1, 0.45);
      add(m);
    }
  };
  hedge(0.2, 6.85, 49.82, 50.44, 1.02);        // frente do canto do hall (sob a janela)
  hedge(13.42, 15.94, 49.82, 50.46, 1.14);     // à direita da porta
  // pedrisco branco (faixa da frente e todo o canteiro dos vasos)
  for (const [x0, x1, z0, z1] of [[0.13, 6.9, 50.44, 50.83], [6.9, 10.58, 49.84, 50.83], [13.32, 15.98, 50.46, 50.83]]) {
    add(flat(box(x1 - x0, 0.03, z1 - z0, P.pebble, (x0 + x1) / 2, 0.015, (z0 + z1) / 2)));
    const n = Math.round((x1 - x0) * (z1 - z0) * 5);
    for (let i = 0; i < n; i++) { const m = sph(0.028 + rnd() * 0.02, P.pebble2, x0 + 0.05 + rnd() * (x1 - x0 - 0.1), 0.03, z0 + 0.04 + rnd() * (z1 - z0 - 0.08)); m.scale.set(1, 0.45, 1); add(flat(m)); }
  }
  // guias brancas das jardineiras (frente e cabeceiras)
  for (const [x0, x1] of [[0.1, 10.6], [13.3, 16.0]]) {
    add(box(x1 - x0, 0.08, 0.05, P.curbW, (x0 + x1) / 2, 0.04, 50.83, { cast: false }));
    for (const x of [x0 + 0.025, x1 - 0.025]) add(box(0.05, 0.08, 1.07, P.curbW, x, 0.04, 50.29, { cast: false }));
  }

  // ---- Vasos altos pretos com palmeiras cicas, na frente do painel ripado ----
  const cycas = (x, z, h, seed) => {
    const g = G(), rr = mulberry(seed);
    g.add(cyl(0.19, 0.13, h, P.vase, 0, h / 2, 0, 20));
    g.add(cyl(0.2, 0.2, 0.03, P.vase, 0, h - 0.015, 0, 20));
    g.add(cyl(0.175, 0.175, 0.02, M.soil, 0, h - 0.035, 0, 16));
    g.add(cyl(0.065, 0.085, 0.16, P.cycaTrunk, 0, h + 0.05, 0, 10));
    // coroa de folhas pinadas: sobem firmes e arqueiam na ponta (a ponta é mais estreita)
    const n = 16, top = h + 0.12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rr() * 0.3, rise = -0.45 - rr() * 0.45, mat = i % 2 ? P.cyca : P.cyca2;
      const tip = frond(g, 0, top, 0, 0.27 + rr() * 0.07, 0.085, a, rise, mat);
      frond(g, tip[0], tip[1], tip[2], 0.24 + rr() * 0.08, 0.055, a + (rr() - 0.5) * 0.15, 0.1 + rr() * 0.3, mat);
    }
    // folhas novas (centro, mais claras e em pé)
    for (let i = 0; i < 4; i++) frond(g, 0, top, 0, 0.22, 0.09, i * Math.PI / 2 + 0.4, -1.15, P.leafB);
    place(g, x, z, rr() * Math.PI);
  };
  [[7.52, 0.62], [8.26, 0.86], [9.0, 0.62], [9.74, 0.86], [10.42, 0.62]].forEach(([x, h], i) => cycas(x, 50.3, h, 40 + i));

  // ---- Estacionamento frontal (piso cinza em espinha de peixe já é a zona do cartão) ----
  // guia de concreto entre a calçada grafite e o intertravado
  add(flat(box(26.0, 0.008, 0.1, P.curbW, 10.0, 0.008, 51.0)));
  // vagas a 90° (2,5 × 4,8 m), de frente para o prédio; passagem livre na frente da porta (x 10,3–15,0)
  const L0 = 51.3, L1 = 56.1, Lm = (L0 + L1) / 2;
  const stallX = [-2.2, 0.3, 2.8, 5.3, 7.8, 10.3];
  for (const x of stallX) add(flat(box(0.1, 0.006, L1 - L0, P.paint, x, 0.007, Lm)));
  for (let i = 0; i < stallX.length - 1; i++) {
    const xc = (stallX[i] + stallX[i + 1]) / 2;
    add(box(1.5, 0.12, 0.16, P.stop, xc, 0.06, 51.85));                    // batente de concreto
    add(flat(box(1.5, 0.004, 0.05, P.yellow, xc, 0.122, 51.85)));          // faixa amarela no topo
  }
  // 2 vagas PCD (azuis, com símbolo de cadeira de rodas) + faixa zebrada de embarque entre elas
  const PW = 6.2, PD = L1 - L0, PX0 = 15.0;
  const pcdTex = makeTex(1024, (g, s) => {
    g.save(); g.scale(s / PW, s / PD);          // desenha em metros: x → largura, y → profundidade (0 = lado do prédio)
    const blue = (x0) => {
      g.fillStyle = '#2f76b2'; g.fillRect(x0, 0, 2.5, PD);
      g.strokeStyle = '#f4f4f0'; g.lineWidth = 0.1; g.strokeRect(x0 + 0.05, 0.05, 2.4, PD - 0.1);
      // símbolo internacional de acesso (branco), perto da entrada da vaga
      const cx = x0 + 1.2, cy = 3.25, k = 1.25;
      g.save(); g.translate(cx, cy); g.scale(k, k);
      g.fillStyle = '#f4f4f0'; g.strokeStyle = '#f4f4f0'; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.arc(-0.08, -0.52, 0.1, 0, Math.PI * 2); g.fill();
      g.lineWidth = 0.1;
      g.beginPath(); g.moveTo(-0.1, -0.34); g.lineTo(-0.06, 0.04); g.lineTo(0.28, 0.04); g.lineTo(0.42, 0.4); g.lineTo(0.56, 0.36); g.stroke();
      g.beginPath(); g.moveTo(-0.08, -0.17); g.lineTo(0.2, -0.17); g.stroke();
      g.lineWidth = 0.08; g.beginPath(); g.arc(-0.04, 0.26, 0.33, -0.1 * Math.PI, 1.3 * Math.PI); g.stroke();
      g.restore();
    };
    blue(0); blue(3.7);
    // faixa de embarque (x 2,5–3,7): contorno + zebrado diagonal
    g.strokeStyle = '#f4f4f0'; g.lineWidth = 0.1; g.strokeRect(2.55, 0.05, 1.1, PD - 0.1);
    g.save(); g.beginPath(); g.rect(2.55, 0.05, 1.1, PD - 0.1); g.clip();
    g.lineWidth = 0.09; for (let y = -1.2; y < PD + 0.6; y += 0.45) { g.beginPath(); g.moveTo(2.5, y + 1.2); g.lineTo(3.7, y); g.stroke(); }
    g.restore();
    g.restore();
  });
  pcdTex.wrapS = pcdTex.wrapT = THREE.ClampToEdgeWrapping;
  const pcd = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), new THREE.MeshStandardMaterial({ map: pcdTex, alphaTest: 0.5, roughness: 0.85 }));
  pcd.rotation.x = -Math.PI / 2; pcd.position.set(PX0 + PW / 2, 0.009, Lm); pcd.castShadow = false; pcd.receiveShadow = true; add(pcd);
  for (const xc of [PX0 + 1.25, PX0 + 4.95]) { add(box(1.5, 0.12, 0.16, P.stop, xc, 0.06, 51.85)); add(flat(box(1.5, 0.004, 0.05, P.yellow, xc, 0.122, 51.85))); }
  // v1.8: sem as placas PCD em poste (pedido: nenhum poste no estacionamento) — a vaga fica marcada no piso
  // estacionamento frontal sem carros (vagas livres)

  // ---- Limites do estacionamento (o lote acaba em z 60) ----
  for (const x of [-3.07, 23.07]) add(box(0.14, 0.12, 10.3, P.curb, x, 0.06, 54.85, { cast: false }));
  add(flat(box(26.0, 0.02, 0.2, P.curbW, 10.0, 0.01, 60.1)));                       // soleira rebaixada (entrada de carros)
  // v1.8: sem entorno (ruas, calçadas públicas, árvores, postes e vizinhos) — pedido do dono: só o lote e o estacionamento

  // ---- Totem de entrada (monólito preto com face ripada e o logo em relevo), na calçada à esquerda ----
  {
    const g = G(), TWd = 1.3, THt = 4.0, TD = 0.42, B0 = 0.3;
    g.add(box(1.9, B0, 1.0, P.curbW, 0, B0 / 2, 0));                                       // floreira/base de concreto branco
    g.add(flat(box(1.8, 0.02, 0.9, P.pebble, 0, B0 + 0.01, 0)));                            // pedrisco
    g.add(box(TWd, THt, TD, P.mono, 0, B0 + THt / 2, 0));
    g.add(box(TWd + 0.04, 0.05, TD + 0.04, P.cap, 0, B0 + THt + 0.025, 0));
    const fw = TWd - 0.2, fh = THt - 0.3, fy = B0 + 0.15 + fh / 2, zf = TD / 2;
    g.add(box(fw, fh, 0.02, P.ripaFundo, 0, fy, zf + 0.01));
    for (let x = -fw / 2 + 0.03; x < fw / 2 - 0.02; x += 0.075) g.add(box(0.046, fh, 0.03, rnd() < 0.3 ? P.ripa2 : P.ripa, x, fy, zf + 0.035));
    const R = logo.relief(0.86, { depth: 0.05, layers: 3, weight: 0.045 }); R.position.set(0, B0 + 2.85, zf + 0.052); g.add(R);
    bindEmissive('fachada', R.userData.face, 0.9);
    // placa preta com o endereço
    g.add(box(1.0, 0.26, 0.02, P.plate, 0, B0 + 1.45, zf + 0.062));
    const A = 1.0 / 0.2;                                                                     // proporção da placa de texto (1,0 × 0,2 m)
    const addrTex = makeTex(1024, (c, s) => {
      c.setTransform(1, 0, 0, A, 0, 0);
      const hS = s / A; c.fillStyle = '#eeeeea'; c.strokeStyle = '#eeeeea'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${Math.round(hS * 0.62)}px ${logo.font}`; c.lineWidth = hS * 0.03;
      c.fillText('802 SUL · PALMAS', s / 2, hS * 0.52, s * 0.94); c.strokeText('802 SUL · PALMAS', s / 2, hS * 0.52, s * 0.94);
    });
    addrTex.wrapS = addrTex.wrapT = THREE.ClampToEdgeWrapping;
    const addr = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.188), new THREE.MeshStandardMaterial({ map: addrTex, alphaTest: 0.5, roughness: 0.4,
      emissive: 0xfff4e6, emissiveMap: addrTex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    addr.position.set(0, B0 + 1.45, zf + 0.073); addr.castShadow = false; g.add(addr);
    bindEmissive('fachada', addr.material, 0.8);
    // verso: marca (anel + B) em branco
    const back = logo.mesh(0.7, 0, { layout: 'mark', color: '#e9e9e6' }); back.rotation.y = Math.PI; back.position.set(0, B0 + 3.1, -TD / 2 - 0.004); g.add(back);
    // embutido no pedrisco + faixa de luz lavando a face ripada
    g.add(flat(box(0.16, 0.03, 0.08, P.grille, 0, B0 + 0.03, zf + 0.2)));
    g.add(flat(box(0.12, 0.008, 0.05, P.upLens, 0, B0 + 0.047, zf + 0.2)));
    const w = glowPlane(1.15, 2.8, 'fachada', { color: 0xffc98a, base: 0.5, day: 0.05 }); w.position.set(0, B0 + 1.4, zf + 0.056); g.add(w);
    place(g, -1.85, 50.32, 0.35);
  }

  // ---- Placa com a marca no muro dos fundos, ao lado do portão (para quem chega pela rua de trás) ----
  add(box(0.72, 0.72, 0.02, P.plate, 6.3, 2.0, -ctx.TF - 0.03, { cast: false }));   // 2 cm afastada da face externa do muro (z −TF)
  { const m = logo.mesh(0.6, 0, { layout: 'mark', color: '#e9e9e6' }); m.rotation.y = Math.PI; m.position.set(6.3, 2.0, -ctx.TF - 0.042); add(m); }

  // ---- Paraciclo (3 arcos de aço) na calçada da direita, fora das vagas PCD ----
  for (const x of [21.55, 22.05, 22.55]) {
    for (const z of [49.95, 50.55]) add(cyl(0.022, 0.022, 0.75, P.alu, x, 0.375, z, 8));
    bar(add, [x, 0.75, 49.95], [x, 0.75, 50.55], 0.044, P.alu);
  }

  // =================================================================================================
  // (b) MODO FACHADA — paredes altas, platibandas, cobertura, beiral com treliça e letreiro
  // =================================================================================================
  const TW = 0.19;                                           // cobre a tampa (0,18) das paredes de 3,0 m
  const wX = (z, x0, x1, y0, y1, mat = P.black) => addExt(box(x1 - x0, y1 - y0, TW, mat, (x0 + x1) / 2, (y0 + y1) / 2, z));
  const wZ = (x, z0, z1, y0, y1, mat = P.black) => addExt(box(TW, y1 - y0, z1 - z0, mat, x, (y0 + y1) / 2, (z0 + z1) / 2));
  const capX = (z, x0, x1, y) => addExt(box(x1 - x0 + 0.04, 0.05, TW + 0.06, P.cap, (x0 + x1) / 2, y + 0.025, z, { cast: false }));
  const capZ = (x, z0, z1, y) => addExt(box(TW + 0.06, 0.05, z1 - z0 + 0.04, P.cap, x, y + 0.025, (z0 + z1) / 2, { cast: false }));
  const e = TW / 2;

  // ---- Cobertura do bloco templo + hall: meia-água caindo para a ala direita (x+), beiral até x 17,45 ----
  const RX0 = 0.1, RX1 = 17.45, RY0 = HT - 0.3, RY1 = HT - 0.95, RZ0 = 12.5, RZ1 = 49.55;
  const slope = (RY0 - RY1) / (RX1 - RX0), roofY = (x) => RY0 - (x - RX0) * slope;   // topo da telha
  const ang = Math.atan(slope), RL = (RX1 - RX0) / Math.cos(ang);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(RL, 0.1, RZ1 - RZ0), roofMat);
  roof.position.set((RX0 + RX1) / 2, roofY((RX0 + RX1) / 2) - 0.05, (RZ0 + RZ1) / 2); roof.rotation.z = -ang;
  roof.castShadow = true; roof.receiveShadow = true; addExt(roof);
  const under = (x) => roofY(x) - 0.1;                                                 // face de baixo da telha

  // ---- Paredes altas (pretas) do bloco templo + hall: frente, esquerda e fundo até 8,5 m ----
  wX(49.65, -e, 16.05 + e, Y0, HT); capX(49.65, -e, 16.05 + e, HT);
  wZ(0, 12.4 - e, 49.65 + e, Y0, HT); capZ(0, 12.4 - e, 49.65 + e, HT);
  wX(12.4, -e, 16.05 + e, Y0, HT); capX(12.4, -e, 16.05 + e, HT);
  // lateral direita: preta dentro da ala, revestimento amadeirado acima do telhado da ala até o beiral
  const WING_TOP = HA - 0.25;                                                          // telhado da ala (atrás das platibandas)
  wZ(16.05, 12.4, 49.65, Y0, WING_TOP + 0.05);
  wZ(16.05, 12.4 + e, 49.65 - e, WING_TOP + 0.05, under(16.05) + 0.04, cladMat);
  // pilares aparentes na divisa (x = 0) continuando os de baixo até a platibanda
  for (const z of [12.4, 16.9, 21.4, 25.9, 30.4, 35.0, 39.5, 44.0]) addExt(box(0.2, HT - 3.05, 0.4, P.black, -0.1, (HT + 3.05) / 2, z));

  // ---- Beiral lateral: treliças metálicas creme em balanço, forro amadeirado e calha (foto, canto sup. direito) ----
  const xw = 16.05 + e;
  addExt(box(RX1 - xw, 0.02, RZ1 - RZ0, cladMat, (xw + RX1) / 2, under((xw + RX1) / 2) - 0.02, (RZ0 + RZ1) / 2, { cast: false }));   // forro sob o beiral
  addExt(box(0.14, 0.34, RZ1 - RZ0 + 0.1, P.cream, RX1 + 0.07, roofY(RX1) - 0.12, (RZ0 + RZ1) / 2));                                  // calha / testeira
  const put = (m) => addExt(m);
  for (const z of [12.9, 16.9, 21.4, 25.9, 30.4, 35.0, 39.5, 44.0, 49.1]) {
    const yt = (x) => under(x) - 0.06, yb = (x) => under(x) - 0.06 - 0.75 * (RX1 - 0.05 - x) / (RX1 - 0.05 - xw) - 0.06;
    const xs = [xw, 16.55, 16.95, RX1 - 0.05];
    bar(put, [xw, yt(xw), z], [RX1, yt(RX1), z], 0.06, P.cream);                   // banzo superior
    bar(put, [xw, yb(xw), z], [xs[3], yb(xs[3]), z], 0.06, P.cream);               // banzo inferior (inclinado)
    for (let i = 1; i < 3; i++) bar(put, [xs[i], yb(xs[i]), z], [xs[i], yt(xs[i]), z], 0.04, P.cream);   // montantes
    for (let i = 0; i < 3; i++) bar(put, [xs[i], yt(xs[i]), z], [xs[i + 1], yb(xs[i + 1]), z], 0.04, P.cream);   // diagonais
    addExt(box(0.03, 0.9, 0.14, P.cream, xw + 0.015, yt(xw) - 0.38, z));           // chapa de fixação na parede
  }
  // tubos de descida da calha até o telhado da ala
  for (const z of [21.0, 33.5, 46.2]) addExt(cyl(0.05, 0.05, roofY(RX1) - 0.3 - WING_TOP, P.cream, RX1 + 0.07, (roofY(RX1) - 0.3 + WING_TOP) / 2, z, 10));
  // cabos/tubulação descendo pela parede até a condensadora da frente
  for (const [dz, r] of [[0, 0.022], [0.07, 0.016], [0.13, 0.03]]) addExt(cyl(r, r, under(16.05) - 0.2 - WING_TOP, P.cream, xw + 0.04, (under(16.05) - 0.2 + WING_TOP) / 2, 48.55 + dz, 8));

  // ---- Ala direita (x 16,05–20,1 · z 11,0–49,5) até 4,5 m ----
  wX(49.5, 16.05 + e, 20.1 + e, Y0, HA); capX(49.5, 16.05 + e, 20.1 + e, HA);
  wZ(20.1, 11.0 - e, 49.5 + e, Y0, HA); capZ(20.1, 11.0 - e, 49.5 + e, HA);
  wX(11.0, 16.05 - e, 20.1 + e, Y0, HA); capX(11.0, 16.05 - e, 20.1 + e, HA);
  wZ(16.05, 11.0 - e, 12.4 - e, Y0, HA); capZ(16.05, 11.0 + e, 12.4 - e, HA);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(20.1 - e - xw, 0.08, 49.5 - e - (11.0 + e)), roofMat);
  wing.position.set((xw + 20.1 - e) / 2, WING_TOP - 0.04, (49.5 - e + 11.0 + e) / 2); wing.castShadow = true; wing.receiveShadow = true; addExt(wing);

  // ---- Bloco dos fundos (almoxarifado, cozinha, recepção, pastoral, caixa d'água) até 3,6 m ----
  // paredes finas (ctx.TF): largura TF + 4 cm; nas de divisa (z 0, x 20,1) o eixo recua TF/2 e a face externa fica no lugar
  const tf = ctx.TF + 0.04, ef = tf / 2, sf = ctx.TF / 2;
  const fX = (z, x0, x1) => { addExt(box(x1 - x0, HF - Y0, tf, P.black, (x0 + x1) / 2, (Y0 + HF) / 2, z)); addExt(box(x1 - x0 + 0.04, 0.05, tf + 0.06, P.cap, (x0 + x1) / 2, HF + 0.025, z, { cast: false })); };
  const fZ = (x, z0, z1) => { addExt(box(tf, HF - Y0, z1 - z0, P.black, x, (Y0 + HF) / 2, (z0 + z1) / 2)); addExt(box(tf + 0.06, 0.05, z1 - z0 + 0.04, P.cap, x, HF + 0.025, (z0 + z1) / 2, { cast: false })); };
  fX(-sf, 4.9 - ef, 20.1 + e);
  fZ(20.1 + sf, -e, 9.25 + ef);
  fX(9.25, 9.45 - ef, 20.1 + sf);
  fZ(9.45, 5.9 - ef, 9.25 + ef);
  fX(5.9, 9.45 - ef, 12.75 + ef);
  fZ(12.75, 3.9 - ef, 5.9 + ef);
  fX(3.9, 4.9 - ef, 12.75 + ef);
  fZ(4.9, -e, 3.9 + ef);
  const SLAB = HF - 0.3;                                                               // laje impermeabilizada
  for (const [x0, z0, x1, z1] of [[4.9, 0, 12.75, 3.9], [9.45, 5.9, 12.75, 9.25], [12.75, 0, 20.1, 9.25]]) {
    addExt(box(x1 - x0 - 0.02, 0.12, z1 - z0 - 0.02, P.slab, (x0 + x1) / 2, SLAB - 0.06, (z0 + z1) / 2));
  }
  // caixa d'água (reservatório azul) sobre a casa de máquinas
  addExt(box(1.8, 0.1, 1.8, P.slab, 18.55, SLAB + 0.05, 1.6));
  addExt(cyl(0.72, 0.78, 1.0, P.tank, 18.55, SLAB + 0.6, 1.6, 24));
  addExt(cyl(0.76, 0.76, 0.08, P.tank, 18.55, SLAB + 1.14, 1.6, 24));
  addExt(cyl(0.2, 0.2, 0.06, P.tank, 18.55, SLAB + 1.21, 1.6, 12));

  // ---- Condensadoras do ar-condicionado ----
  // (a) splits da ala/templo: unidades de parede no telhado da ala, encostadas na parede alta (foto)
  const cond = (x, y, z, face) => {
    addExt(box(0.34, 0.66, 0.9, P.unit, x, y + 0.08 + 0.33, z));
    addExt(box(0.3, 0.08, 0.06, P.grille, x, y + 0.04, z - 0.35)); addExt(box(0.3, 0.08, 0.06, P.grille, x, y + 0.04, z + 0.35));
    const fan = cyl(0.24, 0.24, 0.02, P.grille, x + face * 0.175, y + 0.42, z - 0.1, 20); fan.rotation.z = Math.PI / 2; addExt(fan);
    addExt(box(0.02, 0.5, 0.18, P.grille, x + face * 0.175, y + 0.42, z + 0.3, { cast: false }));
  };
  for (const z of [22.1, 29.6, 38.6, 41.6, 47.6]) cond(16.62, WING_TOP, z, 1);
  // (b) VRF do templo sobre a laje do almoxarifado (descarga para cima) e a da pastoral
  for (const x of [6.3, 7.9]) {
    addExt(box(1.0, 1.15, 0.72, P.unit, x, SLAB + 0.08 + 0.575, 2.0));
    addExt(cyl(0.3, 0.3, 0.05, P.grille, x, SLAB + 0.08 + 1.17, 2.0, 20));
    addExt(box(0.96, 0.7, 0.02, P.grille, x, SLAB + 0.55, 2.37, { cast: false }));
    addExt(box(0.9, 0.08, 0.1, P.grille, x, SLAB + 0.04, 2.0));
  }
  cond(14.9, SLAB, 1.0, 1);

  // ---- Fachada: painel ripado (parte alta), portal da porta e letreiro BASE CHURCH ----
  addExt(box(2.64, 0.5, 0.22, P.frame, 12.0, Y0 + 0.25, 49.83));                     // verga preta do portal
  // (o painel ripado alto e o letreiro BASE CHURCH ficam no modo normal: ver o início do arquivo)
  // câmera de segurança (canto esquerdo) e sensor branco (canto direito), como na foto
  addExt(box(0.12, 0.1, 0.18, P.grille, 0.9, 6.3, 49.83)); addExt(cyl(0.05, 0.05, 0.16, P.unit, 0.9, 6.24, 49.95, 10)).rotation.x = Math.PI / 2;
  addExt(box(0.28, 0.16, 0.06, P.unit, 15.3, 6.0, 49.78, { cast: false }));

  // ---- Detalhes de realismo (v1.5.1): interfone e placa de número ao lado da porta principal, capacho externo ----
  {
    add(box(0.1, 0.2, 0.035, P.alu, 13.55, 1.4, 49.743)); add(box(0.06, 0.06, 0.006, P.plate, 13.55, 1.45, 49.764, { cast: false }));
    const bt = cyl(0.012, 0.012, 0.006, P.plate, 13.55, 1.34, 49.764, 10); bt.rotation.x = Math.PI / 2; bt.castShadow = false; add(bt);
    const numTex = ctx.makeTex(256, (g, S) => { g.fillStyle = '#121214'; g.fillRect(0, 0, S, S); g.fillStyle = '#f4f5f7'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold ${Math.round(S * 0.42)}px ${ctx.logo.font}`; g.fillText('802', S / 2, S * 0.4); g.font = `bold ${Math.round(S * 0.2)}px ${ctx.logo.font}`; g.fillText('SUL', S / 2, S * 0.75); });
    add(box(0.26, 0.26, 0.012, std({ map: numTex, color: 0xffffff, roughness: 0.5 }), 13.55, 2.0, 49.731, { cast: false }));
    add(box(1.8, 0.012, 0.8, std({ color: 0x1a1a1c, roughness: 0.92 }), 12.0, 0.012, 50.15, { cast: false }));
  }
}
// @rooms-end

// ---------------------------------------------------------------------------
// O cartão
// ---------------------------------------------------------------------------
const CSS = `
:host { display: block; position: relative; height: var(--igreja3d-height, calc(100vh - 100px)); min-height: 360px;
  border-radius: var(--ha-card-border-radius, 12px); overflow: hidden; overflow: clip; background: #0a0f1e;   /* clip: foco e scrollIntoView não rolam o cartão */
  font: 13px/1.35 var(--igreja3d-font, -apple-system, BlinkMacSystemFont, var(--primary-font-family, "Segoe UI", Roboto, sans-serif)); color: var(--ink);   /* SF nos aparelhos Apple; nos outros, a fonte do tema do HA (sem system-ui: no Linux ele vira a DejaVu, 1/4 mais larga) */
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  /* Paleta v1.8 (a da Casa v1.9): cores de sistema do iOS escuro (referência: app Casa do iOS 17/18, sem Liquid Glass). Ligado = âmbar · estrutura = grafite ·
     foco e seleção = azul · indisponível = vermelho. Contraste no pior fundo: texto ≥ 4,5:1, ícone e controle ≥ 3:1 */
  --glass: #1c1c1e;                       /* coluna e folha (secondarySystemBackground), opaca; vidro só no .wrap.glass */
  --glass-solid: #1c1c1e;                 /* menos transparência */
  --raised: #2c2c2e;                      /* bloco desligado, lista agrupada, ajustes (tertiarySystemBackground) */
  --fill: rgba(118, 118, 128, .24);       /* trilho do segmentado, círculo do ícone, cápsulas */
  --fill-2: rgba(120, 120, 128, .32);     /* botão neutro */
  --fill-3: rgba(120, 120, 128, .36);     /* interruptor desligado, trilho do slider */
  --line: rgba(84, 84, 88, .65);          /* separator */
  --line-2: rgba(235, 235, 245, .18);     /* quaternaryLabel */
  --ink: #fff; --ink-2: rgba(235, 235, 245, .6); --ink-3: rgba(235, 235, 245, .6);   /* label · secondaryLabel 5,95:1 no #1c1c1e e 5,27:1 no #2c2c2e (o tertiaryLabel não chega a 4,5:1) */
  --on: #ffb547; --on-ink: #2b1800; --on-bg: rgba(255, 181, 71, .16); --on-line: rgba(255, 181, 71, .5);
  --off: var(--ink-3); --off-bg: var(--raised); --off-ink: var(--ink-2);
  --alert: #ff6961;                       /* indisponível: systemRed de alto contraste (4,9:1 no #2c2c2e) */
  --focus: #409cff;                       /* foco e seleção: systemBlue de alto contraste (âmbar quer dizer "ligado") */
  --ease: cubic-bezier(.32, .72, 0, 1);   /* curva da folha do iOS */
  --seg: #636366; --seg-line: rgba(255, 255, 255, .3);   /* polegar do segmentado e o fio dele */
  --tile-on: #e5e5ea; --tile-on-ink: #000; --tile-on-ink-2: #545458;   /* bloco ligado: claro; nome 16,7:1 · estado 6,0:1 */
  --mat-chrome: #1c1c1e; --mat-pop: #2c2c2e;   /* botão do topo e trilha · lista suspensa, balão, "Ir para…" (opacos fora do vidro) */
  --blur: none; --blur-s: none;
  --check: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z'/%3E%3C/svg%3E");   /* Phosphor check (bold) */
  -webkit-tap-highlight-color: transparent; color-scheme: dark; }   /* sem o flash de toque do Android (o retorno é o :active) · controles nativos escuros */
.wrap { position: absolute; inset: 0; }
.wrap:not(.sf) * { letter-spacing: 0 !important; }   /* tracking calibrado para o SF: na Roboto, na Segoe e na fonte do tema fica o desenho dela */
.wrap.glass { --glass: rgba(28, 28, 30, .78); --mat-chrome: rgba(28, 28, 30, .78); --mat-pop: rgba(44, 44, 46, .84); --blur: blur(30px) saturate(180%); --blur-s: blur(20px) saturate(180%);
  --ink-2: rgba(235, 235, 245, .8); --ink-3: rgba(235, 235, 245, .8); --seg-line: rgba(255, 255, 255, .5); }   /* vidro (nível alta, GPU dedicada; o governador o tira primeiro): o cinza sobe ("vibrancy"), 4,5:1 com a cena branca atrás */
.wrap.glass :is(button, .tile, input):focus-visible { box-shadow: 0 0 0 2px #000; }   /* sobre o vidro o azul sozinho dá 2,9:1: anel duplo, como sobre a cena */
canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; cursor: grab; }
canvas.pick { cursor: pointer; }
canvas:active { cursor: grabbing; }
.hud { position: absolute; left: 0; right: 0; display: flex; gap: 8px; padding: 10px; pointer-events: none; box-sizing: border-box; }
.hud > * { pointer-events: auto; }
.hud.top { top: 0; justify-content: space-between; align-items: flex-start; }
.panel { background: var(--mat-chrome); border: 0; border-radius: 14px; backdrop-filter: var(--blur-s); -webkit-backdrop-filter: var(--blur-s);
  box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .12), 0 4px 16px rgba(0, 0, 0, .22); }   /* material de barra, fio claro de 0,5 px por dentro */
/* v1.8: o cartão do título saiu; o topo é a trilha da Vista de cima (à esquerda) e UM botão (⋯) à direita que abre a lista suspensa
   (pull-down do iOS, 260 pt): marca de verificação à esquerda, ícone à direita, linhas de 44 no toque e 36 com mouse, seções separadas por
   faixa de 8; nasce do botão e volta para ele */
.btns { position: relative; display: flex; flex: none; margin-left: auto; }
.btn.menubtn { width: 44px; height: 44px; min-height: 0; padding: 0; display: grid; place-items: center; border-radius: 50%; }
.menubtn svg { width: 24px; height: 24px; }
.menubtn[aria-expanded="true"] { background: #3a3a3c; color: var(--ink); }
.menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 8; width: 260px; max-width: calc(var(--cw, 100vw) - 20px); max-height: calc(var(--ch, 640px) - 74px); overflow: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 0;
  border-radius: 14px; background: var(--mat-pop); border: 0; backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
  box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .12), 0 10px 40px rgba(0, 0, 0, .45);
  transform-origin: top right; animation: menuIn .32s var(--ease); scrollbar-width: thin; scrollbar-color: var(--fill-3) transparent; }   /* nasce do botão ⋯ */
.menu[hidden] { display: none; }
@keyframes menuIn { from { opacity: 0; scale: .9; } }   /* sem overshoot */
.menu.out, .sel.out { animation: popOut .15s ease-in forwards; pointer-events: none; }   /* sai pelo mesmo caminho: de volta ao botão / à ponta */
@keyframes popOut { to { opacity: 0; scale: .9; } }
.btn:active, .menu .mseg button:active, .phead .collapse:active { transform: scale(.97); transition: transform .1s ease-out; }   /* retorno no toque, não no soltar */
.reopen:active { transform: scale(.97); }
.wrap.sheet .reopen:active { transform: translateX(-50%) scale(.97); }   /* a pílula da folha mora centrada: não pula ao tocar */
.menu .msec { padding: 0; } .menu .msec + .msec { border-top: 8px solid rgba(0, 0, 0, .22); }
.menu .mh { padding: 10px 16px 4px; font-size: 13px; line-height: 18px; letter-spacing: -.006em; color: var(--ink-2); }
.menu .mi { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 11px 16px 11px 12px; border-radius: 0; text-align: left; font-size: 17px; line-height: 22px; font-weight: 400; letter-spacing: -.025em; color: var(--ink); }
.menu .mi + .mi { box-shadow: inset 0 1px 0 var(--line); }
.menu .mi::before { content: ""; flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: var(--check) center / 16px no-repeat; mask: var(--check) center / 16px no-repeat; visibility: hidden; }   /* o lugar da marca fica reservado */
.menu .mi[aria-pressed="true"]::before { visibility: visible; }
.menu .mi:hover, .menu .mi[aria-pressed]:hover { background: var(--fill); }
.menu .mi:active { background: var(--fill-3); }   /* realce da linha, sem encolher */
.menu .mi[aria-pressed="true"] { background: transparent; color: var(--ink); }   /* ligado: a marca diz, não o fundo */
.menu .mi:focus-visible, .menu .mhr :focus-visible { outline-offset: -3px; }   /* a lista rola: o anel por dentro */
.menu .mi:disabled { cursor: default; } .menu .mi:disabled:hover { background: transparent; }
.menu .mi .mic { order: 2; flex: none; width: 20px; display: grid; place-items: center; color: var(--ink); } .menu .mi .mic svg { width: 20px; height: 20px; }   /* ícone à direita; o estado é a marca */
.menu .mi .ml { flex: 1; min-width: 0; } .menu .mi .ml small, .menu .mi .mnote { display: block; font-size: 13px; line-height: 18px; letter-spacing: -.006em; color: var(--ink-2); }
.menu .mi.peg { touch-action: pan-y; cursor: grab; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; } .menu .mi.peg .mic { color: var(--on); transition: transform .2s var(--ease); } .menu .mi.peg.lift .mic { transform: scale(1.3); }   /* o bonequinho continua âmbar: no toque, segure (ele cresce) e arraste; correr o dedo rola a lista */
@media (pointer: fine) { .menu .mi { min-height: 36px; padding-block: 8px; font-size: 15px; line-height: 20px; letter-spacing: -.015em; } .menu .mi .ml small, .menu .mi .mnote { font-size: 12px; line-height: 16px; letter-spacing: 0; } }
.menu .mseg { display: flex; margin: 4px 16px 10px; }
.menu .mseg button { flex: 1; }
/* Hora (v1.8: era o título e, na demo, a faixa da hora): agora ou simulada — arrastar simula o sol, "Ao vivo" volta ao relógio */
.menu .mtime { padding: 0 16px; } .menu .mtime b { display: block; font-size: 28px; line-height: 34px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.menu .mtime small { display: block; font-size: 13px; line-height: 18px; color: var(--ink-2); font-variant-numeric: tabular-nums; } .menu .mtime small svg { width: 13px; height: 13px; vertical-align: -2px; }
.menu .mhr { display: flex; align-items: center; gap: 12px; padding: 6px 16px 12px; }
.menu .mhr input { flex: 1; min-width: 0; height: 28px; margin: 0; -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; touch-action: pan-y; }
.menu .mhr input::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: var(--sky, var(--fill-3)); }
.menu .mhr input::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; margin-top: -9px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 3px 1px rgba(0, 0, 0, .06), 0 0 0 .5px rgba(0, 0, 0, .04); }
.menu .mhr input::-moz-range-track { height: 6px; border-radius: 3px; background: var(--sky, var(--fill-3)); }
.menu .mhr input::-moz-range-thumb { width: 24px; height: 24px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 3px 1px rgba(0, 0, 0, .06); }
.menu .mhr button { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 6px 12px; border-radius: 999px; background: var(--fill-2); color: var(--ink); font-size: 15px; line-height: 20px; letter-spacing: -.015em; }
.menu .mhr button i { width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; border: 2px solid var(--ink-2); }
.menu .mhr button[aria-pressed="true"] { background: var(--fill-2); color: var(--ink); } .menu .mhr button[aria-pressed="true"] i { border: 0; background: #30d158; }   /* ao vivo: o ponto verde do iOS */
.menu .mwx { display: flex; align-items: center; gap: 10px; padding: 4px 16px 10px; }
.menu .mwx .mic { flex: none; width: 22px; color: var(--ink); display: grid; place-items: center; } .menu .mwx .mic svg { width: 22px; height: 22px; }
.menu .mwx b { display: block; font-size: 15px; line-height: 20px; color: var(--ink); } .menu .mwx small { display: block; font-size: 13px; line-height: 18px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
button { appearance: none; border: 0; background: transparent; color: var(--ink); font: inherit; font-weight: 600; font-size: 12px;
  padding: 6px 10px; border-radius: 7px; cursor: pointer; letter-spacing: -.006em; }
button:hover { background: var(--fill); }
button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.hud .btn:focus-visible, .nav button:focus-visible, .reopen:focus-visible, .pegdica button:focus-visible { box-shadow: 0 0 0 2px #000; }   /* sobre a cena: anel duplo (o azul encosta no preto, 7,4:1) */
button[aria-pressed="true"] { background: var(--on-bg); color: var(--on); }
.btn { min-height: 36px; padding: 7px 14px; border-radius: 999px; font-size: 15px; line-height: 20px; letter-spacing: -.015em; }   /* cápsula, como os botões de barra do HIG */
@media (pointer: coarse) { .btn { min-height: 44px; } }
.btn:hover { background: var(--raised); }   /* opaco: o fill translúcido mostraria a cena por baixo */
.wrap::before, .wrap::after { content: ""; position: absolute; left: 0; right: 0; height: 120px; pointer-events: none; }
.wrap::before { top: 0; background: linear-gradient(rgba(6, 9, 18, .55), transparent); }
.wrap::after { bottom: 0; background: linear-gradient(transparent, rgba(6, 9, 18, .6)); }
.err { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: #ffb4b4; background: #0a0f1e; }
/* Vista de cima navegável: trilha Planta › Bloco › Cômodo (Voltar + migalhas) à esquerda do botão; o cômodo aparece no próprio painel */
.navrow { flex: 1 1 0; display: flex; pointer-events: none; min-width: 0; box-sizing: border-box; }
.wrap.side:not(.sheet) .navrow { padding-left: calc(var(--side-w, 320px) + 10px); }   /* coluna aberta: a trilha fica na faixa da cena, à direita dela */
.wrap:not(.side):not(.sheet) .navrow { padding-left: 36px; }   /* coluna recolhida: a pílula de reabrir mora no canto de cima */
.navrow[hidden] { display: none; }
.navrow > * { pointer-events: auto; }
.nav { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-height: 44px; padding: 4px 10px 4px 4px; max-width: 100%; box-sizing: border-box; border-radius: 22px; }
.nav .back { display: inline-flex; align-items: center; min-height: 36px; padding: 6px 12px 6px 8px; border-radius: 999px; background: var(--fill-2); font-size: 15px; line-height: 20px; letter-spacing: -.015em; }
.nav .back svg { width: 16px; height: 16px; margin-right: 2px; }
.nav .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 0 1px; font-size: 13px; min-width: 0; }
.nav .crumbs button { padding: 5px 6px; font-size: 13px; line-height: 18px; }
.nav .crumbs button[aria-current="page"] { color: var(--ink); cursor: default; background: transparent; }   /* página atual não é "ligado" */
.nav .sep { color: var(--ink-2); }
.nav .navhint { color: var(--ink-2); font-size: 13px; padding: 0 4px; }
@media (max-width: 640px) { .nav .back { min-height: 44px; } .nav .crumbs button { padding: 8px 6px; } .nav .navhint { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } }   /* celular: a trilha numa linha ao lado do ⋯; a dica fica só para o leitor de tela */
/* Visão de pessoa: joystick, aviso de comandos */
.joy { position: absolute; left: 16px; bottom: 16px; width: 116px; height: 116px; border-radius: 50%; z-index: 4; touch-action: none; opacity: .85; cursor: grab;
  background: radial-gradient(circle, rgba(255, 255, 255, .12), rgba(255, 255, 255, .04)); border: 1px solid rgba(255, 255, 255, .24); backdrop-filter: var(--blur-s); -webkit-backdrop-filter: var(--blur-s); }
.joy[hidden] { display: none; }
.joy .knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; pointer-events: none;
  background: var(--on-line); border: 1px solid var(--on); box-shadow: 0 2px 10px rgba(0, 0, 0, .35); }
.walkhint { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); z-index: 4; padding: 7px 12px; font-size: 13px; line-height: 18px; color: var(--ink); max-width: calc(100% - 32px);
  text-align: center; pointer-events: none; opacity: 0; transition: opacity .6s; }
.walkhint.show { opacity: 1; }
/* balão do aparelho selecionado na maquete (v1.6.1; popover do iOS na v1.8): nome, estado e a ação; Acender/Ligar âmbar cheio, Apagar/Desligar/Detalhes grafite.
   A posição vem do _selPlace na propriedade translate: a escala da entrada e da saída nasce da ponta */
.sel { position: absolute; left: 0; top: 0; z-index: 4; display: flex; align-items: center; gap: 12px; max-width: calc(100% - 16px); box-sizing: border-box; padding: 8px 8px 8px 14px; border-radius: 14px; white-space: nowrap;
  background: var(--mat-pop); border: 0; backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .12), 0 10px 28px rgba(0, 0, 0, .45);
  transform-origin: calc(50% + var(--ax, 0px)) calc(100% + 8px); animation: selIn .3s var(--ease); }   /* sólido fora do vidro: os rótulos da maquete não transparecem */
.sel.below { transform-origin: calc(50% + var(--ax, 0px)) -8px; }
@keyframes selIn { from { opacity: 0; scale: .9; } }
.sel[hidden] { display: none; } .sel > span { min-width: 0; } .sel b, .sel small { overflow: hidden; text-overflow: ellipsis; }   /* texto longo: reticências; o botão fica inteiro */
.sel::after { content: ""; position: absolute; left: calc(50% + var(--ax, 0px)); bottom: -5.5px; width: 12px; height: 12px; margin-left: -6px; background: var(--mat-pop); transform: rotate(45deg);
  clip-path: polygon(0 100%, 100% 100%, 100% 0); box-shadow: inset -.5px -.5px 0 rgba(255, 255, 255, .12); }   /* ponta: metade de fora de um quadrado girado, com o mesmo fio de 0,5 px do corpo */
.sel.below::after { top: -5.5px; bottom: auto; clip-path: polygon(0 100%, 0 0, 100% 0); box-shadow: inset .5px .5px 0 rgba(255, 255, 255, .12); }   /* perto do cabeçalho: abre embaixo do ponto */
.sel b { display: block; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -.015em; color: var(--ink); } .sel small { display: block; font-size: 13px; line-height: 18px; color: var(--ink-2); }
.sel button { flex: none; min-height: 32px; padding: 6px 14px; border-radius: 999px; background: var(--fill-2); color: var(--ink); font-size: 15px; line-height: 20px; letter-spacing: -.015em; transition: transform .1s ease-out, background-color .2s; }   /* Apagar/Desligar/Detalhes: grafite */
.sel button:hover { background: var(--fill-3); } .sel button.go { background: var(--on); color: var(--on-ink); }   /* Acender/Ligar: âmbar cheio */
.sel button:active { transform: scale(.97); }
@media (pointer: coarse) { .sel button { min-height: 44px; } }
.wrap.side:not(.sheet) .walkhint { left: calc(50% + var(--side-w, 320px) / 2 + 10px); max-width: calc(100% - var(--side-w, 320px) - 52px); }   /* centrada na faixa livre */
canvas.walk { cursor: crosshair; }
canvas.walk.pick { cursor: pointer; }
/* Bonequinho (arrastar do item Pessoa da lista até o ambiente), "Ir para…" — v1.4.6 */
.pegdica { position: absolute; z-index: 7; display: flex; align-items: flex-start; gap: 6px; max-width: 240px; padding: 9px 6px 9px 12px; font-size: 13px; line-height: 18px; color: var(--ink); text-wrap: pretty;
  background: var(--mat-pop); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .12), 0 10px 28px rgba(0, 0, 0, .45); animation: fadeIn .25s ease-out; }
.pegdica[hidden] { display: none; }
.pegdica::before { content: ""; position: absolute; top: -6px; right: calc(var(--ax, 20px) + 1px); width: 10px; height: 10px; background: inherit; transform: rotate(45deg); }
.pegdica button { flex: none; width: 24px; height: 24px; padding: 0; border-radius: 50%; font-size: 15px; line-height: 1; color: var(--ink-2); }
.pegghost { position: absolute; left: 0; top: 0; width: 44px; height: 44px; z-index: 7; pointer-events: none; display: grid; place-items: center; color: var(--on);
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, .55)); opacity: .85; }
.pegghost svg { width: 40px; height: 40px; } .pegghost.ok { opacity: 1; } .pegghost[hidden] { display: none; }
.pegtip { position: absolute; left: 0; top: 0; z-index: 7; pointer-events: none; padding: 5px 9px; font-size: 13px; font-weight: 600; color: var(--on); white-space: nowrap; }
.pegtip[hidden] { display: none; }
.goto { position: absolute; right: 10px; top: var(--hud-h, 62px); z-index: 6; width: min(340px, calc(100% - 20px)); max-height: calc(100% - 150px); overflow: auto; padding: 8px 10px 10px; overscroll-behavior: contain; box-sizing: border-box;
  background: var(--mat-pop); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); }
.goto[hidden] { display: none; }
.wrap.side .goto { width: min(340px, calc(100% - var(--side-w, 340px) - 30px)); }   /* coluna aberta à esquerda: a lista fica à direita, sem cruzar */
.goto .gh { font-size: 13px; line-height: 18px; color: var(--ink-2); padding: 2px 2px 6px; }
.goto .gt { font-size: 13px; color: var(--ink-2); font-weight: 600; margin: 10px 2px 6px; }
.goto .grow { display: flex; flex-wrap: wrap; gap: 6px; }
.goto .grow button { background: var(--fill-2); border-radius: 999px; padding: 7px 14px; font-size: 15px; line-height: 20px; }
.goto .grow button:hover { background: var(--fill-3); color: var(--ink); }
.fade { position: absolute; inset: 0; background: #06090f; opacity: 0; pointer-events: none; z-index: 5; }
@media (max-width: 640px) { .goto, .wrap.side .goto { top: auto; bottom: 138px; right: 10px; left: 10px; width: auto; max-height: 50%; } }
@media (max-width: 640px) { .joy { width: 104px; height: 104px; left: 14px; bottom: 14px; } .walkhint { bottom: 130px; } }
/* Painel (v1.7, o da Casa; v1.8 com o visual da Casa v1.9) — coluna grafite à esquerda (barra lateral flutuante do iPadOS); âmbar só no que está ligado (tokens no :host).
   --side-w / --side-top vêm do _layoutHud (largura da coluna e topo: no alto, ou abaixo do botão ⋯ se ele invadir a faixa) */
.dock { position: absolute; top: var(--side-top, 58px); left: 10px; bottom: auto; max-height: calc(100% - var(--side-top, 58px) - 10px); width: var(--side-w, 340px); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; z-index: 4; touch-action: pan-y;
  border-radius: 28px; border: 0; background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);   /* raio 28: concêntrico com o bloco (18 + 12 de margem) */
  box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .1), 0 8px 40px rgba(0, 0, 0, .38);
  animation: dockIn .3s var(--ease) backwards; }
.dock[hidden] { display: none; }
.dock.closing { animation: dockOut .2s ease-in forwards; pointer-events: none; }
@keyframes dockIn { from { opacity: 0; transform: translateX(-32px); } }
@keyframes dockOut { to { opacity: 0; transform: translateX(calc(-100% - 16px)); } }   /* sai pelo mesmo lado por onde entrou */
.grab { display: none; }   /* alça da folha (só na folha de baixo) */
.dshadow { display: none; }   /* sombra da folha flutuante (só no tablet em pé) */
@keyframes paneIn { from { opacity: 0; } }   /* troca de aba: só esmaece */
@keyframes sheetIn { from { opacity: 0; transform: translateY(14px); } }
@keyframes flashPulse { 0% { box-shadow: 0 0 0 0 var(--focus); } 100% { box-shadow: 0 0 0 14px transparent; } }
/* cabeçalho da coluna: cápsula do que está ligado (como "Luzes · 4 acesas" do Home) + recolher; abaixo, as abas em segmento de largura igual */
.phead { display: flex; align-items: center; gap: 8px; padding: 12px; flex: none; }
.phead .spacer { flex: 1; }
.phead .count { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; padding: 6px 12px 6px 10px; border-radius: 999px; background: var(--fill); color: var(--ink-2); font-size: 13px; line-height: 18px; font-weight: 400; font-variant-numeric: tabular-nums; white-space: nowrap; }
.phead .count svg { width: 14px; height: 14px; color: var(--off); transition: color .2s; }
.phead .count.lit svg { color: var(--on); }   /* a lâmpada acende; sem brilho */
.phead .count b { color: var(--ink); font-weight: 600; }
.phead .count:not(.lit):not(.any) { color: var(--ink-3); }   /* "Tudo desligado" em cinza */
.phead .count:hover { background: var(--fill-2); }
.phead .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }   /* só leitor de tela */
.phead .collapse { position: relative; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border-radius: 50%; background: var(--fill); color: var(--ink-2); flex: none; }
.phead .collapse:hover { background: var(--fill-2); color: var(--ink); }
/* UISegmentedControl (abas, Ligados/Todos, modo do ar, "desligar em", Auto/Dia/Noite): trilho raio 9, polegar #636366 raio 7 com 2 px de folga, 13 pt.
   O escolhido em semibold, com um fio claro (3,4:1 contra o trilho: a cor sozinha não chega a 3:1) */
.tabs, .zonebar, .seg2, .menu .mseg { gap: 0; padding: 2px; border: 0; border-radius: 9px; background: var(--fill); }
.tabs button[role="tab"], .zonebar button, .seg2 button, .menu .mseg button { min-height: 28px; padding: 4px 10px; border-radius: 7px; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: -.006em; color: var(--ink); transition: background-color .2s, box-shadow .2s; }
.tabs button[aria-selected="true"], .zonebar button[aria-pressed="true"], .seg2 button[aria-pressed="true"], .menu .mseg button[aria-pressed="true"] {
  background: var(--seg); color: var(--ink); font-weight: 600; box-shadow: inset 0 0 0 1px var(--seg-line), 0 3px 8px rgba(0, 0, 0, .12), 0 3px 1px rgba(0, 0, 0, .04); }
.tabs { display: flex; margin: 0 12px 12px; flex: none; }
.tabs button[role="tab"] { flex: 1; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding-inline: 4px; }
.tabs button[role="tab"] span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabs button[role="tab"] svg { display: none; }   /* coluna estreita: só o texto */
.pane { flex: 0 1 auto; min-height: 0; overflow: auto; padding: 12px 12px 14px; display: none; touch-action: pan-y; overscroll-behavior: contain;
  -webkit-mask-image: linear-gradient(transparent, #000 12px); mask-image: linear-gradient(transparent, #000 12px);   /* degradê na borda de cima em vez de linha de 1 px */ scrollbar-width: thin; scrollbar-color: var(--fill-3) transparent; }
.pane.active { display: block; animation: paneIn .2s var(--ease); }
.pane.top { -webkit-mask-image: none; mask-image: none; }   /* degradê só depois de rolar: sem camada de máscara parada */
/* Ligados · Todos: filtro compacto à esquerda, segmentos de largura igual, com selo âmbar (a planta é o filtro por cômodo) */
.zonebar { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; width: max-content; max-width: 100%; box-sizing: border-box; margin: 0 0 16px; }
.zonebar button { position: relative; min-width: 84px; font-variant-numeric: tabular-nums; }
.zonebar .n { display: inline-block; min-width: 20px; height: 20px; margin-left: 6px; padding: 0 6px; box-sizing: border-box; border-radius: 10px; background: var(--on); color: var(--on-ink); font-size: 12px; font-weight: 600; line-height: 20px; vertical-align: 1px; }   /* selo: quantos estão ligados */
.zempty { margin: 0 0 8px; padding: 12px; border-radius: 12px; background: var(--raised); font-size: 15px; line-height: 20px; color: var(--ink-2); } .zempty[hidden] { display: none; }
.zempty button { padding: 6px 4px; color: var(--ink); font-size: inherit; text-decoration: underline; text-underline-offset: 3px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 8px; }   /* 1 coluna a 272 px, 2 a 320, 3 a 470 */
/* cômodo como no Home: "Mídia ›" em 17 semibold, contagem em 13 cinza, sem fio */
.zone { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin: 24px 2px 0; font-size: 17px; line-height: 22px; font-weight: 600; letter-spacing: -.025em; color: var(--ink); }
.zone:first-child { margin-top: 0; }
.zone::after { content: ""; order: 2; flex: 1; }
.zone button { display: inline-flex; align-items: center; gap: 4px; padding: 0; font: inherit; letter-spacing: inherit; color: inherit; }
.zone button i, .blk .bn i { display: inline-grid; color: var(--ink-2); } .zone button i svg { width: 14px; height: 14px; } .blk .bn i svg { width: 16px; height: 16px; }   /* "›": leva ao cômodo / ao bloco */
.zone button:not(:disabled):hover, .zone button:not(:disabled):hover i { color: var(--ink); } .zone button:disabled { cursor: default; }
.zone .zn { order: 3; font-weight: 400; font-size: 13px; letter-spacing: -.006em; color: var(--ink-2); font-variant-numeric: tabular-nums; }   /* contagem em texto: neutra */
.zone[hidden], .tile[hidden], .blk[hidden], .sect[hidden] { display: none; }
/* bloco (v1.7, como a Casa; v1.8: Templo · Operacional · Banheiro · Sala Pastoral · Hall de entrada) — numa linha, nome › (abre o bloco),
   "N de M ligados" e o interruptor de tudo dele (o da Casa v1.9); os cômodos dele embaixo */
.blk { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; margin: 0 2px; color: var(--ink); }
:not([hidden]) ~ .blk { margin-top: 32px; } .blk + .zone { margin-top: 12px; }   /* vão só entre blocos à vista */
.blk .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }   /* nome e, embaixo, a contagem — como no cabeçalho do cômodo, em qualquer largura */
.blk b { font-size: 20px; line-height: 25px; font-weight: 700; letter-spacing: -.02em; } .blk .bn { position: relative; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0; font: inherit; color: inherit; text-align: left; }
.blk .bn:hover i { color: var(--ink); } .blk .bn::after { content: ""; position: absolute; inset: -8px -6px; }   /* alvo maior que o texto */
.blk small { white-space: nowrap; font-size: 13px; line-height: 18px; letter-spacing: -.006em; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.autos > .blk:not(:first-child) { margin-top: 24px; } .autos > .blk + .zone { margin-top: 4px; } .autos .zone { margin-bottom: 8px; } .autos > .blk { margin-bottom: 8px; }   /* Automações · bloco → cômodo */
.tile.wide { grid-column: 1 / -1; } .dock.room:not(.bv) .tile.wide { grid-column: auto; } .tile small .sv { font-weight: 400; }   /* aparelho de mais de um cômodo: linha inteira, cabe o "também …" */
.wrap.sheet:not(.narrow) .dock:not(.room) .tile.wide, .wrap.sheet:not(.narrow) .dock.bv .tile.wide { grid-column: span 2; }   /* folha do tablet (4+ colunas): 2 colunas bastam */
.tile.wide small { white-space: normal; }   /* "também Depósito, WC Masc., WC Fem. e WCs": quebra a linha em vez de cortar */
/* bloco do Home (ícone num círculo à esquerda, nome e estado à direita, sem borda): desligado grafite; ligado claro com o círculo âmbar; sensor nunca acende */
.tile { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 8px; min-height: 64px; padding: 12px 8px 12px 12px; border-radius: 18px; text-align: left; color: var(--ink);
  background: var(--raised); border: 0;
  transition: background-color .2s, transform .14s var(--ease); }
.tile > * { position: relative; }
.tile { container: tile / inline-size; }   /* a letra segue a largura do bloco, não a da tela */
.tile:hover { background: #363638; }
.tile:active { transform: scale(.97); }
.tile:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.tile .top { display: contents; }
.tile > span:not(.top) { min-width: 0; }
.tile .eyebrow { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }   /* área/cômodo: só leitor de tela */
.tile .ico { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--ink-2); transition: background-color .2s, color .2s; }
.tile .ico svg { width: 20px; height: 20px; }
svg .f, :is(.on, .lit) svg .r { display: none; } :is(.on, .lit) svg .f { display: inline; }   /* Phosphor: desligado = regular, ligado = fill (só CSS, sem refazer o bloco) */
.tile b { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: break-word; hyphens: auto; -webkit-hyphens: auto; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -.015em; color: var(--ink); }   /* até 2 linhas, como no Home (palavra longa: hifeniza onde o sistema sabe) */
.tile small { display: block; font-size: 13px; line-height: 18px; font-weight: 400; letter-spacing: -.006em; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile small .st { color: var(--ink-2); }
.tile small .tm, .tile small .sep { display: none; }   /* o horário fica na aba Atividade */
.tile.on:not([data-kind="sensor"]) { background: var(--tile-on); }   /* ligado: claro (depois do :hover) */
.tile.on:not([data-kind="sensor"]):hover { background: #f2f2f7; }
.tile.on:not([data-kind="sensor"]) b { color: var(--tile-on-ink); }
.tile.on:not([data-kind="sensor"]) small, .tile.on:not([data-kind="sensor"]) small .st { color: var(--tile-on-ink-2); }
.tile.on .ico { background: var(--on); color: var(--on-ink); }   /* desenho cheio no círculo âmbar, sem halo */
.tile[data-kind="sensor"].on { background: var(--raised); } .tile[data-kind="sensor"].on .ico { background: var(--fill-2); color: var(--ink-2); }   /* sensor é só leitura: nunca acende */
.tile[data-kind="sensor"] small { white-space: normal; } .tile[data-kind="sensor"] small .st { color: var(--ink); }   /* leitura: pode quebrar a linha */
.tile.unavailable:hover { background: #323234; } .tile.unavailable b { color: var(--ink-2); } .tile.unavailable .ico { color: var(--ink-3); } .tile.unavailable small .st { color: var(--alert); }   /* sem opacidade nem filtro: continua legível */
.tile.flash { box-shadow: 0 0 0 3px var(--focus); }   /* "olha aqui" */
.tile .more { position: absolute; top: 4px; right: 4px; z-index: 1; width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border-radius: 50%; background: transparent; color: var(--ink-2); cursor: pointer; opacity: 0; transition: background-color .2s, opacity .2s; }   /* z-index: por cima do nome, que senão pega o toque */
.tile .more svg { width: 16px; height: 16px; }
.tile:hover .more, .tile:focus-within .more { opacity: 1; } @media (hover: none) { .tile .more { opacity: 1; } }   /* "⋯" só aparece quando serve (no toque, sempre) */
.tile .more:hover, .tile .more:focus-visible { background: var(--fill-2); color: var(--ink); opacity: 1; }
.tile.on .more { color: var(--tile-on-ink-2); } .tile.on .more:hover, .tile.on .more:focus-visible { background: rgba(60, 60, 67, .14); color: #000; }
.tile .more:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; } .tile.on .more:focus-visible { outline-color: #0040dd; }   /* por dentro do círculo; no bloco claro, o azul escuro do iOS (6:1) */
.tile .more::after { content: ""; position: absolute; inset: -4px; }   /* área de toque maior */
.tile[data-kind]:not([data-kind="sensor"]):is(:hover, :focus-within) b { padding-right: var(--mw, 22px); } @media (hover: none) { .tile[data-kind]:not([data-kind="sensor"]) b { padding-right: var(--mw, 22px); } }   /* onde o "⋯" aparece, o nome acaba antes dele, não embaixo */
.tiles.routines { grid-template-columns: minmax(0, 1fr); }
.tile.routine .ico { background: var(--fill); color: var(--ink-2); }
.tile.routine small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; }   /* descrição em até 2 linhas (o .tile small é de 1) */
@container tile (max-width: 140px) { .tile b { --mw: 18px; font-size: 13px; line-height: 18px; letter-spacing: -.006em; } .tile small { font-size: 12px; line-height: 16px; letter-spacing: 0; } .tile .ico { width: 32px; height: 32px; margin-left: -2px; } }   /* bloco estreito (2 colunas na coluna de 330, tablet deitado, 320): nome 13 e estado 12, como no Home, e o vão do ⋯ a 18; palavras inteiras e «acesa · 100%» sem corte */
/* folha de controles do aparelho: cartão #2c2c2e colado no fim da área rolável */
.detail { grid-column: 1 / -1; position: sticky; bottom: 4px; z-index: 4; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; padding: 16px; border-radius: 18px; margin-top: 4px;
  background: var(--raised); box-shadow: 0 -8px 32px rgba(0, 0, 0, .4); animation: sheetIn .28s var(--ease); }
.detail[hidden] { display: none; }
.detail .dhead { display: flex; align-items: center; gap: 12px; }
.detail .dbody { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.detail .dtitle { display: flex; align-items: center; gap: 10px; margin-right: auto; min-width: 0; }
.detail .dtitle .ico { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--ink-2); background: var(--fill); flex: none; transition: background-color .2s, color .2s; }
.detail.on .dtitle .ico { background: var(--on); color: var(--on-ink); }   /* o mesmo ícone aceso do bloco */
.detail .dtitle .ico svg { width: 20px; height: 20px; }
.detail .dtitle b { font-size: 17px; line-height: 22px; font-weight: 600; letter-spacing: -.025em; } .detail .dtitle small { color: var(--ink-2); font-size: 13px; line-height: 18px; display: block; }
.detail .close { position: relative; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border-radius: 50%; background: var(--fill-2); color: var(--ink-2); } .detail .close svg { width: 13px; height: 13px; }
/* linhas de ajuste do ar (v1.8): nome à esquerda (com a leitura embaixo), controle à direita — Temperatura (alvo no − / +, atual embaixo) e Oscilar */
.detail .drow { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; font-size: 15px; line-height: 20px; letter-spacing: -.015em; } .detail .drow > :last-child { margin-left: auto; }   /* coluna de 272: o − / + desce para baixo do nome, à direita, em vez de passar da borda */
.detail .drow small { display: block; font-size: 13px; line-height: 18px; letter-spacing: -.006em; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.detail .drow .sw:disabled { opacity: .45; cursor: default; }   /* o ar não informa oscilar ao HA: a nota diz por quê */
/* UISwitch 51×31 (luz, ar, automação, oscilar e o "tudo" do bloco e do cômodo): polegar 27 branco com a sombra do iOS; ligado em âmbar; estica sob o dedo */
.sw, .sw:hover { position: relative; flex: none; width: 51px; height: 31px; padding: 0; border-radius: 999px; background: var(--fill-3); transition: background-color .25s var(--ease); }
.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 14px; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 3px 1px rgba(0, 0, 0, .06); transition: transform .3s var(--ease), width .2s var(--ease); }
.sw[aria-checked="true"] { background: var(--on); } .sw[aria-checked="true"]::after { transform: translateX(20px); }
.sw:active::after { width: 34px; } .sw[aria-checked="true"]:active::after { transform: translateX(13px); }
.sw.still, .sw.still::after { transition: none; }   /* 1º desenho: já na posição, sem deslizar */
.sw:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.sw[hidden] { display: none; }
.swl { flex: none; font-size: 13px; line-height: 18px; letter-spacing: -.006em; color: var(--ink-2); } .swl[hidden] { display: none; }   /* "Tudo" à vista: o interruptor do grupo não se confunde com o de uma automação */
.seg2 { display: inline-flex; }
.timerseg .tlab { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px 0 6px; font-size: 13px; color: var(--ink-2); }
.step { display: inline-flex; align-items: center; gap: 6px; padding: 2px; border-radius: 999px; background: var(--fill); }
.step button { position: relative; width: 40px; height: 32px; padding: 0; border-radius: 999px; background: transparent; color: var(--ink); font-size: 22px; font-weight: 400; line-height: 1; }
.step button:hover { background: var(--fill-2); color: var(--ink); }
.step output { min-width: 50px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 17px; letter-spacing: -.01em; color: var(--ink); }
.mbtn { position: relative; width: 36px; height: 32px; padding: 0; border-radius: 999px; background: var(--fill-2); display: inline-grid; place-items: center; font-size: 16px; }
.mbtn:hover { background: var(--fill-3); }
input[type="range"] { flex: 1; min-width: 110px; }
.detail .rng { flex: 1 1 200px; min-width: 150px; display: flex; align-items: center; gap: 10px; }
.detail .rng output { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 15px; color: var(--ink); }
/* slider grosso do Controle Central: trilho de 36 px, preenchimento branco, sem polegar (a borda do preenchimento é o valor) */
.detail input[type="range"] { -webkit-appearance: none; appearance: none; flex: 1; min-width: 0; height: 36px; margin: 0; background: transparent; cursor: pointer; --v: 100%; --c: #fff; }
.detail input[type="range"]::-webkit-slider-runnable-track { height: 36px; border-radius: 12px; background: linear-gradient(90deg, var(--c) var(--v), var(--fill-3) var(--v)); }
.detail input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 0; height: 36px; margin-top: 0; border: 0; background: transparent; box-shadow: none; }
.detail input[type="range"]::-moz-range-track { height: 36px; border-radius: 12px; background: var(--fill-3); }
.detail input[type="range"]::-moz-range-progress { height: 36px; border-radius: 12px; background: var(--c); }
.detail input[type="range"]::-moz-range-thumb { width: 0; height: 36px; border: 0; background: transparent; box-shadow: none; }
.detail input[type="range"]:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 14px; }
.swatches { display: flex; gap: 8px; } .swatch { position: relative; width: 26px; height: 26px; border-radius: 50%; padding: 0; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .2); transition: transform .15s; }
.swatch:hover { transform: scale(1.15); }
/* rótulo de seção (lista agrupada do iOS): a única caixa alta do painel; a nota desce para uma linha própria */
.sect { margin: 0 12px 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; font-size: 13px; line-height: 18px; font-weight: 400; letter-spacing: -.006em; text-transform: uppercase; color: var(--ink-2); }
.sect small { flex-basis: 100%; text-transform: none; font-size: 13px; line-height: 18px; color: var(--ink-2); }
.tiles + .sect { margin-top: 24px; }
/* listas agrupadas (Automações, Atividade e as automações do cômodo): cada sequência de linhas é um cartão #2c2c2e de raio 12, linhas de 44+ com fio inset */
.autos { display: grid; grid-template-columns: minmax(0, 1fr); }
.auto { position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; min-height: 44px; box-sizing: border-box; padding: 10px 12px; background: var(--raised); transition: background-color .2s; }
.autos > .auto:first-child, .autos > :not(.auto) + .auto { border-radius: 12px 12px 0 0; }
.autos > .auto:last-child, .autos > .auto:has(+ :not(.auto)) { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }   /* sem :has, só os cantos de baixo ficam retos */
.auto + .auto::before, .feed li + li::before { content: ""; position: absolute; top: 0; right: 0; left: 52px; border-top: 1px solid var(--line); }
.auto:hover { background: #363638; }
.auto .ico { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; background: var(--fill-2); color: var(--ink-2); transition: background-color .2s, color .2s; }   /* ícone de Ajustes: quadrado arredondado */
.auto.on .ico { background: var(--on); color: var(--on-ink); }   /* automação ativa: âmbar */
.auto b { display: block; font-size: 15px; line-height: 20px; font-weight: 400; letter-spacing: -.015em; color: var(--ink); } .auto small { display: block; color: var(--ink-2); font-size: 13px; line-height: 18px; letter-spacing: -.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }   /* legenda numa linha, como no Casa */
.auto.off b { color: var(--ink-2); }
.auto.flash { animation: flashPulse .7s var(--ease); }
.auto .run { position: relative; width: 30px; height: 30px; padding: 0; border-radius: 50%; background: var(--fill); display: inline-grid; place-items: center; transition: background-color .2s; }
.auto .run:hover { background: var(--fill-3); }
.autos .empty { color: var(--ink-2); font-size: 15px; padding: 12px; border-radius: 12px; background: var(--raised); grid-column: 1 / -1; }
.feed { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); border-radius: 12px; background: var(--raised); overflow: hidden; }
.feed li { position: relative; display: grid; grid-template-columns: 28px 1fr auto; gap: 11px; align-items: center; min-height: 44px; box-sizing: border-box; padding: 10px 12px; font-size: 15px; line-height: 20px; letter-spacing: -.015em; }
.feed .d { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; background: var(--fill); color: var(--ink-2); }
.feed .d svg { width: 15px; height: 15px; }
.feed li.on .d { background: var(--on); color: var(--on-ink); }   /* o que acendeu, ligou ou começou a tocar */
.feed b { font-weight: 600; color: var(--ink); } .feed time { color: var(--ink-2); font-variant-numeric: tabular-nums; font-size: 13px; text-align: right; white-space: nowrap; }
.feed .empty { color: var(--ink-2); padding: 14px 12px; font-size: 15px; grid-column: 1 / -1; display: block; }
@media (min-resolution: 2dppx) { .auto + .auto::before, .feed li + li::before { border-top-width: .5px; } .menu .mi + .mi { box-shadow: inset 0 .5px 0 var(--line); } }   /* fio de 0,5 pt, como na Apple */
:is(.auto .ico, .feed .d, .phead .count, .tlab, .rfoot .enter, .reopen) svg path:not(.f) { stroke: currentColor; stroke-width: 8; stroke-linejoin: round; }   /* desenhos de até 16 px: o traço do Phosphor (16/256 ≈ 0,9 px) engrossa até o do bold */
/* aba de reabrir presa à borda esquerda, na altura do topo da coluna: seta, "Painel" (ou o cômodo) na vertical e o nº de luzes acesas */
.reopen { position: absolute; left: 0; top: var(--side-top, 58px); display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 8px 12px 7px; z-index: 3;
  border-radius: 0 14px 14px 0; font-size: 13px; color: var(--ink); letter-spacing: .04em;
  background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .12), 0 8px 30px rgba(0, 0, 0, .4); animation: reopenIn .3s var(--ease) backwards; }
.reopen .rl { writing-mode: vertical-rl; line-height: 1; }
.reopen svg { width: 14px; height: 14px; color: var(--ink-2); }
.reopen svg, .phead .collapse svg { transform: scaleX(-1); }   /* setas espelhadas: o painel mora à esquerda (na folha giram 90°) */
@keyframes reopenIn { from { opacity: 0; transform: translateX(-14px); } }
.reopen:hover { background: var(--raised); }
.reopen .rn { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--on); color: var(--on-ink); font-size: 12px; font-weight: 600; line-height: 18px; text-align: center; font-variant-numeric: tabular-nums; letter-spacing: 0; }
.reopen .rn:empty { display: none; }
.reopen[hidden] { display: none; }
/* cômodo ou bloco tocado (v1.7): o painel focado nele — no lugar das abas e do filtro, "‹", nome, "N de M ligados" e o interruptor de tudo
   (v1.8, o da Casa v1.9); embaixo dos blocos, as automações e "Entrar aqui" */
.rhead { flex: none; margin: 0 12px 10px; }
.dock:not(.room) .rhead, .dock:not(.room) .rfoot, .dock.room .tabs, .dock.room .zonebar, .dock.room .blk, .dock.room:not(.bv) .tile .sv { display: none; }   /* bloco aberto (.bv): os subtítulos e o "também" ficam */
.dock.room .rhead { display: flex; align-items: center; gap: 8px; }   /* [‹] [nome + N de M] [Tudo ◯] */
.rhead .rback { flex: none; width: 32px; height: 32px; margin-left: -8px; padding: 0; display: grid; place-items: center; border-radius: 50%; color: var(--ink); } .rhead .rback svg { width: 20px; height: 20px; }
.rhead .rback:hover { background: var(--fill-2); }
.rhead .rtitle { flex: 1; min-width: 0; } .rhead .rtitle b { display: block; font-size: 20px; line-height: 25px; font-weight: 700; letter-spacing: -.02em; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rhead .rtitle small { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--ink-2); font-size: 13px; line-height: 18px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
.wrap:not(.sheet) .rhead .rtitle b, .wrap:not(.sheet) .rhead .rtitle small { white-space: normal; }   /* coluna: o nome e a leitura quebram a linha em vez de sumir (na folha, a 1ª linha é a espiada) */
.rfoot { margin-top: 24px; } .rfoot .autos { margin-bottom: 12px; }
.rfoot .enter { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; min-height: 44px; padding: 8px 14px; border-radius: 999px; background: var(--fill-2); color: var(--ink); font-size: 15px; line-height: 20px; letter-spacing: -.015em; transition: transform .1s ease-out, background-color .2s; }
.rfoot .enter:hover { background: var(--fill-3); }
.rfoot .enter svg { width: 16px; height: 16px; color: var(--ink); }
.rfoot .enter:active { transform: scale(.97); }   /* retorno já no toque */
/* folha de baixo (celular e tablet em pé, ver _layoutHud): altura do conteúdo e três alturas — espiada, média, cheia — por translateY.
   Fora da cheia a lista não rola: o dedo em qualquer ponto move a folha; na cheia, puxar com a lista no topo desce a folha */
.wrap.sheet .dock { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: calc(100% - var(--side-top, 58px)); border-radius: 28px 28px 0 0; animation-name: drawerIn; touch-action: none; --sab: env(safe-area-inset-bottom, 0px); }
.wrap.sheet .dock.closing { animation-name: drawerOut; }
@keyframes drawerIn { from { transform: translateY(100%); } }
@keyframes drawerOut { to { transform: translateY(100%); } }
.wrap.sheet .dock:not([data-snap="full"]) .pane { overflow: clip; touch-action: none; }   /* clip: nem o foco nem o _flashRow rolam a lista escondida */
.wrap.sheet .dock[data-snap="full"] .pane.top { touch-action: pan-down; }   /* no topo: subir rola a lista, descer é da folha */
.wrap.sheet .grab { display: block; position: absolute; left: 50%; top: 0; width: 64px; height: 22px; margin-left: -32px; padding: 0; z-index: 1; background: none; }
.wrap.sheet .grab::before { content: ""; position: absolute; left: 14px; right: 14px; top: 5px; height: 5px; border-radius: 2.5px; background: rgba(235, 235, 245, .4); }   /* alça 36×5 do iOS (3,2:1) */
.wrap.sheet .grab::after { content: ""; position: absolute; inset: 0 0 -22px; }   /* alvo de 44 px */
.wrap.sheet .phead .collapse svg { transform: rotate(90deg); }
.wrap.sheet .dock.room .phead { display: none; } .wrap.sheet .dock.room .rhead { margin-top: 16px; }   /* no cômodo a 1ª linha é a dele */
.wrap.sheet .reopen { top: auto; bottom: 0; left: 50%; right: auto; transform: translateX(-50%); flex-direction: row; padding: 9px 14px calc(9px + env(safe-area-inset-bottom)); border-radius: 14px 14px 0 0; animation-name: fadeIn; }
.wrap.sheet .reopen .rl { writing-mode: horizontal-tb; } .wrap.sheet .reopen svg { transform: rotate(90deg); }   /* a aba de reabrir fica onde a folha mora: embaixo */
.wrap.sheet .phead { padding: 16px 16px 8px; } .wrap.sheet .tabs, .wrap.sheet .rhead { margin: 0 16px 12px; } .wrap.sheet .pane { padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); }
@media (min-width: 641px) {   /* tablet em pé: folha flutuante, blocos em 4 colunas */
  .wrap.sheet .dock { left: 12px; right: 12px; bottom: 12px; max-height: calc(100% - var(--side-top, 58px) - 12px); border-radius: 28px; --sab: 0px; box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .1); }   /* a sombra fica no .dshadow: o clip-path a cortaria */
  .wrap.sheet .dock:not([hidden]) + .dshadow { display: block; position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 3; border-radius: 28px; box-shadow: 0 8px 40px rgba(0, 0, 0, .38); pointer-events: none; animation: drawerIn .3s var(--ease) backwards; }   /* altura do pedaço à vista (_sideX) */
  .wrap.sheet .dock.closing + .dshadow { animation: drawerOut .2s ease-in forwards; }   /* entra e sai junto com a folha */
  .wrap.sheet .reopen { bottom: 12px; border-radius: 999px; padding-bottom: 9px; }
  .wrap.sheet .tiles:not(.routines) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
/* coluna à esquerda (v1.7): no alto (v1.8, sem o título); borda direita arrastável (.sizer) */
.wrap.side:not(.sheet) .joy { left: calc(var(--side-w, 320px) + 26px); }
.wrap:not(.sheet) .dock { overflow: visible; } .wrap:not(.sheet) .pane { border-radius: 0 0 27px 27px; }   /* a alça sai 10 px da borda: o .pane recorta os cantos de baixo */
.dock { container-type: inline-size; }   /* consultas pela largura do PAINEL (coluna ajustável e folha); sem contain: paint, que cortaria a alça */
@container (max-width: 300px) { .tabs button[role="tab"] { padding-inline: 3px; font-size: 12px; letter-spacing: 0; } }   /* "Automações" inteira a 272 px */
@container (max-width: 400px) { .timerseg { display: flex; flex-wrap: wrap; flex: 1 1 100%; } .timerseg .tlab { flex-basis: 100%; padding: 3px 6px 4px; } .timerseg button { flex: 1 1 auto; padding-inline: 4px; white-space: nowrap; } }   /* "desligar em" em cima, os 4 tempos embaixo */
.sizer { position: absolute; top: 0; bottom: 0; right: -10px; width: 12px; z-index: 2; cursor: col-resize; touch-action: none; outline: none; }
.sizer::after { content: ""; position: absolute; top: 50%; left: .5px; width: 4px; height: 36px; margin-top: -18px; border-radius: 2px; background: var(--ink-3); box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); opacity: 0; transition: opacity .15s, background-color .15s; }   /* a mesma pílula da alça da folha: neutra */
@media (hover: hover) { .dock:hover .sizer::after { opacity: .7; } .dock .sizer:hover::after { opacity: 1; background: var(--ink-2); } }
@media (hover: none) { .sizer::after { opacity: .7; } }
.wrap.sizing .sizer::after { opacity: 1; background: var(--ink-2); }
.dock .sizer:focus-visible::after { opacity: 1; background: var(--ink-2); box-shadow: 0 0 0 2px var(--focus); }   /* .dock: acima do .dock:hover */
.sizer[data-edge="min"] { cursor: e-resize; } .sizer[data-edge="max"] { cursor: w-resize; }
.wrap.sizing, .wrap.sizing * { cursor: col-resize !important; user-select: none; -webkit-user-select: none; }
.wrap.sheet .sizer { display: none; }
@media (pointer: coarse) { .sizer { width: 44px; right: -36px; } .sizer::after { left: 6.5px; } }   /* toque: alvo de 44 px (8 dentro, 36 fora) */
@media (prefers-contrast: more) { .wrap .dock .sizer::after { opacity: 1; background: var(--ink); } }   /* acima do hover e do foco: sempre no máximo */
/* toque: alvos de 44 px sem mudar o desenho */
@media (pointer: coarse) {
  .phead .collapse::after { content: ""; position: absolute; inset: -9px -7px -5px; } .phead .count { min-height: 44px; border-block: 4px solid transparent; margin-block: -4px; background-clip: padding-box; } .phead .count:focus-visible { outline-offset: -2px; }   /* círculo de 30 px, alvo de 44 · cápsula: 36 de desenho, 44 de alvo */
  .tabs button[role="tab"], .seg2 button, .menu .mseg button { position: relative; }
  .tabs button[role="tab"]::after, .zonebar button::after, .seg2 button::after, .menu .mseg button::after { content: ""; position: absolute; inset: -8px 0; }   /* segmentado: 28 de desenho, 44 de alvo */
  .detail .close::after, .auto .run::after { content: ""; position: absolute; inset: -7px; } .step button::after { content: ""; position: absolute; inset: -6px -2px; } .mbtn::after { content: ""; position: absolute; inset: -6px -4px; }
  .swatches { gap: 12px; } .swatch { width: 32px; height: 32px; } .swatch::after { content: ""; position: absolute; inset: -6px; }
  .sw::before { content: ""; position: absolute; inset: -7px 0; }   /* interruptor: 31 de desenho, 45 de alvo */
  .detail input[type="range"], .menu .mhr input { height: 44px; } .menu .mhr button { min-height: 44px; }
  .rhead .rback, .rfoot .enter, .goto .grow button { min-height: 44px; } .rhead .rback { width: 44px; }
  .zone button { min-height: 44px; margin: -12px 0; } .blk .bn::after { inset: -13px -6px; }   /* nome do bloco: alvo de 44 px */
  .tile .more::after { inset: -10px; }
}
@media (max-width: 640px) {
  .detail .rng { flex-basis: 100%; }
  .hud.top { gap: 6px; }
}
@media (max-width: 340px) { .rhead .swl { display: none; } }   /* celular de 320: o nome do cômodo antes do rótulo "Tudo" */
/* cantos contínuos (Chrome/Edge ≥ 139), raio ~1,4×; só com o vidro: em aparelho fraco, recorte que não é retângulo arredondado pode virar máscara.
   Os botões são cápsulas (o HIG prefere) e ficam fora */
@supports (corner-shape: squircle) {
  .wrap.glass :is(.tile, .detail, .menu, .sel, .panel:not(.dock, .btn, .nav), .auto, .autos .empty, .feed, .zempty, .dock, .pane, .dshadow) { corner-shape: squircle; }
  .wrap.glass .tile, .wrap.glass .detail { border-radius: 26px; }
  .wrap.glass :is(.menu, .sel, .panel:not(.dock, .btn, .nav)) { border-radius: 20px; }
  .wrap.glass :is(.feed, .zempty, .autos .empty) { border-radius: 17px; }
  .wrap.glass .autos > :is(.auto:first-child, :not(.auto) + .auto) { border-radius: 17px 17px 0 0; }
  .wrap.glass .autos > :is(.auto:last-child, .auto:has(+ :not(.auto))) { border-bottom-left-radius: 17px; border-bottom-right-radius: 17px; }
  .wrap.glass .dock { border-radius: 40px; } .wrap.glass:not(.sheet) .pane { border-radius: 0 0 39px 39px; } .wrap.glass.sheet .dock { border-radius: 40px 40px 0 0; }   /* depois do .panel: a coluna não cai para 20 */
  .wrap.glass .detail input[type="range"]::-webkit-slider-runnable-track { corner-shape: squircle; border-radius: 17px; }
  @media (min-width: 641px) { .wrap.glass.sheet .dock, .wrap.glass.sheet .dock:not([hidden]) + .dshadow { border-radius: 40px; } }
}
@media (prefers-reduced-motion: reduce) { .pane.active, .tile, .tile .ico, .detail, .feed li, .auto, .sw, .seg2 button, .swatch, .menubtn, .menu .mi, .menu .mseg button, .rfoot .enter, .sel button { animation: none !important; transition: none !important; transform: none !important; }
  .sw::after, .btn { transition: none !important; }   /* sem o transform: none: o polegar ligado fica à direita e a pílula da folha, centrada */
  .dock, .dshadow, .reopen, .menu, .sel { animation: fadeIn .15s linear !important; }   /* sem deslize nem escala: fade curto (o .sel fica fora da lista de cima: a posição dele é translate) */
  .menu.out, .sel.out { animation: fadeOut .15s linear forwards !important; } }
@keyframes fadeIn { from { opacity: 0; } }
@keyframes fadeOut { to { opacity: 0; } }
/* menos transparência: o vidro volta a opaco */
@media (prefers-reduced-transparency: reduce) {
  .wrap.glass { --glass: var(--glass-solid); --mat-chrome: #1c1c1e; --mat-pop: #2c2c2e; --blur: none; --blur-s: none; --ink-2: rgba(235, 235, 245, .6); --ink-3: rgba(235, 235, 245, .6); }
  .joy { backdrop-filter: none; -webkit-backdrop-filter: none; }
}
/* mais contraste: fundo sólido, linhas e textos mais claros e um contorno definido (sem bordas no visual da v1.8) */
@media (prefers-contrast: more) {
  :host { --glass: #0e0e10; --glass-solid: #0e0e10; --raised: #1c1c1f; --fill: rgba(255, 255, 255, .1); --fill-2: rgba(255, 255, 255, .16); --fill-3: rgba(255, 255, 255, .28);
    --line: rgba(255, 255, 255, .55); --line-2: rgba(255, 255, 255, .8); --ink-2: #dcdce2; --ink-3: #c8c8d0; --on-bg: rgba(255, 181, 71, .24); --on-line: var(--on); --mat-chrome: var(--glass); --mat-pop: var(--raised); }
  .wrap.glass { --glass: #0e0e10; --mat-chrome: #0e0e10; --mat-pop: #1c1c1f; --ink-2: #dcdce2; --ink-3: #c8c8d0; --blur: none; --blur-s: none; }
  .panel, .dock, .reopen, .menu, .sel, .detail, .tile, .auto, .feed, .zempty { outline: 1px solid var(--line); outline-offset: -1px; }   /* o :focus-visible vence pela especificidade */
  .panel, .dock, .menu { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--glass); }
  .zonebar button, .tabs button[role="tab"], .seg2 button, .menu .mseg button { border: 1px solid transparent; }
  .zonebar button[aria-pressed="true"], .tabs button[aria-selected="true"], .seg2 button[aria-pressed="true"], .menu .mseg button[aria-pressed="true"] { border-color: var(--line-2); }
}
`;

class Igreja3DCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = Object.assign({}, DEFAULT_CONFIG);
    this._q = this._qualityFor(this._config.quality); this._lite = this._q === 'leve' || this._q === 'min'; this._min = this._q === 'min';
    this._nightVision = true;
    this._state = {};          // key -> { on, state, attrs }
    this._lastChanged = {};    // key -> ISO da última mudança (do HA)
    this._activity = [];       // histórico: { key, state, ts }
    this._autos = []; this._autoLast = {};   // automações do HA
    this._panelOpen = false;
    this._items = new Map();   // key -> runtime (lights, meshes, chip)
    this._built = false;
    this._raf = 0;
    this._lastSig = '';
    this._mode = 'auto';
    this._night = true;
    this._clock = new THREE.Clock(false);
    this._hoverObj = null; this._nav = { level: 0, block: null, room: null }; this._hoverZones = null; this._hoverKey = '';
    this._reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { this._sideUser = +window.localStorage.getItem('igreja3d.painel_w') || 0; } catch (_) { this._sideUser = 0; }   // largura escolhida do painel (0 = automática)
  }

  // ---- API Lovelace ----
  static getStubConfig() { return { title: 'Base Church' }; }
  getCardSize() { return 12; }
  getLayoutOptions() { return { grid_columns: 'full', grid_rows: 8, grid_min_rows: 5 }; }

  setConfig(config) {
    this._config = Object.assign({}, DEFAULT_CONFIG, config || {});
    if (!this._built) { this._q = this._qualityFor(this._config.quality); this._lite = this._q === 'leve' || this._q === 'min'; this._min = this._q === 'min'; }   // montada, a cena fica como está · no HA a posição real vem de hass.config
    this._mode = ['auto', 'day', 'night'].includes(this._config.mode) ? this._config.mode : 'auto';
    this._nightVision = this._config.night_vision !== false;
    if (this._config.height) this.style.setProperty('--igreja3d-height', String(this._config.height));
    if (this._built) {
      this._titleEl.textContent = this._config.title || 'Base Church';
      this._setLabels(!!this._config.labels);
      this._applyMode();
      this._lastSig = ''; if (this._hass) this._syncFromHass();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (this._built) this._syncFromHass();
  }
  get hass() { return this._hass; }

  entity(key) {
    const e = this._config.entities || {};
    return e[key] || DEFAULT_ENTITIES[key];
  }

  connectedCallback() {
    if (!this._built) this._build(); else this._timersOn();
    this._start();
  }
  // o HA desanexa/reanexa o cartão ao trocar de vista: os intervalos param e voltam junto
  disconnectedCallback() { this._stop(); this._timersOff(); if (this._walkOn) this._setWalk(false); this._menuSet(false); if (this._szStop) this._szStop(); }   // sai da Pessoa: solta o teclado da página; ajuste da largura no meio: a cena não fica parada
  _timersOn() {
    if (!this._feedTimer && this._built) this._feedTimer = setInterval(() => { if (this._panelOpen) this._renderPanel(); this._updateTime(true); }, 30000);
    if (!this._weatherTimer && this._weatherUI) { if (!(Date.now() - this._weatherOk < 10 * 60000)) this._fetchWeather(); this._weatherTimer = setInterval(() => this._fetchWeather(), 15 * 60000); }   // de volta à vista: clima em dia (a leitura de menos de 10 min serve)
    if (this._menuKeyH) { window.addEventListener('keydown', this._menuKeyH, true); window.addEventListener('pointerdown', this._menuOut, true); }   // fora da página o cartão não fica preso à janela
  }
  _timersOff() {
    clearInterval(this._feedTimer); clearInterval(this._weatherTimer); this._feedTimer = this._weatherTimer = 0;
    if (this._menuKeyH) { window.removeEventListener('keydown', this._menuKeyH, true); window.removeEventListener('pointerdown', this._menuOut, true); }
  }

  // ---- Construção do DOM ----
  _build() {
    const root = this.shadowRoot;
    root.innerHTML = '';
    const style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);
    const wrap = document.createElement('div'); wrap.className = 'wrap'; wrap.lang = 'pt-BR'; root.appendChild(wrap);   // o texto do cartão é pt-BR (hifenização e leitor de tela), em qualquer idioma do HA
    wrap.classList.toggle('sf', /Macintosh|iPhone|iPad|iPod/.test(navigator.userAgent));   // aparelho Apple: a pilha cai no SF, e o tracking do CSS é o dele
    wrap.classList.toggle('glass', this._q === 'alta' && Igreja3DCard._gpuInfo().glass);   // vidro (backdrop-filter) só no nível alta com GPU dedicada; o governador o tira antes de tudo
    const canvas = document.createElement('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Modelo 3D da igreja'); wrap.appendChild(canvas);
    this._canvas = canvas;
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && this._mk) { this._hoverDest = null; this._mkHide(); } });   // sai do quadro: some o anel do destino

    const top = document.createElement('div'); top.className = 'hud top'; wrap.appendChild(top); this._hudTop = top; this._wrap = wrap;
    // v1.8: o cartão do título saiu (pedido do dono). O topo é a trilha da Vista de cima à esquerda e UM botão (⋯) à direita, que abre a
    // lista suspensa (pull-down do iOS) por seções — Hora (e simular) · Clima · Andar · Ambiente · Vista · Painel. As referências (_modeBtns,
    // _nvBtn, _labelsBtn, _roofBtn, _topBtn, _walkBtn, _panelBtn) são as de antes e o estado continua em aria-pressed
    const btns = document.createElement('div'); btns.className = 'btns'; top.appendChild(btns); this._btnsEl = btns;
    const menu = document.createElement('div'); menu.className = 'menu'; menu.id = 'igreja3d-menu'; menu.hidden = true;
    menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Opções'); this._menu = menu;   // dialog: tem a hora, o clima e um slider, não só itens
    const sec = (title, label = title) => {
      const d = document.createElement('div'); d.className = 'msec'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', label);
      const h = document.createElement('div'); h.className = 'mh'; h.setAttribute('aria-hidden', 'true'); h.textContent = title; d.appendChild(h); menu.appendChild(d); return d;
    };
    // item (pull-down do iOS): marca de verificação à esquerda, nome (+ nota), ícone à direita; `toggle` = estado no aria-pressed
    const item = (parent, icon, label, { toggle = false, title = '', note = '' } = {}) => {
      const b = document.createElement('button'); b.className = 'mi';
      b.innerHTML = `<span class="mic">${iconSvg(icon)}</span><span class="ml"></span>`;
      const ml = b.querySelector('.ml'); ml.textContent = label; if (note) ml.insertAdjacentHTML('beforeend', `<small>${note}</small>`);
      if (title) b.title = title; if (toggle) b.setAttribute('aria-pressed', 'false');
      parent.appendChild(b); return b;
    };
    // Hora: o nome da igreja encabeça a lista; a hora agora (ou simulada), o período e o sol; arrastar simula o sol, "Ao vivo" volta ao relógio
    const sHr = sec(this._config.title || 'Base Church', 'Hora'); this._titleEl = sHr.firstChild; this._hrSec = sHr;
    sHr.insertAdjacentHTML('beforeend', '<div class="mtime"><b>--:--</b><small></small><small></small></div><div class="mhr"><input type="range" min="0" max="1439" step="5" aria-label="Hora do dia (arraste para simular o sol)"><button type="button" aria-pressed="true"><i aria-hidden="true"></i>Ao vivo</button></div>');
    [this._clockEl, this._clockSub, this._clockSun, this._hrRange, this._hrLive] = sHr.querySelectorAll('.mtime b, .mtime small, .mhr input, .mhr button');
    this._hrRange.addEventListener('input', () => this.setSimTime(Date.now() + (+this._hrRange.value - this._dayMin(Date.now())) * 60000));   // a hora do dia escolhida, hoje
    this._hrLive.addEventListener('click', () => this.setSimTime(null));
    const sNav = sec('Andar');
    // Pessoa = o bonequinho (v1.4.6): arraste até um ambiente da maquete/planta e solte para entrar ali; toque: anda daqui, na altura dos olhos
    this._walkBtn = this._pegBtn = item(sNav, 'person', 'Pessoa', { toggle: true, note: 'segure e arraste até um ambiente', title: 'Segure e arraste o bonequinho até um ambiente para andar por dentro dele · toque: anda daqui (setas/WASD ou joystick; arraste para olhar)' });
    this._pegBtn.classList.add('peg'); this._pegBind(this._pegBtn);
    this._walkBtn.addEventListener('click', () => { if (performance.now() - (this._pegT || 0) < 400) return; const on = !this._walkOn; this._setWalk(on); if (on) this._menuSet(false); });   // o clique que sobra do arrasto não conta
    const gotoMi = item(sNav, 'pin', 'Ir para…', { note: 'um ambiente, como Pessoa', title: 'Vai direto a um ambiente na visão de Pessoa (inclui a salinha do mezanino)' });
    gotoMi.addEventListener('click', () => { this._menuSet(false); this._toggleGoto(true); });
    const sAmb = sec('Ambiente');
    const seg = document.createElement('div'); seg.className = 'mseg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Iluminação ambiente');
    this._modeBtns = {};
    for (const [m, lbl] of [['auto', 'Auto'], ['day', 'Dia'], ['night', 'Noite']]) {
      const b = document.createElement('button'); b.textContent = lbl; b.dataset.mode = m;
      b.addEventListener('click', () => { this._mode = m; this._applyMode(); });
      seg.appendChild(b); this._modeBtns[m] = b;
    }
    sAmb.appendChild(seg);
    this._nvBtn = item(sAmb, 'moon', 'Visão noturna', { toggle: true, title: 'À noite, deixa a igreja inteira visível (luz de lua)' });
    this._nvBtn.addEventListener('click', () => { this._nightVision = !this._nightVision; this._applyMode(); });
    const sVis = sec('Vista');
    this._labelsBtn = item(sVis, 'tag', 'Rótulos', { toggle: true, title: 'Nomes dos ambientes sobre a maquete' });
    this._labelsBtn.addEventListener('click', () => this._setLabels(!this._labelsOn));
    this._roofBtn = item(sVis, 'church', 'Fachada', { toggle: true, title: 'Mostra a fachada, paredes altas e cobertura' });
    this._roofBtn.addEventListener('click', () => this._setRoof(!this._roofOn));
    this._topBtn = item(sVis, 'plan', 'Vista de cima', { toggle: true, title: 'Planta vista de cima, sem cobertura: confira luzes, ares e automações de todos os cômodos' });
    this._topBtn.addEventListener('click', () => { this._airFocus = this._airTour = null; this._setTopView(!this._topView); });
    const reset = item(sVis, 'recenter', 'Recentrar', { title: 'Volta à vista inicial (Vista de cima, de frente para o palco)' });
    reset.addEventListener('click', () => { this._airFocus = this._airTour = null; if (this._topView) this._navTo(0); else this._setTopView(true); this._menuSet(false); });   // v1.6.1: volta à vista inicial (Vista de cima, nível 0)
    const sPan = sec('Painel');
    this._panelBtn = item(sPan, 'side', 'Painel', { toggle: true, title: 'Ambientes, automações e atividade (coluna à esquerda; no celular e no tablet em pé, folha embaixo)' });
    this._panelBtn.addEventListener('click', () => this._setPanel(!this._panelOpen));

    this._menuBtn = document.createElement('button'); this._menuBtn.className = 'panel btn menubtn'; this._menuBtn.innerHTML = iconSvg('more');
    this._menuBtn.setAttribute('aria-haspopup', 'dialog'); this._menuBtn.setAttribute('aria-expanded', 'false'); this._menuBtn.setAttribute('aria-controls', menu.id); this._menuBtn.setAttribute('aria-label', 'Opções');
    this._menuBtn.title = 'Hora e clima, Pessoa e as opções (ambiente, vista, painel)';
    this._menuBtn.addEventListener('click', (e) => this._menuSet(!this._menuOn, e.detail === 0));   // detail 0 = Enter/Espaço: o foco vai para o 1º item
    this._menuBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this._menuSet(true); this._menuFocus(e.key === 'ArrowDown' ? 0 : -1); } });
    btns.append(this._menuBtn, menu);
    // teclado e clique fora com o menu aberto: escutados na janela, em captura (antes do Walker e da trilha da Vista de cima); presos à conexão (_timersOn)
    this._menuKeyH = (e) => this._menuKey(e);
    this._menuOut = (e) => { if (!this._menuOn) return; const path = e.composedPath(); if (!path.includes(menu) && !path.includes(this._menuBtn)) this._menuSet(false); };
    const out = (e) => { const t = e.relatedTarget; if (this._menuOn && t && !menu.contains(t) && t !== this._menuBtn) this._menuSet(false); };
    menu.addEventListener('focusout', out); this._menuBtn.addEventListener('focusout', out);   // Tab saiu da lista (ou Shift+Tab do ⋯, aberta pelo clique): ela fecha
    const PERSON = iconSvg('person');
    this._pegGhost = document.createElement('div'); this._pegGhost.className = 'pegghost'; this._pegGhost.innerHTML = PERSON; this._pegGhost.hidden = true; wrap.appendChild(this._pegGhost);
    this._pegTip = document.createElement('div'); this._pegTip.className = 'panel pegtip'; this._pegTip.hidden = true; wrap.appendChild(this._pegTip);
    this._gotoPanel = document.createElement('div'); this._gotoPanel.className = 'panel goto'; this._gotoPanel.hidden = true; this._gotoPanel.setAttribute('role', 'dialog'); this._gotoPanel.setAttribute('aria-label', 'Ir para um ambiente'); wrap.appendChild(this._gotoPanel);
    this._fadeEl = document.createElement('div'); this._fadeEl.className = 'fade'; wrap.appendChild(this._fadeEl);
    const joy = document.createElement('div'); joy.className = 'joy'; joy.hidden = true; joy.setAttribute('role', 'application'); joy.setAttribute('aria-label', 'Andar');
    const knob = document.createElement('div'); knob.className = 'knob'; joy.appendChild(knob); wrap.appendChild(joy); this._joy = joy;
    this._walkHint = document.createElement('div'); this._walkHint.className = 'panel walkhint'; wrap.appendChild(this._walkHint);
    // balão do aparelho selecionado na maquete (v1.6.1)
    this._selEl = document.createElement('div'); this._selEl.className = 'panel sel'; this._selEl.hidden = true; this._selEl.setAttribute('role', 'group'); this._selEl.setAttribute('aria-label', 'Selecionado');
    this._selEl.innerHTML = '<span><b></b><small aria-live="polite"></small></span><button type="button"></button>'; wrap.appendChild(this._selEl);
    [this._selName, this._selState, this._selBtn] = this._selEl.querySelectorAll('b, small, button'); this._selBtn.addEventListener('click', () => this._selAct());

    // a dica do modo Pessoa some na primeira interação (não por tempo)
    const used = () => { if (this._walkOn && this._walkHint.classList.contains('show') && performance.now() - (this._walkHintAt || 0) > 400) this._walkHint.classList.remove('show'); };
    wrap.addEventListener('pointerdown', used, true); canvas.addEventListener('wheel', used, { passive: true }); canvas.addEventListener('keydown', used);
    // dica do bonequinho no primeiro acesso: aponta para o ⋯ e só some quando ele é usado ou a dica é fechada (lembrada neste navegador)
    let seen = '1'; try { seen = window.localStorage.getItem('igreja3d.dica_pessoa'); } catch { /* sem armazenamento: não insiste */ }
    if (!seen) {
      const d = document.createElement('div'); d.className = 'panel pegdica'; d.setAttribute('role', 'note');
      d.innerHTML = '<span>Para andar por dentro, abra ⋯, segure o bonequinho e arraste até um ambiente</span><button type="button" aria-label="Fechar a dica">×</button>';
      wrap.appendChild(d); this._pegDica = d; d.querySelector('button').addEventListener('click', () => this._dicaOff());
      this._pegBtn.addEventListener('pointerdown', () => this._dicaOff()); this._pegBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this._dicaOff(); });
    }

    // trilha da Vista de cima (Planta › Bloco › Cômodo): à esquerda no topo, ao lado do ⋯; escondida fora da Vista de cima
    const navrow = document.createElement('div'); navrow.className = 'navrow'; navrow.hidden = true;
    const nav = document.createElement('div'); nav.className = 'panel nav';
    const back = document.createElement('button'); back.className = 'back'; back.innerHTML = `${iconSvg('chevl')}Voltar`; back.setAttribute('aria-label', 'Voltar um nível');
    back.addEventListener('click', () => this._navBack());
    const crumbs = document.createElement('nav'); crumbs.className = 'crumbs'; crumbs.setAttribute('aria-label', 'Trilha da planta');
    nav.append(back, crumbs); navrow.appendChild(nav); top.prepend(navrow);
    this._navRow = navrow; this._navCrumbs = crumbs;
    // Esc/Backspace na Vista de cima sobem um nível; fora dela o Esc volta o painel do cômodo à visão geral (com o menu aberto, o Esc só fecha ele)
    const navKey = (e) => {
      if (this._menuOn || (e.key !== 'Escape' && !(e.key === 'Backspace' && this._topView))) return;
      if (this._topView) this._navBack(); else if (this._room) this._showRoom(null); else return;
      e.preventDefault();
    };
    canvas.addEventListener('keydown', navKey); nav.addEventListener('keydown', navKey);

    try {
      this._build3D(canvas);
    } catch (err) {
      const e = document.createElement('div'); e.className = 'err';
      e.textContent = 'Não foi possível iniciar o WebGL: ' + (err && err.message || err);
      wrap.appendChild(e);
      console.error('[igreja3d-card]', err);
      return;
    }

    this._buildPanel(wrap); this._dock.addEventListener('keydown', navKey);
    if (this._ro) this._ro.observe(this._dock);
    this._built = true;
    this._timersOn();
    this._setLabels(!!this._config.labels);
    this._applyMode();
    this._setRoof(!!(this._config.fachada != null ? this._config.fachada : this._config.roof));   // `fachada:` (ou `roof:`, como no casa3d)
    if (this._hass) this._syncFromHass();
    else this._applyDemoDefaults();
    this._setPanel(this._config.panel !== false, 'peek');   // depois dos estados ("Ligados" se houver algo ligado); folha: abre na espiada, no lugar da pílula
    // v1.6.1: abre na Vista de cima (nível 0, de frente para o palco) — com a Fachada ligada no YAML fica a maquete de sempre; o painel fica como `panel:` pedir
    if (!this._roofOn) { this._setTopView(true, true); this._resize(); const o = this._orbit; o.sph.copy(o.goal); o.target.copy(o.targetGoal); }
  }

  // Entorno ligado: gramado texturizado. Desligado: chão de cor chapada (MeshBasic, quase de graça na GPU) que acompanha dia/noite
  // em _frame. v1.8: as ruas, calçadas públicas, árvores, postes e vizinhos saíram (pedido do dono) — fica só o lote e o estacionamento
  _setEntorno(on) {
    this._entornoOn = on;
    const g = this._ground; if (!g) return;
    if (!this._groundStd) { this._groundStd = g.material; this._groundFlat = new THREE.MeshBasicMaterial({ color: 0x6d705e }); }
    g.material = on ? this._groundStd : this._groundFlat; g.receiveShadow = on;
    if (this._renderer) this._renderer.shadowMap.needsUpdate = true;
    if (this._orbit) this._orbit.dirty = true;
  }
  // quality: 'alta' | 'media' | 'leve' | 'min' | 'auto' (padrão): min em aparelho muito fraco (renderizador por software, ≤ 2 GB de RAM, ou ≤ 2 núcleos com ≤ 4 GB);
  // leve em celular/tablet (toque + tela < 900 px) ou com ≤ 4 GB; no PC, alta com GPU dedicada e media com vídeo integrado (Intel, AMD APU) ou desconhecido
  static _gpuInfo() {
    if (Igreja3DCard.__gpu !== undefined) return Igreja3DCard.__gpu;
    let strong = false, soft = false, glass = false;
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
        strong = /nvidia|geforce|quadro|rtx|gtx|radeon\s*(rx|pro)|apple m\d|apple gpu/i.test(name) && !/intel|swiftshader|llvmpipe|mali|adreno|powervr/i.test(name);
        soft = /swiftshader|llvmpipe|softpipe|mesa offscreen|basic render/i.test(name);   // desenho por software (sem GPU)
        glass = strong && !/apple gpu/i.test(name);   // "Apple GPU" é o nome mascarado do WebKit (até Mac Intel e iPad): forte para a cena, mas sem vidro
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      }
    } catch (_) { strong = soft = glass = false; }
    return (Igreja3DCard.__gpu = { strong, soft, glass });
  }
  static _strongGPU() { return Igreja3DCard._gpuInfo().strong; }
  _qualityFor(q) {
    if (['alta', 'media', 'leve', 'min'].includes(q)) return q;
    try {
      if (Igreja3DCard._gpuInfo().soft || (navigator.deviceMemory || 8) <= 2 || ((navigator.hardwareConcurrency || 8) <= 2 && (navigator.deviceMemory || 8) <= 4)) return 'min';   // só núcleos não basta: navegadores com anti-fingerprint dizem 2
      const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      const small = !!window.screen && Math.min(window.screen.width, window.screen.height) < 900;
      if ((coarse && small) || (navigator.deviceMemory || 8) <= 4) return 'leve';
      // desktop/notebook: 'alta' só com GPU dedicada; integrada (Intel, AMD Vega/APU etc.) ou desconhecida → media
      return Igreja3DCard._strongGPU() ? 'alta' : 'media';
    } catch (_) { return 'leve'; }
  }

  // ---- Cena 3D ----
  _build3D(canvas) {
    const M = materials();
    // MSAA (bordas lisas) em toda GPU de verdade — nas móveis (tile-based) quase de graça; só fica sem no desenho por software
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Igreja3DCard._gpuInfo().soft, powerPreference: 'high-performance' });
    // Neutral (r162+): preto da "Igreja Preta" fica preto, roxo do palco e telão saturados, branco estoura menos que no ACES
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    // Salvaguarda de GPU: 26 PointLights + 9 sombras usam ~250 vec4 de uniforms e 13 samplers por programa PBR;
    // o mínimo do WebGL2 é 224 vetores de fragment. Em GPU apertada (ou no leve) corta luzes fracas e sombras.
    const caps = renderer.capabilities;
    this._tight = caps.maxFragmentUniforms < 512 || caps.maxTextures < 16;
    if (this._tight) console.warn(`[igreja3d-card] GPU com margem pequena (fragment uniforms ${caps.maxFragmentUniforms}, samplers ${caps.maxTextures}): luzes fracas viram só halo e sombras só nas principais`);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this._q === 'alta' || this._q === 'media' ? THREE.PCFSoftShadowMap : this._min ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;   // cena estática: sombras só recalculam quando algo muda
    this._renderer = renderer;

    const scene = new THREE.Scene();
    this._scene = scene;
    renderer.setClearColor(0x0a0f1e, 1);
    scene.fog = new THREE.Fog(0x0a0f1e, 70, 240);
    this._buildSky(scene, renderer);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 400);
    this._camera = camera;
    this._home = this._homeFor(1.6);
    camera.position.copy(this._home.pos); camera.lookAt(this._home.target);
    this._orbit = new Orbit(camera, canvas, this._home.target);
    this._orbit.onClick = (e) => this._onClick(e);
    this._orbit.onHover = (e) => this._onHover(e);

    // Luz ambiente (dia/noite). Um único direcional faz de sol (dia) e de lua (noite).
    const C = new THREE.Vector3(LOT.cx, 0, LOT.cz);   // centro do lote
    this._hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a8070, 1.6); scene.add(this._hemi);
    this._amb = new THREE.AmbientLight(0x4a5a80, 0.25); scene.add(this._amb);
    this._sun = new THREE.DirectionalLight(0xfff0d2, 3.2);
    this._sunDist = 60;
    this._sunPos = new THREE.Vector3(-0.42, 1, 0.55).normalize();   // direção do sol no modo "Dia" (ilumina a fachada)
    this._moonPos = C.clone().addScaledVector(new THREE.Vector3(11, 20, -9).normalize(), this._sunDist);
    this._sunCol = new THREE.Color(0xfff0d2); this._moonCol = new THREE.Color(0x8fa6d8);
    this._sun.position.copy(C).addScaledVector(this._sunPos, this._sunDist); this._sun.target.position.copy(C);
    this._sun.castShadow = !this._min;   // min: nenhuma sombra (sem amostrador nem PCF nos shaders)
    this._sun.shadow.mapSize.set(this._lite ? 1024 : 2048, this._lite ? 1024 : 2048);   // desenhada só quando o sol anda
    // cobre x −4…24 · z −4…62 (meia-diagonal ≈ 36 m) em qualquer direção do sol
    const sc = this._sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 125;
    this._sun.shadow.bias = -0.0006; this._sun.shadow.normalBias = 0.04;
    scene.add(this._sun); scene.add(this._sun.target);

    // Terreno (grama) — grande, sem recortes
    const GS = 800;   // passa do domo do céu: o horizonte some na neblina
    const gmap = textures().grassDry.clone(); gmap.repeat.set(GS / 2.2, GS / 2.2);
    // media: Lambert sem relevo e sem o laço das lâmpadas (o gramado de 800 m pesava ~30 % do quadro); recebe a sombra do sol
    const gmat = this._q === 'media' ? patchNoPoint(new THREE.MeshLambertMaterial({ color: 0xd8d6c8, map: gmap })) : M.ground.clone();
    if (this._q !== 'media') { gmat.color.setHex(0xd8d6c8); gmat.map = gmap; }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GS, GS), gmat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(LOT.cx, -0.03, LOT.cz); ground.receiveShadow = true;   // 3 cm abaixo dos pisos (y 0,004): sem z-fighting grama × piso em vista rasante
    // desenhado depois dos opacos: o teste de profundidade descarta o gramado sob os pisos (antes ele era sombreado e coberto)
    ground.renderOrder = 1; ground.userData.noMerge = true; scene.add(ground); this._ground = ground;

    this._clickables = []; this._labels = []; this._zoneMeshes = {};
    // Pisos (zonas): um plano por retângulo; textura alinhada ao mundo (sem emenda entre retângulos)
    const TX = textures();
    // laminado com leve brilho; porcelanato bege acetinado (WCs); porcelanato cinza POLIDO no templo (reflete luzes e ambiente)
    const ROUGH = { tileGray: 0.5, tileLight: 0.6, tileCool: 0.45, wood: 0.72, herring: 0.95, paversGray: 0.95, paversDark: 0.9, laminate: 0.44, porcelainBeige: 0.3, porcelainGray: 0.13 };
    const BUMP = { tileGray: 0.3, laminate: 0.25, porcelainBeige: 0.15, porcelainGray: 0.08 }, ENVI = { porcelainGray: 0.6, porcelainBeige: 0.8, laminate: 0.8 };
    for (const [id, z] of Object.entries(ZONES)) {
      const tk = z.floor || 'concrete', tile = z.tile || 3, list = this._zoneMeshes[id] = [];
      for (const [x, zz, w, d, edges = 'nsew'] of z.rects) {
        const map = TX[tk].clone(); map.repeat.set(w / tile, d / tile); map.offset.set(x / tile, -(zz + d) / tile);
        const tint = ['grass', 'concrete'].includes(tk) ? 0xdedede : 0xffffff;
        const mat = new THREE.MeshStandardMaterial({ color: tint, map, roughness: ROUGH[tk] || 0.9, bumpMap: this._min ? null : map, bumpScale: BUMP[tk] != null ? BUMP[tk] : 0.6,
          aoMap: edges && !this._min ? this._makeAO(w, d, edges) : null, aoMapIntensity: 1.0, envMapIntensity: ENVI[tk] != null ? ENVI[tk] : 1 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
        m.rotation.x = -Math.PI / 2; m.position.set(x + w / 2, 0.004, zz + d / 2); m.receiveShadow = true;   // pisos a 4 mm: tapetes (≥ 5 mm) ficam por cima sem z-fighting
        m.userData = { item: z.item || null, zone: id }; scene.add(m); list.push(m);
        if (z.item) this._clickables.push(m);
      }
      if (z.label) {
        const s = this._makeLabel(z.label, z.ls || 1, !!z.main); s.userData.label.zone = id; s.position.set(z.lp[0], z.ly != null ? z.ly : H + 0.6 + (id === 'templo' ? 1.2 : 0), z.lp[1]);
        scene.add(s); this._labels.push(s);
      }
    }
    this._buildWalls(scene, M);
    // a borda da escada do lado do hall (vidro + massa) é uma parede para quem anda no térreo; só se entra por ela pela base, no lado leste
    if (!STAIR.off) this._walls.push({ axis: 'x', c: STAIR.Z0, a0: MEZZ.x1, a1: STAIR.XE + STAIR.GO, t: 0.06, h: 1.0 });
    // escada em U do hall (x 13,62–15,94): lances e patamar intermediário são obstáculo; a passagem sob o patamar de cima (z 44,2–46,2) fica livre
    else this._walls.push({ axis: 'z', c: 14.78, a0: 46.24, a1: 49.54, t: 2.32, h: 1.5 });
    // Rodapés nas zonas internas (só nas bordas que encostam em parede)
    // madeira no laminado (~7 cm), porcelanato cinza no templo, branco no resto
    // afastamento do eixo = meia parede + 2 cm; no bloco dos fundos (z < 11) meia parede fina, e na divisa (x 0 / 20,1, z 0)
    // a face interna fica no próprio eixo da planta
    for (const z of Object.values(ZONES)) {
      if (!z.inside) continue;
      const bm = z.floor === 'laminate' ? M.baseboardWood : z.floor === 'porcelainGray' ? M.baseboardGray : M.baseboard, hb = bm === M.baseboard ? 0.09 : 0.07;
      for (const [x, zz, w, d, edges = 'nsew'] of z.rects) {
        const back = zz + d < 11.01, io = (c) => (!back ? T / 2 : c < 0.01 || c > 20.09 ? 0 : TF / 2) + 0.02;
        const iw = io(x), ie = io(x + w), inn = io(zz), is = io(zz + d);
        if (edges.includes('n')) scene.add(box(w - iw - ie, hb, 0.02, bm, x + (w + iw - ie) / 2, hb / 2, zz + inn, { cast: false }));
        if (edges.includes('s')) scene.add(box(w - iw - ie, hb, 0.02, bm, x + (w + iw - ie) / 2, hb / 2, zz + d - is, { cast: false }));
        if (edges.includes('w')) scene.add(box(0.02, hb, d - inn - is, bm, x + iw, hb / 2, zz + (d + inn - is) / 2, { cast: false }));
        if (edges.includes('e')) scene.add(box(0.02, hb, d - inn - is, bm, x + w - ie, hb / 2, zz + (d + inn - is) / 2, { cast: false }));
      }
    }

    for (const o of scene.children) o.userData.arch = true;   // arquitetura pronta (pisos, paredes, rodapés…): não conta como obstáculo das portas
    // Grupo externo (modo Fachada): paredes altas, platibandas, telhados e revestimento da
    // fachada — preenchido pela decoração roomFachada via ctx.addExt; só aparece com o botão.
    this._ext = new THREE.Group(); this._ext.name = 'fachada'; this._ext.userData.keep = true; this._ext.visible = false; scene.add(this._ext);
    for (const m of this._wallHi || []) this._ext.add(m);   // paredes do bloco dos fundos de HB até H: só no modo Fachada (v1.8)
    // Mezanino (v1.4.6): laje, guarda-corpo, paredes altas e mobília da "salinha" sobre os WCs e o canto do hall; some na Vista de cima
    this._mezz = new THREE.Group(); this._mezz.name = 'mezanino'; this._mezz.userData.keep = true; scene.add(this._mezz);

    this._nLights = 0; this._nShadows = 0;
    this._buildFurniture(scene, M);
    this._snapThin(scene);
    this._buildFixtures(scene, M);
    this._buildPools(scene);
    mergeItems(scene, this._clickables, this._items); mergeItems(this._ext, this._clickables, this._items);
    this._buildDoors(scene);   // folhas das portas viram instâncias animáveis (antes do merge estático)

    const stats = mergeStatic(scene, true);
    const extStats = mergeStatic(this._ext, true);
    mergeStatic(this._mezz, true);
    if (this._q === 'media') this._midMaterials(scene);
    this._setEntorno(this._config.entorno === 'auto' || this._config.entorno == null ? !this._lite : !!this._config.entorno);
    console.info(`[igreja3d-card] malhas estáticas: ${stats.before} → ${stats.after} draw calls · fachada: ${extStats.before} → ${extStats.after} · luzes reais: ${this._nLights} (${this._nShadows} com sombra) · qualidade: ${this._q}`);

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._ro = new ResizeObserver(() => this._sizing || this._resize());   // ajustando a largura do painel: nada de _layoutHud/câmera por quadro
    // fora da tela (rolado para longe no dashboard) não gasta GPU com a animação ociosa
    try { this._io = new window.IntersectionObserver((es) => { this._onScreen = es.some((e) => e.isIntersecting); }); this._io.observe(this); } catch (_) {}
    this._ro.observe(this);
    if (this._dock) this._ro.observe(this._dock);
    if (this._hudTop) this._ro.observe(this._hudTop);
    this._resize();
    renderer.shadowMap.needsUpdate = true;
    this._buildBlocks();
    this._precompile();
  }
  // Compila os shaders antes do primeiro quadro — em paralelo quando o navegador deixa (KHR_parallel_shader_compile),
  // sem travar a página na carga — com a fachada visível, para os botões não engasgarem depois.
  // Enquanto isso _frame não desenha.
  _precompile() {
    const r = this._renderer, hide = [this._ext, this._hl, this._mk].filter((g) => g && !g.visible);
    this._busy = true;
    let p;
    try {
      hide.forEach((g) => { g.visible = true; });
      if (r.extensions.has('KHR_parallel_shader_compile')) p = r.compileAsync(this._scene, this._camera);
      else { r.compile(this._scene, this._camera); p = Promise.resolve(); }
    } catch (e) { p = Promise.resolve(); }
    hide.forEach((g) => { g.visible = false; });
    p.catch(() => {}).then(() => { this._busy = false; if (this._orbit) this._orbit.dirty = true; });
  }

  // media: o environment map fica só nos materiais brilhantes — vidro, metal, porcelanato polido —, só com o reflexo (a sonda faz a luz difusa)
  _midMaterials(scene) {
    const env = new Set();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && !m.envMap && (m.metalness >= 0.5 || m.roughness <= 0.3 || (m.transparent && m.opacity < 0.5))) env.add(m);
    });
    for (const m of env) patchEnvSpec(m);
    this._envMats = [...env];
  }

  // v1.8: as divisórias dos fundos afinaram (7,5 → 5 cm) e a decoração foi medida nas faces antigas: o que está junto de uma face
  // antiga (até 15 cm dela, sem atravessar a parede: painel, ripas, logo e halo em camadas andam juntos) acompanha a face nova.
  // Só o que fica de frente para a parede: o que passa da ponta dela (o paredão da marca além da x = 4,9) fica onde está, e um móvel inteiro
  // (Group) comprido para longe dela é da parede do lado (a estante do muro x = 20,1). Peças soltas seguem as vizinhas (a bancada em L da cozinha)
  _snapThin(scene) {
    const f0 = 0.0375, d = f0 - TF / 2, bb = new THREE.Box3();
    for (const o of scene.children) {
      if (o.userData.arch || o === this._ext || o === this._mezz) continue;
      bb.setFromObject(o); if (bb.isEmpty()) continue;
      for (const w of this._thin || []) {
        const n = w.axis === 'x' ? 'z' : 'x', u = w.axis === 'x' ? 'x' : 'z';   // n = normal da parede · u = ao longo dela
        if (bb.max[u] <= w.a0 + 0.01 || bb.min[u] >= w.a1 - 0.01) continue;   // além da ponta: não é desta parede
        if (o.isGroup && bb.max[n] - bb.min[n] > Math.max(1, 2 * (bb.max[u] - bb.min[u]))) continue;   // móvel comprido para longe dela: é da parede do lado
        if (bb.min[n] >= w.c + f0 - 0.02 && bb.min[n] <= w.c + f0 + 0.15) o.position[n] -= d;
        else if (bb.max[n] <= w.c - f0 + 0.02 && bb.max[n] >= w.c - f0 - 0.15) o.position[n] += d;
      }
    }
  }

  // Luminárias + luzes de cada item (PointLight só onde não é `glowOnly`)
  _buildFixtures(scene, M) {
    const TXg = textures().glow;
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6, side: THREE.DoubleSide });
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide });
    const linMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.45, metalness: 0.4 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.6, metalness: 0.3 });
    const linRails = {};
    const up = new THREE.Vector3(0, 1, 0);
    const MOVE_DIR = new THREE.Vector3(1, -1.25, 0).normalize();   // moving heads da parede do palco: para +x e para baixo
    const mid = this._q === 'media';
    // material do feixe: aditivo, mais forte no eixo (N·V) e sumindo para baixo (uv.y); uma instância por refletor
    const beamMat = () => new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color() }, uI: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uC; uniform float uI; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float fade = pow(vY, 1.8); gl_FragColor = vec4(uC * uI * edge * fade, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const it of ITEMS) {
      const rt = this._items.get(it.key) || {}; this._items.set(it.key, rt);
      rt.lights = rt.lights || []; rt.fixtures = rt.fixtures || []; rt.target = 0; rt.level = 0; rt.color = new THREE.Color(it.color || 0xffffff); rt.cbase = rt.color.clone(); rt.cshow = rt.color.clone();
      if (!it.fixtures) continue;
      // quality leve (tablet/celular): poucas luzes reais — cada item principal fica com LITE_LIGHTS[key] delas,
      // mais fortes e com alcance maior para compensar; as demais viram só halo + emissivo (visual quase igual)
      // lâmpadas de sala que eram só enfeite (WCs, depósito, circulação…): no alta viram luz real fraca e no media entram como
      // candidatas do conjunto fixo (a quantidade de luzes não muda) — antes essas salas ficavam sem luz nenhuma à noite
      const FX = it.fixtures.map((f) => f.glowOnly && !f.ext && !f.sconce && !f.highbay && !this._lite && !this._tight && !['palco', 'plateia', 'fachada', 'estacionamento'].includes(it.key)
        ? Object.assign({}, f, { glowOnly: false, i: 16, d: 5 }) : f);
      const realIdx = FX.map((f, k) => (f.glowOnly || (this._tight && f.i <= 22)) ? -1 : k).filter((k) => k >= 0);
      // media: nenhuma luz fixa — as luminárias reais viram candidatas (rt.cands) do conjunto fixo (_assignPool)
      const liteMax = this._min ? (MIN_LIGHTS[it.key] || 0) : this._lite ? (LITE_LIGHTS[it.key] || 0) : mid ? 0 : realIdx.length;
      const step = liteMax > 0 ? realIdx.length / liteMax : Infinity;
      const keep = new Set(liteMax >= realIdx.length ? realIdx : Array.from({ length: liteMax }, (_, n) => realIdx[Math.floor(n * step + step / 2 - 0.5)]));
      const boost = keep.size ? realIdx.length / keep.size : 1;
      for (const [fk, f] of FX.entries()) {
        const [px, py, pz] = f.p;
        const holder = f.ext ? this._ext : scene;
        // GPU apertada (uniforms/samplers no limite): as luzes fracas das salas viram só halo + emissivo
        const glowOnly = !keep.has(fk);
        const lp = f.l ? new THREE.Vector3(...f.l) : new THREE.Vector3(px, f.highbay ? py - 0.25 : f.linear ? py - 0.1 : py, pz);   // l: luz longe da lente (refletor da fachada)
        // moving head: a luz sai 1,2 m à frente da lente (ilumina o palco, não a parede atrás da treliça)
        if (f.moving) lp.addScaledVector(MOVE_DIR, 1.2);
        if (mid && realIdx.includes(fk)) (rt.cands = rt.cands || []).push({ p: lp, i: f.i, d: f.d, shadow: !!f.shadow && (!this._tight || !!f.liteShadow) });
        if (!glowOnly) {
          const L = new THREE.PointLight(rt.color, 0, this._lite ? f.d * Math.min(1.35, Math.sqrt(boost)) : f.d, 2);
          L.position.copy(lp);
          if (f.shadow && !this._lite && (!this._tight || f.liteShadow)) {
            // 256 (leve: 192): com o PCF de 9 amostras fica igual a 512 e ocupa 1/4 da memória (4 MB por luz em vez de 16)
            const ms = this._lite ? 192 : 256;
            L.castShadow = true; L.shadow.mapSize.set(ms, ms); L.shadow.radius = 2;
            L.shadow.bias = -0.004; L.shadow.normalBias = 0.03;
            L.shadow.camera.near = 0.15; L.shadow.camera.far = f.d + 1;
            // a geometria é estática: a sombra da luz é desenhada uma vez só (a do sol continua seguindo o sol);
            // _refreshPointShadows() pede de novo quando algo muda (porta do hall, modo Fachada)
            L.shadow.autoUpdate = false; L.shadow.needsUpdate = true;
            this._nShadows++;
          }
          scene.add(L); rt.lights.push({ L, i: this._lite ? f.i * boost : f.i }); this._nLights++;
        }
        if (f.hidden) continue;   // só a luz (a peça visível é da decoração)
        // uma lente emissiva por entidade (todas acendem juntas) → depois vira uma malha só
        const emis = () => rt.emisMat || (rt.emisMat = new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: rt.color, emissiveIntensity: 0, roughness: 0.4 }));
        let mesh, gs = 1.5, gb = 0.8;
        if (f.spot) {
          // refletor: lata preta curta com lente, presa por uma forquilha
          const dir = (f.aim === 'wall' ? new THREE.Vector3(0, -1, -0.2) : f.aim === 'out' ? new THREE.Vector3(0, -0.5, 1) : new THREE.Vector3(0, -0.85, -0.5)).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
          const can = cyl(0.11, 0.13, 0.28, M.dark, px, py, pz, 16); can.quaternion.copy(q); can.castShadow = false; holder.add(can);
          const back = cyl(0.07, 0.07, 0.06, M.graphite, 0, 0, 0, 12); back.quaternion.copy(q); back.position.set(px, py, pz).addScaledVector(dir, -0.16); back.castShadow = false; holder.add(back);
          holder.add(box(0.03, 0.26, 0.03, M.dark, px - 0.16, py + 0.06, pz, { cast: false }));
          holder.add(box(0.03, 0.26, 0.03, M.dark, px + 0.16, py + 0.06, pz, { cast: false }));
          holder.add(box(0.35, 0.03, 0.04, M.dark, px, py + 0.19, pz, { cast: false }));
          holder.add(cyl(0.012, 0.012, f.aim ? 0.12 : 0.4, M.dark, px, py + (f.aim ? 0.26 : 0.39), pz, 6));
          // refletor de fachada: braço curto até a parede (abaixo do topo da platibanda)
          if (f.aim === 'wall') holder.add(box(0.05, 0.05, 0.66, M.dark, px, py + 0.33, pz - 0.3, { cast: false }));
          else if (f.aim === 'out') holder.add(box(0.05, 0.05, 0.3, M.dark, px, py + 0.33, pz - 0.15, { cast: false }));   // braço até a parede da fachada
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.02, 18), emis());
          mesh.quaternion.copy(q); mesh.position.set(px, py, pz).addScaledVector(dir, 0.145);
          gs = 1.3; gb = 0.85;
        } else if (f.moving) {
          // moving head (como na foto): base presa à treliça (grampo até y + 0,25), garfo e cabeça cilíndrica mirando MOVE_DIR
          const dir = MOVE_DIR, q = new THREE.Quaternion().setFromUnitVectors(up, dir);
          holder.add(box(0.3, 0.1, 0.3, M.dark, px, py + 0.17, pz, { cast: false }));
          holder.add(box(0.06, 0.06, 0.06, M.graphite, px, py + 0.25, pz, { cast: false }));
          for (const s2 of [-1, 1]) holder.add(box(0.26, 0.2, 0.03, M.dark, px, py + 0.03, pz + s2 * 0.14, { cast: false }));   // braços do garfo
          const head = cyl(0.11, 0.1, 0.3, M.dark, px, py, pz, 18); head.quaternion.copy(q); head.castShadow = false; holder.add(head);
          const bez = cyl(0.115, 0.115, 0.03, M.graphite, 0, 0, 0, 18); bez.quaternion.copy(q); bez.position.set(px, py, pz).addScaledVector(dir, 0.15); bez.castShadow = false; holder.add(bez);
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 18), emis());
          mesh.quaternion.copy(q); mesh.position.set(px, py, pz).addScaledVector(dir, 0.165);
          gs = 1.1; gb = 0.85;
        } else if (f.highbay) {
          // pendente industrial grande (campânula grafite + difusor); `susp` = os redondos menores do templo (Ø 0,64 m),
          // suspensos sem haste; os outros têm cabo de 1,7 m
          const kb = f.susp ? 0.7 : 1;
          const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * kb, 0.46 * kb, 0.36 * kb, 24, 1, true), bayMat); sh.position.set(px, py + 0.02 * kb, pz); sh.castShadow = false; sh.userData = { item: it.key };
          holder.add(sh); this._clickables.push(sh);
          holder.add(cyl(0.15 * kb, 0.15 * kb, 0.12 * kb, M.graphite, px, py + 0.25 * kb, pz, 16));
          if (!f.susp) { const y0r = py + 0.31 * kb, rodL = 1.7 - 0.31 * kb; holder.add(cyl(0.012, 0.012, rodL, M.dark, px, y0r + rodL / 2, pz, 6)); }
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * kb, 0.42 * kb, 0.025, 28), emis()); mesh.position.set(px, py - 0.15 * kb, pz);
          gs = 2.6 * kb; gb = 0.8;
        } else if (f.linear) {
          // pendente linear de LED (2,4 m ao longo de z), grafite, pendurado por 2 cabos no trilho do teto (y 6,42)
          const body = box(0.1, 0.07, 2.4, linMat, px, py + 0.035, pz, { cast: false }); body.userData = { item: it.key };
          holder.add(body); this._clickables.push(body);
          for (const dz of [-0.9, 0.9]) holder.add(cyl(0.006, 0.006, 6.4 - py - 0.07, M.dark, px, (6.4 + py + 0.07) / 2, pz + dz, 5));
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 2.3), emis()); mesh.position.set(px, py - 0.004, pz);
          (linRails[px] = linRails[px] || []).push(pz);
          gs = 1.6; gb = 0.55;
        } else if (f.lamp) {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), emis()); mesh.position.set(px, py, pz);
          holder.add(box(0.18, 0.22, 0.18, M.dark, px, py - 0.2, pz));
          gs = 0.9; gb = 0.7;
        } else if (f.sconce) {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 0.12), emis()); mesh.position.set(px, py, pz);
          gs = 1.1; gb = 0.8;
        } else {
          // pendente: cabo + cúpula aberta + lâmpada
          mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), emis()); mesh.position.set(px, py, pz);
          const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.2, 0.17, 20, 1, true), shadeMat);
          shade.position.set(px, py + 0.09, pz); shade.castShadow = false; shade.userData = { item: it.key }; holder.add(shade); this._clickables.push(shade);
          const fd = pz < 12.4 && !f.ext, top = fd ? HB : py + 0.44;   // fundos (paredes HB): a haste para no topo da parede e continua até H só com a Fachada/Pessoa (v1.8)
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, top - py - 0.16, 6), M.dark); rod.position.set(px, (py + 0.16 + top) / 2, pz); rod.castShadow = false; holder.add(rod);
          if (fd) { const hi = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, H - HB, 6), M.dark); hi.position.set(px, (HB + H) / 2, pz); hi.castShadow = false; this._ext.add(hi); }
        }
        mesh.userData = { item: it.key }; mesh.castShadow = false; holder.add(mesh);
        rt.fixtures.push(mesh); this._clickables.push(mesh);
        // Halo (bloom barato) na luminária
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TXg, color: rt.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.set(gs, gs, 1); glow.position.copy(mesh.position);
        holder.add(glow); rt.glows = rt.glows || []; rt.glows.push({ sp: glow, base: gb, gs });
        // Feixe volumétrico falso (cone aditivo) nos refletores do palco: segue a cor e o brilho da entidade
        if ((f.spot && !f.aim) || f.moving) {
          const dir = f.moving ? MOVE_DIR : new THREE.Vector3(0, -0.85, -0.5).normalize(), len = f.moving ? 5.8 : 5.2;
          const geo = new THREE.CylinderGeometry(f.moving ? 0.08 : 0.1, f.moving ? 0.95 : 1.15, len, 24, 1, true); geo.translate(0, -len / 2, 0);   // topo (v = 1) na lente
          const beam = new THREE.Mesh(geo, beamMat()); beam.position.set(px, py, pz).addScaledVector(dir, f.moving ? 0.17 : 0.15);
          beam.quaternion.setFromUnitVectors(up, dir.clone().negate());
          beam.userData.keep = true; beam.renderOrder = 5; beam.visible = false; beam.castShadow = beam.receiveShadow = false; holder.add(beam);
          rt.beams = rt.beams || []; rt.beams.push(beam);
        }
      }
    }
    // trilhos do teto (y 6,42) onde os pendentes lineares se penduram: um por coluna de luminárias, ao longo de z
    const allZ = Object.values(linRails).flat();
    if (allZ.length) {
      const z0 = Math.min(...allZ) - 1.2, z1 = Math.max(...allZ) + 1.2;
      for (const x of Object.keys(linRails)) scene.add(box(0.06, 0.06, z1 - z0, railMat, +x, 6.43, (z0 + z1) / 2, { cast: false }));
    }
    // leve/min: as salas não têm luz real — UMA luz (sem sombra, quantidade fixa → nenhum shader recompila) acompanha o cômodo
    // onde a pessoa (modo Pessoa) ou o alvo da câmera está e acende com a luz dele (_roomLightTick)
    if (this._lite) {
      const L = new THREE.PointLight(0xffffff, 0, 6, 2); L.position.set(LOT.cx, -30, LOT.cz);
      scene.add(L); this._roomLight = L; this._nLights++;
    }
    // media: o conjunto fixo de luzes (_assignPool distribui); as MID_SHADOWS primeiras com sombra 256², redesenhada só quando mudam de lugar
    if (mid) {
      this._pool = [];
      for (let n = 0; n < MID_LIGHTS; n++) {
        const L = new THREE.PointLight(0xffffff, 0, 10, 2); L.position.set(LOT.cx, -30, LOT.cz);
        if (n < (this._tight ? 1 : MID_SHADOWS)) {
          L.castShadow = true; L.shadow.mapSize.set(256, 256); L.shadow.radius = 2;
          L.shadow.bias = -0.004; L.shadow.normalBias = 0.03; L.shadow.camera.near = 0.15; L.shadow.autoUpdate = false;
          this._nShadows++;
        }
        scene.add(L); this._pool.push(L); this._nLights++;
      }
    }
  }

  // leve/min: a luz que segue o cômodo (ver _buildFixtures). Devolve true quando algo mudou (redesenhar)
  _roomLightTick(dayScale) {
    const L = this._roomLight, p = this._walkOn ? this._camera.position : this._orbit.target;
    const up = this._walkOn && p.y > 3.6 && inMezz(p.x, p.z);   // em cima, no mezanino (salinha): vale o abajur de lá
    if (!this._rlP || Math.abs(this._rlP.x - p.x) + Math.abs(this._rlP.z - p.z) > 0.15 || this._rlP.up !== up) {
      this._rlP = { x: p.x, z: p.z, up }; this._rlF = null;
      const SKIP = ['palco', 'plateia', 'fachada', 'estacionamento'];
      if (up) {   // a salinha fica sobre WC, WC PCD e o canto do hall: a luz dela é o abajur (fixture escondida da luz do hall)
        const it = ITEMS.find((i) => i.key === 'hall'), f = it && (it.fixtures || []).find((q) => q.p[1] > 3);
        if (f) this._rlF = { f, key: 'hall' };
      } else for (const z of Object.values(ZONES)) {
        if (!z.inside || !z.item || SKIP.includes(z.item)) continue;
        const inZ = (x, zz, m) => z.rects.some(([rx, rz, w, d]) => x >= rx - m && x <= rx + w + m && zz >= rz - m && zz <= rz + d + m);
        if (!inZ(p.x, p.z, 0)) continue;
        const it = ITEMS.find((i) => i.key === z.item), fx = ((it && it.fixtures) || []).filter((f) => !f.ext && (f.p[1] > 3) === up && inZ(f.p[0], f.p[2], 0.05));
        if (!fx.length) break;
        const f = fx.reduce((a, b) => (Math.hypot(b.p[0] - p.x, b.p[2] - p.z) < Math.hypot(a.p[0] - p.x, a.p[2] - p.z) ? b : a));
        this._rlF = { f, key: z.item }; break;
      }
    }
    let i = 0;
    if (this._rlF) {
      const { f, key } = this._rlF, rt = this._items.get(key);
      if (rt) { i = (f.i || 16) * 1.25 * (rt.lv != null ? rt.lv : rt.level) * dayScale; L.color.copy(rt.cshow || rt.color); }
      if (L.position.x !== f.p[0] || L.position.z !== f.p[2]) { L.position.set(f.p[0], f.p[1] - 0.1, f.p[2]); L.distance = Math.max(f.d || 5, 5.5) * 1.2; i = i || 0; this._rlMoved = true; }
    }
    if (Math.abs(L.intensity - i) < 0.01 && !this._rlMoved) return false;
    L.intensity = i; this._rlMoved = false; return true;
  }

  // Poças de luz no piso dos cômodos (à noite as salas ficavam com um círculo pequeno de luz e cantos escuros): um plano aditivo
  // sobre o piso de cada zona interna, recortado no retângulo da zona (não vaza pela parede), com a luz caindo a partir de cada
  // luminária da própria zona. Não é luz real (nenhum shader das outras malhas muda): uma malha por item, 1 draw call cada.
  // Mais forte no leve/min, onde as salas não têm PointLight; fraca no alta/media, onde só completa a luz real.
  _buildPools(scene) {
    const SKIP = new Set(['palco', 'plateia', 'fachada', 'estacionamento']);
    const vs = 'attribute vec4 aF0; attribute vec4 aF1; attribute vec4 aF2; varying vec4 vF0; varying vec4 vF1; varying vec4 vF2; varying vec2 vP;'
      + ' void main(){ vF0 = aF0; vF1 = aF1; vF2 = aF2; vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }';
    const fs = 'uniform vec3 uC; uniform float uI; varying vec4 vF0; varying vec4 vF1; varying vec4 vF2; varying vec2 vP;'
      + ' float fall(vec4 f){ if (f.w <= 0.0) return 0.0; float k = clamp(1.0 - distance(vP, f.xy) / f.z, 0.0, 1.0); return f.w * k * k; }'
      + ' void main(){ float a = min(fall(vF0) + fall(vF1) + fall(vF2), 1.4); gl_FragColor = vec4(uC * uI * a, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}';
    this._poolK = this._lite ? 0.42 : this._q === 'media' ? 0.26 : 0.2;
    for (const it of ITEMS) {
      if (it.kind !== 'light' || !it.fixtures || SKIP.has(it.key)) continue;
      const rt = this._items.get(it.key); if (!rt) continue;
      const pos = [], F = [[], [], []], idx = [];
      for (const z of Object.values(ZONES)) {
        if (z.item !== it.key || !z.inside) continue;
        const inZ = (x, zz) => z.rects.some(([rx, rz, w, d]) => x >= rx - 0.05 && x <= rx + w + 0.05 && zz >= rz - 0.05 && zz <= rz + d + 0.05);
        const fx = it.fixtures.filter((f) => !f.ext && f.p[1] < 3 && inZ(f.p[0], f.p[2]));   // só o térreo (o abajur do mezanino fica de fora)
        if (!fx.length) continue;
        const span = Math.max(...z.rects.map(([, , w, d]) => Math.hypot(w, d)));
        for (const [x, zz, w, d] of z.rects) {
          // até 3 luminárias por retângulo (as mais próximas do centro); alcance ~ diagonal da zona (a luz chega aos cantos)
          const cx = x + w / 2, cz = zz + d / 2;
          const near = fx.slice().sort((a, b) => Math.hypot(a.p[0] - cx, a.p[2] - cz) - Math.hypot(b.p[0] - cx, b.p[2] - cz)).slice(0, 3);
          const R = clamp(span * 0.62, 2.6, 6.5);
          const b = pos.length / 3;
          for (const [vx, vz] of [[x, zz], [x + w, zz], [x + w, zz + d], [x, zz + d]]) {
            pos.push(vx, 0.03, vz);
            for (let k = 0; k < 3; k++) { const f = near[k]; F[k].push(f ? f.p[0] : 0, f ? f.p[2] : 0, R, f ? 1 : 0); }
          }
          idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      F.forEach((a, k) => g.setAttribute('aF' + k, new THREE.Float32BufferAttribute(a, 4)));
      g.setIndex(idx);
      const mat = new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color() }, uI: { value: 0 } }, vertexShader: vs, fragmentShader: fs,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const m = new THREE.Mesh(g, mat); m.userData.keep = true; m.renderOrder = 2; m.frustumCulled = true; m.visible = false; m.castShadow = m.receiveShadow = false;
      g.computeBoundingSphere(); scene.add(m); rt.pool = m;
    }
  }

  // Domo de céu (dia/noite com crossfade) e mapa de ambiente para reflexos
  _buildSky(scene, renderer) {
    const T = textures();
    const R = 260;   // envolve a câmera mesmo no zoom máximo (alvo ± 150 m)
    const geo = new THREE.SphereGeometry(R, 32, 16);
    this._skyNight = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: T.skyNight, side: THREE.BackSide, fog: false, depthWrite: false }));
    this._skyDay = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: T.skyDay, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: 0 }));
    this._skyDusk = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: T.skyDusk, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: 0 }));
    this._skyNight.renderOrder = -3; this._skyDusk.renderOrder = -2; this._skyDay.renderOrder = -1;
    this._skyNight.position.set(LOT.cx, 0, LOT.cz); this._skyDay.position.copy(this._skyNight.position); this._skyDusk.position.copy(this._skyNight.position);
    scene.add(this._skyNight, this._skyDusk, this._skyDay);
    // (v1.4.6) sem estrelas: o cliente pediu o céu noturno liso
    // Ambiente (PMREM) a partir do próprio céu: reflexos em vidros/metais e luz difusa.
    // No leve fica sem: o reflexo custa ~⅓ de cada quadro em GPU integrada. No media só os materiais brilhantes
    // refletem (_useEnvMats) e a luz difusa do céu vem de uma sonda SH do mesmo domo (quase de graça)
    if (this._q === 'media') {
      this._shDay = skySH(T.skyDay, true); this._shNight = skySH(T.skyNight, false);
      this._probe = new THREE.LightProbe(this._shNight.clone(), 0.35); scene.add(this._probe);
    }
    if (!this._lite) try {
      const pm = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(130, 32, 16), new THREE.MeshBasicMaterial({ map: T.skyDay, side: THREE.BackSide }));
      const sun = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      sun.position.set(-45, 90, 35); envScene.add(dome, sun);
      this._envDay = pm.fromScene(envScene, 0.04).texture;
      dome.material.map = T.skyNight; sun.visible = false;
      this._envNight = pm.fromScene(envScene, 0.04).texture;
      pm.dispose();
      if (!this._probe) { scene.environment = this._envNight; scene.environmentIntensity = 0.35; }
    } catch (e) { console.warn('[igreja3d-card] sem environment map', e); }
  }

  // Paredes (linha de centro, espessura T, altura H) — medidas do rooms/BRIEF.md
  _buildWalls(scene, M) {
    const wallX = (z, xa, xb, ops = [], o = {}) => this._wallSeg(scene, M, 'x', z, xa, xb, ops, o);
    const wallZ = (x, za, zb, ops = [], o = {}) => this._wallSeg(scene, M, 'z', x, za, zb, ops, o);
    // Externas (pretas por fora, revestidas de branco por dentro): `inner` = lado de dentro
    const DK = { mat: M.wallDark, cap: M.wallDarkCap, frame: M.frameDark, ext: true };
    // Bloco dos fundos (z 0–12,4): paredes com espessura TF e altura HB. Nas de divisa a face externa fica onde estava (eixo recuado TF/2).
    const F = { t: TF, h: HB, hx: H };
    wallX(-TF / 2, 0, 20.1, [{ a: 0.3, b: 4.7, t: 'gate' }], Object.assign({ inner: 1 }, DK, F));
    // divisa esquerda (x = 0) em 3 trechos: o do templo (z 12,4–44,0) é a PAREDE DO PALCO — sobe a 8,5 m
    // já no modo normal e é preta por dentro (correção do cliente: o palco fica nesta parede lateral longa)
    wallZ(-TF / 2, 0, 12.4, [], Object.assign({}, DK, F, { ext1: false, clad: [{ side: 1, mat: M.wall, a: 0, b: 12.4 }] }));
    // saída preta de 2 folhas na parede do palco, perto do fundo (z 13,8–15,4, entre os perfis de z 13,5 e 18,5 — pedido do cliente, v1.4.8)
    wallZ(0, 12.4, 44.0, [{ a: 13.8, b: 15.4, t: 'door', style: 'black2', metal: true }], Object.assign({}, DK, { ext: false, h: SPEC.H_TEMPLO, clad: [{ side: 1, mat: M.pretoFosco, a: 12.4, b: 44.0 }] }));
    wallZ(0, 44.0, 49.65, [], Object.assign({}, DK, { ext0: false, clad: [{ side: 1, mat: M.wall, a: 44.0, b: 49.65 - T / 2 }] }));
    wallZ(20.1 + TF / 2, 0, 11.0, [], Object.assign({ inner: -1 }, DK, F, { ext1: false }));
    wallZ(20.1, 11.0, 49.5, [], Object.assign({ inner: -1 }, DK, { ext0: false }));
    wallX(49.65, 0, 16.05, [{ a: 0.6, b: 3.2, t: 'window' }, { a: 10.9, b: 13.1, t: 'glassdoor', item: 'porta' }], Object.assign({ inner: -1 }, DK));
    wallX(49.5, 16.05, 20.1, [{ a: 17.6, b: 19.6, t: 'window', sill: 1.6 }], Object.assign({ inner: -1 }, DK));
    // Almoxarifado / cozinha
    wallZ(4.9, 0, 3.9, [{ a: 1.0, b: 2.0, t: 'window' }], F);
    wallZ(8.6, 0, 3.9, [], F);
    wallX(3.9, 4.9, 12.75, [{ a: 7.5, b: 8.4, t: 'door' }, { a: 9.2, b: 10.8, t: 'window' }, { a: 11.6, b: 12.5, t: 'door' }], F);
    // Recepção / sala pastoral
    wallZ(12.75, 0, 9.25, [{ a: 8.2, b: 9.1, t: 'door' }], F);
    wallZ(9.45, 5.9, 9.25, [], F);
    wallX(5.9, 9.45, 12.75, [{ a: 10.3, b: 11.9, t: 'window' }], F);
    wallX(9.25, 9.45, 20.1, [{ a: 11.8, b: 12.6, t: 'door' }, { a: 12.9, b: 13.8, t: 'door' }, { a: 14.2, b: 16.6, t: 'glass' }], F);
    // Caixa d'água / banheiro da pastoral
    wallZ(17.0, 0, 4.9, [{ a: 1.2, b: 2.2, t: 'window' }, { a: 3.4, b: 4.2, t: 'door' }], F);
    wallX(3.1, 17.0, 20.1, [], F);
    wallX(4.9, 17.0, 20.1, [], F);
    // Ala direita: entrada lateral, Gilvan, administrativo
    wallX(11.0, 16.05, 20.1, [{ a: 17.9, b: 19.9, t: 'window' }]);   // (v1.5.1: a porta x 16,15–17,0 foi para a parede x = 16,05 — aqui ficou parede lisa, com o vaso na frente)
    wallZ(17.1, 11.0, 19.0, [{ a: 12.9, b: 13.8, t: 'door' }, { a: 14.4, b: 15.3, t: 'door' }, { a: 16.8, b: 18.3, t: 'window' }]);
    wallX(14.2, 17.1, 20.1);
    wallX(19.0, 17.1, 20.1);
    // Templo: faces internas do perímetro PRETAS (fosco), o lado dos cômodos vizinhos continua claro.
    // Ponta z = 12,4 (parede comum de 3 m, lisa — a saída de vidro x 12,9–15,1 não existe na obra, saiu na v1.4.8) e lateral direita x = 16,05 (mídia de frente para o palco)
    const TB = (side, a, b) => ({ clad: [{ side, mat: M.pretoFosco, a, b }] });
    wallX(12.4, 0, 16.05, [], TB(1, T / 2, 16.05 - T / 2));
    // (v1.4.5, pedido do cliente: a porta preta de correr z 34,2–35,1 e a preta dupla z 42,0–43,6 saíram — parede lisa)
    // v1.5.1 (pedido do cliente): a porta de madeira do pátio para o corredor lateral foi para esta parede (z 11,25–12,15, no canto onde
    // ficava o vaso de espada-de-são-jorge); a porta do WC Feminino voltou para a parede do hall dos banheiros (z = 44,3)
    wallZ(16.05, 11.0, 49.65, [{ a: 11.25, b: 12.15, t: 'door' }, { a: 19.2, b: 22.6, t: 'glass' }, { a: 23.6, b: 27.7, t: 'window', sill: 1.1 }, { a: 29.9, b: 31.9, t: 'window' }],
      TB(-1, 12.4 + T / 2, 44.0 - T / 2));
    // Mídia, voluntariado, depósito, WCs
    wallX(23.3, 16.05, 18.9, [{ a: 17.9, b: 18.8, t: 'door' }]);
    wallZ(18.9, 23.3, 28.0);
    wallX(28.0, 16.05, 20.1, [{ a: 19.0, b: 19.9, t: 'door' }]);
    wallX(33.9, 16.05, 20.1, [{ a: 16.2, b: 17.0, t: 'door' }]);
    wallZ(17.1, 33.9, 40.8, [{ a: 34.6, b: 35.4, t: 'door' }]);
    wallX(35.9, 17.1, 20.1);
    wallX(37.0, 17.1, 20.1);
    wallX(40.8, 17.1, 20.1, [{ a: 18.2, b: 19.0, t: 'open' }]);   // WC masc.: entrada sem porta (vão aberto)
    wallX(44.3, 16.05, 20.1, [{ a: 16.25, b: 17.15, t: 'door' }]);   // WC fem.: porta pelo hall dos banheiros (voltou na v1.5.1)
    // Templo ↔ hall (porta de 2 folhas de vidro, caixilho preto)
    wallX(44.0, 0, 16.05, [{ a: 10.6, b: 13.1, t: 'door', style: 'glass2' }], TB(-1, T / 2, 16.05 - T / 2));
    // WCs (v1.8: a parede x = 4,0 da Sala da Família e a porta dela saíram; o canto virou hall — fica só o trecho do WC PCD)
    wallZ(1.9, 44.0, 46.3);
    wallZ(4.0, 44.0, 46.3 + T / 2, [{ a: 44.4, b: 45.3, t: 'door' }]);   // + T/2: fecha a quina com a parede z = 46,3
    wallX(46.3, 0, 4.0, [{ a: 0.5, b: 1.3, t: 'door' }]);
    // Pilares do templo (0,4 × 0,4, 3,05 m). Metade voltada para o templo PRETA, a outra clara (ou preta por fora na divisa).
    // x = 0: por dentro só nos cantos (z 12,4 e 44,0) — no trecho do palco a face da parede fica lisa (telas, telão e
    // perfis altos são da decoração). x = 16,05: seguem a planta (encontros com as paredes da ala direita).
    const PH = H + 0.05;
    for (const z of PILLARS_L) {
      scene.add(box(0.2, PH, 0.4, M.wallDark, -0.1, PH / 2, z));
      if (z <= 12.4 || z >= 44.0) scene.add(box(0.2, PH, 0.4, M.pretoFosco, 0.1, PH / 2, z));
    }
    for (const z of PILLARS_R) { scene.add(box(0.2, PH, 0.4, M.pretoFosco, 15.95, PH / 2, z)); scene.add(box(0.2, PH, 0.4, M.pillar, 16.15, PH / 2, z)); }
    for (const x of [5.4, 10.5]) {
      scene.add(box(0.4, PH, 0.2, M.pillar, x, PH / 2, 12.3)); scene.add(box(0.4, PH, 0.2, M.pretoFosco, x, PH / 2, 12.5));
      scene.add(box(0.4, PH, 0.2, M.pretoFosco, x, PH / 2, 43.9)); scene.add(box(0.4, PH, 0.2, M.pillar, x, PH / 2, 44.1));
    }
  }

  // Segmento de parede ao longo de X (z fixo) ou Z (x fixo) com aberturas.
  // o = { h, hx (a parede continua de h até hx só no modo Fachada — o que também vale na Pessoa: grupo ext), mat, cap, frame (caixilho; padrão preto), doorFrame (batente/guarnição; padrão madeira), inner (±1: lado do
  //   revestimento claro), ext (estende T/2 nas pontas; ext0/ext1 só no início/fim), clad: [{ side ±1, mat, a, b }] (revestimento
  //   de 12 mm num lado, entre a e b — ex.: face preta do templo) }
  // Aberturas: door (style 'black' = preta de correr, side = lado do trilho) · window (sill/top opcionais) · glass ·
  //   glassdoor (2 folhas, item) · open · gate
  _wallSeg(scene, M, axis, c, a0, a1, ops, o = {}) {
    const W = this._walls || (this._walls = []);   // segmentos sólidos ao nível dos pés, para a colisão da visão de pessoa
    if (o.t === TF && !o.ext) (this._thin || (this._thin = [])).push({ axis, c, a0, a1 });   // divisória fina dos fundos (ver _snapThin)
    const h = o.h || H, t = o.t || T, mat = o.mat || M.wall, capMat = o.cap || M.wallCap, fr = o.frame || M.frameDark, inner = o.inner || 0;
    const e0 = o.ext0 != null ? o.ext0 : !!o.ext, e1 = o.ext1 != null ? o.ext1 : !!o.ext;
    if (e0) a0 -= T / 2;   // até a face externa da parede perpendicular (fica no lugar mesmo nas finas)
    if (e1) a1 += T / 2;
    const glassMat = o.ext ? M.glass : M.glassSmoke;   // visores/janelas internas: vidro levemente fumê
    const put = (len, hh, thick, m, mid, y, opts, off = 0, hi = false) => {
      const mesh = axis === 'x' ? box(len, hh, thick, m, mid, y, c + off, opts) : box(thick, hh, len, m, c + off, y, mid, opts);
      if (hi) (this._wallHi || (this._wallHi = [])).push(mesh); else scene.add(mesh);   // hi: parte de cima (h → hx), vai para o grupo da Fachada
      return mesh;
    };
    const seg = (a, b, y0, y1, hi = false) => {
      if (b - a <= 0.001 || y1 - y0 <= 0.001) return;
      if (y0 <= 0.5 && y1 >= 0.9) W.push({ axis, c, a0: a, a1: b, t, h });   // parede cheia ou sob o peitoril; vergas de porta (y0 2,1) não bloqueiam
      put(b - a, y1 - y0, t, mat, (a + b) / 2, (y0 + y1) / 2, undefined, 0, hi);
      // revestimento interno: só entre as faces internas das paredes vizinhas (nas pontas
      // estendidas ele apareceria como um filete branco do lado de fora)
      const la = e0 ? Math.max(a, a0 + t) : a, lb = e1 ? Math.min(b, a1 - t) : b;
      if (inner && lb - la > 0.001) put(lb - la, y1 - y0, 0.012, M.wall, (la + lb) / 2, (y0 + y1) / 2, { cast: false }, inner * (t / 2 + 0.006), hi);
      for (const cl of o.clad || []) {
        const ca = Math.max(a, cl.a), cb = Math.min(b, cl.b);
        if (cb - ca > 0.001) put(cb - ca, y1 - y0, 0.012, cl.mat, (ca + cb) / 2, (y0 + y1) / 2, { cast: false }, cl.side * (t / 2 + 0.006), hi);
      }
      // tampa ligeiramente acima do topo (e com altura diferente por eixo) → sem faces coplanares; com hx, a de baixo fica dentro da
      // espessura (some sob a parte de cima no modo Fachada) e a parede continua até hx
      const top = hi ? o.hx : h;
      if (Math.abs(y1 - top) < 0.001) put(b - a, 0.03, hi || !o.hx ? t + 0.03 : t - 0.004, capMat, (a + b) / 2, top + (axis === 'x' ? 0.02 : 0.018), { cast: false }, 0, hi);
      if (!hi && o.hx > h && Math.abs(y1 - h) < 0.001) seg(a, b, h, o.hx, true);
    };
    const pane = (a, b, y0, y1) => { if (y0 <= 0.5) W.push({ axis, c, a0: a, a1: b, t: 0.02 }); return put(b - a, y1 - y0, 0.02, glassMat, (a + b) / 2, (y0 + y1) / 2, { cast: false, receive: false }); };   // vidro fixo do chão bloqueia
    // caixilho: ombreiras + verga (e peitoril se y0 > 0)
    const frame = (a, b, y0, y1, lintel = true) => {
      put(0.06, y1 - y0, t + 0.06, fr, a + 0.03, (y0 + y1) / 2); put(0.06, y1 - y0, t + 0.06, fr, b - 0.03, (y0 + y1) / 2);
      if (lintel) put(b - a, 0.06, t + 0.06, fr, (a + b) / 2, y1 - 0.03);
      if (y0 > 0.01) put(b - a + 0.12, 0.04, t + 0.16, fr, (a + b) / 2, y0 + 0.02);
    };
    const mullion = (a, b, y0, y1) => put(0.04, y1 - y0, t + 0.02, fr, (a + b) / 2, (y0 + y1) / 2);
    // peça pequena em (u ao longo da parede, y, n = afastamento do eixo); `rot` gira o cilindro para a normal da parede
    const at = (m, u, y, n) => { if (axis === 'x') m.position.set(u, y, c + n); else m.position.set(c + n, y, u); scene.add(m); return m; };
    let cur = a0;
    const sorted = [...ops].sort((p, q) => p.a - q.a);
    for (const op of sorted) {
      seg(cur, op.a, 0, h);
      if (op.t === 'door') {
        // porta interna (vídeos): folha lisa de cedro com veio, batente + guarnição de madeira nas duas faces, alavanca
        // cromada dos dois lados. style 'black': porta preta de correr (saídas do templo) com trilho aparente e puxador preto.
        seg(op.a, op.b, 2.1, h);
        const black = op.style === 'black' || op.style === 'black2' || op.style === 'glass2', df = op.metal ? M.steel : black ? M.frameDark : (o.doorFrame || M.doorFrame);   // metal: guarnição de aço (porta preta em parede preta)
        const w = op.b - op.a, mid = (op.a + op.b) / 2;
        put(0.04, 2.1, t + 0.02, df, op.a + 0.02, 1.05); put(0.04, 2.1, t + 0.02, df, op.b - 0.02, 1.05); put(w, 0.04, t + 0.02, df, mid, 2.08);
        for (const sd of [-1, 1]) {
          const off = sd * (t / 2 + 0.008);
          put(0.07, 2.17, 0.016, df, op.a - 0.025, 1.085, { cast: false }, off);
          put(0.07, 2.17, 0.016, df, op.b + 0.025, 1.085, { cast: false }, off);
          put(w + 0.12, 0.07, 0.016, df, mid, 2.135, { cast: false }, off);
        }
        // a folha e as ferragens são instâncias próprias (animadas no modo Pessoa; fechadas ficam idênticas às de sempre)
        this._doorAdd(axis, c, t, op, M);
        if (black && op.style !== 'black2' && op.style !== 'glass2') {
          const sd = op.side || -1;
          put(2 * w + 0.1, 0.1, 0.07, M.frameDark, op.a + w - 0.05, 2.26, { cast: false }, sd * (t / 2 + 0.05));   // trilho/caixa da porta de correr
        }
      } else if (op.t === 'gate') {
        W.push({ axis, c, a0: op.a, a1: op.b, t });   // portão de correr fechado bloqueia
        // portão de correr: sem verga, réguas horizontais escuras até o topo do muro (2,6 m no máximo)
        const gt = Math.min(2.6, h);
        frame(op.a, op.b, 0, gt, false);
        for (let y = 0.12; y < gt - 0.1; y += 0.2) put(op.b - op.a - 0.12, 0.13, 0.04, M.frameDark, (op.a + op.b) / 2, y + 0.065, { cast: false });
        put(op.b - op.a - 0.12, 0.05, 0.06, M.frameDark, (op.a + op.b) / 2, gt - 0.05);
      } else if (op.t === 'window') {
        const y0 = op.sill != null ? op.sill : 1.0, y1 = op.top != null ? op.top : 2.15;
        seg(op.a, op.b, 0, y0); seg(op.a, op.b, y1, h); frame(op.a, op.b, y0, y1); pane(op.a, op.b, y0, y1); mullion(op.a, op.b, y0, y1);
      } else if (op.t === 'glass') {
        seg(op.a, op.b, 2.25, h); frame(op.a, op.b, 0, 2.25); pane(op.a, op.b, 0, 2.25);
        const n = Math.max(1, Math.round((op.b - op.a) / 1.0)); for (let i = 1; i < n; i++) mullion(op.a + ((op.b - op.a) * i) / n - 0.02, op.a + ((op.b - op.a) * i) / n + 0.02, 0, 2.25);
      } else if (op.t === 'glassdoor') {
        // porta de vidro de 2 folhas (caixilho preto) — abre para fora quando `item` (sensor) = on
        seg(op.a, op.b, 2.25, h); frame(op.a, op.b, 0, 2.25);
        const rt = this._items.get(op.item) || {}; this._items.set(op.item, rt); rt.leaves = rt.leaves || []; rt.fixtures = rt.fixtures || [];
        const lw = (op.b - op.a - 0.12) / 2, out = axis === 'x' ? (inner < 0 ? 1 : -1) : 1;
        for (const [pivot, sgn] of [[op.a + 0.06, 1], [op.b - 0.06, -1]]) {
          const g = new THREE.Group(); g.userData.keep = true;
          if (axis === 'x') g.position.set(pivot, 0, c); else { g.position.set(c, 0, pivot); g.rotation.y = -Math.PI / 2; }
          const cx = sgn * lw / 2;
          const gl = box(lw - 0.08, 2.1, 0.02, M.glass, cx, 1.1, 0, { cast: false, receive: false }); gl.userData = { item: op.item };
          g.add(gl, box(0.05, 2.18, 0.05, M.frameDark, sgn * 0.025, 1.1, 0), box(0.05, 2.18, 0.05, M.frameDark, sgn * (lw - 0.025), 1.1, 0),
            box(lw, 0.05, 0.05, M.frameDark, cx, 0.03, 0), box(lw, 0.05, 0.05, M.frameDark, cx, 2.17, 0));
          for (const s of [-1, 1]) g.add(cyl(0.012, 0.012, 1.1, M.chrome, sgn * (lw - 0.12), 1.05, s * 0.06, 8));   // puxadores
          scene.add(g); this._clickables.push(gl); rt.fixtures.push(gl);
          rt.leaves.push({ g, dir: sgn * out, base: g.rotation.y });
        }
        (this._doors || (this._doors = [])).push(this._doorNew({ kind: 'main', axis, c, t, a: op.a, b: op.b, rt }));   // abre sozinha no modo Pessoa (só visual)
      } else if (op.t === 'open') {
        seg(op.a, op.b, Math.min(h - 0.35, 2.3), h);
      }
      cur = op.b;
    }
    seg(cur, a1, 0, h);
  }

  // ---- Portas que abrem sozinhas no modo Pessoa ----
  // Cada porta interna (op 'door' de _wallSeg) vira uma definição em this._doors: folhas com pivô na dobradiça, cujas peças (folha, alavanca,
  // puxadores) são INSTÂNCIAS de poucos InstancedMesh (um por geometria × material × sombra ≈ 5 draw calls para o prédio inteiro; fechadas
  // ficam idênticas às malhas estáticas de antes). O quadro da folha tem x = ao longo da parede e z = lateral; no eixo z ele é o mundo
  // girado −90°, então o lateral local é −x do mundo. A porta principal (kind 'main') só ganha um "abrir" local nas folhas que já existem.
  _doorNew(d) {
    d = Object.assign({ leaves: [], q: 0, p: 0, p2: 0, hs: 0, lever: false, target: 0, side: 1, open: 1.5, slideLen: 0, max: { '-1': 1.55, '1': 1.55 }, awayAt: 0, hold: 0, suppress: false, moving: false, dist: 99, du: 99, n: 0 }, d);
    d.mx = d.axis === 'x' ? (d.a + d.b) / 2 : d.c; d.mz = d.axis === 'x' ? d.c : (d.a + d.b) / 2;
    return d;
  }
  _doorAdd(axis, c, t, op, M) {
    const glass2 = op.style === 'glass2', two = op.style === 'black2' || glass2, black = op.style === 'black' || two;
    const w = op.b - op.a, mid = (op.a + op.b) / 2, sd = op.side || -1, hx = op.b - 0.1;
    const d = this._doorNew({ kind: two ? 'double' : black ? 'slide' : 'swing', axis, c, t, a: op.a, b: op.b, sd, latOff: sd * (t / 2 + 0.05) });
    const ln = (n) => (axis === 'x' ? n : -n);
    const lf = (u, dirU, len) => { const l = { u, dirU, len, parts: [], lag: false }; d.leaves.push(l); return l; };
    // peça: s = tamanho (ao longo da parede, altura, lateral) · (u, y, n) = posição absoluta no mundo da parede
    const part = (l, geo, mat, s, u, y, n, cast, recv) => l.parts.push({ geo, mat, s, pos: [u - l.u, y, ln(n)], cast, recv });
    if (two) {
      const A = lf(op.a + 0.04, 1, mid - 0.002 - (op.a + 0.04)), B = lf(op.b - 0.04, -1, op.b - 0.04 - (mid + 0.002)); B.lag = true;   // a segunda folha atrasa um pouco (as duas nunca se movem em uníssono)
      // folhas pretas (black2) ou de vidro (glass2, transparentes: sem sombra)
      const lm = glass2 ? M.glass : M.pretoFosco, lt = glass2 ? 0.02 : 0.04;
      part(A, 'box', lm, [A.len, 2.06, lt], (op.a + 0.04 + mid - 0.002) / 2, 1.03, 0, !glass2, !glass2);
      part(B, 'box', lm, [B.len, 2.06, lt], (mid + 0.002 + op.b - 0.04) / 2, 1.03, 0, !glass2, !glass2);
      part(A, 'box', M.frameDark, [0.012, 2.06, 0.05], mid, 1.03, 0, false, true);   // junta central
      if (op.metal) {
        // saída de emergência: barra antipânico cromada nas duas faces de cada folha
        for (const s2 of [-1, 1]) for (const L of [A, B]) {
          const u0 = L === A ? op.a + 0.04 : mid + 0.002, u1 = L === A ? mid - 0.002 : op.b - 0.04;
          part(L, 'box', M.chrome, [u1 - u0 - 0.2, 0.045, 0.035], (u0 + u1) / 2, 1.0, s2 * 0.045, false, true);
        }
      } else for (const s2 of [-1, 1]) for (const dx of [-0.09, 0.09]) part(dx < 0 ? A : B, 'box', M.frameDark, [0.025, 0.6, 0.025], mid + dx, 1.05, s2 * 0.045, false, true);
    } else if (black) {
      const l = lf(op.a, 1, w - 0.08);
      part(l, 'box', M.pretoFosco, [w - 0.08, 2.06, 0.04], mid, 1.03, 0, true, true);
      for (const s2 of [-1, 1]) part(l, 'box', M.frameDark, [0.025, 0.4, 0.025], op.b - 0.1, 1.05, s2 * 0.045, false, true);
    } else {
      const l = lf(op.a + 0.04, 1, w - 0.08);   // dobradiça no lado oposto à alavanca
      part(l, 'box', M.door, [w - 0.08, 2.06, 0.04], mid, 1.03, 0, true, true);
      for (const s2 of [-1, 1]) {
        part(l, 'cyl', M.chrome, null, hx, 1.02, s2 * 0.026, false, false);   // roseta
        part(l, 'box', M.chrome, [0.13, 0.02, 0.022], hx - 0.05, 1.02, s2 * 0.05, false, true);   // alavanca
        l.parts[l.parts.length - 1].lever = [hx - l.u, 1.02];   // gira em torno da roseta (x local da folha, y) quando a pessoa "aperta" a maçaneta
      }
      d.lever = true;
    }
    (this._doors || (this._doors = [])).push(d);
  }

  // Depois de toda a decoração (antes do mergeStatic): mede o que atrapalha o giro/deslize de cada porta e cria os InstancedMesh.
  _buildDoors(scene) {
    const D = (this._doors || []).filter((d) => d.kind !== 'main'); this._doorMeshes = [];
    if (!D.length) return;
    scene.updateMatrixWorld(true);
    // obstáculos = mobiliário/decoração entre 0,12 e 2,0 m de altura (o "arquitetônico" foi marcado com userData.arch); paredes vêm de _walls
    const obs = [], bb = new THREE.Box3();
    for (const top of scene.children) {
      if (top.userData.arch || top === this._ext || top === this._mezz) continue;
      top.traverseVisible((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.material.isShaderMaterial || o.material.transparent || o.material.blending === THREE.AdditiveBlending) return;
        bb.setFromObject(o);
        if (bb.max.y < 0.12 || bb.min.y > 2.0 || bb.max.x - bb.min.x > 7 || bb.max.z - bb.min.z > 7) return;
        obs.push([bb.min.x, bb.min.z, bb.max.x, bb.max.z]);
      });
    }
    this._furnObs = obs;   // móveis (caixas na planta): a navegação por clique escolhe pontos de entrada longe deles
    const walls = (this._walls || []).map((w) => (w.axis === 'z' ? { ax: 'z', c: w.c, b: [w.c - w.t / 2, w.a0, w.c + w.t / 2, w.a1] } : { ax: 'x', c: w.c, b: [w.a0, w.c - w.t / 2, w.a1, w.c + w.t / 2] }));
    const DEG = Math.PI / 180;
    for (const d of D) {
      // caixas no quadro da porta: (u0, l0, u1, l1); a parede da própria porta (mesmo eixo e c) não conta
      const loc = (b) => (d.axis === 'x' ? [b[0], b[1] - d.c, b[2], b[3] - d.c] : [b[1], -(b[2] - d.c), b[3], -(b[0] - d.c)]);
      const near = (b) => b[2] > d.a - 2.6 && b[0] < d.b + 2.6 && b[3] > -2.6 && b[1] < 2.6;
      const F = obs.map(loc).filter(near), Wl = walls.filter((w) => !(w.ax === d.axis && Math.abs(w.c - d.c) < 0.02)).map((w) => loc(w.b)).filter(near);
      const hit = (u, l, rf, rw) => { for (const b of F) if (u > b[0] - rf && u < b[2] + rf && l > b[1] - rf && l < b[3] + rf) return true; for (const b of Wl) if (u > b[0] - rw && u < b[2] + rw && l > b[1] - rw && l < b[3] + rw) return true; return false; };
      if (d.kind === 'slide') {
        const lat = d.axis === 'x' ? d.latOff : -d.latOff, u0 = d.a + 0.04, u1 = d.b - 0.04; let free = 0;
        for (let s = 0.05; s <= d.b - d.a + 1e-6; s += 0.05) {
          let bad = false; for (let u = u0 + s; u <= u1 + s + 1e-6 && !bad; u += 0.1) bad = hit(u, lat, 0.05, 0.03);
          if (bad || hit(u1 + s, lat, 0.05, 0.03)) break; free = s;
        }
        d.slideLen = Math.max(free, 0.3);
      } else {
        for (const s of [-1, 1]) {
          let ok = 0;
          for (let a = 4; a <= 92; a += 4) {
            const th = a * DEG; let bad = false;
            for (const l of d.leaves) { for (let r = 0.1; r <= l.len + 1e-6 && !bad; r += 0.1) bad = hit(l.u + l.dirU * Math.cos(th) * r, s * Math.sin(th) * r, 0.05, 0.03); if (!bad) bad = hit(l.u + l.dirU * Math.cos(th) * l.len, s * Math.sin(th) * l.len, 0.05, 0.03); if (bad) break; }
            if (bad) break; ok = th;
          }
          d.max[s] = ok;
        }
      }
    }
    // InstancedMesh por (geometria, material, sombra)
    const gBox = new THREE.BoxGeometry(1, 1, 1), gRos = new THREE.CylinderGeometry(0.028, 0.028, 0.012, 14);
    const groups = new Map(), q = new THREE.Quaternion(), qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
    for (const d of D) for (const l of d.leaves) for (const p of l.parts) {
      p.local = new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), p.geo === 'cyl' ? qc : q, p.geo === 'cyl' ? one : new THREE.Vector3(...p.s));
      const key = [p.geo, p.mat.uuid, p.cast ? 1 : 0, p.recv ? 1 : 0].join('|');
      if (!groups.has(key)) groups.set(key, { p, list: [] });
      groups.get(key).list.push([d, p]);
    }
    for (const { p, list } of groups.values()) {
      const im = new THREE.InstancedMesh(p.geo === 'cyl' ? gRos : gBox, p.mat, list.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = !!p.cast; im.receiveShadow = !!p.recv; im.frustumCulled = false;
      im.userData.noMerge = true; im.userData.owners = [];
      list.forEach(([d, pp], i) => { pp.mesh = im; pp.idx = i; im.userData.owners.push(d); (d.meshes || (d.meshes = [])).includes(im) || d.meshes.push(im); });
      scene.add(im); this._doorMeshes.push(im);
    }
    for (const d of D) this._doorApply(d);
    for (const im of this._doorMeshes) { im.computeBoundingSphere(); im.boundingSphere.radius += 3; }
  }
  // posição das peças da porta no estado atual (d.p eased 0…1 — pode passar um pouco de 1 no "assentar" —, d.side, d.open, d.hs = maçaneta apertada 0…1)
  _doorApply(d) {
    if (d.kind === 'main') return;
    const z = d.axis === 'z', base = z ? -Math.PI / 2 : 0, m1 = _dm1, m2 = _dm2, m3 = _dm3;
    const lat = z ? -d.latOff : d.latOff, hang = d.hs * 0.72;   // alavanca desce ~41°
    for (const l of d.leaves) {
      const p = l.lag ? d.p2 : d.p;
      if (d.kind === 'slide') {
        m1.makeRotationY(base);
        m2.makeTranslation(clamp((p - 0.12) / 0.88, 0, 1) * d.slideLen, 0, clamp(p / 0.25, 0, 1) * lat); m1.multiply(m2);
      } else m1.makeRotationY(base - d.side * l.dirU * p * d.open);
      const e = m1.elements; e[12] += z ? d.c : l.u; e[14] += z ? l.u : d.c;   // pivô no mundo
      for (const pt of l.parts) {
        if (pt.lever && hang > 0.001) {
          // alavanca: gira em torno da roseta (eixo = normal da folha), como se a mão a apertasse
          const cs = Math.cos(hang), sn = Math.sin(hang), px = pt.lever[0], py = pt.lever[1];
          m2.makeRotationZ(hang); const f = m2.elements; f[12] = px - cs * px + sn * py; f[13] = py - sn * px - cs * py;
          m2.multiply(pt.local); m3.multiplyMatrices(m1, m2);
        } else m3.multiplyMatrices(m1, pt.local);
        pt.mesh.setMatrixAt(pt.idx, m3);
      }
    }
    for (const im of d.meshes) im.instanceMatrix.needsUpdate = true;
  }
  // curva do movimento (q = tempo normalizado 0…1 → ângulo/deslize 0…1): a folha de giro abre com um "empurrão" que passa um tico
  // do fim e assenta (~4%); fecha em S suave; a de correr e a principal largam rápido e vão freando devagar
  _doorEase(d, q) {
    if (q <= 0) return 0;
    if (d.kind === 'slide' || d.kind === 'main') { if (q >= 1) return 1; const w = 1 - Math.pow(1 - q, 1.7); return w * w * (3 - 2 * w); }
    if (d.target) {   // abre em S até 72% do tempo e ainda passa ~4% do batente, voltando devagar (a folha "assenta")
      if (q >= 1) return 1; const x = q / 0.72; if (x < 1) return x * x * (3 - 2 * x);
      const y = Math.sin(Math.PI * (q - 0.72) / 0.28); return 1 + 0.04 * y * y;
    }
    return q * q * (3 - 2 * q);
  }

  // Lado para onde a folha gira (para longe da pessoa, se couber) e quanto abre
  _doorSide(d) {
    if (d.kind !== 'swing' && d.kind !== 'double') return;
    const lp = d.axis === 'x' ? d.n : -d.n;   // lateral da pessoa no quadro da folha
    let s = Math.abs(lp) < 0.12 ? d.side : lp > 0 ? -1 : 1;
    const o = -s;
    if (d.max[s] < 0.87 && d.max[o] > d.max[s] + 0.1) s = o;   // móvel/parede atrapalha desse lado: abre para o outro
    d.side = s; d.open = Math.max(d.max[s], 0.35);
  }
  // Pessoa (walk) → portas: abre a mais "de frente" a ~1,6 m do vão (2,1 m correndo), mantém aberta enquanto está por perto e fecha
  // 2,5 s depois que ela se afasta. Devolve true enquanto alguma porta se move (só então o cartão pede quadros).
  _doorsTick(dt) {
    const D = this._doors, w = this._walk; if (!D || !D.length || !w) return false;
    const px = w.pos.x, pz = w.pos.z, fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), now = performance.now();
    const R = 1.6 + (Math.hypot(w.vel.x, w.vel.z) > 2.4 ? 0.5 : 0);
    let best = null, bs = 1e9, moving = false;
    for (const d of D) {
      const u = d.axis === 'x' ? px : pz, n = (d.axis === 'x' ? pz : px) - d.c, du = Math.max(d.a - u, u - d.b, 0);
      d.du = du; d.n = n; d.dist = Math.hypot(du, n);
      if (d.suppress && d.dist > R + 0.6) d.suppress = false;
      if (d.suppress || du > 0.6 || Math.abs(n) > R || d.dist > R) continue;
      const mx = d.mx - px, mz = d.mz - pz, cs = (fx * mx + fz * mz) / (Math.hypot(mx, mz) || 1);
      if (cs < 0.35 && d.dist > 0.9) continue;   // só a que está de frente (ou colada nela)
      const sc = d.dist + (1 - cs) * 0.8;
      if (sc < bs) { bs = sc; best = d; }
    }
    for (const d of D) {
      const want = !d.suppress && (d === best || d.hold > now || (d.target === 1 && d.dist < 2.2 && d.du < 0.9));
      if (want) {
        d.awayAt = 0;
        if (!d.target) { d.target = 1; if (d.q < 0.001) this._doorSide(d); }
      } else if (d.target) {
        if (!d.awayAt) d.awayAt = now; else if (now - d.awayAt > 2500) { d.target = 0; d.awayAt = 0; }
      }
      // maçaneta (portas de giro): a "mão" aperta antes de a folha sair do batente e solta logo que ela anda; ao fechar aperta de novo
      // perto do batente (a lingueta recua) e solta quando a folha encosta
      const lev = d.lever && !this._reduced, slideLike = d.kind === 'slide' || d.kind === 'main';
      const wantH = lev ? (d.target ? (d.q < 0.13 ? 1 : 0) : (d.q > 0 && d.q < 0.1 ? 1 : 0)) : 0;
      if (d.q !== d.target || d.hs !== wantH) {
        const dur = slideLike ? 0.95 : d.kind === 'double' ? 1.15 : 1.05;
        if (this._reduced) { d.q = d.target; d.hs = 0; }
        else {
          if (!(d.target && lev && d.q < 0.02 && d.hs < 0.97)) d.q = d.target ? Math.min(1, d.q + dt / dur) : Math.max(0, d.q - dt / (dur * 0.9));   // espera a maçaneta descer
          if (d.hs !== wantH) { const r = dt / (wantH > d.hs ? 0.14 : 0.26); d.hs = wantH > d.hs ? Math.min(wantH, d.hs + r) : Math.max(wantH, d.hs - r); }
        }
        d.p = this._doorEase(d, d.q);
        if (d.kind === 'double') d.p2 = this._doorEase(d, clamp((d.q - 0.07) / 0.93, 0, 1));
        d.moving = moving = true;
        if (d.kind === 'main') { d.rt.pOpen = d.p; d.rt.pMoving = true; } else this._doorApply(d);
      } else if (d.moving) {
        d.moving = false; moving = true;   // acabou de assentar: um último quadro + sombras refeitas uma vez
        if (d.kind === 'main') { d.rt.pMoving = false; this._refreshPointShadows('hall'); } else this._refreshShadowsNear(d.mx, d.mz);
      }
    }
    return moving;
  }
  // Sombras das luzes de sombra perto de (x, z) — uma vez, quando a porta assenta
  _refreshShadowsNear(x, z) {
    for (const [, rt] of this._items) for (const { L } of rt.lights || []) if (L.castShadow && Math.hypot(L.position.x - x, L.position.z - z) < 14) L.shadow.needsUpdate = true;
    this._needShadow = true;
  }
  // Toque/clique/Enter: alterna a porta (aberta → fecha e não reabre até a pessoa se afastar; fechada → abre e segura 6 s)
  _doorToggle(d) {
    const now = performance.now();
    if (d.target) { if (d.dist < 0.6) return; d.target = 0; d.hold = 0; d.suppress = true; d.awayAt = 0; }
    else { d.suppress = false; if (d.q < 0.001) this._doorSide(d); d.target = 1; d.hold = now + 6000; d.awayAt = 0; }
    this._orbit.dirty = true;
  }
  // Enter/F: a porta mais perto e à frente (até ~2,4 m)
  _doorInteract() {
    const D = this._doors, w = this._walk; if (!D || !w) return false;
    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw); let best = null, bs = 1e9;
    for (const d of D) {
      const mx = d.mx - w.pos.x, mz = d.mz - w.pos.z, cs = (fx * mx + fz * mz) / (Math.hypot(mx, mz) || 1);
      if (d.dist > 2.4 || (cs < 0.2 && d.dist > 0.9)) continue;
      const sc = d.dist + (1 - cs) * 0.8; if (sc < bs) { bs = sc; best = d; }
    }
    if (best) this._doorToggle(best);
    return !!best;
  }
  // Ao sair da visão de pessoa: tudo fechado na hora (o modo normal mostra as portas fechadas e paradas, como sempre)
  _doorsReset() {
    let any = false;
    for (const d of this._doors || []) {
      if (d.q === 0 && d.target === 0 && !d.moving) continue;
      any = true; d.q = d.p = d.p2 = d.hs = d.target = 0; d.hold = 0; d.awayAt = 0; d.suppress = false; d.moving = false;
      if (d.kind === 'main') { d.rt.pOpen = 0; d.rt.pMoving = false; } else this._doorApply(d);
    }
    if (any) { this._refreshPointShadows(); this._needShadow = true; }
  }
  // O raio de _pick (já apontado) acerta uma folha de porta? { d, dist } se estiver a ≤ 3,4 m e sem parede no caminho
  _doorHit() {
    if (!this._doorMeshes || !this._doorMeshes.length || !this._walk) return null;
    const cam = this._camera.position;
    for (const h of this._raycaster.intersectObjects(this._doorMeshes, false)) {
      if (h.distance > 3.4 || h.instanceId == null) continue;
      if (this._segBlocked(cam.x, cam.z, h.point.x, h.point.z)) continue;
      return { d: h.object.userData.owners[h.instanceId], dist: h.distance };
    }
    return null;
  }
  // Clique/toque no modo Pessoa: a folha de uma porta (ou a folha de vidro da principal) abre/fecha; vence o que estiver atrás dela
  _doorClick(hit) {
    const dh = this._doorHit();
    if (dh && (!hit || dh.dist <= hit.distance + 0.02)) { this._doorToggle(dh.d); return true; }
    if (hit && hit.object.userData.item === 'porta' && hit.distance <= 4.5) {
      const m = (this._doors || []).find((d) => d.kind === 'main');
      if (m) { this._doorToggle(m); return true; }
    }
    return false;
  }
  // segmento (planta) atravessa alguma parede sólida?
  _segBlocked(x0, z0, x1, z1) {
    for (const w of this._walls || []) {
      const a0 = w.a0 + 0.15, a1 = w.a1 - 0.15, h = w.t / 2 - 0.01;
      const bx0 = w.axis === 'x' ? a0 : w.c - h, bx1 = w.axis === 'x' ? a1 : w.c + h, bz0 = w.axis === 'x' ? w.c - h : a0, bz1 = w.axis === 'x' ? w.c + h : a1;
      if (bx1 <= bx0 || bz1 <= bz0) continue;
      let t0 = 0, t1 = 1; const dx = x1 - x0, dz = z1 - z0;
      for (const [p, dd, lo, hi] of [[x0, dx, bx0, bx1], [z0, dz, bz0, bz1]]) {
        if (Math.abs(dd) < 1e-9) { if (p < lo || p > hi) { t0 = 2; break; } continue; }
        let ta = (lo - p) / dd, tb = (hi - p) / dd; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break;
      }
      if (t0 <= t1) return true;
    }
    return false;
  }

  _buildFurniture(scene, M) {
    const F = furniture(M);
    const place = (g, x, z, ry = 0, y = 0) => { g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); return g; };
    // materiais iguais (mesmas opções) viram o mesmo objeto → menos draw calls depois do mergeStatic
    const matCache = new Map();
    const std = (o) => {
      const opts = Object.assign({ roughness: 0.9, metalness: 0 }, o || {});
      // texturas entram na chave pelo uuid: JSON.stringify chamaria Texture.toJSON (serializa a imagem em data URL — segundos por build)
      const kopts = {}; for (const k in opts) { const v = opts[k]; kopts[k] = (v && v.isTexture) ? 'tex:' + v.uuid : v; }
      let key = null; try { key = JSON.stringify(kopts, (k, v) => (v && v.isColor) ? '#' + v.getHexString() : v); } catch (_) { key = null; }
      if (key && matCache.has(key)) return matCache.get(key);
      const m = new THREE.MeshStandardMaterial(opts); if (key) matCache.set(key, m); return m;
    };
    const ext = this._ext;
    const addExt = (m) => { ext.add(m); return m; };
    const get = (k) => { const rt = this._items.get(k) || {}; this._items.set(k, rt); rt.fixtures = rt.fixtures || []; return rt; };
    // Emissivo da decoração que acompanha uma entidade: intensidade = max · (min + (1 − min) · nível).
    // O material pode ser compartilhado (continua valendo depois do mergeStatic).
    const bindEmissive = (key, mat, max = 1, opts = {}) => {
      if (!mat || !mat.emissive) return mat;
      const rt = get(key); rt.emisBind = rt.emisBind || [];
      rt.emisBind.push({ mat, max, min: opts.min != null ? opts.min : 0.08 }); mat.userData.noShare = true; mat.emissiveIntensity = max * (opts.min != null ? opts.min : 0.08);
      return mat;
    };
    // Halo aditivo (bloom barato) num plano w × h virado para +z, aceso com a entidade `key`.
    // opts: { color, base (opacidade máx., 0,45), day (fração de dia, 0,35), tex ('glow' radial | 'frame' moldura) }
    // Planos da mesma entidade com a mesma cor/opções compartilham o material (o merge os junta num draw call);
    // o cartão acende/apaga pelo material (opacity + visible).
    const glowMats = new Map();
    const glowPlane = (w, h, key, opts = {}) => {
      const tk = opts.tex === 'frame' ? 'frame' : 'glow', color = opts.color != null ? opts.color : 0xffffff;
      const base = opts.base != null ? opts.base : 0.45, day = opts.day != null ? opts.day : 0.35, mk = [key, tk, color, base, day].join('|');
      let mat = glowMats.get(mk);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ map: tk === 'frame' ? this._frameGlowTex() : textures().glow, color, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        mat.visible = false; mat.userData = { noShare: true, base, day }; glowMats.set(mk, mat);
        const rt = get(key); (rt.halos = rt.halos || []).push(mat);
      }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.castShadow = m.receiveShadow = false; m.renderOrder = 4;
      return m;
    };
    // Logo oficial compartilhado (mesma função de desenho em todo o cartão) — ver rooms/BRIEF.md
    const logo = { draw: drawLogo, aspect: logoAspect, tex: logoTex, mesh: logoMesh, relief: logoRelief, font: LOGO_FONT };
    const ctx = (seed) => ({ THREE, M, F, box, cyl, sph, std, place, add: (m) => { scene.add(m); return m; }, rnd: mulberry32(seed),
      ZONES, H, T, TF, HB, LOT, ext, addExt, makeTex, SPEC, PILLARS_L, PILLARS_R, logo, bindEmissive, glowPlane, TEX: textures(),
      STAIR, MEZZ, addMezz: (m) => { this._mezz.add(m); return m; }, top: () => !!this._topView });   // mezanino: grupo próprio (some na Vista de cima, que enxerga os cômodos de baixo)
    const click = (m, key) => { m.userData = { item: key }; scene.add(m); this._clickables.push(m); get(key).fixtures.push(m); return m; };

    // ---- Objetos ligados a entidades (as decorações não recriam nem cobrem) ----
    // Telão LED 8,4 × 3,0 m (media_player) na PAREDE DO PALCO x = 0: z 23,9–32,3, y 1,15–4,15, plano em x 0,25 virado
    // para +x (a plateia olha para −x), moldura preta fina (painel de x 0,12 a 0,24 com 5 cm de borda)
    const TVZ = 28.1, TVY = 2.65, TVW = 8.4, TVH = 3.0, TVX = 0.25;
    const tv = get('telao');
    scene.add(box(0.12, TVH + 0.1, TVW + 0.1, M.dark, 0.18, TVY, TVZ));
    tv.canvas = document.createElement('canvas'); tv.canvas.width = 1536; tv.canvas.height = 548;   // 2,8 : 1 (8,4 × 3,0)
    tv.tex = new THREE.CanvasTexture(tv.canvas); tv.tex.colorSpace = THREE.SRGBColorSpace; tv.tex.anisotropy = 4;
    tv.screenMat = new THREE.MeshStandardMaterial({ color: 0x050608, emissive: 0xffffff, emissiveMap: tv.tex, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1, toneMapped: false });
    tv.screenMat.userData.noShare = true;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(TVW, TVH), tv.screenMat); screen.rotation.y = Math.PI / 2;
    screen.position.set(TVX, TVY, TVZ); screen.castShadow = false; screen.receiveShadow = false;
    click(screen, 'telao');
    tv.light = new THREE.PointLight(0x8a70ff, 0, 14, 2); tv.light.position.set(2.1, 2.8, TVZ); scene.add(tv.light); this._nLights++;   // cor média do conteúdo
    // brilho de LED em volta do painel (moldura desfocada, vazada no meio para não lavar a imagem)
    tv.bloom = new THREE.Mesh(new THREE.PlaneGeometry(TVW + 2.2, TVH + 1.8), new THREE.MeshBasicMaterial({ map: this._frameGlowTex(TVW, TVH, TVW + 2.2, TVH + 1.8), color: 0x7a5cff,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    tv.bloom.rotation.y = Math.PI / 2; tv.bloom.position.set(TVX + 0.04, TVY, TVZ);
    tv.bloom.userData.noMerge = true; tv.bloom.renderOrder = 4; tv.bloom.visible = false; scene.add(tv.bloom);
    this._drawTelao('');
    // Som (switch): LEDs de status nas quinas frontais do palco (topo y 1,0; frente x 5,0; pontas z 19,6 / 36,6)
    const som = get('som'); som.ledMats = [];
    for (const z of [19.8, 36.4]) {
      click(box(0.1, 0.05, 0.16, M.dark, 4.9, 1.025, z, { cast: false }), 'som');
      const lm = som.ledMats[0] || new THREE.MeshStandardMaterial({ color: 0x0f2a18, emissive: 0x22c55e, emissiveIntensity: 0 }); lm.userData.noShare = true;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lm); led.position.set(4.9, 1.065, z); led.castShadow = false;
      click(led, 'som'); if (!som.ledMats.includes(lm)) som.ledMats.push(lm);
    }
    // Splits (climate): corpo branco + grelha + LED de modo + aleta que abre e fluxo de ar. axis = direção do comprimento; face = lado da sala.
    // sz = [comprimento, altura, profundidade] (templo: unidades grandes piso-teto instaladas no alto, como nos vídeos)
    // Fluxo: fitas translúcidas saindo da aleta (um ShaderMaterial por entidade, todas as unidades numa malha só);
    // a cor segue o modo e o desenho só anda por alguns segundos depois de ligar (ver _airTick).
    // Cada unidade tem o seu crescimento uG[i] (0 → 1, calculado em _airStep): o fluxo "nasce" da aleta e avança até o comprimento
    // cheio; o vértice guarda o índice da unidade (aU). Uma malha e um shader por entidade — nada recompila a cada vez.
    const airMat = () => new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(0x9fdcff) }, uI: { value: 0 }, uT: { value: 0 }, uTop: { value: 0 }, uG: { value: new Float32Array(8) } },
      vertexShader: 'attribute float aU; uniform float uG[8]; varying vec2 vUv; varying float vG; void main(){ vUv = uv; vG = uG[int(aU + 0.5)]; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; uniform float uI; uniform float uT; uniform float uTop; varying vec2 vUv; varying float vG; void main(){ float k = floor(vUv.x); float u = vUv.x - k; float v = vUv.y;'
        + ' bool fl = k > 2.5; float g = fl ? clamp((vG - 0.3) / 0.7, 0.0, 1.0) : vG; float vf = g * 1.3; float reveal = 1.0 - smoothstep(vf - 0.22, vf, v);'
        + ' float uw = u + 0.05 * sin(v * 9.0 - uT * 2.0 + k * 3.0) * v; float edge = smoothstep(0.0, 0.22, uw) * smoothstep(1.0, 0.78, uw); float fade = smoothstep(0.0, 0.06, v) * pow(1.0 - v, 1.5);'
        + ' float tb = 0.9 * sin(v * 6.5 + uT * 1.6 + u * 5.0 + k * 1.9) + 0.5 * sin(v * 13.0 - uT * 2.3 + u * 9.0 + k);'   // turbulência: o ar ondula, não é uma fita rígida
        + ' float s = 0.5 + 0.5 * sin(v * 21.0 - uT * 4.5 + k * 2.1 + u * 4.0 + tb); float fil = 0.72 + 0.28 * sin(u * 37.0 + k * 3.7 + v * 5.0 + tb * 0.7);'
        + ' float a = fl ? smoothstep(0.0, 0.12, v) * (1.0 - v) * (0.6 + 0.4 * s) * 1.1 : fade * (0.3 + 0.7 * s * s) * fil;'   // piso: leque mais cheio
        + ' vec3 col = uC; if (fl) { a *= 1.0 + uTop * (0.9 + 0.3 * sin(uT * 5.0)); col = mix(uC, pow(uC, vec3(1.8)) * 1.15, uTop * 0.75); }'   // Vista de cima: o leque no piso é o que se enxerga → mais forte, mais saturado e pulsando
        + ' float front = exp(-pow((v - vf + 0.09) / 0.1, 2.0)) * (1.0 - g);'   // ponta que avança brilha enquanto nasce
        + ' a = (a * (0.75 + 0.25 * (1.0 - g)) + front * 0.45 * edge) * reveal * smoothstep(0.0, 0.1, g);'
        + ' gl_FragColor = vec4(col, uI * edge * clamp(a, 0.0, 1.0));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
    const split = (key, x, y, z, axis, face, sz = [0.9, 0.3, 0.22]) => {
      const rt = get(key); rt.ledMats = rt.ledMats || [];
      const [Ls, Hs, D] = sz;
      click(axis === 'z' ? box(D, Hs, Ls, M.white, x, y, z) : box(Ls, Hs, D, M.white, x, y, z), key);
      const fo = face * (D / 2 + 0.006);
      scene.add(axis === 'z' ? box(0.012, 0.05, Ls - 0.1, M.steel, x + fo, y - Hs / 2 + 0.04, z, { cast: false }) : box(Ls - 0.1, 0.05, 0.012, M.steel, x, y - Hs / 2 + 0.04, z + fo, { cast: false }));
      // um material de LED por unidade (cada split acende na sua vez: ver _airStep)
      const lm = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, emissive: 0x67d3ff, emissiveIntensity: 0 }); lm.userData.noShare = true;
      const led = new THREE.Mesh(axis === 'z' ? new THREE.BoxGeometry(0.012, 0.03, 0.2) : new THREE.BoxGeometry(0.2, 0.03, 0.012), lm);
      if (axis === 'z') led.position.set(x + fo, y + Hs / 2 - 0.09, z + (Ls / 2 - 0.2) * face); else led.position.set(x + Ls / 2 - 0.2, y + Hs / 2 - 0.09, z + fo);
      led.castShadow = false; scene.add(led); rt.ledMats.push(lm);
      // referencial local da unidade: x ao longo do aparelho, z para fora (lado da sala), y para cima
      const ry = axis === 'x' ? (face > 0 ? 0 : Math.PI) : (face > 0 ? Math.PI / 2 : -Math.PI / 2);
      const out = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      (rt.airUnits = rt.airUnits || []).push({ p: new THREE.Vector3(x, y, z), out, big: Ls > 1, f: 0, g: 0, led: 0, on: false, ign: 0 });   // f aleta · g fluxo · led: 0..1
      // aleta: fecha rente ao fundo do aparelho e abre ~50° para fora/baixo com o nível do ar (grupo fora do merge)
      const unit = new THREE.Group(); unit.position.set(x, y, z); unit.rotation.y = ry; unit.userData.keep = true;
      const pivot = new THREE.Group(); pivot.position.set(0, -Hs / 2 - 0.008, D / 2 - 0.07); unit.add(pivot);
      pivot.add(box(Ls - 0.14, 0.012, 0.1, M.white, 0, 0, 0.02, { cast: false }));
      pivot.visible = false; scene.add(unit); (rt.flaps = rt.flaps || []).push(pivot);
      // selo do modo (❄ / chama / gota / hélice) acima do aparelho, só na Vista de cima: acha os ares ligados de longe
      const bm = rt.badgeMat || (rt.badgeMat = new THREE.SpriteMaterial({ map: this._airBadge('cool'), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false }));
      const sp = new THREE.Sprite(bm); sp.position.set(x, 3.4, z).addScaledVector(out, 0.9); sp.scale.set(0.042, 0.042, 1); sp.renderOrder = 9; sp.visible = false;
      scene.add(sp); (rt.badges = rt.badges || []).push(sp);
      // fitas do fluxo (3 camadas, curvando para baixo como ar frio); uv.x = camada + posição na largura, uv.y = 0 na aleta → 1 na ponta
      const ui = rt.airUnits.length - 1, A = rt.air = rt.air || { pos: [], uv: [], au: [], idx: [], pa: [], pb: [], pc: [], pm: [] }, sc = Ls > 1 ? 1.45 : 1, NV = 14;   // templo: unidades grandes, jato maior
      _m4.compose(_v.set(x, y, z), _q.setFromAxisAngle(_up, ry), _one);
      const pr = mulberry32(917 + rt.airUnits.length * 31 + Math.round(x * 7 + z * 3)), NP = this._min ? 8 : Ls > 1 ? 30 : 16;
      for (let k = 0; k < 3; k++) {
        const W = Ls - 0.18, len = (1.05 + 0.3 * k) * sc, a0 = 0.55 + 0.2 * k, a1 = 1.2 + 0.12 * k, base = A.pos.length / 3;
        let py = -Hs / 2 - 0.02 - 0.015 * k, pz = D / 2 - 0.04 + 0.02 * k;
        const pth = [];
        for (let j = 0; j <= NV; j++) {
          const v = j / NV, w = W * (1 + 0.4 * v) / 2;
          for (const u of [0, 1]) { const p = new THREE.Vector3(u ? w : -w, py, pz).applyMatrix4(_m4); A.pos.push(p.x, p.y, p.z); A.uv.push(u + k, v); A.au.push(ui); }
          pth.push([py, pz]);
          const ang = a0 + (a1 - a0) * v * v, st = len / NV; py -= Math.sin(ang) * st; pz += Math.cos(ang) * st;
        }
        for (let j = 0; j < NV; j++) { const i = base + j * 2; A.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
        // partículas de névoa que acompanham esta camada: curva de Bézier (início, meio, fim) da linha central da fita, com abertura lateral
        for (let n = 0; n < NP / 3; n++) {
          const xr = (pr() - 0.5) * W * 0.95, e0 = pth[0], em = pth[NV >> 1], e1 = pth[NV];
          const q0 = new THREE.Vector3(xr, e0[0], e0[1]).applyMatrix4(_m4), qm = new THREE.Vector3(xr * 1.2, em[0], em[1]),
            q1 = new THREE.Vector3(xr * 1.55, e1[0], e1[1]).applyMatrix4(_m4);
          qm.set(xr * 1.125, 2 * em[0] - (e0[0] + e1[0]) / 2, 2 * em[1] - (e0[1] + e1[1]) / 2).applyMatrix4(_m4);   // ponto de controle (a curva passa pelo meio)
          A.pa.push(q0.x, q0.y, q0.z); A.pb.push(qm.x, qm.y, qm.z); A.pc.push(q1.x, q1.y, q1.z);
          A.pm.push(ui, pr(), 0.7 + pr() * 0.7, (0.05 + pr() * 0.06) * sc);
        }
      }
      // camada 4: o ar espalhando no piso à frente do aparelho (leque rente ao chão — é o que aparece na Vista de cima)
      { const R = 1.5 * sc, W0 = Ls * 0.9, W1 = Ls * 1.9, z0 = D / 2 + 0.25, base = A.pos.length / 3;
        for (let j = 0; j <= 4; j++) {
          const v = j / 4, w = (W0 + (W1 - W0) * v) / 2;
          for (const u of [0, 1]) { const p = new THREE.Vector3(u ? w : -w, 0.03 - y, z0 + R * v).applyMatrix4(_m4); A.pos.push(p.x, p.y, p.z); A.uv.push(u + 3, v); A.au.push(ui); }
        }
        for (let j = 0; j < 4; j++) { const i = base + j * 2; A.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
      }
    };
    // templo (nenhum na parede do palco x = 0): 3 na parede x = 16,05 (fora do vidro/visor/porta; o do meio acima da janela
    // z 29,9–31,9) e 1 em cada ponta (z 12,4 e 44,0), no alto (y 2,6, topo 2,73 < 3,0)
    const ACT = [1.25, 0.26, 0.3], acIn = T / 2 + ACT[2] / 2;
    for (const z of [15.3, 30.9, 37.6]) split('ac_templo', 16.05 - acIn, 2.6, z, 'z', -1, ACT);
    split('ac_templo', 7.95, 2.6, 12.4 + acIn, 'x', 1, ACT);
    split('ac_templo', 7.95, 2.6, 44.0 - acIn, 'x', -1, ACT);
    split('ac_pastoral', 14.9, HB - 0.18, 0.125, 'x', 1);   // encostado na parede fina z = 0 (face em 0,012), abaixo do topo (HB)
    // ala direita (vídeos v4 e v2): mídia no fundo z = 28 (sobre as placas acústicas) e voluntariado na parede de marmorato x = 20,1
    split('ac_midia', 17.55, 2.56, 27.785, 'x', -1, [0.85, 0.28, 0.2]);
    split('ac_voluntariado', 19.9, 2.58, 29.5, 'z', -1);
    // uma malha de fluxo por entidade (fora do merge; só visível com o ar ligado)
    for (const key of AC_KEYS) {
      const rt = this._items.get(key); if (!rt || !rt.air) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rt.air.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(rt.air.uv, 2)); g.setAttribute('aU', new THREE.Float32BufferAttribute(rt.air.au, 1)); g.setIndex(rt.air.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, airMat()); m.userData.noMerge = true; m.renderOrder = 5; m.castShadow = m.receiveShadow = false; m.visible = false; m.frustumCulled = true;
      scene.add(m); rt.airMesh = m;
      // névoa: pontos macios que descem pela curva de cada fita (uma malha de Points por entidade, mesmo relógio uT e mesmo crescimento uG das fitas)
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(rt.air.pb, 3));
      pg.setAttribute('aA', new THREE.Float32BufferAttribute(rt.air.pa, 3)); pg.setAttribute('aB', new THREE.Float32BufferAttribute(rt.air.pb, 3));
      pg.setAttribute('aC', new THREE.Float32BufferAttribute(rt.air.pc, 3)); pg.setAttribute('aM', new THREE.Float32BufferAttribute(rt.air.pm, 4));
      const pm = new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color(0x9fdcff) }, uI: { value: 0 }, uT: { value: 0 }, uP: { value: 0.3 }, uPS: { value: 400 }, uG: { value: m.material.uniforms.uG.value } },
        vertexShader: 'attribute vec3 aA; attribute vec3 aB; attribute vec3 aC; attribute vec4 aM; uniform float uG[8]; uniform float uT; uniform float uPS; varying float vA; void main(){'
          + ' float g = uG[int(aM.x + 0.5)]; float ph = fract(aM.y + uT * aM.z * 0.22); vec3 p = mix(mix(aA, aB, ph), mix(aB, aC, ph), ph);'
          + ' p += vec3(sin(ph * 9.0 + aM.y * 40.0 + uT * 1.3), sin(ph * 7.0 + aM.y * 23.0 - uT * 0.9) * 0.6, cos(ph * 8.0 + aM.y * 31.0 + uT * 1.1)) * (0.015 + 0.11 * ph);'
          + ' vA = step(ph, g * 1.02) * smoothstep(0.0, 0.14, ph) * (1.0 - smoothstep(0.5, 1.0, ph)) * smoothstep(0.0, 0.2, g);'
          + ' gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); gl_PointSize = clamp(aM.w * (0.7 + 1.3 * ph) * uPS / max(gl_Position.w, 0.1), 1.0, 48.0); }',
        fragmentShader: 'uniform vec3 uC; uniform float uI; uniform float uP; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5);'
          + ' float a = smoothstep(0.5, 0.0, d); a *= a * vA * uI * uP; gl_FragColor = vec4(mix(uC, vec3(1.0), 0.55), a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
        transparent: true, depthWrite: false });
      const pts = new THREE.Points(pg, pm); pts.userData.noMerge = true; pts.renderOrder = 6; pts.visible = false; pts.frustumCulled = false; scene.add(pts); rt.airPts = pts; rt.air = null;
      // ordem em que as unidades ligam (e em que a câmera as visita): ao longo do cômodo, de z menor para maior
      rt.airOrder = rt.airUnits.map((_, i) => i).sort((a, b) => (rt.airUnits[a].p.z - rt.airUnits[b].p.z) || (rt.airUnits[a].p.x - rt.airUnits[b].p.x));
    }

    // Decoração por ambiente (funções room*, no topo do arquivo)
    // @room templo_palco
    roomTemploPalco(ctx(21));
    // @endroom
    // @room templo_plateia
    roomTemploPlateia(ctx(22));
    // @endroom
    // @room hall
    roomHall(ctx(23));
    // @endroom
    // @room ala_direita
    roomAlaDireita(ctx(24));
    // @endroom
    // @room administrativo
    roomAdministrativo(ctx(25));
    // @endroom
    // @room servico_patio
    roomServicoPatio(ctx(26));
    // @endroom
    // @room fachada
    roomFachada(ctx(27));
    // @endroom
  }

  // Conteúdo do telão (canvas 2,8 : 1, como o painel de 8,4 × 3,0 m): fundo roxo/azul com feixes e o logo oficial (drawLogo).
  // Parado: logo completo no centro. Tocando: marca (anel + B) em cima, título e "BASE MUSIC".
  _drawTelao(title) {
    const tv = this._items.get('telao'); if (!tv || !tv.canvas) return;
    title = title || '';
    if (tv.drawn === title) return; tv.drawn = title;
    const g = tv.canvas.getContext('2d'), W = tv.canvas.width, Hh = tv.canvas.height, k = Hh / 580;
    const bg = g.createLinearGradient(0, 0, W, Hh); bg.addColorStop(0, '#1d1040'); bg.addColorStop(0.55, '#3b2080'); bg.addColorStop(1, '#10306e');
    g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
    g.globalCompositeOperation = 'lighter';
    const nb = 8;
    for (let i = 0; i < nb; i++) {
      const x = W * (i + 0.5) / nb, sk = (i - (nb - 1) / 2) * 34 * k, gr = g.createLinearGradient(0, 0, 0, Hh);
      gr.addColorStop(0, 'rgba(190,160,255,0.3)'); gr.addColorStop(1, 'rgba(190,160,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x - 14 * k, 0); g.lineTo(x + 14 * k, 0); g.lineTo(x + 130 * k + sk, Hh); g.lineTo(x - 130 * k + sk, Hh); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.save(); g.shadowColor = 'rgba(200,180,255,0.8)'; g.shadowBlur = 18 * k;
    if (!title) {
      const lh = Hh * 0.62, lw = lh / logoAspect('full'); drawLogo(g, (W - lw) / 2, (Hh - lh) / 2, lw, { layout: 'full', color: '#ffffff' });
    } else {
      const mw = 170 * k; drawLogo(g, (W - mw) / 2, 44 * k, mw, { layout: 'mark', color: '#ffffff' });
      const font = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${Math.round(74 * k)}px ${font}`; g.fillText(title, W / 2, 318 * k, W - 160);
      g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 ${Math.round(32 * k)}px ${LOGO_FONT}`;
      if ('letterSpacing' in g) g.letterSpacing = `${Math.round(11 * k)}px`;
      g.fillText('BASE MUSIC', W / 2, 418 * k);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    }
    g.restore();
    tv.tex.needsUpdate = true;
  }

  // Moldura desfocada (branco nas bordas de um retângulo interno, preto dentro e fora) para halos
  // aditivos em volta de telas: o miolo fica preto e não lava a imagem. Padrão (ctx.glowPlane 'frame'):
  // interno 6,0 × 3,4 num plano de 8,4 × 5,8; o telão usa interno 8,4 × 3,0 num plano de 10,6 × 4,8.
  _frameGlowTex(iwM = 6.0, ihM = 3.4, owM = 8.4, ohM = 5.8) {
    const key = [iwM, ihM, owM, ohM].join('x'); this._fgTex = this._fgTex || {};
    if (this._fgTex[key]) return this._fgTex[key];
    const W = 256, Hh = Math.max(64, Math.round(256 * ohM / owM));
    const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
    const iw = W * iwM / owM, ih = Hh * ihM / ohM, ix = (W - iw) / 2, iy = (Hh - ih) / 2;
    g.shadowColor = '#fff'; g.shadowBlur = 26; g.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) g.fillRect(ix, iy, iw, ih);
    g.shadowBlur = 0; g.fillStyle = '#000'; g.fillRect(ix, iy, iw, ih);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this._fgTex[key] = t; return t;
  }
  // Sombras das PointLights são desenhadas uma vez (autoUpdate = false). Pede um redesenho
  // só das luzes de `key` (ou de todas, sem argumento) — ex.: a porta do hall girou.
  _refreshPointShadows(key) {
    for (const [k, rt] of this._items) {
      if (key && k !== key) continue;
      for (const { L } of rt.lights || []) if (L.castShadow) L.shadow.needsUpdate = true;
    }
    if (this._pool && !key) for (const L of this._pool) L.userData.cand = null;   // media: vaga sem luminária → redesenha ao voltar
    this._needShadow = true;
  }

  // PC lento demais (governador, só no `auto`): media → o conjunto fixo cai para 6 luzes (as com sombra ficam); os outros níveis
  // ficam com MIN_LIGHTS[item] luzes por item (as com sombra primeiro), o resto soma a intensidade na vizinha. Recompila uma vez, em paralelo.
  _shrinkLights() {
    if (this._pool) {
      const drop = this._pool.filter((L) => !L.castShadow).slice(0, this._pool.length - 6);
      for (const L of drop) this._scene.remove(L);
      this._pool = this._pool.filter((L) => !drop.includes(L)); this._nLights -= drop.length;
      console.info(`[igreja3d-card] PC lento: ${this._pool.length} luzes reais`);
    } else {
      let n = 0;
      for (const key of SHRINK_ORDER) {
        const rt = this._items.get(key); if (!rt || !rt.lights || !rt.lights.length) continue;
        const max = MIN_LIGHTS[key] || 0, all = rt.lights.slice().sort((a, b) => (b.L.castShadow ? 1 : 0) - (a.L.castShadow ? 1 : 0));
        const kept = all.slice(0, max);
        for (const d of all.slice(max)) {
          const near = kept.slice().sort((a, b) => a.L.position.distanceTo(d.L.position) - b.L.position.distanceTo(d.L.position))[0];
          if (near) { const f = Math.sqrt((near.i + d.i) / near.i); near.i += d.i; near.L.distance *= Math.min(1.35, f); }
          this._scene.remove(d.L); if (d.L.shadow && d.L.shadow.map) d.L.shadow.map.dispose(); this._nLights--; n++;
        }
        rt.lights = kept;
      }
      console.info(`[igreja3d-card] PC lento: ${n} luzes reais a menos (${this._nLights} no total)`);
    }
    this._poolSig = ''; this._precompile();
  }
  _shrinkPool() { this._shrinkLights(); }

  // ---- Governador de qualidade ----
  // O nível (alta/media/leve/min) é fixo na construção; em tempo de execução só a resolução se adapta ao TEMPO REAL DE QUADRO:
  // em movimento a escala cai/sobe com histerese (2 janelas lentas de 300 ms para baixar, 4 rápidas para subir); ao parar vem UM
  // quadro nítido (resolução cheia ou maior, se sobra fôlego) cujo custo é medido no rAF seguinte — nunca se desenha só para medir.
  // Só no `auto` (quality manual vale como escolhido) e quando nem a escala mínima aguenta, desce uma escada (gramado chapado, luzes, supersampling).
  _govInit() {
    const t = GOV[this._q] || GOV.leve;
    this._gov = { tier: this._q, auto: this._config.quality === 'auto', moveScale: t.move, moveMin: t.min, moveMax: t.max, idleScale: 1, idleMax: t.idleMax, idleMin: t.idleMin,
      ft: 0, lastAdj: 0, slowWin: 0, fastWin: 0, rung: 0, lastStep: 0, sharpAt: 0, sharpPending: false, sharpFast: 0, slow: 0, slowIdle: 0,
      t0: typeof performance !== 'undefined' ? performance.now() : 0 };
    this._moveScale = t.move;
  }
  _govIdleMax() {
    const g = this._gov, w = Math.max(1, this.clientWidth), h = Math.max(1, this.clientHeight), d = this._dprFull || 1;
    return Math.max(g.idleMin, Math.min(g.idleMax, 3 / d, Math.sqrt(4e6 / (w * h * d * d))));   // nunca acima de 3× DPR nem de 4 Mpx
  }
  _govPR(v) {
    const r = this._renderer; if (Math.abs(r.getPixelRatio() - v) < 0.01) return false;
    r.setPixelRatio(v); return true;
  }
  _govFrame(now, dirty) {
    const g = this._gov || (this._govInit(), this._gov), o = this._orbit;
    const ft = now - (this._lastT || now); this._lastT = now;
    if (o.moving) {
      this._lastMove = now; g.sharpPending = false;
      if (!this._lowRes) { this._lowRes = true; g.ft = 0; if (this._govPR(this._dprFull * g.moveScale)) dirty = true; }
      else if (ft > 0) {
        g.ft = g.ft ? g.ft * 0.8 + ft * 0.2 : ft;
        if (now - g.lastAdj > 300) {
          g.lastAdj = now;
          g.slowWin = g.ft > 40 ? g.slowWin + 1 : 0; g.fastWin = g.ft < 22 ? g.fastWin + 1 : 0;
          if (g.slowWin >= 2) { if (!this._wrap.classList.contains('glass')) g.moveScale = Math.max(g.moveMin, g.moveScale * 0.85); else if (this._govSettled(now)) this._wrap.classList.remove('glass'); g.slowWin = 0; }   // lento: 1º sai o vidro (também com quality fixo), depois a resolução; nos 20 s da entrada nenhum dos dois
          if (g.fastWin >= 4) { g.moveScale = Math.min(g.moveMax, g.moveScale * 1.1); g.fastWin = 0; }
          // escada (só auto): na escala mínima e ainda < 15 quadros/s por ~1,5 s — nunca nos 20 s após carregar
          // (compilação de shaders e texturas subindo dão picos que não dizem nada do aparelho)
          g.slow = g.moveScale <= g.moveMin + 0.01 && g.ft > 66 ? g.slow + 1 : 0;
          if (g.slow >= 5 && now - g.lastStep > 4000 && this._govSettled(now)) this._govStepDown(now);   // pode recompilar (_busy, sem desenhar): o canvas não muda neste quadro
          else if (this._govPR(this._dprFull * g.moveScale)) dirty = true;
          // degrau 1 desfeito: ~6 s de movimento fluido na escala máxima → o gramado com textura volta (a queda foi passageira)
          g.fastRun = g.rung === 1 && g.ft < 25 && g.moveScale >= g.moveMax - 0.01 ? (g.fastRun || 0) + 1 : 0;
          if (g.fastRun >= 20) this._govStepUp(now);
        }
      }
    } else if (this._lowRes && now - (this._lastMove || 0) > 180) {
      // parou: um quadro nítido, na escala parada (medida abaixo); com `dirty` a cena é redesenhada uma vez
      this._lowRes = false; this._govPR(Math.min(this._dprFull * Math.min(g.idleScale, this._govIdleMax()), 3));
      dirty = true; g.sharpAt = now; g.sharpPending = true; g.ft = 0;
    } else if (g.sharpPending) {
      // o rAF seguinte ao quadro nítido só chega depois de o navegador apresentá-lo: o intervalo é o custo real (CPU + GPU)
      g.sharpPending = false;
      if (!dirty) this._govSharp(now - g.sharpAt);
    }
    this._ft = g.ft; this._moveScale = g.moveScale; this._lastAdj = g.lastAdj;   // espelhos (ferramentas de teste)
    return dirty;
  }
  _govSharp(ms) {
    const g = this._gov;
    if (ms > 250) {
      g.sharpFast = 0;
      if (this._wrap.classList.contains('glass')) { if (this._govSettled(performance.now())) this._wrap.classList.remove('glass'); }   // quadro nítido lento: o vidro sai antes da resolução (passados os picos da entrada)
      else if (g.idleScale > g.idleMin + 0.01) g.idleScale = Math.max(g.idleMin, g.idleScale * 0.85);   // o próximo quadro nítido é mais leve: sem travar a página
      else if (g.auto && ms > 400 && ++g.slowIdle >= 3 && performance.now() - g.lastStep > 4000 && this._govSettled(performance.now())) this._govStepDown(performance.now());
    } else if (ms < 30) {
      g.slowIdle = 0;
      if (++g.sharpFast >= 2) { g.idleScale = Math.min(this._govIdleMax(), g.idleScale * 1.15); g.sharpFast = 0; }   // sobra fôlego: resolução acima da cheia
    } else { g.sharpFast = 0; g.slowIdle = 0; }
  }
  // Degraus (só no auto): 1 entorno = gramado de cor chapada, o chão de 800 m que cobre boa parte da tela (v1.8: ruas, árvores e postes
  // não existem mais; volta sozinho se o PC se mostrar rápido) · 2 menos luzes reais · 3 sem supersampling
  // parado e escala mínima menor em movimento. A sombra do sol e a resolução cheia parada NUNCA caem (v1.4.3: a sombra
  // em 512² e a parada abaixo da cheia deixavam a imagem borrada)
  _govSettled(now) { return !this._busy && now - (this._gov.t0 || 0) > 20000; }
  _govStepUp(now) {
    const g = this._gov; if (g.rung !== 1) return;
    g.rung = 0; g.lastStep = now; g.fastRun = 0;
    if (g.entornoAuto && !this._entornoOn) this._setEntorno(true);
    console.info('[igreja3d-card] governador: de volta ao degrau 0 — entorno ligado');
    if (this._orbit) this._orbit.dirty = true;
  }
  _govStepDown(now) {
    const g = this._gov; if (!g.auto || g.rung >= 3) return;
    g.rung++; g.lastStep = now; g.slow = g.slowIdle = 0; g.fastRun = 0; this._wrap.classList.remove('glass');
    if (g.rung === 1) {
      g.entornoAuto = this._entornoOn && (this._config.entorno === 'auto' || this._config.entorno == null);
      if (g.entornoAuto) this._setEntorno(false);
    } else if (g.rung === 2) this._shrinkLights();
    else { g.idleMax = Math.min(g.idleMax, 1); g.idleScale = Math.min(g.idleScale, 1); g.moveMin = Math.max(0.3, g.moveMin - 0.05); }
    console.info(`[igreja3d-card] governador: degrau ${g.rung} — entorno ${this._entornoOn ? 'ligado' : 'desligado'}, ${this._nLights} luzes reais`);
    if (this._orbit) this._orbit.dirty = true;
  }
  // estado do governador (testes/demo)
  getQuality() {
    const g = this._gov || {};
    return { tier: this._q, auto: !!g.auto, rung: g.rung || 0, moveScale: g.moveScale, idleScale: g.idleScale, ftEMA: g.ft, lights: this._nLights, entorno: !!this._entornoOn };
  }

  // media: redistribui o conjunto fixo de luzes (_pool) às luminárias acesas que importam no enquadramento (chamado
  // com a câmera parada). Cada item aceso e visível ganha 1 luz (os que pesam mais primeiro: intensidade ÷ distância²
  // à câmera); as que sobram vão a quem pesa mais (D'Hondt). Dentro do item as escolhidas se espalham (a mais forte,
  // depois as mais afastadas das já escolhidas) e somam a intensidade das vizinhas sem luz, como no leve. As vagas com
  // sombra vão às luminárias marcadas `shadow`. De longe fica parecido com o leve; perto de um cômodo, igual ao alta.
  _assignPool() {
    const pool = this._pool, cam = this._camera, cp = cam.position, sph = new THREE.Sphere(), groups = [];
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const rt of this._items.values()) {
      if (!rt.cands) continue;
      rt.lights = [];
      if (Math.max(rt.target * (rt.brightScale || 1), rt.level) < 0.01) continue;
      const vis = rt.cands.filter((c) => fr.intersectsSphere(sph.set(c.p, c.d * 0.7)));
      for (const c of vis) c.w = c.i / Math.max(16, c.p.distanceToSquared(cp));
      if (vis.length) groups.push({ rt, vis, n: 0, w: vis.reduce((a, c) => a + c.w, 0) });
    }
    groups.sort((a, b) => b.w - a.w);
    let free = pool.length;
    for (const g of groups) if (free > 0) { g.n = 1; free--; }
    for (; free > 0; free--) {
      let best = null;
      for (const g of groups) if (g.n < g.vis.length && (!best || g.w / (g.n + 1) > best.w / (best.n + 1))) best = g;
      if (!best) break;
      best.n++;
    }
    const picks = [];
    for (const g of groups) {
      if (!g.n) continue;
      const rest = g.vis.slice().sort((a, b) => b.w - a.w), pick = [rest.shift()];
      while (pick.length < g.n) {
        let bi = 0, bv = -1;
        rest.forEach((c, k) => { const v = c.w * Math.min(...pick.map((q) => q.p.distanceTo(c.p))); if (v > bv) { bv = v; bi = k; } });
        pick.push(rest.splice(bi, 1)[0]);
      }
      // quem ficou sem luz soma a intensidade na escolhida mais próxima, se estiver ao alcance dela
      const sum = new Map(pick.map((q) => [q, q.i]));
      for (const c of g.rt.cands) {
        if (sum.has(c)) continue;
        let near = pick[0]; for (const q of pick) if (q.p.distanceTo(c.p) < near.p.distanceTo(c.p)) near = q;
        if (near.p.distanceTo(c.p) < near.d * 0.8) sum.set(near, sum.get(near) + c.i);
      }
      for (const q of pick) picks.push({ c: q, rt: g.rt, i: sum.get(q) });
    }
    // vagas com sombra: primeiro às marcadas mais relevantes; a luminária que já estava numa vaga fica nela
    // (a sombra não precisa ser redesenhada); vaga com sombra usada por outra vira luz comum (sombra 0)
    picks.sort((a, b) => (b.c.shadow - a.c.shadow) || (b.c.w - a.c.w));
    const nS = pool.filter((L) => L.castShadow).length;
    picks.forEach((pk, k) => { pk.S = pk.c.shadow && k < nS; });
    const free2 = new Set(pool), take = (pk, same) => {
      for (const want of pk.S ? [true] : same ? [false] : [false, true]) for (const L of free2) if (L.castShadow === want && (!same || L.userData.cand === pk.c)) { free2.delete(L); return L; }
      return null;
    };
    for (const pk of picks) pk.L = take(pk, true);
    for (const pk of picks) if (!pk.L) pk.L = take(pk, false);
    for (const L of free2) { L.intensity = 0; L.userData.cand = null; }
    for (const { L, c, rt, i, S } of picks) {
      if (!L) continue;
      L.position.copy(c.p); L.distance = c.d * Math.min(1.35, Math.sqrt(i / c.i));
      rt.lights.push({ L, i });
      if (L.castShadow) {
        L.shadow.intensity = S ? 1 : 0;
        if (S && L.userData.cand !== c) { L.shadow.needsUpdate = true; this._needShadow = true; }
      }
      L.userData.cand = S || !L.castShadow ? c : null;
    }
  }

  // Sombra suave junto às paredes (AO falsa): textura branca com bordas escurecidas.
  // edges: n = z mínimo (topo do canvas), s = z máximo, w = x mínimo, e = x máximo
  _makeAO(w, d, edges = 'nsew') {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    const fx = Math.min(0.45, 0.55 / w) * 128, fz = Math.min(0.45, 0.55 / d) * 128;
    const strip = (x0, y0, x1, y1, gx0, gy0, gx1, gy1) => { const gr = g.createLinearGradient(gx0, gy0, gx1, gy1); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, y1 - y0); };
    if (edges.includes('w')) strip(0, 0, fx, 128, 0, 0, fx, 0);
    if (edges.includes('e')) strip(128 - fx, 0, 128, 128, 128, 0, 128 - fx, 0);
    if (edges.includes('n')) strip(0, 0, 128, fz, 0, 0, 0, fz);
    if (edges.includes('s')) strip(0, 128 - fz, 128, 128, 0, 128, 0, 128 - fz);
    const t = new THREE.CanvasTexture(c); t.channel = 0; return t;
  }

  // Rótulo em sprite de tamanho fixo NA TELA (sizeAttenuation: false; a escala é recalculada em
  // _updateLabels para ~12–16 px de fonte) e com teste de profundidade: de dentro do templo o
  // telão e as paredes escondem os nomes das salas de trás. LOD: de longe só os ambientes principais.
  _makeLabel(text, scale = 1, main = false) {
    const c = document.createElement('canvas'); const s = 2; c.width = 320 * s; c.height = 72 * s;
    const g = c.getContext('2d'); g.scale(s, s);
    g.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 7; g.strokeStyle = 'rgba(6,10,20,.9)'; g.strokeText(text, 160, 36, 300);
    g.fillStyle = '#ffffff'; g.fillText(text, 160, 36, 300); const tw = Math.min(300, g.measureText(text).width) + 7;   // largura do texto (com o contorno), em px do canvas
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: false, fog: false }));
    sp.renderOrder = 20; sp.userData.label = { ls: scale, main, font: clamp(13 * Math.sqrt(scale), 11, 16), tw };
    return sp;
  }

  // ---- Estado ----
  _applyDemoDefaults() {
    for (const it of ITEMS) this._setItemState(it.key, { state: 'off', attrs: {} });
    this._renderPanel();
  }

  _syncFromHass() {
    const hass = this._hass; if (!hass || !hass.states) return;
    const sig = ITEMS.map((it) => {
      const s = hass.states[this.entity(it.key)]; if (!s) return 'x';
      const a = s.attributes || {};
      return s.state + '|' + JSON.stringify([a.rgb_color, a.brightness, a.temperature, a.current_temperature, a.hvac_action, a.swing_mode, a.media_title, a.volume_level]);
    }).join(';') + '|' + (hass.states[this.entity('sun')] || {}).state
      + '|' + Object.keys(hass.states).filter((id) => id.startsWith('automation.')).map((id) => { const a = hass.states[id]; return id + ':' + a.state + ':' + ((a.attributes || {}).last_triggered || ''); }).join(',');
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    const seeded = !!this._activitySeeded;
    const turnedOn = [];
    for (const it of ITEMS) {
      const s = hass.states[this.entity(it.key)];
      const prev = this._state[it.key];
      const next = s ? { state: s.state, attrs: s.attributes || {} } : { state: 'unavailable', attrs: {} };
      // ar ligou (off → ligado) depois da carga — pelo cartão, pelo HA ou por automação: cada unidade liga na sua vez (_airStart)
      // e a câmera acompanha (na sincronização inicial não; vários ao mesmo tempo: o cômodo com mais unidades)
      if (seeded && it.kind === 'climate' && prev && !prev.on && !prev.unavailable && !['off', 'unavailable', 'unknown'].includes(next.state)) turnedOn.push(it.key);
      // a temperatura muda o tempo todo: não entra no histórico
      if (seeded && prev && prev.state !== next.state && next.state !== 'unavailable' && it.key !== 'temperatura') this._pushActivity(it.key, next.state, Date.now());
      this._setItemState(it.key, next);
      if (s && s.last_changed) this._lastChanged[it.key] = s.last_changed; else if (!s) delete this._lastChanged[it.key];
    }
    // Automações do HA: descobertas pelo domínio; disparos entram na atividade
    const autos = [];
    for (const st of Object.values(hass.states)) {
      if (!st.entity_id || !st.entity_id.startsWith('automation.')) continue;
      const a = st.attributes || {}; const last = a.last_triggered ? new Date(a.last_triggered).getTime() : 0;
      autos.push({ id: st.entity_id, name: a.friendly_name || st.entity_id.slice(11), on: st.state === 'on', last });
      const prevLast = this._autoLast[st.entity_id];
      if (seeded && prevLast !== undefined && last && last !== prevLast) this._pushActivity(st.entity_id, 'triggered', last);
      this._autoLast[st.entity_id] = last;
    }
    autos.sort((x, y) => y.last - x.last);
    this._autos = autos;
    if (!seeded) {
      for (const a of autos) if (a.last) this._pushActivity(a.id, 'triggered', a.last, true);
      // Semente do histórico: última mudança de cada entidade, conforme o HA reporta
      for (const it of ITEMS) { const st = this._state[it.key]; if (it.key !== 'temperatura' && st && !st.unavailable && this._lastChanged[it.key]) this._pushActivity(it.key, st.state, new Date(this._lastChanged[it.key]).getTime(), true); }
      this._activitySeeded = true;
      if (this._panelOpen && !this._room) this._setZone(this._onKeys().length ? 'on' : '');   // 1º retrato do HA chegou com o painel aberto: "Ligados" se houver
    }
    this._renderPanel();
    this._timeAt = 0;
    this._applyMode();
    if (turnedOn.length) this._airStart(turnedOn);
  }

  _setItemState(key, { state, attrs }) {
    const it = ITEMS.find((i) => i.key === key); const rt = this._items.get(key); if (!it || !rt) return;
    attrs = attrs || {};
    const unavailable = state === 'unavailable' || state === 'unknown';
    let on = false, val = '';
    if (it.kind === 'light' || it.kind === 'switch') on = state === 'on';
    else if (it.kind === 'climate') {
      on = !unavailable && state !== 'off';
      const t = attrs.temperature, cur = attrs.current_temperature;
      val = unavailable ? 'indisponível' : (on ? `${HVAC_PT[state] || state}${t != null ? ' · ' + t + '°' : ''}` : 'Desligado') + (cur != null ? ` · ${cur}° atual` : '');
    } else if (it.kind === 'media') {
      on = state === 'playing' || state === 'on' || state === 'paused';
      val = unavailable ? 'indisponível' : (MEDIA_PT[state] || state);
      if (state === 'playing' && attrs.media_title) val = attrs.media_title;
      rt.playing = state === 'playing';
      if (key === 'telao') this._drawTelao(on ? attrs.media_title || '' : '');
    } else if (it.kind === 'sensor') {
      if (key === 'presenca') { on = state === 'on'; val = unavailable ? 'indisponível' : on ? 'pessoas no templo' : 'vazio'; }
      else if (key === 'porta') { on = state === 'on'; val = unavailable ? 'indisponível' : on ? 'aberta' : 'fechada'; }
      else if (key === 'temperatura') { const n = parseFloat(state); on = !unavailable && !isNaN(n); val = on ? `${(Math.round(n * 10) / 10).toLocaleString('pt-BR')} °C` : 'indisponível'; }
      else { on = state === 'on'; val = unavailable ? 'indisponível' : state; }
    }
    if ((it.kind === 'light' || it.kind === 'switch') && unavailable) val = 'indisponível';
    this._state[key] = { on, state, attrs, unavailable };
    rt.target = on ? 1 : 0;
    // brilho (qualquer luz dimerizável) e cor (RGB)
    rt.brightScale = it.kind === 'light' && attrs.brightness != null ? clamp(attrs.brightness / 255, 0.08, 1) : 1;
    if (it.rgb) {
      const rgb = attrs.rgb_color;
      const c = rgb ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : new THREE.Color(it.color);
      rt.color.copy(c);
      for (const f of rt.fixtures || []) if (f.material && f.material.emissive) f.material.emissive.copy(c);
    }
    if (it.kind === 'climate') { rt.hvac = state; if (on) rt.hvacOn = state; rt.on = on; if (!this._activitySeeded) rt.snap = true; }   // na carga inicial as unidades já estão como o HA diz, sem animar
    this._state[key].text = val;
    if (this._orbit) this._orbit.dirty = true;   // luz acende/apaga: um quadro novo, sem refazer as sombras (cada luz marca a sua: _refreshPointShadows, _assignPool)
  }


  // Relógio + sol: hora local (ou simulada), elevação/azimute (do HA quando houver)
  _updateTime(force = false) {
    const now = Date.now();
    if (!force && this._timeAt && now - this._timeAt < 1000) return;
    this._timeAt = now;
    const cfg = this._config, hc = this._hass && this._hass.config;
    const lat = hc && hc.latitude != null ? hc.latitude : cfg.latitude, lon = hc && hc.longitude != null ? hc.longitude : cfg.longitude;
    const tz = (hc && hc.time_zone) || cfg.timezone;
    const date = this._simTime ? new Date(this._simTime) : new Date(now);
    let sun = null;
    const hs = this._hass && this._hass.states && this._hass.states[this.entity('sun')];
    if (!this._simTime && hs && hs.attributes && hs.attributes.elevation != null) sun = { elevation: +hs.attributes.elevation, azimuth: +hs.attributes.azimuth };
    else sun = solarPosition(date, lat, lon);
    this._sunInfo = sun;
    let per; const el = sun.elevation;
    let hour = date.getHours();
    try { hour = +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(date); } catch (_) {}
    if (el > 6) per = hour < 12 ? 'Manhã' : 'Tarde'; else if (el > -4) per = hour < 12 ? 'Amanhecer' : 'Entardecer'; else per = hour < 5 || hour >= 22 ? 'Noite' : hour < 12 ? 'Madrugada' : 'Noite';
    let dt = '';
    try { dt = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(date).replace(/\./g, ''); } catch { dt = date.toLocaleDateString('pt-BR'); }
    this._tzNow = tz;
    // nascer/pôr do sol do dia (varredura de 5 em 5 min; recalcula uma vez por dia) e o céu do trilho da hora (noite · nascer · dia · pôr · noite)
    const dayKey = Math.floor((date.getTime() - 3 * 3600000) / 86400000);
    if (this._sunDay !== dayKey) {
      this._sunDay = dayKey; let rise = null, set = null, prev = null;
      const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
      for (let m = 0; m <= 1440; m += 5) { const el2 = solarPosition(new Date(d0.getTime() + m * 60000), lat, lon).elevation; if (prev !== null) { if (prev < -0.83 && el2 >= -0.83) rise = d0.getTime() + m * 60000; if (prev >= -0.83 && el2 < -0.83) set = d0.getTime() + m * 60000; } prev = el2; }
      this._sunTimes = { rise, set };
      const r = rise ? this._dayMin(rise) : 360, s = set ? this._dayMin(set) : 1090, f = (m) => `calc(12px + (100% - 24px) * ${clamp(m / 1439, 0, 1).toFixed(4)})`;   // a cor sob o CENTRO do polegar (24 px: anda de 12 a 100% − 12)
      if (this._hrRange) this._hrRange.style.setProperty('--sky', `linear-gradient(90deg, #1c2758 ${f(r - 60)}, #ff9a4d ${f(r)}, #8cc8f0 ${f(r + 90)}, #5aa9e6 ${f((r + s) / 2)}, #8cc8f0 ${f(s - 90)}, #ff7f3a ${f(s)}, #1c2758 ${f(s + 60)})`);
    }
    if (!this._clockEl || !this._menuOn) return;   // a hora mora na lista suspensa: fechada, nada a escrever
    const stt = this._sunTimes || {}, live = !this._simTime, hm = fmtClock(date, tz);
    this._clockEl.textContent = hm; this._clockSub.textContent = `${dt} · ${per}${live ? '' : ' · simulado'}`;
    this._clockSun.innerHTML = stt.rise && stt.set ? `${iconSvg('sun')} nasce ${fmtClock(stt.rise, tz)} · põe ${fmtClock(stt.set, tz)}` : '';   // no fuso da igreja, não no do navegador
    this._hrRange.value = this._dayMin(date); this._hrRange.setAttribute('aria-valuetext', `${hm}, ${per}${live ? ', agora' : ', simulado'}`);
    this._hrLive.setAttribute('aria-pressed', String(live)); this._hrLive.title = live ? 'Hora real (relógio)' : 'Voltar para a hora real';
  }
  _dayMin(ts) {   // minuto do dia no fuso da igreja
    try { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: this._tzNow, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts).split(':'); return h * 60 + +m; } catch { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
  }
  setSimTime(date) { this._simTime = date ? new Date(date).getTime() : null; this._updateTime(true); this._orbit.dirty = true; }
  _applyMode() {
    this._updateTime(true);
    const el = this._sunInfo ? this._sunInfo.elevation : -20;
    const night = this._mode === 'night' ? true : this._mode === 'day' ? false : el < 1;
    this._night = night;
    for (const [m, b] of Object.entries(this._modeBtns)) b.setAttribute('aria-pressed', m === this._mode ? 'true' : 'false');
    this._nvBtn.setAttribute('aria-pressed', this._nightVision ? 'true' : 'false');
    this._nvSync();
  }

  // Visão noturna só vale à noite: de dia o item fica desabilitado e diz por quê ("só à noite")
  _nvSync() {
    const b = this._nvBtn, day = !this._night; b.disabled = day; b.style.opacity = day ? '.55' : '';
    b.querySelector('.ml').innerHTML = day ? 'Visão noturna <small class="mnote">só à noite</small>' : 'Visão noturna';
    b.title = day ? 'Disponível só à noite (de dia a igreja já está iluminada)' : 'À noite, deixa a igreja inteira visível (luz de lua)';
  }
  _setLabels(on) {
    this._labelsOn = on;
    // no modo Fachada os rótulos (desenhados por cima de tudo) ficariam soltos na frente das paredes altas
    for (const s of this._labels || []) s.visible = on && !this._roofOn;
    this._labelsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this._updateLabels(); if (this._orbit) this._orbit.dirty = true;
  }
  // Tamanho fixo na tela (fonte ~12–16 px), some perto da câmera (< 5 m, esmaecendo até 9 m) e,
  // com a câmera a mais de 35 m do alvo, só os ambientes principais (Templo, Hall, Estacionamento…)
  _updateLabels() {
    if (!this._labels || !this._labelsOn || this._roofOn || !this._camera) return;
    const cam = this._camera, k = 2 * Math.tan(cam.fov * Math.PI / 360) / (this._vh || 600);
    // celular (tela estreita): de longe só os maiores (Templo, Hall, Estacionamento, Pastoral, Pátio) — os outros se sobrepõem
    const narrow = (this.clientWidth || 1000) < 560;
    // na Vista de cima (tela larga) todos os cômodos ficam rotulados: é para conferir as automações de cada um
    const far = this._orbit && cam.position.distanceTo(this._orbit.target) > 35 && !(this._topView && !narrow);
    // câmera baixa (dentro do prédio / altura de gente): só os rótulos até ~20 m, os do fundo não poluem
    const reach = cam.position.y < 8 ? 20 : 1e9;
    // Vista de cima aproximada num bloco/cômodo: só os rótulos de dentro dele
    const reg = this._topView && this._nav && this._nav.level >= 1 ? this._navRects() : null, lv0 = this._topView && !reg;   // planta: só os nomes dos blocos
    for (const s of this._labels) {
      const L = s.userData.label; if (!L) continue;
      const d = cam.position.distanceTo(s.position);
      const inReg = !reg || reg.some(([x0, z0, x1, z1]) => s.position.x >= x0 - 1 && s.position.x <= x1 + 1 && s.position.z >= z0 - 1 && s.position.z <= z1 + 1);
      const op = inReg && (L.blk ? lv0 : !lv0 && L.top !== !this._topView) ? clamp((d - 5) / 4, 0, 1) * clamp((reach - d) / 4, 0, 1) * (far && (!L.main || (narrow && L.ls < 1)) ? 0 : 1) : 0;
      s.visible = op > 0.02; s.material.opacity = op;
      const hpx = L.font * (this._topView ? 2.6 : 3);   // texto de 24 px num canvas de 72 px → sprite com 3× a altura da fonte (menor na Vista de cima)
      s.scale.set(hpx * k * 320 / 72, hpx * k, 1);
      if (L.blk && s.visible) {   // nome do bloco na planta: o texto inteiro dentro da faixa visível (no celular o do Hall de entrada saía pela borda)
        const W = this.clientWidth || 1, P = this._pNow || 0, half = hpx * L.tw / 144, x = (_lbl.copy(s.position).project(cam).x + 1) / 2 * W;
        s.center.x = 0.5 - (clamp(x, Math.min(P + 8 + half, W / 2), Math.max(W - 8 - half, W / 2)) - x) / (hpx * 320 / 72);
      }
    }
  }

  // Posição inicial da câmera: prédio inteiro (lote ~20 × 60 m) em diagonal, por cima,
  // vendo a fachada; em telas estreitas (retrato) sobe e afasta para caber tudo.
  // A câmera vem da frente (lado do estacionamento), um pouco à direita e alta: a fachada com o
  // painel ripado e o logo fica de frente e legível, e o interior (palco/telão) aparece por cima das paredes.
  _homeFor(aspect) {
    if (aspect < 1.0) {
      // retrato: vista mais de cima, com o comprimento do lote na vertical da tela (a faixa visível já desconta o HUD e o painel lateral: ver _resize)
      const target = new THREE.Vector3(9.5, 0, 31);
      const dir = new THREE.Vector3(0.45, 1.6, 1.0).normalize();
      return { pos: target.clone().addScaledVector(dir, 66 * Math.sqrt(1 / Math.max(aspect, 0.3))), target };
    }
    // paisagem: abaixo de 1,8 o limite é a largura → afasta
    // o palco fica na parede alta x = 0 virado para +x: a câmera vem um pouco da direita para ver o palco/telão em
    // diagonal e ainda ler o logo do ripado da fachada (z 49,65); a parede alta vira o fundo da cena, não esconde o interior
    const target = new THREE.Vector3(9.8, 0, 33.5);
    const dir = new THREE.Vector3(0.62, 1.2, 1.0).normalize();
    const k = aspect >= 1.8 ? 1 : 1.8 / aspect;
    return { pos: target.clone().addScaledVector(dir, 47 * k), target };
  }
  _setRoof(on) {
    this._roofOn = !!on;
    if (this._roofOn && this._topView) this._setTopView(false, true);   // Fachada tira da planta (os rótulos já somem)
    if (this._ext) this._ext.visible = this._roofOn;
    if (this._items) this._refreshPointShadows();   // paredes altas entram/saem: refaz as sombras das luzes uma vez
    if (this._labelsBtn) this._setLabels(!!this._labelsOn);
    this._roofBtn.setAttribute('aria-pressed', this._roofOn ? 'true' : 'false');
    this._needShadow = true; this._orbit.dirty = true;
  }
  // Vista de cima, nível 0 (v1.6.1): de frente para o palco, como quem está na plateia — câmera do lado +x olhando para −x. v1.7: a igreja
  // inteira na largura (z 0–52, dos Fundos à Entrada; em retrato também: a câmera só afasta). v1.8: mais alta, inclinada para o palco
  // (polar 0,62 ≈ 54° acima do horizonte, antes 38°): os blocos aparecem como áreas e não como uma faixa fina. A distância sai das quinas
  // da planta (piso, topo das paredes e da parede do palco) projetadas na faixa visível, com 3 % de folga, e o desenho fica no meio dela:
  // medida só no alvo, a perspectiva aumentava o lado de perto e a Sala Pastoral e o Hall de entrada saíam pelas bordas
  _topFor(aspect) {
    const tv = Math.tan(this._camera.fov * Math.PI / 360) * 0.97, th = tv * aspect;
    const w = new THREE.Vector3().setFromSphericalCoords(1, 0.62, Math.PI / 2), r = new THREE.Vector3(0, 1, 0).cross(w).normalize(), u = w.clone().cross(r);   // para a câmera · direita · cima da tela
    const g = new THREE.Vector3(u.x, 0, u.z).normalize(), gu = g.dot(u);   // no piso, o rumo que sobe na tela
    const P = [[0, 0, 0], [0, 0, 52], [20.1, 0, 0], [20.1, 0, 52], [20.1, H, 0], [20.1, H, 52], [0, 8.6, 12.4], [0, 8.6, 44]].map((q) => new THREE.Vector3(...q));
    const target = new THREE.Vector3(10, 0, 26), v = new THREE.Vector3();
    const fit = () => Math.max(...P.map((q) => { v.subVectors(q, target); return v.dot(w) + Math.max(Math.abs(v.dot(r)) / th, Math.abs(v.dot(u)) / tv); }));
    for (let i = 0; i < 3; i++) {   // cabe tudo → centra o desenho na faixa → mede de novo
      const d = fit(), sx = [], sy = [];
      for (const q of P) { v.subVectors(q, target); const z = d - v.dot(w); sx.push(v.dot(r) / z); sy.push(v.dot(u) / z); }
      target.addScaledVector(r, (Math.min(...sx) + Math.max(...sx)) / 2 * d).addScaledVector(g, (Math.min(...sy) + Math.max(...sy)) / 2 * d / gu);
    }
    return { pos: target.clone().addScaledVector(w, fit()), target };
  }
  // O painel fica como está (v1.7, como na Casa): o cômodo tocado aparece nele
  _setTopView(on, keepCamera = false) {
    if (this._walkOn && this._setWalk) this._setWalk(false);   // sai da visão de pessoa
    const ch = !!on !== !!this._topView;   // o voo do ar chama de fora dela: o cômodo aberto no painel fica
    this._topView = !!on; this._nav = { level: 0, block: null, room: null }; this._clearHover(); this._select(null); if (this._dock && ch) this._showRoom(null);
    if (this._mezz) { this._mezz.visible = !this._topView; this._needShadow = true; }   // a planta enxerga os cômodos que ficam sob o mezanino
    if (this._navRow) this._renderNav();
    if (this._topBtn) this._topBtn.setAttribute('aria-pressed', this._topView ? 'true' : 'false');
    if (this._topView && this._roofOn) this._setRoof(false);   // sem cobertura/fachada: o interior fica à mostra
    if (!keepCamera) this._resetView(true);
    if (this._orbit) this._orbit.dirty = true;
  }
  _resetView(fly = false) {
    const a = this._camera.aspect, n = this._nav;
    // Vista de cima: enquadra o nível atual da navegação (planta inteira · bloco · cômodo)
    this._home = !this._topView ? this._homeFor(a)
      : n.level === 2 && n.room ? this._frameRect(...(n.room.frame || this._rectsBox(n.room.rects)), 1.0)
      : n.level === 1 && n.block ? this._frameRect(...n.block.box, 2.0) : this._topFor(a);
    if (fly) this._flyCam(this._home.pos, this._home.target, 3.2); else this._orbit.reset(this._home.pos, this._home.target);
    this._orbit.touched = false;
  }
  // voo suave da câmera; com prefers-reduced-motion corta direto para a pose
  _flyCam(pos, target, speed) {
    const o = this._orbit; o.fly(pos, target, speed);
    if (this._reduced) { o.sph.copy(o.goal); o.target.copy(o.targetGoal); o.speed = 9; }
    o.dirty = true;
  }

  // ---- Vista de cima navegável: Planta → bloco → cômodo → aparelho ----
  // BLOCKS resolvido com ZONES (retângulos) e os aparelhos de cada cômodo (chaves de ITEMS, mais o que tem luminária/ar dentro dele).
  _buildBlocks() {
    this._hlGeo = new THREE.PlaneGeometry(1, 1);
    this._hlMat = new THREE.MeshBasicMaterial({ color: 0x409cff, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false, toneMapped: false });   // cômodo escolhido: o mesmo azul do --focus (foco e seleção), não luz acesa
    this._hl = new THREE.Group(); this._hl.visible = false; this._hl.userData.keep = true; this._scene.add(this._hl);
    this._hlShow([[0, 0, 1, 1]]); this._hl.visible = false;   // uma peça pronta (o material entra no _precompile)
    // marcador do destino da caminhada (visão de Pessoa): anel âmbar + ponto no piso
    const mkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.2, 40), mkMat), dot = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), mkMat);
    ring.material = mkMat.clone(); ring.rotation.x = dot.rotation.x = -Math.PI / 2; ring.renderOrder = dot.renderOrder = 30;
    this._mk = new THREE.Group(); this._mk.add(ring, dot); this._mk.visible = false; this._mk.userData.keep = true; ring.userData.noMerge = dot.userData.noMerge = true; this._scene.add(this._mk);
    const near = (rs, x, z, m) => rs.some(([rx, rz, w, d]) => x >= rx - m && x <= rx + w + m && z >= rz - m && z <= rz + d + m);
    const pts = ITEMS.map((it) => {
      const rt = this._items.get(it.key);
      return { key: it.key, p: (it.fixtures || []).filter((f) => !f.ext).map((f) => [(f.l || f.p)[0], (f.l || f.p)[2]]).concat(((rt && rt.airUnits) || []).map((u) => [u.p.x, u.p.z])) };
    });
    this._blocks = Object.entries(BLOCKS).map(([id, b]) => {
      const rooms = b.rooms.map((r) => {
        const rects = r.rects || r.zones.flatMap((z) => ZONES[z].rects.map((q) => q.slice(0, 4)));
        const items = new Set(r.items || []);
        if (!r.noauto) for (const q of pts) if (q.p.some(([x, z]) => near(rects, x, z, 0))) items.add(q.key);   // só o que está dentro do cômodo (com folga pegava o ar do vizinho)
        return { id: r.id, label: r.label, rects, zones: r.zones, frame: r.frame, items: [...items].filter((k) => ITEMS.some((i) => i.key === k)) };
      });
      const blk = { id, label: b.label, flat: !!b.flat, box: b.box, lp: b.lp, rooms, zones: [...new Set(rooms.flatMap((r) => r.zones))], rects: rooms.flatMap((r) => r.rects) };   // rects: realce e rótulos do bloco
      for (const r of rooms) r.block = blk;
      return blk;
    });
    // na lista do painel cada aparelho fica num cômodo só (HOME, ou o 1º que o tem): r.own
    const home = {}, all = this._blocks.flatMap((b) => b.rooms); for (const r of all) for (const k of r.items) home[k] = home[k] || HOME[k] || r.id;
    for (const r of all) r.own = r.items.filter((k) => home[k] === r.id);
    for (const b of this._blocks) b.items = b.flat ? [...new Set(b.rooms.flatMap((r) => r.items))] : b.rooms.flatMap((r) => r.own);   // o bloco: os aparelhos próprios dos cômodos dele · lista única: todos os dos cômodos (a luz do Pátio, que é a do Estacionamento, entra na Sala Pastoral)
    const de = (k) => { const h = all.find((q) => q.id === home[k]), it = ITEMS.find((i) => i.key === k), nm = h.block.flat ? h.block.label : h.label; return `${(it.short || it.label).toLowerCase()} ${/a$/.test(nm) ? 'da' : 'do'} ${nm}`; };   // da lista única: o nome do bloco ("luz do Banheiro")
    for (const r of all) if (!r.own.length) r.via = r.items.length ? [...new Set(r.items.map(de))].join(' · ') : 'sem aparelhos';   // sem aparelho próprio: de onde vem a luz ("luz do Estacionamento"), no lugar da conta
    // Vista de cima: só os nomes do dono — na planta os dos blocos; aproximado, os dos cômodos: o rótulo de zona com outro nome sai
    // ("Estacionamento interno", do Pátio) e o cômodo que fica sem nenhum ganha o dele ("WC" + "WC PCD" → "WCs da frente"; "Hall de entrada" → "Hall")
    for (const b of this._blocks) { const s = this._makeLabel(b.label, 1.3, true); s.userData.label.blk = true; s.material.depthTest = false; s.position.set(b.lp[0], H + 0.6 + (b.id === 'templo' ? 1.2 : 0), b.lp[1]); this._scene.add(s); this._labels.push(s); }   // só na planta (nível 0), por cima de tudo (a placa ripada da fachada cortava o do Hall)
    for (const r of all) {
      const zl = this._labels.filter((s) => r.zones.includes(s.userData.label.zone)), off = zl.filter((s) => ZONES[s.userData.label.zone].label !== r.label);
      for (const s of off) s.userData.label.top = false;   // só fora da Vista de cima
      if (!off.length || off.length < zl.length) continue;
      const s = this._makeLabel(r.label, Math.max(...off.map((q) => q.userData.label.ls))); s.userData.label.top = true;   // só na Vista de cima
      s.position.copy(off[0].position); this._scene.add(s); this._labels.push(s);   // no lugar do 1º (o do "WC": no meio colava no canto do hall); o _setLabels de depois acerta a visibilidade
    }
  }
  _rectsBox(rs) {
    return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[0] + r[2])), Math.max(...rs.map((r) => r[1] + r[3]))];
  }
  // retângulos [x0, z0, x1, z1] da região em foco (bloco ou cômodo) — usados no filtro de rótulos
  _navRects() {
    const n = this._nav, q = n.level === 2 ? n.room : n.level === 1 ? n.block : null;   // bloco: os cômodos dele (a caixa da Entrada cruza o WC Fem.)
    return q ? q.rects.map((r) => [r[0], r[1], r[0] + r[2], r[1] + r[3]]) : null;
  }
  // Enquadramento de cima de um retângulo, sempre com o palco em cima, como a planta (v1.7: em qualquer faixa — a altura da folha muda o
  // formato dela, e a planta girava 90° entre um bloco e outro). v1.8: centrado no retângulo e inclinado para o palco como a planta,
  // mais quanto maior ele é (Templo ≈ 23°; um cômodo de 3 m quase reto, para a parede da frente não cobrir o piso)
  _frameRect(x0, z0, x1, z1, margin) {
    const A = this._camera.aspect, tanV = Math.tan(this._camera.fov * Math.PI / 360);
    const hx = (x1 - x0) / 2 + margin, hz = (z1 - z0) / 2 + margin, phi = clamp(Math.min(x1 - x0, z1 - z0) * 0.025, 0.035, 0.4);
    const d = Math.max(hz / (tanV * A), (hx * Math.cos(phi) + H * Math.sin(phi)) / tanV);   // z na largura, x (encurtado pela inclinação) na altura
    const target = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), o = this._orbit;
    const dist = clamp(d * 1.08 + 3, o.minDist + 2, o.maxDist);   // +3 m: o topo das paredes (3 m) fica mais perto da câmera
    return { pos: new THREE.Vector3().setFromSphericalCoords(dist, phi, Math.PI / 2).add(target), target };
  }
  // cômodo (ou, na falta, o bloco) sob o ponto (x, z) do piso; folga de 0,8 m para as paredes
  _hit(x, z) {
    let best = null, bd = 0.8;
    for (const b of this._blocks || []) for (const r of b.rooms) for (const [rx, rz, w, d] of r.rects) {
      const dist = Math.hypot(Math.max(rx - x, 0, x - rx - w), Math.max(rz - z, 0, z - rz - d));
      if (dist === 0) return { b, r };
      if (dist < bd) { bd = dist; best = { b, r }; }
    }
    if (best) return best;
    const b = (this._blocks || []).find((q) => x >= q.box[0] && x <= q.box[2] && z >= q.box[1] && z <= q.box[3]);
    return b ? { b, r: null } : null;
  }
  // ponto do piso (y = 0) sob o mouse/toque
  _groundPoint(e) {
    const r = this._canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this._camera);
    const ray = this._raycaster.ray; if (ray.direction.y > -1e-4) return null;
    return ray.origin.clone().addScaledVector(ray.direction, -ray.origin.y / ray.direction.y);
  }
  // realce de bloco/cômodo sob o mouse na planta: retângulos âmbar translúcidos desenhados por cima (sem teste de profundidade), reaproveitados
  _hlShow(rects) {
    const g = this._hl; if (!g) return;
    if (rects) {
      while (g.children.length < rects.length) {
        const m = new THREE.Mesh(this._hlGeo, this._hlMat); m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.renderOrder = 40; g.add(m);
      }
      g.children.forEach((m, k) => {
        const r = rects[k]; m.visible = !!r;
        if (r) { m.scale.set(r[2] - r[0], r[3] - r[1], 1); m.position.x = (r[0] + r[2]) / 2; m.position.z = (r[1] + r[3]) / 2; }
      });
    }
    g.visible = !!rects;
  }
  _tintZones(ids, hex) { for (const id of ids || []) for (const m of this._zoneMeshes[id] || []) m.material.emissive.setHex(hex); }
  _clearHover() {
    this._roomHl(this._room); this._hoverKey = '';   // volta o realce do cômodo do painel
    if (this._hoverObj && this._hoverObj.userData.zone) this._tintZones([this._hoverObj.userData.zone], 0);
    this._hoverObj = null; if (this._canvas) this._canvas.classList.remove('pick');
    if (this._orbit) this._orbit.dirty = true;
  }
  _navTo(level, block, room) {
    const blk = typeof block === 'string' ? (this._blocks || []).find((q) => q.id === block) : block;
    const one = blk && blk.rooms.length === 1, rm = one ? blk.rooms[0] : blk && blk.flat ? null : typeof room === 'string' && blk ? blk.rooms.find((q) => q.id === room) : room;   // Templo: o bloco é o cômodo · Banheiro e Sala Pastoral: o bloco inteiro, sem nível de cômodo
    this._nav = { level: blk ? (rm && (level === 2 || one) ? 2 : 1) : 0, block: blk || null, room: rm && blk ? rm : null };
    this._clearHover(); this._showRoom(this._nav.room || this._nav.block);   // cômodo: o painel mostra ele · bloco: o resumo dele (cômodos + Ligar/Desligar tudo) · planta: visão geral
    this._resetView(true); this._renderNav(); this._updateLabels(); this._orbit.dirty = true;
  }
  // Voltar: cômodo → bloco → planta → sai da Vista de cima
  _navBack() {
    if (!this._topView) return;
    const n = this._nav;
    if (n.level === 0) this._setTopView(false);
    else if (n.level === 1 || n.block.flat) this._navTo(0); else this._navTo(1, n.block);
  }
  _navEnd() { const n = this._nav; return !!n && (n.level === 2 || (n.level === 1 && n.block.flat)); }   // último nível: o cômodo, ou o bloco de lista única
  // liga/desliga o aparelho (mesma lógica dos blocos do painel)
  _toggleItem(key) {
    const it = ITEMS.find((i) => i.key === key); if (!it) return;
    const on = !!(this._state[key] && this._state[key].on);
    if (it.kind === 'sensor') this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: this.entity(key) }, bubbles: true, composed: true }));
    else if (it.kind === 'light' || it.kind === 'switch') this._activate(key);
    else if (it.kind === 'climate') this._svc('climate', 'set_hvac_mode', this.entity(key), { hvac_mode: on ? 'off' : 'cool' });
    else if (it.kind === 'media') this._svc('media_player', on ? 'turn_off' : 'turn_on', this.entity(key));
  }
  _setNavHint(t) { if (this._navHint) this._navHint.textContent = t || this._navHintDefault || ''; }
  // trilha (Voltar + migalhas); reconstrói só quando o nível muda
  _renderNav() {
    const row = this._navRow; if (!row) return;
    row.hidden = !this._topView;
    if (!this._topView) { this._navSig = ''; return; }
    const n = this._nav, sig = [n.level, n.block && n.block.id, n.room && n.room.id].join('|');
    if (sig === this._navSig) return;
    this._navSig = sig;
    const cr = this._navCrumbs; cr.innerHTML = '';
    const list = [{ t: 'Planta', go: () => this._navTo(0) }];
    if (n.block) list.push({ t: n.block.label, go: () => this._navTo(1, n.block) });
    if (n.room && !n.block.flat) list.push({ t: n.room.label });   // Templo: "Planta › Templo" 
    list.forEach((c, k) => {
      if (k) { const sp = document.createElement('span'); sp.className = 'sep'; sp.textContent = '›'; sp.setAttribute('aria-hidden', 'true'); cr.appendChild(sp); }
      const b = document.createElement('button'); b.textContent = c.t;
      if (k === list.length - 1) b.setAttribute('aria-current', 'page'); else b.addEventListener('click', c.go);
      cr.appendChild(b);
    });
    this._navHintDefault = n.level === 0 ? 'Clique num bloco para aproximar' : this._navEnd() ? 'Clique num aparelho para ligar ou desligar' : 'Clique num cômodo para aproximar';
    this._navHint = document.createElement('span'); this._navHint.className = 'navhint'; this._navHint.textContent = this._navHintDefault; this._navHint.setAttribute('aria-live', 'polite');
    cr.appendChild(this._navHint);
  }
  // aparelhos do cômodo (os de BLOCKS + o que tem luminária/ar dentro dele, ver _buildBlocks)
  _roomKeys(r) { return r ? r.items : []; }
  // Ligar tudo liga luzes e interruptores (o Som do templo), como o _allSet da Casa v1.9 — ar e telão ficam (ligar sem escolher modo/fonte seria
  // surpresa); Desligar tudo apaga as luzes e desliga ar, telão e som (é o "fechar a sala"). Uma chamada em lote (homeassistant.turn_on/turn_off); luzes/interruptores mudam na hora
  _roomPower(on, keys = this._roomKeys(this._room)) {
    keys = keys.filter((k) => { const it = ITEMS.find((i) => i.key === k), st = this._state[k]; return (on ? it.kind === 'light' || it.kind === 'switch' : it.kind !== 'sensor') && !!(st && st.on) !== on; });
    if (!keys.length) return;
    for (const k of keys) { const it = ITEMS.find((i) => i.key === k), st = this._state[k]; if ((it.kind === 'light' || it.kind === 'switch') && st && !st.unavailable) this._setItemState(k, { state: on ? 'on' : 'off', attrs: st.attrs }); }
    this._svc('homeassistant', on ? 'turn_on' : 'turn_off', keys.map((k) => this.entity(k)));
    this._renderPanel();
  }
  // automações do HA ligadas ao cômodo: o estado não diz que entidades cada uma usa, então casa pelo nome — palavras (4+ letras, mais "ar"
  // e "som") do nome do cômodo e dos aparelhos dele no nome/id da automação. Cada automação fica no cômodo que mais casa (cada palavra em
  // comum, no nome do cômodo e no de cada aparelho, conta 1): "Presença acende o hall" → Hall de entrada (cômodo e luz), não a Plateia (só o sensor) nem o Hall dos banheiros;
  // empate → nos dois (o _renderAutos põe no bloco). ponytail: heurística por palavra; mapa explícito no YAML se um dia errar muito
  _roomAutos(room) {
    const words = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => (w.length >= 4 || w === 'ar' || w === 'som') && !['sala', 'area', 'tudo', 'principal'].includes(w));
    const src = (r) => r.aw || (r.aw = [r.label, ...r.items.map((k) => ITEMS.find((i) => i.key === k).label)].map(words));   // palavras de cada nome, uma vez
    const score = (r, aw) => src(r).reduce((n, ws) => n + ws.filter((w) => aw.has(w)).length, 0), rooms = this._roomsAll();   // cada palavra em comum conta: "Ar do templo…" → Templo (ar + templo)
    return (this._autos || []).filter((a) => { const aw = new Set(words(a.name + ' ' + a.id.slice(11))), s = score(room, aw); return s > 0 && rooms.every((q) => score(q, aw) <= s); });
  }
  // Selo redondo do modo do ar (textura 64 px, uma por modo, em cache): frio ❄ azul, quente chama laranja,
  // seco gota, ventilar hélice, auto "A"
  _airBadge(mode) {
    const m = ['heat', 'dry', 'fan_only', 'heat_cool', 'auto'].includes(mode) ? (mode === 'auto' ? 'heat_cool' : mode) : 'cool';
    const cache = this._badgeTex || (this._badgeTex = {}); if (cache[m]) return cache[m];
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const fill = { cool: '#2f8fd8', heat: '#e2702a', dry: '#6b7a8c', fan_only: '#6b7a8c', heat_cool: '#2f9f8f' }[m];
    g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
    g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round';
    if (m === 'cool') {
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, dx = Math.cos(a), dy = Math.sin(a);
        g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + dx * 18, 32 + dy * 18);
        for (const s of [-1, 1]) { const b = a + s * 0.7; g.moveTo(32 + dx * 11, 32 + dy * 11); g.lineTo(32 + dx * 11 + Math.cos(b) * 6, 32 + dy * 11 + Math.sin(b) * 6); }
        g.stroke();
      }
    } else if (m === 'heat') {
      g.beginPath(); g.moveTo(32, 13); g.bezierCurveTo(44, 26, 46, 36, 42, 44); g.bezierCurveTo(38, 52, 26, 52, 22, 44); g.bezierCurveTo(18, 36, 24, 30, 26, 24);
      g.bezierCurveTo(28, 30, 30, 32, 33, 33); g.bezierCurveTo(34, 26, 34, 20, 32, 13); g.fill();
    } else if (m === 'dry') {
      g.beginPath(); g.moveTo(32, 13); g.bezierCurveTo(40, 26, 45, 32, 45, 39); g.arc(32, 39, 13, 0, Math.PI); g.bezierCurveTo(19, 32, 24, 26, 32, 13); g.fill();
    } else if (m === 'fan_only') {
      for (let i = 0; i < 3; i++) { const a = i * 2 * Math.PI / 3; g.beginPath(); g.ellipse(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 10, 5, a, 0, Math.PI * 2); g.fill(); }
      g.beginPath(); g.arc(32, 32, 4, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
    } else { g.font = 'bold 32px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A', 32, 34); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; cache[m] = t; return t;
  }
  // Enquadramento (pos, target) de um ou mais splits: a câmera fica acima das paredes de 3 m, de frente para o aparelho e um pouco de lado.
  // all = quadro final de vários splits (templo: a plateia inteira com os ares ligados, vista de frente para a parede mais cheia).
  _airShot(units, all = false) {
    const walls = new Map();
    for (const u of units) { const k = u.out.x.toFixed(2) + ',' + u.out.z.toFixed(2); if (!walls.has(k)) walls.set(k, []); walls.get(k).push(u); }
    const W = [...walls.values()].sort((a, b) => b.length - a.length)[0], out = W[0].out.clone();
    const big = units[0].big, bb = new THREE.Box3();
    for (const u of units) bb.expandByPoint(u.p);
    const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
    const cam = this._camera, tanV = Math.tan(cam.fov * Math.PI / 360), tanH = tanV * cam.aspect;
    let target, dist, el, az;
    if (all) {
      target = c.clone().addScaledVector(out, 3.5); target.y = 1.0;
      const span = (Math.abs(out.x) > Math.abs(out.z) ? size.z : size.x) + 5;
      dist = clamp(Math.max(span / 2 / tanH, 6 / tanV) * 1.08, 15, 70); el = 1.0; az = 0.1;   // alto o bastante para passar por cima da parede de 8,5 m do templo
    } else if (big) {
      target = c.clone().addScaledVector(out, 1.5); target.y = 1.9;
      dist = clamp(Math.max(5.2 / 2 / tanH, 3.4 / tanV), 9, 20); el = 0.75; az = 0.3;
    } else {
      target = c.clone().addScaledVector(out, 0.7); target.y = Math.max(1.0, c.y - 0.9);
      dist = clamp(Math.max(2.6 / 2 / tanH, 1.6 / tanV) * 1.15, 5.2, 60); el = 0.82; az = 0.28;
    }
    const dir = out.clone().multiplyScalar(Math.cos(az)).addScaledVector(new THREE.Vector3(-out.z, 0, out.x), Math.sin(az)).multiplyScalar(Math.cos(el));
    dir.y = Math.sin(el);
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }
  // Voo suave até o(s) split(s) do cômodo (uma unidade: até ela; várias: enquadramento final); com a câmera focada o fluxo segue andando até o usuário mexer.
  _flyToAir(key) {
    if (this._walkOn) return;   // a pessoa não é teleportada pelo voo do ar
    const rt = this._items.get(key); if (!rt || !rt.airUnits || !rt.airUnits.length || !this._orbit) return;
    const s = this._airShot(rt.airUnits, rt.airUnits.length > 1);
    this._setTopView(false, true);
    this._flyCam(s.pos, s.target);
    this._orbit.touched = true;   // redimensionar não desfaz o voo; "Recentrar" volta à vista padrão
    const now = performance.now(); this._airFocus = { key, at: now, until: now + 45000 };
    rt.airUntil = Math.max(rt.airUntil || 0, now + 8000);
  }

  // ---- Visão de pessoa (ver classe Walker) ----
  // altura do piso sob (x, z): o palco do templo (1,0 m), a escada e o mezanino sobem; o resto é térreo
  // ---- Escada e mezanino (v1.4.6) ----
  // o piso do mezanino só vale para quem já subiu (`up`): embaixo dele ficam os WCs e o canto do hall
  _walkFloor(x, z, up = false) {
    if (inChan(x, z)) return clamp(stairNose(x), 0, STAIR.Y);        // rampa pela linha dos bocéis (a câmera suaviza os degraus)
    if (up && inMezz(x, z)) return STAIR.Y;
    return x >= 0.15 && x <= 5.0 && z >= 19.6 && z <= 36.6 ? 1.0 : 0;   // palco do templo
  }
  // no lance a partir de 1,3 m de altura já vale a colisão do andar de cima; fora do mezanino e da escada volta ao térreo
  _walkUp(x, z, up) { if (inChan(x, z)) return stairNose(x) > 1.3; return !!up && inMezz(x, z); }
  // chão livre do andar de cima: piso do mezanino (até o guarda-corpo, x 4,06) + a passagem da escada (z 48,05–49,56)
  _upFree(x, z) {
    return (x >= MEZZ.x0 && x <= 4.06 && z >= MEZZ.z0 && z <= MEZZ.z1) || (!STAIR.off && x >= 4.0 && x <= STAIR.XE + STAIR.GO + 0.01 && z >= STAIR.Z0 && z <= STAIR.Z1);
  }
  _collideUp(px, pz, nx, nz) {
    const ok = (x, z) => { if (!this._upFree(x, z)) return false; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (!this._upFree(x + 0.22 * Math.cos(a), z + 0.22 * Math.sin(a))) return false; } return true; };
    if (ok(nx, nz)) return [nx, nz];
    if (ok(nx, pz)) return [nx, pz];
    if (ok(px, nz)) return [px, nz];
    return [px, pz];
  }

  // ---- Navegação por clique (v1.4.6): grade de 0,1 m com as paredes engordadas pelo raio da pessoa; A* + alisamento ----
  _navGrid() {
    if (this._ng) return this._ng;
    const CS = 0.1, R = 0.26, x0 = LOT.x0, z0 = LOT.z0, nx = Math.round((LOT.x1 - LOT.x0) / CS), nz = Math.round((LOT.z1 - LOT.z0) / CS);
    const blk = new Uint8Array(nx * nz), fur = new Uint8Array(nx * nz);
    const fill = (a, bx0, bz0, bx1, bz1) => {
      const i0 = Math.max(0, Math.ceil((bx0 - x0) / CS - 0.5)), i1 = Math.min(nx - 1, Math.floor((bx1 - x0) / CS - 0.5));
      const j0 = Math.max(0, Math.ceil((bz0 - z0) / CS - 0.5)), j1 = Math.min(nz - 1, Math.floor((bz1 - z0) / CS - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) a[j * nx + i] = 1;
    };
    for (const w of this._walls || []) {
      if (w.axis === 'z') fill(blk, w.c - w.t / 2 - R, w.a0 - R, w.c + w.t / 2 + R, w.a1 + R); else fill(blk, w.a0 - R, w.c - w.t / 2 - R, w.a1 + R, w.c + w.t / 2 + R);
    }
    if (!STAIR.off) fill(blk, STAIR.XS - 0.1, STAIR.Z0 - R, STAIR.XE + R, STAIR.Z1 + R);   // a escada (massa): só se entra por ela pelo lado leste, tratado em _walkGo
    fill(blk, LOT.x0, LOT.z0, LOT.x1, LOT.z0 + 0.5); fill(blk, LOT.x0, LOT.z1 - 0.5, LOT.x1, LOT.z1);
    fill(blk, LOT.x0, LOT.z0, LOT.x0 + 0.5, LOT.z1); fill(blk, LOT.x1 - 0.5, LOT.z0, LOT.x1, LOT.z1);
    for (const b of this._furnObs || []) fill(fur, b[0] - 0.3, b[1] - 0.3, b[2] + 0.3, b[3] + 0.3);   // móveis (não travam, mas o ponto de entrada os evita)
    return (this._ng = { CS, x0, z0, nx, nz, blk, fur });
  }
  _navFree(x, z, furn = true) {
    const g = this._navGrid(), i = Math.floor((x - g.x0) / g.CS), j = Math.floor((z - g.z0) / g.CS);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return false;
    return !g.blk[j * g.nx + i] && !(furn && g.fur[j * g.nx + i]);
  }
  // caminho (planta) de (sx, sz) até o ponto alcançável mais perto de (tx, tz): [[x, z], …] sem o ponto de partida
  _navPath(sx, sz, tx, tz) {
    const g = this._navGrid(), { CS, x0, z0, nx, nz, blk } = g, N = nx * nz;
    const cell = (x, z) => [clamp(Math.floor((x - x0) / CS), 0, nx - 1), clamp(Math.floor((z - z0) / CS), 0, nz - 1)];
    const free = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && !blk[j * nx + i];
    const near = (i, j) => {
      if (free(i, j)) return [i, j];
      for (let r = 1; r < 40; r++) {
        let best = null, bd = 1e9;
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !free(i + di, j + dj)) continue;
          const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i + di, j + dj]; }
        }
        if (best) return best;
      }
      return null;
    };
    let [si, sj] = cell(sx, sz), [ti, tj] = cell(tx, tz);
    const s0 = near(si, sj); if (!s0) return [[tx, tz]]; [si, sj] = s0;
    const t0 = near(ti, tj); if (t0) [ti, tj] = t0;
    const gs = new Float32Array(N).fill(1e9), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const hf = (i, j) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const HK = [], HI = [];
    const push = (k, idx) => { let n = HK.length; HK.push(k); HI.push(idx); while (n > 0) { const p = (n - 1) >> 1; if (HK[p] <= HK[n]) break; [HK[p], HK[n]] = [HK[n], HK[p]]; [HI[p], HI[n]] = [HI[n], HI[p]]; n = p; } };
    const pop = () => {
      const top = HI[0], lk = HK.pop(), li = HI.pop();
      if (HK.length) {
        HK[0] = lk; HI[0] = li; let n = 0;
        for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < HK.length && HK[l] < HK[m]) m = l; if (r < HK.length && HK[r] < HK[m]) m = r; if (m === n) break; [HK[m], HK[n]] = [HK[n], HK[m]]; [HI[m], HI[n]] = [HI[n], HI[m]]; n = m; }
      }
      return top;
    };
    const start = sj * nx + si, goal = tj * nx + ti; gs[start] = 0; push(hf(si, sj), start);
    let best = start, bh = hf(si, sj), found = false;
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (HI.length) {
      const cur = pop(); if (closed[cur]) continue; closed[cur] = 1;
      const ci = cur % nx, cj = (cur / nx) | 0, h = hf(ci, cj);
      if (h < bh - 1e-6 || (Math.abs(h - bh) < 1e-6 && gs[cur] < gs[best])) { bh = h; best = cur; }
      if (cur === goal) { found = true; break; }
      for (let d = 0; d < 8; d++) {
        const ni = ci + DI[d], nj = cj + DJ[d]; if (!free(ni, nj)) continue;
        if (d > 3 && (!free(ci + DI[d], cj) || !free(ci, cj + DJ[d]))) continue;   // sem cortar quina
        const nn = nj * nx + ni; if (closed[nn]) continue;
        const ng = gs[cur] + (d > 3 ? 1.4142 : 1);
        if (ng < gs[nn]) { gs[nn] = ng; par[nn] = cur; push(ng + hf(ni, nj), nn); }
      }
    }
    const raw = []; for (let c = found ? goal : best; c >= 0; c = par[c]) raw.push([x0 + ((c % nx) + 0.5) * CS, z0 + (((c / nx) | 0) + 0.5) * CS]);
    raw.reverse();
    const blkAt = (x, z) => { const i = Math.floor((x - x0) / CS), j = Math.floor((z - z0) / CS); return i < 0 || j < 0 || i >= nx || j >= nz || blk[j * nx + i] === 1; };
    const los = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.ceil(Math.hypot(dx, dz) / 0.05); for (let k = 1; k < n; k++) if (blkAt(a[0] + dx * k / n, a[1] + dz * k / n)) return false; return true; };
    const out = []; let cur = [sx, sz], j = 0;
    while (j < raw.length - 1) { let k = j + 1; while (k + 1 < raw.length && los(cur, raw[k + 1])) k++; out.push(raw[k]); cur = raw[k]; j = k; }
    if (found && !blkAt(tx, tz) && out.length) out[out.length - 1] = [tx, tz];
    return out;
  }

  // ---- Raio → mundo (paredes, escada, palco, mezanino, chão): o que está sob o cursor/dedo ----
  // Devolve { kind: 'ground'|'stage'|'stair'|'mezz'|'wall'|'ceil', t, x, y, z } do primeiro ponto atingido
  _pickWorld(o, d) {
    let bt = Infinity, kind = null;
    const mzOn = !this._mezz || this._mezz.visible;
    const hit = (t, k) => { if (t > 1e-4 && t < bt) { bt = t; kind = k; } };
    let ax = 0;   // eixo da face de entrada da última caixa acertada (0 x · 1 y · 2 z)
    const boxT = (x0, y0, z0, x1, y1, z1) => {   // entrada do raio na caixa (Infinity se não acerta ou se a origem está dentro)
      let t0 = 0, t1 = Infinity, k0 = 0, k = 0;
      for (const [p, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
        if (Math.abs(dd) < 1e-9) { if (p < lo || p > hi) return Infinity; k++; continue; }
        let ta = (lo - p) / dd, tb = (hi - p) / dd; if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) { t0 = ta; k0 = k; }
        t1 = Math.min(t1, tb); k++; if (t0 > t1) return Infinity;
      }
      ax = k0; return t0 > 0 ? t0 : Infinity;
    };
    for (const w of this._walls || []) {
      const h = w.h || H, hh = w.t / 2;
      hit(w.axis === 'x' ? boxT(w.a0, 0, w.c - hh, w.a1, h, w.c + hh) : boxT(w.c - hh, 0, w.a0, w.c + hh, h, w.a1), 'wall');
    }
    // escada (degraus maciços: acerta o piso e o espelho) e palco
    if (!STAIR.off) for (let i = 1; i <= STAIR.N - 1; i++) { const xa = STAIR.XS + (STAIR.N - 1 - i) * STAIR.GO; hit(boxT(xa, 0, STAIR.Z0, xa + STAIR.GO, i * STAIR.R, STAIR.Z1), 'stair'); }
    hit(boxT(0.15, 0, 19.6, 5.0, 1.0, 36.6), 'stage');
    if (mzOn) {
      for (const b of [[-0.075, 0.075, 43.925, 49.725], [0.075, 4.075, 43.925, 44.075], [0.075, 4.075, 49.575, 49.725]]) hit(boxT(b[0], 3.03, b[2], b[1], 5.92, b[3]), 'wall');
      const t = boxT(0, 2.91, 43.95, 4.1, STAIR.Y, 49.7);   // laje: por cima e pela testeira é o mezanino; por baixo, teto
      if (t < bt) hit(t, ax === 1 && d.y > 0 ? 'ceil' : 'mezz');
    }
    if (Math.abs(d.y) > 1e-9 && d.y < 0 && o.y > 0) { const t = -o.y / d.y, x = o.x + d.x * t, z = o.z + d.z * t; if (x > LOT.x0 && x < LOT.x1 && z > LOT.z0 && z < LOT.z1) hit(t, 'ground'); }
    if (!kind) return null;
    return { kind, t: bt, x: o.x + d.x * bt, y: o.y + d.y * bt, z: o.z + d.z * bt };
  }
  _rayAt(cx, cy) {
    this._camera.updateMatrixWorld();
    const r = this._canvas.getBoundingClientRect();
    this._ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this._camera);
    return this._raycaster.ray;
  }
  // destino de caminhada sob o cursor: { x, z, up, kind, t } (nulo no céu/teto)
  _destAt(cx, cy) {
    const ray = this._rayAt(cx, cy), p = this._pickWorld(ray.origin, ray.direction); if (!p || p.kind === 'ceil') return null;
    let x = p.x, z = p.z, up = p.kind === 'mezz';
    if (p.kind === 'wall') {   // parede: o ponto do chão em frente a ela, do lado de quem olha
      const hl = Math.hypot(ray.direction.x, ray.direction.z) || 1;
      x -= ray.direction.x / hl * 0.5; z -= ray.direction.z / hl * 0.5; up = p.y > 3.03 && inMezz(x, z);
    }
    if (p.kind === 'stair') { up = true; }
    if (up && !p.kind.startsWith('st')) { x = clamp(x, MEZZ.x0 + 0.35, 3.8); z = clamp(z, MEZZ.z0 + 0.35, MEZZ.z1 - 0.3); }
    return { x: clamp(x, LOT.x0 + 0.6, LOT.x1 - 0.6), z: clamp(z, LOT.z0 + 0.6, LOT.z1 - 0.6), up, kind: p.kind, t: p.t, y: p.y };
  }

  // Caminho até o destino: térreo → A*; para o mezanino passa pela base da escada (x 9,75) e sobe pela passagem; do mezanino desce do mesmo jeito
  _walkRoute(d) {
    const w = this._walk, S0 = [STAIR.XE + 0.55, (STAIR.Z0 + STAIR.Z1) / 2], TOP = [4.35, S0[1]], MZE = [3.4, 48.7], pos = [w.pos.x, w.pos.z];
    const inStair = inChan(pos[0], pos[1]) || (w.high && pos[0] > 4.06);
    if (d.up) {
      const tg = [clamp(d.x, MEZZ.x0 + 0.35, 3.8), clamp(d.z, MEZZ.z0 + 0.35, MEZZ.z1 - 0.3)];
      if (w.high && !inStair) return [tg];
      return inStair ? [TOP, MZE, tg] : [...this._navPath(pos[0], pos[1], S0[0], S0[1]), S0, TOP, MZE, tg];
    }
    if (w.high || inStair) return [...(w.high && !inStair ? [MZE, TOP] : []), S0, ...this._navPath(S0[0], S0[1], d.x, d.z)];
    return this._navPath(pos[0], pos[1], d.x, d.z);
  }
  _walkGo(d) {
    const w = this._walk; if (!this._walkOn || !w) return false;
    if (STAIR.off && !!d.up !== !!w.high) {   // sem escada até a salinha: troca de andar direto (com o fade do "Ir para…")
      const r = this._roomAt(d.x, d.z, d.up), sp = r ? this._dropSpot(r, d.x, d.z, d.up) : { x: d.x, z: d.z, up: !!d.up };
      this._enterAt(sp, r ? this._roomYaw(r, sp.x, sp.z) : w.yaw); return true;
    }
    const pts = this._walkRoute(d); if (!pts.length) return false;
    w.path = { pts, i: 0, t: 0, px: w.pos.x, pz: w.pos.z, goal: d, tries: 0 };
    w.head = true; this._orbit.dirty = true;
    const e = pts[pts.length - 1]; this._mkSet(e[0], e[1], d.up, true);
    return true;
  }
  _walkReplan() {
    const w = this._walk, P = w && w.path; if (!P) return;
    const pts = this._walkRoute(P.goal); if (!pts.length) { w.stop(true); return; }
    P.pts = pts; P.i = 0; P.t = 0; P.px = w.pos.x; P.pz = w.pos.z;
  }
  _walkStopped() { this._mkDestOff = performance.now() + 500; this._orbit.dirty = true; }

  // marcador discreto no piso: anel âmbar sob o cursor (hover) ou no destino (pulsa até chegar)
  _mkSet(x, z, up, dest) {
    const m = this._mk; if (!m) return;
    m.position.set(x, this._walkFloor(x, z, up) + 0.035, z); m.visible = true; this._mkIsDest = !!dest; m.scale.setScalar(1);
    m.children[0].material.opacity = dest ? 0.95 : 0.7; this._mkDestOff = 0; this._orbit.dirty = true;
  }
  _mkHide(destToo) { if (!this._mk || (this._mkIsDest && !destToo && this._walk && this._walk.path)) return; if (this._mk.visible) { this._mk.visible = false; this._orbit.dirty = true; } }
  _mkTick(t) {
    const m = this._mk; if (!m || !m.visible) return false;
    if (this._mkIsDest) {
      if (this._mkDestOff && performance.now() > this._mkDestOff) { m.visible = false; return true; }
      m.scale.setScalar(1 + 0.18 * Math.sin(t * 7)); return true;
    }
    return false;
  }
  _walkHover(e) {
    const now = performance.now(); if (now - (this._hvT || 0) < 45) return; this._hvT = now;
    const d = this._destAt(e.clientX, e.clientY);
    this._hoverDest = d;
    if (d && d.kind !== 'ceil') { if (!(this._mkIsDest && this._walk.path)) this._mkSet(d.x, d.z, d.up, false); } else this._mkHide();
  }
  // clique/toque no modo Pessoa: aparelho liga/desliga (como sempre); qualquer outro ponto do piso/escada/mezanino/parede vira caminhada
  _walkClick(e, hit) {
    const d = this._destAt(e.clientX, e.clientY), o = hit && hit.object;
    if (o && o.userData.item && !o.userData.zone && !(d && d.kind === 'wall' && d.t < hit.distance - 0.05)) return false;
    if (!d) return true;
    if (d.kind === 'stair') {   // clicou na escada: sobe até a salinha (quem está em cima e clica num degrau bem abaixo, desce)
      if (this._walk.high && stairNose(d.x) < this._walk.pos.y - 1.6 - 0.3) { d.up = false; d.x = STAIR.XE + 0.55; d.z = (STAIR.Z0 + STAIR.Z1) / 2; }
      else { d.up = true; d.x = 3.3; d.z = 48.7; }
    }
    this._walkGo(d);
    return true;
  }

  // ---- Cômodos: pontos de entrada livres, para onde olhar, e o bonequinho / "Entrar aqui" / "Ir para…" ----
  _roomsAll() {
    if (!this._blocks) return [];
    if (!this._mezzRoom) {
      const hall = this._blocks.find((b) => b.id === 'hall');
      this._mezzRoom = { id: 'mezanino', label: 'Mezanino (salinha)', rects: [[MEZZ.x0, MEZZ.z0, MEZZ.x1 - MEZZ.x0, MEZZ.z1 - MEZZ.z0]], zones: [], items: [], up: true, block: hall };
    }
    return [...this._blocks.flatMap((b) => b.rooms), this._mezzRoom];
  }
  // o cômodo com o aparelho k mais perto do ponto (x, z): o refletor da fachada é do Estacionamento, não do Pátio (que também acende com ele)
  _nearRoom(k, x, z) {
    const dist = (q) => Math.min(...q.rects.map(([rx, rz, w, d]) => Math.hypot(Math.max(rx - x, 0, x - rx - w), Math.max(rz - z, 0, z - rz - d))));
    return this._roomsAll().filter((q) => q.items.includes(k)).sort((a, b) => dist(a) - dist(b))[0];
  }
  _roomAt(x, z, up) {
    if (up && inMezz(x, z)) return this._roomsAll().find((r) => r.up) || null;
    const h = this._hit(x, z); return h && h.r ? h.r : null;
  }
  _roomBox(r) { return this._rectsBox(r.rects); }
  // ponto livre (sem parede, sem móvel) do cômodo mais perto de `want` (padrão: o centro do cômodo)
  _roomSpot(r, want) {
    if (r.up) return { x: 1.55, z: 46.9, up: true };
    const g = this._navGrid(), b = this._roomBox(r), w = want || [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    let best = null, bd = 1e9;
    for (const [rx, rz, rw, rd] of r.rects) for (let z = rz + 0.05; z < rz + rd; z += 0.1) for (let x = rx + 0.05; x < rx + rw; x += 0.1) {
      if (!this._navFree(x, z)) continue;
      const d = Math.hypot(x - w[0], z - w[1]); if (d < bd) { bd = d; best = { x, z, up: false }; }
    }
    if (!best) for (const [rx, rz, rw, rd] of r.rects) for (let z = rz + 0.05; z < rz + rd; z += 0.1) for (let x = rx + 0.05; x < rx + rw; x += 0.1) {   // cômodo cheio: aceita móvel, só não parede
      if (!this._navFree(x, z, false)) continue;
      const d = Math.hypot(x - w[0], z - w[1]); if (d < bd) { bd = d; best = { x, z, up: false }; }
    }
    return best || { x: (b[0] + b[2]) / 2, z: (b[1] + b[3]) / 2, up: false };
  }
  _roomYaw(r, x, z) {
    const f = ROOM_FOCUS[r.id], b = this._roomBox(r);
    if (f && Math.hypot(f[0] - x, f[2] - z) > 0.5) return Math.atan2(-(f[0] - x), -(f[2] - z));
    // sem foco próprio: o rumo com a vista mais longa (quem entra enxerga o ambiente), com um leve gosto pelo centro do cômodo
    const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, ac = Math.atan2(-(cx - x), -(cz - z)), far = Math.hypot(cx - x, cz - z) > 0.6;
    let best = -1e9, ba = 0;
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12, dx = -Math.sin(a), dz = -Math.cos(a); let d = 0;
      while (d < 14 && this._navFree(x + dx * d, z + dz * d, false)) d += 0.2;
      const sc = d + (far ? 1.2 * Math.cos(a - ac) : 0); if (sc > best) { best = sc; ba = a; }
    }
    return ba;
  }
  // ponto de entrada perto de (x, z) dentro do cômodo r (o próprio ponto se estiver livre)
  _dropSpot(r, x, z, up) {
    if (up || r.up) return { x: clamp(x, MEZZ.x0 + 0.5, 3.6), z: clamp(z, MEZZ.z0 + 0.5, MEZZ.z1 - 0.4), up: true };
    if (this._navFree(x, z) && this._roomAt(x, z, false) === r) return { x, z, up: false };
    return this._roomSpot(r, [x, z]);
  }
  _fade() {
    const el = this._fadeEl; if (!el || this._reduced) return;
    el.style.transition = 'none'; el.style.opacity = '0.9'; void el.offsetWidth; el.style.transition = 'opacity .55s ease-out'; el.style.opacity = '0';
  }
  // entra (ou já andando, teleporta) no ponto — a 1,6 m, olhando para `yaw`
  _enterAt(sp, yaw) {
    this._fade(); this._closeGoto();
    this._setWalk(true);
    this._walk.reset(sp.x, sp.z, yaw, 0, !!sp.up); this._mkHide(true);
    this._orbit.dirty = true;
  }
  _enterRoom(r, at) {
    if (!r) return false;
    const sp = at ? this._dropSpot(r, at[0], at[1], r.up) : this._roomSpot(r);
    this._enterAt(sp, this._roomYaw(r, sp.x, sp.z)); return true;
  }
  enterRoom(id, x, z) { const r = this._roomsAll().find((q) => q.id === (ROOM_ALIAS[id] || id)); return this._enterRoom(r, x != null ? [x, z] : null); }   // ids de antes (palco, plateia) também
  walkTo(x, z, up = false) { return this._walkGo({ x, z, up: !!up }); }

  // Bonequinho (estilo Street View): arrastar até um ponto do piso da planta/maquete e soltar → entra na visão de Pessoa ali
  _pegBind(btn) {
    let st = null;
    const pt = (e) => ({ x: e.clientX, y: e.clientY - (e.pointerType === 'touch' ? 56 : 0) });   // no toque a mira fica acima do dedo
    const drop = () => { if (st) clearTimeout(st.t); btn.classList.remove('lift'); st = null; };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || this._walkOn) return;
      const touch = e.pointerType === 'touch';   // v1.8: no toque a linha mora numa lista que rola — o dedo parado levanta o bonequinho, o dedo que corre rola
      st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, live: false, up: !touch, t: touch ? setTimeout(() => { if (st) { st.up = true; btn.classList.add('lift'); } }, 300) : 0 };
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    btn.addEventListener('touchmove', (e) => { if (st && st.up) e.preventDefault(); }, { passive: false });   // levantado: o dedo leva o bonequinho, não a lista
    btn.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      if (!st.live && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < 6) return;
      if (!st.up) { drop(); return; }   // correu antes de levantar: é rolagem da lista (o navegador segue com ela)
      if (!st.live) this._menuSet(false);   // v1.8: o bonequinho sai da lista suspensa; ela fecha e a cena fica livre
      st.live = true; this._pegMove(pt(e));
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; drop(); try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!s.live) return;   // toque: o clique do item (Pessoa liga/desliga)
      this._pegT = performance.now(); this._pegDrop(e.type === 'pointerup' ? pt(e) : null);
    };
    btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
  }
  _pegAt(p) {
    const el = this.shadowRoot.elementFromPoint(p.x, p.y);
    if (el !== this._canvas) return null;
    const d = this._destAt(p.x, p.y); if (!d || d.kind === 'ceil') return null;
    const r = this._roomAt(d.x, d.z, d.up); if (!r) return null;
    return { d, r };
  }
  _pegMove(p) {
    const g = this._pegGhost, tip = this._pegTip, wr = this._wrap.getBoundingClientRect();
    g.hidden = false; g.style.transform = `translate(${p.x - wr.left - 22}px, ${p.y - wr.top - 44}px)`;
    const hit = this._pegAt(p); this._pegSel = hit;
    if (hit) {
      this._hlShow(hit.r.rects.map(([x, z, w, d]) => [x, z, x + w, z + d]));
      tip.hidden = !hit.r.label; tip.textContent = hit.r.label; tip.style.transform = `translate(${p.x - wr.left + 26}px, ${p.y - wr.top - 30}px)`;   // a obra sem nome: sem etiqueta
      g.classList.add('ok');
    } else { this._hlShow(null); tip.hidden = true; g.classList.remove('ok'); }
    this._orbit.dirty = true;
  }
  _pegDrop(p) {
    const sel = p ? this._pegAt(p) : null;   // soltar fora do piso (painéis, fora do lote) ou cancelar o gesto: nada acontece
    this._pegGhost.hidden = true; this._pegTip.hidden = true; this._roomHl(this._room); this._pegSel = null; this._orbit.dirty = true;
    if (sel) this._enterRoom(sel.r, [sel.d.x, sel.d.z]);
  }

  // "Ir para…": lista de cômodos por bloco (mezanino incluído) — teleporte suave até um ponto livre do cômodo
  _buildGoto() {
    const box = this._gotoPanel; box.innerHTML = '';
    const hd = document.createElement('div'); hd.className = 'gh'; hd.textContent = 'Ir para…'; box.appendChild(hd);
    for (const b of this._blocks || []) {
      const sec = document.createElement('div'); sec.className = 'gsec'; const t = document.createElement('div'); t.className = 'gt'; t.textContent = b.label; if (b.rooms.length > 1) sec.appendChild(t);   // Templo: só o botão (não "Templo › Templo")
      const row = document.createElement('div'); row.className = 'grow';
      for (const r of [...b.rooms, ...(b.id === 'hall' ? [this._roomsAll().find((q) => q.up)] : [])]) {
        const c = document.createElement('button'); c.textContent = r.up ? '↑ ' + r.label : r.label; c.addEventListener('click', () => this._enterRoom(r));
        row.appendChild(c);
      }
      sec.appendChild(row); box.appendChild(sec);
    }
  }
  _toggleGoto(force) {
    const box = this._gotoPanel; if (!box) return;
    const open = force != null ? force : box.hidden;
    if (open && !box.dataset.built) { this._buildGoto(); box.dataset.built = '1'; }
    if (open) { this._menuSet(false); if (this._panelOpen && this._sideOverlay) this._setPanel(false); }   // a lista não abre por baixo da folha do celular
    box.hidden = !open;
  }
  _closeGoto() { if (this._gotoPanel && !this._gotoPanel.hidden) this._toggleGoto(false); }

  // Colisão simples: cada segmento de parede (registrado em _wallSeg) vira uma caixa engordada pelo raio da pessoa; move por eixo
  // (X e depois Z), então encostar numa parede desliza ao longo dela. Vãos de porta passam (o segmento não existe ali).
  _walkCollide(px, pz, nx, nz, up = false) {
    if (up) return this._collideUp(px, pz, nx, nz);
    const R = 0.22, W = this._walls || [];
    if (!this._wbox || this._wbox.length !== W.length) this._wbox = W.map((w) => w.axis === 'z' ? [w.c - w.t / 2 - R, w.a0 - R, w.c + w.t / 2 + R, w.a1 + R] : [w.a0 - R, w.c - w.t / 2 - R, w.a1 + R, w.c + w.t / 2 + R]);
    const B = this._wbox, e = 1e-3;
    for (let pass = 0; pass < 2; pass++) for (const [x0, z0, x1, z1] of B) if (pz > z0 && pz < z1 && nx > x0 && nx < x1) { if (px <= x0) nx = x0 - e; else if (px >= x1) nx = x1 + e; }
    for (let pass = 0; pass < 2; pass++) for (const [x0, z0, x1, z1] of B) if (nx > x0 && nx < x1 && nz > z0 && nz < z1) { if (pz <= z0) nz = z0 - e; else if (pz >= z1) nz = z1 + e; }
    return [clamp(nx, LOT.x0 + 0.5, LOT.x1 - 0.5), clamp(nz, LOT.z0 + 0.5, LOT.z1 - 0.5)];
  }
  _setWalk(on) {
    on = !!on; if (on === !!this._walkOn || !this._orbit) return;
    const was = on && { room: this._room, nav: { ...this._nav }, snap: this._dock.dataset.snap, top: !!this._topView };   // cômodo, Vista de cima, nível e altura da folha de antes: voltam ao sair
    this._showRoom(null); this._select(null);
    const o = this._orbit, cam = this._camera, cv = this._canvas;
    if (on) {
      if (this._topView) this._setTopView(false, true);
      this._walkSaved = { ...was, pos: cam.position.clone(), target: o.target.clone(), panel: this._panelOpen, touched: o.touched, roof: !!this._roofOn };
      // v1.5.5: na visão de Pessoa a Fachada liga sozinha (paredes altas, forro e telhado: por dentro some o céu sobre as salas);
      // ao sair volta como estava. O botão Fachada continua valendo durante o passeio. `fachada_pessoa: false` desliga isso.
      if (this._config.fachada_pessoa !== false && !this._roofOn) this._setRoof(true);
      if (this._panelOpen) this._setPanel(false);   // vista inteira para andar (a folha cobriria o joystick); volta ao sair
      this._airFocus = this._airTour = null;
      o.enabled = false; o.touched = true;
      if (!this._walk) { this._walk = new Walker(this, cam, cv); this._walk.reset(12.0, 52.0); }
      this._walkOn = true; this._walk.enable();
      cam.near = 0.15; cam.fov = this._walkFov(); cam.updateProjectionMatrix();
      cv.classList.add('walk'); try { cv.focus({ preventScroll: true }); } catch (_) {}
      this._joy.hidden = false; this._showWalkHint();
      this._closeGoto();
    } else {
      this._walk.disable(); this._walk.path = null; this._walkOn = false; o.enabled = true;
      this._doorsReset(); this._mkHide(true); this._closeGoto();
      cam.near = 0.3; cam.fov = 42; cam.updateProjectionMatrix();
      cv.classList.remove('walk'); this._joy.hidden = true; this._walkHint.classList.remove('show');
      const sv = this._walkSaved;
      // volta voando da altura dos olhos até onde a câmera estava antes
      o.sph.setFromVector3(cam.position.clone().sub(o.target)); o.goal.copy(o.sph);
      this._flyCam(sv.pos, sv.target, 3.2);
      o.touched = sv.touched;
      if (this._config.fachada_pessoa !== false && !!this._roofOn !== sv.roof) this._setRoof(sv.roof);   // antes da Vista de cima: a Fachada tira da planta
      if (sv.top) this._setTopView(true, true);
      if (sv.nav.level) this._navTo(sv.nav.level, sv.nav.block, sv.nav.room);   // o nível da planta de antes
      if (sv.panel) { if (sv.room) this._showRoom(sv.room); this._setPanel(true, sv.snap); }   // o cômodo e a altura da folha de antes
      else if (this._panelOpen) { this._dock.hidden = true; this._setPanel(false); }   // estava recolhido: o _navTo do cômodo o abriu; fecha de novo sem a animação de saída
    }
    this._walkBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    o.dirty = true;
  }
  // campo de visão de quem anda: mais aberto que o da maquete (42°), e ainda mais em telas em pé
  _walkFov() { return this._camera.aspect < 1 ? 80 : 66; }
  _showWalkHint() {
    const h = this._walkHint, coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    h.textContent = coarse ? 'Toque no piso para ir até lá · joystick anda · arraste para olhar' : 'Clique no piso para ir até lá · setas/WASD ou joystick andam · arraste para olhar · Shift corre · Enter/F abre a porta · Esc sai';
    h.classList.add('show'); this._walkHintAt = performance.now(); this._dicaOff();   // some na primeira interação (ver `used` em _build)
  }

  // ---- Ganchos públicos (depuração / demo) ----
  // setView([x,y,z],[tx,ty,tz]) — posiciona a câmera na hora (e para de recentrar sozinha)
  setView(pos, target) {
    if (!this._orbit) return;
    const p = new THREE.Vector3(...pos), t = new THREE.Vector3(...(target || [LOT.cx, 0, LOT.cz]));
    this._orbit.reset(p, t); this._orbit.sph.copy(this._orbit.goal); this._orbit.target.copy(t);
    this._orbit.touched = true; this._orbit.dirty = true;
  }
  setFachada(on) { this._setRoof(!!on); }
  // setWalk(true|false) entra/sai da visão de pessoa · setWalkPose(x, z, yaw, pitch) posiciona a pessoa na hora (sem colisão; yaw 0 olha para −z,
  // + vira à esquerda) · getWalkPose() → { x, y, z, yaw, pitch }
  setWalk(on) { this._setWalk(!!on); }
  setWalkPose(x, z, yaw = 0, pitch = 0, up = false) { this._setWalk(true); this._walk.reset(x, z, yaw, pitch, up); this._orbit.dirty = true; }
  getWalkPose() { const w = this._walk; return w ? { x: w.pos.x, y: w.pos.y, z: w.pos.z, yaw: w.yaw, pitch: w.pitch, up: w.high, walking: !!w.path } : null; }
  // setTopNav('operacional', 'midia') — liga a Vista de cima (se preciso) e navega direto para o bloco / cômodo; getTopNav() → { level, block, room }
  setTopNav(block, room) {
    if (!this._blocks || !this._orbit) return;
    if (!this._topView) this._setTopView(true);
    const id = BLOCK_ALIAS[block] || block, rid = ROOM_ALIAS[room] || room, r = rid && this._blocks.flatMap((q) => q.rooms).find((q) => q.id === rid);   // ids de antes (ala, fundos, entrada; palco, plateia)
    const b = r ? r.block : this._blocks.find((q) => q.id === id);   // o cômodo manda: o WC Masc. de setTopNav('ala', 'wc_masc') agora fica no Banheiro
    if (b) this._navTo(r ? 2 : 1, b, r); else this._navTo(0);
  }
  getTopNav() { const n = this._nav; return { level: this._topView ? n.level : -1, block: n.block && n.block.id, room: n.room && n.room.id }; }
  // setMode('auto'|'day'|'night') — troca o ambiente na hora (sem a transição suave dos botões)
  setMode(mode) { if (['auto', 'day', 'night'].includes(mode)) { this._mode = mode; this._applyMode(); this._nightLevel = undefined; if (this._orbit) this._orbit.dirty = true; } }

  // ---- Ações ----
  _activate(key) {
    const it = ITEMS.find((i) => i.key === key); if (!it) return;
    const eid = this.entity(key);
    const hass = this._hass;
    if (it.kind === 'light' || it.kind === 'switch') {
      // Otimista: acende já, o HA confirma em seguida
      const st = this._state[key] || { on: false, attrs: {} };
      if (!st.unavailable) this._setItemState(key, { state: st.on ? 'off' : 'on', attrs: st.attrs });
      this._renderPanel();
      if (hass && hass.callService) hass.callService('homeassistant', 'toggle', { entity_id: eid });
    } else {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: eid }, bubbles: true, composed: true }));
    }
    this._lastSig = '';
  }

  _pick(e) { const h = this._pickHit(e); return h ? h.object : null; }
  _pickHit(e) {
    const r = this._canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this._camera);
    const hits = this._raycaster.intersectObjects(this._clickables, false);
    // ignora o que está escondido (ex.: luminárias do modo Fachada com o botão desligado)
    for (const h of hits) { let vis = true; for (let o = h.object; o; o = o.parent) if (!o.visible) { vis = false; break; } if (vis) return h; }
    return null;
  }
  _onClick(e) {
    const hit = this._pickHit(e), o = hit ? hit.object : null;
    if (this._topView) return this._topClick(e, o);
    if (this._walkOn && this._doorClick(hit)) return;
    if (this._walkOn && this._walkClick(e, hit)) return;   // piso / escada / mezanino / parede: caminha até lá
    // v1.6.1: 1º toque seleciona (realce + balão com nome, estado e o botão); 2º toque no mesmo alvo em até 5 s (ou o botão) executa; vazio limpa
    const s = this._sel, k = o && o.userData.item;
    if (k && s && s.key === k && performance.now() - s.at < 5000) return this._selAct();
    const h = k && this._hit(hit.point.x, hit.point.z), r0 = k && (h && h.r && h.r.items.includes(k) ? h.r : this._nearRoom(k, hit.point.x, hit.point.z));
    const fb = r0 && r0.block.flat, r = fb ? this._flatUp(r0) : r0;   // lista única: o bloco inteiro, e o nome inteiro do aparelho ("Plateia", não "Luz")
    if (k) {   // v1.7: o cômodo do aparelho entra no painel como está (sem abrir nem mudar a altura: o aparelho fica sob o dedo) · na Pessoa só o balão
      if (!this._walkOn) this._showRoom(r, k, true);
      return this._select({ key: k, room: r && r.label, name: fb ? ITEMS.find((i) => i.key === k).label : '', p: hit.point.clone(), at: performance.now() });
    }
    this._select(null); if (!this._walkOn) this._showRoom(null);   // vazio: limpa o balão e o painel volta ao geral
  }
  _select(sel) {
    const b = this._selEl; if (!b) return;
    if (!sel && b.contains(this.shadowRoot.activeElement)) this._canvas.focus({ preventScroll: true });   // o foco no botão do balão volta à maquete
    if (this._sel) this._roomHl(this._room);   // volta o realce do cômodo do painel
    const band = this._selBand; this._selGone = sel ? null : this._sel || this._selGone; this._sel = sel; this._selTxt = ''; clearTimeout(this._selT); b.classList.toggle('out', !sel);   // _selGone: saindo, o balão segue preso ao ponto
    if (sel) b.hidden = false; else if (!b.hidden) this._selT = setTimeout(() => { b.hidden = true; this._selGone = null; }, this._reduced ? 0 : 150);   // sai encolhendo para a ponta
    this._selBand = sel ? band || (this._vb && [this._pNow || 0, ...this._vb]) : null;   // balão aberto: a faixa da cena fica parada (_resize) e o 2º toque cai no mesmo aparelho
    if (sel) { this._selRender(); this._orbit.dirty = true; } else if (band) this._resize(true);   // fechou: a cena volta à faixa de verdade, deslizando
  }
  _selRender() {   // também a cada atualização do HA (_renderPanel): só reescreve o que mudou
    const s = this._sel; if (!s) return;
    const it = ITEMS.find((i) => i.key === s.key), st = this._state[s.key], on = !!(st && st.on);
    const txt = [s.name || it.short || it.label, [s.room, this._stateText(it, st, true)].filter(Boolean).join(' · '), it.kind === 'sensor' ? 'Detalhes' : it.kind === 'light' ? (on ? 'Apagar' : 'Acender') : (on ? 'Desligar' : 'Ligar')];   // nome · "Cômodo · acesa" · ação
    if (txt.join('|') === this._selTxt) return;
    this._selTxt = txt.join('|'); [this._selName.textContent, this._selState.textContent, this._selBtn.textContent] = txt; this._selEl.setAttribute('aria-label', s.room ? `${txt[0]}, ${s.room}` : txt[0]);
    this._selBtn.classList.toggle('go', it.kind !== 'sensor' && !on);   // Acender/Ligar: âmbar cheio · Apagar/Desligar: grafite
    this._selWH = [this._selEl.offsetWidth, this._selEl.offsetHeight]; this._selPlace();   // medida para o _selPlace (só quando o texto muda)
  }
  // balão preso ao ponto tocado (acompanha a câmera): dentro da faixa da cena (à direita da coluna, acima da folha); encostado na borda, a
  // ponta continua no ponto; perto do cabeçalho abre embaixo dele; some se o ponto sair por trás ou da faixa
  _selPlace() {
    const s = this._sel || this._selGone; if (!s) return;
    const el = this._selEl, v = s.p.clone().project(this._camera), W = this._canvas.clientWidth, H = this._canvas.clientHeight, P = this._pNow || 0, B = this._vb ? this._vb[0] : 0;
    const [bw, bh] = this._selWH || [200, 56], px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H, below = py - 14 - bh < (this._hudH || 0);
    const x = clamp(px, Math.min(P + 8 + bw / 2, W / 2), Math.max(W - 8 - bw / 2, W / 2));
    el.classList.toggle('below', below);
    el.style.translate = `calc(${x.toFixed(1)}px - 50%) calc(${py.toFixed(1)}px ${below ? '+ 12px' : '- 100% - 12px'})`;   // posição em translate: a escala da entrada nasce da ponta (transform-origin)
    el.style.setProperty('--ax', `${clamp(px - x, 18 - bw / 2, bw / 2 - 18).toFixed(1)}px`);   // a ponta segue o ponto
    el.style.visibility = v.z > 1 || px < P || px > W || py < 0 || py > H - B ? 'hidden' : '';
  }
  _selAct() { const k = this._sel && this._sel.key; if (!k) return; this._select(null); this._toggleItem(k); this._flashRow(k); }
  // Vista de cima: planta → 1º clique aproxima o bloco e abre os aparelhos dele no painel (v1.8) → 2º enquadra o cômodo (no bloco de lista
  // única não há esse nível) → no último nível o clique num aparelho liga/desliga ele
  _topClick(e, o) {
    const n = this._nav, p = this._groundPoint(e), h = p && this._hit(p.x, p.z);
    const toggle = (k) => { this._toggleItem(k); this._flashRow(k); };
    if (this._navEnd()) {
      const room = n.room, keys = (room || n.block).items;
      if (o && !o.userData.zone && o.userData.item && keys.includes(o.userData.item)) return toggle(o.userData.item);   // luminária, ar, telão…
      if (h && h.b !== n.block) { this._navTo(1, h.b); return; }   // outro bloco: aproxima ele e abre os aparelhos dele
      if (n.block.flat) return;   // lista única (Templo, Banheiro, Sala Pastoral): o piso não liga nada — o 1º toque já abriu, o 2º não apaga a Plateia
      if (h && h.r && h.r !== room) return this._navTo(2, n.block, h.r);
      if (o && o.userData.zone && o.userData.item) {   // piso do próprio cômodo: a luz principal dele (como no clique de sempre)
        const main = room.items.includes(o.userData.item) ? o.userData.item : room.items.find((k) => { const it = ITEMS.find((i) => i.key === k); return it && it.kind === 'light'; });   // a luz do piso tocado, se for do cômodo; senão a 1ª luz dele
        toggle(main || o.userData.item);
      }
      return;
    }
    if (!h) { this._showRoom(null); return; }   // vazio da planta: painel volta ao geral
    if (n.level === 0 || h.b !== n.block) this._navTo(1, h.b);   // 1º toque: aproxima o bloco e abre os aparelhos dele no painel (o Templo, um cômodo só, já entra nele)
    else if (h.r) this._navTo(2, h.b, h.r);
  }
  _onHover(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (this._topView && !this._navEnd()) {
      // planta e bloco: realça o bloco / cômodo sob o mouse
      const n = this._nav, p = this._groundPoint(e), h = p && this._hit(p.x, p.z);
      let rects = null, key = '', name = '';
      if (h && (n.level === 0 || h.b !== n.block || !h.r)) { rects = h.b.rects.map(([x, z, w, d]) => [x, z, x + w, z + d]); key = 'b:' + h.b.id; name = h.b.label; }   // os cômodos do bloco, não a caixa (a da Entrada cruza o WC Fem.)
      else if (h) { rects = h.r.rects.map(([x, z, w, d]) => [x, z, x + w, z + d]); key = 'r:' + h.r.id; name = h.r.label; }
      this._canvas.classList.toggle('pick', !!rects);
      if (key !== this._hoverKey) {
        if (rects) this._hlShow(rects); else this._roomHl(this._room);   // saiu: volta o realce do cômodo do painel
        this._hoverKey = key; this._setNavHint(name ? `${name} — clique para aproximar` : '');
        this._orbit.dirty = true;
      }
      return;
    }
    if (this._hoverKey) { this._roomHl(this._room); this._hoverKey = ''; }
    let o = this._pick(e); const nb = this._topView && this._nav.block;
    if (o && o.userData.zone && nb && nb.flat && nb.zones.includes(o.userData.zone)) o = null;   // piso do bloco de lista única aberto: não é clicável (_topClick)
    if (this._walkOn) this._walkHover(e);
    this._canvas.classList.toggle('pick', (!!o && !(this._walkOn && o.userData.zone)) || (this._walkOn && (!!this._doorHit() || !!this._hoverDest)));   // no modo Pessoa a folha da porta também é clicável
    if (o !== this._hoverObj) {
      // zonas em L têm vários retângulos: realça todos
      const tint = (obj, hex) => { if (obj && obj.userData.zone) for (const m of this._zoneMeshes[obj.userData.zone] || [obj]) m.material.emissive.setHex(hex); };
      tint(this._hoverObj, 0x000000); tint(o, 0x1a1a1a);
      this._hoverObj = o; this._orbit.dirty = true;
    }
  }

  // ---- Painel inferior: cômodos (blocos), rotinas, atividade ----
  _svc(domain, service, entity, data) {
    const payload = Object.assign({ entity_id: entity }, data || {});
    if (this._hass && this._hass.callService) this._hass.callService(domain, service, payload);
    this._lastSig = '';
  }
  _sceneCtx() {
    return { e: (k) => this.entity(k), on: (k) => this._svc('homeassistant', 'turn_on', this.entity(k)), off: (k) => this._svc('homeassistant', 'turn_off', this.entity(k)), call: (d, sv, e, data) => this._svc(d, sv, e, data) };
  }
  // Temporizador local: desliga a entidade depois de N minutos (enquanto o cartão estiver aberto)
  _setTimer(key, minutes) {
    const cur = this._timers[key]; if (cur) { clearTimeout(cur.handle); delete this._timers[key]; }
    if (minutes > 0) {
      const at = Date.now() + minutes * 60000;
      const handle = setTimeout(() => { delete this._timers[key]; this._svc('homeassistant', 'turn_off', this.entity(key)); this._pushActivity(key, 'off', Date.now()); this._renderPanel(); }, minutes * 60000);
      this._timers[key] = { at, handle, min: minutes };
    }
    this._renderPanel();
  }
  _timerText(key, now = Date.now()) {
    const t = this._timers[key]; if (!t) return '';
    const m = Math.max(1, Math.round((t.at - now) / 60000)); return ` · desliga em ${m} min`;
  }
  // Painel (v1.7, o da Casa v1.8): coluna à esquerda no desktop e no tablet deitado (a cena é enquadrada à direita dela, ver _resize);
  // no celular e no tablet em pé, folha de baixo com três alturas (snap: peek · half · full)
  _setPanel(open, snap = 'half') {
    this._panelOpen = !!open; this._selBand = null;   // abrir/recolher reenquadra a cena mesmo com o balão aberto
    const d = this._dock, a = this.shadowRoot.activeElement;
    cancelAnimationFrame(this._sprRaf); this._sprRaf = 0; this._sprX = 0;
    clearTimeout(this._dockT); d.classList.remove('closing');
    if (!open && !d.hidden && !this._reduced && this._wrap && this._wrap.isConnected) {   // recolhe deslizando por onde entrou (~0,2 s); o estado já vale na hora
      d.classList.add('closing');
      this._dockT = setTimeout(() => { d.classList.remove('closing'); d.hidden = !this._panelOpen; d.style.transform = ''; }, 200);
    } else { d.hidden = !open; d.style.transform = ''; }
    if (open && this._sideOverlay) this._closeGoto();   // painel por cima da cena: a lista "Ir para…" sai
    this._reopen.hidden = !!open;
    if (!open && d.contains(a)) this._reopen.focus({ preventScroll: true });   // teclado: recolheu com o foco dentro → a pílula; reabriu por ela → o resumo (no cômodo, o ‹)
    else if (open && a === this._reopen) (this._room ? this._rBack : this._countEl).focus({ preventScroll: true });
    if (this._wrap) this._wrap.classList.toggle('side', !!open);   // trilha, "Ir para…" e aviso da Pessoa ficam à direita da coluna
    this._panelBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) { this._setZone(this._onKeys().length ? 'on' : ''); this._renderPanel(); }   // abre em "Ligados" se houver algo ligado
    if (open && this._sheet) { d.dataset.snap = snap; this._grab.setAttribute('aria-expanded', snap !== 'peek' ? 'true' : 'false'); this._sideX(this._snaps()[snap]); }   // a folha entra já na altura dela
    requestAnimationFrame(() => this._resize());
  }
  // Gesto do painel (toque): arrastar a coluna para a esquerda acompanha o dedo 1:1 (limiar de 10 px antes de assumir o gesto); ao soltar,
  // abre ou fecha pela posição projetada com a velocidade do dedo e assenta numa mola que herda essa velocidade. Agarrar no meio da mola
  // interrompe e segue daqui; puxar além do aberto tem resistência progressiva. Folha de baixo: o mesmo gesto no eixo Y, com três alturas
  _swipeBind(dock) {
    let g = null;
    const W = () => (this._sheet ? this._snaps().shut : dock.offsetWidth + 16);   // deslocamento de "fechado" (sai inteira por onde entrou: esquerda, ou baixo na folha)
    const P = (e) => (this._sheet ? [e.clientY, e.clientX] : [-e.clientX, e.clientY]);   // [eixo do gesto, transversal]; coluna: + = para a esquerda
    const rubber = (x, dim) => x * dim * 0.55 / (dim + 0.55 * Math.abs(x));
    dock.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || g || e.target.closest('input[type="range"]')) return;   // o brilho (range) arrasta de lado
      const pane = this._sheet && e.target.closest('.pane');   // folha: fora da cheia o dedo em qualquer ponto move a folha; na cheia a lista rola
      const moving = !!this._sprRaf; cancelAnimationFrame(this._sprRaf); this._sprRaf = 0;
      const [sx, sy] = P(e); g = { id: e.pointerId, sx, sy, x0: this._sprX || 0, live: moving, hist: [], snap: dock.dataset.snap, pane: dock.dataset.snap === 'full' && pane };
      if (moving) try { dock.setPointerCapture(e.pointerId); } catch (_) {}
    });
    dock.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const [px, py] = P(e), dx = px - g.sx, dy = py - g.sy;
      if (!g.live) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }   // gesto transversal: é rolagem da lista
        if (g.pane && !(g.pane.scrollTop <= 0 && dx > 0)) { if (Math.abs(dx) > 10) g = null; return; }   // na cheia só puxar para baixo com a lista no topo desce a folha
        if (Math.abs(dx) < 10) return;
        g.live = true; g.sx += Math.sign(dx) * 10; try { dock.setPointerCapture(e.pointerId); } catch (_) {}   // assume o gesto: segue o dedo descontando os 10 px do limiar (sem pulo)
      }
      this._dragging = true;
      const x = g.x0 + px - g.sx;
      this._sideX(x < 0 ? -rubber(-x, W()) : x);
      g.hist.push([e.timeStamp, this._sprX]); if (g.hist.length > 6) g.hist.shift();
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g; g = null; this._dragging = false; try { dock.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!s.live) return;
      this._swiped = performance.now();   // o "click" que o navegador ainda manda ao soltar não liga o bloco
      const h = s.hist, a = h[0], b = h[h.length - 1];
      const v = e.type === 'pointerup' && a && b[0] - a[0] > 0 ? (b[1] - a[1]) / (b[0] - a[0]) * 1000 : 0;   // px/s
      const proj = this._sprX + (v / 1000) * 0.998 / (1 - 0.998);   // projeção do momento (desaceleração 0,998)
      if (this._sheet) {   // detente mais perto da projeção; fechar só a partir da espiada (senão para nela, com o cômodo e o realce)
        const S = this._snaps(); let to = Object.keys(S).reduce((q, k) => (Math.abs(S[k] - proj) < Math.abs(S[q] - proj) ? k : q), 'full');
        if (to === 'shut' && s.snap !== 'peek') to = 'peek';
        if (to !== 'shut') { this._snapTo(to, v); return; }
      }
      const close = proj > W() / 2;
      if (this._reduced) { if (close) this._setPanel(false); else this._sideX(0); return; }
      this._sideSpring(close ? W() : 0, v, () => { if (close) this._setPanel(false); });
    };
    dock.addEventListener('pointerup', end); dock.addEventListener('pointercancel', end);
    dock.addEventListener('click', (e) => { if (performance.now() - (this._swiped || 0) < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  // posição da coluna (0 = aberta, + = para a esquerda; na folha, para baixo)
  _sideX(x) {
    this._sprX = x; const s = this._dock.style; s.transform = x ? (this._sheet ? `translateY(${x}px)` : `translateX(${-x}px)`) : '';   // coluna: + = para a esquerda (fora)
    s.clipPath = this._sheet && !this._narrow && x > 0 ? `inset(0 0 ${x}px round 22px)` : '';   // folha flutuante (tablet): o que desce some no vão de 12 px, com os cantos de baixo
    s.willChange = this._sprRaf || this._dragging ? 'transform' : '';   // camada própria só enquanto a mola ou o dedo mexem
    if (this._sheet && !this._narrow) { const h = this._dShadow.style; h.height = `${Math.max(0, this._dock.offsetHeight - Math.max(0, x))}px`; h.transform = x < 0 ? s.transform : ''; }   // tablet: a sombra veste só o pedaço à vista
  }
  // alturas da folha como deslocamento para baixo: cheia (tudo), média (até metade do cartão), espiada (só a 1ª linha), fechada
  _snaps() {
    const d = this._dock, H = d.offsetHeight, el = this._room ? this._rTitle.parentNode.parentNode : this._phead;   // 1ª linha: a do cômodo ou o resumo
    const pk = el.getBoundingClientRect().bottom - d.getBoundingClientRect().top + (parseFloat(window.getComputedStyle(d).getPropertyValue('--sab')) || 0) + (this._room ? 8 : 0);   // cômodo: 8 px de respiro embaixo, como o do resumo
    return { full: 0, half: Math.max(0, H - Math.round(this.clientHeight * 0.5)), peek: Math.max(0, H - pk), shut: H + 16 };
  }
  // leva a folha a uma altura com a mola (ou direto, sem animação); a câmera reenquadra quando ela assenta
  _snapTo(n, v = 0, now = this._reduced) {   // now: sem mola (menos movimento, Tab)
    const d = this._dock; if (!this._sheet || !this._panelOpen || d.hidden) return;
    this._selBand = null;   // mudar a altura reenquadra a cena mesmo com o balão aberto
    if (n !== 'full') for (const t of Object.values(this._panes)) t.pane.scrollTop = 0;   // fora da cheia a lista volta ao topo (o clip guardaria o deslocamento)
    d.dataset.snap = n; this._grab.setAttribute('aria-expanded', n !== 'peek' ? 'true' : 'false');
    if (now) { cancelAnimationFrame(this._sprRaf); this._sprRaf = 0; this._sideX(this._snaps()[n]); this._resize(); return; }
    this._sideSpring(() => this._snaps()[n], v, () => this._resize(true));   // alvo medido a cada quadro: o conteúdo pode mudar de altura no caminho
  }
  // mola feita à mão (amortecimento 0,8, resposta 0,3 s), partindo da posição e da velocidade atuais
  _sideSpring(goal, v, done, x = this._sprX || 0, set = (p) => this._sideX(p), id = '_sprRaf') {   // x/set/id: a borda do painel usa a mesma mola
    const w = 2 * Math.PI / 0.3, k = w * w, c = 2 * 0.8 * w;
    const G = typeof goal === 'function' ? goal : () => goal; if (id === '_sprRaf') this._sprGoal = G;   // alvo (o _resize enquadra a câmera já nele)
    let last = 0, to;
    const tick = (t) => {
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 1 / 60; last = t; to = G();
      for (let i = 0, n = Math.ceil(dt * 240); i < n; i++) { v += (-k * (x - to) - c * v) * (dt / n); x += v * (dt / n); }   // Euler semi-implícito
      if (Math.abs(x - to) < 0.5 && Math.abs(v) < 8) { this[id] = 0; set(to); if (done) done(); return; }
      set(x); this[id] = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this[id]); this[id] = requestAnimationFrame(tick);
  }
  // Borda direita da coluna (desktop/tablet deitado): arrasto 1:1 com elástico nos limites; ao soltar, mola até o encaixe mais perto da
  // projeção — compacta (1 coluna) · padrão · larga (3 colunas do mesmo tamanho). Teclado ←/→ troca de encaixe, Home/End vão às pontas,
  // duplo clique volta ao padrão. Enquanto mexe só o --side-w muda (a cena espera: _sizing); a câmera reenquadra uma vez, ao assentar.
  _sizerBind(dock) {
    const sz = document.createElement('div'); sz.className = 'sizer'; sz.tabIndex = 0; this._sizer = sz;
    for (const [a, v] of [['role', 'separator'], ['aria-orientation', 'vertical'], ['aria-label', 'Largura do painel'], ['title', 'Arraste para ajustar a largura · duplo clique: padrão']]) sz.setAttribute(a, v);
    dock.appendChild(sz);
    const setW = (x) => { this._sideW = x = Math.round(x); this._wrap.style.setProperty('--side-w', `${x}px`); };
    const snaps = () => [this._sideMin, this._sideAuto, Math.min(470, this._sideMax)];
    const begin = () => { cancelAnimationFrame(this._szRaf); this._szRaf = 0; this._sizing = true; this._wrap.classList.add('sizing'); };
    const finish = () => { this._szRaf = requestAnimationFrame(() => { this._szRaf = 0; this._sizing = false; this._wrap.classList.remove('sizing'); this._resize(true); }); };   // um quadro depois (o ResizeObserver do último passo ainda espera): um reenquadramento só, deslizando
    let goal = 0;   // encaixe para onde a mola está indo (teclas seguidas andam a partir dele)
    const settle = (i, v = 0) => {   // i: encaixe (0 compacta · 1 padrão · 2 larga)
      const to = snaps()[i]; goal = to; this._sideUser = [this._sideMin, 0, 470][i];   // lembra o encaixe, não os px deste cartão; o padrão acompanha o cartão
      try { const ls = window.localStorage; if (this._sideUser) ls.setItem('igreja3d.painel_w', String(this._sideUser)); else ls.removeItem('igreja3d.painel_w'); } catch (_) {}
      if (this._reduced) { setW(to); finish(); } else this._sideSpring(to, v, finish, this._sideW, setW, '_szRaf');
    };
    const rub = (x) => x * 120 * 0.55 / (120 + 0.55 * Math.abs(x));   // além do limite: resistência progressiva
    let g = null;
    this._szStop = () => { g = null; cancelAnimationFrame(this._szRaf); this._szRaf = 0; this._sizing = false; this._wrap.classList.remove('sizing'); };   // cartão saiu da página no meio do ajuste
    sz.addEventListener('pointerdown', (e) => {
      if (this._sheet || e.button) return;
      e.preventDefault(); e.stopPropagation();   // sem seleção de texto e sem o arrasto de fechar da coluna (_swipeBind)
      begin(); try { sz.setPointerCapture(e.pointerId); } catch (_) {}
      g = { id: e.pointerId, x: e.clientX, w: this._sideW, h: [] };   // agarrou no meio da mola: segue do valor na tela
    });
    sz.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const x = g.w + e.clientX - g.x, lo = this._sideMin, hi = this._sideMax;
      setW(x < lo ? lo - rub(lo - x) : x > hi ? hi + rub(x - hi) : x);   // 1:1 com o ponto agarrado
      g.h.push([e.timeStamp, this._sideW]); if (g.h.length > 6) g.h.shift();
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g; g = null; try { sz.releasePointerCapture(e.pointerId); } catch (_) {}
      const S = snaps(); if (this._sideW === s.w && S.includes(s.w)) { finish(); return; }   // clique sem arrastar, parado num encaixe: não mexe na preferência
      const a = s.h[0], b = s.h[s.h.length - 1], v = e.type === 'pointerup' && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) * 1000 : 0;
      const p = this._sideW + v * 0.099;   // projeção curta (desaceleração 0,99): um peteleco não pula o encaixe vizinho
      settle(S.reduce((q, n, j) => (Math.abs(n - p) < Math.abs(S[q] - p) ? j : q), 0), v);
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) sz.addEventListener(t, end);   // perdeu a captura (girou, escondeu): termina igual
    sz.addEventListener('dblclick', () => { begin(); settle(1); });
    sz.addEventListener('keydown', (e) => {
      const S = snaps(), w = this._szRaf ? goal : this._sideW, k = e.key;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
      e.preventDefault();
      const i = k === 'Home' ? 0 : k === 'End' ? 2 : k === 'ArrowLeft' ? [2, 1, 0].find((j) => S[j] < w - 1) : [0, 1, 2].find((j) => S[j] > w + 1);
      if (i != null) { begin(); settle(i); }
    });
  }
  // mede o topo e posiciona a coluna (à esquerda): largura (--side-w) e topo (--side-top) logo abaixo do título — ou dos botões, se eles
  // invadirem a faixa da coluna; na folha, abaixo do cabeçalho inteiro (com a trilha da Vista de cima)
  _layoutHud(w) {
    if (!this._btnsEl || !this._wrap) return;
    const wr = this._wrap.getBoundingClientRect(), br = this._btnsEl.getBoundingClientRect();
    this._narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;   // mesmo corte do CSS
    const sheet = this._narrow || (w < 1024 && this.clientHeight > w * 1.1);   // folha de baixo: celular e tablet em pé (tamanho do cartão, não da janela)
    if (sheet !== this._sheet) {   // girou o tablet: troca folha ↔ coluna sem herdar o deslocamento do outro eixo
      this._sheet = sheet; this._wrap.classList.toggle('sheet', sheet);
      cancelAnimationFrame(this._sprRaf); this._sprRaf = 0;
      if (this._dock) { this._dock.dataset.snap = this._room ? 'half' : 'peek'; this._sideX(sheet && this._panelOpen ? this._snaps()[this._dock.dataset.snap] : 0); }
    }
    if (this._dock) this._dock[sheet ? 'addEventListener' : 'removeEventListener']('wheel', this._wheel, { passive: false });   // roda não passiva só na folha
    const lo = 272, hi = Math.max(lo, Math.min(480, Math.round(w * 0.42)));   // largura: 1 coluna de blocos … até 42 % do cartão
    this._sideAuto = Math.round(clamp(Math.min(w * 0.26, 320), lo, hi));   // padrão (sem preferência / duplo clique)
    const sw = this._sizing ? this._sideW : Math.round(clamp(this._sideUser || this._sideAuto, lo, hi));   // a lembrada, cabendo neste cartão
    this._sideMin = lo; this._sideMax = hi;
    if (this._sizer) { const z = this._sizer; z.setAttribute('aria-valuemin', lo); z.setAttribute('aria-valuemax', hi); z.setAttribute('aria-valuenow', sw); z.dataset.edge = sw <= lo ? 'min' : sw >= hi ? 'max' : ''; }
    this._sideOverlay = sheet || sw + 20 > w * 0.6;   // folha, ou coluna larga demais para dividir a tela: fica por cima, sem reenquadrar
    const hit = this._sideOverlay || br.left - wr.left < 10 + sw + 8;   // coluna à esquerda: no alto (v1.8, sem o título); abaixo do ⋯ se ele invadir a faixa
    const nb = this._navRow && !this._navRow.hidden ? this._navRow.getBoundingClientRect().bottom : 0;   // folha: também abaixo da trilha da Vista de cima
    const hb = Math.round(Math.max(br.bottom, nb) - wr.top + 8), top = sheet ? hb : hit ? Math.round(br.bottom - wr.top + 8) : 10;
    this._sideW = sw; this._wrap.style.setProperty('--side-w', `${sw}px`); this._wrap.style.setProperty('--side-top', `${top}px`); this._wrap.style.setProperty('--hud-h', `${hb}px`);
    this._hudH = hb;   // altura do cabeçalho (o _resize desconta na folha aberta; o balão abre embaixo dele)
  }
  // Painel contextual (v1.7, o da Casa): o painel focado no cômodo r (null = visão geral, com abas e filtros; um bloco = o resumo dele, nível 1
  // da Vista de cima). Abre o painel recolhido — menos na Pessoa com o painel por cima da vista (a folha cobriria o joystick); o cômodo fica
  // pronto e a pílula mostra o nome dele.
  _showRoom(r, key, stay) {   // stay: 1º toque num aparelho da maquete — o cômodo entra no painel como está (recolhido, espiada…), sem abrir nem mudar a altura
    r = this._flatUp(r) || null; const d = this._dock, ch = r !== this._room;
    if (ch) {
      this._rUp = r && !r.rooms && this._room && this._room.rooms && r.block === this._room ? this._room : null;   // cômodo aberto de dentro do bloco: o ‹ volta para o bloco
      this._room = r; d.classList.toggle('room', !!r); d.classList.toggle('bv', !!(r && r.rooms)); this._detail.hidden = true; this._detailKey = null; if (!stay) this._select(null);   // o balão é do cômodo de antes (no stay o _onClick já troca)
      this._reopen.querySelector('.rl').textContent = r ? r.label : 'Painel';
      const f = this._rFoot; f.replaceChildren();
      if (r) {   // v1.8: o bloco (r.rooms) mostra os aparelhos dele, como o cômodo — com os cômodos de subtítulo, salvo na lista única — e as automações de todos
        this._rTitle.textContent = r.label; this._showTab('ctl'); this._rSw.setAttribute('aria-label', `Tudo em ${r.label}`); this._rSw.classList.add('still'); delete this._rSw.dataset.hold;   // outro cômodo: o interruptor já nasce na posição dele
        const autos = r.rooms ? [...new Set(r.rooms.flatMap((q) => this._roomAutos(q)))] : this._roomAutos(r);
        if (autos.length) { const h = document.createElement('div'), al = document.createElement('div'); h.className = 'sect'; h.textContent = 'Automações'; al.className = 'autos'; for (const a of autos) al.appendChild(this._autoRow(a, Date.now())); f.append(h, al); }
        if (!r.rooms) f.appendChild(this._rEnter);
      }
      this._setZone(r ? '' : this._onKeys().length ? 'on' : '');   // bloco ou cômodo aberto: Todos (v1.8, ligados e desligados) · de volta ao geral: "Ligados" se houver
    }
    if (r) { const n = this._nav, up = this._topView ? n.level === 2 && !n.block.flat && n.block : this._rUp, bl = up ? `Voltar para ${up.label}` : this._topView ? 'Voltar para Planta' : 'Todos os ambientes'; this._rBack.setAttribute('aria-label', bl); this._rBack.title = bl; }   // o 2º toque muda o nível sem trocar de cômodo
    this._roomHl(r);
    if (r && !this._panelOpen && !stay && !(this._walkOn && this._sideOverlay)) this._setPanel(true);
    else { this._renderPanel(); if ((r || ch) && !stay) this._snapTo(r ? 'half' : 'peek'); }   // folha: cômodo na média, geral na espiada
    if (key) this._flashRow(key);
  }
  _flatUp(r) { return r && !r.rooms && r.block && r.block.flat && r.block.rooms.length > 1 ? r.block : r; }   // cômodo de bloco de lista única (Banheiro, Sala Pastoral) → o bloco: não abre sozinho
  // abre o bloco/cômodo pelo nome na lista; o foco do teclado vai ao ‹ (o nome some com a lista geral e o foco cairia no body)
  _openFrom(el, r) {
    const f = this.shadowRoot.activeElement === el;
    if (this._topView) { if (r.rooms) this._navTo(1, r); else this._navTo(2, r.block, r); } else this._showRoom(r.rooms && r.rooms.length === 1 ? r.rooms[0] : r);   // Templo: o cômodo dele (automações e Entrar aqui)
    if (f && this._room) this._rBack.focus({ preventScroll: true });
  }
  // realce azul do cômodo do painel (na Pessoa não: desenhado por cima de tudo, atravessaria as paredes)
  _roomHl(r) { this._hlShow(r && !this._walkOn ? r.rects.map(([x, z, w, d]) => [x, z, x + w, z + d]) : null); this._orbit.dirty = true; }
  // ---- Lista suspensa (v1.6.0; v1.8: o único botão do topo) ----
  // abre/fecha; `focus` (aberto pelo teclado) leva o foco ao 1º item; ao fechar com o foco dentro, ele volta ao ⋯. Sai encolhendo para o botão
  _menuSet(open, focus = false) {
    const m = this._menu; if (!m) return;
    if (!!open !== !!this._menuOn) {
      this._menuOn = !!open; this._menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      clearTimeout(this._menuT); m.classList.toggle('out', !open);
      if (open) { m.hidden = false; this._closeGoto(); this._updateTime(true); }
      else { this._menuT = setTimeout(() => { m.hidden = true; }, this._reduced ? 0 : 150); if (m.contains(this.shadowRoot.activeElement)) this._menuBtn.focus(); }
    }
    if (open && focus) this._menuFocus(0);
  }
  _menuItems() { return [...this._menu.querySelectorAll('button, input')].filter((b) => !b.disabled); }
  _menuFocus(i) { const it = this._menuItems(); if (it.length) it[((i % it.length) + it.length) % it.length].focus(); }
  // teclado com o menu aberto (captura na janela: antes do Walker e da trilha da Vista de cima): Esc só fecha o menu, ↑/↓/Home/End andam
  // (←/→ mexem na hora), Tab segue e, saindo da lista, ela fecha (focusout)
  _menuKey(e) {
    if (e.key === 'Escape' && this._sel && !this._menuOn) { e.stopPropagation(); this._select(null); return; }   // 1º Esc: só o balão (o cômodo do painel e a Pessoa ficam)
    if (!this._menuOn) return;
    const act = this.shadowRoot.activeElement, inside = !!act && (this._menu.contains(act) || act === this._menuBtn);
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this._menuSet(false); if (inside) this._menuBtn.focus(); return; }
    if (!inside) return;
    const it = this._menuItems(), i = it.indexOf(act), d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    const to = d ? (i < 0 ? (d > 0 ? 0 : -1) : i + d) : e.key === 'Home' ? 0 : e.key === 'End' ? -1 : null;
    if (to == null) return;
    e.preventDefault(); e.stopImmediatePropagation(); this._menuFocus(to);
  }
  _buildPanel(wrap) {
    this._wrap = wrap;
    const dock = document.createElement('div'); dock.className = 'panel dock'; dock.hidden = true; dock.setAttribute('role', 'complementary'); dock.setAttribute('aria-label', 'Painel da igreja'); wrap.appendChild(dock); this._dock = dock;
    this._dShadow = wrap.appendChild(document.createElement('div')); this._dShadow.className = 'dshadow';   // sombra da folha flutuante (tablet): irmã do .dock, fora do clip-path dele
    // folha de baixo: alça (toque alterna espiada ↔ média)
    this._grab = document.createElement('button'); this._grab.className = 'grab'; this._grab.setAttribute('aria-label', 'Expandir painel'); this._grab.setAttribute('aria-expanded', 'false'); dock.appendChild(this._grab);
    const flip = () => this._snapTo(this._dock.dataset.snap === 'peek' ? 'half' : 'peek');
    this._grab.addEventListener('click', flip);
    // cabeçalho: resumo do que está ligado (toque → "Ligados") + recolher
    const head = document.createElement('div'); head.className = 'phead'; dock.appendChild(head); this._phead = head;
    head.addEventListener('click', (e) => { if (this._sheet && !e.target.closest('button')) flip(); });
    this._countEl = document.createElement('button'); this._countEl.className = 'count'; head.appendChild(this._countEl);
    this._countSr = document.createElement('span'); this._countSr.className = 'sr'; this._countSr.setAttribute('role', 'status'); head.appendChild(this._countSr);   // leitor de tela: anuncia o que ligou/desligou
    this._countEl.addEventListener('click', () => {
      if (this._topView && this._nav.level) this._navTo(0); else this._showRoom(null);
      this._showTab('ctl'); this._setZone('on'); this._snapTo('half');
    });
    const spacer = document.createElement('div'); spacer.className = 'spacer'; head.appendChild(spacer);
    const col = document.createElement('button'); col.className = 'collapse'; col.title = 'Recolher painel'; col.setAttribute('aria-label', 'Recolher painel');
    col.innerHTML = iconSvg('chevr'); col.addEventListener('click', () => { if (this._sheet && this._dock.dataset.snap !== 'peek') this._snapTo('peek'); else this._setPanel(false); }); head.appendChild(col);   // folha: desce até a espiada; dela, fecha
    // cômodo tocado (ver _showRoom), numa linha: [‹ voltar] [nome + "N de M ligados"] [Tudo: o interruptor do cômodo/bloco (v1.8, o da Casa v1.9)]
    const rh = document.createElement('div'); rh.className = 'rhead'; dock.appendChild(rh);
    rh.innerHTML = `<button class="rback" aria-label="Todos os ambientes">${iconSvg('chevl')}</button><div class="rtitle" role="status"><b></b><small></small></div><span class="swl" aria-hidden="true">Tudo</span><button class="sw still" role="switch"></button>`;
    this._rBack = rh.firstChild; this._rBack.addEventListener('click', () => {
      const f = this.shadowRoot.activeElement === this._rBack; if (this._topView) this._navBack(); else this._showRoom(this._rUp);   // cômodo aberto do bloco: volta ao bloco
      if (f && !this._room) this._countEl.focus({ preventScroll: true });   // o ‹ some com o cômodo: o foco vai ao resumo (como ao reabrir), não ao body
    });
    this._rTitle = rh.querySelector('b'); this._rCount = rh.querySelector('small'); this._rSw = rh.lastChild;
    this._rSw.addEventListener('click', () => this._swFlip(this._rSw, this._roomKeys(this._room)));
    const tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Seções do painel'); dock.appendChild(tabs);
    this._panes = {};
    const panes = [];
    const TABS = [['ctl', 'Ambientes', 'home'], ['scn', 'Automações', 'auto'], ['act', 'Atividade', 'timer']];
    for (const [id, label, ic] of TABS) {
      const b = document.createElement('button'); b.innerHTML = `${iconSvg(ic)}<span>${label}</span>`; b.setAttribute('role', 'tab'); b.dataset.tab = id;
      b.addEventListener('click', () => this._showTab(id));
      b.addEventListener('keydown', (e) => {   // setas ← → trocam de aba (padrão WAI-ARIA)
        const i = TABS.findIndex((x) => x[0] === id), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
        e.preventDefault(); const nx = TABS[(i + d + TABS.length) % TABS.length][0]; this._showTab(nx); this._panes[nx].btn.focus();
      });
      tabs.appendChild(b);
      const pane = document.createElement('div'); pane.className = 'pane top'; pane.dataset.pane = id; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-label', label); panes.push(pane);
      pane.addEventListener('scroll', () => pane.classList.toggle('top', pane.scrollTop <= 0), { passive: true });   // folha cheia: no topo, puxar desce a folha
      this._panes[id] = { btn: b, pane };
    }
    for (const pane of panes) dock.appendChild(pane);
    this._swipeBind(dock);
    this._sizerBind(dock);
    dock.addEventListener('keydown', (e) => { if (e.key === 'Tab' && !e.shiftKey && this._sheet && dock.dataset.snap !== 'full') this._snapTo('full', 0, true); });   // Tab: a folha abre já, antes de o foco andar (o navegador rola a lista, não a página do HA)
    for (const t of ['pointerdown', 'pointerup']) dock.addEventListener(t, () => { this._tapT = performance.now(); });   // o foco que um toque/clique traz não é o do teclado
    dock.addEventListener('focusin', (e) => {   // teclado ou leitor de tela abaixo da dobra (Shift+Tab de fora): a folha sobe até a cheia, como no iOS; toque, clique e alvo à vista não mexem nela
      if (!this._sheet || dock.dataset.snap === 'full' || performance.now() - (this._tapT || 0) < 400 || e.target.getBoundingClientRect().bottom <= dock.getBoundingClientRect().bottom - (this._sprX || 0) + 1) return;
      this._snapTo('full'); this.scrollIntoView({ block: 'nearest' });   // o navegador já rolou a página até o alvo escondido: o cartão volta
      const t = e.target, p = t.closest('.pane');
      if (p) requestAnimationFrame(() => { const r = t.getBoundingClientRect(), q = p.getBoundingClientRect(); if (r.bottom > q.bottom) p.scrollTop += r.bottom - q.bottom + 12; });   // o navegador rola antes do focusin, com a lista ainda presa: rola agora
    });
    let acc = 0, last = 0, ate = false;   // roda: soma do gesto, hora do último evento, gesto já usado
    this._wheel = (e) => {   // mouse/trackpad na folha (o _layoutHud só a liga nela): ~32 px abrem a cheia (aí a lista rola) ou descem à espiada; dela para cima, rola a página
      const gap = e.timeStamp - last; last = e.timeStamp; if (gap > 600) ate = false; if (gap > 1500) acc = 0;   // pausa de 0,6 s: gesto novo; de 1,5 s: o tremor somado some
      const to = e.deltaY > 0 ? 'full' : 'peek', s = dock.dataset.snap;
      if (e.ctrlKey || !e.deltaY || (!ate && (s === 'full' || s === to))) return;
      e.preventDefault(); if (ate) return;   // o resto do gesto que mudou a altura (inércia do trackpad) não rola a lista nem a página do HA
      acc += e.deltaY * (e.deltaMode ? 40 : 1);   // em linhas (Firefox): um dente vale inteiro
      if (Math.abs(acc) >= 32) { acc = 0; ate = true; this._snapTo(to); }   // tremor de 2 px do trackpad não muda a altura
    };
    this._reopen = document.createElement('button'); this._reopen.className = 'panel btn reopen'; this._reopen.title = 'Abrir o painel'; this._reopen.setAttribute('aria-label', 'Abrir o painel');
    this._reopen.innerHTML = `${iconSvg('chevl')}<span class="rl">Painel</span><span class="rn" title="luzes acesas"></span>`; this._reopen.hidden = true;
    this._reopen.addEventListener('click', () => this._setPanel(true)); wrap.appendChild(this._reopen);
    this._buildWeather();

    // Ambientes: blocos → cômodos → aparelhos; filtro "Ligados · Todos"
    this._tiles = {}; this._tileList = [];   // _tiles: o bloco de cada aparelho · _tileList: todos, com as cópias da lista única (a luz do Pátio na Sala Pastoral)
    const zbar = document.createElement('div'); zbar.className = 'zonebar'; zbar.setAttribute('role', 'group'); zbar.setAttribute('aria-label', 'Mostrar'); this._panes.ctl.pane.appendChild(zbar); this._zbar = zbar;
    for (const [val, label] of [['on', 'Ligados'], ['', 'Todos']]) {
      const c = document.createElement('button'); c.textContent = label; c.dataset.zone = val; c.setAttribute('aria-pressed', 'false');
      c.addEventListener('click', () => this._setZone(val)); zbar.appendChild(c);
    }
    this._zEmpty = document.createElement('div'); this._zEmpty.className = 'zempty'; this._zEmpty.hidden = true; this._zEmpty.textContent = 'Tudo desligado · ';
    const all = document.createElement('button'); all.textContent = 'Ver todos'; all.addEventListener('click', () => this._setZone('')); this._zEmpty.appendChild(all); this._panes.ctl.pane.appendChild(this._zEmpty);
    const grid = document.createElement('div'); grid.className = 'tiles'; this._panes.ctl.pane.appendChild(grid); this._grid = grid;
    this._detail = document.createElement('div'); this._detail.className = 'detail'; this._detail.hidden = true;
    // v1.7 (como a Casa 1.8.1): blocos da Vista de cima → cômodos → aparelhos, cada um uma vez (r.own, ver _buildBlocks); o de vários cômodos
    // ocupa a linha e diz "também …". Todos os cômodos do bloco, na ordem da planta: o sem nada próprio (Sala Gilvan, WCs…) diz de onde vem
    // a luz e abre igual. v1.8: o bloco `flat` (Templo, Banheiro, Sala Pastoral) é uma lista só, sem subtítulos, com o nome inteiro do
    // aparelho ("Ar do templo", não "Ar"); o nome do bloco abre ele (na Vista de cima, aproxima)
    this._groups = []; this._zone = ''; this._onKeep = new Set(); const list = new Intl.ListFormat('pt-BR');
    for (const b of this._blocks) {
      const bh = document.createElement('div'); bh.className = 'blk'; grid.appendChild(bh);   // [nome ›  N de M ligados] [Tudo: o interruptor do bloco]
      bh.innerHTML = `<div class="bt"><b role="heading" aria-level="2"><button class="bn"><span></span><i aria-hidden="true">${iconSvg('chevr')}</i></button></b><small></small></div><span class="swl" aria-hidden="true">Tudo</span><button class="sw still" role="switch"></button>`;
      const bs = bh.lastChild, bn = bh.querySelector('.bn'); bn.firstChild.textContent = b.label; bn.title = `Abrir ${b.label}`; bs.setAttribute('aria-label', `Tudo em ${b.label}`);
      bn.addEventListener('click', () => this._openFrom(bn, b));
      const keys = b.items;   // só os listados embaixo (os mesmos do nível 1 da Vista de cima): a soma dos blocos não repete aparelho
      bs.addEventListener('click', () => this._swFlip(bs, keys));
      this._groups.push({ zh: bh, zn: bh.querySelector('small'), keys, sw: bs, b });
      for (const r of b.rooms) {
        if (!b.flat) { const zh = this._zoneHead(r); grid.appendChild(zh); this._groups.push({ zh, zn: zh.lastChild, keys: r.own, via: r.via, b }); }
        const cp = b.flat ? r.items.filter((k) => !b.rooms.some((q) => q.own.includes(k))) : [];   // lista única: o aparelho de outro bloco que serve a este cômodo entra como cópia, com o nome do cômodo ("Pátio")
        for (const k of [...cp, ...r.own]) {
          const it = ITEMS.find((i) => i.key === k), c = cp.includes(k); grid.appendChild(this._makeTile(it, b.flat ? b.label : r.label, c ? r.label : b.flat ? it.label : '', b, r, c));   // o rótulo do leitor de tela: o bloco da lista única
          const o = this._roomsAll().filter((q) => q !== r && q.items.includes(k) && !(b.flat && q.block === b)).map((q) => q.label); if (!o.length) continue;   // serve a outros cômodos: diz quais (na lista única, só os de fora)
          const t = this._tileList[this._tileList.length - 1], sv = document.createElement('span'); sv.className = 'sv'; sv.textContent = ` · também ${list.format(o)}`;
          t.small.appendChild(sv); t.tile.classList.add('wide'); if (!t.copy) t.tile.title += ` — também ${list.format(o)}`;   // linha inteira: o "também" cabe (a cópia guarda no título o nome da entidade)
        }
      }
    }
    grid.appendChild(this._detail);
    this._rFoot = document.createElement('div'); this._rFoot.className = 'rfoot'; this._panes.ctl.pane.appendChild(this._rFoot);   // automações do cômodo + Entrar aqui
    this._rEnter = document.createElement('button'); this._rEnter.className = 'enter'; this._rEnter.innerHTML = `${iconSvg('walk')}<span>Entrar aqui</span>`;
    this._rEnter.title = 'Entra neste cômodo na visão de Pessoa (num ponto livre, olhando para dentro)'; this._rEnter.addEventListener('click', () => this._enterRoom(this._room));
    this._timers = {};
    // Automações: rotinas rápidas do cartão + automações do HA (descobertas sozinhas)
    const h1 = document.createElement('div'); h1.className = 'sect'; h1.textContent = 'Rotinas rápidas'; this._panes.scn.pane.appendChild(h1);
    const rgrid = document.createElement('div'); rgrid.className = 'tiles routines'; this._panes.scn.pane.appendChild(rgrid);
    const h2 = document.createElement('div'); h2.className = 'sect'; h2.innerHTML = 'Automações do Home Assistant <small>ligar/desligar · executar agora</small>'; this._panes.scn.pane.appendChild(h2);
    this._autoList = document.createElement('div'); this._autoList.className = 'autos'; this._panes.scn.pane.appendChild(this._autoList);
    for (const sc of SCENES) {
      const b = document.createElement('button'); b.className = 'tile routine';
      b.innerHTML = `<span class="ico">${iconSvg(sc.icon)}</span><span><b>${sc.name}</b><small>${sc.desc}</small></span>`;
      b.addEventListener('click', () => { sc.run(this._sceneCtx()); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 700); });
      rgrid.appendChild(b);
    }
    // Atividade
    this._feed = document.createElement('ul'); this._feed.className = 'feed'; this._panes.act.pane.appendChild(this._feed);
    this._showTab('ctl');
  }
  // Clima ao vivo (Open-Meteo, sem chave) — atualiza a cada 15 min (busca e intervalo presos à conexão: _timersOn)
  _buildWeather() {
    if (!this._config.weather) return;
    // seção Clima da lista suspensa, logo depois da hora (v1.8: o título saiu): condição, cidade, sensação, vento e a hora da leitura
    const d = document.createElement('div'); d.className = 'msec'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Clima');
    d.innerHTML = `<div class="mh" aria-hidden="true">Clima</div><div class="mwx"><span class="mic">${iconSvg('cloudsun')}</span><span><b>Carregando…</b><small></small><small></small></span></div>`;
    const [line, meta, upd] = d.querySelectorAll('.mwx b, .mwx small'); meta.textContent = this._config.weather_city || 'Local';
    this._hrSec.after(d);
    this._weatherUI = { ico: d.querySelector('.mic'), line, meta, upd };
  }
  async _fetchWeather() {
    const ui = this._weatherUI; if (!ui) return;
    const lat = this._config.latitude, lon = this._config.longitude;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&timezone=auto`;
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal }); clearTimeout(to);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(); const c = j.current; if (!c) throw new Error('sem dados');
      const [iconKey, desc] = WEATHER_CODE[c.weather_code] || ['cloud', '—'];
      const icon = !c.is_day && iconKey === 'sun' ? 'night' : !c.is_day && iconKey === 'cloudsun' ? 'cloudnight' : iconKey;
      const t = Math.round(c.temperature_2m), city = this._config.weather_city || 'Local';
      ui.ico.innerHTML = iconSvg(icon);
      ui.line.textContent = `${t}° · ${desc}`;
      ui.meta.textContent = `${city} · sensação ${Math.round(c.apparent_temperature)}° · vento ${Math.round(c.wind_speed_10m)} km/h`;
      ui.upd.textContent = `atualizado ${fmtClock(Date.now())}`;
      this._weatherOk = Date.now();   // hora da última leitura boa (de volta à vista, só busca de novo depois de 10 min)
    } catch (err) {
      if (!this._weatherOk) { ui.line.textContent = 'Clima indisponível'; ui.upd.textContent = 'sem conexão'; }
      console.warn('[igreja3d-card] clima indisponível:', err && err.message);
    }
  }
  _showTab(id) {
    this._tab = id; if (id !== 'ctl' && this._feedDirty) this._renderFeed();
    for (const [k, t] of Object.entries(this._panes)) { t.btn.setAttribute('aria-selected', k === id ? 'true' : 'false'); t.btn.tabIndex = k === id ? 0 : -1; t.pane.classList.toggle('active', k === id); }
  }
  // filtro "Ligados · Todos". Ligados é uma FOTO do momento da escolha: o que liga entra na hora, o que desliga fica embaixo do dedo
  // até trocar de filtro, de cômodo ou recolher. Com um cômodo tocado, só os aparelhos dele (sensor vira leitura na linha de estado)
  _setZone(z) {
    this._zone = z || ''; if (this._zone === 'on') this._onKeep = new Set(this._onKeys());
    for (const c of this._zbar.children) c.setAttribute('aria-pressed', c.dataset.zone === this._zone ? 'true' : 'false');
    this._zoneHide(); this._panes.ctl.pane.scrollTop = 0;
  }
  _zoneHide() {
    const R = this._room, ks = R && this._roomKeys(R), on = !ks && this._zone === 'on', keep = this._onKeep;
    for (const g of this._groups) g.zh.hidden = R ? g.b !== R : on && !g.keys.some((k) => keep.has(k));   // bloco ou cômodo sem nada à vista some · bloco aberto: os subtítulos dele (o .blk sai no CSS)
    const Rb = R && (R.rooms ? R : R.block), mine = (t) => (t.copy ? t.b === Rb : !this._tileList.some((q) => q.copy && q.it.key === t.it.key && q.b === Rb));   // aberto: a cópia só no bloco dela, e nele no lugar do original
    for (const t of this._tileList) t.tile.hidden = ks ? !ks.includes(t.it.key) || !mine(t) : on && !keep.has(t.it.key);   // bloco ou cômodo aberto: todos os aparelhos dele (sensores também), ligados e desligados
    this._zEmpty.hidden = !(on && !keep.size);
  }
  // interruptor "Tudo" (v1.8, o da Casa v1.9; bloco e cômodo): ligado se algum aparelho controlável do grupo está; tocar ligado desliga tudo,
  // desligado liga luzes e som (_roomPower). Vira na hora (como o UISwitch) e segura a posição pedida até o HA concordar (no máx. 2 s)
  _swFlip(sw, keys) {
    const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); sw.dataset.hold = performance.now() + 2000;
    clearTimeout(this._swT); this._swT = setTimeout(() => this._renderPanel(), 2050); this._roomPower(on, keys);   // o HA não confirmou (aparelho fora do ar): volta ao real
  }
  _swSet(sw, n, on) {
    sw.hidden = sw.previousSibling.hidden = !n; if (+sw.dataset.hold > performance.now() && (sw.getAttribute('aria-checked') === 'true') !== on) return;
    delete sw.dataset.hold; sw.setAttribute('aria-checked', String(on)); sw.title = on ? 'Desligar tudo (luzes, ar, telão e som)' : 'Ligar tudo (luzes e som; ar e telão ficam como estão)';
    if (sw.classList.contains('still')) requestAnimationFrame(() => sw.classList.remove('still'));   // 1º desenho (e troca de cômodo) sem deslize
  }
  // aparelhos ligados agora (sensor não conta)
  _onKeys() { return ITEMS.filter((i) => i.kind !== 'sensor' && this._state[i.key] && this._state[i.key].on).map((i) => i.key); }
  _hasDetail(it) { return it.kind !== 'sensor'; }
  // "Mídia ›  1 de 2 ligados": abre o cômodo (na Vista de cima, aproxima ele) — na aba Ambientes e na Automações
  _zoneHead(r) {
    const zh = document.createElement('div'); zh.className = 'zone'; zh.dataset.room = r.label; zh.setAttribute('role', 'heading'); zh.setAttribute('aria-level', '3');
    const zt = document.createElement('button'); zt.className = 'zt'; zt.textContent = r.label; zt.insertAdjacentHTML('beforeend', `<i aria-hidden="true">${iconSvg('chevr')}</i>`); zt.title = `Abrir ${r.label}`;
    zt.addEventListener('click', () => this._openFrom(zt, r));
    const zn = document.createElement('span'); zn.className = 'zn'; zh.append(zt, zn); return zh;
  }
  _makeTile(it, room, name, blk, rm, copy) {   // room: rótulo do leitor de tela · name: o nome na lista única do bloco · copy: cópia na lista única
    const tile = document.createElement('button'); tile.className = 'tile'; tile.dataset.key = it.key; tile.dataset.kind = it.kind; tile.setAttribute('aria-pressed', 'false');
    const top = document.createElement('span'); top.className = 'top';
    const ico = document.createElement('span'); ico.className = 'ico'; ico.innerHTML = iconSvg(it.icon); top.appendChild(ico);
    const txt = document.createElement('span');
    const eye = document.createElement('span'); eye.className = 'eyebrow'; eye.textContent = room || '';
    const b = document.createElement('b'); b.textContent = name || it.short || it.label; tile.title = it.label; const small = document.createElement('small'); txt.append(eye, b, small);
    // estado em três partes (estado · separador · tempo) — o texto junto continua "acesa · 30% · há 6 min"
    const sSt = document.createElement('span'); sSt.className = 'st'; const sSep = document.createElement('span'); sSep.className = 'sep'; const sTm = document.createElement('span'); sTm.className = 'tm';
    small.append(sSt, sSep, sTm);
    tile.append(top, txt);
    const t = { tile, small, it, room, sSt, sSep, sTm, b: blk, r: rm, copy: !!copy };
    if (this._hasDetail(it)) {
      const more = document.createElement('span'); more.className = 'more'; more.innerHTML = iconSvg('more'); more.title = 'Mais controles'; more.setAttribute('role', 'button'); more.tabIndex = 0;
      more.addEventListener('click', (e) => { e.stopPropagation(); this._openDetail(it.key); });
      more.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this._openDetail(it.key); } });
      top.appendChild(more);
    }
    tile.addEventListener('click', () => this._toggleItem(it.key));
    tile.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this._roomHl(rm); });   // mouse no bloco: realça o cômodo dele (o do painel)
    tile.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this._roomHl(this._room); });
    if (!copy) this._tiles[it.key] = t; this._tileList.push(t); return tile;
  }
  // Faixa de detalhes (brilho/cor do LED, modo/temperatura do ar, controles da TV)
  _openDetail(key) {
    const it = ITEMS.find((i) => i.key === key); if (!it) return;
    const d = this._detail; d.innerHTML = ''; d.hidden = false; d.dataset.key = key; d.dataset.kind = it.kind; this._detailKey = key;
    d.setAttribute('role', 'group'); d.setAttribute('aria-label', `Controles: ${it.label}`);
    this._dSw = this._dSmall = this._dModes = this._dOut = this._dCur = this._dSwing = this._dPP = this._dVol = this._dTimer = this._dRange = null;
    const head = document.createElement('div'); head.className = 'dhead'; d.appendChild(head);
    const body = document.createElement('div'); body.className = 'dbody'; d.appendChild(body);
    const title = document.createElement('div'); title.className = 'dtitle';
    title.innerHTML = `<span class="ico">${iconSvg(it.icon)}</span><span><b>${it.label}</b><small></small></span>`;
    head.appendChild(title); this._dSmall = title.querySelector('small');
    const sw = document.createElement('button'); sw.className = 'sw'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', 'false'); sw.setAttribute('aria-label', `${it.label} ligado`);
    head.appendChild(sw); this._dSw = sw;
    if (it.rgb || it.dim) {
      sw.addEventListener('click', () => this._activate(key));
      const range = document.createElement('input'); range.type = 'range'; range.min = 1; range.max = 100; range.setAttribute('aria-label', 'Brilho');
      const st = this._state[key]; range.value = st && st.attrs && st.attrs.brightness != null ? Math.round(st.attrs.brightness / 2.55) : 100;
      range.addEventListener('change', () => this._svc('light', 'turn_on', this.entity(key), { brightness_pct: +range.value }));
      const rw = document.createElement('div'); rw.className = 'rng'; const ro = document.createElement('output'); rw.append(range, ro); this._dRange = { range, ro };
      const fill = () => { range.style.setProperty('--v', `${((+range.value - 1) / 99) * 100}%`); ro.textContent = `${range.value}%`; }; range.addEventListener('input', fill); fill();
      body.append(rw);
      if (it.rgb) {
        const sws = document.createElement('div'); sws.className = 'swatches';
        for (const [name, rgb] of LED_PRESETS) { const c = document.createElement('button'); c.className = 'swatch'; c.title = name; c.setAttribute('aria-label', name); c.style.background = `rgb(${rgb.join(',')})`; c.addEventListener('click', () => this._svc('light', 'turn_on', this.entity(key), { rgb_color: rgb })); sws.appendChild(c); }
        body.append(sws);
      }
    } else if (it.kind === 'climate') {
      sw.addEventListener('click', () => this._svc('climate', 'set_hvac_mode', this.entity(key), { hvac_mode: this._state[key] && this._state[key].on ? 'off' : 'cool' }));
      const seg = document.createElement('div'); seg.className = 'seg2'; this._dModes = {};
      for (const m of ['cool', 'fan_only', 'dry', 'heat_cool']) { const mb = document.createElement('button'); mb.textContent = HVAC_PT[m]; mb.addEventListener('click', () => this._svc('climate', 'set_hvac_mode', this.entity(key), { hvac_mode: m })); seg.appendChild(mb); this._dModes[m] = mb; }
      // v1.8: uma linha por ajuste, como no iOS — Temperatura (o alvo no − / +, a atual embaixo) e Oscilar (climate.set_swing_mode); os 4 ares
      const tr = document.createElement('div'); tr.className = 'drow';
      tr.innerHTML = '<span>Temperatura<small></small></span><div class="step"><button aria-label="Diminuir a temperatura">−</button><output aria-live="polite">—</output><button aria-label="Aumentar a temperatura">+</button></div>';
      const [minus, out, plus] = tr.querySelectorAll('.step > *'); this._dOut = out; this._dCur = tr.querySelector('small');
      const bump = (dd) => {
        const a = (this._state[key] && this._state[key].attrs) || {}, p = this._tPend;
        const base = p && p.k === key && performance.now() - p.t < 3000 ? p.v : a.temperature != null ? a.temperature : 23;   // toques seguidos somam (o HA ainda não respondeu o anterior)
        const tt = Math.round(clamp(base + dd * (a.target_temp_step || 1), a.min_temp || 16, a.max_temp || 31) * 10) / 10;
        this._tPend = { k: key, v: tt, t: performance.now() }; out.textContent = `${String(tt).replace('.', ',')}°`; this._svc('climate', 'set_temperature', this.entity(key), { temperature: tt });
      };
      minus.addEventListener('click', () => bump(-1)); plus.addEventListener('click', () => bump(1));
      const wr = document.createElement('div'); wr.className = 'drow';
      wr.innerHTML = '<span>Oscilar<small></small></span><button class="sw" role="switch" aria-checked="false" aria-label="Oscilar"></button>';
      const sg = this._dSwing = wr.lastChild;
      sg.addEventListener('click', () => {   // liga no modo de oscilar que o ar oferece (on, both, vertical…); a posição fica segura até o HA confirmar
        const ms = ((this._state[key] && this._state[key].attrs) || {}).swing_modes || [], on = sg.getAttribute('aria-checked') !== 'true';
        const m = on ? ['on', 'both', 'vertical', 'horizontal'].find((x) => ms.includes(x)) || ms.find((x) => x !== 'off') : ms.includes('off') ? 'off' : ms[0];
        sg.setAttribute('aria-checked', String(on)); sg.dataset.hold = performance.now() + 2000; this._svc('climate', 'set_swing_mode', this.entity(key), { swing_mode: m });
      });
      body.append(seg, tr, wr);
    } else if (it.kind === 'media') {
      sw.addEventListener('click', () => this._svc('media_player', this._state[key] && this._state[key].on ? 'turn_off' : 'turn_on', this.entity(key)));
      const mk = (html, label, fn) => { const x = document.createElement('button'); x.className = 'mbtn'; x.innerHTML = html; x.setAttribute('aria-label', label); x.addEventListener('click', fn); body.appendChild(x); return x; };
      this._dPP = mk(iconSvg('play'), 'Tocar / pausar', () => this._svc('media_player', 'media_play_pause', this.entity(key)));
      mk('−', 'Volume −', () => this._svc('media_player', 'volume_down', this.entity(key)));
      mk('+', 'Volume +', () => this._svc('media_player', 'volume_up', this.entity(key)));
      const vol = document.createElement('small'); body.appendChild(vol); this._dVol = vol;
    }
    if (it.kind === 'light' || it.kind === 'switch') {
      if (!it.rgb && !it.dim) sw.addEventListener('click', () => this._activate(key));
      const tm = document.createElement('div'); tm.className = 'seg2 timerseg'; tm.setAttribute('aria-label', 'Desligar em');
      const lab = document.createElement('span'); lab.className = 'tlab'; lab.innerHTML = `${iconSvg('timer')} desligar em`; tm.appendChild(lab);
      for (const m of [15, 30, 60]) { const b = document.createElement('button'); b.textContent = `${m} min`; b.addEventListener('click', () => this._setTimer(key, m)); tm.appendChild(b); }
      const cancel = document.createElement('button'); cancel.textContent = 'Nunca'; cancel.addEventListener('click', () => this._setTimer(key, 0)); tm.appendChild(cancel);
      body.appendChild(tm); this._dTimer = tm;
    }
    d.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); d.hidden = true; this._detailKey = null; const t = this._tileFor(key); const mo = t && t.tile.querySelector('.more'); if (mo) mo.focus(); } };
    const close = document.createElement('button'); close.className = 'close'; close.innerHTML = iconSvg('close'); close.setAttribute('aria-label', 'Fechar');
    close.addEventListener('click', () => { d.hidden = true; this._detailKey = null; }); head.appendChild(close);
    this._showTab('ctl'); this._renderPanel(); this._snapTo('full');   // folha: os controles pedem a altura cheia (a lista rola)
    if (!this._sheet) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // coluna: a página do HA mostra os controles; na folha a cheia já mostra
  }
  _stateText(it, st, short = false) {   // short: no bloco (o ar sem a temperatura atual, numa linha)
    if (!st || st.unavailable) return 'indisponível';
    const a = st.attrs || {};
    const n = (v) => String(v).replace('.', ',');   // 24,5°, como o resto do painel
    if (it.kind === 'climate') return st.on ? `${HVAC_PT[st.state] || st.state}${a.temperature != null ? ` · ${n(a.temperature)}°` : ''}${!short && a.current_temperature != null ? ` · ${n(a.current_temperature)}° atual` : ''}` : `Desligado${!short && a.current_temperature != null ? ` · ${n(a.current_temperature)}° atual` : ''}`;
    if (it.kind === 'media') return st.state === 'playing' && a.media_title ? `${a.media_title}` : (MEDIA_PT[st.state] || st.state);
    if (it.kind === 'sensor') return st.text || st.state;
    if (it.kind === 'switch') return st.on ? 'ligado' : 'desligado';
    const pct = st.on && a.brightness != null && (it.dim || it.rgb) ? ` · ${Math.round(a.brightness / 2.55)}%` : '';
    return (st.on ? 'acesa' : 'apagada') + pct;
  }
  _renderPanel() {
    if (!this._tiles) return;
    this._selRender();
    const kind = (k) => ITEMS.find((i) => i.key === k).kind;
    if (this._room) {   // cabeçalho do cômodo: "N de M ligados" (sensor não conta: aparece no bloco dele, como na lista Todos); sem aparelho, só o aviso
      const ks = this._roomKeys(this._room), ctl = ks.filter((k) => kind(k) !== 'sensor');
      const on = ctl.filter((k) => this._state[k] && this._state[k].on).length;
      this._rCount.textContent = !ks.length ? 'Nenhum aparelho' : ctl.length ? `${on} de ${ctl.length} ligados` : '';
      this._swSet(this._rSw, ctl.length, on > 0);
    }
    const now = Date.now();
    for (const t of this._tileList) {
      const k = t.it.key, st = this._state[k], on = !!(st && st.on);
      t.tile.classList.toggle('on', on); t.tile.classList.toggle('unavailable', !!(st && st.unavailable));
      t.tile.setAttribute('aria-pressed', on ? 'true' : 'false');
      const lc = this._lastChanged[k];
      const tm = [lc ? fmtRel(lc, now) : '', this._timerText(k, now).replace(/^ · /, '')].filter(Boolean).join(' · ');
      const stx = this._stateText(t.it, st, true);
      if (t.sSt.textContent !== stx) t.sSt.textContent = stx;
      t.sSep.textContent = tm ? ' · ' : ''; if (t.sTm.textContent !== tm) t.sTm.textContent = tm;
    }
    for (const z of this._groups || []) {
      const ks = z.keys.filter((k) => kind(k) !== 'sensor'), act = ks.filter((k) => this._state[k] && this._state[k].on).length;
      z.zn.textContent = ks.length ? `${act} de ${ks.length} ligados` : z.via || '';   // sensor não conta; cômodo sem aparelho próprio: de onde vem a luz
      if (z.sw) this._swSet(z.sw, ks.length, act > 0);
    }
    // resumo do que está ligado ("4 luzes · Telão · Som · 2 ares", +N depois de 3 partes) e o filtro "Ligados · N"
    const onK = this._onKeys(), n = onK.filter((k) => kind(k) === 'light').length, ac = onK.filter((k) => kind(k) === 'climate').length;
    if (this._countEl) {
      const parts = [...(n ? [`<b>${n}</b> ${n === 1 ? 'luz' : 'luzes'}`] : []), ...onK.filter((k) => !['light', 'climate'].includes(kind(k))).map((k) => ITEMS.find((i) => i.key === k).short), ...(ac ? [ac === 1 ? 'Ar' : `${ac} ares`] : [])];   // os 4 ares somam
      const txt = parts.length ? parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ` +${parts.length - 3}` : '') : 'Tudo desligado';
      const plain = (parts.join(' · ') || txt).replace(/<\/?b>/g, '');   // a lista inteira: o que muda dentro do "+N" também atualiza o selo e o leitor de tela
      if (this._cN !== plain) {
        this._cN = plain; this._countEl.innerHTML = `${iconSvg('bulb')}<span>${txt}</span>`;
        this._countEl.setAttribute('aria-label', `Mostrar o que está ligado: ${plain}`); this._countSr.textContent = plain;
        this._zbar.firstChild.innerHTML = `Ligados${onK.length ? ` <span class="n">${onK.length}</span>` : ''}`;   // selo âmbar: quantos estão ligados
      }
      this._countEl.classList.toggle('lit', n > 0); this._countEl.classList.toggle('any', onK.length > 0);
    }
    if (!this._room && this._zone === 'on' && onK.some((k) => !this._onKeep.has(k))) { onK.forEach((k) => this._onKeep.add(k)); this._zoneHide(); }   // o que ligou entra na foto
    if (this._reopen) {   // pílula: ligados do cômodo, ou as luzes da igreja
      const rn = this._reopen.querySelector('.rn'), m = this._room ? this._roomKeys(this._room).filter((k) => onK.includes(k)).length : n;
      if (rn) { rn.textContent = m ? String(m) : ''; rn.title = this._room ? 'ligados' : 'luzes acesas'; }
    }
    const key = this._detailKey;
    if (key && this._detail && !this._detail.hidden) {
      const st = this._state[key]; const on = !!(st && st.on); const it = ITEMS.find((i) => i.key === key);
      if (this._dSw) this._dSw.setAttribute('aria-checked', on ? 'true' : 'false');
      this._detail.classList.toggle('on', on);   // ícone do detalhe aceso como o do bloco
      if (this._dSmall) this._dSmall.textContent = this._stateText(it, st) + this._timerText(key, now);
      if (this._dTimer) for (const b of this._dTimer.querySelectorAll('button')) b.setAttribute('aria-pressed', b.textContent === (this._timers[key] ? `${this._timers[key].min} min` : 'Nunca') ? 'true' : 'false');
      if (this._dModes) for (const [m, mb] of Object.entries(this._dModes)) mb.setAttribute('aria-pressed', st && st.state === m ? 'true' : 'false');
      if (this._dRange && st && st.attrs && st.attrs.brightness != null && this._dRange.range.getRootNode().activeElement !== this._dRange.range) {
        const r = this._dRange.range; r.value = Math.max(1, Math.round(st.attrs.brightness / 2.55)); r.dispatchEvent(new Event('input'));
      }
      if (this._dOut && st && st.attrs) {   // ar: o alvo (o pedido ainda sem resposta fica à vista), a atual e o oscilar
        const a = st.attrs, p = this._tPend, ms = Array.isArray(a.swing_modes) && a.swing_modes.length > 1 ? a.swing_modes : null, sw = !!a.swing_mode && a.swing_mode !== 'off', sg = this._dSwing;
        if (a.temperature != null && !(p && p.k === key && performance.now() - p.t < 3000 && p.v !== a.temperature)) this._dOut.textContent = `${String(a.temperature).replace('.', ',')}°`;
        this._dCur.textContent = a.current_temperature != null ? `atual ${String(a.current_temperature).replace('.', ',')}°` : 'alvo';
        if (!(+sg.dataset.hold > performance.now()) || (sg.getAttribute('aria-checked') === 'true') === sw) { delete sg.dataset.hold; sg.setAttribute('aria-checked', String(sw)); }
        sg.disabled = !ms; sg.previousSibling.lastChild.textContent = !ms ? 'este ar não informa ao HA' : sw ? 'ligado' : 'desligado';
      }
      if (this._dPP) this._dPP.innerHTML = iconSvg(st && st.state === 'playing' ? 'pause' : 'play');
      if (this._dVol && st && st.attrs) this._dVol.textContent = st.attrs.volume_level != null ? `vol ${Math.round(st.attrs.volume_level * 100)}%` : '';
    }
    if (this._panelOpen && this._tab !== 'ctl') this._renderFeed(now); else this._feedDirty = true;   // Automações e Atividade só com a aba à vista (a troca de aba refaz)
  }
  _pushActivity(key, state, ts, seed = false) {
    this._activity.push({ key, state, ts, seed });
    this._activity.sort((a, b) => b.ts - a.ts);
    if (this._activity.length > 40) this._activity.length = 40;
  }
  _renderAutos(now = Date.now()) {
    const el = this._autoList; if (!el) return;
    el.innerHTML = '';
    if (!this._autos.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = this._hass ? 'Nenhuma automação encontrada no Home Assistant.' : 'As automações do HA aparecem aqui quando o cartão está no Home Assistant.'; el.appendChild(e); return; }
    // v1.7 (como a Casa 1.8.1): por bloco → cômodo (o do _roomAutos), cada uma uma vez; a que empata em mais de um cômodo do bloco fica no
    // bloco; o resto em "Outras automações". O bloco é o mesmo título da aba Ambientes
    const seen = new Set(), head = (t) => { const h = document.createElement('div'); h.className = 'blk'; h.innerHTML = '<div class="bt"><b role="heading" aria-level="2"></b></div>'; h.querySelector('b').textContent = t; el.appendChild(h); };
    const add = (a) => { seen.add(a); el.appendChild(this._autoRow(a, now)); };
    for (const b of this._blocks) {
      const per = b.rooms.map((r) => [r, this._roomAutos(r).filter((a) => !seen.has(a))]), all = per.flatMap(([, l]) => l); if (!all.length) continue;
      head(b.label);
      new Set(all.filter((a, i) => all.indexOf(a) !== i)).forEach(add);   // de mais de um cômodo do bloco
      for (const [r, l] of per) { const m = l.filter((a) => !seen.has(a)); if (m.length) { if (!b.flat) el.appendChild(this._zoneHead(r)); m.forEach(add); } }   // lista única: sem subtítulo
    }
    const rest = this._autos.filter((a) => !seen.has(a));
    if (rest.length && seen.size) head('Outras automações');
    for (const a of rest) el.appendChild(this._autoRow(a, now));
  }
  // linha de uma automação do HA: ativar/desativar + executar agora (painel lateral e painel do cômodo)
  _autoRow(a, now = Date.now()) {
    const row = document.createElement('div');
    row.innerHTML = `<span class="ico">${iconSvg('auto')}</span><span><b></b><small></small></span>`;
    row.querySelector('b').textContent = a.name; const sm = row.querySelector('small');
    const sw = document.createElement('button'); sw.className = 'sw'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', `${a.name} ativa`);
    const paint = () => {   // a própria linha muda na hora (no cômodo e na aba), sem redesenhar o painel
      row.className = 'auto ' + (a.on ? 'on' : 'off'); sw.setAttribute('aria-checked', a.on ? 'true' : 'false');
      sm.textContent = `${a.last ? `executou ${fmtRel(a.last, now)} · ${fmtClock(a.last)}` : 'nunca executou'}${a.on ? '' : ' · desativada'}`;   // curto e o "há …" antes da hora: na coluna estreita as reticências cortam só a hora
    };
    paint();
    sw.addEventListener('click', () => { a.on = !a.on; this._svc('automation', a.on ? 'turn_on' : 'turn_off', a.id); paint(); this._renderAutos(); });
    const run = document.createElement('button'); run.className = 'run'; run.innerHTML = iconSvg('play'); run.title = 'Executar agora'; run.setAttribute('aria-label', `Executar ${a.name}`);
    run.addEventListener('click', () => { this._svc('automation', 'trigger', a.id, { skip_condition: true }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 600); });
    row.append(sw, run); return row;
  }
  _renderFeed(now = Date.now()) {
    if (!this._feed) return;
    this._feedDirty = false;
    this._renderAutos(now);
    this._feed.innerHTML = '';
    if (!this._activity.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nenhuma atividade ainda.'; this._feed.appendChild(li); return; }
    for (const ev of this._activity.slice(0, 30)) {
      if (ev.state === 'triggered') {
        const a = this._autos.find((x) => x.id === ev.key); const li = document.createElement('li');   // disparou: grafite
        li.innerHTML = `<i class="d">${iconSvg('auto')}</i><span><b>${a ? a.name : ev.key}</b> disparou</span><time>${fmtClock(ev.ts)} · ${fmtRel(ev.ts, now)}</time>`;
        this._feed.appendChild(li); continue;
      }
      const it = ITEMS.find((i) => i.key === ev.key); if (!it) continue;
      const li = document.createElement('li');
      const on = it.kind === 'climate' ? ev.state !== 'off' : it.kind === 'media' ? (ev.state === 'playing' || ev.state === 'on' || ev.state === 'paused') : ev.state === 'on';
      li.classList.toggle('on', on && it.kind !== 'sensor');   // âmbar só no que acendeu/ligou (sensor é leitura)
      let what;
      if (it.kind === 'climate') what = ev.state === 'off' ? 'desligado' : `→ ${HVAC_PT[ev.state] || ev.state}`;
      else if (it.kind === 'media') what = `→ ${MEDIA_PT[ev.state] || ev.state}`;
      else if (it.kind === 'sensor') what = it.key === 'presenca' ? (ev.state === 'on' ? '→ pessoas no templo' : '→ vazio') : it.key === 'porta' ? (ev.state === 'on' ? 'aberta' : 'fechada') : `→ ${ev.state} °C`;
      else if (it.kind === 'switch') what = ev.state === 'on' ? 'ligado' : 'desligado';
      else what = ev.state === 'on' ? 'acesa' : 'apagada';
      li.innerHTML = `<i class="d">${iconSvg(it.icon)}</i><span><b>${it.label}</b> ${what}</span><time datetime="${new Date(ev.ts).toISOString()}">${fmtClock(ev.ts)} · ${fmtRel(ev.ts, now)}</time>`;
      this._feed.appendChild(li);
    }
  }
  _tileFor(key) { return (this._tileList || []).find((t) => t.it.key === key && !t.tile.hidden) || (this._tiles && this._tiles[key]); }   // o bloco à vista (a cópia da lista única, se for ela)
  _flashRow(key) {
    const t = this._tileFor(key); if (!t || !this._panelOpen) return;
    this._showTab('ctl'); if (t.tile.hidden) this._setZone(''); t.tile.classList.add('flash');
    const p = t.tile.closest('.pane'), r = t.tile.getBoundingClientRect(), q = p.getBoundingClientRect();
    if (r.top < q.top || r.bottom > q.bottom) p.scrollBy({ top: r.top - q.top - 12, behavior: 'smooth' });   // só a lista rola, nunca a página do HA (fora da cheia ela é clip e fica)
    setTimeout(() => t.tile.classList.remove('flash'), 900);
  }

  // ---- Loop ----
  _resize(fly = false) {
    if (!this._renderer) return;
    const w = Math.max(1, this.clientWidth), h = Math.max(1, this.clientHeight);
    // Resolução cheia (parado): até o pixel ratio da tela, com teto por nível (alta 2,8 Mpx · media 2,4 · leve 2,0 · min 1,4).
    // O movimento desenha uma fração disso (governador), então o teto alto só pesa no quadro nítido, que é um só.
    const strong = this._q === 'alta' && Igreja3DCard._strongGPU();
    const [cap, px] = this._q === 'alta' ? (strong ? [2.5, 3.5e6] : [2, 2.8e6]) : this._q === 'media' ? [2, 2.4e6] : this._min ? [1.5, 1.4e6] : [2, 2.0e6];
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(px / (w * h))));
    // mexer no tamanho do canvas o apaga (quadro preto até o próximo desenho): só quando muda de verdade — painel, trilha e cômodo
    // chamam o _resize só para reenquadrar a câmera —, e aí redesenha na hora (fim da função)
    const rd = this._renderer, sz = rd.getSize(_rsz), changed = dpr !== this._dprFull || sz.x !== w || sz.y !== h;
    if (changed) {
      this._dprFull = dpr; this._lowRes = false;   // o governador (movimento) escala a partir daqui
      if (!this._gov) this._govInit();
      rd.setPixelRatio(Math.min(dpr * Math.min(this._gov.idleScale, this._govIdleMax()), 3));   // mantém a nitidez escolhida pelo governador
      rd.setSize(w, h, false);
    }
    const wr = this._wrap;
    if (wr) { wr.classList.toggle('narrow', w <= 640); wr.style.setProperty('--cw', w + 'px'); wr.style.setProperty('--ch', h + 'px'); }   // a lista suspensa cabe no cartão
    this._layoutHud(w);
    // v1.7: com o painel aberto (desktop/tablet deitado) a cena é enquadrada na faixa à DIREITA da coluna (P); na folha de baixo (celular/tablet
    // em pé), entre o cabeçalho (T) e a parte VISÍVEL dela (B). Fora da folha, o HUD de cima alto (a trilha da Vista de cima quebrada) empurra a cena (U)
    const open = this._panelOpen && this._dock && !this._dock.hidden;
    if (open && this._sheet && !this._sprRaf && !this._dragging && this._dock.dataset.snap) this._sideX(this._snaps()[this._dock.dataset.snap]);   // conteúdo mudou de altura: fica no mesmo detente
    const hudH = this._hudTop ? this._hudTop.offsetHeight : 0, U = hudH > 90 ? Math.min(hudH, h * 0.3) : 0;
    let P = open && !this._sideOverlay ? this._sideW + 20 : 0, B = open && this._sheet ? Math.max(0, wr.clientHeight - this._dock.offsetTop - (this._sprRaf ? this._sprGoal() : this._sprX || 0)) : 0, T = B ? this._hudH || 0 : U;
    const fz = this._selBand; if (fz && fz[3] === w && fz[4] === h) [P, B, T] = fz;   // balão aberto: o painel mudou de conteúdo, a cena fica onde o dedo está
    const p0 = this._pNow; this._vb = [B, T, w, h]; this._viewP(P);   // já na faixa final: o _resetView enquadra por ela
    if (!this._orbit.touched) this._resetView(fly);   // fly: a folha assentou, a câmera desliza até o novo quadro
    this._pA = fly && !this._reduced && p0 != null && p0 !== P ? [p0, P, 0] : null;   // a borda do painel assentou: a faixa da cena desliza em 0,25 s (_frame), sem pulo
    if (this._pA) this._viewP(p0);
    this._orbit.dirty = true;
    const dc = this._pegDica;   // dica do bonequinho: logo abaixo do ⋯ (ele mora na lista), a seta no meio do botão
    if (dc && wr) { const r = this._menuBtn.getBoundingClientRect(), q = wr.getBoundingClientRect(); dc.hidden = !r.width; dc.style.top = `${r.bottom - q.top + 10}px`; dc.style.right = `${Math.max(8, q.right - r.right - 60)}px`; dc.style.setProperty('--ax', `${q.right - (r.left + r.right) / 2 - Math.max(8, q.right - r.right - 60) - 6}px`); }
    if (changed && this._raf && !this._busy) rd.render(this._scene, this._camera);   // o ResizeObserver roda depois do quadro: sem isso a tela piscaria preta
  }
  _viewP(P) {   // câmera na faixa livre: P px à esquerda (coluna), T em cima (cabeçalho) e B embaixo (folha); B, T e o tamanho vêm do _resize
    const [B, T, w, h] = this._vb, vw = Math.max(160, w - P), vh = Math.max(120, h - B - T), c = this._camera;
    this._pNow = P; this._vh = vh; c.aspect = vw / vh; if (this._walkOn) c.fov = this._walkFov();
    if (P || B || T) c.setViewOffset(vw, vh, -P, -T, w, h); else c.clearViewOffset();
    c.updateProjectionMatrix();
  }
  _dicaOff() { if (!this._pegDica) return; this._pegDica.remove(); this._pegDica = null; try { window.localStorage.setItem('igreja3d.dica_pessoa', '1'); } catch { /* só nesta sessão */ } }
  _start() {
    if (this._raf || !this._renderer) return;
    this._clock.start();
    const tick = () => { this._raf = requestAnimationFrame(tick); if (!this._sizing) this._frame(); else this._clock.getDelta(); };   // ajustando a largura: a cena espera (sem acumular o tempo: o 1º quadro depois não pula)
    this._raf = requestAnimationFrame(tick);
  }
  _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; this._clock.stop(); }

  // Sequência de cada unidade de ar (estilo split real): o LED pisca duas vezes (o "bip") e fica aceso → ~0,35 s depois a aleta destrava e abre devagar
  // (mola: passa um tico e assenta) → o fluxo nasce da aleta, cresce até o comprimento cheio (~1,4 s) e a névoa começa a descer. Com o ar rodando a aleta
  // balança de leve (só enquanto a animação anda). Ao desligar o fluxo recolhe primeiro (~0,7 s), a aleta fecha logo em seguida (~0,75 s) e por fim o LED apaga.
  // rt.seq = { t0, off[i] } escalona o início de cada unidade (templo: uma após a outra).
  // Sem animação (unidades vão direto ao estado): carga inicial, prefers-reduced-motion, aba oculta e cartão fora da tela. Devolve true enquanto algo muda.
  _airStep(rt, ledColor, now, dt, nl, key) {
    const U = rt.airUnits, m = rt.airMesh; if (!U || !U.length || !m) return false;
    const snap = rt.snap || this._reduced || (typeof document !== 'undefined' && document.hidden) || this._onScreen === false;
    const on = !!rt.on, seq = rt.seq, top = !!this._topView, G = m.material.uniforms.uG.value, sm = (x) => x * x * (3 - 2 * x);
    // mola amortecida da aleta abrindo (f: 0…1 → 0…1 com ~7% de passada e assentamento)
    const spring = (f) => { if (f <= 0) return 0; if (f >= 1) return 1; const tau = f * 1.25; return 1 - Math.exp(-5.2 * tau) * (Math.cos(6.4 * tau) + 0.81 * Math.sin(6.4 * tau)); };
    const sway = (this._reduced || !(now < (rt.airUntil || 0) || (this._airFocus && this._airFocus.key === key))) ? 0 : (this._airFocus && this._airFocus.key === key ? 1 : Math.min(1, ((rt.airUntil || 0) - now) / 1500));
    let busy = false, vis = false;
    for (let i = 0; i < U.length; i++) {
      const u = U[i]; const want = on && !(seq && now < seq.t0 + seq.off[i]) ? 1 : 0;
      if (snap) { u.led = u.f = u.g = want; u.on = !!want; u.ign = 0; }
      else if (want) {
        if (!u.on) { u.on = true; u.ign = now; }
        const age = (now - u.ign) / 1000;
        u.led = Math.min(1, u.led + dt / 0.08);
        if (age > 0.35) u.f = Math.min(1, u.f + dt / 1.0);
        if (u.f > 0.45) u.g = Math.min(1, u.g + dt / 1.4);
      } else {
        u.on = false; u.ign = 0;
        u.g = Math.max(0, u.g - dt / 0.7); if (u.g < 0.6) u.f = Math.max(0, u.f - dt / 0.75); if (u.f <= 0) u.led = Math.max(0, u.led - dt / 0.25);
      }
      if (u.g !== want || u.f !== want || u.led !== want) busy = true;
      const fl = rt.flaps[i], lm = rt.ledMats[i], b = rt.badges[i];
      if (fl) {
        fl.visible = u.f > 0.01;
        const swing = sway > 0 && u.f >= 1 ? 0.045 * sway * Math.sin(now * 0.0016 + i * 1.7) : 0;   // vai-e-vem lento das palhetas
        fl.rotation.x = 0.9 * (want ? spring(u.f) : sm(u.f)) + swing;
      }
      if (lm) {
        lm.emissive.setHex(ledColor);
        // bip: pisca duas vezes (LED todo aceso, meio, aceso, meio…) e assenta com um brilho um pouco mais forte que se acalma
        const age = u.ign ? (now - u.ign) / 1000 : 9;
        let k = 1; if (age < 0.6) k = Math.floor(age / 0.15) % 2 === 0 ? 1.25 : 0.12; else if (age < 1.1) k = 1 + 0.3 * (1 - (age - 0.6) / 0.5);
        lm.emissiveIntensity = u.led * 2.2 * (want ? k : 1);
        if (age < 1.1) busy = true;
      }
      G[i] = sm(u.g); if (u.g > 0.001) vis = true;
      if (b) {
        // selo do modo (Vista de cima): pulsa na hora em que a unidade liga
        b.visible = top && u.led > 0.01;
        const age = u.ign ? (now - u.ign) / 1000 : 9, pulse = age < 1.4 ? (1 - age / 1.4) * (0.55 + 0.45 * Math.cos(age * 13)) : 0;
        const sc = 0.042 * (1 + 1.1 * pulse); if (b.scale.x !== sc) b.scale.set(sc, sc, 1);
        if (top && pulse > 0) busy = true;
      }
    }
    m.visible = vis;
    if (rt.badgeMat && rt.on) { const tx = this._airBadge(rt.hvac); if (rt.badgeMat.map !== tx) { rt.badgeMat.map = tx; rt.badgeMat.needsUpdate = true; } }
    const uf = m.material.uniforms; uf.uI.value = THREE.MathUtils.lerp(0.45, 0.6, nl) * (top ? 1.5 : 1); uf.uTop.value = top ? 1 : 0; uf.uC.value.setHex(AIR_COL[rt.hvacOn || rt.hvac] || 0xe8eef4);
    const pt = rt.airPts;
    if (pt) {
      pt.visible = vis; const pu = pt.material.uniforms;
      pu.uI.value = THREE.MathUtils.lerp(0.55, 0.85, nl) * (top ? 0.6 : 1); pu.uC.value.copy(uf.uC.value);
      pu.uPS.value = this._renderer.domElement.height * 0.5 * this._camera.projectionMatrix.elements[5];
      // névoa cheia enquanto a animação anda; no fim da janela (airUntil) esmaece até um resto discreto (o mesmo valor que fica parado)
      const run = this._airFocus && this._airFocus.key === key ? 1 : clamp(((rt.airUntil || 0) - now) / 1500, 0, 1);
      pu.uP.value = 0.28 + 0.72 * run;
    }
    rt.snap = false;
    return busy;
  }

  // Um ou mais ares acabaram de ligar (depois da carga): escalona as unidades (templo: uma após a outra, ~2,5 s) e leva a câmera junto.
  // Órbita: voo até o aparelho (templo: tour pelos 5 splits + enquadramento final da plateia); Vista de cima: navega até o cômodo e fica na
  // planta; Pessoa: só a animação. A animação anda durante a sequência e por 8 s depois da última unidade.
  _airStart(keys) {
    const now = performance.now(), lead = this._reduced ? 0 : 600, stag = this._reduced ? 0 : 2500;
    let hero = null, heroN = 0, total = 0;
    for (const key of keys) {
      const rt = this._items.get(key); const n = rt && rt.airUnits ? rt.airUnits.length : 0; if (!n) continue;
      const off = new Array(n);
      rt.airOrder.forEach((ui, rank) => { off[ui] = n > 1 ? lead + rank * stag : 0; });
      rt.seq = { t0: now, off }; if (n === 1) rt.seq.off[0] = this._reduced ? 0 : 400;
      const end = Math.max(...off) + 2600;
      rt.airUntil = Math.max(rt.airUntil || 0, now + end + 8000); total = Math.max(total, end);
      if (n >= heroN) { hero = key; heroN = n; }
    }
    if (!hero || this._walkOn) return;   // a pessoa não é teleportada: só vê a animação
    if (this._topView) { this._airFocus = null; this._airNavTo(hero); return; }
    const rt = this._items.get(hero), U = rt.airUnits;
    if (U.length < 2 || this._reduced) { this._flyToAir(hero); return; }
    // tour: uma parada por unidade (a câmera parte ~0,6 s antes de a unidade ligar) e o quadro final com todas
    const steps = rt.airOrder.map((ui, rank) => ({ t: rank * stag, ...this._airShot([U[ui]]), speed: 3.2 }));
    steps.push({ t: U.length * stag, ...this._airShot(U, true), speed: 2.2 });
    this._setTopView(false, true);
    this._airTour = { at: now, i: 0, steps };
    this._airFocus = { key: hero, at: now, until: now + U.length * stag + 45000 };
    this._orbit.touched = true;
  }
  // Vista de cima: leva a planta até o cômodo do ar (no templo, o Templo inteiro)
  _airNavTo(key) {
    for (const b of this._blocks || []) for (const r of b.rooms) if (r.items.includes(key)) {
      const n = this._nav; if (n.level === 2 && n.room === r) return;
      this._navTo(2, b, r); return;
    }
  }
  // passos do tour da câmera; qualquer gesto do usuário (arrastar, girar, zoom) o interrompe — as unidades restantes continuam ligando
  _airTourRun(now) {
    const T = this._airTour, o = this._orbit;
    if (this._walkOn || this._topView || (o.userAt || 0) > T.at) { this._airTour = null; return; }
    while (T.i < T.steps.length && now - T.at >= T.steps[T.i].t) { const st = T.steps[T.i++]; this._flyCam(st.pos, st.target, st.speed); o.touched = true; }
    if (T.i >= T.steps.length) this._airTour = null;
  }

  // Fluxo dos ares: a textura só anda (~16 q/s) com o ar ligado E no enquadramento E (nos primeiros 8 s depois de
  // ligar OU com a câmera focada nele depois do voo); fora disso fica parado e visível — sem ar ligado, 0 redesenhos.
  // Respeita prefers-reduced-motion, aba oculta e cartão fora da tela.
  _airTick() {
    if (this._reduced || (typeof document !== 'undefined' && document.hidden) || this._onScreen === false) return false;
    const now = performance.now(); if (now - (this._airLast || 0) < 60) return false;
    const f = this._airFocus, o = this._orbit;
    if (f && (now > f.until || (o.userAt || 0) > f.at)) this._airFocus = null;   // o usuário girou/aproximou: solta o foco
    let run = false;
    for (const key of AC_KEYS) {
      const rt = this._items.get(key); const m = rt && rt.airMesh; if (!m || !m.visible) continue;
      if (!(now < (rt.airUntil || 0) || (this._airFocus && this._airFocus.key === key))) continue;
      if (!this._frustum) { this._frustum = new THREE.Frustum(); this._pv = new THREE.Matrix4(); }
      this._pv.multiplyMatrices(this._camera.projectionMatrix, this._camera.matrixWorldInverse); this._frustum.setFromProjectionMatrix(this._pv);
      if (!this._frustum.intersectsSphere(m.geometry.boundingSphere)) continue;
      m.material.uniforms.uT.value = (now / 1000) % 1000; if (rt.airPts) rt.airPts.material.uniforms.uT.value = m.material.uniforms.uT.value; run = true;
    }
    if (run) this._airLast = now;
    return run;
  }

  _frame() {
    if (this._busy) return;   // compilando shaders (_precompile)
    const dt = Math.min(this._clock.getDelta(), 0.1);
    const t = this._clock.elapsedTime;
    let dirty = this._walkOn ? this._walk.update(dt) : this._orbit.update(dt);
    if (this._pA) { const a = this._pA, k = Math.min(1, (a[2] += dt) / 0.25); this._viewP(a[0] + (a[1] - a[0]) * (1 - (1 - k) ** 3)); if (k === 1) this._pA = null; dirty = true; }   // faixa da cena deslizando até a nova borda do painel
    if (this._walkOn && this._doorsTick(dt)) dirty = true;   // portas abrindo/fechando na visão de pessoa
    if (this._walkOn && this._mkTick(t)) dirty = true;        // marcador do destino pulsando
    const k = 1 - Math.exp(-dt * 7);
    // Ambiente dia/noite — em "auto" segue a elevação do sol (transição suave no crepúsculo)
    this._updateTime();
    const elev = this._sunInfo ? this._sunInfo.elevation : -20;
    const nightGoal = this._mode === 'night' ? 1 : this._mode === 'day' ? 0 : clamp((6 - elev) / 10, 0, 1);
    if (this._mode === 'auto' && this._night !== (nightGoal > 0.5)) { this._night = nightGoal > 0.5; this._nvSync(); }
    if (this._nightLevel === undefined) this._nightLevel = nightGoal;
    if (Math.abs(this._nightLevel - nightGoal) > 0.002) { this._nightLevel += (nightGoal - this._nightLevel) * k; dirty = true; this._needShadow = true; }
    else if (this._nightLevel !== nightGoal) { this._nightLevel = nightGoal; dirty = true; this._needShadow = true; }
    const nl = this._nightLevel;
    // Visão noturna: à noite, luz de lua mais forte + ambiente frio para a igreja inteira ficar legível
    const nvGoal = this._nightVision ? 1 : 0;
    if (this._nvLevel === undefined) this._nvLevel = nvGoal;
    if (Math.abs(this._nvLevel - nvGoal) > 0.002) { this._nvLevel += (nvGoal - this._nvLevel) * k; dirty = true; }   // só intensidades: as sombras ficam
    else if (this._nvLevel !== nvGoal) { this._nvLevel = nvGoal; dirty = true; }
    const nv = this._nvLevel, L = THREE.MathUtils.lerp;
    this._hemi.intensity = L(0.85, L(0.22, 0.66, nv), nl);   // de dia menos luz chapada → sombras com volume
    this._hemi.color.setHex(0xe4ecf5).lerp(new THREE.Color(0x4a5f92), nl);
    this._hemi.groundColor.setHex(0xa08c70).lerp(new THREE.Color(0x1c2130), nl);
    this._amb.intensity = L(0.12, L(0.14, 0.36, nv), nl);   // visão noturna um pouco mais escura: letreiro e refletores aparecem
    this._amb.color.setHex(0xdde4ee).lerp(new THREE.Color(0x6b7aa8), nl);
    // sol: posição pelo azimute/elevação reais (no dia); cor esquenta perto do horizonte
    const az = ((this._sunInfo ? this._sunInfo.azimuth : 90) - this._config.orientation) * Math.PI / 180;   // v1.8: sentido corrigido (antes −(o−180): com o 90 do README o sol nascia/punha do lado oposto)
    const elr = Math.max(elev, 4) * Math.PI / 180;
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(elr), Math.sin(elr), -Math.cos(az) * Math.cos(elr));
    if (this._mode === 'day') sunDir.copy(this._sunPos).normalize();
    const sunPos = this._sun.target.position.clone().addScaledVector(sunDir, this._sunDist);
    // no modo "Dia" forçado (mesmo com o sol real abaixo do horizonte) usa um sol de meio da manhã
    const effEl = this._mode === 'day' ? Math.max(elev, 50) : elev;
    const warm = clamp(1 - effEl / 14, 0, 1);
    const dayCol = this._sunCol.clone().lerp(new THREE.Color(0xff9848), warm * 0.85);
    const dayInt = 3.2 * clamp(0.25 + Math.sin(Math.max(effEl, 0) * Math.PI / 180) * 1.5, 0.25, 1);
    this._sun.intensity = L(dayInt, L(0.5, 1.15, nv), nl);
    this._sun.position.lerpVectors(sunPos, this._moonPos, nl);
    this._sun.color.copy(dayCol).lerp(this._moonCol, nl);
    if (!this._lastSunPos || this._lastSunPos.distanceToSquared(this._sun.position) > 0.01) { this._lastSunPos = this._sun.position.clone(); this._needShadow = true; dirty = true; }
    const dusk = this._mode === 'auto' ? clamp(1 - Math.abs(elev) / 9, 0, 1) * 0.95 : 0;
    this._skyDusk.material.opacity = dusk;
    this._skyDay.material.opacity = (1 - nl) * (1 - dusk * 0.85);
    this._hemi.color.lerp(new THREE.Color(0xffb27a), dusk * 0.5 * (1 - nl));
    this._scene.fog.color.setHex(0xd6e4f2).lerp(new THREE.Color(0xf0a070), dusk * 0.6).lerp(new THREE.Color(0x0a0f1e), nl);
    if (this._groundFlat) this._groundFlat.color.setHex(0x8a8c74).lerp(new THREE.Color(0x151a24), L(nl, nl * 0.75, nv));
    const envI = L(0.9, L(0.35, 0.7, nv), nl);   // PMREM mais forte: reflexo em vidro/metal
    if (this._probe) { this._probe.sh.copy(this._shDay).lerp(this._shNight, nl); this._probe.intensity = envI; }   // media: luz difusa do céu
    if (this._envDay) {
      const env = nl > 0.5 ? this._envNight : this._envDay;
      if (this._envMats) for (const m of this._envMats) { m.envMap = env; m.envMapIntensity = envI; }   // media: só nos brilhantes
      else { if (this._scene.environment !== env) this._scene.environment = env; this._scene.environmentIntensity = envI; }
    }
    // Luzes (fade) e materiais emissivos
    let ambient = false;   // animação ociosa (telão pulsando)
    const nowA = performance.now(), dtA = Math.min((nowA - (this._airPrev || nowA)) / 1000, 0.25); this._airPrev = nowA;   // relógio real dos ares (independe do clamp do dt)
    if (this._airTour) this._airTourRun(nowA);
    // luz de dia: as lâmpadas pesam menos na cena
    const dayScale = L(0.45, 1, nl);
    // media: com a câmera parada, as luzes reais vão para as luminárias que importam neste enquadramento
    if (this._pool && !this._orbit.moving) {
      const c = this._camera.position, o = this._orbit.target;
      let sig = [c.x, c.y, c.z, o.x, o.y, o.z].map((v) => v.toFixed(1)).join();
      for (const [key, rt] of this._items) if (rt.cands && Math.max(rt.target * (rt.brightScale || 1), rt.level) >= 0.01) sig += key;
      if (sig !== this._poolSig) { this._poolSig = sig; this._assignPool(); dirty = true; }
    }
    for (const it of ITEMS) {
      const rt = this._items.get(it.key); if (!rt) continue;
      const goal = rt.target * (rt.brightScale || 1);
      const fx = it.kind === 'light' && !this._reduced ? LAMP_FX[it.key] : null;
      const kk = fx ? 1 - Math.exp(-dt * (goal > rt.level ? fx.up : fx.dn)) : k;
      if (Math.abs(rt.level - goal) > 0.003) { rt.level += (goal - rt.level) * kk; dirty = true; }
      else if (rt.level !== goal) { rt.level = goal; dirty = true; }
      let lv = rt.level, col = rt.color, hsc = 1;
      if (fx) {
        // partida: tubo fluorescente/LED linear treme antes de firmar; lâmpadas quentes começam alaranjadas e o halo cresce até o tamanho cheio;
        // RGB (palco) faz cross-fade entre as cores em vez de trocar de repente
        if (goal > 0.003) { if (rt.wasOff !== false) { rt.wasOff = false; rt.onAt = t; } rt.peak = goal; } else if (rt.level < 0.003) rt.wasOff = true;
        if (fx.tube && goal > 0.003 && rt.onAt !== undefined && t - rt.onAt < 0.62) { lv *= tubeFlick(t - rt.onAt); dirty = true; }
        const cb = rt.cbase;
        if (it.rgb) {
          const dr = Math.abs(cb.r - rt.color.r) + Math.abs(cb.g - rt.color.g) + Math.abs(cb.b - rt.color.b);
          if (dr > 0.004 && rt.level > 0.02 && this._activitySeeded) { cb.lerp(rt.color, 1 - Math.exp(-dt * 4.5)); dirty = true; } else if (dr > 0) cb.copy(rt.color);
        }
        const r = clamp(rt.level / (rt.peak || 1), 0, 1), r2 = r * r * (3 - 2 * r), w = fx.warm * (1 - clamp((r - 0.1) / 0.75, 0, 1));
        col = rt.cshow; col.copy(it.rgb ? cb : rt.color); if (w > 0.002) col.lerp(_WARM, w);
        hsc = 0.62 + 0.38 * r2;
        if (rt.emisMat && (it.rgb || fx.warm)) rt.emisMat.emissive.copy(col);
      }
      rt.lv = lv;
      for (const { L: pl, i } of rt.lights || []) { pl.intensity = i * lv * dayScale; pl.color.copy(col); }
      if (it.kind === 'light') for (const f of rt.fixtures || []) if (f.material && f.material.emissive) f.material.emissiveIntensity = lv * 1.6;
      for (const { sp, base, gs } of rt.glows || []) {
        sp.material.opacity = lv * base * L(0.35, 1, nl); sp.material.color.copy(col); sp.visible = lv > 0.01;   // de dia o halo quase some
        if (fx) { const sc = gs * hsc; if (sp.scale.x !== sc) sp.scale.set(sc, sc, 1); }
      }
      if (rt.pool) { const pu = rt.pool.material.uniforms; pu.uI.value = lv * this._poolK * L(0.12, 1, nl); pu.uC.value.copy(col); rt.pool.visible = lv > 0.01; }
      for (const b of rt.beams || []) { b.material.uniforms.uI.value = lv * L(0.18, 0.55, nl); b.material.uniforms.uC.value.copy(col); b.visible = lv > 0.01; }
      // emissivos da decoração ligados à entidade (ctx.bindEmissive): acompanham o brilho, com um mínimo aceso
      for (const b of rt.emisBind || []) b.mat.emissiveIntensity = b.max * (b.min + (1 - b.min) * lv);
      for (const hm of rt.halos || []) { hm.opacity = lv * hm.userData.base * L(hm.userData.day, 1, nl); hm.visible = lv > 0.01; }   // materiais de ctx.glowPlane
      if (it.key === 'telao' && rt.screenMat) {
        // tela acende; tocando, pulsa levemente e ilumina o palco
        const pulse = rt.playing && !this._reduced && this._q === 'alta' ? 0.88 + 0.12 * Math.sin(t * 2.1) : rt.playing ? 1 : 0.7;
        rt.screenMat.emissiveIntensity = pulse * lv * 1.0;   // toneMapped: false → cores do canvas saem fiéis
        rt.light.intensity = pulse * lv * 9 * L(0.6, 1, nl);
        if (rt.bloom) { rt.bloom.material.opacity = pulse * lv * 0.35 * L(0.4, 1, nl); rt.bloom.visible = lv > 0.01; }
        if (lv > 0.01 && rt.playing && !this._reduced && this._q === 'alta') ambient = true;   // no leve/media o telão fica aceso sem pulsar: parado, não desenha nada
      }
      if (it.key === 'som' && rt.ledMats) for (const m of rt.ledMats) m.emissiveIntensity = lv * 2.6;
      if (it.kind === 'climate' && rt.ledMats) {
        const hv = rt.hvacOn || rt.hvac, c = hv === 'cool' ? 0x67d3ff : hv === 'heat' ? 0xff8a5b : 0x8ef0b0;   // ao desligar mantém a cor do modo (o LED apaga sem trocar de cor)
        // cada unidade tem a sua sequência (LED → aleta → fluxo nasce e cresce); cor pelo modo (frio azul-claro, quente laranja, seco/ventilar neutro)
        if (this._airStep(rt, c, nowA, dtA, nl, it.key)) dirty = true;
      }
      if (it.key === 'porta' && rt.leaves) {
        // a entidade abre; a pessoa também pode abrir localmente (rt.pOpen, só visual): vale o maior dos dois
        const lvp = Math.max(lv, rt.pOpen || 0);
        for (const lf of rt.leaves) { const ry = lf.base - lf.dir * lvp * 1.25; if (lf.g.rotation.y !== ry) { lf.g.rotation.y = ry; dirty = true; if (!rt.pMoving) { this._needShadow = true; this._refreshPointShadows('hall'); } } }
      }
    }
    if (this._roomLight && this._roomLightTick(dayScale)) dirty = true;
    if (this._airTick()) dirty = true;   // fluxo dos ares andando (~16 q/s, só em cena e por pouco tempo)
    if (this._needShadow) { this._renderer.shadowMap.needsUpdate = true; this._needShadow = false; dirty = true; }
    if (dirty) { this._updateLabels(); this._selPlace(); }
    // Só animação ociosa (telão pulsando): no máximo ~8 quadros/s, e nada com a aba ou o cartão fora da tela
    const now = performance.now();
    // Todos os níveis: girando/aproximando desenha na resolução que o tempo real de quadro permite; parou → um quadro nítido (governador)
    dirty = this._govFrame(now, dirty);
    const visible = !(typeof document !== 'undefined' && document.hidden) && this._onScreen !== false;
    if (this._busy) return;   // o governador acabou de pedir recompilação (_shrinkLights)
    if (dirty || (ambient && visible && now - (this._lastIdle || 0) > 125)) {
      if (!dirty) this._lastIdle = now;
      this._renderer.render(this._scene, this._camera);
    }
  }
}

// ===========================================================================
// Igreja Painel 3D — motor das vistas 3D do igreja-painel-card (v1.0.0)
// Gerado por build_painel.py: acima deste ponto vem o igreja3d-card.js (helpers, materiais, decoração dos cômodos e os
// métodos de construção da cena de Igreja3DCard) sem o registro do elemento. Aqui embaixo fica só o que é do painel:
// um WebGLRenderer para várias vistas (cada uma copia para o seu canvas 2D), enquadramento por retângulo, toque nos
// aparelhos (pickAt), cortes de parede entre a câmera e o foco (casa de boneca) e o corte só no cômodo (cut).
// Coordenadas em metros como no cartão: X → direita (muro x = 0 até 20,1), Z → frente (fachada em z ≈ 49,7), Y para cima.
// ===========================================================================
export const VERSION = '1.0.0';
const P3_CUT = 0.9;   // altura das paredes cortadas (abaixo dos peitoris de 1,0 m: a tampa cobre as janelas)
const P3_DEG = Math.PI / 180;
const P3_TUNE = { ty: 0.2, grid: 0.5, maxN: 24, ins: 0.15, part: 0.6, overview: 0.3 };
// enquadramento [x0, z0, x1, z1, giro, inclinação]; giro 90 = câmera do lado da ala direita (+x) olhando o palco (−x)
const P3_ANG = { templo: [90, 42], gilvan: [180, 55], administrativo: [90, 55], circulacao: [90, 55], midia: [90, 52], voluntariado: [90, 52],
  deposito: [90, 58], tecnica: [90, 60], wc_masc: [90, 58], hall_banheiros: [90, 55], wc_fem: [0, 55], patio: [0, 52], almoxarifado: [0, 55],
  cozinha: [0, 55], recepcao: [0, 55], pastoral: [0, 52], caixa_dagua: [0, 58], hall: [0, 45], wcs: [0, 58], estac_frontal: [0, 40], fachada: [0, 25] };
const _p3box = (rs) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z, w, d] of rs) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + w); z1 = Math.max(z1, z + d); } return [x0, z0, x1, z1]; };
const _p3rects = (r) => r.rects || [].concat(...(r.zones || []).map((z) => (ZONES[z] ? ZONES[z].rects : [])));
const _p3round = (a) => a.map((v) => Math.round(v * 100) / 100);
export const ROOMS3D = {};
for (const b of Object.values(BLOCKS)) for (const r of b.rooms) ROOMS3D[r.id] = _p3round([...(r.frame || _p3box(_p3rects(r))), ...(P3_ANG[r.id] || [90, 55])]);
export const BLOCKS3D = {};
for (const [id, b] of Object.entries(BLOCKS)) BLOCKS3D[id] = _p3round([...b.box, ...(id === 'pastoral' ? [0, 52] : id === 'hall' ? [0, 42] : id === 'templo' ? [90, 45] : [90, 52])]);
export const PLAN3D = [-3, 0, 23, 60, 90, 58];
// cômodo de um ponto do piso (primeiro que contém; os blocos de lista têm cômodos sem sobreposição)
const P3_ROOMS = [];
for (const [bid, b] of Object.entries(BLOCKS)) for (const r of b.rooms) P3_ROOMS.push({ id: r.id, block: bid, rects: _p3rects(r) });
function p3RoomAt(x, z) {
  for (const r of P3_ROOMS) for (const [rx, rz, w, d] of r.rects) if (x >= rx - 0.08 && x <= rx + w + 0.08 && z >= rz - 0.08 && z <= rz + d + 0.08) return r.id;
  return null;
}
const P3_KIND = { light: 'light', climate: 'ac', media: 'telao', switch: 'som' };

class P3View {
  constructor(E, canvas, o = {}) {
    this.E = E; this.c = canvas; this.o = o; this.g2 = canvas.getContext('2d');
    this.cam = new THREE.PerspectiveCamera(o.fov || 32, 1, 0.1, 600);
    this.az = 90; this.el = 58; this.zoom = 1; this.dist = 60; this.target = new THREE.Vector3(); this.rect = PLAN3D.slice(0, 4);
    this.state = o.state || null; this._cam = null; this._click = null; this._cutRoom = null; this._clip = null; this._h = [];
    if (o.home) { this.az = o.home[0]; this.el = o.home[1]; }
    if (o.interactive) this._bind();
  }
  // onCam(fn) / onClick(fn) — também aceitam atribuição (view.onClick = fn), como no motor da casa
  get onCam() { const f = (fn) => { this._cam = fn; return this; }; return f; }
  set onCam(fn) { this._cam = fn; }
  get onClick() { const f = (fn) => { this._click = fn; return this; }; return f; }
  set onClick(fn) { this._click = fn; }
  _size() {
    const el = this.c.parentElement || this.c, w = el.clientWidth, h = el.clientHeight;
    const r = el.getBoundingClientRect(); return { w, h, s: w ? r.width / w : 1 };
  }
  _safe(w, h) { const s = typeof this.o.safe === 'function' ? this.o.safe(w, h) : this.o.safe; return Object.assign({ l: 4, t: 4, r: 4, b: 4 }, s || {}); }
  frame(x0, z0, x1, z1, az, el, keepZoom = false) {
    this.rect = [x0, z0, x1, z1]; if (az != null) this.az = az; if (el != null) this.el = el; if (!keepZoom) this.zoom = 1;
    this._fit(); this.render(); return this;
  }
  _fit() {
    const { w, h } = this._size(); if (!w || !h) { this._pendingFit = true; return; }
    this._pendingFit = false;
    const [x0, z0, x1, z1] = this.rect, hy = this.o.hy != null ? this.o.hy : 1.2;
    this.target.set((x0 + x1) / 2, this.o.ty != null ? this.o.ty : 0.3, (z0 + z1) / 2);
    const pts = [];
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, hy]) pts.push(new THREE.Vector3(x, y, z));
    // parede do palco (x = 0, z 12,4–44,0, 8,5 m): entra no enquadramento quando aparece nele
    if (x0 < 0.6 && z1 > 12.4 && z0 < 44.0) for (const z of [Math.max(z0, 12.4), Math.min(z1, 44.0)]) pts.push(new THREE.Vector3(0, SPEC.H_TEMPLO, z));
    const s = this._safe(w, h), _v = new THREE.Vector3();
    const search = () => {
      let lo = 0.5, hi = 900;
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2; this.dist = m; this._place(w, h, 1);
        let ok = true;
        for (const p of pts) { _v.copy(p).project(this.cam); const a = (_v.x + 1) / 2 * w, b = (1 - _v.y) / 2 * h; if (_v.z > 1 || a < s.l || a > w - s.r || b < s.t || b > h - s.b) { ok = false; break; } }
        if (ok) hi = m; else lo = m;
      }
      this.dist = hi; this._place(w, h, 1);
    };
    // centraliza o que aparece (não o alvo) na área livre: mede a caixa projetada e desloca a vista; 2 passadas
    this._shift = [0, 0];
    for (let k = 0; k < 2; k++) {
      search();
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (const p of pts) { _v.copy(p).project(this.cam); const a = (_v.x + 1) / 2 * w, b = (1 - _v.y) / 2 * h; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const ex = (s.l + w - s.r) / 2 - (a0 + a1) / 2, ey = (s.t + h - s.b) / 2 - (b0 + b1) / 2;
      if (Math.abs(ex) < 1 && Math.abs(ey) < 1) break;
      this._shift = [this._shift[0] + ex, this._shift[1] + ey];
    }
    search(); this._place(w, h);
  }
  _place(w, h, z = this.zoom) {
    const az = this.az * P3_DEG, el = this.el * P3_DEG, d = this.dist / z, t = this.target;
    this.cam.position.set(t.x + d * Math.cos(el) * Math.sin(az), t.y + d * Math.sin(el), t.z + d * Math.cos(el) * Math.cos(az));
    this.cam.up.set(0, 1, 0); this.cam.lookAt(t);
    const s = this._safe(w, h), sh = this._shift || [0, 0], dx = (s.l + w - s.r) / 2 - w / 2 + sh[0], dy = (s.t + h - s.b) / 2 - h / 2 + sh[1];
    const fw = w + 2 * Math.abs(dx), fh = h + 2 * Math.abs(dy);
    this.cam.aspect = fw / fh;
    this.cam.setViewOffset(fw, fh, Math.abs(dx) - dx, Math.abs(dy) - dy, w, h);
    this.cam.far = d * 4 + 120; this.cam.near = Math.max(0.1, d * 0.02);
    this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld();
    this._wh = [w, h];
  }
  _sync() { const { w, h } = this._size(); if (!w || !h) return false; if (this._pendingFit || !this._wh || this._wh[0] !== w || this._wh[1] !== h) this._fit(); return true; }
  // ponto do mundo → px (CSS) dentro do elemento da vista
  project(p) {
    if (!this._sync()) return [-999, -999];
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.cam), [w, h] = this._wh;
    return v.z > 1 ? [-999, -999] : [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
  }
  // px (CSS) → ponto no chão [x, z]
  pick(px, py) {
    if (!this._sync()) return null; const [w, h] = this._wh;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(px / w * 2 - 1, 1 - py / h * 2), this.cam);
    const o = rc.ray.origin, d = rc.ray.direction; if (Math.abs(d.y) < 1e-6) return null;
    const k = -o.y / d.y; return k > 0 ? [o.x + d.x * k, o.z + d.z * k] : null;
  }
  // px (CSS) → o que está sob o dedo: { kind: 'light'|'ac'|'telao'|'som'|'room', key, room } ou null
  pickAt(px, py) { return this.E._pickAt(this, px, py); }
  // corte só no cômodo (ou bloco): o resto do prédio some (planos de recorte globais nesta vista); null volta ao prédio inteiro
  cut(id) {
    const r = id ? (ROOMS3D[id] || BLOCKS3D[id]) : null;
    this._cutRoom = r ? id : null;
    if (!r) this._clip = null;
    else {
      const m = 0.22, [x0, z0, x1, z1] = r;
      this._clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -(x0 - m)), new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1 + m),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -(z0 - m)), new THREE.Plane(new THREE.Vector3(0, 0, -1), z1 + m)];
      this._clipBox = [x0 - m, z0 - m, x1 + m, z1 + m];
    }
    this.render(); return this;
  }
  render() { this.E._queue(this); }
  setZoom(z) { this.zoom = Math.max(0.6, Math.min(4, z)); if (this._sync()) this._place(...this._wh); this._moved(); }
  _moved() { this.render(); if (this._cam) this._cam(this); }
  _on(t, f, o) { this.c.addEventListener(t, f, o); this._h.push([t, f, o]); }
  _bind() {
    const c = this.c, P = new Map(); let drag = null, pinch = null;
    const loc = (e) => { const r = c.getBoundingClientRect(), s = c.clientWidth ? r.width / c.clientWidth : 1; return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; };
    this._on('pointerdown', (e) => {
      if (e.button > 0) return; P.set(e.pointerId, loc(e)); try { c.setPointerCapture(e.pointerId); } catch (_) {}
      if (P.size === 1) drag = { p: loc(e), az: this.az, el: this.el, moved: false };
      else if (P.size === 2) { const [a, b] = [...P.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom }; drag = null; }
    });
    this._on('pointermove', (e) => {
      if (!P.has(e.pointerId)) return; P.set(e.pointerId, loc(e));
      if (pinch && P.size === 2) { const [a, b] = [...P.values()]; this.setZoom(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(10, pinch.d)); return; }
      if (!drag) return; const p = loc(e), dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; c.parentElement && c.parentElement.classList.add('p3drag');
      this.az = drag.az - dx * 0.45; this.el = Math.max(18, Math.min(88, drag.el + dy * 0.3));
      if (this._sync()) this._place(...this._wh); this._moved();
    });
    const up = (e) => {
      if (!P.has(e.pointerId)) return; P.delete(e.pointerId);
      c.parentElement && c.parentElement.classList.remove('p3drag');
      if (drag && !drag.moved && this._click) { const p = loc(e); this._click(p[0], p[1], this.pickAt(p[0], p[1])); }
      if (P.size < 2) pinch = null; drag = null;
    };
    this._on('pointerup', up); this._on('pointercancel', up);
    this._on('wheel', (e) => { e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    this._on('dblclick', () => { this.frame(...this.rect, this.o.home ? this.o.home[0] : this.az, this.o.home ? this.o.home[1] : this.el); this._moved(); });
  }
  dispose() { for (const [t, f, o] of this._h) this.c.removeEventListener(t, f, o); this._h = []; this._cam = this._click = null; this.E.drop(this); }
}

export class IgrejaPainel3D {
  static shared(opts) { if (!window.__igrejaPainel3D) window.__igrejaPainel3D = new IgrejaPainel3D(opts); return window.__igrejaPainel3D; }
  constructor(opts = {}) {
    this.opts = opts; this.views = new Set(); this._dirty = new Set(); this.segs = [];
    this.version = VERSION;
  }
  ready() {
    if (!this._ready) this._ready = new Promise((res, rej) => setTimeout(() => {
      try { this._build(); } catch (e) { rej(e); return; }
      this._precompile().then(() => { this.views.forEach((v) => v.render()); res(this); });
    }, 20));
    return this._ready;
  }
  view(canvas, o) { const v = new P3View(this, canvas, o); this.views.add(v); if (this.scene) v.render(); return v; }
  drop(v) { this.views.delete(v); this._dirty.delete(v); }
  // posições [x, y, z] das luminárias/aparelhos de uma entidade (para os pinos)
  points(key) {
    const it = ITEMS.find((x) => x.key === key); if (!it) return [];
    if (it.fixtures) return it.fixtures.filter((f) => !f.hidden && !f.ext).map((f) => [f.p[0], f.p[1], f.p[2]]);
    const rt = this.host && this.host._items.get(key);
    if (it.kind === 'climate') return rt && rt.airUnits ? rt.airUnits.map((u) => [u.p.x, u.p.y, u.p.z]) : [];
    if (key === 'telao') return [[0.25, 2.65, 28.1]];
    if (key === 'som') return [[4.9, 1.065, 19.8], [4.9, 1.065, 36.4]];
    if (key === 'porta') return [[12.0, 1.1, 49.65]];
    if (key === 'presenca' || key === 'temperatura') return [[10.8, 2.6, 28.1]];
    return [];
  }

  // ---- construção: a mesma cena do igreja3d-card (_build3D), sem câmera/órbita/DOM, numa maquete escura ----
  _build() {
    const opts = this.opts;
    const H0 = Object.create(Igreja3DCard.prototype); this.host = H0;
    H0._config = Object.assign({}, DEFAULT_CONFIG, { entities: opts.entities || {}, entorno: true });
    let q = H0._qualityFor(opts.quality || 'auto');
    H0._q = q; H0._lite = q === 'leve' || q === 'min'; H0._min = q === 'min';
    H0._nightVision = opts.night_vision !== false; H0._reduced = true; H0._state = {}; H0._lastChanged = {}; H0._activity = [];
    H0._items = new Map(); H0._clickables = []; H0._labels = []; H0._zoneMeshes = {}; H0._nLights = 0; H0._nShadows = 0; H0._topView = false;
    const M = materials();
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Igreja3DCard._gpuInfo().soft, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.localClippingEnabled = true;
    const caps = renderer.capabilities;
    H0._tight = caps.maxFragmentUniforms < 512 || caps.maxTextures < 16;
    renderer.shadowMap.enabled = !H0._min;
    renderer.shadowMap.type = q === 'alta' || q === 'media' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x0a0f1e, 1);
    this.renderer = renderer; H0._renderer = renderer;
    const scene = new THREE.Scene(); this.scene = scene; H0._scene = scene;
    H0._buildSky(scene, renderer);
    for (const s of [H0._skyNight, H0._skyDay, H0._skyDusk]) if (s) s.visible = false;   // maquete: fundo liso (cor do painel)

    const C = new THREE.Vector3(LOT.cx, 0, LOT.cz);
    H0._hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a8070, 1.6); scene.add(H0._hemi);
    H0._amb = new THREE.AmbientLight(0x4a5a80, 0.25); scene.add(H0._amb);
    H0._sun = new THREE.DirectionalLight(0xfff0d2, 3.2);
    H0._sunDist = 60;
    H0._sunPos = new THREE.Vector3(-0.42, 1, 0.55).normalize();
    H0._moonPos = C.clone().addScaledVector(new THREE.Vector3(11, 20, -9).normalize(), H0._sunDist);
    H0._sun.position.copy(C).addScaledVector(H0._sunPos, H0._sunDist); H0._sun.target.position.copy(C);
    H0._sun.castShadow = !H0._min;
    H0._sun.shadow.mapSize.set(H0._lite ? 1024 : 2048, H0._lite ? 1024 : 2048);
    const sc = H0._sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 125;
    H0._sun.shadow.bias = -0.0006; H0._sun.shadow.normalBias = 0.04;
    scene.add(H0._sun, H0._sun.target);

    // base da maquete: laje do lote (gramado seco por cima, lados escuros)
    const TX = textures();
    const gmap = TX.grassDry.clone(); const gw = LOT.x1 - LOT.x0 + 1, gd = LOT.z1 - LOT.z0 + 1; gmap.repeat.set(gw / 2.2, gd / 2.2);
    const side = new THREE.MeshStandardMaterial({ color: 0x1a2232, roughness: 0.9 }), top = new THREE.MeshStandardMaterial({ color: 0xd8d6c8, map: gmap, roughness: 0.95 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.45, gd), [side, side, top, side, side, side]);
    slab.position.set((LOT.x0 + LOT.x1) / 2, -0.03 - 0.225, (LOT.z0 + LOT.z1) / 2); slab.receiveShadow = true; slab.userData.noMerge = true; slab.userData.ground = true;
    scene.add(slab); this.slab = slab;

    // pisos das zonas (igual ao _build3D, sem os rótulos)
    const ROUGH = { tileGray: 0.5, tileLight: 0.6, tileCool: 0.45, wood: 0.72, herring: 0.95, paversGray: 0.95, paversDark: 0.9, laminate: 0.44, porcelainBeige: 0.3, porcelainGray: 0.13 };
    const BUMP = { tileGray: 0.3, laminate: 0.25, porcelainBeige: 0.15, porcelainGray: 0.08 }, ENVI = { porcelainGray: 0.6, porcelainBeige: 0.8, laminate: 0.8 };
    for (const [id, z] of Object.entries(ZONES)) {
      const tk = z.floor || 'concrete', tile = z.tile || 3, list = H0._zoneMeshes[id] = [];
      for (const [x, zz, w, d, edges = 'nsew'] of z.rects) {
        const map = TX[tk].clone(); map.repeat.set(w / tile, d / tile); map.offset.set(x / tile, -(zz + d) / tile);
        const tint = ['grass', 'concrete'].includes(tk) ? 0xdedede : 0xffffff;
        const mat = new THREE.MeshStandardMaterial({ color: tint, map, roughness: ROUGH[tk] || 0.9, bumpMap: H0._min ? null : map, bumpScale: BUMP[tk] != null ? BUMP[tk] : 0.6,
          aoMap: edges && !H0._min ? H0._makeAO(w, d, edges) : null, aoMapIntensity: 1.0, envMapIntensity: ENVI[tk] != null ? ENVI[tk] : 1 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
        m.rotation.x = -Math.PI / 2; m.position.set(x + w / 2, 0.004, zz + d / 2); m.receiveShadow = true;
        m.userData = { item: z.item || null, zone: id }; scene.add(m); list.push(m);
        if (z.item) H0._clickables.push(m);
      }
    }
    // paredes: cada _wallSeg vira um trecho cortável (as peças dele ficam fora do mergeStatic)
    const segs = this.segs, wallSeg = Igreja3DCard.prototype._wallSeg;
    H0._wallSeg = function (sc2, M2, axis, c, a0, a1, ops, o = {}) {
      const n0 = sc2.children.length;
      wallSeg.call(this, sc2, M2, axis, c, a0, a1, ops, o);
      segs.push({ axis, c, a0, a1, ops: ops || [], h: o.h || H, t: o.t || T, meshes: sc2.children.slice(n0), cut: false, i: segs.length });
    };
    const nW = scene.children.length;
    H0._buildWalls(scene, M);
    // pilares (soltos no _buildWalls) entram no trecho em que estão encostados
    const inSeg = new Set(); for (const s of segs) for (const m of s.meshes) inSeg.add(m);
    const bb = new THREE.Box3(), ctr = new THREE.Vector3();
    for (const o of scene.children.slice(nW)) {
      if (inSeg.has(o)) continue;
      bb.setFromObject(o); bb.getCenter(ctr);
      const s = segs.find((g) => (g.axis === 'x' ? Math.abs(ctr.z - g.c) < 0.4 && ctr.x >= g.a0 - 0.3 && ctr.x <= g.a1 + 0.3 : Math.abs(ctr.x - g.c) < 0.4 && ctr.z >= g.a0 - 0.3 && ctr.z <= g.a1 + 0.3));
      if (s) s.meshes.push(o);
    }
    if (!STAIR.off) H0._walls.push({ axis: 'x', c: STAIR.Z0, a0: MEZZ.x1, a1: STAIR.XE + STAIR.GO, t: 0.06, h: 1.0 });
    else H0._walls.push({ axis: 'z', c: 14.78, a0: 46.24, a1: 49.54, t: 2.32, h: 1.5 });
    // rodapés (igual ao _build3D)
    for (const z of Object.values(ZONES)) {
      if (!z.inside) continue;
      const bm = z.floor === 'laminate' ? M.baseboardWood : z.floor === 'porcelainGray' ? M.baseboardGray : M.baseboard, hb = bm === M.baseboard ? 0.09 : 0.07;
      for (const [x, zz, w, d, edges = 'nsew'] of z.rects) {
        const back = zz + d < 11.01, io = (c) => (!back ? T / 2 : c < 0.01 || c > 20.09 ? 0 : TF / 2) + 0.02;
        const iw = io(x), ie = io(x + w), inn = io(zz), is = io(zz + d);
        if (edges.includes('n')) scene.add(box(w - iw - ie, hb, 0.02, bm, x + (w + iw - ie) / 2, hb / 2, zz + inn, { cast: false }));
        if (edges.includes('s')) scene.add(box(w - iw - ie, hb, 0.02, bm, x + (w + iw - ie) / 2, hb / 2, zz + d - is, { cast: false }));
        if (edges.includes('w')) scene.add(box(0.02, hb, d - inn - is, bm, x + iw, hb / 2, zz + (d + inn - is) / 2, { cast: false }));
        if (edges.includes('e')) scene.add(box(0.02, hb, d - inn - is, bm, x + w - ie, hb / 2, zz + (d + inn - is) / 2, { cast: false }));
      }
    }
    for (const o of scene.children) o.userData.arch = true;
    H0._ext = new THREE.Group(); H0._ext.name = 'fachada'; H0._ext.userData.keep = true; H0._ext.visible = false; scene.add(H0._ext);
    for (const m of H0._wallHi || []) H0._ext.add(m);
    H0._mezz = new THREE.Group(); H0._mezz.name = 'mezanino'; H0._mezz.userData.keep = true; scene.add(H0._mezz);
    H0._buildFurniture(scene, M);
    H0._snapThin(scene);
    H0._buildFixtures(scene, M);
    H0._buildPools(scene);
    mergeItems(scene, H0._clickables, H0._items); mergeItems(H0._ext, H0._clickables, H0._items);
    H0._buildDoors(scene);
    this._clipUp = [new THREE.Plane(new THREE.Vector3(0, -1, 0), P3_CUT)];
    this._doorsToSegs(scene);
    this._decoToSegs(scene);
    this._mergeSegs(scene, M);
    const stats = mergeStatic(scene, true);
    mergeStatic(H0._ext, true); mergeStatic(H0._mezz, true);
    if (q === 'media') H0._midMaterials(scene);
    scene.fog = null;
    // o que não respeita os planos de recorte (sprites, ShaderMaterial, Points): some à mão fora do cômodo cortado
    this._free = []; const c3 = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o.material; if (!(o.isSprite || o.isPoints || (o.isMesh && m && !Array.isArray(m) && m.isShaderMaterial))) return;
      if (o.isSprite) o.getWorldPosition(c3); else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); c3.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld); }
      this._free.push({ o, x: c3.x, z: c3.z, r: 0 });
      if (o.isMesh || o.isPoints) this._clipShader(m);
    });
    // estado inicial: tudo desligado
    for (const it of ITEMS) H0._setItemState(it.key, { state: 'off', attrs: {} });
    H0._activitySeeded = true;
    this._key = null; this._cutSig = null; this._nlApplied = null;
    renderer.shadowMap.needsUpdate = true;
    console.info(`[igreja-painel-3d] v${VERSION} · qualidade ${q} · ${stats.after} malhas estáticas · ${segs.length} trechos de parede · ${H0._nLights} luzes`);
  }
  // as folhas das portas (InstancedMesh do cartão, animadas no modo Pessoa) viram malhas fixas do trecho de parede delas (cortam junto)
  _doorsToSegs(scene) {
    const H0 = this.host, m4 = new THREE.Matrix4();
    for (const im of H0._doorMeshes || []) {
      for (let i = 0; i < im.count; i++) {
        const d = im.userData.owners[i]; im.getMatrixAt(i, m4);
        const m = new THREE.Mesh(im.geometry, im.material); m4.decompose(m.position, m.quaternion, m.scale);
        m.castShadow = im.castShadow; m.receiveShadow = im.receiveShadow;
        const s = this.segs.find((g) => g.axis === d.axis && Math.abs(g.c - d.c) < 0.02 && d.a >= g.a0 - 0.2 && d.b <= g.a1 + 0.2);
        scene.add(m); if (s) s.meshes.push(m); else m.userData.noMerge = false;
      }
      scene.remove(im);
    }
    H0._doorMeshes = [];
  }
  // decoração fina presa numa parede (painéis, quadros, placas, ripados, prateleiras rasas) corta junto com ela
  _decoToSegs(scene) {
    const bb = new THREE.Box3(), list = [];
    const skip = (o) => o.userData.item || o.userData.keep || o.userData.arch || o.userData.noMerge || o.userData.zone;
    const walk = (o) => {
      if (skip(o)) return;
      if (o.isMesh && !o.isInstancedMesh) { list.push(o); return; }
      for (const ch of o.children) walk(ch);
    };
    for (const o of scene.children) if (o !== this.host._ext && o !== this.host._mezz) walk(o);
    scene.updateMatrixWorld(true);
    let n = 0;
    for (const o of list) {
      const m = o.material; if (!m || Array.isArray(m) || m.isShaderMaterial || m.blending === THREE.AdditiveBlending) continue;
      bb.setFromObject(o); if (bb.isEmpty() || bb.max.y < P3_CUT + 0.05) continue;
      let best = null, bd = 9;
      for (const s of this.segs) {
        const nk = s.axis === 'x' ? 'z' : 'x', uk = s.axis === 'x' ? 'x' : 'z';
        if (bb.max[nk] - bb.min[nk] > 0.3) continue;
        if (bb.max[uk] <= s.a0 + 0.02 || bb.min[uk] >= s.a1 - 0.02) continue;
        const d = Math.min(Math.abs(bb.min[nk] - s.c), Math.abs(bb.max[nk] - s.c)) - s.t / 2;
        if (d <= 0.12 && d < bd) { bd = d; best = s; }
      }
      if (!best) continue;
      if (o.parent !== scene) scene.attach(o);
      best.meshes.push(o); n++;
    }
    this._decoN = n;
  }
  // junta as peças de cada trecho por material (menos draw calls) e cria a tampa escura do corte (fora das portas e vãos)
  _mergeSegs(scene, M) {
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.85 });
    const _v = new THREE.Matrix4();
    for (const s of this.segs) {
      const groups = new Map(), out = [];
      for (const o of s.meshes) {
        if (!o.isMesh || Array.isArray(o.material) || !o.geometry.attributes.normal || !o.geometry.attributes.uv || o.parent !== scene) { if (o.parent === scene) { o.userData.noMerge = true; out.push(o); } continue; }
        const key = o.material.uuid + (o.castShadow ? 'c' : 'n') + (o.receiveShadow ? 'r' : '');
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o);
      }
      for (const ms of groups.values()) {
        let total = 0; const parts = ms.map((o) => { o.updateMatrix(); const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix); total += g.attributes.position.count; return g; });
        const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2); let off = 0;
        for (const g of parts) { const n = g.attributes.position.count; pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3); uv.set(g.attributes.uv.array, off * 2); off += n; g.dispose(); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.computeBoundingSphere(); geo.computeBoundingBox();
        const m = new THREE.Mesh(geo, ms[0].material); m.castShadow = ms[0].castShadow; m.receiveShadow = ms[0].receiveShadow; m.matrixAutoUpdate = false; m.userData.noMerge = true; m.userData.arch = true;
        for (const o of ms) { scene.remove(o); if (!o.geometry.userData.shared) { /* a geometria das portas é compartilhada */ } }
        scene.add(m); out.push(m);
      }
      s.meshes = out;
      // corte: a peça troca para uma cópia do material com o plano y < P3_CUT (o original segue nos trechos inteiros)
      for (const m of out) { m.userData.seg = s.i; if (m.material && !Array.isArray(m.material)) { m.userData.mFull = m.material; m.userData.mCut = this._cutVariant(m.material); } }
      // tampa do corte (só nos trechos cheios: fora de portas, vidros, vãos e portões; as janelas têm parede abaixo do peitoril)
      const gaps = s.ops.filter((o) => o.t !== 'window' || (o.sill != null ? o.sill : 1.0) < P3_CUT).map((o) => [o.a, o.b]).sort((a, b) => a[0] - b[0]);
      const spans = []; let cur = s.a0;
      for (const [a, b] of gaps) { if (a > cur) spans.push([cur, a]); cur = Math.max(cur, b); }
      if (s.a1 > cur) spans.push([cur, s.a1]);
      const caps = [];
      for (const [a, b] of spans) {
        if (b - a < 0.02) continue;
        const cp = s.axis === 'x' ? box(b - a, 0.03, s.t + 0.02, cutMat, (a + b) / 2, P3_CUT + 0.015, s.c, { cast: false }) : box(s.t + 0.02, 0.03, b - a, cutMat, s.c, P3_CUT + 0.015, (a + b) / 2, { cast: false });
        cp.receiveShadow = false; cp.visible = false; cp.userData.noMerge = true; cp.userData.cap = true; scene.add(cp); caps.push(cp);
      }
      s.caps = caps;
    }
  }
  _precompile() {
    const r = this.renderer, cam = new THREE.PerspectiveCamera(32, 1.6, 0.1, 600); cam.position.set(60, 60, 30); cam.lookAt(10, 0, 30);
    for (const s of this.segs) for (const c of s.caps) c.visible = true;
    let p;
    try { p = r.extensions.has('KHR_parallel_shader_compile') ? r.compileAsync(this.scene, cam) : (r.compile(this.scene, cam), Promise.resolve()); } catch (e) { p = Promise.resolve(); }
    for (const s of this.segs) for (const c of s.caps) c.visible = false;
    return p.catch(() => {});
  }

  // Corta (por vista) os trechos de parede entre a câmera e o retângulo em foco: raio câmera → ponto do foco (altura ty) atravessa o trecho
  // (extensão e altura reais)? Divisórias dentro do foco são sempre cortadas, exceto na visão geral.
  _applyCuts(v) {
    const C = v.cam.position, ins = P3_TUNE.ins, ty = P3_TUNE.ty;
    // com zoom só conta o que está na tela: o retângulo encolhe em volta do alvo (1/zoom); assim aproximar não derruba paredes
    // que nem aparecem (antes os pontos de amostra cobriam o retângulo inteiro e a câmera mais perto cortava mais trechos)
    const zr = Math.max(1, v.zoom || 1), tx = v.target.x, tz = v.target.z;
    const [x0, z0, x1, z1] = zr > 1 ? [tx + (v.rect[0] - tx) / zr, tz + (v.rect[1] - tz) / zr, tx + (v.rect[2] - tx) / zr, tz + (v.rect[3] - tz) / zr] : v.rect;
    const lotA = (LOT.x1 - LOT.x0) * (LOT.z1 - LOT.z0), overview = (v.rect[2] - v.rect[0]) * (v.rect[3] - v.rect[1]) > P3_TUNE.overview * lotA;
    const nx = Math.max(3, Math.min(P3_TUNE.maxN, Math.ceil((x1 - x0) / P3_TUNE.grid) + 1)), nz = Math.max(3, Math.min(P3_TUNE.maxN, Math.ceil((z1 - z0) / P3_TUNE.grid) + 1));
    let sig = '';
    for (const W of this.segs) {
      const ax = W.axis === 'x', [p0, p1, q0, q1] = ax ? [z0, z1, x0, x1] : [x0, x1, z0, z1];
      let hit = v.o.cuts === false ? false : !overview && W.c > p0 + P3_TUNE.part && W.c < p1 - P3_TUNE.part && Math.min(W.a1, q1) - Math.max(W.a0, q0) > 0.4;
      if (v._clipBox && !hit) {   // corte no cômodo: só os trechos que sobram dentro da caixa contam
        const [bx0, bz0, bx1, bz1] = v._clipBox, inBox = ax ? W.c > bz0 && W.c < bz1 && W.a1 > bx0 && W.a0 < bx1 : W.c > bx0 && W.c < bx1 && W.a1 > bz0 && W.a0 < bz1;
        if (!inBox) { sig += '0'; this._setCut(W, false); continue; }
      }
      const cu = ax ? C.z : C.x, ca = ax ? C.x : C.z, d0 = cu - W.c;
      if (!hit && v.o.cuts !== false && Math.abs(d0) > W.t / 2 && (d0 > 0 ? p0 < W.c : p1 > W.c)) {
        for (let i = 0; i < nx && !hit; i++) for (let j = 0; j < nz && !hit; j++) {
          const px = x0 + ins + (x1 - x0 - 2 * ins) * i / (nx - 1), pz = z0 + ins + (z1 - z0 - 2 * ins) * j / (nz - 1);
          const pa = ax ? px : pz, pu = ax ? pz : px, d1 = pu - W.c;
          if (d0 * d1 >= 0) continue;
          const t = d0 / (d0 - d1), a = ca + t * (pa - ca), y = C.y + t * (ty - C.y);
          if (y < W.h && a > W.a0 + 0.02 && a < W.a1 - 0.02) hit = true;
        }
      }
      this._setCut(W, hit); sig += hit ? '1' : '0';
    }
    this._cutSig = sig;
  }
  _setCut(W, on) {
    if (W.cut === on) return; W.cut = on;
    for (const c of W.caps || []) c.visible = on;
    for (const m of W.meshes) if (m.userData.mCut) m.material = on ? m.userData.mCut : m.userData.mFull;
  }
  // cópia do material com o recorte (o clone perde o onBeforeCompile dos padrões em espaço de mundo: vai junto)
  _cutVariant(m) {
    this._cutMats = this._cutMats || new Map();
    let c = this._cutMats.get(m); if (c) return c;
    c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
    c.clippingPlanes = this._clipUp; c.clipShadows = false; c.userData = Object.assign({}, m.userData);
    this._cutMats.set(m, c); return c;
  }

  // toque → aparelho ou cômodo; ignora o que está cortado/recortado na vista, vidro, halos e feixes
  _pickAt(v, px, py) {
    if (!this.scene || !v._sync()) return null; const [w, h] = v._wh;
    this._prep(v);
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(px / w * 2 - 1, 1 - py / h * 2), v.cam);
    const vis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    const cb = v._clipBox;
    for (const it of rc.intersectObjects(this.scene.children, true)) {
      const o = it.object, m = o.material, p = it.point;
      const mm = Array.isArray(m) && it.face ? m[it.face.materialIndex] : m;
      if (o.isSprite || o.isLine || o.isPoints || !vis(o) || !mm || mm.visible === false || mm.isShaderMaterial || mm.blending === THREE.AdditiveBlending || (mm.transparent && mm.opacity < 0.35)) continue;
      if (cb && (p.x < cb[0] || p.x > cb[2] || p.z < cb[1] || p.z > cb[3])) continue;
      if (o.userData.seg != null && this.segs[o.userData.seg].cut && p.y > P3_CUT + 0.02) continue;
      let key = null, zone = null;
      for (let q = o; q && q !== this.scene; q = q.parent) { if (q.userData.zone) zone = q.userData.zone; if (q.userData.item && !key) key = q.userData.item; }
      const n = it.face && !o.userData.ground ? it.face.normal.clone().transformDirection(o.matrixWorld) : null;
      const gx = n && Math.abs(n.y) < 0.5 ? p.x + n.x * 0.15 : p.x, gz = n && Math.abs(n.y) < 0.5 ? p.z + n.z * 0.15 : p.z;
      let room = p3RoomAt(gx, gz);
      if (v._cutRoom && ROOMS3D[v._cutRoom] && room !== v._cutRoom) room = v._cutRoom;   // corte no cômodo: o que sobra é dele
      if (key && !zone) {
        const itm = ITEMS.find((x) => x.key === key), kind = itm && P3_KIND[itm.kind];
        if (kind) return { kind, key, room, point: [p.x, p.y, p.z] };
      }
      // carcaça/suporte de um aparelho (moving head, campânula, corpo do split…): o aparelho mais próximo a até 0,45 m
      const near = this._nearItem(p);
      if (near) { const itm = ITEMS.find((x) => x.key === near); return { kind: P3_KIND[itm.kind], key: near, room: room || p3RoomAt(p.x, p.z), point: [p.x, p.y, p.z] }; }
      if (!room) return null;
      return { kind: 'room', key: zone ? (ZONES[zone] && ZONES[zone].item) || null : key, room, point: [p.x, p.y, p.z] };
    }
    const g = v.pick(px, py); if (!g || (cb && (g[0] < cb[0] || g[0] > cb[2] || g[1] < cb[1] || g[1] > cb[3]))) return null;
    const room = p3RoomAt(g[0], g[1]);
    return room ? { kind: 'room', key: null, room, point: [g[0], 0, g[1]] } : null;
  }

  _nearItem(p) {
    if (!this._itemPts) { this._itemPts = []; for (const it of ITEMS) if (P3_KIND[it.kind]) for (const q of this.points(it.key)) this._itemPts.push([it.key, q]); }
    let best = null, bd = 0.45;
    for (const [k, q] of this._itemPts) { const d = Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]); if (d < bd) { bd = d; best = k; } }
    return best;
  }

  // ShaderMaterial do cartão (poças de luz no piso, feixes, fluxo dos ares) passa a respeitar os planos de recorte da vista:
  // sem isso a poça de uma entidade espalhada por vários cômodos (banheiros, circulação) vazava fora do corte
  _clipShader(m) {
    if (!m || !m.isShaderMaterial || m.userData.p3clip) return; m.userData.p3clip = true;
    const vs = m.vertexShader, fs = m.fragmentShader, iv = vs.lastIndexOf('}'), mf = fs.indexOf('void main(){');
    if (iv < 0 || mf < 0 || !/void main\(\)\{/.test(vs)) return;
    m.vertexShader = '#include <clipping_planes_pars_vertex>\n' + vs.slice(0, iv) + ' { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n#include <clipping_planes_vertex>\n }\n' + vs.slice(iv);
    m.fragmentShader = '#include <clipping_planes_pars_fragment>\n' + fs.slice(0, mf + 12) + '\n#include <clipping_planes_fragment>\n' + fs.slice(mf + 12);
    m.clipping = true; m.needsUpdate = true;
  }

  // estado → entidades do cartão (mesmo _setItemState) → luzes/materiais (sem animação: nível = alvo)
  // st = { lights:{chave:bool}, palco:{on,rgb,bri}, plateia:{on,bri}, telao:{on,title}, som, ac:{chave:{on,mode}}, porta, night }
  _apply(st) {
    st = st || {};
    const key = JSON.stringify(st); if (key === this._key) return; this._key = key;
    const H0 = this.host, L = (st.lights || {}), bri = (b) => (b == null ? null : b > 100 ? b : Math.round(b * 2.55));
    for (const it of ITEMS) {
      let s = 'off', a = {};
      if (it.key === 'palco') { const p = st.palco || {}; const on = p.on != null ? p.on : L.palco; s = on ? 'on' : 'off'; if (p.rgb) a.rgb_color = p.rgb; if (p.bri != null) a.brightness = bri(p.bri); }
      else if (it.key === 'plateia') { const p = st.plateia || {}; const on = p.on != null ? p.on : L.plateia; s = on ? 'on' : 'off'; if (p.bri != null) a.brightness = bri(p.bri); }
      else if (it.kind === 'light') s = L[it.key] ? 'on' : 'off';
      else if (it.key === 'telao') { const tv = st.telao || {}; s = tv.on ? (tv.title ? 'playing' : 'on') : 'off'; if (tv.title) a.media_title = tv.title; }
      else if (it.key === 'som') s = st.som ? 'on' : 'off';
      else if (it.kind === 'climate') { const ac = (st.ac || {})[it.key]; s = ac && ac.on ? (ac.mode || 'cool') : 'off'; }
      else if (it.key === 'porta') s = st.porta ? 'on' : 'off';
      else continue;
      H0._setItemState(it.key, { state: s, attrs: a });
    }
    // dia/noite (fórmulas do _frame do cartão, sem transição)
    const nl = st.night === false ? 0 : 1, nv = H0._nightVision ? 1 : 0, Lr = THREE.MathUtils.lerp, Cc = (h) => new THREE.Color(h);
    H0._nightLevel = nl;
    H0._hemi.intensity = Lr(0.85, Lr(0.22, 0.66, nv), nl); H0._hemi.color.setHex(0xe4ecf5).lerp(Cc(0x4a5f92), nl); H0._hemi.groundColor.setHex(0xa08c70).lerp(Cc(0x1c2130), nl);
    H0._amb.intensity = Lr(0.12, Lr(0.14, 0.36, nv), nl); H0._amb.color.setHex(0xdde4ee).lerp(Cc(0x6b7aa8), nl);
    const C = H0._sun.target.position, sunPos = C.clone().addScaledVector(H0._sunPos, H0._sunDist);
    H0._sun.intensity = Lr(3.2, Lr(0.5, 1.15, nv), nl); H0._sun.position.lerpVectors(sunPos, H0._moonPos, nl); H0._sun.color.setHex(0xfff0d2).lerp(Cc(0x8fa6d8), nl);
    if (this._nlApplied !== nl) { this._nlApplied = nl; H0._sun.shadow.needsUpdate = true; this.renderer.shadowMap.needsUpdate = true; }
    const envI = Lr(0.9, Lr(0.35, 0.7, nv), nl);
    if (H0._probe) { H0._probe.sh.copy(H0._shDay).lerp(H0._shNight, nl); H0._probe.intensity = envI; }
    if (H0._envDay) {
      const env = nl > 0.5 ? H0._envNight : H0._envDay;
      if (H0._envMats) for (const m of H0._envMats) { m.envMap = env; m.envMapIntensity = envI; }
      else { this.scene.environment = env; this.scene.environmentIntensity = envI; }
    }
    this.renderer.setClearColor(nl ? 0x0a0f1e : 0x16212e, 1);
    const dayScale = Lr(0.45, 1, nl), now = performance.now();
    for (const it of ITEMS) {
      const rt = H0._items.get(it.key); if (!rt) continue;
      const lv = rt.target * (rt.brightScale || 1), col = rt.color;
      rt.level = lv; rt.lv = lv; if (rt.cbase) rt.cbase.copy(col); if (rt.cshow) rt.cshow.copy(col);
      for (const { L: pl, i } of rt.lights || []) { pl.intensity = i * lv * dayScale; pl.color.copy(col); }
      if (it.kind === 'light') for (const f of rt.fixtures || []) if (f.material && f.material.emissive) f.material.emissiveIntensity = lv * 1.6;
      if (rt.emisMat && it.rgb) rt.emisMat.emissive.copy(col);
      for (const { sp, base, gs } of rt.glows || []) { sp.material.opacity = lv * base * Lr(0.35, 1, nl); sp.material.color.copy(col); sp.visible = lv > 0.01; if (gs && sp.scale.x !== gs) sp.scale.set(gs, gs, 1); }
      if (rt.pool) { const pu = rt.pool.material.uniforms; pu.uI.value = lv * H0._poolK * Lr(0.12, 1, nl); pu.uC.value.copy(col); rt.pool.visible = lv > 0.01; }
      for (const b of rt.beams || []) { b.material.uniforms.uI.value = lv * Lr(0.18, 0.55, nl); b.material.uniforms.uC.value.copy(col); b.visible = lv > 0.01; }
      for (const b of rt.emisBind || []) b.mat.emissiveIntensity = b.max * (b.min + (1 - b.min) * lv);
      for (const hm of rt.halos || []) { hm.opacity = lv * hm.userData.base * Lr(hm.userData.day, 1, nl); hm.visible = lv > 0.01; }
      if (it.key === 'telao' && rt.screenMat) {
        const pulse = rt.playing ? 1 : 0.7;
        rt.screenMat.emissiveIntensity = pulse * lv; rt.light.intensity = pulse * lv * 9 * Lr(0.6, 1, nl);
        if (rt.bloom) { rt.bloom.material.opacity = pulse * lv * 0.35 * Lr(0.4, 1, nl); rt.bloom.visible = lv > 0.01; }
      }
      if (it.key === 'som' && rt.ledMats) for (const m of rt.ledMats) m.emissiveIntensity = lv * 2.6;
      if (it.kind === 'climate' && rt.ledMats) {
        const hv = rt.hvacOn || rt.hvac, c = hv === 'cool' ? 0x67d3ff : hv === 'heat' ? 0xff8a5b : 0x8ef0b0;
        rt.snap = true; H0._airStep(rt, c, now, 0, nl, it.key);
      }
      if (it.key === 'porta' && rt.leaves) {
        for (const lf of rt.leaves) { const ry = lf.base - lf.dir * lv * 1.25; if (lf.g.rotation.y !== ry) { lf.g.rotation.y = ry; H0._refreshPointShadows('hall'); H0._sun.shadow.needsUpdate = true; } }
      }
    }
    this._dayScale = dayScale;
    if (H0._needShadow) { this.renderer.shadowMap.needsUpdate = true; H0._needShadow = false; }
  }

  // estado da vista (luzes, mezanino, luz que segue o cômodo, conjunto de luzes do media) e cortes
  _prep(v) {
    const H0 = this.host;
    H0._camera = v.cam; H0._topView = v.el >= 62;
    if (H0._mezz) H0._mezz.visible = !H0._topView && !(v._cutRoom && ['wcs'].includes(v._cutRoom));
    for (const f of this._free) if (f.hid) { f.o.visible = true; f.hid = false; }
    this._apply(v.state ? v.state() : { lights: {}, night: true });
    const cb = v._clipBox;
    if (cb) for (const f of this._free) if (f.o.visible && (f.x < cb[0] - f.r || f.x > cb[2] + f.r || f.z < cb[1] - f.r || f.z > cb[3] + f.r)) { f.o.visible = false; f.hid = true; }
    if (H0._roomLight) { H0._orbit = { target: v.target }; H0._walkOn = false; H0._roomLightTick(this._dayScale || 1); }
    if (H0._pool) { H0._assignPool(); for (const it of ITEMS) { const rt = H0._items.get(it.key); if (rt && rt.cands) for (const { L, i } of rt.lights) { L.intensity = i * (rt.lv || 0) * (this._dayScale || 1); L.color.copy(rt.color); } } }
    if (H0._needShadow) { this.renderer.shadowMap.needsUpdate = true; H0._needShadow = false; }
    this._applyCuts(v);
    if (this._cutMats) for (const [o, c] of this._cutMats) {
      if (o.emissive) { c.emissive.copy(o.emissive); c.emissiveIntensity = o.emissiveIntensity; }
      c.opacity = o.opacity; c.visible = o.visible; if (c.envMap !== o.envMap) { c.envMap = o.envMap; c.needsUpdate = true; } c.envMapIntensity = o.envMapIntensity;
    }
  }

  _queue(v) {
    this._dirty.add(v);
    if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; const L = [...this._dirty]; this._dirty.clear(); for (const x of L) { try { this._draw(x); } catch (e) { console.warn('igreja-painel-3d: render', e); } } });
  }
  _draw(v) {
    if (!this.scene || !v.c.isConnected) return;
    if (!v._sync()) return;
    const [w, h] = v._wh, s = v._size().s || 1, dpr = Math.min(2, window.devicePixelRatio || 1);
    let k = s * dpr * (v.o.res || 1); const maxW = v.o.maxPx || 1800; if (w * k > maxW) k = maxW / w;
    const pw = Math.max(2, Math.round(w * k)), ph = Math.max(2, Math.round(h * k));
    if (v.c.width !== pw || v.c.height !== ph) { v.c.width = pw; v.c.height = ph; }
    const R = this.renderer, cv = R.domElement;
    if (cv.width < pw || cv.height < ph) R.setSize(Math.max(cv.width, pw), Math.max(cv.height, ph), false);
    this._prep(v);
    R.clippingPlanes = v._clip || [];
    R.setViewport(0, 0, pw, ph); R.setScissor(0, 0, pw, ph); R.setScissorTest(true);
    R.render(this.scene, v.cam);
    R.clippingPlanes = [];
    v.g2.clearRect(0, 0, pw, ph);
    v.g2.drawImage(cv, 0, cv.height - ph, pw, ph, 0, 0, pw, ph);
    v.drawn = (v.drawn || 0) + 1;
  }
}
