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
- **Seeding localStorage:** the app flushes its in-memory state on
  `pagehide`, and closing leftover tabs flushes too — a seed written from
  another page gets clobbered. The reliable way is
  `Page.addScriptToEvaluateOnNewDocument` (guard with a sessionStorage
  flag), which runs before the app boots and reads storage.
- Close stale CDP tabs (`/json/close/<id>`) before a scenario; leftover
  app tabs hold timers that re-save old state.
- Worktrees: symlink the main checkout's `node_modules` into the worktree
  (`ln -s <repo>/node_modules node_modules`) instead of reinstalling.
