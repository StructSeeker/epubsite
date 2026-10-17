/* global console, navigator */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error) => {
    console.error('epubsite: service worker registration failed', error)
  })
}
