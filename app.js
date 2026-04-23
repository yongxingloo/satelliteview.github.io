// Remote endpoints used for scene search and server-side image preview rendering.
const EARTH_SEARCH_API = "https://earth-search.aws.element84.com/v1/search";
const TITILER_STAC_API = "https://titiler.xyz/stac/bbox";

// Initial map camera settings (Zurich area).
const DEFAULT_VIEW = {
  center: [47.3769, 8.5417],
  zoom: 12
};

// Cache references to all interactive UI elements used by the app.
const collectionSelect = document.querySelector("#collectionSelect");
const startDateInput = document.querySelector("#startDateInput");
const endDateInput = document.querySelector("#endDateInput");
const cloudInput = document.querySelector("#cloudInput");
const limitInput = document.querySelector("#limitInput");
const sequenceModeSelect = document.querySelector("#sequenceModeSelect");
const bboxOutput = document.querySelector("#bboxOutput");
const statusText = document.querySelector("#statusText");
const resultCountText = document.querySelector("#resultCountText");
const drawAreaButton = document.querySelector("#drawAreaButton");
const viewAreaButton = document.querySelector("#viewAreaButton");
const clearAreaButton = document.querySelector("#clearAreaButton");
const searchButton = document.querySelector("#searchButton");
const streetsLayerButton = document.querySelector("#streetsLayerButton");
const satelliteLayerButton = document.querySelector("#satelliteLayerButton");
const playButton = document.querySelector("#playButton");
const exportButton = document.querySelector("#exportButton");
const downloadFramesButton = document.querySelector("#downloadFramesButton");
const speedInput = document.querySelector("#speedInput");
const timelineInput = document.querySelector("#timelineInput");
const resultsList = document.querySelector("#resultsList");
const statsGrid = document.querySelector("#statsGrid");
const timelineScale = document.querySelector("#timelineScale");
const timelineTrack = document.querySelector("#timelineTrack");
const playerImage = document.querySelector("#playerImage");
const playerPlaceholder = document.querySelector("#playerPlaceholder");
const playerTitle = document.querySelector("#playerTitle");
const playerSubtitle = document.querySelector("#playerSubtitle");
const downloadLink = document.querySelector("#downloadLink");

// Create the Leaflet map and apply the default view.
const map = L.map("map", {
  zoomControl: true
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

// Add a metric scale bar for distance reference.
L.control.scale({
  imperial: false,
  metric: true
}).addTo(map);

// Define available base layers (street and satellite).
const streetLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20
});

const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
  maxZoom: 19
});

// Start the app with satellite imagery turned on.
satelliteLayer.addTo(map);

// Layers for user-selected area, all footprints, and highlighted footprint.
const aoiLayer = L.featureGroup().addTo(map);
const footprintLayer = L.geoJSON(null, {
  style: () => ({
    color: "#ff7b54",
    weight: 1.4,
    fillColor: "#ff7b54",
    fillOpacity: 0.1
  })
}).addTo(map);

const highlightedLayer = L.geoJSON(null, {
  style: () => ({
    color: "#f3efe7",
    weight: 2.2,
    fillColor: "#f5b13d",
    fillOpacity: 0.14
  })
}).addTo(map);

// Central runtime state for map drawing, scene results, playback, and export.
const state = {
  bbox: null,
  aoiRectangle: null,
  tempRectangle: null,
  anchorLatLng: null,
  drawing: false,
  items: [],
  selectedIndex: -1,
  playing: false,
  playTimer: null,
  exporting: false
};

// Off-screen canvas used to compose frames for video export.
const exportCanvas = document.createElement("canvas");
const exportContext = exportCanvas.getContext("2d");

// Pre-fill date filters with a one-year range ending today.
function initializeDates() {
  // Use the current day as the default end date.
  const end = new Date();
  // Clone the date and move it one year back for the default start date.
  const start = new Date();
  start.setFullYear(end.getFullYear() - 1);
  // Write both dates into the date input fields in YYYY-MM-DD format.
  startDateInput.value = toDateInputValue(start);
  endDateInput.value = toDateInputValue(end);
}

// Convert a Date object into YYYY-MM-DD for date inputs.
function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

// Show a status message in the UI.
function setStatus(message) {
  statusText.textContent = message;
}

// Update the small label that tells how many scenes are loaded.
function setResultCount(count) {
  resultCountText.textContent = `${count} scene${count === 1 ? "" : "s"} loaded`;
}

// Toggle which base map is visible and update active button styles.
function setActiveMapLayer(layerName) {
  // If satellite is requested, ensure the street layer is removed.
  if (layerName === "satellite") {
    map.removeLayer(streetLayer);
    // Add satellite imagery and update button highlight state.
    satelliteLayer.addTo(map);
    streetsLayerButton.classList.remove("active");
    satelliteLayerButton.classList.add("active");
    return;
  }

  // Otherwise switch to the street-style basemap.
  map.removeLayer(satelliteLayer);
  streetLayer.addTo(map);
  satelliteLayerButton.classList.remove("active");
  streetsLayerButton.classList.add("active");
}

// Enable/disable export buttons based on current state and available frames.
function setExportButtonState() {
  // Count frames that have a usable preview URL.
  const renderableFrames = state.items.filter((scene) => scene.frameUrl).length;
  // Video export needs at least 2 frames; ZIP export needs at least 1.
  exportButton.disabled = state.exporting || renderableFrames < 2;
  downloadFramesButton.disabled = state.exporting || renderableFrames < 1;
  // Swap labels to indicate progress while export is running.
  exportButton.textContent = state.exporting ? "Rendering video..." : "Download WebM";
  downloadFramesButton.textContent = state.exporting ? "Preparing ZIP..." : "Download ZIP";
}

// Format coordinates to a readable precision.
function formatCoordinate(value) {
  return value.toFixed(4);
}

// Create a human-readable bounding box label.
function formatBBox(bbox) {
  // If no area exists yet, show a friendly placeholder message.
  if (!bbox) {
    return "No area selected yet.";
  }

  // Unpack the bbox into named values to improve readability.
  const [west, south, east, north] = bbox;
  // Return a compact text summary using consistent decimal formatting.
  return `W ${formatCoordinate(west)}, S ${formatCoordinate(south)}, E ${formatCoordinate(east)}, N ${formatCoordinate(north)}`;
}

// Convert Leaflet bounds to a normalized [west, south, east, north] array.
function normalizeBounds(bounds) {
  // Leaflet stores corners as southwest and northeast points.
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  // Return [west, south, east, north] with fixed precision for stable queries.
  return [
    Number(southWest.lng.toFixed(5)),
    Number(southWest.lat.toFixed(5)),
    Number(northEast.lng.toFixed(5)),
    Number(northEast.lat.toFixed(5))
  ];
}

// Save and render the currently selected area of interest (AOI).
function setBBox(bbox, fitMap = true) {
  // Persist bbox in state and reflect it in the UI.
  state.bbox = bbox;
  bboxOutput.textContent = formatBBox(bbox);

  // Remove previously rendered AOI rectangle before drawing a new one.
  if (state.aoiRectangle) {
    aoiLayer.removeLayer(state.aoiRectangle);
  }

  // If bbox is null, the AOI is being cleared.
  if (!bbox) {
    state.aoiRectangle = null;
    return;
  }

  // Convert bbox array into Leaflet bounds: [lat, lng] corners.
  const latLngBounds = L.latLngBounds(
    [bbox[1], bbox[0]],
    [bbox[3], bbox[2]]
  );

  // Draw a dashed rectangle so the selected search area is visible.
  state.aoiRectangle = L.rectangle(latLngBounds, {
    color: "#f5b13d",
    weight: 2,
    dashArray: "8 6",
    fillOpacity: 0.08
  }).addTo(aoiLayer);

  // Optionally move/zoom the map so the AOI is comfortably in view.
  if (fitMap) {
    map.fitBounds(latLngBounds.pad(0.35));
  }
}

// Remove the temporary rectangle shown while the user is drawing.
function clearTempRectangle() {
  if (state.tempRectangle) {
    aoiLayer.removeLayer(state.tempRectangle);
    state.tempRectangle = null;
  }
}

// Exit draw mode and reset temporary drawing helpers.
function stopDrawing() {
  // Reset drawing-related state.
  state.drawing = false;
  state.anchorLatLng = null;
  clearTempRectangle();
  // Restore button and map cursor styling.
  drawAreaButton.dataset.active = "false";
  drawAreaButton.textContent = "Draw area on map";
  map.getContainer().classList.remove("drawing-active");
}

// Enter draw mode so the user can click two corners on the map.
function startDrawing() {
  // Enable draw mode and clear leftovers from earlier attempts.
  state.drawing = true;
  state.anchorLatLng = null;
  clearTempRectangle();
  // Update UI to indicate drawing is active.
  drawAreaButton.dataset.active = "true";
  drawAreaButton.textContent = "Finish drawing";
  map.getContainer().classList.add("drawing-active");
  setStatus("Click two opposite corners on the map to define the search area.");
}

// Switch between drawing and not drawing.
function toggleDrawing() {
  if (state.drawing) {
    stopDrawing();
    setStatus("Area drawing cancelled.");
    return;
  }
  startDrawing();
}

// Safely parse and clamp numeric input values to allowed ranges.
function clampNumber(value, min, max, fallback) {
  // Convert unknown input to number.
  const numeric = Number(value);
  // If conversion fails, use the safe fallback.
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  // Clamp to allowed range to avoid invalid API requests.
  return Math.max(min, Math.min(max, numeric));
}

// Build and validate the STAC search request payload from the UI.
function buildSearchPayload() {
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;

  // Require an AOI because Earth Search needs a spatial filter.
  if (!state.bbox) {
    throw new Error("Select an area on the map before searching.");
  }

  // Require both date endpoints.
  if (!startDate || !endDate) {
    throw new Error("Choose both a start date and end date.");
  }

  // Basic chronological validation.
  if (startDate > endDate) {
    throw new Error("The start date must be before the end date.");
  }

  // Read optional numeric filters with guardrails.
  const maxCloud = clampNumber(cloudInput.value, 0, 100, 25);
  const limit = clampNumber(limitInput.value, 5, 60, 18);

  // Build STAC POST payload with ascending date sort and cloud filter.
  return {
    collections: [collectionSelect.value],
    bbox: state.bbox,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    limit,
    sortby: [{ field: "properties.datetime", direction: "asc" }],
    query: {
      "eo:cloud_cover": {
        lte: maxCloud
      }
    }
  };
}

// Compute area of a bbox in coordinate-space units.
function bboxArea(bbox) {
  // Invalid or missing bbox has no area.
  if (!bbox || bbox.length !== 4) {
    return 0;
  }

  // Ensure width/height are non-negative before multiplying.
  const width = Math.max(0, bbox[2] - bbox[0]);
  const height = Math.max(0, bbox[3] - bbox[1]);
  return width * height;
}

// Return the overlapping bbox of two boxes, or null if they do not overlap.
function intersectBBoxes(a, b) {
  // Need both boxes to compute overlap.
  if (!a || !b) {
    return null;
  }

  // Overlap is bounded by max west/south and min east/north.
  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);

  // If bounds cross or touch, there is no positive-area intersection.
  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

// Measure how much of the target AOI is covered by a scene (0..1).
function computeCoverageScore(sceneBBox, targetBBox) {
  // Find the overlap between scene and selected AOI.
  const intersection = intersectBBoxes(sceneBBox, targetBBox);
  const targetArea = bboxArea(targetBBox);

  // No overlap or zero-sized AOI means zero coverage.
  if (!intersection || targetArea === 0) {
    return 0;
  }

  // Coverage is overlap fraction of target AOI.
  return bboxArea(intersection) / targetArea;
}

// Check whether a scene bbox completely contains the target AOI.
function sceneFullyCoversBBox(sceneBBox, targetBBox) {
  // Missing boxes cannot satisfy full coverage.
  if (!sceneBBox || !targetBBox) {
    return false;
  }

  // Full coverage means scene contains all four AOI edges.
  return sceneBBox[0] <= targetBBox[0]
    && sceneBBox[1] <= targetBBox[1]
    && sceneBBox[2] >= targetBBox[2]
    && sceneBBox[3] >= targetBBox[3];
}

// Pick the best visual asset strategy available for a STAC item.
function resolveFrameSource(item) {
  // STAC assets can vary by collection/provider.
  const assets = item.assets ?? {};

  // Prefer explicit RGB band triplets when present.
  if (assets.red?.href && assets.green?.href && assets.blue?.href) {
    return { type: "rgb-bands", assetKeys: ["red", "green", "blue"] };
  }

  // Sentinel-style band names for RGB fallback.
  if (assets.B04?.href && assets.B03?.href && assets.B02?.href) {
    return { type: "rgb-bands", assetKeys: ["B04", "B03", "B02"] };
  }

  // Some catalogs expose one pre-rendered visual asset.
  if (assets.visual?.href) {
    return { type: "single-asset", assetKeys: ["visual"] };
  }

  if (assets.image?.href) {
    return { type: "single-asset", assetKeys: ["image"] };
  }

  // Fall back to preview-like images if full assets are unavailable.
  if (assets.rendered_preview?.href) {
    return { type: "preview-image", href: assets.rendered_preview.href };
  }

  if (assets.overview?.href) {
    return { type: "preview-image", href: assets.overview.href };
  }

  if (assets.preview?.href) {
    return { type: "preview-image", href: assets.preview.href };
  }

  if (assets.thumbnail?.href) {
    return { type: "preview-image", href: assets.thumbnail.href };
  }

  return null;
}

// Build a TiTiler URL that crops and renders the same AOI for each frame.
function buildTitilerPreviewUrl(itemUrl, source, bbox) {
  // Encode bbox in URL path as fixed precision for consistency.
  const bboxPath = bbox.map((value) => Number(value).toFixed(5)).join(",");
  // Query parameters tell TiTiler what to render and how.
  const params = new URLSearchParams({
    url: itemUrl,
    width: "900",
    height: "900",
    rescale: "0,4000",
    coord_crs: "epsg:4326",
    dst_crs: "epsg:4326"
  });

  // Request each chosen asset key from the STAC item.
  source.assetKeys.forEach((assetKey) => {
    params.append("assets", assetKey);
  });

  // For RGB bands, force one band per color channel and per-band rescaling.
  if (source.type === "rgb-bands") {
    params.set("asset_as_band", "true");
    params.append("rescale", "0,4000");
    params.append("rescale", "0,4000");
    params.append("rescale", "0,4000");
  }

  return `${TITILER_STAC_API}/${bboxPath}/900x900.png?${params.toString()}`;
}

// Resolve a direct preview URL for a scene, preferring AOI-cropped TiTiler output.
function resolveFrameUrl(item) {
  const frameSource = resolveFrameSource(item);

  // If no usable assets exist, this scene cannot provide a frame.
  if (!frameSource) {
    return "";
  }

  // Prefer the STAC self link for TiTiler requests.
  const itemUrl = item.links?.find((link) => link.rel === "self")?.href ?? "";

  // Build a consistently cropped frame for timelapse alignment.
  if (
    state.bbox
    && itemUrl
    && (frameSource.type === "rgb-bands" || frameSource.type === "single-asset")
  ) {
    return buildTitilerPreviewUrl(itemUrl, frameSource, state.bbox);
  }

  // If only static previews exist, allow common web image formats.
  if (frameSource.type === "preview-image") {
    const lowerHref = frameSource.href.toLowerCase();
    if (lowerHref.endsWith(".jpg") || lowerHref.endsWith(".jpeg") || lowerHref.endsWith(".png") || lowerHref.endsWith(".webp")) {
      return frameSource.href;
    }
  }

  return "";
}

// Convert raw STAC features into a normalized scene object used by the UI.
function mapFeatureToScene(feature) {
  // Treat incoming feature as a STAC item for readability.
  const item = feature;
  const properties = item.properties ?? {};
  // Use the best available acquisition timestamp key.
  const sceneDate = properties.datetime ?? properties["start_datetime"] ?? "";
  const cloudCover = Number(properties["eo:cloud_cover"]);
  // Fall back to current selected collection/provider when metadata is missing.
  const collection = item.collection ?? collectionSelect.value;
  const provider = properties.platform ?? properties.constellation ?? "Satellite scene";
  // Resolve preview URL and spatial coverage metrics used for filtering.
  const frameUrl = resolveFrameUrl(item);
  const coverageScore = computeCoverageScore(item.bbox ?? null, state.bbox);
  const fullCoverage = sceneFullyCoversBBox(item.bbox ?? null, state.bbox);
  const tileId = properties["s2:tile_id"] ?? properties["mgrs:tile"] ?? "";

  return {
    id: item.id,
    collection,
    provider,
    datetime: sceneDate,
    cloudCover: Number.isFinite(cloudCover) ? cloudCover : null,
    geometry: item.geometry ?? null,
    bbox: item.bbox ?? null,
    coverageScore,
    fullCoverage,
    tileId,
    frameUrl,
    browserUrl: item.links?.find((link) => link.rel === "self")?.href ?? "",
    item
  };
}

// Keep one best scene per day to avoid redundant frames.
function dedupeScenesByDay(scenes) {
  // Keep only one representative scene per calendar day.
  const bestByDay = new Map();

  scenes.forEach((scene) => {
    // Use date portion as key; fallback to id when datetime is unavailable.
    const dayKey = scene.datetime ? scene.datetime.slice(0, 10) : scene.id;
    const existing = bestByDay.get(dayKey);

    // First scene for that day wins temporarily.
    if (!existing) {
      bestByDay.set(dayKey, scene);
      return;
    }

    // Compare quality: better AOI coverage first, then lower cloud cover.
    const sceneCloud = scene.cloudCover ?? Number.POSITIVE_INFINITY;
    const existingCloud = existing.cloudCover ?? Number.POSITIVE_INFINITY;

    if (scene.coverageScore > existing.coverageScore || (scene.coverageScore === existing.coverageScore && sceneCloud < existingCloud)) {
      bestByDay.set(dayKey, scene);
    }
  });

  // Return scenes sorted chronologically for playback.
  return Array.from(bestByDay.values()).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

// Filter and order scenes according to the selected sequence mode.
function refineSceneSequence(scenes) {
  // Early return for empty searches.
  if (!scenes.length) {
    return [];
  }

  // User-selected mode controls strictness of filtering.
  const mode = sequenceModeSelect.value;
  // Prefer scenes that have actual frame URLs.
  const frameReadyScenes = scenes.filter((scene) => scene.frameUrl);
  const usableScenes = frameReadyScenes.length ? frameReadyScenes : scenes;

  let filteredScenes = usableScenes;

  if (mode === "strict") {
    // Strict mode: aim for complete AOI coverage, with gradual fallback.
    const fullCoverageScenes = usableScenes.filter((scene) => scene.fullCoverage);
    const coveragePool = fullCoverageScenes.length ? fullCoverageScenes : usableScenes.filter((scene) => scene.coverageScore > 0.92);
    filteredScenes = coveragePool.length ? coveragePool : usableScenes.filter((scene) => scene.coverageScore > 0);
  } else if (mode === "balanced") {
    // Balanced mode: keep mostly well-covered scenes.
    const nearFullCoverageScenes = usableScenes.filter((scene) => scene.coverageScore > 0.72);
    filteredScenes = nearFullCoverageScenes.length ? nearFullCoverageScenes : usableScenes.filter((scene) => scene.coverageScore > 0);
  } else {
    // Dense mode: keep all scenes that intersect the AOI.
    filteredScenes = usableScenes.filter((scene) => scene.coverageScore > 0);
  }

  // Dense mode keeps all filtered frames; other modes reduce daily duplicates.
  const dedupedScenes = mode === "dense" ? filteredScenes : dedupeScenesByDay(filteredScenes.length ? filteredScenes : usableScenes);

  // Count how often each tile appears so strict mode can favor a stable tile.
  const dominantTileCounts = new Map();
  dedupedScenes.forEach((scene) => {
    if (!scene.tileId) {
      return;
    }
    dominantTileCounts.set(scene.tileId, (dominantTileCounts.get(scene.tileId) ?? 0) + 1);
  });

  // Pick tile with highest frequency and optionally filter to it.
  const dominantTile = Array.from(dominantTileCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const tileFilteredScenes = mode === "strict" && dominantTile
    ? dedupedScenes.filter((scene) => !scene.tileId || scene.tileId === dominantTile)
    : dedupedScenes;

  // Final sort ensures stable ordering in UI and playback.
  return tileFilteredScenes.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

// Format scene timestamps with date and time for cards/player labels.
function formatSceneDate(datetime) {
  if (!datetime) {
    return "Unknown acquisition time";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(datetime));
}

// Format timestamps as date only (used by timeline and stats).
function formatDateOnly(datetime) {
  if (!datetime) {
    return "--";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(datetime));
}

// Compute whole-day distance between two timestamps.
function differenceInDays(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 86400000));
}

// Render statistics cards and the visual timeline from current scene results.
function renderAnalytics() {
  // Guard for layouts that may not include analytics widgets.
  if (!statsGrid || !timelineScale || !timelineTrack) {
    return;
  }

  const scenes = state.items;
  // Rebuild analytics from scratch on each render.
  statsGrid.innerHTML = "";
  timelineScale.innerHTML = "";
  timelineTrack.innerHTML = "";

  // Empty state cards before any successful search.
  if (!scenes.length) {
    statsGrid.innerHTML = `
      <article class="stat-card">
        <span class="status-label">Scenes</span>
        <strong>0</strong>
        <p>No search yet</p>
      </article>
      <article class="stat-card">
        <span class="status-label">Range</span>
        <strong>--</strong>
        <p>Waiting for results</p>
      </article>
      <article class="stat-card">
        <span class="status-label">Cadence</span>
        <strong>--</strong>
        <p>Average revisit</p>
      </article>
      <article class="stat-card">
        <span class="status-label">Cloud</span>
        <strong>--</strong>
        <p>Average cloud cover</p>
      </article>
    `;
    timelineTrack.innerHTML = '<div class="empty-state">Timeline will appear after a search.</div>';
    return;
  }

  // Sort scenes with valid datetime for range and cadence calculations.
  const datedScenes = scenes.filter((scene) => scene.datetime).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const firstScene = datedScenes[0] ?? scenes[0];
  const lastScene = datedScenes[datedScenes.length - 1] ?? scenes[scenes.length - 1];
  const dateSpanDays = datedScenes.length > 1 ? differenceInDays(firstScene.datetime, lastScene.datetime) : 0;
  const cloudValues = scenes.map((scene) => scene.cloudCover).filter((value) => Number.isFinite(value));
  const averageCloud = cloudValues.length
    ? `${(cloudValues.reduce((sum, value) => sum + value, 0) / cloudValues.length).toFixed(1)}%`
    : "--";

  // Cadence is the mean day gap between neighboring scenes.
  let averageCadence = "--";
  if (datedScenes.length > 1) {
    const intervals = [];
    for (let index = 1; index < datedScenes.length; index += 1) {
      intervals.push(differenceInDays(datedScenes[index - 1].datetime, datedScenes[index].datetime));
    }
    const meanInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    averageCadence = `${meanInterval.toFixed(1)} d`;
  }

  // Render high-level numeric summary cards.
  statsGrid.innerHTML = `
    <article class="stat-card">
      <span class="status-label">Scenes</span>
      <strong>${scenes.length}</strong>
      <p>Current results</p>
    </article>
    <article class="stat-card">
      <span class="status-label">Range</span>
      <strong>${dateSpanDays} d</strong>
      <p>${formatDateOnly(firstScene.datetime)} to ${formatDateOnly(lastScene.datetime)}</p>
    </article>
    <article class="stat-card">
      <span class="status-label">Cadence</span>
      <strong>${averageCadence}</strong>
      <p>Average revisit</p>
    </article>
    <article class="stat-card">
      <span class="status-label">Cloud</span>
      <strong>${averageCloud}</strong>
      <p>Average cloud cover</p>
    </article>
  `;

  timelineScale.innerHTML = `
    <span>${formatDateOnly(firstScene.datetime)}</span>
    <span>${formatDateOnly(lastScene.datetime)}</span>
  `;

  // Single-point timeline fallback.
  if (datedScenes.length === 1) {
    const onlyIndex = scenes.findIndex((scene) => scene.id === datedScenes[0].id);
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "timeline-dot active";
    dot.style.left = "50%";
    dot.dataset.label = formatDateOnly(datedScenes[0].datetime);
    dot.title = datedScenes[0].id;
    dot.addEventListener("click", () => selectScene(onlyIndex, true));
    timelineTrack.append(dot);
    return;
  }

  // Place each scene dot proportionally across total date span.
  const spanMs = Math.max(1, new Date(lastScene.datetime) - new Date(firstScene.datetime));
  datedScenes.forEach((scene) => {
    const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
    const offset = ((new Date(scene.datetime) - new Date(firstScene.datetime)) / spanMs) * 100;
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `timeline-dot${sceneIndex === state.selectedIndex ? " active" : ""}`;
    dot.style.left = `calc(1rem + (${offset} * (100% - 2rem) / 100))`;
    dot.dataset.label = formatDateOnly(scene.datetime);
    dot.title = scene.id;
    dot.addEventListener("click", () => selectScene(sceneIndex, true));
    timelineTrack.append(dot);
  });
}

// Render result cards, map footprints, and ensure player/timeline stay in sync.
function renderResults() {
  // Clear previous DOM/cards and map overlays before rendering new results.
  resultsList.innerHTML = "";
  footprintLayer.clearLayers();
  highlightedLayer.clearLayers();
  setResultCount(state.items.length);
  renderAnalytics();

  // Show empty message and reset player when no scenes are available.
  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No scenes matched this search yet. Try widening the date range or increasing the cloud threshold.";
    resultsList.append(empty);
    renderPlayer();
    return;
  }

  state.items.forEach((scene, index) => {
    // Draw each scene footprint on the map if geometry exists.
    if (scene.geometry) {
      footprintLayer.addData(scene.geometry);
    }

    // Build result card and mark it active when selected.
    const card = document.createElement("article");
    card.className = `result-card${index === state.selectedIndex ? " active" : ""}`;

    // Prepare readable metadata text snippets for the card.
    const cloudText = scene.cloudCover === null ? "Cloud cover unavailable" : `${scene.cloudCover.toFixed(1)}% cloud cover`;
    const coverageText = scene.fullCoverage
      ? "Full AOI coverage"
      : `${(scene.coverageScore * 100).toFixed(0)}% AOI coverage`;
    // Either show an image thumbnail or an explicit unavailable placeholder.
    const imageMarkup = scene.frameUrl
      ? `<img class="result-thumb" src="${scene.frameUrl}" alt="Preview for ${scene.id}" loading="lazy">`
      : `<div class="result-thumb result-thumb-placeholder">Preview unavailable</div>`;

    card.innerHTML = `
      ${imageMarkup}
      <div class="result-content">
        <div class="result-topline">
          <span class="pill">${scene.provider}</span>
          <span class="pill pill-muted">${scene.collection}</span>
        </div>
        <h3>${scene.id}</h3>
        <p>${formatSceneDate(scene.datetime)}</p>
        <p>${cloudText}</p>
        <p>${coverageText}</p>
        <button type="button" class="button button-inline" data-scene-index="${index}">Focus scene</button>
      </div>
    `;

    resultsList.append(card);
  });

  // Wire focus buttons after cards are inserted into the DOM.
  resultsList.querySelectorAll("[data-scene-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.sceneIndex);
      selectScene(index, true);
    });
  });

  // Auto-select first scene when selection is empty; otherwise refresh player only.
  if (state.selectedIndex === -1 && state.items.length) {
    selectScene(0, false);
  } else {
    renderPlayer();
  }
}

// Zoom and highlight the currently selected scene footprint on the map.
function focusSceneOnMap(scene) {
  // Clear previous highlight to avoid multiple emphasized footprints.
  highlightedLayer.clearLayers();
  if (scene.geometry) {
    // Prefer exact geometry when available.
    highlightedLayer.addData(scene.geometry);
    const bounds = highlightedLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2));
    }
    return;
  }

  // Fall back to bbox fit if geometry is missing.
  if (scene.bbox) {
    const bounds = L.latLngBounds(
      [scene.bbox[1], scene.bbox[0]],
      [scene.bbox[3], scene.bbox[2]]
    );
    map.fitBounds(bounds.pad(0.2));
  }
}

// Update the image player panel based on current selection and app state.
function renderPlayer() {
  // Determine whether playback controls should be enabled.
  const hasItems = state.items.length > 0;
  const selectedScene = state.items[state.selectedIndex] ?? null;
  timelineInput.disabled = !hasItems;
  playButton.disabled = !hasItems;
  setExportButtonState();
  timelineInput.max = String(Math.max(0, state.items.length - 1));
  timelineInput.value = String(Math.max(0, state.selectedIndex));

  // Empty player state before/after unsuccessful searches.
  if (!selectedScene) {
    playerImage.removeAttribute("src");
    playerImage.hidden = true;
    playerPlaceholder.hidden = false;
    playerPlaceholder.textContent = "Search an area to populate the timelapse frames.";
    playerTitle.textContent = "No frame selected";
    playerSubtitle.textContent = "Awaiting overpass search";
    downloadLink.hidden = true;
    playButton.textContent = "Play";
    return;
  }

  // Show frame image when available and expose direct download link.
  if (selectedScene.frameUrl) {
    playerImage.src = selectedScene.frameUrl;
    playerImage.hidden = false;
    playerPlaceholder.hidden = true;
    downloadLink.href = selectedScene.frameUrl;
    downloadLink.hidden = false;
  } else {
    // Otherwise explain that this scene has no directly usable preview.
    playerImage.removeAttribute("src");
    playerImage.hidden = true;
    playerPlaceholder.hidden = false;
    playerPlaceholder.textContent = "This scene is missing a directly usable preview asset.";
    downloadLink.hidden = true;
  }

  // Update heading and subtitle with current scene metadata.
  playerTitle.textContent = `${state.selectedIndex + 1} / ${state.items.length} · ${formatSceneDate(selectedScene.datetime)}`;
  playerSubtitle.textContent = selectedScene.cloudCover === null
    ? `${selectedScene.id} · ${(selectedScene.coverageScore * 100).toFixed(0)}% AOI coverage`
    : `${selectedScene.id} · ${selectedScene.cloudCover.toFixed(1)}% cloud cover · ${(selectedScene.coverageScore * 100).toFixed(0)}% AOI coverage`;
}

// Select one scene, update list highlighting, and optionally focus map bounds.
function selectScene(index, focusMap) {
  // Persist new active index.
  state.selectedIndex = index;

  // Toggle active card highlight in the sidebar list.
  const cards = resultsList.querySelectorAll(".result-card");
  cards.forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === index);
  });

  if (focusMap) {
    // Focus map only when user explicitly asked to focus.
    focusSceneOnMap(state.items[index]);
  } else {
    // Otherwise just update highlighted geometry without changing map view.
    highlightedLayer.clearLayers();
    if (state.items[index]?.geometry) {
      highlightedLayer.addData(state.items[index].geometry);
    }
  }

  renderAnalytics();
  renderPlayer();
}

// Stop automated playback and reset related UI state.
function stopPlayback() {
  // Stop timer loop and restore idle playback button state.
  state.playing = false;
  clearInterval(state.playTimer);
  state.playTimer = null;
  playButton.textContent = "Play";
  setExportButtonState();
}

// Start cycling through scenes at the configured playback speed.
function startPlayback() {
  // Need at least 2 scenes for meaningful playback.
  if (state.items.length < 2) {
    return;
  }

  state.playing = true;
  playButton.textContent = "Pause";
  setExportButtonState();

  const framesPerSecond = clampNumber(speedInput.value, 1, 6, 2);
  // Convert FPS to interval timer in milliseconds.
  const interval = Math.round(1000 / framesPerSecond);

  clearInterval(state.playTimer);
  // Rotate through all scenes in a loop.
  state.playTimer = setInterval(() => {
    const nextIndex = (state.selectedIndex + 1) % state.items.length;
    selectScene(nextIndex, false);
  }, interval);
}

// Run a STAC search, transform results, and refresh the app UI.
async function searchScenes() {
  let payload;

  try {
    // Validate UI inputs and construct request body.
    payload = buildSearchPayload();
  } catch (error) {
    // Show validation feedback without making a network call.
    setStatus(error.message);
    return;
  }

  // Start loading state before requesting scenes.
  stopPlayback();
  searchButton.disabled = true;
  setExportButtonState();
  setStatus("Searching public STAC scenes for overpasses that intersect the selected area...");

  try {
    // Query Earth Search STAC API with the generated payload.
    const response = await fetch(EARTH_SEARCH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Search failed with HTTP ${response.status}.`);
    }

    // Convert API response into app-specific scene objects.
    const data = await response.json();
    const features = Array.isArray(data.features) ? data.features : [];
    const rawScenes = features.map(mapFeatureToScene);
    // Apply sequence mode filtering and initialize selection.
    state.items = refineSceneSequence(rawScenes);
    state.selectedIndex = state.items.length ? 0 : -1;

    renderResults();

    if (state.items.length) {
      // Include active mode in success status for user clarity.
      const modeLabel = sequenceModeSelect.options[sequenceModeSelect.selectedIndex]?.text ?? "Balanced";
      setStatus(`Loaded ${state.items.length} overpasses in ${modeLabel.toLowerCase()} mode using the same AOI crop for each frame.`);
    } else {
      setStatus("The search completed, but no scenes matched the current date and cloud filters.");
    }
  } catch (error) {
    // Reset result state on request/parsing failures.
    state.items = [];
    state.selectedIndex = -1;
    renderResults();
    setStatus(`Search error: ${error.message} Check your connection or try a smaller date range.`);
  } finally {
    // Always re-enable search button after request completes.
    searchButton.disabled = false;
  }
}

// Convert user/content strings into filesystem-safe name parts.
function sanitizeFilenamePart(value) {
  // Replace unsafe filename characters and normalize to lowercase.
  return String(value).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "timelapse";
}

// Promise-based sleep helper used to pace exported frames.
function wait(ms) {
  // Utility Promise used with await to create a delay.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Load an image URL into a drawable image object for canvas rendering.
async function loadImageForExport(url) {
  try {
    // Request frame with CORS enabled so it can be drawn to canvas.
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Prefer ImageBitmap when available for faster canvas drawing.
    const blob = await response.blob();
    if ("createImageBitmap" in window) {
      return await createImageBitmap(blob);
    }

    // Fallback path: decode via temporary object URL and HTMLImageElement.
    const objectUrl = URL.createObjectURL(blob);
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Could not decode frame: ${url}`));
      };
      image.src = objectUrl;
    });
  } catch (error) {
    // Wrap lower-level errors with export-specific context.
    throw new Error(`Could not load frame for export: ${error.message}`);
  }
}

// Download a frame URL and return it as a Blob.
async function fetchFrameBlob(url) {
  // Simple fetch helper used by ZIP export.
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
}

// Trigger a browser download for generated files (video or zip).
function triggerDownload(blob, fileName) {
  // Create a temporary object URL and click a hidden anchor to download.
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke URL later to free memory after browser consumes it.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
}

// Draw one export frame on canvas, including a readable date/id overlay.
function drawExportFrame(image, width, height, labelScene) {
  // Clear previous frame and draw a dark background behind the image.
  exportContext.clearRect(0, 0, width, height);
  exportContext.fillStyle = "#08111f";
  exportContext.fillRect(0, 0, width, height);
  exportContext.drawImage(image, 0, 0, width, height);

  // Draw a translucent caption bar for legible text overlays.
  exportContext.fillStyle = "rgba(6, 12, 22, 0.62)";
  exportContext.fillRect(20, height - 78, Math.min(width - 40, 420), 58);
  exportContext.fillStyle = "#edf5ff";
  exportContext.font = '600 24px "Inter", sans-serif';
  exportContext.fillText(formatSceneDate(labelScene.datetime), 34, height - 42);
  // Include scene id below the date for traceability.
  exportContext.font = '400 16px "Inter", sans-serif';
  exportContext.fillText(labelScene.id, 34, height - 18);
}

// Render all frames into a WebM animation and download it.
async function exportAnimation() {
  // Prevent overlap with another export and require enough scenes.
  if (state.exporting || state.items.length < 2) {
    return;
  }

  // Use only scenes with renderable frame URLs.
  const frameScenes = state.items.filter((scene) => scene.frameUrl);
  if (frameScenes.length < 2) {
    setStatus("At least two renderable frames are needed before an animation can be downloaded.");
    return;
  }

  // Browser capability check for recording canvas output.
  if (typeof MediaRecorder === "undefined") {
    setStatus("This browser does not support animation export through MediaRecorder.");
    return;
  }

  // Enter exporting state and pause playback while rendering.
  state.exporting = true;
  stopPlayback();
  setExportButtonState();
  setStatus(`Rendering ${frameScenes.length} frames into a downloadable WebM video...`);

  // Remember current selection so it can be restored after export.
  const previousIndex = state.selectedIndex;

  try {
    // Preload all frame images before starting recorder.
    const loadedFrames = await Promise.all(frameScenes.map((scene) => loadImageForExport(scene.frameUrl)));
    // Match canvas size to first frame dimensions (or default).
    const width = loadedFrames[0].naturalWidth || loadedFrames[0].width || 900;
    const height = loadedFrames[0].naturalHeight || loadedFrames[0].height || 900;
    exportCanvas.width = width;
    exportCanvas.height = height;

    // Export FPS is user-controlled with conservative bounds.
    const fps = clampNumber(speedInput.value, 1, 12, 2);
    const frameDuration = Math.max(120, Math.round(1000 / fps));
    // Capture canvas as a MediaStream for MediaRecorder.
    const stream = exportCanvas.captureStream(fps);
    // Prefer VP9, then VP8, then generic WebM if needed.
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";

    // Defensive check in case environment changes unexpectedly.
    if (typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support WebM export.");
    }

    // Accumulate recorder chunks and resolve to a single Blob on stop.
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    const renderedBlob = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(new Error("WebM recording failed."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    // Start recording and then render frames one-by-one.
    recorder.start(250);

    for (let index = 0; index < loadedFrames.length; index += 1) {
      const image = loadedFrames[index];
      const labelScene = frameScenes[index];
      // Draw frame and overlay labels onto export canvas.
      drawExportFrame(image, width, height, labelScene);

      // Keep on-screen player in sync with the frame currently being exported.
      const liveIndex = state.items.findIndex((scene) => scene.id === labelScene.id);
      if (liveIndex >= 0) {
        selectScene(liveIndex, false);
      }

      // Hold each frame long enough for the recorder timeline.
      await wait(frameDuration);
    }

    // Add a short tail frame so the last scene is visible in output.
    await wait(frameDuration);
    recorder.stop();
    // Wait for recorder finalization, then trigger download.
    const blob = await renderedBlob;
    const fileName = `${sanitizeFilenamePart(collectionSelect.value)}-${sanitizeFilenamePart(startDateInput.value)}-${sanitizeFilenamePart(endDateInput.value)}.webm`;
    triggerDownload(blob, fileName);
    setStatus(`Downloaded WebM animation with ${frameScenes.length} frames as ${fileName}.`);
  } catch (error) {
    setStatus(`Animation export failed: ${error.message}`);
  } finally {
    // Always leave exporting mode and restore the previous selection view.
    state.exporting = false;
    setExportButtonState();
    if (previousIndex >= 0 && previousIndex < state.items.length) {
      selectScene(previousIndex, false);
    } else {
      renderPlayer();
    }
  }
}

// Download all available frame previews as a ZIP archive.
async function downloadAllFrames() {
  // Prevent simultaneous export actions.
  if (state.exporting) {
    return;
  }

  // Only include scenes that have downloadable frame URLs.
  const frameScenes = state.items.filter((scene) => scene.frameUrl);
  if (!frameScenes.length) {
    setStatus("There are no downloadable frames in the current result set.");
    return;
  }

  state.exporting = true;
  setExportButtonState();
  setStatus(`Packaging ${frameScenes.length} frames into a ZIP file...`);

  try {
    // JSZip is loaded globally from HTML; fail early if missing.
    if (typeof JSZip === "undefined") {
      throw new Error("ZIP export library did not load.");
    }

    // Build a ZIP with a dedicated frames folder.
    const zip = new JSZip();
    const folder = zip.folder("frames");

    for (let index = 0; index < frameScenes.length; index += 1) {
      const scene = frameScenes[index];
      // Download each frame and infer a practical file extension.
      const blob = await fetchFrameBlob(scene.frameUrl);
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("jpeg") ? "jpg" : "png";
      // Prefix with frame number so files are naturally ordered.
      const fileName = `${String(index + 1).padStart(3, "0")}-${sanitizeFilenamePart(scene.id)}.${extension}`;
      folder.file(fileName, blob);
    }

    // Generate compressed ZIP blob and trigger browser download.
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const zipName = `${sanitizeFilenamePart(collectionSelect.value)}-${sanitizeFilenamePart(startDateInput.value)}-${sanitizeFilenamePart(endDateInput.value)}-frames.zip`;
    triggerDownload(zipBlob, zipName);
    setStatus(`Downloaded ${frameScenes.length} frames as ${zipName}.`);
  } catch (error) {
    setStatus(`Frame download failed: ${error.message}`);
  } finally {
    state.exporting = false;
    setExportButtonState();
  }
}

// UI event wiring: area controls, search, basemap switches, and playback/export controls.
drawAreaButton.addEventListener("click", toggleDrawing);

viewAreaButton.addEventListener("click", () => {
  // Use current viewport bounds directly as AOI.
  stopDrawing();
  setBBox(normalizeBounds(map.getBounds()), false);
  setStatus("Using the current map view as the search area.");
});

clearAreaButton.addEventListener("click", () => {
  // Reset AOI, results, and playback to a clean state.
  stopDrawing();
  setBBox(null);
  state.items = [];
  state.selectedIndex = -1;
  stopPlayback();
  renderResults();
  setStatus("Area cleared. Draw a new box to search again.");
});

searchButton.addEventListener("click", searchScenes);
streetsLayerButton.addEventListener("click", () => setActiveMapLayer("streets"));
satelliteLayerButton.addEventListener("click", () => setActiveMapLayer("satellite"));

timelineInput.addEventListener("input", () => {
  // Manual timeline scrub pauses playback and selects chosen frame.
  stopPlayback();
  selectScene(Number(timelineInput.value), false);
});

playButton.addEventListener("click", () => {
  // Toggle play/pause behavior from one button.
  if (state.playing) {
    stopPlayback();
    return;
  }
  startPlayback();
});

exportButton.addEventListener("click", exportAnimation);
downloadFramesButton.addEventListener("click", downloadAllFrames);

speedInput.addEventListener("input", () => {
  // If currently playing, restart timer so new speed applies immediately.
  if (state.playing) {
    startPlayback();
  }
});

// Map interaction: two-click rectangle drawing for AOI selection.
map.on("click", (event) => {
  // Ignore map clicks unless draw mode is active.
  if (!state.drawing) {
    return;
  }

  // First click stores anchor corner and creates a temporary rectangle.
  if (!state.anchorLatLng) {
    state.anchorLatLng = event.latlng;
    clearTempRectangle();
    state.tempRectangle = L.rectangle(L.latLngBounds(event.latlng, event.latlng), {
      color: "#8be9fd",
      weight: 2,
      dashArray: "6 6",
      fillOpacity: 0.08
    }).addTo(aoiLayer);
    setStatus("First corner placed. Click the opposite corner to finish the area.");
    return;
  }

  // Second click completes rectangle and commits it as the AOI bbox.
  const bounds = L.latLngBounds(state.anchorLatLng, event.latlng);
  const bbox = normalizeBounds(bounds);
  stopDrawing();
  setBBox(bbox);
  setStatus("Area selected. You can now search for overpasses.");
});

// While drawing, update the temporary rectangle with mouse movement.
map.on("mousemove", (event) => {
  // Update preview rectangle only while an anchor corner exists.
  if (!state.drawing || !state.anchorLatLng || !state.tempRectangle) {
    return;
  }

  state.tempRectangle.setBounds(L.latLngBounds(state.anchorLatLng, event.latlng));
});

// Keyboard shortcut: Escape cancels drawing mode.
document.addEventListener("keydown", (event) => {
  // ESC gives a quick way to exit draw mode.
  if (event.key === "Escape" && state.drawing) {
    stopDrawing();
    setStatus("Area drawing cancelled.");
  }
});

// Initial app bootstrapping: defaults, first render, and button states.
initializeDates();
// Start with a predefined AOI around Zurich for immediate exploration.
setBBox([8.49, 47.35, 8.58, 47.41], true);
setStatus("Default area loaded. Search immediately or draw a different box on the map.");
// Render initial empty states and ensure export buttons reflect startup state.
renderResults();
setExportButtonState();
