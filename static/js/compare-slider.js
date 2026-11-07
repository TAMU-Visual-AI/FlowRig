// Before/after wipe for two pixel-aligned videos stacked in one frame (after the comparison handle on
// code-video-model.github.io, with a vertical divider instead of a tilted one). The top layer is clipped to the left of
// the divider; the frame's --split custom property (a percentage) drives the clip, the line and the handle in CSS.
// Drag anywhere on the frame (mouse: press jumps the divider there; touch: only after a horizontal move, so vertical
// page scrolling still works) or use the arrow keys / Home / End on the handle.
export function setupCompareSlider(frame, { handle, onChange = null, initial = 50 } = {}) {
  if (!frame || !handle) throw new Error('setupCompareSlider needs the frame and its handle');
  let value = initial;
  let drag = null;

  function setValue(next) {
    value = Math.max(0, Math.min(100, next));
    frame.style.setProperty('--split', `${value}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
    if (onChange) onChange(value);
  }
  function fromX(x) {
    const box = frame.getBoundingClientRect();
    const ratio = (x - box.left) / box.width;
    setValue(ratio <= 0.02 ? 0 : ratio >= 0.98 ? 100 : ratio * 100);   // snap to a single layer near the edges
  }

  frame.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, touch: e.pointerType !== 'mouse', moved: false };
    frame.setPointerCapture(e.pointerId);
    if (!drag.touch) { fromX(e.clientX); frame.classList.add('is-dragging'); }
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.touch && !drag.moved && Math.abs(e.clientX - drag.x) < 6) return;
    drag.moved = true;
    frame.classList.add('is-dragging');
    fromX(e.clientX);
  });
  const finish = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (frame.hasPointerCapture(e.pointerId)) frame.releasePointerCapture(e.pointerId);
    drag = null;
    frame.classList.remove('is-dragging');
  };
  frame.addEventListener('pointerup', finish);
  frame.addEventListener('pointercancel', finish);
  frame.addEventListener('lostpointercapture', () => { drag = null; frame.classList.remove('is-dragging'); });
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2;
    const keys = { ArrowLeft: value - step, ArrowDown: value - step, ArrowRight: value + step, ArrowUp: value + step,
      PageDown: value - 10, PageUp: value + 10, Home: 0, End: 100 };
    if (e.key in keys) { e.preventDefault(); setValue(keys[e.key]); }
  });
  setValue(initial);
  return { setValue, get value() { return value; } };
}
