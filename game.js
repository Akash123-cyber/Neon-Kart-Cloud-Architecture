const loadingScreen = document.getElementById('loading-screen');
const mainMenu = document.getElementById('main-menu');
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const hud = document.getElementById('hud');

// UI Menus
const soloModal = document.getElementById('solo-setup-modal');
const createModal = document.getElementById('create-setup-modal');
const joinModal = document.getElementById('join-modal');
const lobbyModal = document.getElementById('lobby-modal');
const settingsModal = document.getElementById('settings-modal');
const ingameMenu = document.getElementById('ingame-menu');
const matchEndScreen = document.getElementById('match-end-screen');

// Auth State
let username = localStorage.getItem('nk_username');
let wins = parseInt(localStorage.getItem('nk_wins')) || 0;
let matches = parseInt(localStorage.getItem('nk_matches')) || 0;
let highScore = parseInt(localStorage.getItem('nk_highscore')) || 0;
let isGuest = !username;

if (isGuest) username = 'Guest_' + Math.floor(Math.random() * 10000);
document.getElementById('guest-name').innerText = username;
document.getElementById('stats-wins').innerText = wins;
document.getElementById('stats-matches').innerText = matches;
document.getElementById('stats-highscore').innerText = highScore;
if(!isGuest) {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('logged-in-section').style.display = 'block';
    document.getElementById('account-username').innerText = username;
}

const SoundManager = (() => {
    let audioCtx = null;
    let globalGain = null;

    const init = () => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            globalGain = audioCtx.createGain();
            globalGain.connect(audioCtx.destination);
            globalGain.gain.value = 0.3;
            
            const volumeSlider = document.querySelector('input[type="range"]');
            if (volumeSlider) {
                volumeSlider.addEventListener('input', (e) => {
                    globalGain.gain.value = e.target.value / 100;
                });
            }
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
    };

    const playTone = (freq, type, duration, vol=1) => {
        init();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain); gain.connect(globalGain);
        osc.start(); osc.stop(audioCtx.currentTime + duration);
    };

    return {
        init,
        shoot: () => {
            init();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(400, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
            osc.connect(gain); gain.connect(globalGain);
            osc.start(); osc.stop(audioCtx.currentTime + 0.15);
        },
        hit: () => playTone(150, 'square', 0.1, 0.2),
        takeDamage: () => playTone(80, 'sawtooth', 0.25, 0.4),
        buttonClick: () => playTone(800, 'sine', 0.05, 0.1),
        matchWon: () => { playTone(400, 'sine', 0.2, 0.3); setTimeout(()=>playTone(600, 'sine', 0.4, 0.3), 200); },
        matchLost: () => { playTone(200, 'sawtooth', 0.4, 0.3); setTimeout(()=>playTone(100, 'sawtooth', 0.6, 0.3), 400); }
    };
})();

document.getElementById('stats-info-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('stats-tooltip').classList.toggle('active');
});

document.addEventListener('click', (e) => {
    if (e.target.tagName.toLowerCase() === 'button') SoundManager.buttonClick();
    if (e.target.id !== 'stats-info-btn') {
        const tooltip = document.getElementById('stats-tooltip');
        if(tooltip) tooltip.classList.remove('active');
    }
});

// Load Simulation
let loadProgress = 0;
const loadInterval = setInterval(() => {
    loadProgress += 20;
    document.getElementById('loading-bar').style.width = loadProgress + '%';
    if (loadProgress >= 100) {
        clearInterval(loadInterval);
        setTimeout(() => { loadingScreen.classList.remove('active'); mainMenu.classList.add('active'); }, 200);
    }
}, 100);

// Generic Buttons
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('.modal-overlay').classList.remove('active'));
});

// Settings & Auth UI
document.getElementById('open-login-btn').addEventListener('click', () => { settingsModal.classList.add('active'); document.querySelector('[data-tab="account-tab"]').click(); });
document.getElementById('main-settings-btn').addEventListener('click', () => settingsModal.classList.add('active'));
document.getElementById('hud-ingame-settings-btn').addEventListener('click', () => ingameMenu.classList.add('active'));
document.getElementById('resume-btn').addEventListener('click', () => ingameMenu.classList.remove('active'));
document.getElementById('exit-game-btn').addEventListener('click', () => {
    if (playMode === 'SOLO' && playerState) {
        if (playerState.score > highScore) {
            highScore = playerState.score;
            localStorage.setItem('nk_highscore', highScore);
            if(!isGuest) fetch('/api/score', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, score: highScore}) });
        }
    }
    window.location.reload();
});
document.getElementById('return-menu-end-btn').addEventListener('click', () => window.location.reload());

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.tab).classList.add('active');
    });
});

async function handleAuth(type) {
    const userIn = document.getElementById('auth-username').value.trim();
    const passIn = document.getElementById('auth-password').value.trim();
    if (!userIn || !passIn) return;
    try {
        const res = await fetch(`/api/${type}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: userIn, password: passIn}) });
        const data = await res.json();
        if(res.ok) {
            localStorage.setItem('nk_username', userIn);
            localStorage.setItem('nk_wins', data.wins); 
            localStorage.setItem('nk_matches', data.matches_played);
            localStorage.setItem('nk_highscore', data.high_score);
            window.location.reload();
        } else {
            document.getElementById('auth-error').innerText = data.error;
        }
    } catch(e) {}
}
document.getElementById('auth-login-btn').addEventListener('click', () => handleAuth('login'));
document.getElementById('auth-signup-btn').addEventListener('click', () => handleAuth('signup'));
document.getElementById('auth-logout-btn').addEventListener('click', () => { localStorage.clear(); window.location.reload(); });

// Networking / State
let socket;
let playMode = 'NONE';
let playerState = null;
let otherPlayers = {};
let projectiles = [];
let npcs = [];
let gameTheme = 'neon';
let gameTimeRemaining = 0;
let lastTime = 0;

const textures = { jungle: new Image(), desert: new Image(), snow: new Image() };
textures.jungle.src = 'img/jungle.png'; textures.desert.src = 'img/desert.png'; textures.snow.src = 'img/snow.png';

function resizeCanvas() { gameCanvas.width = window.innerWidth; gameCanvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

const MAP_SIZE = 3000;

// Setup Modals
document.getElementById('solo-play-btn').addEventListener('click', () => soloModal.classList.add('active'));
document.getElementById('open-create-btn').addEventListener('click', () => createModal.classList.add('active'));
document.getElementById('open-join-btn').addEventListener('click', () => joinModal.classList.add('active'));

// START SOLO
document.getElementById('start-solo-btn').addEventListener('click', () => {
    soloModal.classList.remove('active'); mainMenu.classList.remove('active');
    playMode = 'SOLO'; gameTheme = document.getElementById('solo-theme').value;
    gameTimeRemaining = parseInt(document.getElementById('solo-duration').value) * 60;
    const diff = document.getElementById('solo-difficulty').value;
    
    playerState = { id: 'local', username: username, x: MAP_SIZE/2, y: MAP_SIZE/2, angle: 0, color: '#00ff00', health: 1000, maxHealth: 1000, lives: 3, isAlive: true, score: 0 };
    
    const npcCount = diff === 'easy' ? 3 : (diff === 'medium' ? 5 : 8);
    for(let i=0; i<npcCount; i++) spawnNPC();
    
    startGameUI();
});

class NPC {
    constructor() {
        this.id = 'npc_'+Math.random(); this.username = 'Bot_' + Math.floor(Math.random()*100);
        this.x = Math.random() * MAP_SIZE; this.y = Math.random() * MAP_SIZE; this.angle = 0;
        this.health = 50; this.maxHealth = 50; this.isAlive = true; this.color = '#dc3545';
        this.lastShot = 0; this.score = 0;
    }
    update(dt) {
        if(!this.isAlive || !playerState.isAlive) return;
        const dist = Math.hypot(playerState.x - this.x, playerState.y - this.y);
        let desiredAngle = Math.atan2(playerState.y - this.y, playerState.x - this.x);
        this.angle = desiredAngle;
        
        if(dist > 200) {
            this.x += Math.cos(this.angle) * 5 * (dt/16);
            this.y += Math.sin(this.angle) * 5 * (dt/16);
        }
        
        if(dist < 400 && Date.now() - this.lastShot > 1000) {
            const px = this.x + Math.cos(this.angle) * 40; const py = this.y + Math.sin(this.angle) * 40;
            projectiles.push({ x: px, y: py, angle: this.angle, speed: 10, color: this.color, ownerId: this.id, damage: 20, radius: 5, life: 1000 });
            this.lastShot = Date.now();
        }
    }
}
function spawnNPC() { npcs.push(new NPC()); }

// START PVP
document.getElementById('start-create-btn').addEventListener('click', () => {
    createModal.classList.remove('active');
    if(!socket) socket = io();
    socket.emit('createRoom', {
        username, theme: document.getElementById('pvp-theme').value,
        duration: document.getElementById('pvp-duration').value,
        maxPlayers: document.getElementById('pvp-max-players').value
    });
    lobbyModal.classList.add('active');
    socket.on('roomCreated', (code) => document.getElementById('room-code-display').innerText = code);
    setupSocketListeners();
});

document.getElementById('copy-code-btn').addEventListener('click', () => {
    const code = document.getElementById('room-code-display').innerText;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code);
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
    }
    document.getElementById('copy-code-btn').innerText = "Copied!";
    setTimeout(() => { document.getElementById('copy-code-btn').innerText = "Copy"; }, 2000);
});

document.getElementById('submit-join-btn').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if(code) {
        if(!socket) socket = io();
        socket.emit('joinRoom', { roomId: code, username });
        setupSocketListeners();
    }
});

function setupSocketListeners() {
    socket.on('lobbyUpdate', (data) => {
        document.getElementById('lobby-count').innerText = data.count;
        document.getElementById('lobby-max').innerText = data.max;
        if(data.count >= 2) document.getElementById('lobby-status').innerText = "Game is starting...";
    });
    socket.on('gameStarted', (data) => {
        lobbyModal.classList.remove('active'); joinModal.classList.remove('active'); mainMenu.classList.remove('active');
        playMode = 'PVP'; gameTheme = data.theme; gameTimeRemaining = data.timeRemaining;
        playerState = data.players[socket.id];
        otherPlayers = data.players;
        startGameUI();
    });
    socket.on('stateUpdate', (players) => {
        otherPlayers = players;
        if(playerState && players[playerState.id]) {
            if (players[playerState.id].health < playerState.health) SoundManager.takeDamage();
            playerState.health = players[playerState.id].health;
            playerState.lives = players[playerState.id].lives;
            playerState.isAlive = players[playerState.id].isAlive;
            playerState.score = players[playerState.id].score;
        }
        updateScoreboard();
    });
    socket.on('projectileSpawned', (p) => { p.life = 1000; projectiles.push(p); });
    socket.on('playerRespawned', (id) => { if(id === playerState.id) { playerState.x = otherPlayers[id].x; playerState.y = otherPlayers[id].y; }});
    socket.on('playerEliminated', (leaderboard) => {
        triggerMatchEnd(leaderboard, false, "WASTED", "#dc3545");
        setTimeout(() => window.location.reload(), 3000);
    });
    socket.on('matchWon', (leaderboard) => {
        triggerMatchEnd(leaderboard, true, "VICTORY!", "#4caf50");
        setTimeout(() => window.location.reload(), 3000);
    });
    socket.on('matchEnded', (leaderboard) => {
        triggerMatchEnd(leaderboard, false, "MATCH FINISHED", "#ffeb3b");
    });
    socket.on('roomError', (msg) => document.getElementById('join-error').innerText = msg);
}

function startGameUI() {
    gameCanvas.style.display = 'block'; hud.classList.add('active');
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    setInterval(() => { if(gameTimeRemaining > 0) gameTimeRemaining--; }, 1000);
}

function updateScoreboard() {
    const list = document.getElementById('score-list');
    list.innerHTML = '';
    let arr = playMode === 'PVP' ? Object.values(otherPlayers) : [playerState];
    arr.sort((a,b) => b.score - a.score).forEach(p => {
        const li = document.createElement('li');
        li.innerText = `${p.username}: ${p.score}`;
        list.appendChild(li);
    });
    
    document.getElementById('health-bar-fill').style.width = Math.max(0, (playerState.health / playerState.maxHealth) * 100) + '%';
    document.getElementById('lives-display').innerText = `Lives: ${playerState.lives}`;
    const m = Math.floor(gameTimeRemaining / 60); const s = gameTimeRemaining % 60;
    document.getElementById('timer-display').innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
}

let lastShot = 0;

function updateState(dt) {
    if(!playerState || !playerState.isAlive) return;
    
    let vx = 0; let vy = 0;
    if (keys['KeyW'] || keys['ArrowUp']) { vx += Math.cos(playerState.angle) * 10; vy += Math.sin(playerState.angle) * 10; }
    if (keys['KeyS'] || keys['ArrowDown']) { vx -= Math.cos(playerState.angle) * 5; vy -= Math.sin(playerState.angle) * 5; }
    if (vx!==0 || vy!==0) {
        if (keys['KeyA'] || keys['ArrowLeft']) playerState.angle -= 0.08;
        if (keys['KeyD'] || keys['ArrowRight']) playerState.angle += 0.08;
    }
    
    playerState.x = Math.max(30, Math.min(MAP_SIZE-30, playerState.x + vx*(dt/16)));
    playerState.y = Math.max(30, Math.min(MAP_SIZE-30, playerState.y + vy*(dt/16)));
    
    if (playMode === 'PVP' && socket) socket.emit('playerUpdate', { x: playerState.x, y: playerState.y, angle: playerState.angle });

    if (keys['Space'] && Date.now() - lastShot > 300) {
        const px = playerState.x + Math.cos(playerState.angle) * 40; const py = playerState.y + Math.sin(playerState.angle) * 40;
        const p = { x: px, y: py, angle: playerState.angle, speed: 18, color: playerState.color, ownerId: playerState.id, damage: 50, radius: 8, life: 1000 };
        projectiles.push(p);
        SoundManager.shoot();
        if(playMode === 'PVP') socket.emit('shoot', p);
        lastShot = Date.now();
    }

    if(playMode === 'SOLO') {
        npcs.forEach(n => n.update(dt));
        if(gameTimeRemaining <= 0) {
            const lb = [playerState, ...npcs].sort((a,b)=>b.score - a.score).map(p=>({username: p.username, score: p.score}));
            triggerMatchEnd(lb);
            playMode = 'ENDED';
        }
        updateScoreboard();
    }

    for(let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.x += Math.cos(p.angle) * p.speed * (dt/16); p.y += Math.sin(p.angle) * p.speed * (dt/16);
        p.life -= dt;
        if (p.life <= 0) { projectiles.splice(i, 1); continue; }

        if (playMode === 'PVP') {
            if (p.ownerId === playerState.id) {
                for (let id in otherPlayers) {
                    let op = otherPlayers[id];
                    if (id !== playerState.id && op.isAlive && Math.hypot(p.x - op.x, p.y - op.y) < p.radius + 30) {
                        socket.emit('hitOpponent', { damage: p.damage, victimId: id });
                        SoundManager.hit();
                        projectiles.splice(i, 1); break;
                    }
                }
            } else if (playerState.isAlive && Math.hypot(p.x - playerState.x, p.y - playerState.y) < p.radius + 30) projectiles.splice(i, 1);
        } else if (playMode === 'SOLO') {
            if(p.ownerId === playerState.id) {
                npcs.forEach(n => {
                    if(n.isAlive && Math.hypot(p.x - n.x, p.y - n.y) < p.radius + 30) {
                        n.health -= p.damage; projectiles.splice(i, 1);
                        SoundManager.hit();
                        if(n.health <= 0) { n.isAlive = false; playerState.score++; setTimeout(()=> { n.health=n.maxHealth; n.isAlive=true; n.x=Math.random()*MAP_SIZE; n.y=Math.random()*MAP_SIZE; }, 2000); }
                    }
                });
            } else if(playerState.isAlive && Math.hypot(p.x - playerState.x, p.y - playerState.y) < p.radius + 30) {
                playerState.health -= p.damage; projectiles.splice(i, 1);
                SoundManager.takeDamage();
                if(playerState.health <= 0) {
                    playerState.lives--;
                    if(playerState.lives > 0) { playerState.health = playerState.maxHealth; playerState.x = MAP_SIZE/2; playerState.y = MAP_SIZE/2; }
                    else { playerState.isAlive = false; }
                }
            }
        }
    }
}

function triggerMatchEnd(leaderboard, isWinOverride, title, color) {
    hud.classList.remove('active'); gameCanvas.style.display = 'none';
    matchEndScreen.classList.add('active');
    
    let isWin = isWinOverride !== undefined ? isWinOverride : (leaderboard[0].username === username);
    if(isWin) SoundManager.matchWon(); else SoundManager.matchLost();
    
    document.getElementById('end-title').innerText = title || (isWin ? "VICTORY!" : "MATCH FINISHED");
    document.getElementById('end-title').style.color = color || (isWin ? "#4caf50" : "#ffeb3b");
    document.getElementById('mvp-display').innerText = "MVP: " + leaderboard[0].username;
    
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    leaderboard.forEach((p, i) => {
        list.innerHTML += `<p>#${i+1} ${p.username} - ${p.score} Kills ${p.isAlive === false ? '(Dead)' : ''}</p>`;
    });

    if (playMode === 'PVP') {
        matches++;
        if (isWin) wins++;
        localStorage.setItem('nk_wins', wins);
        localStorage.setItem('nk_matches', matches);
        if(!isGuest) fetch('/api/match_end', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, isWin}) });
    } else if (playMode === 'SOLO') {
        const myScore = leaderboard.find(p => p.username === username)?.score || 0;
        if (myScore > highScore) {
            highScore = myScore;
            localStorage.setItem('nk_highscore', highScore);
            if(!isGuest) fetch('/api/score', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, score: highScore}) });
        }
    }
}

function drawBackground() {
    if(gameTheme === 'neon') {
        ctx.fillStyle = '#3a75c4'; ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
        ctx.fillStyle = '#3266b0';
        for(let i=0; i<MAP_SIZE; i+=150) for(let j=0; j<MAP_SIZE; j+=150) if((i/150 + j/150) % 2 === 0) ctx.fillRect(i, j, 150, 150);
    } else {
        const img = textures[gameTheme];
        if(img.complete && img.naturalWidth) {
            ctx.fillStyle = ctx.createPattern(img, 'repeat');
            ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
        } else { ctx.fillStyle = '#555'; ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE); }
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
}

function drawKart(state, isLocal) {
    if (!state.isAlive) return;
    ctx.save(); ctx.translate(state.x, state.y); ctx.rotate(state.angle);
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.roundRect(-25, -20, 50, 40, 10); ctx.fill(); 
    ctx.fillStyle = state.color; ctx.beginPath(); ctx.roundRect(-15, -15, 30, 30, 8); ctx.fill();
    ctx.fillStyle = '#ffccaa'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(5, -4, 3, 0, Math.PI*2); ctx.arc(5, 4, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(-20, -25, 15, 8); ctx.fillRect(-20, 17, 15, 8); ctx.fillRect(15, -25, 15, 8); ctx.fillRect(15, 17, 15, 8);
    ctx.restore();

    if(!isLocal && playMode !== 'SOLO') {
        ctx.save(); ctx.translate(state.x, state.y);
        ctx.font = `bold 14px 'Nunito'`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.strokeText(state.username, 0, -45); ctx.fillText(state.username, 0, -45);
        ctx.fillStyle = '#000'; ctx.fillRect(-22, -38, 44, 8);
        ctx.fillStyle = '#f00'; ctx.fillRect(-20, -37, 40, 6);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -37, 40 * Math.max(0, state.health / state.maxHealth), 6);
        ctx.restore();
    } else if(playMode === 'SOLO' && state.id.startsWith('npc_')) {
        ctx.save(); ctx.translate(state.x, state.y);
        ctx.fillStyle = '#000'; ctx.fillRect(-22, -38, 44, 8);
        ctx.fillStyle = '#f00'; ctx.fillRect(-20, -37, 40, 6);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -37, 40 * Math.max(0, state.health / state.maxHealth), 6);
        ctx.restore();
    }
}

function drawState() {
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    if(!playerState) return;
    ctx.save();
    let camX = playerState.x - gameCanvas.width / 2; let camY = playerState.y - gameCanvas.height / 2;
    camX = Math.max(0, Math.min(MAP_SIZE - gameCanvas.width, camX)); camY = Math.max(0, Math.min(MAP_SIZE - gameCanvas.height, camY));
    ctx.translate(-camX, -camY);
    
    drawBackground();
    projectiles.forEach(p => { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); });
    
    if(playMode === 'PVP') for(let id in otherPlayers) { if(id !== playerState.id) drawKart(otherPlayers[id], false); }
    else npcs.forEach(n => drawKart(n, false));
    drawKart(playerState, true);
    ctx.restore();
}

function gameLoop(timestamp) {
    if(!hud.classList.contains('active')) return;
    const dt = timestamp - lastTime; lastTime = timestamp;
    if (dt < 100 && playMode !== 'ENDED') { updateState(dt); drawState(); }
    requestAnimationFrame(gameLoop);
}
