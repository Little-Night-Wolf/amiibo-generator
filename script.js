/**
 * Amiibo Generator Pro - Modern Refactored Logic
 * Fully prepared for GitHub Pages deployment & API Scraping.
 * Features: Auto-Encryption, Smart Toasts, Multi-API Engine, GET URL Filters, Duplicate Aggregation.
 */

// --- API CONFIGURATION ENGINE ---
// Add new APIs here easily. The engine will fetch and merge them automatically.
const API_CONFIGS = [
    {
        id: "main_api",
        name: "amiiboapi.org", 
        url: "https://amiiboapi.org/api/amiibo/",
        extractData: (json) => json.amiibo || [],
        extractOrigin: (item) => "API",
        mapData: (item) => ({
            id: ((item.head || "") + (item.tail || "")).toUpperCase(),
            name: item.name || "Unknown",
            series: item.amiiboSeries || "-",
            gameSeries: item.gameSeries || "-",
            type: item.type || "Figure",
            releases: formatReleases(item.release),
            image: item.image || "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg"
        })
    },
    {
        id: "local_extras",
        name: "Extras",
        url: "extras.json",
        extractData: (json) => json.amiibo || [],
        extractOrigin: (item) => item.customGroup || "Extras", // Uses customGroup dynamically
        mapData: (item) => ({
            id: ((item.head || "") + (item.tail || "")).toUpperCase(),
            name: item.name || "Unknown",
            series: item.amiiboSeries || "-",
            gameSeries: item.gameSeries || "-",
            type: item.type || "Figure",
            releases: formatReleases(item.release),
            image: item.image || "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg"
        })
    }
    // Future Example:
    // { url: "new-api.com/data", extractData: (json) => json.results, extractOrigin: () => "NewAPI", mapData: (item) => ({ id: item.rawId.replace("0x", ""), name: item.title ... }) }
];

// --- GLOBAL STATE ---
const STATE = {
    database: [], // Will hold merged deduplicated items
    table: null,
    keys: null, 
    defaults: {
        sigHex: "6769746875622e636f6d2f4c6974746c652d4e696768742d576f6c66",
        sigText: "github.com/Little-Night-Wolf"
    },
    cryptoQueue: { data: null, filename: "" }
};

// --- CORE UTILITIES ---
const Utils = {
    hexToBytes: (hex) => {
        let bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        return bytes;
    },
    textToBytes: (text, length) => {
        let result = new Uint8Array(length);
        result.set(new TextEncoder().encode(text).slice(0, length));
        return result;
    },
    generateRandomUID: () => {
        let uid = new Uint8Array(9);
        crypto.getRandomValues(uid);
        uid[0] = 0x04;
        uid[3] = (0x88 ^ uid[0] ^ uid[1] ^ uid[2]) & 0xFF; 
        uid[8] = (uid[4] ^ uid[5] ^ uid[6] ^ uid[7]) & 0xFF; 
        return uid;
    },
    downloadBlob: (data, filename) => {
        const blob = new Blob([data], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        
        a.click();
        
        setTimeout(() => {
            if (document.body.contains(a)) document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 5000); 
    },
    showToast: (title, message, type = 'info') => {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `custom-toast toast-${type}`;
        
        let icon = "ℹ️";
        if(type === 'success') icon = "✅";
        if(type === 'error') icon = "❌";
        if(type === 'warning') icon = "⚠️";

        toast.innerHTML = `<strong>${icon} ${title}</strong>${message}`;
        container.appendChild(toast);
        
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { if (container.contains(toast)) toast.remove(); }, 400); 
        }, 4000);
    }
};

// --- URL PARAMS MANAGER ---
// Reads URL to set initial filters, and updates URL when filters change.
const UrlSync = {
    updateURL: () => {
        const params = new URLSearchParams();
        const search = $('#inputSearch').val();
        const origin = $('#filterOrigin').val();
        const type = $('#filterType').val();
        const series = $('#filterSeries').val();
        const gSeries = $('#filterGameSeries').val();
        
        if (search) params.set('search', search);
        if (origin) params.set('origin', origin);
        if (type) params.set('type', type);
        if (series) params.set('series', series);
        if (gSeries) params.set('gameSeries', gSeries);
        
        const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
    },
    applyFromURL: () => {
        const params = new URLSearchParams(window.location.search);
        
        if(params.has('search')) {
            $('#inputSearch').val(params.get('search'));
            STATE.table.search(params.get('search'));
        }
        if(params.has('origin')) {
            $('#filterOrigin').val(params.get('origin'));
            STATE.table.column(5).search(params.get('origin')); // Column 5 is Origin(s)
        }
        if(params.has('type')) {
            $('#filterType').val(params.get('type'));
            STATE.table.column(9).search(params.get('type'));
        }
        if(params.has('series')) {
            $('#filterSeries').val(params.get('series'));
            STATE.table.column(4).search(params.get('series'));
        }
        if(params.has('gameSeries')) {
            $('#filterGameSeries').val(params.get('gameSeries'));
            STATE.table.column(8).search(params.get('gameSeries'));
        }
        STATE.table.draw();
    }
};

window.switchTool = function(targetTool, prefillId = null) {
    if (typeof jQuery === 'undefined') return; 
    $('.tool-section').hide();
    
    if (targetTool === 'main') {
        $('#mainContent').fadeIn();
        // Restore standard search params when going back to main
        UrlSync.updateURL(); 
    } else {
        $(`#${targetTool}Mode`).fadeIn();
        window.history.pushState({}, document.title, `?tool=${targetTool}${prefillId ? '&id='+prefillId : ''}`);
        
        if (targetTool === 'advanced') {
            document.getElementById('advId').value = prefillId ? prefillId.toUpperCase() : "";
            document.getElementById('advSig').value = STATE.defaults.sigText;
            generateNewAdvUID();
            if(prefillId) document.getElementById('advId').dispatchEvent(new Event('input'));
        }
    }
};

function setupDropZone(zoneId, inputId, processCallback) {
    const dropZone = document.getElementById(zoneId);
    const inputEl = document.getElementById(inputId);
    if(!dropZone || !inputEl) return;

    dropZone.addEventListener('click', () => inputEl.click());
    inputEl.addEventListener('change', () => { if(inputEl.files.length) processCallback(inputEl.files[0]); });
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('drop-zone--over')));
    ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('drop-zone--over')));
    dropZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) { inputEl.files = e.dataTransfer.files; processCallback(e.dataTransfer.files[0]); }});
}

// --- KEY MANAGEMENT ---
async function handleKeyUpload(file) {
    const buffer = await file.arrayBuffer();
    const keyData = Array.from(new Uint8Array(buffer));
    
    if (keyData.length !== 160) { Utils.showToast("Key Error", `key_retail.bin must be exactly 160 bytes.`, "error"); return; }

    try {
        if(typeof maboii === 'undefined') throw new Error("Maboii library missing");
        STATE.keys = maboii.loadMasterKeys(keyData);
        if (STATE.keys) {
            localStorage.setItem('maboii_keys_v2', JSON.stringify(keyData));
            updateKeyUI(true);
            Utils.showToast("Keys Loaded", "Encryption and decryption are ready.", "success");
        }
    } catch (err) { Utils.showToast("Critical Error", "Invalid keys format or file is corrupted.", "error"); }
}

function updateKeyUI(loaded) {
    const status = document.getElementById('keyStatus');
    const clearBtn = document.getElementById('clearKeysBtn');
    if(!status) return;
    status.className = loaded ? "badge badge-success mr-3 mb-2 mb-md-0 py-2 px-3" : "badge badge-danger mr-3 mb-2 mb-md-0 py-2 px-3";
    status.textContent = loaded ? "🔒 Keys Loaded (Auto-Encryption Active)" : "⚠️ Keys missing: Downloads will be decrypted";
    clearBtn.style.display = loaded ? "inline-block" : "none";
}

window.clearKeys = function() {
    STATE.keys = null;
    localStorage.removeItem('maboii_keys_v2');
    updateKeyUI(false);
    Utils.showToast("Keys Cleared", "Reverted to plain-text mode.", "info");
};

// --- ENCRYPTION LOGIC ---
async function encryptBuffer(unpackedArray) {
    if (!STATE.keys || typeof maboii === 'undefined') return unpackedArray;
    try {
        const magic = [0x48, 0x0F, 0xE0, 0xF1, 0x10, 0xFF, 0xEE, 0xA5];
        magic.forEach((val, i) => unpackedArray[9 + i] = val);

        let packed = await maboii.pack(STATE.keys, Array.from(unpackedArray));
        packed[8] = packed[4] ^ packed[5] ^ packed[6] ^ packed[7]; 
        const pwd = [ (0xAA ^ packed[1] ^ packed[4]) & 0xFF, (0x55 ^ packed[2] ^ packed[5]) & 0xFF, (0xAA ^ packed[4] ^ packed[6]) & 0xFF, (0x55 ^ packed[5] ^ packed[7]) & 0xFF ];
        packed.splice(532, 6, pwd[0], pwd[1], pwd[2], pwd[3], 0x80, 0x80);

        return new Uint8Array(packed);
    } catch (e) { return unpackedArray; }
}

// --- DATA GENERATORS ---
async function generateAmiibo(idHex, type = 'amiibo', customUid = null, sigText = null, noSig = false) {
    const cleanId = idHex.replace(/[^0-9A-Fa-f]/g, '').padEnd(16, '0');
    
    if (type === 'wumiibo') {
        const arr = new Uint8Array(540);
        arr[2] = 0x0F; arr[3] = 0xE0;
        for (let i = 0, off = 0x1DC; i < 16; i += 2, off++) arr[off] = parseInt(cleanId.substring(i, i + 2), 16);
        return await encryptBuffer(arr);
    } 
    
    const arr = new Uint8Array(572); 
    const idBytes = Utils.hexToBytes(cleanId);
    const uid = customUid ? Utils.hexToBytes(customUid) : Utils.generateRandomUID();

    arr[0] = uid[8];
    arr.set([0x48, 0x0F, 0xE0, 0xF1, 0x10, 0xFF, 0xEE], 0x01);
    arr.set([0xA5, 0x00, 0x00, 0x00], 0x28);
    arr.set(idBytes, 0x54);
    arr.set(uid, 0x1D4);
    arr.set(idBytes, 0x1DC);
    
    let salt = new Uint8Array(32); crypto.getRandomValues(salt);
    arr.set(salt, 0x1E8);
    arr.set([0x01, 0x00, 0x0F, 0xBD], 0x208);
    arr.set([0x00, 0x00, 0x00, 0x04], 0x20C);
    arr.set([0x5F, 0x00, 0x00, 0x00], 0x210);
    
    let encryptedBody = await encryptBuffer(arr.slice(0, 540));
    if (noSig) return encryptedBody;

    let finalArr = new Uint8Array(572);
    finalArr.set(encryptedBody);
    let finalSig = (!sigText || sigText === STATE.defaults.sigText) ? Utils.hexToBytes(STATE.defaults.sigHex) : Utils.textToBytes(sigText, 16);
    finalArr.set(finalSig, 540);
    return finalArr;
}

// --- PUBLIC ACTIONS ---
window.generateNewAdvUID = () => { document.getElementById('advUID').value = Array.from(Utils.generateRandomUID()).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); };

window.downloadSingle = async (type, name, id) => {
    try {
        const data = await generateAmiibo(id, type);
        Utils.downloadBlob(data, `${name.replace(/[/\\?%*:|"<>]/g, '-')}_${type}_${STATE.keys ? "ENC" : "DEC"}.bin`);
        Utils.showToast("Download Complete", `${name} file generated successfully.`, "success");
    } catch(e) { Utils.showToast("Download Error", "Failed to generate the file.", "error"); }
};

window.downloadAdvanced = async () => {
    const id = document.getElementById('advId').value;
    const uid = document.getElementById('advUID').value.replace(/\s/g, '');
    if (uid.length !== 18) { Utils.showToast("Invalid Format", "UID must be exactly 18 Hexadecimal characters.", "warning"); return; }
    
    try {
        const data = await generateAmiibo(id, 'amiibo', uid, document.getElementById('advSig').value, document.getElementById('advNoSig').checked);
        Utils.downloadBlob(data, `custom_${id}_${STATE.keys ? "ENC" : "DEC"}.bin`);
        Utils.showToast("Advanced Generator", "Custom Amiibo downloaded successfully.", "success");
    } catch(e) { Utils.showToast("Generation Error", "Please check your input parameters.", "error"); }
};

window.generateZip = async () => {
    if (!STATE.database.length) return;
    Utils.showToast("Packaging...", "Creating a ZIP file with the collection.", "info");
    
    setTimeout(async () => {
        try {
            const zip = new JSZip();
            const stateStr = STATE.keys ? "ENC" : "DEC";
            
            for (const amiibo of STATE.database) {
                let data = await generateAmiibo(amiibo.id, 'amiibo');
                zip.folder(amiibo.main.series || "Others").file(`${amiibo.main.name} (amiibo_${stateStr}).bin`, data);
            }
            const content = await zip.generateAsync({ type: "blob" });
            Utils.downloadBlob(content, `amiibos_collection_${stateStr}.zip`);
            Utils.showToast("ZIP Complete!", "The entire collection was downloaded successfully.", "success");
        } catch(e) { Utils.showToast("ZIP Error", "There was an issue compressing the files.", "error"); }
    }, 100); 
};

// --- TOOL: SMART CRYPTO ---
window.processSmartCrypto = async (file) => {
    if(!file) file = document.getElementById('encryptFileInput').files[0];
    if(!file) return;
    
    if(!STATE.keys || typeof maboii === 'undefined') { Utils.showToast("Missing Keys", "You must load the key_retail.bin file first.", "error"); return; }

    try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (data.length < 520) { Utils.showToast("Invalid File", "File is too small to be an Amiibo dump.", "warning"); return; }

        let isEncrypted = (data[0x28] !== 0xA5);
        if(!isEncrypted) { for (let i = 0; i < 8; i++) { if (data[0x54 + i] !== data[0x1DC + i]) { isEncrypted = true; break; } } }

        let finalData = null;
        let originalStateText = "";
        let newStateText = "";
        let idHex = "";

        if (isEncrypted) {
            originalStateText = '<span class="badge badge-danger">🔐 Encrypted (Raw Dump)</span>';
            const res = await maboii.unpack(STATE.keys, Array.from(data.slice(0, 540)));
            if (res && res.unpacked) {
                finalData = new Uint8Array(res.unpacked);
                idHex = Array.from(finalData.slice(0x1DC, 0x1DC+8)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();

                if (res.result) {
                    newStateText = '<span class="badge badge-success">🔓 Decrypted (Valid Signature)</span>';
                    Utils.showToast("Decryption Success", "Intact official copy was decrypted.", "success");
                } else {
                    newStateText = '<span class="badge badge-warning text-dark">🔓 Decrypted (Modified)</span>';
                    Utils.showToast("Forced Decryption", "Modifications detected (Saved Mii or emulator). File recovered.", "warning");
                }
                
                STATE.cryptoQueue.data = finalData;
                STATE.cryptoQueue.filename = `${file.name.replace('.bin','')} [DECRYPTED].bin`;
            } else throw new Error("unpack failed");
        } else {
            originalStateText = '<span class="badge badge-secondary">🔓 Decrypted (Plain Text)</span>';
            newStateText = '<span class="badge badge-success">🔐 Encrypted (Ready for NTAG)</span>';
            idHex = Array.from(data.slice(0x1DC, 0x1DC+8)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();

            const encryptedBody = await encryptBuffer(data.slice(0, 540));
            finalData = encryptedBody;
            if (data.length > 540) { 
                finalData = new Uint8Array(data.length);
                finalData.set(encryptedBody);
                finalData.set(data.slice(540), 540);
            }
            
            STATE.cryptoQueue.data = finalData;
            STATE.cryptoQueue.filename = `${file.name.replace('.bin','')} [ENCRYPTED].bin`;
            Utils.showToast("Encryption Success", "File is ready to be written to an NFC tag.", "success");
        }

        const dbMatch = STATE.database.find(a => a.id === idHex);
        if (dbMatch) {
            document.getElementById('cryptoImage').src = dbMatch.main.image;
            document.getElementById('cryptoName').innerText = dbMatch.main.name;
        } else {
            document.getElementById('cryptoImage').src = "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
            document.getElementById('cryptoName').innerText = "Unknown Amiibo";
        }

        // Bugfix: Ensure visibility resets cleanly
        const waitBox = document.getElementById('cryptoWaitBox');
        waitBox.classList.remove('d-flex');
        waitBox.style.display = 'none';
        
        document.getElementById('cryptoResultBox').style.display = 'block';
        document.getElementById('cryptoStateBefore').innerHTML = originalStateText;
        document.getElementById('cryptoStateAfter').innerHTML = newStateText;

    } catch (e) { console.error("Smart Crypto Error:", e); Utils.showToast("Conversion Error", "Fatal error processing file. Check keys.", "error"); }
};

window.executeCryptoDownload = () => {
    if (STATE.cryptoQueue.data) {
        Utils.downloadBlob(STATE.cryptoQueue.data, STATE.cryptoQueue.filename);
        Utils.showToast("Download Initiated", "Check your downloads folder.", "info");
    }
};

// --- TOOL: DEEP ANALYZER ---
window.processAnalyzer = async (file) => {
    if(!file) file = document.getElementById('analyzeFileInput').files[0];
    if(!file) return;

    const data = new Uint8Array(await file.arrayBuffer());
    if (data.length < 520) { Utils.showToast("Analysis Failed", "File is too small to be an Amiibo.", "error"); return; }

    let isEncrypted = (data[0x28] !== 0xA5);
    if(!isEncrypted) { for (let i = 0; i < 8; i++) if (data[0x54 + i] !== data[0x1DC + i]) { isEncrypted = true; break; } }

    let unpackedData = data;
    let dStatus = "decrypted"; 

    if (isEncrypted) {
        if (!STATE.keys || typeof maboii === 'undefined') dStatus = "failed_no_keys";
        else {
            try {
                const res = await maboii.unpack(STATE.keys, Array.from(data.slice(0, 540)));
                if (res && res.unpacked) {
                    unpackedData = new Uint8Array(res.unpacked);
                    dStatus = res.result ? "success_valid" : "success_modified";
                } else dStatus = "failed_bad_keys";
            } catch (e) { dStatus = "failed_bad_keys"; }
        }
    }

    let idHex = "ERROR", uidHex = "ERROR", sigHex = "None", sigText = "None", nickname = "Not Set", miiOwner = "Not Set";
    
    if (!dStatus.includes("failed")) {
        idHex = Array.from(unpackedData.slice(0x1DC, 0x1DC+8)).map(b=>b.toString(16).padStart(2,'0')).join('');
        uidHex = Array.from(unpackedData.slice(0x1D4, 0x1D4+9)).map(b=>b.toString(16).padStart(2,'0')).join('');
        try {
            const arrData = Array.from(unpackedData);
            let rawNick = maboii.plainDataUtils.getNickName(arrData);
            let rawMii = maboii.plainDataUtils.getMiiName(arrData);
            if(rawNick && rawNick.trim().length > 0 && rawNick.charCodeAt(0) !== 0) nickname = rawNick;
            if(rawMii && rawMii.trim().length > 0 && rawMii.charCodeAt(0) !== 0) miiOwner = rawMii;
        } catch(e) {}
    }

    if (data.length >= 572) {
        const sigBytes = data.slice(540, 572);
        sigHex = Array.from(sigBytes).map(b=>b.toString(16).padStart(2,'0')).join('');
        const text = new TextDecoder("utf-8").decode(sigBytes).replace(/[\x00-\x1F\x7F-\x9F]/g, "");
        sigText = text.trim() ? text : "(Binary Data)";
    } else if (data.length > 540) sigHex = `Detected (${data.length - 540} extra bytes)`;

    const badges = {
        "decrypted": '<span class="badge badge-secondary">Already decrypted (Plain text)</span>',
        "success_valid": '<span class="badge badge-success">Encrypted (Original / Valid Signature)</span>',
        "success_modified": '<span class="badge badge-warning text-dark">Encrypted (Custom / AppData modified)</span>',
        "failed_no_keys": '<span class="badge badge-danger">Encrypted (No keys loaded to read)</span>',
        "failed_bad_keys": '<span class="badge badge-danger">Encrypted (Decryption Failed - Bad keys?)</span>'
    };

    document.getElementById('resStatus').innerHTML = badges[dStatus];
    document.getElementById('resID').innerText = idHex.toUpperCase();
    document.getElementById('resUID').innerText = uidHex.toUpperCase();
    document.getElementById('resNickname').innerText = nickname;
    document.getElementById('resMii').innerText = miiOwner;
    document.getElementById('resSigText').innerText = sigText;

    if (!dStatus.includes("failed")) {
        Utils.showToast("Analysis Complete", "Internal data extracted successfully.", "success");
        const dbMatch = STATE.database.find(a => a.id === idHex.toUpperCase());
        if (dbMatch) {
            document.getElementById('resImage').src = dbMatch.main.image;
            document.getElementById('resName').innerText = dbMatch.main.name;
            document.getElementById('resSeries').innerText = dbMatch.main.series;
        } else {
            // Fallback for unknown IDs just in case it's on the main API but our DB didn't load
            fetch(`https://amiiboapi.org/api/amiibo/?id=${idHex.toLowerCase()}`)
                .then(r => r.json()).then(d => {
                    document.getElementById('resImage').src = d.amiibo.image;
                    document.getElementById('resName').innerText = d.amiibo.name;
                    document.getElementById('resSeries').innerText = d.amiibo.amiiboSeries;
                }).catch(() => {
                    document.getElementById('resName').innerText = "Unknown Custom Amiibo";
                    document.getElementById('resImage').src = "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
                    document.getElementById('resSeries').innerText = "---";
                });
        }
    } else {
        Utils.showToast("Read Error", "Could not penetrate encryption. Check your keys.", "error");
        document.getElementById('resName').innerText = "Unreadable File";
        document.getElementById('resImage').src = "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
        document.getElementById('resSeries').innerText = "---";
    }
};

const formatReleases = (release) => {
    if (!release || typeof release !== 'object') return "-";
    let parts = [];
    if (release.na) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">NA:</strong> ${release.na}</span>`);
    if (release.eu) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">EU:</strong> ${release.eu}</span>`);
    if (release.jp) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">JP:</strong> ${release.jp}</span>`);
    if (release.au) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">AU:</strong> ${release.au}</span>`);
    return parts.length > 0 ? parts.join('<br>') : "-";
};

// Formatting function for Duplicate Amiibo dropdowns
function formatChildRow(entry) {
    let html = '<div class="p-3 bg-dark rounded border border-secondary" style="margin: 5px 0;"><h6 class="text-info mb-3">Available Versions / Sources</h6><div class="row">';
    entry.sources.forEach(src => {
        html += `
        <div class="col-md-4 mb-2">
            <div class="card bg-secondary text-white border-0 shadow-sm">
                <div class="card-body p-3">
                    <div class="amiibo-image">
                        <img loading="lazy" src="${src.image}" onerror="this.src='https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg'">
                    </div>
                    <span class="badge badge-dark float-right">${src.origin}</span>
                    <strong class="d-block mb-1">${src.name}</strong>
                    <small class="d-block text-light mb-1">Series: ${src.series}</small>
                    <small class="d-block text-light mb-3">Type: ${src.type}</small>
                    <!-- <button class="btn btn-sm btn-danger btn-block font-weight-bold" onclick="downloadSingle('amiibo','${src.name.replace(/'/g, "\\'")}','${entry.id}')">Download Version</button> -->
                </div>
            </div>
        </div>`;
    });

    html += '</div></div>';
    return html;
}

// --- CORE SYSTEM INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async function() {
    
    if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
        document.getElementById('dbStats').innerHTML = `<span class="text-danger">⚠️ Error: External libraries blocked. Check your ad-blocker or connection.</span>`;
        return;
    }

    const savedKeys = localStorage.getItem('maboii_keys_v2');
    if (savedKeys && typeof maboii !== 'undefined') {
        try {
            STATE.keys = maboii.loadMasterKeys(JSON.parse(savedKeys));
            if(STATE.keys) updateKeyUI(true);
        } catch (e) { localStorage.removeItem('maboii_keys_v2'); }
    }
    
    document.getElementById('keyRetailInput').addEventListener('change', e => { if(e.target.files.length) handleKeyUpload(e.target.files[0]) });
    setupDropZone('encryptorDropZone', 'encryptFileInput', window.processSmartCrypto);
    setupDropZone('analyzerDropZone', 'analyzeFileInput', window.processAnalyzer);

    document.getElementById('advId').addEventListener('input', e => {
        const id = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        if (id.length === 16) {
            const match = STATE.database.find(a => a.id === id);
            document.getElementById('advPreviewImage').src = match ? match.main.image : "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
            document.getElementById('advPreviewName').innerText = match ? match.main.name : "Unknown / Custom ID";
            document.getElementById('advPreviewName').className = match ? "text-success mb-1" : "text-warning mb-1";
            document.getElementById('advPreviewSeries').innerText = match ? match.main.series : "Not found in database";
            $('#advPreviewBox').fadeIn(200);
        } else {
            $('#advPreviewBox').fadeOut(200);
        }
    });

    // Multi-API Fetch & Aggregate Logic
    try {
        console.log("📡 Connecting to data sources...");
        
        const aggregationMap = new Map();
        let totalItemsFetched = 0;

        for (const config of API_CONFIGS) {
            try {
                const response = await fetch(config.url);
                if(!response.ok) throw new Error("HTTP " + response.status);
                
                const rawJson = await response.json();
                const itemsList = config.extractData(rawJson);
                
                itemsList.forEach(rawItem => {
                    const mapped = config.mapData(rawItem);
                    if (!mapped.id) return;
                    
                    const sourceOrigin = config.extractOrigin ? config.extractOrigin(rawItem) : config.name;
                    const sourceInfo = { origin: sourceOrigin, ...mapped };
                    
                    if (aggregationMap.has(mapped.id)) {
                        aggregationMap.get(mapped.id).sources.push(sourceInfo);
                    } else {
                        aggregationMap.set(mapped.id, {
                            id: mapped.id,
                            main: sourceInfo, // Visual defaults to first found
                            sources: [sourceInfo]
                        });
                    }
                    totalItemsFetched++;
                });
                console.log(`✅ ${config.name} loaded. (Items: ${itemsList.length})`);
            } catch (err) {
                console.warn(`⚠️ Warning: Failed to load data from ${config.name}`, err);
                alert(`⚠️ Warning: Failed to load data from ${config.name}`);
            }
        }

        STATE.database = Array.from(aggregationMap.values());
        
        if (STATE.database.length === 0) {
            document.getElementById('dbStats').innerHTML = `<span class="text-danger">⚠️ Database is empty. Could not load any APIs.</span>`;
            return;
        } else {
            document.getElementById('dbStats').innerText = `${STATE.database.length} unique amiibos (${totalItemsFetched} total)`;
        }

        // Initialize DataTables
        STATE.table = $('#dataTable').DataTable({ 
            dom: '<"row"<"col-sm-12"l>>rt<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
            columnDefs: [
                { orderable: false, targets: [0, 1, 7] }, // Expand, Image, Actions non-sortable
                { targets: [8, 9], visible: false } // Hidden for filtering
            ], 
            pageLength: 20, 
            order: [[2, 'asc']] 
        });
        
        STATE.database.forEach(entry => {
            const m = entry.main;
            const safeName = m.name.replace(/'/g, "\\'");
            
            const actions = `
                <div class="btn-group">
                    <button type="button" class="btn btn-sm btn-amiibo" onclick="downloadSingle('amiibo','${safeName}','${entry.id}')">Download</button>
                    <button type="button" class="btn btn-sm btn-amiibo dropdown-toggle dropdown-toggle-split" data-toggle="dropdown"></button>
                    <div class="dropdown-menu dropdown-menu-right" style="background-color: #2c2c2c;">
                        <a class="dropdown-item text-white" href="javascript:void(0)" onclick="switchTool('advanced', '${entry.id}')">Advanced Edit</a>
                    </div>
                </div>`;
            
            let typeIcon = "👤";
            if(m.type.toLowerCase() === "card") typeIcon = "🎴";
            if(m.type.toLowerCase() === "yarn") typeIcon = "🧶";
            if(m.type.toLowerCase() === "band") typeIcon = "⌚";

            // Expand Button if duplicates exist. Using flexbox wrapper for large clickable area.
            const expandCell = entry.sources.length > 1 
                ? `<span class="badge badge-danger badge-pill duplicate-badge" title="Multiple sources available">${entry.sources.length}</span>` 
                : ``;

            // Deduplicate origins for the Origin(s) column
            const uniqueOrigins = [...new Set(entry.sources.map(s => s.origin))].sort();
            const originBadges = uniqueOrigins.map(org => `<span class="badge badge-secondary badge-origin">${org}</span>`).join('');

            // Add row
            const rowNode = STATE.table.row.add([
                entry.sources.length > 1 ? `<div class="details-control-wrapper">${expandCell}</div>` : '',
                `<div class="amiibo-image"><img loading="lazy" src="${m.image}" onerror="this.src='https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg'"></div>`,
                `<span class="type-icon" title="${m.type}">${typeIcon}</span> <strong>${m.name}</strong>`, 
                `<code>${entry.id}</code>`, 
                m.series, 
                originBadges, 
                m.releases, 
                actions,
                m.gameSeries, 
                m.type        
            ]).node();
            
            $(rowNode).attr('data-amiibo-id', entry.id);
            if(entry.sources.length > 1) $(rowNode).find('td:first-child').addClass('details-control');
        });
        
        STATE.table.draw();

        // Bind Expand/Collapse Event
        $('#dataTable tbody').on('click', 'td.details-control', function () {
            const tr = $(this).closest('tr');
            const row = STATE.table.row(tr);
            const amiiboId = tr.attr('data-amiibo-id');
            const entryData = STATE.database.find(a => a.id === amiiboId);

            if (row.child.isShown()) {
                row.child.hide();
                tr.removeClass('shown');
            } else {
                row.child(formatChildRow(entryData)).show();
                tr.addClass('shown');
            }
        });

        // Filter Dropdown Population (using all unique origins found across all sources)
        const allOrigins = [...new Set(STATE.database.flatMap(entry => entry.sources.map(s => s.origin)))].sort();
        $('#filterOrigin').empty().append(new Option("All Origins", ""));
        allOrigins.forEach(opt => $('#filterOrigin').append(new Option(opt, opt)));

        const fillSelect = (id, property) => {
            const opts = [...new Set(STATE.database.map(a => a.main[property]))].sort();
            let defaultText = property.charAt(0).toUpperCase() + property.slice(1);
            if(property === 'gameSeries') defaultText = "Game Series";
            $(id).empty().append(new Option(`All ${defaultText}`, ""));
            opts.forEach(opt => $(id).append(new Option(opt, opt)));
        };
        
        fillSelect('#filterType', 'type');
        fillSelect('#filterSeries', 'series');
        fillSelect('#filterGameSeries', 'gameSeries');

        // Apply URL Filters FIRST
        UrlSync.applyFromURL();

        // Bind Events to update URL and Filter Table
        $('.filter-input').on('change keyup', function() {
            UrlSync.updateURL();
            
            const search = $('#inputSearch').val();
            const origin = $('#filterOrigin').val();
            const type = $('#filterType').val();
            const series = $('#filterSeries').val();
            const gSeries = $('#filterGameSeries').val();

            // Apply filters. Note: column 5 is Origin(s)
            STATE.table.search(search)
                       .column(5).search(origin)
                       .column(9).search(type)
                       .column(4).search(series)
                       .column(8).search(gSeries)
                       .draw();
        });
        
        $(".hide_until_zipped").show();

    } catch (err) { 
        console.error("DB Init error:", err); 
        document.getElementById('dbStats').innerHTML = `<span class="text-danger">⚠️ Fatal error loading the database.</span>`;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has('tool')) switchTool(params.get('tool'), params.get('id'));
});
