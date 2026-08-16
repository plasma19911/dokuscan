// Vierpunkt-Perspektivkorrektur ("Scanner-Zuschnitt") komplett im Browser.
// Bildet ein Rechteck (Zielbild) auf ein beliebiges Viereck im Quellbild ab
// (klassische "unit square to quad"-Projektion, z. B. nach Paul Heckbert).
// So funktioniert der "schiefes Foto -> gerades Dokument"-Effekt bekannter
// Scanner-Apps, ganz ohne Server oder große Bildverarbeitungs-Bibliothek.

function computeQuadCoefficients(pts) {
  // pts: [{x,y} TL, {x,y} TR, {x,y} BR, {x,y} BL] im Quellbild
  const [p0, p1, p2, p3] = pts;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a13 = 0;
  let a23 = 0;
  const det = dx1 * dy2 - dx2 * dy1;

  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    a13 = (dx3 * dy2 - dx2 * dy3) / det;
    a23 = (dx1 * dy3 - dx3 * dy1) / det;
  }

  const a11 = p1.x - p0.x + a13 * p1.x;
  const a21 = p3.x - p0.x + a23 * p3.x;
  const a31 = p0.x;
  const a12 = p1.y - p0.y + a13 * p1.y;
  const a22 = p3.y - p0.y + a23 * p3.y;
  const a32 = p0.y;

  return { a11, a12, a13, a21, a22, a23, a31, a32 };
}

function mapUnitToQuad(c, u, v) {
  const denom = c.a13 * u + c.a23 * v + 1;
  return {
    x: (c.a11 * u + c.a21 * v + c.a31) / denom,
    y: (c.a12 * u + c.a22 * v + c.a32) / denom,
  };
}

function samplePixel(imgData, x, y) {
  const w = imgData.width;
  const h = imgData.height;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const idx = (xx, yy) => (yy * w + xx) * 4;
  const out = [0, 0, 0, 0];
  for (let ch = 0; ch < 4; ch++) {
    const c00 = imgData.data[idx(x0, y0) + ch];
    const c10 = imgData.data[idx(x1, y0) + ch];
    const c01 = imgData.data[idx(x0, y1) + ch];
    const c11 = imgData.data[idx(x1, y1) + ch];
    const top = c00 + (c10 - c00) * fx;
    const bottom = c01 + (c11 - c01) * fx;
    out[ch] = top + (bottom - top) * fy;
  }
  return out;
}

/**
 * Schneidet ein Viereck aus dem Quell-Canvas aus und entzerrt es
 * (Perspektivkorrektur) in ein neues, gerades Rechteck-Canvas.
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {[{x,y}]} quadPoints - 4 Ecken in Bildpixel-Koordinaten (TL,TR,BR,BL)
 * @param {number} outWidth
 * @param {number} outHeight
 * @returns {HTMLCanvasElement}
 */
function warpPerspective(sourceCanvas, quadPoints, outWidth, outHeight) {
  const srcCtx = sourceCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  const coeffs = computeQuadCoefficients(quadPoints);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext('2d');
  const outData = outCtx.createImageData(outWidth, outHeight);

  for (let oy = 0; oy < outHeight; oy++) {
    const v = oy / outHeight;
    for (let ox = 0; ox < outWidth; ox++) {
      const u = ox / outWidth;
      const { x, y } = mapUnitToQuad(coeffs, u, v);
      const [r, g, b, a] = samplePixel(srcData, x, y);
      const di = (oy * outWidth + ox) * 4;
      outData.data[di] = r;
      outData.data[di + 1] = g;
      outData.data[di + 2] = b;
      outData.data[di + 3] = a;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

/** Schätzt eine sinnvolle Ausgabegröße anhand der Seitenlängen des Vierecks. */
function estimateOutputSize(quadPoints, maxDimension = 1800) {
  const [p0, p1, p2, p3] = quadPoints;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = (dist(p0, p1) + dist(p3, p2)) / 2;
  const height = (dist(p0, p3) + dist(p1, p2)) / 2;
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(200, Math.round(width * Math.min(1, scale))),
    height: Math.max(200, Math.round(height * Math.min(1, scale))),
  };
}

/** Wendet einen einfachen Filter an: 'color' | 'gray' | 'bw'. */
function applyFilter(canvas, mode) {
  if (mode === 'color') return canvas;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const gray = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
    if (mode === 'bw') {
      const v = gray > 150 ? 255 : 0;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    } else {
      data.data[i] = data.data[i + 1] = data.data[i + 2] = gray;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

window.DokuCrop = { warpPerspective, estimateOutputSize, applyFilter };
