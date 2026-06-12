# -*- coding: utf-8 -*-
"""
Küchenvorrat – komplett lokales Programm (keine Internetverbindung nötig).

Funktionen:
- Produkte mit Soll-Vorrat anlegen
- Einkäufe und Verbrauch erfassen
- Einkaufsliste: was muss gekauft werden, um den Vorrat voll zu halten
- Schätzung des Verbrauchs aus dem Einkaufsverhalten
  (durchschnittlich gekaufte Menge pro Tag zwischen den Einkäufen)

Daten liegen in vorratsdaten.json im selben Ordner.
Start:  python vorrat.py
"""

import json
import os
from datetime import datetime, date

import tkinter as tk
from tkinter import ttk, messagebox, simpledialog

DATEI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vorratsdaten.json")
DATUMSFORMAT = "%Y-%m-%d"


# ---------------------------------------------------------------- Datenhaltung

def laden():
    if os.path.exists(DATEI):
        with open(DATEI, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"produkte": []}


def speichern(daten):
    with open(DATEI, "w", encoding="utf-8") as f:
        json.dump(daten, f, ensure_ascii=False, indent=2)


def heute():
    return date.today().strftime(DATUMSFORMAT)


# ---------------------------------------------------------------- Auswertung

def verbrauch_pro_tag(produkt):
    """Schätzt den Tagesverbrauch aus dem Einkaufsverhalten.

    Annahme: Was zwischen erstem und letztem Einkauf gekauft wurde,
    wurde in dieser Zeit auch verbraucht. Zusätzlich erfasster
    Verbrauch fließt direkt ein.
    """
    eink = sorted(produkt.get("einkaeufe", []), key=lambda e: e["datum"])
    if len(eink) < 2:
        return None
    erster = datetime.strptime(eink[0]["datum"], DATUMSFORMAT).date()
    letzter = datetime.strptime(eink[-1]["datum"], DATUMSFORMAT).date()
    tage = (letzter - erster).days
    if tage <= 0:
        return None
    # Menge ohne den letzten Einkauf – die gilt als im Zeitraum verbraucht
    menge = sum(e["menge"] for e in eink[:-1])
    return menge / tage


def bestand(produkt):
    gekauft = sum(e["menge"] for e in produkt.get("einkaeufe", []))
    verbraucht = sum(v["menge"] for v in produkt.get("verbrauch", []))
    return max(0, gekauft - verbraucht)


def reicht_noch_tage(produkt):
    rate = verbrauch_pro_tag(produkt)
    if not rate:
        return None
    return bestand(produkt) / rate


def einkaufsliste(daten):
    """Alles, was unter dem Soll-Vorrat liegt."""
    liste = []
    for p in daten["produkte"]:
        fehlt = p["soll"] - bestand(p)
        if fehlt > 0:
            liste.append((p, fehlt))
    return liste


# ---------------------------------------------------------------- Oberfläche

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Küchenvorrat")
        self.geometry("760x520")
        self.daten = laden()

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=8, pady=8)

        self.tab_vorrat = ttk.Frame(nb)
        self.tab_liste = ttk.Frame(nb)
        nb.add(self.tab_vorrat, text="Vorrat")
        nb.add(self.tab_liste, text="Einkaufsliste")

        self._baue_vorrat()
        self._baue_liste()
        self.aktualisieren()

    # ----- Tab Vorrat
    def _baue_vorrat(self):
        spalten = ("produkt", "einheit", "bestand", "soll", "reichweite")
        self.tabelle = ttk.Treeview(self.tab_vorrat, columns=spalten, show="headings")
        titel = {"produkt": "Produkt", "einheit": "Einheit", "bestand": "Bestand",
                 "soll": "Soll-Vorrat", "reichweite": "Reicht noch ca."}
        for s in spalten:
            self.tabelle.heading(s, text=titel[s])
            self.tabelle.column(s, width=130, anchor="center")
        self.tabelle.column("produkt", width=200, anchor="w")
        self.tabelle.pack(fill="both", expand=True, padx=6, pady=6)

        leiste = ttk.Frame(self.tab_vorrat)
        leiste.pack(fill="x", padx=6, pady=(0, 6))
        ttk.Button(leiste, text="Produkt anlegen", command=self.produkt_anlegen).pack(side="left")
        ttk.Button(leiste, text="Einkauf eintragen", command=self.einkauf).pack(side="left", padx=6)
        ttk.Button(leiste, text="Verbrauch eintragen", command=self.verbrauch).pack(side="left")
        ttk.Button(leiste, text="Produkt löschen", command=self.loeschen).pack(side="right")

    # ----- Tab Einkaufsliste
    def _baue_liste(self):
        spalten = ("produkt", "kaufen", "einheit", "hinweis")
        self.liste = ttk.Treeview(self.tab_liste, columns=spalten, show="headings")
        titel = {"produkt": "Produkt", "kaufen": "Kaufen", "einheit": "Einheit", "hinweis": "Hinweis"}
        for s in spalten:
            self.liste.heading(s, text=titel[s])
        self.liste.column("produkt", width=200, anchor="w")
        self.liste.column("kaufen", width=80, anchor="center")
        self.liste.column("einheit", width=80, anchor="center")
        self.liste.column("hinweis", width=320, anchor="w")
        self.liste.pack(fill="both", expand=True, padx=6, pady=6)

    # ----- Aktionen
    def gewaehltes_produkt(self):
        sel = self.tabelle.selection()
        if not sel:
            messagebox.showinfo("Hinweis", "Bitte erst ein Produkt in der Tabelle auswählen.")
            return None
        name = self.tabelle.item(sel[0], "values")[0]
        for p in self.daten["produkte"]:
            if p["name"] == name:
                return p
        return None

    def produkt_anlegen(self):
        name = simpledialog.askstring("Produkt anlegen", "Name des Produkts:", parent=self)
        if not name:
            return
        if any(p["name"].lower() == name.lower() for p in self.daten["produkte"]):
            messagebox.showwarning("Hinweis", "Dieses Produkt gibt es schon.")
            return
        einheit = simpledialog.askstring("Einheit", "Einheit (z. B. Stück, Liter, kg):",
                                         parent=self, initialvalue="Stück") or "Stück"
        soll = simpledialog.askfloat("Soll-Vorrat", "Wie viel soll immer da sein?", parent=self, minvalue=0)
        if soll is None:
            return
        self.daten["produkte"].append({"name": name, "einheit": einheit, "soll": soll,
                                       "einkaeufe": [], "verbrauch": []})
        speichern(self.daten)
        self.aktualisieren()

    def einkauf(self):
        p = self.gewaehltes_produkt()
        if not p:
            return
        menge = simpledialog.askfloat("Einkauf", f"Gekaufte Menge ({p['einheit']}):",
                                      parent=self, minvalue=0.001)
        if menge is None:
            return
        p["einkaeufe"].append({"datum": heute(), "menge": menge})
        speichern(self.daten)
        self.aktualisieren()

    def verbrauch(self):
        p = self.gewaehltes_produkt()
        if not p:
            return
        menge = simpledialog.askfloat("Verbrauch", f"Verbrauchte Menge ({p['einheit']}):",
                                      parent=self, minvalue=0.001)
        if menge is None:
            return
        p["verbrauch"].append({"datum": heute(), "menge": menge})
        speichern(self.daten)
        self.aktualisieren()

    def loeschen(self):
        p = self.gewaehltes_produkt()
        if not p:
            return
        if messagebox.askyesno("Löschen", f"„{p['name']}“ wirklich löschen?"):
            self.daten["produkte"].remove(p)
            speichern(self.daten)
            self.aktualisieren()

    # ----- Anzeige
    def aktualisieren(self):
        self.tabelle.delete(*self.tabelle.get_children())
        for p in self.daten["produkte"]:
            tage = reicht_noch_tage(p)
            reichweite = f"{tage:.0f} Tage" if tage is not None else "– (zu wenig Daten)"
            self.tabelle.insert("", "end", values=(
                p["name"], p["einheit"], f"{bestand(p):g}", f"{p['soll']:g}", reichweite))

        self.liste.delete(*self.liste.get_children())
        for p, fehlt in einkaufsliste(self.daten):
            tage = reicht_noch_tage(p)
            if bestand(p) == 0:
                hinweis = "Vorrat ist leer!"
            elif tage is not None:
                hinweis = f"Vorrat reicht noch ca. {tage:.0f} Tage"
            else:
                hinweis = "Unter Soll-Vorrat"
            self.liste.insert("", "end", values=(p["name"], f"{fehlt:g}", p["einheit"], hinweis))


if __name__ == "__main__":
    App().mainloop()
