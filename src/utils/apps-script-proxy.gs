/**
 * TomFarmerFitness — Apps Script Proxy
 * =====================================
 * Deploy this as a Web App in your TFF-Database Google Spreadsheet.
 *
 * Steps:
 *  1. Open TFF-Database → Extensions → Apps Script
 *  2. Paste this entire file, replacing any existing code
 *  3. Click Deploy → New Deployment
 *     - Type: Web App
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  4. Authorise when prompted (Sheets + Drive scopes required)
 *  5. Copy the Web App URL into your .env file as VITE_APPS_SCRIPT_URL
 *
 * Script Properties required (Project Settings → Script Properties):
 *   CLAUDE_API_KEY  — your Anthropic API key
 *                     Used for: food lookup (Nutrition tab) + AI chat (Ask tab)
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss   = SpreadsheetApp.getActiveSpreadsheet();

    // ── Append a row to a named sheet tab ────────────────────────────────────
    if (data.action === 'append') {
      var sheet = ss.getSheetByName(data.tab);
      if (!sheet) throw new Error("Tab '" + data.tab + "' not found");

      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var row     = headers.map(function(h) {
        return data.row[h] !== undefined ? data.row[h] : '';
      });
      sheet.appendRow(row);
      return ok({ appended: true });
    }

    // ── Delete a row by matching ID in a named column ─────────────────────────
    if (data.action === 'deleteRow') {
      var sheet   = ss.getSheetByName(data.tab);
      if (!sheet) throw new Error("Tab '" + data.tab + "' not found");

      var lastCol  = sheet.getLastColumn();
      var lastRow  = sheet.getLastRow();
      if (lastRow < 2) return ok({ deleted: false, reason: 'no data rows' });

      var headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var colIndex = headers.indexOf(data.idColumn);
      if (colIndex < 0) throw new Error("Column '" + data.idColumn + "' not found");

      var values   = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
      var deleted  = false;
      for (var i = values.length - 1; i >= 0; i--) {
        if (String(values[i][0]) === String(data.id)) {
          sheet.deleteRow(i + 2);
          deleted = true;
          break;
        }
      }
      return ok({ deleted: deleted });
    }

    // ── AI Chat: answer a client question using Claude ────────────────────────
    if (data.action === 'askClaude') {
      if (!data.question) throw new Error('question is required');
      var result = askClaude(
        data.question,
        data.clientProfile || 'Profile not available',
        data.history       || []
      );
      return ok(result);
    }

    // ── Food lookup: nutritional data via Claude ──────────────────────────────
    if (data.action === 'lookupFood') {
      if (!data.query) throw new Error('query is required');
      var results = lookupFood(data.query);
      return ok({ results: results });
    }

    // ── Photo upload to Google Drive ──────────────────────────────────────────
    if (data.action === 'uploadPhoto') {
      if (!data.base64)   throw new Error('base64 is required');
      if (!data.clientId) throw new Error('clientId is required');
      if (!data.fileName) throw new Error('fileName is required');

      var photoResult = uploadPhotoToDrive(
        data.clientId,
        data.clientName || data.clientId,
        data.base64,
        data.mimeType   || 'image/jpeg',
        data.fileName,
        data.photoType  || 'Front',
        data.date       || '',
        data.note       || ''
      );
      return ok(photoResult);
    }


    // ── Upsert a row (insert or update) by ID column ─────────────────────────
    if (data.action === 'upsertRow') {
      var sheet = ss.getSheetByName(data.tab);
      if (!sheet) throw new Error("Tab '" + data.tab + "' not found");

      var lastCol  = sheet.getLastColumn();
      var lastRow  = sheet.getLastRow();
      var headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var colIndex = headers.indexOf(data.idColumn);
      if (colIndex < 0) throw new Error("Column '" + data.idColumn + "' not found");

      var rowValues = headers.map(function(h) {
        return data.row[h] !== undefined ? data.row[h] : '';
      });

      var found = false;
      if (lastRow >= 2) {
        var ids = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(data.id)) {
            sheet.getRange(i + 2, 1, 1, lastCol).setValues([rowValues]);
            found = true;
            break;
          }
        }
      }
      if (!found) { sheet.appendRow(rowValues); }
      return ok({ upserted: true, updated: found });
    }

    // ── Delete all rows where column === value ────────────────────────────────
    if (data.action === 'deleteRowsWhere') {
      var sheet = ss.getSheetByName(data.tab);
      if (!sheet) throw new Error("Tab '" + data.tab + "' not found");

      var lastCol  = sheet.getLastColumn();
      var lastRow  = sheet.getLastRow();
      if (lastRow < 2) return ok({ deleted: 0 });

      var headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var colIndex = headers.indexOf(data.column);
      if (colIndex < 0) throw new Error("Column '" + data.column + "' not found");

      var values  = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
      var deleted = 0;
      for (var i = values.length - 1; i >= 0; i--) {
        if (String(values[i][0]) === String(data.value)) {
          sheet.deleteRow(i + 2);
          deleted++;
        }
      }
      return ok({ deleted: deleted });
    }

    // ── AI Program Generation via Claude ──────────────────────────────────────
    if (data.action === 'generateProgram') {
      var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
      if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

      var goal        = data.goal        || 'General Fitness';
      var daysPerWeek = data.daysPerWeek || 3;
      var duration    = data.durationWeeks || 8;
      var level       = data.level       || 'Intermediate';
      var equipment   = (data.equipment  || []).join(', ') || 'Any';
      var focus       = (data.focusAreas || []).join(', ') || 'Full body';
      var notes       = data.notes       || '';

      var prompt = 'You are an expert personal trainer. Generate a complete training program.\n' +
        'Goal: ' + goal + '\n' +
        'Days per week: ' + daysPerWeek + '\n' +
        'Duration: ' + duration + ' weeks\n' +
        'Level: ' + level + '\n' +
        'Equipment: ' + equipment + '\n' +
        'Focus: ' + focus + '\n' +
        (notes ? 'Notes: ' + notes + '\n' : '') +
        '\nReturn ONLY valid JSON, no markdown:\n' +
        '{"name":"...","description":"...","goal":"' + goal + '","daysPerWeek":' + daysPerWeek + ',' +
        '"durationWeeks":' + duration + ',"level":"' + level + '","equipment":[],"focusAreas":[],' +
        '"days":[{"dayOrder":1,"dayName":"Push","focusArea":"Chest","exercises":[' +
        '{"name":"Bench Press","muscleGroup":"Chest","sets":4,"reps":"8-10","rest":"90s","notes":""}]}]}';

      var payload = {
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      };

      var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      var result = JSON.parse(resp.getContentText());
      if (result.error) throw new Error(result.error.message);
      var text = result.content[0].text.trim();
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      var program = JSON.parse(text);

      // Stamp IDs onto days and exercises
      (program.days || []).forEach(function(day, di) {
        day.id = 'day-ai-' + (di + 1);
        day.dayOrder = di + 1;
        (day.exercises || []).forEach(function(ex, ei) {
          ex.id = 'exrow-ai-' + (di + 1) + '-' + (ei + 1);
          if (!ex.exerciseId) ex.exerciseId = '';
        });
      });
      return ok({ program: program });
    }


        throw new Error("Unknown action: " + data.action);

  } catch (err) {
    return error(err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  askClaude — answer a client fitness/nutrition question
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Calls claude-sonnet-4-20250514 with the TFF fitness assistant system prompt.
 * @param {string}   question       - The client's question
 * @param {string}   clientProfile  - Comma-separated profile string e.g. "Name: Jane, Goal: lose 5kg"
 * @param {Array}    history        - Previous messages [{role:'user'|'assistant', content:'...'}]
 * @returns {{ response: string, escalated: boolean }}
 */
function askClaude(question, clientProfile, history) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

  var ESCALATION_MARKER = 'flagged it for him';

  var systemPrompt =
    'You are a knowledgeable fitness and nutrition assistant for Tom Farmer Fitness. ' +
    'You can answer questions about exercise technique, how to perform specific movements, ' +
    'nutrition information, macros, meal ideas, and general health and fitness topics. ' +
    'You have access to this client\'s profile: ' + clientProfile + '. ' +
    'Always be encouraging and professional. Keep responses focused and practical — ' +
    'aim for 2-4 concise paragraphs unless the question genuinely requires more detail. ' +
    'If a question is about a specific medical condition, injury treatment, or anything requiring ' +
    'professional medical advice, do not answer it directly — instead say exactly: ' +
    '"That is a great question for your coach Tom. ' +
    'I have flagged it for him and he will get back to you." ' +
    'If you are not confident in your answer for any reason, use the same escalation response.';

  // Build messages array: history + new question
  var messages = [];
  for (var i = 0; i < history.length; i++) {
    var h = history[i];
    if (h.role && h.content) {
      messages.push({ role: h.role, content: String(h.content) });
    }
  }
  messages.push({ role: 'user', content: question });

  var payload = {
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   messages,
  };

  var options = {
    method:          'post',
    contentType:     'application/json',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload:          JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var code     = response.getResponseCode();
  var body     = JSON.parse(response.getContentText());

  if (code !== 200) {
    throw new Error(
      'Claude API error ' + code + ': ' +
      (body.error && body.error.message ? body.error.message : 'unknown error')
    );
  }

  var text = body.content && body.content[0] && body.content[0].text;
  if (!text) throw new Error('Empty response from Claude');

  var escalated = text.toLowerCase().indexOf(ESCALATION_MARKER) >= 0;

  return {
    response:  text,
    escalated: escalated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  lookupFood — nutritional data for a food query
// ─────────────────────────────────────────────────────────────────────────────
function lookupFood(query) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

  var prompt =
    'You are a nutrition database. The user is looking up: "' + query + '".\n\n' +
    'Return ONLY a JSON array (no markdown, no explanation) of 1-4 matching foods.\n' +
    'Each object must have exactly these fields:\n' +
    '  foodName    (string)  - specific name e.g. "Chicken Breast, grilled"\n' +
    '  servingSize (number)  - typical serving in grams\n' +
    '  calories    (number)  - kcal per servingSize\n' +
    '  protein     (number)  - grams per servingSize\n' +
    '  carbs       (number)  - grams per servingSize\n' +
    '  fats        (number)  - grams per servingSize\n' +
    '  fibre       (number)  - grams per servingSize\n\n' +
    'Use accurate Australian/international food values.\n' +
    'Example: [{"foodName":"Oats, raw","servingSize":80,"calories":306,"protein":11,"carbs":52,"fats":5,"fibre":7}]';

  var payload = {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages:   [{ role: 'user', content: prompt }],
  };

  var options = {
    method:          'post',
    contentType:     'application/json',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload:          JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var code     = response.getResponseCode();
  var body     = JSON.parse(response.getContentText());

  if (code !== 200) {
    throw new Error('Claude API error ' + code + ': ' + (body.error && body.error.message || 'unknown'));
  }

  var text = body.content && body.content[0] && body.content[0].text;
  if (!text) throw new Error('Empty response from Claude');

  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  var results = JSON.parse(text);
  if (!Array.isArray(results)) throw new Error('Claude did not return an array');

  return results.map(function(r) {
    return {
      foodName:    String(r.foodName    || 'Unknown food'),
      servingSize: Number(r.servingSize || 100),
      calories:    Number(r.calories    || 0),
      protein:     Number(r.protein     || 0),
      carbs:       Number(r.carbs       || 0),
      fats:        Number(r.fats        || 0),
      fibre:       Number(r.fibre       || 0),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  uploadPhotoToDrive — store progress photo in Google Drive
// ─────────────────────────────────────────────────────────────────────────────
function uploadPhotoToDrive(clientId, clientName, base64Data, mimeType, fileName,
                             photoType, date, note) {
  var ROOT_FOLDER_NAME = 'TomFarmerFitness-ProgressPhotos';

  var rootFolder;
  var rootIter = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  rootFolder   = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);

  var clientFolder;
  var clientIter = rootFolder.getFoldersByName(clientId);
  if (clientIter.hasNext()) {
    clientFolder = clientIter.next();
  } else {
    clientFolder = rootFolder.createFolder(clientId);
    clientFolder.setDescription('Progress photos for ' + (clientName || clientId));
  }

  var blob   = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  var file   = clientFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var fileId       = file.getId();
  var viewUrl      = 'https://drive.google.com/uc?id=' + fileId + '&export=view';
  var thumbnailUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';

  return { fileId: fileId, viewUrl: viewUrl, thumbnailUrl: thumbnailUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────────────────────

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'TFF Proxy running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ success: true }, payload)))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
