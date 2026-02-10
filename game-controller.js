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
        roundResults: null,
        currentRoundNumber: 1,
        totalRounds: parseInt(totalRounds) || 5,
        modeContext: modeContext,
        players: {
            [GameState.playerId]: {
                name,
                isHost: true,
                answers: {},
                score: 0,
                cumulativeScore: 0,
                eliminated: false,
                streak: 0,
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
        cumulativeScore: 0,
        eliminated: false,
        streak: 0,
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

        GameState.lastStatus = room.status;

        // 🔴 Play Again Logic (Host & Guest)
        if (room.playAgainRequest) {
            const { status, requestedBy } = room.playAgainRequest;
            const modal = document.getElementById('play-again-modal');

            // Host: Handle Accepted/Declined
            if (GameState.isHost) {
                if (status === 'accepted') {
                    // Only start if we haven't already (prevent double triggers)
                    // We check if we are still in 'status: accepted' to trigger the round start
                    // The startNewRound function will clear the request
                    startNewRound(room);
                } else if (status === 'declined') {
                    showToast('اللاعب رفض اللعب مرة أخرى', 'error');
                    getDatabase().ref(`rooms/${GameState.roomId}/playAgainRequest`).remove();
                    // Reset button UI
                    const btn = document.querySelector('#results-container button');
                    if (btn) {
                        btn.textContent = 'لعب مرة أخرى';
                        btn.disabled = false;
                        btn.classList.remove('btn-waiting');
                    }
                }
            }

            // Guest: Show Modal if Pending
            if (!GameState.isHost && status === 'pending' && requestedBy !== GameState.playerId) {
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
                if (!GameState.isHost) {
                    const container = document.getElementById('game-container');
                    if (container) container.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><p>جاري حساب النتائج...</p></div>';
                } else if (!room.roundResults) {
                    handleHostCalculation(room);
                }
                break;
            case 'results':
            case 'finished_game':
                if (!GameState.resultsShown) {
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

    const updates = {
        status: 'playing',
        letter: window.GameEngine.getRandomLetter(),
        roundId: 1,
        currentRoundNumber: 1,
        phase: firstPhase,
        phaseIndex: 0,
        phaseStartAt: firebase.database.ServerValue.TIMESTAMP,
        phaseDuration: modeConfig.durations[firstPhase] || 60,
        modeContext: modeContext,
        roundResults: null,
        stopLock: false
    };

    // Reset player round data
    Object.keys(room.players).forEach(pid => {
        updates[`players/${pid}/answers`] = {};
        updates[`players/${pid}/score`] = 0;
        updates[`players/${pid}/cumulativeScore`] = 0;
        updates[`players/${pid}/eliminated`] = false;
        updates[`players/${pid}/streak`] = 0;
    });

    await roomRef.update(updates);
}

/**
 * Play Again (Host only) - Initiates Request
 */
async function playAgain() {
    if (!GameState.roomId || !GameState.isHost) return;

    // Set request to pending
    await getDatabase().ref(`rooms/${GameState.roomId}/playAgainRequest`).set({
        requestedBy: GameState.playerId,
        status: 'pending',
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // UI Feedback for Host
    const btn = document.querySelector('#results-container button');
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

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const modeConfig = window.GameEngine.getModeConfig(room.mode);
    const firstPhase = modeConfig.phases[0];
    const modeContext = await buildModeContext(room.mode, modeConfig);

    const updates = {
        status: 'playing',
        letter: window.GameEngine.getRandomLetter(),
        roundId: (room.roundId || 0) + 1,
        currentRoundNumber: (room.currentRoundNumber || 0) + 1,
        phase: firstPhase,
        phaseIndex: 0,
        phaseStartAt: firebase.database.ServerValue.TIMESTAMP,
        phaseDuration: modeConfig.durations[firstPhase] || 60,
        modeContext: modeContext,
        roundResults: null,
        stopLock: false,
        playAgainRequest: null // Clear the request
    };

    // Reset round-specific data but keep cumulativeScore
    Object.keys(room.players).forEach(pid => {
        updates[`players/${pid}/answers`] = {};
        updates[`players/${pid}/score`] = 0;
        updates[`players/${pid}/eliminated`] = false;
        updates[`players/${pid}/streak`] = 0;
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

function startTimer(startAt, duration, room) {
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);

    // 🔴 FIX: Move element query INSIDE output to handle UI rebuilds
    const update = () => {
        const timerEl = document.getElementById('timer-value'); // Query fresh every tick

        // 🔴 Use server-synced time
        const now = Date.now() + (window.GameController.serverTimeOffset || 0);
        const elapsed = Math.floor((now - startAt) / 1000);
        const remaining = Math.max(0, duration - elapsed);

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

async function handleHostCalculation(room) {
    if (!GameState.isHost) return;

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);

    // 1. Collect all answers
    const players = room.players || {};
    const playerIds = Object.keys(players);
    const roundResults = {};

    try {
        // Prepare validation for each player
        for (const pid of playerIds) {
            const player = players[pid];
            const answers = player.answers || {};

            // 🔴 Use the REAL AI Validator from GameEngine
            const validation = await window.GameEngine.AI_VALIDATORS.validator(answers, room.letter, room);

            roundResults[pid] = {
                name: player.name,
                answers: validation.results,
                score: validation.score,
                cumulativeScore: (player.cumulativeScore || 0) + validation.score
            };

            // Update player's cumulative score in DB for persistence
            await roomRef.child(`players/${pid}`).update({
                cumulativeScore: roundResults[pid].cumulativeScore,
                score: validation.score
            });
        }

        // 2. Finalize round
        const isLastRound = room.currentRoundNumber >= room.totalRounds;
        await roomRef.update({
            roundResults: roundResults,
            status: isLastRound ? 'finished_game' : 'results'
        });

    } catch (e) {
        console.error('Calculation Error:', e);
        showToast('حدث خطأ في الحساب، تم الانتقال للنتائج', 'error');

        try {
            // 🔴 FIX: Ensure we always exit 'calculating' state
            // Use whatever results we have or empty object
            const isLastRound = room.currentRoundNumber >= room.totalRounds;
            await roomRef.update({
                roundResults: roundResults || {},
                status: isLastRound ? 'finished_game' : 'results'
            });
        } catch (updateError) {
            console.error('CRITICAL: Failed to recover from calculation error', updateError);
        }
    }
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
                // Handle Stop Button
                // Sync final answers immediately before stopping?
                // For now, just trigger end round via host or request stop
                if (GameState.isHost) {
                    // Host can stop immediately
                    handleTimeUp();
                } else {
                    showToast('المضيف فقط يمكنه إيقاف اللعبة حالياً');
                }
            },
            onSubmit: () => {
                // For Survival/Memory modes
            }
        });

        // 🔴 SETUP INPUT SYNC
        // Sync answers to Firebase as user types
        const inputs = document.getElementById('game-container').querySelectorAll('input, textarea');
        let debounceTimer;

        const syncAnswers = () => {
            const answers = uiBuilder.getAnswers();
            // Optimistic local update
            GameState.answers = answers;

            // Sync to Firebase
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const playerRef = getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`);
                playerRef.update({ answers: answers });
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
async function showResultsScreen(room, isFinal) {
    showScreen('results');
    const container = document.getElementById('results-container');
    if (!container) return;

    const results = room.roundResults || {};
    const playerIds = Object.keys(results);

    // Find winner
    let winnerId = null;
    let maxTotal = -1;
    playerIds.forEach(pid => {
        if (results[pid].cumulativeScore > maxTotal) {
            maxTotal = results[pid].cumulativeScore;
            winnerId = pid;
        }
    });

    let html = `
        <div class="results-header">
            <h3>${isFinal ? '🏆 النتائج النهائية' : '📊 نتائج الجولة'}</h3>
        </div>
        <div class="results-table-wrapper">
            <table class="results-table">
                <thead>
                    <tr>
                        <th>اللاعب</th>
                        <th>اسم ولد</th>
                        <th>اسم بنت</th>
                        <th>خضار</th>
                        <th>فواكه</th>
                        <th>جماد</th>
                        <th>حيوان</th>
                        <th>بلاد</th>
                        <th>مدينة</th>
                        <th>مهنة</th>
                        <th>النقاط</th>
                    </tr>
                </thead>
                <tbody>
    `;

    playerIds.forEach(pid => {
        const res = results[pid];
        const answers = res.answers || {};

        html += `
            <tr class="${pid === GameState.playerId ? 'is-me' : ''} ${isFinal && pid === winnerId ? 'winner-row' : ''}">
                <td class="player-name-cell">
                    ${res.name} 
                    ${isFinal && pid === winnerId ? '<span class="winner-crown">👑</span>' : ''}
                </td>
                ${['boyName', 'girlName', 'vegetable', 'fruit', 'object', 'animal', 'country', 'city', 'job'].map(catId => {
            const ansData = answers[catId] || { answer: '-', valid: false };
            return `<td class="${ansData.valid ? 'valid-ans' : 'invalid-ans'}" title="${catId}">
                        ${ansData.answer || '-'}
                    </td>`;
        }).join('')}
                <td class="total-score-cell">${res.score}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
        
        <div class="results-summary">
            ${playerIds.map(pid => `
                <div class="summary-card">
                    <div class="summary-name">${results[pid].name}</div>
                    <div class="summary-total">المجموع: ${results[pid].cumulativeScore}</div>
                </div>
            `).join('')}
        </div>

        <div class="results-actions">
    `;

    if (GameState.isHost) {
        html += `<button class="btn btn-primary" onclick="window.GameController.playAgain()">
            ${isFinal ? 'لعب من جديد 🔄' : 'الجولة التالية ⏭️'}
        </button>`;
    } else {
        html += `<p class="waiting-text">بانتظار المضيف لبدء الجولة التالية...</p>`;
    }

    html += `
            <button class="btn btn-secondary" onclick="window.GameController.leaveRoom()">خروج 🚪</button>
        </div>
    `;

    container.innerHTML = html;
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
