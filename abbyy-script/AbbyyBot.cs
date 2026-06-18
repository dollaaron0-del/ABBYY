// =============================================================================
// ABBYY FlexiCapture – KI-Bot Skript v2
// Datei: AbbyyBot.cs
// Einzufügen in: ABBYY FlexiCapture → Projekt → Skript-Editor
//
// Events die gebunden werden müssen:
//   Document_OnOpen        → AbbyyBotScript.OnDocumentOpened
//   Document_OnClose       → AbbyyBotScript.OnDocumentClosed  (für Korrektur-Tracking)
//
// Vollständige Installationsanleitung: README_INSTALLATION.txt
// =============================================================================

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Threading;

// ---- KONFIGURATION ----------------------------------------------------------
public static class BotConfig
{
    public const string API_BASE    = "http://127.0.0.1:3001/api/abbyy/bot";
    public const int    TIMEOUT_MS  = 300000; // 5 Minuten max. für KI-Analyse
    public const bool   SHOW_STATUS = true;   // Status-Meldungen anzeigen
}
// -----------------------------------------------------------------------------

public class AbbyyBotScript
{
    // Speichert die Bot-Felder pro Dokument um später Korrekturen zu erkennen
    private static readonly Dictionary<string, Dictionary<string, string>> _botFields
        = new Dictionary<string, Dictionary<string, string>>();

    // =========================================================================
    // EVENT: Dokument wird zur Verifikation geöffnet
    //        Binde an: Document → OnOpen
    // =========================================================================
    public static void OnDocumentOpened(IScriptingHost host)
    {
        IDocument doc = host.Document;
        string docName = GetDocumentName(doc);

        Log("=== ABBYY KI-Bot gestartet für: " + docName);
        ShowStatus(host, "🤖 KI-Bot analysiert... bitte warten", false);

        try
        {
            // Schritt 1: OCR-Text und vorhandene Felder auslesen
            string ocrText = ExtractOcrText(doc);
            var existingFields = ReadAbbyyFields(doc);

            Log("OCR: " + ocrText.Length + " Zeichen | ABBYY-Felder: " + existingFields.Count);

            // Schritt 2: KI-Backend aufrufen
            var response = CallBotApi(ocrText, docName, existingFields);
            if (response == null)
            {
                ShowStatus(host, "⚠️ KI-Bot: Backend nicht erreichbar. Bitte manuell ausfüllen.", false);
                Log("FEHLER: Backend nicht erreichbar");
                return;
            }

            // Schritt 3: Felder eintragen
            var fields = response["fields"] as Dictionary<string, object>;
            var botFilledFields = new Dictionary<string, string>();

            if (fields != null && fields.Count > 0)
            {
                int filled = FillAbbyyFields(doc, fields, botFilledFields);
                Log("Felder ausgefüllt: " + filled);

                // Bot-Felder merken (für späteres Korrektur-Tracking)
                lock (_botFields) { _botFields[docName] = botFilledFields; }
            }

            // Schritt 4: Entscheidung
            string decision  = (response["decision"] as string) ?? "manual_review";
            string reason    = (response["reason"]   as string) ?? "";
            string ampel     = (response["ampel"]    as string) ?? "rot";
            string docType   = (response["doc_type"] as string) ?? "Unbekannt";
            int    confidence = Convert.ToInt32(response["confidence"] ?? 0);
            string supplier  = (response["supplier_name"] as string) ?? "";
            string ampelIcon = ampel == "gruen" ? "🟢" : (ampel == "gelb" ? "🟡" : "🔴");

            Log("Entscheidung: " + decision + " | " + reason);

            if (decision == "auto_complete")
            {
                ShowStatus(host,
                    "✅ KI-Bot: Alle Felder ausgefüllt\n" +
                    docType + " | " + confidence + "% | " + supplier + "\n" +
                    "Task wird in 3 Sekunden automatisch abgeschlossen...",
                    true);

                Thread.Sleep(3000);
                doc.SendToNextStage();

                LogToBackend(docName, "auto_complete",
                    docType + " | " + confidence + "% | " + supplier);
            }
            else
            {
                ShowStatus(host,
                    ampelIcon + " KI-Bot: Felder ausgefüllt – bitte prüfen\n" +
                    docType + " | " + confidence + "%\n" +
                    reason,
                    false);

                LogToBackend(docName, "manual_review",
                    docType + " | " + confidence + "% | " + reason);
            }
        }
        catch (Exception ex)
        {
            Log("KRITISCHER FEHLER: " + ex.Message);
            ShowStatus(host, "❌ KI-Bot Fehler: " + ex.Message + "\nBitte manuell ausfüllen.", false);
        }
    }

    // =========================================================================
    // EVENT: Dokument wird abgeschlossen / zur nächsten Station geschickt
    //        Binde an: Document → OnClose  ODER  AfterVerification
    //        Zweck: Erkennen was der Mensch geändert hat (für Lernfunktion)
    // =========================================================================
    public static void OnDocumentClosed(IScriptingHost host)
    {
        IDocument doc = host.Document;
        string docName = GetDocumentName(doc);

        Dictionary<string, string> botFieldsCopy;
        lock (_botFields)
        {
            if (!_botFields.TryGetValue(docName, out botFieldsCopy))
                return; // Bot hatte dieses Dokument nicht bearbeitet
            _botFields.Remove(docName);
        }

        // Finale ABBYY-Feldwerte lesen
        var finalFields = ReadAbbyyFields(doc);

        // Unterschiede an Backend melden
        try
        {
            var serializer = new JavaScriptSerializer();
            var payload = new Dictionary<string, object>
            {
                { "document_name",  docName },
                { "bot_fields",    botFieldsCopy },
                { "human_fields",  finalFields },
            };
            string json = serializer.Serialize(payload);
            byte[] data = Encoding.UTF8.GetBytes(json);

            var request = (HttpWebRequest)WebRequest.Create(BotConfig.API_BASE + "/correction");
            request.Method        = "POST";
            request.ContentType   = "application/json; charset=utf-8";
            request.ContentLength = data.Length;
            request.Timeout       = 5000;

            using (var stream = request.GetRequestStream())
                stream.Write(data, 0, data.Length);
            request.GetResponse();
        }
        catch { /* Korrektur-Log darf den Ablauf nie blockieren */ }
    }

    // =========================================================================
    // Hilfsmethoden
    // =========================================================================

    private static string ExtractOcrText(IDocument doc)
    {
        var sb = new StringBuilder();
        try
        {
            for (int p = 0; p < doc.Pages.Count; p++)
                sb.AppendLine(doc.Pages[p].Text);
        }
        catch
        {
            foreach (IField field in doc.Fields)
                if (!string.IsNullOrEmpty(field.Text))
                    sb.AppendLine(field.Name + ": " + field.Text);
        }
        return sb.ToString().Trim();
    }

    private static Dictionary<string, string> ReadAbbyyFields(IDocument doc)
    {
        var result = new Dictionary<string, string>();
        foreach (IField field in doc.Fields)
            if (!string.IsNullOrWhiteSpace(field.Text))
                result[field.Name.ToLower()] = field.Text;
        return result;
    }

    private static int FillAbbyyFields(IDocument doc,
        Dictionary<string, object> fields,
        Dictionary<string, string> filledOut)
    {
        int count = 0;

        // Mapping: unser Feldname → mögliche ABBYY-Feldnamen
        // WICHTIG: Rechte Spalte an eure FlexiCapture-Feldnamen anpassen!
        var fieldMapping = new Dictionary<string, string[]>
        {
            { "absender",          new[] { "Supplier", "Lieferant", "Absender", "VendorName" } },
            { "absender_strasse",  new[] { "SupplierStreet", "Strasse", "VendorStreet" } },
            { "absender_plz",      new[] { "SupplierZip", "PLZ", "VendorZip" } },
            { "absender_ort",      new[] { "SupplierCity", "Ort", "VendorCity" } },
            { "rechnungsnummer",   new[] { "InvoiceNumber", "Rechnungsnummer", "InvNumber" } },
            { "rechnungsdatum",    new[] { "InvoiceDate", "Rechnungsdatum", "InvDate" } },
            { "faelligkeitsdatum", new[] { "DueDate", "Faelligkeitsdatum", "PaymentDueDate" } },
            { "betrag_brutto",     new[] { "TotalAmount", "Brutto", "GrossAmount", "InvoiceTotal" } },
            { "betrag_netto",      new[] { "NetAmount", "Netto", "NetTotal" } },
            { "steuerbetrag",      new[] { "TaxAmount", "Steuer", "VATAmount" } },
            { "steuersatz",        new[] { "TaxRate", "Steuersatz", "VATRate" } },
            { "waehrung",          new[] { "Currency", "Waehrung" } },
            { "iban",              new[] { "IBAN", "BankIBAN" } },
            { "bic",               new[] { "BIC", "SWIFT", "BankBIC" } },
        };

        foreach (var kvp in fields)
        {
            if (kvp.Value == null) continue;
            string value = kvp.Value.ToString().Trim();
            if (string.IsNullOrEmpty(value)) continue;

            string[] abbyyNames;
            if (!fieldMapping.TryGetValue(kvp.Key, out abbyyNames)) continue;

            foreach (string abbyyName in abbyyNames)
            {
                try
                {
                    IField field = doc.Fields[abbyyName];
                    if (field == null) continue;

                    if (string.IsNullOrWhiteSpace(field.Text) || ShouldOverwrite(field.Text, kvp.Key))
                    {
                        field.Text = value;
                        filledOut[abbyyName.ToLower()] = value;
                        count++;
                        Log("  → " + abbyyName + " = " + value);
                    }
                    break;
                }
                catch { }
            }
        }
        return count;
    }

    private static bool ShouldOverwrite(string existing, string fieldName)
    {
        if (fieldName != "absender") return false;
        int digits = 0, letters = 0;
        foreach (char c in existing)
        {
            if (char.IsDigit(c)) digits++;
            else if (char.IsLetter(c)) letters++;
        }
        return letters == 0 || (digits > 0 && digits >= letters);
    }

    private static Dictionary<string, object> CallBotApi(
        string ocrText, string documentName,
        Dictionary<string, string> existingFields)
    {
        try
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 5000000 };
            var payload = new Dictionary<string, object>
            {
                { "ocr_text",       ocrText },
                { "document_name",  documentName },
                { "existing_fields", existingFields },
            };

            byte[] data = Encoding.UTF8.GetBytes(serializer.Serialize(payload));
            var request = (HttpWebRequest)WebRequest.Create(BotConfig.API_BASE + "/analyze");
            request.Method        = "POST";
            request.ContentType   = "application/json; charset=utf-8";
            request.ContentLength = data.Length;
            request.Timeout       = BotConfig.TIMEOUT_MS;

            using (var s = request.GetRequestStream()) s.Write(data, 0, data.Length);
            using (var resp = (HttpWebResponse)request.GetResponse())
            using (var rdr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return serializer.Deserialize<Dictionary<string, object>>(rdr.ReadToEnd());
        }
        catch (Exception ex)
        {
            Log("API-Fehler: " + ex.Message);
            return null;
        }
    }

    private static void LogToBackend(string docName, string action, string details)
    {
        try
        {
            var serializer = new JavaScriptSerializer();
            var payload = new Dictionary<string, string>
            { { "document_name", docName }, { "action", action }, { "details", details } };
            byte[] data = Encoding.UTF8.GetBytes(serializer.Serialize(payload));

            var request = (HttpWebRequest)WebRequest.Create(BotConfig.API_BASE + "/log");
            request.Method        = "POST";
            request.ContentType   = "application/json; charset=utf-8";
            request.ContentLength = data.Length;
            request.Timeout       = 5000;

            using (var s = request.GetRequestStream()) s.Write(data, 0, data.Length);
            request.GetResponse();
        }
        catch { }
    }

    private static string GetDocumentName(IDocument doc)
    {
        try { return doc.Name ?? "Unbekannt"; } catch { return "Unbekannt"; }
    }

    private static void Log(string msg)
    {
        Console.WriteLine("[KI-Bot] " + DateTime.Now.ToString("HH:mm:ss") + " " + msg);
    }

    private static void ShowStatus(IScriptingHost host, string message, bool isSuccess)
    {
        try { host.MessageWindow.WriteLine(message); } catch { }
    }
}
