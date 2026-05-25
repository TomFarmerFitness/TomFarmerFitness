/**
 * Calculate TDEE and starting macros using the Mifflin-St Jeor formula.
 *
 * @param {object} stats
 * @param {number}           stats.weightKg           - Current body weight in kg
 * @param {number}           stats.heightCm           - Height in cm
 * @param {number}           stats.age                - Age in years
 * @param {'male'|'female'}  stats.gender
 * @param {number}           stats.trainingDaysPerWeek
 * @param {string}           stats.goal               - 'Weight Loss'|'Fat Loss'|'Muscle Gain'|'General Fitness'|'Strength'
 * @returns {{ tdee: number, calories: number, protein: number, carbs: number, fats: number }}
 */
export function calculateMacros({ weightKg, heightCm, age, gender, trainingDaysPerWeek, goal }) {
  const w = Number(weightKg);
  const h = Number(heightCm);
  const a = Number(age);
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

  // 3. Calorie target by goal
  let calories;
  switch (goal) {
    case 'Weight Loss':    calories = tdee - 500; break;
    case 'Fat Loss':       calories = tdee - 400; break;
    case 'Muscle Gain':    calories = tdee + 300; break;
    case 'Strength':       calories = tdee + 200; break;
    default:               calories = tdee;        // General Fitness
  }
  calories = Math.max(Math.round(calories), 1200); // safety floor

  // 4. Macros
  // Protein: higher for hypertrophy/strength goals
  const proteinPerKg = (goal === 'Muscle Gain' || goal === 'Strength') ? 2.2 : 2.0;
  const protein = Math.round(proteinPerKg * w);
  const fats    = Math.round((calories * 0.28) / 9);
  const carbs   = Math.max(Math.round((calories - protein * 4 - fats * 9) / 4), 0);

  return { tdee, calories, protein, carbs, fats };
}

/**
 * Activity factor labels for display purposes.
 */
export function activityLabel(trainingDaysPerWeek) {
  const days = Number(trainingDaysPerWeek);
  if (days <= 1) return 'Light (1 day/wk)';
  if (days <= 3) return 'Moderate (2–3 days/wk)';
  if (days <= 5) return 'Active (4–5 days/wk)';
  return 'Very Active (6–7 days/wk)';
}
