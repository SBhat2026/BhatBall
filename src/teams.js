// 17 nations with authentic home/away kits, softened ~15% into the pastel world.
// kit: { shirt, sleeve, shorts, gk, pat?, pat2? }  pat: 'stripes' | 'checkers' | 'hoops'
// xi: current-era starting elevens [number, name], ordered GK · DF×4 · MF×3 · FW×3
// to match the 4-3-3 FORMATION slots. rating drives World Cup CPU sims.
export const TEAMS = [
  { code: 'BRA', name: 'Brazil', rating: 88,
    home: { shirt: '#efd463', sleeve: '#58a878', shorts: '#5b78c9', gk: '#6fb392' },
    away: { shirt: '#5b78c9', sleeve: '#f4f5f0', shorts: '#f4f5f0', gk: '#d9a75f' },
    xi: [[1,'Alisson'],[2,'Danilo'],[4,'Marquinhos'],[3,'Gabriel'],[16,'Arana'],[5,'Casemiro'],[8,'Guimarães'],[10,'Paquetá'],[11,'Raphinha'],[9,'João Pedro'],[7,'Vinícius Jr']] },
  { code: 'ARG', name: 'Argentina', rating: 92,
    home: { shirt: '#a7d3ee', sleeve: '#f6f7f3', shorts: '#3c445e', gk: '#c9b647', pat: 'stripes', pat2: '#f6f7f3' },
    away: { shirt: '#4a5788', sleeve: '#4a5788', shorts: '#4a5788', gk: '#93c98a' },
    xi: [[23,'E. Martínez'],[26,'Molina'],[13,'Romero'],[25,'Otamendi'],[3,'Tagliafico'],[7,'De Paul'],[24,'Enzo'],[20,'Mac Allister'],[11,'Garnacho'],[9,'J. Álvarez'],[10,'Messi']] },
  { code: 'FRA', name: 'France', rating: 91,
    home: { shirt: '#3d4a78', sleeve: '#3d4a78', shorts: '#f4f4ef', gk: '#d9cb5c' },
    away: { shirt: '#f4f3ee', sleeve: '#9db8d9', shorts: '#f4f3ee', gk: '#8a93a5' },
    xi: [[16,'Maignan'],[5,'Koundé'],[17,'Saliba'],[4,'Upamecano'],[22,'T. Hernández'],[8,'Tchouaméni'],[6,'Camavinga'],[7,'Griezmann'],[15,'Barcola'],[10,'Mbappé'],[11,'Dembélé']] },
  { code: 'GER', name: 'Germany', rating: 86,
    home: { shirt: '#f5f4ef', sleeve: '#454549', shorts: '#454549', gk: '#6fae85' },
    away: { shirt: '#b26fa8', sleeve: '#5c4470', shorts: '#5c4470', gk: '#d9b05c' },
    xi: [[1,'Neuer'],[6,'Kimmich'],[2,'Rüdiger'],[15,'Tah'],[18,'Mittelstädt'],[16,'Pavlović'],[21,'Gündoğan'],[10,'Musiala'],[17,'Wirtz'],[7,'Havertz'],[19,'Sané']] },
  { code: 'ESP', name: 'Spain', rating: 90,
    home: { shirt: '#c85454', sleeve: '#e5c766', shorts: '#3d4a78', gk: '#79c9ac' },
    away: { shirt: '#a5d5ce', sleeve: '#f4f4ef', shorts: '#a5d5ce', gk: '#b985c0' },
    xi: [[23,'U. Simón'],[2,'Carvajal'],[3,'Le Normand'],[14,'Laporte'],[24,'Cucurella'],[16,'Rodri'],[8,'Pedri'],[10,'D. Olmo'],[17,'N. Williams'],[21,'Oyarzabal'],[19,'L. Yamal']] },
  { code: 'ENG', name: 'England', rating: 88,
    home: { shirt: '#f6f5f0', sleeve: '#f6f5f0', shorts: '#3d4a78', gk: '#d9d05c' },
    away: { shirt: '#c25555', sleeve: '#c25555', shorts: '#f4f3ee', gk: '#7fa5d9' },
    xi: [[1,'Pickford'],[2,'Alexander-Arnold'],[5,'Stones'],[6,'Guéhi'],[3,'Shaw'],[4,'Rice'],[10,'Bellingham'],[11,'Palmer'],[18,'Gordon'],[9,'Kane'],[7,'Saka']] },
  { code: 'ITA', name: 'Italy', rating: 84,
    home: { shirt: '#6b98d4', sleeve: '#6b98d4', shorts: '#f4f4ef', gk: '#b5b95e' },
    away: { shirt: '#f4f3ee', sleeve: '#6b98d4', shorts: '#f4f3ee', gk: '#c9855a' },
    xi: [[1,'Donnarumma'],[2,'Di Lorenzo'],[23,'Bastoni'],[5,'Calafiori'],[3,'Dimarco'],[18,'Barella'],[8,'Tonali'],[16,'Frattesi'],[10,'Zaccagni'],[9,'Retegui'],[14,'Chiesa']] },
  { code: 'POR', name: 'Portugal', rating: 87,
    home: { shirt: '#b04f56', sleeve: '#b04f56', shorts: '#3d5f50', gk: '#b5d95e' },
    away: { shirt: '#f2efe6', sleeve: '#b04f56', shorts: '#3c445e', gk: '#d9a05c' },
    xi: [[22,'D. Costa'],[20,'Cancelo'],[4,'R. Dias'],[3,'Inácio'],[19,'N. Mendes'],[23,'Vitinha'],[8,'B. Fernandes'],[18,'J. Neves'],[17,'R. Leão'],[7,'Ronaldo'],[10,'B. Silva']] },
  { code: 'NED', name: 'Netherlands', rating: 85,
    home: { shirt: '#e0904f', sleeve: '#e0904f', shorts: '#f4f4ef', gk: '#6fae85' },
    away: { shirt: '#46548c', sleeve: '#46548c', shorts: '#46548c', gk: '#d9d05c' },
    xi: [[1,'Verbruggen'],[22,'Dumfries'],[3,'De Ligt'],[4,'Van Dijk'],[5,'Aké'],[14,'Reijnders'],[21,'F. de Jong'],[7,'Simons'],[11,'Gakpo'],[10,'Depay'],[18,'Malen']] },
  { code: 'JPN', name: 'Japan', rating: 82,
    home: { shirt: '#5c69b8', sleeve: '#5c69b8', shorts: '#f4f4ef', gk: '#c9855a' },
    away: { shirt: '#f4f3ee', sleeve: '#5c69b8', shorts: '#f4f3ee', gk: '#7fb98f' },
    xi: [[23,'Z. Suzuki'],[2,'Sugawara'],[4,'Itakura'],[22,'Tomiyasu'],[26,'Itō'],[6,'Endō'],[17,'Morita'],[15,'Kamada'],[7,'Mitoma'],[9,'Ueda'],[11,'Kubo']] },
  { code: 'USA', name: 'USA', rating: 79,
    home: { shirt: '#f5f5f0', sleeve: '#f5f5f0', shorts: '#3d4a78', gk: '#d9d05c' },
    away: { shirt: '#4a5a94', sleeve: '#4a5a94', shorts: '#4a5a94', gk: '#79c9ac' },
    xi: [[1,'M. Turner'],[2,'Dest'],[3,'C. Richards'],[13,'Ream'],[5,'A. Robinson'],[4,'T. Adams'],[8,'McKennie'],[7,'Reyna'],[10,'Pulisic'],[9,'Balogun'],[21,'Weah']] },
  { code: 'MEX', name: 'Mexico', rating: 80,
    home: { shirt: '#4a8266', sleeve: '#4a8266', shorts: '#f4f4f0', gk: '#b58fc9' },
    away: { shirt: '#f2e8dc', sleeve: '#b04f4f', shorts: '#454549', gk: '#7fa5d9' },
    xi: [[13,'Ochoa'],[2,'J. Sánchez'],[3,'C. Montes'],[5,'J. Vásquez'],[23,'J. Gallardo'],[4,'E. Álvarez'],[18,'L. Chávez'],[26,'G. Mora'],[11,'A. Vega'],[9,'S. Giménez'],[22,'H. Lozano']] },
  { code: 'CRO', name: 'Croatia', rating: 83,
    home: { shirt: '#f0efe9', sleeve: '#f0efe9', shorts: '#f4f4f0', gk: '#5c69b8', pat: 'checkers', pat2: '#c25555' },
    away: { shirt: '#3d4352', sleeve: '#3d4352', shorts: '#3d4352', gk: '#d9d05c' },
    xi: [[1,'Livaković'],[2,'Stanišić'],[24,'Šutalo'],[20,'Gvardiol'],[19,'Sosa'],[10,'Modrić'],[8,'Kovačić'],[11,'Brozović'],[14,'Perišić'],[17,'Budimir'],[7,'Majer']] },
  { code: 'MAR', name: 'Morocco', rating: 83,
    home: { shirt: '#c25555', sleeve: '#c25555', shorts: '#3d7a55', gk: '#d9d05c' },
    away: { shirt: '#f4f3ee', sleeve: '#3d7a55', shorts: '#f4f3ee', gk: '#c9855a' },
    xi: [[1,'Bounou'],[2,'Hakimi'],[5,'Aguerd'],[24,'Dari'],[25,'Mazraoui'],[4,'Amrabat'],[8,'Ounahi'],[26,'El Khannouss'],[7,'Ziyech'],[19,'En-Nesyri'],[10,'B. Díaz']] },
  { code: 'URU', name: 'Uruguay', rating: 82,
    home: { shirt: '#85bede', sleeve: '#85bede', shorts: '#454549', gk: '#6fae85' },
    away: { shirt: '#3d4560', sleeve: '#85bede', shorts: '#3d4560', gk: '#c9855a' },
    xi: [[23,'Rochet'],[2,'Nández'],[4,'R. Araújo'],[22,'Coates'],[16,'M. Olivera'],[15,'Valverde'],[5,'Ugarte'],[10,'De La Cruz'],[8,'Pellistri'],[9,'Núñez'],[7,'F. Torres']] },
  { code: 'BEL', name: 'Belgium', rating: 83,
    home: { shirt: '#b5544e', sleeve: '#454549', shorts: '#b5544e', gk: '#6fae85' },
    away: { shirt: '#f4f3ee', sleeve: '#b5544e', shorts: '#f4f3ee', gk: '#d9a05c' },
    xi: [[1,'Courtois'],[21,'Castagne'],[3,'Debast'],[4,'Faes'],[5,'Theate'],[24,'Onana'],[7,'De Bruyne'],[8,'Tielemans'],[11,'Doku'],[9,'Lukaku'],[17,'Trossard']] },
  { code: 'CPV', name: 'Cabo Verde', rating: 74,
    home: { shirt: '#4f6ab8', sleeve: '#f4f4f0', shorts: '#f4f4f0', gk: '#d9cb5c' },
    away: { shirt: '#f4f3ee', sleeve: '#c25555', shorts: '#4f6ab8', gk: '#7fb98f' },
    xi: [[1,'Vozinha'],[2,'Dylan Silva'],[4,'Logan Costa'],[3,'R. Lopes'],[19,'Diney'],[6,'K. Rocha'],[8,'J. Monteiro'],[10,'D. Duarte'],[7,'G. Rodrigues'],[9,'Bebé'],[11,'Ryan Mendes']] },
];

// Back-compat: top-level shirt/sleeve/shorts/gk mirror the home kit
// (menus, chips, and anything that reads def.shirt keep working).
for (const t of TEAMS) Object.assign(t, t.home);

export const SKIN_TONES = ['#f2cfae', '#e5b58f', '#cf9a6e', '#a97753', '#8a5f42'];
//                            0 fair     1 light    2 olive    3 brown    4 dark

// --- per-player appearance --------------------------------------------------
// Real-life-ish look for each listed player: [skin index into SKIN_TONES,
// hair color]. ONLY skin tone + hair color live here — geometry and hair
// *style* stay procedural/random. Unlisted players fall back to a neutral look.
const K = '#1f1d1b', DB = '#3a2c20', BR = '#5f4229', LB = '#8a6540', BL = '#cbb182', GY = '#70737b';
export const PLAYER_LOOKS = {
  // Brazil
  'Alisson': [1, DB], 'Danilo': [3, K], 'Marquinhos': [2, K], 'Gabriel': [4, K], 'Arana': [3, K],
  'Casemiro': [3, K], 'Guimarães': [3, K], 'Paquetá': [2, DB], 'Raphinha': [3, K], 'João Pedro': [2, DB], 'Vinícius Jr': [3, K],
  // Argentina
  'E. Martínez': [1, DB], 'Molina': [1, DB], 'Romero': [1, BR], 'Otamendi': [1, DB], 'Tagliafico': [1, DB],
  'De Paul': [1, BR], 'Enzo': [1, LB], 'Mac Allister': [1, BR], 'Garnacho': [1, DB], 'J. Álvarez': [0, BR], 'Messi': [1, LB],
  // France
  'Maignan': [4, K], 'Koundé': [4, K], 'Saliba': [4, K], 'Upamecano': [4, K], 'T. Hernández': [1, DB],
  'Tchouaméni': [4, K], 'Camavinga': [4, K], 'Griezmann': [1, BR], 'Barcola': [3, K], 'Mbappé': [4, K], 'Dembélé': [4, K],
  // Germany
  'ter Stegen': [1, BR], 'Neuer': [0, LB], 'Kimmich': [0, LB], 'Rüdiger': [4, K], 'Tah': [4, K], 'Mittelstädt': [1, BR],
  'Pavlović': [1, DB], 'Gündoğan': [2, K], 'Musiala': [3, K], 'Wirtz': [0, BR], 'Havertz': [1, BR], 'Sané': [3, BL],
  // Spain
  'U. Simón': [1, BR], 'Carvajal': [2, DB], 'Le Normand': [1, BR], 'Laporte': [1, DB], 'Cucurella': [1, BR],
  'Rodri': [1, DB], 'Pedri': [1, DB], 'D. Olmo': [1, BR], 'N. Williams': [4, K], 'Oyarzabal': [1, DB], 'L. Yamal': [3, K],
  // England
  'Pickford': [0, LB], 'Alexander-Arnold': [2, DB], 'Stones': [1, DB], 'Guéhi': [4, K], 'Shaw': [1, BR],
  'Rice': [1, DB], 'Bellingham': [2, DB], 'Palmer': [2, DB], 'Gordon': [0, LB], 'Kane': [1, BR], 'Saka': [4, K],
  // Italy
  'Donnarumma': [1, DB], 'Di Lorenzo': [1, DB], 'Bastoni': [1, DB], 'Calafiori': [1, DB], 'Dimarco': [1, DB],
  'Barella': [1, BR], 'Tonali': [1, DB], 'Frattesi': [1, DB], 'Zaccagni': [1, LB], 'Retegui': [1, DB], 'Chiesa': [1, DB],
  // Portugal
  'D. Costa': [1, DB], 'Cancelo': [2, DB], 'R. Dias': [1, DB], 'Inácio': [1, DB], 'N. Mendes': [3, K],
  'Vitinha': [1, DB], 'B. Fernandes': [1, DB], 'J. Neves': [1, DB], 'R. Leão': [4, K], 'Ronaldo': [1, DB], 'B. Silva': [1, DB],
  // Netherlands
  'Verbruggen': [1, BR], 'Dumfries': [4, K], 'De Ligt': [0, BL], 'Van Dijk': [4, K], 'Aké': [4, K],
  'Reijnders': [2, DB], 'F. de Jong': [1, BR], 'Simons': [1, BR], 'Gakpo': [4, K], 'Depay': [3, K], 'Malen': [4, K],
  // Japan
  'Z. Suzuki': [1, K], 'Sugawara': [1, K], 'Itakura': [1, K], 'Tomiyasu': [1, K], 'Itō': [1, K],
  'Endō': [1, K], 'Morita': [1, K], 'Kamada': [1, K], 'Mitoma': [1, K], 'Ueda': [1, K], 'Kubo': [1, K],
  // USA
  'M. Turner': [1, BR], 'Dest': [3, K], 'C. Richards': [4, K], 'Ream': [0, LB], 'A. Robinson': [4, K],
  'T. Adams': [3, K], 'McKennie': [4, K], 'Reyna': [1, DB], 'Pulisic': [1, LB], 'Balogun': [4, K], 'Weah': [4, K],
  // Mexico
  'Malagón': [2, K], 'Ochoa': [2, K], 'J. Sánchez': [2, K], 'C. Montes': [2, DB], 'J. Vásquez': [2, K], 'J. Gallardo': [3, K],
  'E. Álvarez': [2, K], 'L. Chávez': [2, DB], 'G. Mora': [2, K], 'A. Vega': [2, K], 'S. Giménez': [1, BR], 'H. Lozano': [2, DB],
  // Croatia
  'Livaković': [1, DB], 'Stanišić': [1, BR], 'Šutalo': [1, DB], 'Gvardiol': [1, BR], 'Sosa': [1, DB],
  'Modrić': [1, BL], 'Kovačić': [1, DB], 'Brozović': [1, DB], 'Perišić': [1, BR], 'Budimir': [1, BR], 'Majer': [0, LB],
  // Morocco
  'Bounou': [2, K], 'Hakimi': [3, K], 'Aguerd': [2, K], 'Dari': [2, K], 'Mazraoui': [2, K],
  'Amrabat': [2, K], 'Ounahi': [2, K], 'El Khannouss': [2, K], 'Ziyech': [2, K], 'En-Nesyri': [3, K], 'B. Díaz': [2, DB],
  // Uruguay
  'Rochet': [1, DB], 'Nández': [2, DB], 'R. Araújo': [1, DB], 'Coates': [1, BR], 'M. Olivera': [2, DB],
  'Valverde': [1, BR], 'Ugarte': [2, DB], 'De La Cruz': [2, DB], 'Pellistri': [0, LB], 'Núñez': [2, DB], 'F. Torres': [1, BR],
  // Belgium
  'Courtois': [1, BR], 'Castagne': [1, BR], 'Debast': [1, BR], 'Faes': [1, BR], 'Theate': [1, LB],
  'Onana': [4, K], 'De Bruyne': [0, BL], 'Tielemans': [1, DB], 'Doku': [4, K], 'Lukaku': [4, K], 'Trossard': [1, BR],
  // Cabo Verde
  'Vozinha': [4, K], 'Dylan Silva': [3, K], 'Logan Costa': [4, K], 'R. Lopes': [3, K], 'Diney': [4, K],
  'K. Rocha': [3, K], 'J. Monteiro': [4, K], 'D. Duarte': [4, K], 'G. Rodrigues': [3, K], 'Bebé': [4, K], 'Ryan Mendes': [3, K],
};

// Resolve a player's look by name → { skin: hex, hair: hex }. Neutral fallback
// (olive skin, dark-brown hair) for placeholder/unknown names.
export function playerLook(name) {
  const l = PLAYER_LOOKS[name];
  return { skin: SKIN_TONES[l ? l[0] : 2], hair: l ? l[1] : DB };
}

// --- kit resolution ---------------------------------------------------------

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function kitDist(h1, h2) {
  const a = rgb(h1), b = rgb(h2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const CLASH = 100;

// Deterministic (host and clients compute the same answer):
// team A wears home; team B switches to away on a shirt clash; each GK gets a
// color that reads against both outfield shirts and the other keeper.
export function resolveKits(aDef, bDef) {
  const a = { ...aDef.home };
  let b = kitDist(a.shirt, bDef.home.shirt) < CLASH ? { ...bDef.away } : { ...bDef.home };
  if (kitDist(a.shirt, b.shirt) < CLASH) {
    b = kitDist(a.shirt, bDef.home.shirt) >= kitDist(a.shirt, bDef.away.shirt)
      ? { ...bDef.home } : { ...bDef.away };
  }
  // max-min separation vs both outfield shirts and the other keeper,
  // with a small bias toward the nation's real keeper kit
  const pickGK = (def, other) => {
    let best = def.home.gk, bestScore = -1;
    for (const c of [def.home.gk, def.away.gk, '#454549', '#e08a3a', '#b58fc9']) {
      const sep = Math.min(
        kitDist(c, a.shirt), kitDist(c, b.shirt),
        other ? kitDist(c, other) * 1.3 : 1e9,
      ) * (c === def.home.gk ? 1.15 : 1);
      if (sep > bestScore) { bestScore = sep; best = c; }
    }
    return best;
  };
  a.gk = pickGK(aDef, b.gk);
  b.gk = pickGK(bDef, a.gk);
  return { a, b };
}
