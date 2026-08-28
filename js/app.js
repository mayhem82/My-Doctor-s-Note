import * as db from './db.js';
import * as api from './api.js';
import { isVoiceSupported, createVoiceCapture } from './voice.js';

const state = {
  threads: [],
  activeThreadId: null,
  voice: null,
  voiceActive: false,
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch (_) {
    return iso;
  }
}

function showStatus(message, kind = 'info') {
  const banner = document.getElementById('status-banner');
  banner.textContent = message;
  banner.className = `status-banner status-${kind}`;
  banner.hidden = false;
  if (kind !== 'error') {
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => { banner.hidden = true; }, 4000);
  }
}

function clearStatus() {
  const banner = document.getElementById('status-banner');
  banner.hidden = true;
}

// ---------- data helpers ----------

function activeThread() {
  return state.threads.find((t) => t.thread_id === state.activeThreadId) || null;
}

function distilledCaptureIds(thread) {
  const ids = new Set();
  for (const d of thread.distillations) {
    for (const id of d.source_capture_ids || []) ids.add(id);
  }
  return ids;
}

async function refreshThreads(preserveActive = true) {
  state.threads = await db.getAllThreads();
  if (!preserveActive || !activeThread()) {
    state.activeThreadId = state.threads[0]?.thread_id ?? null;
  }
  renderThreadList();
  renderThreadDetail();
}

// ---------- rendering: thread list ----------

function renderThreadList() {
  const list = document.getElementById('thread-list');
  if (state.threads.length === 0) {
    list.innerHTML = '<li class="empty-hint">No threads yet - start one for an upcoming appointment or ongoing issue.</li>';
    return;
  }
  list.innerHTML = state.threads.map((t) => `
    <li>
      <button class="thread-item ${t.thread_id === state.activeThreadId ? 'active' : ''}" data-action="select-thread" data-thread-id="${t.thread_id}">
        <span class="thread-label">${escapeHtml(t.label)}</span>
        <span class="thread-meta">${t.captures.length} note${t.captures.length === 1 ? '' : 's'} &middot; ${formatDate(t.created_at)}</span>
      </button>
    </li>
  `).join('');
}

// ---------- rendering: thread detail ----------

function renderThreadDetail() {
  const container = document.getElementById('thread-detail');
  const thread = activeThread();

  if (!thread) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No thread selected.</p>
        <p>Create a thread for an upcoming appointment or an ongoing issue you want to track - e.g. "GP follow-up", "knee pain".</p>
      </div>`;
    return;
  }

  const distilledIds = distilledCaptureIds(thread);
  const capturesHtml = thread.captures.slice().reverse().map((c) => `
    <li class="capture-entry">
      <label class="capture-select">
        <input type="checkbox" data-capture-id="${c.capture_id}" class="capture-checkbox" ${distilledIds.has(c.capture_id) ? '' : 'checked'}>
        <span class="capture-time">${formatDate(c.timestamp)} <span class="input-mode-tag">${c.input_mode}</span></span>
      </label>
      <p class="capture-text">${escapeHtml(c.raw_text)}</p>
    </li>
  `).join('') || '<li class="empty-hint">No notes captured yet.</li>';

  const distillationsHtml = thread.distillations.slice().reverse().map((d) => renderDistillation(d)).join('')
    || '<p class="empty-hint">No distilled note yet - select the notes above and click "Generate distilled note".</p>';

  const reconciliationsHtml = thread.reconciliations.slice().reverse().map((r) => renderReconciliation(r)).join('');

  const distillationOptions = thread.distillations.slice().reverse().map((d) => `
    <option value="${d.distillation_id}">${formatDate(d.generated_at)}</option>
  `).join('');

  container.innerHTML = `
    <div class="thread-header">
      <h2>${escapeHtml(thread.label)}</h2>
      <span class="thread-created">Started ${formatDate(thread.created_at)}</span>
    </div>

    <section class="panel">
      <h3>Capture</h3>
      <p class="hint">Write however it comes out - tangents, "it's probably nothing but", loose dates. Structure happens later.</p>
      <textarea id="capture-input" rows="4" placeholder="What's going on..."></textarea>
      <div class="capture-controls">
        ${isVoiceSupported() ? `<button type="button" id="mic-btn" data-action="toggle-mic" class="btn btn-secondary">🎙️ Start voice</button>` : ''}
        <button type="button" data-action="submit-capture" class="btn btn-primary">Save note</button>
      </div>
      <p id="voice-interim" class="voice-interim" hidden></p>
    </section>

    <section class="panel">
      <h3>Captured notes (${thread.captures.length})</h3>
      <ul class="capture-list">${capturesHtml}</ul>
      <button type="button" data-action="generate-distillation" class="btn btn-primary" ${thread.captures.length === 0 ? 'disabled' : ''}>Generate distilled note from checked</button>
    </section>

    <section class="panel">
      <h3>Distilled note${thread.distillations.length > 1 ? 's' : ''}</h3>
      ${distillationsHtml}
    </section>

    ${thread.distillations.length > 0 ? `
    <section class="panel">
      <h3>Post-visit reconciliation</h3>
      <p class="hint">Right after the appointment: what actually got covered?</p>
      <form id="reconciliation-form">
        <label class="field-label" for="reconciliation-against">Against distilled note</label>
        <select id="reconciliation-against">${distillationOptions}</select>
        <label class="field-label" for="reconciliation-date">Appointment date</label>
        <input type="date" id="reconciliation-date" value="${new Date().toISOString().slice(0, 10)}">
        <label class="field-label" for="reconciliation-text">What happened</label>
        <textarea id="reconciliation-text" rows="4" placeholder="What did they ask, what did you answer, what got covered, what ran out of time..."></textarea>
        <button type="button" data-action="submit-reconciliation" class="btn btn-primary">Compare against distilled note</button>
      </form>
    </section>` : ''}

    ${reconciliationsHtml ? `<section class="panel"><h3>Reconciliation history</h3>${reconciliationsHtml}</section>` : ''}
  `;
}

function renderDistillation(d) {
  return `
    <div class="distillation-card" data-distillation-id="${d.distillation_id}">
      <div class="distillation-meta">Generated ${formatDate(d.generated_at)} from ${d.source_capture_ids.length} note${d.source_capture_ids.length === 1 ? '' : 's'}</div>

      <h4>Chief concerns</h4>
      <ul>${d.chief_concerns.map((c) => `<li>${escapeHtml(c)}</li>`).join('') || '<li class="empty-hint">None extracted</li>'}</ul>

      <h4>Timeline</h4>
      <p>${escapeHtml(d.timeline)}</p>

      ${(d.factors.aggravating.length || d.factors.relieving.length) ? `
      <h4>Factors</h4>
      ${d.factors.aggravating.length ? `<p><strong>Worse with:</strong> ${d.factors.aggravating.map(escapeHtml).join(', ')}</p>` : ''}
      ${d.factors.relieving.length ? `<p><strong>Better with:</strong> ${d.factors.relieving.map(escapeHtml).join(', ')}</p>` : ''}
      ` : ''}

      <h4>Questions to ask</h4>
      <ul>${d.questions_to_ask.map((q) => `<li>${escapeHtml(q)}</li>`).join('') || '<li class="empty-hint">None extracted</li>'}</ul>

      ${d.flagged_worries.length ? `
      <h4>Worries flagged</h4>
      <ul>${d.flagged_worries.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      ` : ''}

      <button type="button" class="btn btn-secondary" data-action="copy-distillation" data-distillation-id="${d.distillation_id}">Copy note</button>
    </div>
  `;
}

function renderReconciliation(r) {
  const covered = r.items_not_covered.length === 0;
  return `
    <div class="reconciliation-card">
      <div class="distillation-meta">Appointment ${formatDate(r.appointment_date)}</div>
      <p class="reconciliation-text">${escapeHtml(r.raw_text)}</p>
      ${covered
        ? '<p class="all-covered">Everything on the distilled note appears to have been covered.</p>'
        : `
        <h4>Not covered this visit</h4>
        <ul class="not-covered-list">${r.items_not_covered.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        <button type="button" class="btn btn-secondary" data-action="carry-forward" data-reconciliation-id="${r.reconciliation_id}">Carry forward to a new note</button>
      `}
    </div>
  `;
}

// ---------- distillation text for clipboard ----------

function distillationToText(d) {
  const lines = [];
  lines.push('CHIEF CONCERNS');
  d.chief_concerns.forEach((c) => lines.push(`- ${c}`));
  lines.push('', 'TIMELINE', d.timeline);
  if (d.factors.aggravating.length) lines.push('', 'WORSE WITH', ...d.factors.aggravating.map((f) => `- ${f}`));
  if (d.factors.relieving.length) lines.push('', 'BETTER WITH', ...d.factors.relieving.map((f) => `- ${f}`));
  lines.push('', 'QUESTIONS TO ASK');
  d.questions_to_ask.forEach((q) => lines.push(`- ${q}`));
  if (d.flagged_worries.length) {
    lines.push('', 'WORRIES');
    d.flagged_worries.forEach((w) => lines.push(`- ${w}`));
  }
  return lines.join('\n');
}

// ---------- event handlers ----------

async function handleNewThread(event) {
  event.preventDefault();
  const input = document.getElementById('new-thread-label');
  const label = input.value.trim();
  if (!label) return;
  const thread = await db.createThread(label);
  input.value = '';
  document.getElementById('new-thread-form').hidden = true;
  await refreshThreads(false);
  state.activeThreadId = thread.thread_id;
  renderThreadList();
  renderThreadDetail();
}

async function handleSubmitCapture() {
  const thread = activeThread();
  if (!thread) return;
  const textarea = document.getElementById('capture-input');
  const text = textarea.value.trim();
  if (!text) return;
  const mode = state.voiceActive ? 'voice' : 'typed';
  await db.addCapture(thread.thread_id, text, mode);
  await refreshThreads();
  showStatus('Note saved.', 'success');
}

async function handleGenerateDistillation() {
  const thread = activeThread();
  if (!thread) return;
  const checked = Array.from(document.querySelectorAll('.capture-checkbox:checked')).map((el) => el.dataset.captureId);
  if (checked.length === 0) {
    showStatus('Select at least one note to distill.', 'error');
    return;
  }
  const captures = thread.captures.filter((c) => checked.includes(c.capture_id));
  const btn = document.querySelector('[data-action="generate-distillation"]');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const result = await api.distillCaptures(captures);
    await db.addDistillation(thread.thread_id, {
      source_capture_ids: checked,
      ...result,
    });
    await refreshThreads();
    showStatus('Distilled note generated.', 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate distilled note from checked';
  }
}

async function handleCopyDistillation(distillationId) {
  const thread = activeThread();
  const d = thread.distillations.find((x) => x.distillation_id === distillationId);
  if (!d) return;
  try {
    await navigator.clipboard.writeText(distillationToText(d));
    showStatus('Copied to clipboard.', 'success');
  } catch (_) {
    showStatus('Could not copy - your browser may require a manual selection.', 'error');
  }
}

async function handleSubmitReconciliation() {
  const thread = activeThread();
  if (!thread) return;
  const select = document.getElementById('reconciliation-against');
  const dateInput = document.getElementById('reconciliation-date');
  const textArea = document.getElementById('reconciliation-text');
  const distillationId = select.value;
  const rawText = textArea.value.trim();
  if (!rawText) {
    showStatus('Describe what happened at the appointment first.', 'error');
    return;
  }
  const distillation = thread.distillations.find((d) => d.distillation_id === distillationId);
  const btn = document.querySelector('[data-action="submit-reconciliation"]');
  btn.disabled = true;
  btn.textContent = 'Comparing…';
  try {
    const { items_not_covered } = await api.diffReconciliation(distillation, rawText);
    await db.addReconciliation(thread.thread_id, {
      appointment_date: dateInput.value ? new Date(dateInput.value).toISOString() : new Date().toISOString(),
      against_distillation_id: distillationId,
      raw_text: rawText,
      items_not_covered,
    });
    await refreshThreads();
    showStatus('Reconciliation saved.', 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Compare against distilled note';
  }
}

function handleCarryForward(reconciliationId) {
  const thread = activeThread();
  const r = thread.reconciliations.find((x) => x.reconciliation_id === reconciliationId);
  if (!r) return;
  const textarea = document.getElementById('capture-input');
  const seed = r.items_not_covered.map((i) => `- ${i}`).join('\n');
  textarea.value = `Following up from ${formatDate(r.appointment_date)} - still need to raise:\n${seed}\n\n`;
  textarea.focus();
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleToggleMic() {
  const btn = document.getElementById('mic-btn');
  const textarea = document.getElementById('capture-input');
  const interimEl = document.getElementById('voice-interim');

  if (state.voiceActive) {
    state.voice.stop();
    return;
  }

  const baseText = textarea.value ? `${textarea.value.replace(/\s+$/, '')} ` : '';
  try {
    state.voice = createVoiceCapture({
      onResult: (finalTranscript, interim) => {
        textarea.value = baseText + finalTranscript;
        interimEl.hidden = !interim;
        interimEl.textContent = interim;
      },
      onEnd: (finalTranscript) => {
        textarea.value = baseText + finalTranscript;
        state.voiceActive = false;
        interimEl.hidden = true;
        btn.textContent = '🎙️ Start voice';
        btn.classList.remove('recording');
      },
      onError: (code) => {
        showStatus(`Voice input error: ${code}`, 'error');
        state.voiceActive = false;
        btn.textContent = '🎙️ Start voice';
        btn.classList.remove('recording');
      },
    });
    state.voice.start();
    state.voiceActive = true;
    btn.textContent = '⏹ Stop voice';
    btn.classList.add('recording');
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

// ---------- settings dialog ----------

function initSettings() {
  const dialog = document.getElementById('settings-dialog');
  const input = document.getElementById('api-key-input');
  const workspaceInput = document.getElementById('workspace-id-input');

  document.getElementById('settings-btn').addEventListener('click', () => {
    input.value = api.getApiKey();
    workspaceInput.value = api.getWorkspaceId();
    dialog.showModal();
  });
  document.getElementById('settings-close').addEventListener('click', () => dialog.close());
  document.getElementById('settings-save').addEventListener('click', (e) => {
    e.preventDefault();
    api.setApiKey(input.value.trim());
    api.setWorkspaceId(workspaceInput.value.trim());
    dialog.close();
    showStatus('Settings saved.', 'success');
  });
}

// ---------- wiring ----------

function initThreadListControls() {
  document.getElementById('new-thread-btn').addEventListener('click', () => {
    document.getElementById('new-thread-form').hidden = false;
    document.getElementById('new-thread-label').focus();
  });
  document.getElementById('new-thread-cancel').addEventListener('click', () => {
    document.getElementById('new-thread-form').hidden = true;
  });
  document.getElementById('new-thread-form').addEventListener('submit', handleNewThread);

  document.getElementById('thread-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="select-thread"]');
    if (!btn) return;
    state.activeThreadId = btn.dataset.threadId;
    renderThreadList();
    renderThreadDetail();
  });
}

function initThreadDetailDelegation() {
  document.getElementById('thread-detail').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    clearStatus();
    switch (el.dataset.action) {
      case 'toggle-mic':
        handleToggleMic();
        break;
      case 'submit-capture':
        handleSubmitCapture();
        break;
      case 'generate-distillation':
        handleGenerateDistillation();
        break;
      case 'copy-distillation':
        handleCopyDistillation(el.dataset.distillationId);
        break;
      case 'submit-reconciliation':
        handleSubmitReconciliation();
        break;
      case 'carry-forward':
        handleCarryForward(el.dataset.reconciliationId);
        break;
      default:
        break;
    }
  });
}

async function init() {
  initThreadListControls();
  initThreadDetailDelegation();
  initSettings();
  await refreshThreads(false);
}

document.addEventListener('DOMContentLoaded', init);
