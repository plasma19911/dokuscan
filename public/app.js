// DokuScan: Verarbeitung vollständig im Browser.
// Es gibt bewusst keinen Upload-Endpunkt für Bilder, OCR-Text oder PDFs.

let pages = [];
let pendingRawImage = null;
let pendingObjectUrl = null;
let cropPoints = [];
let currentFilter = 'color';
let lastGeneratedPdf = null;
let lastGeneratedFilename = '';
let deferredInstallPrompt = null;

const $ = (id) => document.getElementById(id);
const cameraInput = $('cameraInput');
const addPageBtn = $('addPageBtn');
const pageListEl = $('pageList');
const pageBadge = $('pageBadge');
const finishBtn = $('finishBtn');
const statusEl = $('status');
const manualTypeSelect = $('manualType');
const keepLocalCopy = $('keepLocalCopy');
const docListEl = $('docList');
const installBtn = $('installBtn');
const resultSection = $('resultSection');
const resultName = $('resultName');
const savePdfBtn = $('savePdfBtn');
const discardPdfBtn = $('discardPdfBtn');

const cropModal = $('cropModal');
const cropImage = $('cropImage');
const cropOverlay = $('cropOverlay');
const cropConfirmBtn = $('cropConfirmBtn');
const cropCancelBtn = $('cropCancelBtn');
const processingOverlay = $('processingOverlay');
const processingText = $('processingText');

keepLocalCopy.checked = localStorage.getItem('dokuscan.keepLocalCopy') === '1';
keepLocalCopy.addEventListener('change', () => {
  localStorage.setItem('dokuscan.keepLocalCopy', keepLocalCopy.checked ? '1' : '0');
});

// --------------------------------------------------------------- PWA
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
});

window.addEventListener('appinstalled', () => installBtn.classList.add('hidden'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service Worker:', err));
  });
}

// ------------------------------------------------------------- Kamera
addPageBtn.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', () => {
  const file = cameraInput.files && cameraInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    statusEl.textContent = 'Bitte ein Foto oder Bild auswählen.';
    return;
  }

  const img = new Image();
  pendingObjectUrl = URL.createObjectURL(file);
  img.onload = () => openCropModal(img);
  img.onerror = () => {
    statusEl.textContent = 'Das Bild konnte nicht geöffnet werden.';
    cleanupPendingImage();
  };
  img.src = pendingObjectUrl;
  cameraInput.value = '';
});

function cleanupPendingImage() {
  if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
  pendingObjectUrl = null;
  pendingRawImage = null;
}

// ------------------------------------------------------ Eckpunkt-Crop
function openCropModal(img) {
  pendingRawImage = img;
  cropImage.src = img.src;
  currentFilter = 'color';
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.filter === 'color'));

  cropImage.onload = () => {
    const inset = 0.06;
    cropPoints = [
      { x: img.naturalWidth * inset, y: img.naturalHeight * inset },
      { x: img.naturalWidth * (1 - inset), y: img.naturalHeight * inset },
      { x: img.naturalWidth * (1 - inset), y: img.naturalHeight * (1 - inset) },
      { x: img.naturalWidth * inset, y: img.naturalHeight * (1 - inset) },
    ];
    cropOverlay.setAttribute('viewBox', `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    cropOverlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    renderCropOverlay();
  };

  cropModal.classList.remove('hidden');
}

function renderCropOverlay() {
  cropOverlay.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';

  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('points', cropPoints.map((p) => `${p.x},${p.y}`).join(' '));
  poly.setAttribute('class', 'crop-poly');
  cropOverlay.appendChild(poly);

  cropPoints.forEach((p, idx) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', Math.max(pendingRawImage.naturalWidth, pendingRawImage.naturalHeight) * 0.022);
    c.setAttribute('class', 'crop-handle');
    c.dataset.idx = idx;
    c.addEventListener('pointerdown', startDrag);
    cropOverlay.appendChild(c);
  });
}

function startDrag(e) {
  e.preventDefault();
  const idx = Number(e.target.dataset.idx);
  const move = (moveEvt) => {
    cropPoints[idx] = clientToImageCoords(moveEvt.clientX, moveEvt.clientY);
    renderCropOverlay();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function clientToImageCoords(clientX, clientY) {
  const rect = cropImage.getBoundingClientRect();
  const scale = Math.min(rect.width / pendingRawImage.naturalWidth, rect.height / pendingRawImage.naturalHeight);
  const shownW = pendingRawImage.naturalWidth * scale;
  const shownH = pendingRawImage.naturalHeight * scale;
  const offsetX = rect.left + (rect.width - shownW) / 2;
  const offsetY = rect.top + (rect.height - shownH) / 2;
  const x = Math.min(pendingRawImage.naturalWidth, Math.max(0, (clientX - offsetX) / scale));
  const y = Math.min(pendingRawImage.naturalHeight, Math.max(0, (clientY - offsetY) / scale));
  return { x, y };
}

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

cropCancelBtn.addEventListener('click', () => {
  cropModal.classList.add('hidden');
  cleanupPendingImage();
});

cropConfirmBtn.addEventListener('click', () => {
  if (!pendingRawImage) return;
  cropConfirmBtn.disabled = true;
  try {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = pendingRawImage.naturalWidth;
    sourceCanvas.height = pendingRawImage.naturalHeight;
    sourceCanvas.getContext('2d', { willReadFrequently: true }).drawImage(pendingRawImage, 0, 0);

    const { width, height } = DokuCrop.estimateOutputSize(cropPoints, 2000);
    let resultCanvas = DokuCrop.warpPerspective(sourceCanvas, cropPoints, width, height);
    resultCanvas = DokuCrop.applyFilter(resultCanvas, currentFilter);

    pages.push({ id: `${Date.now()}-${Math.random()}`, canvas: resultCanvas });
    cropModal.classList.add('hidden');
    cleanupPendingImage();
    renderPages();
    statusEl.textContent = '';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Zuschneiden fehlgeschlagen. Bitte das Foto erneut aufnehmen.';
  } finally {
    cropConfirmBtn.disabled = false;
  }
});

// -------------------------------------------------------------- Stapel
function renderPages() {
  pageListEl.innerHTML = '';
  pages.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'page-card';

    const thumb = document.createElement('img');
    thumb.src = p.canvas.toDataURL('image/jpeg', 0.65);
    thumb.alt = `Seite ${idx + 1}`;
    card.appendChild(thumb);

    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = idx + 1;
    card.appendChild(num);

    const actions = document.createElement('div');
    actions.className = 'page-actions';
    actions.innerHTML = `
      <button data-action="up" type="button" aria-label="Seite nach vorn" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button data-action="down" type="button" aria-label="Seite nach hinten" ${idx === pages.length - 1 ? 'disabled' : ''}>↓</button>
      <button data-action="remove" type="button" aria-label="Seite löschen">✕</button>
    `;
    actions.querySelector('[data-action="up"]').onclick = () => movePage(idx, -1);
    actions.querySelector('[data-action="down"]').onclick = () => movePage(idx, 1);
    actions.querySelector('[data-action="remove"]').onclick = () => removePage(idx);
    card.appendChild(actions);
    pageListEl.appendChild(card);
  });

  pageBadge.textContent = `${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'}`;
  finishBtn.disabled = pages.length === 0;
}

function movePage(idx, dir) {
  const target = idx + dir;
  if (target < 0 || target >= pages.length) return;
  [pages[idx], pages[target]] = [pages[target], pages[idx]];
  renderPages();
}

function removePage(idx) {
  pages.splice(idx, 1);
  renderPages();
}

// ----------------------------------------------- OCR und PDF-Erstellung
function showProcessing(text) {
  processingText.textContent = text;
  processingOverlay.classList.remove('hidden');
}
function hideProcessing() {
  processingOverlay.classList.add('hidden');
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.88) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas konnte nicht gespeichert werden.')), type, quality);
  });
}

function safeTypeName(type) {
  return (type || 'Dokument')
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60) || 'Dokument';
}

function makeFilename(type, createdAt = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())}_${pad(createdAt.getHours())}-${pad(createdAt.getMinutes())}`;
  return `${safeTypeName(type)}_${stamp}.pdf`;
}

async function recognizeDocumentText() {
  let worker = null;
  let fullText = '';
  try {
    worker = await Tesseract.createWorker(['deu', 'eng'], 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract-core',
      langPath: '/lang-data',
      logger: (m) => {
        if (typeof m.progress === 'number' && m.status) {
          const pct = Math.round(m.progress * 100);
          processingText.textContent = `${m.status} ${pct}%`;
        }
      },
    });

    for (let i = 0; i < pages.length; i++) {
      showProcessing(`Texterkennung Seite ${i + 1} von ${pages.length} …`);
      const pageBlob = await canvasToBlob(pages[i].canvas, 'image/jpeg', 0.9);
      const { data } = await worker.recognize(pageBlob);
      fullText += `\n\n${data.text || ''}`;
    }
  } finally {
    if (worker) await worker.terminate();
  }
  return fullText;
}

async function buildPdf(type) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(type);
  pdfDoc.setSubject('Erstellt mit DokuScan – lokal im Browser');
  pdfDoc.setCreator('DokuScan');

  for (let i = 0; i < pages.length; i++) {
    showProcessing(`Erstelle PDF – Seite ${i + 1} von ${pages.length} …`);
    const pageBlob = await canvasToBlob(pages[i].canvas, 'image/jpeg', 0.88);
    const jpegBytes = await pageBlob.arrayBuffer();
    const image = await pdfDoc.embedJpg(jpegBytes);
    const pdfPage = pdfDoc.addPage([image.width, image.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

finishBtn.addEventListener('click', async () => {
  if (pages.length === 0) return;
  finishBtn.disabled = true;
  statusEl.textContent = '';
  resultSection.classList.add('hidden');
  lastGeneratedPdf = null;
  lastGeneratedFilename = '';

  let finalType = manualTypeSelect.value || '';
  let ocrWarning = false;

  try {
    if (!finalType) {
      try {
        showProcessing('Starte lokale Texterkennung …');
        const fullText = await recognizeDocumentText();
        showProcessing('Erkenne Dokumentenart …');
        const result = await DokuClassify.classify(fullText);
        finalType = result.type || 'Sonstiges';
      } catch (ocrErr) {
        console.warn('OCR/Erkennung fehlgeschlagen:', ocrErr);
        finalType = 'Sonstiges';
        ocrWarning = true;
      }
    }

    showProcessing('Erstelle PDF lokal …');
    const createdAt = new Date();
    const pdfBlob = await buildPdf(finalType);
    const filename = makeFilename(finalType, createdAt);

    if (keepLocalCopy.checked) {
      showProcessing('Speichere lokale Browser-Kopie …');
      await DokuStorage.addDocument({
        type: finalType,
        pdfBlob,
        pageCount: pages.length,
        createdAt: createdAt.toISOString(),
      });
      await loadDocuments();
    }

    lastGeneratedPdf = pdfBlob;
    lastGeneratedFilename = filename;
    resultName.textContent = filename;
    resultSection.classList.remove('hidden');
    statusEl.textContent = ocrWarning
      ? 'PDF erstellt. Die automatische Dokumentenerkennung war nicht verfügbar; Typ wurde als „Sonstiges“ gesetzt.'
      : `Fertig: ${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'} als „${finalType}“. Nichts wurde hochgeladen.`;

    pages = [];
    renderPages();
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Fehler bei der Verarbeitung. Deine Bilder wurden nicht hochgeladen. Bitte erneut versuchen.';
  } finally {
    hideProcessing();
    finishBtn.disabled = pages.length === 0;
  }
});

// -------------------------------------------------------- Datei ablegen
async function saveOrSharePdf(blob, filename) {
  if (!blob) return;

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PDF-Dokument', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      console.warn('Speichern-Dialog nicht verfügbar:', err);
    }
  }

  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    console.warn('Teilen nicht verfügbar:', err);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

savePdfBtn.addEventListener('click', async () => {
  const result = await saveOrSharePdf(lastGeneratedPdf, lastGeneratedFilename);
  if (result === 'saved') statusEl.textContent = 'PDF am gewählten Ort gespeichert.';
  if (result === 'shared') statusEl.textContent = 'PDF an die von dir gewählte App/Dateiablage übergeben.';
  if (result === 'downloaded') statusEl.textContent = 'Der Browser hat die PDF in seinen Download-Ordner gespeichert.';
});

discardPdfBtn.addEventListener('click', () => {
  lastGeneratedPdf = null;
  lastGeneratedFilename = '';
  resultSection.classList.add('hidden');
  statusEl.textContent = 'PDF aus dem Arbeitsspeicher entfernt.';
});

// --------------------------------------------------- Lokale Bibliothek
async function loadTypes() {
  try {
    const types = await DokuClassify.listTypes();
    manualTypeSelect.innerHTML = '<option value="">Automatisch erkennen</option>';
    types.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      manualTypeSelect.appendChild(opt);
    });
  } catch (err) {
    console.warn(err);
    manualTypeSelect.innerHTML = '<option value="">Automatisch erkennen</option><option value="Dokument">Dokument</option>';
  }
}

async function loadDocuments() {
  try {
    const docs = await DokuStorage.listDocuments();
    docListEl.innerHTML = '';
    if (docs.length === 0) {
      docListEl.innerHTML = '<p class="empty-state">Noch keine lokalen Kopien gespeichert.</p>';
      return;
    }

    docs.forEach((doc) => {
      const row = document.createElement('div');
      row.className = 'doc-row';
      const date = new Date(doc.createdAt);

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = doc.type || 'Dokument';
      const meta = document.createElement('span');
      meta.className = 'hint';
      meta.textContent = `${doc.pageCount || '?'} Seite(n) · ${date.toLocaleString('de-DE')}`;
      info.append(title, meta);
      row.appendChild(info);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'doc-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = '💾';
      saveBtn.title = 'Speichern unter / Teilen';
      saveBtn.onclick = async () => {
        await saveOrSharePdf(doc.pdfBlob, makeFilename(doc.type, date));
      };
      btnGroup.appendChild(saveBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '🗑';
      delBtn.title = 'Lokale Kopie löschen';
      delBtn.className = 'danger-btn';
      delBtn.onclick = async () => {
        if (!confirm('Diese lokale Browser-Kopie wirklich löschen?')) return;
        await DokuStorage.deleteDocument(doc.id);
        await loadDocuments();
      };
      btnGroup.appendChild(delBtn);

      row.appendChild(btnGroup);
      docListEl.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    docListEl.innerHTML = '<p class="empty-state">Lokaler Speicher ist in diesem Browser nicht verfügbar.</p>';
  }
}

loadTypes();
loadDocuments();
renderPages();
