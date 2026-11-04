// Local preview lifecycle. No capture, recording, frame extraction, or uploads.
export type CameraGate = { allowed: boolean; revision: number; noticeVersion: string; expiresAt: number };
export type CameraState = { mode: "idle" | "checking" | "permission" | "validating" | "active" | "stopped" | "error"; message: string; promptPending: boolean };
type Dependencies = {
  check: () => Promise<CameraGate>;
  getStream: () => Promise<MediaStream>;
  attach: (stream: MediaStream | null) => void | Promise<void>;
  visible: () => boolean;
  state: (value: CameraState) => void;
  gateHint?: string;
  activeMessage?: string;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (id: ReturnType<typeof setTimeout>) => void;
};
function cameraError(error: unknown) {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was denied. Manual attendance remains available.";
  if (name === "NotFoundError") return "No camera is available on this device.";
  if (name === "NotReadableError") return "The camera is busy or unavailable. Close other camera apps and try again.";
  return "Camera preview could not start. Check your device and camera permission, then try again.";
}
export class LocalCamera {
  private dependencies: Dependencies;
  private generation = 0;
  private disposed = false;
  private pending = false;
  private stream: MediaStream | null = null;
  private ended: Array<{ track: MediaStreamTrack; handler: () => void }> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private current: CameraState = { mode: "idle", message: "Camera is off.", promptPending: false };
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }
  private now() { return (this.dependencies.now ?? Date.now)(); }
  private schedule(callback: () => void, ms: number) { return (this.dependencies.schedule ?? setTimeout)(callback, ms); }
  private emit(mode: CameraState["mode"], message: string) {
    this.current = { mode, message, promptPending: this.pending };
    if (!this.disposed) this.dependencies.state(this.current);
  }
  private valid(gate: CameraGate) { return gate.allowed && Number.isFinite(gate.expiresAt) && gate.expiresAt > this.now(); }
  private clearTimers() {
    for (const timer of [this.timer, this.pollTimer]) if (timer !== undefined) (this.dependencies.cancel ?? clearTimeout)(timer);
    this.timer = this.pollTimer = undefined;
  }
  stop(message = "Camera preview stopped.") {
    this.generation++; this.clearTimers();
    for (const { track, handler } of this.ended) track.removeEventListener("ended", handler);
    this.ended = [];
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    void this.dependencies.attach(null);
    this.emit("stopped", message);
  }
  dispose() { this.disposed = true; this.stop(); }
  private poll(generation: number, initial: CameraGate) {
    this.pollTimer = this.schedule(() => {
      void (async () => {
        try {
          const fresh = await this.dependencies.check();
          if (generation !== this.generation || this.disposed) return;
          if (!this.valid(fresh) || fresh.revision !== initial.revision || fresh.noticeVersion !== initial.noticeVersion || !this.dependencies.visible()) {
            this.stop("Camera choice changed or expired. Review your choice before restarting."); return;
          }
          this.poll(generation, initial);
        } catch { if (generation === this.generation) this.stop("Preview stopped because your current choice could not be verified."); }
      })();
    }, 10000);
  }
  async start() {
    if (this.disposed || this.pending || this.stream || ["checking", "permission"].includes(this.current.mode)) return;
    const generation = ++this.generation;
    this.emit("checking", "Checking your current camera choice…");
    let acquired: MediaStream | null = null;
    try {
      const first = await this.dependencies.check();
      if (generation !== this.generation || this.disposed) return;
      if (!this.valid(first) || !this.dependencies.visible()) { this.emit("stopped", this.dependencies.gateHint ?? "Enable the current local preview choice before starting the camera."); return; }
      this.pending = true; this.emit("permission", "Waiting for your browser’s camera permission…");
      try { acquired = await this.dependencies.getStream(); }
      finally { this.pending = false; }
      if (generation !== this.generation || this.disposed || !this.dependencies.visible()) {
        for (const track of acquired.getTracks()) track.stop();
        if (!this.disposed) this.emit("stopped", "The preview request was cancelled. Camera is off.");
        return;
      }
      this.stream = acquired;
      this.emit("validating", "Camera opened. Verifying your latest choice before displaying video…");
      // Bound camera use immediately, including time waiting for revalidation.
      this.timer = this.schedule(() => this.stop("Preview ended after its time limit or choice expiry."), Math.min(60000, first.expiresAt - this.now()));
      const second = await this.dependencies.check();
      if (generation !== this.generation || this.disposed) return;
      if (!this.valid(second) || second.revision !== first.revision || second.noticeVersion !== first.noticeVersion || !this.dependencies.visible()) {
        this.stop("Camera choice changed while permission was pending. Review it before restarting."); return;
      }
      for (const track of acquired.getTracks()) {
        const handler = () => this.stop("The camera stream ended. Camera is off.");
        track.addEventListener("ended", handler); this.ended.push({ track, handler });
      }
      await this.dependencies.attach(acquired);
      if (generation !== this.generation || this.disposed) return;
      this.emit("active", this.dependencies.activeMessage ?? "Local preview active. It stops within 60 seconds.");
      this.poll(generation, second);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.stop();
      this.emit("error", acquired ? "Preview stopped because your choice or video playback could not be verified." : cameraError(error));
    } finally {
      if (!this.disposed && this.current.promptPending !== this.pending) this.emit(this.current.mode, this.current.message);
    }
  }
}
