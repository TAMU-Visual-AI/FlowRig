// Shared playback for the result viewers: several <video>s + any number of 4D views on ONE time bar.
//   fetchOk(url, kind)        fetch that rejects on HTTP errors; kind = 'json' | 'arrayBuffer' | 'blob'
//   BlobVideoLoader           clips are small, so each is downloaded whole and played from a blob URL: frame-exact
//                             seeking then works on any server, including ones without HTTP range support
//                             (e.g. python -m http.server)
//   SyncedTimeline            videos[0] is the master clock, the others are kept within half a frame of it;
//                             onFrame(k) drives the 4D views. Play / restart / scrub / speed, loops, pauses when
//                             the viewer scrolls out of view or the tab is hidden.

export function fetchOk(url, kind) {
  return fetch(url).then((r) => (r.ok ? r[kind]() : Promise.reject(new Error(`${r.status} ${url}`))));
}

export class BlobVideoLoader {
  constructor() { this.cache = new Map(); }   // src -> Promise<blob URL>

  // download a clip once (kept until release); resolves to a blob URL
  prefetch(src) {
    if (!this.cache.has(src)) {
      const p = fetchOk(src, 'blob').then((blob) => URL.createObjectURL(blob));
      p.catch(() => this.cache.delete(src));
      this.cache.set(src, p);
    }
    return this.cache.get(src);
  }

  // show a (prefetched) clip in a <video>; resolves once its metadata is loaded
  attach(video, src, poster) {
    if (poster) video.poster = poster;
    return this.prefetch(src).then((url) => new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error(`video ${src}`)), { once: true });
      video.src = url;
      video.load();
    }));
  }

  load(video, src, poster) { return this.attach(video, src, poster); }

  // free every cached clip whose src is not in `keep`
  release(keep = []) {
    const keepSet = new Set(keep);
    [...this.cache.keys()].filter((src) => !keepSet.has(src)).forEach((src) => {
      this.cache.get(src).then((url) => URL.revokeObjectURL(url), () => {});
      this.cache.delete(src);
    });
  }
}

export class SyncedTimeline {
  // ui = { play, playIcon, playLabel, restart, timeline, frame, speed, status }; extraControls are enabled
  // together with the playback controls; observe = element whose visibility gates autoplay
  constructor({ videos, ui, observe, onFrame = () => {}, onVisible = () => {}, onHidden = () => {}, extraControls = [] }) {
    if (!videos.length) throw new Error('SyncedTimeline needs at least one video');
    Object.assign(this, { videos, ui, onFrame, onVisible, onHidden, extraControls });
    this.master = videos[0];
    this.fps = 8;
    this.T = 1;
    this.frame = 0;
    this.revision = 0;
    this.ready = false;
    this.playing = false;
    this.visible = false;
    this.wantsPlayback = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    ui.play.addEventListener('click', () => {
      this.wantsPlayback = !this.playing;
      if (this.playing) this.pause(); else this.play();
    });
    ui.restart.addEventListener('click', () => this.seekFrame(0));
    ui.timeline.addEventListener('input', () => {
      if (this.playing) this.pause();
      this.wantsPlayback = false;
      this.seekFrame(Number(ui.timeline.value));
    });
    ui.speed.addEventListener('change', () => this.applySpeed());
    this.master.addEventListener('ended', () => {
      if (!this.playing) return;
      this.seekFrame(0);
      this.play();
    });
    new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      if (this.visible) {
        this.onVisible();
        if (this.wantsPlayback && this.ready) this.play();
      } else {
        this.pause();
        this.onHidden();
      }
    }, { threshold: 0.15 }).observe(observe);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else if (this.visible && this.wantsPlayback && this.ready) this.play();
    });
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  setControls(on) {
    [this.ui.play, this.ui.restart, this.ui.timeline, ...this.extraControls].forEach((el) => { el.disabled = !on; });
  }

  // a new clip starts loading; returns a token that setReady / isCurrent check against
  beginLoad(statusText) {
    this.pause();
    this.ready = false;
    this.setControls(false);
    this.ui.status.textContent = statusText;
    return ++this.revision;
  }

  isCurrent(token) { return token === this.revision; }

  setReady(token, fps, T, statusText) {
    if (!this.isCurrent(token)) return false;
    if (!(fps > 0 && T >= 1)) throw new Error(`SyncedTimeline: bad clip fps=${fps} T=${T}`);
    this.fps = fps;
    this.T = T;
    this.ui.timeline.max = String(T - 1);
    this.applySpeed();
    this.ready = true;
    this.setControls(true);
    this.seekFrame(0);
    this.ui.status.textContent = statusText;
    if (this.wantsPlayback && this.visible) this.play();
    return true;
  }

  fail(token, statusText) {
    if (this.isCurrent(token)) this.ui.status.textContent = statusText;
  }

  applySpeed() {
    const rate = Number(this.ui.speed.value);
    this.videos.forEach((v) => { v.defaultPlaybackRate = rate; v.playbackRate = rate; });
  }

  // some <video>s get a new source (view toggle, baseline menu): keep the current frame and play state
  swapSources(attached) {
    const token = this.revision, wasPlaying = this.playing, k = this.frame;
    this.pause();
    return attached.then(() => {
      if (!this.isCurrent(token)) return;
      this.applySpeed();
      this.seekFrame(k);
      if (wasPlaying) this.play();
    });
  }

  frameAt(t) { return Math.min(this.T - 1, Math.max(0, Math.floor(t * this.fps + 1e-3))); }

  playbackUI() {
    this.ui.playLabel.textContent = this.playing ? 'Pause' : 'Play';
    this.ui.playIcon.textContent = this.playing ? '❚❚' : '▶';
    this.ui.play.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
  }

  showFrame(k) {
    this.frame = k;
    this.ui.timeline.value = String(k);
    this.ui.timeline.setAttribute('aria-valuetext', `frame ${k + 1} of ${this.T}`);
    this.ui.frame.textContent = `Frame ${String(k + 1).padStart(2, '0')} / ${this.T}`;
    this.onFrame(k);
  }

  seekFrame(k) {
    const t = (k + 0.5) / this.fps;   // middle of frame k: unambiguous for every video
    this.videos.forEach((v) => { if (v.readyState >= 1) v.currentTime = t; });
    this.showFrame(k);
  }

  pause() {
    this.videos.forEach((v) => v.pause());
    this.playing = false;
    this.playbackUI();
  }

  play() {
    if (!this.ready) return;
    const token = this.revision;
    this.playing = true;
    this.playbackUI();
    Promise.all(this.videos.map((v) => v.play())).then(null, () => {
      if (!this.isCurrent(token)) return;
      this.pause();
      this.wantsPlayback = false;
      this.ui.status.textContent = 'Press Play to start.';
    });
  }

  tick() {
    if (this.playing && this.ready) {
      const t = this.master.currentTime;
      this.videos.forEach((v) => { if (v !== this.master && Math.abs(v.currentTime - t) > 0.5 / this.fps) v.currentTime = t; });
      const k = this.frameAt(t);
      if (k !== this.frame) this.showFrame(k);
    }
    requestAnimationFrame(this.tick);
  }
}
