const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Prometheus Monitoring setup
const client = require('prom-client');
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const activePlayers = new client.Gauge({
  name: 'neon_kart_active_players',
  help: 'Number of currently connected players'
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.use(express.static(__dirname));
app.use(express.json());

// Database setup
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./users.db', (err) => {
    if (err) console.error(err.message);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        wins INTEGER DEFAULT 0,
        matches_played INTEGER DEFAULT 0,
        high_score INTEGER DEFAULT 0
    )`);
});

// Auth Routes
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({error: 'Username and password required'});
    bcrypt.hash(password, 10, (err, hash) => {
        if(err) return res.status(500).json({error: 'Server error'});
        db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err) {
            if(err) return res.status(400).json({error: 'Username already exists'});
            res.json({ success: true, wins: 0, matches_played: 0, high_score: 0 });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if(err || !row) return res.status(400).json({error: 'Invalid credentials'});
        bcrypt.compare(password, row.password_hash, (err, result) => {
            if(result) res.json({ success: true, wins: row.wins, matches_played: row.matches_played, high_score: row.high_score });
            else res.status(400).json({error: 'Invalid credentials'});
        });
    });
});

app.post('/api/match_end', (req, res) => {
    const { username, isWin } = req.body;
    if(!username) return res.json({ success: false });
    const winIncr = isWin ? 1 : 0;
    db.run('UPDATE users SET matches_played = matches_played + 1, wins = wins + ? WHERE username = ?', [winIncr, username], (err) => {
        res.json({ success: true });
    });
});

app.post('/api/score', (req, res) => {
    const { username, score } = req.body;
    if(!username) return res.json({ success: false });
    db.get('SELECT high_score FROM users WHERE username = ?', [username], (err, row) => {
        if(err || !row) return res.json({ success: false });
        if(score > row.high_score) {
            db.run('UPDATE users SET high_score = ? WHERE username = ?', [score, username], () => {
                res.json({ success: true, newHighScore: score });
            });
        } else {
            res.json({ success: true, newHighScore: row.high_score });
        }
    });
});

// Rooms State
const rooms = {};
const colors = ['#007bff', '#dc3545', '#ffc107', '#28a745', '#17a2b8', '#6f42c1'];

function generateRoomId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

function createPlayerState(id, username) {
    return {
        id: id, username: username,
        x: Math.random() * 2800 + 100, y: Math.random() * 2800 + 100, angle: 0,
        color: colors[Math.floor(Math.random() * colors.length)],
        health: 250, maxHealth: 250, lives: 3, isAlive: true, score: 0
    };
}

io.on('connection', (socket) => {
    activePlayers.inc();
    socket.roomId = null;

    socket.on('createRoom', ({ username, theme, duration, maxPlayers }) => {
        const roomId = generateRoomId();
        rooms[roomId] = {
            settings: { theme, duration: parseInt(duration), maxPlayers: parseInt(maxPlayers) },
            state: 'WAITING', players: {}, startTime: null
        };
        socket.join(roomId);
        socket.roomId = roomId;
        rooms[roomId].players[socket.id] = createPlayerState(socket.id, username);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('lobbyUpdate', { count: 1, max: rooms[roomId].settings.maxPlayers });
    });

    socket.on('joinRoom', (data) => {
        const { roomId, username } = data;
        const room = rooms[roomId];
        if(!room) { socket.emit('roomError', 'Room not found.'); return; }
        if(Object.keys(room.players).length >= room.settings.maxPlayers) { socket.emit('roomError', 'Room is full.'); return; }
        
        socket.join(roomId);
        socket.roomId = roomId;
        room.players[socket.id] = createPlayerState(socket.id, username);
        
        const count = Object.keys(room.players).length;
        io.to(roomId).emit('lobbyUpdate', { count: count, max: room.settings.maxPlayers });
        
        // If state is playing, drop them in. If waiting and count >= 2, start game.
        if (room.state === 'WAITING' && count >= 2) {
            room.state = 'PLAYING';
            room.startTime = Date.now();
            io.to(roomId).emit('gameStarted', {
                theme: room.settings.theme,
                timeRemaining: room.settings.duration * 60,
                players: room.players
            });
        } else if (room.state === 'PLAYING') {
            const timeElapsed = Math.floor((Date.now() - room.startTime)/1000);
            const timeRemaining = (room.settings.duration * 60) - timeElapsed;
            socket.emit('gameStarted', { theme: room.settings.theme, timeRemaining, players: room.players });
        } else {
            socket.emit('roomJoined', roomId);
        }
    });

    socket.on('disconnect', () => {
        activePlayers.dec();
        if(socket.roomId && rooms[socket.roomId]) {
            const r = rooms[socket.roomId];
            delete r.players[socket.id];
            
            if(Object.keys(r.players).length === 0) {
                delete rooms[socket.roomId];
            } else {
                io.to(socket.roomId).emit('lobbyUpdate', { count: Object.keys(r.players).length, max: r.settings.maxPlayers });
            }
        }
    });

    socket.on('playerUpdate', (data) => {
        if(socket.roomId && rooms[socket.roomId] && rooms[socket.roomId].players[socket.id]) {
            let p = rooms[socket.roomId].players[socket.id];
            if(p.isAlive) { p.x = data.x; p.y = data.y; p.angle = data.angle; }
        }
    });

    socket.on('shoot', (data) => {
        if(socket.roomId && rooms[socket.roomId] && rooms[socket.roomId].players[socket.id]) {
            socket.to(socket.roomId).emit('projectileSpawned', {
                x: data.x, y: data.y, angle: data.angle, speed: data.speed,
                color: rooms[socket.roomId].players[socket.id].color,
                ownerId: socket.id, damage: data.damage, radius: data.radius
            });
        }
    });

    socket.on('hitOpponent', (data) => {
        if(!socket.roomId || !rooms[socket.roomId]) return;
        const r = rooms[socket.roomId];
        const victim = r.players[data.victimId];
        if(!victim || !victim.isAlive) return;

        victim.health -= data.damage;
        if (victim.health <= 0) {
            victim.lives--;
            if(r.players[socket.id]) {
                r.players[socket.id].score++;
            }
            if (victim.lives > 0) {
                victim.health = victim.maxHealth;
                victim.x = Math.random() * 2800 + 100;
                victim.y = Math.random() * 2800 + 100;
                io.to(socket.roomId).emit('playerRespawned', victim.id);
            } else {
                victim.isAlive = false;
                
                const alive = Object.values(r.players).filter(p => p.isAlive);
                const leaderboard = Object.values(r.players)
                    .map(p => ({ username: p.username, score: p.score, id: p.id, isAlive: p.isAlive }))
                    .sort((a,b) => b.score - a.score);

                io.to(victim.id).emit('playerEliminated', leaderboard);
                
                if (alive.length === 1 && r.state === 'PLAYING') {
                    r.state = 'FINISHED';
                    io.to(alive[0].id).emit('matchWon', leaderboard);
                    // End match for everyone else still spectating
                    setTimeout(() => {
                        io.to(socket.roomId).emit('matchEnded', leaderboard);
                    }, 500);
                }
            }
        }
    });
});

// Broadcast game state and Handle Timers
setInterval(() => {
    const now = Date.now();
    for(const roomId in rooms) {
        const room = rooms[roomId];
        if(room.state === 'PLAYING') {
            io.to(roomId).emit('stateUpdate', room.players);
            
            const timeElapsed = Math.floor((now - room.startTime)/1000);
            const timeRemaining = (room.settings.duration * 60) - timeElapsed;
            
            if (timeRemaining <= 0) {
                room.state = 'FINISHED';
                // Build Leaderboard
                const leaderboard = Object.values(room.players)
                    .map(p => ({ username: p.username, score: p.score }))
                    .sort((a,b) => b.score - a.score);
                io.to(roomId).emit('matchEnded', leaderboard);
            }
        }
    }
}, 1000 / 30);

server.listen(8000, () => { console.log('Server running on 8000'); });
