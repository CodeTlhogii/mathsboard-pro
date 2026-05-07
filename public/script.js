pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let socket, currentUser, currentRoomId;
let canvas, ctx, drawing = false, lastX, lastY;
let currentColor = '#ff0000', currentSize = 5, isErasing = false;

// PDF variables
let pdfDoc = null, currentPage = 1, totalPages = 0, pdfImageData = null;
let pdfControls = document.getElementById('pdf-controls');
let pageIndicator = document.getElementById('page-indicator');

// Calculator variables
let calcExpression = '';
let calcDisplay = document.getElementById('calc-display');

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

function showScreen(id) {
    ['login-screen', 'join-screen', 'board-screen'].forEach(s => document.getElementById(s).classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ============ CANVAS DRAWING ============
function initCanvas() {
    const canvasEl = document.getElementById('whiteboard');
    const rect = canvasEl.parentElement;
    canvasEl.width = rect.clientWidth;
    canvasEl.height = rect.clientHeight;
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function getCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let cx, cy;
        if (e.touches) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
    }

    function start(e) {
        e.preventDefault();
        drawing = true;
        const pos = getCoords(e);
        lastX = pos.x; lastY = pos.y;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
    }

    function draw(e) {
        if (!drawing) return;
        e.preventDefault();
        const pos = getCoords(e);
        ctx.strokeStyle = isErasing ? '#fff' : currentColor;
        ctx.lineWidth = currentSize;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        socket?.emit('draw', { fromX: lastX, fromY: lastY, toX: pos.x, toY: pos.y, color: isErasing ? '#fff' : currentColor, size: currentSize });
        lastX = pos.x; lastY = pos.y;
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

function drawRemote(data) {
    ctx.beginPath();
    ctx.moveTo(data.fromX, data.fromY);
    ctx.lineTo(data.toX, data.toY);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.stroke();
}

function clearCanvas() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (pdfImageData) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = pdfImageData;
    }
}

// ============ PDF FUNCTIONS ============
async function loadPDF(dataURL) {
    showToast('Loading PDF...');
    try {
        let base64 = dataURL.includes(',') ? dataURL.split(',')[1] : dataURL;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;
        pdfControls.style.display = 'block';
        pageIndicator.textContent = `Page 1 / ${totalPages}`;
        await renderPDFPage();
        showToast(`PDF loaded: ${totalPages} pages`);
    } catch(e) { showToast('PDF load failed', 'error'); }
}

async function renderPDFPage() {
    const page = await pdfDoc.getPage(currentPage);
    const scale = Math.min(canvas.width / page.getViewport({ scale: 1 }).width, canvas.height / page.getViewport({ scale: 1 }).height);
    const viewport = page.getViewport({ scale: scale });
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewport.width;
    tempCanvas.height = viewport.height;
    await page.render({ canvasContext: tempCanvas.getContext('2d'), viewport }).promise;
    
    pdfImageData = tempCanvas.toDataURL();
    const img = new Image();
    img.onload = () => {
        const x = (canvas.width - img.width) / 2;
        const y = (canvas.height - img.height) / 2;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y);
    };
    img.src = pdfImageData;
    pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;
}

function nextPage() { if (currentPage < totalPages) { currentPage++; renderPDFPage(); socket?.emit('pdf-page-change', { pageNum: currentPage }); } }
function prevPage() { if (currentPage > 1) { currentPage--; renderPDFPage(); socket?.emit('pdf-page-change', { pageNum: currentPage }); } }

// ============ CALCULATOR ============
function evaluateExpression(expr) {
    try {
        let processed = expr.replace(/π/g, 'Math.PI').replace(/e(?![a-z])/g, 'Math.E')
            .replace(/sin\(/g, 'Math.sin(').replace(/cos\(/g, 'Math.cos(').replace(/tan\(/g, 'Math.tan(')
            .replace(/sqrt\(/g, 'Math.sqrt(').replace(/log\(/g, 'Math.log10(').replace(/ln\(/g, 'Math.log(')
            .replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
        const result = Function('"use strict";return (' + processed + ')')();
        return isNaN(result) ? 'Error' : result;
    } catch(e) { return 'Error'; }
}

function updateCalcDisplay() { calcDisplay.textContent = calcExpression || '0'; }

function setupCalculator() {
    document.querySelectorAll('.calc-btn[data-num]').forEach(btn => {
        btn.onclick = () => { calcExpression += btn.dataset.num; updateCalcDisplay(); };
    });
    document.querySelectorAll('.calc-btn[data-op]').forEach(btn => {
        btn.onclick = () => { calcExpression += btn.dataset.op; updateCalcDisplay(); };
    });
    document.querySelectorAll('.calc-btn[data-dot]').forEach(btn => {
        btn.onclick = () => { calcExpression += '.'; updateCalcDisplay(); };
    });
    document.querySelector('.calc-btn[data-action="clear"]').onclick = () => { calcExpression = ''; updateCalcDisplay(); };
    document.querySelector('.calc-btn[data-action="del"]').onclick = () => { calcExpression = calcExpression.slice(0, -1); updateCalcDisplay(); };
    document.querySelector('.calc-btn[data-action="equals"]').onclick = () => {
        const result = evaluateExpression(calcExpression);
        calcExpression = result.toString();
        updateCalcDisplay();
        showToast(`Result: ${result}`);
    };
    document.querySelectorAll('.calc-btn[data-func]').forEach(btn => {
        btn.onclick = () => {
            const func = btn.dataset.func;
            if (func === 'pi') calcExpression += 'π';
            else if (func === 'e') calcExpression += 'e';
            else if (func === 'sqrt') calcExpression += 'sqrt(';
            else calcExpression += `${func}(`;
            updateCalcDisplay();
        };
    });
    document.getElementById('calc-copy').onclick = () => {
        if (calcExpression && calcExpression !== '0') {
            const result = evaluateExpression(calcExpression);
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            ctx.font = '24px Arial';
            ctx.fillStyle = '#000';
            ctx.fillText(result.toString(), centerX, centerY);
            showToast(`Copied: ${result}`);
        }
    };
}

// ============ TOOLS ============
function setupTools() {
    document.querySelectorAll('.color').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
            currentColor = el.dataset.color;
            isErasing = false;
            document.getElementById('draw-mode').classList.add('active');
            document.getElementById('eraser-mode').classList.remove('active');
        };
    });
    document.querySelectorAll('.color')[0].classList.add('active');

    const sizeSlider = document.getElementById('brush-size');
    sizeSlider.oninput = (e) => { currentSize = parseInt(e.target.value); document.getElementById('size-display').textContent = `Size: ${currentSize}px`; };
    
    document.getElementById('draw-mode').onclick = () => { isErasing = false; document.getElementById('draw-mode').classList.add('active'); document.getElementById('eraser-mode').classList.remove('active'); showToast('Draw mode'); };
    document.getElementById('eraser-mode').onclick = () => { isErasing = true; document.getElementById('eraser-mode').classList.add('active'); document.getElementById('draw-mode').classList.remove('active'); showToast('Eraser mode'); };
    document.getElementById('clear-canvas').onclick = () => { clearCanvas(); socket?.emit('clear-drawings'); showToast('Board cleared'); };
    
    // PDF upload
    document.getElementById('pdf-upload-btn').onclick = () => document.getElementById('pdf-upload').click();
    document.getElementById('pdf-upload').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const data = ev.target.result;
            await loadPDF(data);
            socket?.emit('pdf-loaded', { pdfData: data });
        };
        reader.readAsDataURL(file);
    };
    document.getElementById('clear-pdf').onclick = () => {
        pdfDoc = null; pdfImageData = null;
        pdfControls.style.display = 'none';
        clearCanvas();
        socket?.emit('pdf-cleared');
        showToast('PDF removed');
    };
    document.getElementById('pdf-prev').onclick = prevPage;
    document.getElementById('pdf-next').onclick = nextPage;
    
    // Copy room code
    document.getElementById('copy-room-btn').onclick = () => {
        navigator.clipboard.writeText(currentRoomId);
        showToast('Room code copied!');
    };
}

// ============ CHAT ============
function linkify(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}

function addMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.userId === socket?.id ? 'own' : ''}`;
    const time = new Date(msg.timestamp).toLocaleTimeString();
    div.innerHTML = `<div class="message-name">${escapeHtml(msg.userName)} <span class="message-time">${time}</span></div>${linkify(escapeHtml(msg.message))}`;
    document.getElementById('chat-messages').appendChild(div);
    div.scrollIntoView();
}

function addSystemMessage(msg) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = msg;
    document.getElementById('chat-messages').appendChild(div);
    div.scrollIntoView();
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

// ============ SOCKET ============
function initSocket() {
    socket = io();
    socket.on('connect', () => socket.emit('login', currentUser));
    socket.on('room-created', (data) => { 
        currentRoomId = data.roomId; 
        document.getElementById('room-id').textContent = data.roomId; 
        showScreen('board-screen'); 
        initCanvas(); 
        setupTools(); 
        setupCalculator();
        showToast(`Room created: ${data.roomId}`);
        addSystemMessage(`Room code: ${data.roomId} - Share this with others to join`);
    });
    socket.on('room-joined', (data) => { 
        currentRoomId = data.roomId; 
        document.getElementById('room-id').textContent = data.roomId; 
        showScreen('board-screen'); 
        initCanvas(); 
        setupTools();
        setupCalculator();
        data.drawings.forEach(d => drawRemote(d)); 
        data.messages.forEach(m => addMessage(m)); 
        showToast(`Joined room: ${data.roomId}`);
        addSystemMessage(`You joined room ${data.roomId}`);
    });
    socket.on('draw', (d) => drawRemote(d));
    socket.on('clear-drawings', () => clearCanvas());
    socket.on('chat-message', (m) => addMessage(m));
    socket.on('user-joined', (u) => addSystemMessage(`${u.name} joined the session`));
    socket.on('user-left', () => addSystemMessage(`User left the session`));
    socket.on('pdf-loaded', (d) => loadPDF(d.pdfData));
    socket.on('pdf-cleared', () => { pdfDoc = null; pdfImageData = null; pdfControls.style.display = 'none'; clearCanvas(); showToast('PDF removed by tutor'); });
    socket.on('pdf-page-change', (d) => { if (pdfDoc && d.pageNum !== currentPage) { currentPage = d.pageNum; renderPDFPage(); } });
    socket.on('error', (e) => showToast(e));
}

// ============ AUTH ============
document.getElementById('login-tab').onclick = () => {
    document.getElementById('login-tab').classList.add('active');
    document.getElementById('register-tab').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
};
document.getElementById('register-tab').onclick = () => {
    document.getElementById('register-tab').classList.add('active');
    document.getElementById('login-tab').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
    document.getElementById('login-form').classList.remove('active');
};
document.getElementById('do-login').onclick = async () => {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value }) });
    const data = await res.json();
    if (data.success) { currentUser = data.user; document.getElementById('user-avatar').src = currentUser.avatar; document.getElementById('user-name').textContent = currentUser.name; initSocket(); showScreen('join-screen'); showToast(`Welcome, ${currentUser.name}!`); }
    else showToast(data.error);
};
document.getElementById('do-register').onclick = async () => {
    if (document.getElementById('reg-password').value !== document.getElementById('reg-confirm').value) return showToast('Passwords mismatch');
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('reg-username').value, password: document.getElementById('reg-password').value, name: document.getElementById('reg-name').value }) });
    const data = await res.json();
    if (data.success) { showToast('Registered! Please login'); document.getElementById('login-tab').click(); }
    else showToast(data.error);
};
document.getElementById('logout-btn').onclick = () => location.reload();
document.getElementById('leave-btn').onclick = () => location.reload();
document.getElementById('create-btn').onclick = () => { if (!socket) initSocket(); setTimeout(() => socket.emit('create-room'), 500); };
document.getElementById('join-btn').onclick = () => { const code = document.getElementById('room-code-input').value; if (!code) return showToast('Enter room code'); if (!socket) initSocket(); setTimeout(() => socket.emit('join-room', code), 500); };
document.getElementById('send-chat').onclick = () => { const input = document.getElementById('chat-input'); const msg = input.value.trim(); if (msg) { socket.emit('chat-message', msg); input.value = ''; } };
document.getElementById('chat-input').onkeypress = (e) => { if (e.key === 'Enter') document.getElementById('send-chat').click(); };