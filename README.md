# ABBYY Rechnungsvorfilterung

**Althoff Hotels & Resorts – Intelligentes Dokumentenklassifizierungssystem**

Ein vollständig On-Premise betriebenes System zur automatischen Vorklassifizierung von eingehenden Dokumenten (Rechnungen, Mahnungen, Behördenbescheide) mittels lokaler KI (Ollama) und OCR (Tesseract.js).

---

## Systemarchitektur

```
┌─────────────────────────────────────────────────────────┐
│                  Docker Compose Stack                   │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐   ┌───────────┐  │
│  │   Frontend   │    │   Backend    │   │  Ollama   │  │
│  │  React/Vite  │───▶│  Node/Express│──▶│ llama3.2  │  │
│  │   Port 3000  │    │  Port 3001   │   │ Port 11434│  │
│  └──────────────┘    └──────────────┘   └───────────┘  │
│                             │                           │
│                      ┌──────────────┐                  │
│                      │   SQLite DB  │                  │
│                      │  /app/data/  │                  │
│                      └──────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

### Verarbeitungs-Pipeline

```
Dokument-Upload → OCR (Tesseract.js) → KI-Analyse (Ollama) → Lieferanten-Abgleich → Ampel-Zuweisung → [Optional: ABBYY-Weiterleitung]
```

### Ampel-Logik

| Ampel | Bedingung |
|-------|-----------|
| 🟢 Grün | Bekannter Typ (Rechnung/Mahnung/Bescheid) + Konfidenz ≥ Schwellenwert + Lieferant erkannt |
| 🟡 Gelb | Bekannter Typ, aber Konfidenz < Schwellenwert ODER Lieferant unbekannt |
| 🔴 Rot | Unleserlich, Sonstiges oder Verarbeitungsfehler |

---

## Voraussetzungen

- **Docker** ≥ 24.0 und **Docker Compose** ≥ 2.20
- Für GPU-Beschleunigung (optional): NVIDIA GPU mit CUDA + nvidia-container-toolkit
- Mindestens 8 GB RAM (16 GB empfohlen für Ollama)
- 20 GB freier Speicherplatz (für Ollama-Modell)

---

## Installation

### 1. Repository klonen / Dateien bereitstellen

```bash
# Ins Verzeichnis wechseln
cd /opt/rechnungsvorfilterung
```

### 2. Docker Compose starten

```bash
# Alle Services starten (erster Start lädt Ollama-Image, dauert ca. 2-5 Minuten)
docker compose up -d

# Logs verfolgen
docker compose logs -f
```

### 3. Ollama-Modell herunterladen

Nach dem ersten Start muss das KI-Modell heruntergeladen werden (ca. 7-8 GB):

```bash
# Modell herunterladen (llama3.2-vision für OCR+Analyse)
docker exec rechnungsvorfilterung-ollama ollama pull llama3.2-vision

# Alternativ: Leichteres Modell für schwächere Hardware
docker exec rechnungsvorfilterung-ollama ollama pull llama3.2
```

### 4. Anwendung aufrufen

Öffnen Sie im Browser: **http://localhost:3000**

---

## Konfiguration

### Einstellungen-Seite (Empfehlung: Erster Start)

1. **KI-Einstellungen**: Ollama-Modell auswählen (nach dem Herunterladen erscheint es im Dropdown)
2. **Konfidenz-Schwellenwert**: Empfehlung 75% – Dokumente mit niedrigerer Konfidenz gehen in manuelle Prüfung
3. **ABBYY-Integration** (optional): Endpunkt und Token konfigurieren, Verbindung testen
4. **Claude API Fallback**: Nur aktivieren wenn nötig – Daten verlassen das Netzwerk!

### Lieferanten importieren

Importieren Sie Ihre Lieferantenliste über **Einstellungen → Lieferanten → CSV/Excel importieren**.

Erwartetes CSV-Format (Semikolon-getrennt):
```csv
Name;Aliases;Kategorie
Müller GmbH;Müller,Mueller GmbH;Lebensmittel
Rewe Group;REWE,Rewe Markt;Einzelhandel
```

Excel-Format: Spalten `Name`, `Aliases` (kommagetrennt), `Kategorie`

---

## Betrieb

### Services verwalten

```bash
# Status prüfen
docker compose ps

# Einzelnen Service neu starten
docker compose restart backend

# Logs anzeigen
docker compose logs backend --tail=100 -f

# Alles stoppen
docker compose down

# Alles stoppen und Volumes löschen (VORSICHT: löscht Datenbank!)
docker compose down -v
```

### Datensicherung

```bash
# Datenbank sichern
cp ./data/database.sqlite ./data/database.sqlite.bak

# Hochgeladene Dokumente sichern
tar czf uploads_backup_$(date +%Y%m%d).tar.gz ./uploads/
```

### Ollama-Modelle verwalten

```bash
# Verfügbare Modelle anzeigen
docker exec rechnungsvorfilterung-ollama ollama list

# Weiteres Modell herunterladen
docker exec rechnungsvorfilterung-ollama ollama pull mistral

# Modell entfernen
docker exec rechnungsvorfilterung-ollama ollama rm llama3.2
```

---

## Dateistruktur

```
/opt/rechnungsvorfilterung/
├── docker-compose.yml
├── data/
│   └── database.sqlite          # SQLite Datenbank
├── uploads/
│   ├── originals/               # Originaldokumente
│   ├── processed/               # Verarbeitete Versionen
│   └── thumbnails/              # Vorschaubilder
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js             # Express-Server
│       ├── database/
│       │   ├── db.js            # DB-Singleton
│       │   └── schema.js        # Schema & Initialisierung
│       ├── routes/
│       │   ├── documents.js     # Dokument-API
│       │   ├── analysis.js      # Analyse-API
│       │   ├── suppliers.js     # Lieferanten-API
│       │   ├── settings.js      # Einstellungen-API
│       │   ├── abbyy.js         # ABBYY-Integration
│       │   └── reports.js       # Berichte & Export
│       └── services/
│           ├── documentProcessor.js   # Haupt-Pipeline
│           ├── ocrService.js          # OCR mit Tesseract
│           ├── aiService.js           # Ollama/Claude KI
│           └── supplierMatchingService.js  # Fuzzy Matching
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── pages/               # React-Seiten
        ├── components/          # Layout etc.
        ├── api/                 # API-Client
        └── types/               # TypeScript-Typen
```

---

## API-Dokumentation (Backend)

### Gesundheit
- `GET /api/health` – Systemstatus

### Dokumente
- `GET /api/documents` – Liste (Filter: status, ampel, search, page, limit)
- `GET /api/documents/stats` – Statistiken (Filter: from, to)
- `GET /api/documents/:id` – Einzelnes Dokument
- `POST /api/documents/upload` – Einzelnes Dokument hochladen (multipart: `file`)
- `POST /api/documents/upload-batch` – Mehrere Dokumente (multipart: `files[]`)
- `PATCH /api/documents/:id` – Dokument aktualisieren (Korrekturen)
- `DELETE /api/documents/:id` – Dokument löschen

### Analyse
- `POST /api/analysis/trigger/:id` – Analyse (re-)starten
- `POST /api/analysis/trigger-batch` – Batch-Analyse
- `GET /api/analysis/status/:id` – Analysestatus
- `POST /api/analysis/ocr/:id` – Nur OCR ausführen
- `GET /api/analysis/ollama/models` – Verfügbare Ollama-Modelle
- `GET /api/analysis/ollama/health` – Ollama-Status

### Lieferanten
- `GET /api/suppliers` – Liste
- `POST /api/suppliers` – Anlegen
- `PUT /api/suppliers/:id` – Aktualisieren
- `DELETE /api/suppliers/:id` – Löschen
- `POST /api/suppliers/import` – CSV/Excel importieren
- `GET /api/suppliers/export/excel` – Excel exportieren

### Einstellungen
- `GET /api/settings` – Alle Einstellungen
- `PUT /api/settings` – Mehrere Einstellungen speichern

### ABBYY
- `GET /api/abbyy/test` – Verbindung testen
- `POST /api/abbyy/forward/:id` – Dokument weiterleiten
- `POST /api/abbyy/forward-batch` – Mehrere weiterleiten

### Berichte
- `GET /api/reports/summary` – Zusammenfassung (Filter: from, to)
- `GET /api/reports/export` – Excel-Export
- `GET /api/reports/processing-log` – Verarbeitungsprotokoll

---

## Fehlerbehebung

### Backend startet nicht
```bash
docker compose logs backend
# Häufige Ursachen: Port 3001 bereits belegt, Verzeichnisberechtigungen
```

### Ollama nicht erreichbar
```bash
docker compose logs ollama
docker exec rechnungsvorfilterung-ollama ollama list
# Sicherstellen, dass das Modell heruntergeladen wurde
```

### OCR liefert leeren Text
- Für bessere Ergebnisse: Bilder mit mindestens 300 DPI scannen
- Tesseract-Sprachen prüfen: Einstellungen → OCR-Sprache

### Dokument bleibt in "In Bearbeitung"
```bash
docker compose restart backend
# Prüfen ob Ollama-Modell geladen ist
docker exec rechnungsvorfilterung-ollama ollama list
```

---

## Datenschutz & Sicherheit

- **Vollständig On-Premise**: Alle Daten verbleiben im lokalen Netzwerk
- **Kein externer Netzwerkzugriff** im Normalbetrieb
- **Claude API Fallback**: Nur manuell aktivierbar; zeigt Warnbanner
- **Passwörter/Tokens**: Werden in SQLite gespeichert (On-Premise)
- **Empfehlung**: System hinter Firewall/VPN betreiben, kein direkter Internetzugang

---

## Support & Wartung

Bei technischen Fragen zur Installation wenden Sie sich an Ihre IT-Abteilung.

System entwickelt für Althoff Hotels & Resorts · Version 1.0.0
