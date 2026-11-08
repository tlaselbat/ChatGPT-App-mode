const fs = require('node:fs');
async function windowCapture(app, file, expectedWindowId) {
  const result = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }, expectedWindowId) => {
    const windows = BrowserWindow.getAllWindows();
    const win = expectedWindowId === undefined ? windows[0] : BrowserWindow.fromId(expectedWindowId);
    if (!win || win.isDestroyed() || windows.length !== 1) throw Error('Ambiguous native window ownership');
    const size = win.getSize();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: size[0], height: size[1] } });
    const source = sources.find(source => source.id === win.getMediaSourceId());
    if (!source || source.thumbnail.isEmpty()) throw Error('Native window capture unavailable');
    const image = source.thumbnail, data = image.toBitmap();
    let magenta = 0, green = 0, chromeMarker = 0, contentMarker = 0;
    const dimensions = image.getSize();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 220 && data[i + 1] < 40 && data[i + 2] > 220) magenta++;
      if (data[i] < 40 && data[i + 1] > 90 && data[i + 2] < 40) green++;
      const y = Math.floor(i / 4 / dimensions.width);
      if (y < 60 && data[i] > 220 && data[i + 1] > 220 && data[i + 2] < 40) chromeMarker++;
      if (y >= 60 && data[i] < 40 && data[i + 1] > 150 && data[i + 2] < 40) contentMarker++;
    }
    return { png: image.toPNG().toString('base64'), magenta, green, chromeMarker, contentMarker, size: dimensions,
      windowId: win.id, sourceIdMatches: source.id === win.getMediaSourceId(), bounds: win.getBounds(), contentBounds: win.getContentBounds(),
      views: win.contentView.children.map(view => ({ role: view.webContents.getURL().endsWith('/controls.html') ? 'controls' : 'content', bounds: view.getBounds(), zoom: view.webContents.getZoomFactor() })),
      scaleFactor: screen.getDisplayMatching(win.getBounds()).scaleFactor };
  }, expectedWindowId);
  fs.writeFileSync(file, Buffer.from(result.png, 'base64'));
  delete result.png;
  return result;
}

module.exports = { windowCapture };
