(() => {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  window.createScenePlayer = function createScenePlayer(scenes) {
    const stage = $("#stage");
    const titleEl = $("#scene-title");
    const subEl = $("#scene-sub");
    const idxEl = $("#scene-index");
    const playBtn = $("#btn-play");
    const prevBtn = $("#btn-prev");
    const nextBtn = $("#btn-next");
    const dots = $("#dots");
    const bar = $("#progress-bar");
    const legend = $("#legend");

    let index = 0;
    let playing = !prefersReduced;
    let startedAt = 0;
    let leftover = 0;
    let raf = 0;

    scenes.forEach((scene, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dot";
      b.setAttribute("aria-label", `第 ${i + 1} 幕：${scene.title}`);
      b.addEventListener("click", () => go(i, true));
      dots.appendChild(b);
    });

    function applyLegend(keys) {
      $$("[data-lit]", legend).forEach((el) => {
        el.classList.toggle("is-lit", (keys || []).includes(el.dataset.lit));
      });
    }

    function applyScene(i, restartAnims) {
      const scene = scenes[i];
      stage.dataset.scene = scene.id;
      if (restartAnims) {
        stage.classList.remove("is-running");
        void stage.offsetWidth;
      }
      stage.classList.add("is-running");
      titleEl.textContent = scene.title;
      subEl.textContent = scene.subtitle;
      $$( "[data-bind]", stage).forEach((el) => {
        const val = scene.bind && scene.bind[el.dataset.bind];
        if (val != null) el.textContent = val;
      });
      idxEl.textContent = `${String(i + 1).padStart(2, "0")} / ${String(scenes.length).padStart(2, "0")}`;
      $$(".dot", dots).forEach((d, di) => d.classList.toggle("is-on", di === i));
      applyLegend(scene.lit);
      prevBtn.disabled = i === 0;
      nextBtn.disabled = i === scenes.length - 1;
      leftover = 0;
      startedAt = performance.now();
    }

    function setPlaying(on) {
      playing = on;
      playBtn.dataset.state = on ? "playing" : "paused";
      playBtn.setAttribute("aria-label", on ? "暂停" : "播放");
      playBtn.querySelector(".play-icon").hidden = on;
      playBtn.querySelector(".pause-icon").hidden = !on;
      if (on) {
        startedAt = performance.now();
        tick();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        leftover += performance.now() - startedAt;
      }
    }

    function go(i, user) {
      index = Math.max(0, Math.min(scenes.length - 1, i));
      applyScene(index, true);
      if (user && !playing) {
        bar.style.transform = "scaleX(0)";
      }
      if (playing) tick();
    }

    function tick() {
      if (raf) cancelAnimationFrame(raf);
      const scene = scenes[index];
      const duration = prefersReduced ? 0 : scene.duration;
      const loop = () => {
        const elapsed = leftover + (performance.now() - startedAt);
        const p = duration === 0 ? 1 : Math.min(1, elapsed / duration);
        bar.style.transform = `scaleX(${p})`;
        if (p >= 1) {
          if (index < scenes.length - 1) {
            leftover = 0;
            go(index + 1, false);
          } else {
            setPlaying(false);
            bar.style.transform = "scaleX(1)";
          }
          return;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    playBtn.addEventListener("click", () => setPlaying(!playing));
    prevBtn.addEventListener("click", () => go(index - 1, true));
    nextBtn.addEventListener("click", () => go(index + 1, true));

    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, button")) {
        if (e.code !== "Space") return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!playing);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        go(index + 1, true);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        go(index - 1, true);
      }
    });

    applyScene(0, true);
    if (playing) tick();
    else bar.style.transform = "scaleX(0)";
  };
})();
