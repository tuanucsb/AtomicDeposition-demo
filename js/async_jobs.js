/* Shared Async Background Job Runner & Native `<progress>` Controller (`S10.3`). */
(function () {
  "use strict";

  function updateProgressUI(progressEl, statusEl, { visible = true, pct = null, text = "" } = {}) {
    if (progressEl) {
      progressEl.hidden = !visible;
      if (visible) {
        if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
          progressEl.removeAttribute("value");
        } else {
          progressEl.max = 100;
          progressEl.value = Math.max(0, Math.min(100, Number(pct)));
        }
      }
    }
    if (statusEl && text) {
      statusEl.textContent = text;
    }
  }

  async function pollJob(jobId, { progressEl = null, statusEl = null, intervalMs = 280, maxWaitMs = 95000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs) {
      const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (!resp.ok) {
        let msg = `Job status check failed (HTTP ${resp.status})`;
        try {
          const err = await resp.json();
          if (err && err.detail) msg = String(err.detail);
        } catch (_) {}
        throw new Error(msg);
      }
      const job = await resp.json();
      const st = job.status || "queued";
      if (st === "queued") {
        updateProgressUI(progressEl, statusEl, {
          visible: true,
          pct: null,
          text: `${job.job_id}: ${job.stage || "Queued…"}`,
        });
      } else if (st === "running") {
        updateProgressUI(progressEl, statusEl, {
          visible: true,
          pct: job.progress_pct ?? 10,
          text: `${job.job_id} (${job.progress_pct ?? 10}%): ${job.stage || "Running…"}`,
        });
      } else if (st === "completed") {
        updateProgressUI(progressEl, statusEl, {
          visible: true,
          pct: 100,
          text: `${job.job_id}: ${job.stage || "Completed"}`,
        });
        return job;
      } else {
        updateProgressUI(progressEl, statusEl, {
          visible: false,
          text: `${job.job_id} failed: ${job.error || job.stage || "Unknown error"}`,
        });
        throw new Error(job.error || job.stage || "Background job failed");
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    updateProgressUI(progressEl, statusEl, { visible: false, text: "Background job timed out." });
    throw new Error("Background job timed out");
  }

  async function submitAndPoll(endpoint, payload, { progressEl = null, statusEl = null, intervalMs = 260 } = {}) {
    updateProgressUI(progressEl, statusEl, {
      visible: true,
      pct: null,
      text: "Submitting background job…",
    });
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    if (!resp.ok) {
      let msg = `Job submission failed (HTTP ${resp.status})`;
      try {
        const err = await resp.json();
        if (err && err.detail) {
          msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
        }
      } catch (_) {}
      updateProgressUI(progressEl, statusEl, { visible: false, text: msg });
      throw new Error(msg);
    }
    const job = await resp.json();
    if (job.status === "completed") {
      updateProgressUI(progressEl, statusEl, {
        visible: true,
        pct: 100,
        text: `${job.job_id}: ${job.stage || "Completed"}`,
      });
      return job;
    }
    return pollJob(job.job_id, { progressEl, statusEl, intervalMs });
  }

  window.PANGAsyncJobs = {
    updateProgressUI,
    pollJob,
    submitAndPoll,
  };
})();
