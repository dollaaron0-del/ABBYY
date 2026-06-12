// =============================================================================
// ABBYY FlexiCapture – KI-Bot Skript
// Datei: AbbyyBot.cs
// Einzufügen in: ABBYY FlexiCapture → Projekt → Skript-Editor
//
// Dieses Skript verbindet sich beim Öffnen eines Dokuments mit dem lokalen
// KI-Backend (127.0.0.1:3001), analysiert den Inhalt und füllt die Felder
// automatisch aus. Bei hoher Konfidenz wird der Task selbstständig abgeschlossen.
//
// Installation: Siehe README_INSTALLATION.txt
// =============================================================================

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

// ---- KONFIGURATION ----------------------------------------------------------
// Passe diese Werte an deine Installation an:
public static class BotConfig
{
    public const string API_BASE = "http://127.0.0.1:3001/api/abbyy/bot";
    public const int    TIMEOUT_MS = 300000; // 5 Minuten (KI braucht Zeit)
    public const bool   LOG_TO_CONSOLE = true;
}
// -----------------------------------------------------------------------------

/// <summary>
/// Hauptskript – wird von ABBYY FlexiCapture aufgerufen.
/// Binde die Methoden an die entsprechenden Dokument-Events im Script Editor.
/// </summary>
public class AbbyyBotScript
{
    // =========================================================================
    // EVENT: Wird aufgerufen wenn ein Dokument in der Verification Station
    //        zur Bearbeitung geöffnet wird.
    //        Binde diesen Event an: Dokument → OnOpen (oder BeforeVerification)
    // =========================================================================
    public static void OnDocumentOpened(IScriptingHost host)
    {
        IDocument doc = host.Document;
        string docName = GetDocumentName(doc);

        Log("=== ABBYY KI-Bot gestartet für: " + docName);

        try
        {
            // 1. OCR-Text aus ABBYY-Dokument lesen
            string ocrText = ExtractOcrText(doc);
            Log("OCR-Text gelesen: " + ocrText.Length + " Zeichen");

            // 2. Vorhandene ABBYY-Felder auslesen
            var existingFields = ReadAbbyyFields(doc);
            Log("Vorhandene ABBYY-Felder: " + existingFields.Count + " Felder");

            // 3. An KI-Backend senden
            var response = CallBotApi(ocrText, docName, existingFields);
            if (response == null)
            {
                Log("FEHLER: Keine Antwort vom KI-Backend. Manuelle Überprüfung erforderlich.");
                ShowMessage(host, "KI-Bot: Backend nicht erreichbar. Bitte manuell prüfen.", false);
                return;
            }

            Log("KI-Ergebnis: " + response["doc_type"] + " | Konfidenz: " + response["confidence"] + "% | Ampel: " + response["ampel"]);

            // 4. Felder in ABBYY eintragen
            var fields = response["fields"] as System.Collections.Generic.Dictionary<string, object>;
            if (fields != null && fields.Count > 0)
            {
                int filled = FillAbbyyFields(doc, fields);
                Log("Felder ausgefüllt: " + filled + " von " + fields.Count);
            }

            // 5. Entscheidung: Auto-Abschluss oder manuelle Prüfung
            string decision  = response["decision"] as string ?? "manual_review";
            string reason     = response["reason"]   as string ?? "";
            string ampel      = response["ampel"]    as string ?? "rot";
            int    confidence = Convert.ToInt32(response["confidence"] ?? 0);

            if (decision == "auto_complete")
            {
                Log("AUTO-ABSCHLUSS: " + reason);
                ShowMessage(host,
                    "KI-Bot: Alle Felder ausgefüllt ✓\n" +
                    "Konfidenz: " + confidence + "%\n" +
                    "Lieferant: " + (response["supplier_name"] ?? "erkannt") + "\n\n" +
                    "Task wird automatisch abgeschlossen...",
                    true);

                // Kurz warten damit der Nutzer die Meldung lesen kann, dann abschließen
                System.Threading.Thread.Sleep(2000);
                doc.SendToNextStage(); // Task abschließen
            }
            else
            {
                string ampelSymbol = ampel == "gruen" ? "🟢" : (ampel == "gelb" ? "🟡" : "🔴");
                Log("MANUELLE PRÜFUNG: " + reason);
                ShowMessage(host,
                    "KI-Bot: Felder wurden ausgefüllt " + ampelSymbol + "\n" +
                    "Dokumenttyp: " + response["doc_type"] + "\n" +
                    "Konfidenz: " + confidence + "%\n\n" +
                    "Bitte prüfen: " + reason,
                    false);
            }

            // 6. Aktion an Backend loggen
            LogToBackend(docName, "document_processed",
                decision + " | " + response["doc_type"] + " | " + confidence + "% | " + reason);
        }
        catch (Exception ex)
        {
            Log("KRITISCHER FEHLER: " + ex.Message);
            ShowMessage(host, "KI-Bot Fehler: " + ex.Message + "\n\nBitte manuell ausfüllen.", false);
        }
    }

    // =========================================================================
    // Hilfsmethoden
    // =========================================================================

    /// <summary>Liest den gesamten OCR-Text des Dokuments aus ABBYY.</summary>
    private static string ExtractOcrText(IDocument doc)
    {
        var sb = new StringBuilder();
        try
        {
            // Volltext über alle Seiten
            for (int p = 0; p < doc.Pages.Count; p++)
            {
                IPage page = doc.Pages[p];
                sb.AppendLine(page.Text);
            }
        }
        catch
        {
            // Fallback: Feldwerte sammeln
            foreach (IField field in doc.Fields)
            {
                if (!string.IsNullOrEmpty(field.Text))
                    sb.AppendLine(field.Name + ": " + field.Text);
            }
        }
        return sb.ToString().Trim();
    }

    /// <summary>Liest alle bereits von ABBYY erkannten Felder aus.</summary>
    private static System.Collections.Generic.Dictionary<string, string> ReadAbbyyFields(IDocument doc)
    {
        var result = new System.Collections.Generic.Dictionary<string, string>();
        foreach (IField field in doc.Fields)
        {
            if (!string.IsNullOrWhiteSpace(field.Text))
                result[field.Name.ToLower()] = field.Text;
        }
        return result;
    }

    /// <summary>Schreibt die vom KI-Backend zurückgegebenen Felder in das ABBYY-Dokument.</summary>
    private static int FillAbbyyFields(IDocument doc, System.Collections.Generic.Dictionary<string, object> fields)
    {
        int count = 0;

        // Mapping: unser Feldname → ABBYY FlexiCapture Feldname
        // WICHTIG: Passe diese Namen an dein FlexiCapture-Projekt an!
        var fieldMapping = new System.Collections.Generic.Dictionary<string, string[]>
        {
            { "absender",         new[] { "Supplier", "Lieferant", "Absender", "VendorName" } },
            { "absender_strasse", new[] { "SupplierStreet", "Strasse", "VendorStreet" } },
            { "absender_plz",     new[] { "SupplierZip", "PLZ", "VendorZip" } },
            { "absender_ort",     new[] { "SupplierCity", "Ort", "VendorCity" } },
            { "rechnungsnummer",  new[] { "InvoiceNumber", "Rechnungsnummer", "InvNumber" } },
            { "rechnungsdatum",   new[] { "InvoiceDate", "Rechnungsdatum", "InvDate" } },
            { "faelligkeitsdatum",new[] { "DueDate", "Faelligkeitsdatum", "PaymentDueDate" } },
            { "betrag_brutto",    new[] { "TotalAmount", "Brutto", "GrossAmount", "InvoiceTotal" } },
            { "betrag_netto",     new[] { "NetAmount", "Netto", "NetTotal" } },
            { "steuerbetrag",     new[] { "TaxAmount", "Steuer", "VATAmount" } },
            { "steuersatz",       new[] { "TaxRate", "Steuersatz", "VATRate" } },
            { "waehrung",         new[] { "Currency", "Waehrung" } },
            { "iban",             new[] { "IBAN", "BankIBAN" } },
            { "bic",              new[] { "BIC", "SWIFT", "BankBIC" } },
        };

        foreach (var kvp in fields)
        {
            if (kvp.Value == null) continue;
            string value = kvp.Value.ToString().Trim();
            if (string.IsNullOrEmpty(value)) continue;

            string[] abbyyNames;
            if (!fieldMapping.TryGetValue(kvp.Key, out abbyyNames)) continue;

            // Versuche jeden möglichen ABBYY-Feldnamen
            foreach (string abbyyName in abbyyNames)
            {
                try
                {
                    IField field = doc.Fields[abbyyName];
                    if (field != null)
                    {
                        // Nur überschreiben wenn leer oder offensichtlich falsch
                        if (string.IsNullOrWhiteSpace(field.Text) || ShouldOverwrite(field.Text, value, kvp.Key))
                        {
                            field.Text = value;
                            count++;
                            Log("  Feld gesetzt: " + abbyyName + " = " + value);
                        }
                        else
                        {
                            Log("  Feld behalten: " + abbyyName + " = " + field.Text + " (KI: " + value + ")");
                        }
                        break;
                    }
                }
                catch { /* Feld existiert nicht → weiter */ }
            }
        }

        return count;
    }

    /// <summary>Entscheidet ob ein bestehendes ABBYY-Feld mit dem KI-Wert überschrieben werden soll.</summary>
    private static bool ShouldOverwrite(string existingValue, string newValue, string fieldName)
    {
        // Absender: überschreiben wenn bestehender Wert wie eine Nummer aussieht
        if (fieldName == "absender")
        {
            int digits = 0, letters = 0;
            foreach (char c in existingValue) {
                if (char.IsDigit(c)) digits++;
                else if (char.IsLetter(c)) letters++;
            }
            if (letters == 0) return true; // reine Zahl → KI-Wert ist besser
            if (digits > 0 && digits >= letters) return true; // überwiegend Ziffern
        }
        return false;
    }

    /// <summary>Ruft das KI-Backend auf und gibt die geparste Antwort zurück.</summary>
    private static System.Collections.Generic.Dictionary<string, object> CallBotApi(
        string ocrText, string documentName,
        System.Collections.Generic.Dictionary<string, string> existingFields)
    {
        try
        {
            var serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = 5000000;

            var payload = new System.Collections.Generic.Dictionary<string, object>
            {
                { "ocr_text",       ocrText },
                { "document_name",  documentName },
                { "existing_fields", existingFields },
            };

            string json = serializer.Serialize(payload);
            byte[] data = Encoding.UTF8.GetBytes(json);

            var request = (HttpWebRequest)WebRequest.Create(BotConfig.API_BASE + "/analyze");
            request.Method      = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.ContentLength = data.Length;
            request.Timeout     = BotConfig.TIMEOUT_MS;

            using (var stream = request.GetRequestStream())
                stream.Write(data, 0, data.Length);

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string responseText = reader.ReadToEnd();
                var result = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(responseText);
                return result;
            }
        }
        catch (Exception ex)
        {
            Log("API-Aufruf fehlgeschlagen: " + ex.Message);
            return null;
        }
    }

    /// <summary>Sendet einen Log-Eintrag ans Backend (für Audit-Trail in der Datenbank).</summary>
    private static void LogToBackend(string documentName, string action, string details)
    {
        try
        {
            var serializer = new JavaScriptSerializer();
            var payload = new System.Collections.Generic.Dictionary<string, string>
            {
                { "document_name", documentName },
                { "action",        action },
                { "details",       details },
            };
            string json = serializer.Serialize(payload);
            byte[] data = Encoding.UTF8.GetBytes(json);

            var request = (HttpWebRequest)WebRequest.Create(BotConfig.API_BASE + "/log");
            request.Method        = "POST";
            request.ContentType   = "application/json; charset=utf-8";
            request.ContentLength = data.Length;
            request.Timeout       = 5000;

            using (var stream = request.GetRequestStream())
                stream.Write(data, 0, data.Length);

            request.GetResponse();
        }
        catch { /* Log-Fehler dürfen den Bot nicht stoppen */ }
    }

    private static string GetDocumentName(IDocument doc)
    {
        try { return doc.Name ?? "Unbekannt"; }
        catch { return "Unbekannt"; }
    }

    private static void Log(string msg)
    {
        if (BotConfig.LOG_TO_CONSOLE)
            Console.WriteLine("[KI-Bot] " + DateTime.Now.ToString("HH:mm:ss") + " " + msg);
    }

    private static void ShowMessage(IScriptingHost host, string message, bool isSuccess)
    {
        try
        {
            // Im Script-Kontext: zeigt eine Meldung in der ABBYY Status-Leiste
            host.MessageWindow.WriteLine(message);
        }
        catch { /* Falls MessageWindow nicht verfügbar */ }
    }
}
