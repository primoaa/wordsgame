/**
 * 🎮 تحدي الحروف - Game Controller (Professional Version)
 * Handles Firebase integration and mode-specific game flow with strict state management.
 * 
 * 🔴 ABSOLUTE RULES:
 * - Must read room.mode, room.phases, room.phase before ANY logic
 * - AI NEVER controls timers, phase transitions, round start/end
 * - Each mode uses its own UI builder
 */

// ==================== STATE ====================
const GameState = {
    roomId: null,
    playerId: null,
    playerName: '',
    isHost: false,
    roundId: 0,
    phase: null,
    phaseIndex: 0,
    phaseStartAt: 0,
    timerInterval: null,
    roomListener: null,
    resultsShown: false,
    lastDisplayedRoundId: 0,
    lastDisplayedPhase: null,
    lastDisplayedMode: null,
    lastStatus: null, // 🔴 Added for timer tracking

    // Mode-specific context
    modeContext: {}
};

// 🔴 Expose to window for index.html
window.GameController = {
    state: GameState,
    serverTimeOffset: 0,
    createRoom,
    joinRoom,
    startGame,
    listenToRoom,
    leaveRoom,
    submitAnswers,
    playAgain,
    acceptPlayAgain,
    declinePlayAgain
};

// Sync server time offset
getDatabase().ref('.info/serverTimeOffset').on('value', snap => {
    window.GameController.serverTimeOffset = snap.val() || 0;
});

// ==================== FIREBASE ====================
function getDatabase() {
    return window.database || firebase.database();
}

// ==================== ROOM MANAGEMENT ====================

/**
 * Create a new room with specified mode
 */
async function createRoom(name, mode, totalRounds = 5) {
    if (!mode) throw new Error('🔴 CRITICAL: mode must be specified');

    const { MODES } = window.GameEngine;
    const code = generateRoomCode();

    if (!GameState.playerId) GameState.playerId = generatePlayerId();
    GameState.playerName = name;
    GameState.isHost = true;
    GameState.roundId = 0;
    GameState.phase = null;
    GameState.phaseIndex = 0;

    const modeConfig = MODES[mode];
    if (!modeConfig) throw new Error(`🔴 CRITICAL FAILURE: No configuration for mode "${mode}"`);

    const modeContext = await buildModeContext(mode, modeConfig);

    await getDatabase().ref('rooms/' + code).set({
        code,
        status: 'waiting',
        mode: mode,
        modeName: modeConfig.name,
        letter: '',
        roundId: 0,
        phases: modeConfig.phases,
        phaseIndex: 0,
        totalPhases: modeConfig.phases.length,
        phase: null,
        phaseStartAt: null,
        phaseDuration: 60,
        stoppedBy: '',
        stopLock: false,
        roundResults: {},
        playerAnswers: {},
        roundScores: {},
        totalScores: {},
        roundsWon: {},
        roundsPlayed: 0,
        roundsToPlay: parseInt(totalRounds) || 5,
        calculationLock: false,
        modeContext: modeContext,
        players: {
            [GameState.playerId]: {
                name,
                isHost: true,
                answers: {},
                score: 0,
                status: 'online'
            }
        }
    });

    GameState.roomId = code;
    setupPresence();
    listenToRoom();
    return code;
}

/**
 * Join an existing room
 */
async function joinRoom(code, name) {
    const snap = await getDatabase().ref('rooms/' + code).once('value');
    if (!snap.exists()) throw new Error('الغرفة غير موجودة');

    const room = snap.val();
    if (room.status !== 'waiting') throw new Error('اللعبة بدأت بالفعل');
    if (Object.keys(room.players || {}).length >= 2) throw new Error('الغرفة ممتلئة');

    if (!GameState.playerId) GameState.playerId = generatePlayerId();
    GameState.playerName = name;
    GameState.isHost = false;
    GameState.roundId = room.roundId || 0;
    GameState.phase = room.phase || null;
    GameState.phaseIndex = room.phaseIndex || 0;

    await getDatabase().ref(`rooms/${code}/players/${GameState.playerId}`).set({
        name,
        isHost: false,
        answers: {},
        score: 0,
        status: 'online'
    });

    GameState.roomId = code;
    setupPresence();
    listenToRoom();
}

/**
 * Listen to room changes and sync state
 */
function listenToRoom() {
    if (!GameState.roomId) return;

    if (GameState.roomListener) {
        getDatabase().ref('rooms/' + GameState.roomId).off('value', GameState.roomListener);
    }

    GameState.roomListener = getDatabase().ref('rooms/' + GameState.roomId).on('value', async snap => {
        if (!snap.exists()) {
            showToast('تم حذف الغرفة', 'error');
            cleanup();
            showScreen('welcome');
            return;
        }

        const room = snap.val();
        const players = room.players || {};
        const playerCount = Object.keys(players).length;

        // 🔴 HOST SYNC: Ensure there is always a host
        const myPlayerData = players[GameState.playerId];
        if (myPlayerData && myPlayerData.isHost && !GameState.isHost) {
            GameState.isHost = true;
            showToast('أصبحت المضيف الجديد! 👑');
        }

        // Update UI Elements
        const countEl = document.getElementById('players-count');
        if (countEl) countEl.textContent = `اللاعبون: ${playerCount}/2`;

        // 🔴 Show manual start button for host
        const startBtn = document.getElementById('force-start-btn');
        if (startBtn) {
            startBtn.style.display = (GameState.isHost && room.status === 'waiting') ? 'block' : 'none';
        }

        // 🔴 AUTO-START LOGIC (Professional)
        // Only host triggers start when room is full and status is waiting
        if (GameState.isHost && room.status === 'waiting' && playerCount >= 2) {
            console.log("🚀 Room full, starting game...");
            startGame();
            return; // Exit to wait for next sync with 'playing' status
        }

        // Sync Phase & Round & Timer
        const isNewRound = room.roundId > GameState.roundId;
        const isPhaseChange = room.phase !== GameState.phase;
        const isStatusToPlaying = room.status === 'playing' && GameState.lastStatus !== 'playing';

        if (isNewRound) {
            GameState.roundId = room.roundId;
            GameState.resultsShown = false;
        }

        GameState.phase = room.phase;

        // 🔴 FIX: Start timer if Phase OR Round OR Status changed to playing
        if ((isPhaseChange || isNewRound || isStatusToPlaying) && room.status === 'playing' && room.phaseStartAt) {
            console.log(`⏰ Starting Timer: Round=${room.roundId}, Phase=${room.phase}, Reason=${isNewRound ? 'NewRound' : (isPhaseChange ? 'PhaseChange' : 'StatusChange')}`);
            startTimer(room.phaseStartAt, room.phaseDuration || 60, room);
        }

        // 🔴 Handle Universal Stop
        if (room.stoppedBy && room.status === 'playing') {
            const stopperName = room.players && room.players[room.stoppedBy] ? room.players[room.stoppedBy].name : 'Unknown';
            showToast(`🛑 تم إيقاف الجولة بواسطة: ${stopperName}`);

            if (GameState.isHost) {
                // Host handles logic to end round
                handleTimeUp();
            }
        }

        GameState.lastStatus = room.status;

        // 🔴 Play Again Logic (Both Host & Guest can request)
        if (room.playAgainRequest) {
            const { status, requestedBy } = room.playAgainRequest;
            const modal = document.getElementById('play-again-modal');

            // Host starts new round when accepted
            if (GameState.isHost && status === 'accepted') {
                startNewRound(room);
            }

            // Show declined message to whoever requested
            if (status === 'declined' && requestedBy === GameState.playerId) {
                showToast('اللاعب رفض اللعب مرة أخرى', 'error');
                getDatabase().ref(`rooms/${GameState.roomId}/playAgainRequest`).remove();
                const btn = document.querySelector('.res-btn-primary');
                if (btn) {
                    btn.disabled = false;
                    btn.classList.remove('btn-waiting');
                }
            }

            // Show modal to the OTHER player (not the requester)
            if (status === 'pending' && requestedBy !== GameState.playerId) {
                if (modal) modal.classList.add('active');
            } else {
                if (modal) modal.classList.remove('active');
            }
        } else {
            // No request active
            const modal = document.getElementById('play-again-modal');
            if (modal) modal.classList.remove('active');
        }

        // 🔴 STATE MACHINE
        switch (room.status) {
            case 'waiting':
                showScreen('waiting');
                break;
            case 'playing':
                showGameScreen(room);
                break;
            case 'calculating':
                // 🔴 FIX: Show calculating screen for BOTH host and guest
                showScreen('game');
                const calcContainer = document.getElementById('game-container');
                if (calcContainer) {
                    calcContainer.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><p>جاري التحقق و حساب النتائج...</p></div>';
                }
                // Host triggers calculation logic
                if (GameState.isHost && !room.roundResults && !room.calculationLock) {
                    handleHostCalculation(room);
                }
                break;
            case 'results':
            case 'finished_game':
                if (!GameState.resultsShown && room.roundId === GameState.roundId) {
                    GameState.resultsShown = true;
                    await showResultsScreen(room, room.status === 'finished_game');
                }
                break;
        }
    });
}

/**
 * Start the game (Host only)
 */
async function startGame() {
    if (!GameState.roomId || !GameState.isHost) return;

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const roomSnap = await roomRef.once('value');
    const room = roomSnap.val();

    const modeConfig = window.GameEngine.getModeConfig(room.mode);
    const firstPhase = modeConfig.phases[0];
    const modeContext = await buildModeContext(room.mode, modeConfig);

    // 🔴 GUARD: Generate and validate Arabic letter
    let letter = window.GameEngine.getRandomLetter();
    if (!letter || !/^[\u0600-\u06FF]$/.test(letter)) {
        console.error('🔴 Invalid letter in startGame, retrying...');
        letter = window.GameEngine.getRandomLetter();
    }

    const updates = {
        status: 'playing',
        letter: letter,
        roundId: Date.now(),
        phase: firstPhase,
        phaseIndex: 0,
        phaseStartAt: firebase.database.ServerValue.TIMESTAMP,
        phaseDuration: modeConfig.durations[firstPhase] || 60,
        modeContext: modeContext,
        roundResults: {},
        playerAnswers: {},
        roundScores: {},
        totalScores: {},
        roundsWon: {},
        roundsPlayed: 0,
        calculationLock: false,
        stoppedBy: '',
        stopLock: false
    };

    // Reset player round data
    Object.keys(room.players).forEach(pid => {
        updates[`players/${pid}/answers`] = {};
        updates[`players/${pid}/score`] = 0;
    });

    await roomRef.update(updates);
}

/**
 * Play Again (Host only) - Initiates Request
 */
async function playAgain() {
    if (!GameState.roomId) return;

    // Set request to pending
    await getDatabase().ref(`rooms/${GameState.roomId}/playAgainRequest`).set({
        requestedBy: GameState.playerId,
        status: 'pending',
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // UI Feedback for requester
    const btn = document.querySelector('.res-btn-primary');
    if (btn) {
        btn.textContent = 'بانتظار رد اللاعب...';
        btn.disabled = true;
        btn.classList.add('btn-waiting');
    }
}

async function acceptPlayAgain() {
    if (!GameState.roomId) return;
    await getDatabase().ref(`rooms/${GameState.roomId}/playAgainRequest`).update({
        status: 'accepted'
    });
    // Hide modal immediately for better UX
    document.getElementById('play-again-modal').classList.remove('active');
}

async function declinePlayAgain() {
    if (!GameState.roomId) return;
    await getDatabase().ref(`rooms/${GameState.roomId}/playAgainRequest`).update({
        status: 'declined'
    });
    document.getElementById('play-again-modal').classList.remove('active');
}

/**
 * Start New Round (Internal Logic)
 * Triggered when Host sees 'accepted' status
 */
async function startNewRound(room) {
    if (!GameState.roomId || !GameState.isHost) return;

    // Avoid re-triggering if we are already shifting to playing or cleared request
    if (room.status === 'playing' && !room.playAgainRequest) return;

    // 🔴 Reset GameState for clean round
    GameState.resultsShown = false;
    GameState.lastStatus = null;
    if (GameState.timerInterval) {
        clearInterval(GameState.timerInterval);
        GameState.timerInterval = null;
    }

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const modeConfig = window.GameEngine.getModeConfig(room.mode);
    const firstPhase = modeConfig.phases[0];
    const modeContext = await buildModeContext(room.mode, modeConfig);

    // 🔴 GUARD: Generate and validate Arabic letter
    let letter = window.GameEngine.getRandomLetter();
    if (!letter || !/^[\u0600-\u06FF]$/.test(letter)) {
        console.error('🔴 Invalid letter in startNewRound, retrying...');
        letter = window.GameEngine.getRandomLetter();
    }

    const updates = {
        roundId: Date.now(),
        playerAnswers: {},
        roundResults: {},
        roundScores: {},
        calculationLock: false,
        status: 'playing',
        letter: letter,
        phase: firstPhase,
        phaseIndex: 0,
        phaseStartAt: firebase.database.ServerValue.TIMESTAMP,
        phaseDuration: modeConfig.durations[firstPhase] || 60,
        modeContext: modeContext,
        stoppedBy: '',
        stopLock: false,
        playAgainRequest: null // Clear the request
    };

    // Reset round-specific data
    Object.keys(room.players).forEach(pid => {
        updates[`players/${pid}/answers`] = {};
        updates[`players/${pid}/score`] = 0;
    });

    await roomRef.update(updates);
}

/**
 * Handle Presence and Disconnection
 */
function setupPresence() {
    if (!GameState.roomId || !GameState.playerId) return;

    const playerRef = getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`);

    playerRef.update({ status: 'online' });

    // 🔴 CRITICAL: Clean up on disconnect to prevent ghost players
    playerRef.onDisconnect().remove().then(() => {
        // If host leaves, room logic in leaveRoom handles handover
    });
}

/**
 * Leave Room
 */
async function leaveRoom() {
    if (!GameState.roomId || !GameState.playerId) {
        cleanup();
        return;
    }

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);

    try {
        const snap = await roomRef.once('value');
        const room = snap.val();

        if (room && room.players) {
            const playerIds = Object.keys(room.players);
            if (playerIds.length <= 1) {
                // Last player leaves, delete room
                await roomRef.remove();
            } else {
                // Handover host if needed
                if (GameState.isHost) {
                    const nextHostId = playerIds.find(id => id !== GameState.playerId);
                    await roomRef.child(`players/${nextHostId}`).update({ isHost: true });
                }
                await roomRef.child(`players/${GameState.playerId}`).remove();
            }
        }
    } catch (e) {
        console.error("Error leaving room:", e);
    }

    cleanup();
    // 🔴 FIX: Sync local state so currentRoomId is reset
    if (typeof window.syncGameState === 'function') window.syncGameState();
    showScreen('welcome');
}

// ==================== UTILS & HELPERS ====================

function cleanup() {
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);
    if (GameState.roomListener && GameState.roomId) {
        getDatabase().ref('rooms/' + GameState.roomId).off('value', GameState.roomListener);
    }
    GameState.roomId = null;
    GameState.isHost = false;
    GameState.roomListener = null;
    GameState.timerInterval = null;
    GameState.lastRenderedKey = null;
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePlayerId() {
    return 'p_' + Math.random().toString(36).substring(2, 10);
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id + '-screen');
    if (target) target.classList.add('active');
}

function showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function buildModeContext(mode, modeConfig) {
    // Fallback static generation (Simplified for brevity, same as original logic)
    const { getRandomCategory } = window.GameEngine;
    switch (mode) {
        case 'survival': return { currentCategory: getRandomCategory(), roundNumber: 0 };
        case 'memory': return { words: ['أسد', 'نمر', 'فيل', 'زرافة', 'قرد'], showDuration: 5, recallDuration: 15 };
        default: return {};
    }
}

// This logic is typically inside the roomListener function, which is not provided in the snippet.
// Assuming it's meant to be executed when the room object updates.
// 🔴 FIX: Start timer if Phase OR Round OR Status changed to playing
// This block should be placed inside the GameState.roomListener function where 'room' is updated.
// For the purpose of this edit, I'm placing it here as instructed, but note its typical context.
// You would need to define `isPhaseChange`, `isNewRound`, `isStatusToPlaying` based on `GameState.lastRoomState` or similar.
/*
if ((isPhaseChange || isNewRound || isStatusToPlaying) && room.status === 'playing' && room.phaseStartAt) {
    console.log(`⏰ Starting Timer: Round=${room.roundId}, Phase=${room.phase}, Reason=${isNewRound ? 'NewRound' : (isPhaseChange ? 'PhaseChange' : 'StatusChange')}`);
    startTimer(room.phaseStartAt, room.phaseDuration || 60, room);
}

// 🔴 Handle Universal Stop
if (room.stoppedBy && room.status === 'playing') {
    const stopperName = room.players && room.players[room.stoppedBy] ? room.players[room.stoppedBy].name : 'Unknown';
    showToast(`🛑 تم إيقاف الجولة بواسطة: ${stopperName}`);
    
    if (GameState.isHost) {
        // Host handles logic to end round
        handleTimeUp();
    }
}

GameState.lastStatus = room.status;

// 🔴 Play Again Logic (Host & Guest)
*/

function startTimer(startAt, duration, room) {
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);

    // 🔴 FIX: Move element query INSIDE output to handle UI rebuilds
    const update = () => {
        const timerEl = document.getElementById('timer-value'); // Query fresh every tick
        const stopBtn = document.getElementById('stop-btn');

        // 🔴 Use server-synced time
        const now = Date.now() + (window.GameController.serverTimeOffset || 0);
        const elapsed = Math.floor((now - startAt) / 1000);
        const remaining = Math.max(0, duration - elapsed);

        // 🔴 UNIVERSAL STOP LOGIC: Lock for first 20s
        if (stopBtn) {
            const LOCK_DURATION = 20; // Seconds
            if (elapsed < LOCK_DURATION) {
                stopBtn.disabled = true;
                stopBtn.textContent = `🔒 انتظر (${LOCK_DURATION - elapsed})`;
                stopBtn.classList.add('locked'); // Add visual style if needed
            } else {
                stopBtn.disabled = false;
                stopBtn.textContent = '🛑 STOP';
                stopBtn.classList.remove('locked');
            }
        }

        if (timerEl) {
            timerEl.textContent = remaining;

            // Get parent container for floating styles
            const timerContainer = timerEl.parentElement;
            if (timerContainer && timerContainer.classList.contains('timer-display')) {
                // Clear previous states
                timerContainer.classList.remove('warning', 'danger');

                // logic for Red Alarm (last 10s)
                if (remaining <= 10) {
                    timerContainer.classList.add('danger');
                }
                // logic for Warning (last 20s)
                else if (remaining <= 20) {
                    timerContainer.classList.add('warning');
                }
            }
        }

        if (remaining <= 0) {
            clearInterval(GameState.timerInterval);
            if (GameState.isHost) {
                console.log("⏰ Time up! Transitioning...");
                handleTimeUp();
            }
        }
    };

    GameState.timerInterval = setInterval(update, 1000);
    update();
}

async function handleTimeUp() {
    if (!GameState.isHost) return;
    // Transition to next phase or calculation
    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const snap = await roomRef.once('value');
    const room = snap.val();

    if (room.status !== 'playing') return;

    const nextIdx = (room.phaseIndex || 0) + 1;
    if (nextIdx < room.phases.length) {
        const nextPhase = room.phases[nextIdx];
        const modeConfig = window.GameEngine.getModeConfig(room.mode);
        await roomRef.update({
            phase: nextPhase,
            phaseIndex: nextIdx,
            phaseStartAt: firebase.database.ServerValue.TIMESTAMP,
            phaseDuration: modeConfig.durations[nextPhase] || 60
        });
    } else {
        await roomRef.update({ status: 'calculating' });
    }
}

async function handleHostCalculation(roomData) {
    if (!GameState.isHost) return;

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);

    // 🔴 Prevent double calculation with lock
    if (roomData.calculationLock) return;
    await roomRef.update({ calculationLock: true });

    try {
        // Build playerAnswers from players' answers
        const players = roomData.players || {};
        const playerAnswers = {};
        Object.keys(players).forEach(pid => {
            playerAnswers[pid] = players[pid].answers || {};
        });

        // Build entries for Worker
        const entries = [];
        Object.entries(playerAnswers).forEach(([playerId, answers]) => {
            Object.entries(answers).forEach(([category, word]) => {
                entries.push({ playerId, category, word });
            });
        });

        const response = await fetch(window.WORKER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                roundId: roomData.roundId,
                entries,
                letter: roomData.letter,
                mode: roomData.mode
            })
        });

        const data = await response.json();

        if (data.quotaExceeded) {
            showToast("🚫 تم استهلاك حد الذكاء الاصطناعي");
            await roomRef.update({ status: "finished_game", calculationLock: false });
            return;
        }

        if (data.roundId !== roomData.roundId) {
            await roomRef.update({ calculationLock: false });
            return;
        }

        // 🔴 New simplified scoring: +10 per valid answer
        const roundScores = calculateRoundScores(data.results);
        const winner = determineRoundWinner(roundScores);

        const updatedTotals = {};
        const updatedRoundsWon = { ...(roomData.roundsWon || {}) };

        Object.keys(roundScores).forEach(playerId => {
            updatedTotals[playerId] =
                (roomData.totalScores?.[playerId] || 0) + roundScores[playerId];

            if (!updatedRoundsWon[playerId]) {
                updatedRoundsWon[playerId] = 0;
            }
        });

        if (winner) {
            updatedRoundsWon[winner] += 1;
        }

        // Update player scores in DB
        Object.keys(players).forEach(pid => {
            roomRef.child(`players/${pid}`).update({
                score: roundScores[pid] || 0
            });
        });

        const isLastRound = (roomData.roundsPlayed || 0) + 1 >= (roomData.roundsToPlay || 5);

        await roomRef.update({
            roundResults: data.results,
            roundScores,
            totalScores: updatedTotals,
            roundsWon: updatedRoundsWon,
            roundsPlayed: (roomData.roundsPlayed || 0) + 1,
            status: isLastRound ? 'finished_game' : 'results',
            calculationLock: false
        });

    } catch (e) {
        console.error('Calculation Error:', e);
        showToast('حدث خطأ في الحساب، تم الانتقال للنتائج', 'error');

        try {
            const isLastRound = (roomData.roundsPlayed || 0) + 1 >= (roomData.roundsToPlay || 5);
            await roomRef.update({
                roundResults: {},
                status: isLastRound ? 'finished_game' : 'results',
                calculationLock: false
            });
        } catch (updateError) {
            console.error('CRITICAL: Failed to recover from calculation error', updateError);
        }
    }
}

/**
 * 🔴 Simplified scoring: +10 per valid answer, +0 per invalid
 * No word comparison between players
 */
function calculateRoundScores(validationResults) {
    const scores = {};

    Object.keys(validationResults).forEach(playerId => {
        scores[playerId] = 0;

        Object.values(validationResults[playerId]).forEach(isValid => {
            if (isValid) {
                scores[playerId] += 10;
            }
        });
    });

    return scores;
}

/**
 * 🏆 Determine the round winner (highest score)
 * Returns playerId or null (draw)
 */
function determineRoundWinner(roundScores) {
    const players = Object.keys(roundScores);

    if (players.length < 2) return null;

    const p1 = players[0];
    const p2 = players[1];

    if (roundScores[p1] > roundScores[p2]) return p1;
    if (roundScores[p2] > roundScores[p1]) return p2;

    return null; // تعادل
}

/**
 * 🏁 Determine the final game winner based on rounds won
 * Returns { winner, result } where result is "win" or "draw"
 */
function determineFinalWinner(roundsWon) {
    const players = Object.keys(roundsWon);

    if (players.length < 2) return null;

    const p1 = players[0];
    const p2 = players[1];

    if (roundsWon[p1] > roundsWon[p2]) {
        return { winner: p1, result: "win" };
    }

    if (roundsWon[p2] > roundsWon[p1]) {
        return { winner: p2, result: "win" };
    }

    return { winner: null, result: "draw" };
}

/**
 * 🔴 SHOW GAME SCREEN
 * Handled transition from waiting -> playing
 */
function showGameScreen(room) {
    // 🔴 SMART RENDER CHECK
    // Only re-render if Mode, Round, Phase, or Letter changes
    const currentKey = `${room.mode}_${room.roundId}_${room.phase}_${room.letter}`;

    if (GameState.lastRenderedKey === currentKey) {
        showScreen('game');
        return; // UI is fresh, inputs preserved
    }
    GameState.lastRenderedKey = currentKey;

    showScreen('game');

    // 1. Render the Mode-Specific UI
    // 1. Render the Mode-Specific UI
    try {
        const uiBuilder = window.GameEngine.renderGameUI(room);

        // 🔴 SETUP MODE HANDLERS (Stop button, etc.)
        window.GameEngine.setupModeHandler(room, {
            onStop: () => {
                // Universal Stop Request
                // Write to DB -> triggers listener -> ends round
                if (!GameState.roomId) return;

                // Double check local timer to be safe (UI should be disabled anyway)
                const stopBtn = document.getElementById('stop-btn');
                if (stopBtn && stopBtn.disabled) return;

                // Optimistic check
                if (room.stoppedBy) return;

                getDatabase().ref(`rooms/${GameState.roomId}`).update({
                    stoppedBy: GameState.playerId
                });
            },
            onSubmit: () => {
                // 🔴 Force Sync Immediately (e.g. Bluff Submit / Vote)
                if (!uiBuilder || !uiBuilder.getAnswers) return;

                const newAnswers = uiBuilder.getAnswers();
                const merged = { ...GameState.answers, ...newAnswers };
                GameState.answers = merged;

                const playerRef = getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`);
                playerRef.update({ answers: merged });

                console.log('🚀 Force synced answers via onSubmit:', merged);
            }
        });

        // 🔴 SETUP INPUT SYNC
        // Sync answers to Firebase as user types
        const inputs = document.getElementById('game-container').querySelectorAll('input, textarea');
        let debounceTimer;

        const syncAnswers = () => {
            if (!uiBuilder || !uiBuilder.getAnswers) return;

            const newAnswers = uiBuilder.getAnswers();
            // 🔴 MERGE to prevent overwriting (e.g. vote phase shouldn't wipe answer)
            const merged = { ...GameState.answers, ...newAnswers };

            // Optimistic local update
            GameState.answers = merged;

            // Sync to Firebase
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const playerRef = getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`);
                playerRef.update({ answers: merged });
            }, 300);
        };

        inputs.forEach(input => {
            input.addEventListener('input', syncAnswers);
            input.addEventListener('change', syncAnswers);
        });

    } catch (e) {
        console.error("Failed to render game UI:", e);
        showToast("فشل في تحميل واجهة اللعبة", "error");
    }

    // 3. Update common elements
    // Timer is handled by startTimer separately
}

/**
 * Render a beautiful results table
 */
/**
 * Render a beautiful, modern results screen
 */
async function showResultsScreen(room, isFinal) {
    showScreen('results');
    const container = document.getElementById('results-container');
    if (!container) return;

    // 🔴 Guard: Don't render if calculation still in progress
    if (room.calculationLock) return;

    // ===== DATA FROM FIREBASE ONLY =====
    const players = room.players || {};
    const roundScores = room.roundScores || {};
    const totalScores = room.totalScores || {};
    const roundsWon = room.roundsWon || {};
    const roundResults = room.roundResults || {};
    const roundsPlayed = room.roundsPlayed || 0;
    const roundsToPlay = room.roundsToPlay || 5;

    // ===== RANKING SYSTEM =====
    function buildRanking() {
        const playerIds = Object.keys(players);
        return playerIds
            .map(pid => ({
                playerId: pid,
                name: players[pid]?.name || 'لاعب',
                total: totalScores[pid] || 0,
                wins: roundsWon[pid] || 0,
                roundScore: roundScores[pid] || 0
            }))
            .sort((a, b) => {
                if (b.total !== a.total) return b.total - a.total;
                return b.wins - a.wins;
            });
    }

    function determineFinalResult(ranking) {
        if (ranking.length < 2) return null;
        if (ranking[0].total === ranking[1].total && ranking[0].wins === ranking[1].wins) {
            return { type: 'draw' };
        }
        return { type: 'winner', winnerId: ranking[0].playerId, name: ranking[0].name };
    }

    const ranking = buildRanking();
    const rankIcons = ['🥇', '🥈', '🥉'];
    const finalResult = isFinal ? determineFinalResult(ranking) : null;

    // ===== INJECT STYLES (Idempotent) =====
    if (!document.getElementById('pro-results-styles')) {
        const style = document.createElement('style');
        style.id = 'pro-results-styles';
        style.innerHTML = `
            /* ===== RESULTS OVERLAY ===== */
            .res-screen {
                max-width: 700px;
                margin: 0 auto;
                padding: 20px 15px 40px;
                animation: resFadeIn 0.6s ease;
            }

            /* Header */
            .res-header {
                text-align: center;
                margin-bottom: 28px;
            }
            .res-header h1 {
                font-size: 2rem;
                margin: 0 0 6px;
                background: linear-gradient(135deg, #ffd700, #ff8c00);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .res-round-info {
                color: #8b8baf;
                font-size: 0.95rem;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            .res-round-info .round-progress {
                background: rgba(255,255,255,0.08);
                border-radius: 20px;
                padding: 3px 14px;
                font-weight: 600;
                color: #c0c0e0;
            }

            /* Final Banner */
            .res-final-banner {
                text-align: center;
                padding: 18px 20px;
                border-radius: 16px;
                margin-bottom: 24px;
                animation: resBannerPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .res-final-banner.winner-banner {
                background: linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,140,0,0.08));
                border: 1px solid rgba(255,215,0,0.3);
            }
            .res-final-banner.draw-banner {
                background: linear-gradient(135deg, rgba(100,149,237,0.15), rgba(65,105,225,0.08));
                border: 1px solid rgba(100,149,237,0.3);
            }
            .res-final-banner .banner-icon {
                font-size: 2.5rem;
                display: block;
                margin-bottom: 6px;
            }
            .res-final-banner .banner-text {
                font-size: 1.3rem;
                font-weight: 700;
                color: #fff;
            }
            .res-final-banner .banner-sub {
                font-size: 0.85rem;
                color: #a0a0c0;
                margin-top: 4px;
            }

            /* Player Cards */
            .res-cards {
                display: flex;
                flex-direction: column;
                gap: 14px;
                margin-bottom: 24px;
            }
            .res-card {
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 16px;
                padding: 18px 20px;
                display: flex;
                align-items: center;
                gap: 16px;
                position: relative;
                transition: all 0.4s ease;
                animation: resCardSlide 0.5s ease backwards;
            }
            .res-card:nth-child(1) { animation-delay: 0.1s; }
            .res-card:nth-child(2) { animation-delay: 0.25s; }
            .res-card:nth-child(3) { animation-delay: 0.4s; }

            .res-card.rank-1 {
                background: linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,140,0,0.04));
                border-color: rgba(255,215,0,0.25);
                box-shadow: 0 4px 24px rgba(255,215,0,0.08);
            }

            /* Rank Badge */
            .res-rank {
                font-size: 1.8rem;
                min-width: 44px;
                text-align: center;
                flex-shrink: 0;
            }

            /* Avatar */
            .res-avatar {
                width: 46px;
                height: 46px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.2rem;
                font-weight: 700;
                color: #fff;
                flex-shrink: 0;
            }
            .res-card.rank-1 .res-avatar {
                background: linear-gradient(135deg, #ffd700, #ff8c00);
                color: #1a1a2e;
            }
            .res-card.rank-2 .res-avatar {
                background: linear-gradient(135deg, #c0c0c0, #a8a8a8);
                color: #1a1a2e;
            }
            .res-card:not(.rank-1):not(.rank-2) .res-avatar {
                background: linear-gradient(135deg, #4361ee, #3a0ca3);
            }

            /* Player Info */
            .res-info {
                flex: 1;
                min-width: 0;
            }
            .res-name {
                font-size: 1.1rem;
                font-weight: 700;
                color: #fff;
                margin-bottom: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .res-round-score {
                font-size: 0.85rem;
                color: #8b8baf;
            }
            .res-round-score span {
                color: #4cc9f0;
                font-weight: 600;
            }

            /* Stats */
            .res-stats {
                display: flex;
                gap: 16px;
                flex-shrink: 0;
            }
            .res-stat {
                text-align: center;
                min-width: 48px;
            }
            .res-stat-val {
                font-size: 1.3rem;
                font-weight: 800;
                color: #fff;
                display: block;
                line-height: 1.2;
            }
            .res-stat-val.count-up {
                transition: color 0.3s;
            }
            .res-stat-label {
                font-size: 0.7rem;
                color: #6b6b8d;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .res-card.rank-1 .res-stat-val {
                color: #ffd700;
            }

            /* Details Section */
            .res-details-toggle {
                display: block;
                margin: 0 auto 16px;
                padding: 10px 24px;
                background: transparent;
                border: 1px solid rgba(255,255,255,0.12);
                color: #a0a0c0;
                border-radius: 30px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: all 0.3s;
            }
            .res-details-toggle:hover {
                background: rgba(255,255,255,0.06);
                color: #fff;
                border-color: rgba(255,255,255,0.25);
            }
            .res-details-panel {
                display: none;
                background: rgba(0,0,0,0.25);
                border-radius: 14px;
                padding: 16px;
                margin-bottom: 20px;
                animation: resFadeIn 0.4s ease;
                overflow-x: auto;
            }
            .res-details-panel.visible { display: block; }
            .res-detail-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.85rem;
                min-width: 500px;
            }
            .res-detail-table th {
                text-align: right;
                padding: 8px 10px;
                color: #6b6b8d;
                font-weight: 600;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                white-space: nowrap;
            }
            .res-detail-table td {
                padding: 10px;
                border-bottom: 1px solid rgba(255,255,255,0.04);
                color: #c0c0e0;
            }
            .res-valid { color: #4ade80; }
            .res-invalid { color: #ef4444; text-decoration: line-through; opacity: 0.7; }

            /* Action Buttons */
            .res-actions {
                display: flex;
                gap: 12px;
                justify-content: center;
                flex-wrap: wrap;
                margin-top: 8px;
            }
            .res-btn {
                padding: 12px 28px;
                border-radius: 30px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: all 0.3s;
            }
            .res-btn-primary {
                background: linear-gradient(135deg, #4361ee, #3a0ca3);
                color: #fff;
                box-shadow: 0 4px 16px rgba(67,97,238,0.3);
            }
            .res-btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 24px rgba(67,97,238,0.4);
            }
            .res-btn-secondary {
                background: rgba(255,255,255,0.06);
                color: #a0a0c0;
                border: 1px solid rgba(255,255,255,0.12);
            }
            .res-btn-secondary:hover {
                background: rgba(255,255,255,0.1);
                color: #fff;
            }
            .res-waiting-msg {
                text-align: center;
                color: #6b6b8d;
                font-size: 0.9rem;
                padding: 8px;
                animation: resPulse 2s infinite;
            }

            /* Animations */
            @keyframes resFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes resCardSlide {
                from { opacity: 0; transform: translateX(30px); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes resBannerPop {
                0% { opacity: 0; transform: scale(0.8); }
                100% { opacity: 1; transform: scale(1); }
            }
            @keyframes resPulse {
                0%, 100% { opacity: 0.5; }
                50% { opacity: 1; }
            }

            /* Mobile */
            @media (max-width: 500px) {
                .res-screen { padding: 15px 10px 30px; }
                .res-header h1 { font-size: 1.5rem; }
                .res-card { padding: 14px; gap: 10px; flex-wrap: wrap; }
                .res-stats { width: 100%; justify-content: space-around; margin-top: 6px; }
                .res-rank { font-size: 1.4rem; min-width: 32px; }
                .res-avatar { width: 38px; height: 38px; font-size: 1rem; }
            }
        `;
        document.head.appendChild(style);
    }

    // ===== BUILD HTML =====
    let html = `<div class="res-screen">`;

    // Header
    html += `
        <div class="res-header">
            <h1>${isFinal ? '🏆 النتائج النهائية' : '🎉 نتائج الجولة'}</h1>
            <div class="res-round-info">
                <span class="round-progress">الجولة ${roundsPlayed} / ${roundsToPlay}</span>
                <span>• الحرف: <strong>${room.letter || '—'}</strong></span>
            </div>
        </div>
    `;

    // Final Banner (only on finished_game)
    if (isFinal && finalResult) {
        if (finalResult.type === 'winner') {
            html += `
                <div class="res-final-banner winner-banner">
                    <span class="banner-icon">🎉</span>
                    <div class="banner-text">🏆 الفائز: ${finalResult.name}</div>
                    <div class="banner-sub">مجموع النقاط: ${ranking[0].total} • الجولات المفازة: ${ranking[0].wins}</div>
                </div>
            `;
        } else {
            html += `
                <div class="res-final-banner draw-banner">
                    <span class="banner-icon">🤝</span>
                    <div class="banner-text">تعادل!</div>
                    <div class="banner-sub">كلا اللاعبين بنفس المستوى</div>
                </div>
            `;
        }
    }

    // Player Cards
    html += `<div class="res-cards">`;
    ranking.forEach((p, i) => {
        const rankIcon = rankIcons[i] || `#${i + 1}`;
        const rankClass = `rank-${i + 1}`;

        html += `
            <div class="res-card ${rankClass}">
                <div class="res-rank">${rankIcon}</div>
                <div class="res-avatar">${p.name.charAt(0).toUpperCase()}</div>
                <div class="res-info">
                    <div class="res-name">${p.name}</div>
                    <div class="res-round-score">نقاط الجولة: <span data-count="${p.roundScore}">0</span></div>
                </div>
                <div class="res-stats">
                    <div class="res-stat">
                        <span class="res-stat-val count-up" data-count="${p.total}">0</span>
                        <span class="res-stat-label">المجموع</span>
                    </div>
                    <div class="res-stat">
                        <span class="res-stat-val">${p.wins}</span>
                        <span class="res-stat-label">فوز</span>
                    </div>
                </div>
            </div>
        `;
    });
    html += `</div>`;

    // Details Toggle + Table
    const categories = [
        { id: 'boyName', label: 'ولد' },
        { id: 'girlName', label: 'بنت' },
        { id: 'vegetable', label: 'خضار' },
        { id: 'fruit', label: 'فواكه' },
        { id: 'object', label: 'جماد' },
        { id: 'animal', label: 'حيوان' },
        { id: 'country', label: 'بلاد' },
        { id: 'city', label: 'مدينة' },
        { id: 'job', label: 'مهنة' }
    ];

    // Check if we have answer data to show
    const playerAnswers = room.playerAnswers || {};
    const hasAnswers = Object.keys(playerAnswers).length > 0 || Object.keys(roundResults).length > 0;

    if (hasAnswers) {
        html += `
            <button class="res-details-toggle" onclick="document.getElementById('res-details').classList.toggle('visible')">
                📋 عرض تفاصيل الإجابات
            </button>
            <div id="res-details" class="res-details-panel">
                <table class="res-detail-table">
                    <thead>
                        <tr>
                            <th>اللاعب</th>
                            ${categories.map(c => `<th>${c.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        ranking.forEach(p => {
            const pid = p.playerId;
            const answers = playerAnswers[pid] || players[pid]?.answers || {};
            const validations = roundResults[pid] || {};

            html += `<tr><td style="font-weight:600;color:#fff">${p.name}</td>`;
            categories.forEach(cat => {
                const word = answers[cat.id] || '-';
                const isValid = validations[cat.id] === true;
                const cls = word === '-' ? '' : (isValid ? 'res-valid' : 'res-invalid');
                html += `<td class="${cls}">${word} ${word !== '-' ? (isValid ? '✅' : '❌') : ''}</td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
    }

    // Action Buttons - 🔴 FIX: Role-aware buttons
    html += `<div class="res-actions">`;
    if (isFinal) {
        // Final game: both players can request to play again
        html += `<button class="res-btn res-btn-primary" onclick="window.GameController.playAgain()">🔄 لعب من جديد</button>`;
    } else if (GameState.isHost) {
        // Host: Show "Next Round" button
        html += `<button class="res-btn res-btn-primary" onclick="window.GameController.playAgain()">⏭️ الجولة التالية</button>`;
    } else {
        // Guest: Show waiting indicator (disabled)
        html += `<button class="res-btn res-btn-primary" disabled style="opacity:0.6;cursor:default;">⏳ بانتظار المضيف</button>`;
    }
    html += `<button class="res-btn res-btn-secondary" onclick="window.GameController.leaveRoom()">🚪 خروج</button>`;
    html += `</div>`;

    html += `</div>`; // close .res-screen

    container.innerHTML = html;

    // ===== ANIMATE COUNT-UP =====
    requestAnimationFrame(() => {
        container.querySelectorAll('[data-count]').forEach(el => {
            const target = parseInt(el.dataset.count) || 0;
            if (target === 0) { el.textContent = '0'; return; }
            let current = 0;
            const step = Math.max(1, Math.ceil(target / 25));
            const interval = setInterval(() => {
                current += step;
                if (current >= target) {
                    current = target;
                    clearInterval(interval);
                }
                el.textContent = current;
            }, 30);
        });
    });
}

async function submitAnswers() {
    // Placeholder for UI-to-DB bridge
    const roomSnap = await getDatabase().ref('rooms/' + GameState.roomId).once('value');
    const room = roomSnap.val();
    const uiBuilder = window.GameEngine.UI_BUILDERS[room.mode];
    if (uiBuilder) {
        const answers = uiBuilder.getAnswers();
        await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}/answers`).set(answers);
        showToast('تم إرسال الإجابة!');
    }
}
