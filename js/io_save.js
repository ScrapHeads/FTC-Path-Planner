// Some embedded browsers expose file pickers but block writes to their handles.
export async function saveExport(payload, directory = null) {
  try {
    let handle;
    if (directory) {
      if (directory.queryPermission) {
        let permission = await directory.queryPermission({ mode: 'readwrite' });
        if (permission === 'prompt' && directory.requestPermission) {
          permission = await directory.requestPermission({ mode: 'readwrite' });
        }
        if (permission !== 'granted') {
          downloadExport(payload);
          return 'downloaded';
        }
      }
      handle = await directory.getFileHandle(payload.suggestedName, { create: true });
    } else if (window.showSaveFilePicker) {
      handle = await window.showSaveFilePicker({ suggestedName: payload.suggestedName });
    } else {
      downloadExport(payload);
      return 'downloaded';
    }
    const writable = await handle.createWritable();
    await writable.write(payload.content);
    await writable.close();
    return 'saved';
  } catch (error) {
    if (!['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
    downloadExport(payload);
    return 'downloaded';
  }
}

function downloadExport(payload) {
  const blob = new Blob([payload.content], { type: payload.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = payload.suggestedName;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Give the browser time to start reading the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
