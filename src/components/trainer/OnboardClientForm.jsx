import { useState, useEffect, useCallback } from 'react';
import { appendToSheet } from '../../utils/sheets';
import { calculateMacros } from '../../utils/macros';

// ─── SHA-256 helper (same as AuthContext) ────────────────────────────────────
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(password);
  const buf      = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const GOALS      = ['Weight Loss', 'Fat Loss', 'Muscle Gain', 'General Fitness', 'Strength'];
const EQUIPMENT  = ['Full Gym', 'Home Gym', 'Minimal', 'Bodyweight Only'];
const DAYS       = [1,2,3,4,5,6,7];
const GENDERS    = ['Male', 'Female'];

const EMPTY = {
  name: '', email: '', password: '',
  gender: 'Male', age: '', goal: 'General Fitness',
  startDate: new Date().toISOString().slice(0,10),
  currentWeight: '', targetWeight: '', height: '',
  goalTimeframe: '', // weeks to reach target weight
  trainingDaysPerWeek: '3', equipment: [],
  injuries: '', notes: '', programId: '',
};

function MacroPreview({ macros }) {
  if (!macros) return null;
  return (
    <div style={{
      background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)',
      borderRadius: '10px', padding: '14px 16px', marginTop: '8px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
        Calculated Starting Macros
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' }}>
        {[
          { label: 'Calories', value: macros.calories, unit: 'kcal', color: '#f97316' },
          { label: 'Protein',  value: macros.protein,  unit: 'g',    color: '#4ade80' },
          { label: 'Carbs',    value: macros.carbs,    unit: 'g',    color: '#60a5fa' },
          { label: 'Fats',     value: macros.fats,     unit: 'g',    color: '#fbbf24' },
        ].map(({ label, value, unit, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: '700', color }}>{value}</div>
            <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{unit}</div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>
        TDEE: {macros.tdee} kcal/day (maintenance)
        {macros.weeklyChange !== null && macros.weeklyChange !== undefined && (
          <span style={{ marginLeft: '8px', color: macros.weeklyChange < 0 ? '#4ade80' : '#f97316' }}>
            · {macros.weeklyChange > 0 ? '+' : ''}{macros.weeklyChange} kg/week
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Field helpers ───────────────────────────────────────────────────────────

function FieldLabel({ children, required }) {
  return (
    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {children}{required && <span style={{ color: '#ef4444', marginLeft: '3px' }}>*</span>}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = 'text', required }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%', padding: '9px 12px', boxSizing: 'border-box',
        background: '#0f172a', border: `1px solid ${focused ? '#f97316' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '8px', color: '#f1f5f9', fontSize: '13.5px',
        outline: 'none', transition: 'border-color 0.15s',
      }}
    />
  );
}

function Select({ value, onChange, children }) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={value}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%', padding: '9px 12px', boxSizing: 'border-box',
        background: '#0f172a', border: `1px solid ${focused ? '#f97316' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '8px', color: '#f1f5f9', fontSize: '13.5px',
        outline: 'none', transition: 'border-color 0.15s', cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: '10.5px', fontWeight: '700', color: '#f97316',
      textTransform: 'uppercase', letterSpacing: '1px',
      borderBottom: '1px solid rgba(249,115,22,0.15)',
      paddingBottom: '6px', marginBottom: '14px', marginTop: '20px',
    }}>
      {children}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export default function OnboardClientForm({ programs = [], onClose, onSuccess }) {
  const [form,     setForm]     = useState(EMPTY);
  const [macros,   setMacros]   = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState(null);
  const [showPw,   setShowPw]   = useState(false);
  const [visible,  setVisible]  = useState(false);

  // Slide-in animation
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 280);
  }, [onClose]);

  // ESC to close
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close]);

  // Recalculate macros when physical stats or goal change
  useEffect(() => {
    const { currentWeight, height, age, gender, trainingDaysPerWeek, goal, targetWeight, goalTimeframe } = form;
    if (currentWeight && height && age && gender) {
      try {
        const result = calculateMacros({
          weightKg:            Number(currentWeight),
          heightCm:            Number(height),
          age:                 Number(age),
          gender:              gender.toLowerCase(),
          trainingDaysPerWeek: Number(trainingDaysPerWeek),
          goal,
          targetWeightKg:      targetWeight  ? Number(targetWeight)  : null,
          timeframeWeeks:      goalTimeframe ? Number(goalTimeframe) : null,
        });
        setMacros(result);
      } catch {
        setMacros(null);
      }
    } else {
      setMacros(null);
    }
  }, [form.currentWeight, form.height, form.age, form.gender, form.trainingDaysPerWeek, form.goal, form.targetWeight, form.goalTimeframe]);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleEquipment(item) {
    setForm(prev => ({
      ...prev,
      equipment: prev.equipment.includes(item)
        ? prev.equipment.filter(e => e !== item)
        : [...prev.equipment, item],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // Basic validation
    if (!form.name.trim())        return setError('Name is required.');
    if (!form.email.trim())       return setError('Email is required.');
    if (!form.password.trim())    return setError('Password is required.');
    if (form.password.length < 6) return setError('Password must be at least 6 characters.');

    setSaving(true);
    try {
      const passwordHash = await hashPassword(form.password);
      const clientId     = `CLI_${Date.now()}`;

      const row = {
        ClientID:            clientId,
        Name:                form.name.trim(),
        Email:               form.email.trim().toLowerCase(),
        PasswordHash:        passwordHash,
        Status:              'Active',
        Goal:                form.goal,
        StartDate:           form.startDate,
        CurrentWeight:       form.currentWeight,
        TargetWeight:        form.targetWeight,
        Height:              form.height,
        Age:                 form.age,
        Gender:              form.gender,
        TrainingDaysPerWeek: form.trainingDaysPerWeek,
        Equipment:           form.equipment.join(', '),
        Injuries:            form.injuries.trim(),
        Notes:               form.notes.trim(),
        ProgramID:           form.programId,
        GoalTimeframe:       form.goalTimeframe,
        DailyCalories:       macros?.calories ?? '',
        ProteinTarget:       macros?.protein  ?? '',
        CarbTarget:          macros?.carbs    ?? '',
        FatTarget:           macros?.fats     ?? '',
      };

      await appendToSheet('Clients', row);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: visible ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(4px)' : 'none',
        transition: 'background 0.28s, backdrop-filter 0.28s',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          width: '480px', maxWidth: '100vw', height: '100vh',
          background: '#111827',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.16,1,0.3,1)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#f8fafc' }}>Onboard New Client</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Fill in their details to create an account</div>
          </div>
          <button
            onClick={close}
            style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)', border: 'none',
              color: '#94a3b8', cursor: 'pointer', fontSize: '18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#ef4444'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          <SectionHeader>Personal Details</SectionHeader>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <FieldLabel required>Full Name</FieldLabel>
              <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" required />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <FieldLabel required>Email</FieldLabel>
              <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@email.com" required />
            </div>
            <div>
              <FieldLabel required>Password (you set this)</FieldLabel>
              <div style={{ position: 'relative' }}>
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px',
                  }}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <FieldLabel>Gender</FieldLabel>
              <Select value={form.gender} onChange={e => set('gender', e.target.value)}>
                {GENDERS.map(g => <option key={g}>{g}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required>Age</FieldLabel>
              <Input type="number" value={form.age} onChange={e => set('age', e.target.value)} placeholder="28" required />
            </div>
            <div>
              <FieldLabel required>Start Date</FieldLabel>
              <Input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} required />
            </div>
          </div>

          <SectionHeader>Physical Stats</SectionHeader>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <FieldLabel required>Current Weight (kg)</FieldLabel>
              <Input type="number" value={form.currentWeight} onChange={e => set('currentWeight', e.target.value)} placeholder="82" required />
            </div>
            <div>
              <FieldLabel required>Target Weight (kg)</FieldLabel>
              <Input type="number" value={form.targetWeight} onChange={e => set('targetWeight', e.target.value)} placeholder="75" required />
            </div>
            <div>
              <FieldLabel required>Height (cm)</FieldLabel>
              <Input type="number" value={form.height} onChange={e => set('height', e.target.value)} placeholder="175" required />
            </div>
            <div>
              <FieldLabel>Goal Timeframe (weeks)</FieldLabel>
              <Input type="number" value={form.goalTimeframe} onChange={e => set('goalTimeframe', e.target.value)} placeholder="12" />
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#475569', marginBottom: '12px', marginTop: '-6px' }}>
            Enter goal timeframe to auto-calculate a personalised calorie target based on the required rate of weight change.
          </div>

          <SectionHeader>Training</SectionHeader>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <FieldLabel required>Goal</FieldLabel>
              <Select value={form.goal} onChange={e => set('goal', e.target.value)}>
                {GOALS.map(g => <option key={g}>{g}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required>Training Days / Week</FieldLabel>
              <Select value={form.trainingDaysPerWeek} onChange={e => set('trainingDaysPerWeek', e.target.value)}>
                {DAYS.map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
              </Select>
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <FieldLabel>Equipment Access</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {EQUIPMENT.map(item => {
                const checked = form.equipment.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleEquipment(item)}
                    style={{
                      padding: '6px 14px', borderRadius: '99px', fontSize: '12.5px', fontWeight: '500',
                      cursor: 'pointer', transition: 'all 0.12s',
                      background: checked ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${checked ? '#f97316' : 'rgba(255,255,255,0.1)'}`,
                      color: checked ? '#f97316' : '#94a3b8',
                    }}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>

          {programs.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <FieldLabel>Assign Program</FieldLabel>
              <Select value={form.programId} onChange={e => set('programId', e.target.value)}>
                <option value="">— None for now —</option>
                {programs.map(p => (
                  <option key={p.ProgramID} value={p.ProgramID}>{p.Name}</option>
                ))}
              </Select>
            </div>
          )}

          <SectionHeader>Health Notes</SectionHeader>

          <div style={{ marginBottom: '12px' }}>
            <FieldLabel>Injuries / Limitations</FieldLabel>
            <textarea
              value={form.injuries}
              onChange={e => set('injuries', e.target.value)}
              placeholder="e.g. Left knee tendinitis, lower back sensitivity..."
              rows={2}
              style={{
                width: '100%', padding: '9px 12px', boxSizing: 'border-box',
                background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#f1f5f9', fontSize: '13.5px',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = '#f97316'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any other notes about this client..."
              rows={2}
              style={{
                width: '100%', padding: '9px 12px', boxSizing: 'border-box',
                background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#f1f5f9', fontSize: '13.5px',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = '#f97316'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            />
          </div>

          {/* Macro preview */}
          <MacroPreview macros={macros} />

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '14px', padding: '10px 14px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', color: '#fca5a5', fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          {/* Extra bottom padding so last field isn't hidden behind footer */}
          <div style={{ height: '20px' }} />
        </form>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', gap: '10px', flexShrink: 0,
          background: '#111827',
        }}>
          <button
            type="button"
            onClick={close}
            style={{
              flex: 1, padding: '10px', borderRadius: '9px',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', fontSize: '13.5px', fontWeight: '500',
              cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#e2e8f0'; }}
        