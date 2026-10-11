/* Manifest version: a9e9uJgt */
// Bit Bswup service worker: offline-first caching of the app shell and every published asset, with background
// updates. Requests to other origins (the PocketBase server, fonts) are left alone and always use the network.
self.assetsExclude = [/\.scp\.css$/];
self.caseInsensitiveUrl = true;

// The one mandatory line: imports the Bswup service worker engine.
self.importScripts('_content/Bit.Bswup/bit-bswup.sw.js');
