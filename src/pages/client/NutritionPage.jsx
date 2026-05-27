import { useState, useEffect, useRef, useCallback } from 'react';
import { readSheet, appendToSheet, lookupFood } from '../../utils/sheets';
import { useAuth } from '../../context/AuthContext';

// ─── Utilities ────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (isoDate === todayISO()) return 'Today';
  if (isoDate === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  if (isoDate === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getLast7Days(anchorDate) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    days.push(addDays(anchorDate, -i));
  }
  return days;
}

// Parse a NutritionLogs row — handles both old format (MealName = food name) and new format
function parseNutritionRow(row) {
  return {
    logId:      row.LogID        || '',
    clientId:   row.ClientID     || '',
    date:       row.Date         || '',
    mealType:   row.MealType     || row.MealName || 'Snacks',
    foodName:   row.FoodName     || row.MealName || '',
    servingG:   parseFloat(row.ServingG)  || 100,
    calories:   parseFloat(row.Calories)  || 0,
    protein:    parseFloat(row.Protein)   || 0,
    carbs:      parseFloat(row.Carbs)     || 0,
    fats:       parseFloat(row.Fats)      || 0,
    fibre:      parseFloat(row.Fibre)     || 0,
    loggedAt:   row.LoggedAt     || '',
  };
}

const MEAL_TYPES = [
  { key: 'Breakfast', label: 'Breakfast', emoji: '☀️' },
  { key: 'Lunch',     label: 'Lunch',     emoji: '🌤️' },
  { key: 'Dinner',    label: 'Dinner',    emoji: '🌙' },
  { key: 'Snacks',    label: 'Snacks',    emoji: '🍎' },
];

// ─── DateSelector ────────────────────────────────────────────────────────────

function DateSelector({ date, onChange }) {
  const inputRef = useRef(null);

  function handlePrev() { onChange(addDays(date, -1)); }
  function handleNext() { onChange(addDays(date,  1)); }

  function handleDateClick() {
    if (inputRef.current) inputRef.current.showPicker?.();
    else inputRef.current?.click();
  }

  const isToday = date === todayISO();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px 6px',
      position: 'relative',
    }}>
      <button onClick={handlePrev} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-secondary)', fontSize: 20, padding: '4px 8px',
        borderRadius: 8, lineHeight: 1,
      }}>‹</button>

      <div onClick={handleDateClick} style={{
        flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative',
      }}>
        <div style={{
          fontSize: 17, fontWeight: 600,
          color: 'var(--text-primary)',
        }}>{formatDisplayDate(date)}</div>
        {!isToday && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{date}</div>
        )}
        {/* Hidden date input for native calendar picker */}
        <input
          ref={inputRef}
          type="date"
          value={date}
          max={todayISO()}
          onChange={e => e.target.value && onChange(e.target.value)}
          style={{
            position: 'absolute', opacity: 0, width: 0, height: 0,
            top: 0, left: '50%', pointerEvents: 'none',
          }}
        />
      </div>

      <button onClick={handleNext} disabled={isToday} style={{
        background: 'none', border: 'none', cursor: isToday ? 'default' : 'pointer',
        color: isToday ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        fontSize: 20, padding: '4px 8px', borderRadius: 8, lineHeight: 1,
        opacity: isToday ? 0.3 : 1,
      }}>›</button>
    </div>
  );
}

// ─── CalorieRing ─────────────────────────────────────────────────────────────

function CalorieRing({ consumed, target }) {
  const size = 180;
  const stroke = 13;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0;
  const offset = circ * (1 - pct);

  const remaining = target - consumed;
  const overBy    = consumed - target;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0 8px' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="var(--surface-secondary, #2a2a2a)"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={consumed > target ? '#ef4444' : '#22c55e'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.3s' }}
          />
        </svg>
        {/* Centre text */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
            {consumed.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            of {target.toLocaleString()} kcal
          </div>
        </div>
      </div>

      {/* Remaining / over */}
      <div style={{
        marginTop: 4, fontSize: 13, fontWeight: 500,
        color: consumed > target ? '#ef4444' : 'var(--text-secondary)',
      }}>
        {consumed > target
          ? `${overBy.toLocaleString()} kcal over`
          : `${remaining.toLocaleString()} kcal remaining`}
      </div>
    </div>
  );
}

// ─── MacroBar ────────────────────────────────────────────────────────────────

function MacroBar({ label, consumed, target, color }) {
  const pct = target > 0 ? Math.min((consumed / target) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          {Math.round(consumed)}g
          <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> / {Math.round(target)}g</span>
        </span>
      </div>
      <div style={{
        height: 6, borderRadius: 3,
        background: 'var(--surface-secondary, #2a2a2a)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: `${pct}%`,
          background: color,
          transition: 'width 0.7s ease',
        }} />
      </div>
    </div>
  );
}

// ─── RemainingMacros ─────────────────────────────────────────────────────────

function RemainingMacros({ protein, carbs, fats, targetProtein, targetCarbs, targetFats }) {
  const remP = Math.max(0, Math.round(targetProtein - protein));
  const remC = Math.max(0, Math.round(targetCarbs   - carbs));
  const remF = Math.max(0, Math.round(targetFats    - fats));

  return (
    <div style={{
      background: 'var(--surface-secondary, #1a1a1a)',
      borderRadius: 10, padding: '10px 14px', margin: '0 16px 12px',
      fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6,
    }}>
      {remP === 0 && remC === 0 && remF === 0
        ? 'All macros hit for today 🎯'
        : `You have ${remP}g protein, ${remC}g carbs, ${remF}g fats remaining`}
    </div>
  );
}

// ─── FoodItem ─────────────────────────────────────────────────────────────────

function FoodItem({ item, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid var(--border, #2a2a2a)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {item.foodName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {item.servingG}g · {Math.round(item.protein)}p · {Math.round(item.carbs)}c · {Math.round(item.fats)}f
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {Math.round(item.calories)}
        </span>
        {onDelete && (
          <button onClick={() => onDelete(item.logId)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', fontSize: 16, padding: 4, lineHeight: 1,
          }}>×</button>
        )}
      </div>
    </div>
  );
}

// ─── MealSection ─────────────────────────────────────────────────────────────

function MealSection({ mealType, items, onAddFood, onDeleteItem }) {
  const [collapsed, setCollapsed] = useState(false);

  const totalCals = items.reduce((s, i) => s + (parseFloat(i.calories) || 0), 0);

  return (
    <div style={{
      background: 'var(--surface, #111)',
      borderRadius: 14,
      margin: '0 16px 10px',
      overflow: 'hidden',
      border: '1px solid var(--border, #2a2a2a)',
    }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{mealType.emoji}</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            {mealType.label}
          </span>
          {items.length > 0 && (
            <span style={{
              fontSize: 12, color: 'var(--text-tertiary)',
              background: 'var(--surface-secondary, #1a1a1a)',
              borderRadius: 10, padding: '2px 7px',
            }}>
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {totalCals > 0 && (
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {Math.round(totalCals)} kcal
            </span>
          )}
          <span style={{
            fontSize: 11, color: 'var(--text-tertiary)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            display: 'inline-block',
          }}>▾</span>
        </div>
      </button>

      {!collapsed && (
        <div style={{ padding: '0 14px' }}>
          {items.map(item => (
            <FoodItem key={item.logId} item={item} onDelete={onDeleteItem} />
          ))}

          {/* ADD FOOD button */}
          <button
            onClick={() => onAddFood(mealType.key)}
            style={{
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              color: '#22c55e', fontSize: 14, fontWeight: 500,
              padding: '10px 0', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
            Add food
          </button>
        </div>
      )}
    </div>
  );
}


// ─── BarcodeScanner ──────────────────────────────────────────────────────────

function BarcodeScanner({ onResult, onClose }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [status,  setStatus]  = useState('starting'); // 'starting'|'scanning'|'found'|'error'
  const [message, setMessage] = useState('Starting camera…');

  useEffect(() => {
    let active    = true;
    let detector  = null;
    let intervalId = null;

    async function lookupBarcode(barcode) {
      setStatus('found');
      setMessage('Looking up product…');
      try {
        const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
        const data = await res.json();

        if (!data || data.status === 0 || !data.product) {
          setStatus('error');
          setMessage('Product not found. Try another barcode or use manual entry.');
          return;
        }

        const p = data.product;
        const n = p.nutriments || {};

        // Prefer serving size if available, otherwise per-100g
        const rawServing = parseFloat(p.serving_quantity) || 0;
        const servingSize = rawServing > 0 ? rawServing : 100;
        const scale = servingSize / 100;

        const food = {
          foodName:    p.product_name_en || p.product_name || p.abbreviated_product_name || 'Unknown Product',
          servingSize,
          calories: Math.round((parseFloat(n['energy-kcal_100g'] || n['energy-kcal'] || 0)) * scale),
          protein:  Math.round((parseFloat(n['proteins_100g']    || n['proteins']    || 0)) * scale * 10) / 10,
          carbs:    Math.round((parseFloat(n['carbohydrates_100g'] || n['carbohydrates'] || 0)) * scale * 10) / 10,
          fats:     Math.round((parseFloat(n['fat_100g']         || n['fat']         || 0)) * scale * 10) / 10,
          fibre:    Math.round((parseFloat(n['fiber_100g'] || n['fibers_100g'] || n['fiber'] || 0)) * scale * 10) / 10,
        };

        onResult(food);
      } catch {
        setStatus('error');
        setMessage('Failed to fetch product data. Check your connection.');
      }
    }

    async function start() {
      try {
        if (!('BarcodeDetector' in window)) {
          setStatus('error');
          setMessage('Barcode scanning requires Chrome 83+ or Safari 17+. Please update your browser or use manual entry.');
          return;
        }

        detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
        });

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setStatus('scanning');
        setMessage('Align barcode in the frame');

        intervalId = setInterval(async () => {
          if (!active || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              clearInterval(intervalId);
              const barcode = barcodes[0].rawValue;
              await lookupBarcode(barcode);
            }
          } catch { /* detection error — continue scanning */ }
        }, 400);

      } catch (err) {
        if (!active) return;
        if (err.name === 'NotAllowedError') {
          setStatus('error');
          setMessage('Camera access denied. Please allow camera access in your browser settings.');
        } else if (err.name === 'NotFoundError') {
          setStatus('error');
          setMessage('No camera found on this device.');
        } else {
          setStatus('error');
          setMessage('Could not start camera: ' + err.message);
        }
      }
    }

    start();

    return () => {
      active = false;
      clearInterval(intervalId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [onResult]);

  const isScanning = status === 'scanning';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: '#000',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 20, right: 20,
          width: 44, height: 44, borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)', border: 'none',
          color: '#fff', fontSize: 22, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, marginBottom: 20, textAlign: 'center', padding: '0 24px' }}>
        {status === 'found' ? '✓ Barcode found' : 'Scan Barcode'}
      </div>

      {/* Viewfinder */}
      <div style={{
        position: 'relative',
        width: Math.min(window.innerWidth - 48, 300),
        height: Math.min(window.innerWidth - 48, 300),
        borderRadius: 20, overflow: 'hidden',
        border: `2px solid ${status === 'error' ? '#ef4444' : status === 'found' ? '#22c55e' : '#22c55e'}`,
        background: '#111',
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* Corner guides */}
        {['top-left','top-right','bottom-left','bottom-right'].map(corner => {
          const [v, h] = corner.split('-');
          return (
            <div key={corner} style={{
              position: 'absolute',
              [v]: -2, [h]: -2,
              width: 24, height: 24,
              borderTop:    v === 'top'    ? '4px solid #22c55e' : 'none',
              borderBottom: v === 'bottom' ? '4px solid #22c55e' : 'none',
              borderLeft:   h === 'left'   ? '4px solid #22c55e' : 'none',
              borderRight:  h === 'right'  ? '4px solid #22c55e' : 'none',
              borderRadius: corner === 'top-left' ? '4px 0 0 0' : corner === 'top-right' ? '0 4px 0 0' : corner === 'bottom-left' ? '0 0 0 4px' : '0 0 4px 0',
            }} />
          );
        })}
        {/* Scanning animation */}
        {isScanning && (
          <div style={{
            position: 'absolute', left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, #22c55e, transparent)',
            animation: 'scanLine 2s ease-in-out infinite',
          }} />
        )}
      </div>

      <div style={{
        marginTop: 20, fontSize: 14,
        color: status === 'error' ? '#fca5a5' : '#94a3b8',
        textAlign: 'center', maxWidth: 280, padding: '0 16px',
      }}>
        {message}
      </div>

      {status === 'error' && (
        <button
          onClick={onClose}
          style={{
            marginTop: 20, padding: '12px 24px',
            background: '#22c55e', border: 'none', borderRadius: 10,
            color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Use Manual Entry
        </button>
      )}

      <style>{`
        @keyframes scanLine {
          0%   { top: 10%; }
          50%  { top: 85%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  );
}

// ─── AddFoodModal ────────────────────────────────────────────────────────────
// Three-step flow: search → results → quantity+meal

const COMMON_PORTIONS = [
  { label: '1 serve', grams: null },   // use servingSize from food data
  { label: '100g',    grams: 100 },
  { label: '150g',    grams: 150 },
  { label: '200g',    grams: 200 },
  { label: '250g',    grams: 250 },
];

function scaleNutrition(food, grams) {
  const base = food.servingSize || 100;
  const ratio = grams / base;
  return {
    calories: Math.round(food.calories * ratio),
    protein:  Math.round(food.protein  * ratio * 10) / 10,
    carbs:    Math.round(food.carbs    * ratio * 10) / 10,
    fats:     Math.round(food.fats     * ratio * 10) / 10,
    fibre:    Math.round((food.fibre || 0) * ratio * 10) / 10,
  };
}

function AddFoodModal({ initialMealType, clientTargets, onSave, onClose }) {
  const overlayRef = useRef(null);
  const sheetRef   = useRef(null);

  // Steps: 'search' | 'results' | 'quantity'
  const [step,        setStep]        = useState('search');
  const [query,       setQuery]       = useState('');
  const [searching,   setSearching]   = useState(false);
  const [results,     setResults]     = useState([]);
  const [searchError, setSearchError] = useState('');
  const [selected,    setSelected]    = useState(null);
  const [servingG,    setServingG]    = useState(100);
  const [mealType,    setMealType]    = useState(initialMealType || 'Breakfast');

  // Barcode scanner
  const [showScanner, setShowScanner] = useState(false);

  // Manual entry fallback
  const [manualMode,  setManualMode]  = useState(false);
  const [manualFood,  setManualFood]  = useState({ name: '', calories: '', protein: '', carbs: '', fats: '' });

  // Slide-in animation
  useEffect(() => {
    const overlay = overlayRef.current;
    const sheet   = sheetRef.current;
    if (!overlay || !sheet) return;
    overlay.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.25s';
      sheet.style.transition   = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
      overlay.style.opacity    = '1';
      sheet.style.transform    = 'translateY(0)';
    }));
  }, []);

  function closeWithAnimation(cb) {
    const overlay = overlayRef.current;
    const sheet   = sheetRef.current;
    if (overlay) { overlay.style.transition = 'opacity 0.2s'; overlay.style.opacity = '0'; }
    if (sheet)   { sheet.style.transition   = 'transform 0.25s'; sheet.style.transform = 'translateY(100%)'; }
    setTimeout(cb, 250);
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const res = await lookupFood(query.trim());
      setResults(res);
      setStep('results');
    } catch (e) {
      if (e.message === 'apps_script_not_configured') {
        setSearchError('Food lookup not configured yet — use manual entry below.');
      } else {
        setSearchError('Could not look up food. Try manual entry.');
      }
    } finally {
      setSearching(false);
    }
  }

  function handleSelectFood(food) {
    setSelected(food);
    setServingG(food.servingSize || 100);
    setStep('quantity');
  }

  function handleBarcodeResult(food) {
    setShowScanner(false);
    handleSelectFood(food);
  }

  function handleSave() {
    if (!selected) return;
    const scaled = scaleNutrition(selected, servingG);
    onSave({
      foodName: selected.foodName,
      mealType,
      servingG,
      ...scaled,
    });
    closeWithAnimation(onClose);
  }

  function handleManualSave() {
    if (!manualFood.name || !manualFood.calories) return;
    onSave({
      foodName: manualFood.name,
      mealType,
      servingG:  100,
      calories:  parseFloat(manualFood.calories) || 0,
      protein:   parseFloat(manualFood.protein)  || 0,
      carbs:     parseFloat(manualFood.carbs)    || 0,
      fats:      parseFloat(manualFood.fats)     || 0,
      fibre:     0,
    });
    closeWithAnimation(onClose);
  }

  const scaled = selected ? scaleNutrition(selected, servingG) : null;

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-secondary, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    borderRadius: 10, padding: '12px 14px',
    color: 'var(--text-primary)', fontSize: 15, outline: 'none',
  };

  const btnPrimary = {
    width: '100%', padding: '14px', borderRadius: 12, border: 'none',
    background: '#22c55e', color: '#000', fontSize: 15, fontWeight: 700,
    cursor: 'pointer',
  };

  return (
    <>
      {showScanner && (
        <BarcodeScanner
          onResult={handleBarcodeResult}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div
        ref={overlayRef}
        onClick={e => { if (e.target === overlayRef.current) closeWithAnimation(onClose); }}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
      >
        <div
          ref={sheetRef}
          style={{
            width: '100%', maxWidth: 430,
            background: 'var(--surface, #111)',
            borderRadius: '20px 20px 0 0',
            padding: '0 0 calc(16px + env(safe-area-inset-bottom))',
            maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Handle bar */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border, #333)' }} />
          </div>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px 8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {step !== 'search' && !manualMode && (
                <button
                  onClick={() => setStep(step === 'quantity' ? 'results' : 'search')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 20, padding: 0 }}
                >←</button>
              )}
              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
                {manualMode ? 'Manual Entry' : step === 'search' ? 'Add Food' : step === 'results' ? `Results for "${query}"` : selected?.foodName}
              </span>
            </div>
            <button
              onClick={() => closeWithAnimation(onClose)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 22, padding: 4 }}
            >×</button>
          </div>

          <div style={{ padding: '8px 16px 16px', flex: 1 }}>

            {/* ── Meal type selector (always visible) ── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {MEAL_TYPES.map(mt => (
                <button
                  key={mt.key}
                  onClick={() => setMealType(mt.key)}
                  style={{
                    flex: 1, minWidth: 60,
                    padding: '7px 4px', borderRadius: 10, border: 'none',
                    cursor: 'pointer', fontSize: 13, fontWeight: 500,
                    background: mealType === mt.key ? '#22c55e' : 'var(--surface-secondary, #1a1a1a)',
                    color: mealType === mt.key ? '#000' : 'var(--text-secondary)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {mt.emoji} {mt.label}
                </button>
              ))}
            </div>

            {/* ── MANUAL MODE ── */}
            {manualMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input style={inputStyle} placeholder="Food name *" value={manualFood.name}
                  onChange={e => setManualFood(f => ({ ...f, name: e.target.value }))} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[['Calories (kcal)*','calories'],['Protein (g)','protein'],['Carbs (g)','carbs'],['Fats (g)','fats']].map(([ph, k]) => (
                    <input key={k} type="number" min="0" style={inputStyle} placeholder={ph}
                      value={manualFood[k]}
                      onChange={e => setManualFood(f => ({ ...f, [k]: e.target.value }))} />
                  ))}
                </div>
                <button
                  onClick={handleManualSave}
                  disabled={!manualFood.name || !manualFood.calories}
                  style={{ ...btnPrimary, opacity: (!manualFood.name || !manualFood.calories) ? 0.4 : 1 }}
                >
                  Add to {mealType}
                </button>
                <button onClick={() => setManualMode(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, padding: '8px 0' }}>
                  ← Back to search
                </button>
              </div>
            ) : step === 'search' ? (
              /* ── SEARCH STEP ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="e.g. chicken breast, banana, oats…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                  <button
                    onClick={handleSearch}
                    disabled={!query.trim() || searching}
                    style={{
                      background: '#22c55e', border: 'none', borderRadius: 10,
                      padding: '0 16px', cursor: 'pointer',
                      color: '#000', fontWeight: 700, fontSize: 14,
                      opacity: (!query.trim() || searching) ? 0.5 : 1,
                    }}
                  >
                    {searching ? '…' : 'Search'}
                  </button>
                </div>

                {/* Barcode scan button */}
                <button
                  onClick={() => setShowScanner(true)}
                  style={{
                    width: '100%', padding: '13px',
                    background: 'var(--surface-secondary, #1a1a1a)',
                    border: '1px solid var(--border, #333)',
                    borderRadius: 10, cursor: 'pointer',
                    color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                    <rect x="7" y="7" width="3" height="10" rx="1"/><rect x="14" y="7" width="3" height="10" rx="1"/>
                  </svg>
                  Scan Barcode
                </button>

                {searchError && (
                  <div style={{
                    background: '#1a1a1a', border: '1px solid #333', borderRadius: 10,
                    padding: '10px 12px', fontSize: 13, color: '#fbbf24',
                  }}>
                    {searchError}
                  </div>
                )}

                <button onClick={() => setManualMode(true)} style={{
                  background: 'none', border: '1px dashed var(--border, #333)',
                  borderRadius: 10, padding: '12px', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 14,
                }}>
                  Enter macros manually instead
                </button>
              </div>
            ) : step === 'results' ? (
              /* ── RESULTS STEP ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {results.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
                    No results found. <button onClick={() => setManualMode(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#22c55e', fontSize: 14 }}>Enter manually?</button>
                  </div>
                ) : results.map((food, i) => (
                  <button key={i} onClick={() => handleSelectFood(food)} style={{
                    background: 'var(--surface-secondary, #1a1a1a)',
                    border: '1px solid var(--border, #2a2a2a)',
                    borderRadius: 12, padding: '12px 14px',
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 3 }}>{food.foodName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        per {food.servingSize || 100}g · {Math.round(food.protein)}p · {Math.round(food.carbs)}c · {Math.round(food.fats)}f
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginLeft: 10 }}>
                      {Math.round(food.calories)}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}> kcal</span>
                    </div>
                  </button>
                ))}
                <button onClick={() => setManualMode(true)} style={{
                  background: 'none', border: '1px dashed var(--border, #333)',
                  borderRadius: 10, padding: '11px', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 13, marginTop: 4,
                }}>
                  Not what I was looking for — enter manually
                </button>
              </div>
            ) : (
              /* ── QUANTITY STEP ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Portion quick-picks */}
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Serving size</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {COMMON_PORTIONS.map(p => {
                      const g = p.grams ?? (selected?.servingSize || 100);
                      return (
                        <button key={p.label} onClick={() => setServingG(g)} style={{
                          padding: '7px 12px', borderRadius: 10, border: 'none',
                          cursor: 'pointer', fontSize: 13, fontWeight: 500,
                          background: servingG === g ? '#22c55e' : 'var(--surface-secondary, #1a1a1a)',
                          color: servingG === g ? '#000' : 'var(--text-secondary)',
                          transition: 'background 0.15s',
                        }}>
                          {p.label === '1 serve' ? `1 serve (${g}g)` : p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom grams input */}
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Or enter grams</div>
                  <input
                    type="number" min="1" max="2000"
                    style={{ ...inputStyle, width: 120 }}
                    value={servingG}
                    onChange={e => setServingG(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-tertiary)', marginLeft: 8 }}>g</span>
                </div>

                {/* Live preview */}
                {scaled && (
                  <div style={{
                    background: 'var(--surface-secondary, #1a1a1a)',
                    borderRadius: 12, padding: '12px 14px',
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center',
                  }}>
                    {[['Calories', scaled.calories, 'kcal'], ['Protein', scaled.protein, 'g'], ['Carbs', scaled.carbs, 'g'], ['Fats', scaled.fats, 'g']].map(([label, val, unit]) => (
                      <div key={label}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{val}{unit === 'kcal' ? '' : unit}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{label}{unit === 'kcal' ? ' kcal' : ''}</div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={handleSave} style={btnPrimary}>
                  Add to {mealType}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── WeeklyBarChart ───────────────────────────────────────────────────────────

function WeeklyBarChart({ days, caloriesByDate, targetCalories }) {
  const W = 320, H = 140;
  const padL = 28, padR = 8, padT = 10, padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const maxVal = Math.max(targetCalories * 1.2, ...Object.values(caloriesByDate), 100);
  const barW   = (chartW / 7) * 0.55;
  const gap    = chartW / 7;

  const today = todayISO();

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* Y axis ticks */}
      {[0, 0.5, 1].map(f => {
        const y = padT + chartH * (1 - f);
        const label = Math.round(maxVal * f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y} y2={y}
              stroke="var(--border, #2a2a2a)" strokeWidth="1" strokeDasharray="3 3" />
            <text x={padL - 3} y={y + 4} textAnchor="end"
              fontSize="9" fill="var(--text-tertiary, #666)">
              {label >= 1000 ? `${(label / 1000).toFixed(1)}k` : label}
            </text>
          </g>
        );
      })}

      {/* Target line */}
      {targetCalories > 0 && (() => {
        const y = padT + chartH * (1 - targetCalories / maxVal);
        return (
          <line x1={padL} x2={W - padR} y1={y} y2={y}
            stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />
        );
      })()}

      {/* Bars */}
      {days.map((date, i) => {
        const x    = padL + i * gap + gap / 2 - barW / 2;
        const cals = caloriesByDate[date] || 0;
        const pct  = Math.min(cals / maxVal, 1);
        const bH   = Math.max(pct * chartH, cals > 0 ? 3 : 0);
        const y    = padT + chartH - bH;
        const isT  = date === today;
        const hit  = cals >= targetCalories * 0.9;
        const color = isT ? '#22c55e' : hit ? '#3b82f6' : '#4b5563';

        const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'narrow' });

        return (
          <g key={date}>
            <rect x={x} y={y} width={barW} height={bH} rx={3} fill={color} opacity={isT ? 1 : 0.8} />
            <text x={x + barW / 2} y={H - padB + 13} textAnchor="middle"
              fontSize="9" fill={isT ? '#22c55e' : 'var(--text-tertiary, #666)'} fontWeight={isT ? '700' : '400'}>
              {dayLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── WeeklyView ───────────────────────────────────────────────────────────────

function WeeklyView({ nutritionRows, targets }) {
  const today = todayISO();
  const days  = getLast7Days(today);

  // Group rows by date
  const rowsByDate = {};
  nutritionRows.forEach(r => {
    if (!rowsByDate[r.date]) rowsByDate[r.date] = [];
    rowsByDate[r.date].push(r);
  });

  const caloriesByDate = {};
  days.forEach(d => {
    caloriesByDate[d] = (rowsByDate[d] || []).reduce((s, r) => s + r.calories, 0);
  });

  // Days on target (within 10% under, any amount over allowed)
  const daysOnTarget = days.filter(d => {
    const c = caloriesByDate[d] || 0;
    return c > 0 && c >= targets.calories * 0.9;
  }).length;

  // Average macros (logged days only)
  const loggedDays = days.filter(d => (caloriesByDate[d] || 0) > 0);
  function avgMacro(key) {
    if (!loggedDays.length) return 0;
    return loggedDays.reduce((s, d) => s + (rowsByDate[d] || []).reduce((ss, r) => ss + (r[key] || 0), 0), 0) / loggedDays.length;
  }

  const avgCals    = avgMacro('calories');
  const avgProtein = avgMacro('protein');
  const avgCarbs   = avgMacro('carbs');
  const avgFats    = avgMacro('fats');

  return (
    <div>
      {/* Chart */}
      <div style={{
        background: 'var(--surface, #111)', borderRadius: 14, margin: '0 16px 12px',
        padding: '14px 12px 8px',
        border: '1px solid var(--border, #2a2a2a)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
          7-Day Calories
        </div>
        <WeeklyBarChart days={days} caloriesByDate={caloriesByDate} targetCalories={targets.calories} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <div style={{ width: 20, height: 2, background: '#22c55e', borderRadius: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Target ({targets.calories} kcal)</span>
        </div>
      </div>

      {/* Days on target */}
      <div style={{
        background: 'var(--surface, #111)', borderRadius: 14, margin: '0 16px 12px',
        padding: '14px', border: '1px solid var(--border, #2a2a2a)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Days on target</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>within 10% of calorie goal</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: daysOnTarget >= 5 ? '#22c55e' : daysOnTarget >= 3 ? '#f59e0b' : 'var(--text-primary)' }}>
          {daysOnTarget}<span style={{ fontSize: 16, fontWeight: 400, color: 'var(--text-tertiary)' }}>/7</span>
        </div>
      </div>

      {/* Average macros */}
      <div style={{
        background: 'var(--surface, #111)', borderRadius: 14, margin: '0 16px 12px',
        padding: '14px', border: '1px solid var(--border, #2a2a2a)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
          Daily averages {loggedDays.length < 7 ? `(${loggedDays.length} logged day${loggedDays.length !== 1 ? 's' : ''})` : ''}
        </div>
        {loggedDays.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No nutrition logged this week yet.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14, textAlign: 'center' }}>
              {[
                ['Calories', Math.round(avgCals), 'kcal', '#22c55e'],
                ['Protein',  Math.round(avgProtein), 'g',   '#3b82f6'],
                ['Carbs',    Math.round(avgCarbs),   'g',   '#f59e0b'],
                ['Fats',     Math.round(avgFats),    'g',   '#f97316'],
              ].map(([label, val, unit, color]) => (
                <div key={label} style={{
                  background: 'var(--surface-secondary, #1a1a1a)',
                  borderRadius: 10, padding: '10px 4px',
                }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{unit}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</div>
                </div>
              ))}
            </div>
            <MacroBar label="Protein" consumed={avgProtein} target={targets.protein} color="#3b82f6" />
            <MacroBar label="Carbs"   consumed={avgCarbs}   target={targets.carbs}   color="#f59e0b" />
            <MacroBar label="Fats"    consumed={avgFats}    target={targets.fats}    color="#f97316" />
          </>
        )}
      </div>
    </div>
  );
}


// ─── NutritionPage (main) ──────────────────────────────────────────────────

export default function NutritionPage() {
  const { user } = useAuth();

  // View state
  const [activeTab,      setActiveTab]      = useState('daily');   // 'daily' | 'weekly'
  const [selectedDate,   setSelectedDate]   = useState(todayISO());

  // Data
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [nutritionRows,  setNutritionRows]  = useState([]);  // all rows fetched
  const [clientData,     setClientData]     = useState(null);

  // Add Food modal
  const [showAddFood,    setShowAddFood]    = useState(false);
  const [addFoodMeal,    setAddFoodMeal]    = useState('Breakfast');

  // ── Fetch data ────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!user?.clientID) return;
    setLoading(true);
    setError('');
    try {
      const [clients, nutrition] = await Promise.all([
        readSheet('Clients'),
        readSheet('NutritionLogs'),
      ]);

      const client = clients.find(c =>
        (c.ClientID || c.Email?.toLowerCase()) === (user.clientID || user.email?.toLowerCase())
      );
      setClientData(client || null);

      const myRows = nutrition
        .filter(r => r.ClientID === user.clientID)
        .map(parseNutritionRow);
      setNutritionRows(myRows);
    } catch (e) {
      console.error('NutritionPage fetch error:', e);
      setError('Could not load nutrition data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived targets ────────────────────────────────────────────────────────

  const targets = (() => {
    if (!clientData) return { calories: 2000, protein: 150, carbs: 200, fats: 65 };
    return {
      calories: parseFloat(clientData.DailyCalories)  || 2000,
      protein:  parseFloat(clientData.ProteinTarget)  || 150,
      carbs:    parseFloat(clientData.CarbTarget)     || 200,
      fats:     parseFloat(clientData.FatTarget)      || 65,
    };
  })();

  // ── Today's rows ──────────────────────────────────────────────────────────

  const dayRows = nutritionRows.filter(r => r.date === selectedDate);

  const totals = dayRows.reduce((acc, r) => ({
    calories: acc.calories + r.calories,
    protein:  acc.protein  + r.protein,
    carbs:    acc.carbs    + r.carbs,
    fats:     acc.fats     + r.fats,
    fibre:    acc.fibre    + r.fibre,
  }), { calories: 0, protein: 0, carbs: 0, fats: 0, fibre: 0 });

  // ── Save food ──────────────────────────────────────────────────────────────

  async function handleSaveFood(foodData) {
    const logId = `NL-${Date.now()}`;
    const row = {
      LogID:     logId,
      ClientID:  user.clientID,
      Date:      selectedDate,
      MealType:  foodData.mealType,
      FoodName:  foodData.foodName,
      ServingG:  foodData.servingG,
      Calories:  foodData.calories,
      Protein:   foodData.protein,
      Carbs:     foodData.carbs,
      Fats:      foodData.fats,
      Fibre:     foodData.fibre || 0,
      LoggedAt:  new Date().toISOString(),
    };

    // Optimistic UI update
    setNutritionRows(prev => [...prev, parseNutritionRow(row)]);

    try {
      await appendToSheet('NutritionLogs', row);
    } catch (e) {
      console.error('Failed to save food log:', e);
      // Revert optimistic update on failure
      setNutritionRows(prev => prev.filter(r => r.logId !== logId));
    }
  }

  // ── Delete food (optimistic) ───────────────────────────────────────────────
  // Note: deletion via Apps Script requires implementing a 'delete' action.
  // For now, we remove from local state only (trainer can delete from sheet if needed).
  function handleDeleteItem(logId) {
    setNutritionRows(prev => prev.filter(r => r.logId !== logId));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🥗</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading nutrition…</div>
        </div>
      </div>
    );
  }

  const cardStyle = {
    background: 'var(--surface, #111)',
    borderRadius: 14, margin: '0 16px 12px',
    border: '1px solid var(--border, #2a2a2a)',
  };

  return (
    <div style={{ paddingBottom: 20 }}>

      {/* ── Tab Bar: Daily / Weekly ── */}
      <div style={{ display: 'flex', margin: '0 16px 4px', gap: 6 }}>
        {[['daily','Daily'],['weekly','Weekly']].map(([val, label]) => (
          <button key={val} onClick={() => setActiveTab(val)} style={{
            flex: 1, padding: '9px', borderRadius: 10, border: 'none',
            cursor: 'pointer', fontSize: 14, fontWeight: 600,
            background: activeTab === val ? '#22c55e' : 'var(--surface, #111)',
            color: activeTab === val ? '#000' : 'var(--text-secondary)',
            transition: 'background 0.15s, color 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{
          margin: '8px 16px', padding: '10px 14px', borderRadius: 10,
          background: '#1a1a1a', border: '1px solid #333',
          fontSize: 13, color: '#fbbf24',
        }}>
          {error}
        </div>
      )}

      {/* ── DAILY VIEW ── */}
      {activeTab === 'daily' && (
        <>
          {/* Date selector */}
          <DateSelector date={selectedDate} onChange={setSelectedDate} />

          {/* Calorie ring */}
          <div style={{ ...cardStyle, padding: '4px 16px 12px' }}>
            <CalorieRing consumed={Math.round(totals.calories)} target={targets.calories} />

            {/* Macro bars */}
            <div style={{ marginTop: 4 }}>
              <MacroBar label="Protein" consumed={totals.protein} target={targets.protein} color="#3b82f6" />
              <MacroBar label="Carbs"   consumed={totals.carbs}   target={targets.carbs}   color="#f59e0b" />
              <MacroBar label="Fats"    consumed={totals.fats}    target={targets.fats}    color="#f97316" />
            </div>
          </div>

          {/* Remaining macros text */}
          <RemainingMacros
            protein={totals.protein} carbs={totals.carbs} fats={totals.fats}
            targetProtein={targets.protein} targetCarbs={targets.carbs} targetFats={targets.fats}
          />

          {/* Fibre (if any logged) */}
          {totals.fibre > 0 && (
            <div style={{
              ...cardStyle, padding: '10px 14px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Fibre</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {Math.round(totals.fibre)}g
              </span>
            </div>
          )}

          {/* Meal sections */}
          {MEAL_TYPES.map(mt => (
            <MealSection
              key={mt.key}
              mealType={mt}
              items={dayRows.filter(r => r.mealType === mt.key)}
              onAddFood={mealKey => { setAddFoodMeal(mealKey); setShowAddFood(true); }}
              onDeleteItem={handleDeleteItem}
            />
          ))}

          {/* Quick add button at bottom */}
          <div style={{ padding: '4px 16px 0' }}>
            <button
              onClick={() => { setAddFoodMeal('Snacks'); setShowAddFood(true); }}
              style={{
                width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                background: '#22c55e', color: '#000', fontSize: 15, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Add Food
            </button>
          </div>
        </>
      )}

      {/* ── WEEKLY VIEW ── */}
      {activeTab === 'weekly' && (
        <WeeklyView nutritionRows={nutritionRows} targets={targets} />
      )}

      {/* ── AddFoodModal ── */}
      {showAddFood && (
        <AddFoodModal
          initialMealType={addFoodMeal}
          clientTargets={targets}
          onSave={handleSaveFood}
          onClose={() => setShowAddFood(false)}
        />
      )}
    </div>
  );
}
