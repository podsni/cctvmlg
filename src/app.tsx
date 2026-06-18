import React, { useCallback, useEffect, useRef, useState } from "react";
import { KECAMATAN, kecamatanName, type Camera } from "./schemas";

interface AppProps {
  initialCameras?: Camera[];
  upstreamError?: string | null;
  isServer?: boolean;
}

const ACTIVE_MAX = 6;
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 200;

const RECENT_KEY = "cctvmlg:recent";
const RECENT_MAX = 8;
type RecentEntry = { id: string; name: string; stream_id: string; ts: number };

function loadRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentEntry =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as RecentEntry).id === "string" &&
          typeof (x as RecentEntry).name === "string",
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function pushRecent(e: RecentEntry): void {
  if (typeof window === "undefined") return;
  const cur = loadRecent().filter((x) => x.id !== e.id);
  const next = [e, ...cur].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

function streamUrl(c: Camera): string {
  // Best-effort proxy through our Worker. Upstream CCTV uses a WAF that
  // sometimes rejects requests from CF Worker IPs (JA fingerprinting),
  // in which case the stream will 403. The UI offers an "Open source"
  // button as a fallback that hits the upstream directly from the
  // user's browser (which has proper cookies after visiting the site).
  return `/api/stream/${c.stream_id}`;
}

function sourceUrl(c: Camera): string {
  return `https://cctv.malangkota.go.id/cctv-stream/streams/${c.stream_id}.m3u8`;
}

const App = ({ initialCameras, upstreamError, isServer }: AppProps) => {
  const initialFromWindow =
    !isServer && typeof window !== "undefined"
      ? ((
          window as unknown as {
            __CCTVMLG__?: Camera[];
          }
        ).__CCTVMLG__ ?? undefined)
      : undefined;

  const [cameras, setCameras] = useState<Camera[]>(
    initialCameras ?? initialFromWindow ?? [],
  );
  const [active, setActive] = useState<Camera[]>([]);
  const [kecamatanFilter, setKecamatanFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [streamErrors, setStreamErrors] = useState<Record<string, string>>({});
  const [error] = useState<string | null>(upstreamError ?? null);

  // Promote SSR-shipped first page to full server-side list after mount.
  useEffect(() => {
    if (isServer) return;
    setRecent(loadRecent());
    if (
      initialFromWindow &&
      initialCameras &&
      initialFromWindow.length > initialCameras.length
    ) {
      setCameras(initialFromWindow);
    }
  }, [isServer, initialCameras, initialFromWindow]);

  // Debounce search.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const filteredCameras = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return cameras.filter((c) => {
      if (kecamatanFilter !== "all" && c.kecamatan_id !== kecamatanFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        kecamatanName(c.kecamatan_id).toLowerCase().includes(q)
      );
    });
  }, [cameras, search, kecamatanFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredCameras.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedCameras = React.useMemo(
    () => filteredCameras.slice(pageStart, pageStart + PAGE_SIZE),
    [filteredCameras, pageStart],
  );

  const playCamera = useCallback((c: Camera) => {
    setActive((prev) => {
      const without = prev.filter((p) => p.id !== c.id);
      return [c, ...without].slice(0, ACTIVE_MAX);
    });
    pushRecent({
      id: c.id,
      name: c.name,
      stream_id: c.stream_id,
      ts: Date.now(),
    });
    setRecent(loadRecent());
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const closeOne = useCallback((id: string) => {
    setActive((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const closeAll = useCallback(() => {
    setActive([]);
  }, []);

  const onStreamError = useCallback((id: string, msg: string) => {
    setStreamErrors((prev) => ({ ...prev, [id]: msg }));
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    if (isServer) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        return;
      }
      if (e.key === "Escape" && active.length > 0) {
        e.preventDefault();
        closeAll();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const input = document.getElementById("search-input");
        if (input instanceof HTMLInputElement) input.focus();
      } else if (e.key === "ArrowLeft" && page > 1) {
        e.preventDefault();
        setPage((p) => Math.max(1, p - 1));
      } else if (e.key === "ArrowRight" && page < pageCount) {
        e.preventDefault();
        setPage((p) => Math.min(pageCount, p + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer, active, page, pageCount, closeAll]);

  return (
    <>
      <Masthead
        onRefresh={() => window.location.reload()}
        kecamatanFilter={kecamatanFilter}
        onFilterChange={setKecamatanFilter}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        resultCount={filteredCameras.length}
        isSearching={searchInput.trim() !== search.trim()}
      />

      <main className="container">
        {active.length > 0 && (
          <PlayerGrid
            active={active}
            onCloseOne={closeOne}
            onCloseAll={closeAll}
            onError={onStreamError}
            errors={streamErrors}
          />
        )}

        {error && (
          <p className="error-banner" role="status">
            <em>Heads up:</em> {error}
          </p>
        )}

        <CameraMap
          cameras={pagedCameras}
          allCameras={cameras}
          onPlay={playCamera}
        />

        {recent.length > 0 && (
          <RecentRow
            entries={recent.slice(0, 4)}
            cameras={cameras}
            onPlay={playCamera}
          />
        )}

        <ChannelsList
          cameras={pagedCameras}
          totalCount={filteredCameras.length}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          onPlay={playCamera}
          searchInput={searchInput}
        />
      </main>

      <Footer />
    </>
  );
};

// ---- Subcomponents ----

const Masthead = (p: {
  onRefresh: () => void;
  kecamatanFilter: string;
  onFilterChange: (v: string) => void;
  searchInput: string;
  onSearchChange: (v: string) => void;
  resultCount: number;
  isSearching: boolean;
}) => (
  <>
    <header className="masthead">
      <div className="masthead-inner">
        <div className="masthead-meta left">
          <span className="live-dot" />
          Est. 2026 · Vol. 01
        </div>
        <h1 className="wordmark">
          cctv<span className="ampersand">·</span>Mlg
        </h1>
        <div className="masthead-meta right">
          <button
            type="button"
            className="refresh-btn"
            onClick={p.onRefresh}
            aria-label="Muat ulang"
          >
            Muat ulang
          </button>
        </div>
      </div>
      <div className="masthead-rule" />
      <p className="tagline">
        CCTV Kota Malang <em>live</em> — 253 kamera lalu lintas & publik, peta
        interaktif, multi-play.
      </p>
    </header>

    <nav className="masthead-nav" aria-label="Navigasi utama">
      <div className="masthead-nav-inner">
        <div className="search-input-wrap">
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="search-icon"
            width="16"
            height="16"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M16 16 L21 21"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <input
            id="search-input"
            type="search"
            className="search-input"
            placeholder="Cari nama jalan, alamat, kecamatan…"
            value={p.searchInput}
            onChange={(e) => p.onSearchChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Cari kamera"
          />
          {p.searchInput && (
            <button
              type="button"
              className="search-clear"
              onClick={() => p.onSearchChange("")}
              aria-label="Bersihkan pencarian"
            >
              ×
            </button>
          )}
          {!p.searchInput && (
            <kbd className="search-kbd" aria-hidden>
              /
            </kbd>
          )}
        </div>
        <div
          className="filter-chips"
          role="tablist"
          aria-label="Filter kecamatan"
        >
          <button
            type="button"
            role="tab"
            aria-selected={p.kecamatanFilter === "all"}
            className={`chip ${p.kecamatanFilter === "all" ? "chip-active" : ""}`}
            onClick={() => p.onFilterChange("all")}
          >
            Semua
          </button>
          {KECAMATAN.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={p.kecamatanFilter === k.id}
              className={`chip ${p.kecamatanFilter === k.id ? "chip-active" : ""}`}
              onClick={() => p.onFilterChange(k.id)}
            >
              {k.name}
            </button>
          ))}
        </div>
        {p.searchInput && (
          <p className="search-results-count" role="status" aria-live="polite">
            {p.isSearching ? (
              <span className="search-results-loading">
                <span className="dot-pulse" /> Mencari…
              </span>
            ) : (
              <>
                <strong>{p.resultCount}</strong> hasil untuk{" "}
                <em>“{p.searchInput}”</em>
              </>
            )}
          </p>
        )}
      </div>
    </nav>
  </>
);

interface PlayerGridProps {
  active: Camera[];
  onCloseOne: (id: string) => void;
  onCloseAll: () => void;
  onError: (id: string, msg: string) => void;
  errors: Record<string, string>;
}

const PlayerGrid = ({
  active,
  onCloseOne,
  onCloseAll,
  onError,
}: PlayerGridProps) => {
  const cols = Math.min(active.length, 4);
  return (
    <section id="now-playing" className="player-grid-section">
      <header className="player-grid-head">
        <div>
          <span className="section-kicker">
            Sedang Tayang · {active.length} stream
          </span>
          <h2 className="section-title">
            Multi-<em>play</em>
          </h2>
          <p className="section-blurb">
            Buka beberapa kamera sekaligus. Klik × untuk menutup, <kbd>Esc</kbd>{" "}
            untuk menutup semua.
          </p>
        </div>
        <div className="player-grid-actions">
          <button type="button" className="btn btn-link" onClick={onCloseAll}>
            Tutup semua
          </button>
        </div>
      </header>
      <div className={`player-grid cols-${cols}`} role="region">
        {active.map((c) => (
          <StreamPlayer
            key={c.id}
            camera={c}
            onClose={() => onCloseOne(c.id)}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
};

interface StreamPlayerProps {
  camera: Camera;
  onClose: () => void;
  onError: (id: string, msg: string) => void;
}

const StreamPlayer = React.memo(
  ({ camera, onClose, onError }: StreamPlayerProps) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<{ destroy: () => void } | null>(null);
    const [state, setState] = useState<
      "loading" | "playing" | "error" | "paused"
    >("loading");
    const [muted, setMuted] = useState(true);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      let cancelled = false;

      const start = async () => {
        const url = streamUrl(camera);
        // Wait for hls.js to load (deferred script in HTML head).
        const w = window as unknown as {
          Hls?: HlsCtor;
        };
        // Poll for hls.js (script may load after this effect runs).
        for (let i = 0; i < 50 && !w.Hls; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (cancelled) return;
        }
        const hls = w.Hls;
        const canNative =
          video.canPlayType("application/vnd.apple.mpegurl") !== "";

        if (canNative) {
          video.src = url;
          video.play().catch(() => {});
          return;
        }
        if (hls && hls.isSupported()) {
          const inst = new hls();
          hlsRef.current = inst;
          inst.loadSource(url);
          inst.attachMedia(video);
          inst.on(inst.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
          });
          inst.on(inst.Events.ERROR, (...args: unknown[]) => {
            const data = args[1] as { fatal?: boolean } | undefined;
            if (data?.fatal) {
              setState("error");
              onError(camera.id, "stream fatal error");
              try {
                inst.destroy();
              } catch {
                /* */
              }
              hlsRef.current = null;
            }
          });
        } else {
          // Last resort: try native src (might fail on Chromium).
          video.src = url;
          video.play().catch(() => {});
        }
      };

      void start();

      return () => {
        cancelled = true;
        if (hlsRef.current) {
          try {
            hlsRef.current.destroy();
          } catch {
            /* */
          }
          hlsRef.current = null;
        }
        if (video) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
      };
    }, [camera.id, camera.stream_id, onError]);

    return (
      <article className="player-card">
        <header className="player-card-head">
          <div className="player-card-id">
            <span className="player-card-bullet" aria-hidden />
            <div>
              <h3 className="player-card-title">{camera.name}</h3>
              <p className="player-card-meta">
                <span className="player-card-cat">
                  {kecamatanName(camera.kecamatan_id)}
                </span>
              </p>
            </div>
          </div>
          <span className="player-card-actions">
            <button
              type="button"
              className="player-card-iconbtn"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    d="M5 9v6h4l5 4V5L9 9H5z M17 9l4 6 M21 9l-4 6"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    d="M5 9v6h4l5 4V5L9 9H5z M16 8a5 5 0 010 8 M19 5a9 9 0 010 14"
                  />
                </svg>
              )}
            </button>
            <a
              href={sourceUrl(camera)}
              target="_blank"
              rel="noreferrer"
              className="player-card-iconbtn"
              aria-label="Buka sumber stream"
              title="Buka sumber stream"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  d="M14 4h6v6 M20 4l-8 8 M19 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h6"
                />
              </svg>
            </a>
            <button
              type="button"
              className="player-card-iconbtn"
              onClick={onClose}
              aria-label="Tutup stream"
              title="Tutup (Esc)"
            >
              ×
            </button>
          </span>
        </header>
        <div className="player-card-frame">
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted={muted}
            controls
            preload="metadata"
            onPlaying={() => setState("playing")}
            onPause={() => setState("paused")}
            onError={() => {
              setState("error");
              onError(camera.id, "video element error");
            }}
            aria-label={`Stream: ${camera.name}`}
          />
          {state === "loading" && (
            <div className="player-card-loading" aria-hidden>
              <div className="spinner" />
              <span>Memuat stream…</span>
            </div>
          )}
          {state === "error" && (
            <div className="player-card-error" role="alert">
              <p className="state-mark">
                Stream <em>terputus</em>
              </p>
              <p>Coba kamera lain.</p>
            </div>
          )}
        </div>
      </article>
    );
  },
);
StreamPlayer.displayName = "StreamPlayer";

// Minimal hls.js shape — we only call isSupported/new/loadSource/attachMedia/on/destroy.
interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(el: HTMLMediaElement): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  destroy(): void;
  Events: { MANIFEST_PARSED: string; ERROR: string };
}

interface HlsCtor {
  isSupported(): boolean;
  new (): HlsInstance;
}

interface CameraMapProps {
  cameras: Camera[];
  allCameras: Camera[];
  onPlay: (c: Camera) => void;
}

const CameraMap = ({ cameras, allCameras, onPlay }: CameraMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const markerClusterRef = useRef<unknown>(null);
  const markersRef = useRef<Map<string, unknown>>(new Map());
  const [ready, setReady] = useState(false);

  // Init map once Leaflet is loaded (deferred script tag).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = containerRef.current;
    if (!id) return;

    let cancelled = false;
    const init = () => {
      const w = window as unknown as {
        L?: {
          map: (el: HTMLElement, opts?: unknown) => unknown;
          tileLayer: (
            url: string,
            opts?: unknown,
          ) => { addTo: (m: unknown) => unknown };
          markerClusterGroup: (opts?: unknown) => unknown;
          marker: (latlng: [number, number]) => {
            addTo: (g: unknown) => unknown;
            bindPopup: (html: string) => unknown;
            on: (ev: string, cb: (...args: unknown[]) => void) => unknown;
          };
          divIcon: (opts: {
            html: string;
            className: string;
            iconSize: [number, number];
          }) => unknown;
        };
      };
      const L = w.L;
      if (!L || cancelled) return;

      const map = L.map(id, {
        center: [-7.97, 112.63],
        zoom: 12,
        zoomControl: true,
        scrollWheelZoom: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const cluster = L.markerClusterGroup({ disableClusteringAtZoom: 16 });
      markerClusterRef.current = cluster;
      // Add cluster to map.
      try {
        (cluster as unknown as { addTo: (m: unknown) => unknown }).addTo(map);
      } catch {
        /* */
      }
      setReady(true);
    };

    if (typeof (window as unknown as { L?: unknown }).L !== "undefined") {
      init();
    } else {
      const iv = setInterval(() => {
        if (typeof (window as unknown as { L?: unknown }).L !== "undefined") {
          clearInterval(iv);
          init();
        }
      }, 200);
      return () => clearInterval(iv);
    }

    return () => {
      cancelled = true;
      // Map will be GC'd when container unmounts.
    };
  }, []);

  // Render markers whenever cameras change.
  useEffect(() => {
    if (!ready) return;
    const w = window as unknown as {
      L?: {
        markerClusterGroup: (opts?: unknown) => unknown;
        marker: (latlng: [number, number]) => {
          addTo: (g: unknown) => unknown;
          bindPopup: (html: string) => unknown;
          on: (ev: string, cb: (...args: unknown[]) => void) => unknown;
        };
      };
    };
    const L = w.L;
    if (!L || !markerClusterRef.current) return;

    // Clear existing markers.
    const cluster = markerClusterRef.current as {
      clearLayers: () => void;
    };
    cluster.clearLayers();
    markersRef.current.clear();

    for (const c of cameras) {
      if (!c.latitude || !c.longitude) continue;
      const mk = L.marker([c.latitude, c.longitude]);
      const popupHtml =
        `<div class="map-popup">` +
        `<strong>${escapeHtml(c.name)}</strong>` +
        `<br/><span>${escapeHtml(kecamatanName(c.kecamatan_id))}</span>` +
        `<br/><a href="#" data-cam-id="${c.id}" class="map-popup-play">▶ Putar</a>` +
        `</div>`;
      mk.bindPopup(popupHtml);
      mk.on("popupopen", () => {
        // Wire up the play link after popup is rendered.
        setTimeout(() => {
          const link = document.querySelector(
            `.map-popup-play[data-cam-id="${c.id}"]`,
          );
          if (link) {
            link.addEventListener("click", (ev) => {
              ev.preventDefault();
              onPlay(c);
            });
          }
        }, 0);
      });
      (mk as unknown as { addTo: (g: unknown) => unknown }).addTo(cluster);
      markersRef.current.set(c.id, mk);
    }
  }, [cameras, ready, onPlay]);

  return (
    <section className="map-section">
      <header className="section-head">
        <div>
          <span className="section-kicker">Peta · Live</span>
          <h2 className="section-title">
            Peta <em>kamera</em>
          </h2>
          <p className="section-blurb">
            {cameras.length} kamera ditampilkan. Klik marker atau tombol "Putar"
            di popup untuk menambah ke multi-play.
          </p>
        </div>
        <div className="section-count">
          {allCameras.length} total · {cameras.length} terlihat
        </div>
      </header>
      <div
        ref={containerRef}
        className="map-canvas"
        aria-label="Peta CCTV Kota Malang"
      />
      {!ready && (
        <div className="map-loading">
          <div className="spinner" />
          <span>Memuat peta…</span>
        </div>
      )}
    </section>
  );
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ChannelsList = ({
  cameras,
  totalCount,
  page,
  pageCount,
  onPageChange,
  onPlay,
}: {
  cameras: Camera[];
  totalCount: number;
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
  onPlay: (c: Camera) => void;
  searchInput: string;
}) => {
  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = rangeStart + cameras.length - 1;

  if (totalCount === 0) {
    return (
      <section id="list" className="section">
        <header className="section-head">
          <div>
            <span className="section-kicker">Daftar kamera</span>
            <h2 className="section-title">
              Tidak ada <em>kamera</em>
            </h2>
            <p className="section-blurb">
              Coba kata kunci lain atau pilih kecamatan berbeda.
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section id="list" className="section">
      <header className="section-head">
        <div>
          <span className="section-kicker">Daftar kamera</span>
          <h2 className="section-title">
            Semua <em>kamera</em>
          </h2>
          <p className="section-blurb">
            Klik untuk menambah ke multi-play. Maksimal enam stream aktif.
          </p>
        </div>
        <div className="section-count">
          {rangeStart}–{rangeEnd} / {totalCount} kamera
        </div>
      </header>
      <ul className="channel-list">
        {cameras.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="channel-row"
              onClick={() => onPlay(c)}
              data-cam-id={c.id}
            >
              <span className="channel-row-bullet" aria-hidden>
                ●
              </span>
              <span className="channel-row-name">{c.name}</span>
              <span className="channel-row-cat">
                {kecamatanName(c.kecamatan_id)}
              </span>
              <span className="channel-row-play" aria-hidden>
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M5 4l6 4-6 4z" fill="currentColor" />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {pageCount > 1 && (
        <nav className="pagination" aria-label="Halaman">
          <button
            type="button"
            className="pagination-btn pagination-arrow"
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Halaman sebelumnya"
          >
            ‹ Sebelumnya
          </button>
          <span className="pagination-info">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="pagination-btn pagination-arrow"
            disabled={page === pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label="Halaman berikutnya"
          >
            Selanjutnya ›
          </button>
        </nav>
      )}
    </section>
  );
};

const RecentRow = ({
  entries,
  cameras,
  onPlay,
}: {
  entries: RecentEntry[];
  cameras: Camera[];
  onPlay: (c: Camera) => void;
}) => {
  // Map recent ids back to camera records.
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const items = entries
    .map((e) => byId.get(e.id))
    .filter((x): x is Camera => x !== undefined);

  if (items.length === 0) return null;

  return (
    <section id="recent" className="section">
      <header className="section-head">
        <div>
          <span className="section-kicker">Baru dilihat</span>
          <h2 className="section-title">
            Back to the <em>stream</em>
          </h2>
        </div>
        <div className="section-count">{items.length} kamera</div>
      </header>
      <div className="recent-grid">
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            className="recent-card"
            onClick={() => onPlay(c)}
          >
            <span className="recent-name">{c.name}</span>
            <span className="recent-meta">{kecamatanName(c.kecamatan_id)}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

const Footer = () => (
  <footer className="site-footer">
    <div className="container">
      <p>
        Data:{" "}
        <a
          href="https://cctv.malangkota.go.id/sebaran-cctv"
          target="_blank"
          rel="noreferrer"
        >
          Pemerintah Kota Malang
        </a>{" "}
        · Set in Fraunces &amp; Inter Tight
      </p>
      <p className="colophon">
        Tekan <kbd>/</kbd> untuk cari, <kbd>Esc</kbd> untuk tutup, <kbd>←</kbd>/
        <kbd>→</kbd> untuk pindah halaman
      </p>
    </div>
  </footer>
);

export default App;
