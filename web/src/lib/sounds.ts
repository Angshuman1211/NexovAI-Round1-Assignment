/** Call tones, synthesised with oscillators rather than shipped as audio files.
 *
 *  A ringback tone is two sine waves at 440 and 480 Hz, two seconds on and four
 *  off. That is the real pattern, and it is why the sound reads as "ringing"
 *  rather than as a beep. Kept quiet on purpose: this plays while someone is
 *  recording a demo. */

let ctx: AudioContext | null = null;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

type Burst = { stop: () => void };

/** One burst of paired tones with a soft envelope, so it does not click.
 *  Returns a handle, because a burst already scheduled has to be cut short
 *  when the agent answers mid-ring: otherwise it rings over the greeting. */
function burst(at: number, secs: number, freqs: number[], peak: number): Burst {
  const ac = audio();
  const gain = ac.createGain();
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.04);
  gain.gain.setValueAtTime(peak, at + secs - 0.05);
  gain.gain.linearRampToValueAtTime(0, at + secs);

  const oscs = freqs.map((f) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + secs);
    return osc;
  });

  return {
    stop() {
      const now = ac.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.06);   // fade, never a click
        for (const osc of oscs) osc.stop(now + 0.07);
      } catch {
        /* already finished */
      }
    },
  };
}

/** Ring until the returned function is called. */
export function startRinging(): () => void {
  let stopped = false;
  let current: Burst | null = null;

  const ring = () => {
    if (stopped) return;
    try {
      current = burst(audio().currentTime + 0.01, 2, [440, 480], 0.05);
    } catch {
      /* no audio device, or the context was blocked: the call still works */
    }
  };

  ring();
  const timer = window.setInterval(ring, 6000);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    current?.stop();
    current = null;
  };
}

/** Two short descending notes when the call drops. */
export function playEndTone() {
  try {
    const t = audio().currentTime;
    burst(t + 0.01, 0.14, [480], 0.05);
    burst(t + 0.19, 0.22, [380], 0.05);
  } catch {
    /* audio is decoration here, never a dependency */
  }
}
