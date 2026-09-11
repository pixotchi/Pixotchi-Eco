/** Assemble original screenshot pixels and repo assets inside phone mockups. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';

const root = process.cwd();
const capture = path.join(root, 'output/tutorial-capture');
const destination = path.join(root, 'public/tutorial/current');
await fs.mkdir(destination, {recursive:true});
const scenes = [
  {key:'mint-plant',screen:'mint',detail:'plant-card',path:'MINT → PLANTS → CHOOSE A STRAIN',title:'Your first plant.',secondPhone:'plant',icons:[]},
  {key:'token-flow',screen:'swap',detail:'swap',path:'SWAP → ETH → SEED',title:'SEED starts here.',icons:['PixotchiKit/COIN.svg','icons/ethlogo.svg']},
  {key:'plant-items',screen:'care',detail:'care-review',path:'FARM → PLANTS → PLANT CARE',title:'Choose care. Review its effect.',icons:['icons/WATERDROPS.png','icons/SUN.png','icons/FERTILIZER.png']},
  {key:'ptstod',screen:'plant',detail:'plant-card',path:'FARM → PLANTS',title:'Watch points and lifetime.',crop:{left:0,top:0,width:716,height:740},icons:['icons/pts.svg','icons/HEART.svg']},
  {key:'attack',screen:'ranking',detail:'fence',path:'RANKING · FARM → PLANT CARE → FENCE',title:'Attack. Protect your progress.',icons:['icons/Fence.png']},
  {key:'land',screen:'land',detail:'building-detail',path:'FARM → LANDS → VILLAGE',title:'Your land supports your plants.',crop:{left:0,top:0,width:650,height:610},icons:['icons/solar-panels.png','icons/soil-factory.png','icons/bee-house.png']},
  {key:'buildings',screen:'town',detail:'town',path:'FARM → LANDS → BUILDINGS → TOWN',title:'Choose a building.',icons:['icons/farmer-house.png','icons/marketplace.png']},
  {key:'staking',screen:'plant',detail:'stake',path:'HEADER → STAKE',title:'Stake SEED. Earn LEAF.',crop:{left:0,top:300,width:716,height:850},icons:['PixotchiKit/COIN.svg','icons/leaf.png']},
  {key:'chat',screen:'chat',detail:'chat',path:'HEADER → CHAT → PUBLIC / AI',title:'Help is always close.',crop:{left:0,top:0,width:716,height:530},icons:['icons/neuralseed.png','icons/chat-icon.webp']},
  {key:'tasks',screen:'plant',detail:'tasks',path:'HEADER → TASKS',title:'Find your next task.',crop:{left:0,top:0,width:716,height:1040},icons:['icons/Volcanic_Rock.svg']},
  {key:'base',screen:'settings',detail:'settings',path:'HEADER → SETTINGS',title:'Your guide, whenever you need it.',crop:{left:0,top:560,width:436,height:705},icons:['PixotchiKit/Logonotext.svg']},
];
const uri = async filename => {
  const mime = filename.endsWith('.svg') ? 'image/svg+xml' : filename.endsWith('.webp') ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${(await fs.readFile(filename)).toString('base64')}`;
};
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
for (const scene of scenes) {
  const screen = await uri(path.join(capture,`${scene.screen}-screen.png`));
  let detailFile = path.join(capture,`${scene.detail}-detail.png`);
  if (scene.crop) {
    const metadata = await sharp(detailFile).metadata();
    const crop = {...scene.crop,width:Math.min(scene.crop.width,metadata.width),height:Math.min(scene.crop.height,metadata.height-scene.crop.top)};
    const buffer = await sharp(detailFile).extract(crop).png().toBuffer();
    detailFile = path.join(capture,`${scene.key}-crop.png`);
    await fs.writeFile(detailFile,buffer);
  }
  const detail = await uri(detailFile);
  const icons = await Promise.all(scene.icons.map(async file => `<img src="${await uri(path.join(root,'public',file))}"/>`));
  const second = scene.secondPhone ? await uri(path.join(capture,`${scene.secondPhone}-screen.png`)) : null;
  const phone = (src, cls='') => `<div class="phone ${cls}"><div class="speaker"></div><div class="screen"><img src="${src}"/></div></div>`;
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#abc8e6;color:#18334f}
    .board{width:1440px;height:900px;position:relative;overflow:hidden;border-radius:44px;background:radial-gradient(ellipse at 72% 34%,#c6ddf0 0,transparent 63%),#abc8e6}
    .phone{position:absolute;left:54px;top:47px;width:388px;padding:23px 10px 14px;border:3px solid #68747f;border-radius:48px;background:linear-gradient(100deg,#404950,#111519 7%,#090d11 93%,#4d565d);box-shadow:inset 0 0 0 3px #161c21,0 16px 24px -12px #3f608782}
    .phone:before{content:'';position:absolute;right:-7px;top:195px;width:5px;height:98px;border-radius:3px;background:#414950}.phone:after{content:'';position:absolute;left:-7px;top:132px;width:5px;height:65px;border-radius:3px;background:#414950}
    .speaker{position:absolute;top:9px;left:43%;height:5px;width:14%;background:#3b434b;border-radius:9px}
    .screen{overflow:hidden;border-radius:29px;background:#1b232e}.screen img{display:block;width:100%;height:auto}
    .text{position:absolute;left:495px;right:45px;top:47px}.path{font-size:20px;font-weight:700;letter-spacing:1px;line-height:1.45;color:#355878}.title{font-size:38px;line-height:1.15;font-weight:700;margin:12px 0 0;letter-spacing:-1px}
    .detail{position:absolute;left:495px;top:168px;width:866px;height:614px;display:flex;align-items:center;justify-content:center}
    .detail img{max-width:100%;max-height:100%;width:auto;height:auto;border-radius:23px;box-shadow:0 14px 34px -18px #274b7399}
    .icons{position:absolute;left:535px;right:85px;bottom:23px;height:83px;display:flex;justify-content:center;gap:45px;align-items:center}.icons img{width:78px;height:78px;object-fit:contain;image-rendering:pixelated}
    .second{left:735px;top:166px;width:435px}.double .phone:first-of-type{top:47px;width:388px;left:54px}.double .text{left:495px}.double .detail{display:none}
  </style></head><body><div class="board ${second?'double':''}">${phone(screen)}<div class="text"><div class="path">${scene.path}</div><h1 class="title">${scene.title}</h1></div>${second?phone(second,'second'):`<div class="detail"><img src="${detail}"/></div><div class="icons">${icons.join('')}</div>`}</div></body></html>`);
  await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
  const png = await page.screenshot();
  await sharp(png).webp({quality:90,effort:6}).toFile(path.join(destination,`${scene.key}.webp`));
  console.log('Rendered',scene.key);
}
await browser.close();
await fs.writeFile(path.join(root,'docs/design/tutorial-art-current.json'),JSON.stringify({
  date:'2026-09-11',method:'Actual app screenshots composed in phone frames; original repository assets. No generative artwork.',
  reproduction:['npx tsx scripts/capture-tutorial.mts','node scripts/render-tutorial-art.mjs'],
  sampleData:'Plant, land, selected balance and chat reads are seeded in the capture browser only. No app layout or asset substitutions. Prices and other unseeded readouts are snapshots and may change.',
  dimensions:{width:1440,height:900},scenes
},null,2)+'\n');
