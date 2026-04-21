# OrbitEye - Accessible Satellite Time Lapses for Global Event Tracking

## Mission

We will build a browser-based interactive satellite time-lapse generator for non-experts to easily track, visualise, and analyse environmental changes and global events (e.g., natural disasters, conflicts).

There is an abundance of satellite data openly available (e.g., through [Copernicus missions](https://www.copernicus.eu/en/access-data)).
The project will use polar orbiting satellites and a temporal resolution of days or weeks under the constraint of localised (client-side) computing.

Examples of applications include damage assessment after landslides or floods, the evolution of refugee camps, drought tracking, conflict zone mapping, and urban city planning.

## Scope

### In Scope

* Browser interface with intuitive latitude, longitude, and time-range selection.
* Integration of at least two satellite data sources.
* Automated API querying and ingestion of satellite imagery via SentinelHub or AWS.
* Automated time-lapse video creator.
* Interactive user guide and pre-loaded example of specific use case.

### Out of Scope / Non-Goals

* Server-side computing (the project will rely on local hosting and computing).
* Mosaicking or patchworking of disparate satellite images.
* User authentication, account creation, cloud-saving of user sessions etc.
* Advanced atmospheric corrections.
* Automatic detection of cloud cover percentage (if not provided by source).

## Objectives and Success Criteria

### Scientific Validity Objectives

* Integrity: Successfully and consistently parse, align, and render satellite data into a chronological visual time series without distorting spatial coordinates.
* Reproducibility: Achieve consistent output with the same or similar input parameters.
* Error Tolerance: The system will identify missing or corrupt satellite passes and skip frames accordingly.
* Analytic Benchmarking: Output time-lapses will be evaluated against known, historical satellite/aerial datasets (e.g., Google Earth) to guarantee spatial and temporal accuracy.

### Operational Performance Objectives

* Download and process a single satellite image in under five seconds, generating a full 10-frame time lapse in under 60 seconds (with average laptop computational power and wifi bandwidth).
* Achieve a "Time to First Render" (the time it takes a new user to generate their first time lapse) of less than five minutes, guided by the interactive UI.
* The local processing overhead will not exceed 2GB of RAM to ensure the browser does not freeze on standard hardware.
* The browser environment must render correctly across Windows, maxOS, and Linux without requiring specific system-level configurations.

## Inputs / Outputs

### Inputs

* Latitude and Longitude of center of the image.
* Extent (e.g. radius around center) for the size of the images, limited to a maximum value to prevent payload overload.
* Start and end date and time (local, specific timezone, or UTC).
* Satellite choice toggles (e.g., Sentinel-2, best, all).
* Choice of file format for output (see Outputs). 

### Outputs

* Media: Time-lapse file as .mp4 or .gif.
* Data (optional): a packaged .geotiff sequence to export to GIS software.
* Metadata (optional): a .json, .csv, or .txt file containing exact lat/lon bounds, image links, acquisition dates, cloud cover percentages (if available) etc.

## Constraints

* Target Audience: Fully understandable and usable by a non-science audience (e.g., no GIS jargon in the main UI).
* Platform: Platform-independent and browser based (e.g., HTML frontend, Python backend).
* Computation: Constrained by standard consumer laptop CPU and RAM.
* Runtime: Interactive runtime only. No batch processing to pevent exceeding standard user constraints and to stay within API rate limits.
* Dependencies: Reliance on open-source libraries and open-data satellite APIs.

## Risk and Mitigation Strategies

| **Risk**                                                                                                                                         | **Mitigation Plan**                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inconsistent Spatial Data:** Geodetic formatting may differ between satellites (e.g. varying pixel resolutions or grid projections).           | Implement a preprocessing step to reproject and resample incoming data to a unified grid before rendering.                                                                                                                                                                                |
| **Memory / Bandwidth Limits:** Satellite images are massive. Fetching a long time series could crash the browser, max out RAM, or take too long. | Utilise API-side clipping where available (SentinelHub allows restricting downloads to specific bounding boxes) so only the exact area of interest is downloaded, rather than full satellite swaths.                                                                                      |
| **Data Quality:** High cloud cover or missing data might render a time lapse unusable.                                                           | Add a "Maximum Cloud Cover" slider in the UI to filter out cloudy results before downloading. Add a "Minimum Coverage Available" slider in the UI to filter out results where more than a certain fraction of the images are missing (e.g. due to location being at the edge of a swath). |
| **Library Incompatibility**                                                                                                                      | Utilize Environment Encapsulation (e.g., Docker, Conda, or requirements.txt) to lock dependency versions and ensure portability across systems.                                                                                                                                           |
| **API Rate Limits**                                                                                                                              | Implement local caching of repeatedly queried coordinate boxes to minimize repeated API pings, and display specific cooldown warnings if limits are reached.                                                                                                                              |
