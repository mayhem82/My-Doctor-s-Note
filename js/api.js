// Client-side call to the Claude Messages API. No backend: the browser
// talks directly to api.anthropic.com using a key the user supplies and
// stores themselves (see Settings). This means the key is visible to
// anyone with access to this browser/device - that's the tradeoff of the
// "no backend, no account system" constraint. See README for details.

const API_KEY_STORAGE_KEY = 'doctorsNote.anthropicApiKey';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

export function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
}

export function setApiKey(key) {
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}

async function callClaude(userContent, schema) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Add one in Settings first.');
  }

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calling the Messages API directly from a browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: userContent }],
        output_config: {
          format: { type: 'json_schema', schema },
        },
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach the Claude API: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text();
    let message = `Claude API error (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error && parsed.error.message) message = parsed.error.message;
    } catch (_) {
      // body wasn't JSON - keep the generic message
    }
    if (res.status === 401) message = 'Invalid Anthropic API key. Check Settings.';
    throw new Error(message);
  }

  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude API returned no text content.');
  return JSON.parse(textBlock.text);
}

const DISTILLATION_SCHEMA = {
  type: 'object',
  properties: {
    chief_concerns: { type: 'array', items: { type: 'string' } },
    timeline: { type: 'string' },
    factors: {
      type: 'object',
      properties: {
        aggravating: { type: 'array', items: { type: 'string' } },
        relieving: { type: 'array', items: { type: 'string' } },
      },
      required: ['aggravating', 'relieving'],
      additionalProperties: false,
    },
    questions_to_ask: { type: 'array', items: { type: 'string' } },
    flagged_worries: { type: 'array', items: { type: 'string' } },
  },
  required: ['chief_concerns', 'timeline', 'factors', 'questions_to_ask', 'flagged_worries'],
  additionalProperties: false,
};

export async function distillCaptures(captures) {
  const capturesText = captures
    .map((c) => `[${c.timestamp}]\n${c.raw_text}`)
    .join('\n\n---\n\n');

  const prompt = `You are helping a patient prepare for a doctor's appointment. Below are one or more free-form notes they wrote to themselves before the visit - unstructured, possibly rambling, with tangents and uncertain dates. Do not impose clinical framing they didn't use themselves; distill what's there.

Produce a structured note with:
- chief_concerns: what's bothering them most, ordered by what THEY emphasized, not by guessed clinical severity
- timeline: a reconstructed timeline as a single readable string, preserving stated uncertainty (e.g. "~3 weeks, possibly longer") rather than inventing precision
- factors: aggravating and relieving factors they mentioned, if any (empty arrays if none mentioned - do not invent factors)
- questions_to_ask: direct questions to ask the doctor, extracted or reasonably inferred from what they wrote
- flagged_worries: things they explicitly said they were worried about, kept close to their own words - don't sanitize away emotional content, a stated fear is clinically relevant

Patient's notes:

${capturesText}`;

  return callClaude(prompt, DISTILLATION_SCHEMA);
}

const RECONCILIATION_SCHEMA = {
  type: 'object',
  properties: {
    items_not_covered: { type: 'array', items: { type: 'string' } },
  },
  required: ['items_not_covered'],
  additionalProperties: false,
};

export async function diffReconciliation(distillation, reconciliationText) {
  const noteItems = [
    ...distillation.chief_concerns.map((c) => `Chief concern: ${c}`),
    ...distillation.questions_to_ask.map((q) => `Question to ask: ${q}`),
    ...distillation.flagged_worries.map((w) => `Worry: ${w}`),
  ];

  const prompt = `Before a doctor's appointment, the patient prepared this list of things they intended to raise:

${noteItems.map((i) => `- ${i}`).join('\n')}

After the appointment, they wrote this account of what actually happened / was discussed:

"""
${reconciliationText}
"""

Compare the two. List, in items_not_covered, the exact items from the pre-visit list above (copy their original wording after the colon) that do NOT appear to have been addressed or discussed in the post-visit account. Only include an item if you're reasonably confident it was not covered - if the post-visit account is ambiguous about an item, do not include it. Return an empty array if everything was covered.`;

  return callClaude(prompt, RECONCILIATION_SCHEMA);
}
