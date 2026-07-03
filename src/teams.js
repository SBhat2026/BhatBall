// 16 nations, flag colors softened into pastel/matte kit palettes.
// xi: current-era starting elevens [number, name], ordered GK · DF×4 · MF×3 · FW×3
// to match the 4-3-3 FORMATION slots. (Brazil built around Militão/Rodrygo/Estevão injuries.)
export const TEAMS = [
  { code: 'BRA', name: 'Brazil',      shirt: '#f2dd8c', sleeve: '#96cfa6', shorts: '#9db8e0', gk: '#c3b3e3',
    xi: [[1,'Alisson'],[2,'Danilo'],[4,'Marquinhos'],[3,'Gabriel'],[16,'Arana'],[5,'Casemiro'],[8,'Guimarães'],[10,'Paquetá'],[11,'Raphinha'],[9,'João Pedro'],[7,'Vinícius Jr']] },
  { code: 'ARG', name: 'Argentina',   shirt: '#b7d9f2', sleeve: '#f7f6f0', shorts: '#5c6478', gk: '#b3d9c9',
    xi: [[23,'E. Martínez'],[26,'Molina'],[13,'Romero'],[25,'Otamendi'],[3,'Tagliafico'],[7,'De Paul'],[24,'Enzo'],[20,'Mac Allister'],[11,'Garnacho'],[9,'J. Álvarez'],[10,'Messi']] },
  { code: 'FRA', name: 'France',      shirt: '#93a5d6', sleeve: '#f4f3ef', shorts: '#f4f3ef', gk: '#e0c39a',
    xi: [[16,'Maignan'],[5,'Koundé'],[17,'Saliba'],[4,'Upamecano'],[22,'T. Hernández'],[8,'Tchouaméni'],[6,'Camavinga'],[7,'Griezmann'],[15,'Barcola'],[10,'Mbappé'],[11,'Dembélé']] },
  { code: 'GER', name: 'Germany',     shirt: '#f5f3ee', sleeve: '#6f6f76', shorts: '#6f6f76', gk: '#a6d9b8',
    xi: [[1,'ter Stegen'],[6,'Kimmich'],[2,'Rüdiger'],[15,'Tah'],[18,'Mittelstädt'],[16,'Pavlović'],[21,'Gündoğan'],[10,'Musiala'],[17,'Wirtz'],[7,'Havertz'],[19,'Sané']] },
  { code: 'ESP', name: 'Spain',       shirt: '#e59a94', sleeve: '#f0d28c', shorts: '#7c88b5', gk: '#a8d5d0',
    xi: [[23,'U. Simón'],[2,'Carvajal'],[3,'Le Normand'],[14,'Laporte'],[24,'Cucurella'],[16,'Rodri'],[8,'Pedri'],[10,'D. Olmo'],[17,'N. Williams'],[21,'Oyarzabal'],[19,'L. Yamal']] },
  { code: 'ENG', name: 'England',     shirt: '#f6f5f0', sleeve: '#a9b9d9', shorts: '#8a97b8', gk: '#e5b8c8',
    xi: [[1,'Pickford'],[2,'Alexander-Arnold'],[5,'Stones'],[6,'Guéhi'],[3,'Shaw'],[4,'Rice'],[10,'Bellingham'],[11,'Palmer'],[18,'Gordon'],[9,'Kane'],[7,'Saka']] },
  { code: 'ITA', name: 'Italy',       shirt: '#9dc6e8', sleeve: '#f4f4ef', shorts: '#f4f4ef', gk: '#d9c79a',
    xi: [[1,'Donnarumma'],[2,'Di Lorenzo'],[23,'Bastoni'],[5,'Calafiori'],[3,'Dimarco'],[18,'Barella'],[8,'Tonali'],[16,'Frattesi'],[10,'Zaccagni'],[9,'Retegui'],[14,'Chiesa']] },
  { code: 'POR', name: 'Portugal',    shirt: '#dc8f8f', sleeve: '#8fbf9f', shorts: '#8fbf9f', gk: '#b8bde0',
    xi: [[22,'D. Costa'],[20,'Cancelo'],[4,'R. Dias'],[3,'Inácio'],[19,'N. Mendes'],[23,'Vitinha'],[8,'B. Fernandes'],[18,'J. Neves'],[17,'R. Leão'],[7,'Ronaldo'],[10,'B. Silva']] },
  { code: 'NED', name: 'Netherlands', shirt: '#f2b083', sleeve: '#f7f2ea', shorts: '#f7f2ea', gk: '#a9c9e5',
    xi: [[1,'Verbruggen'],[22,'Dumfries'],[3,'De Ligt'],[4,'Van Dijk'],[5,'Aké'],[14,'Reijnders'],[21,'F. de Jong'],[7,'Simons'],[11,'Gakpo'],[10,'Depay'],[18,'Malen']] },
  { code: 'JPN', name: 'Japan',       shirt: '#8c94c9', sleeve: '#f5f5f2', shorts: '#f5f5f2', gk: '#e5c9a0',
    xi: [[23,'Z. Suzuki'],[2,'Sugawara'],[4,'Itakura'],[22,'Tomiyasu'],[26,'Itō'],[6,'Endō'],[17,'Morita'],[15,'Kamada'],[7,'Mitoma'],[9,'Ueda'],[11,'Kubo']] },
  { code: 'USA', name: 'USA',         shirt: '#f5f5f0', sleeve: '#e6a2a2', shorts: '#93a3cc', gk: '#a8dcc8',
    xi: [[1,'M. Turner'],[2,'Dest'],[3,'C. Richards'],[13,'Ream'],[5,'A. Robinson'],[4,'T. Adams'],[8,'McKennie'],[7,'Reyna'],[10,'Pulisic'],[9,'Balogun'],[21,'Weah']] },
  { code: 'MEX', name: 'Mexico',      shirt: '#9ec9a6', sleeve: '#f5f4ef', shorts: '#f5f4ef', gk: '#d8a9c0',
    xi: [[13,'Malagón'],[2,'J. Sánchez'],[3,'C. Montes'],[5,'J. Vásquez'],[23,'J. Gallardo'],[4,'E. Álvarez'],[18,'L. Chávez'],[26,'G. Mora'],[11,'A. Vega'],[9,'S. Giménez'],[22,'H. Lozano']] },
  { code: 'CRO', name: 'Croatia',     shirt: '#e6a5a5', sleeve: '#f6f6f3', shorts: '#a5b7d8', gk: '#c9d8a0',
    xi: [[1,'Livaković'],[2,'Stanišić'],[24,'Šutalo'],[20,'Gvardiol'],[19,'Sosa'],[10,'Modrić'],[8,'Kovačić'],[11,'Brozović'],[14,'Perišić'],[17,'Budimir'],[7,'Majer']] },
  { code: 'MAR', name: 'Morocco',     shirt: '#d69494', sleeve: '#98bf9f', shorts: '#98bf9f', gk: '#b0b9df',
    xi: [[1,'Bounou'],[2,'Hakimi'],[5,'Aguerd'],[24,'Dari'],[25,'Mazraoui'],[4,'Amrabat'],[8,'Ounahi'],[26,'El Khannouss'],[7,'Ziyech'],[19,'En-Nesyri'],[10,'B. Díaz']] },
  { code: 'URU', name: 'Uruguay',     shirt: '#a8cde8', sleeve: '#f5f4ef', shorts: '#5c6478', gk: '#e0d09a',
    xi: [[23,'Rochet'],[2,'Nández'],[4,'R. Araújo'],[22,'Coates'],[16,'M. Olivera'],[15,'Valverde'],[5,'Ugarte'],[10,'De La Cruz'],[8,'Pellistri'],[9,'Núñez'],[7,'F. Torres']] },
  { code: 'BEL', name: 'Belgium',     shirt: '#d99a9a', sleeve: '#f0d28c', shorts: '#5c6478', gk: '#a6cfd9',
    xi: [[1,'Courtois'],[21,'Castagne'],[3,'Debast'],[4,'Faes'],[5,'Theate'],[24,'Onana'],[7,'De Bruyne'],[8,'Tielemans'],[11,'Doku'],[9,'Lukaku'],[17,'Trossard']] },
];

export const SKIN_TONES = ['#f2cfae', '#e5b58f', '#cf9a6e', '#a97753', '#8a5f42'];
