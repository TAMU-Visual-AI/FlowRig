// In-the-Wild section: a sequence selector + [input | overlay wipe (one frame, draggable vertical divider) |
// interactive 4D mesh + skeleton] that share one time bar. Assets per case live in static/in_the_wild/<case>/
// (thumb.jpg, raw.mp4, overlay.mp4, demo4d.bin, case.json), written by for_wild/export_wild_web.py; raw and overlay
// are pixel-aligned (same size), so they stack directly. The case order comes from static/in_the_wild/manifest.json.
// Nothing is fetched until the section gets close to the viewport.
import { hasWebGL, AnimatedMesh, AnimatedSkeleton, View4DGroup } from './viewer4d.js';
import { fetchOk, BlobVideoLoader, SyncedTimeline } from './media-sync.js';
import { setupCompareSlider } from './compare-slider.js';

const TAG_HIDE_PCT = 15;   // hide a layer's corner tag once the divider leaves it less than this much of the frame

const ROOT = './static/in_the_wild/';

const $ = (s) => document.querySelector(s);

// case.json + demo4d.bin (positions uint16 [T,V,3] | joints float32 [T,J,3] | faces uint16 [F,3]) -> the 4D view
function loadDemo4D(group, info, buffer) {
  const d = info.demo4d;
  const T = info.n_frames, V = d.n_verts, F = d.n_faces, J = d.n_joints, B = d.n_bones;
  if (d.joints.offset !== T * V * 3 * 2 || d.faces.offset !== d.joints.offset + T * J * 3 * 4 ||
      buffer.byteLength !== d.faces.offset + F * 3 * 2 || d.bones.length !== B) {
    throw new Error(`demo4d.bin layout does not match case.json (${info.id})`);
  }
  const positions = new Uint16Array(buffer, d.positions.offset, T * V * 3);
  const joints = new Float32Array(buffer, d.joints.offset, T * J * 3);
  const faces = new Uint16Array(buffer, d.faces.offset, F * 3);
  const bones = d.bones.flat();
  const frames = Array.from({ length: T }, (_, t) => ({ joints: joints.subarray(t * J * 3, (t + 1) * J * 3), bones }));
  group.setContents([{ mesh: new AnimatedMesh(positions, faces, T, V),
    skeleton: new AnimatedSkeleton(frames, d.joint_radius, d.bone_radius) }]);
  group.setHome(d.camera.eye_dir, d.camera.up, positions);   // starts from the frame-0 video camera
}

function initInTheWild() {
  const section = $('#in-the-wild');
  if (!section) return;
  const ui = {
    selector: $('#itw-selector'), count: $('#itw-count'), title: $('#itw-title'), meta: $('#itw-meta'),
    loading: $('#itw-3d-loading'), reset: $('#itw-reset'), fullscreen: $('#itw-fullscreen'), stage3d: $('#itw-3d'),
  };
  const raw = $('#itw-raw'), overlay = $('#itw-overlay');
  const tagRaw = $('#itw-tag-raw'), tagOverlay = $('#itw-tag-overlay');
  setupCompareSlider($('#itw-compare'), {
    handle: $('#itw-compare-handle'),
    onChange: (pct) => {
      tagRaw.classList.toggle('is-hidden', pct < TAG_HIDE_PCT);
      tagOverlay.classList.toggle('is-hidden', pct > 100 - TAG_HIDE_PCT);
    },
  });
  // without WebGL the two videos and the timeline still work; the 4D panel says why it is empty
  const group = hasWebGL() ? new View4DGroup([ui.stage3d]) : null;
  if (!group) ui.loading.textContent = 'The interactive 4D view needs WebGL.';
  const videos = new BlobVideoLoader();
  const timeline = new SyncedTimeline({
    videos: [raw, overlay],
    ui: { play: $('#itw-play'), playIcon: $('#itw-play-icon'), playLabel: $('#itw-play-label'), restart: $('#itw-restart'),
      timeline: $('#itw-timeline'), frame: $('#itw-frame'), speed: $('#itw-speed'), status: $('#itw-status') },
    observe: $('#itw-shell'),
    onFrame: (k) => { if (group) group.setFrame(k); },
    onVisible: () => { if (group) group.start(); },
    onHidden: () => { if (group) group.stop(); },
    extraControls: group ? [ui.reset] : [],
  });
  let cases = [];
  let index = 0;

  function renderSelector() {
    ui.selector.innerHTML = cases.map((c, i) => `
      <button type="button" class="itw-card" data-index="${i}" aria-pressed="${i === index}" aria-label="Show ${c.label}">
        <img src="${ROOT}${c.dir}/thumb.jpg" alt="" width="384" height="216" loading="lazy">
        <span class="itw-card__label">${c.label}</span>
        <span class="itw-card__check" aria-hidden="true">${i === index ? '✓' : ''}</span>
      </button>`).join('');
    ui.count.textContent = `SEQUENCE ${String(index + 1).padStart(2, '0')} / ${String(cases.length).padStart(2, '0')}`;
  }

  function loadCase(i) {
    index = i;
    renderSelector();
    const c = cases[i];
    const dir = `${ROOT}${c.dir}/`;
    const token = timeline.beginLoad(`Loading ${c.label}…`);
    ui.title.textContent = c.label;
    ui.meta.textContent = '';
    ui.loading.hidden = false;
    fetchOk(`${dir}case.json`, 'json').then((info) => {
      if (!timeline.isCurrent(token)) return null;
      return Promise.all([
        group ? fetchOk(dir + info.files.demo4d, 'arrayBuffer') : null,
        videos.load(raw, dir + info.files.raw, dir + info.files.thumb),
        videos.load(overlay, dir + info.files.overlay, null),
      ]).then(([buffer]) => {
        if (!timeline.isCurrent(token)) return;
        const d = info.demo4d;
        if (group) loadDemo4D(group, info, buffer);
        ui.meta.textContent = `${d.n_joints} joints · ${d.n_bones} bones · ${info.n_frames} frames @ ${info.fps} fps`;
        ui.loading.hidden = !!group;
        videos.release([dir + info.files.raw, dir + info.files.overlay]);   // previous case's clips
        timeline.setReady(token, info.fps, info.n_frames, 'Input, overlay and 4D view share one timeline');
      });
    }).catch((err) => {
      if (timeline.isCurrent(token)) ui.loading.hidden = !!group;
      timeline.fail(token, `Could not load ${c.label} (${err.message}). Select it again to retry.`);
    });
  }

  ui.selector.addEventListener('click', (e) => {
    const b = e.target.closest('[data-index]');
    if (b && Number(b.dataset.index) !== index) loadCase(Number(b.dataset.index));
  });
  ui.reset.addEventListener('click', () => { if (group) group.resetView(); });
  ui.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (ui.stage3d.requestFullscreen) ui.stage3d.requestFullscreen();
  });

  // fetch nothing until the section is close to the viewport
  const lazy = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    lazy.disconnect();
    fetchOk(`${ROOT}manifest.json`, 'json').then((m) => {
      cases = m.cases;
      loadCase(0);
    }).catch((err) => { $('#itw-status').textContent = `Could not load the sequence list (${err.message}).`; });
  }, { rootMargin: '800px 0px' });
  lazy.observe(section);
}

initInTheWild();
