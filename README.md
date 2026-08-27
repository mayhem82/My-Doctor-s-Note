# My Doctor's Note

A local-first tool for closing the gap between the conversation you actually have about your health (unstructured, full of tangents that matter) and the one a doctor's visit has time for (closed questions, time-boxed). See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design spec.

Three steps, one loop, per health issue ("thread"):

1. **Capture** — jot or speak free-form notes before a visit, whenever something comes to mind. No structure imposed at entry.
2. **Distill** — turn one or more captures into a structured pre-visit note (chief concerns, timeline, factors, questions to ask, worries) via a Claude API call.
3. **Reconcile** — right after the visit, note what actually happened. The app diffs it against the distilled note and surfaces what didn't get covered, so it carries forward into your next note for that issue.

## Running it

No build step. Serve the folder statically and open it:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a modern browser (IndexedDB and the Clipboard API work from `file://` in most browsers, though a local server is more reliable).

On first use, open **Settings** (⚙️ in the header) and paste an Anthropic API key. It's needed for the Distill and Reconcile steps, which call `api.anthropic.com` directly from the browser.

## Privacy model

- All health data (notes, distilled notes, reconciliations) is stored only in this browser's IndexedDB. Nothing is synced, and there's no account system.
- The Distill and Reconcile steps send the relevant note text directly to Anthropic's API from your browser, using the key you provide. That's the one point where data leaves the device — no other backend is involved.
- The API key itself lives in this browser's `localStorage`. Anyone with access to this browser/device can read it back out — don't use this on a shared or public computer, and treat the key like a password.

## Browser support

- Voice capture uses the Web Speech API (`SpeechRecognition`), which is Chrome/Edge/Safari-only as of writing. The app falls back to typed-only capture where it's unavailable.
- Everything else (IndexedDB, `fetch`, Clipboard API, `<dialog>`) works in any current evergreen browser.

## Deploying to GitHub Pages

This is a plain static site (no build step, no framework) — the same pattern as `mayhem82/floodwatch` and `mayhem82.github.io/Darts-Score-System`. In the repo's **Settings → Pages**, set the source to deploy from the `main` branch, root folder. `.nojekyll` is included so GitHub Pages serves the files as-is.

## Explicitly out of scope (MVP)

- No diagnostic or clinical-judgment inference of any kind — this is a note-taking and translation aid only.
- No multi-user support, no accounts, no cloud sync.
- No PDF export — copy-to-clipboard is sufficient for v1.

See `ARCHITECTURE.md` for the full spec and data model.
