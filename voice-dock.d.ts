import "./voice-dock.css";
export type VoiceDockStatus = "connecting" | "live" | "reconnecting" | "ended";
/** The height of a bead, px. The whole dock scales with it. */
export type VoiceDockSize = 36 | 42 | 48;
export type VoiceDockAppearance = "glass" | "flat";
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
    /** the screen is shared: the window lights up */
    sharing?: boolean;
    /** the menu bead is open; the menu itself is yours to render */
    menuOpen?: boolean;
    /** the voice, 0…1. A function is read every frame, so a meter re-renders nothing. */
    level?: number | (() => number);
    /** Exit waits for its second press. Leave it out and the dock keeps it, letting go after 4 s. */
    armed?: boolean;
    /** the height of a bead, 48 by default */
    size?: VoiceDockSize;
    /** tinted smoked glass with lit icons ("glass", the default) or plain grey ("flat") */
    appearance?: VoiceDockAppearance;
    onMutedChange?: (muted: boolean) => void;
    onSharingChange?: (sharing: boolean) => void;
    onMenuOpenChange?: (open: boolean) => void;
    onArmedChange?: (armed: boolean) => void;
    /** the second press of Exit; set status to "ended" to fold the dock */
    onExit?: () => void;
    labels: VoiceDockLabels;
};
export declare function VoiceDock({ status, muted, sharing, menuOpen, level, armed: armedProp, size, appearance, onMutedChange, onSharingChange, onMenuOpenChange, onArmedChange, onExit, labels, }: VoiceDockProps): import("react/jsx-runtime").JSX.Element;
