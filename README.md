# DokuScan 3.0 – GitHub + Cloudflare Pages

Privater Dokumenten- und Fotoscanner für Handy und PC.

## Datenschutz-Prinzip

- Die Website hat **keinen Upload-Endpunkt** für Fotos oder PDFs.
- Zuschneiden, Filter, OCR, Dokumentenerkennung und PDF-Erstellung laufen im Browser.
- Die fertige PDF bleibt zunächst nur im Arbeitsspeicher.
- Über **„Speichern unter / Teilen“** bestimmst du den Ablageort, soweit dein Browser das unterstützt.
- Eine zusätzliche Kopie in IndexedDB ist **optional** und standardmäßig ausgeschaltet.
- Cloudflare liefert nur HTML/CSS/JS, OCR-Modelle und Bibliotheken aus.
- Eine Content-Security-Policy beschränkt Laufzeit-Verbindungen auf die eigene Website.

Cloudflare kann wie jeder Webhoster normale Verbindungsdaten des Seitenaufrufs sehen (z. B. IP/HTTP-Anfragen auf App-Dateien). Die Dokumentbilder, OCR-Texte und erzeugten PDFs werden von der App nicht an Cloudflare gesendet.

## Cloudflare Pages Einstellungen

- Repository: dieses GitHub-Repository
- Framework preset: None
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/` bzw. leer lassen

Beim Build werden die Browserbibliotheken aus den npm-Paketen in `dist/vendor/` kopiert und die deutschen/englischen OCR-Sprachmodelle einmalig heruntergeladen und mit ausgeliefert. Beim späteren Scannen lädt der Browser alles nur von deiner Cloudflare-Domain.

## Handy-App / Icon

Die App enthält ein Web-App-Manifest, Service Worker sowie 192x192- und 512x512-Icons.

- Android/Chrome: Menü → App installieren / Zum Startbildschirm hinzufügen
- iPhone/Safari: Teilen → Zum Home-Bildschirm

## Wichtige Dateien

- `public/index.html` – Oberfläche
- `public/app.js` – Scannerlogik, OCR, PDF, Speichern/Teilen
- `public/lib/crop.js` – Perspektivkorrektur
- `public/lib/storage.js` – optionale lokale IndexedDB-Bibliothek
- `public/_headers` – Sicherheitsheader/CSP
- `public/manifest.webmanifest` – PWA-Konfiguration
- `public/sw.js` – Offline-/Cache-Unterstützung
- `build.mjs` – Cloudflare-Build
- `wrangler.toml` – Pages-Ausgabeverzeichnis

## Lokal entwickeln

Zum vollständigen Test mit OCR müssen zuerst die npm-Abhängigkeiten installiert und der Build ausgeführt werden:

```bash
npm install
npm run build
```

Danach `dist/` über einen lokalen HTTPS-Server oder Cloudflare Pages öffnen. Für Kamerafunktionen auf dem Handy ist HTTPS erforderlich.
