"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import "./voice-dock.css";
const H = 48;
const HEIGHTS = [H, H, H, 38, H];
const CORNER = 17;
const BEVEL = 0.44;
const NECK = 7.4;
const PAD = 28;
const DOT = 75;
const WORD = 61;
const WIDTHS = [DOT, 81, 79, DOT, 79];
const VOICE = 1;
const SCREEN = 2;
const EXIT = 3;
const MENU = 4;
const BARS = [0.44, 0.37, 0.96, 0.78, 0.37, 1, 0.37];
const CASCADE = 32;
const LAYERS = 5;
const clamp = (value) => Math.min(1, Math.max(0, value));
const round = (value) => Math.round(value * 100) / 100;
const mix = (from, to, t) => from + (to - from) * t;
let reduce;
const still = () => (reduce ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;
let canvas;
function measure(element, text) {
  if (!element || !text) return 0;
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  const style = getComputedStyle(element);
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return Math.ceil(canvas.measureText(text).width);
}
class Spring {
  x;
  v = 0;
  to;
  next = null;
  at = 0;
  stiffness;
  damping;
  constructor(value, stiffness = 560, damping = 34) {
    this.x = value;
    this.to = value;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  set(to, delay, now) {
    if (delay > 0) {
      this.next = to;
      this.at = now + delay;
    } else {
      this.next = null;
      this.to = to;
    }
  }
  /** One frame; tells whether it still moves. */
  step(dt, now, snap) {
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
function side(w, h, join) {
  const c = H / 2;
  const top = c - h / 2;
  const a = Math.min(CORNER * h / H, w / 2, h / 2);
  const s = Math.min(BEVEL * h, w / 2);
  const n = Math.min(NECK, 0.3 * h);
  const end = [[a, top], [0.6 * a, top], [0, top + 0.6 * a], [0, top + a]];
  const waist = [[s, top], [0.45 * s, top], [0.42 * s, c - n], [0, c - n]];
  return end.map(([dx, y], index) => [mix(dx, waist[index][0], join), mix(y, waist[index][1], join)]);
}
function chain(pieces) {
  if (!pieces.length) return "";
  const p = (x, y) => `${round(x)} ${round(y)}`;
  const m = (y) => H - y;
  const sides = pieces.map((piece) => ({ l: side(piece.w, piece.h, piece.left), r: side(piece.w, piece.h, piece.right) }));
  let d = `M${p(pieces[0].x + sides[0].l[0][0], sides[0].l[0][1])}`;
  pieces.forEach((piece, k) => {
    const { r } = sides[k];
    const xr = piece.x + piece.w;
    d += `L${p(xr - r[0][0], r[0][1])}C${p(xr - r[1][0], r[1][1])} ${p(xr - r[2][0], r[2][1])} ${p(xr, r[3][1])}`;
    const next = pieces[k + 1];
    if (next) {
      const { l } = sides[k + 1];
      d += `L${p(next.x, l[3][1])}C${p(next.x + l[2][0], l[2][1])} ${p(next.x + l[1][0], l[1][1])} ${p(next.x + l[0][0], l[0][1])}`;
    } else {
      d += `L${p(xr, m(r[3][1]))}C${p(xr - r[2][0], m(r[2][1]))} ${p(xr - r[1][0], m(r[1][1]))} ${p(xr - r[0][0], m(r[0][1]))}`;
    }
  });
  for (let k = pieces.length - 1; k >= 0; k--) {
    const piece = pieces[k];
    const { l } = sides[k];
    d += `L${p(piece.x + l[0][0], m(l[0][1]))}C${p(piece.x + l[1][0], m(l[1][1]))} ${p(piece.x + l[2][0], m(l[2][1]))} ${p(piece.x, m(l[3][1]))}`;
    const previous = pieces[k - 1];
    if (previous) {
      const { r } = sides[k - 1];
      const xr = previous.x + previous.w;
      d += `L${p(xr, m(r[3][1]))}C${p(xr - r[2][0], m(r[2][1]))} ${p(xr - r[1][0], m(r[1][1]))} ${p(xr - r[0][0], m(r[0][1]))}`;
    } else {
      d += `L${p(piece.x, l[3][1])}C${p(piece.x + l[2][0], l[2][1])} ${p(piece.x + l[1][0], l[1][1])} ${p(piece.x + l[0][0], l[0][1])}Z`;
    }
  }
  return d;
}
class Motion {
  beads = WIDTHS.map((width, index) => ({ w: new Spring(width), h: new Spring(HEIGHTS[index]), x: 0, base: width }));
  // the bars are livelier springs: they overshoot a little when they jump up
  bars = BARS.map(() => new Spring(3, 1e3, 38));
  voice = 0;
  level = 0;
  talking = false;
  /** when the voice last went on or off: the bars follow one after another */
  switched = -Infinity;
  /** a muted voice bead under the pointer: the bars stir */
  peek = false;
  wordWidth = 0;
  status = null;
  visible = true;
  snap = true;
  raf = 0;
  last = 0;
  /** the elements it draws into, handed over by their refs */
  parts = { row: null, paths: [], stops: [], beads: [], bars: [], word: null };
  layout({ status, enabled, hover, press, widths }) {
    const ended = status === "ended";
    const stagger = this.status !== null && this.status === "ended" !== ended && !still();
    this.status = status;
    const now = performance.now();
    this.beads.forEach((bead, index) => {
      const gone = ended && index > 0;
      const on = !gone && enabled[index];
      const swell = on && press === index ? -3 : on && hover === index ? 1 : 0;
      const delay = stagger && index ? ended ? (4 - index) * 45 : 70 + (index - 1) * 55 : 0;
      bead.base = widths[index];
      bead.w.set(gone ? 0 : widths[index] + (swell > 0 ? 6 : swell), delay, now);
      bead.h.set(gone ? 0 : HEIGHTS[index] + (swell > 0 ? 3 : swell), delay, now);
    });
    this.kick();
  }
  setTalking(on) {
    if (on === this.talking) return;
    this.talking = on;
    this.switched = performance.now();
    this.kick();
  }
  /** a toggled bead squashes and springs back */
  pop(index) {
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
  frame = (now) => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1e3) : 1 / 60;
    this.last = now;
    const snap = this.snap || still();
    this.snap = false;
    let moving = false;
    for (const bead of this.beads) {
      for (const spring of [bead.w, bead.h]) if (spring.step(dt, now, snap)) moving = true;
    }
    this.draw();
    if (this.wave(dt, now, snap) || moving || (this.talking || this.peek) && this.visible) this.kick();
    else this.last = 0;
  };
  /** how much of a bead there is to join: 0 folded away, 1 from half its full size up */
  presence(index) {
    const bead = this.beads[index];
    if (!bead) return 0;
    return clamp(Math.min(bead.w.x / (0.5 * DOT), bead.h.x / (0.5 * H)));
  }
  draw() {
    const { row, paths, stops, beads, word } = this.parts;
    if (!row) return;
    let x = 0;
    const pieces = [];
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
        if (index) node.style.opacity = String(round(clamp((w / (bead.base || DOT) - 0.3) / 0.5)));
      }
      if (w >= 0.5 && h >= 0.5) pieces.push({ x: bead.x, w, h, left: this.presence(index - 1), right: this.presence(index + 1) });
    });
    row.style.width = `${round(x)}px`;
    const d = chain(pieces);
    for (const path of paths) path?.setAttribute("d", d);
    this.beads.forEach((bead, index) => {
      const offset = String(round(x ? clamp((bead.x + Math.max(0, bead.w.x) / 2) / x) : 0));
      stops[index]?.setAttribute("offset", offset);
      stops[index + this.beads.length]?.setAttribute("offset", offset);
    });
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
  wave(dt, now, snap) {
    const target = this.talking ? clamp((typeof this.level === "function" ? this.level() : this.level) || 0) : 0;
    const rate = target > this.voice ? 24 : 7;
    this.voice += (target - this.voice) * (snap ? 1 : 1 - Math.exp(-dt * rate));
    const t = now / 1e3;
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
function put(motion, list, index, node) {
  if (motion) motion.parts[list][index] = node;
}
function VoiceDock({
  status,
  muted = false,
  sharing = false,
  menuOpen = false,
  level = 0,
  armed: armedProp,
  size = 48,
  appearance = "glass",
  onMutedChange,
  onSharingChange,
  onMenuOpenChange,
  onArmedChange,
  onExit,
  labels
}) {
  const live = status === "live";
  const ended = status === "ended";
  const [ownArmed, setOwnArmed] = useState(false);
  if (ended && ownArmed) setOwnArmed(false);
  const armed = !ended && (armedProp ?? ownArmed);
  const [hover, setHover] = useState(-1);
  const [press, setPress] = useState(-1);
  const [stop, setStop] = useState(VOICE);
  const [fonts, setFonts] = useState(0);
  const [word, setWord] = useState(live ? "" : labels[status]);
  if (!live && word !== labels[status]) setWord(labels[status]);
  const [exitWord, setExitWord] = useState(null);
  const motion = useRef(null);
  if (motion.current === null) motion.current = new Motion();
  const slash = useRef(null);
  const toggled = useRef({ muted, sharing, menuOpen });
  const id = useId().replace(/[^\w-]/g, "");
  const enabled = [false, live, live, !ended, !ended];
  const tabStop = enabled[stop] ? stop : enabled.indexOf(true);
  const exitText = armed ? labels.confirm : labels.exit;
  const zoom = size / H;
  const tints = [
    live ? "live" : ended ? "none" : "warn",
    !live ? "none" : muted ? "danger" : "live",
    sharing ? "share" : "none",
    armed ? "danger" : "none",
    menuOpen ? "bright" : "none"
  ];
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
        WIDTHS[MENU]
      ]
    });
  }, [status, live, ended, muted, level, hover, press, word, exitWord, exitText, fonts]);
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
        easing: muted ? "cubic-bezier(0.25, 1, 0.5, 1)" : "cubic-bezier(0.5, 0, 0.75, 0)"
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
    const remeasure = () => setFonts((count) => count + 1);
    document.fonts?.addEventListener("loadingdone", remeasure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", remeasure);
      m.stop();
    };
  }, []);
  const setArmed = (next) => {
    if (armedProp === void 0) setOwnArmed(next);
    onArmedChange?.(next);
  };
  const letGo = useEffectEvent(() => setArmed(false));
  useEffect(() => {
    if (!armed || armedProp !== void 0) return;
    const timer = window.setTimeout(() => letGo(), 4e3);
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
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      if (armed) setArmed(false);
      else if (menuOpen) onMenuOpenChange?.(false);
      else return;
      event.preventDefault();
      return;
    }
    const order = [VOICE, SCREEN, EXIT, MENU].filter((index) => enabled[index]);
    const at = order.indexOf(Number(event.target.dataset.bead));
    const to = event.key === "Home" ? order[0] : event.key === "End" ? order.at(-1) : event.key === "ArrowRight" && at >= 0 ? order[(at + 1) % order.length] : event.key === "ArrowLeft" && at >= 0 ? order[(at - 1 + order.length) % order.length] : void 0;
    if (to === void 0) return;
    event.preventDefault();
    motion.current?.parts.beads[to]?.focus();
  };
  const bead = (index) => ({
    type: "button",
    "data-bead": index,
    disabled: !enabled[index],
    inert: ended,
    tabIndex: index === tabStop ? 0 : -1,
    onFocus: () => setStop(index),
    onPointerEnter: (event) => {
      if (event.pointerType === "mouse") setHover(index);
    },
    onPointerLeave: () => {
      setHover((at) => at === index ? -1 : at);
      setPress((at) => at === index ? -1 : at);
    },
    onPointerDown: (event) => {
      if (event.button === 0) setPress(index);
    },
    onPointerUp: () => setPress(-1),
    onPointerCancel: () => setPress(-1)
  });
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: (node) => {
        if (motion.current) motion.current.parts.row = node;
      },
      className: "vd",
      role: "toolbar",
      "aria-label": labels.dock,
      "data-appearance": appearance,
      "data-status": status,
      "data-talking": live && !muted ? "" : void 0,
      "data-muted": muted ? "" : void 0,
      "data-sharing": sharing ? "" : void 0,
      "data-armed": armed ? "" : void 0,
      "data-menu": menuOpen ? "" : void 0,
      style: { zoom, "--vd-zoom": zoom },
      onKeyDown,
      children: [
        /* @__PURE__ */ jsxs("svg", { className: "vd-surface", "aria-hidden": "true", children: [
          /* @__PURE__ */ jsxs("defs", { children: [
            /* @__PURE__ */ jsx("linearGradient", { id: `${id}-tint`, children: tints.map((tint, index) => /* @__PURE__ */ jsx("stop", { className: "vd-tint-stop", "data-tint": tint, ref: (node) => put(motion.current, "stops", index, node) }, index)) }),
            /* @__PURE__ */ jsx("linearGradient", { id: `${id}-rim`, children: tints.map((tint, index) => /* @__PURE__ */ jsx("stop", { className: "vd-rim-stop", "data-tint": tint, ref: (node) => put(motion.current, "stops", index + tints.length, node) }, index)) }),
            /* @__PURE__ */ jsxs("linearGradient", { id: `${id}-sheen`, x1: "0", y1: "0", x2: "0", y2: "1", children: [
              /* @__PURE__ */ jsx("stop", { offset: "0", className: "vd-sheen-top" }),
              /* @__PURE__ */ jsx("stop", { offset: "0.5", className: "vd-sheen-middle" }),
              /* @__PURE__ */ jsx("stop", { offset: "1", className: "vd-sheen-bottom" })
            ] }),
            /* @__PURE__ */ jsx("clipPath", { id: `${id}-clip`, children: /* @__PURE__ */ jsx("path", { ref: (node) => put(motion.current, "paths", LAYERS - 1, node) }) })
          ] }),
          /* @__PURE__ */ jsx("path", { className: "vd-body", ref: (node) => put(motion.current, "paths", 0, node) }),
          /* @__PURE__ */ jsx("path", { className: "vd-tint", fill: `url(#${id}-tint)`, ref: (node) => put(motion.current, "paths", 1, node) }),
          /* @__PURE__ */ jsx("path", { className: "vd-sheen", fill: `url(#${id}-sheen)`, ref: (node) => put(motion.current, "paths", 2, node) }),
          /* @__PURE__ */ jsx(
            "path",
            {
              className: "vd-rim",
              stroke: `url(#${id}-rim)`,
              clipPath: `url(#${id}-clip)`,
              ref: (node) => put(motion.current, "paths", 3, node)
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "vd-bead vd-status", ref: (node) => put(motion.current, "beads", 0, node), children: [
          /* @__PURE__ */ jsx("span", { className: "vd-bokeh", "aria-hidden": "true", children: [0, 1, 2, 3, 4, 5, 6].map((index) => /* @__PURE__ */ jsx("i", {}, index)) }),
          /* @__PURE__ */ jsx("span", { className: "vd-dot" }),
          /* @__PURE__ */ jsx(
            "span",
            {
              className: "vd-word",
              "aria-hidden": "true",
              ref: (node) => {
                if (motion.current) motion.current.parts.word = node;
              },
              children: word
            }
          ),
          /* @__PURE__ */ jsx("span", { className: "vd-sr", role: "status", children: labels[status] })
        ] }),
        /* @__PURE__ */ jsxs(
          "button",
          {
            ...bead(VOICE),
            ref: (node) => put(motion.current, "beads", VOICE, node),
            className: "vd-bead vd-voice",
            "aria-label": labels.mute,
            "aria-pressed": muted,
            onClick: () => onMutedChange?.(!muted),
            children: [
              /* @__PURE__ */ jsx("span", { className: "vd-wave", children: BARS.map((_, index) => /* @__PURE__ */ jsx("i", { ref: (node) => put(motion.current, "bars", index, node) }, index)) }),
              /* @__PURE__ */ jsx("svg", { className: "vd-slash", ref: slash, viewBox: "0 0 40 40", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M11 9L29 31", pathLength: 1 }) }),
              /* @__PURE__ */ jsx("span", { className: "vd-tip", "aria-hidden": "true", children: muted ? labels.unmute : labels.mute })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            ...bead(SCREEN),
            ref: (node) => put(motion.current, "beads", SCREEN, node),
            className: "vd-bead vd-screen",
            "aria-label": labels.share,
            "aria-pressed": sharing,
            onClick: () => onSharingChange?.(!sharing),
            children: [
              /* @__PURE__ */ jsxs("span", { className: "vd-window", children: [
                /* @__PURE__ */ jsx("i", {}),
                /* @__PURE__ */ jsx("i", {}),
                /* @__PURE__ */ jsx("i", {})
              ] }),
              /* @__PURE__ */ jsx("span", { className: "vd-tip", "aria-hidden": "true", children: sharing ? labels.unshare : labels.share })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            ...bead(EXIT),
            ref: (node) => put(motion.current, "beads", EXIT, node),
            className: "vd-bead vd-exit",
            "aria-label": armed ? labels.confirmExit : void 0,
            onClick: pressExit,
            onBlur: () => {
              if (armed) setArmed(false);
            },
            children: /* @__PURE__ */ jsx("span", { className: "vd-word", ref: setExitWord, children: exitText }, exitText)
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            ...bead(MENU),
            ref: (node) => put(motion.current, "beads", MENU, node),
            className: "vd-bead vd-menu",
            "aria-label": labels.more,
            "aria-haspopup": "menu",
            "aria-expanded": menuOpen,
            onClick: () => onMenuOpenChange?.(!menuOpen),
            children: [
              /* @__PURE__ */ jsxs("span", { className: "vd-grid", children: [
                /* @__PURE__ */ jsx("i", {}),
                /* @__PURE__ */ jsx("i", {}),
                /* @__PURE__ */ jsx("i", {}),
                /* @__PURE__ */ jsx("i", {})
              ] }),
              /* @__PURE__ */ jsx("span", { className: "vd-tip", "aria-hidden": "true", children: labels.more })
            ]
          }
        )
      ]
    }
  );
}
export {
  VoiceDock
};
