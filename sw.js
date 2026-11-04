const CACHE_NAME='accident-public-20261105-1';
const ASSETS=['/','/index.html','/manifest.json','/icon-192.png','/icon-512.png','/vendor/qrcode.js','/vendor/qrcode_UTF8.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('accident-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 // Shared URLs are not written into the cache. Normalize navigation key to avoid storing personal data.
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request).then(r=>{if(r.ok&&!url.search)e.waitUntil(caches.open(CACHE_NAME).then(c=>c.put('/',r.clone())));return r;}).catch(()=>caches.match('/')));return;
 }
 if(!ASSETS.includes(url.pathname))return;
 e.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(e.request)));
});
