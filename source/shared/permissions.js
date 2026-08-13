export const context = {
  secure:       location.protocol === 'https:',
  installed:    window.matchMedia('(display-mode: standalone)').matches
                || navigator.standalone === true,
  online:       navigator.onLine,
  hasFilePicker: 'showDirectoryPicker' in window,
  hasTauri:     '__TAURI__' in window
};
