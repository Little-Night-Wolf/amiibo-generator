/**
 * Amiibo Generator Pro - Main Logic with Auto-Encryption
 */

var amiiboDatabase = [];
var mainTable = null;
var masterKeys = null; // Stores loaded maboii keys

const DEFAULT_SIG_HEX = "6769746875622e636f6d2f4c6974746c652d4e696768742d576f6c66"; 
const DEFAULT_SIG_TEXT = "github.com/Little-Night-Wolf";

// --- ENCRYPTION LOGIC ---

/**
 * Calculates the NTAG215 Password based on the UID from packed data
 */
function calculatePWD(packed) {
    return [
        (0xAA ^ packed[1] ^ packed[4]) & 0xFF,
        (0x55 ^ packed[2] ^ packed[5]) & 0xFF,
        (0xAA ^ packed[4] ^ packed[6]) & 0xFF,
        (0x55 ^ packed[5] ^ packed[7]) & 0xFF
    ];
}

/**
 * Encrypts the provided Uint8Array using master keys if available
 */
async function applyEncryption(unpackedArray) {
    if (!masterKeys) return unpackedArray;

    try {
        // Enforce magic bytes before packing for consistency
        const magic = [0x48, 0x0F, 0xE0, 0xF1, 0x10, 0xFF, 0xEE, 0xA5];
        magic.forEach((val, i) => unpackedArray[9 + i] = val);

        let packed = await maboii.pack(masterKeys, Array.from(unpackedArray));
        
        // Post-pack fixes for hardware compatibility
        packed[8] = packed[4] ^ packed[5] ^ packed[6] ^ packed[7]; 
        
        const pwd = calculatePWD(packed);
        packed[532] = pwd[0];
        packed[533] = pwd[1];
        packed[534] = pwd[2];
        packed[535] = pwd[3];
        packed[536] = 0x80; // PACK
        packed[537] = 0x80;

        return new Uint8Array(packed);
    } catch (e) {
        console.error("Encryption process failed:", e);
        return unpackedArray;
    }
}

// --- UTILITIES ---

function hexToBytes(hex) {
    let bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

function textToUint8Array(text, length) {
    const encoder = new TextEncoder();
    let view = encoder.encode(text);
    let result = new Uint8Array(length);
    result.set(view.slice(0, length));
    return result;
}

function generateRandomUID() {
    let uid = new Uint8Array(9);
    crypto.getRandomValues(uid);
    uid[0] = 0x04;
    uid[3] = (0x88 ^ uid[0] ^ uid[1] ^ uid[2]) & 0xFF; 
    uid[8] = (uid[4] ^ uid[5] ^ uid[6] ^ uid[7]) & 0xFF; 
    return uid;
}

window.generateNewAdvUID = function() {
    const uid = generateRandomUID();
    const hex = Array.from(uid).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    document.getElementById('advUID').value = hex;
};

// --- DATA GENERATION (Asynchronous) ---

async function generateWumiiboData(idHex) {
    const arr = new Uint8Array(540);
    arr[2] = 0x0F; arr[3] = 0xE0;
    const cleanId = idHex.replace(/[^0-9A-Fa-f]/g, '').padEnd(16, '0');
    for (let i = 0, off = 0x1DC; i < 16; i += 2, off++) {
        arr[off] = parseInt(cleanId.substring(i, i + 2), 16);
    }
    return await applyEncryption(arr);
}

async function generateamiiboData(idHex, uidBytes = null, sigText = null, noSignature = false) {
    const arr = new Uint8Array(572); 
    const cleanId = idHex.replace(/[^0-9A-Fa-f]/g, '').padEnd(16, '0');
    const idBytes = hexToBytes(cleanId);
    const uid = uidBytes || generateRandomUID();

    arr[0] = uid[8];
    arr.set([0x48, 0x0F, 0xE0, 0xF1, 0x10, 0xFF, 0xEE], 0x01);
    arr.set([0xA5, 0x00, 0x00, 0x00], 0x28);
    arr.set(idBytes, 0x54);
    arr.set(uid, 0x1D4);
    arr.set(idBytes, 0x1DC);

    let salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    arr.set(salt, 0x1E8);
    
    arr.set([0x01, 0x00, 0x0F, 0xBD], 0x208);
    arr.set([0x00, 0x00, 0x00, 0x04], 0x20C);
    arr.set([0x5F, 0x00, 0x00, 0x00], 0x210);
    
    // Encrypt the core 540 bytes
    let encryptedBody = await applyEncryption(arr.slice(0, 540));
    
    if (noSignature) return encryptedBody;

    let finalArr = new Uint8Array(572);
    finalArr.set(encryptedBody);
    let finalSig = (!sigText || sigText === DEFAULT_SIG_TEXT) ? 
                   hexToBytes(DEFAULT_SIG_HEX) : textToUint8Array(sigText, 16);
    finalArr.set(finalSig, 540);
    return finalArr;
}

// --- KEY MANAGEMENT ---

async function loadKeysFromFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const keyData = Array.from(new Uint8Array(buffer));
    try {
        masterKeys = maboii.loadMasterKeys(keyData);
        if (masterKeys) {
            localStorage.setItem('maboii_keys_v2', JSON.stringify(keyData));
            updateKeyUI(true);
        }
    } catch (err) { alert("Invalid key_retail.bin file."); }
}

function updateKeyUI(loaded) {
    const status = document.getElementById('keyStatus');
    const clearBtn = document.getElementById('clearKeysBtn');
    if (loaded) {
        status.className = "badge badge-success mr-3";
        status.textContent = "Keys Loaded: Files will be ENCRYPTED (ENC)";
        clearBtn.style.display = "inline-block";
    } else {
        status.className = "badge badge-danger mr-3";
        status.textContent = "Keys missing: Downloads will be decrypted";
        clearBtn.style.display = "none";
    }
}

window.clearKeys = function() {
    masterKeys = null;
    localStorage.removeItem('maboii_keys_v2');
    updateKeyUI(false);
};

// --- UPDATED DOWNLOAD HANDLERS ---

window.downloadSingle = async function(type, name, id) {
    try {
        let data = (type === 'wumiibo') ? await generateWumiiboData(id) : await generateamiiboData(id);
        let filename = name.replace(/[/\\?%*:|"<>]/g, '-');
        let state = masterKeys ? "ENC" : "DEC";
        download(new Blob([data]), `${filename}_${type}_${state}.bin`, "application/octet-stream");
    } catch (e) { console.error(e); }
};

window.generateZip = async function(type) {
    if (!amiiboDatabase.length) return;
    const zip = new JSZip();
    let state = masterKeys ? "ENC" : "DEC";
    
    for (const amiibo of amiiboDatabase) {
        let data = (type === 'wumiibo') ? await generateWumiiboData(amiibo.id) : await generateamiiboData(amiibo.id);
        let folder = zip.folder(amiibo.series || "Others");
        folder.file(`${amiibo.name} (${type}_${state}).bin`, data);
    }
    const content = await zip.generateAsync({ type: "blob" });
    download(content, `amiibos_${type}_${state}.zip`, "application/octet-stream");
};

window.downloadAdvanced = async function() {
    const id = document.getElementById('advId').value;
    const UID = document.getElementById('advUID').value.replace(/\s/g, '');
    const sigText = document.getElementById('advSig').value;
    const noSig = document.getElementById('advNoSig').checked;
    
    if (UID.length !== 18) { alert("UID must be 18 hex characters."); return; }
    
    try {
        const data = await generateamiiboData(id, hexToBytes(UID), sigText, noSig);
        let state = masterKeys ? "ENC" : "DEC";
        download(new Blob([data]), `custom_amiibo_${id}_${state}.bin`, "application/octet-stream");
    } catch (e) { alert("Error processing advanced data."); }
};

// --- MANUAL ENCRYPTION TOOL LOGIC ---

window.processManualEncryption = async function() {
    const fileInput = document.getElementById('encryptFileInput');
    if (!fileInput.files.length) { alert("Please select a .bin file first."); return; }
    if (!masterKeys) { alert("Please load key_retail.bin first!"); return; }

    const file = fileInput.files[0];
    const buffer = await file.arrayBuffer();
    const decryptedData = new Uint8Array(buffer);

    if (decryptedData.length < 520) {
        alert("Invalid file size. This doesn't look like an amiibo dump.");
        return;
    }

    try {
        // Use the existing encryption logic on the first 540 bytes
        const encryptedBody = await applyEncryption(decryptedData.slice(0, 540));
        
        let finalData = encryptedBody;
        // If the original file had extra data (like a signature), preserve it
        if (decryptedData.length > 540) {
            finalData = new Uint8Array(decryptedData.length);
            finalData.set(encryptedBody);
            finalData.set(decryptedData.slice(540), 540);
        }

        const originalName = file.name.split('.').slice(0, -1).join('.');
        download(new Blob([finalData]), `${originalName}_ENC.bin`, "application/octet-stream");
    } catch (e) {
        alert("Encryption failed. Check your keys or file format.");
        console.error(e);
    }
};

// --- INITIALIZATION ---

$(document).ready(async function() {
    // Restore keys from storage
    const saved = localStorage.getItem('maboii_keys_v2');
    if (saved) {
        masterKeys = maboii.loadMasterKeys(JSON.parse(saved));
        updateKeyUI(true);
    }
    document.getElementById('keyFileInput').addEventListener('change', loadKeysFromFile);

    mainTable = $('#dataTable').DataTable({
        columnDefs: [{ orderable: false, targets: [0, 7] }],
        pageLength: 20,
        order: [[1, 'asc']]
    });

    // Handle routing and tool selection
    const urlParams = new URLSearchParams(window.location.search);
    const tool = urlParams.get('tool');
    const amiiboId = urlParams.get('id');

    if (tool === 'advanced' || amiiboId) {
        $("#mainContent").hide();
        $("#encryptorMode").hide();
        $("#advancedMode").show();
        if (amiiboId) {
            document.getElementById('advId').value = amiiboId.toUpperCase();
        } else {
            document.getElementById('advId').value = ""; // Manual entry
        }
        document.getElementById('advSig').value = DEFAULT_SIG_TEXT;
        generateNewAdvUID();
    } 
    else if (tool === 'encryptor') {
        $("#mainContent").hide();
        $("#advancedMode").hide();
        $("#encryptorMode").show();
    }

    try {
        // Fetch data from both API and local extras.json simultaneously
        const [apiRes, extraRes] = await Promise.all([
            fetch("https://amiiboapi.org/api/amiibo/").then(r => r.json()).catch(() => ({ amiibo: [] })),
            fetch("extras.json").then(r => r.json()).catch(() => ({ amiibo: [] }))
        ]);

        // Map official API data
        const apiData = apiRes.amiibo.map(ami => ({
            id: (ami.head + ami.tail).toUpperCase(),
            name: ami.name,
            series: ami.amiiboSeries,
            group: "API",
            relEU: ami.release?.eu || "-",
            relNA: ami.release?.na || "-",
            image: ami.image
        }));

        // Map local extra data
        const extraData = (extraRes.amiibo || []).map(ami => ({
            id: (ami.head + ami.tail).toUpperCase(),
            name: ami.name,
            series: ami.amiiboSeries,
            group: ami.customGroup || "Extra",
            relEU: "-",
            relNA: "-",
            image: ami.image || ""
        }));

        // Merge both databases
        amiiboDatabase = [...apiData, ...extraData];

        // Populate DataTable
        amiiboDatabase.forEach(amiibo => {
            const safeName = amiibo.name.replace(/'/g, "\\'");
            const actions = `
                <div class="btn-group">
                    <div class="btn-group">
                        <button type="button" class="btn btn-sm btn-amiibo" onclick="downloadSingle('amiibo','${safeName}','${amiibo.id}')">Amiibo</button>
                        <button type="button" class="btn btn-sm btn-amiibo dropdown-toggle dropdown-toggle-split" data-toggle="dropdown"></button>
                        <div class="dropdown-menu dropdown-menu-right" style="background-color: #2c2c2c;">
                            <a class="dropdown-item text-white" href="?id=${amiibo.id}">Advanced Mode</a>
                        </div>
                    </div>
                </div>`;
            
            mainTable.row.add([
                `<div class="amiibo-image"><img src="${amiibo.image}" onerror="this.src='https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg'"></div>`,
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

        // --- FILTERS SETUP ---

        // Setup Series Filter
        const series = [...new Set(amiiboDatabase.map(a => a.series))].sort();
        $('#filterSeries').empty().append(new Option("All Series", ""));
        series.forEach(s => $('#filterSeries').append(new Option(s, s)));

        // Setup Group Filter (Fix for missing groups)
        const groups = [...new Set(amiiboDatabase.map(a => a.group))].sort();
        $('#filterGroup').empty().append(new Option("All Groups", ""));
        groups.forEach(g => $('#filterGroup').append(new Option(g, g)));

        // --- EVENT HANDLERS ---

        // Search bar
        $('#input').on('keyup', function() { 
            mainTable.search(this.value).draw(); 
        });

        // Series dropdown (Column 3)
        $('#filterSeries').on('change', function() { 
            mainTable.column(3).search(this.value).draw(); 
        });

        // Group dropdown (Column 4)
        $('#filterGroup').on('change', function() { 
            mainTable.column(4).search(this.value).draw(); 
        });

        $(".hide_until_zipped").show();
        $("#downloadamiiboZip").off("click").on("click", () => generateZip('amiibo'));

    } catch (err) { 
        console.error("Initialization error:", err); 
    }
});
