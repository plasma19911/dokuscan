// DokuScan-Erweiterung: Mehrfachauswahl + speichersparende Seiten + Qualitätsmodus.
// Läuft vollständig im Browser und verwendet keine Netzwerk-Uploads.
(() => {
  const MAX_BATCH = 30;
  const MAX_PAGE_DIMENSION = 3000;
  const PAGE_JPEG_QUALITY = 0.92;

  const batchInput = document.getElementById('batchInput');
  const batchAddBtn = document.getElementById('batchAddBtn');
  const addPageBtn = document.getElementById('addPageBtn');
  const cropConfirmBtn = document.getElementById('cropConfirmBtn');
  const cropCancelBtn = document.getElementById('cropCancelBtn');
  const statusEl = document.getElementById('status');
  const pageListEl = document.getElementById('pageList');
  const pageBadge = document.getElementById('pageBadge');
  const finishBtn = document.getElementById('finishBtn');

  if (!batchInput || !batchAddBtn) return;

  // Die vorhandene Scannerlogik ruft estimateOutputSize(..., 2000) auf.
  // Für alle neuen Scans verwenden wir stattdessen bis zu 3000 px an der längsten Kante.
  const originalEstimateOutputSize = DokuCrop.estimateOutputSize.bind(DokuCrop);
  DokuCrop.estimateOutputSize = (quadPoints) => originalEstimateOutputSize(quadPoints, MAX_PAGE_DIMENSION);

  // Verarbeitete Seiten als JPEG-Blob statt als großes Canvas im RAM halten.
  // Die bestehenden Funktionen werden so erweitert, dass sowohl alte Canvas-Seiten
  // als auch neue Blob-Seiten funktionieren.
  const trackedPreviewUrls = new Set();

  const getPageBlob = async (page) => {
    if (page.blob) return page.blob;
    if (page.canvas) return canvasToBlob(page.canvas, 'image/jpeg', PAGE_JPEG_QUALITY);
    throw new Error('Seite enthält keine Bilddaten.');
  };

  const convertPageToBlob = async (page) => {
    if (!page || page.blob || !page.canvas) return;
    const blob = await canvasToBlob(page.canvas, 'image/jpeg', PAGE_JPEG_QUALITY);
    page.width = page.canvas.width;
    page.height = page.canvas.height;
    page.blob = blob;
    page.previewUrl = URL.createObjectURL(blob);
    trackedPreviewUrls.add(page.previewUrl);
    page.canvas.width = 1;
    page.canvas.height = 1;
    page.canvas = null;
  };

  const convertPagesFrom = async (startIndex) => {
    for (let i = Math.max(0, startIndex); i < pages.length; i++) {
      await convertPageToBlob(pages[i]);
    }
  };

  renderPages = function renderPagesOptimized() {
    const currentUrls = new Set(pages.map((page) => page.previewUrl).filter(Boolean));
    for (const url of [...trackedPreviewUrls]) {
      if (!currentUrls.has(url)) {
        URL.revokeObjectURL(url);
        trackedPreviewUrls.delete(url);
      }
    }

    pageListEl.innerHTML = '';
    pages.forEach((page, idx) => {
      const card = document.createElement('div');
      card.className = 'page-card';

      const thumb = document.createElement('img');
      if (page.previewUrl) {
        thumb.src = page.previewUrl;
        trackedPreviewUrls.add(page.previewUrl);
      } else if (page.canvas) {
        thumb.src = page.canvas.toDataURL('image/jpeg', 0.62);
      }
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
  };

  removePage = function removePageOptimized(idx) {
    const [removed] = pages.splice(idx, 1);
    if (removed?.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl);
      trackedPreviewUrls.delete(removed.previewUrl);
    }
    renderPages();
  };

  recognizeDocumentText = async function recognizeDocumentTextOptimized() {
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
        const pageBlob = await getPageBlob(pages[i]);
        const { data } = await worker.recognize(pageBlob);
        fullText += `\n\n${data.text || ''}`;
      }
    } finally {
      if (worker) await worker.terminate();
    }
    return fullText;
  };

  buildPdf = async function buildPdfOptimized(type) {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(type);
    pdfDoc.setSubject('Erstellt mit DokuScan – lokal im Browser');
    pdfDoc.setCreator('DokuScan');

    for (let i = 0; i < pages.length; i++) {
      showProcessing(`Erstelle PDF – Seite ${i + 1} von ${pages.length} …`);
      const pageBlob = await getPageBlob(pages[i]);
      const jpegBytes = await pageBlob.arrayBuffer();
      const image = await pdfDoc.embedJpg(jpegBytes);
      const pdfPage = pdfDoc.addPage([image.width, image.height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  };

  // Nach jeder bestätigten Seite wird das große Canvas sofort in einen Blob umgewandelt.
  let confirmStartCount = 0;
  cropConfirmBtn.addEventListener('click', () => {
    confirmStartCount = pages.length;
  }, true);

  cropConfirmBtn.addEventListener('click', () => {
    const before = confirmStartCount;
    setTimeout(async () => {
      if (pages.length <= before) return;
      try {
        await convertPagesFrom(before);
        renderPages();
      } catch (err) {
        console.warn('Speicheroptimierung fehlgeschlagen:', err);
      }

      if (batchState) {
        batchState.done += 1;
        openNextBatchImage();
      }
    }, 0);
  });

  // ---------------------------------------------------------- Mehrfachauswahl
  let batchQueue = [];
  let batchState = null;

  const looksLikeImage = (file) => {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name || '');
  };

  batchAddBtn.addEventListener('click', () => {
    if (batchState) return;
    batchInput.click();
  });

  batchInput.addEventListener('change', () => {
    const chosen = Array.from(batchInput.files || []);
    batchInput.value = '';
    if (!chosen.length) return;

    const valid = chosen.filter(looksLikeImage);
    const selected = valid.slice(0, MAX_BATCH);
    if (!selected.length) {
      statusEl.textContent = 'Bitte Bilddateien auswählen.';
      return;
    }

    batchQueue = selected;
    batchState = {
      total: selected.length,
      done: 0,
      skipped: 0,
      truncated: valid.length > MAX_BATCH || chosen.length > MAX_BATCH,
    };
    addPageBtn.disabled = true;
    batchAddBtn.disabled = true;
    openNextBatchImage();
  });

  const finishBatch = () => {
    if (!batchState) return;
    const state = batchState;
    batchState = null;
    batchQueue = [];
    addPageBtn.disabled = false;
    batchAddBtn.disabled = false;
    const extra = state.truncated ? ` Maximal ${MAX_BATCH} Bilder pro Stapel wurden verarbeitet.` : '';
    statusEl.textContent = `Stapel fertig: ${state.done} von ${state.total} Seiten übernommen${state.skipped ? `, ${state.skipped} übersprungen` : ''}.${extra}`;
  };

  function openNextBatchImage() {
    if (!batchState) return;
    if (!batchQueue.length) {
      finishBatch();
      return;
    }

    const file = batchQueue.shift();
    const current = batchState.done + batchState.skipped + 1;
    statusEl.textContent = `Stapel: Bild ${current} von ${batchState.total} – Ecken prüfen und übernehmen.`;

    if (!looksLikeImage(file)) {
      batchState.skipped += 1;
      openNextBatchImage();
      return;
    }

    const img = new Image();
    pendingObjectUrl = URL.createObjectURL(file);
    img.onload = () => openCropModal(img);
    img.onerror = () => {
      batchState.skipped += 1;
      cleanupPendingImage();
      statusEl.textContent = `Bild ${current} konnte nicht geöffnet werden. Fahre mit dem Stapel fort.`;
      openNextBatchImage();
    };
    img.src = pendingObjectUrl;
  }

  cropCancelBtn.addEventListener('click', () => {
    if (!batchState) return;
    batchState.skipped += 1;
    setTimeout(openNextBatchImage, 0);
  });

  renderPages();
})();
