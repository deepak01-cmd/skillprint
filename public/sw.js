/* Lets phones install Skillprint as an app. It does not cache anything: every request goes to the server,
   so personal data is never stored on the device by this worker. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* network only */ });
