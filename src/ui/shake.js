import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";

/**
 * Shake `target` while the pointer (or keyboard focus) is on `trigger`. The
 * shake ramps up quickly on arrival and dies away gradually after, slowing as
 * it settles. `strength` scales how far it moves (1 = the Resume link's
 * jitter) and `speed` how fast (lower reads as a wobble rather than a shake).
 *
 * Returns `{ settle, dispose }`: settle() lets it die away (e.g. when a menu
 * closes under the pointer); dispose() stops it and removes the listeners.
 */
export function shakeOnHover(trigger, target = trigger, { strength = 1, speed = 1 } = {}) {
  const shake = { strength: 0 };
  const setX = gsap.quickSetter(target, "x", "px");
  const setY = gsap.quickSetter(target, "y", "px");
  const setRotation = gsap.quickSetter(target, "rotation", "deg");
  let phase = 0;
  let running = false;

  function tick(time, deltaMs) {
    const s = shake.strength * strength;
    phase += (deltaMs / 1000) * (0.4 + 0.6 * shake.strength) * speed; // slows down as it fades
    // A few out-of-step waves, so it jitters rather than swings.
    setX(s * (1.5 * Math.sin(phase * 53) + 0.6 * Math.sin(phase * 31 + 1)));
    setY(s * 0.7 * Math.sin(phase * 41 + 2));
    setRotation(s * (2 * Math.sin(phase * 47 + 0.5) + 0.7 * Math.sin(phase * 23)));
  }

  function stop() {
    gsap.ticker.remove(tick);
    running = false;
    gsap.set(target, { x: 0, y: 0, rotation: 0 });
  }

  function start() {
    if (reduceMotion()) return;
    if (!running) {
      running = true;
      gsap.ticker.add(tick);
    }
    gsap.to(shake, { strength: 1, duration: 0.18, ease: "power2.out", overwrite: true });
  }

  function settle() {
    if (!running) return;
    // sine.inOut tapers off evenly rather than stopping short.
    gsap.to(shake, { strength: 0, duration: 0.9, ease: "sine.inOut", overwrite: true, onComplete: stop });
  }

  const onFocus = () => trigger.matches(":focus-visible") && start();
  trigger.addEventListener("pointerenter", start);
  trigger.addEventListener("pointerleave", settle);
  trigger.addEventListener("focus", onFocus);
  trigger.addEventListener("blur", settle);

  return {
    settle,
    dispose() {
      trigger.removeEventListener("pointerenter", start);
      trigger.removeEventListener("pointerleave", settle);
      trigger.removeEventListener("focus", onFocus);
      trigger.removeEventListener("blur", settle);
      gsap.killTweensOf(shake);
      stop();
    },
  };
}
