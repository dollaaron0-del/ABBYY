====================================================================
ABBYY FlexiCapture – KI-Bot Installationsanleitung
Für IT-Abteilung / ABBYY Administrator
====================================================================

WAS MACHT DER BOT?
------------------
Wenn ein Dokument in der ABBYY Verification Station geöffnet wird,
ruft das Skript automatisch den lokalen KI-Server auf (läuft auf
demselben Rechner unter 127.0.0.1:3001). Der KI-Server analysiert
den Text, erkennt Dokumenttyp und Felder, und das Skript trägt die
Ergebnisse direkt in die ABBYY-Felder ein.

Bei hoher Konfidenz wird der Task automatisch abgeschlossen.
Bei Unsicherheit werden die Felder ausgefüllt aber der Sachbearbeiter
muss den Task manuell bestätigen.

VORAUSSETZUNGEN
---------------
1. KI-Backend läuft auf dem Verification-Station-PC:
   - Starten mit: starten.bat im ABBYY-Programmordner
   - Backend läuft auf: http://127.0.0.1:3001
   - Test: Browser öffnen → http://127.0.0.1:3001/api/health

2. ABBYY FlexiCapture (Version 12 oder höher)

INSTALLATION IM ABBYY SCRIPT EDITOR
-------------------------------------
SCHRITT 1: FlexiCapture-Projekt öffnen
  → ABBYY FlexiCapture Administration → Projekt auswählen

SCHRITT 2: Script Editor öffnen
  → Menü: Projekt → Eigenschaften → Skripte
  ODER: Im Document Definition Editor → Skript-Editor

SCHRITT 3: Skript-Datei einfügen
  → Inhalt von AbbyyBot.cs in den Script Editor kopieren
  ODER → "Datei hinzufügen" → AbbyyBot.cs auswählen

SCHRITT 4: Event-Bindung konfigurieren
  Im Script Editor den Event "Document_OnOpen" oder
  "BeforeVerification" mit der Methode "AbbyyBotScript.OnDocumentOpened"
  verbinden.

  Konkret:
  a) In der Event-Liste: Document → On Open
  b) Handler: AbbyyBotScript.OnDocumentOpened
  c) Speichern und Projekt neu laden

SCHRITT 5: ABBYY-Feldnamen anpassen (WICHTIG!)
  Im Skript (Zeile ~96) sind die ABBYY-Feldnamen hinterlegt.
  Diese müssen mit den echten Feldnamen in eurem FlexiCapture-Projekt
  übereinstimmen.

  Aktuelle Mapping (linke Spalte = unser Name, rechte Spalte = ABBYY):
  "absender"         → "Supplier", "Lieferant", "Absender", "VendorName"
  "rechnungsnummer"  → "InvoiceNumber", "Rechnungsnummer", "InvNumber"
  "rechnungsdatum"   → "InvoiceDate", "Rechnungsdatum", "InvDate"
  "betrag_brutto"    → "TotalAmount", "Brutto", "GrossAmount", "InvoiceTotal"
  "iban"             → "IBAN", "BankIBAN"
  usw.

  → Wenn die ABBYY-Feldnamen anders heißen: Skript-Zeile 96–114 anpassen.

  Die echten Feldnamen findet man im Document Definition Editor unter
  Felder → Eigenschaften → Name.

SCHRITT 6: Test
  → Ein Testdokument in Verification Station öffnen
  → Konsole (oder MessageWindow) beobachten
  → Bot sollte innerhalb von 30–120 Sekunden die Felder ausfüllen

KONFIGURATION IM SKRIPT
------------------------
Am Anfang von AbbyyBot.cs:

  API_BASE    = "http://127.0.0.1:3001/api/abbyy/bot"
               → Ändern wenn Backend auf anderem Rechner/Port

  TIMEOUT_MS  = 300000  (5 Minuten)
               → KI-Analyse kann bei großen PDFs länger dauern

  LOG_TO_CONSOLE = true
               → Auf false setzen im Produktionsbetrieb

FEHLERBEHEBUNG
--------------
Problem: "KI-Bot: Backend nicht erreichbar"
Lösung:  starten.bat ausführen, dann 30 Sekunden warten

Problem: "Felder werden nicht ausgefüllt"
Lösung:  ABBYY-Feldnamen prüfen (Schritt 5)

Problem: Bot läuft aber Felder sind falsch
Lösung:  Ollama-Modell prüfen (llama3.2 oder besser)
         Settings: http://127.0.0.1:3001 → Einstellungen

SICHERHEIT
----------
- Der Bot kommuniziert NUR mit 127.0.0.1 (localhost)
- Keine Daten verlassen das Firmennetzwerk
- Keine Cloud-Dienste werden verwendet
- Alle Daten bleiben lokal auf dem PC

====================================================================
Fragen: IT-Abteilung oder Werkstudent Finanzbuchhaltung
====================================================================
