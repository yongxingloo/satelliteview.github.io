# OrbitEye: Master Architecture & Design Document

---

## Part 1: Deployment & Security Strategy

### 1.1 The Architecture Paradox & Solution
OrbitEye aims to serve non-experts with zero server-side computing. Requiring users to install Python, Conda, or Docker creates excessive friction. Furthermore, running local HTML files (`file://`) triggers strict browser CORS security policies, blocking API requests to satellite data providers.

**The Solution:** A **Serverless Python Web App** using **GitHub Pages** and **PyScript (WebAssembly)**.
* **Frictionless:** Users access the tool via a simple URL (`https://yourusername.github.io/OrbitEye`).
* **Serverless Compute:** The HTML, WebAssembly, and Python code are downloaded into the user's browser. All API querying, image processing, and RAM usage happen strictly on the user's local machine.
* **CORS Compliance:** Served over HTTPS, allowing PyScript to fetch external STAC data without browser security blocks.

### 1.2 Authentication & API Security (SentinelHub/AWS)
Because all code runs client-side, API keys cannot be permanently hidden in the repository.

* **V1.0 (Current - Prototyping):** Hardcoded keys in `main.py` for closed testing and initial development.
* **V2.0 (Future - Production):** Implementation of a "Bring Your Own Key" (BYOK) strategy. The UI will prompt the user for their SentinelHub/AWS Client ID and Secret upon first load, storing them locally in the browser's `localStorage`.

---

## Part 2: Technical Design Specification (V1.0)

### 2.1 System Components
The application consists of three primary files:
1. **`index.html`**: The UI shell (HTML5 / Tailwind CSS).
2. **`pyscript.toml`**: Environment configuration (Python dependency management).
3. **`main.py`**: The core logic engine (Python 3.11+ via Pyodide).

### 2.2 Dependency Specification (`pyscript.toml`)
To ensure the 2GB RAM limit is respected and the WebAssembly payload remains light, dependencies must be minimized.
```toml
name = "OrbitEye"
packages = [
    "pystac-client",
    "stackstac",
    "xarray",
    "numpy",
    "Pillow",
    "rasterio"
]
```

### 2.3 Technical Logic & Data Flow (The Engine)
Following the proof-of-concept in the Jupyter Notebook, `main.py` is divided into four distinct phases. AI agents must implement this exact sequential logic to prevent memory overflow.

#### Phase 1: Search & Metadata Filtering
* **Library:** `pystac_client`
* **Inputs:** `bbox` (calculated from Lat/Lon), `date_range`, `max_cloud_cover`
* **Logic:** Query the STAC API (e.g., `https://earth-search.aws.element84.com/v1`). Filter the returned collection for `eo:cloud_cover < max_cloud`. Sort chronologically.

#### Phase 2: Data Ingestion (Lazy Loading & Clipping)
* **Library:** `stackstac` or `odc-stac`
* **Process:** Iterate through items one-by-one. Extract ONLY bands B04 (Red), B03 (Green), and B02 (Blue). Use the `bbox` to crop the image *during* the request (API-side clipping/HTTP range requests) to respect the 2GB RAM constraint.

#### Phase 3: Image Processing & Alignment
* **Library:** `xarray`, `numpy`
* **Logic:** Convert raw reflectance values to 0-255 (8-bit RGB) using a robust scaling method (e.g., 2nd and 98th percentiles). Reproject/align arrays if EPSG codes or grids differ between frames.

#### Phase 4: Time-Lapse Assembly
* **Library:** `Pillow` (PIL)
* **Logic:** Append processed 8-bit frames to a local memory buffer (`List[PIL.Image]`). Once the loop completes, compile the list into an Animated GIF or MP4 (via HTML5 Canvas) for user download.

### 2.4 Core Variables & Loop Structure Guide
```python
# Reference structure for AI code generation
STAC_URL = "[https://earth-search.aws.element84.com/v1](https://earth-search.aws.element84.com/v1)"
BANDS = ["B04", "B03", "B02"]

def process_timelapse(lat, lon, radius_m, dates, max_cloud):
    # 1. Calculate BBox from Lat/Lon and radius
    # 2. Search catalog (pystac_client)
    # 3. Memory-safe loop:
    #    processed_frames = []
    #    for item in items:
    #        data = fetch_and_clip(item, bbox, BANDS)
    #        rgb_frame = normalize_to_rgb(data)
    #        processed_frames.append(rgb_frame)
    # 4. Compile and trigger UI download
```

---

## Part 3: UI Requirements & Restrictions

### 3.1 Non-Expert UI Layout (`index.html`)
The interface must be intuitive, avoiding GIS jargon.
* **Inputs:** Location Name, Latitude, Longitude, Radius Slider (0.5km to 5km), Start/End Dates, Image Quality (Cloud Cover) Slider.
* **Feedback Mechanism:** A visible console `div` updating the user on the Python backend status (e.g., *"System loading..." -> "Found 12 clear days..." -> "Processing frame 3/12..."*).

### 3.2 Hard Development Constraints
1. **No Server-Side Code:** No Flask, Django, Node.js, or cloud databases. 100% logic in `main.py` and `index.html`.
2. **Memory Limit:** Never use `.compute()` on a full uncropped STAC data cube. Process chronologically in chunks.
3. **No Jupyter Artifacts:** All output must be standard Python. Matplotlib `plt.show()` commands must be replaced with UI DOM updates or direct image byte streams.
4. **Resilient Looping:** If a specific band is missing for a single date, log a warning in the UI console and skip to the next date. Do not crash the application.

---

## Part 4: Iteration & Refinement Roadmap

* **Phase 1 (Current):** Setup PyScript bridge, implement STAC search, fetch a single static RGB frame using hardcoded keys to verify CORS and memory limits.
* **Phase 2:** Implement the iterative memory-safe loop and animated GIF compilation.
* **Phase 3:** Refine UI/UX (Tailwind styling, progress bars, interactive map picker via Leaflet.js).
* **Phase 4:** Swap hardcoded keys for BYOK `localStorage` implementation and deploy to public GitHub Pages.
```