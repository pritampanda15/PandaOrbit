/**
 * PandaOrbit -> Google Docs Bridge (Google Apps Script)
 *
 * 60-second setup (no Google Cloud project or OAuth credentials needed):
 *  1. Open https://script.google.com -> New Project -> paste this file.
 *  2. Click Deploy -> New deployment -> Web app:
 *       - Execute as: Me
 *       - Who has access: Anyone (or Anyone with Google account)
 *  3. Copy the Web App URL (https://script.google.com/macros/s/.../exec)
 *     and paste it into PandaOrbit -> Habits -> Work Summary -> Settings.
 *
 * Behavior:
 *  - If `docId` is provided, appends a dated formatted section to that Google Doc.
 *  - Otherwise creates a new Google Doc titled with the summary heading and returns its URL.
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || "{}");
    var title = payload.title || "PandaOrbit Work Summary";
    var doc = payload.docId
      ? DocumentApp.openById(payload.docId)
      : DocumentApp.create(title);

    var body = doc.getBody();
    if (payload.docId) {
      body.appendHorizontalRule();
    }

    var lines = String(payload.plainText || payload.markdown || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (i === 0 && line.trim()) {
        body.appendParagraph(line).setHeading(DocumentApp.ParagraphHeading.HEADING1);
      } else if (/^[A-Z0-9\s/-]{4,}$/.test(line.trim())) {
        body.appendParagraph(line.trim()).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      } else if (line.trim().indexOf("• ") === 0) {
        body.appendListItem(line.trim().slice(2)).setGlyphType(DocumentApp.GlyphType.BULLET);
      } else if (line.trim()) {
        body.appendParagraph(line);
      }
    }

    doc.saveAndClose();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, docId: doc.getId(), docUrl: doc.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
