# Küchenvorrat

Ein komplett **lokales** Programm: Es läuft nur auf deinem Rechner, braucht kein
Internet und keine Server. Die Daten liegen in der Datei `vorratsdaten.json`
im selben Ordner.

## Was es kann
- Produkte für die Küche mit einem **Soll-Vorrat** anlegen (z. B. immer 6 Liter Milch)
- **Einkäufe** und **Verbrauch** eintragen
- Tab **Einkaufsliste**: zeigt automatisch, was und wie viel du kaufen musst,
  um den Vorrat wieder vollzumachen
- Schätzt aus deinem **Einkaufsverhalten** (wie oft und wie viel du kaufst),
  wie lange der Vorrat noch reicht

## Starten
Voraussetzung: Python 3 (mit Tkinter, ist bei der normalen Installation dabei).

- Windows: Doppelklick auf `Vorrat starten.bat`
- Oder im Terminal: `python vorrat.py`

## Bedienung
1. **Produkt anlegen** – Name, Einheit und Soll-Vorrat angeben
2. Nach jedem Einkauf: Produkt auswählen → **Einkauf eintragen**
3. Optional Verbrauch eintragen (sonst wird er aus den Einkäufen geschätzt)
4. Im Tab **Einkaufsliste** steht, was gekauft werden muss
