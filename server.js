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

// HTTP Request Duration Histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5]
});

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

// Prometheus HTTP Metrics Middleware
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    end({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode
    });
  });

  next();
});

// Auth Routes powered by Redis
const bcrypt = require('bcryptjs');

app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({error: 'Username and password required'});
    
    const exists = await gamePub.exists(`user:${username}`);
    if(exists) return res.status(400).json({error: 'Username already exists'});

    bcrypt.hash(password, 10, async (err, hash) => {
        if(err) return res.status(500).json({error: 'Server error'});
        await gamePub.hSet(`user:${username}`, { password_hash: hash, wins: 0, matches_played: 0, high_score: 0 });
        res.json({ success: true, wins: 0, matches_played: 0, high_score: 0 });
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await gamePub.hGetAll(`user:${username}`);
    
    if(!user || !user.password_hash) return res.status(400).json({error: 'Invalid credentials'});
    
    bcrypt.compare(password, user.password_hash, (err, result) => {
        if(result) res.json({ success: true, wins: parseInt(user.wins), matches_played: parseInt(user.matches_played), high_score: parseInt(user.high_score) });
        else res.status(400).json({error: 'Invalid credentials'});
    });
});

app.post('/api/match_end', async (req, res) => {
    const { username, isWin } = req.body;
    if(!username) return res.json({ success: false });
    
    const winIncr = isWin ? 1 : 0;
    await gamePub.hIncrBy(`user:${username}`, 'matches_played', 1);
    await gamePub.hIncrBy(`user:${username}`, 'wins', winIncr);
    res.json({ success: true });
});

app.post('/api/score', async (req, res) => {
    const { username, score } = req.body;
    if(!username) return res.json({ success: false });
    
    const currentHigh = await gamePub.hGet(`user:${username}`, 'high_score');
    if(!currentHigh || score > parseInt(currentHigh)) {
        await gamePub.hSet(`user:${username}`, 'high_score', score);
        res.json({ success: true, newHighScore: score });
    } else {
        res.json({ success: true, newHighScore: parseInt(currentHigh) });
    }
});

// ----------------------------------------------------
// REDIS PUB/SUB & ROOM OWNERSHIP ARCHITECTURE
// ----------------------------------------------------
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const POD_ID = Math.random().toString(36).substring(2, 9);
const REDIS_URL = process.env.REDIS_URL || 'redis://redis-service:6379';

const redisConfig = { url: REDIS_URL, socket: { connectTimeout: 3000 } };
const pubClient = createClient(redisConfig);
const subClient = pubClient.duplicate();
const gamePub = pubClient.duplicate();
const gameSub = pubClient.duplicate();

let redisReady = false;

// We will force redisReady = true after 4 seconds regardless, to prevent infinite hanging
setTimeout(() => { if(!redisReady) { console.log('Redis timeout hit. Booting in local mode.'); redisReady = true; } }, 4000);

Promise.all([
    pubClient.connect(), subClient.connect(),
    gamePub.connect(), gameSub.connect()
]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    gameSub.subscribe('game-events', (message) => {
        const msg = JSON.parse(message);
        handleGameEvent(msg);
    });
    redisReady = true;
    console.log(`Pod ${POD_ID} successfully connected to Redis.`);
}).catch(err => {
    console.log(`Pod ${POD_ID} failed to connect to Redis. Running in local fallback mode.`);
    redisReady = true; // Still allow game to run if Redis is missing (useful for local dev)
});

// localRooms replaces the global rooms dictionary. It ONLY holds rooms owned by this Pod.
const localRooms = {};
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

// ----------------------------------------------------
// DISTRIBUTED EVENT ROUTER
// ----------------------------------------------------
function handleGameEvent(msg) {
    const { type, roomId, socketId, data } = msg;
    const room = localRooms[roomId];
    
    // If this Pod does not own the room, it ignores the event completely.
    if (!room) return; 

    if (type === 'playerJoined') {
        room.players[socketId] = createPlayerState(socketId, data.username);
        const count = Object.keys(room.players).length;
        
        // Update the global Redis metadata
        gamePub.set(`room:${roomId}`, JSON.stringify({ ...room.settings, count, owner: POD_ID }));
        io.to(roomId).emit('lobbyUpdate', { count, max: room.settings.maxPlayers });
        
        if (room.state === 'WAITING' && count >= room.settings.maxPlayers) {
            room.state = 'PLAYING';
            room.startTime = Date.now();
            io.to(roomId).emit('gameStarted', {
                theme: room.settings.theme, timeRemaining: room.settings.duration * 60, players: room.players
            });
        }
    }
    else if (type === 'playerUpdate') {
        if(room.players[socketId] && room.players[socketId].isAlive) {
            room.players[socketId].x = data.x;
            room.players[socketId].y = data.y;
            room.players[socketId].angle = data.angle;
        }
    }
    else if (type === 'shoot') {
        if(room.players[socketId]) {
            io.to(roomId).emit('projectileSpawned', {
                x: data.x, y: data.y, angle: data.angle, speed: data.speed,
                color: room.players[socketId].color, ownerId: socketId, damage: data.damage, radius: data.radius
            });
        }
    }
    else if (type === 'hitOpponent') {
        const victim = room.players[data.victimId];
        if(!victim || !victim.isAlive) return;

        victim.health -= data.damage;
        if (victim.health <= 0) {
            victim.lives--;
            if(room.players[socketId]) room.players[socketId].score++;
            
            if (victim.lives > 0) {
                victim.health = victim.maxHealth;
                victim.x = Math.random() * 2800 + 100;
                victim.y = Math.random() * 2800 + 100;
                io.to(roomId).emit('playerRespawned', victim.id);
            } else {
                victim.isAlive = false;
                const alive = Object.values(room.players).filter(p => p.isAlive);
                const leaderboard = Object.values(room.players)
                    .map(p => ({ username: p.username, score: p.score, id: p.id, isAlive: p.isAlive }))
                    .sort((a,b) => b.score - a.score);

                io.to(victim.id).emit('playerEliminated', leaderboard);
                
                if (alive.length === 1 && room.state === 'PLAYING') {
                    room.state = 'FINISHED';
                    io.to(alive[0].id).emit('matchWon', leaderboard);
                    setTimeout(() => { io.to(roomId).emit('matchEnded', leaderboard); }, 500);
                }
            }
        }
    }
    else if (type === 'playerDisconnected') {
        delete room.players[socketId];
        const count = Object.keys(room.players).length;
        if(count === 0) {
            // Room is empty, garbage collect it
            delete localRooms[roomId];
            gamePub.del(`room:${roomId}`);
        } else {
            gamePub.set(`room:${roomId}`, JSON.stringify({ ...room.settings, count, owner: POD_ID }));
            io.to(roomId).emit('lobbyUpdate', { count, max: room.settings.maxPlayers });
        }
    }
}

// ----------------------------------------------------
// SOCKET.IO ENDPOINTS (Proxies)
// ----------------------------------------------------
io.on('connection', (socket) => {
    if(!redisReady) {
        socket.emit('roomError', 'Server booting up, please try again in a few seconds.');
        return socket.disconnect();
    }
    
    activePlayers.inc();
    socket.roomId = null;

    socket.on('createRoom', ({ username, theme, duration, maxPlayers }) => {
        const roomId = generateRoomId();
        
        // This pod claims MASTER OWNERSHIP
        localRooms[roomId] = {
            settings: { theme, duration: parseInt(duration), maxPlayers: parseInt(maxPlayers), count: 1 },
            state: 'WAITING', players: {}, startTime: null
        };
        localRooms[roomId].players[socket.id] = createPlayerState(socket.id, username);
        
        socket.join(roomId);
        socket.roomId = roomId;

        // Register room globally in Redis so other Pods know it exists
        if(gamePub.isOpen) {
            gamePub.set(`room:${roomId}`, JSON.stringify({ owner: POD_ID, maxPlayers: parseInt(maxPlayers), count: 1, theme }));
        }

        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('lobbyUpdate', { count: 1, max: parseInt(maxPlayers) });
    });

    socket.on('joinRoom', async (data) => {
        const { roomId, username } = data;
        
        // 1. Ask Redis if the room exists globally
        if(gamePub.isOpen) {
            const roomMetaStr = await gamePub.get(`room:${roomId}`);
            if(!roomMetaStr) return socket.emit('roomError', 'Room not found.');
            
            const roomMeta = JSON.parse(roomMetaStr);
            if(roomMeta.count >= roomMeta.maxPlayers) return socket.emit('roomError', 'Room is full.');
            
            socket.join(roomId);
            socket.roomId = roomId;
            
            // 2. Tell the Master Owner Pod that a player joined
            // We add a 250ms delay to prevent a Redis Pub/Sub race condition
            // This gives the socket.io redis-adapter enough time to officially subscribe to the roomId channel
            setTimeout(() => {
                if(gamePub.isOpen) {
                    gamePub.publish('game-events', JSON.stringify({
                        type: 'playerJoined', roomId, socketId: socket.id, data: { username }
                    }));
                }
            }, 250);
        } else {
            // Local fallback if Redis fails
            if(!localRooms[roomId]) return socket.emit('roomError', 'Room not found.');
            socket.join(roomId);
            socket.roomId = roomId;
            handleGameEvent({ type: 'playerJoined', roomId, socketId: socket.id, data: { username } });
        }
    });

    socket.on('disconnect', () => {
        activePlayers.dec();
        if(socket.roomId) {
            if(gamePub.isOpen) {
                gamePub.publish('game-events', JSON.stringify({
                    type: 'playerDisconnected', roomId: socket.roomId, socketId: socket.id
                }));
            } else {
                handleGameEvent({ type: 'playerDisconnected', roomId: socket.roomId, socketId: socket.id });
            }
        }
    });

    // Proxy physical movements to the Master Owner Pod via Redis
    socket.on('playerUpdate', (data) => {
        if(socket.roomId) {
            if(gamePub.isOpen) gamePub.publish('game-events', JSON.stringify({ type: 'playerUpdate', roomId: socket.roomId, socketId: socket.id, data }));
            else handleGameEvent({ type: 'playerUpdate', roomId: socket.roomId, socketId: socket.id, data });
        }
    });

    socket.on('shoot', (data) => {
        if(socket.roomId) {
            if(gamePub.isOpen) gamePub.publish('game-events', JSON.stringify({ type: 'shoot', roomId: socket.roomId, socketId: socket.id, data }));
            else handleGameEvent({ type: 'shoot', roomId: socket.roomId, socketId: socket.id, data });
        }
    });

    socket.on('hitOpponent', (data) => {
        if(socket.roomId) {
            if(gamePub.isOpen) gamePub.publish('game-events', JSON.stringify({ type: 'hitOpponent', roomId: socket.roomId, socketId: socket.id, data }));
            else handleGameEvent({ type: 'hitOpponent', roomId: socket.roomId, socketId: socket.id, data });
        }
    });
});

// ----------------------------------------------------
// THE GAME LOOP (Only runs for rooms OWNED by this pod)
// ----------------------------------------------------
setInterval(() => {
    const now = Date.now();
    for(const roomId in localRooms) {
        const room = localRooms[roomId];
        if(room.state === 'PLAYING') {
            io.to(roomId).emit('stateUpdate', room.players);
            
            const timeElapsed = Math.floor((now - room.startTime)/1000);
            const timeRemaining = (room.settings.duration * 60) - timeElapsed;
            
            if (timeRemaining <= 0) {
                room.state = 'FINISHED';
                const leaderboard = Object.values(room.players)
                    .map(p => ({ username: p.username, score: p.score }))
                    .sort((a,b) => b.score - a.score);
                io.to(roomId).emit('matchEnded', leaderboard);
                
                // Cleanup
                if(gamePub.isOpen) gamePub.del(`room:${roomId}`);
                delete localRooms[roomId];
            }
        }
    }
}, 1000 / 30);

server.listen(8000, () => { console.log(`Pod ${POD_ID} running on 8000`); });
