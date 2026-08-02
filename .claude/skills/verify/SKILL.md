---
name: verify
description: Build, launch, and drive the Quick Braille Fox app to verify a change end-to-end (headless Chrome over CDP against the Vite dev server).
---

# Verifying changes to Quick Braille Fox

The surface is a browser GUI (Vite + React, real `<input>` for typing).
There is no Playwright/puppeteer in the repo; use the installed Google
Chrome headless with raw CDP (node >= 22 has global `fetch`/`WebSocket`,
no deps needed).

## Launch

```bash
./scripts/dev.sh > /tmp/vite.log 2>&1 &   # note the port it prints (5173+, first free)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9223 \
  --user-data-dir="$(mktemp -d)" --no-first-run about:blank &
curl -s http://127.0.0.1:9223/json/version   # webSocketDebuggerUrl
```

Connect a WebSocket to `webSocketDebuggerUrl`, then `Target.createTarget`,
`Target.attachToTarget` (`flatten: true`), `Page.enable` / `Runtime.enable`,
and drive everything with `Runtime.evaluate` (`returnByValue`,
`awaitPromise`) + `Page.captureScreenshot`.

## Driving the app

- Type into the drill: set `.drill-input`'s value via the native setter and
  dispatch an `InputEvent` (React ignores plain `.value =`):

  ```js
  const input = document.querySelector('.drill-input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    .set.call(input, v);
  input.dispatchEvent(new InputEvent('input', { bubbles: true,
    inputType: backspace ? 'deleteContentBackward' : 'insertText' }));
  ```

- Read state from the DOM: prompt text at `.prompt .visually-hidden`,
  active skills at `.learning-skill` (`.learning-print` for the print form;
  the score lives in the progressbar's `aria-valuenow`/`aria-label`),
  hint at `.hint`, totals at `.overall`, group rows at `.group-row`.
- Progress persists in localStorage key `qbf-progress-v1`
  (envelope `{ version, tutor, bestQbf, introducedSkillIds }`).

## Gotchas

- The score-0 auto-hint fires 400 ms after a prompt appears — read/act fast
  or expect `hintShown` behaviour.
- **Reaching `src/core` from the page:** `Runtime.evaluate` runs a classic
  script, so a dynamic `import()` in the expression fails with
  `SyntaxError: Unexpected token 'import'`. Inject a module script instead
  and park the namespace on `window`, then use `window.__core` from later
  evaluates (`awaitPromise: true` on this one):

  ```js
  new Promise((resolve) => {
    if (window.__core) { resolve(true); return; }
    window.__coreReady = () => resolve(true);
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = "import * as core from '/src/core/index.ts';"
      + " window.__core = core; window.__coreReady();";
    document.head.appendChild(s);
  })
  ```

  Vite serves the TS entry, so the `/src/core/index.ts` URL is correct as
  written. Re-inject after every navigation — `window.__core` dies with the
  document.

- **Seeding localStorage:** the app flushes its in-memory state on
  `pagehide`, and closing leftover tabs flushes too — a seed written from
  another page gets clobbered. The fix is to hand the seed over in
  sessionStorage (which the app never touches, and which survives a
  same-tab navigation) and let a new-document script move it into
  localStorage. Register once, after attaching:

  ```js
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const cmd = sessionStorage.getItem('__seed');
    if (cmd) {
      sessionStorage.removeItem('__seed');
      if (cmd === 'CLEAR') localStorage.clear();
      else localStorage.setItem('qbf-progress-v1', cmd);
    }
  ` });
  ```

  Then, from the current page, set the command and navigate:

  ```js
  // Start clean:
  await evaluate(`sessionStorage.setItem('__seed', 'CLEAR'); true`);
  await goto(APP);

  // Or seed a specific round (needs window.__core, see above):
  await evaluate(`(() => {
    const core = window.__core;
    const state = core.makeTutorState({
      seed: 7, promptCounter: 1,
      prompt: core.makePrompt({ text: 'the dog', targetSkillId: 'letter-d' }),
    });
    sessionStorage.setItem('__seed', JSON.stringify({
      version: 1, tutor: core.serialize(state), bestQbf: null,
      inputMode: 'emulated',
    }));
  })(); true`);
  await goto(APP);
  ```

  The ordering is the whole point: the new-document script runs *after* the
  outgoing page's `pagehide` flush and *before* the app boots, which is the
  only window in which a write to localStorage survives.
- Close stale CDP tabs (`/json/close/<id>`) before a scenario; leftover
  app tabs hold timers that re-save old state.
- Worktrees: symlink the main checkout's `node_modules` into the worktree
  (`ln -s <repo>/node_modules node_modules`) instead of reinstalling.
