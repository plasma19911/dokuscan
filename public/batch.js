// DokuScan-Erweiterung: unbegrenzte Stapelauswahl + lokaler Temp-Speicher + Qualitätsmodus.
// Keine künstliche Seitenbegrenzung. Praktische Grenze sind nur Browser-/Geräteressourcen.
(() => {
  const MAX_PAGE_DIMENSION = 3000;
  const PAGE_JPEG_QUALITY = 0.92;
  const THUMB_MAX_DIMENSION = 320;
  const TEMP_DB_NAME = 'dokuscan-temp-pages';
  const TEMP_STORE_NAME = 'pages';

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

  // Die bestehende Scannerlogik übergibt 2000 px. Wir erzwingen den Qualitätsmodus mit 3000 px.
  const originalEstimateOutputSize = DokuCrop.estimateOutputSize.bind(DokuCrop);
  DokuCrop.estimateOutputSize = (quadPoints) => originalEstimateOutputSize(quadPoints, MAX_PAGE_DIMENSION);

  // ------------------------------------------------------- Temporärer Seitenspeicher
  // Große JPEG-Seiten werden nach dem Zuschneiden in IndexedDB ausgelagert.
  // Im RAM bleibt nur eine kleine Vorschau und die Seiten-Metadaten.
  let tempDbPromise = null;
  const trackedPreviewUrls = new Set();
  let storageWarning = '';
  let hadPagesLastRender = false;

  function openTempDb() {
    if (tempDbPromise) return tempDbPromise;
    tempDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(TEMP_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TEMP_STORE_NAME)) {
          db.createObjectStore(TEMP_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return tempDbPromise;
  }

  async function putTempPage(id, blob) {
    const db = await openTempDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEMP_STORE_NAME, 'readwrite');
      tx.objectStore(TEMP_STORE_NAME).put({ id, blob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Temporärer Seitenspeicher abgebrochen.'));
    });
  }

  async function getTempPage(id) {
    const db = await openTempDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEMP_STORE_NAME, 'readonly');
      const req = tx.objectStore(TEMP_STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteTempPage(id) {
    if (!id) return;
    try {
      const db = await openTempDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(TEMP_STORE_NAME, 'readwrite');
        tx.objectStore(TEMP_STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('Temporäre Seite konnte nicht gelöscht werden:', err);
    }
  }

  async function clearTempPages() {
    try {
      const db = await openTempDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(TEMP_STORE_NAME, 'readwrite');
        tx.objectStore(TEMP_STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('Temporärer Seitenspeicher konnte nicht geleert werden:', err);
    }
  }

  const startupCleanupPromise = clearTempPages();

  async function updateStorageWarning() {
    storageWarning = '';
    try {
      if (!navigator.storage?.estimate) return;
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if (!quota) return;
      const free = Math.max(0, quota - usage);
      const freeMb = free / (1024 * 1024);
      const usedRatio = usage / quota;
      if (freeMb < 250 || usedRatio > 0.9) {
        storageWarning = ` ⚠️ Wenig lokaler Speicher frei (${Math.max(0, Math.round(freeMb))} MB).`;
      }
    } catch (err) {
      console.warn('Speicherstatus nicht verfügbar:', err);
    }
  }

  async function makeThumbnailBlob(canvas) {
    const longest = Math.max(canvas.width, canvas.height);
    const scale = Math.min(1, THUMB_MAX_DIMENSION / Math.max(1, longest));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(canvas.width * scale));
    thumb.height = Math.max(1, Math.round(canvas.height * scale));
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return canvasToBlob(thumb, 'image/jpeg', 0.7);
  }

  const getPageBlob = async (page) => {
    if (page.tempId) {
      const stored = await getTempPage(page.tempId);
      if (stored) return stored;
    }
    if (page.blob) return page.blob;
    if (page.canvas) return canvasToBlob(page.canvas, 'image/jpeg', PAGE_JPEG_QUALITY);
    throw new Error('Seite enthält keine Bilddaten.');
  };

  const convertPageToStored = async (page) => {
    if (!page || page.tempId || page.blob || !page.canvas) return;

    await startupCleanupPromise;
    const fullBlob = await canvasToBlob(page.canvas, 'image/jpeg', PAGE_JPEG_QUALITY);
    const thumbBlob = await makeThumbnailBlob(page.canvas);
    const tempId = `page-${page.id || `${Date.now()}-${Math.random()}`}`;

    page.width = page.canvas.width;
    page.height = page.canvas.height;
    page.previewUrl = URL.createObjectURL(thumbBlob);
    trackedPreviewUrls.add(page.previewUrl);

    try {
      await putTempPage(tempId, fullBlob);
      page.tempId = tempId;
    } catch (err) {
      // Kein Datenverlust: wenn IndexedDB voll/gesperrt ist, bleibt die komprimierte Seite als Blob im RAM.
      console.warn('IndexedDB-Temporärspeicher nicht verfügbar, nutze RAM-Fallback:', err);
      page.blob = fullBlob;
      storageWarning = ' ⚠️ Lokaler Temp-Speicher ist nicht verfügbar; große Stapel können mehr RAM benötigen.';
    }

    page.canvas.width = 1;
    page.canvas.height = 1;
    page.canvas = null;
  };

  const convertPagesFrom = async (startIndex) => {
    for (let i = Math.max(0, startIndex); i < pages.length; i++) {
      await convertPageToStored(pages[i]);
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

    if (pages.length > 0) {
      hadPagesLastRender = true;
    } else if (hadPagesLastRender) {
      hadPagesLastRender = false;
      clearTempPages();
    }
  };

  removePage = function removePageOptimized(idx) {
    const [removed] = pages.splice(idx, 1);
    if (removed?.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl);
      trackedPreviewUrls.delete(removed.previewUrl);
    }
    if (removed?.tempId) deleteTempPage(removed.tempId);
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

  // Nach jeder bestätigten Seite wird das große Canvas sofort lokal ausgelagert.
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
        if ((pages.length % 10) === 0) await updateStorageWarning();
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
  // Keine feste Seitenzahl: jede vom Browser/Dateidialog gelieferte Bilddatei wird nacheinander verarbeitet.
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

  batchInput.addEventListener('change', async () => {
    const chosen = Array.from(batchInput.files || []);
    batchInput.value = '';
    if (!chosen.length) return;

    const valid = chosen.filter(looksLikeImage);
    if (!valid.length) {
      statusEl.textContent = 'Bitte Bilddateien auswählen.';
      return;
    }

    await updateStorageWarning();
    batchQueue = valid;
    batchState = {
      total: valid.length,
      done: 0,
      skipped: chosen.length - valid.length,
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
    statusEl.textContent = `Stapel fertig: ${state.done} von ${state.total} Bildseiten übernommen${state.skipped ? `, ${state.skipped} nicht verwendbare/übersprungene Dateien` : ''}.${storageWarning}`;
  };

  function openNextBatchImage() {
    if (!batchState) return;
    if (!batchQueue.length) {
      finishBatch();
      return;
    }

    const file = batchQueue.shift();
    const current = batchState.total - batchQueue.length;
    statusEl.textContent = `Stapel: Bild ${current} von ${batchState.total} – Ecken prüfen und übernehmen.${storageWarning}`;

    const img = new Image();
    pendingObjectUrl = URL.createObjectURL(file);
    img.onload = () => openCropModal(img);
    img.onerror = () => {
      batchState.skipped += 1;
      cleanupPendingImage();
      statusEl.textContent = `Bild ${current} konnte nicht geöffnet werden. Fahre mit dem Stapel fort.${storageWarning}`;
      openNextBatchImage();
    };
    img.src = pendingObjectUrl;
  }

  cropCancelBtn.addEventListener('click', () => {
    if (!batchState) return;
    batchState.skipped += 1;
    setTimeout(openNextBatchImage, 0);
  });

  window.addEventListener('pagehide', () => {
    for (const url of trackedPreviewUrls) URL.revokeObjectURL(url);
  });

  renderPages();
})();