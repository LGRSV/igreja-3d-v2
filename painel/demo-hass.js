// Home Assistant simulado (noite de culto) — tirado do demo.template.html do igreja-3d.
const toastEl = document.getElementById('toast') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toast' }));
const states = {};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const mk = (id, state, attributes = {}, min = 0) => { states[id] = { entity_id: id, state, attributes, last_changed: ago(min) }; };
mk('light.palco_rgb', 'on', { friendly_name: 'Palco RGB', rgb_color: [140, 60, 230], brightness: 255, supported_color_modes: ['rgb'] }, 6);
mk('light.templo_plateia', 'on', { friendly_name: 'Plateia', brightness: 77, supported_color_modes: ['brightness'] }, 6);
mk('media_player.telao_led', 'playing', { friendly_name: 'Telão LED', media_title: 'Louvor — Base Music', volume_level: 0.6 }, 6);
mk('switch.som_templo', 'on', { friendly_name: 'Som do templo' }, 40);
mk('climate.ar_templo', 'cool', { friendly_name: 'Ar do templo', temperature: 22, current_temperature: 24.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat_cool'], swing_mode: 'on', swing_modes: ['off', 'on'] }, 55);
// os 5 splits do templo (entities ac_templo_1…5 do painel): 2 ligados e 3 desligados
mk('climate.ar_templo_1', 'cool', { friendly_name: 'A/C do templo · split 1', temperature: 22, current_temperature: 24.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat_cool'] }, 55);
mk('climate.ar_templo_2', 'cool', { friendly_name: 'A/C do templo · split 2', temperature: 22, current_temperature: 24.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat_cool'] }, 55);
mk('climate.ar_templo_3', 'off', { friendly_name: 'A/C do templo · split 3', temperature: 23, current_temperature: 24.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat_cool'] }, 55);
mk('climate.ar_templo_4', 'off', { friendly_name: 'A/C do templo · split 4', temperature: 23, current_temperature: 24.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat_cool'] }, 55);
mk('climate.ar_templo_5', 'off', { friendly_name: 'A/C do templo · split 5', temperature: 23, current_temperature: 24.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat_cool'] }, 55);
mk('light.hall_entrada', 'on', { friendly_name: 'Hall de entrada' }, 70);
mk('light.fachada_letreiro', 'on', { friendly_name: 'Fachada / letreiro' }, 95);
mk('light.estacionamento', 'on', { friendly_name: 'Estacionamento' }, 95);
mk('light.sala_pastoral', 'off', { friendly_name: 'Sala pastoral' }, 180);
mk('climate.ar_sala_pastoral', 'off', { friendly_name: 'Ar da sala pastoral', temperature: 23, current_temperature: 27, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry'], swing_mode: 'off', swing_modes: ['off', 'on'] }, 180);
mk('light.recepcao', 'off', { friendly_name: 'Recepção' }, 175);
mk('light.administrativo', 'off', { friendly_name: 'Administrativo' }, 190);
mk('light.circulacao', 'on', { friendly_name: 'Circulação' }, 80);
mk('light.sala_midia', 'on', { friendly_name: 'Sala de mídia' }, 60);
mk('climate.ar_midia', 'off', { friendly_name: 'Ar da mídia', temperature: 21, current_temperature: 26, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry'], swing_mode: 'off', swing_modes: ['off', 'on'] }, 60);
mk('light.voluntariado', 'off', { friendly_name: 'Voluntariado' }, 50);
mk('climate.ar_voluntariado', 'off', { friendly_name: 'Ar do voluntariado', temperature: 23, current_temperature: 27.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'fan_only', 'dry', 'heat'], swing_mode: 'off', swing_modes: ['off', 'on'] }, 50);
mk('light.cozinha', 'off', { friendly_name: 'Cozinha' }, 120);
mk('light.banheiros', 'on', { friendly_name: 'Banheiros' }, 75);
mk('binary_sensor.presenca_templo', 'on', { friendly_name: 'Presença no templo', device_class: 'occupancy' }, 58);
mk('binary_sensor.porta_principal', 'off', { friendly_name: 'Porta principal', device_class: 'door' }, 9);
mk('sensor.temperatura_templo', '24.5', { friendly_name: 'Temperatura do templo', unit_of_measurement: '°C', device_class: 'temperature' }, 2);
// Automações de exemplo do HA; last_triggered simulado
const autos = [['automation.fachada_no_por_do_sol', 'Fachada acende no pôr do sol', 95], ['automation.ar_templo_antes_do_culto', 'Ar do templo 1 h antes do culto', 55],
  ['automation.abrir_igreja_domingo', 'Abrir a igreja (domingo 17h30)', 100], ['automation.presenca_acende_hall', 'Presença acende o hall', 70],
  ['automation.fechar_tudo_meia_noite', 'Fechar tudo à meia-noite', 1400], ['automation.expediente_seg_sex', 'Expediente (seg–sex 8h)', 700],
  ['automation.aviso_porta_aberta', 'Aviso: porta aberta depois das 23h', 0]];
for (const [id, name, min] of autos) mk(id, id === 'automation.aviso_porta_aberta' ? 'off' : 'on', { friendly_name: name, last_triggered: min ? ago(min) : null, mode: 'single' }, 99999);

let toastT = 0;
const toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2600); };

let card;
const push = () => { card.hass = { states: { ...states }, language: 'pt', locale: { language: 'pt' }, config: { time_zone: 'America/Sao_Paulo' }, user: { name: 'Sandro' }, callService: (d, s, x) => { (window.__calls ||= []).push([d, s, x]); return callService(d, s, x); }, callWS: async (m) => { (window.__calls ||= []).push(['ws', m.type, m]); return {}; }, connection: { subscribeMessage: async () => () => {} } }; };
// Simula os serviços que o cartão usa (com a latência de um interruptor Wi-Fi)
function callService(domain, service, data) {
  if (data && Array.isArray(data.entity_id)) return data.entity_id.forEach((e) => callService(domain, service, { ...data, entity_id: e }));   // em lote (Ligar/Desligar tudo)
  const id = data && data.entity_id; const s = states[id]; if (!s) return;
  const set = (state, attrs) => { s.state = state; if (attrs) Object.assign(s.attributes, attrs); s.last_changed = new Date().toISOString(); push(); };
  const later = (fn) => setTimeout(fn, 220);
  const isMedia = domain === 'media_player' || id.startsWith('media_player.');
  const isClimate = id.startsWith('climate.');
  if (service === 'toggle') later(() => set(isMedia ? (s.state === 'off' ? 'playing' : 'off') : isClimate ? (s.state === 'off' ? 'cool' : 'off') : (s.state === 'on' ? 'off' : 'on')));
  else if (service === 'turn_on') {
    const attrs = {};
    if (data.rgb_color) attrs.rgb_color = data.rgb_color;
    if (data.brightness_pct != null) attrs.brightness = Math.round(data.brightness_pct * 2.55);
    if (data.brightness != null) attrs.brightness = data.brightness;
    if (isMedia && !s.attributes.media_title) attrs.media_title = 'Louvor — Base Music';
    later(() => set(isMedia ? 'playing' : isClimate ? 'cool' : 'on', attrs));
  }
  else if (service === 'turn_off') later(() => set('off'));
  else if (service === 'set_hvac_mode') later(() => set(data.hvac_mode));
  else if (service === 'set_temperature') later(() => set(s.state, { temperature: data.temperature }));
  else if (service === 'set_swing_mode') later(() => set(s.state, { swing_mode: data.swing_mode }));   // oscilar (simulado)
  else if (service === 'media_play_pause') later(() => set(s.state === 'playing' ? 'paused' : 'playing'));
  else if (service === 'volume_up') set(s.state, { volume_level: Math.min(1, +((s.attributes.volume_level || 0.3) + 0.05).toFixed(2)) });
  else if (service === 'volume_down') set(s.state, { volume_level: Math.max(0, +((s.attributes.volume_level || 0.3) - 0.05).toFixed(2)) });
  else if (domain === 'automation' && service === 'trigger') {
    // efeito plausível de cada automação de exemplo
    const on = (...ids) => ids.forEach((k) => { states[k].state = 'on'; });
    const fx = {
      'automation.fachada_no_por_do_sol': () => on('light.fachada_letreiro', 'light.estacionamento'),
      'automation.ar_templo_antes_do_culto': () => { states['climate.ar_templo'].state = 'cool'; },
      'automation.abrir_igreja_domingo': () => on('light.fachada_letreiro', 'light.estacionamento', 'light.hall_entrada', 'light.banheiros', 'light.recepcao'),
      'automation.presenca_acende_hall': () => on('light.hall_entrada'),
      'automation.fechar_tudo_meia_noite': () => { for (const k of Object.keys(states)) if (k.startsWith('light.') || k.startsWith('switch.') || k.startsWith('climate.') || k.startsWith('media_player.')) states[k].state = 'off'; },
      'automation.expediente_seg_sex': () => on('light.administrativo', 'light.sala_pastoral', 'light.recepcao', 'light.circulacao'),
    };
    later(() => { (fx[id] || (() => {}))(); s.attributes.last_triggered = new Date().toISOString(); push(); });
  }
}

export function attach(el, config) {
  card = el;
  window.__calls = [];
  card.setConfig(config);
  card.addEventListener('hass-more-info', (e) => {
    const id = e.detail.entityId; const s = states[id]; if (!s) return;
    if (id.startsWith('climate.')) { s.state = s.state === 'off' ? 'cool' : 'off'; toast(`No Home Assistant isso abre o painel do ${s.attributes.friendly_name}. Na demo: ${s.state === 'off' ? 'desligado' : 'ligado (frio)'}.`); }
    else if (id.startsWith('media_player.')) { s.state = { playing: 'paused', paused: 'off', off: 'playing' }[s.state] || 'playing'; toast(`No Home Assistant isso abre o controle do telão. Na demo: ${s.state}.`); }
    else if (id === 'binary_sensor.porta_principal') { s.state = s.state === 'on' ? 'off' : 'on'; toast(`${s.attributes.friendly_name}: ${s.state === 'on' ? 'aberta' : 'fechada'} (na demo o toque abre/fecha)`); }
    else if (id.startsWith('binary_sensor.') || id.startsWith('sensor.')) {   // sensor: nome e estado (no HA abre o painel dele)
      const st = s.attributes.unit_of_measurement ? `${String(s.state).replace('.', ',')} ${s.attributes.unit_of_measurement}` : s.attributes.device_class === 'occupancy' ? (s.state === 'on' ? 'pessoas no templo' : 'vazio') : s.state;
      toast(`${s.attributes.friendly_name}: ${st}`); return;
    }
    s.last_changed = new Date().toISOString();
    push();
  });
  
  push();
  window.demo = { states, push, set(id, state, attrs) { const s = states[id]; if (!s) return false; s.state = String(state); if (attrs) Object.assign(s.attributes, attrs); push(); return true; } };
  return states;
}
