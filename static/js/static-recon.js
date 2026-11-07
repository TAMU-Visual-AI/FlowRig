// Static Reconstruction section: 360-degree orbit renders of static test meshes on three datasets. Dataset buttons
// switch the sequence list; columns = GT / Ours / a baseline picked from a menu (Anymate by default, only the baselines
// rendered for that dataset are offered). The three videos share one time bar; changing the baseline keeps the frame.
// Below the videos, three synced interactive 3D views (one shared camera) show the same mesh with each skeleton;
// a baseline without 3D data yet says so in its panel.
// Assets: static/static_recon/<dataset>/<case>/{thumb.jpg, <method>.mp4, mesh3d.bin, skel3d.json} + manifest.json,
// written by skt/mytool/export_static_web.py (videos, thumbnails) and skt/mytool/export_static_3d.py (3D).
import { hasWebGL, AnimatedMesh, AnimatedSkeleton, View4DGroup } from './viewer4d.js';
import { fetchOk, BlobVideoLoader, SyncedTimeline } from './media-sync.js';

const ROOT = './static/static_recon/';

const $ = (s) => document.querySelector(s);

function initStaticRecon() {
  const section = $('#static_recon');
  if (!section) return;
  const ui = {
    datasets: $('#st-datasets'), selector: $('#st-selector'), count: $('#st-count'), title: $('#st-title'),
    meta: $('#st-meta'), baseline: $('#st-baseline'), reset: $('#st-reset'),
  };
  const video = { gt: $('#st-video-gt'), ours: $('#st-video-ours'), baseline: $('#st-video-baseline') };
  const stages = ['gt', 'ours', 'baseline'].map((m) => $(`#st-3d-${m}`));
  const overlays = stages.map((s) => s.querySelector('.st-3d-loading'));
  const group = hasWebGL() ? new View4DGroup(stages, { background: 0xffffff }) : null;
  const note = (i, text) => { overlays[i].textContent = text; overlays[i].hidden = !text; };
  if (!group) [0, 1, 2].forEach((i) => note(i, 'The interactive 3D views need WebGL.'));
  const loader = new BlobVideoLoader();
  const timeline = new SyncedTimeline({
    videos: [video.gt, video.ours, video.baseline],   // GT is the master clock
    ui: { play: $('#st-play'), playIcon: $('#st-play-icon'), playLabel: $('#st-play-label'), restart: $('#st-restart'),
      timeline: $('#st-timeline'), frame: $('#st-frame'), speed: $('#st-speed'), status: $('#st-status') },
    observe: $('#st-shell'),
    onVisible: () => { if (group) group.start(); },
    onHidden: () => { if (group) group.stop(); },
    extraControls: group ? [ui.reset] : [],
  });
  let manifest = null;
  let ds = 0;           // dataset index
  let index = 0;        // case index within the dataset
  let baseline = null;  // baseline method id
  let shown = null;     // { dir, baseline } currently attached
  let shown3d = null;   // { skeletons (skel3d.json), radii } of the current case

  const dataset = () => manifest.datasets[ds];
  const label = (m) => manifest.methods[m] || m;

  function skeleton3d(m) {
    const frames = shown3d && shown3d.skeletons[m];
    if (!frames) return null;
    return new AnimatedSkeleton(frames.map((f) => ({ joints: Float32Array.from(f.j), bones: Int32Array.from(f.b) })),
      shown3d.jointRadius, shown3d.boneRadius);
  }

  function showBaseline3d() {
    if (!group || !shown3d) return;
    const sk = skeleton3d(baseline);
    group.replaceSkeleton(2, sk);
    note(2, sk ? '' : `3D skeleton for ${label(baseline)} coming soon`);
  }

  function renderDatasets() {
    ui.datasets.innerHTML = manifest.datasets.map((d, k) =>
      `<button type="button" data-st-dataset="${k}" aria-pressed="${k === ds}">${d.label}</button>`).join('');
  }

  function renderBaselineMenu() {
    const avail = dataset().baselines;
    if (!avail.includes(baseline)) baseline = avail.includes(manifest.default_baseline) ? manifest.default_baseline : avail[0];
    ui.baseline.innerHTML = avail.map((m) => `<option value="${m}"${m === baseline ? ' selected' : ''}>${label(m)}</option>`).join('');
  }

  function renderSelector() {
    const d = dataset();
    ui.selector.innerHTML = d.cases.map((c, i) => `
      <button type="button" class="itw-card dyn-card" data-index="${i}" aria-pressed="${i === index}" aria-label="Show sequence ${i + 1}" title="${c.id}">
        <img src="${ROOT}${d.dir}/${c.dir}/thumb.jpg" alt="" width="360" height="400" loading="lazy">
        <span class="itw-card__label">${String(i + 1).padStart(2, '0')}</span>
        <span class="itw-card__check" aria-hidden="true">${i === index ? '✓' : ''}</span>
      </button>`).join('');
    ui.count.textContent = `SEQUENCE ${String(index + 1).padStart(2, '0')} / ${String(d.cases.length).padStart(2, '0')}`;
  }

  function load3d(d, c, dir, buffer, skeletons) {
    const g = c.mesh3d, V = g.n_verts, F = g.n_faces;
    const FaceArray = g.faces.dtype === 'uint32' ? Uint32Array : Uint16Array;
    if (g.faces.offset !== V * 3 * 2 || buffer.byteLength !== g.faces.offset + F * 3 * FaceArray.BYTES_PER_ELEMENT) {
      throw new Error(`mesh3d.bin layout does not match the manifest (${c.id})`);
    }
    const positions = new Uint16Array(buffer, 0, V * 3);
    const mesh = new AnimatedMesh(positions, new FaceArray(buffer, g.faces.offset, F * 3), 1, V);
    shown3d = { skeletons, jointRadius: g.joint_radius, boneRadius: g.bone_radius };
    group.setContents([{ mesh, skeleton: skeleton3d('gt') }, { mesh, skeleton: skeleton3d('ours') }, { mesh, skeleton: null }]);
    group.setHome(d.camera3d.eye_dir, d.camera3d.up, positions);   // the renders' camera
    group.setFrame(0);
    [0, 1].forEach((i) => note(i, ''));
    showBaseline3d();
  }

  function loadCase(i) {
    index = i;
    renderSelector();
    const d = dataset(), c = d.cases[i];
    const dir = `${ROOT}${d.dir}/${c.dir}/`;
    const token = timeline.beginLoad(`Loading ${d.label} sequence ${i + 1}…`);
    ui.title.textContent = `Sequence ${String(i + 1).padStart(2, '0')}`;
    ui.meta.textContent = `${d.label} · ${c.id}`;
    if (group) [0, 1, 2].forEach((k) => note(k, 'Loading 3D…'));
    const attachedBaseline = baseline;
    const clips = [`${dir}gt.mp4`, `${dir}ours.mp4`, `${dir}${attachedBaseline}.mp4`];
    const has3d = group && c.files3d;
    Promise.all([
      has3d ? fetchOk(dir + c.files3d.mesh, 'arrayBuffer') : null,
      has3d ? fetchOk(dir + c.files3d.skeletons, 'json') : null,
      loader.attach(video.gt, clips[0], null),
      loader.attach(video.ours, clips[1], null),
      loader.attach(video.baseline, clips[2], null),
    ]).then(([buffer, skeletons]) => {
      if (!timeline.isCurrent(token)) return;
      loader.release(clips);   // previous case's clips
      shown = { dir, baseline: attachedBaseline };
      if (has3d) load3d(d, c, dir, buffer, skeletons);
      else if (group) [0, 1, 2].forEach((k) => note(k, 'No 3D data for this sequence'));
      timeline.setReady(token, manifest.fps, manifest.n_frames,
        'Videos share one timeline · the 3D views share one camera: drag any of them, all three follow');
      if (baseline !== attachedBaseline) setBaseline(baseline);   // changed while loading
    }).catch((err) => timeline.fail(token, `Could not load sequence ${i + 1} (${err.message}). Select it again to retry.`));
  }

  function setBaseline(m) {
    baseline = m;
    showBaseline3d();
    if (!shown || shown.baseline === m || !timeline.ready) return;   // a load in flight picks up `baseline` itself
    const src = `${shown.dir}${m}.mp4`;
    shown = { dir: shown.dir, baseline: m };
    timeline.swapSources(loader.attach(video.baseline, src, null));
  }

  function setDataset(k) {
    ds = k;
    renderDatasets();
    renderBaselineMenu();
    loadCase(0);
  }

  ui.datasets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st-dataset]');
    if (b && Number(b.dataset.stDataset) !== ds) setDataset(Number(b.dataset.stDataset));
  });
  ui.selector.addEventListener('click', (e) => {
    const b = e.target.closest('[data-index]');
    if (b && Number(b.dataset.index) !== index) loadCase(Number(b.dataset.index));
  });
  ui.baseline.addEventListener('change', () => setBaseline(ui.baseline.value));
  ui.reset.addEventListener('click', () => { if (group) group.resetView(); });

  // fetch nothing until the section is close to the viewport
  const lazy = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    lazy.disconnect();
    fetchOk(`${ROOT}manifest.json`, 'json').then((m) => {
      manifest = m;
      setDataset(0);
    }).catch((err) => { $('#st-status').textContent = `Could not load the sequence list (${err.message}).`; });
  }, { rootMargin: '800px 0px' });
  lazy.observe(section);
}

initStaticRecon();
