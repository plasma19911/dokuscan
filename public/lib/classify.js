// Erkennt die Dokumentenart rein im Browser anhand des OCR-Textes.
// Lädt lediglich die (unkritische) Stichwortliste vom eigenen Server -
// der erkannte Dokumenttext selbst verlässt das Gerät dabei nie.

let cachedKeywords = null;

async function loadKeywords() {
  if (cachedKeywords) return cachedKeywords;
  const res = await fetch('/keywords.json');
  cachedKeywords = await res.json();
  return cachedKeywords;
}

async function classify(text) {
  const keywords = await loadKeywords();
  const lowerText = (text || '').toLowerCase();

  const scores = {};
  for (const [type, words] of Object.entries(keywords)) {
    let score = 0;
    for (const word of words) {
      if (lowerText.includes(word.toLowerCase())) score += 1;
    }
    scores[type] = score;
  }

  let bestType = 'Sonstiges';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }
  return { type: bestType, scores };
}

async function listTypes() {
  const keywords = await loadKeywords();
  return [...Object.keys(keywords), 'Sonstiges'];
}

window.DokuClassify = { classify, listTypes };
