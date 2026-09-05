import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { definitions, compactDrawings, palette } from './pixel-kit-definitions.mjs';

const root=process.cwd(),publicRoot=path.join(root,'public'),kit=path.join(publicRoot,'pixel-kit-v1');
const manifest=JSON.parse(await fs.readFile(path.join(kit,'manifest.json'),'utf8'));
const inventory=JSON.parse(await fs.readFile(path.join(kit,'audit/inventory.json'),'utf8'));
const absolute=url=>path.join(publicRoot,url.slice(1));
const allowed=new Set(Object.values(palette));
const uniqueIds=new Set();let drawings=0,pngs=0,totalSvgBytes=0,totalPngBytes=0;
async function verifyDrawing(asset,svgUrl,variants) {
  const svg=await fs.readFile(absolute(svgUrl),'utf8');totalSvgBytes+=Buffer.byteLength(svg);
  assert(!/<(?:image|script|filter|linearGradient|radialGradient|foreignObject)\b/.test(svg),svgUrl+' contains non-pixel constructs');
  assert(svg.includes(`viewBox="0 0 ${asset.size} ${asset.size}"`));
  assert(svg.includes('shape-rendering="crispEdges"'));
  for(const m of svg.matchAll(/ d="([^"]+)"/g)) assert(/^(?:M\d+ \d+h\d+v1H\d+z)+$/.test(m[1]),svgUrl+' has off-grid geometry');
  const {data,info}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,asset.size);assert.equal(info.height,asset.size);
  let opaque=0;
  for(let i=0;i<asset.pixels.length;i++) {
    const expected=asset.pixels[i]==='currentColor'?palette.ink:asset.pixels[i];
    const a=data[i*4+3];assert(a===0||a===255,svgUrl+' has anti-aliased alpha');
    if(!expected){assert.equal(a,0,svgUrl+' background must be transparent');continue;}
    assert(allowed.has(expected),svgUrl+' contains unapproved colour '+expected);assert.equal(a,255);
    const actual='#'+[...data.subarray(i*4,i*4+3)].map(v=>v.toString(16).padStart(2,'0')).join('');
    assert.equal(actual,expected,svgUrl+' changed original pixel colour');opaque++;
  }
  assert(opaque>0&&opaque<asset.size**2*.9,svgUrl+' must be visible with padding');
  // Entire outermost row/column should remain transparent at both grid sizes.
  for(let v=0;v<asset.size;v++) for(const i of [v,(asset.size-1)*asset.size+v,v*asset.size,v*asset.size+asset.size-1]) assert.equal(data[i*4+3],0,svgUrl+' touches artboard edge');
  for(const [sizeString,url] of Object.entries(variants)) {
    const size=Number(sizeString),buffer=await fs.readFile(absolute(url));totalPngBytes+=buffer.length;
    const actual=await sharp(buffer).ensureAlpha().raw().toBuffer();
    const expected=await sharp(data,{raw:info}).resize(size,size,{kernel:'nearest'}).raw().toBuffer();
    assert.deepEqual(actual,expected,url+' differs from lossless nearest-neighbour source');pngs++;
  }
  drawings++;
}
for(const entry of manifest.assets) {
  assert(!uniqueIds.has(entry.id),'Duplicate ID');uniqueIds.add(entry.id);
  const source=definitions.find(d=>d.id===entry.id);assert(source,'Missing source drawing');
  await verifyDrawing(source,entry.svg,entry.png);
  if(entry.compact) await verifyDrawing(compactDrawings.get(entry.id),entry.compact.svg,entry.compact.png);
  if(entry.lightSvg) {
    const svg=await fs.readFile(absolute(entry.lightSvg));totalSvgBytes+=svg.length;
    const {data,info}=await sharp(svg).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let i=0;i<data.length;i+=4) if(data[i+3]) assert.equal('#'+[...data.subarray(i,i+3)].map(v=>v.toString(16).padStart(2,'0')).join(''),palette.cream);
    for(const size of [16,32]) {
      const buffer=await fs.readFile(absolute(entry.lightSvg.replace('.svg',`-${size}.png`)));totalPngBytes+=buffer.length;
      assert.deepEqual(await sharp(buffer).ensureAlpha().raw().toBuffer(),await sharp(data,{raw:info}).resize(size,size,{kernel:'nearest'}).raw().toBuffer());pngs++;
    }
  }
}
assert.equal(manifest.assets.length,definitions.length);
assert.equal(manifest.assets.filter(a=>a.group==='items').length,10);
const referencedGameArt=inventory.assets.filter(a=>a.category==='game-ui'&&a.references.length);
for(const old of referencedGameArt) assert(manifest.assets.some(a=>a.legacy.includes(old.path)),'Missing replacement for '+old.path);
for(const old of inventory.assets) {
  const hash=createHash('sha256').update(await fs.readFile(absolute(old.path))).digest('hex');
  assert.equal(hash,old.sha256,'Original artwork changed: '+old.path);
}
const html=await fs.readFile(path.join(kit,'catalog.html'),'utf8');
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) if(!m[1].startsWith('http')&&!m[1].startsWith('#')) await fs.access(path.resolve(kit,m[1]));
const result={status:'passed',originalDesigns:manifest.assets.length,compactVariants:compactDrawings.size,verifiedPixelDrawings:drawings,verifiedPngVariants:pngs,referencedGameUiAssetsCovered:referencedGameArt.length,originalPublicFilesUnchanged:inventory.assets.length,svgBytes:totalSvgBytes,pngBytes:totalPngBytes,checks:['Palette and binary transparency','Integer SVG grid geometry','Rendered SVG pixels match source coordinates','PNG export pixels match lossless nearest-neighbour source','Transparent artboard border','Compact drawings and light utility variants','Manifest and catalogue local links','Referenced game-UI mapping coverage','Original public asset hashes'],limits:['Light/dark catalogue review is visual, not a full integrated-game accessibility test.','App behaviour is unchanged. Browser layout during later rollout still needs verification.']};
await fs.writeFile(path.join(kit,'audit/validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
