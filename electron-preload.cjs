const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (buffer, filename) => ipcRenderer.invoke('save-file', { buffer, filename }),
  isElectron: true
});

// After DOM is ready, inject blob download interceptor
window.addEventListener('DOMContentLoaded', () => {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      if (!window.electronAPI) return;

      function handleBlobDownload(anchor) {
        if (anchor.href && anchor.href.startsWith('blob:') && anchor.download) {
          var filename = anchor.download;
          var blobUrl = anchor.href;
          fetch(blobUrl)
            .then(function(r) { return r.arrayBuffer(); })
            .then(function(buf) {
              window.electronAPI.saveFile(Array.from(new Uint8Array(buf)), filename);
            });
          return true;
        }
        return false;
      }

      // Patch .click() - used by file-saver and manual createElement('a')
      var origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (handleBlobDownload(this)) return;
        return origClick.call(this);
      };

      // Patch .dispatchEvent() - jsPDF uses dispatchEvent(new MouseEvent('click'))
      var origDispatch = HTMLAnchorElement.prototype.dispatchEvent;
      HTMLAnchorElement.prototype.dispatchEvent = function(event) {
        if (event.type === 'click' && handleBlobDownload(this)) return true;
        return origDispatch.call(this, event);
      };
    })();
  `;
  document.head.appendChild(script);
});
