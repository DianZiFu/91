import * as api from "../api";
import { RefreshRequest } from "../RefreshRequest";
import { isGenerationBusy } from "./scanResults";

const resources: api.DriveResource[] = ["config", "runtime", "stats", "storage"];
export type ResourceState<T> = { data?: T; loading: boolean; error: string; revision: number; updatedAt?: string };
export type DriveDetailState = {
  resources: { [R in api.DriveResource]: ResourceState<api.DriveResourceData[R]> };
  connection: "paused" | "connecting" | "live" | "reconnecting";
  notFound: boolean;
  unauthorized: boolean;
};

type Stream = { close(): void };
export type DriveDetailDependencies = {
  load: (id: string, resource: api.DriveResource, signal: AbortSignal) => Promise<api.DriveSnapshot>;
  subscribe: (id: string, snapshot: (value: api.DriveSnapshot) => void, open: () => void, error: () => void) => Stream;
};

const defaults: DriveDetailDependencies = { load: api.getDriveSnapshot, subscribe: api.subscribeDriveSnapshots };
const emptyResource = () => ({ loading: false, error: "", revision: 0 });
const emptyResources = () => ({ config: emptyResource(), runtime: emptyResource(), stats: emptyResource(), storage: emptyResource() });
function runtimeBusy(runtime?: api.DriveRuntime) {
  return [runtime?.scanGenerationStatus, runtime?.thumbnailGenerationStatus, runtime?.previewGenerationStatus, runtime?.fingerprintGenerationStatus]
    .some((status) => isGenerationBusy(status?.state || "idle"));
}

// One controller owns a drive's server snapshots. Form drafts and directory
// expansion remain in their UI components and never pause task synchronization.
export class DriveDetailData {
  private state: DriveDetailState = {
    resources: emptyResources(),
    connection: "paused", notFound: false, unauthorized: false,
  };
  private listeners = new Set<() => void>();
  private requests = new Map<api.DriveResource, RefreshRequest<{ snapshot: api.DriveSnapshot; requestedEpoch?: string }>>();
  private timers = new Map<api.DriveResource, ReturnType<typeof setTimeout>>();
  private failures = new Map<api.DriveResource, number>();
  private leases = 0;
  private stream: Stream | null = null;
  private streamGeneration = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private healthTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private epoch?: string;
  private retiredEpochs = new Set<string>();

  constructor(readonly driveId: string, private readonly dependencies = defaults) {
    for (const resource of resources) {
      this.requests.set(resource, new RefreshRequest(
        (signal) => {
          const requestedEpoch = this.epoch;
          return dependencies.load(driveId, resource, signal).then((snapshot) => ({ snapshot, requestedEpoch }));
        },
        ({ snapshot, requestedEpoch }) => {
          // An initial read can belong to an unknown older process. It cannot
          // replace an epoch already established by another resource/stream.
          if (this.epoch && snapshot.epoch !== this.epoch && requestedEpoch !== this.epoch) {
            if (this.active && this.state.connection !== "live") void this.read([resource]);
            return;
          }
          this.accept(snapshot, false);
        },
        (error) => this.failed(resource, error),
      ));
    }
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get active() { return this.leases > 0 && !this.state.unauthorized && !this.state.notFound; }

  retain(): () => void {
    this.leases++;
    if (this.leases === 1 && (this.state.notFound || this.state.unauthorized)) {
      this.reset();
    }
    if (this.leases === 1 && this.active) {
      void this.refresh();
      this.connect();
      for (const resource of resources) this.schedule(resource);
    }
    return () => {
      this.leases--;
      if (this.leases === 0) this.pause();
    };
  }

  async refresh(selected: api.DriveResource[] = resources): Promise<void> {
    if (this.leases === 0 || this.state.unauthorized) return;
    if (this.state.notFound) {
      this.reset();
      selected = resources;
      this.connect();
      for (const resource of resources) this.schedule(resource);
    }
    await this.read(selected);
  }

  private reset() {
    this.failures.clear();
    this.state = { ...this.state, notFound: false, unauthorized: false, resources: emptyResources() };
    this.emit();
  }

  private async read(selected: api.DriveResource[], fresh = false): Promise<void> {
    if (!this.active) return;
    await Promise.all(selected.map((resource) => {
      const request = this.requests.get(resource)!;
      if (fresh) request.cancel();
      this.updateResource(resource, { loading: true });
      return request.refresh();
    }));
  }

  accept(snapshot: api.DriveSnapshot, authoritative = true): void {
    if (snapshot.driveId !== this.driveId || !resources.includes(snapshot.resource) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision <= 0) return;
    if (this.retiredEpochs.has(snapshot.epoch)) return;
    if (!authoritative && this.epoch && this.epoch !== snapshot.epoch && this.state.connection === "live") return;
    if (this.epoch && this.epoch !== snapshot.epoch) {
      this.retiredEpochs.add(this.epoch);
      const reset = { ...this.state.resources };
      for (const resource of resources) Object.assign(reset, { [resource]: { ...reset[resource], revision: 0 } });
      this.state = { ...this.state, resources: reset };
    }
    this.epoch = snapshot.epoch;
    const resource = snapshot.resource;
    if (snapshot.revision < this.state.resources[resource].revision) return;
    // Only config owns existence. Resource revisions order content changes
    // within that resource and cannot establish cross-resource freshness.
    if (snapshot.status === 404 && resource !== "config") {
      this.updateResource(resource, { loading: false });
      void this.read(["config"], true);
      return;
    }
    this.failures.set(resource, snapshot.error ? (this.failures.get(resource) || 0) + 1 : 0);
    const finished = resource === "runtime" && Boolean(snapshot.data) && !snapshot.error && runtimeBusy(this.state.resources.runtime.data) && !runtimeBusy(snapshot.data as api.DriveRuntime);
    if (snapshot.status === 404) {
      this.state = { ...this.state, notFound: true, resources: emptyResources() };
      this.pause();
    }
    this.updateResource(resource, {
      ...(snapshot.data ? { data: snapshot.data } : {}), loading: false,
      revision: snapshot.revision, updatedAt: snapshot.updatedAt, error: snapshot.error || "",
    });
    if (finished) void this.read(["stats", "storage"]);
  }

  private updateResource(resource: api.DriveResource, value: Partial<ResourceState<api.DriveResourceData[api.DriveResource]>>) {
    this.state = { ...this.state, resources: { ...this.state.resources, [resource]: { ...this.state.resources[resource], ...value } } };
    this.emit();
  }

  private emit() { for (const listener of this.listeners) listener(); }

  private failed(resource: api.DriveResource, error: unknown) {
    this.failures.set(resource, (this.failures.get(resource) || 0) + 1);
    if (error instanceof api.UnauthorizedError || (error instanceof api.APIResponseError && error.status === 403)) {
      this.state = { ...this.state, unauthorized: true };
      this.pause();
    }
    this.updateResource(resource, { loading: false, error: error instanceof Error ? error.message : "数据加载失败" });
  }

  private interval(resource: api.DriveResource) {
    const base = ({ config: 10_000, runtime: 1_000, stats: 3_000, storage: 15_000 })[resource];
    const failures = this.failures.get(resource) || 0;
    return failures ? Math.min(30_000, base * 2 ** Math.min(failures, 5)) : base;
  }

  private schedule(resource: api.DriveResource) {
    clearTimeout(this.timers.get(resource));
    this.timers.delete(resource);
    if (!this.active || this.state.connection === "live") return;
    this.timers.set(resource, setTimeout(async () => {
      await this.read([resource]);
      if (this.active) this.schedule(resource);
    }, this.interval(resource)));
  }

  private connect() {
    if (!this.active) return;
    const generation = ++this.streamGeneration;
    this.state = { ...this.state, connection: this.reconnectAttempts ? "reconnecting" : "connecting" };
    this.emit();
    const current = () => this.active && generation === this.streamGeneration;
    const healthy = () => {
      if (!current()) return;
      const becameLive = this.state.connection !== "live";
      this.reconnectAttempts = 0;
      if (becameLive) { this.state = { ...this.state, connection: "live" }; this.emit(); }
      clearTimeout(this.healthTimer);
      this.healthTimer = setTimeout(() => this.streamFailed(generation), 45_000);
      if (becameLive) for (const resource of resources) this.schedule(resource);
    };
    try {
      const stream = this.dependencies.subscribe(this.driveId,
        (snapshot) => { if (current()) { healthy(); this.accept(snapshot); } }, healthy,
        () => this.streamFailed(generation));
      if (current()) this.stream = stream; else stream.close();
      // Also bound the initial handshake if the browser never reports an error.
      if (this.state.connection !== "live") this.healthTimer = setTimeout(() => this.streamFailed(generation), 15_000);
    } catch { this.streamFailed(generation); }
  }

  private streamFailed(generation: number) {
    if (!this.active || generation !== this.streamGeneration) return;
    this.streamGeneration++;
    this.stream?.close();
    this.stream = null;
    clearTimeout(this.healthTimer);
    this.state = { ...this.state, connection: "reconnecting" };
    this.emit();
    void this.read(resources);
    for (const resource of resources) this.schedule(resource);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts++, 5));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private pause() {
    this.streamGeneration++;
    this.stream?.close();
    this.stream = null;
    clearTimeout(this.healthTimer);
    clearTimeout(this.reconnectTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const request of this.requests.values()) request.cancel();
    this.state = { ...this.state, connection: "paused" };
    this.emit();
  }
}

export function driveDetailData(driveId: string, cache: Map<string, DriveDetailData>): DriveDetailData {
  let data = cache.get(driveId);
  if (!data) {
    data = new DriveDetailData(driveId);
    cache.set(driveId, data);
    // Retained admin routes must not create an unbounded per-drive cache.
    if (cache.size > 20) {
      for (const [id, entry] of cache) {
        if (id !== driveId && !entry.active) cache.delete(id);
        if (cache.size <= 20) break;
      }
    }
  }
  return data;
}
