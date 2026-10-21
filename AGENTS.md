# Voice Dock — notes for coding agents

`<VoiceDock>` is a React component: the control bar of a live voice session (status, microphone, screen, Exit, More), drawn as beads on one thread. It only draws and reports presses. The call, the microphone, screen sharing and the menu stay in the app.

## Install

`npm i github:Likemiens/voice-dock`, then `import { VoiceDock } from "@likemiens/voice-dock"`: JavaScript with its types, and it imports its CSS itself. Or copy `voice-dock.tsx` and `voice-dock.css` into the app, side by side, and import from `./voice-dock`. It starts with `"use client"` and needs React 19.2 or newer (`useEffectEvent`), nothing else. `example.tsx` is a complete, typed usage.

## Contract

```tsx
import { VoiceDock, type VoiceDockLabels, type VoiceDockStatus, type VoiceDockSize, type VoiceDockAppearance } from "@likemiens/voice-dock";

<VoiceDock
  status={status}     // required: "connecting" | "live" | "reconnecting" | "ended"
  labels={labels}     // required: VoiceDockLabels, 13 strings
  muted={muted}       // false: a slash across the waveform
  sharing={sharing}   // false: the window lights up
  menuOpen={open}     // false: turns the More dots; the menu is the app's
  level={read}        // 0: a number 0…1, or () => 0…1 read every animation frame
  armed={armed}       // leave it out and the dock keeps it, letting go after 4 s
  size={48}           // 36 | 42 | 48: the height of a bead
  appearance="glass"  // "glass" (tinted smoked glass, lit icons) | "flat" (plain grey)
  onMutedChange={(muted) => {}}
  onSharingChange={(sharing) => {}}
  onMenuOpenChange={(open) => {}} // also on Esc while the menu is open
  onArmedChange={(armed) => {}}
  onExit={() => {}}               // the second press of Exit
/>
```

Labels: `dock connecting live reconnecting ended mute unmute share unshare exit confirm confirmExit more`. Colours: `--vd-surface --vd-glass --vd-ink --vd-quiet --vd-live --vd-warn --vd-danger --vd-share --vd-focus`, on the dock or any parent; each look has its own fallbacks (`--vd-surface` is the flat body, `--vd-glass` the glass one). Keyboard: ← → Home End move between the beads, Enter and Space press, Esc takes Exit back or else closes the menu.

## Recipes

**Level from a MediaStream** (`getUserMedia`, or the local track of a WebRTC call). A stable function the dock reads every frame; nothing re-renders:

```tsx
function useLevel(stream: MediaStream | null) {
  const read = useRef<() => number>(() => 0);
  useEffect(() => {
    if (!stream) return;
    const audio = new AudioContext(); // create it after a user gesture, or it stays suspended
    const analyser = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    read.current = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += ((value - 128) / 128) ** 2;
      return Math.sqrt(sum / data.length) * 4; // 4 is the gain: tune it to the microphone
    };
    return () => {
      read.current = () => 0;
      void audio.close();
    };
  }, [stream]);
  return useCallback(() => read.current(), []);
}
```

**A call SDK.** Map its connection state to `status`, and change the state only once the SDK has done it. `call` below stands for your SDK:

```tsx
onMutedChange={(next) => call.setMicrophoneEnabled(!next).then(() => setMuted(next))}
onSharingChange={(next) => call.setScreenShareEnabled(next).then(() => setSharing(next), () => {})} // a closed picker changes nothing
onExit={() => call.leave()} // then set status to "ended"
```

Sharing can also stop from the browser's own "Stop sharing" bar: listen for the track's `ended` event and set `sharing` to false.

**Your own menu.** When `menuOpen` is true, render it next to the dock. Wrap both in a `position: relative; display: inline-flex` box and place the menu at `position: absolute; right: 0; bottom: calc(100% + 12px)`: More is the last bead. The bead has `aria-haspopup="menu"` and `aria-expanded`. Closing on an outside click, on a choice and on Esc inside the menu is yours. The dock only calls `onMenuOpenChange(false)` from its own bead and from Esc while focus is in the dock.

## Gotchas

- **It is controlled.** The dock keeps no state for `muted`, `sharing` or `menuOpen`: a press only calls back. If you don't pass the new value in, nothing changes.
- **`level`:** for live audio, pass a function; a number means re-rendering the parent for every value. It is read only while the status is live and the microphone is on, and it is clamped to 0…1.
- **`armed`:** leave it out, or own it fully by passing `armed` and setting it from `onArmedChange`. Controlled, the 4 s timeout is yours; Esc, focus leaving Exit and the second press still call `onArmedChange(false)`.
- **`"ended"`** folds the dock into its first bead and makes every button inert, so focus leaves the dock: move it somewhere useful, such as a rejoin button. Any other status unfolds it. Until `"live"`, the microphone and screen beads are disabled.
- **`size`** is 36, 42 or 48 only: the dock is drawn at 48 px and scaled with CSS `zoom`. Use `size` rather than a transform, so tooltips keep their size.
- Only the nine `--vd-*` colours are variables. The tooltips (`#232b35`, or dark glass in the glass look, with white text), the glass rim and sheen and the window's dots are fixed in voice-dock.css.
- **`appearance="glass"`** is dark by nature, like a phone's dark controls: it reads on a light page too, but it is made for a dark one. On a light app with a light toolbar, `"flat"` is the quieter choice.
- `font-family: var(--ui-font)` in voice-dock.css is a variable of the author's site. Without it, the dock inherits the page's font.
- **Next.js:** the App Router is fine; render the dock from a client component, because it takes functions. The Pages Router allows global CSS only in `pages/_app`: move `import "./voice-dock.css"` there.

## Don't

- Don't redraw the beads with rounded rectangles or CSS borders: the outline is one SVG path, measured from a reference.
- Don't write words into the component: pass `labels`. Screen readers rely on `dock`, `live` and `confirmExit`.
- Don't drive `level` with `setState` 60 times a second.
- Don't scale the dock with `transform` or `zoom` from outside: use `size`.
