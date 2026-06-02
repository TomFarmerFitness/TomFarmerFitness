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
      // Auto-create any missing column headers
      if (lastCol === 0) {
        // Empty sheet — write all keys as headers in row 1
        var allKeys = Object.keys(data.row);
        allKeys.forEach(function(k, i) { sheet.getRange(1, i + 1).setValue(k); });
        lastCol = allKeys.length;
      } else {
        var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        var newKeys = Object.keys(data.row).filter(function(k) { return existingHeaders.indexOf(k) < 0; });
        newKeys.forEach(function(k) {
          lastCol++;
          sheet.getRange(1, lastCol).setValue(k);
        });
      }
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

      // Ensure any columns in data.row that don't exist yet are added as new headers
      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var newKeys = Object.keys(data.row).filter(function(k) { return headers.indexOf(k) < 0; });
      if (newKeys.length > 0) {
        newKeys.forEach(function(k) {
          sheet.getRange(1, lastCol + 1).setValue(k);
          headers.push(k);
          lastCol++;
        });
      }

      var lastRow  = sheet.getLastRow();
      var colIndex = headers.indexOf(data.idColumn);
      if (colIndex < 0) throw new Error("Column '" + data.idColumn + "' not found");

      var found = false;
      if (lastRow >= 2) {
        var ids = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(data.id)) {
            // Merge: read existing row, overwrite only fields present in data.row
            var existing = sheet.getRange(i + 2, 1, 1, lastCol).getValues()[0];
            var rowValues = headers.map(function(h, idx) {
              return data.row[h] !== undefined ? data.row[h] : existing[idx];
            });
            sheet.getRange(i + 2, 1, 1, lastCol).setValues([rowValues]);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        // Insert: blank any missing fields
        var rowValues = headers.map(function(h) {
          return data.row[h] !== undefined ? data.row[h] : '';
        });
        sheet.appendRow(rowValues);
      }
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

      var goal            = data.goal            || 'General Fitness';
      var daysPerWeek     = data.daysPerWeek     || 3;
      var duration        = data.durationWeeks   || 8;
      var sessionDuration = data.sessionDuration || 60;
      var trainingType    = data.trainingType    || 'Hypertrophy';
      var level           = data.level           || 'Intermediate';
      var equipment       = (data.equipment      || []).join(', ') || 'Any';
      var notes             = data.notes             || '';
      var clientGoals       = data.clientGoals       || '';
      var clientLimitations = data.clientLimitations || '';
      var clientEmphasis    = data.clientFocusAreas  || '';
      var clientNotes       = data.clientNotes       || '';
      var phase1End         = Math.floor(duration / 2);
      var phase2Start       = phase1End + 1;

      var clientSection = '';
      if (clientGoals || clientLimitations || clientEmphasis || clientNotes) {
        clientSection = '\nCLIENT PROFILE:\n' +
          (clientGoals       ? 'Goals: '             + clientGoals       + '\n' : '') +
          (clientLimitations ? 'Limitations: '       + clientLimitations + '\n' : '') +
          (clientEmphasis    ? 'Emphasis areas: '    + clientEmphasis    + '\n' : '') +
          (clientNotes       ? 'Notes: '             + clientNotes       + '\n' : '');
      }

      var prompt = 'You are an expert personal trainer. Generate a complete training program as compact JSON.\n' +
        'Goal: ' + goal + '\n' +
        'Training Type: ' + trainingType + '\n' +
        'Session Duration: ' + sessionDuration + ' minutes per workout\n' +
        'Days per week: ' + daysPerWeek + '\n' +
        'Duration: ' + duration + ' weeks\n' +
        'Level: ' + level + '\n' +
        'Equipment: ' + equipment + '\n' +
        (notes ? 'Additional Notes: ' + notes + '\n' : '') +
        clientSection +
        '\nCORE PROGRAM PHILOSOPHY (non-negotiable):\n' +
        '- EVERY muscle group must be trained every week: chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes, calves, core\n' +
        '- Each muscle group must accumulate 10-15 working sets per week total\n' +
        '- Each muscle group must appear in AT LEAST 2 separate training days per week (frequency principle)\n' +
        '- If emphasis areas specified, allocate more sets to those muscles (up to 15) while keeping all others at minimum 10 sets\n' +
        '- Distribute muscle groups intelligently to allow 48h recovery between same-muscle sessions\n' +
        '\nPERIODISATION STRUCTURE (MANDATORY):\n' +
        '- Phase 1 (weeks 1-' + phase1End + '): Hypertrophy - 10-15 reps, moderate load, 60-90s rest. Week ' + phase1End + ' = deload (50% volume)\n' +
        '- Phase 2 (weeks ' + phase2Start + '-' + duration + '): Strength - 5-8 reps, heavier load, 2-3min rest. Week ' + duration + ' = deload (50% volume)\n' +
        '- Set exercises/reps/weight for Phase 1 as the starting values in the JSON\n' +
        '- For EACH exercise include a progressionScheme field (under 80 chars) e.g. Ph1:3x12;Ph2(wk' + phase2Start + '+):4x6;+2.5kg when all reps hit\n' +
        '\nPROGRESSIVE OVERLOAD:\n' +
        '- Compound (bench/squat/deadlift/row/press/pull): +2.5kg per session when all sets completed\n' +
        '- Isolation exercises: +1.25kg per session when all sets completed\n' +
        '- Bodyweight: +1 rep per set per session when all sets completed\n' +
        '\nRULES:\n' +
        '- Return ONLY valid JSON, no markdown, no extra text\n' +
        '- Maximum 6 exercises per day\n' +
        '- Design each day to fit within ' + sessionDuration + ' minutes\n' +
        '- Match exercise selection to Phase 1 of ' + trainingType + ' style\n' +
        '- Keep all string values SHORT (name <30, notes <50, progressionScheme <80 chars)\n' +
        '- Use empty string "" for notes fields\n' +
        '\nJSON schema (fill in real values):\n' +
        '{"name":"Program Name","description":"2-phase description","goal":"' + goal + '","daysPerWeek":' + daysPerWeek + ',' +
        '"durationWeeks":' + duration + ',"level":"' + level + '","equipment":[],"focusAreas":[],' +
        '"days":[{"dayOrder":1,"dayName":"Push","focusArea":"Chest & Triceps","exercises":[' +
        '{"name":"Bench Press","muscleGroup":"Chest","sets":3,"reps":"10-12","rest":"90s","notes":"","progressionScheme":"Ph1:3x12;Ph2:4x6;+2.5kg when complete"}]}]}';

      var payload = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
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


    // ── Seed the Exercises sheet with a starter library ───────────────────────
    if (data.action === 'seedExercises') {
      var exSheet = ss.getSheetByName('Exercises');
      if (!exSheet) exSheet = ss.insertSheet('Exercises');

      // Columns: ExerciseID, Name, PrimaryMuscle, SecondaryMuscle, EquipmentNeeded, Category, Description, HowToPerform, VideoURL, Alt1ExerciseID, Alt2ExerciseID
      var exHeaders = ['ExerciseID','Name','PrimaryMuscle','SecondaryMuscle','EquipmentNeeded','Category','Description','HowToPerform','VideoURL','Alt1ExerciseID','Alt2ExerciseID'];
      var existingRows = exSheet.getLastRow();
      if (existingRows === 0) {
        exSheet.getRange(1, 1, 1, exHeaders.length).setValues([exHeaders]);
        existingRows = 1;
      }
      if (existingRows > 5) {
        return ok({ seeded: false, reason: 'Exercises sheet already has data. Clear rows 2 onwards to re-seed.' });
      }

      // Format: [ExerciseID, Name, PrimaryMuscle, SecondaryMuscle, EquipmentNeeded, Category, Description, HowToPerform, VideoURL, Alt1ExerciseID, Alt2ExerciseID]
      var exData = [
        ['EX_001','Barbell Bench Press','Chest','Triceps','Barbell','Strength','Classic horizontal pressing movement for chest mass','Lie flat, grip slightly wider than shoulders, lower bar to mid-chest, press explosively','https://www.youtube.com/results?search_query=barbell+bench+press+proper+form','EX_005','EX_006'],
        ['EX_002','Incline Dumbbell Press','Chest','Shoulders','Dumbbells','Hypertrophy','Upper chest focused pressing movement','Set bench 30-45°, press dumbbells from shoulder to above chest, 3-second descent','https://www.youtube.com/results?search_query=incline+dumbbell+press+form+tutorial','EX_001','EX_006'],
        ['EX_003','Cable Fly','Chest','','Cable','Hypertrophy','Full chest stretch and peak contraction isolation','Cables at shoulder height, sweep arms in hugging arc, squeeze hard at centre','https://www.youtube.com/results?search_query=cable+fly+chest+form+tutorial','EX_007','EX_005'],
        ['EX_004','Push-Up','Chest','Triceps','Bodyweight','Strength','Foundational chest and tricep pressing movement','Hands slightly wider than shoulders, body in plank, chest to floor, drive up fully','https://www.youtube.com/results?search_query=push+up+proper+form+tutorial','EX_005','EX_006'],
        ['EX_005','Dumbbell Bench Press','Chest','Triceps','Dumbbells','Hypertrophy','Greater range of motion than barbell bench press','Lie flat, dumbbells at chest, press to lockout, 2-second controlled descent','https://www.youtube.com/results?search_query=dumbbell+bench+press+form+tutorial','EX_001','EX_006'],
        ['EX_006','Chest Press Machine','Chest','Triceps','Machine','Hypertrophy','Safer pressing alternative with guided path','Adjust seat so handles are at mid-chest, press to full extension, slow return','https://www.youtube.com/results?search_query=chest+press+machine+form+tutorial','EX_005','EX_001'],
        ['EX_007','Pec Dec Machine','Chest','','Machine','Hypertrophy','Fly isolation with constant machine tension','Sit upright, forearms on pads at 90°, sweep together until nearly touching','https://www.youtube.com/results?search_query=pec+dec+machine+form+tutorial','EX_003','EX_005'],
        ['EX_008','Dips','Chest','Triceps','Bodyweight','Strength','Lower chest compound bodyweight movement','Lean forward for chest emphasis, lower until shoulders below elbows, press to lockout','https://www.youtube.com/results?search_query=chest+dips+proper+form+tutorial','EX_001','EX_006'],
        ['EX_009','Smith Machine Bench Press','Chest','Triceps','Machine','Strength','Guided bench press with safety catches','Set safety stops, unrack bar, lower to chest with 2-second pause, press to lockout','https://www.youtube.com/results?search_query=smith+machine+bench+press+form+tutorial','EX_001','EX_005'],
        ['EX_010','Incline Barbell Press','Chest','Shoulders','Barbell','Strength','Upper chest barbell press for mass','Set bench 30-45°, unrack bar, lower to upper chest, press to lockout','https://www.youtube.com/results?search_query=incline+barbell+press+form+tutorial','EX_002','EX_006'],
        ['EX_011','Pull-Up','Back','Biceps','Bodyweight','Strength','Foundational vertical pull for back width','Grip wider than shoulders, pull chest to bar, control the descent, full hang at bottom','https://www.youtube.com/results?search_query=pull+up+proper+form+tutorial','EX_013','EX_020'],
        ['EX_012','Barbell Row','Back','Biceps','Barbell','Strength','Horizontal rowing for back thickness','Hinge 45°, pull bar to lower sternum, drive elbows back, controlled descent','https://www.youtube.com/results?search_query=barbell+row+proper+form+tutorial','EX_015','EX_018'],
        ['EX_013','Lat Pulldown','Back','Biceps','Cable','Hypertrophy','Machine vertical pull for lat development','Wide grip, slight lean back, pull bar to upper chest, squeeze lats, control return','https://www.youtube.com/results?search_query=lat+pulldown+proper+form+tutorial','EX_011','EX_020'],
        ['EX_014','Seated Cable Row','Back','Biceps','Cable','Hypertrophy','Mid-back horizontal rowing movement','Sit tall, pull handle to lower abdomen, squeeze shoulder blades, return with control','https://www.youtube.com/results?search_query=seated+cable+row+form+tutorial','EX_012','EX_018'],
        ['EX_015','Single-Arm Dumbbell Row','Back','Biceps','Dumbbells','Strength','Unilateral rowing for balanced back development','Brace on bench, row dumbbell to hip, elbow past body, lower under control','https://www.youtube.com/results?search_query=single+arm+dumbbell+row+form+tutorial','EX_012','EX_018'],
        ['EX_016','Deadlift','Back','Glutes','Barbell','Strength','Full body posterior chain compound movement','Bar over mid-foot, neutral spine, drive through floor, lock hips and knees together','https://www.youtube.com/results?search_query=deadlift+proper+form+tutorial','EX_052','EX_012'],
        ['EX_017','Face Pull','Back','Shoulders','Cable','Hypertrophy','Rear delt and upper back for shoulder health','Cable at head height, pull to face with elbows high and wide, external rotate at end','https://www.youtube.com/results?search_query=face+pull+proper+form+tutorial','EX_028','EX_014'],
        ['EX_018','Machine Row','Back','Biceps','Machine','Hypertrophy','Supported back rowing without lower back load','Chest against pad, pull handles to sides of torso, squeeze shoulder blades','https://www.youtube.com/results?search_query=machine+row+form+tutorial','EX_014','EX_015'],
        ['EX_019','Straight-Arm Pulldown','Back','','Cable','Hypertrophy','Lat isolation emphasising the stretch position','Arms extended, push bar down in arc to thighs keeping arms straight, squeeze lats','https://www.youtube.com/results?search_query=straight+arm+pulldown+form+tutorial','EX_013','EX_011'],
        ['EX_020','Chin-Up','Back','Biceps','Bodyweight','Strength','Underhand pull-up for lats and bicep involvement','Supinated grip, pull chin over bar, full extension at bottom','https://www.youtube.com/results?search_query=chin+up+proper+form+tutorial','EX_011','EX_013'],
        ['EX_021','T-Bar Row','Back','Biceps','Barbell','Strength','Close-grip rowing for mid-back thickness','Straddle bar, neutral grip, drive elbows back, squeeze shoulder blades at top','https://www.youtube.com/results?search_query=t+bar+row+form+tutorial','EX_012','EX_015'],
        ['EX_022','Overhead Press','Shoulders','Triceps','Barbell','Strength','Foundational shoulder press for mass','Bar at upper chest, brace core, press overhead to lockout, lower under control','https://www.youtube.com/results?search_query=overhead+press+proper+form+tutorial','EX_027','EX_026'],
        ['EX_023','Dumbbell Lateral Raise','Shoulders','','Dumbbells','Hypertrophy','Side delt isolation for shoulder width','Slight forward lean, raise to shoulder height leading with elbows, 3-second descent','https://www.youtube.com/results?search_query=dumbbell+lateral+raise+form+tutorial','EX_024','EX_026'],
        ['EX_024','Cable Lateral Raise','Shoulders','','Cable','Hypertrophy','Constant-tension lateral raise for shoulder width','Cross-body cable at hip, raise arm to shoulder height maintaining tension throughout','https://www.youtube.com/results?search_query=cable+lateral+raise+form+tutorial','EX_023','EX_026'],
        ['EX_025','Arnold Press','Shoulders','Triceps','Dumbbells','Hypertrophy','Full range press targeting all three delt heads','Palms facing you at start, rotate outward as you press, reverse on descent','https://www.youtube.com/results?search_query=arnold+press+form+tutorial','EX_027','EX_022'],
        ['EX_026','Machine Shoulder Press','Shoulders','Triceps','Machine','Hypertrophy','Guided overhead press with reduced stabilisation demand','Adjust seat for 90 degree elbow start, press to full extension, lower with control','https://www.youtube.com/results?search_query=machine+shoulder+press+form+tutorial','EX_027','EX_022'],
        ['EX_027','Seated Dumbbell Press','Shoulders','Triceps','Dumbbells','Strength','Strict overhead dumbbell pressing movement','Sit upright, dumbbells at shoulder height, press to lockout, controlled 3-second descent','https://www.youtube.com/results?search_query=seated+dumbbell+press+form+tutorial','EX_022','EX_026'],
        ['EX_028','Rear Delt Fly','Shoulders','Back','Dumbbells','Hypertrophy','Posterior delt isolation for balanced shoulders','Hinge to parallel, raise dumbbells out with slight elbow bend, squeeze rear delts','https://www.youtube.com/results?search_query=rear+delt+fly+form+tutorial','EX_017','EX_024'],
        ['EX_029','Front Raise','Shoulders','','Dumbbells','Hypertrophy','Anterior delt isolation movement','Hold dumbbells in front of thighs, raise to shoulder height, lower under control','https://www.youtube.com/results?search_query=dumbbell+front+raise+form+tutorial','EX_022','EX_024'],
        ['EX_030','Barbell Curl','Arms','','Barbell','Hypertrophy','Bilateral bicep mass builder','Elbows fixed at sides, curl to shoulder height, full extension at bottom, no swinging','https://www.youtube.com/results?search_query=barbell+curl+proper+form+tutorial','EX_033','EX_031'],
        ['EX_031','Hammer Curl','Arms','','Dumbbells','Hypertrophy','Neutral grip curl for brachialis and forearm strength','Neutral grip, curl with thumb pointing up throughout, control descent','https://www.youtube.com/results?search_query=hammer+curl+form+tutorial','EX_030','EX_033'],
        ['EX_032','Incline Dumbbell Curl','Arms','','Dumbbells','Hypertrophy','Long head bicep isolation with full stretch','45 degree incline, arms hang fully, curl with maximum range for long-head stretch','https://www.youtube.com/results?search_query=incline+dumbbell+curl+form+tutorial','EX_030','EX_033'],
        ['EX_033','Cable Bicep Curl','Arms','','Cable','Hypertrophy','Curl with constant cable tension throughout range','Low pulley, elbows fixed, curl and squeeze at top, resist the negative','https://www.youtube.com/results?search_query=cable+bicep+curl+form+tutorial','EX_030','EX_031'],
        ['EX_034','Concentration Curl','Arms','','Dumbbells','Hypertrophy','Peak bicep contraction isolation','Seated, elbow braced on inner thigh, curl fully, squeeze hard at top','https://www.youtube.com/results?search_query=concentration+curl+form+tutorial','EX_030','EX_033'],
        ['EX_035','Preacher Curl','Arms','','Barbell','Hypertrophy','Lower bicep isolation with shoulder support','Brace upper arms on pad, curl from full extension, squeeze at top','https://www.youtube.com/results?search_query=preacher+curl+form+tutorial','EX_030','EX_033'],
        ['EX_036','Tricep Pushdown','Arms','','Cable','Hypertrophy','Cable tricep isolation for consistent tension','Elbows fixed at sides, extend to full lockout, control the return','https://www.youtube.com/results?search_query=tricep+pushdown+form+tutorial','EX_038','EX_037'],
        ['EX_037','Skull Crusher','Arms','','Barbell','Hypertrophy','Long head tricep isolation movement','Lying on bench, lower bar to forehead hinging only at elbow, press to lockout','https://www.youtube.com/results?search_query=skull+crusher+form+tutorial','EX_036','EX_039'],
        ['EX_038','Cable Overhead Tricep Extension','Arms','','Cable','Hypertrophy','Long head tricep with constant cable tension','Face away from cable, hinge forward, extend arms overhead keeping elbows close','https://www.youtube.com/results?search_query=cable+overhead+tricep+extension+form+tutorial','EX_037','EX_036'],
        ['EX_039','Close-Grip Bench Press','Arms','Chest','Barbell','Strength','Tricep-focused compound press','Shoulder-width grip, elbows tucked 45 degrees, lower to chest, press to lockout','https://www.youtube.com/results?search_query=close+grip+bench+press+form+tutorial','EX_037','EX_036'],
        ['EX_040','Diamond Push-Up','Arms','Chest','Bodyweight','Strength','Bodyweight tricep pressing movement','Hands in diamond shape under chest, elbows track back, lower to chest, press up','https://www.youtube.com/results?search_query=diamond+push+up+form+tutorial','EX_036','EX_039'],
        ['EX_041','Overhead Dumbbell Tricep Extension','Arms','','Dumbbells','Hypertrophy','Long head tricep stretch with dumbbell','Hold dumbbell overhead with both hands, lower behind head, extend to lockout','https://www.youtube.com/results?search_query=overhead+dumbbell+tricep+extension+form+tutorial','EX_038','EX_037'],
        ['EX_042','Barbell Back Squat','Legs','Glutes','Barbell','Strength','King of leg movements for quad and lower body mass','Bar on traps, hip-width stance, squat to parallel or below, drive through heels','https://www.youtube.com/results?search_query=barbell+back+squat+proper+form+tutorial','EX_044','EX_043'],
        ['EX_043','Leg Press','Legs','Glutes','Machine','Hypertrophy','Quad press with reduced lower back demand','Feet hip-width on platform, lower to 90 degree knee angle, drive through full foot','https://www.youtube.com/results?search_query=leg+press+proper+form+tutorial','EX_042','EX_044'],
        ['EX_044','Hack Squat','Legs','Glutes','Machine','Strength','Quad-focused squat with supported back','Shoulders against pad, feet at bottom, squat deep, drive through full foot','https://www.youtube.com/results?search_query=hack+squat+machine+form+tutorial','EX_042','EX_043'],
        ['EX_045','Leg Extension','Legs','','Machine','Hypertrophy','Quad isolation for definition and mass','Adjust roller to lower shin, extend to full lockout, 2-second hold at top','https://www.youtube.com/results?search_query=leg+extension+machine+form+tutorial','EX_043','EX_047'],
        ['EX_046','Bulgarian Split Squat','Legs','Glutes','Dumbbells','Strength','Unilateral quad and glute movement','Rear foot elevated, front foot forward, descend until rear knee near floor','https://www.youtube.com/results?search_query=bulgarian+split+squat+form+tutorial','EX_042','EX_049'],
        ['EX_047','Goblet Squat','Legs','Glutes','Dumbbells','Strength','Squat with counterbalance for depth and form','Hold dumbbell at chest, squat deep, elbows push knees out, drive up tall','https://www.youtube.com/results?search_query=goblet+squat+form+tutorial','EX_042','EX_043'],
        ['EX_048','Smith Machine Squat','Legs','Glutes','Machine','Strength','Guided squat for safety and quad isolation','Feet slightly forward of bar, squat to parallel, drive through heels','https://www.youtube.com/results?search_query=smith+machine+squat+form+tutorial','EX_042','EX_043'],
        ['EX_049','Walking Lunges','Legs','Glutes','Dumbbells','Strength','Unilateral leg movement for quad, glute and stability','Step forward into lunge, knee over toe, push off front foot, step into next rep','https://www.youtube.com/results?search_query=walking+lunges+form+tutorial','EX_046','EX_057'],
        ['EX_050','Romanian Deadlift','Legs','Glutes','Barbell','Strength','Hamstring and glute stretch-focused hinge','Soft knee bend, hinge from hips until bar at shin level, drive hips to lockout','https://www.youtube.com/results?search_query=romanian+deadlift+form+tutorial','EX_051','EX_052'],
        ['EX_051','Leg Curl','Legs','','Machine','Hypertrophy','Hamstring isolation for size and balance','Lying face down, curl heels to glutes, brief hold, lower under control','https://www.youtube.com/results?search_query=lying+leg+curl+form+tutorial','EX_050','EX_054'],
        ['EX_052','Dumbbell Romanian Deadlift','Legs','Glutes','Dumbbells','Strength','Hip hinge with dumbbells for hamstring and glute','Hold dumbbells in front of thighs, hinge keeping back flat, lower to shin level','https://www.youtube.com/results?search_query=dumbbell+romanian+deadlift+form+tutorial','EX_050','EX_051'],
        ['EX_053','Nordic Hamstring Curl','Legs','','Bodyweight','Strength','Eccentric hamstring movement for injury prevention','Kneel with ankles anchored, lower body slowly under hamstring control, catch and push up','https://www.youtube.com/results?search_query=nordic+hamstring+curl+form+tutorial','EX_051','EX_050'],
        ['EX_054','Seated Leg Curl','Legs','','Machine','Hypertrophy','Seated hamstring isolation with different angle','Pads across thighs, curl from full extension to full contraction, control return','https://www.youtube.com/results?search_query=seated+leg+curl+form+tutorial','EX_051','EX_050'],
        ['EX_055','Hip Thrust','Glutes','Hamstrings','Barbell','Strength','Primary glute builder for size and strength','Shoulders on bench, bar over hips with pad, drive hips to lockout, squeeze at top','https://www.youtube.com/results?search_query=hip+thrust+proper+form+tutorial','EX_056','EX_060'],
        ['EX_056','Glute Bridge','Glutes','Hamstrings','Bodyweight','Strength','Foundational glute activation movement','Lie on back feet flat, drive hips to ceiling, squeeze glutes hard, 2-second hold','https://www.youtube.com/results?search_query=glute+bridge+form+tutorial','EX_055','EX_058'],
        ['EX_057','Step-Up','Glutes','Legs','Dumbbells','Strength','Unilateral leg and glute strength movement','Hold dumbbells, step onto box with full foot, drive through heel, stand tall on box','https://www.youtube.com/results?search_query=dumbbell+step+up+form+tutorial','EX_046','EX_055'],
        ['EX_058','Cable Kickback','Glutes','','Cable','Hypertrophy','Glute isolation for shape and activation','Ankle cuff on low cable, slight forward lean, kick back until glute fully contracted','https://www.youtube.com/results?search_query=cable+kickback+glutes+form+tutorial','EX_055','EX_056'],
        ['EX_059','Sumo Deadlift','Glutes','Hamstrings','Barbell','Strength','Wide-stance deadlift for glutes and inner thighs','Wide stance toes out, grip inside legs, drive hips and knees together to lockout','https://www.youtube.com/results?search_query=sumo+deadlift+proper+form+tutorial','EX_055','EX_050'],
        ['EX_060','Cable Pull-Through','Glutes','Hamstrings','Cable','Hypertrophy','Hip hinge for glute and hamstring development','Face away from cable, rope between legs, hinge back then drive hips forward explosively','https://www.youtube.com/results?search_query=cable+pull+through+form+tutorial','EX_055','EX_056'],
        ['EX_061','Abductor Machine','Glutes','','Machine','Hypertrophy','Outer glute and hip abductor isolation','Sit in machine, push pads outward against resistance, control inward return','https://www.youtube.com/results?search_query=abductor+machine+form+tutorial','EX_058','EX_056'],
        ['EX_062','Standing Calf Raise','Legs','','Machine','Hypertrophy','Primary calf builder for size and strength','Toes on edge, full range from deep stretch to full raise, 3-second descent','https://www.youtube.com/results?search_query=standing+calf+raise+form+tutorial','EX_063','EX_064'],
        ['EX_063','Seated Calf Raise','Legs','','Machine','Hypertrophy','Soleus-focused calf for lower leg development','Pads on knees, full range stretch to contraction, 3-second controlled descent','https://www.youtube.com/results?search_query=seated+calf+raise+form+tutorial','EX_062','EX_064'],
        ['EX_064','Single-Leg Calf Raise','Legs','','Bodyweight','Strength','Unilateral calf for balance and strength','Balance on step edge, full range raise, hold at top, control the descent','https://www.youtube.com/results?search_query=single+leg+calf+raise+form+tutorial','EX_062','EX_063'],
        ['EX_065','Plank','Core','','Bodyweight','Strength','Foundational isometric core stability','Forearms and toes, body straight from head to heels, brace abs hard, breathe normally','https://www.youtube.com/results?search_query=plank+proper+form+tutorial','EX_066','EX_068'],
        ['EX_066','Ab Wheel Rollout','Core','','Bodyweight','Strength','Dynamic core stability with full range of motion','Kneel with wheel under shoulders, roll out until near parallel, abs pull you back','https://www.youtube.com/results?search_query=ab+wheel+rollout+form+tutorial','EX_065','EX_070'],
        ['EX_067','Cable Crunch','Core','','Cable','Hypertrophy','Weighted ab flexion for core size','Kneel facing cable, rope at forehead, crunch abs toward knees, squeeze at bottom','https://www.youtube.com/results?search_query=cable+crunch+form+tutorial','EX_072','EX_071'],
        ['EX_068','Hanging Leg Raise','Core','','Bodyweight','Strength','Lower ab and hip flexor strength','Dead hang from bar, raise legs to 90 degrees or beyond, slow controlled descent','https://www.youtube.com/results?search_query=hanging+leg+raise+form+tutorial','EX_065','EX_071'],
        ['EX_069','Pallof Press','Core','','Cable','Strength','Anti-rotation core stability movement','Stand perpendicular to cable, press straight out resisting rotation, hold 2 seconds','https://www.youtube.com/results?search_query=pallof+press+form+tutorial','EX_065','EX_066'],
        ['EX_070','Dead Bug','Core','','Bodyweight','Strength','Coordination and deep core stability','Lie on back arms up, opposite arm and leg lower together, lower back stays on floor','https://www.youtube.com/results?search_query=dead+bug+exercise+form+tutorial','EX_065','EX_069'],
        ['EX_071','Russian Twist','Core','','Bodyweight','Hypertrophy','Rotational oblique movement for core definition','Lean back slightly feet off floor, rotate torso side to side, add weight for progression','https://www.youtube.com/results?search_query=russian+twist+form+tutorial','EX_067','EX_068'],
        ['EX_072','Bicycle Crunch','Core','','Bodyweight','Hypertrophy','Oblique and ab movement with alternating rotation','Hands behind head, bring opposite elbow to knee while extending other leg, slow and controlled','https://www.youtube.com/results?search_query=bicycle+crunch+form+tutorial','EX_071','EX_067'],
        ['EX_073','Side Plank','Core','','Bodyweight','Strength','Lateral core stability and oblique endurance','On forearm and feet, body in straight line, hold without sagging hips','https://www.youtube.com/results?search_query=side+plank+form+tutorial','EX_065','EX_069'],
        ['EX_074','Kettlebell Swing','Full Body','Glutes','Kettlebell','Power','Hip hinge power movement for posterior chain conditioning','Hinge with soft knees, drive hips forward explosively swinging bell to shoulder height','https://www.youtube.com/results?search_query=kettlebell+swing+proper+form+tutorial','EX_059','EX_055'],
        ['EX_075','Box Jump','Full Body','Legs','Bodyweight','Power','Explosive lower body power development','Quarter squat, swing arms back, explode onto box, land softly, step down carefully','https://www.youtube.com/results?search_query=box+jump+proper+form+tutorial','EX_042','EX_074'],
        ['EX_076','Farmers Walk','Full Body','Core','Dumbbells','Strength','Loaded carry for grip, core and total body conditioning','Hold heavy dumbbells, stand tall, short fast steps, squeeze grip hard throughout','https://www.youtube.com/results?search_query=farmers+walk+form+tutorial','EX_074','EX_016'],
        ['EX_077','Clean and Press','Full Body','Shoulders','Barbell','Power','Total body power movement from floor to overhead','Deadlift into a high pull, catch at shoulders, press overhead, lower with control','https://www.youtube.com/results?search_query=clean+and+press+form+tutorial','EX_022','EX_074'],
        ['EX_078','Battle Ropes','Full Body','Shoulders','Equipment','Power','Upper body conditioning and metabolic training','Anchor rope at low point, alternate or simultaneous wave patterns, drive from hips','https://www.youtube.com/results?search_query=battle+ropes+workout+form+tutorial','EX_074','EX_076'],
        ['EX_079','Hip Flexor Stretch','Full Body','','Bodyweight','Mobility','Hip flexor and quad mobility','Kneeling lunge position, push hips forward, hold for 30-60 seconds each side','https://www.youtube.com/results?search_query=hip+flexor+stretch+tutorial','EX_080','EX_081'],
        ['EX_080','Thoracic Extension','Full Body','','Bodyweight','Mobility','Upper back mobility for posture and pressing','Foam roller under mid-back, arms behind head, extend over roller, hold briefly','https://www.youtube.com/results?search_query=thoracic+extension+mobility+tutorial','EX_079','EX_081'],
        ['EX_081','Worlds Greatest Stretch','Full Body','','Bodyweight','Mobility','Full body mobility combining hip, thoracic and hamstring','Lunge forward, rotate thoracic spine, reach overhead, hold, repeat other side','https://www.youtube.com/results?search_query=worlds+greatest+stretch+form+tutorial','EX_079','EX_080'],
      ];

      exData.forEach(function(row) { exSheet.appendRow(row); });
      return ok({ seeded: true, count: exData.length });
    }

    // -- AI exercise substitution for injuries -----------------------------------
    if (data.action === 'substituteExercises') {
      var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
      if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

      var injuryNotes = data.injuryNotes || '';
      var flaggedExs  = data.exercises   || [];
      var exListStr = flaggedExs.map(function(e) {
        return '- ' + e.name + ' (' + (e.muscleGroup || 'unknown') + ')';
      }).join('\n');

      var subPrompt =
        'You are a personal trainer. A client reported this injury: "' + injuryNotes + '"\n\n' +
        'These exercises may aggravate it:\n' + exListStr + '\n\n' +
        'For EACH exercise suggest ONE safer alternative that trains the same muscle group while avoiding the injured area.\n' +
        'Return ONLY a JSON array (no markdown):\n' +
        '[{"original":"Bench Press","substitute":"Machine Chest Press","reason":"Less shoulder stress"}]\n' +
        'If all exercises are already safe return [].';

      var subResp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        payload: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512,
          messages: [{ role: 'user', content: subPrompt }] }),
        muteHttpExceptions: true,
      });
      var subResult = JSON.parse(subResp.getContentText());
      if (subResult.error) throw new Error(subResult.error.message);
      var subTxt = subResult.content[0].text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
      return ok({ substitutions: JSON.parse(subTxt) });
    }

    // -- Apply progressive overload to program DaysJSON -----------------------
    if (data.action === 'applyProgression') {
      var programId = data.programId;
      var pgUpdates = data.updates || [];

      var pgSheet  = ss.getSheetByName('Programs');
      if (!pgSheet) throw new Error('Programs sheet not found');
      var pgLastCol = pgSheet.getLastColumn();
      var pgLastRow = pgSheet.getLastRow();
      if (pgLastRow < 2) throw new Error('No programs found');

      var pgHeaders = pgSheet.getRange(1,1,1,pgLastCol).getValues()[0];
      var pgIdIdx   = pgHeaders.indexOf('ProgramID');
      var pgJsonIdx = pgHeaders.indexOf('DaysJSON');
      if (pgIdIdx < 0 || pgJsonIdx < 0) throw new Error('Missing ProgramID or DaysJSON column');

      var pgRows = pgSheet.getRange(2,1,pgLastRow-1,pgLastCol).getValues();
      var pgRowIdx = -1;
      for (var pgi = 0; pgi < pgRows.length; pgi++) {
        if (pgRows[pgi][pgIdIdx] === programId) { pgRowIdx = pgi; break; }
      }
      if (pgRowIdx < 0) throw new Error('Program not found: ' + programId);

      var pgDays;
      try { pgDays = JSON.parse(pgRows[pgRowIdx][pgJsonIdx]); }
      catch(pje) { throw new Error('Invalid DaysJSON in program'); }

      var pgUpdMap = {};
      pgUpdates.forEach(function(u) { pgUpdMap[u.exerciseName.toLowerCase()] = u; });

      pgDays.forEach(function(day) {
        (day.exercises || []).forEach(function(ex) {
          var upd = pgUpdMap[(ex.name || '').toLowerCase()];
          if (!upd) return;
          if (upd.type === 'weight') ex.weight = upd.newWeight;
          else if (upd.type === 'reps') ex.reps = String(upd.newReps);
        });
      });

      pgSheet.getRange(pgRowIdx + 2, pgJsonIdx + 1).setValue(JSON.stringify(pgDays));
      return ok({ updated: true, count: pgUpdates.length });
    }

    // ── Suggest program settings from client description ─────────────────────
    if (data.action === 'suggestSettings') {
      var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
      if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

      var description = data.description || '';
      var suggestPrompt = 'You are an expert personal trainer. Based on this client description, suggest optimal program settings.\n' +
        'Client description: ' + description + '\n\n' +
        'Return ONLY valid JSON with these exact fields (no markdown, no extra text):\n' +
        '{\n' +
        '  "goal": "Weight Loss|Muscle Gain|Strength|General Fitness",\n' +
        '  "daysPerWeek": 3,\n' +
        '  "durationWeeks": 8,\n' +
        '  "sessionDuration": 60,\n' +
        '  "trainingType": "HIIT|Strength and Conditioning|Hypertrophy|Mobility",\n' +
        '  "level": "Beginner|Intermediate|Advanced",\n' +
        '  "equipment": ["Dumbbells","Barbell"],\n' +
        '  "emphasisAreas": ["Glutes","Shoulders"]\n' +
        '}\n\n' +
        'Equipment options: Barbell, Dumbbells, Cables, Machines, Kettlebells, Bodyweight, Resistance Bands, TRX, Smith Machine\n' +
        'emphasisAreas are muscle groups the client wants MORE focus on (higher set count) — all other muscles are still trained. Options: Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Core\n' +
        'Pick the most appropriate values based on the description.';

      var suggestPayload = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: suggestPrompt }],
      };

      var suggestResp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        payload: JSON.stringify(suggestPayload),
        muteHttpExceptions: true,
      });

      var suggestResult = JSON.parse(suggestResp.getContentText());
      if (suggestResult.error) throw new Error(suggestResult.error.message);
      var suggestText = suggestResult.content[0].text.trim();
      suggestText = suggestText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      var settings = JSON.parse(suggestText);
      return ok({ settings: settings });
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
    model:      'claude-sonnet-4-6',
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
