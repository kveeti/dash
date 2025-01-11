const CACHE_NAME = "pwa-cache-v1";

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((cacheNames) =>
				Promise.all(
					cacheNames
						.filter((name) => name !== CACHE_NAME)
						.map((name) => caches.delete(name)),
				),
			),
	);
	self.clients.claim();
});

// Intercept requests and cache assets dynamically
self.addEventListener("fetch", (event) => {
	const { request } = event;

	// Check if the request is for /assets and cache it if it's not already cached
	if (request.url.includes("/assets/")) {
		event.respondWith(
			caches.match(request).then((cachedResponse) => {
				if (cachedResponse) {
					return cachedResponse; // return cached asset if it exists
				}

				return fetch(request).then((response) => {
					if (response?.ok) {
						// Cache the newly fetched asset
						caches.open(CACHE_NAME).then((cache) => {
							cache.put(request, response.clone());
						});
					}
					return response; // return the fetched response
				});
			}),
		);
	} else {
		// For non-asset files, handle normally
		event.respondWith(
			caches.match(request).then((cachedResponse) => {
				return cachedResponse || fetch(request);
			}),
		);
	}
});

// Handle update logic
self.addEventListener("message", (event) => {
	if (event.data === "skipWaiting") {
		self.skipWaiting();
	}
});
