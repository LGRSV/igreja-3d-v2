/*
 * Base Church · Painel dashboard da igreja — cartão Lovelace
 * type: custom:igreja-painel-card
 * Mesmo desenho do painel da casa (casa-petroleo-card v1.2.2): 1280×800 escalado por _fit() ocupando a área toda, menu lateral,
 * estado otimista (_pend) e comandos por _call. As vistas 3D vêm do motor igreja-painel-3d.js (ao lado deste arquivo);
 * sem o motor fica uma planta 2D desenhada aqui mesmo (mesma API de vista).
 * Entidades e blocos = os do igreja3d-card v1.8 (templo · operacional · banheiro · pastoral · hall).
 */
const IGP_VERSION = '1.2.0'; // v1.2.0: em cada A/C o botão ⏻, Velocidade (fan_modes) e Aleta (swing_modes) com seletor; modo do split também no seletor · v1.1.0: v1.1.0: “A/C” no lugar de “Ar”; A/C do Templo com Ligar/Desligar todos e os 5 splits separados (ac_templo_1…5) · v1.0.0: primeira versão — Início (resumo, cenas, blocos, ambiente 3D clicável, planta), Ambientes, Templo/Culto, A/C, Alexa
const P3_URL = new URL('igreja-painel-3d.js?v=1.0.1', import.meta.url).href;

// ---------- entidades (iguais ao README do igreja3d-card, "Configuração completa") ----------
const ENT = {
  palco: 'light.palco_rgb', plateia: 'light.templo_plateia', telao: 'media_player.telao_led', som: 'switch.som_templo',
  ac_templo: 'climate.ar_templo', presenca: 'binary_sensor.presenca_templo', temperatura: 'sensor.temperatura_templo',
  hall: 'light.hall_entrada', fachada: 'light.fachada_letreiro', estacionamento: 'light.estacionamento', porta: 'binary_sensor.porta_principal',
  banheiros: 'light.banheiros', pastoral: 'light.sala_pastoral', ac_pastoral: 'climate.ar_sala_pastoral', recepcao: 'light.recepcao',
  administrativo: 'light.administrativo', circulacao: 'light.circulacao', midia: 'light.sala_midia', ac_midia: 'climate.ar_midia',
  voluntariado: 'light.voluntariado', ac_voluntariado: 'climate.ar_voluntariado', cozinha: 'light.cozinha', sun: 'sun.sun', weather: '',
};
const LIGHTS = ['palco', 'plateia', 'hall', 'fachada', 'estacionamento', 'banheiros', 'pastoral', 'recepcao', 'administrativo', 'circulacao', 'midia', 'voluntariado', 'cozinha'];
const ACS = ['ac_templo', 'ac_pastoral', 'ac_midia', 'ac_voluntariado'];
const SPLITS = ['ac_templo_1', 'ac_templo_2', 'ac_templo_3', 'ac_templo_4', 'ac_templo_5'];   // os 5 splits do templo (opcionais: entities.ac_templo_1…5)
const TOG = [...LIGHTS, 'som', 'telao', ...ACS, ...SPLITS];   // tudo que liga e desliga
const SENS = ['presenca', 'temperatura', 'porta'];
const NAMES = { palco: 'Palco', plateia: 'Plateia', hall: 'Hall', fachada: 'Fachada', estacionamento: 'Estacionamento', banheiros: 'Banheiros',
  pastoral: 'Sala Pastoral', recepcao: 'Recepção', administrativo: 'Administrativo', circulacao: 'Circulação', midia: 'Mídia', voluntariado: 'Voluntariado',
  cozinha: 'Cozinha', som: 'Som', telao: 'Telão', ac_templo: 'A/C do Templo', ac_pastoral: 'A/C da Pastoral', ac_midia: 'A/C da Mídia',
  ac_voluntariado: 'A/C do Voluntariado', ac_templo_1: 'Split 1', ac_templo_2: 'Split 2', ac_templo_3: 'Split 3', ac_templo_4: 'Split 4', ac_templo_5: 'Split 5', presenca: 'Presença', temperatura: 'Temperatura', porta: 'Porta principal' };
const AC_SHORT = { ac_templo: 'Templo', ac_pastoral: 'Pastoral', ac_midia: 'Mídia', ac_voluntariado: 'Voluntariado' };
const AC_ROOM = { ac_templo: 'Templo · 5 splits', ac_pastoral: 'Sala Pastoral', ac_midia: 'Sala de Mídia', ac_voluntariado: 'Voluntariado' };

// ---------- blocos e cômodos (v1.8 do igreja3d-card); box = [x0, z0, x1, z1] em metros ----------
const BLOCKS = [
  { id: 'templo', n: 'Templo', icon: 'church', rooms: ['templo'], box: [0, 12.4, 16.05, 44.0], lp: [10.8, 28.1] },
  { id: 'operacional', n: 'Operacional', icon: 'desk', rooms: ['gilvan', 'administrativo', 'circulacao', 'midia', 'voluntariado'], box: [16.05, 11.0, 20.1, 33.9], lp: [18.1, 22.4] },
  { id: 'banheiro', n: 'Banheiro', icon: 'drop', rooms: ['deposito', 'tecnica', 'wc_masc', 'hall_banheiros', 'wc_fem'], box: [16.05, 33.9, 20.1, 49.5], lp: [18.6, 44.0] },
  { id: 'pastoral', n: 'Sala Pastoral', icon: 'book', rooms: ['patio', 'almoxarifado', 'cozinha', 'recepcao', 'pastoral', 'caixa_dagua'], box: [0, 0, 20.1, 12.4], lp: [10.0, 6.2] },
  { id: 'hall', n: 'Hall de entrada', icon: 'door', rooms: ['hall', 'wcs', 'estac_frontal', 'fachada'], box: [-3, 44.0, 23, 60], lp: [10.0, 47.0] },
];
const ROOMS = [
  { id: 'templo', n: 'Templo', b: 'templo', box: [0, 12.4, 16.05, 44.0], items: ['palco', 'plateia', 'telao', 'som', 'ac_templo', 'presenca', 'temperatura'] },
  { id: 'gilvan', n: 'Sala Gilvan', b: 'operacional', box: [17.1, 11.0, 20.1, 14.2], items: ['administrativo'] },
  { id: 'administrativo', n: 'Administrativo', b: 'operacional', box: [17.1, 14.2, 20.1, 19.0], items: ['administrativo'] },
  { id: 'circulacao', n: 'Circulação', b: 'operacional', box: [16.05, 19.0, 20.1, 23.3], items: ['circulacao'] },
  { id: 'midia', n: 'Mídia', b: 'operacional', box: [16.05, 23.3, 18.9, 28.0], items: ['midia', 'ac_midia'] },
  { id: 'voluntariado', n: 'Voluntariado', b: 'operacional', box: [16.05, 28.0, 20.1, 33.9], items: ['voluntariado', 'ac_voluntariado'] },
  { id: 'deposito', n: 'Depósito', b: 'banheiro', box: [17.1, 33.9, 20.1, 35.9], items: ['banheiros'] },
  { id: 'tecnica', n: 'Área técnica', b: 'banheiro', box: [17.1, 35.9, 20.1, 37.0], items: [] },
  { id: 'wc_masc', n: 'WC Masc.', b: 'banheiro', box: [17.1, 37.0, 20.1, 40.8], items: ['banheiros'] },
  { id: 'hall_banheiros', n: 'Hall dos banheiros', b: 'banheiro', box: [16.05, 40.8, 20.1, 44.3], items: ['banheiros'] },
  { id: 'wc_fem', n: 'WC Fem.', b: 'banheiro', box: [16.05, 44.3, 20.1, 49.5], items: ['banheiros'] },
  { id: 'patio', n: 'Pátio', b: 'pastoral', box: [0, 3.9, 12.75, 12.4], items: ['estacionamento'] },
  { id: 'almoxarifado', n: 'Almoxarifado', b: 'pastoral', box: [4.9, 0, 8.6, 3.9], items: ['cozinha'] },
  { id: 'cozinha', n: 'Cozinha', b: 'pastoral', box: [8.6, 0, 12.75, 3.9], items: ['cozinha'] },
  { id: 'recepcao', n: 'Recepção', b: 'pastoral', box: [9.45, 5.9, 12.75, 9.25], items: ['recepcao'] },
  { id: 'pastoral', n: 'Sala Pastoral', b: 'pastoral', box: [12.75, 0, 20.1, 11.0], items: ['pastoral', 'ac_pastoral'] },
  { id: 'caixa_dagua', n: 'Caixa d’água', b: 'pastoral', box: [17.0, 0, 20.1, 3.1], items: [] },
  { id: 'hall', n: 'Hall', b: 'hall', box: [0, 44.0, 16.05, 49.65], items: ['hall', 'porta'] },
  { id: 'wcs', n: 'WCs da frente', b: 'hall', box: [0, 44.0, 4.0, 46.3], items: ['banheiros'] },
  { id: 'fachada', n: 'Fachada', b: 'hall', box: [-3, 49.65, 23, 51.0], items: ['fachada'] },
  { id: 'estac_frontal', n: 'Estacionamento', b: 'hall', box: [-3, 51.0, 23, 60], items: ['estacionamento'] },
];
const RM = Object.fromEntries(ROOMS.map((r) => [r.id, r])), BK = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));
const blockItems = (b) => [...new Set(BK[b].rooms.flatMap((r) => RM[r].items))];
// enquadramentos de reserva [x0, z0, x1, z1, giro, inclinação] — o motor manda os dele (ROOMS3D / BLOCKS3D / PLAN3D)
const PLAN_F = [-3, 0, 23, 60, 90, 58];
const frameOf = (box) => [...box, 90, 52];

// ---------- cenas ----------
const SCENES = [
  { id: 'culto', n: 'Culto', d: 'Palco, telão, som e A/C', icon: 'church', f: [0, 12.4, 16.05, 44.0, 90, 46] },
  { id: 'ensaio', n: 'Ensaio', d: 'Palco azul, plateia baixa', icon: 'music', f: [0, 12.4, 16.05, 26.0, 90, 46] },
  { id: 'chegada', n: 'Chegada', d: 'Hall, fachada e pátio', icon: 'door', f: [-3, 40.0, 23, 60, 90, 48] },
  { id: 'limpeza', n: 'Limpeza', d: 'Todas as luzes no máximo', icon: 'sun', f: [-3, 0, 23, 60, 90, 58] },
  { id: 'fechar', n: 'Fechar tudo', d: 'Apaga luzes, A/C e som', icon: 'power', f: [-3, 0, 23, 60, 90, 58] },
];
const SCENE_ON = {   // o que cada cena deixa ligado (para as miniaturas)
  culto: ['palco', 'plateia', 'telao', 'som', 'ac_templo', 'hall', 'banheiros', 'fachada', 'estacionamento'],
  ensaio: ['palco', 'plateia', 'telao', 'som', 'ac_templo'],
  chegada: ['hall', 'fachada', 'estacionamento', 'banheiros'],
  limpeza: LIGHTS, fechar: [],
};
const PRESETS = [['Quente', '#ffb46e', [255, 180, 110], 2700], ['Branco', '#fff4e5', null, 5000], ['Azul', '#286eff', [40, 110, 255]], ['Roxo', '#8c3ce6', [140, 60, 230]],
  ['Vermelho', '#ff2828', [255, 40, 40]], ['Verde', '#28c85a', [40, 200, 90]]];
const FAN_PT = { auto: 'Auto', low: 'Baixa', medium: 'Média', middle: 'Média', mid: 'Média', high: 'Alta', quiet: 'Silencioso', silent: 'Silencioso', turbo: 'Turbo', strong: 'Forte', diffuse: 'Difuso', focus: 'Foco', on: 'Ligado', off: 'Desligado' };
const SWING_PT = { off: 'Parada', on: 'Oscilando', vertical: 'Vertical', horizontal: 'Horizontal', both: 'Ambas' };
const FAN_DEF = ['auto', 'low', 'medium', 'high'], SWING_DEF = ['off', 'on'];
const ptOf = (T, v) => v == null || v === '' ? '—' : T[String(v).toLowerCase()] || (/^\d+$/.test(String(v)) ? String(v) : String(v).charAt(0).toUpperCase() + String(v).slice(1).replace(/_/g, ' '));
const MODES = [['Frio', 'snow', 'cool'], ['Auto', 'auto', 'heat_cool'], ['Seco', 'drop', 'dry'], ['Ventilar', 'fan', 'fan_only']];
const HVAC_PT = { cool: 'Frio', heat_cool: 'Auto', auto: 'Auto', dry: 'Seco', fan_only: 'Ventilar', heat: 'Quente' };
const ALX_CMDS = ['Que horas são?', 'Como está o tempo?', 'Tocar louvor', 'Parar', 'Aumentar o volume', 'Diminuir o volume'];
const ALX_SONS = [['Sino', 'amzn_sfx_church_bell_1x_02'], ['Campainha', 'amzn_sfx_doorbell_chime_01'], ['Aplausos', 'amzn_sfx_crowd_applause_01'], ['Relógio', 'clock_01'], ['Buzina', 'air_horn_03']];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (id, st) => `<svg class="i"${st ? ` style="${st}"` : ''}><use href="#i-${id}"/></svg>`;
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const CSS = `:host{
  --bg:#061a1d; --bg2:#071c1f; --card:#0f2e33; --card2:#13383e; --line:rgba(255,255,255,.08);
  --mint:#1fe0a3; --mint2:#26d09c; --teal:#16464d; --teal2:#1c5760;
  --tx:#ffffff; --tx2:#8ba7ab; --tx3:#5f7e83; --orange:#e07a4a; --amber:#ffc46b;
  --f:"Inter","Segoe UI",Roboto,Arial,sans-serif; --fd:"Inter Display","Inter","Segoe UI",Roboto,Arial,sans-serif;
  color-scheme: dark;
  display:block;position:relative;background:#030d0f;overflow:hidden;height:var(--igp-h,calc(100vh - var(--header-height,56px)));min-height:320px;font-family:var(--f);color:var(--tx);-webkit-font-smoothing:antialiased
}
.fitbox{position:absolute;inset:0;overflow:hidden}
#app{position:absolute;left:0;top:0;width:1280px;height:800px;transform-origin:0 0;background:var(--bg);overflow:hidden;color:var(--tx);font-family:var(--f)}
#app *{box-sizing:border-box}
#app svg.i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
:where(#app) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left}
[hidden]{display:none!important}
/* menu lateral */
.side{position:absolute;left:0;top:0;width:212px;height:100%;background:var(--bg2);border-right:1px solid var(--line);padding:22px 14px 18px;display:flex;flex-direction:column}
.user{display:flex;align-items:center;gap:11px;padding:4px 6px 20px;border-bottom:1px solid var(--line)}
.ava{width:38px;height:38px;border-radius:12px;background:linear-gradient(140deg,#1fe0a3,#139a78);color:#062a22;font:700 17px var(--fd);display:grid;place-items:center}
.user b{display:block;font:600 14.5px var(--fd)}
.user span{font-size:11.5px;color:var(--tx2)}
.sec{font-size:10px;letter-spacing:.14em;color:var(--tx3);font-weight:600;margin:20px 8px 10px}
.nav a{display:flex;align-items:center;gap:11px;height:40px;padding:0 11px;border-radius:11px;color:var(--tx2);font-size:13.5px;font-weight:500;text-decoration:none;margin-bottom:3px;cursor:pointer;user-select:none}
.nav a.on{background:var(--teal);color:#fff;box-shadow:inset 0 0 0 1px rgba(31,224,163,.18)}
.nav a.on svg{color:var(--mint)}
.nav a .cnt{margin-left:auto;font-size:10.5px;background:rgba(255,255,255,.06);color:var(--tx2);padding:2px 7px;border-radius:99px}
.side .foot{margin-top:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.foot .row{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600}
.dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 3px rgba(31,224,163,.18)}
.foot p{font-size:11px;color:var(--tx2);margin:5px 0 0;line-height:1.45}
/* área principal */
.main{position:absolute;left:212px;top:0;width:calc(100% - 212px);height:100%;padding:22px 24px;display:grid;grid-template-rows:84px 70px minmax(0,1fr);row-gap:14px;background:radial-gradient(900px 500px at 85% -10%,rgba(31,224,163,.07),transparent 60%),var(--bg)}
.head{display:flex;justify-content:space-between;align-items:flex-start}
.date{font-size:11px;letter-spacing:.14em;color:var(--mint2);font-weight:600}
.head h2{font:600 31px/1.15 var(--fd);margin:7px 0 0;letter-spacing:-.01em}
.head p{font-size:13px;color:var(--tx2);margin:6px 0 0}
.clock{text-align:right}
.clock b{font:600 30px/1 var(--fd);font-variant-numeric:tabular-nums}
.clock > span{display:block;font-size:12px;color:var(--tx2);margin-top:7px}
.chips{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
.chip{font-size:11px;color:var(--tx2);border:1px solid var(--line);background:rgba(255,255,255,.03);padding:3px 9px;border-radius:99px;display:flex;align-items:center;gap:5px;white-space:nowrap}
.chip .dot{width:6px;height:6px;box-shadow:none}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) 150px;gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:16px;display:flex;align-items:center;gap:10px;padding:0 12px;box-shadow:0 8px 24px rgba(0,0,0,.18);min-width:0}
.ic{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(31,224,163,.12);color:var(--mint);flex:none;transition:background .3s,color .3s}
.ic.off{background:rgba(255,255,255,.05);color:var(--tx3)}
.stat b{display:block;font:600 14px var(--fd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stat span{display:block;font-size:11px;color:var(--tx2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stat div{min-width:0}
.act{background:linear-gradient(180deg,rgba(224,122,74,.16),rgba(224,122,74,.06));border:1px solid rgba(224,122,74,.65)!important;border-radius:16px;display:flex!important;align-items:center;gap:10px;padding:0 12px!important}
.act .ic{background:var(--orange);color:#fff;border-radius:50%}
.act b{display:block;font:600 14.5px var(--fd)}
.act span{display:block;font-size:11px;color:#d9b3a0;white-space:nowrap;margin-top:3px}
.ttl{display:flex;justify-content:space-between;align-items:center;min-height:22px;gap:8px}
.ttl h3{font:600 15px var(--fd);margin:0;white-space:nowrap}
.ttl h3 small{font:500 10px var(--f);letter-spacing:.14em;color:var(--tx3);margin-right:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;box-shadow:0 8px 24px rgba(0,0,0,.18);min-height:0}
/* Início */
.lower{display:grid;grid-template-columns:minmax(0,1fr) 370px;column-gap:18px;min-height:0}
.left{display:flex;flex-direction:column;gap:12px;min-height:0}
.right{display:flex;flex-direction:column;gap:14px;min-height:0}
.scenes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.scene{position:relative;background:var(--card);border:1px solid var(--line)!important;border-radius:14px;padding:4px!important;height:116px;display:block;width:100%;transition:border-color .25s,background .25s,box-shadow .25s}
.scene .pv{height:58px;border-radius:10px}
.scene .tx{padding:8px 2px 0 3px}
.scene .bd{position:absolute;left:6px;top:6px;z-index:3;width:24px;height:24px;border-radius:8px;background:rgba(6,26,29,.78);border:1px solid rgba(255,255,255,.14);display:grid;place-items:center;color:#cfe0e2}
.scene .bd svg{width:14px!important;height:14px!important}
.scene.on .bd{background:var(--mint);color:#063126;border-color:var(--mint)}
.scene b{display:block;font-size:11.5px;letter-spacing:-.02em;font-weight:600;white-space:nowrap}
.scene span{display:block;font-size:10.5px;color:var(--tx2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scene.on{background:linear-gradient(180deg,rgba(31,224,163,.18),rgba(31,224,163,.06));border-color:rgba(31,224,163,.75)!important;box-shadow:0 0 0 3px rgba(31,224,163,.10)}
.scene.on span{color:#a9e9d3}
.pv{position:relative;overflow:hidden;background:#0a1416}
.pv canvas.p3{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1;touch-action:none}
.pv.click canvas.p3{cursor:pointer}
.pin{position:absolute;transform:translate(-50%,-50%);z-index:2;pointer-events:none;transition:opacity .4s}
.room{flex:1;min-height:0;border-radius:20px;border:1px solid var(--line);position:relative;overflow:hidden;box-shadow:0 14px 30px rgba(0,0,0,.25)}
.room .pv{position:absolute;inset:0}
.scrim-t{position:absolute;left:0;right:0;top:0;height:120px;background:linear-gradient(180deg,rgba(6,26,29,.88),rgba(6,26,29,0));z-index:2;pointer-events:none}
.scrim-b{position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(0deg,rgba(6,26,29,.9),rgba(6,26,29,0));z-index:2;pointer-events:none}
.cap{position:absolute;left:20px;top:16px;z-index:3;pointer-events:none}
.cap small{font-size:10px;letter-spacing:.14em;color:var(--mint2);font-weight:600}
.cap h4{font:600 22px var(--fd);margin:4px 0 0}
.cap p{font-size:12px;color:#b9cfd2;margin:3px 0 0}
.ctrls{position:absolute;right:16px;top:16px;bottom:52px;width:172px;z-index:3;display:flex;flex-direction:column;gap:8px;overflow:auto;scrollbar-width:none}
.ctrls::-webkit-scrollbar{display:none}
.gl{background:rgba(9,32,36,.82)!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:14px;padding:10px 11px!important;display:block;width:100%;flex:none;transition:border-color .25s}
.gl .r{display:flex;align-items:center;justify-content:space-between}
.gl .r svg{width:17px!important;height:17px!important;color:var(--tx2)}
.gl.on{border-color:rgba(31,224,163,.4)!important}
.gl.on .r svg{color:var(--mint)}
.gl b{display:block;font-size:12.5px;font-weight:600;margin-top:8px}
.gl span{display:block;font-size:10.8px;color:var(--tx2);margin-top:2px}
.gl.on span{color:#a9e9d3}
.gl.na{opacity:.55}
.gl .more{font-size:10px;color:var(--mint2);margin-top:4px}
.gl.ro .r .val{font:600 13px var(--fd);color:#fff}
.empty{background:rgba(9,32,36,.82);border:1px dashed rgba(255,255,255,.18);border-radius:14px;padding:12px;font-size:11.5px;color:var(--tx2);line-height:1.45}
.tg{width:34px;height:20px;border-radius:99px;background:#2a4a4f;position:relative;flex:none;transition:background .25s}
.tg::after{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#9db4b7;transition:left .25s, background .25s}
.tg.on{background:var(--mint)}
.tg.on::after{left:17px;background:#fff}
.tabs{position:absolute;left:16px;bottom:14px;right:16px;z-index:3;display:flex;gap:6px;flex-wrap:wrap}
.tab{height:30px;padding:0 12px!important;border-radius:99px;display:flex!important;align-items:center;font-size:12px;font-weight:500;background:rgba(9,32,36,.72)!important;border:1px solid rgba(255,255,255,.12)!important;color:#cfe0e2;white-space:nowrap;transition:background .2s,color .2s;cursor:pointer}
.tab.on{background:#fff!important;color:#0b2428!important;font-weight:600;border-color:#fff!important}
.plan .pv{height:184px;border-radius:12px;margin-top:10px}
.zoom{display:flex;align-items:center;gap:2px;font-size:11px;color:var(--tx2);border:1px solid var(--line);border-radius:99px;padding:2px 3px}
.zoom i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.05);font-style:normal;color:#fff;cursor:pointer;user-select:none}
.zoom span{padding:0 4px}
.rl{background:rgba(6,26,29,.82);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:2px 7px;font-size:9.5px;font-weight:600;white-space:nowrap}
.mdot{width:7px;height:7px;border-radius:50%;background:#fff3d6;box-shadow:0 0 0 2px rgba(255,196,107,.45),0 0 8px 2px rgba(255,196,107,.7)}
.odot{width:7px;height:7px;border-radius:50%;border:1.5px solid #6f8b90;background:rgba(6,26,29,.6)}
.legend{display:flex;gap:14px;margin-top:10px;font-size:11px;color:var(--tx2);align-items:center}
.legend span{display:flex;align-items:center;gap:6px}
.blks{flex:1;display:flex;flex-direction:column}
.blist{display:flex;flex-direction:column;gap:4px;margin-top:8px;flex:1;min-height:0;overflow:auto;scrollbar-width:none}
.brow{display:grid!important;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px;padding:4px 8px!important;border-radius:14px;background:rgba(255,255,255,.03)!important;border:1px solid var(--line)!important;width:100%;flex:none}
.brow.sel{border-color:rgba(31,224,163,.5)!important}
.brow b{display:block;font-size:13px;font-weight:600}
.brow .ic{width:30px;height:30px;border-radius:10px}
.brow .ic svg{width:16px!important;height:16px!important}
.brow span{display:block;font-size:11px;color:var(--tx2);margin-top:1px}
.brow.on span{color:#a9e9d3}
/* páginas: escondem resumo e parte de baixo do Início */
.page{display:none;min-height:0;grid-row:2 / span 2}
#app:not(.p-home) .stats,#app:not(.p-home) .lower{display:none}
#app.p-rooms .amb,#app.p-templo .tpl,#app.p-ares .ares,#app.p-alexa .alx{display:grid}
/* Ambientes */
.amb{grid-template-columns:minmax(0,1fr) 400px;column-gap:18px}
.amb .room{flex:none;height:100%}
.alist{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0;padding-right:4px;scrollbar-width:thin;scrollbar-color:#1c5760 transparent}
.agrp{font-size:10px;letter-spacing:.14em;color:var(--tx3);font-weight:600;margin:10px 4px 2px;display:flex;justify-content:space-between;align-items:center}
.agrp:first-child{margin-top:0}
.agrp .tg{transform:scale(.85)}
.arow{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px;cursor:pointer}
.arow.sel{border-color:rgba(31,224,163,.6);box-shadow:0 0 0 3px rgba(31,224,163,.10)}
.arow .h{display:flex;justify-content:space-between;align-items:center}
.arow .h b{font-size:13.5px;font-weight:600}
.arow .h span{font-size:11px;color:var(--tx2)}
.devs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dv{height:28px;padding:0 10px!important;border-radius:99px;font-size:11.5px;font-weight:500;background:rgba(255,255,255,.04)!important;border:1px solid var(--line)!important;color:var(--tx2);display:flex!important;align-items:center;gap:6px}
.dv svg{width:14px!important;height:14px!important}
.dv.on{background:rgba(31,224,163,.16)!important;color:#dff7ee;border-color:rgba(31,224,163,.55)!important}
.dv.ro{cursor:default}
.dv.na{opacity:.5}
/* Templo / Culto */
.tpl{grid-template-columns:minmax(0,1fr) 420px;column-gap:18px}
.tleft{display:flex;flex-direction:column;gap:12px;min-height:0}
.tleft .room{flex:1}
.trow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;height:178px;flex:none}
.tright{display:flex;flex-direction:column;gap:14px;min-height:0}
.top2{display:flex;justify-content:space-between;align-items:center;gap:8px}
.top2 b{font:600 15px var(--fd)}
.top2 span{display:block;font-size:11px;color:var(--tx2);margin-top:2px}
.sw{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:12px}
.swb{display:flex!important;flex-direction:column;align-items:center;gap:6px;font-size:10.5px;color:var(--tx2);padding:7px 0!important;border-radius:12px;border:1px solid transparent!important}
.swb i{width:26px;height:26px;border-radius:50%;display:block;box-shadow:0 0 0 2px rgba(255,255,255,.12)}
.swb.on{border-color:rgba(31,224,163,.6)!important;background:rgba(31,224,163,.08)!important;color:#fff}
.rowl{display:flex;justify-content:space-between;font-size:12px;color:var(--tx2);margin:14px 0 8px}
.rowl b{color:#fff;font-variant-numeric:tabular-nums}
.rng{width:100%;accent-color:var(--mint);margin:0}
.big{font:600 30px/1 var(--fd);margin-top:14px;font-variant-numeric:tabular-nums}
.big small{font-size:13px;color:var(--tx2);font-weight:500;margin-left:4px}
.sub2{font-size:11.5px;color:var(--tx2);margin-top:6px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctl{display:flex;justify-content:center;gap:14px;margin-top:12px;align-items:center}
.ctl button{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.06)!important;display:grid!important;place-items:center}
.ctl .pp{width:46px;height:46px;background:var(--mint)!important;color:#063126}
.ctl button:disabled{opacity:.35;pointer-events:none}
/* clima (A/C e Templo) */
.clim{display:flex;flex-direction:column}
.clim.off .temp b{color:var(--tx3)}
.dial{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
.rb{width:38px;height:38px;border-radius:12px;background:var(--teal)!important;border:1px solid var(--line)!important;display:grid!important;place-items:center;color:#fff}
.rb svg{width:16px!important;height:16px!important}
.temp{text-align:center}
.temp b{font:600 40px/1 var(--fd);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.temp b sup{font-size:17px;vertical-align:top;margin-left:2px;color:var(--tx2);font-weight:500}
.temp > span{display:block;font-size:11px;color:var(--tx2);margin-top:3px}
.modes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
.mode{height:28px;border-radius:99px;display:flex!important;align-items:center;justify-content:center;gap:5px;font-size:11.5px;font-weight:500;background:rgba(255,255,255,.04)!important;border:1px solid var(--line)!important;color:var(--tx2)}
.mode svg{width:13px!important;height:13px!important}
.mode.on{background:var(--mint)!important;color:#063126!important;border-color:var(--mint)!important;font-weight:600}
.clim.na{opacity:.55}
.ares{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);grid-template-rows:repeat(3,minmax(0,1fr));gap:14px}
.ares .clim{padding:14px 18px}
.ares .tplac{grid-row:1 / span 3;padding:18px 20px}
.ares .tplac .temp b{font-size:48px}
.ares .clim:not(.tplac) .temp b{font-size:32px}
.ares .clim:not(.tplac) .dial{margin-top:auto;padding:0 10%}
.ares .clim:not(.tplac) .modes{margin-top:auto}
.tright .clim .temp b{font-size:32px}
.tright .clim .dial{margin-top:6px}
/* v1.1: os 5 splits do templo */
.splh{display:flex;gap:6px;align-items:center;margin-top:12px}
.splh small{font-size:10px;letter-spacing:.14em;color:var(--tx3);font-weight:600;margin-right:auto}
.allb{height:28px;padding:0 12px!important;border-radius:99px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.05)!important;border:1px solid var(--line)!important;color:#dfeef0;white-space:nowrap}
.allb.on{background:var(--mint)!important;color:#063126!important;border-color:var(--mint)!important}
.spls{display:flex;flex-direction:column;gap:5px;margin-top:8px}
.spl{display:grid;grid-template-columns:minmax(0,1fr) auto auto 34px;align-items:center;gap:8px;padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid var(--line)}
.spl.on{border-color:rgba(31,224,163,.35)}
.spl.na{opacity:.5}
.spl .sn b{display:block;font-size:12.5px;font-weight:600}
.spl .sn span{display:block;font-size:10.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.spl.on .sn span{color:#a9e9d3}
.spl .st{display:flex;align-items:center;gap:4px}
.spl .st b{font:600 14px var(--fd);min-width:32px;text-align:center;font-variant-numeric:tabular-nums}
.rb.s{width:24px;height:24px;border-radius:8px}
.rb.s svg{width:12px!important;height:12px!important}
.spl .sm{display:flex;gap:3px}
.mode.s{width:24px;height:24px;padding:0!important;gap:0}
.mode.s svg{width:12px!important;height:12px!important}
.splnote{font-size:11px;color:var(--tx2);margin-top:10px;line-height:1.45;border:1px dashed rgba(255,255,255,.18);border-radius:12px;padding:8px 10px}
.splnote code{color:#dfeef0}
/* v1.2: ⏻, Velocidade e Aleta (seletor) */
.pw{width:34px;height:34px;border-radius:50%;display:grid!important;place-items:center;background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.14)!important;color:var(--tx2);flex:none;transition:background .2s,color .2s,box-shadow .2s}
.pw svg{width:17px!important;height:17px!important;stroke-width:2.2!important}
.pw.on{background:var(--mint)!important;color:#063126!important;border-color:var(--mint)!important;box-shadow:0 0 0 3px rgba(31,224,163,.18)}
.spl .pw{width:30px;height:30px}
.spl .pw svg{width:15px!important;height:15px!important}
.xrow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.xb{height:28px;border-radius:99px;display:flex!important;align-items:center;justify-content:center;gap:5px;font-size:11.5px;font-weight:500;background:rgba(255,255,255,.04)!important;border:1px solid var(--line)!important;color:var(--tx2);padding:0 9px!important;min-width:0;white-space:nowrap}
.xb svg{width:13px!important;height:13px!important}
.xb span{overflow:hidden;text-overflow:ellipsis}
.xb small{font-size:10px;color:var(--tx3);font-weight:500}
.xb.on{color:#dfeef0;border-color:rgba(31,224,163,.45)!important}
.xb.open{background:rgba(31,224,163,.16)!important;border-color:var(--mint)!important;color:#fff}
.spl{grid-template-columns:30px minmax(0,1fr) auto auto auto auto!important;gap:6px!important;padding:5px 6px!important}
.spl .xb{height:26px;padding:0 7px!important;font-size:10.5px;max-width:86px;gap:4px}
.spl.all{background:rgba(31,224,163,.06);border-color:rgba(31,224,163,.25)}
.pop{position:absolute;z-index:70;min-width:150px;background:#0d2a2f;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:6px;box-shadow:0 18px 50px rgba(0,0,0,.55);display:none}
.pop.open{display:block}
.pop h5{margin:2px 6px 6px;font:600 10px var(--f);letter-spacing:.12em;color:var(--tx3)}
.pop button{display:flex!important;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px!important;border-radius:9px;font-size:12.5px;color:#dfeef0}
.pop button:hover{background:rgba(255,255,255,.06)!important}
.pop button.on{background:var(--mint)!important;color:#063126!important;font-weight:600}
.pop button svg{width:14px!important;height:14px!important}
.ares .clim:not(.tplac) .xrow{margin-top:8px}
.ares .spls{gap:8px;margin-top:12px}
.ares .spl{padding:9px 10px}
.ares .spl .sn b{font-size:13.5px}
.splh small{white-space:nowrap}
.mini{display:flex;justify-content:space-between;margin-top:auto;padding-top:10px;border-top:1px solid var(--line);font-size:11.2px;color:var(--tx2)}
.mini span{display:flex;align-items:center;gap:6px}
.mini svg{width:14px!important;height:14px!important}
.mini b{color:#fff;font-weight:600}
/* Alexa */
.alx{grid-template-columns:minmax(0,1fr) 370px;column-gap:18px}
.aleft{display:flex;flex-direction:column;gap:14px;min-height:0}
.say{display:flex;gap:8px;margin-top:12px}
.say input{flex:1;min-width:0;height:44px;border-radius:14px;border:1px solid var(--line);background:#0a2226;color:var(--tx);font:500 14px var(--f);padding:0 16px;outline:none}
.say input:focus{border-color:rgba(31,224,163,.6);box-shadow:0 0 0 3px rgba(31,224,163,.12)}
.pbtn{height:44px;padding:0 16px!important;border-radius:14px;background:var(--mint)!important;color:#063126!important;font-weight:700!important;display:flex!important;align-items:center;gap:8px;white-space:nowrap}
.pbtn.alt{background:var(--teal)!important;color:#fff!important}
.chipsb{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chipsb button{height:34px;padding:0 14px!important;border-radius:99px;font-size:12.5px;font-weight:500;background:rgba(255,255,255,.04)!important;border:1px solid var(--line)!important;color:#dfeef0;display:flex!important;align-items:center;gap:7px}
.chipsb button:active{background:rgba(31,224,163,.16)!important}
.kv{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--tx2);gap:10px}
.kv:last-child{border-bottom:0}
.kv b{color:#fff;font-weight:600;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hint{font-size:11px;color:var(--tx3);line-height:1.45;margin-top:10px}
/* modal e aviso */
.mbg{position:absolute;inset:0;background:rgba(2,10,12,.62);z-index:50;display:grid;place-items:center;opacity:0;pointer-events:none;transition:opacity .25s}
.mbg.open{opacity:1;pointer-events:auto}
.sheet{width:440px;background:#0d2a2f;border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:18px 20px 20px;box-shadow:0 30px 80px rgba(0,0,0,.55);transform:translateY(12px) scale(.98);transition:transform .25s}
.mbg.open .sheet{transform:none}
.sh{display:flex;align-items:center;gap:10px}
.sh .x{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.08)!important;display:grid!important;place-items:center;font-size:18px;color:#cfe0e2}
.sh b{font:600 17px var(--fd)}
.sh .tg{margin-left:auto}
.sheet .sub{font-size:12px;color:var(--tx2);margin:6px 0 14px 40px}
.toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,20px);background:#0d2a2f;border:1px solid rgba(31,224,163,.45);color:#dff7ee;font-size:12.5px;font-weight:500;padding:9px 16px;border-radius:99px;opacity:0;transition:opacity .25s, transform .25s;z-index:60;white-space:nowrap;pointer-events:none}
.toast.show{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion: reduce){.tg::after,.toast,.sheet{transition:none}}
`;
const ICONS = `
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></symbol>
<symbol id="i-door" viewBox="0 0 24 24"><path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M4 20.5h16"/><circle cx="14.5" cy="12" r=".9" fill="currentColor"/></symbol>
<symbol id="i-church" viewBox="0 0 24 24"><path d="M12 2.5v5M9.8 4.7h4.4"/><path d="M12 7.5 6.5 12v8.5h11V12z"/><path d="M4 20.5h16M10.3 20.5v-4a1.7 1.7 0 0 1 3.4 0v4"/></symbol>
<symbol id="i-desk" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M9 20h6M12 15.5V20"/></symbol>
<symbol id="i-book" viewBox="0 0 24 24"><path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10.5M11.8 7v5M9.4 9.2h4.8"/></symbol>
<symbol id="i-bulb" viewBox="0 0 24 24"><path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.1v.6h5.2v-.6c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></symbol>
<symbol id="i-spot" viewBox="0 0 24 24"><path d="M9 3.5h6l-1 5h-4z"/><path d="M10 8.5 5 20.5h14l-5-12"/></symbol>
<symbol id="i-snow" viewBox="0 0 24 24"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/></symbol>
<symbol id="i-tv" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="12.5" rx="2.5"/><path d="M8.5 21h7"/></symbol>
<symbol id="i-speaker" viewBox="0 0 24 24"><rect x="6" y="2.8" width="12" height="18.4" rx="2.5"/><circle cx="12" cy="14.5" r="3.2"/><circle cx="12" cy="7" r="1.1"/></symbol>
<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/></symbol>
<symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3v8.5"/><path d="M7 6.2a7.5 7.5 0 1 0 10 0"/></symbol>
<symbol id="i-drop" viewBox="0 0 24 24"><path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
<symbol id="i-swing" viewBox="0 0 24 24"><path d="M3.5 6.5h17"/><path d="M6 10.5 18 12M6 15.5l12-1.5M6 20l12-3"/></symbol>
<symbol id="i-fan" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C10.5 6.5 11 3.5 13.6 3.5c2.5 0 2.4 3.6-1.6 6.9zM13.6 12.4c4.1-.6 7 .4 6.6 3-.4 2.4-3.8 1.3-6.6-3zM10.6 13c-2.5 3.3-5.3 4.5-6.6 2.3-1.2-2.2 2-3.8 6.6-2.3z"/></symbol>
<symbol id="i-auto" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></symbol>
<symbol id="i-radar" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/></symbol>
<symbol id="i-therm" viewBox="0 0 24 24"><path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></symbol>
<symbol id="i-prev" viewBox="0 0 24 24"><path d="M18 6v12L9 12zM6 6v12"/></symbol>
<symbol id="i-next" viewBox="0 0 24 24"><path d="M6 6v12l9-6zM18 6v12"/></symbol>
<symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></symbol>
<symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></symbol>
<symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></symbol>
<symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5.5h16v10H9l-5 4z"/></symbol>
`;

const HTML = `
<div class="fitbox" id="fitbox"><div id="app" class="p-home">
  <aside class="side">
    <div class="user"><div class="ava" id="ava">B</div><div><b id="uname">Base Church</b><span id="usub">Painel da igreja</span></div></div>
    <div class="sec">MENU</div>
    <nav class="nav" id="nav">
      <a class="on" data-nav="home">${svg('grid')}Início</a>
      <a data-nav="rooms">${svg('door')}Ambientes<span class="cnt">${ROOMS.length}</span></a>
      <a data-nav="templo">${svg('church')}Templo / Culto</a>
      <a data-nav="ares">${svg('snow')}A/C<span class="cnt" id="nav-ac">0</span></a>
      <a data-nav="alexa" id="nav-alexa" hidden>${svg('mic')}Alexa</a>
    </nav>
    <div class="foot"><div class="row"><span class="dot" id="hadot"></span><span id="hastat">Home Assistant online</span></div><p><span id="ndev">0</span> dispositivos · ${BLOCKS.length} blocos<br>Sincronizado há <span id="sync">1 s</span></p></div>
  </aside>
  <main class="main">
    <header class="head">
      <div><div class="date" id="date"></div><h2 id="hello">Boa noite.</h2><p id="mood"></p></div>
      <div class="clock"><b id="clock">--:--</b><span id="wx">Palmas (TO)</span>
        <div class="chips"><span class="chip" id="chip-pres"><span class="dot"></span><span id="pres-t">Templo vazio</span></span><span class="chip" id="chip-porta">Porta <span id="porta-t">—</span></span></div></div>
    </header>
    <section class="stats">
      <div class="stat"><div class="ic" id="st-p-ic">${svg('radar')}</div><div><b id="st-p1"></b><span id="st-p2"></span></div></div>
      <div class="stat"><div class="ic" id="st-l-ic">${svg('bulb')}</div><div><b id="st-l"></b><span id="st-l2"></span></div></div>
      <div class="stat"><div class="ic" id="st-ac-ic">${svg('snow')}</div><div><b id="st-ac"></b><span id="st-ac2"></span></div></div>
      <div class="stat"><div class="ic" id="st-c-ic">${svg('tv')}</div><div><b id="st-c"></b><span id="st-c2"></span></div></div>
      <button type="button" class="act" id="act-off"><div class="ic">${svg('power')}</div><div><b>Fechar tudo</b><span>Luzes, A/C e som</span></div></button>
    </section>
    <section class="lower">
      <div class="left">
        <div class="ttl"><h3><small>CENAS</small>Cenas rápidas</h3></div>
        <div class="scenes" id="scenes"></div>
        <div class="room">
          <div class="pv click" id="room-pv"></div>
          <div class="scrim-t"></div><div class="scrim-b"></div>
          <div class="cap"><small id="room-k">BLOCO SELECIONADO</small><h4 id="room-name"></h4><p id="room-sub"></p></div>
          <div class="ctrls" id="ctrls"></div>
          <div class="tabs" id="tabs"></div>
        </div>
      </div>
      <div class="right">
        <div class="card plan">
          <div class="ttl"><h3>Planta interativa</h3><div class="zoom" id="zoom"><i data-z="-1">−</i><span id="zoom-t">100%</span><i data-z="1">+</i></div></div>
          <div class="pv click" id="plan-pv"></div>
          <div class="legend"><span><span class="mdot"></span><span id="lg-on"></span></span><span><span class="odot"></span><span id="lg-off"></span></span><span style="margin-left:auto">Toque num cômodo</span></div>
        </div>
        <div class="card blks"><div class="ttl"><h3><small>BLOCOS</small>Ligar e desligar</h3></div><div class="blist" id="blist"></div></div>
      </div>
    </section>
    <section class="page amb" id="amb">
      <div class="room">
        <div class="pv click" id="amb-pv"></div>
        <div class="scrim-t"></div><div class="scrim-b"></div>
        <div class="cap"><small id="amb-k">AMBIENTE</small><h4 id="amb-name"></h4><p id="amb-sub"></p></div>
      </div>
      <div class="alist" id="alist"></div>
    </section>
    <section class="page tpl" id="tpl">
      <div class="tleft">
        <div class="room">
          <div class="pv click" id="tpl-pv"></div>
          <div class="scrim-t"></div>
          <div class="cap"><small>TEMPLO</small><h4>Culto</h4><p id="tpl-sub"></p></div>
        </div>
        <div class="trow">
          <div class="card" id="c-plateia"></div>
          <div class="card" id="c-telao"></div>
          <div class="card" id="c-som"></div>
        </div>
      </div>
      <div class="tright">
        <div class="card" id="c-palco"></div>
        <div class="card clim" id="c-actpl"></div>
      </div>
    </section>
    <section class="page ares" id="ares"></section>
    <section class="page alx" id="alx">
      <div class="aleft">
        <div class="card"><div class="ttl"><h3><small>ALEXA</small>Falar e anunciar</h3></div>
          <form class="say" id="say"><input id="say-t" type="text" placeholder="Escreva o que a Alexa deve falar" aria-label="Texto para a Alexa" enterkeyhint="send">
            <button type="submit" class="pbtn">${svg('chat')}Falar</button><button type="button" class="pbtn alt" id="say-an">${svg('bell')}Anunciar</button></form>
          <p class="hint">Falar usa a voz da Echo; Anunciar toca o aviso antes. Sem as entidades de notificação, o texto vai como comando de voz.</p></div>
        <div class="card"><div class="ttl"><h3><small>COMANDOS</small>Pedidos rápidos</h3></div>
          <div class="chipsb" id="alx-cmds">${ALX_CMDS.map((c) => `<button type="button" data-cmd="${esc(c)}">${svg('mic')}${esc(c)}</button>`).join('')}</div>
          <form class="say" id="cmd"><input id="cmd-t" type="text" placeholder="Outro pedido (ex.: tocar Hillsong no Spotify)" aria-label="Comando livre para a Alexa" enterkeyhint="send"><button type="submit" class="pbtn">${svg('mic')}Pedir</button></form></div>
        <div class="card"><div class="ttl"><h3><small>SONS</small>Tocar na Echo</h3></div>
          <div class="chipsb" id="alx-sons">${ALX_SONS.map(([n, s]) => `<button type="button" data-snd="${s}">${svg('bell')}${esc(n)}</button>`).join('')}</div></div>
      </div>
      <div class="card" id="alx-st"><div class="ttl"><h3>Status da Echo</h3></div><div id="alx-kv"></div></div>
    </section>
  </main>
  <div class="mbg" id="mbg"><div class="sheet" id="sheet" role="dialog" aria-modal="true"></div></div>
  <div class="pop" id="pop" role="listbox"></div>
  <div class="toast" id="toast" role="status"></div>
</div></div>`;

// ---------------------------------------------------------------------------
// Planta 2D de reserva (sem o motor 3D): mesma API das vistas do motor
// ---------------------------------------------------------------------------
class FlatView {
  constructor(eng, canvas, o) {
    this.e = eng; this.cv = canvas; this.o = Object.assign({ safe: { l: 0, t: 0, r: 0, b: 0 }, res: 1 }, o || {}); this.zoom = 1; this._cut = null;
    this.F = PLAN_F.slice(0, 4); this.onCam = null; this.onClick = null;
    if (this.o.interactive) canvas.addEventListener('click', (e) => { const r = canvas.getBoundingClientRect(), k = canvas.clientWidth / (r.width || 1);
      const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k; if (this.onClick) this.onClick(px, py, this.pickAt(px, py)); });
  }
  frame(x0, z0, x1, z1) { this.F = [x0, z0, x1, z1]; this.zoom = 1; this._calc(); this.render(); if (this.onCam) this.onCam(); }
  setZoom(z) { this.zoom = Math.max(0.5, Math.min(4, z)); this._calc(); this.render(); if (this.onCam) this.onCam(); }
  cut(id) { this._cut = id || null; this.render(); }
  dispose() { this.cv.remove(); }
  _calc() {   // escala e giro (o prédio é comprido: deita quando a área é larga)
    const W = this.cv.clientWidth || 300, H = this.cv.clientHeight || 200, s = this.o.safe, [x0, z0, x1, z1] = this.F;
    const w = W - s.l - s.r, h = H - s.t - s.b, fw = x1 - x0, fh = z1 - z0;
    this.rot = (fh > fw) !== (h > w) && Math.abs(fh - fw) > 0.5;
    const ew = this.rot ? fh : fw, eh = this.rot ? fw : fh;
    this.k = Math.min(w / ew, h / eh) * 0.94 * this.zoom; this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2; this.ox = s.l + w / 2; this.oy = s.t + h / 2;
  }
  project(p) { if (this.k == null) this._calc(); const dx = p[0] - this.cx, dz = p[2] - this.cz;
    return this.rot ? [this.ox + dz * this.k, this.oy - dx * this.k] : [this.ox + dx * this.k, this.oy + dz * this.k]; }   // deitado: frente (z grande) à direita
  pick(px, py) { if (this.k == null) this._calc(); const a = (px - this.ox) / this.k, b = (py - this.oy) / this.k;
    return this.rot ? [this.cx - b, this.cz + a] : [this.cx + a, this.cz + b]; }
  pickAt(px, py) {
    for (const k of TOG) for (const w of this.e.points(k)) { const [a, b] = this.project(w); if (Math.hypot(a - px, b - py) < 12) return { kind: k.startsWith('ac_') ? 'ac' : (k === 'telao' || k === 'som') ? k : 'light', key: k, room: this.e.roomAt(w[0], w[2]) }; }
    const [x, z] = this.pick(px, py), room = this.e.roomAt(x, z);
    return room ? { kind: 'room', key: null, room } : null;
  }
  render() {
    const cv = this.cv, dpr = Math.min(2, (window.devicePixelRatio || 1)) * (this.o.res || 1), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    this._calc(); const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = (this.o.state && this.o.state()) || {}, L = st.lights || {}, night = st.night !== false;
    g.fillStyle = night ? '#071417' : '#10282c'; g.fillRect(0, 0, W, H);
    const rect = (b) => { const p = this.project([b[0], 0, b[1]]), q = this.project([b[2], 0, b[3]]); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])]; };
    const order = ROOMS.slice().sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]));
    for (const r of order) {
      const lit = r.items.some((k) => LIGHTS.includes(k) && L[k]), dim = this._cut && this._cut !== r.id;
      const [a, b, w, h] = rect(r.box); g.globalAlpha = dim ? 0.35 : 1;
      g.fillStyle = lit ? (night ? 'rgba(255,190,110,.42)' : 'rgba(255,214,150,.30)') : '#15343a'; g.fillRect(a, b, w, h);
      g.strokeStyle = this._cut === r.id ? '#1fe0a3' : 'rgba(255,255,255,.18)'; g.lineWidth = this._cut === r.id ? 2 : 1; g.strokeRect(a + .5, b + .5, w - 1, h - 1);
      if (w > 46 && h > 16 && this.o.labels !== false) { g.fillStyle = 'rgba(223,238,240,.75)'; g.font = '600 10px Inter,Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.n, a + w / 2, b + h / 2, w - 6); }
    }
    g.globalAlpha = 1;
    if (st.palco && st.palco.on) { const [a, b, w, h] = rect([0, 20.0, 4.9, 36.2]); g.fillStyle = hex(st.palco.rgb || [255, 180, 110]) + 'aa'; g.fillRect(a, b, w, h); }
    if (st.telao && st.telao.on) { const [a, b, w, h] = rect([0.1, 24.6, 0.6, 31.6]); g.fillStyle = '#7fd8ff'; g.fillRect(a, b, Math.max(w, 2), Math.max(h, 2)); }
    for (const k of ACS) { const on = st.ac && st.ac[k] && st.ac[k].on; for (const w of this.e.points(k)) { const [a, b] = this.project(w); g.beginPath(); g.arc(a, b, 4, 0, 7); g.fillStyle = on ? '#5ab8ff' : '#33515a'; g.fill(); } }
  }
}
class FlatEngine {
  static shared(o) { return window.__igrejaFlat2D || (window.__igrejaFlat2D = new FlatEngine(o)); }
  constructor(o) { this.o = o || {}; this.flat = true; }
  ready() { return Promise.resolve(this); }
  view(canvas, o) { return new FlatView(this, canvas, o); }
  roomAt(x, z) { const hit = ROOMS.filter((r) => x >= r.box[0] && x <= r.box[2] && z >= r.box[1] && z <= r.box[3]);
    hit.sort((a, b) => (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) - (b.box[2] - b.box[0]) * (b.box[3] - b.box[1])); return hit.length ? hit[0].id : null; }
  points(k) {   // centro do cômodo de cada luz/aparelho (o palco fica na frente do templo)
    if (k === 'palco') return [[2.6, 3.2, 28.1]]; if (k === 'telao') return [[0.25, 2.65, 28.1]]; if (k === 'som') return [[4.9, 1.065, 19.8], [4.9, 1.065, 36.4]];
    const rs = ROOMS.filter((r) => r.items[0] === k || (k.startsWith('ac_') && r.items.includes(k)) || (LIGHTS.includes(k) && r.items.includes(k) && r.items.indexOf(k) === 0));
    return rs.map((r) => [(r.box[0] + r.box[2]) / 2 + (k.startsWith('ac_') ? (r.box[2] - r.box[0]) * 0.3 : 0), 2.6, (r.box[1] + r.box[3]) / 2]);
  }
}
window.__igrejaFlatEngine = FlatEngine;   // o stub de teste do motor (tools/painel/) usa esta mesma planta

// ---------------------------------------------------------------------------
class IgrejaPainelCard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._sel = 'b:templo'; this._asel = 'templo'; this._scene = null; this._nav = 'home'; this._pend = {}; this._local = {}; }
  static getStubConfig() { return {}; }
  setConfig(c) { this._config = Object.assign({}, c || {}); this._ent = Object.assign({}, ENT, (c && c.entities) || {}); if (this._built) { this._applyConfig(); this._fit(); } }
  getCardSize() { return 12; }
  set hass(h) { const first = !this._hass; this._hass = h; this._lastHass = Date.now(); if (!this._built) this._build(); this._derive(); this._render(); if (first) this._fit(); }
  get hass() { return this._hass; }
  connectedCallback() {
    if (!this._built && this._hass) this._build();
    if (!this._ro) { this._ro = new ResizeObserver(() => this._fit()); this._ro.observe(this); }
    if (!this._tick) this._tick = setInterval(() => this._clock(), 1000);
  }
  disconnectedCallback() { clearInterval(this._tick); this._tick = 0; if (this._ro) { this._ro.disconnect(); this._ro = null; } }
  $(id) { return this.shadowRoot.getElementById(id); }

  // ---------- estado real → S ----------
  _st(k) { const id = this._ent[k]; return id && this._hass && this._hass.states[id]; }
  _isOn(k) {
    const s = this._st(k); if (!s) return false; const v = s.state;
    if (k === 'telao') return !['off', 'standby', 'unavailable', 'unknown'].includes(v);
    if (ACS.includes(k) || SPLITS.includes(k)) return !['off', 'unavailable', 'unknown'].includes(v);
    return v === 'on';
  }
  _derive() {
    const S = { on: {}, na: {}, ac: {} };
    for (const k of TOG) { const s = this._st(k); S.on[k] = this._isOn(k); S.na[k] = !s || s.state === 'unavailable'; }
    const pa = (this._st('palco') || {}).attributes || {};
    S.palcoRgb = pa.rgb_color || (pa.color_temp_kelvin ? (pa.color_temp_kelvin < 3600 ? [255, 180, 110] : [255, 244, 229]) : [255, 180, 110]);
    S.palcoBri = pa.brightness != null ? Math.max(1, Math.round(pa.brightness / 2.55)) : 100; S.palcoColor = this._preset(pa);
    const pl = (this._st('plateia') || {}).attributes || {}; S.plateiaBri = pl.brightness != null ? Math.max(1, Math.round(pl.brightness / 2.55)) : 100;
    const tv = this._st('telao'), ta = (tv && tv.attributes) || {};
    S.telao = { state: tv ? tv.state : 'unavailable', title: ta.media_title || '', artist: ta.media_artist || ta.app_name || '', vol: ta.volume_level != null ? Math.round(ta.volume_level * 100) : null };
    for (const k of [...ACS, ...SPLITS]) { const s = this._st(k), a = (s && s.attributes) || {};
      S.ac[k] = { t: a.temperature != null ? Math.round(a.temperature) : '--', hvac: s ? s.state : 'unavailable', mode: HVAC_PT[s && s.state] || 'Frio', amb: a.current_temperature,
        min: a.min_temp || 16, max: a.max_temp || 31, modes: a.hvac_modes || null,
        fan: a.fan_mode != null ? String(a.fan_mode) : null, fans: Array.isArray(a.fan_modes) && a.fan_modes.length ? a.fan_modes.map(String) : FAN_DEF,
        swing: a.swing_mode != null ? String(a.swing_mode) : null, swings: Array.isArray(a.swing_modes) && a.swing_modes.length ? a.swing_modes.map(String) : SWING_DEF }; }
    const pr = this._st('presenca'); S.pres = pr ? pr.state === 'on' : null;
    const tp = this._st('temperatura'); S.temp = tp && !isNaN(+tp.state) ? Math.round(+tp.state * 10) / 10 : null;
    const po = this._st('porta'); S.porta = po ? po.state === 'on' : null;
    const sun = this._st('sun'), c = this._config || {};
    S.night = c.luz_3d === 'noite' ? true : c.luz_3d === 'dia' ? false : sun ? sun.state !== 'above_horizon' : true;
    S.person = (this._hass.user && this._hass.user.name) || '';
    const wid = this._ent.weather || Object.keys(this._hass.states).find((x) => x.startsWith('weather.'));
    const w = wid && this._hass.states[wid]; S.out = w && w.attributes.temperature != null ? Math.round(w.attributes.temperature) : null;
    // comando otimista: vale até o HA confirmar (ou 4 s)
    const now = Date.now();
    for (const [k, p] of Object.entries(this._pend)) { if (now - p.t > 4000 || S.on[k] === p.v) delete this._pend[k]; else S.on[k] = p.v; }
    // A/C do Templo com splits: ligado se qualquer split estiver ligado; a temperatura vem da entidade geral ou do 1º split
    S.splits = this._splits();
    if (S.splits.length) { S.on.ac_templo = S.on.ac_templo || S.splits.some((k) => S.on[k]); S.na.ac_templo = S.na.ac_templo && S.splits.every((k) => S.na[k]);
      if (S.ac.ac_templo.t === '--') { const f = S.splits.map((k) => S.ac[k]).find((a) => a.t !== '--'); if (f) Object.assign(S.ac.ac_templo, { t: f.t, min: f.min, max: f.max, modes: f.modes, amb: f.amb }); }
      if (!this._st('ac_templo')) { const f = S.splits.find((k) => S.on[k]) || S.splits[0], A = S.ac[f]; if (S.on[f]) S.ac.ac_templo.mode = A.mode;
        Object.assign(S.ac.ac_templo, { fan: A.fan, fans: A.fans, swing: A.swing, swings: A.swings }); } }
    // velocidade e aleta escolhidas: valem até o HA confirmar (ou 4 s)
    for (const [k, o] of Object.entries(this._optA || {})) { const a = S.ac[k]; if (!a) continue;
      for (const f of ['fan', 'swing']) if (o[f] != null) { if (now - o[f + 'T'] > 4000 || a[f] === o[f]) delete o[f]; else a[f] = o[f]; } }
    this.S = S;
  }
  _splits() { return SPLITS.filter((k) => this._ent[k]); }
  // entidades que um comando de A/C atinge: o A/C do Templo com splits vale para todos eles (e a entidade geral, se existir)
  _acKeys(k) { if (k !== 'ac_templo') return [k]; const sp = this._splits(); return sp.length ? [...sp, ...(this._st('ac_templo') ? ['ac_templo'] : [])] : [k]; }
  _acIds(k) { const ids = this._acKeys(k).map((x) => this._ent[x]).filter(Boolean); return ids.length === 1 ? ids[0] : ids; }
  _preset(a) {
    if (a.color_mode === 'color_temp' || (!a.rgb_color && a.color_temp_kelvin)) return (a.color_temp_kelvin || 2700) < 3600 ? 'Quente' : 'Branco';
    const rgb = a.rgb_color; if (!rgb) return 'Quente';
    const [r, g, b] = rgb.map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < .12) return 'Branco';
    let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); h = (h * 60 + 360) % 360;
    const opts = [['Vermelho', 0], ['Quente', 30], ['Verde', 140], ['Azul', 220], ['Roxo', 270], ['Vermelho', 360]];
    return opts.reduce((best, o) => Math.abs(o[1] - h) < Math.abs(best[1] - h) ? o : best)[0];
  }

  // ---------- construção ----------
  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `<style>${CSS}</style><svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${ICONS}</defs></svg>${HTML}`;
    this.$('scenes').innerHTML = SCENES.map((s) => `<button type="button" class="scene" data-s="${s.id}" aria-label="Cena ${esc(s.n)}"><div class="pv"><div class="bd">${svg(s.icon)}</div></div><div class="tx"><b>${esc(s.n)}</b><span>${esc(s.d)}</span></div></button>`).join('');
    this.$('tabs').innerHTML = BLOCKS.map((b) => `<button type="button" class="tab" data-b="${b.id}">${esc(b.n)}</button>`).join('');
    this.$('ares').innerHTML = ACS.map((k) => `<div class="card clim${k === 'ac_templo' ? ' tplac' : ''}" data-ac="${k}"></div>`).join('');
    this._applyConfig();
    this._bind();
    requestAnimationFrame(() => { this._init3D(); this._render(); });
  }
  _applyConfig() {
    const c = this._config || {};
    if (c.height) this.style.setProperty('--igp-h', c.height); else this.style.removeProperty('--igp-h');
    this.$('nav-alexa').hidden = !c.alexa_device;
    this.$('uname').textContent = c.title || 'Base Church';
  }
  _fit() {
    const app = this.$('app'); if (!app) return;
    const W = this.clientWidth, H = this.clientHeight; if (!W || !H) return;
    const s = Math.min(W / 1280, H / 800);   // escala pelo lado limitante e o layout estica no outro (ocupa a área toda, sem tarjas)
    app.style.width = (W / s) + 'px'; app.style.height = (H / s) + 'px';
    app.style.transform = `scale(${s})`; this._p3resize();
  }

  // ---------- vistas 3D ----------
  _init3D() {
    const c = this._config || {};
    if (this._p3try) return; this._p3try = true;
    const flat = () => { this._mod = {}; this._p3 = FlatEngine.shared(); this._p3setup(); };
    if (c.vista_3d === false) { flat(); return; }
    import(P3_URL).then((mod) => { const E = mod.IgrejaPainel3D.shared({ night_vision: c.night_vision !== false, quality: c.quality || 'auto' });
      return E.ready().then(() => { this._mod = mod; this._p3 = E; this._p3setup(); }); })
      .catch((e) => { console.warn('igreja-painel-card: motor 3D indisponível, fica a planta 2D', e); flat(); });
  }
  _frame(sel) {   // 'b:id' (bloco) | 'r:id' (cômodo) | 'plan'
    const m = this._mod || {}, [t, id] = sel.split(':');
    if (t === 'plan') return (m.PLAN3D || PLAN_F).slice();
    if (t === 'b') return (m.BLOCKS3D && m.BLOCKS3D[id] || frameOf(BK[id].box)).slice();
    return (m.ROOMS3D && m.ROOMS3D[id] || frameOf(RM[id].box)).slice();
  }
  _p3canvas(pv) { pv.querySelectorAll('canvas.p3').forEach((c) => c.remove()); const cv = document.createElement('canvas'); cv.className = 'p3'; pv.prepend(cv); return cv; }
  _p3setup() {
    const E = this._p3, st = () => this._p3state();
    const mk = (id, o) => { const v = E.view(this._p3canvas(this.$(id)), Object.assign({ state: st }, o)); return v; };
    const act = (v) => (px, py, hit) => this._p3hit(v, px, py, hit);
    this._p3room = mk('room-pv', { interactive: true, safe: { l: 14, t: 76, r: 200, b: 52 } });
    this._p3room.onClick = act(this._p3room);
    this._p3plan = mk('plan-pv', { interactive: true, labels: false, safe: { l: 6, t: 6, r: 6, b: 6 }, home: this._frame('plan').slice(4) });
    this._p3plan.onClick = (px, py, hit) => this._p3hit(this._p3plan, px, py, hit, true);
    this._p3plan.onCam = () => { this._p3pins(); this.$('zoom-t').textContent = Math.round((this._p3plan.zoom || 1) * 100) + '%'; };
    this._p3amb = mk('amb-pv', { interactive: true, safe: { l: 14, t: 76, r: 14, b: 14 } });
    this._p3amb.onClick = act(this._p3amb);
    this._p3tpl = mk('tpl-pv', { interactive: true, safe: { l: 14, t: 70, r: 14, b: 10 } });
    this._p3tpl.onClick = act(this._p3tpl);
    this._p3thumbs = SCENES.map((s, i) => { const pv = this.$('scenes').children[i].querySelector('.pv');
      const v = E.view(this._p3canvas(pv), { safe: { l: 2, t: 2, r: 2, b: 2 }, res: 1.5, labels: false, state: () => this._p3state(s.id) }); v.frame(...s.f); return v; });
    this._p3plan.frame(...this._frame('plan'));
    this._p3tpl.frame(...this._frame('r:templo'));
    // pinos da planta: rótulos dos blocos e uma bolinha por luminária
    const pp = this.$('plan-pv'); pp.querySelectorAll('.pin').forEach((p) => p.remove()); this._planDots = [];
    BLOCKS.forEach((b) => { const p = document.createElement('div'); p.className = 'pin'; p.innerHTML = `<div class="rl">${esc(b.n)}</div>`; p._w = [b.lp[0], 0.25, b.lp[1]]; pp.appendChild(p); });
    LIGHTS.forEach((l) => (E.points(l) || []).forEach((w) => { const p = document.createElement('div'); p.className = 'pin'; p.dataset.l = l; p._w = w; pp.appendChild(p); this._planDots.push(p); }));
    this._placeSel(); this._placeAmb(); this._p3pins(); this._render();
  }
  _p3state(sid) {
    const S = this.S || { on: {}, ac: {} };
    const on = sid ? Object.fromEntries(TOG.map((k) => [k, SCENE_ON[sid].includes(k)])) : S.on;
    const rgb = sid === 'ensaio' ? [40, 110, 255] : sid === 'limpeza' ? [255, 244, 229] : sid ? [255, 180, 110] : S.palcoRgb;
    return {
      lights: Object.fromEntries(LIGHTS.map((l) => [l, !!on[l]])),
      palco: { on: !!on.palco, rgb: rgb || [255, 180, 110], bri: sid ? (sid === 'ensaio' ? 70 : 100) : S.palcoBri || 100 },
      plateia: { on: !!on.plateia, bri: sid ? ({ culto: 60, ensaio: 25 }[sid] || 100) : S.plateiaBri || 100 },
      telao: { on: !!on.telao, title: sid ? '' : (S.telao && S.telao.title) || '' },
      som: !!on.som,
      ac: Object.fromEntries([...ACS, ...this._splits()].map((k) => [k, { on: sid && SPLITS.includes(k) ? !!on.ac_templo : !!on[k], mode: sid ? 'cool' : (S.ac[k] ? S.ac[k].hvac : null), fan: S.ac[k] ? S.ac[k].fan : null, swing: S.ac[k] ? S.ac[k].swing : null }])),
      porta: sid ? sid === 'chegada' : !!S.porta,
      night: sid ? true : S.night !== false,
    };
  }
  // toque numa vista: aparelho liga/desliga (opção toque: false desliga), cômodo seleciona
  _p3hit(v, px, py, hit, planOnly) {
    if (hit === undefined && v.pickAt) hit = v.pickAt(px, py);
    if (!hit && v.pick && this._p3.roomAt) { const g = v.pick(px, py); const r = g && this._p3.roomAt(g[0], g[1]); if (r) hit = { kind: 'room', room: r }; }
    if (!hit) return;
    const c = this._config || {};
    if (hit.key && SPLITS.includes(hit.key) && !this._ent[hit.key]) hit = Object.assign({}, hit, { key: 'ac_templo' });   // split sem entidade: vale o A/C do Templo
    if (!planOnly && hit.kind !== 'room' && hit.key && TOG.includes(hit.key) && c.toque !== false) { this._toggle(hit.key); return; }
    if (hit.room && RM[hit.room]) this._select('r:' + hit.room, true);
  }
  _select(sel, toast) {
    const [t, id] = sel.split(':');
    if (t === 'r') this._asel = id;
    if (this._nav === 'rooms') { this._placeAmb(); this._render(); if (toast) this._toast(RM[id].n); return; }
    this._sel = sel; this._placeSel(); this._render(); if (toast) this._toast(t === 'r' ? RM[id].n : BK[id].n);
  }
  _cutOk() { return (this._config || {}).corte_comodo !== false; }
  _placeSel() { const v = this._p3room; if (!v) return; const f = this._frame(this._sel); if (v.o) v.o.home = f.slice(4); v.frame(...f);
    if (v.cut) v.cut(this._sel.startsWith('r:') && this._cutOk() ? this._sel.slice(2) : null); }
  _placeAmb() { const v = this._p3amb; if (!v) return; const f = this._frame('r:' + this._asel); f[5] = Math.max(f[5], 68); if (v.o) v.o.home = f.slice(4); v.frame(...f);
    if (v.cut) v.cut(this._cutOk() ? this._asel : null); }
  _p3pins() { const v = this._p3plan; if (!v) return;
    this.$('plan-pv').querySelectorAll('.pin').forEach((p) => { if (!p._w) return; const [a, b] = v.project(p._w); p.style.left = a + 'px'; p.style.top = b + 'px'; }); }
  _views() { return [this._p3room, this._p3plan, this._p3amb, this._p3tpl, ...(this._p3thumbs || [])].filter(Boolean); }
  _p3paint() { const vis = { home: [this._p3room, this._p3plan, ...(this._p3thumbs || [])], rooms: [this._p3amb], templo: [this._p3tpl] }[this._nav] || [];
    vis.forEach((v) => v && v.render && v.render()); }
  _p3resize() { if (!this._p3) return; this._views().forEach((v) => v.render && v.render()); this._p3pins(); }

  // ---------- comandos ----------
  _call(domain, service, data) { if (!this._hass) return Promise.resolve(); return Promise.resolve(this._hass.callService(domain, service, data)).catch((e) => this._toast(`Falhou: ${(e && e.message) || e}`)); }
  _pendKey(k, v) { const id = this._ent[k]; for (const [k2, i2] of Object.entries(this._ent)) if (i2 === id && TOG.includes(k2)) this._pend[k2] = { v, t: Date.now() }; }   // chaves no mesmo circuito andam juntas
  _set(k, v, extra) {
    const id = this._ent[k]; if (!id) return; const d = id.split('.')[0]; this._pendKey(k, v);
    const dom = ['light', 'switch', 'fan', 'input_boolean', 'climate', 'media_player'].includes(d) ? d : 'homeassistant';
    return this._call(dom, v ? 'turn_on' : 'turn_off', Object.assign({ entity_id: id }, v ? extra || {} : {}));
  }
  _dev(k) {
    const S = this.S, st = this._st(k), na = !st || st.state === 'unavailable';
    if (SENS.includes(k)) {
      const v = k === 'presenca' ? (S.pres == null ? '—' : S.pres ? 'Ocupado' : 'Vazio') : k === 'temperatura' ? (S.temp == null ? '—' : `${S.temp} °C`) : (S.porta == null ? '—' : S.porta ? 'Aberta' : 'Fechada');
      return { n: NAMES[k], icon: k === 'temperatura' ? 'therm' : k === 'porta' ? 'door' : 'radar', st: na ? 'Indisponível' : v, ro: true, on: k === 'presenca' ? !!S.pres : k === 'porta' ? !!S.porta : false, na };
    }
    const on = !!S.on[k]; let icon = 'bulb', txt = on ? 'Acesa' : 'Apagada', more = '';
    if (k === 'palco') { icon = 'spot'; txt = on ? `${S.palcoColor} · ${S.palcoBri}%` : 'Apagado'; more = 'Cor e brilho'; }
    else if (k === 'plateia') { txt = on ? `Acesa · ${S.plateiaBri}%` : 'Apagada'; more = 'Brilho'; }
    else if (k === 'telao') { icon = 'tv'; txt = on ? (S.telao.title || 'Ligado') : 'Desligado'; more = 'Controlar'; }
    else if (k === 'som') { icon = 'speaker'; txt = on ? 'Ligado' : 'Desligado'; }
    else if (ACS.includes(k) || SPLITS.includes(k)) { const a = S.ac[k], sp = k === 'ac_templo' ? S.splits : [], n = sp.filter((x) => S.on[x]).length; icon = 'snow';
      txt = on ? (sp.length ? `${n} de ${sp.length} splits · ${a.t} °C` : `${a.t} °C · ${a.mode}`) : 'Desligado'; more = sp.length ? 'Splits, temperatura e modo' : 'Temperatura e modo'; }
    else if (k === 'fachada') txt = on ? 'Letreiro + arandelas' : 'Apagada';
    else if (k === 'estacionamento') txt = on ? 'Postes acesos' : 'Apagado';
    return { n: NAMES[k], icon, st: na ? 'Indisponível' : txt, more, on: on && !na, na };
  }
  _toggle(k) {
    if (k === 'ac_templo' && this.S.splits.length) { this._acAll(!this.S.on.ac_templo); return; }
    if (!TOG.includes(k)) return; const was = !!this.S.on[k]; this._scene = null;
    this._set(k, !was); this._derive(); this._render(); this._toast(`${NAMES[k]}: ${this._dev(k).st}`);
  }
  // A/C do Templo: Ligar todos / Desligar todos (os splits de uma vez, numa chamada só)
  _acAll(v) {
    const keys = this._acKeys('ac_templo'); keys.forEach((k) => this._pendKey(k, v)); this._scene = null;
    this._call('climate', v ? 'turn_on' : 'turn_off', { entity_id: this._acIds('ac_templo') });
    this._derive(); this._render(); this._toast(`A/C do Templo: ${keys.length > 1 ? (v ? 'todos ligados' : 'todos desligados') : (v ? 'ligado' : 'desligado')}`);
  }
  _setMany(keys, v) { keys.filter((k) => TOG.includes(k)).forEach((k) => this._set(k, v)); }
  _block(b, v) {   // "Tudo" do bloco: liga só as luzes; desliga luzes, A/C, telão e som
    const items = blockItems(b).filter((k) => TOG.includes(k)); this._scene = null;
    this._setMany(v ? items.filter((k) => LIGHTS.includes(k)) : items, v); this._derive(); this._render();
    this._toast(`${BK[b].n}: ${v ? 'luzes acesas' : 'tudo desligado'}`);
  }
  _runScene(id) {
    const on = (k, x) => this._set(k, true, x), off = (k) => this._set(k, false);
    const acCool = (k) => { this._acKeys(k).forEach((x) => this._pendKey(x, true)); this._call('climate', 'set_hvac_mode', { entity_id: this._acIds(k), hvac_mode: 'cool' }); };
    if (id === 'culto') { on('palco', { rgb_color: [255, 180, 110], brightness_pct: 90 }); on('plateia', { brightness_pct: 60 }); on('telao'); on('som'); acCool('ac_templo');
      ['hall', 'banheiros'].forEach((k) => on(k)); if (this.S.night) ['fachada', 'estacionamento'].forEach((k) => on(k)); }
    if (id === 'ensaio') { on('palco', { rgb_color: [40, 110, 255], brightness_pct: 70 }); on('plateia', { brightness_pct: 25 }); on('telao'); on('som'); acCool('ac_templo'); }
    if (id === 'chegada') ['hall', 'fachada', 'estacionamento', 'banheiros'].forEach((k) => on(k));
    if (id === 'limpeza') { LIGHTS.forEach((k) => on(k, k === 'palco' ? { color_temp_kelvin: 5000, brightness_pct: 100 } : k === 'plateia' ? { brightness_pct: 100 } : null)); off('som'); off('telao'); }
    if (id === 'fechar') TOG.forEach(off);
    this._scene = id; this._derive(); this._render();
    this._toast(`Cena “${SCENES.find((s) => s.id === id).n}” executada`);
  }
  _acTemp(k, d) {
    const a = this.S.ac[k]; if (!a || a.t === '--') return; const cur = this._local[k] != null ? this._local[k] : a.t;
    const t = Math.max(a.min, Math.min(a.max, cur + d)), keys = this._acKeys(k); keys.forEach((x) => { this._local[x] = t; }); this._local[k] = t; this._scene = null; this._render();
    clearTimeout(this._acT && this._acT[k]); this._acT = this._acT || {};
    this._acT[k] = setTimeout(() => { this._call('climate', 'set_temperature', { entity_id: this._acIds(k), temperature: t }); setTimeout(() => { [k, ...keys].forEach((x) => delete this._local[x]); }, 3000); }, 600);
  }
  _acMode(k, m) {
    const M = MODES.find((x) => x[0] === m); const modes = this.S.ac[k] && this.S.ac[k].modes;
    let hv = M[2]; if (hv === 'heat_cool' && modes && !modes.includes('heat_cool') && modes.includes('auto')) hv = 'auto';
    this._acKeys(k).forEach((x) => this._pendKey(x, true)); this._scene = null; this._call('climate', 'set_hvac_mode', { entity_id: this._acIds(k), hvac_mode: hv });
    this._toast(`${SPLITS.includes(k) ? 'A/C do Templo · ' : ''}${NAMES[k]}${k === 'ac_templo' && this.S.splits.length ? ' (todos)' : ''}: ${m}`);
  }
  _acOpt(k, f, v) { this._optA = this._optA || {}; for (const x of [k, ...this._acKeys(k)]) { const o = this._optA[x] || (this._optA[x] = {}); o[f] = v; o[f + 'T'] = Date.now(); } }
  _acFan(k, v) { this._acOpt(k, 'fan', v); this._scene = null; this._call('climate', 'set_fan_mode', { entity_id: this._acIds(k), fan_mode: v });
    this._derive(); this._render(); this._toast(`${this._acLabel(k)}: velocidade ${ptOf(FAN_PT, v)}`); }
  _acSwing(k, v) { this._acOpt(k, 'swing', v); this._scene = null; this._call('climate', 'set_swing_mode', { entity_id: this._acIds(k), swing_mode: v });
    this._derive(); this._render(); this._toast(`${this._acLabel(k)}: aleta ${ptOf(SWING_PT, v)}`); }
  _acLabel(k) { return SPLITS.includes(k) ? `A/C do Templo · ${NAMES[k]}` : NAMES[k] + (k === 'ac_templo' && this.S.splits.length ? ' (todos)' : ''); }
  _palcoColor(n) {
    const p = PRESETS.find((x) => x[0] === n), data = { entity_id: this._ent.palco };
    if (p[2] && n !== 'Quente') data.rgb_color = p[2]; else data.color_temp_kelvin = p[3];
    this._pendKey('palco', true); this._scene = null; this._call('light', 'turn_on', data); this._toast(`Palco: ${n}`);
  }
  _bri(k, v) { this._pendKey(k, true); this._scene = null; this._call('light', 'turn_on', { entity_id: this._ent[k], brightness_pct: +v }); }

  // ---------- render ----------
  _render() {
    if (!this._built || !this.S) return;
    const S = this.S, $ = (i) => this.$(i);
    const lit = LIGHTS.filter((l) => S.on[l]), acs = ACS.filter((k) => S.on[k]);
    const units = acs.reduce((n, k) => n + (k === 'ac_templo' && S.splits.length ? S.splits.filter((x) => S.on[x]).length || 1 : 1), 0);   // cada split conta como uma unidade
    if (S.person) { $('usub').textContent = S.person; $('ava').textContent = S.person[0].toUpperCase(); }
    $('nav-ac').textContent = units;
    // resumo
    $('st-p1').textContent = S.pres == null ? 'Templo' : S.pres ? 'Templo ocupado' : 'Templo vazio';
    $('st-p2').textContent = `Presença${S.temp != null ? ` · ${S.temp} °C` : ''}`; $('st-p-ic').classList.toggle('off', !S.pres);
    $('st-l').textContent = `${lit.length} ${lit.length === 1 ? 'luz acesa' : 'luzes acesas'}`;
    $('st-l2').textContent = `de ${LIGHTS.length}` + (lit.length ? ' · ' + lit.map((l) => NAMES[l]).join(', ') : ' · tudo apagado'); $('st-l-ic').classList.toggle('off', !lit.length);
    $('st-ac').textContent = units ? `${units} A/C ${units === 1 ? 'ligado' : 'ligados'}` : 'A/C desligados';
    $('st-ac2').textContent = acs.length ? acs.map((k) => `${AC_SHORT[k]} ${k === 'ac_templo' && S.splits.length ? S.splits.filter((x) => S.on[x]).length + '/' + S.splits.length : S.ac[k].t + '°'}`).join(' · ') : 'Templo, Pastoral, Mídia, Voluntariado'; $('st-ac-ic').classList.toggle('off', !acs.length);
    const culto = S.on.telao || S.on.som;
    $('st-c').textContent = culto ? 'Culto no ar' : 'Telão e som'; $('st-c2').textContent = `Telão ${S.on.telao ? (S.telao.title || 'ligado') : 'desligado'} · Som ${S.on.som ? 'ligado' : 'desligado'}`;
    $('st-c-ic').classList.toggle('off', !culto);
    $('pres-t').textContent = S.pres == null ? 'Presença —' : S.pres ? 'Templo ocupado' : 'Templo vazio';
    $('porta-t').textContent = S.porta == null ? '—' : S.porta ? 'aberta' : 'fechada';
    $('lg-on').textContent = `${lit.length} ${lit.length === 1 ? 'luz acesa' : 'luzes acesas'}`;
    $('lg-off').textContent = `${LIGHTS.length - lit.length} apagada${LIGHTS.length - lit.length === 1 ? '' : 's'}`;
    const bits = []; if (S.on.palco) bits.push('o palco está aceso'); if (S.on.telao) bits.push('o telão está ligado'); if (units) bits.push(S.on.ac_templo && S.splits.length ? `A/C do Templo ${S.splits.filter((x) => S.on[x]).length}/${S.splits.length} ligados` + (units > S.splits.filter((x) => S.on[x]).length ? ` (${units} A/C no total)` : '') : units === 1 ? 'um A/C está ligado' : `${units} A/C estão ligados`);
    $('mood').textContent = bits.length ? bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' : (lit.length ? 'Algumas luzes acesas.' : 'Igreja fechada, tudo apagado.');
    $('wx').textContent = `Palmas (TO)${S.out != null ? ` · ${S.out} °C lá fora` : ''}`;
    // cenas
    [...$('scenes').children].forEach((b) => { const on = b.dataset.s === this._scene; b.classList.toggle('on', on); b.querySelector('.tx span').textContent = on ? 'Ativa agora' : SCENES.find((s) => s.id === b.dataset.s).d; });
    // bloco/cômodo selecionado
    const [t, id] = this._sel.split(':'), items = t === 'b' ? blockItems(id) : RM[id].items;
    $('room-k').textContent = t === 'b' ? 'BLOCO SELECIONADO' : `CÔMODO · ${BK[RM[id].b].n.toUpperCase()}`;
    $('room-name').textContent = t === 'b' ? BK[id].n : RM[id].n;
    $('room-sub').textContent = this._sub(items);
    [...$('tabs').children].forEach((x) => x.classList.toggle('on', t === 'b' ? x.dataset.b === id : x.dataset.b === RM[id].b));
    $('ctrls').innerHTML = items.length ? items.map((k) => this._gl(k)).join('') : '<div class="empty">Este cômodo não tem aparelhos ligados ao Home Assistant.</div>';
    // blocos
    $('blist').innerHTML = BLOCKS.map((b) => { const it = blockItems(b.id).filter((k) => TOG.includes(k)), n = it.filter((k) => S.on[k]).length;
      return `<div class="brow ${n ? 'on' : ''} ${t === 'b' && id === b.id ? 'sel' : ''}" data-bsel="${b.id}" role="button" tabindex="0"><div class="ic ${n ? '' : 'off'}">${svg(b.icon)}</div><div><b>${esc(b.n)}</b><span>${n} de ${it.length} ligados</span></div><button type="button" class="tg ${n ? 'on' : ''}" data-blk="${b.id}" aria-label="Tudo do bloco ${esc(b.n)}"></button></div>`; }).join('');
    (this._planDots || []).forEach((p) => { p.innerHTML = S.on[p.dataset.l] ? '<div class="mdot"></div>' : '<div class="odot"></div>'; });
    if (this._nav === 'rooms') this._renderAmb();
    if (this._nav === 'templo') this._renderTpl();
    if (this._nav === 'ares') ACS.forEach((k) => this._renderAc(this.shadowRoot.querySelector(`[data-ac="${k}"]`), k, true));
    if (this._nav === 'alexa') this._renderAlexa();
    const ids = new Set(Object.values(this._ent).filter(Boolean)); let ok = 0; ids.forEach((i) => { const s = this._hass.states[i]; if (s && s.state !== 'unavailable') ok++; });
    $('ndev').textContent = ok;
    if (this._modal) this._drawModal();
    this._p3paint(); this._clock();
  }
  _sub(items) { const L = items.filter((k) => LIGHTS.includes(k)), n = L.filter((k) => this.S.on[k]).length, o = items.filter((k) => TOG.includes(k) && !LIGHTS.includes(k) && this.S.on[k]);
    const s = L.length ? `${n} de ${L.length} ${L.length === 1 ? 'luz acesa' : 'luzes acesas'}` : 'Sem luzes ligadas ao HA';
    return (this._scene ? `Cena “${SCENES.find((x) => x.id === this._scene).n}” · ` : '') + s + (o.length ? ` · ${o.map((k) => NAMES[k]).join(', ')}` : ''); }
  _gl(k) { const d = this._dev(k);
    if (d.ro) return `<div class="gl ro ${d.on ? 'on' : ''} ${d.na ? 'na' : ''}"><div class="r">${svg(d.icon)}<span class="val">${esc(d.st)}</span></div><b>${esc(d.n)}</b><span>Sensor · só leitura</span></div>`;
    return `<div class="gl ${d.on ? 'on' : ''} ${d.na ? 'na' : ''}" data-k="${k}" ${d.more ? 'role="button" tabindex="0"' : ''}><div class="r">${svg(d.icon)}<button type="button" class="tg ${d.on ? 'on' : ''}" data-t="${k}" aria-label="Ligar ou desligar ${esc(d.n)}"></button></div><b>${esc(d.n)}</b><span>${esc(d.st)}</span>${d.more ? `<div class="more">${d.more} ›</div>` : ''}</div>`; }
  _renderAmb() {
    const S = this.S, r = RM[this._asel];
    this.$('amb-k').textContent = BK[r.b].n.toUpperCase(); this.$('amb-name').textContent = r.n; this.$('amb-sub').textContent = this._sub(r.items);
    this.$('alist').innerHTML = BLOCKS.map((b) => { const it = blockItems(b.id).filter((k) => TOG.includes(k)), n = it.filter((k) => S.on[k]).length;
      return `<div class="agrp"><span>${esc(b.n.toUpperCase())} · ${n} de ${it.length}</span><button type="button" class="tg ${n ? 'on' : ''}" data-blk="${b.id}" aria-label="Tudo do bloco ${esc(b.n)}"></button></div>` +
        b.rooms.map((rid) => { const x = RM[rid], L = x.items.filter((k) => LIGHTS.includes(k)), on = L.filter((k) => S.on[k]).length;
          return `<div class="arow ${rid === this._asel ? 'sel' : ''}" data-rsel="${rid}"><div class="h"><b>${esc(x.n)}</b><span>${L.length ? `${on} de ${L.length} acesas` : '—'}</span></div><div class="devs">${x.items.map((k) => { const d = this._dev(k);
            return d.ro ? `<span class="dv ro ${d.on ? 'on' : ''}">${svg(d.icon)}${esc(d.n)} · ${esc(d.st)}</span>` : `<button type="button" class="dv ${d.on ? 'on' : ''} ${d.na ? 'na' : ''}" data-t="${k}">${svg(d.icon)}${esc(d.n)}</button>`; }).join('')}</div></div>`; }).join(''); }).join('');
    const sel = this.$('alist').querySelector('.arow.sel'); if (sel && this._ambScroll) { sel.scrollIntoView({ block: 'nearest' }); this._ambScroll = false; }
  }
  _renderTpl() {
    const S = this.S, $ = (i) => this.$(i);
    $('tpl-sub').textContent = `${S.pres == null ? '' : S.pres ? 'Ocupado · ' : 'Vazio · '}${S.temp != null ? S.temp + ' °C · ' : ''}${this._sub(RM.templo.items)}`;
    const keep = (el) => el.contains(this.shadowRoot.activeElement) && this.shadowRoot.activeElement.type === 'range';   // não redesenha embaixo do dedo
    const pa = $('c-palco'); if (!keep(pa)) pa.innerHTML = `<div class="top2"><div><b>Palco</b><span>Moving heads RGB · ${esc(this._dev('palco').st)}</span></div><button type="button" class="tg ${S.on.palco ? 'on' : ''}" data-t="palco" aria-label="Ligar ou desligar o palco"></button></div>
      <div class="sw">${PRESETS.map(([n, c]) => `<button type="button" class="swb ${S.on.palco && S.palcoColor === n ? 'on' : ''}" data-c="${n}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>
      <div class="rowl"><span>Brilho</span><b class="bri-t">${S.palcoBri}%</b></div><input class="rng" data-bri="palco" type="range" min="5" max="100" value="${S.palcoBri}" aria-label="Brilho do palco">`;
    const pl = $('c-plateia'); if (!keep(pl)) pl.innerHTML = `<div class="top2"><div><b>Plateia</b><span>${esc(this._dev('plateia').st)}</span></div><button type="button" class="tg ${S.on.plateia ? 'on' : ''}" data-t="plateia" aria-label="Ligar ou desligar a plateia"></button></div>
      <div class="big">${S.on.plateia ? S.plateiaBri : 0}<small>%</small></div><div class="rowl"><span>Brilho</span><b class="bri-t">${S.plateiaBri}%</b></div><input class="rng" data-bri="plateia" type="range" min="5" max="100" value="${S.plateiaBri}" aria-label="Brilho da plateia">`;
    const tv = $('c-telao'), T = S.telao, play = T.state === 'playing'; if (!keep(tv)) tv.innerHTML = `<div class="top2"><div><b>Telão</b><span>${S.na.telao ? 'Indisponível' : !S.on.telao ? 'Desligado' : ({ playing: 'Tocando', paused: 'Pausado' })[T.state] || 'Ligado'}</span></div><button type="button" class="tg ${S.on.telao ? 'on' : ''}" data-t="telao" aria-label="Ligar ou desligar o telão"></button></div>
      <div class="sub2">${esc(S.on.telao ? [T.title, T.artist].filter(Boolean).join(' · ') || 'Sem título' : 'Telão LED desligado')}</div>
      <div class="ctl"><button type="button" data-mp="media_previous_track" aria-label="Anterior" ${S.on.telao ? '' : 'disabled'}>${svg('prev')}</button><button type="button" class="pp" data-mp="media_play_pause" aria-label="Tocar ou pausar" ${S.on.telao ? '' : 'disabled'}>${svg(play ? 'pause' : 'play')}</button><button type="button" data-mp="media_next_track" aria-label="Próxima" ${S.on.telao ? '' : 'disabled'}>${svg('next')}</button></div>`;
    $('c-som').innerHTML = `<div class="top2"><div><b>Som</b><span>Mesa e caixas do templo</span></div><button type="button" class="tg ${S.on.som ? 'on' : ''}" data-t="som" aria-label="Ligar ou desligar o som"></button></div>
      <div class="big">${S.on.som ? 'Ligado' : 'Desligado'}</div><div class="sub2">Presença: ${S.pres == null ? '—' : S.pres ? 'ocupado' : 'vazio'}</div><div class="sub2">Temperatura: ${S.temp == null ? '—' : S.temp + ' °C'}</div>`;
    this._renderAc($('c-actpl'), 'ac_templo', false, true);
  }
  // botão ⏻ (mostra o estado) e botões com seletor: Modo, Velocidade e Aleta
  _pw(k, on, n) { return `<button type="button" class="pw ${on ? 'on' : ''}" data-t="${k}" aria-pressed="${on}" aria-label="${on ? 'Desligar' : 'Ligar'} ${esc(n)}" title="${on ? 'Ligado — tocar para desligar' : 'Desligado — tocar para ligar'}">${svg('power')}</button>`; }
  _xb(kind, k, row) {
    const a = this.S.ac[k], on = !!this.S.on[k], n = this._acLabel(k);
    if (kind === 'mode') { const M = MODES.find((x) => x[0] === a.mode) || MODES[0];
      return `<button type="button" class="xb ${on ? 'on' : ''}" data-pop="mode" data-pk="${k}" aria-haspopup="listbox" aria-label="${esc(n)}: modo ${M[0]}" title="Modo: ${M[0]}">${svg(M[1])}<span>${M[0]}</span></button>`; }
    const fan = kind === 'fan', v = fan ? ptOf(FAN_PT, a.fan) : ptOf(SWING_PT, a.swing), lab = fan ? 'Velocidade' : 'Aleta';
    return `<button type="button" class="xb ${on ? 'on' : ''}" data-pop="${kind}" data-pk="${k}" aria-haspopup="listbox" aria-label="${esc(n)}: ${lab} ${v}" title="${lab}: ${v}">${svg(fan ? 'fan' : 'swing')}${row ? '' : `<small>${lab}</small>`}<span>${v}</span></button>`;
  }
  _acRow(k, label, all) {
    const S = this.S, a = S.ac[k], on = !!S.on[k], na = S.na[k], t = this._local[k] != null ? this._local[k] : a.t;
    return `<div class="spl ${on ? 'on' : ''} ${na ? 'na' : ''} ${all ? 'all' : ''}" data-split="${k}">${this._pw(k, on, all ? 'todos os splits' : label)}
      <div class="sn"><b>${esc(label)}</b><span>${na ? 'Indisponível' : all ? `${S.splits.filter((x) => S.on[x]).length} de ${S.splits.length} ligados` : on ? 'Ligado' : 'Desligado'}</span></div>
      <div class="st"><button type="button" class="rb s" data-tmp="${k}" data-d="-1" aria-label="${esc(label)}: diminuir temperatura">${svg('minus')}</button><b>${t}°</b><button type="button" class="rb s" data-tmp="${k}" data-d="1" aria-label="${esc(label)}: aumentar temperatura">${svg('plus')}</button></div>
      ${this._xb('mode', k, true)}${this._xb('fan', k, true)}${this._xb('swing', k, true)}</div>`;
  }
  _renderAc(el, k, big, tpl) {
    if (!el) return; const S = this.S, a = S.ac[k], on = !!S.on[k], na = S.na[k], t = this._local[k] != null ? this._local[k] : a.t;
    const amb = a.amb != null ? `ambiente ${Math.round(a.amb)} °C` : AC_ROOM[k], sp = k === 'ac_templo' ? S.splits : [];
    if (el.contains(this.shadowRoot.activeElement) && this._popK) return;   // não redesenha com o seletor aberto
    el.classList.toggle('off', !on); el.classList.toggle('na', na);
    const head = `<div class="top2"><div><b>${esc(NAMES[k])}</b><span>${esc(big ? AC_ROOM[k] : 'Climatização · ' + AC_ROOM[k])}${na ? ' · indisponível' : ''}</span></div>${this._pw(k, on, NAMES[k])}</div>`;
    if (tpl && sp.length) { el.innerHTML = head + `<div class="spls">${this._acRow(k, 'Todos', true)}</div>` + this._splitsHtml(true); return; }   // Templo/Culto: compacto
    el.innerHTML = head + `
      <div class="dial"><button type="button" class="rb" data-tmp="${k}" data-d="-1" aria-label="Diminuir temperatura">${svg('minus')}</button>
      <div class="temp"><b>${t}<sup>°C</sup></b><span>${on ? `${a.mode} · ${amb}` : `Desligado · ${amb}`}</span></div>
      <button type="button" class="rb" data-tmp="${k}" data-d="1" aria-label="Aumentar temperatura">${svg('plus')}</button></div>
      <div class="modes">${MODES.map(([m, ic]) => `<button type="button" class="mode ${on && a.mode === m ? 'on' : ''}" data-ack="${k}" data-m="${m}">${svg(ic)}${m}</button>`).join('')}</div>
      <div class="xrow">${this._xb('fan', k)}${this._xb('swing', k)}</div>` +
      (k === 'ac_templo' ? this._splitsHtml() : '') +
      (big || tpl ? '' : `<div class="mini"><span>${svg('radar')}Presença <b>${S.pres == null ? '—' : S.pres ? 'Ocupado' : 'Vazio'}</b></span><span>${svg('therm')}Templo <b>${S.temp == null ? '—' : S.temp + ' °C'}</b></span></div>`);
  }
  // v1.1: Ligar/Desligar todos e uma linha por split (⏻, temperatura, modo, velocidade, aleta)
  _splitsHtml(compact) {
    const S = this.S, sp = S.splits, n = sp.filter((k) => S.on[k]).length;
    const head = `<div class="splh"><small>${sp.length ? `SPLITS · ${n}/${sp.length} LIGADOS` : 'TODOS OS SPLITS'}</small><button type="button" class="allb ${sp.length ? (n === sp.length ? 'on' : '') : (S.on.ac_templo ? 'on' : '')}" data-acall="on">Ligar todos</button><button type="button" class="allb ${(sp.length ? n === 0 : !S.on.ac_templo) ? 'on' : ''}" data-acall="off">Desligar todos</button></div>`;
    if (!sp.length) return head + '<div class="splnote">Controle separado dos 5 splits: informe <code>ac_templo_1</code> … <code>ac_templo_5</code> em <code>entities</code>. Sem eles, o A/C do Templo usa a entidade única <code>ac_templo</code>.</div>';
    return head + `<div class="spls${compact ? ' c' : ''}">` + sp.map((k) => this._acRow(k, NAMES[k])).join('') + '</div>';
  }
  // seletor pequeno (Modo · Velocidade · Aleta): fica dentro do desenho 1280×800, fecha ao escolher, ao tocar fora e com Esc
  _popOpen(btn) {
    const kind = btn.dataset.pop, k = btn.dataset.pk, a = this.S.ac[k], pop = this.$('pop'), app = this.$('app');
    if (this._popK === kind + ':' + k) { this._popClose(); return; }
    const opts = kind === 'mode' ? MODES.map(([m, ic]) => [m, m, ic]) : kind === 'fan' ? a.fans.map((v) => [v, ptOf(FAN_PT, v), 'fan']) : a.swings.map((v) => [v, ptOf(SWING_PT, v), 'swing']);
    const cur = kind === 'mode' ? (this.S.on[k] ? a.mode : null) : kind === 'fan' ? a.fan : a.swing;
    pop.innerHTML = `<h5>${kind === 'mode' ? 'MODO' : kind === 'fan' ? 'VELOCIDADE' : 'ALETA'} · ${esc(this._acLabel(k).toUpperCase())}</h5>` +
      opts.map(([v, l, ic]) => `<button type="button" role="option" aria-selected="${v === cur}" class="${v === cur ? 'on' : ''}" data-popv="${esc(v)}">${svg(ic)}${esc(l)}</button>`).join('');
    this._popK = kind + ':' + k; this._popKind = kind; this._popKey = k;
    this.shadowRoot.querySelectorAll('.xb.open').forEach((b) => b.classList.remove('open')); btn.classList.add('open');
    pop.classList.add('open');
    const s = app.getBoundingClientRect().width / app.offsetWidth || 1, A = app.getBoundingClientRect(), B = btn.getBoundingClientRect();
    const W = app.offsetWidth, H = app.offsetHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = (B.left - A.left) / s, y = (B.bottom - A.top) / s + 6;
    if (y + ph > H - 8) y = (B.top - A.top) / s - ph - 6;   // sem espaço embaixo: abre para cima
    x = Math.max(8, Math.min(W - pw - 8, x)); y = Math.max(8, Math.min(H - ph - 8, y));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    const f = pop.querySelector('button.on') || pop.querySelector('[data-popv]'); if (f) f.focus({ preventScroll: true });
  }
  _popClose() { const pop = this.$('pop'); if (!pop) return; const back = pop.contains(this.shadowRoot.activeElement) && this.shadowRoot.querySelector('.xb.open'); pop.classList.remove('open'); if (back) back.focus({ preventScroll: true }); this._popK = null; this.shadowRoot.querySelectorAll('.xb.open').forEach((b) => b.classList.remove('open')); }
  _popPick(v) { const kind = this._popKind, k = this._popKey; this._popClose();
    if (kind === 'mode') this._acMode(k, v); else if (kind === 'fan') this._acFan(k, v); else this._acSwing(k, v); }
  _clock() {
    if (!this._built) return;
    const tz = (this._hass && this._hass.config && this._hass.config.time_zone) || 'America/Araguaina', d = new Date();
    let hm = '', dt = '', h = d.getHours();
    try {
      hm = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
      dt = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
      h = +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(d);
    } catch (_) { hm = d.toTimeString().slice(0, 5); }
    this.$('clock').textContent = hm;
    this.$('date').textContent = dt.replace(',', ' •').replace(/ de /g, ' DE ').toUpperCase();
    const g = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite', who = (this.S && this.S.person) || '';
    this.$('hello').textContent = who ? `${g}, ${who}.` : `${g}.`;
    const ago = Math.max(1, Math.round((Date.now() - (this._lastHass || Date.now())) / 1000));
    this.$('sync').textContent = ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`;
    const online = this._hass && this._hass.connected !== false;
    this.$('hastat').textContent = online ? 'Home Assistant online' : 'Home Assistant offline';
    this.$('hadot').style.background = online ? '' : 'var(--orange)';
  }
  _toast(msg) { const t = this.$('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), 1800); }

  // ---------- eventos (um listener só no #app) ----------
  _bind() {
    const app = this.$('app');
    app.addEventListener('click', (e) => {
      const q = (s) => e.target.closest(s);
      let x;
      if ((x = q('[data-popv]'))) { this._popPick(x.dataset.popv); return; }
      if ((x = q('[data-pop]'))) { e.stopPropagation(); this._popOpen(x); return; }
      if (this._popK && !q('#pop')) this._popClose();   // tocar fora fecha o seletor
      if ((x = q('[data-blk]'))) { e.stopPropagation(); const b = x.dataset.blk, it = blockItems(b).filter((k) => TOG.includes(k)); this._block(b, !it.some((k) => this.S.on[k])); return; }
      if ((x = q('[data-t]'))) { e.stopPropagation(); this._toggle(x.dataset.t); return; }
      if ((x = q('.gl[data-k]'))) { if (this._dev(x.dataset.k).more) this._openModal(x.dataset.k); return; }
      if ((x = q('.scene'))) { this._runScene(x.dataset.s); return; }
      if ((x = q('.tab'))) { this._select('b:' + x.dataset.b); return; }
      if ((x = q('[data-bsel]'))) { this._select('b:' + x.dataset.bsel); return; }
      if ((x = q('[data-rsel]'))) { this._select('r:' + x.dataset.rsel); return; }
      if ((x = q('[data-acall]'))) { this._acAll(x.dataset.acall === 'on'); return; }
      if ((x = q('[data-tmp]'))) { this._acTemp(x.dataset.tmp, +x.dataset.d); return; }
      if ((x = q('[data-ack]'))) { this._acMode(x.dataset.ack, x.dataset.m); return; }
      if ((x = q('[data-c]'))) { this._palcoColor(x.dataset.c); return; }
      if ((x = q('[data-mp]'))) { this._call('media_player', x.dataset.mp, { entity_id: this._ent.telao }); return; }
      if ((x = q('[data-z]'))) { const v = this._p3plan; if (v) v.setZoom((v.zoom || 1) * (x.dataset.z === '1' ? 1.25 : 0.8)); return; }
      if ((x = q('[data-cmd]'))) { this._alexaCmd(x.dataset.cmd); return; }
      if ((x = q('[data-snd]'))) { this._alexaSound(x.dataset.snd, x.textContent.trim()); return; }
      if ((x = q('[data-nav]'))) { this._go(x.dataset.nav); return; }
    });
    app.addEventListener('input', (e) => { const b = e.target.dataset && e.target.dataset.bri; if (b) { const t = e.target.closest('.card,.sheet').querySelector('.bri-t'); if (t) t.textContent = e.target.value + '%'; }
      if (e.target.id === 'm-vrng') this.$('m-vol').textContent = e.target.value; });
    app.addEventListener('change', (e) => { const b = e.target.dataset && e.target.dataset.bri; if (b) this._bri(b, e.target.value);
      if (e.target.id === 'm-vrng') this._call('media_player', 'volume_set', { entity_id: this._ent.telao, volume_level: +e.target.value / 100 }); });
    app.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches) {
        if (e.target.matches('.gl[data-k]')) { e.preventDefault(); this._openModal(e.target.dataset.k); }
        else if (e.target.matches('[data-bsel]')) { e.preventDefault(); this._select('b:' + e.target.dataset.bsel); }
      }
      if (e.key === 'Escape') { if (this._popK) this._popClose(); else this._closeModal(); }
    });
    for (const id of ['say-t', 'cmd-t']) for (const t of ['keydown', 'keyup', 'keypress']) this.$(id).addEventListener(t, (ev) => ev.stopPropagation());   // o HA não pega as teclas
    this.$('act-off').addEventListener('click', () => this._runScene('fechar'));
    this.$('say').addEventListener('submit', (e) => { e.preventDefault(); this._alexaSpeak(false); });
    this.$('say-an').addEventListener('click', () => this._alexaSpeak(true));
    this.$('cmd').addEventListener('submit', (e) => { e.preventDefault(); const v = this.$('cmd-t').value.trim(); if (v) { this._alexaCmd(v); this.$('cmd-t').value = ''; } });
    const sheet = this.$('sheet'), mbg = this.$('mbg');
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this._closeModal(); });
    mbg.addEventListener('click', (e) => { if (e.target === mbg) this._closeModal(); });
  }
  _go(nav) {
    if (nav === 'alexa' && !(this._config || {}).alexa_device) return;
    this._popClose(); this._nav = nav; const app = this.$('app');
    app.className = 'p-' + nav;
    this.shadowRoot.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
    if (nav === 'rooms') { this._ambScroll = true; this._placeAmb(); }
    if (nav === 'alexa') this._alexaLoad();
    this._render(); requestAnimationFrame(() => this._p3resize());
  }
  _openModal(k) { this._modal = k; this._drawModal(); this.$('mbg').classList.add('open'); }
  _closeModal() { this.$('mbg').classList.remove('open'); this._modal = null; }
  _drawModal() {
    const S = this.S, sheet = this.$('sheet'), k = this._modal, d = this._dev(k);
    if (sheet.contains(this.shadowRoot.activeElement) && this.shadowRoot.activeElement.type === 'range') return;   // não redesenha embaixo do dedo
    const head = `<div class="sh"><button type="button" class="x" data-close aria-label="Fechar">×</button><b>${esc(d.n)}</b><button type="button" class="tg ${d.on ? 'on' : ''}" data-t="${k}" aria-label="Ligar ou desligar ${esc(d.n)}"></button></div><div class="sub">${esc(this._ent[k])} · ${esc(d.st)}</div>`;
    if (k === 'palco') sheet.innerHTML = head + `<div class="sw">${PRESETS.map(([n, c]) => `<button type="button" class="swb ${S.on.palco && S.palcoColor === n ? 'on' : ''}" data-c="${n}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>
      <div class="rowl"><span>Brilho</span><b class="bri-t">${S.palcoBri}%</b></div><input class="rng" data-bri="palco" type="range" min="5" max="100" value="${S.palcoBri}" aria-label="Brilho do palco">`;
    else if (k === 'plateia') sheet.innerHTML = head + `<div class="rowl"><span>Brilho</span><b class="bri-t">${S.plateiaBri}%</b></div><input class="rng" data-bri="plateia" type="range" min="5" max="100" value="${S.plateiaBri}" aria-label="Brilho da plateia">`;
    else if (k === 'telao') { const T = S.telao, pl = T.state === 'playing';
      sheet.innerHTML = head + `<div class="sub2" style="margin-left:40px">${esc([T.title, T.artist].filter(Boolean).join(' · ') || (S.on.telao ? 'Sem título' : 'Telão desligado'))}</div>
      <div class="ctl"><button type="button" data-mp="media_previous_track" aria-label="Anterior">${svg('prev')}</button><button type="button" class="pp" data-mp="media_play_pause" aria-label="Tocar ou pausar">${svg(pl ? 'pause' : 'play')}</button><button type="button" data-mp="media_next_track" aria-label="Próxima">${svg('next')}</button></div>
      <div class="rowl"><span>Volume</span><b id="m-vol">${T.vol == null ? '—' : T.vol}</b></div><input class="rng" id="m-vrng" type="range" min="0" max="100" value="${T.vol == null ? 0 : T.vol}" aria-label="Volume do telão">`; }
    else if (ACS.includes(k)) { sheet.innerHTML = `<div class="sh"><button type="button" class="x" data-close aria-label="Fechar">×</button><b>Climatização</b></div><div class="clim" style="margin-top:12px"></div>`;
      this._renderAc(sheet.querySelector('.clim'), k, true); }
  }

  // ---------- Alexa (opcional: alexa_device na config) ----------
  async _alexaLoad(force) {
    const dev = (this._config || {}).alexa_device; if (!dev || (this._alx && !force)) { this._renderAlexa(); return; }
    this._alx = { ents: [] };
    try { const l = await this._hass.callWS({ type: 'config/entity_registry/list_for_display' }); this._alx.ents = ((l && l.entities) || []).filter((x) => x.di === dev).map((x) => x.ei); }
    catch (_) { this._alx.ents = []; }
    this._renderAlexa();
  }
  _alxEnt(re, dom) { const l = (this._alx && this._alx.ents) || []; return l.find((e) => e.startsWith(dom + '.') && re.test(e)) || null; }
  _renderAlexa() {
    const box = this.$('alx-kv'); if (!box) return; const st = (this._hass && this._hass.states) || {}, c = this._config || {};
    const v = (id) => (id && st[id] ? st[id].state : null);
    const when = (id) => { const s = v(id); if (!s || s === 'unknown' || s === 'unavailable') return 'Nenhum'; const t = Date.parse(s); return isNaN(t) ? s : new Date(t).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
    const con = v(c.alexa_conectividade || this._alxEnt(/conectiv|connectiv/, 'binary_sensor')), dnd = c.alexa_nao_incomodar || this._alxEnt(/incomodar|disturb/, 'switch');
    const rows = [['Aparelho', c.alexa_nome || 'Echo'], ['Conexão', con == null ? '—' : con === 'on' ? 'Conectada' : 'Desconectada'],
      ['Não perturbe', dnd ? `<button type="button" class="tg ${v(dnd) === 'on' ? 'on' : ''}" data-dnd="${esc(dnd)}" aria-label="Não perturbe"></button>` : '—'],
      ['Próximo alarme', esc(when(this._alxEnt(/alarm/, 'sensor')))], ['Próximo lembrete', esc(when(this._alxEnt(/lembrete|reminder/, 'sensor')))], ['Próximo temporizador', esc(when(this._alxEnt(/temporizador|timer/, 'sensor')))]];
    box.innerHTML = rows.map(([a, b]) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`).join('');
    const t = box.querySelector('[data-dnd]'); if (t) t.onclick = (e) => { e.stopPropagation(); this._call('switch', v(dnd) === 'on' ? 'turn_off' : 'turn_on', { entity_id: dnd }); };
  }
  _alexaSvc(service, data) { const dev = (this._config || {}).alexa_device; if (!dev) return Promise.reject(new Error('alexa_device não configurado'));
    return this._call('alexa_devices', service, Object.assign({ device_id: dev }, data)); }
  async _alexaSpeak(anuncio) {
    const tx = this.$('say-t').value.trim(); if (!tx) { this._toast('Escreva o texto primeiro'); return; }
    const c = this._config || {}, ent = anuncio ? (c.alexa_anuncio || this._alxEnt(/anuncio|announce/, 'notify')) : (c.alexa_fala || this._alxEnt(/fala|speak/, 'notify'));
    if (ent) await this._call('notify', 'send_message', { entity_id: ent, message: tx });
    else await this._alexaSvc('send_text_command', { text_command: anuncio ? `anunciar ${tx}` : `diga ${tx}` });
    this.$('say-t').value = ''; this._toast(anuncio ? 'Anúncio enviado à Alexa' : 'A Alexa vai falar');
  }
  _alexaCmd(tx) { this._alexaSvc('send_text_command', { text_command: tx }).then(() => this._toast(`Pedi à Alexa: “${tx}”`)).catch((e) => this._toast(`Falhou: ${(e && e.message) || e}`)); }
  _alexaSound(s, n) { this._alexaSvc('send_sound', { sound: s }).then(() => this._toast(`Som: ${n}`)).catch((e) => this._toast(`Falhou: ${(e && e.message) || e}`)); }
}
if (!customElements.get('igreja-painel-card')) customElements.define('igreja-painel-card', IgrejaPainelCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'igreja-painel-card')) window.customCards.push({ type: 'igreja-painel-card', name: 'Base Church · Painel', description: 'Painel dashboard da igreja (blocos, cenas, templo, ares e Alexa) com vistas 3D.' });
console.info(`%c IGREJA-PAINEL-CARD %c v${IGP_VERSION} `, 'background:#061a1d;color:#1fe0a3;font-weight:700', 'background:#1fe0a3;color:#061a1d;font-weight:700');
