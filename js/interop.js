// Browser glue for Simple Kennel: PocketBase realtime stream, image processing, printing, downloads.

window.kennelRealtime = (() => {
    let es = null;
    let ref = null;
    let online = null;
    let offline = null;

    function stop() {
        if (es) { es.close(); es = null; }
        if (online) { window.removeEventListener('online', online); online = null; }
        if (offline) { window.removeEventListener('offline', offline); offline = null; }
        ref = null;
    }

    // PocketBase pushes record changes over Server-Sent Events. After the stream connects it hands out a
    // client id; the app then says which collections it wants. A reconnect gives a new id, so we subscribe
    // again and ask .NET to catch up on anything missed.
    function start(baseUrl, token, collections, dotnetRef) {
        stop();
        ref = dotnetRef;
        online = () => ref && ref.invokeMethodAsync('OnBrowserOnline');
        offline = () => ref && ref.invokeMethodAsync('OnBrowserOffline');
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);

        es = new EventSource(baseUrl + '/api/realtime');
        es.addEventListener('PB_CONNECT', async (e) => {
            const clientId = JSON.parse(e.data || '{}').clientId || e.lastEventId;
            const subs = collections.map(c => c + '/*');
            try {
                await fetch(baseUrl + '/api/realtime', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token || '' },
                    body: JSON.stringify({ clientId, subscriptions: subs }),
                });
            } catch { return; }
            subs.forEach(name => es.addEventListener(name, (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    ref && ref.invokeMethodAsync('OnRealtime', name.split('/')[0], msg.action, JSON.stringify(msg.record));
                } catch { }
            }));
            ref && ref.invokeMethodAsync('OnRealtimeConnected');
        });
    }

    return { start, stop };
})();

window.kennelUi = (() => {
    const picked = new Map();
    let nextId = 1;
    const urls = new Set();

    function print() { window.print(); }

    function download(name, mime, bytesOrText) {
        const blob = new Blob([bytesOrText], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function blobUrl(bytes, mime) {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
        urls.add(url);
        return url;
    }

    function revoke(url) { if (urls.delete(url)) URL.revokeObjectURL(url); }

    async function decode(file) {
        if ('createImageBitmap' in window) {
            try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { }
        }
        // Fallback for browsers whose createImageBitmap rejects the file.
        return await new Promise((resolve, reject) => {
            const img = new Image();
            const u = URL.createObjectURL(file);
            img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('That file is not a readable image.')); };
            img.src = u;
        });
    }

    function toJpeg(canvas, quality) {
        return new Promise((resolve, reject) =>
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not process the image.')), 'image/jpeg', quality));
    }

    // Shrinks a photo/scan to at most maxDim pixels on the long side and recompresses it as JPEG, lowering the
    // quality until it fits maxBytes. PDFs pass through untouched when allowPdf is set.
    async function processFile(input, opts) {
        const file = input.files && input.files[0];
        if (!file) return null;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        try {
            let bytes, mime, name = file.name;
            if (isPdf) {
                if (!opts.allowPdf) throw new Error('Choose an image.');
                bytes = new Uint8Array(await file.arrayBuffer()); mime = 'application/pdf';
            } else {
                const bmp = await decode(file);
                const w = bmp.width, h = bmp.height;
                const scale = Math.min(1, opts.maxDim / Math.max(w, h));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
                let q = opts.quality, blob = await toJpeg(canvas, q);
                while (blob.size > opts.maxBytes && q > 0.35) { q -= 0.1; blob = await toJpeg(canvas, q); }
                bytes = new Uint8Array(await blob.arrayBuffer()); mime = 'image/jpeg';
                name = name.replace(/\.[^.]+$/, '') + '.jpg';
            }
            if (bytes.length > opts.maxBytes) throw new Error('That file is larger than ' + Math.round(opts.maxBytes / 1048576) + ' MB.');
            const id = nextId++;
            picked.set(id, bytes);
            return { id, name, mime, size: bytes.length, error: null };
        } catch (e) {
            return { id: 0, name: file.name, mime: '', size: 0, error: e.message || 'Could not read that file.' };
        } finally {
            input.value = '';
        }
    }

    function takeBytes(id) {
        const b = picked.get(id);
        picked.delete(id);
        return b;
    }

    function requestPersistence() {
        try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { }
    }

    function setAccent(name) { document.documentElement.setAttribute('data-accent', name); }

    return { print, download, blobUrl, revoke, processFile, takeBytes, requestPersistence, setAccent };
})();

kennelUi.requestPersistence();
