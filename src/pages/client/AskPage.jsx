import { useState, useEffect, useRef, useCallback } from 'react';
import { readSheet, appendToSheet } from '../../utils/sheets';
import { useAuth } from '../../context/AuthContext';
import config from '../../config';

// ─── Constants ────────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  'How do I perform a Romanian deadlift?',
  'What should I eat before training?',
  'How much protein do I need per day?',
  'What are the best foods for muscle recovery?',
  'Can you explain progressive overload?',
];

// Substring that the AI uses when escalating — checked case-insensitively
const ESCALATION_MARKER = 'flagged it for him';

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatMsgTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  const now   = new Date();
  const today = now.toDateString() === d.toDateString();
  const hm    = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (today) return hm;
  const yest  = new Date(now); yest.setDate(now.getDate() - 1);
  if (yest.toDateString() === d.toDateString()) return `Yesterday ${hm}`;
  return `${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} ${hm}`;
}

/**
 * Convert AIQuestions rows (from Google Sheets) into a flat chat message array.
 * Each row becomes up to two messages: the client's question + the AI/coach response.
 */
function parseAIQuestionsToMessages(rows) {
  const msgs = [];
  const sorted = [...rows].sort((a, b) => new Date(a.AskedAt || 0) - new Date(b.AskedAt || 0));

  sorted.forEach(row => {
    if (!row.Question) return;

    msgs.push({
      id:        `${row.QuestionID}-q`,
      role:      'user',
      content:   row.Question,
      timestamp: row.AskedAt    || '',
      rowId:     row.QuestionID || '',
    });

    if (row.Answer) {
      const isCoach = row.Status === 'CoachAnswered';
      msgs.push({
        id:        `${row.QuestionID}-a`,
        role:      isCoach ? 'coach' : 'assistant',
        content:   row.Answer,
        timestamp: row.AnsweredAt || row.AskedAt || '',
        escalated: row.EscalatedToCoach === 'TRUE',
        rowId:     row.QuestionID || '',
      });
    }
  });

  return msgs;
}

// ─── SuggestedChips ───────────────────────────────────────────────────────────

function SuggestedChips({ onSelect, disabled }) {
  return (
    <div style={{ padding: '16px 16px 0' }}>
      {/* Avatar + intro */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24,
        }}>🏋️</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            TFF Assistant
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Ask me anything about training, nutrition, or technique.
          </div>
        </div>
      </div>

      {/* Suggested chips */}
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 10 }}>
        Try asking:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SUGGESTED_QUESTIONS.map(q => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            disabled={disabled}
            style={{
              background: 'var(--surface, #111)',
              border: '1px solid var(--border, #2a2a2a)',
              borderRadius: 12, padding: '11px 14px',
              color: 'var(--text-primary)', fontSize: 14,
              cursor: disabled ? 'default' : 'pointer',
              textAlign: 'left',
              transition: 'border-color 0.15s',
              opacity: disabled ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = '#22c55e'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border, #2a2a2a)'; }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser  = msg.role === 'user';
  const isCoach = msg.role === 'coach';

  // Colour scheme per role
  const bubbleStyle = isUser
    ? {
        background:   '#22c55e',
        color:        '#000',
        borderRadius: '18px 18px 4px 18px',
        alignSelf:    'flex-end',
        maxWidth:     '82%',
      }
    : isCoach
    ? {
        background:   'rgba(249, 115, 22, 0.12)',
        border:       '1px solid rgba(249, 115, 22, 0.3)',
        color:        'var(--text-primary)',
        borderRadius: '18px 18px 18px 4px',
        alignSelf:    'flex-start',
        maxWidth:     '86%',
      }
    : {
        background:   'var(--surface-secondary, #1a1a1a)',
        border:       '1px solid var(--border, #2a2a2a)',
        color:        'var(--text-primary)',
        borderRadius: '18px 18px 18px 4px',
        alignSelf:    'flex-start',
        maxWidth:     '86%',
      };

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      alignItems:    isUser ? 'flex-end' : 'flex-start',
      marginBottom:  4,
    }}>
      {/* Sender label for AI / coach */}
      {!isUser && (
        <div style={{
          fontSize: 11, fontWeight: 600, marginBottom: 3, paddingLeft: 2,
          color: isCoach ? '#f97316' : '#22c55e',
        }}>
          {isCoach ? '👋 Tom (Your Coach)' : '🏋️ TFF Assistant'}
        </div>
      )}

      {/* Bubble */}
      <div style={{ ...bubbleStyle, padding: '10px 14px' }}>
        {/* Render message text — preserve newlines */}
        <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {msg.content}
        </div>
      </div>

      {/* Escalation note */}
      {msg.escalated && !isUser && !isCoach && (
        <div style={{
          marginTop: 5, paddingLeft: 4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 13 }}>📌</span>
          <span style={{ fontSize: 12, color: '#f59e0b', fontStyle: 'italic' }}>
            Your question has been flagged for Tom. He&apos;ll respond shortly.
          </span>
        </div>
      )}

      {/* Timestamp */}
      {msg.timestamp && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3, paddingLeft: 2, paddingRight: 2 }}>
          {formatMsgTime(msg.timestamp)}
        </div>
      )}
    </div>
  );
}

// ─── TypingIndicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3, paddingLeft: 2, color: '#22c55e' }}>
        🏋️ TFF Assistant
      </div>
      <div style={{
        background:   'var(--surface-secondary, #1a1a1a)',
        border:       '1px solid var(--border, #2a2a2a)',
        borderRadius: '18px 18px 18px 4px',
        padding:      '12px 16px',
        display:      'flex', alignItems: 'center', gap: 5,
      }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width:     7, height: 7, borderRadius: '50%',
              background: '#22c55e', opacity: 0.7,
              animation: `tffDotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes tffDotPulse {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1;   }
        }
      `}</style>
    </div>
  );
}

// ─── ErrorBubble ─────────────────────────────────────────────────────────────

function ErrorBubble({ message }) {
  return (
    <div style={{
      alignSelf:    'flex-start',
      maxWidth:     '86%',
      background:   'rgba(239,68,68,0.1)',
      border:       '1px solid rgba(239,68,68,0.25)',
      borderRadius: '18px 18px 18px 4px',
      padding:      '10px 14px',
      fontSize:     13, color: '#fca5a5',
      marginBottom: 4,
    }}>
      {message}
    </div>
  );
}


// ─── AskPage (main) ───────────────────────────────────────────────────────────

export default function AskPage() {
  const { user } = useAuth();

  const [messages,    setMessages]    = useState([]);   // flat array of chat msgs
  const [input,       setInput]       = useState('');
  const [sending,     setSending]     = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState('');
  const [clientData,  setClientData]  = useState(null);

  const bottomRef  = useRef(null);
  const textareaRef = useRef(null);
  const inputBarRef = useRef(null);

  // ── Mark ask tab as seen (clears notification badge) ──────────────────────
  useEffect(() => {
    localStorage.setItem('tff_ask_last_seen', new Date().toISOString());
  }, []);

  // ── Fetch client profile + existing Q&A history ───────────────────────────
  const fetchData = useCallback(async () => {
    if (!user?.clientID) return;
    setLoading(true);
    setFetchError('');
    try {
      const [clients, questions] = await Promise.all([
        readSheet('Clients'),
        readSheet('AIQuestions'),
      ]);

      const client = clients.find(c => c.ClientID === user.clientID);
      setClientData(client || null);

      const myRows = questions.filter(r => r.ClientID === user.clientID);
      setMessages(parseAIQuestionsToMessages(myRows));
    } catch (e) {
      console.error('AskPage fetch error:', e);
      setFetchError('Could not load chat history.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Auto-scroll to bottom whenever messages change ────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // ── Build client profile string for the system prompt ────────────────────
  function buildClientProfile() {
    if (!clientData) return 'Profile not yet loaded';
    const parts = [
      clientData.Name    ? `Name: ${clientData.Name}`           : null,
      clientData.Goal    ? `Goal: ${clientData.Goal}`           : null,
      clientData.ProgramID ? `Current program: ${clientData.ProgramID}` : null,
      clientData.Height  ? `Height: ${clientData.Height}cm`    : null,
      clientData.Age     ? `Age: ${clientData.Age}`             : null,
      clientData.Gender  ? `Gender: ${clientData.Gender}`      : null,
      clientData.Injuries && clientData.Injuries !== 'None noted' ? `Injuries/limitations: ${clientData.Injuries}` : null,
    ].filter(Boolean);
    return parts.join(', ') || 'Profile not available';
  }

  // ── Build conversation history for Claude context (last 8 exchanges) ──────
  function buildHistory() {
    // Take the last 16 non-error messages, mapping roles to 'user'/'assistant'
    return messages.slice(-16).map(m => ({
      role:    m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
  }

  // ── Send a message ─────────────────────────────────────────────────────────
  async function sendMessage(text) {
    const question = text.trim();
    if (!question || sending) return;

    setInput('');
    setSending(true);

    // Optimistic: show user message immediately
    const userMsgId = `local-q-${Date.now()}`;
    const sentAt    = new Date().toISOString();
    setMessages(prev => [...prev, {
      id:        userMsgId,
      role:      'user',
      content:   question,
      timestamp: sentAt,
      rowId:     '',
    }]);

    // Resize textarea back to single line
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const appsScriptUrl = config.APPS_SCRIPT_URL;
      if (!appsScriptUrl || appsScriptUrl.startsWith('YOUR_')) {
        throw new Error('apps_script_not_configured');
      }

      const res = await fetch(appsScriptUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:        'askClaude',
          question,
          clientProfile: buildClientProfile(),
          history:       buildHistory(),
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'ai_error');

      const responseText = data.response;
      const escalated    = !!data.escalated;
      const answeredAt   = new Date().toISOString();
      const questionId   = `AQ-${Date.now()}`;

      // Show AI response
      const aiMsgId = `local-a-${Date.now()}`;
      setMessages(prev => [...prev, {
        id:        aiMsgId,
        role:      'assistant',
        content:   responseText,
        timestamp: answeredAt,
        escalated,
        rowId:     questionId,
      }]);

      // Persist to AIQuestions sheet (best-effort, don't block UI)
      appendToSheet('AIQuestions', {
        QuestionID:        questionId,
        ClientID:          user.clientID,
        ClientName:        clientData?.Name || '',
        Question:          question,
        Answer:            responseText,
        Status:            escalated ? 'Flagged' : 'Answered',
        EscalatedToCoach:  escalated ? 'TRUE' : '',
        AskedAt:           sentAt,
        AnsweredAt:        answeredAt,
      }).catch(err => console.warn('Failed to save to AIQuestions:', err));

    } catch (e) {
      console.error('sendMessage error:', e);

      let errorContent;
      if (e.message === 'apps_script_not_configured') {
        errorContent = "The AI assistant isn't connected yet. Ask Tom to finish setting up the app.";
      } else if (e.message === 'CLAUDE_API_KEY not set in Script Properties') {
        errorContent = "The AI assistant needs to be configured by Tom before it can answer questions.";
      } else {
        errorContent = "Sorry, I had trouble responding right now. Please try again in a moment.";
      }

      setMessages(prev => [...prev, {
        id:        `err-${Date.now()}`,
        role:      'error',
        content:   errorContent,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }

  // ── Handle suggested chip tap ─────────────────────────────────────────────
  function handleSuggestedQuestion(q) {
    sendMessage(q);
  }

  // ── Handle textarea key press (Enter to send, Shift+Enter for newline) ────
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  function handleInputChange(e) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  // ── Check if chat is empty (show suggested chips) ─────────────────────────
  const isEmpty = !loading && messages.length === 0 && !sending;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Inline keyframe for dot animation ── */}
      <style>{`
        .tff-ask-content {
          padding-bottom: 80px;
          min-height: 100%;
        }
      `}</style>

      <div className="tff-ask-content">

        {/* Loading state */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading chat…</div>
            </div>
          </div>
        )}

        {/* Fetch error */}
        {fetchError && !loading && (
          <div style={{ margin: '16px', padding: '12px 14px', borderRadius: 10, background: '#1a1a1a', border: '1px solid #333', fontSize: 13, color: '#fbbf24' }}>
            {fetchError}
          </div>
        )}

        {/* Empty state: suggested chips */}
        {isEmpty && (
          <SuggestedChips onSelect={handleSuggestedQuestion} disabled={sending} />
        )}

        {/* Messages */}
        {!loading && messages.length > 0 && (
          <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map(msg =>
              msg.role === 'error'
                ? <ErrorBubble key={msg.id} message={msg.content} />
                : <MessageBubble key={msg.id} msg={msg} />
            )}
          </div>
        )}

        {/* Typing indicator */}
        {sending && (
          <div style={{ padding: '0 16px' }}>
            <TypingIndicator />
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* ── Fixed input bar — sits above the bottom nav ── */}
      <div
        ref={inputBarRef}
        style={{
          position:        'fixed',
          bottom:          64,          // height of bottom nav
          left:            '50%',
          transform:       'translateX(-50%)',
          width:           '100%',
          maxWidth:        430,
          zIndex:          60,
          background:      'var(--bg, #0a0a0a)',
          borderTop:       '1px solid var(--border, #1e1e1e)',
          padding:         '8px 12px',
          paddingBottom:   'calc(8px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about training or nutrition…"
            rows={1}
            style={{
              flex:             1,
              background:       'var(--surface-secondary, #1a1a1a)',
              border:           '1px solid var(--border, #2a2a2a)',
              borderRadius:     14,
              padding:          '10px 14px',
              color:            'var(--text-primary)',
              fontSize:         14,
              outline:          'none',
              resize:           'none',
              lineHeight:       1.5,
              overflowY:        'hidden',
              maxHeight:        120,
              WebkitAppearance: 'none',
              fontFamily:       'inherit',
            }}
          />

          {/* Send button */}
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            style={{
              width:        44,
              height:       44,
              borderRadius: '50%',
              border:       'none',
              flexShrink:   0,
              cursor:       (!input.trim() || sending) ? 'default' : 'pointer',
              background:   (!input.trim() || sending) ? 'var(--surface, #111)' : '#22c55e',
              color:        (!input.trim() || sending) ? 'var(--text-tertiary)' : '#000',
              fontSize:     20,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              transition:   'background 0.15s, color 0.15s',
            }}
          >
            {sending
              ? <span style={{ width: 18, height: 18, border: '2.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              : '↑'}
          </button>
        </div>

        {/* Hint */}
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'center' }}>
          Press Enter to send · Shift+Enter for new line
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

