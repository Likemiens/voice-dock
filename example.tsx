"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { VoiceDock, type VoiceDockLabels, type VoiceDockStatus } from "./voice-dock";

const labels: VoiceDockLabels = {
  dock: "Voice session",
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  ended: "Ended",
  mute: "Mute",
  unmute: "Unmute",
  share: "Share screen",
  unshare: "Stop sharing",
  exit: "Exit",
  confirm: "Sure?",
  confirmExit: "Confirm exit",
  more: "More",
};

// Stands in for a microphone: phrases with pauses, 0…1. The dock calls it every frame.
const fakeLevel = () => {
  const t = performance.now() / 1000;
  return Math.max(0, Math.sin(t * 1.2)) * (0.6 + 0.4 * Math.sin(t * 11));
};

// The menu is yours. More is the last bead, so the menu lines up with the right edge of the dock.
const menu: CSSProperties = { position: "absolute", right: 0, bottom: "calc(100% + 12px)", display: "grid", minWidth: 164, padding: 5, borderRadius: 16, background: "#fff", boxShadow: "0 0 0 1px rgb(35 43 53 / 10%)" };
const item: CSSProperties = { padding: "8px 10px", border: 0, borderRadius: 11, background: "none", font: "inherit", textAlign: "left", cursor: "pointer" };

export function VoiceDockExample() {
  const [status, setStatus] = useState<VoiceDockStatus>("connecting");
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // pretend the call connects after a moment
  useEffect(() => {
    if (status !== "connecting") return;
    const timer = setTimeout(() => setStatus("live"), 1200);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <VoiceDock
        status={status}
        muted={muted}
        sharing={sharing}
        menuOpen={menuOpen}
        level={fakeLevel}
        labels={labels}
        onMutedChange={setMuted}
        onSharingChange={setSharing}
        onMenuOpenChange={setMenuOpen}
        onExit={() => {
          setMenuOpen(false);
          setStatus("ended");
        }}
      />
      {menuOpen && (
        <div style={menu}>
          {["Transcript", "Settings", "Report a problem"].map((name) => (
            <button key={name} type="button" style={item} onClick={() => setMenuOpen(false)}>{name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
