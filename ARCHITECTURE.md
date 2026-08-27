# My Doctor's Note — Architecture Spec

## Problem
Two conversations exist. One is rich (lived experience, unstructured, tangents that matter). One is sterile (closed questions, time-boxed intake). Information is lost in both directions: what you meant to say and forgot, and what the doctor said that only makes sense after you leave. This tool closes that gap.

## Constraints (locked)
- Local-only storage. No backend, no sync, no account system. Health data never leaves the device.
- Web app, static hosting (GitHub Pages pattern — matches mayhem82/floodwatch, mayhem82.github.io/Darts-Score-System).
- Distillation step is AI-assisted (Claude API call), not rule-based templating.
- No data discarded at any stage — compression is additive (a new derived artifact), never destructive of the raw capture underneath it.

## Three Modules, One Loop

### 1. Capture (pre-visit)
Free-form input. No clinical structure imposed at entry — structure is the distillation module's job, not the capture module's. Capture should not push the user toward "symptom, onset, severity" framing; it should accept the conversation as it actually occurs (tangents, uncertainty, "it's probably nothing but," dates remembered loosely).

**Input modes (recommend building in this order):**
1. Typed free text (MVP — no dependencies, ships first)
2. Voice-to-text (browser SpeechRecognition API — no server round-trip needed)
3. Structured journal entries over time (multiple captures before one visit, e.g. symptom diary)

**Data captured per entry:**
- Raw text
- Timestamp of the capture (not of the symptom — those may differ and both matter)
- Optional tag: which upcoming appointment this belongs to (supports multiple concurrent threads — e.g. one for a GP visit, one for a specialist)

### 2. Distillation (translation layer)
Takes one or more capture entries tied to an appointment and produces the sterile-environment artifact via Claude API call.

**Output structure (the "note" the user brings in):**
- Chief concern(s), prioritized by what the user flagged as most bothering them — not by clinical severity guessing
- Timeline as reconstructed (with uncertainty preserved, e.g. "~3 weeks, possibly longer")
- Aggravating / relieving factors, if mentioned
- Direct questions to ask the doctor, extracted or inferred from the capture
- Anything the user explicitly said they were worried about, verbatim-adjacent (don't sanitize away the emotional content — a fear stated is clinically relevant)

**Critical rule:** the distilled note is a *view*, not a replacement. The raw capture is always retrievable underneath it. Regenerating the distillation must never mutate or delete the raw entries.

### 3. Reconciliation (post-visit)
Quick-entry pass immediately after the appointment: what did they ask, what did you answer, what got covered, what ran out of time.

**Mechanism:**
- Show the pre-visit distilled note side-by-side (or sequentially) with a new free-text or checklist capture of what actually happened
- Diff logic: which items from the distilled note were NOT addressed in the reconciliation entry
- Surface that diff explicitly — "not covered this visit" — and carry it forward as a seed for the next capture thread for this ongoing issue

This reconciliation step is the actual differentiator. Neither the lived conversation nor the sterile one does this alone.

## Data Model (draft — refine in Claude Code)

```json
{
  "threads": [
    {
      "thread_id": "uuid",
      "label": "e.g. knee pain, GP follow-up",
      "created_at": "ISO8601",
      "captures": [
        {
          "capture_id": "uuid",
          "timestamp": "ISO8601",
          "input_mode": "typed | voice",
          "raw_text": "string"
        }
      ],
      "distillations": [
        {
          "distillation_id": "uuid",
          "generated_at": "ISO8601",
          "source_capture_ids": ["uuid"],
          "chief_concerns": ["string"],
          "timeline": "string",
          "factors": { "aggravating": ["string"], "relieving": ["string"] },
          "questions_to_ask": ["string"],
          "flagged_worries": ["string"]
        }
      ],
      "reconciliations": [
        {
          "reconciliation_id": "uuid",
          "appointment_date": "ISO8601",
          "against_distillation_id": "uuid",
          "raw_text": "string",
          "items_not_covered": ["string"]
        }
      ]
    }
  ]
}
```

Storage: browser `localStorage` or `IndexedDB` (IndexedDB preferred once voice transcripts and multiple threads accumulate — localStorage has a ~5-10MB ceiling).

## Explicitly Out of Scope (MVP)
- No AMA (Autonomous Medical Analyst) engine integration at this stage — that's a separate MAYHEM engine and a much heavier clinical-judgment surface. This tool is a *note-taking and translation* aid, not a diagnostic one. Keep the boundary explicit so Claude Code doesn't scope-creep into medical inference.
- No multi-user, no accounts, no cloud sync.
- No PDF export in MVP — plain copy-to-clipboard of the distilled note is sufficient for v1.

## Build Order for Claude Code
1. Typed capture + IndexedDB persistence + thread list UI
2. Distillation call (Claude API) + display of structured note
3. Reconciliation entry + diff surfacing
4. Voice input (SpeechRecognition)
5. GitHub Pages deploy config
