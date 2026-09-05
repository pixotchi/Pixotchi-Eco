import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const publicRoot=path.resolve('public');
const types={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.gpl':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(pathname==='/'){res.writeHead(302,{Location:'/pixel-kit-imagegen/catalog.html'});res.end();return;}
    const file=path.resolve(publicRoot,'.'+pathname);
    if(!file.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}
    const bytes=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4187,'127.0.0.1',()=>console.log('Pixel kit catalogue: http://127.0.0.1:4187/pixel-kit-imagegen/catalog.html'));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
