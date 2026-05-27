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
        model: 'claude-haiku-4-5-20251001',
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


    // ── Seed the Exercises sheet with a starter library ───────────────────────
    if (data.action === 'seedExercises') {
      var exSheet = ss.getSheetByName('Exercises');
      if (!exSheet) exSheet = ss.insertSheet('Exercises');

      var exHeaders = ['ExerciseID','Name','MuscleGroup','Equipment','Category','Description','VideoURL','Instructions'];
      var existingRows = exSheet.getLastRow();
      if (existingRows === 0) {
        exSheet.getRange(1, 1, 1, exHeaders.length).setValues([exHeaders]);
        existingRows = 1;
      }
      if (existingRows > 5) {
        return ok({ seeded: false, reason: 'Exercises sheet already has data. Clear rows 2 onwards if you want to re-seed.' });
      }

      var exData = [
        // ── Chest ────────────────────────────────────────────────────────────
        ['EX_001','Barbell Bench Press','Chest','Barbell','Strength','Classic horizontal pressing movement for chest mass','https://www.youtube.com/results?search_query=barbell+bench+press+proper+form','Lie flat, grip slightly wider than shoulders, lower bar to mid-chest, press explosively'],
        ['EX_002','Incline Dumbbell Press','Chest','Dumbbells','Hypertrophy','Upper chest focused pressing movement','https://www.youtube.com/results?search_query=incline+dumbbell+press+form+tutorial','Set bench 30-45°, press dumbbells from shoulder to above chest, 3-second descent'],
        ['EX_003','Cable Fly','Chest','Cable','Hypertrophy','Full chest stretch and peak contraction isolation','https://www.youtube.com/results?search_query=cable+fly+chest+form+tutorial','Cables at shoulder height, sweep arms in hugging arc, squeeze hard at centre'],
        ['EX_004','Push-Up','Chest','Bodyweight','Strength','Foundational chest and tricep pressing movement','https://www.youtube.com/results?search_query=push+up+proper+form+tutorial','Hands slightly wider than shoulders, body in plank, chest to floor, drive up fully'],
        ['EX_005','Dumbbell Bench Press','Chest','Dumbbells','Hypertrophy','Greater range of motion than barbell bench press','https://www.youtube.com/results?search_query=dumbbell+bench+press+form+tutorial','Lie flat, dumbbells at chest, press to lockout, 2-second controlled descent'],
        ['EX_006','Chest Press Machine','Chest','Machine','Hypertrophy','Safer pressing alternative with guided path','https://www.youtube.com/results?search_query=chest+press+machine+form+tutorial','Adjust seat so handles are at mid-chest, press to full extension, slow return'],
        ['EX_007','Pec Dec Machine','Chest','Machine','Hypertrophy','Fly isolation with constant machine tension','https://www.youtube.com/results?search_query=pec+dec+machine+form+tutorial','Sit upright, forearms on pads at 90°, sweep together until nearly touching'],
        ['EX_008','Dips','Chest','Bodyweight','Strength','Lower chest compound bodyweight movement','https://www.youtube.com/results?search_query=chest+dips+proper+form+tutorial','Lean forward for chest emphasis, lower until shoulders below elbows, press to lockout'],
        ['EX_009','Smith Machine Bench Press','Chest','Machine','Strength','Guided bench press for hypertrophy with safety catches','https://www.youtube.com/results?search_query=smith+machine+bench+press+form+tutorial','Set safety stops, unrack bar, lower to chest with 2-second pause, press to lockout'],
        // ── Back ─────────────────────────────────────────────────────────────
        ['EX_010','Pull-Up','Back','Bodyweight','Strength','Foundational vertical pull for back width','https://www.youtube.com/results?search_query=pull+up+proper+form+tutorial','Grip wider than shoulders, pull chest to bar, control the descent, full hang at bottom'],
        ['EX_011','Barbell Row','Back','Barbell','Strength','Horizontal rowing for back thickness','https://www.youtube.com/results?search_query=barbell+row+proper+form+tutorial','Hinge 45°, pull bar to lower sternum, drive elbows back, controlled descent'],
        ['EX_012','Lat Pulldown','Back','Cable','Hypertrophy','Machine vertical pull for lat development','https://www.youtube.com/results?search_query=lat+pulldown+proper+form+tutorial','Wide grip, slight lean back, pull bar to upper chest, squeeze lats, control return'],
        ['EX_013','Seated Cable Row','Back','Cable','Hypertrophy','Mid-back horizontal rowing movement','https://www.youtube.com/results?search_query=seated+cable+row+form+tutorial','Sit tall, pull handle to lower abdomen, squeeze shoulder blades, return with control'],
        ['EX_014','Single-Arm Dumbbell Row','Back','Dumbbells','Strength','Unilateral rowing for balanced back development','https://www.youtube.com/results?search_query=single+arm+dumbbell+row+form+tutorial','Brace on bench, row dumbbell to hip, elbow past body, lower under control'],
        ['EX_015','Deadlift','Back','Barbell','Strength','Full body posterior chain compound movement','https://www.youtube.com/results?search_query=deadlift+proper+form+tutorial','Bar over mid-foot, neutral spine, drive through floor, lock hips and knees together'],
        ['EX_016','Face Pull','Back','Cable','Hypertrophy','Rear delt and upper back for shoulder health','https://www.youtube.com/results?search_query=face+pull+proper+form+tutorial','Cable at head height, pull to face with elbows high and wide, external rotate at end'],
        ['EX_017','Machine Row','Back','Machine','Hypertrophy','Supported back rowing without lower back load','https://www.youtube.com/results?search_query=machine+row+form+tutorial','Chest against pad, pull handles to sides of torso, squeeze shoulder blades'],
        ['EX_018','Straight-Arm Pulldown','Back','Cable','Hypertrophy','Lat isolation emphasising the stretch position','https://www.youtube.com/results?search_query=straight+arm+pulldown+form+tutorial','Arms extended, push bar down in arc to thighs keeping arms straight, squeeze lats'],
        ['EX_019','Chin-Up','Back','Bodyweight','Strength','Underhand pull-up for lats and bicep involvement','https://www.youtube.com/results?search_query=chin+up+proper+form+tutorial','Supinated grip, pull chin over bar, full extension at bottom'],
        // ── Shoulders ────────────────────────────────────────────────────────
        ['EX_020','Overhead Press','Shoulders','Barbell','Strength','Foundational shoulder press for mass','https://www.youtube.com/results?search_query=overhead+press+proper+form+tutorial','Bar at upper chest, brace core, press overhead to lockout, lower under control'],
        ['EX_021','Dumbbell Lateral Raise','Shoulders','Dumbbells','Hypertrophy','Side delt isolation for shoulder width','https://www.youtube.com/results?search_query=dumbbell+lateral+raise+form+tutorial','Slight forward lean, raise to shoulder height leading with elbows, 3-second descent'],
        ['EX_022','Arnold Press','Shoulders','Dumbbells','Hypertrophy','Full range press targeting all three delt heads','https://www.youtube.com/results?search_query=arnold+press+form+tutorial','Palms facing you at start, rotate outward as you press, reverse on descent'],
        ['EX_023','Rear Delt Fly','Shoulders','Dumbbells','Hypertrophy','Posterior delt isolation for balanced shoulders','https://www.youtube.com/results?search_query=rear+delt+fly+form+tutorial','Hinge to parallel, raise dumbbells out with slight elbow bend, squeeze rear delts'],
        ['EX_024','Cable Lateral Raise','Shoulders','Cable','Hypertrophy','Constant-tension lateral raise for shoulder width','https://www.youtube.com/results?search_query=cable+lateral+raise+form+tutorial','Cross-body cable at hip, raise arm to shoulder height maintaining tension throughout'],
        ['EX_025','Machine Shoulder Press','Shoulders','Machine','Hypertrophy','Guided overhead press with reduced stabilisation demand','https://www.youtube.com/results?search_query=machine+shoulder+press+form+tutorial','Adjust seat for 90° elbow start, press to full extension, lower with control'],
        ['EX_026','Seated Dumbbell Press','Shoulders','Dumbbells','Strength','Strict overhead dumbbell pressing movement','https://www.youtube.com/results?search_query=seated+dumbbell+press+form+tutorial','Sit upright, dumbbells at shoulder height, press to lockout, controlled 3-second descent'],
        // ── Arms ─────────────────────────────────────────────────────────────
        ['EX_027','Barbell Curl','Arms','Barbell','Hypertrophy','Bilateral bicep mass builder','https://www.youtube.com/results?search_query=barbell+curl+proper+form+tutorial','Elbows fixed at sides, curl to shoulder height, full extension at bottom, no swinging'],
        ['EX_028','Tricep Pushdown','Arms','Cable','Hypertrophy','Cable tricep isolation for consistent tension','https://www.youtube.com/results?search_query=tricep+pushdown+form+tutorial','Elbows fixed at sides, extend to full lockout, control the return'],
        ['EX_029','Hammer Curl','Arms','Dumbbells','Hypertrophy','Neutral grip curl for brachialis and forearm strength','https://www.youtube.com/results?search_query=hammer+curl+form+tutorial','Neutral grip, curl with thumb pointing up throughout, control descent'],
        ['EX_030','Skull Crusher','Arms','Barbell','Hypertrophy','Long head tricep isolation movement','https://www.youtube.com/results?search_query=skull+crusher+form+tutorial','Lying on bench, lower bar to forehead hinging only at elbow, press to lockout'],
        ['EX_031','Incline Dumbbell Curl','Arms','Dumbbells','Hypertrophy','Long head bicep isolation with full stretch','https://www.youtube.com/results?search_query=incline+dumbbell+curl+form+tutorial','45° incline, arms hang fully, curl with maximum range for long-head stretch'],
        ['EX_032','Cable Overhead Tricep Extension','Arms','Cable','Hypertrophy','Long head tricep with constant cable tension','https://www.youtube.com/results?search_query=cable+overhead+tricep+extension+form+tutorial','Face away from cable, hinge forward, extend arms overhead keeping elbows close'],
        ['EX_033','Cable Bicep Curl','Arms','Cable','Hypertrophy','Curl with constant cable tension throughout range','https://www.youtube.com/results?search_query=cable+bicep+curl+form+tutorial','Low pulley, elbows fixed, curl and squeeze at top, resist the negative'],
        ['EX_034','Close-Grip Bench Press','Arms','Barbell','Strength','Tricep-focused compound press','https://www.youtube.com/results?search_query=close+grip+bench+press+form+tutorial','Shoulder-width grip, elbows tucked 45°, lower to chest, press to lockout'],
        // ── Legs ─────────────────────────────────────────────────────────────
        ['EX_035','Barbell Back Squat','Legs','Barbell','Strength','King of leg movements for quad and lower body mass','https://www.youtube.com/results?search_query=barbell+back+squat+proper+form+tutorial','Bar on traps, hip-width stance, squat to parallel or below, drive through heels'],
        ['EX_036','Leg Press','Legs','Machine','Hypertrophy','Quad press with reduced lower back demand','https://www.youtube.com/results?search_query=leg+press+proper+form+tutorial','Feet hip-width on platform, lower to 90° knee angle, drive through full foot'],
        ['EX_037','Leg Extension','Legs','Machine','Hypertrophy','Quad isolation for definition and mass','https://www.youtube.com/results?search_query=leg+extension+machine+form+tutorial','Adjust roller to lower shin, extend to full lockout, 2-second hold at top'],
        ['EX_038','Bulgarian Split Squat','Legs','Dumbbells','Strength','Unilateral quad and glute movement','https://www.youtube.com/results?search_query=bulgarian+split+squat+form+tutorial','Rear foot elevated, front foot forward, descend until rear knee near floor'],
        ['EX_039','Romanian Deadlift','Legs','Barbell','Strength','Hamstring and glute stretch-focused hinge','https://www.youtube.com/results?search_query=romanian+deadlift+form+tutorial','Soft knee bend, hinge from hips until bar at shin level, drive hips to lockout'],
        ['EX_040','Leg Curl','Legs','Machine','Hypertrophy','Hamstring isolation for size and balance','https://www.youtube.com/results?search_query=lying+leg+curl+form+tutorial','Lying face down, curl heels to glutes, brief hold, lower under control'],
        ['EX_041','Walking Lunges','Legs','Dumbbells','Strength','Unilateral leg movement for quad, glute and stability','https://www.youtube.com/results?search_query=walking+lunges+form+tutorial','Step forward into lunge, knee over toe, push off front foot, step into next rep'],
        ['EX_042','Goblet Squat','Legs','Dumbbells','Strength','Squat with counterbalance for depth and form','https://www.youtube.com/results?search_query=goblet+squat+form+tutorial','Hold dumbbell at chest, squat deep, elbows push knees out, drive up tall'],
        ['EX_043','Hack Squat','Legs','Machine','Strength','Quad-focused squat with supported back','https://www.youtube.com/results?search_query=hack+squat+machine+form+tutorial','Shoulders against pad, feet at bottom, squat deep, drive through full foot'],
        ['EX_044','Smith Machine Squat','Legs','Machine','Strength','Guided squat for safety and quad isolation','https://www.youtube.com/results?search_query=smith+machine+squat+form+tutorial','Feet slightly forward of bar, squat to parallel, drive through heels'],
        ['EX_045','Nordic Hamstring Curl','Legs','Bodyweight','Strength','Eccentric hamstring movement for injury prevention','https://www.youtube.com/results?search_query=nordic+hamstring+curl+form+tutorial','Kneel with ankles anchored, lower body slowly under hamstring control, catch and push up'],
        ['EX_046','Step-Up','Legs','Dumbbells','Strength','Unilateral leg and glute strength movement','https://www.youtube.com/results?search_query=dumbbell+step+up+form+tutorial','Hold dumbbells, step onto box with full foot, drive through heel, stand tall on box'],
        // ── Glutes ───────────────────────────────────────────────────────────
        ['EX_047','Hip Thrust','Glutes','Barbell','Strength','Primary glute builder for size and strength','https://www.youtube.com/results?search_query=hip+thrust+proper+form+tutorial','Shoulders on bench, bar over hips with pad, drive hips to lockout, squeeze at top'],
        ['EX_048','Cable Kickback','Glutes','Cable','Hypertrophy','Glute isolation for shape and activation','https://www.youtube.com/results?search_query=cable+kickback+glutes+form+tutorial','Ankle cuff on low cable, slight forward lean, kick back until glute fully contracted'],
        ['EX_049','Sumo Deadlift','Glutes','Barbell','Strength','Wide-stance deadlift for glutes and inner thighs','https://www.youtube.com/results?search_query=sumo+deadlift+proper+form+tutorial','Wide stance toes out, grip inside legs, drive hips and knees together to lockout'],
        ['EX_050','Glute Bridge','Glutes','Bodyweight','Strength','Foundational glute activation movement','https://www.youtube.com/results?search_query=glute+bridge+form+tutorial','Lie on back feet flat, drive hips to ceiling, squeeze glutes hard, 2-second hold'],
        ['EX_051','Cable Pull-Through','Glutes','Cable','Hypertrophy','Hip hinge for glute and hamstring development','https://www.youtube.com/results?search_query=cable+pull+through+form+tutorial','Face away from cable, rope between legs, hinge back then drive hips forward explosively'],
        ['EX_052','Dumbbell Romanian Deadlift','Glutes','Dumbbells','Strength','Hip hinge with dumbbells for glute and hamstring','https://www.youtube.com/results?search_query=dumbbell+romanian+deadlift+form+tutorial','Hold dumbbells in front of thighs, hinge keeping back flat, lower to shin level'],
        // ── Core ─────────────────────────────────────────────────────────────
        ['EX_053','Plank','Core','Bodyweight','Strength','Foundational isometric core stability','https://www.youtube.com/results?search_query=plank+proper+form+tutorial','Forearms and toes, body straight from head to heels, brace abs hard, breathe normally'],
        ['EX_054','Ab Wheel Rollout','Core','Equipment','Strength','Dynamic core stability with full range of motion','https://www.youtube.com/results?search_query=ab+wheel+rollout+form+tutorial','Kneel with wheel under shoulders, roll out until near parallel, abs pull you back'],
        ['EX_055','Cable Crunch','Core','Cable','Hypertrophy','Weighted ab flexion for core size','https://www.youtube.com/results?search_query=cable+crunch+form+tutorial','Kneel facing cable, rope at forehead, crunch abs toward knees, squeeze at bottom'],
        ['EX_056','Hanging Leg Raise','Core','Bodyweight','Strength','Lower ab and hip flexor strength','https://www.youtube.com/results?search_query=hanging+leg+raise+form+tutorial','Dead hang from bar, raise legs to 90° or beyond, slow controlled descent'],
        ['EX_057','Pallof Press','Core','Cable','Strength','Anti-rotation core stability movement','https://www.youtube.com/results?search_query=pallof+press+form+tutorial','Stand perpendicular to cable, press straight out resisting rotation, hold 2 seconds'],
        ['EX_058','Dead Bug','Core','Bodyweight','Strength','Coordination and deep core stability','https://www.youtube.com/results?search_query=dead+bug+exercise+form+tutorial','Lie on back arms up, opposite arm and leg lower together, lower back stays on floor'],
        ['EX_059','Russian Twist','Core','Bodyweight','Hypertrophy','Rotational oblique movement for core definition','https://www.youtube.com/results?search_query=russian+twist+form+tutorial','Lean back slightly feet off floor, rotate torso side to side, add weight for progression'],
        ['EX_060','Bicycle Crunch','Core','Bodyweight','Hypertrophy','Oblique and ab movement with alternating rotation','https://www.youtube.com/results?search_query=bicycle+crunch+form+tutorial','Hands behind head, bring opposite elbow to knee while extending other leg, slow and controlled'],
        // ── Full Body / Power ─────────────────────────────────────────────────
        ['EX_061','Kettlebell Swing','Full Body','Kettlebell','Power','Hip hinge power movement for glutes and posterior chain','https://www.youtube.com/results?search_query=kettlebell+swing+proper+form+tutorial','Hinge with soft knees, drive hips forward explosively swinging bell to shoulder height'],
        ['EX_062','Box Jump','Full Body','Bodyweight','Power','Explosive lower body power development','https://www.youtube.com/results?search_query=box+jump+proper+form+tutorial','Quarter squat, swing arms back, explode onto box, land softly, step down carefully'],
        ['EX_063','Farmer\'s Walk','Full Body','Dumbbells','Strength','Loaded carry for grip, core and conditioning','https://www.youtube.com/results?search_query=farmers+walk+form+tutorial','Hold heavy dumbbells, stand tall, short fast steps, squeeze grip hard throughout'],
        // ── Calves ───────────────────────────────────────────────────────────
        ['EX_064','Standing Calf Raise','Legs','Machine','Hypertrophy','Primary calf builder for size and strength','https://www.youtube.com/results?search_query=standing+calf+raise+form+tutorial','Toes on edge, full range from deep stretch to full raise, 3-second descent'],
        ['EX_065','Seated Calf Raise','Legs','Machine','Hypertrophy','Soleus-focused calf for lower leg development','https://www.youtube.com/results?search_query=seated+calf+raise+form+tutorial','Pads on knees, full range stretch to contraction, 3-second controlled descent'],
        ['EX_066','Single-Leg Calf Raise','Legs','Bodyweight','Strength','Unilateral calf for balance and strength','https://www.youtube.com/results?search_query=single+leg+calf+raise+form+tutorial','Balance on step edge, full range raise, hold at top, control the descent'],
      ];

      exData.forEach(function(row) { exSheet.appendRow(row); });
      return ok({ seeded: true, count: exData.length });
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
