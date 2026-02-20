const map = L.map("map").setView([39.9242, -82.8089], 12);

const overpassUrl = "https://overpass-api.de/api/interpreter";

// Array to store camera locations
let cameras = [];

function fetchSurveillanceData(bounds) {
  // Show the loading spinner
  document.getElementById("loading").style.display = "block";

  // Get the bounds of the current view
  const swLat = bounds.getSouthWest().lat;
  const swLon = bounds.getSouthWest().lng;
  const neLat = bounds.getNorthEast().lat;
  const neLon = bounds.getNorthEast().lng;

  const query = `
    [out:json];
    (
      node["amenity"="camera"](${swLat},${swLon},${neLat},${neLon});
      node["man_made"="surveillance"](${swLat},${swLon},${neLat},${neLon});
    );
    out body;
  `;

  fetch(overpassUrl, {
    method: "POST",
    body: new URLSearchParams({
      data: query,
    }),
    timeout: 10000,
  })
    .then((response) => {
      if (
        response.ok &&
        response.headers.get("Content-Type").includes("application/json")
      ) {
        return response.json();
      } else {
        throw new Error("Invalid response format");
      }
    })
    .then((data) => {
      // Hide the loading spinner after data is fetched
      document.getElementById("loading").style.display = "none";

      // Process and display camera data...
      cameras = [];
      data.elements.forEach((element) => {
        const lat = element.lat;
        const lon = element.lon;
        cameras.push({ lat, lon });
        L.circleMarker([lat, lon], {
          color: "red",
          radius: 3,
          weight: 1,
          opacity: 1,
          fillOpacity: 0.4,
        }).addTo(map);
      });

      // Check for cameras along the route
      checkForCamerasOnRoute();
    })
    .catch((error) => {
      // Hide loading spinner and log error
      document.getElementById("loading").style.display = "none";
      console.error("Error fetching OSM data:", error);
    });
}

function checkForCamerasOnRoute() {
  const waypoints = control.getWaypoints();
  console.log("Waypoints:", waypoints);

  if (waypoints.length < 2) {
    console.error("Waypoints not set properly.");
    return;
  }

  // Find the route polyline on the map
  let routePolylines = []; // To hold multiple polylines
  map.eachLayer((layer) => {
    if (layer instanceof L.Polyline) {
      routePolylines.push(layer); // Collect all route polylines
    }
  });

  if (routePolylines.length === 0) {
    console.error("Route polylines not found on the map.");
    return;
  }

  // Convert route polylines into Turf.js lineStrings
  const routeLines = routePolylines.map((polyline) => {
    const routeCoords = polyline
      .getLatLngs()
      .map((latLng) => [latLng.lng, latLng.lat]);
    return turf.lineString(routeCoords);
  });

  // Clear the list of cameras in the UI
  const cameraListDiv = document.getElementById("cameraList");
  cameraListDiv.innerHTML = "<h3>Intersecting Cameras:</h3>"; // Reset the list

  // Collect cameras that interact with any of the routes
  let camerasToAvoid = [];
  cameras.forEach((camera) => {
    const cameraPoint = turf.point([camera.lon, camera.lat]);
    const buffer = turf.buffer(cameraPoint, 50, { units: "meters" }); // 50m buffer to avoid camera

    // Check if the route intersects with the camera's buffer for any of the route lines
    routeLines.forEach((routeLine) => {
      if (turf.booleanIntersects(routeLine, buffer)) {
        camerasToAvoid.push(camera); // Collect cameras to avoid
        console.log(
          `Camera at (${camera.lat}, ${camera.lon}) interacts with the route!`,
        );

        // Make the camera more visible on the map by changing its style
        L.circleMarker([camera.lat, camera.lon], {
          color: "red",
          radius: 7, // Increase size of marker
          weight: 3,
          opacity: 1,
          fillOpacity: 0.4, // Increase fill opacity
        })
          .addTo(map)
          .bindPopup(`Camera at (${camera.lat}, ${camera.lon})`);

        // Add the camera to the list in the bottom right corner
        const cameraItem = document.createElement("div");
        cameraItem.classList.add("camera-item");
        cameraItem.innerHTML = `Camera at (${camera.lat.toFixed(4)}, ${camera.lon.toFixed(4)})`;
        cameraListDiv.appendChild(cameraItem);
      }
    });
  });

  // If cameras to avoid are found, recalculate the route
  if (camerasToAvoid.length > 0) {
    avoidCamerasAndRecalculateRoute(camerasToAvoid);
  }
}

async function geocodeAddress(street, city, state, zip) {
  const params = new URLSearchParams({
    street: street,
    city: city,
    state: state,
    postalcode: zip,
    country: "USA",
    format: "json",
    limit: 1
  });

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Geocoding request failed");
  }

  const data = await response.json();

  console.log("Geocode response:", data);

  if (!data || data.length === 0) {
    throw new Error("Address not found");
  }

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon)
  };
}

function avoidCamerasAndRecalculateRoute(camerasToAvoid) {
  const waypoints = control.getWaypoints();
  const start = waypoints[0].latLng; // Fixed start point
  const destination = waypoints[1].latLng; // Fixed destination point

  // Collect new waypoints to avoid the cameras
  let newWaypoints = [start];

  camerasToAvoid.forEach((camera) => {
    const cameraBuffer = turf.buffer(turf.point([camera.lon, camera.lat]), 50, {
      units: "meters",
    });

    // Find a new waypoint that avoids the camera's buffer
    let avoidancePoint = findAvoidancePoint(cameraBuffer);

    if (avoidancePoint) {
      // Add new waypoint to avoid the camera
      newWaypoints.push(L.latLng(avoidancePoint.lat, avoidancePoint.lng));
    }
  });

  // Add the destination at the end of the new waypoints
  newWaypoints.push(destination);

  // Recalculate the route with the new waypoints
  recalculateRoute(newWaypoints);
}

function recalculateRoute(waypoints) {
  document.getElementById("loading").style.display = "block";

  // Log the waypoints array and each waypoint in it for debugging
  console.log("Waypoints:", waypoints);
  waypoints.forEach((wp, index) => {
    console.log(`Waypoint ${index}:`, wp);
  });

  // Check if the waypoints array is valid and contains lat and lng properties
  if (
    !waypoints ||
    waypoints.length < 2 ||
    !waypoints[0].lat ||
    !waypoints[1].lat
  ) {
    console.error("Invalid waypoints or missing lat/lng data");
    document.getElementById("loading").style.display = "none";
    return;
  }

  const startLat = waypoints[0].lat;
  const startLon = waypoints[0].lng;
  const endLat = waypoints[waypoints.length - 1].lat;
  const endLon = waypoints[waypoints.length - 1].lng;

  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
  console.log("OSRM Request URL:", osrmUrl);

  fetch(osrmUrl)
    .then((response) => response.json())
    .then((data) => {
      console.log("OSRM Data:", data);
      if (data.routes && data.routes.length > 0) {
        data.routes.forEach((route) => {
          if (route.geometry && route.geometry.coordinates) {
            const routeCoords = route.geometry.coordinates.map((coord) => [
              coord[1],
              coord[0],
            ]);
            L.polyline(routeCoords, {
              color: "#16a085",
              weight: 5,
              opacity: 0.7,
            }).addTo(map);
          } else {
            console.error("Route geometry or coordinates not found:", route);
          }
        });
      } else {
        console.error("No route found with the new waypoints");
      }
    })
    .catch((error) => {
      console.error("Error recalculating route:", error);
    });
}

function findAlternativeRoute(camera) {
  const waypoints = control.getWaypoints();
  const start = waypoints[0].latLng; // Fixed start point
  const destination = waypoints[1].latLng; // Fixed destination point

  // Create a buffer zone around the camera to avoid it (50 meters)
  const cameraBuffer = turf.buffer(turf.point([camera.lon, camera.lat]), 50, {
    units: "meters",
  });

  // Find a new waypoint that avoids the camera's buffer
  let avoidancePoint = findAvoidancePoint(cameraBuffer);

  if (avoidancePoint) {
    // Add new waypoint to avoid the camera while keeping the start and destination fixed
    const newWaypoints = [
      start,
      L.latLng(avoidancePoint.lat, avoidancePoint.lng),
      destination,
    ];

    // Recalculate the route with the new waypoints
    recalculateRoute(newWaypoints);
  } else {
    console.log("No viable avoidance point found.");
  }
}

function findAvoidancePoint(cameraBuffer) {
  const bufferBounds = cameraBuffer.geometry.coordinates[0]; // Buffer's bounding coordinates

  // Let's take the top-right corner of the buffer as an avoidance point (you can change this logic)
  const northEast = bufferBounds[0]; // Top-right corner of the buffer

  // We will move a small amount away from the camera to avoid it
  const avoidancePoint = {
    lat: northEast[1] + 0.005, // Simple offset to avoid the buffer
    lng: northEast[0] + 0.005, // Simple offset to avoid the buffer
  };

  return avoidancePoint;
}

// Add OpenStreetMap tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const control = L.Routing.control({
  waypoints: [
    L.latLng(39.9095, -83.8080),
    L.latLng(39.8031, -83.8898),
  ],
  routeWhileDragging: true, // Allow dragging to update the route
  lineOptions: {
    styles: [
      {
        color: "#16a085", // Set the color of the route line
        weight: 5, // Set the weight (thickness) of the line
        opacity: 0.7, // Set the opacity of the line
      },
    ],
  },
}).addTo(map);

async function updateRoute() {
  document.getElementById("loading").style.display = "block";

  try {
    const start = await geocodeAddress(
      document.getElementById("startStreet").value,
      document.getElementById("startCity").value,
      document.getElementById("startState").value,
      document.getElementById("startZip").value
    );

    const end = await geocodeAddress(
      document.getElementById("endStreet").value,
      document.getElementById("endCity").value,
      document.getElementById("endState").value,
      document.getElementById("endZip").value
    );

    control.setWaypoints([
      L.latLng(start.lat, start.lon),
      L.latLng(end.lat, end.lon)
    ]);

    const routeBounds = L.latLngBounds([
      L.latLng(start.lat, start.lon),
      L.latLng(end.lat, end.lon)
    ]);
    map.fitBounds(routeBounds);

    checkForCamerasOnRoute();

  } catch (error) {
    alert("Invalid or incomplete address. Please enter full address.");
    console.error(error);
  }

  document.getElementById("loading").style.display = "none";
}

map.on("moveend", function () {
  const bounds = map.getBounds();
  fetchSurveillanceData(bounds); // Update the surveillance markers based on new map bounds
});

// Initial load of surveillance data based on the initial map view
fetchSurveillanceData(map.getBounds());
