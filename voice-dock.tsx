"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import "./voice-dock.css";

// The control bar of a live voice session — connection, microphone, screen, exit and a menu — drawn as beads
// on one thread. Neighbouring beads meet at a waist: each bead bevels down to it with an S-curve (see side()),
// and the outer ends are rounded. Widths and heights ride on springs: a bead swells under the pointer and
// bounces when it is toggled, Exit stretches to its question, and an ended session folds every bead into the
// first, each end rounding off as its neighbour goes. The script draws the outline into one SVG path; the
// buttons on top carry the icons, the words, the focus ring and everything a screen reader hears.

export type VoiceDockStatus = "connecting" | "live" | "reconnecting" | "ended";

/** The height of a bead, px. The whole dock scales with it. */
export type VoiceDockSize = 36 | 42 | 48;

/** Every word the dock shows or says to a screen reader. */
export type VoiceDockLabels = {
  /** the name of the toolbar */
  dock: string;
  connecting: string;
  /** said, not shown: a live session shows only its dot */
  live: string;
  reconnecting: string;
  ended: string;
  mute: string;
  unmute: string;
  share: string;
  unshare: string;
  exit: string;
  /** the Exit bead after its first press */
  confirm: string;
  confirmExit: string;
  more: string;
};

export type VoiceDockProps = {
  /** the session, shown by the dot and its word; "ended" folds every bead into the first */
  status: VoiceDockStatus;
  /** the microphone is off: a slash is drawn across the waveform */
  muted?: boolean;
  /** the screen is shared: the window turns green */
  sharing?: boolean;
  /** the menu bead is open; the menu itself is yours to render */
  menuOpen?: boolean;
  /** the voice, 0…1. A function is read every frame, so a meter re-renders nothing. */
  level?: number | (() => number);
  /** Exit waits for its second press. Leave it out and the dock keeps it, letting go after 4 s. */
  armed?: boolean;
  /** the height of a bead, 48 by default */
  size?: VoiceDockSize;
  onMutedChange?: (muted: boolean) => void;
  onSharingChange?: (sharing: boolean) => void;
  onMenuOpenChange?: (open: boolean) => void;
  onArmedChange?: (armed: boolean) => void;
  /** the second press of Exit; set status to "ended" to fold the dock */
  onExit?: () => void;
  labels: VoiceDockLabels;
};

// Measured from the reference at 48px: icon beads are 48 high and Exit 38; the waist is 15 across; a bevel
// reaches 0.44 of a bead's height into it; an outer end rounds off over 17px. Other sizes zoom all of it.
const H = 48;
const HEIGHTS = [H, H, H, 38, H];
const CORNER = 17;
const BEVEL = 0.44;
const NECK = 7.4; // half the waist
const PAD = 28; // either side of the Exit word, from waist to waist
const DOT = 75; // the status bead with its dot alone
const WORD = 61; // the status bead around its word: the padding, the dot and the space after it
const WIDTHS = [DOT, 81, 79, DOT, 79];
const VOICE = 1;
const SCREEN = 2;
const EXIT = 3;
const MENU = 4;
const BARS = [0.44, 0.37, 0.96, 0.78, 0.37, 1, 0.37]; // the resting shape of the waveform
const CASCADE = 32; // ms between two bars as the slash crosses them

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 100) / 100;
const mix = (from: number, to: number, t: number) => from + (to - from) * t;

let reduce: MediaQueryList | undefined;
const still = () => (reduce ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;

let canvas: CanvasRenderingContext2D | null | undefined;
/** The width of a word in the font its element has, without laying anything out. */
function measure(element: Element | null, text: string) {
  if (!element || !text) return 0;
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  const style = getComputedStyle(element);
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return Math.ceil(canvas.measureText(text).width);
}

/** A value that follows its target like a weight on a spring; a delayed target waits, for staggered folds. */
class Spring {
  x: number;
  v = 0;
  to: number;
  next: number | null = null;
  at = 0;
  stiffness: number;
  damping: number;

  constructor(value: number, stiffness = 560, damping = 34) {
    this.x = value;
    this.to = value;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  set(to: number, delay: number, now: number) {
    if (delay > 0) {
      this.next = to;
      this.at = now + delay;
    } else {
      this.next = null;
      this.to = to;
    }
  }

  /** One frame; tells whether it still moves. */
  step(dt: number, now: number, snap: boolean) {
    if (this.next !== null && now >= this.at) {
      this.to = this.next;
      this.next = null;
    }
    if (snap) {
      this.x = this.to;
      this.v = 0;
    } else {
      for (let left = dt; left > 0; left -= 1 / 240) {
        const d = Math.min(left, 1 / 240);
        this.v += (this.stiffness * (this.to - this.x) - this.damping * this.v) * d;
        this.x += this.v * d;
      }
      if (Math.abs(this.to - this.x) < 0.01 && Math.abs(this.v) < 0.01) {
        this.x = this.to;
        this.v = 0;
      }
    }
    return this.x !== this.to || this.next !== null;
  }
}

/**
 * The upper half of one side of a bead w × h, as four points of a cubic from the top edge to the side:
 * [inset from the side, y]. Alone (join 0) it is a rounded end; next to a bead (join 1) it bevels down to the
 * waist, where the neighbour's bevel meets it. In between it is both at once, so an end rounds off smoothly
 * while its neighbour folds away.
 */
function side(w: number, h: number, join: number): [number, number][] {
  const c = H / 2;
  const top = c - h / 2;
  const a = Math.min((CORNER * h) / H, w / 2, h / 2);
  const s = Math.min(BEVEL * h, w / 2);
  const n = Math.min(NECK, 0.3 * h);
  const end: [number, number][] = [[a, top], [0.6 * a, top], [0, top + 0.6 * a], [0, top + a]];
  const waist: [number, number][] = [[s, top], [0.45 * s, top], [0.42 * s, c - n], [0, c - n]];
  return end.map(([dx, y], index) => [mix(dx, waist[index][0], join), mix(y, waist[index][1], join)]);
}

/** One bead as a closed, clockwise outline. A joined side reaches 0.6px past its edge, under the neighbour,
 *  so the two leave no hairline where they meet. */
function outline(x: number, w: number, h: number, joinLeft: number, joinRight: number) {
  const mirror = (y: number) => H - y;
  const p = (px: number, py: number) => `${round(px)} ${round(py)}`;
  const l = side(w, h, joinLeft);
  const r = side(w, h, joinRight);
  const xl = x;
  const xr = x + w;
  const ol = 0.6 * joinLeft;
  const or = 0.6 * joinRight;
  return (
    `M${p(xl + l[0][0], l[0][1])}` +
    `L${p(xr - r[0][0], r[0][1])}` +
    `C${p(xr - r[1][0], r[1][1])} ${p(xr - r[2][0], r[2][1])} ${p(xr - r[3][0], r[3][1])}` +
    `L${p(xr + or, r[3][1])}L${p(xr + or, mirror(r[3][1]))}L${p(xr, mirror(r[3][1]))}` +
    `C${p(xr - r[2][0], mirror(r[2][1]))} ${p(xr - r[1][0], mirror(r[1][1]))} ${p(xr - r[0][0], mirror(r[0][1]))}` +
    `L${p(xl + l[0][0], mirror(l[0][1]))}` +
    `C${p(xl + l[1][0], mirror(l[1][1]))} ${p(xl + l[2][0], mirror(l[2][1]))} ${p(xl + l[3][0], mirror(l[3][1]))}` +
    `L${p(xl - ol, mirror(l[3][1]))}L${p(xl - ol, l[3][1])}L${p(xl, l[3][1])}` +
    `C${p(xl + l[2][0], l[2][1])} ${p(xl + l[1][0], l[1][1])} ${p(xl + l[0][0], l[0][1])}Z`
  );
}

type Parts = {
  row: HTMLDivElement | null;
  shape: SVGPathElement | null;
  beads: (HTMLElement | null)[];
  bars: (HTMLElement | null)[];
  word: HTMLSpanElement | null;
};

type Layout = {
  status: VoiceDockStatus;
  /** the beads that take a press */
  enabled: boolean[];
  hover: number;
  press: number;
  widths: number[];
};

/** Everything that moves, outside React: springs, the outline and the waveform, one frame at a time. */
class Motion {
  beads = WIDTHS.map((width, index) => ({ w: new Spring(width), h: new Spring(HEIGHTS[index]), x: 0, base: width }));
  // the bars are livelier springs: they overshoot a little when they jump up
  bars = BARS.map(() => new Spring(3, 1000, 38));
  voice = 0;
  level: number | (() => number) = 0;
  talking = false;
  /** when the voice last went on or off: the bars follow one after another */
  switched = -Infinity;
  /** a muted voice bead under the pointer: the bars stir */
  peek = false;
  wordWidth = 0;
  status: VoiceDockStatus | null = null;
  visible = true;
  snap = true;
  raf = 0;
  last = 0;
  /** the elements it draws into, handed over by their refs */
  parts: Parts = { row: null, shape: null, beads: [], bars: [], word: null };

  layout({ status, enabled, hover, press, widths }: Layout) {
    const ended = status === "ended";
    // folding goes from the far end towards the dot, unfolding the other way
    const stagger = this.status !== null && (this.status === "ended") !== ended && !still();
    this.status = status;
    const now = performance.now();
    this.beads.forEach((bead, index) => {
      const gone = ended && index > 0;
      const on = !gone && enabled[index];
      const swell = on && press === index ? -3 : on && hover === index ? 1 : 0;
      const delay = stagger && index ? (ended ? (4 - index) * 45 : 70 + (index - 1) * 55) : 0;
      bead.base = widths[index];
      bead.w.set(gone ? 0 : widths[index] + (swell > 0 ? 6 : swell), delay, now);
      bead.h.set(gone ? 0 : HEIGHTS[index] + (swell > 0 ? 3 : swell), delay, now);
    });
    this.kick();
  }

  setTalking(on: boolean) {
    if (on === this.talking) return;
    this.talking = on;
    this.switched = performance.now();
    this.kick();
  }

  /** a toggled bead squashes and springs back */
  pop(index: number) {
    const bead = this.beads[index];
    if (!bead || still()) return;
    bead.h.v -= 150;
    bead.w.v += 110;
    this.kick();
  }

  kick = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  frame = (now: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const snap = this.snap || still();
    this.snap = false;
    let moving = false;
    for (const bead of this.beads) {
      for (const spring of [bead.w, bead.h]) if (spring.step(dt, now, snap)) moving = true;
    }
    this.draw();
    // a change always plays out; only the endless flutter of a voice rests off the screen
    if (this.wave(dt, now, snap) || moving || ((this.talking || this.peek) && this.visible)) this.kick();
    else this.last = 0;
  };

  /** how much of a bead there is to join: 0 folded away, 1 from half its full size up */
  presence(index: number) {
    const bead = this.beads[index];
    if (!bead) return 0;
    return clamp(Math.min(bead.w.x / (0.5 * DOT), bead.h.x / (0.5 * H)));
  }

  draw() {
    const { row, shape, beads, word } = this.parts;
    if (!row) return;
    let x = 0;
    let d = "";
    this.beads.forEach((bead, index) => {
      const w = Math.max(0, bead.w.x);
      const h = Math.max(0, bead.h.x);
      bead.x = x;
      x += w;
      const node = beads[index];
      if (node) {
        node.style.transform = `translate(${round(bead.x)}px, ${round((H - h) / 2)}px)`;
        node.style.width = `${round(w)}px`;
        node.style.height = `${round(h)}px`;
        // a folding bead lets its icon go before it is gone
        if (index) node.style.opacity = String(round(clamp((w / (bead.base || DOT) - 0.3) / 0.5)));
      }
      if (w < 0.5 || h < 0.5) return;
      d += outline(bead.x, w, h, this.presence(index - 1), this.presence(index + 1));
    });
    row.style.width = `${round(x)}px`;
    shape?.setAttribute("d", d);

    // The status word opens with its bead: 0 is the dot alone, 1 the dot and the whole word.
    if (word) {
      const span = this.wordWidth + WORD - DOT;
      const open = span > 0 ? clamp((this.beads[0].w.x - DOT) / span) : 0;
      word.style.width = `${round(open * this.wordWidth)}px`;
      word.style.marginLeft = `${round(open * 9)}px`;
      word.style.opacity = String(round(open));
    }
    if (!("ready" in row.dataset)) row.dataset.ready = "";
  }

  /** The bars follow the voice with a little flutter each. They go on and off one after another, left to
   *  right, in step with the slash; off the air they lie down as dots. */
  wave(dt: number, now: number, snap: boolean) {
    const target = this.talking ? clamp((typeof this.level === "function" ? this.level() : this.level) || 0) : 0;
    const rate = target > this.voice ? 24 : 7;
    this.voice += (target - this.voice) * (snap ? 1 : 1 - Math.exp(-dt * rate));
    const t = now / 1000;
    const calm = still();
    let moving = !calm && now - this.switched < CASCADE * BARS.length;
    this.parts.bars.forEach((bar, index) => {
      const late = calm ? 0 : now - this.switched - index * CASCADE;
      const on = this.talking ? late >= 0 : late < 0;
      let value = 0;
      if (on) {
        const flutter = calm ? 1 : 0.62 + 0.38 * Math.sin(t * (6.3 + index * 1.9) + index * 2.4);
        const idle = calm ? 0.1 : 0.09 + 0.05 * Math.sin(t * 2.6 - index * 0.9);
        value = Math.max(idle, Math.min(1, this.voice * BARS[index] * flutter * 1.2));
      } else if (this.peek && !calm) {
        value = 0.06 + 0.05 * Math.sin(t * 7 - index * 0.8);
      }
      const spring = this.bars[index];
      spring.set(3 + 24 * value, 0, now);
      if (spring.step(dt, now, snap)) moving = true;
      if (bar) bar.style.height = `${round(Math.max(2, spring.x))}px`;
    });
    return moving;
  }
}

type Lists = "beads" | "bars";

/** Hands an element to the motion as its ref is set. */
function put<K extends Lists>(motion: Motion | null, list: K, index: number, node: Parts[K][number]) {
  if (motion) motion.parts[list][index] = node;
}

export function VoiceDock({
  status,
  muted = false,
  sharing = false,
  menuOpen = false,
  level = 0,
  armed: armedProp,
  size = 48,
  onMutedChange,
  onSharingChange,
  onMenuOpenChange,
  onArmedChange,
  onExit,
  labels,
}: VoiceDockProps) {
  const live = status === "live";
  const ended = status === "ended";
  const [ownArmed, setOwnArmed] = useState(false);
  if (ended && ownArmed) setOwnArmed(false);
  const armed = !ended && (armedProp ?? ownArmed);
  const [hover, setHover] = useState(-1);
  const [press, setPress] = useState(-1);
  const [stop, setStop] = useState(VOICE);
  const [fonts, setFonts] = useState(0);
  // the status bead keeps its word while it shrinks back to the dot
  const [word, setWord] = useState(live ? "" : labels[status]);
  if (!live && word !== labels[status]) setWord(labels[status]);
  const [exitWord, setExitWord] = useState<HTMLSpanElement | null>(null);
  const motion = useRef<Motion>(null);
  if (motion.current === null) motion.current = new Motion();
  const slash = useRef<SVGSVGElement>(null);
  const toggled = useRef({ muted, sharing, menuOpen });

  const enabled = [false, live, live, !ended, !ended];
  // one stop for Tab; the arrows move along the beads
  const tabStop = enabled[stop] ? stop : enabled.indexOf(true);
  const exitText = armed ? labels.confirm : labels.exit;
  // Every size is the 48px dock zoomed: the geometry stays in its own pixels, the words are measured in them.
  const zoom = size / H;

  useLayoutEffect(() => {
    const m = motion.current;
    if (!m) return;
    if (!live) m.wordWidth = measure(m.parts.word, word);
    m.level = level;
    m.setTalking(live && !muted);
    m.peek = live && muted && hover === VOICE;
    m.layout({
      status,
      enabled: [false, live, live, !ended, !ended],
      hover,
      press,
      widths: [
        live ? DOT : WORD + m.wordWidth,
        WIDTHS[VOICE],
        WIDTHS[SCREEN],
        Math.max(DOT, measure(exitWord, exitText) + 2 * PAD),
        WIDTHS[MENU],
      ],
    });
  }, [status, live, ended, muted, level, hover, press, word, exitWord, exitText, fonts]);

  // A toggle answers with a bounce of its bead; muting draws the slash in, unmuting sweeps it out the far end.
  useEffect(() => {
    const m = motion.current;
    const was = toggled.current;
    toggled.current = { muted, sharing, menuOpen };
    if (!m) return;
    if (was.sharing !== sharing) m.pop(SCREEN);
    if (was.menuOpen !== menuOpen) m.pop(MENU);
    if (was.muted === muted) return;
    m.pop(VOICE);
    if (still() || !slash.current) return;
    const frames = muted ? [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }] : [{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }];
    for (const path of slash.current.querySelectorAll("path")) {
      path.animate(frames, {
        duration: muted ? 300 : 240,
        easing: muted ? "cubic-bezier(0.25, 1, 0.5, 1)" : "cubic-bezier(0.5, 0, 0.75, 0)",
      });
    }
  }, [muted, sharing, menuOpen]);

  useEffect(() => {
    const m = motion.current;
    if (!m) return;
    const observer = new IntersectionObserver(([entry]) => {
      m.visible = entry.isIntersecting;
      if (m.visible) m.kick();
    });
    if (m.parts.row) observer.observe(m.parts.row);
    // words are measured in their font; when it arrives, they are measured again
    const remeasure = () => setFonts((count) => count + 1);
    document.fonts?.addEventListener("loadingdone", remeasure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", remeasure);
      m.stop();
    };
  }, []);

  const setArmed = (next: boolean) => {
    if (armedProp === undefined) setOwnArmed(next);
    onArmedChange?.(next);
  };
  const letGo = useEffectEvent(() => setArmed(false));
  useEffect(() => {
    if (!armed || armedProp !== undefined) return;
    const timer = window.setTimeout(() => letGo(), 4000);
    return () => window.clearTimeout(timer);
  }, [armed, armedProp]);

  const pressExit = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onExit?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (armed) setArmed(false);
      else if (menuOpen) onMenuOpenChange?.(false);
      else return;
      event.preventDefault();
      return;
    }
    const order = [VOICE, SCREEN, EXIT, MENU].filter((index) => enabled[index]);
    const at = order.indexOf(Number((event.target as HTMLElement).dataset.bead));
    const to =
      event.key === "Home"
        ? order[0]
        : event.key === "End"
          ? order.at(-1)
          : event.key === "ArrowRight" && at >= 0
            ? order[(at + 1) % order.length]
            : event.key === "ArrowLeft" && at >= 0
              ? order[(at - 1 + order.length) % order.length]
              : undefined;
    if (to === undefined) return;
    event.preventDefault();
    motion.current?.parts.beads[to]?.focus();
  };

  const bead = (index: number) => ({
    type: "button" as const,
    "data-bead": index,
    disabled: !enabled[index],
    inert: ended,
    tabIndex: index === tabStop ? 0 : -1,
    onFocus: () => setStop(index),
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === "mouse") setHover(index);
    },
    onPointerLeave: () => {
      setHover((at) => (at === index ? -1 : at));
      setPress((at) => (at === index ? -1 : at));
    },
    onPointerDown: (event: PointerEvent) => {
      if (event.button === 0) setPress(index);
    },
    onPointerUp: () => setPress(-1),
    onPointerCancel: () => setPress(-1),
  });

  return (
    <div
      ref={(node) => {
        if (motion.current) motion.current.parts.row = node;
      }}
      className="vd"
      role="toolbar"
      aria-label={labels.dock}
      data-status={status}
      data-talking={live && !muted ? "" : undefined}
      data-muted={muted ? "" : undefined}
      data-sharing={sharing ? "" : undefined}
      data-armed={armed ? "" : undefined}
      data-menu={menuOpen ? "" : undefined}
      style={{ zoom, "--vd-zoom": zoom } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <svg className="vd-surface" aria-hidden="true">
        <path
          ref={(node) => {
            if (motion.current) motion.current.parts.shape = node;
          }}
        />
      </svg>

      <div className="vd-bead vd-status" ref={(node) => put(motion.current, "beads", 0, node)}>
        <span className="vd-dot" />
        <span
          className="vd-word"
          aria-hidden="true"
          ref={(node) => {
            if (motion.current) motion.current.parts.word = node;
          }}
        >
          {word}
        </span>
        <span className="vd-sr" role="status">
          {labels[status]}
        </span>
      </div>

      <button
        {...bead(VOICE)}
        ref={(node) => put(motion.current, "beads", VOICE, node)}
        className="vd-bead vd-voice"
        aria-label={labels.mute}
        aria-pressed={muted}
        onClick={() => onMutedChange?.(!muted)}
      >
        <span className="vd-wave">
          {BARS.map((_, index) => (
            <i key={index} ref={(node) => put(motion.current, "bars", index, node)} />
          ))}
        </span>
        <svg className="vd-slash" ref={slash} viewBox="0 0 40 40" aria-hidden="true">
          <path className="vd-slash-cut" d="M11 9L29 31" pathLength={1} />
          <path className="vd-slash-line" d="M11 9L29 31" pathLength={1} />
        </svg>
        <span className="vd-tip" aria-hidden="true">
          {muted ? labels.unmute : labels.mute}
        </span>
      </button>

      <button
        {...bead(SCREEN)}
        ref={(node) => put(motion.current, "beads", SCREEN, node)}
        className="vd-bead vd-screen"
        aria-label={labels.share}
        aria-pressed={sharing}
        onClick={() => onSharingChange?.(!sharing)}
      >
        <span className="vd-window">
          <i />
          <i />
          <i />
        </span>
        <span className="vd-tip" aria-hidden="true">
          {sharing ? labels.unshare : labels.share}
        </span>
      </button>

      <button
        {...bead(EXIT)}
        ref={(node) => put(motion.current, "beads", EXIT, node)}
        className="vd-bead vd-exit"
        aria-label={armed ? labels.confirmExit : undefined}
        onClick={pressExit}
        onBlur={() => {
          if (armed) setArmed(false);
        }}
      >
        <span className="vd-word" key={exitText} ref={setExitWord}>
          {exitText}
        </span>
      </button>

      <button
        {...bead(MENU)}
        ref={(node) => put(motion.current, "beads", MENU, node)}
        className="vd-bead vd-menu"
        aria-label={labels.more}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => onMenuOpenChange?.(!menuOpen)}
      >
        <span className="vd-grid">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="vd-tip" aria-hidden="true">
          {labels.more}
        </span>
      </button>
    </div>
  );
}
