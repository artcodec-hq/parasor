import type { AgentState, Session } from "@parasor/shared";
import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";

const COOLDOWN_MS = 4_000;

type SoundKind = "attention" | "completion";

interface UseAgentSoundsOptions {
  activeProjectId: string | null;
  agentStates: Record<string, AgentState>;
  // Gates priming on a real server snapshot. Cache hydration alone keeps this
  // false so warm-boot does not replay attention/completion cues.
  snapshotApplied: boolean;
  playAttentionSound: boolean;
  playCompletionSound: boolean;
  sessions: Session[];
}

interface ShouldPlayAgentSoundOptions {
  activeProjectId: string | null;
  playAttentionSound: boolean;
  playCompletionSound: boolean;
  priorLifecycle?: AgentState["lifecycle"];
  projectId?: string | null;
  state: AgentState;
}

interface AudioContextWindow extends Window {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

export function shouldPlayAgentSound({
  activeProjectId,
  playAttentionSound,
  playCompletionSound,
  priorLifecycle,
  projectId,
  state,
}: ShouldPlayAgentSoundOptions): SoundKind | null {
  if (!projectId || projectId === activeProjectId) return null;
  if (state.confidence !== "high") return null;

  if (state.lifecycle === "waiting") {
    if (!playAttentionSound || priorLifecycle === "waiting") return null;
    return "attention";
  }

  if (state.lifecycle === "completed") {
    if (!playCompletionSound || priorLifecycle === "completed") return null;
    return "completion";
  }

  return null;
}

export function useAgentSounds({
  activeProjectId,
  agentStates,
  snapshotApplied,
  playAttentionSound,
  playCompletionSound,
  sessions,
}: UseAgentSoundsOptions) {
  const initializedRef = useRef(false);
  const prevLifecyclesRef = useRef<Record<string, AgentState["lifecycle"]>>({});
  const cooldownsRef = useRef<Map<string, number>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!playAttentionSound && !playCompletionSound) return;
    if (typeof window === "undefined") return;

    const unlock = () => {
      const context = ensureAudioContext(audioContextRef);
      if (context && context.state === "suspended") {
        void context.resume().catch(() => {});
      }
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [playAttentionSound, playCompletionSound]);

  useEffect(() => {
    const next: Record<string, AgentState["lifecycle"]> = {};
    for (const [sessionId, state] of Object.entries(agentStates)) {
      next[sessionId] = state.lifecycle;
    }

    if (!snapshotApplied) {
      prevLifecyclesRef.current = next;
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      prevLifecyclesRef.current = next;
      return;
    }

    const sessionsById = new Map(
      sessions.map((session) => [session.id, session]),
    );
    const now = Date.now();

    for (const [sessionId, state] of Object.entries(agentStates)) {
      const kind = shouldPlayAgentSound({
        activeProjectId,
        playAttentionSound,
        playCompletionSound,
        priorLifecycle: prevLifecyclesRef.current[sessionId],
        projectId: sessionsById.get(sessionId)?.projectId ?? null,
        state,
      });
      if (!kind) continue;

      const cooldownKey = `${sessionId}:${kind}`;
      const lastPlayedAt = cooldownsRef.current.get(cooldownKey) ?? 0;
      if (now - lastPlayedAt < COOLDOWN_MS) continue;

      const context = ensureAudioContext(audioContextRef);
      if (!context || context.state !== "running") continue;

      playCue(context, kind);
      cooldownsRef.current.set(cooldownKey, now);
    }

    prevLifecyclesRef.current = next;
  }, [
    activeProjectId,
    agentStates,
    snapshotApplied,
    playAttentionSound,
    playCompletionSound,
    sessions,
  ]);
}

function ensureAudioContext(
  ref: MutableRefObject<AudioContext | null>,
): AudioContext | null {
  if (ref.current) return ref.current;
  if (typeof window === "undefined") return null;
  const audioWindow = window as AudioContextWindow;
  const AudioContextCtor =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;
  ref.current = new AudioContextCtor();
  return ref.current;
}

function playCue(context: AudioContext, kind: SoundKind): void {
  const start = context.currentTime + 0.01;
  if (kind === "attention") {
    scheduleTone(context, start, 880, 0.08, 0.035);
    scheduleTone(context, start + 0.14, 988, 0.12, 0.04);
    return;
  }

  scheduleTone(context, start, 659, 0.1, 0.03);
  scheduleTone(context, start + 0.12, 880, 0.16, 0.035);
}

function scheduleTone(
  context: AudioContext,
  startTime: number,
  frequency: number,
  durationSeconds: number,
  peakGain: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + durationSeconds + 0.02);
}
