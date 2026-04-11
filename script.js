/**
 * Amiibo Generator Pro - Main Logic
 */

var amiiboDatabase = [];
var mainTable = null;

// This is the EXACT signature used by TagMo in its Kotlin code
const TAGMO_SIG_HEX = "5461674d6f20382d426974204e544147"; 
const DEFAULT_SIG_TEXT = "TagMo 8-Bit NTAG";

// --- UTILITIES ---

/**
 * Converts a hexadecimal string into a Uint8Array
 */
function hexToBytes(hex) {
    let bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Converts text to a fixed-length Uint8Array
 */
function textToUint8Array(text, length) {
    const encoder = new TextEncoder();
    let view = encoder.encode(text);
    let result = new Uint8Array(length);
    result.set(view.slice(0, length));
    return result;
}

/**
 * Generates a random UID with valid BCC bytes for NTAG215
 */
function generateRandomUID() {
    let uid = new Uint8Array(9);
    crypto.getRandomValues(uid);
    uid[0] = 0x04; // Standard manufacturer ID for NXP
    // BCC calculation according to NTAG215 specs (used in TagMo)
    uid[3] = (0x88 ^ uid[0] ^ uid[1] ^ uid[2]) & 0xFF; // BCC0
    uid[8] = (uid[4] ^ uid[5] ^ uid[6] ^ uid[7]) & 0xFF; // BCC1
    return uid;
}

// --- DATA GENERATION ---

/**
 * Generates data structure for Wumiibo (3DS)
 */
function generateWumiiboData(idHex) {
    const arr = new Uint8Array(540);
    arr[2] = 0x0F; arr[3] = 0xE0; // Standard CC bytes
    const cleanId = idHex.replace(/[^0-9A-Fa-f]/g, '').padEnd(16, '0');
    // Write ID at specific offset for Wumiibo
    for (let i = 0, off = 0x1DC; i < 16; i += 2, off++) {
        arr[off] = parseInt(cleanId.substring(i, i + 2), 16);
    }
    return arr;
}

/**
 * Exact replication of TagMo's Foomiibo.kt logic
 * Supports custom UID and optional signature exclusion
 */
function generateFoomiiboData(idHex, uidBytes = null, sigText = null, noSignature = false) {
    const arr = new Uint8Array(572); // Temporary TAG_FULL_SIZE
    const cleanId = idHex.replace(/[^0-9A-Fa-f]/g, '').padEnd(16, '0');
    const idBytes = hexToBytes(cleanId);
    const uid = uidBytes || generateRandomUID();

    // 1. Set BCC1 in the first byte (Offset 0x0)
    arr[0] = uid[8];

    // 2. Set Internal, Static Lock, and CC (Offset 0x1, 7 bytes)
    arr.set([0x48, 0x0F, 0xE0, 0xF1, 0x10, 0xFF, 0xEE], 0x01);

    // 3. Set 0xA5 and Write Counter (Offset 0x28, 4 bytes)
    arr.set([0xA5, 0x00, 0x00, 0x00], 0x28);

    // 4. Set Identification Block (Offset 0x54, 8 bytes)
    arr.set(idBytes, 0x54);

    // 5. Set UID (Offset 0x1D4, 9 bytes)
    arr.set(uid, 0x1D4);

    // 6. Write Secondary Identification Block (Offset 0x1DC, 8 bytes)
    arr.set(idBytes, 0x1DC);

    // 7. Set Keygen Salt (Offset 0x1E8, 32 random bytes)
    let salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    arr.set(salt, 0x1E8);
    
    // 8. Dynamic Lock and CFG (Offsets 0x208, 0x20C, 0x210)
    arr.set([0x01, 0x00, 0x0F, 0xBD], 0x208);
    arr.set([0x00, 0x00, 0x00, 0x04], 0x20C);
    arr.set([0x5F, 0x00, 0x00, 0x00], 0x210);
    
    // If the user checked "no signature", we trim the array to 540 bytes
    if (noSignature) {
        return arr.slice(0, 540);
    }

    // 9. Signature (Offset 540 / 0x21C)
    let finalSig;
    if (!sigText || sigText === DEFAULT_SIG_TEXT) {
        finalSig = hexToBytes(TAGMO_SIG_HEX);
    } else {
        finalSig = textToUint8Array(sigText, 16);
    }
    
    arr.set(finalSig, 540);
    return arr;
}

// --- GLOBAL DOWNLOAD FUNCTIONS ---

/**
 * Handles single file download
 */
window.downloadSingle = function(type, name, id) {
    try {
        let data;
        let filename = name.replace(/[/\\?%*:|"<>]/g, '-');
        if (type === 'wumiibo') {
            data = generateWumiiboData(id);
            download(new Blob([data]), `${filename}_wumiibo.bin`, "application/octet-stream");
        } else {
            data = generateFoomiiboData(id);
            download(new Blob([data]), `${filename}_foomiibo.bin`, "application/octet-stream");
        }
    } catch (e) {
        console.error("Download error:", e);
    }
};

/**
 * Handles batch ZIP generation and download
 */
window.generateZip = async function(type) {
    if (!amiiboDatabase.length) return;
    const zip = new JSZip();
    amiiboDatabase.forEach(amiibo => {
        let data = (type === 'wumiibo') ? generateWumiiboData(amiibo.id) : generateFoomiiboData(amiibo.id);
        let folder = zip.folder(amiibo.series || "Others");
        folder.file(`${amiibo.name} (${type}).bin`, data);
    });
    const content = await zip.generateAsync({ type: "blob" });
    download(content, `amiibos_${type}.zip`, "application/octet-stream");
};

// --- ADVANCED MODE LOGIC ---

/**
 * Generates and displays a new random UID in the advanced UI
 */
window.generateNewAdvUID = function() {
    const uid = generateRandomUID();
    document.getElementById('advUID').value = Array.from(uid).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
};

/**
 * Processes and downloads data with advanced parameters
 */
window.downloadAdvanced = function() {
    const id = document.getElementById('advId').value;
    const UID = document.getElementById('advUID').value.replace(/\s/g, '');
    const sigText = document.getElementById('advSig').value;
    const noSig = document.getElementById('advNoSig').checked;
    
    if (UID.length !== 18) {
        alert("The UID must be 18 hexadecimal characters long.");
        return;
    }
    
    try {
        const uidBytes = hexToBytes(UID);
        const data = generateFoomiiboData(id, uidBytes, sigText, noSig);
        download(new Blob([data]), `custom_foomiibo_${id}.bin`, "application/octet-stream");
    } catch (e) {
        alert("Error processing data. Please check the hex UID.");
    }
};

// --- INITIALIZATION ---

$(document).ready(async function() {
    // Initialize DataTable
    mainTable = $('#dataTable').DataTable({
        columnDefs: [{ orderable: false, targets: [0, 7] }],
        pageLength: 20,
        order: [[1, 'asc']]
    });

    // Check for advanced mode via URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const getID = urlParams.get('id');
    if (getID) {
        $("#mainContent").hide();
        $("#advancedMode").show();
        document.getElementById('advId').value = getID.toUpperCase();
        document.getElementById('advSig').value = DEFAULT_SIG_TEXT;
        generateNewAdvUID();
    }

    try {
        // Fetch data from API and local extras
        const [apiRes, extrasRes] = await Promise.all([
            fetch("https://amiiboapi.org/api/amiibo/").then(r => r.json()),
            fetch("extras.json").then(r => r.json()).catch(() => ({ amiibo: [] }))
        ]);

        const apiData = apiRes.amiibo.map(ami => ({
            id: (ami.head + ami.tail).toUpperCase(),
            name: ami.name,
            series: ami.amiiboSeries,
            group: "API",
            relEU: ami.release?.eu || "-",
            relNA: ami.release?.na || "-",
            image: ami.image
        }));

        const extrasData = (extrasRes.amiibo || []).map(ami => ({
            id: (ami.head + ami.tail).toUpperCase(),
            name: ami.name,
            series: ami.amiiboSeries,
            group: ami.customGroup || "Extras",
            relEU: ami.release?.eu || "-",
            relNA: ami.release?.na || "-",
            image: ami.image
        }));

        amiiboDatabase = [...apiData, ...extrasData];

        // Populate table
        amiiboDatabase.forEach(amiibo => {
            const safeName = amiibo.name.replace(/'/g, "\\'");
            
            // Action buttons (Split Button for Foomiibo options)
            const actions = `
                <div class="btn-group">
                    <button class="btn btn-sm btn-wumiibo" onclick="downloadSingle('wumiibo','${safeName}','${amiibo.id}')">Wumiibo</button>
                    
                    <div class="btn-group">
                        <button type="button" class="btn btn-sm btn-foomiibo" onclick="downloadSingle('foomiibo','${safeName}','${amiibo.id}')">Foomiibo</button>
                        <button type="button" class="btn btn-sm btn-foomiibo dropdown-toggle dropdown-toggle-split" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                            <span class="sr-only">Toggle Dropdown</span>
                        </button>
                        <div class="dropdown-menu dropdown-menu-right" style="background-color: #2c2c2c;">
                            <a class="dropdown-item text-white" href="?id=${amiibo.id}">Advanced Mode</a>
                        </div>
                    </div>
                </div>
            `;
            
            mainTable.row.add([
                `<div class="amiibo-image"><img src="${amiibo.image}" onerror="this.src='https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/refs/heads/master/no_image.png';"></div>`,
                amiibo.name,
                `<code>${amiibo.id}</code>`,
                amiibo.series,
                `<span class="badge badge-secondary badge-group">${amiibo.group}</span>`,
                amiibo.relEU,
                amiibo.relNA,
                actions
            ]);
        });
        mainTable.draw();

        // Setup filter dropdowns
        const groups = [...new Set(amiiboDatabase.map(a => a.group))].sort();
        const series = [...new Set(amiiboDatabase.map(a => a.series))].sort();
        $('#filterGroup').append(new Option("All", ""));
        groups.forEach(g => $('#filterGroup').append(new Option(g, g)));
        $('#filterSeries').append(new Option("All", ""));
        series.forEach(s => $('#filterSeries').append(new Option(s, s)));

        // Event listeners for searching and filtering
        $('#input').on('keyup', function() { mainTable.search(this.value).draw(); });
        $('#filterGroup').on('change', function() { mainTable.column(4).search(this.value).draw(); });
        $('#filterSeries').on('change', function() { mainTable.column(3).search(this.value).draw(); });

        // Show ZIP download options once data is ready
        $(".hide_until_zipped").show();
        $("#downloadWumiiboZip").on("click", () => generateZip('wumiibo'));
        $("#downloadFoomiiboZip").on("click", () => generateZip('foomiibo'));

    } catch (err) {
        console.error("Database loading error:", err);
    }
});
