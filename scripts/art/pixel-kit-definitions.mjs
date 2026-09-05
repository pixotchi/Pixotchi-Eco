// Original Pixotchi UI artwork. Pixel coordinates are the editable source of truth.
// No AI raster masters, traced legacy art, external fonts, or drawing libraries.
export const palette = {
  ink: '#253044', inkLight: '#45536b', cream: '#fff4d6', white: '#f4fcf0',
  greenDark: '#286044', green: '#48974c', greenLight: '#83c65b', lime: '#c8e887',
  brownDark: '#704638', brown: '#a56842', clay: '#d99454', sand: '#edc58a',
  goldDark: '#ad702c', gold: '#e8ad39', yellow: '#ffda69', paleGold: '#fff0a5',
  blueDark: '#346086', blue: '#408fb5', aqua: '#68c8d8', ice: '#c0f0e7',
  purpleDark: '#62457d', purple: '#9570ad', lilac: '#c7a4d2', blush: '#f0d6e5',
  redDark: '#993f48', red: '#d76462', coral: '#f59b83',
  grey: '#81959f', silver: '#b8cbcc',
};

export class Pixels {
  constructor(size) { this.size = size; this.data = Array(size * size).fill(null); }
  pixel(x, y, color) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw Error('Pixel coordinates must be integers');
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) throw Error(`Pixel outside ${this.size}px artboard: ${x},${y}`);
    this.data[y * this.size + x] = palette[color] || color; return this;
  }
  rect(x, y, w, h, color) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.pixel(xx, yy, color); return this; }
  poly(points, color) {
    // Point-in-polygon at cell centres produces actual square pixels, never diagonal SVG edges.
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if (((yi > y + .5) !== (yj > y + .5)) && (x + .5 < (xj - xi) * (y + .5 - yi) / (yj - yi) + xi)) inside = !inside;
      }
      if (inside) this.pixel(x, y, color);
    }
    return this;
  }
  line(x, y, x2, y2, color, weight = 1) {
    const dx = Math.abs(x2 - x), sx = x < x2 ? 1 : -1, dy = -Math.abs(y2 - y), sy = y < y2 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.rect(x, y, weight, weight, color);
      if (x === x2 && y === y2) break;
      const e2 = error * 2;
      if (e2 >= dy) { error += dy; x += sx; }
      if (e2 <= dx) { error += dx; y += sy; }
    }
    return this;
  }
  outline() {
    const old = [...this.data];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      if (!old[y * this.size + x]) continue;
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= this.size || yy >= this.size) throw Error('Silhouette needs transparent padding');
        if (!old[yy * this.size + xx]) this.data[yy * this.size + xx] = palette.ink;
      }
    }
    return this;
  }
}

const assets = [];
const add = (id, group, label, size, draw, legacy = [], notes = '', outline = true) => {
  const p = new Pixels(size); draw(p); if (outline) p.outline();
  assets.push({ id, group, label, size, pixels: p.data, legacy, notes });
};
const old = name => `/icons/${name}`;
const leaf = (p,x,y,s=1) => {
  p.poly([[x,y+5*s],[x+5*s,y],[x+9*s,y],[x+9*s,y+5*s],[x+4*s,y+9*s],[x,y+9*s]],'green');
  p.poly([[x,y+5*s],[x+5*s,y],[x+8*s,y],[x+3*s,y+7*s],[x,y+8*s]],'greenLight');
  p.line(x+1,y+8*s,x+7*s,y+2*s,'greenDark',s);
};
const sparkle = (p,x,y,c='paleGold') => p.rect(x,y-1,1,3,c).rect(x-1,y,3,1,c);
const bolt = (p,c='gold',h='paleGold') => p.poly([[7,2],[12,2],[9,6],[13,6],[5,14],[7,9],[3,9]],c).rect(7,3,3,1,h).rect(6,4,1,3,h);
const shield = (p,c='aqua') => p.poly([[3,3],[7,2],[12,3],[12,8],[10,11],[7,13],[4,11],[3,8]],c).poly([[8,4],[11,4],[11,8],[9,11],[8,12]],'blue').line(4,4,4,7,'ice');
const crown = (p,c,h) => p.poly([[3,4],[5,7],[7,3],[10,7],[12,4],[12,12],[3,12]],c).rect(3,10,9,1,h).rect(7,5,1,2,h);
const sprout = (p,x=7,y=3) => p.rect(x,y+3,2,6,'greenDark').poly([[x,y+4],[x-3,y+4],[x-5,y+2],[x-5,y],[x-2,y],[x,y+2]],'green').poly([[x+1,y+3],[x+1,y],[x+4,y-1],[x+6,y-1],[x+6,y+1],[x+4,y+3]],'greenLight');
const pot = p => { sprout(p,7,3); p.rect(3,10,10,2,'clay').rect(4,12,8,1,'brown').rect(5,13,6,1,'clay').rect(4,10,7,1,'sand'); };
const sword = (p,mirror=false,blade='lilac') => {
  const q = new Pixels(16);
  q.poly([[10,2],[13,2],[13,5],[7,11],[4,8]],blade).line(6,8,11,3,'white').line(4,11,3,12,'brown',2).line(4,7,8,11,'gold');
  for(let y=0;y<16;y++) for(let x=0;x<16;x++) if(q.data[y*16+x]) p.pixel(mirror?15-x:x,y,q.data[y*16+x]);
};

// HUD: distinct silhouettes keep PTS, TOD, XP, level and stars distinguishable.
add('pts','status','PTS',16,p=>bolt(p),[old('pts.svg')],'Amber lightning = plant points. Do not use for XP.');
add('tod','status','TOD',16,p=>{
  p.rect(3,2,10,2,'brown').rect(3,12,10,2,'brown').rect(4,2,8,1,'sand');
  p.poly([[5,4],[11,4],[10,6],[8,8],[10,10],[11,12],[5,12],[6,10],[8,8],[6,6]],'ice');
  p.rect(6,5,4,1,'gold').rect(7,6,2,1,'gold').rect(7,9,2,1,'gold').rect(6,10,4,2,'yellow');
},[old('tod.svg')],'Time until plant death; never a generic cooldown timer.');
add('health','status','Plant health',16,p=>p.poly([[2,5],[4,3],[6,3],[8,5],[10,3],[12,3],[14,5],[14,8],[8,14],[2,8]],'red').poly([[10,5],[13,5],[13,8],[8,13],[8,11],[11,8]],'redDark').rect(4,4,2,2,'coral'),[old('HEART.svg')]);
add('star','status','Stars',16,p=>p.poly([[8,2],[10,6],[14,6],[11,9],[12,13],[8,11],[4,13],[5,9],[2,6],[6,6]],'gold').poly([[8,3],[9,7],[12,7],[9,9],[8,10],[6,11],[6,8],[4,7],[7,7]],'yellow'),[old('Star.svg')]);
add('xp','status','Experience',16,p=>p.poly([[7,2],[12,6],[12,10],[7,14],[3,10],[3,6]],'purple').poly([[7,2],[8,7],[7,13],[3,9],[3,6]],'lilac').line(7,4,7,10,'blush'),[],'Use for land/farmer experience; currently pts.svg is overloaded for XP/EXP.');
add('level','status','Level',16,p=>p.poly([[3,6],[8,2],[13,6],[13,9],[8,5],[3,9]],'greenLight').poly([[3,11],[8,7],[13,11],[13,14],[8,10],[3,14]],'green'),[old('level.svg')]);
add('clock','status','Cooldown',16,p=>p.poly([[5,2],[11,2],[14,5],[14,11],[11,14],[5,14],[2,11],[2,5]],'sand').poly([[5,3],[11,3],[13,5],[13,10],[10,13],[5,13],[3,10],[3,5]],'cream').rect(7,4,2,5,'brown').rect(9,8,3,2,'brown'),[old('clock.svg')]);
add('skull','status','Dead plant',16,p=>p.poly([[5,2],[11,2],[13,4],[13,9],[11,10],[11,13],[5,13],[5,10],[3,9],[3,4]],'cream').rect(4,5,3,3,'ink').rect(9,5,3,3,'ink').rect(7,9,2,1,'brown').rect(6,12,1,2,'brown').rect(9,12,1,2,'brown'),[old('skull.png')]);
add('rock','resources','Rocks',16,p=>p.poly([[5,3],[9,2],[13,5],[14,10],[11,13],[4,13],[2,10],[2,6]],'grey').poly([[8,4],[12,6],[13,10],[10,12],[8,9]],'inkLight').poly([[3,7],[5,4],[8,3],[7,6],[4,8]],'silver').line(5,9,7,7,'inkLight').rect(4,10,2,1,'inkLight'),[old('Volcanic_Rock.svg')]);
add('leaf','resources','LEAF reward',16,p=>leaf(p,3,3),[old('spinleaf.png')],'Standalone arcade leaf. LEAF token branding remains separately identified.');
add('fire','resources','Burn',16,p=>p.poly([[8,2],[11,6],[11,4],[13,8],[13,11],[10,14],[5,14],[2,11],[3,7],[5,9],[6,5]],'red').poly([[8,6],[10,10],[11,9],[11,12],[9,13],[6,13],[4,11],[6,9],[7,10]],'gold').rect(7,10,2,3,'paleGold'),[old('fire.svg')]);
add('tax','resources','Fee',16,p=>p.rect(2,4,12,8,'green').rect(3,5,10,5,'greenLight').rect(6,5,4,5,'gold').rect(7,6,2,3,'paleGold').rect(3,11,10,1,'greenDark'),[old('tax.svg')]);
add('shield','combat','Protection',16,p=>shield(p),[old('Shield.png')]);
add('defense','combat','Defense power',16,p=>{shield(p,'greenLight');p.rect(7,4,2,6,'cream').rect(5,6,6,2,'cream');},[old('defpwr.svg')]);
add('attack','combat','Attack power',16,p=>{sword(p,true);sword(p);},[old('attackpwr.svg')]);
add('victory','combat','Attack won',16,p=>{sword(p);p.rect(9,9,5,5,'greenDark').line(10,11,11,12,'lime').line(11,12,13,10,'lime');},[old('Attackwon.png')]);
add('defeat','combat','Attack lost',16,p=>{sword(p);p.rect(9,9,5,5,'redDark').line(10,10,12,12,'cream').line(10,12,12,10,'cream');},[old('Attacklost.png')]);
add('swordsman','combat','Swordsman',16,p=>sword(p),[old('swordsman.png')]);
add('phalanx','combat','Phalanx',16,p=>p.line(6,7,11,12,'brown',2).line(7,8,11,12,'sand').poly([[5,2],[7,4],[10,3],[9,6],[11,8],[8,9],[7,11],[5,8],[2,8],[3,5],[2,3],[5,4]],'grey').rect(5,5,3,3,'silver').rect(5,5,2,1,'white'),[old('phalanx.png')],'Preserve existing mace silhouette despite the troop name.');
for(const [id,label,c,h,file] of [['rank-gold','First place','gold','paleGold','1st.svg'],['rank-silver','Second place','grey','white','2nd.svg'],['rank-bronze','Third place','brown','sand','3rd.svg']]) add(id,'ranking',label,16,p=>crown(p,c,h),[old(file)]);

// Plant shop: exactly the ten entries from lib/constants.ts ITEM_ICONS.
add('magic-soil','items','Magic soil',32,p=>{
  p.poly([[4,23],[8,19],[11,19],[13,16],[20,16],[24,20],[27,22],[28,26],[4,26]],'brown');
  p.poly([[4,24],[12,22],[16,19],[22,20],[27,23],[28,26],[4,26]],'brownDark');
  p.rect(10,20,3,2,'clay').rect(17,18,3,2,'sand').rect(21,23,3,2,'purple').rect(7,24,2,1,'lilac');
  p.rect(15,11,2,7,'greenDark').poly([[16,13],[17,9],[21,7],[24,7],[23,10],[19,13]],'greenLight').poly([[15,13],[11,12],[9,9],[12,9],[15,11]],'green');
  sparkle(p,6,13,'lilac');
},[old('SOIL.png')]);
add('sunlight','items','Sunlight',32,p=>{
  p.poly([[12,8],[20,8],[24,12],[24,20],[20,24],[12,24],[8,20],[8,12]],'gold');
  p.poly([[12,9],[19,9],[22,12],[22,18],[18,22],[12,21],[9,18],[9,12]],'yellow');
  p.rect(12,10,5,2,'paleGold').rect(10,12,2,4,'paleGold');
  p.rect(15,3,2,3,'yellow').rect(15,26,2,3,'gold').rect(3,15,3,2,'yellow').rect(26,15,3,2,'gold');
  p.line(6,6,7,7,'yellow',2).line(24,24,25,25,'gold',2).line(24,6,25,5,'yellow',2).line(5,24,6,23,'gold',2);
},[old('SUN.png')]);
add('water','items','Water',32,p=>{
  p.poly([[6,24],[11,22],[22,22],[26,24],[26,26],[22,28],[9,28],[5,26]],'blue').rect(9,24,14,2,'aqua').rect(12,25,8,1,'ice');
  p.poly([[16,3],[19,9],[24,16],[24,20],[21,23],[11,23],[8,20],[8,16],[13,9]],'blue');
  p.poly([[16,4],[18,10],[21,15],[21,19],[18,22],[12,21],[9,18],[10,14]],'aqua');
  p.poly([[15,9],[15,13],[12,17],[12,19],[10,18],[11,14]],'ice');p.rect(14,6,1,2,'ice');
},[old('WATERDROPS.png')]);
add('fertilizer','items','Fertilizer',32,p=>{
  p.poly([[10,4],[22,4],[20,9],[24,15],[25,24],[22,27],[9,27],[6,24],[7,15],[12,9]],'sand');
  p.poly([[19,9],[23,15],[24,24],[21,26],[9,26],[9,24],[20,24],[21,20]],'clay');
  p.rect(10,8,12,3,'brown').rect(11,8,9,1,'gold').rect(9,15,2,7,'cream');
  p.rect(15,16,2,7,'greenDark').poly([[15,20],[11,18],[11,15],[14,16],[16,18],[17,15],[21,14],[20,18],[17,20]],'green');
},[old('FERTILIZER.png')]);
add('dream-dew','items','Dream dew',32,p=>{
  p.rect(12,3,8,3,'brown').rect(12,3,6,1,'sand').rect(12,7,8,3,'lilac');
  p.poly([[12,10],[20,10],[24,14],[24,24],[21,27],[11,27],[8,24],[8,14]],'purple');
  p.poly([[10,15],[22,15],[22,24],[20,25],[11,25],[10,23]],'purpleDark').rect(10,15,12,2,'lilac');
  p.rect(10,11,2,3,'blush').rect(9,15,1,6,'blush').rect(13,19,2,4,'paleGold').rect(15,22,4,2,'paleGold').rect(17,21,2,1,'paleGold');
  sparkle(p,26,8,'lilac');
},[old('DREAMDEW.png')]);
add('pollinator','items','Pollinator',32,p=>{
  p.poly([[12,13],[7,12],[5,8],[6,5],[10,5],[13,9],[15,13]],'ice');
  p.poly([[16,12],[18,7],[22,4],[26,5],[27,8],[23,12],[20,14]],'ice');
  p.line(7,7,11,11,'white',2).line(21,7,24,6,'white',2);
  p.poly([[7,15],[10,12],[19,12],[23,15],[25,15],[23,18],[21,22],[12,23],[8,20]],'gold');
  p.poly([[9,18],[22,18],[20,21],[12,22]],'goldDark');
  p.rect(13,13,3,9,'brownDark').rect(19,13,3,7,'brownDark').rect(9,14,3,2,'yellow').rect(10,16,2,2,'ink');
  p.line(10,11,9,9,'ink').line(9,23,8,25,'ink').line(18,23,19,25,'ink');
},[old('BEE.png')]);
add('fence','items','Fence',32,p=>{
  p.rect(4,13,24,3,'brown').rect(4,21,24,3,'brown').rect(4,13,24,1,'sand');
  for(const x of [6,14,22]) {p.poly([[x,10],[x+2,7],[x+4,10],[x+4,27],[x,27]],'clay').rect(x,11,1,15,'sand').rect(x+3,11,1,16,'brown').rect(x+1,14,1,1,'brownDark').rect(x+1,22,1,1,'brownDark');}
  p.poly([[10,26],[11,23],[14,23],[13,26]],'green').rect(17,26,3,1,'greenLight');
},[old('Fence.png')],'Inventory fence only; no land/building artwork is replaced.');
add('botano','items','Botano',32,p=>{
  p.poly([[14,4],[24,4],[19,12],[26,12],[10,28],[13,18],[6,18]],'blue');
  p.poly([[14,5],[22,5],[17,13],[23,13],[11,26],[15,16],[8,16]],'aqua');
  p.rect(14,6,5,2,'ice').line(13,9,10,14,'ice');
},[old('botano.svg')],'Cyan bolt preserves Botano recognition; PTS uses amber.');
add('moonlight','items','Moonlight',32,p=>{
  p.poly([[13,4],[20,4],[17,7],[15,11],[15,17],[18,21],[23,22],[26,20],[26,23],[22,27],[15,28],[9,25],[5,20],[4,14],[7,8]],'purple');
  p.poly([[13,5],[17,5],[13,10],[12,17],[16,23],[21,25],[16,27],[10,24],[6,19],[6,13],[8,9]],'lilac');
  p.line(8,11,11,7,'blush',2).rect(6,14,2,4,'blush');sparkle(p,24,9,'paleGold');
},[old('moonlight.png')]);
add('nitro','items','Nitro',32,p=>{
  p.poly([[4,23],[4,14],[7,9],[12,6],[20,6],[25,9],[28,14],[28,23]],'silver');
  p.poly([[6,21],[6,14],[9,10],[13,8],[20,8],[24,11],[26,15],[26,21]],'cream');
  p.poly([[7,14],[9,11],[12,9],[14,11],[11,13],[10,16]],'green');p.rect(14,9,5,3,'gold');
  p.poly([[21,10],[24,13],[25,17],[22,17],[20,13]],'red');
  p.line(15,20,22,12,'ink',2).rect(13,18,5,5,'brown').rect(14,19,3,2,'gold');p.rect(6,24,20,2,'inkLight');
},[old('Nitro.png')],'Retains the speedometer metaphor.');

add('arcade','arcade','Arcade',32,p=>{
  p.poly([[8,4],[24,4],[25,7],[24,19],[27,23],[26,28],[6,28],[5,23],[8,19]],'purple');
  p.rect(9,5,14,3,'lilac').rect(10,5,10,1,'blush').rect(9,10,14,9,'ink');
  p.rect(10,11,12,7,'greenDark').rect(15,13,2,4,'lime').rect(12,12,3,2,'greenLight').rect(17,11,3,3,'greenLight');
  p.rect(8,21,16,3,'lilac').rect(10,20,2,3,'ink').rect(9,20,4,1,'red').rect(19,22,2,1,'gold');
  p.rect(9,25,14,2,'purpleDark').rect(15,25,3,1,'cream');
},[old('GAME.png')]);
add('box','arcade','Mystery box',32,p=>{
  p.poly([[5,11],[15,7],[27,11],[27,25],[16,29],[5,25]],'brown');
  p.poly([[6,12],[16,16],[16,28],[6,24]],'clay').poly([[17,16],[26,12],[26,24],[17,28]],'brown');
  p.poly([[6,11],[15,8],[26,11],[16,15]],'sand');p.line(12,9,22,13,'brown').line(22,14,22,24,'goldDark');
  p.line(7,17,14,20,'sand').rect(11,13,3,12,'gold').rect(12,18,2,3,'brownDark');
},[old('box.png')]);
add('spin-leaf','arcade','Spin reward',32,p=>{leaf(p,7,5,2);p.line(9,23,6,27,'brown',2);},[old('spinleaf.png')]);
add('playing-cards','arcade','Cards',32,p=>{
  p.rect(5,7,15,20,'purpleDark').rect(6,8,13,18,'lilac').rect(9,4,17,22,'cream').rect(10,5,15,20,'white');
  p.poly([[17,9],[23,15],[17,21],[11,15]],'red').rect(11,6,2,2,'red').rect(22,22,2,2,'red');
},[],'Menu icon only. PlayingCard suit/rank faces stay textual and accessible.');

// Own-token proposals retain gold SEED / silver LEAF and a sprout over soil.
for(const [id,label,base,light,shade,legacy] of [['seed-token','SEED token','gold','paleGold','goldDark','/PixotchiKit/COIN.svg'],['leaf-token','LEAF token','silver','white','grey','/icons/leaf.png']]) {
  add(id,'tokens',label,32,p=>{
    p.poly([[10,3],[22,3],[28,9],[28,23],[22,29],[10,29],[4,23],[4,9]],shade);
    p.poly([[10,4],[22,4],[27,9],[27,22],[22,27],[10,27],[5,22],[5,9]],base);
    p.poly([[11,6],[21,6],[25,10],[25,21],[21,25],[11,25],[7,21],[7,10]],light);
    p.poly([[9,21],[13,19],[20,19],[24,21],[21,24],[12,24]],'brown').rect(15,12,2,9,'greenDark');
    p.poly([[15,16],[11,15],[9,12],[9,10],[12,10],[15,13]],'green').poly([[17,14],[17,10],[21,8],[23,8],[23,11],[20,14]],'greenLight');
    p.line(7,8,10,5,light);p.rect(6,10,1,6,light);
  },[legacy],'Game HUD proposal only. Review token brand usage separately before replacing official logos.');
}

// Navigation and feature symbols. These represent actions, not NFT identities.
add('garden','navigation','Garden',16,p=>pot(p));
add('mint','navigation','Mint',16,p=>{sprout(p,7,4);p.rect(3,12,6,2,'clay').rect(11,9,2,5,'gold').rect(9,11,5,1,'gold');});
add('activity','navigation','Activity',16,p=>{p.rect(3,2,10,12,'sand').rect(4,3,8,10,'cream').rect(5,4,5,1,'brown').line(5,10,6,8,'greenDark').line(6,8,8,10,'greenDark').line(8,10,10,6,'greenDark');});
add('ranking','navigation','Ranking',16,p=>p.rect(4,3,8,6,'gold').rect(5,3,5,1,'paleGold').rect(5,9,6,1,'gold').rect(7,10,2,2,'goldDark').rect(5,12,6,2,'gold').line(2,4,2,7,'gold').line(13,4,13,7,'gold').rect(3,7,1,2,'gold').rect(12,7,1,2,'gold'));
add('swap','navigation','Swap',16,p=>p.rect(3,4,8,2,'aqua').poly([[10,2],[14,5],[10,8]],'aqua').rect(5,10,8,2,'greenLight').poly([[6,8],[2,11],[6,14]],'greenLight'));
add('about','navigation','About',16,p=>p.rect(3,3,5,10,'sand').rect(8,3,5,10,'clay').rect(4,4,3,7,'cream').rect(9,4,3,7,'sand').rect(7,3,1,10,'brown').rect(5,5,1,4,'green'));
add('shop','navigation','Plant shop',16,p=>p.rect(3,6,10,8,'clay').rect(4,7,8,6,'sand').rect(5,3,1,4,'brown').rect(10,3,1,4,'brown').rect(6,2,4,1,'brown').rect(7,8,2,4,'greenDark').rect(6,8,4,2,'greenLight'));
add('tasks','navigation','Tasks',16,p=>p.rect(3,3,10,11,'brown').rect(4,4,8,9,'cream').rect(6,2,4,3,'gold').line(5,8,6,9,'greenDark').line(6,9,10,6,'greenDark').rect(5,11,5,1,'clay'));
add('chat','navigation','Chat',16,p=>p.poly([[4,3],[12,3],[14,5],[14,10],[12,12],[8,12],[5,14],[5,12],[2,10],[2,5]],'cream').rect(4,6,2,2,'inkLight').rect(7,6,2,2,'inkLight').rect(10,6,2,2,'inkLight'),[old('chat-icon.webp')]);
add('wallet','navigation','Wallet',16,p=>p.rect(2,4,11,9,'brown').rect(3,3,9,2,'sand').rect(3,5,10,1,'clay').rect(9,7,5,4,'clay').rect(10,8,2,2,'gold'));
add('quest','navigation','Quest',16,p=>p.rect(4,3,8,9,'sand').rect(3,2,9,2,'cream').rect(4,4,7,7,'cream').rect(4,11,9,2,'clay').rect(10,3,2,8,'sand').rect(5,5,4,1,'brown').rect(5,7,3,1,'brown').rect(6,9,2,1,'red'));
add('inventory','navigation','Inventory',16,p=>p.rect(5,2,6,2,'brown').rect(3,5,10,9,'clay').rect(4,4,8,3,'sand').rect(5,9,6,4,'brown').rect(6,9,4,1,'sand').rect(7,7,2,2,'gold'));
add('gift','actions','Claim reward',16,p=>p.rect(3,7,10,7,'green').rect(2,5,12,3,'greenLight').rect(7,5,2,9,'gold').poly([[7,5],[3,4],[3,2],[5,2],[8,5],[10,2],[12,2],[12,4],[9,5]],'gold'));
add('location','actions','Coordinates',16,p=>p.poly([[5,2],[11,2],[13,4],[13,8],[8,14],[3,8],[3,4]],'blue').poly([[5,3],[10,3],[12,5],[12,7],[8,11],[4,7],[4,5]],'aqua').rect(6,5,4,3,'ice'),[old('location.svg')]);
add('edit','actions','Rename',16,p=>p.poly([[10,3],[13,5],[6,12],[2,14],[3,10]],'gold').line(4,10,10,4,'yellow').poly([[10,3],[11,2],[14,4],[13,5]],'coral').rect(3,12,1,1,'brown'),[old('pencil.svg')]);
add('verified','status','Verified',16,p=>p.poly([[6,2],[10,2],[11,4],[13,5],[13,10],[11,11],[10,13],[6,13],[5,11],[3,10],[3,5],[5,4]],'blue').line(5,7,7,9,'ice').line(7,9,11,5,'ice'),[old('verified.svg')],'Generic in-game confirmation; preserve official Base/EFP verification marks in branded contexts.');

// Optional avatar refresh for game-owned default portraits (not connected user avatars).
for(const [id,label,hat,legacy] of [['farmer','Farmer portrait',false,'avatar2-icon.webp'],['gardener','Gardener portrait',true,'avatar1-icon.webp']]) add(id,'portraits',label,32,p=>{
  p.poly([[8,29],[8,25],[12,22],[20,22],[24,25],[24,29]],'greenDark').rect(12,24,8,5,'green').rect(13,23,6,2,'sand');
  p.rect(10,10,12,12,'sand').rect(10,17,2,4,'clay').rect(21,15,1,5,'clay').rect(10,9,12,5,'brownDark').rect(9,13,2,5,'brownDark');
  p.rect(12,14,3,2,'ink').rect(18,14,3,2,'ink').rect(15,19,3,1,'brown').rect(10,17,2,1,'coral').rect(21,17,1,1,'coral');
  if(hat) p.rect(5,10,22,3,'clay').rect(7,9,18,2,'sand').rect(10,4,12,6,'gold').rect(11,4,9,2,'paleGold').rect(10,8,12,2,'greenDark');
  else p.poly([[10,9],[10,5],[13,6],[15,3],[17,5],[21,4],[23,8],[23,12],[19,10],[16,11],[14,9]],'inkLight').rect(12,7,6,2,'grey');
},[old(legacy)]);
add('neural-seed','portraits','Neural Seed',32,p=>{
  p.rect(8,26,16,2,'clay').rect(10,28,12,1,'brown').rect(8,25,16,1,'sand');
  p.rect(12,12,8,10,'silver').rect(11,11,10,8,'silver').rect(11,10,10,2,'ice').rect(12,13,8,4,'ink').rect(13,14,2,2,'lime').rect(17,14,2,2,'lime');
  p.rect(14,19,4,1,'blue').rect(9,19,2,3,'grey').rect(21,19,2,3,'grey').rect(14,22,4,1,'aqua');
  p.rect(15,6,2,4,'greenDark').poly([[15,7],[11,6],[10,3],[13,3],[16,6],[18,3],[22,3],[20,6],[17,7]],'greenLight');
},[old('neuralseed.png')]);

// Utility family: currentColor only, drawn at 16px. Identical geometry also gets
// explicit dark/light PNGs because external SVG <img> cannot inherit currentColor.
const mono = (id,label,draw) => add(id,'utility',label,16,draw,[],'Inline SVG uses currentColor; external SVG defaults to ink. Use the light PNG on dark surfaces.',false);
mono('chevron-left','Previous',p=>p.line(10,3,5,8,'currentColor',2).line(5,8,10,13,'currentColor',2));
mono('chevron-right','Next',p=>p.line(4,3,9,8,'currentColor',2).line(9,8,4,13,'currentColor',2));
mono('chevron-down','Expand',p=>p.line(3,5,7,9,'currentColor',2).line(7,9,11,5,'currentColor',2));
mono('chevron-up','Collapse',p=>p.line(3,9,7,5,'currentColor',2).line(7,5,11,9,'currentColor',2));
mono('plus','Add',p=>p.rect(7,3,2,10,'currentColor').rect(3,7,10,2,'currentColor'));
mono('minus','Remove',p=>p.rect(3,7,10,2,'currentColor'));
mono('close','Close',p=>p.line(3,3,11,11,'currentColor',2).line(3,11,11,3,'currentColor',2));
mono('check','Confirm',p=>p.line(2,7,6,11,'currentColor',2).line(6,11,12,4,'currentColor',2));
mono('search','Search',p=>p.line(4,2,8,2,'currentColor',2).line(2,4,2,8,'currentColor',2).line(4,10,8,10,'currentColor',2).line(10,4,10,8,'currentColor',2).line(10,10,13,13,'currentColor',2).rect(3,3,1,1,'currentColor').rect(9,3,1,1,'currentColor').rect(3,9,1,1,'currentColor').rect(9,9,1,1,'currentColor'));
mono('copy','Copy',p=>p.rect(3,2,8,2,'currentColor').rect(3,2,2,10,'currentColor').rect(6,5,8,2,'currentColor').rect(6,5,2,9,'currentColor').rect(12,5,2,9,'currentColor').rect(6,12,8,2,'currentColor'));
mono('external-link','Open externally',p=>p.rect(8,2,6,2,'currentColor').rect(12,2,2,6,'currentColor').line(7,7,11,3,'currentColor',2).rect(2,4,2,10,'currentColor').rect(2,12,10,2,'currentColor').rect(2,4,4,2,'currentColor').rect(10,10,2,4,'currentColor'));
mono('refresh','Refresh',p=>p.line(4,3,10,3,'currentColor',2).rect(2,5,2,3,'currentColor').rect(10,5,4,2,'currentColor').rect(12,2,2,5,'currentColor').line(4,11,10,11,'currentColor',2).rect(12,8,2,3,'currentColor').rect(2,9,4,2,'currentColor').rect(2,9,2,5,'currentColor'));
mono('info','Information',p=>p.rect(7,3,2,2,'currentColor').rect(6,7,3,5,'currentColor').rect(5,12,6,2,'currentColor'));
mono('warning','Warning',p=>p.line(7,2,2,12,'currentColor').line(8,2,13,12,'currentColor').rect(2,12,12,2,'currentColor').rect(7,5,2,4,'currentColor').rect(7,10,2,1,'currentColor'));
mono('lock','Locked',p=>p.rect(3,7,10,7,'currentColor').rect(4,3,2,5,'currentColor').rect(10,3,2,5,'currentColor').rect(6,2,4,2,'currentColor').rect(7,9,2,3,null));
mono('unlock','Unlocked',p=>p.rect(3,7,10,7,'currentColor').rect(4,3,2,5,'currentColor').rect(10,3,2,2,'currentColor').rect(6,2,4,2,'currentColor').rect(7,9,2,3,null));
mono('send','Send',p=>p.poly([[2,2],[14,7],[2,14],[4,8]],'currentColor').line(5,8,10,7,null));
mono('play','Play',p=>p.poly([[5,3],[13,8],[5,13]],'currentColor'));
mono('pause','Pause',p=>p.rect(4,3,3,10,'currentColor').rect(9,3,3,10,'currentColor'));
mono('sound','Sound',p=>p.rect(2,6,3,5,'currentColor').poly([[5,6],[9,3],[9,14],[5,11]],'currentColor').rect(11,6,2,5,'currentColor'));
mono('mute','Muted',p=>p.rect(2,6,3,5,'currentColor').poly([[5,6],[9,3],[9,14],[5,11]],'currentColor').line(11,6,13,10,'currentColor').line(11,10,13,6,'currentColor'));
mono('more','More options',p=>p.rect(2,7,2,2,'currentColor').rect(7,7,2,2,'currentColor').rect(12,7,2,2,'currentColor'));
mono('filter','Filter',p=>p.rect(2,3,12,2,'currentColor').rect(4,7,8,2,'currentColor').rect(6,11,4,2,'currentColor'));
mono('sort','Sort',p=>p.rect(4,3,2,10,'currentColor').line(2,5,4,3,'currentColor').line(5,3,7,5,'currentColor').rect(10,3,2,10,'currentColor').line(8,10,10,12,'currentColor').line(11,12,13,10,'currentColor'));
mono('logout','Disconnect',p=>p.rect(2,2,6,2,'currentColor').rect(2,2,2,12,'currentColor').rect(2,12,6,2,'currentColor').rect(7,7,7,2,'currentColor').line(11,4,14,7,'currentColor').line(11,11,14,8,'currentColor'));

export const definitions = assets;

// Optical reductions are drawn separately, not resized from the 32px sprites.
export const compactDrawings = new Map();
const compact = (id,draw) => { const p=new Pixels(16);draw(p);p.outline();compactDrawings.set(id,{...assets.find(a=>a.id===id),size:16,pixels:p.data}); };
compact('magic-soil',p=>{p.poly([[2,11],[5,9],[10,9],[14,12],[14,14],[2,14]],'brown').rect(3,12,10,2,'brownDark').rect(5,10,2,1,'sand');sprout(p,7,3);});
compact('sunlight',p=>p.poly([[6,4],[10,4],[12,6],[12,10],[10,12],[6,12],[4,10],[4,6]],'gold').rect(6,5,4,4,'yellow').rect(7,2,2,1,'yellow').rect(7,13,2,1,'gold').rect(2,7,1,2,'yellow').rect(13,7,1,2,'gold'));
compact('water',p=>p.poly([[8,2],[10,6],[13,10],[13,12],[11,14],[5,14],[3,12],[3,10],[6,6]],'blue').poly([[8,3],[9,7],[11,10],[11,12],[9,13],[5,12],[4,10]],'aqua').rect(6,8,1,3,'ice'));
compact('fertilizer',p=>p.poly([[5,2],[11,2],[10,5],[12,8],[13,12],[11,14],[4,14],[3,12],[4,8],[6,5]],'sand').rect(5,5,6,1,'brown').rect(10,8,2,5,'clay').rect(7,8,2,5,'greenDark').rect(5,8,5,2,'green'));
compact('dream-dew',p=>p.rect(6,2,4,2,'brown').rect(6,5,4,1,'lilac').poly([[6,6],[10,6],[12,8],[12,13],[10,14],[5,14],[3,12],[3,8]],'purple').rect(4,8,7,1,'lilac').rect(5,10,2,2,'paleGold').rect(7,12,2,1,'paleGold'));
compact('pollinator',p=>p.poly([[6,7],[3,6],[2,3],[5,3],[7,6],[9,3],[12,2],[14,3],[13,5],[10,7]],'ice').poly([[4,8],[6,7],[11,7],[13,9],[12,11],[10,13],[5,12],[3,10]],'gold').rect(7,8,2,4,'brownDark').rect(11,8,1,3,'brownDark').rect(4,9,1,1,'ink'));
compact('fence',p=>{p.rect(2,7,12,2,'brown').rect(2,11,12,2,'brown');for(const x of [3,7,11]) p.poly([[x,5],[x+1,3],[x+2,5],[x+2,14],[x,14]],'clay').rect(x,6,1,6,'sand');});
compact('botano',p=>bolt(p,'aqua','ice'));
compact('moonlight',p=>p.poly([[6,2],[10,2],[7,5],[7,9],[10,12],[13,11],[11,14],[6,14],[3,11],[2,7],[3,4]],'lilac').poly([[6,3],[7,3],[4,6],[4,10],[7,13],[5,12],[3,9],[3,6]],'blush'));
compact('nitro',p=>p.poly([[2,12],[2,7],[5,3],[10,3],[14,7],[14,12]],'silver').poly([[3,11],[3,7],[6,4],[10,4],[13,7],[13,11]],'cream').rect(4,6,2,2,'green').rect(7,4,2,2,'gold').rect(11,6,2,2,'red').line(8,10,11,7,'brownDark').rect(7,10,2,2,'gold'));
compact('arcade',p=>p.rect(4,2,8,3,'lilac').rect(4,6,8,5,'purple').rect(5,6,6,3,'greenDark').rect(7,6,2,3,'greenLight').rect(3,11,10,3,'purple').rect(4,11,8,1,'lilac').rect(8,12,2,1,'gold'));
compact('box',p=>p.poly([[2,5],[7,3],[14,5],[14,12],[8,14],[2,12]],'brown').poly([[3,6],[8,8],[8,13],[3,11]],'clay').poly([[3,5],[7,4],[13,5],[8,7]],'sand').rect(6,6,2,6,'gold').rect(6,9,1,1,'brownDark'));
compact('playing-cards',p=>p.rect(2,4,7,10,'purple').rect(5,2,8,11,'cream').poly([[9,5],[12,8],[9,11],[6,8]],'red'));
for(const id of ['seed-token','leaf-token']) compact(id,p=>{const gold=id==='seed-token';p.poly([[5,2],[11,2],[14,5],[14,11],[11,14],[5,14],[2,11],[2,5]],gold?'gold':'grey').poly([[5,3],[11,3],[13,5],[13,11],[11,13],[5,13],[3,11],[3,5]],gold?'paleGold':'white').rect(7,7,2,5,'greenDark').rect(5,5,2,3,'green').rect(9,4,3,3,'greenLight').rect(5,11,6,1,'brown');});
