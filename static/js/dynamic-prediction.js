// Dynamic Prediction section: skeleton forecasting / backcasting / interpolation on six animated test assets.
// One column per asset: row 1 = its first-frame mesh (reference), row 2 = the skeleton video (blue bones = observed
// frames, gold = predicted). Task buttons switch all six videos; every task is prefetched, so switching is instant
// and keeps the frame. The six videos share one time bar.
// Assets: static/dynamic_prediction/<case>/{reference.jpg, forecast.mp4, backcast.mp4, interp4.mp4} + manifest.json,
// written by skt/mytool/export_prediction_web.py.
import { fetchOk, BlobVideoLoader, SyncedTimeline } from './media-sync.js';

const ROOT = './static/dynamic_prediction/';

const $ = (s) => document.querySelector(s);

function initDynamicPrediction() {
  const section = $('#dynamic-prediction');
  if (!section) return;
  const ui = { tasks: $('#pred-tasks'), grid: $('#pred-grid'), legend: $('#pred-legend'), status: $('#pred-status') };
  const loader = new BlobVideoLoader();
  let manifest = null;
  let timeline = null;
  let videos = [];
  let task = null;
  let shownTask = null;

  const clip = (c, t) => `${ROOT}${c.dir}/${manifest.tasks.find((x) => x.id === t).file}`;
  const attachTask = (t) => Promise.all(manifest.cases.map((c, i) => loader.attach(videos[i], clip(c, t), null)));

  function build() {
    ui.tasks.innerHTML = manifest.tasks.map((t) =>
      `<button type="button" data-pred-task="${t.id}" aria-pressed="${t.id === task}">${t.label}</button>`).join('');
    ui.legend.innerHTML = `<span><i style="background:${manifest.legend.observed}"></i>Observed</span>` +
      `<span><i style="background:${manifest.legend.predicted}"></i>Predicted</span>`;
    ui.grid.innerHTML = `
      <div class="pred-labels" aria-hidden="true">
        <span></span><span class="pred-rowlabel">Reference<small>first-frame mesh</small></span>
        <span class="pred-rowlabel">Prediction<small>skeleton</small></span>
      </div>` + manifest.cases.map((c) => `
      <div class="pred-col">
        <div class="dyn-colhead pred-head" title="${c.uuid}">${c.label}</div>
        <figure class="itw-panel"><div class="itw-stage pred-stage">
          <img src="${ROOT}${c.dir}/${c.reference}" alt="${c.label}: first-frame mesh" width="360" height="472" loading="lazy">
        </div></figure>
        <figure class="itw-panel is-ours"><div class="itw-stage pred-stage">
          <video muted playsinline preload="auto" aria-label="${c.label}: predicted skeleton"></video>
        </div></figure>
      </div>`).join('');
    videos = Array.from(ui.grid.querySelectorAll('video'));
  }

  function setTask(t) {
    task = t;
    ui.tasks.querySelectorAll('[data-pred-task]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.predTask === t)));
    if (shownTask === null || shownTask === t || !timeline.ready) return;   // the initial load picks up `task` itself
    shownTask = t;
    timeline.swapSources(attachTask(t));
  }

  function start() {
    task = manifest.tasks[0].id;
    build();
    timeline = new SyncedTimeline({
      videos,   // first asset is the master clock
      ui: { play: $('#pred-play'), playIcon: $('#pred-play-icon'), playLabel: $('#pred-play-label'), restart: $('#pred-restart'),
        timeline: $('#pred-timeline'), frame: $('#pred-frame'), speed: $('#pred-speed'), status: ui.status },
      observe: $('#pred-shell'),
    });
    ui.tasks.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pred-task]');
      if (b) setTask(b.dataset.predTask);
    });
    const token = timeline.beginLoad('Loading…');
    manifest.tasks.forEach((t) => manifest.cases.forEach((c) => loader.prefetch(clip(c, t.id))));   // all tasks up front
    const first = task;
    attachTask(first).then(() => {
      shownTask = first;
      timeline.setReady(token, manifest.fps, manifest.n_frames, 'All six predictions share one timeline');
      if (task !== first) setTask(task);   // switched while loading
    }).catch((err) => timeline.fail(token, `Could not load the predictions (${err.message}).`));
  }

  // fetch nothing until the section is close to the viewport
  const lazy = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    lazy.disconnect();
    fetchOk(`${ROOT}manifest.json`, 'json').then((m) => {
      manifest = m;
      start();
    }).catch((err) => { ui.status.textContent = `Could not load the prediction list (${err.message}).`; });
  }, { rootMargin: '800px 0px' });
  lazy.observe(section);
}

initDynamicPrediction();
