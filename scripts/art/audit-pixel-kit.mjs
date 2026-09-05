import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import ts from 'typescript';
import { definitions } from './pixel-kit-definitions.mjs';

const root = process.cwd();
const output = path.join(root, 'public/pixel-kit-v1/audit');
const visual = /\.(svg|png|jpe?g|webp|avif|gif|ico)$/i;
const normalize = file => path.relative(root, file).replaceAll('\\', '/');
const walk = async dir => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]));
  return lists.flat();
};
const refs = new Map(), lucide = new Map(), inlineSvg = [], emoji = [], dynamicImages = [], remoteImages = [], imageLiterals = [];
const record = (map,key,where) => { if(!map.has(key)) map.set(key,new Set()); map.get(key).add(where); };
const sourceFiles = (await Promise.all(['app','components','lib','hooks'].map(d=>walk(path.join(root,d))))).flat().filter(f=>/\.(tsx?|jsx?|css|json)$/.test(f));
for(const f of ['next.config.mjs','public/site.webmanifest','public/browserconfig.xml','README.md']) sourceFiles.push(path.join(root,f));
const publicFiles = (await walk(path.join(root,'public'))).filter(f=>visual.test(f) && !/^public\/(pixel-kit-v1|pixel-kit-imagegen|game-art-v2)\//.test(normalize(f))).sort();
const paths = publicFiles.map(f=>'/'+path.relative(path.join(root,'public'),f).replaceAll('\\','/'));
function examineLiteral(value,where) {
  for(const candidate of paths) if(value.includes(candidate)) record(refs,candidate,where);
  const urlPattern = /(?:https?:\/\/[^\s"'<>]+|\/(?:icons|PixotchiKit|tutorial|ipfs)\/[^\s"'<>]+)\.(?:svg|png|webp|avif|jpe?g|gif)(?:\?[^\s"'<>]*)?/g;
  for(const m of value.matchAll(urlPattern)) {
    if(m[0].startsWith('http')) remoteImages.push({ location:where,url:m[0].split('?')[0] });
    else imageLiterals.push({location:where,path:m[0].split('?')[0]});
  }
  if(/\p{Extended_Pictographic}/u.test(value)) {
    const symbols = [...new Set(value.match(/\p{Extended_Pictographic}/gu))];
    emoji.push({location:where,symbols});
  }
}
for(const file of sourceFiles) {
  let content; try { content = await fs.readFile(file,'utf8'); } catch { continue; }
  if(/\.[jt]sx?$/.test(file)) {
    const source = ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const location = node => `${normalize(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line+1}`;
    const visit = node => {
      if(ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'lucide-react' && !node.importClause?.isTypeOnly) {
        const imports = node.importClause?.namedBindings;
        if(imports && ts.isNamedImports(imports)) for(const el of imports.elements) if(!el.isTypeOnly) record(lucide,el.propertyName?.text || el.name.text,location(el));
      }
      if(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) examineLiteral(node.text,location(node));
      if(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(source);
        if(name === 'svg') inlineSvg.push({location:location(node)});
        if(['Image','img','image'].includes(name)) {
          const attr = node.attributes.properties.find(a=>ts.isJsxAttribute(a) && ['src','href'].includes(a.name.getText(source)));
          if(attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression && !ts.isStringLiteral(attr.initializer.expression)) {
            dynamicImages.push({location:location(node),expression:attr.initializer.expression.getText(source).slice(0,180)});
          }
        }
      }
      ts.forEachChild(node,visit);
    };visit(source);
  } else content.split(/\r?\n/).forEach((line,i)=>examineLiteral(line,`${normalize(file)}:${i+1}`));
}
const building = /^\/icons\/(?:map\/|barracks\.webp|barrackslayer\.webp|bee-house\.png|bee-layer\.webp|casino\.png|casino-layer\.webp|farmer-house\.png|farmerhouse-layer\.webp|landIcon\.png|landsapp\.png|marketplace\.png|marketplace-layer\.webp|soil-factory\.png|soil-layer\.webp|solar-panels\.png|solar-layer\.webp|stake-house\.png|town-small\.png|village-(?:big|high|start)\.png|ware-house\.png)$/i;
function category(url) {
  if(url.startsWith('/ipfs/strain')) return 'canonical-plant-nft';
  if(url.startsWith('/icons/map/') || building.test(url)) return 'building-land-excluded';
  if(/^\/icons\/(plant[1-5]|plantGrowth)/.test(url)) return 'plant-presentation';
  if(['/PixotchiKit/COIN.svg','/icons/leaf.png','/icons/cc.png'].includes(url)) return 'own-token-brand';
  if(/^\/icons\/(Base_|builtOnBase|efp-logo|ethicon|ethlogo|farcaster|github|jessetoken|poet|privy|solana|Telegram|twitter|usdc|x\.|zora)/i.test(url)) return 'external-brand';
  if(/^\/icons\/(bgclaim|cardbj|cardbjfront|casino-bg|casinobj-bg)\./.test(url)) return 'feature-surface';
  if(/^\/(tutorial\/|farcaster-og|og-image|screenshot|twitter-og)/.test(url)) return 'tutorial-marketing';
  if(/^\/(PixotchiKit\/|icon1|icons\/(android-chrome|apple-touch-icon|icon-512x512|Logonotext|miniapp|talent|web-app-manifest)|android-chrome|apple-touch-icon|favicon|icon-512x512|mstile|safari-pinned-tab|splash|web-app-manifest)/.test(url)) return 'app-brand';
  return 'game-ui';
}
const decisions = {
  'canonical-plant-nft':'Keep NFT identity and its level/state variants. Style reference, not replacement art.',
  'building-land-excluded':'Excluded by user. Keep unchanged.',
  'plant-presentation':'Keep strain identity; later normalize canonical NFT framing and transparent display wrappers.',
  'own-token-brand':'SEED/LEAF game-HUD proposals supplied. Preserve official/third-party token identity pending brand review.',
  'external-brand':'Keep recognizable official marks; standardize container size, padding and alignment.',
  'feature-surface':'Second wave: refresh backgrounds/card textures after icons are adopted.',
  'tutorial-marketing':'Re-capture after UI rollout so screenshots match actual gameplay.',
  'app-brand':'Separate brand/export review; do not substitute game-item glyphs for app identity.',
  'game-ui':'Replace using supplied pixel-kit mapping where available.',
};
const assets = [];
for(let i=0;i<publicFiles.length;i++) {
  const file=publicFiles[i], url=paths[i], buffer=await fs.readFile(file), cat=category(url);
  let meta={};try{const m=await sharp(buffer).metadata();meta={width:m.width,height:m.height,hasAlphaChannel:m.hasAlpha,format:m.format};}catch{meta={format:path.extname(file).slice(1),inspection:'metadata unavailable'};}
  const direct=[...(refs.get(url)||[])].sort();
  const family=url.startsWith('/ipfs/strain')?'PlantImage.tsx resolves /ipfs/strain${strain}/${calculatedLevel}.svg; family membership is not proof every level is reached.':null;
  const svg=path.extname(file)==='.svg'?buffer.toString('utf8'):'';
  assets.push({path:url,category:cat,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),...meta,
    references:direct,usage:direct.length?'literal-reference':family?'dynamic-family':'no-literal-reference-found',dynamicFamily:family,
    replacementIds:definitions.filter(d=>d.legacy.includes(url)).map(d=>d.id),decision:decisions[cat],
    ...(svg?{svgFeatures:{gradients:/<(linear|radial)Gradient/.test(svg),filters:/<filter/.test(svg),embeddedRaster:/<image/.test(svg),crispEdges:/crispEdges|pixelated/.test(svg)}}:{}),
  });
}
const duplicates=[...new Set(assets.map(a=>a.sha256))].map(h=>assets.filter(a=>a.sha256===h).map(a=>a.path)).filter(a=>a.length>1);
const missing=imageLiterals.filter(a=>!paths.includes(a.path));
const byCategory=Object.fromEntries([...new Set(assets.map(a=>a.category))].sort().map(c=>[c,{assets:assets.filter(a=>a.category===c).length,literalReferenced:assets.filter(a=>a.category===c&&a.references.length).length}]));
const report={
  schemaVersion:1,method:'TypeScript AST: literal strings and JSX, Lucide imports, inline SVG, dynamic image expressions, CSS/config/manifest text, public asset metadata and SHA-256. Build/preview/source-art outputs are excluded.',
  limits:['Static reachability evidence, not production telemetry. Flags, dead branches and comments in non-code files can affect counts.','Dynamic metadata, user avatars, token logos, data URIs, onchain tokenURI and CSS/canvas-generated visuals are documented as runtime families, not enumerated remote assets.','Emoji inventory includes source strings for AI/server content and is a review queue, not a count of visible UI icons.','No-literal-reference-found is not proof an asset is unused. No files are deleted.'],
  totals:{assets:assets.length,bytes:assets.reduce((n,a)=>n+a.bytes,0),literalReferenced:assets.filter(a=>a.references.length).length,dynamicFamily:assets.filter(a=>a.usage==='dynamic-family').length,noLiteralReference:assets.filter(a=>a.usage==='no-literal-reference-found').length,lucideSymbols:lucide.size,lucideImportSites:[...lucide.values()].reduce((n,s)=>n+s.size,0),inlineSvgSites:inlineSvg.length,dynamicImageSites:dynamicImages.length,emojiSourceSites:emoji.length},
  byCategory,assets,duplicateFiles:duplicates,missingImageLiterals:[...new Map(missing.map(a=>[a.path,a])).values()],
  lucide:[...lucide].sort(([a],[b])=>a.localeCompare(b)).map(([symbol,locations])=>({symbol,locations:[...locations]})),inlineSvg,dynamicImages,remoteImages,emoji,
};
await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'inventory.json'),JSON.stringify(report,null,2)+'\n');
const lines=['# Pixotchi asset inventory','',report.method,'','## Totals','',...Object.entries(report.totals).map(([k,v])=>`- ${k}: ${v}`),'','## Scope and interpretation','',...report.limits.map(v=>`- ${v}`),'','## Asset decisions','','Paths below are public URLs. Code locations are relative to the repository root.','','| Asset | Size | Usage | Decision / replacement | Reference |','| --- | --- | --- | --- | --- |',...assets.map(a=>`| ${a.path} | ${a.width||'?'}×${a.height||'?'} | ${a.usage} | ${a.replacementIds.join(', ')||a.decision} | ${a.references.slice(0,3).join('; ')}${a.references.length>3?` (+${a.references.length-3})`:''} |`),'','## Lucide inventory','','| Symbol | Source locations |','| --- | --- |',...report.lucide.map(a=>`| ${a.symbol} | ${a.locations.join('; ')} |`),'','## Inline SVG review','','These include brand marks, transaction indicators, the roulette/spin wheels and generated wallet avatars. Do not mechanically replace structural SVG or identifying marks with a decorative icon.','',...inlineSvg.map(a=>`- ${a.location}`),'','## Runtime image families','','- Canonical NFT levels: components/PlantImage.tsx. Preserve assets and URI resolution.','- Wallet/social avatars: resolve identity metadata; keep user-provided images and handle fallbacks.','- Swap token logos: runtime token metadata; preserve identifying marks.','- Onchain/API item metadata and SVG/data URIs: inspect resolver and fallback behaviour during rollout.','- Emoji and dynamic expressions: complete source-location queues in inventory.json.',''];
await fs.writeFile(path.join(output,'inventory.md'),lines.join('\n'));

// Visual inspection sheets only: legacy art is rendered unchanged for comparison.
const candidates=assets.filter(a=>a.references.length && ['game-ui','feature-surface','plant-presentation','own-token-brand'].includes(a.category));
const sheet=async(entries,filename,columns=7)=>{
  const cw=160,ch=148,rows=Math.ceil(entries.length/columns);
  const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
  const base=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*cw}" height="${rows*ch}"><rect width="100%" height="100%" fill="#dce7df"/>${entries.map((a,i)=>`<rect x="${i%columns*cw+4}" y="${Math.floor(i/columns)*ch+4}" width="152" height="140" fill="${i%2?'#253044':'#fff4d6'}"/><text x="${i%columns*cw+80}" y="${Math.floor(i/columns)*ch+130}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="${i%2?'#fff4d6':'#253044'}">${esc(path.basename(a.path))}</text>`).join('')}</svg>`);
  const comp=await Promise.all(entries.map(async(a,i)=>({input:await sharp(path.join(root,'public',a.path.slice(1))).resize(96,96,{fit:'contain',kernel:'nearest',background:'#00000000'}).png().toBuffer(),left:i%columns*cw+32,top:Math.floor(i/columns)*ch+12})));
  await sharp(base).composite(comp).png().toFile(path.join(output,filename));
};
await sheet(candidates,'legacy-contact-sheet.png');
await sheet(['/ipfs/strain1/12.svg','/ipfs/strain2/12.svg','/ipfs/strain3/12.svg','/ipfs/strain4/12.svg','/ipfs/strain5/12.svg','/icons/village-start.png','/PixotchiKit/COIN.svg','/icons/leaf.png'].map(path=>({path})),'style-anchors.png',4);
console.log(JSON.stringify({output:normalize(output),...report.totals,byCategory,missingImageLiterals:report.missingImageLiterals},null,2));
