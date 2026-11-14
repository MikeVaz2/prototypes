// AR session lifecycle as a small state machine. Pure: no DOM, no WebXR. The scene state is never part of it: it lives in app.js and survives every transition.
// States: preview (no session) | starting (session requested) | reticle (session up, finding a surface) | placed (session up, model placed) | paused (session lost, waiting for a tap)
// Events:
//   start        user tapped Enter AR                  resume       user tapped the "AR paused" toast
//   started      requestSession + setSession resolved  startFailed  requestSession rejected
//   place        model placed on a surface             exit         user ended AR (Exit button)
//   sessionEnd   the session ended and the user did not ask for it (app switch, recorder panel, notification, system)
//   dismiss      user closed the paused toast
// step(state, event) -> { state, fx[] }. Effects: 'keep-state' (nothing is cleared), 'toast-paused', 'clear-toast', 'request-session',
// 'rebuild' (rebuild the model from state and show it), 'to-preview' (restore the preview view).
export const STATES = ['preview', 'starting', 'reticle', 'placed', 'paused'];
export const PAUSED_TEXT = 'AR paused, tap to resume';

export function step(state, ev) {
  const to = (s, ...fx) => ({ state: s, fx });
  switch (state) {
    case 'preview':
      if (ev === 'start') return to('starting', 'request-session');
      break;
    case 'starting':
      if (ev === 'started') return to('reticle');
      if (ev === 'startFailed') return to('preview', 'to-preview');
      if (ev === 'sessionEnd') return to('paused', 'keep-state', 'to-preview', 'toast-paused');
      break;
    case 'reticle':
      if (ev === 'place') return to('placed', 'rebuild');
      if (ev === 'exit') return to('preview', 'to-preview');
      if (ev === 'sessionEnd') return to('paused', 'keep-state', 'to-preview', 'toast-paused');
      break;
    case 'placed':
      if (ev === 'exit') return to('preview', 'to-preview');
      if (ev === 'sessionEnd') return to('paused', 'keep-state', 'to-preview', 'toast-paused');
      break;
    case 'paused':
      if (ev === 'resume' || ev === 'start') return to('starting', 'clear-toast', 'request-session');
      if (ev === 'dismiss') return to('preview', 'clear-toast');
      break;
    default: break;
  }
  return { state, fx: [] };   // not valid here: ignored
}

export function createLifecycle(onChange = () => {}) {
  let state = 'preview';
  return {
    get state() { return state; },
    send(ev) { const r = step(state, ev), was = state; state = r.state; if (was !== state || r.fx.length) onChange({ from: was, to: state, ev, fx: r.fx }); return r; },
    inSession: () => state === 'reticle' || state === 'placed' || state === 'starting',
  };
}
