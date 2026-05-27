/**
 * Calculate TDEE and starting macros using the Mifflin-St Jeor formula.
 *
 * When targetWeightKg + timeframeWeeks are supplied the calorie target is
 * derived from the required rate of weight change (7,700 kcal ≈ 1 kg of fat),
 * clamped to a safe range of ±1,000 kcal from TDEE.
 * Without them, a goal-based fixed offset is used as a sensible default.
 *
 * @param {object} stats
 * @param {number}           stats.weightKg           - Current body weight in kg
 * @param {number}           stats.heightCm           - Height in cm
 * @param {number}           stats.age                - Age in years
 * @param {'male'|'female'}  stats.gender
 * @param {number}           stats.trainingDaysPerWeek
 * @param {string}           stats.goal               - 'Weight Loss'|'Fat Loss'|'Muscle Gain'|'General Fitness'|'Strength'
 * @param {number}           [stats.targetWeightKg]   - Goal weight in kg (optional)
 * @param {number}           [stats.timeframeWeeks]   - Weeks to reach goal weight (optional)
 * @returns {{ tdee: number, calories: number, protein: number, carbs: number, fats: number, weeklyChange: number|null }}
 */
export function calculateMacros({ weightKg, heightCm, age, gender, trainingDaysPerWeek, goal, targetWeightKg, timeframeWeeks }) {
  const w    = Number(weightKg);
  const h    = Number(heightCm);
  const a    = Number(age);
  const days = Number(trainingDaysPerWeek);

  // 1. BMR — Mifflin-St Jeor
  const genderOffset = gender === 'female' ? -161 : 5;
  const bmr = 10 * w + 6.25 * h - 5 * a + genderOffset;

  // 2. Activity multiplier based on training days per week
  let activityFactor;
  if      (days <= 1) activityFactor = 1.375; // light
  else if (days <= 3) activityFactor = 1.55;  // moderate
  else if (days <= 5) activityFactor = 1.725; // active
  else                activityFactor = 1.9;   // very active

  const tdee = Math.round(bmr * activityFactor);

  // 3. Calorie target
  let calories;
  let weeklyChange = null; // kg/week implied by this deficit/surplus

  const tw = Number(targetWeightKg);
  const tf = Number(timeframeWeeks);

  if (targetWeightKg && tw > 0 && timeframeWeeks && tf > 0) {
    // Precise calculation from target weight + timeframe
    const totalWeightChange  = tw - w;                              // negative = lose, positive = gain
    const dailyCalAdjustment = (totalWeightChange * 7700) / (tf * 7); // kcal/day above or below TDEE
    const rawCalories        = tdee + dailyCalAdjustment;

    // Safety clamp: max 1,000 kcal deficit / 800 kcal surplus 