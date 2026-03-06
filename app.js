// DOM Elements
const playBtn = document.getElementById('btn-play');
const pauseBtn = document.getElementById('btn-pause');
const resetBtn = document.getElementById('btn-reset');
const currentYearEl = document.getElementById('current-year');
const statAdvanced = document.getElementById('stat-advanced');
const statEmerging = document.getElementById('stat-emerging');
const statDeveloping = document.getElementById('stat-developing');

// Simulation State
let simulationInterval;
let isPlaying = false;
let currentYear = 0;
const SIMULATION_SPEED = 1000; // ms per tick

// Data Structures
let worldData;
let countryPaths; // D3 selections
let countryDataMap = new Map(); // id -> target object

// Base categories
const STATUS = {
    UNCLASSIFIED: 'unclassified',
    DEVELOPING: 'developing',
    EMERGING: 'emerging',
    ADVANCED: 'advanced'
};

// Initial Seed Data (Hardcoded IDs based on 110m natural earth)
const SEED_ADVANCED = ['840', '826', '276', '392', '250', '124', '036', '380', '724', '410', '528', '756', '752', '616', '056', '040', '578', '208', '246', '372', '554', '702', '376', '203', '620', '300', '158', '344', '440', '703'];
const SEED_EMERGING = ['156', '356', '076', '484', '643', '360', '792', '682', '032', '710', '764', '784', '818', '458', '704', '050', '152', '608', '170', '586', '566', '364', '604', '398', '642', '404', '804', '188', '348', '862', '400', '191', '148', '112', '800', '218'];
const UNCLASSIFIED_NO_DATA = ['010']; // Antarctica
const TOTAL_COUNTRIES = 177;

// D3 Setup
const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#map-container")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 960 500`)
    .style("max-width", "100%")
    .style("height", "auto");

// Scale responsively on initial load
const initialScale = window.innerWidth < 768 ? 100 : 160;

const projection = d3.geoNaturalEarth1()
    .scale(initialScale)
    .translate([480, 250]);

const path = d3.geoPath().projection(projection);

const gMap = svg.append("g").attr("class", "map-group");
const gFlows = svg.append("g").attr("class", "flow-group");

// Handle window resize dynamically to keep SVG scaled
window.addEventListener('resize', () => {
    // Redraw or adjust viewBox if we needed strict pixel bounds, 
    // but the viewBox 0 0 960 500 naturally scales width/height 100%.
    // Just resetting zoom if they drastically resized might be nice, but is optional.
});

// Tooltip setup
const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);

// Initialize Dashboard
async function init() {
    try {
        // Fetch TopoJSON data
        const response = await fetch('https://unpkg.com/world-atlas@2.0.2/countries-110m.json');
        worldData = await response.json();

        const countries = topojson.feature(worldData, worldData.objects.countries).features;

        // Initialize our data map
        countries.forEach(d => {
            let initialStatus = STATUS.DEVELOPING;
            if (SEED_ADVANCED.includes(d.id)) initialStatus = STATUS.ADVANCED;
            else if (SEED_EMERGING.includes(d.id)) initialStatus = STATUS.EMERGING;
            else if (UNCLASSIFIED_NO_DATA.includes(d.id) || !d.properties.name) initialStatus = STATUS.UNCLASSIFIED;

            // Strip out non-existent or tiny countries if they lack geometries, but 110m is usually clean
            countryDataMap.set(d.id, {
                id: d.id,
                name: d.properties.name,
                status: initialStatus,
                centroid: path.centroid(d), // [x, y] for drawing flows
                timeInStatus: 0
            });
        });

        // Initial setup applies the statuses directly during initialization now.


        // Render Map
        countryPaths = gMap.selectAll(".country")
            .data(countries)
            .enter().append("path")
            .attr("class", d => {
                const cData = countryDataMap.get(d.id);
                return `country ${cData ? cData.status : STATUS.UNCLASSIFIED}`;
            })
            .attr("d", path)
            .on("mouseover", showTooltip)
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip);

        // Zoom capability (optional but nice)
        const zoom = d3.zoom()
            .scaleExtent([0.5, 8]) // allowed zooming out further for small screens
            .on("zoom", (event) => {
                gMap.attr("transform", event.transform);
                gFlows.attr("transform", event.transform);
            });

        svg.call(zoom);

        // Auto-center on mobile
        if (window.innerWidth < 768) {
            svg.call(zoom.transform, d3.zoomIdentity.translate(0, 50).scale(0.8));
        }

        updateStats();

        // Event Listeners for Controls
        playBtn.addEventListener('click', startSimulation);
        pauseBtn.addEventListener('click', pauseSimulation);
        resetBtn.addEventListener('click', resetSimulation);

        pauseBtn.disabled = true;

    } catch (error) {
        console.error("Error loading map data: ", error);
        document.getElementById('map-container').innerHTML =
            "<div style='color: white; padding: 2rem;'>Error loading map data. Ensure you have an internet connection.</div>";
    }
}

// Tooltip handlers
function showTooltip(event, d) {
    const data = countryDataMap.get(d.id);
    if (!data) return;

    // Status text formatting
    const statusText = data.status.charAt(0).toUpperCase() + data.status.slice(1);

    // Get color based on status
    let statusDotClass = data.status;

    tooltip.transition().duration(200).style("opacity", 1);
    tooltip.html(`
        <div class="tooltip-title">${data.name}</div>
        <div class="tooltip-status">
            <span class="color-box ${statusDotClass}" style="width:10px; height:10px;"></span> 
            ${statusText} ${data.status !== STATUS.UNCLASSIFIED ? 'Economy' : ''}
        </div>
    `);
}

function moveTooltip(event) {
    tooltip
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 28) + "px");
}

function hideTooltip() {
    tooltip.transition().duration(500).style("opacity", 0);
}

// Simulation Logic
function startSimulation() {
    if (isPlaying) return;
    isPlaying = true;
    playBtn.disabled = true;
    pauseBtn.disabled = false;

    simulationInterval = setInterval(simulationTick, SIMULATION_SPEED);
}

function pauseSimulation() {
    isPlaying = false;
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    clearInterval(simulationInterval);
}

function resetSimulation() {
    pauseSimulation();
    currentYear = 0;

    // Reset Data
    countryDataMap.forEach(v => {
        let initialStatus = STATUS.DEVELOPING;
        if (SEED_ADVANCED.includes(v.id)) initialStatus = STATUS.ADVANCED;
        else if (SEED_EMERGING.includes(v.id)) initialStatus = STATUS.EMERGING;
        else if (UNCLASSIFIED_NO_DATA.includes(v.id) || !v.name) initialStatus = STATUS.UNCLASSIFIED;

        v.status = initialStatus;
        v.timeInStatus = 0;
    });

    // Clear Flows
    gFlows.selectAll("*").remove();

    updateMapVisuals();
    updateStats();
}

function simulationTick() {
    currentYear++;

    const advancedNodes = [];
    const emergingNodes = [];
    const unclassifiedNodes = [];
    const developingNodes = [];

    // Group current statuses
    countryDataMap.forEach(country => {
        // Only consider countries with valid centroids for math
        if (Number.isNaN(country.centroid[0])) return;

        if (country.status === STATUS.ADVANCED) advancedNodes.push(country);
        else if (country.status === STATUS.EMERGING) emergingNodes.push(country);
        else if (country.status === STATUS.DEVELOPING) developingNodes.push(country);
        else unclassifiedNodes.push(country);

        // Increase time in current status, making them more likely to "graduate"
        if (country.status !== STATUS.ADVANCED && country.status !== STATUS.UNCLASSIFIED) {
            country.timeInStatus++;
        }
    });

    const newlyUpgraded = new Set();
    const tradeFlows = [];

    // Rule 1: Advanced -> Emerging Diffusion (Advanced trades with Emerging, helping them grow)
    emergingNodes.forEach(emerging => {
        // Probability to upgrade to Advanced
        const upgradeChance = 0.015 + (emerging.timeInStatus * 0.002);
        if (Math.random() < upgradeChance) {
            emerging.status = STATUS.ADVANCED;
            emerging.timeInStatus = 0;
            newlyUpgraded.add(emerging.id);

            // Visual trade flow from a random advanced to this newly upgraded one
            if (advancedNodes.length > 0) {
                const source = advancedNodes[Math.floor(Math.random() * advancedNodes.length)];
                tradeFlows.push({ source: source.centroid, target: emerging.centroid, type: 'advanced' });
            }
        }
    });

    // Rule 2: Emerging -> Developing Diffusion 
    // Emerging economies start trading heavily with unclassified/developing, lifting them
    unclassifiedNodes.forEach(unclass => {
        // Small chance to enter global market as developing
        if (!UNCLASSIFIED_NO_DATA.includes(unclass.id) && Math.random() < 0.01) {
            unclass.status = STATUS.DEVELOPING;
            unclass.timeInStatus = 0;
            newlyUpgraded.add(unclass.id);
        }
    });

    developingNodes.forEach(dev => {
        // Probability to upgrade to Emerging
        const upgradeChance = 0.02 + (dev.timeInStatus * 0.005);
        if (Math.random() < upgradeChance) {
            dev.status = STATUS.EMERGING;
            dev.timeInStatus = 0;
            newlyUpgraded.add(dev.id);

            // Visual trade flow from a random emerging
            if (emergingNodes.length > 0) {
                const source = emergingNodes[Math.floor(Math.random() * emergingNodes.length)];
                tradeFlows.push({ source: source.centroid, target: dev.centroid, type: 'emerging' });
            }
        }
    });

    drawTradeFlows(tradeFlows);
    updateMapVisuals(newlyUpgraded);
    updateStats();

    // Stop if everything is advanced
    const allAdvanced = Array.from(countryDataMap.values()).every(c => c.status === STATUS.ADVANCED || c.status === STATUS.UNCLASSIFIED);
    if (allAdvanced && currentYear > 5) {
        pauseSimulation();
    }
}

function updateMapVisuals(newlyUpgraded = new Set()) {
    countryPaths.attr("class", d => {
        const cData = countryDataMap.get(d.id);
        let cls = `country ${cData ? cData.status : STATUS.UNCLASSIFIED}`;

        // Add pulse animation class to newly upgraded
        if (newlyUpgraded.has(d.id) && cData) {
            if (cData.status === STATUS.ADVANCED) cls += " pulse-advanced";
            else if (cData.status === STATUS.EMERGING) cls += " pulse-emerging";
        }
        return cls;
    });
}

function updateStats() {
    let adv = 0, emg = 0, dev = 0;
    countryDataMap.forEach(country => {
        if (country.status === STATUS.ADVANCED) adv++;
        else if (country.status === STATUS.EMERGING) emg++;
        else if (country.status === STATUS.DEVELOPING) dev++;
    });

    currentYearEl.textContent = `Year ${currentYear}`;
    statAdvanced.textContent = adv;
    statEmerging.textContent = emg;
    statDeveloping.textContent = dev;
}

// Visual Effects
function drawTradeFlows(flows) {
    if (flows.length === 0) return;

    // Line generator for arcs
    const lineGenerator = d3.line()
        .curve(d3.curveBasis); // Smooth curves

    flows.forEach(flow => {
        // Calculate control point for a nice arc
        const dx = flow.target[0] - flow.source[0];
        const dy = flow.target[1] - flow.source[1];
        const midX = flow.source[0] + dx / 2;
        const midY = flow.source[1] + dy / 2;

        // Offset the mid point for the arc
        const controlX = midX - dy * 0.2;
        const controlY = midY + dx * 0.2;

        const pathData = [flow.source, [controlX, controlY], flow.target];

        // Draw line
        const pathLine = gFlows.append("path")
            .attr("class", "trade-flow")
            .attr("d", lineGenerator(pathData))
            .style("stroke", flow.type === 'advanced' ? "var(--color-advanced)" : "var(--color-emerging)");

        const totalLength = pathLine.node().getTotalLength();

        pathLine
            .attr("stroke-dasharray", totalLength + " " + totalLength)
            .attr("stroke-dashoffset", totalLength)
            .transition()
            .duration(800)
            .ease(d3.easeLinear)
            .attr("stroke-dashoffset", 0)
            .on("end", () => {
                // Fade out line
                pathLine.transition()
                    .duration(1000)
                    .style("opacity", 0)
                    .remove();
            });

        // Optional Particle
        gFlows.append("circle")
            .attr("class", "flow-particle")
            .attr("r", 3)
            .attr("transform", `translate(${flow.source})`)
            .transition()
            .duration(800)
            .attrTween("transform", function () {
                return function (t) {
                    const p = pathLine.node().getPointAtLength(t * totalLength);
                    return `translate(${p.x},${p.y})`;
                }
            })
            .remove();
    });
}

// Start Initialization
init();
