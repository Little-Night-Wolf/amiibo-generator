/**
 * Amiibo Generator Pro - Modern Refactored Logic
 * Fully prepared for GitHub Pages deployment.
 * Features: Auto-Encryption, Drag & Drop, Real-time Validation, Pro Filters & Deep AppData Analyzer, Smart Toasts
 */

// --- GLOBAL STATE ---
// Stores the application state, including loaded database, master keys, and temporary buffers.
const STATE = {
    database: [],
    table: null,
    keys: null, 
    defaults: {
        sigHex: "6769746875622e636f6d2f4c6974746c652d4e696768742d576f6c66",
        sigText: "github.com/Little-Night-Wolf"
    },
    cryptoQueue: {
        data: null,
        filename: ""
    }
};

// --- CORE UTILITIES ---
// Helper functions for byte manipulation, random generation, UI toasts, and safe file downloading.
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
    
    // NATIVE DOWNLOAD: Avoids rapid-firing download blocks from browsers 
    // when using the "Save As..." dialog by delaying the removal of the anchor element.
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
            if (document.body.contains(a)) {
                document.body.removeChild(a);
            }
            URL.revokeObjectURL(url);
        }, 5000); // 5 seconds grace period
    },
    
    // TOAST NOTIFICATIONS SYSTEM
    // Generates non-blocking UI alerts.
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
        
        // Trigger CSS animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('show'));
        });
        
        // Auto remove after 4 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (container.contains(toast)) toast.remove();
            }, 400); 
        }, 4000);
    }
};

// --- UI ROUTER ---
// Manages the visibility of the different tool sections and updates the URL.
window.switchTool = function(targetTool, prefillId = null) {
    if (typeof jQuery === 'undefined') return; 
    $('.tool-section').hide();
    
    if (targetTool === 'main') {
        $('#mainContent').fadeIn();
        window.history.pushState({}, document.title, window.location.pathname);
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

// --- DRAG & DROP MANAGER ---
// Hooks up visual drag and drop zones to hidden file inputs.
function setupDropZone(zoneId, inputId, processCallback) {
    const dropZone = document.getElementById(zoneId);
    const inputEl = document.getElementById(inputId);
    if(!dropZone || !inputEl) return;

    dropZone.addEventListener('click', () => inputEl.click());
    inputEl.addEventListener('change', () => {
        if(inputEl.files.length) processCallback(inputEl.files[0]);
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drop-zone--over'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drop-zone--over'));
    });

    dropZone.addEventListener('drop', e => {
        if (e.dataTransfer.files.length) {
            inputEl.files = e.dataTransfer.files; 
            processCallback(e.dataTransfer.files[0]);
        }
    });
}

// --- KEY MANAGEMENT ---
// Handles the loading and validation of the retail key file.
async function handleKeyUpload(file) {
    const buffer = await file.arrayBuffer();
    const keyData = Array.from(new Uint8Array(buffer));
    
    if (keyData.length !== 160) {
        Utils.showToast("Key Error", `The key_retail.bin file must be exactly 160 bytes. Yours is ${keyData.length} bytes.`, "error");
        return;
    }

    try {
        if(typeof maboii === 'undefined') throw new Error("Maboii library missing");
        STATE.keys = maboii.loadMasterKeys(keyData);
        if (STATE.keys) {
            localStorage.setItem('maboii_keys_v2', JSON.stringify(keyData));
            updateKeyUI(true);
            Utils.showToast("Keys Loaded", "Automatic encryption and decryption are now active.", "success");
        }
    } catch (err) { 
        Utils.showToast("Critical Error", "The key file is invalid or corrupted.", "error"); 
    }
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
// Encrypts a 540-byte raw amiibo array and applies physical NTAG fixes.
async function encryptBuffer(unpackedArray) {
    if (!STATE.keys || typeof maboii === 'undefined') return unpackedArray;
    try {
        const magic = [0x48, 0x0F, 0xE0, 0xF1, 0x10, 0xFF, 0xEE, 0xA5];
        magic.forEach((val, i) => unpackedArray[9 + i] = val);

        let packed = await maboii.pack(STATE.keys, Array.from(unpackedArray));
        
        packed[8] = packed[4] ^ packed[5] ^ packed[6] ^ packed[7]; 
        const pwd = [
            (0xAA ^ packed[1] ^ packed[4]) & 0xFF, (0x55 ^ packed[2] ^ packed[5]) & 0xFF,
            (0xAA ^ packed[4] ^ packed[6]) & 0xFF, (0x55 ^ packed[5] ^ packed[7]) & 0xFF
        ];
        packed.splice(532, 6, pwd[0], pwd[1], pwd[2], pwd[3], 0x80, 0x80);

        return new Uint8Array(packed);
    } catch (e) {
        console.error("Encryption failed:", e);
        return unpackedArray;
    }
}

// --- DATA GENERATORS ---
// Assembles the Amiibo .bin file format structure.
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
    let finalSig = (!sigText || sigText === STATE.defaults.sigText) ? 
                   Utils.hexToBytes(STATE.defaults.sigHex) : Utils.textToBytes(sigText, 16);
    finalArr.set(finalSig, 540);
    return finalArr;
}

// --- PUBLIC ACTIONS ---
window.generateNewAdvUID = () => {
    document.getElementById('advUID').value = Array.from(Utils.generateRandomUID()).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
};

window.downloadSingle = async (type, name, id) => {
    try {
        const data = await generateAmiibo(id, type);
        Utils.downloadBlob(data, `${name.replace(/[/\\?%*:|"<>]/g, '-')}_${type}_${STATE.keys ? "ENC" : "DEC"}.bin`);
        Utils.showToast("Download Complete", `${name} file generated successfully.`, "success");
    } catch(e) {
        Utils.showToast("Download Error", "Failed to generate the file.", "error");
    }
};

window.downloadAdvanced = async () => {
    const id = document.getElementById('advId').value;
    const uid = document.getElementById('advUID').value.replace(/\s/g, '');
    if (uid.length !== 18) {
        Utils.showToast("Invalid Format", "UID must be exactly 18 Hexadecimal characters.", "warning");
        return;
    }
    
    try {
        const data = await generateAmiibo(id, 'amiibo', uid, document.getElementById('advSig').value, document.getElementById('advNoSig').checked);
        Utils.downloadBlob(data, `custom_${id}_${STATE.keys ? "ENC" : "DEC"}.bin`);
        Utils.showToast("Advanced Generator", "Custom Amiibo generated and downloaded.", "success");
    } catch(e) {
        Utils.showToast("Generation Error", "Please check your input parameters.", "error");
    }
};

window.generateZip = async () => {
    if (!STATE.database.length) return;
    Utils.showToast("Packaging...", "Creating a ZIP file with the entire collection. This might take a moment.", "info");
    
    setTimeout(async () => {
        try {
            const zip = new JSZip();
            const stateStr = STATE.keys ? "ENC" : "DEC";
            
            for (const amiibo of STATE.database) {
                let data = await generateAmiibo(amiibo.id, 'amiibo');
                zip.folder(amiibo.series || "Others").file(`${amiibo.name} (amiibo_${stateStr}).bin`, data);
            }
            const content = await zip.generateAsync({ type: "blob" });
            Utils.downloadBlob(content, `amiibos_collection_${stateStr}.zip`);
            Utils.showToast("ZIP Complete!", "The collection was downloaded successfully.", "success");
        } catch(e) {
            Utils.showToast("ZIP Error", "There was an issue compressing the files.", "error");
        }
    }, 100); 
};

// --- TOOL: SMART CRYPTO (ENCRYPT/DECRYPT) ---
// Analyzes a dropped file, determines its encryption state, and reverses it.
window.processSmartCrypto = async (file) => {
    if(!file) file = document.getElementById('encryptFileInput').files[0];
    if(!file) return;
    
    if(!STATE.keys || typeof maboii === 'undefined') {
        Utils.showToast("Missing Keys", "You must load the key_retail.bin file in the top panel first.", "error");
        return;
    }

    try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (data.length < 520) {
            Utils.showToast("Invalid File", "File size is too small to be an Amiibo dump.", "warning");
            return;
        }

        // Auto-detect Encryption
        let isEncrypted = (data[0x28] !== 0xA5);
        if(!isEncrypted) {
            for (let i = 0; i < 8; i++) {
                if (data[0x54 + i] !== data[0x1DC + i]) { isEncrypted = true; break; }
            }
        }

        let finalData = null;
        let originalStateText = "";
        let newStateText = "";
        let idHex = "";

        if (isEncrypted) {
            // Decrypt Flow
            originalStateText = '<span class="badge badge-danger">🔐 Encrypted (Raw Dump)</span>';
            const res = await maboii.unpack(STATE.keys, Array.from(data.slice(0, 540)));
            
            if (res && res.unpacked) {
                finalData = new Uint8Array(res.unpacked);
                idHex = Array.from(finalData.slice(0x1DC, 0x1DC+8)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();

                if (res.result) {
                    newStateText = '<span class="badge badge-success">🔓 Decrypted (Valid Official Signature)</span>';
                    Utils.showToast("Decryption Success", "Intact official copy was decrypted.", "success");
                } else {
                    newStateText = '<span class="badge badge-warning text-dark">🔓 Decrypted (Modified/Custom Signature)</span>';
                    Utils.showToast("Forced Decryption", "Modifications detected (Saved Mii or emulator). File recovered.", "warning");
                }
                
                STATE.cryptoQueue.data = finalData;
                STATE.cryptoQueue.filename = `${file.name.replace('.bin','')} [DECRYPTED].bin`;

            } else {
                throw new Error("maboii returned undefined unpack");
            }
        } else {
            // Encrypt Flow
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

        // Visual Identity Lookup
        const dbMatch = STATE.database.find(a => a.id === idHex);
        if (dbMatch) {
            document.getElementById('cryptoImage').src = dbMatch.image;
            document.getElementById('cryptoName').innerText = dbMatch.name;
        } else {
            document.getElementById('cryptoImage').src = "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
            document.getElementById('cryptoName').innerText = "Unknown Amiibo";
        }

        // Interface Update
        document.getElementById('cryptoWaitBox').style.display = 'none';
        document.getElementById('cryptoResultBox').style.display = 'block';
        document.getElementById('cryptoStateBefore').innerHTML = originalStateText;
        document.getElementById('cryptoStateAfter').innerHTML = newStateText;

    } catch (e) {
        console.error("Smart Crypto Error:", e);
        Utils.showToast("Conversion Error", "A fatal error occurred. Bad keys?", "error");
    }
};

window.executeCryptoDownload = () => {
    if (STATE.cryptoQueue.data) {
        Utils.downloadBlob(STATE.cryptoQueue.data, STATE.cryptoQueue.filename);
        Utils.showToast("Download Initiated", "Check your downloads folder.", "info");
    }
};

// --- TOOL: DEEP ANALYZER ---
// Extracts security IDs and hidden AppData (like Mii Names) from binary dumps.
window.processAnalyzer = async (file) => {
    if(!file) file = document.getElementById('analyzeFileInput').files[0];
    if(!file) return;

    const data = new Uint8Array(await file.arrayBuffer());
    if (data.length < 520) {
        Utils.showToast("Analysis Failed", "File is too small.", "error");
        return;
    }

    let isEncrypted = (data[0x28] !== 0xA5);
    if(!isEncrypted) {
        for (let i = 0; i < 8; i++) if (data[0x54 + i] !== data[0x1DC + i]) { isEncrypted = true; break; }
    }

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
                } else {
                    dStatus = "failed_bad_keys";
                }
            } catch (e) { dStatus = "failed_bad_keys"; }
        }
    }

    let idHex = "ERROR", uidHex = "ERROR", sigHex = "None", sigText = "None";
    let nickname = "Not Set", miiOwner = "Not Set";
    
    if (!dStatus.includes("failed")) {
        idHex = Array.from(unpackedData.slice(0x1DC, 0x1DC+8)).map(b=>b.toString(16).padStart(2,'0')).join('');
        uidHex = Array.from(unpackedData.slice(0x1D4, 0x1D4+9)).map(b=>b.toString(16).padStart(2,'0')).join('');
        
        try {
            const arrData = Array.from(unpackedData);
            let rawNick = maboii.plainDataUtils.getNickName(arrData);
            let rawMii = maboii.plainDataUtils.getMiiName(arrData);
            if(rawNick && rawNick.trim().length > 0 && rawNick.charCodeAt(0) !== 0) nickname = rawNick;
            if(rawMii && rawMii.trim().length > 0 && rawMii.charCodeAt(0) !== 0) miiOwner = rawMii;
        } catch(e) { console.warn("Failed to extract AppData", e); }
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
        Utils.showToast("Analysis Complete", "Internal data extracted.", "success");
        const dbMatch = STATE.database.find(a => a.id === idHex.toUpperCase());
        if (dbMatch) {
            document.getElementById('resImage').src = dbMatch.image;
            document.getElementById('resName').innerText = dbMatch.name;
            document.getElementById('resSeries').innerText = dbMatch.series;
        } else {
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
        Utils.showToast("Read Error", "Could not penetrate encryption.", "error");
        document.getElementById('resName').innerText = "Unreadable File";
        document.getElementById('resImage').src = "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
        document.getElementById('resSeries').innerText = "---";
    }
};

// --- DATA FORMATTER ---
const formatReleases = (release) => {
    if (!release || typeof release !== 'object') return "-";
    let parts = [];
    if (release.na) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">NA:</strong> ${release.na}</span>`);
    if (release.eu) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">EU:</strong> ${release.eu}</span>`);
    if (release.jp) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">JP:</strong> ${release.jp}</span>`);
    if (release.au) parts.push(`<span class="text-nowrap text-muted"><strong class="text-white">AU:</strong> ${release.au}</span>`);
    return parts.length > 0 ? parts.join('<br>') : "-";
};

// --- CORE SYSTEM INITIALIZATION ---
// Boots the application, fetches APIs, populates tables, and binds events.
document.addEventListener('DOMContentLoaded', async function() {
    
    // Safety check for jQuery blocking
    if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
        console.error("❌ jQuery could not be loaded.");
        document.getElementById('dbStats').innerHTML = `<span class="text-danger">⚠️ Error: Libraries blocked.</span>`;
        return;
    }

    // Restore cached keys
    const savedKeys = localStorage.getItem('maboii_keys_v2');
    if (savedKeys && typeof maboii !== 'undefined') {
        try {
            STATE.keys = maboii.loadMasterKeys(JSON.parse(savedKeys));
            if(STATE.keys) updateKeyUI(true);
        } catch (e) { localStorage.removeItem('maboii_keys_v2'); }
    }
    
    // Event Listeners Registration
    document.getElementById('keyRetailInput').addEventListener('change', e => { if(e.target.files.length) handleKeyUpload(e.target.files[0]) });
    setupDropZone('encryptorDropZone', 'encryptFileInput', window.processSmartCrypto);
    setupDropZone('analyzerDropZone', 'analyzeFileInput', window.processAnalyzer);

    // Advanced Generator Preview Logic
    document.getElementById('advId').addEventListener('input', e => {
        const id = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        if (id.length === 16) {
            const match = STATE.database.find(a => a.id === id);
            document.getElementById('advPreviewImage').src = match ? match.image : "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg";
            document.getElementById('advPreviewName').innerText = match ? match.name : "Unknown / Custom ID";
            document.getElementById('advPreviewName').className = match ? "text-success mb-1" : "text-warning mb-1";
            document.getElementById('advPreviewSeries').innerText = match ? match.series : "Not found in database";
            $('#advPreviewBox').fadeIn(200);
        } else {
            $('#advPreviewBox').fadeOut(200);
        }
    });

    // Database Initialization
    try {
        console.log("📡 Connecting to AmiiboAPI (https://amiiboapi.org/api/amiibo/)...");
        
        // Fetching data simultaneously. Safe fallbacks for missing local files.
        const [apiRes, extraRes] = await Promise.all([
            fetch("https://amiiboapi.org/api/amiibo/").then(r => {
                if(!r.ok) throw new Error("AmiiboAPI Error: " + r.status);
                return r.json();
            }).catch(e => { console.error(e); return { amiibo: [] }; }),
            
            fetch("extras.json").then(r => r.json()).catch(e => { console.warn("No local extras.json found"); return { amiibo: [] }; })
        ]);

        const processData = (arr, isExtra) => {
            if (!arr || !Array.isArray(arr)) return [];
            return arr.map(ami => ({
                id: ((ami.head || "") + (ami.tail || "")).toUpperCase() || "UNKNOWN",
                name: ami.name || "Unknown",
                series: ami.amiiboSeries || "-",
                gameSeries: ami.gameSeries || "-",
                type: ami.type || "Figure",
                origin: isExtra ? (ami.customGroup || "Extra") : "Official API",
                releases: formatReleases(ami.release),
                image: ami.image || "https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg"
            }));
        };

        STATE.database = [...processData(apiRes.amiibo, false), ...processData(extraRes.amiibo || [], true)];
        
        if (STATE.database.length === 0) {
            document.getElementById('dbStats').innerHTML = `<span class="text-danger">⚠️ Database is empty.</span>`;
            return;
        } else {
            document.getElementById('dbStats').innerText = `${STATE.database.length} amiibos loaded`;
        }

        // DataTables Engine Boot
        STATE.table = $('#dataTable').DataTable({ 
            dom: '<"row"<"col-sm-12"l>>rt<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
            columnDefs: [
                { orderable: false, targets: [0, 6] },
                { targets: [7, 8], visible: false } // Hidden for filtering
            ], 
            pageLength: 20, 
            order: [[1, 'asc']] 
        });
        
        // Populate Table Rows
        STATE.database.forEach(ami => {
            const safeName = (ami.name || "Unknown").replace(/'/g, "\\'");
            const actions = `
                <div class="btn-group">
                    <button type="button" class="btn btn-sm btn-amiibo" onclick="downloadSingle('amiibo','${safeName}','${ami.id}')">Download</button>
                    <button type="button" class="btn btn-sm btn-amiibo dropdown-toggle dropdown-toggle-split" data-toggle="dropdown"></button>
                    <div class="dropdown-menu dropdown-menu-right" style="background-color: #2c2c2c;">
                        <a class="dropdown-item text-white" href="javascript:void(0)" onclick="switchTool('advanced', '${ami.id}')">Advanced Edit</a>
                    </div>
                </div>`;
            
            let typeIcon = "👤";
            if(ami.type.toLowerCase() === "card") typeIcon = "🎴";
            if(ami.type.toLowerCase() === "yarn") typeIcon = "🧶";
            if(ami.type.toLowerCase() === "band") typeIcon = "⌚";

            STATE.table.row.add([
                `<div class="amiibo-image"><img loading="lazy" src="${ami.image}" onerror="this.src='https://raw.githubusercontent.com/Little-Night-Wolf/amiibo-generator/main/favicon.svg'"></div>`,
                `<span class="type-icon" title="${ami.type}">${typeIcon}</span> <strong>${ami.name}</strong>`, 
                `<code>${ami.id}</code>`, 
                ami.series, 
                `<span class="badge badge-secondary badge-origin">${ami.origin}</span>`, 
                ami.releases, 
                actions,
                ami.gameSeries, 
                ami.type        
            ]);
        });
        STATE.table.draw();

        // Populate Smart Filters
        const fillSelect = (id, property) => {
            const opts = [...new Set(STATE.database.map(a => a[property]))].sort();
            let defaultText = property.charAt(0).toUpperCase() + property.slice(1);
            if(property === 'gameSeries') defaultText = "Game Series";
            $(id).empty().append(new Option(`All ${defaultText}`, ""));
            opts.forEach(opt => $(id).append(new Option(opt, opt)));
        };
        
        fillSelect('#filterOrigin', 'origin');
        fillSelect('#filterType', 'type');
        fillSelect('#filterSeries', 'series');
        fillSelect('#filterGameSeries', 'gameSeries');

        // Bind Search & Filters
        $('#input').on('keyup', function() { STATE.table.search(this.value).draw(); });
        $('#filterOrigin').on('change', function() { STATE.table.column(4).search(this.value).draw(); });
        $('#filterType').on('change', function() { STATE.table.column(8).search(this.value).draw(); });
        $('#filterSeries').on('change', function() { STATE.table.column(3).search(this.value).draw(); });
        $('#filterGameSeries').on('change', function() { STATE.table.column(7).search(this.value).draw(); });
        
        // Show bulk download button
        $(".hide_until_zipped").show();
        $("#downloadamiiboZip").off("click").on("click", window.generateZip);

    } catch (err) { 
        console.error("DB Init error:", err); 
        document.getElementById('dbStats').innerHTML = `<span class="text-danger">⚠️ Fatal error loading database.</span>`;
    }

    // URL Navigation State
    const params = new URLSearchParams(window.location.search);
    if (params.has('tool')) switchTool(params.get('tool'), params.get('id'));
});
