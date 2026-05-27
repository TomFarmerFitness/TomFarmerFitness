import { useState, useEffect, useCallback, useRef } from 'react';
import { readSheet } from '../../utils/sheets';
import config from '../../config';

// ─── Constants ────────────────────────────────────────────────────────────────
const MUSCLE_GROUPS = [
  'Chest','Back','Shoulders','Biceps','Triceps','Forearms',
  'Abs','Glutes','Quads','Hamstrings','Calves','Full Body','Cardio','Other',
];
const EQUIPMENT_LIST = [
  'Barbell','Dumbbell','Cable','Machine','Bodyweight',
  'Kettlebell','Resistance Band','Smith Machine','Other',
];
const CATEGORY_LIST = ['Compound','Isolation','Cardio','Mobility','Plyometric'];

function generateExId() {
  return `ex-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
}

async function callProxy(body) {
  const url = config.APPS_SCRIPT_URL;
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(body),
    // No Content-Type — avoids CORS preflight for Apps Script
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── ExerciseFormModal ────────────────────────────────────────────────────────
function ExerciseFormModal({ initial, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.Name || '',
    muscleGroup: initial?.MuscleGroup || '',
    equipment: initial?.Equipment || '',
    category: initial?.Category || '',
    description: initial?.Description || '',
    videoUrl: initial?.VideoURL || '',
    instructions: initial?.Instructions || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const inputStyle = {
    width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'10px 12px', boxSizing:'border-box',
  };
  const labelStyle = { color:'#64748b', fontSize:'12px', letterSpacing:'0.05em', marginBottom:'6px', display:'block' };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Exercise name is required'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ ...form, id: initial?.ExerciseID });
      onClose();
    } catch(e) { setError(e.message); setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%', maxWidth:'460px',
        maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'16px' }}>
            {isEdit ? 'Edit Exercise' : 'Add Exercise'}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b',
            fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'20px', display:'flex', flexDirection:'column', gap:'14px' }}>
          <div>
            <label style={labelStyle}>NAME *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Barbell Back Squat" style={inputStyle} autoFocus />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <div>
              <label style={labelStyle}>MUSCLE GROUP</label>
              <select value={form.muscleGroup} onChange={e => set('muscleGroup', e.target.value)} style={inputStyle}>
                <option value="">— Select —</option>
                {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>EQUIPMENT</label>
              <select value={form.equipment} onChange={e => set('equipment', e.target.value)} style={inputStyle}>
                <option value="">— Select —</option>
                {EQUIPMENT_LIST.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>CATEGORY</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {CATEGORY_LIST.map(c => (
                <button key={c}
                  onClick={() => set('category', c)}
                  style={{ padding:'6px 12px', borderRadius:'20px', border:'none', cursor:'pointer',
                    fontSize:'12px', transition:'all 0.15s',
                    background: form.category === c ? '#f97316' : 'rgba(255,255,255,0.08)',
                    color: form.category === c ? '#fff' : '#94a3b8',
                    fontWeight: form.category === c ? 600 : 400 }}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>DESCRIPTION</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Brief description of the exercise"
              rows={2} style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }} />
          </div>

          <div>
            <label style={labelStyle}>INSTRUCTIONS</label>
            <textarea value={form.instructions} onChange={e => set('instructions', e.target.value)}
              placeholder="Step-by-step cues for proper form"
              rows={3} style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }} />
          </div>

          <div>
            <label style={labelStyle}>VIDEO URL (optional)</label>
            <input value={form.videoUrl} onChange={e => set('videoUrl', e.target.value)}
              placeholder="https://youtube.com/…" style={inputStyle} />
          </div>

          {error && (
            <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
              borderRadius:'8px', padding:'10px 12px', color:'#fca5a5', fontSize:'13px' }}>{error}</div>
          )}
        </div>

        <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
          display:'flex', gap:'10px' }}>
          <button onClick={onClose}
            style={{ flex:1, padding:'11px', background:'rgba(255,255,255,0.06)',
              border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
              color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex:2, padding:'11px', background: saving ? '#7c3f0a' : '#f97316',
              border:'none', borderRadius:'10px', color:'#fff',
              fontSize:'14px', fontWeight:600, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Exercise'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ExerciseDetailModal ──────────────────────────────────────────────────────
function ExerciseDetailModal({ ex, onClose, onEdit, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${ex.Name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try { await onDelete(ex.ExerciseID); onClose(); }
    catch(e) { alert('Delete failed: ' + e.message); setDeleting(false); }
  };

  const pill = (label, val) => val ? (
    <span style={{ padding:'4px 10px', borderRadius:'12px',
      background:'rgba(255,255,255,0.08)', color:'#94a3b8',
      fontSize:'12px', border:'1px solid rgba(255,255,255,0.08)' }}>{label}: <b style={{ color:'#e2e8f0' }}>{val}</b></span>
  ) : null;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000,
      display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px 16px 0 0', width:'100%',
        maxWidth:'430px', maxHeight:'80vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'17px',
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{ex.Name}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginTop:'8px' }}>
              {pill('Muscle', ex.MuscleGroup)}
              {pill('Equipment', ex.Equipment)}
              {pill('Category', ex.Category)}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b',
            fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px', flexShrink:0 }}>×</button>
        </div>
        <div style={{ overflowY:'auto', flex:1, padding:'16px 20px', display:'flex', flexDirection:'column', gap:'14px' }}>
          {ex.Description && (
            <div>
              <div style={{ color:'#64748b', fontSize:'11px', marginBottom:'4px' }}>DESCRIPTION</div>
              <div style={{ color:'#cbd5e1', fontSize:'14px', lineHeight:1.6 }}>{ex.Description}</div>
            </div>
          )}
          {ex.Instructions && (
            <div>
              <div style={{ color:'#64748b', fontSize:'11px', marginBottom:'4px' }}>INSTRUCTIONS</div>
              <div style={{ color:'#cbd5e1', fontSize:'14px', lineHeight:1.8,
                whiteSpace:'pre-line' }}>{ex.Instructions}</div>
            </div>
          )}
          {ex.VideoURL && (
            <a href={ex.VideoURL} target="_blank" rel="noreferrer"
              style={{ display:'inline-flex', alignItems:'center', gap:'6px',
                color:'#f97316', fontSize:'13px', textDecoration:'none' }}>
              ▶ Watch Video
            </a>
          )}
        </div>
        <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
          display:'flex', gap:'10px' }}>
          <button onClick={handleDelete} disabled={deleting}
            style={{ padding:'10px 14px', background:'rgba(239,68,68,0.1)',
              border:'1px solid rgba(239,68,68,0.2)', borderRadius:'8px',
              color:'#f87171', fontSize:'13px', cursor:'pointer' }}>
            {deleting ? '…' : '🗑'}
          </button>
          <button onClick={() => onEdit(ex)}
            style={{ flex:1, padding:'10px', background:'rgba(255,255,255,0.06)',
              border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
              color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>✏️ Edit</button>
        </div>
      </div>
    </div>
  );
}


// ─── Main ExercisesPage ───────────────────────────────────────────────────────
export default function ExercisesPage() {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [muscleFilter, setMuscle] = useState('All');
  const [equipFilter, setEquip]   = useState('All');
  const [formTarget, setForm]     = useState(null); // null=closed, false=new, obj=edit
  const [detailEx, setDetail]     = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await readSheet('Exercises');
      setExercises(rows);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = exercises.filter(ex => {
    const matchSearch = !search || ex.Name?.toLowerCase().includes(search.toLowerCase()) ||
      ex.MuscleGroup?.toLowerCase().includes(search.toLowerCase());
    const matchMuscle = muscleFilter === 'All' || ex.MuscleGroup === muscleFilter;
    const matchEquip  = equipFilter  === 'All' || ex.Equipment  === equipFilter;
    return matchSearch && matchMuscle && matchEquip;
  });

  // Group by first letter
  const grouped = {};
  [...filtered].sort((a,b) => (a.Name||'').localeCompare(b.Name||'')).forEach(ex => {
    const key = (ex.Name?.[0] || '#').toUpperCase();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(ex);
  });

  const handleSave = async ({ id, name, muscleGroup, equipment, category,
    description, videoUrl, instructions }) => {
    const exId = id || generateExId();
    const rowData = {
      ExerciseID: exId, Name: name, MuscleGroup: muscleGroup,
      Equipment: equipment, Category: category, Description: description,
      Instructions: instructions, VideoURL: videoUrl,
    };
    await callProxy({ action: 'upsertRow', tab: 'Exercises', idColumn: 'ExerciseID', id: exId, row: rowData });
    // Optimistic update
    const newEx = { ExerciseID: exId, Name: name, MuscleGroup: muscleGroup,
      Equipment: equipment, Category: category, Description: description,
      Instructions: instructions, VideoURL: videoUrl };
    setExercises(prev => id
      ? prev.map(e => e.ExerciseID === id ? newEx : e)
      : [...prev, newEx]);
  };

  const handleDelete = async (exId) => {
    await callProxy({ action: 'deleteRowsWhere', tab: 'Exercises', column: 'ExerciseID', value: exId });
    setExercises(prev => prev.filter(e => e.ExerciseID !== exId));
  };

  const muscleOptions = ['All', ...MUSCLE_GROUPS];
  const equipOptions  = ['All', ...EQUIPMENT_LIST];

  const statChipStyle = {
    padding:'4px 10px', background:'rgba(255,255,255,0.06)',
    border:'1px solid rgba(255,255,255,0.08)', borderRadius:'12px',
    color:'#64748b', fontSize:'12px',
  };

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#f1f5f9',
      fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ position:'fixed', left:'50%', transform:'translateX(-50%)',
        width:'100%', maxWidth:'430px', height:'100dvh', display:'flex',
        flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'16px 16px 0', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
            <div>
              <div style={{ color:'#f1f5f9', fontWeight:800, fontSize:'20px' }}>Exercises</div>
              <div style={{ color:'#64748b', fontSize:'13px' }}>{exercises.length} in database</div>
            </div>
            <button onClick={() => setForm(false)}
              style={{ padding:'8px 14px', background:'#f97316', border:'none',
                borderRadius:'8px', color:'#fff', fontSize:'13px', cursor:'pointer', fontWeight:600 }}>
              + Add
            </button>
          </div>

          {/* Search */}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or muscle…"
            style={{ width:'100%', background:'rgba(255,255,255,0.06)',
              border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
              color:'#f1f5f9', fontSize:'14px', padding:'10px 14px',
              boxSizing:'border-box', marginBottom:'10px' }} />

          {/* Filters */}
          <div style={{ display:'flex', gap:'8px', overflowX:'auto', paddingBottom:'10px' }}>
            <select value={muscleFilter} onChange={e => setMuscle(e.target.value)}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.1)',
                borderRadius:'8px', color: muscleFilter==='All' ? '#94a3b8' : '#f97316',
                fontSize:'12px', padding:'6px 10px', flexShrink:0, cursor:'pointer' }}>
              {muscleOptions.map(m => <option key={m} value={m}>{m === 'All' ? 'All Muscles' : m}</option>)}
            </select>
            <select value={equipFilter} onChange={e => setEquip(e.target.value)}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.1)',
                borderRadius:'8px', color: equipFilter==='All' ? '#94a3b8' : '#f97316',
                fontSize:'12px', padding:'6px 10px', flexShrink:0, cursor:'pointer' }}>
              {equipOptions.map(e => <option key={e} value={e}>{e === 'All' ? 'All Equipment' : e}</option>)}
            </select>
            {(search || muscleFilter !== 'All' || equipFilter !== 'All') && (
              <button onClick={() => { setSearch(''); setMuscle('All'); setEquip('All'); }}
                style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)',
                  borderRadius:'8px', color:'#f87171', fontSize:'12px',
                  padding:'6px 10px', cursor:'pointer', flexShrink:0 }}>
                Clear
              </button>
            )}
          </div>

          {/* Stats row */}
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', paddingBottom:'8px' }}>
            <span style={statChipStyle}>{filtered.length} shown</span>
            {muscleFilter !== 'All' && <span style={{ ...statChipStyle, color:'#f97316' }}>{muscleFilter}</span>}
            {equipFilter  !== 'All' && <span style={{ ...statChipStyle, color:'#f97316' }}>{equipFilter}</span>}
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY:'auto', flex:1, paddingBottom:'16px' }}>
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center',
              height:'200px', color:'#64748b' }}>Loading exercises…</div>
          ) : error ? (
            <div style={{ margin:'16px', background:'rgba(239,68,68,0.1)',
              border:'1px solid rgba(239,68,68,0.3)', borderRadius:'10px',
              padding:'16px', color:'#fca5a5' }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', height:'200px', gap:'12px', color:'#64748b' }}>
              <div style={{ fontSize:'36px' }}>🏋️</div>
              <div style={{ fontSize:'14px' }}>No exercises match your filters</div>
            </div>
          ) : Object.entries(grouped).map(([letter, exList]) => (
            <div key={letter}>
              <div style={{ padding:'8px 16px 4px', color:'#f97316',
                fontSize:'12px', fontWeight:700, letterSpacing:'0.1em',
                background:'rgba(249,115,22,0.05)', borderBottom:'1px solid rgba(249,115,22,0.1)' }}>
                {letter}
              </div>
              {exList.map(ex => (
                <button key={ex.ExerciseID}
                  onClick={() => setDetail(ex)}
                  style={{ width:'100%', background:'none', border:'none', padding:'12px 16px',
                    display:'flex', alignItems:'center', gap:'12px', cursor:'pointer',
                    borderBottom:'1px solid rgba(255,255,255,0.04)', textAlign:'left',
                    transition:'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background='none'}>
                  <div style={{ width:'36px', height:'36px', borderRadius:'8px',
                    background:'rgba(249,115,22,0.1)', border:'1px solid rgba(249,115,22,0.2)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:'#f97316', fontSize:'15px', flexShrink:0 }}>
                    {ex.Category === 'Cardio' ? '🏃' :
                     ex.Category === 'Compound' ? '🏋️' :
                     ex.Category === 'Mobility' ? '🧘' : '💪'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:'#f1f5f9', fontSize:'14px', fontWeight:500,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {ex.Name}
                    </div>
                    <div style={{ color:'#64748b', fontSize:'12px', marginTop:'2px' }}>
                      {[ex.MuscleGroup, ex.Equipment].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {ex.Category && (
                    <span style={{ padding:'3px 8px', borderRadius:'10px',
                      background:'rgba(255,255,255,0.06)', color:'#64748b',
                      fontSize:'11px', flexShrink:0 }}>{ex.Category}</span>
                  )}
                  <span style={{ color:'#334155', fontSize:'16px', flexShrink:0 }}>›</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {formTarget !== null && (
        <ExerciseFormModal
          initial={formTarget || null}
          onClose={() => setForm(null)}
          onSave={handleSave} />
      )}
      {detailEx && (
        <ExerciseDetailModal
          ex={detailEx}
          onClose={() => setDetail(null)}
          onEdit={(ex) => { setDetail(null); setForm(ex); }}
          onDelete={async (id) => { await handleDelete(id); setDetail(null); }} />
      )}
    </div>
  );
}
