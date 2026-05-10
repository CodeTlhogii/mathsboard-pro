console.log('MathsBoard Pro - Complete Version');

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let socket, currentUser, currentRoomId;
let canvas, ctx, drawing = false, lastX, lastY;
let currentColor = '#ff0000', currentSize = 5;
let isErasing = false, isHighlighting = false;
let sessionStartTime, timerInterval;
let pdfDoc = null, currentPage = 1, totalPages = 0;
let pdfImageData = null;
let hasPdf = false;
let heartbeatInterval = null;

// Calculator
let calcExpr = '';
let calcScreen = document.getElementById('calcScreen');

// DOM Elements
const authContainer = document.getElementById('authContainer');
const joinContainer = document.getElementById('joinContainer');
const boardContainer = document.getElementById('boardContainer');

function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="fas fa-bell"></i> ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function showPage(page) {
    authContainer.style.display = 'none';
    joinContainer.style.display = 'none';
    boardContainer.style.display = 'none';
    if (page === 'auth') authContainer.style.display = 'flex';
    else if (page === 'join') joinContainer.style.display = 'flex';
    else if (page === 'board') boardContainer.style.display = 'flex';
}

// ============ HEARTBEAT ============
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('heartbeat');
        }
    }, 25000);
}

// ============ AUTH ============
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

if (loginTab) {
    loginTab.onclick = () => {
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
    };
}
if (registerTab) {
    registerTab.onclick = () => {
        registerTab.classList.add('active');
        loginTab.classList.remove('active');
        registerForm.classList.add('active');
        loginForm.classList.remove('active');
    };
}

document.getElementById('registerBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('regEmail').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;
    
    if (!email || !username || !password) {
        document.getElementById('registerError').textContent = 'Please fill all required fields';
        return;
    }
    if (password !== confirm) {
        document.getElementById('registerError').textContent = 'Passwords do not match';
        return;
    }
    if (password.length < 4) {
        document.getElementById('registerError').textContent = 'Password must be at least 4 characters';
        return;
    }
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username, password, name })
        });
        const data = await res.json();
        
        if (data.success) {
            toast('Registration successful! Please login.');
            loginTab.click();
            document.getElementById('loginEmail').value = email;
            document.getElementById('loginPassword').value = '';
            document.getElementById('regEmail').value = '';
            document.getElementById('regUsername').value = '';
            document.getElementById('regName').value = '';
            document.getElementById('regPassword').value = '';
            document.getElementById('regConfirm').value = '';
        } else {
            document.getElementById('registerError').textContent = data.error;
        }
    } catch (err) {
        document.getElementById('registerError').textContent = 'Server error';
    }
});

document.getElementById('loginBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        document.getElementById('loginError').textContent = 'Enter email and password';
        return;
    }
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        
        if (data.success) {
            currentUser = data.user;
            document.getElementById('userAvatar').src = currentUser.avatar;
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userEmail').textContent = currentUser.email;
            showPage('join');
            toast(`Welcome ${currentUser.name}!`);
            initSocket();
        } else {
            document.getElementById('loginError').textContent = data.error;
        }
    } catch (err) {
        document.getElementById('loginError').textContent = 'Server error';
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', () => location.reload());
document.getElementById('leaveBtn')?.addEventListener('click', () => location.reload());
document.getElementById('createRoomBtn')?.addEventListener('click', () => {
    if (socket) socket.emit('create-room');
    else toast('Connecting...');
});
document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
    const code = document.getElementById('roomCode').value.trim();
    if (code && socket) socket.emit('join-room', code);
    else toast('Enter room code');
});

// ============ SIDEBAR COLLAPSE ============
function initCollapse() {
    const collapseBtn = document.getElementById('collapseBtn');
    const sidebar = document.getElementById('sidebar');
    
    if (collapseBtn) {
        collapseBtn.onclick = () => {
            sidebar.classList.toggle('collapsed');
            const icon = collapseBtn.querySelector('i');
            if (sidebar.classList.contains('collapsed')) {
                icon.classList.remove('fa-chevron-left');
                icon.classList.add('fa-chevron-right');
                collapseBtn.querySelector('span').textContent = 'Expand';
            } else {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-left');
                collapseBtn.querySelector('span').textContent = 'Collapse';
            }
            setTimeout(() => {
                if (canvas) {
                    redrawCanvas();
                }
            }, 300);
        };
    }
}

// ============ CANVAS DRAWING ============
function initCanvas() {
    const c = document.getElementById('mainCanvas');
    const container = c.parentElement;
    
    function resizeCanvas() {
        c.width = container.clientWidth;
        c.height = container.clientHeight;
        canvas = c;
        ctx = canvas.getContext('2d');
        redrawCanvas();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
    
    resizeCanvas();
    window.addEventListener('resize', () => setTimeout(resizeCanvas, 100));
    
    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width / rect.width;
        const sy = canvas.height / rect.height;
        let cx, cy;
        if (e.touches) {
            cx = e.touches[0].clientX;
            cy = e.touches[0].clientY;
        } else {
            cx = e.clientX;
            cy = e.clientY;
        }
        return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
    }
    
    function start(e) {
        e.preventDefault();
        drawing = true;
        const p = getPos(e);
        lastX = p.x; lastY = p.y;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
    }
    
    function draw(e) {
        if (!drawing) return;
        e.preventDefault();
        const p = getPos(e);
        
        if (isHighlighting) {
            ctx.strokeStyle = 'rgba(255,255,0,0.4)';
            ctx.lineWidth = 20;
        } else if (isErasing) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 20;
        } else {
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentSize;
        }
        
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        
        if (socket && socket.connected) {
            socket.emit('draw', { fromX: lastX, fromY: lastY, toX: p.x, toY: p.y, color: currentColor, size: currentSize });
        }
        lastX = p.x; lastY = p.y;
    }
    
    function stop() { drawing = false; ctx.beginPath(); }
    
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stop);
    canvas.addEventListener('mouseleave', stop);
    canvas.addEventListener('touchstart', start);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stop);
}

function redrawCanvas() {
    if (!ctx || !canvas) return;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (hasPdf && pdfImageData) {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
            const x = (canvas.width - img.width * scale) / 2;
            const y = (canvas.height - img.height * scale) / 2;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        };
        img.src = pdfImageData;
    } else {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
}

function drawRemote(d) {
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(d.fromX, d.fromY);
    ctx.lineTo(d.toX, d.toY);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.size;
    ctx.stroke();
}

// ============ PDF FUNCTIONS ============
async function loadPDFFromData(dataUrl) {
    toast('Loading PDF...');
    try {
        const base64 = dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;
        hasPdf = true;
        
        const pdfNav = document.getElementById('pdfNav');
        if (pdfNav) pdfNav.style.display = 'block';
        
        const pageIndicator = document.getElementById('pageIndicator');
        if (pageIndicator) pageIndicator.innerHTML = `Page 1 / ${totalPages}`;
        
        await renderPDFPage();
        toast(`PDF loaded: ${totalPages} pages`);
        
        if (socket) socket.emit('pdf-loaded', { pdfData: dataUrl });
    } catch(e) { 
        console.error('PDF load error:', e);
        toast('PDF error - file may be corrupted or too large');
    }
}

async function renderPDFPage() {
    if (!pdfDoc) return;
    
    const page = await pdfDoc.getPage(currentPage);
    const container = canvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    const viewport = page.getViewport({ scale: 1 });
    let scale;
    if (window.innerWidth <= 768) {
        scale = containerWidth / viewport.width;
    } else {
        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        scale = Math.min(scaleX, scaleY);
    }
    
    const scaledViewport = page.getViewport({ scale: scale });
    
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    canvas.style.width = `${scaledViewport.width}px`;
    canvas.style.height = `${scaledViewport.height}px`;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = scaledViewport.width;
    tempCanvas.height = scaledViewport.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    await page.render({ canvasContext: tempCtx, viewport: scaledViewport }).promise;
    
    pdfImageData = tempCanvas.toDataURL();
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (window.innerWidth <= 768) {
            const container = canvas.parentElement;
            if (canvas.width > container.clientWidth) {
                container.scrollLeft = (canvas.width - container.clientWidth) / 2;
            }
            container.scrollTop = 0;
        }
    };
    img.src = pdfImageData;
    
    document.getElementById('pageIndicator').innerHTML = `Page ${currentPage} / ${totalPages}`;
}

function nextPage() { 
    if (currentPage < totalPages) { 
        currentPage++; 
        renderPDFPage(); 
        if (socket) socket.emit('pdf-page-change', { pageNum: currentPage });
    } 
}

function prevPage() { 
    if (currentPage > 1) { 
        currentPage--; 
        renderPDFPage(); 
        if (socket) socket.emit('pdf-page-change', { pageNum: currentPage });
    } 
}

function clearPDF() {
    pdfDoc = null;
    pdfImageData = null;
    hasPdf = false;
    
    const pdfNav = document.getElementById('pdfNav');
    if (pdfNav) pdfNav.style.display = 'none';
    
    if (ctx && canvas) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
    
    if (socket) socket.emit('pdf-cleared');
    toast('PDF removed - drawing restored');
}

// ============ CALCULATOR ============
function evalExpr(expr) {
    try {
        let p = expr.replace(/π/g, 'Math.PI').replace(/e/g, 'Math.E')
            .replace(/sin\(/g, 'Math.sin(').replace(/cos\(/g, 'Math.cos(').replace(/tan\(/g, 'Math.tan(')
            .replace(/sqrt\(/g, 'Math.sqrt(').replace(/log\(/g, 'Math.log10(').replace(/ln\(/g, 'Math.log(')
            .replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
        let r = Function('"use strict";return (' + p + ')')();
        return isNaN(r) ? 'Error' : r;
    } catch(e) { return 'Error'; }
}

function updateCalc() { if (calcScreen) calcScreen.textContent = calcExpr || '0'; }

function setupCalculator() {
    if (!calcScreen) return;
    document.querySelectorAll('.calc-key[data-num]').forEach(btn => {
        btn.onclick = () => { calcExpr += btn.dataset.num; updateCalc(); };
    });
    document.querySelectorAll('.calc-key[data-op]').forEach(btn => {
        btn.onclick = () => { calcExpr += btn.dataset.op; updateCalc(); };
    });
    document.querySelectorAll('.calc-key[data-dot]').forEach(btn => {
        btn.onclick = () => { calcExpr += '.'; updateCalc(); };
    });
    document.querySelector('.calc-key[data-action="clear"]')?.addEventListener('click', () => { calcExpr = ''; updateCalc(); });
    document.querySelector('.calc-key[data-action="del"]')?.addEventListener('click', () => { calcExpr = calcExpr.slice(0, -1); updateCalc(); });
    document.querySelector('.calc-key[data-action="equals"]')?.addEventListener('click', () => {
        const r = evalExpr(calcExpr);
        calcExpr = r.toString();
        updateCalc();
        toast(`Result: ${r}`);
    });
    document.querySelectorAll('.calc-key.func').forEach(btn => {
        btn.onclick = () => {
            const f = btn.dataset.func;
            if (f === 'pi') calcExpr += 'π';
            else if (f === 'e') calcExpr += 'e';
            else if (f === 'sqrt') calcExpr += 'sqrt(';
            else if (f === 'square') calcExpr += '^2';
            else if (f === 'cube') calcExpr += '^3';
            else calcExpr += `${f}(`;
            updateCalc();
        };
    });
    document.getElementById('copyCalcResult')?.addEventListener('click', () => {
        if (calcExpr && calcExpr !== '0' && ctx) {
            const r = evalExpr(calcExpr);
            ctx.font = '24px Arial';
            ctx.fillStyle = '#000';
            ctx.fillText(r.toString(), canvas.width / 2, canvas.height / 2);
            toast(`Copied: ${r}`);
        }
    });
}

// ============ TOOLS ============
function setupTools() {
    document.querySelectorAll('.color').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
            currentColor = el.dataset.color;
            isErasing = false;
            isHighlighting = false;
            document.getElementById('drawBtn').classList.add('active');
            document.getElementById('highlighterBtn').classList.remove('active');
            document.getElementById('eraserBtn').classList.remove('active');
        };
    });
    
    document.getElementById('brushSlider')?.addEventListener('input', (e) => {
        currentSize = parseInt(e.target.value);
        document.getElementById('sizeDisplay').innerHTML = `Size: ${currentSize}px`;
    });
    
    document.getElementById('drawBtn')?.addEventListener('click', () => {
        isErasing = false;
        isHighlighting = false;
        document.getElementById('drawBtn').classList.add('active');
        document.getElementById('highlighterBtn').classList.remove('active');
        document.getElementById('eraserBtn').classList.remove('active');
        toast('Draw mode');
    });
    
    document.getElementById('highlighterBtn')?.addEventListener('click', () => {
        isHighlighting = true;
        isErasing = false;
        document.getElementById('highlighterBtn').classList.add('active');
        document.getElementById('drawBtn').classList.remove('active');
        document.getElementById('eraserBtn').classList.remove('active');
        toast('Highlighter mode');
    });
    
    document.getElementById('eraserBtn')?.addEventListener('click', () => {
        isErasing = true;
        isHighlighting = false;
        document.getElementById('eraserBtn').classList.add('active');
        document.getElementById('drawBtn').classList.remove('active');
        document.getElementById('highlighterBtn').classList.remove('active');
        toast('Eraser mode');
    });
    
    document.getElementById('clearBtn')?.addEventListener('click', () => {
        redrawCanvas();
        if (socket) socket.emit('clear-drawings');
        toast('Board cleared');
    });
    
    document.getElementById('uploadPdfBtn')?.addEventListener('click', () => document.getElementById('pdfFile').click());
    document.getElementById('pdfFile')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            await loadPDFFromData(ev.target.result);
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('removePdfBtn')?.addEventListener('click', clearPDF);
    document.getElementById('prevPdfBtn')?.addEventListener('click', prevPage);
    document.getElementById('nextPdfBtn')?.addEventListener('click', nextPage);
    document.getElementById('copyCodeBtn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoomId);
        toast('Room code copied!');
    });
}

// ============ CHAT ============
function addMessageToChat(msg) {
    const chatContainer = document.getElementById('chatMessages');
    if (!chatContainer) return;
    
    const div = document.createElement('div');
    div.className = `message ${msg.userId === socket?.id ? 'own' : ''}`;
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<div class="message-name">${msg.userName} <span class="message-time">${time}</span></div>${msg.message}`;
    chatContainer.appendChild(div);
    div.scrollIntoView();
}

function addSystemMessageToChat(msg) {
    const chatContainer = document.getElementById('chatMessages');
    if (!chatContainer) return;
    
    const div = document.createElement('div');
    div.style.cssText = 'background:#fef5e7; color:#d69e2e; padding:8px; border-radius:12px; text-align:center; margin:8px 0;';
    div.innerHTML = msg;
    chatContainer.appendChild(div);
    div.scrollIntoView();
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    if (!socket || !socket.connected) {
        toast('Not connected to server');
        return;
    }
    socket.emit('chat-message', msg);
    input.value = '';
}

const sendChatBtn = document.getElementById('sendChatBtn');
const chatInputField = document.getElementById('chatInput');
if (sendChatBtn) sendChatBtn.onclick = sendChatMessage;
if (chatInputField) chatInputField.onkeypress = (e) => { if (e.key === 'Enter') sendChatMessage(); };

// ============ TIMER ============
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - sessionStartTime;
        const remaining = 3 * 60 * 60 * 1000 - elapsed;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            document.getElementById('timerDisplay').textContent = '0:00:00';
            toast('Session ended!');
            setTimeout(() => location.reload(), 3000);
            return;
        }
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        document.getElementById('timerDisplay').textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

// ============ SOCKET ============
function initSocket() {
    socket = io({
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
    socket.on('connect', () => {
        console.log('Socket connected');
        socket.emit('login', currentUser);
        startHeartbeat();
    });
    
    socket.on('disconnect', () => {
        console.log('Socket disconnected');
        toast('Connection lost, reconnecting...');
    });
    
    socket.on('reconnect', () => {
        console.log('Socket reconnected');
        toast('Reconnected!');
        if (currentRoomId) {
            socket.emit('join-room', currentRoomId);
        }
    });
    
    socket.on('heartbeat', () => {
        console.log('Heartbeat received');
    });
    
    socket.on('room-created', (data) => {
        currentRoomId = data.roomId;
        document.getElementById('roomIdDisplay').textContent = data.roomId;
        sessionStartTime = Date.now();
        startTimer();
        showPage('board');
        initCanvas();
        setupTools();
        setupCalculator();
        initCollapse();
        initMobile();
        initMobileChatToggle();
        toast(`Room created: ${data.roomId}`);
    });
    
    socket.on('room-joined', (data) => {
        currentRoomId = data.roomId;
        document.getElementById('roomIdDisplay').textContent = data.roomId;
        sessionStartTime = Date.now();
        startTimer();
        showPage('board');
        initCanvas();
        setupTools();
        setupCalculator();
        initCollapse();
        initMobile();
        initMobileChatToggle();
        if (data.drawings) data.drawings.forEach(d => drawRemote(d));
        if (data.messages) data.messages.forEach(m => addMessageToChat(m));
        if (data.currentPdf) loadPDFFromData(data.currentPdf);
        const countEl = document.getElementById('chatParticipantCount');
        if (countEl) countEl.textContent = data.participantsCount || 1;
        toast(`Joined room: ${data.roomId}`);
    });
    
    socket.on('draw', drawRemote);
    socket.on('clear-drawings', () => redrawCanvas());
    socket.on('chat-message', (msg) => addMessageToChat(msg));
    socket.on('user-joined', (u) => {
        addSystemMessageToChat(`${u.name} joined`);
        const countEl = document.getElementById('chatParticipantCount');
        if (countEl) {
            let count = parseInt(countEl.textContent) || 1;
            countEl.textContent = count + 1;
        }
    });
    socket.on('user-left', () => {
        addSystemMessageToChat(`User left`);
        const countEl = document.getElementById('chatParticipantCount');
        if (countEl) {
            let count = parseInt(countEl.textContent) || 2;
            countEl.textContent = Math.max(1, count - 1);
        }
    });
    socket.on('pdf-loaded', ({ pdfData }) => loadPDFFromData(pdfData));
    socket.on('pdf-cleared', clearPDF);
    socket.on('pdf-page-change', ({ pageNum }) => {
        if (pdfDoc && pageNum !== currentPage) {
            currentPage = pageNum;
            renderPDFPage();
        }
    });
    socket.on('error', (e) => toast(e));
}

// ============ MOBILE ============
let sidebarOpen = false, chatOpen = false;
function initMobile() {
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const chatPanel = document.getElementById('chatPanel');
    if (menuBtn) {
        menuBtn.onclick = () => {
            sidebarOpen = !sidebarOpen;
            sidebar.classList.toggle('mobile-open', sidebarOpen);
            if (sidebarOpen && chatOpen) { chatPanel.classList.remove('mobile-open'); chatOpen = false; }
        };
    }
    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
        chatHeader.onclick = () => {
            chatOpen = !chatOpen;
            chatPanel.classList.toggle('mobile-open', chatOpen);
            if (chatOpen && sidebarOpen) { sidebar.classList.remove('mobile-open'); sidebarOpen = false; }
        };
    }
}

function initMobileChatToggle() {
    const mobileChatToggle = document.getElementById('mobileChatToggle');
    const chatPanel = document.getElementById('chatPanel');
    
    if (!mobileChatToggle) return;
    
    if (window.innerWidth <= 768) {
        mobileChatToggle.style.display = 'flex';
        mobileChatToggle.classList.remove('hidden');
        
        const newToggle = mobileChatToggle.cloneNode(true);
        mobileChatToggle.parentNode.replaceChild(newToggle, mobileChatToggle);
        const freshToggle = document.getElementById('mobileChatToggle');
        
        freshToggle.onclick = (e) => {
            e.stopPropagation();
            chatPanel.classList.toggle('mobile-open');
            if (chatPanel.classList.contains('mobile-open')) {
                freshToggle.classList.add('hidden');
            } else {
                freshToggle.classList.remove('hidden');
            }
        };
        
        const closeChatHandler = (e) => {
            if (chatPanel.classList.contains('mobile-open')) {
                if (!chatPanel.contains(e.target) && e.target !== freshToggle) {
                    chatPanel.classList.remove('mobile-open');
                    freshToggle.classList.remove('hidden');
                }
            }
        };
        
        document.removeEventListener('click', closeChatHandler);
        document.addEventListener('click', closeChatHandler);
        
        const leaveBtn = document.getElementById('leaveBtn');
        if (leaveBtn) {
            leaveBtn.onclick = () => {
                chatPanel.classList.remove('mobile-open');
                if (freshToggle) freshToggle.classList.remove('hidden');
                location.reload();
            };
        }
    } else {
        mobileChatToggle.style.display = 'none';
    }
}

window.addEventListener('resize', () => {
    initMobileChatToggle();
    if (pdfDoc) {
        setTimeout(() => renderPDFPage(), 100);
    }
});

// Initialize
initMobile();
setupCalculator();
console.log('MathsBoard Pro - Complete version ready');