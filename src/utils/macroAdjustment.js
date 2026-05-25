/**
 * macroAdjustment.js — TomFarmerFitness Auto-Macro Adjustment Engine
 * ====================================================================
 * Called each time a client's data loads. Analyses recent weight trend
 * and compliance to determine whether macro targets need updating.
 *
 * Exports:
 *   runMacroAdjustmentCheck(params)  — main entry point (async)
 *   getMacroNotification(clientId)   — read pending notification from localStorage
 *   dismissMacroNotification(cid)   — clear notification from localStorage
 */

import { appendToSheet } from './sheets';
import config from '../config';

// ─── Constants ────────────────────────────────────────────────────────────────
const ADJUSTMENT_INTERVAL_DAYS      = 10;
const GENERAL_FITNESS_INTERVAL_DAYS = 30;
const NOTIFICATION_KEY              = (cid) => `tff_macro_notification_${cid}`;
const PAUSE_KEY                     = (cid) => `tff_macro_pause_${cid}`;

// ─── Date helpers ─────────────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(String(str).slice(0, 10));
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Weight trend (linear regression) ────────────────────────────────────────
/**
 * Returns kg/week rate from an array of weight entries.
 * Each entry: { Date, Weight } (strings from Sheets).
 * Negative = losing, positive = gaining.
 */
export function calculateWeightTrend(entries) {
  if (!entries || entries.length < 2) return null;

  const sorted = [...entries]
    .map(e => ({ d: parseDate(e.Date || e.date), w: parseFloat(e.Weight || e.weight) }))
    .filter(e => e.d && !isNaN(e.w))
    .sort((a, b) => a.d - b.d);

  if (sorted.length < 2) return null;

  const base = sorted[0].d;
  const pts  = sorted.map(e => ({ x: daysBetween(base, e.d), y: e.w }));

  const n    = pts.length;
  const sumX = pts.reduce((s, p) => s + p.x, 0);
  const sumY = pts.reduce((s, p) => s + p.y, 0);
  const sumXY= pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2= pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom= n * sumX2 - sumX * sumX;

  if (denom === 0) return 0;
  return ((n * sumXY - sumX * sumY) / denom) * 7; // kg/week
}

// ─── Compliance ───────────────────────────────────────────────────────────────
/**
 * Nutrition compliance: fraction of days since `sinceISO` where
 * any calories were logged for this client.
 */
export function calculateNutritionCompliance(nutritionLogs, clientId, sinceISO) {
  const since = parseDate(sinceISO);
  if (!since) return 0;
  const totalDays = Math.max(1, daysBetween(since, new Date()));

  const loggedDates = new Set();
  for (const row of nutritionLogs) {
    if (row.ClientID !== clientId) continue;
    const dateStr = (row.Date || row.LogDate || '').slice(0, 10);
    const d = parseDate(dateStr);
    if (!d || d < since) continue;
    const cals = parseFloat(row.Calories || row.TotalCalories || 0);
    if (cals > 0) loggedDates.add(dateStr);
  }

  return Math.min(1, loggedDates.size / totalDays);
}

/**
 * Training compliance: fraction of expected sessions that were completed.
 * daysPerWeek is from the client's program.
 */
export function calculateTrainingCompliance(trainingLogs, clientId, sinceISO, daysPerWeek = 3) {
  const since = parseDate(sinceISO);
  if (!since) return 0;
  const totalDays = Math.max(1, daysBetween(since, new Date()));
  const expectedSessions = Math.max(1, Math.round((totalDays / 7) * daysPerWeek));

  const loggedDates = new Set();
  for (const row of trainingLogs) {
    if (row.ClientID !== clientId) continue;
    const dateStr = (row.Date || row.WorkoutDate || row.LogDate || '').slice(0, 10);
    const d = parseDate(dateStr);
    if (!d || d < since) continue;
    if (row.Status === 'Completed' || row.Completed === 'TRUE') {
      loggedDates.add(dateStr);
    }
  }

  return Math.min(1, loggedDates.size / expectedSessions);
}

// ─── Core adjustment logic ────────────────────────────────────────────────────
/**
 * Pure function — computes what adjustment (if any) is needed.
 * Returns { shouldAdjust, newTargets, reason, coachNote, weightTrend,
 *           nutritionCompliance, trainingCompliance }
 */
export function computeAdjustment({ client, weightEntries, nutritionCompliance, trainingCompliance }) {
  const goal       = (client.Goal || '').toLowerCase();
  const bodyWeight = parseFloat(client.Weight || client.CurrentWeight || 70) || 70;

  const calories = Math.round(parseFloat(client.TargetCalories) || 2000);
  const protein  = Math.round(parseFloat(client.TargetProtein)  || 150);
  const carbs    = Math.round(parseFloat(client.TargetCarbs)    || 200);
  const fats     = Math.round(parseFloat(client.TargetFats)     || 60);

  const trend = calculateWeightTrend(weightEntries); // kg/week, null if insufficient data

  const isWeightLoss = /weight.?loss|fat.?loss|cut|deficit/i.test(goal);
  const isMuscleGain = /muscle|bulk|mass|strength/i.test(goal);
  const isGeneral    = /general|fitness|maintain/i.test(goal);

  // General fitness: review every 30 days, no adjustments
  if (isGeneral) {
    return { shouldAdjust: false, reason: 'General Fitness — maintaining current targets. Review in 30 days.' };
  }

  if (trend === null) {
    return { shouldAdjust: false, reason: 'Insufficient weight data to analyse trend (need ≥2 entries).' };
  }

  let newCalories = calories;
  let newProtein  = protein;
  let newCarbs    = carbs;
  let newFats     = fats;
  let reason      = '';
  let coachNote   = '';
  let shouldAdjust = false;

  const trendStr = `${trend >= 0 ? '+' : ''}${trend.toFixed(2)} kg/week`;
  const nutPct   = `${Math.round(nutritionCompliance * 100)}%`;
  const trainPct = `${Math.round(trainingCompliance * 100)}%`;

  if (isWeightLoss) {
    if (trend < -0.7) {
      // Too fast — risk of muscle loss
      newCalories  = calories + 100;
      newCarbs     = carbs + 10;
      reason       = `Weight dropping too quickly (${trendStr}). Increased calories by 100 kcal (+10g carbs) to preserve muscle mass.`;
      shouldAdjust = true;

    } else if (trend >= -0.3) {
      // Flat or gaining
      if (nutritionCompliance >= 0.8) {
        // Compliant — deficit isn't deep enough
        newCalories  = calories - 150;
        newCarbs     = carbs - 25;
        newFats      = fats - 6;
        reason       = `Weight stalled (${trendStr}) with ${nutPct} nutrition compliance. Reduced daily calories by 150 (−25g carbs, −6g fats). Protein unchanged.`;
        shouldAdjust = true;
      } else {
        // Non-compliant — don't punish further
        coachNote = `Weight not dropping (${trendStr}) but nutrition logging is inconsistent (${nutPct} compliance) — no calorie reduction made. Coach notified.`;
        reason    = coachNote;
      }

    } else {
      // Healthy rate (-0.3 to -0.7)
      reason = `Weight trending at ${trendStr} — healthy loss rate. No adjustment needed.`;
    }

    // Fat loss specific floors
    if (/fat.?loss|cut/i.test(goal) && shouldAdjust) {
      const minCals = Math.round(bodyWeight * 22);
      const minProt = Math.round(bodyWeight * 2.2);
      if (newCalories < minCals) {
        newCalories = minCals;
        reason += ` Calories floored at ${minCals} kcal (${bodyWeight} kg × 22).`;
      }
      if (newProtein < minProt) {
        newProtein = minProt;
        reason += ` Protein minimum held at ${minProt}g (${bodyWeight} kg × 2.2).`;
      }
    }

  } else if (isMuscleGain) {
    if (trend > 0.5) {
      // Gaining too fast — excess fat
      newCalories  = calories - 100;
      reason       = `Weight increasing too fast (${trendStr}). Reduced calories by 100 kcal to minimise fat gain.`;
      shouldAdjust = true;

    } else if (trend <= 0.05) {
      // Not gaining
      if (trainingCompliance >= 0.8) {
        newCalories  = calories + 150;
        newCarbs     = carbs + 30;
        reason       = `Weight not increasing (${trendStr}) with ${trainPct} training compliance. Added 150 kcal (+30g carbs) to support muscle growth.`;
        shouldAdjust = true;
      } else {
        reason = `Weight not increasing (${trendStr}) but training compliance is low (${trainPct}). No calorie increase — encourage consistent training first.`;
      }

    } else {
      reason = `Weight trending at ${trendStr} — healthy gain rate. No adjustment needed.`;
    }

  } else {
    // Unknown goal — no action
    return { shouldAdjust: false, reason: `Goal "${client.Goal}" — no auto-adjustment rule. Maintaining current targets.` };
  }

  return {
    shouldAdjust,
    newTargets: shouldAdjust ? {
      calories: Math.max(1200, Math.round(newCalories)),
      protein:  Math.max(50,   Math.round(newProtein)),
      carbs:    Math.max(50,   Math.round(newCarbs)),
      fats:     Math.max(25,   Math.round(newFats)),
    } : null,
    reason,
    coachNote,
    trend,
    nutritionCompliance,
    trainingCompliance,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────
/**
 * Run the full adjustment check for a client.
 *
 * @param {object} params
 *   client          — full client row from Clients sheet
 *   weightEntries   — all BodyMetrics rows
 *   nutritionLogs   — all NutritionLogs rows
 *   trainingLogs    — all WorkoutLogs rows
 *   macroAdjustments— all MacroAdjustments rows
 *   daysPerWeek     — from the client's program (default 3)
 *
 * @returns {Promise<{ checked, adjusted, reason, newTargets }>}
 */
export async function runMacroAdjustmentCheck({
  client,
  weightEntries   = [],
  nutritionLogs   = [],
  trainingLogs    = [],
  macroAdjustments = [],
  daysPerWeek     = 3,
}) {
  if (!client?.ClientID) return { checked: false, reason: 'No client data' };

  const cid  = client.ClientID;
  const goal = (client.Goal || '').toLowerCase();
  const interval = /general|fitness|maintain/i.test(goal)
    ? GENERAL_FITNESS_INTERVAL_DAYS
    : ADJUSTMENT_INTERVAL_DAYS;

  // ── Check for manual override pause ──────────────────────────────────────
  const pausedUntilStr = client.AutoAdjustPausedUntil || '';
  if (pausedUntilStr) {
    const pausedUntil = parseDate(pausedUntilStr);
    if (pausedUntil && pausedUntil >= new Date()) {
      return { checked: true, adjusted: false, reason: `Auto-adjustment paused until ${pausedUntilStr} (manual override active).` };
    }
  }

  // ── Determine last adjustment date ───────────────────────────────────────
  const clientAdjustments = macroAdjustments
    .filter(r => r.ClientID === cid)
    .sort((a, b) => (b.AdjustedAt || '').localeCompare(a.AdjustedAt || ''));
  const lastAdjustment = clientAdjustments[0] || null;
  const lastAdjDate    = lastAdjustment ? parseDate(lastAdjustment.AdjustedAt) : null;
  const referenceDate  = lastAdjDate || parseDate(client.StartDate) || parseDate(client.CreatedAt);

  if (!referenceDate) {
    return { checked: true, adjusted: false, reason: 'No reference date found (StartDate/CreatedAt missing).' };
  }

  const daysSince = daysBetween(referenceDate, new Date());
  if (daysSince < interval) {
    return { checked: true, adjusted: false, reason: `Only ${daysSince} days since last check (need ${interval}).` };
  }

  // ── Get weight entries for this client ───────────────────────────────────
  const clientWeights = weightEntries
    .filter(r => r.ClientID === cid)
    .sort((a, b) => (a.Date || '').localeCompare(b.Date || ''));

  // Use last 10 entries for analysis
  const recentWeights = clientWeights.slice(-10);

  // ── Compliance since last adjustment (or last interval) ──────────────────
  const sinceISO = referenceDate.toISOString().slice(0, 10);
  const nutCompliance   = calculateNutritionCompliance(nutritionLogs, cid, sinceISO);
  const trainCompliance = calculateTrainingCompliance(trainingLogs, cid, sinceISO, daysPerWeek);

  // ── Compute adjustment ───────────────────────────────────────────────────
  const result = computeAdjustment({
    client,
    weightEntries:    recentWeights,
    nutritionCompliance: nutCompliance,
    trainingCompliance:  trainCompliance,
  });

  if (!result.shouldAdjust) {
    return { checked: true, adjusted: false, reason: result.reason };
  }

  const { newTargets, reason, trend } = result;
  const today = todayISO();

  // ── Write to MacroAdjustments sheet ─────────────────────────────────────
  const adjustmentRow = {
    AdjustmentID:       generateId('adj'),
    ClientID:           cid,
    AdjustedAt:         today,
    Goal:               client.Goal,
    OldCalories:        client.TargetCalories || '',
    OldProtein:         client.TargetProtein  || '',
    OldCarbs:           client.TargetCarbs    || '',
    OldFats:            client.TargetFats     || '',
    NewCalories:        newTargets.calories,
    NewProtein:         newTargets.protein,
    NewCarbs:           newTargets.carbs,
    NewFats:            newTargets.fats,
    Reason:             reason,
    WeightTrendKgPerWeek: trend !== null ? trend.toFixed(3) : '',
    NutritionCompliance:  (nutCompliance * 100).toFixed(0) + '%',
    TrainingCompliance:   (trainCompliance * 100).toFixed(0) + '%',
  };

  try {
    await appendToSheet('MacroAdjustments', adjustmentRow);
  } catch (e) {
    console.warn('macroAdjustment: failed to log adjustment', e);
  }

  // ── Update Clients sheet via proxy ────────────────────────────────────────
  try {
    const url = config.APPS_SCRIPT_URL;
    if (url && !url.startsWith('YOUR_')) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:   'upsertRow',
          tab:      'Clients',
          idColumn: 'ClientID',
          id:       cid,
          row: {
            ...Object.fromEntries(
              Object.entries(client).map(([k, v]) => [k, v])
            ),
            TargetCalories: newTargets.calories,
            TargetProtein:  newTargets.protein,
            TargetCarbs:    newTargets.carbs,
            TargetFats:     newTargets.fats,
            LastMacroAdjustmentDate: today,
          },
        }),
      });
    }
  } catch (e) {
    console.warn('macroAdjustment: failed to update Clients sheet', e);
  }

  // ── Store notification for client UI ─────────────────────────────────────
  try {
    localStorage.setItem(NOTIFICATION_KEY(cid), JSON.stringify({
      reason,
      adjustedAt: today,
      old: {
        calories: parseInt(client.TargetCalories) || 0,
        protein:  parseInt(client.TargetProtein)  || 0,
        carbs:    parseInt(client.TargetCarbs)    || 0,
        fats:     parseInt(client.TargetFats)     || 0,
      },
      new: newTargets,
    }));
  } catch {}

  return {
    checked:    true,
    adjusted:   true,
    reason,
    newTargets,
    adjustmentRow,
  };
}

// ─── Notification helpers ─────────────────────────────────────────────────────
/** Returns parsed notification object or null. */
export function getMacroNotification(clientId) {
  try {
    const raw = localStorage.getItem(NOTIFICATION_KEY(clientId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Clears the pending notification. */
export function dismissMacroNotification(clientId) {
  try { localStorage.removeItem(NOTIFICATION_KEY(clientId)); } catch {}
}

/** Pause auto-adjustment for N days (called after manual override). */
export function setAutoAdjustPause(clientId, days = 10) {
  try {
    const until = new Date();
    until.setDate(until.getDate() + days);
    localStorage.setItem(PAUSE_KEY(clientId), until.toISOString().slice(0, 10));
  } catch {}
}
