// Service worker mínimo: hace la app instalable y deja la "cáscara" (HTML/CSS/JS/iconos) disponible
// si se pierde la conexión. NUNCA guarda respuestas de /api (datos y sesiones siempre vienen del servidor).
// Estrategia "red primero": si hay internet se usa siempre la versión más reciente, así un despliegue
// nuevo nunca queda tapado por archivos viejos en caché.
const CACHE = 'informes-v1';
const CASCARA = [
    '/', '/index.html', '/dashboard.html', '/css/style.css', '/css/vercel.css', '/js/login.js',
    '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CASCARA.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
        fetch(req).then(res => {
            if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
            return res;
        }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
    );
});
