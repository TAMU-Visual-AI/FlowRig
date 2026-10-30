// Dynamic Reconstruction section: animated Texverse test meshes. Columns = GT / Ours / Puppeteer; rows = the
// rendered video (Orbit or Front, toggled; both are prefetched so switching is instant and keeps the frame) and the
// interactive 4D view. The videos and the three 4D views share one time bar, and the 4D views share one camera
// (rotate / pan / zoom any of them and the others follow).
// Assets per case: static/dynamic_recon/<uuid>/ (thumb.jpg, {front,orbit}/{gt,ours,puppeteer}.mp4, mesh4d.bin,
// skeletons.json, case.json), written by skt/mytool/export_dynamic_web.py; order from static/dynamic_recon/manifest.json.
import { hasWebGL, AnimatedMesh, AnimatedSkeleton, View4DGroup } from './viewer4d.js';
import { fetchOk, BlobVideoLoader, SyncedTimeline } from './media-sync.js';

const ROOT = './static/dynamic_recon/';
const METHODS = ['gt', 'ours', 'puppeteer'];
const VIEWS = ['orbit', 'front'];
// cases kept on disk and in manifest.json but not shown on the page (delete an entry to show it again)
const HIDDEN = new Set([
  'ed0b0d8e0e1943198c7d95eb72189fe5',
  'ee7c8d71b0d04c97b3c4a67359b8eaf4',
]);

const $ = (s) => document.querySelector(s);

// skeletons.json frames [{j: flat xyz, b: flat (parent, child)}] -> AnimatedSkeleton frames
function skeletonFrames(frames, T) {
  if (frames.length !== T) throw new Error(`skeleton has ${frames.length} frames, expected ${T}`);
  return frames.map((f) => ({ joints: Float32Array.from(f.j), bones: Int32Array.from(f.b) }));
}

function initDynamicRecon() {
  const section = $('#dynamic-recon');
  if (!section) return;
  const ui = {
    selector: $('#dyn-selector'), count: $('#dyn-count'), title: $('#dyn-title'), meta: $('#dyn-meta'),
    reset: $('#dyn-reset'), viewButtons: Array.from(section.querySelectorAll('[data-dyn-view]')),
  };
  const overlays = Array.from(section.querySelectorAll('.dyn-3d-loading'));
  const showOverlays = (on) => overlays.forEach((o) => { o.hidden = !on; });
  const video = Object.fromEntries(METHODS.map((m) => [m, $(`#dyn-video-${m}`)]));
  const stages = METHODS.map((m) => $(`#dyn-3d-${m}`));
  const group = hasWebGL() ? new View4DGroup(stages, { background: 0xffffff }) : null;
  if (!group) overlays.forEach((o) => { o.textContent = 'The interactive 4D views need WebGL.'; });
  const loader = new BlobVideoLoader();
  const timeline = new SyncedTimeline({
    videos: METHODS.map((m) => video[m]),   // GT is the master clock
    ui: { play: $('#dyn-play'), playIcon: $('#dyn-play-icon'), playLabel: $('#dyn-play-label'), restart: $('#dyn-restart'),
      timeline: $('#dyn-timeline'), frame: $('#dyn-frame'), speed: $('#dyn-speed'), status: $('#dyn-status') },
    observe: $('#dyn-shell'),
    onFrame: (k) => { if (group) group.setFrame(k); },
    onVisible: () => { if (group) group.start(); },
    onHidden: () => { if (group) group.stop(); },
    extraControls: group ? [ui.reset] : [],
  });
  let cases = [];
  let index = 0;
  let view = 'orbit';
  let shown = null;   // { dir, files, view } of the clips currently attached

  const attachView = (dir, files, v) => Promise.all(METHODS.map((m) => loader.attach(video[m], dir + files.videos[v][m], null)));

  function setView(v) {
    view = v;
    ui.viewButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dynView === v)));
    if (!shown || shown.view === v || !timeline.ready) return;   // a load in flight picks up `view` itself
    const { dir, files } = shown;
    shown = { dir, files, view: v };
    timeline.swapSources(attachView(dir, files, v));
  }

  function renderSelector() {
    ui.selector.innerHTML = cases.map((c, i) => `
      <button type="button" class="itw-card dyn-card" data-index="${i}" aria-pressed="${i === index}" aria-label="Show sequence ${i + 1}" title="${c.id}">
        <img src="${ROOT}${c.dir}/thumb.jpg" alt="" width="360" height="400" loading="lazy">
        <span class="itw-card__label">${String(i + 1).padStart(2, '0')}</span>
        <span class="itw-card__check" aria-hidden="true">${i === index ? '✓' : ''}</span>
      </button>`).join('');
    ui.count.textContent = `SEQUENCE ${String(index + 1).padStart(2, '0')} / ${String(cases.length).padStart(2, '0')}`;
  }

  function loadCase(i) {
    index = i;
    renderSelector();
    const c = cases[i];
    const dir = `${ROOT}${c.dir}/`;
    const token = timeline.beginLoad(`Loading sequence ${i + 1}…`);
    ui.title.textContent = `Sequence ${String(i + 1).padStart(2, '0')}`;
    ui.meta.textContent = '';
    showOverlays(true);
    fetchOk(`${dir}case.json`, 'json').then((info) => {
      if (!timeline.isCurrent(token)) return null;
      const f = info.files;
      const clips = VIEWS.flatMap((v) => METHODS.map((m) => dir + f.videos[v][m]));
      clips.forEach((src) => loader.prefetch(src));   // both views: toggling later is instant
      const attachedView = view;
      return Promise.all([
        group ? fetchOk(dir + f.mesh4d, 'arrayBuffer') : null,
        group ? fetchOk(dir + f.skeletons, 'json') : null,
        attachView(dir, f, attachedView),
        ...clips.map((src) => loader.prefetch(src)),
      ]).then(([buffer, skeletons]) => {
        if (!timeline.isCurrent(token)) return;
        const T = info.n_frames, d = info.mesh4d;
        if (group) {
          const V = d.n_verts, F = d.n_faces;
          const FaceArray = d.faces.dtype === 'uint32' ? Uint32Array : Uint16Array;
          if (d.faces.offset !== T * V * 3 * 2 || buffer.byteLength !== d.faces.offset + F * 3 * FaceArray.BYTES_PER_ELEMENT) {
            throw new Error(`mesh4d.bin layout does not match case.json (${info.id})`);
          }
          const positions = new Uint16Array(buffer, 0, T * V * 3);
          const mesh = new AnimatedMesh(positions, new FaceArray(buffer, d.faces.offset, F * 3), T, V);
          group.setContents(METHODS.map((m) => ({
            mesh, skeleton: new AnimatedSkeleton(skeletonFrames(skeletons[m], T), info.joint_radius, info.bone_radius),
          })));
          group.setHome(info.camera.eye_dir, info.camera.up, positions);   // the front-video camera
        }
        ui.meta.textContent = `${info.id.slice(0, 8)} · GT ${info.skeleton_joints.gt.join('/')} joints · ${T} frames @ ${info.fps} fps`;
        showOverlays(!group);
        loader.release(clips);   // previous case's clips
        shown = { dir, files: f, view: attachedView };
        timeline.setReady(token, info.fps, T, 'Videos and 4D views share one timeline · drag any 4D view, all three follow');
        if (view !== attachedView) setView(view);   // toggled while loading
      });
    }).catch((err) => {
      if (timeline.isCurrent(token)) showOverlays(!group);
      timeline.fail(token, `Could not load sequence ${i + 1} (${err.message}). Select it again to retry.`);
    });
  }

  ui.selector.addEventListener('click', (e) => {
    const b = e.target.closest('[data-index]');
    if (b && Number(b.dataset.index) !== index) loadCase(Number(b.dataset.index));
  });
  ui.viewButtons.forEach((b) => b.addEventListener('click', () => setView(b.dataset.dynView)));
  ui.reset.addEventListener('click', () => { if (group) group.resetView(); });

  // fetch nothing until the section is close to the viewport
  const lazy = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    lazy.disconnect();
    fetchOk(`${ROOT}manifest.json`, 'json').then((m) => {
      cases = m.cases.filter((c) => !HIDDEN.has(c.id));
      loadCase(0);
    }).catch((err) => { $('#dyn-status').textContent = `Could not load the sequence list (${err.message}).`; });
  }, { rootMargin: '800px 0px' });
  lazy.observe(section);
}

initDynamicRecon();
