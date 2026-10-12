(async () => {
  const out = {};
  const tryAt = (v, p) => { const [x, y] = v.project(p); const h = v.pickAt(x, y); return { px: [Math.round(x), Math.round(y)], hit: h && { kind: h.kind, key: h.key, room: h.room } }; };
  const R = V.room, P = V.plan, C = V.cut;
  out.room_highbay = tryAt(R, [10.6, 7.05, 23.5]);
  out.room_moving = tryAt(R, [0.8, 6.0, 26.7]);
  out.room_telao = tryAt(R, [0.3, 2.65, 30.5]);
  out.room_ac = tryAt(R, [15.82, 2.6, 15.3]);
  out.room_som = tryAt(R, [4.9, 1.07, 36.4]);
  out.room_piso = tryAt(R, [9.0, 0.0, 28.1]);
  out.plan_hall_luz = tryAt(P, [7.5, 2.7, 46.8]);
  out.plan_voluntariado = tryAt(P, [18.1, 0.0, 31.5]);
  out.plan_cozinha = tryAt(P, [10.0, 0.0, 2.5]);
  out.cut_midia_luz = tryAt(C, [17.5, 2.7, 25.6]);
  out.cut_ac_midia = tryAt(C, [17.55, 2.56, 27.785]);
  out.cut_fora = tryAt(C, [10.0, 0.0, 25.0]);
  out.points_plateia = V.E.points('plateia').length; out.points_ac = V.E.points('ac_templo');
  // clique real (mouse) na luminária do hall na planta → onClick
  const [x, y] = P.project([11.5, 2.7, 46.8]); const r = P.c.getBoundingClientRect();
  window.__clickAt = [r.left + x, r.top + y];
  return out;
})()
