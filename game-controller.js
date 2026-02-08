/**
 * 🎮 تحدي الحروف - Game Controller
 * Handles Firebase integration and mode-specific game flow
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

    // Mode-specific context
    modeContext: {}
};

// 🔴 Expose to window for index.html
window.GameController = {
    state: GameState,
    createRoom,
    joinRoom,
    startGame,
    listenToRoom,
    leaveRoom,
    submitAnswers
};

// ==================== FIREBASE ====================
// 🔴 Use window.database set by index.html to avoid duplicate declaration
// The database is initialized in index.html's main script

function getDatabase() {
    return window.database || firebase.database();
}

// ==================== ROOM MANAGEMENT ====================

/**
 * Create a new room with specified mode
 * 🔴 Mode is REQUIRED - no default
 */
async function createRoom(name, mode) {
    // 🔴 CRITICAL: Mode must be provided
    if (!mode) {
        throw new Error('🔴 CRITICAL: mode must be specified');
    }

    const { MODES, getRandomLetter, getRandomCategory } = window.GameEngine;

    const code = generateRoomCode();
    // 🔴 reuse existing ID if set by index.html
    if (!GameState.playerId) {
        GameState.playerId = generatePlayerId();
    }
    GameState.playerName = name;
    GameState.isHost = true;
    GameState.roundId = 0;
    GameState.phase = null;
    GameState.phaseIndex = 0;

    // 🔴 CRITICAL: No fallback to classic
    if (!mode) {
        throw new Error('🔴 CRITICAL FAILURE: mode is undefined');
    }
    const modeConfig = MODES[mode];
    if (!modeConfig) {
        throw new Error(`🔴 CRITICAL FAILURE: No configuration for mode "${mode}"`);
    }
    console.log(`🎮 Creating room with mode: ${mode}`, modeConfig);

    // Build mode-specific context
    const modeContext = buildModeContext(mode, modeConfig);

    await getDatabase().ref('rooms/' + code).set({
        code,
        status: 'waiting',
        mode: mode,
        modeName: modeConfig.name,
        letter: '',
        roundId: 0,
        // 🔴 CRITICAL: These must exist before any logic runs
        phases: modeConfig.phases,
        phaseIndex: 0,
        totalPhases: modeConfig.phases.length,
        phase: null,
        phaseStartAt: null,
        phaseDuration: 60,
        stoppedBy: '',
        stopLock: false,
        roundResults: null,
        // 🔴 Mode-specific container - isolated per mode
        modeContext: modeContext,
        players: {
            [GameState.playerId]: {
                name,
                isHost: true,
                answers: {},
                totalScore: 0,
                eliminated: false, // For survival mode
                streak: 0 // For survival mode
            }
        }
    });

    GameState.roomId = code;
    setupPresence();
    listenToRoom(); // 🔴 ERROR 1 FIX: Start listener immediately
    return code;
}

/**
 * Build mode-specific context data
 */
function buildModeContext(mode, modeConfig) {
    const { CATEGORIES, getRandomLetter, getRandomCategory } = window.GameEngine;

    switch (mode) {
        case 'survival':
            return {
                currentCategory: getRandomCategory(),
                roundNumber: 0,
                eliminatedPlayers: []
            };

        case 'memory':
            return {
                words: generateMemoryWords(5),
                showDuration: modeConfig.durations.show,
                recallDuration: modeConfig.durations.recall
            };

        case 'bluff':
            return {
                category: getRandomCategory(),
                anonymousAnswers: [],
                votes: {},
                liar: null // Set randomly when game starts
            };

        case 'objective':
            return {
                constraints: generateObjectiveConstraints()
            };

        default:
            return {};
    }
}

/**
 * Generate random words for memory mode
 */
function generateMemoryWords(count) {
    const wordBank = [
        'أسد', 'نمر', 'فيل', 'زرافة', 'قرد',
        'تفاح', 'موز', 'برتقال', 'عنب', 'رمان',
        'طبيب', 'مهندس', 'معلم', 'طيار', 'شرطي',
        'قمر', 'شمس', 'نجم', 'سماء', 'بحر',
        'كتاب', 'قلم', 'ورقة', 'مكتب', 'كرسي'
    ];

    const shuffled = wordBank.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

/**
 * Generate constraints for objective mode
 */
function generateObjectiveConstraints() {
    const letter = window.GameEngine.ARABIC_LETTERS[Math.floor(Math.random() * window.GameEngine.ARABIC_LETTERS.length)];
    const containsLetter = window.GameEngine.ARABIC_LETTERS[Math.floor(Math.random() * window.GameEngine.ARABIC_LETTERS.length)];
    const length = Math.floor(Math.random() * 3) + 3; // 3-5 letters

    return [
        { type: 'startsWith', value: letter, label: `يبدأ بحرف ${letter}` },
        { type: 'contains', value: containsLetter, label: `يحتوي على حرف ${containsLetter}` },
        { type: 'length', value: length, label: `من ${length} أحرف` }
    ];
}

/**
 * Join an existing room
 */
async function joinRoom(code, name) {
    const snap = await getDatabase().ref('rooms/' + code).once('value');
    if (!snap.exists()) throw new Error('الغرفة غير موجودة');

    const room = snap.val();
    if (room.status !== 'waiting') throw new Error('اللعبة بدأت');
    if (Object.keys(room.players || {}).length >= 2) throw new Error('الغرفة ممتلئة');

    // 🔴 reuse existing ID if set by index.html
    if (!GameState.playerId) {
        GameState.playerId = generatePlayerId();
    }
    GameState.playerName = name;
    GameState.isHost = false;
    GameState.roundId = room.roundId || 0;
    GameState.phase = room.phase || null;
    GameState.phaseIndex = room.phaseIndex || 0;

    await getDatabase().ref(`rooms/${code}/players/${GameState.playerId}`).set({
        name,
        isHost: false,
        answers: {},
        totalScore: 0,
        eliminated: false,
        streak: 0
    });

    GameState.roomId = code;
    setupPresence();
    listenToRoom(); // 🔴 ERROR 1 & 5 FIX: Start listener to detect start
}

/**
 * Start the game (host only)
 * 🔴 ERROR 4 consolidated version
 */
async function startGame() {
    if (!GameState.roomId || !GameState.isHost) return;

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const roomSnap = await roomRef.once('value');
    if (!roomSnap.exists()) return;
    const room = roomSnap.val();

    const mode = room.mode;
    const modeConfig = window.GameEngine.getModeConfig(mode);
    const firstPhase = modeConfig.phases[0];

    // 🔴 ERROR 9 FIX: Context must be refreshed per round if needed
    // Calculate context BEFORE updating status to avoid race conditions
    const modeContext = buildModeContext(mode, modeConfig);

    // For bluff mode, randomly assign liar
    if (mode === 'bluff') {
        const playerIds = Object.keys(room.players || {});
        modeContext.liar = playerIds[Math.floor(Math.random() * playerIds.length)];
    }

    // 🔴 CRITICAL: Prepare all updates including modeContext
    const updates = {
        status: 'playing',
        letter: window.GameEngine.getRandomLetter(),
        roundId: (room.roundId || 0) + 1,
        phases: modeConfig.phases,
        phaseIndex: 0,
        totalPhases: modeConfig.phases.length,
        phase: firstPhase,
        phaseStartAt: firebase.database.ServerValue.TIMESTAMP,
        phaseDuration: modeConfig.durations[firstPhase] || 60,
        stoppedBy: '',
        stopLock: false,
        roundResults: null,
        modeContext: modeContext // 🔴 Ensure this is sent with status: playing
    };

    // Reset players
    if (room.players) {
        Object.keys(room.players).forEach(pid => {
            updates[`players/${pid}/answers`] = null;
            updates[`players/${pid}/eliminated`] = false;
            updates[`players/${pid}/streak`] = 0;
            // Clear previous mode props if needed
        });
    }

    await roomRef.update(updates);
}

// ==================== GAME FLOW ====================

/**
 * Main room listener
 */
function listenToRoom() {
    if (!GameState.roomId) return;

    // Prevent duplicate listeners
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

        // 🔴 CRITICAL: Update global mode tracking
        if (room.mode) {
            window.currentMode = room.mode;
        }

        // 🔴 CRITICAL: Validate room state before any logic
        const validation = window.GameEngine.validateRoomState(room);
        if (!validation.valid && room.status === 'playing') {
            console.error('🔴 CRITICAL: Invalid room state', validation.errors);
            return;
        }

        const roomRoundId = room.roundId || 0;
        const roomPhaseIndex = room.phaseIndex || 0;

        // Update body data attribute for CSS
        document.body.setAttribute('data-mode', room.mode);
        document.body.setAttribute('data-phase', room.phase || '');

        // Check for host transfer
        const myPlayerData = room.players?.[GameState.playerId];
        if (myPlayerData?.isHost && !GameState.isHost) {
            GameState.isHost = true;
            showToast('أصبحت المضيف الجديد! 👑');
        }

        // New round detection
        if (roomRoundId > GameState.roundId) {
            GameState.roundId = roomRoundId;
            GameState.phase = room.phase || null;
            GameState.phaseIndex = 0;
            GameState.resultsShown = false;
        }

        // Phase change within same round
        if (roomPhaseIndex !== GameState.phaseIndex && room.status === 'playing') {
            GameState.phaseIndex = roomPhaseIndex;
            GameState.phase = room.phase || null;
            if (GameState.timerInterval) {
                clearInterval(GameState.timerInterval);
                GameState.timerInterval = null;
            }
            const phaseConfig = window.GameEngine.getPhaseConfig(room.phase);
            showToast(`🔄 مرحلة ${phaseConfig?.name || room.phase}`);
        }

        // Player count update
        const count = Object.keys(room.players || {}).length;
        const countEl = document.getElementById('players-count');
        if (countEl) countEl.textContent = `اللاعبون: ${count}/2`;

        // Handle game states
        switch (room.status) {
            case 'waiting':
                GameState.resultsShown = false;
                showScreen('waiting'); // 🔴 Ensure waiting screen is shown
                if (count === 2 && GameState.isHost) {
                    setTimeout(() => startGame(), 1000);
                }
                break;

            case 'playing':
                // 🔴 CRITICAL: Immediate switch for guest
                showGameScreen(room);
                break;

            case 'finished':
                if (!GameState.resultsShown) {
                    GameState.resultsShown = true;
                    await submitAnswers(room);
                    await new Promise(resolve => setTimeout(resolve, 800));
                    const freshSnap = await getDatabase().ref('rooms/' + GameState.roomId).once('value');
                    if (freshSnap.exists()) {
                        await showResultsScreen(freshSnap.val());
                    }
                }
                break;

            case 'calculating':
                if (GameState.isHost) {
                    const results = await calculateResults(room);
                    await getDatabase().ref('rooms/' + GameState.roomId).update({
                        roundResults: results,
                        status: 'results'
                    });
                } else {
                    // Guest shows loading state if needed, or wait for results
                    const container = document.getElementById('results-container');
                    if (container && document.getElementById('results-screen').classList.contains('active')) {
                        container.innerHTML = '<div class="ai-loading"><p>جاري حساب النتائج...</p></div>';
                    }
                }
                break;

            case 'results':
                if (!GameState.resultsShown) {
                    GameState.resultsShown = true;
                    await showResultsScreen(room);
                }
                break;
        }
    });
}

/**
 * Show game screen based on current mode
 * 🔴 USES renderGameUI AS SINGLE ENTRY POINT
 */
function showGameScreen(room) {
    showScreen('game');

    // 🔴 CRITICAL: Validate mode exists
    if (!room || !room.mode) {
        throw new Error('🔴 CRITICAL FAILURE: room.mode is undefined');
    }

    // Update state
    GameState.phase = room.phase || null;
    GameState.phaseIndex = room.phaseIndex || 0;

    // Build UI on new round OR new phase (for modes like Memory/Bluff)
    const roomRoundId = room.roundId || 0;
    const currentPhase = room.phase;

    // Check if full rebuild is needed
    // 🔴 ERROR 3 & 8 FIX: Always rebuild if UI state is empty OR round/phase change
    const needsRebuild =
        !GameState.lastDisplayedMode ||
        room.mode !== GameState.lastDisplayedMode ||
        roomRoundId > GameState.lastDisplayedRoundId ||
        currentPhase !== GameState.lastDisplayedPhase;

    if (needsRebuild) {
        GameState.lastDisplayedMode = room.mode;
        GameState.lastDisplayedRoundId = roomRoundId;
        GameState.lastDisplayedPhase = currentPhase;

        console.log(`🎮 showGameScreen: Rebuilding UI for mode "${room.mode}" phase "${currentPhase}"`);

        // 🔴 CRITICAL: Use SINGLE ENTRY POINT for UI
        window.GameEngine.renderGameUI(room);

        // 🔴 Setup mode-specific event handlers
        setupModeEventHandlers(room);
    }

    // Update phase-specific elements
    updatePhaseState(room);

    // Start timer
    if (!GameState.timerInterval && room.phaseStartAt) {
        GameState.phaseStartAt = room.phaseStartAt;
        startTimer(room.phaseStartAt, room.phaseDuration || 60, room);
    }
}

/**
 * Setup mode-specific event handlers
 * 🔴 Uses GameEngine.setupModeHandler for strict isolation
 */
function setupModeEventHandlers(room) {
    const callbacks = {
        // Classic & Multiphase
        onStop: () => pressStop(room),

        // Survival
        onSubmit: () => submitSurvivalAnswer(room),

        // Memory (onSubmit also used for Survival but context differs)
        // Memory uses submitAnswers which is general but strict inside
        onMemorySubmit: () => submitAnswers(room),

        // Bluff
        onVote: () => submitBluffVote(room),

        // Objective
        onObjectiveSubmit: () => checkObjectiveConstraints(room),
        onInput: () => liveCheckConstraints(room)
    };

    // Map specific callbacks for generic handler names if needed
    // GameEngine expects: onStop, onSubmit, onVote, onInput

    // Create a mode-specific callback map
    const modeCallbacks = {};
    const mode = room.mode;

    if (mode === 'memory') modeCallbacks.onSubmit = callbacks.onMemorySubmit;
    else if (mode === 'objective') modeCallbacks.onSubmit = callbacks.onObjectiveSubmit;
    else modeCallbacks.onSubmit = callbacks.onSubmit;

    modeCallbacks.onStop = callbacks.onStop;
    modeCallbacks.onVote = callbacks.onVote;
    modeCallbacks.onInput = callbacks.onInput;

    window.GameEngine.setupModeHandler(room, modeCallbacks);
}

/**
 * Handle Stop button press
 */
async function pressStop(room) {
    if (!GameState.isHost) return;

    // Check lock or permission
    const isAllowed = window.GameEngine.isStopAllowed(room);
    if (!isAllowed || room.stopLock) return;

    await getDatabase().ref('rooms/' + GameState.roomId).update({
        status: 'calculating',
        stoppedBy: GameState.playerName,
        stopLock: true
    });
}



/**
 * Update phase-specific state
 */
function updatePhaseState(room) {
    const stopBtn = document.getElementById('stop-btn');
    if (!stopBtn) return;

    const isStopAllowed = window.GameEngine.isStopAllowed(room);

    if (!isStopAllowed) {
        if (room.phase === 'speed') {
            stopBtn.style.display = 'none';
        } else {
            stopBtn.style.display = 'block';
            stopBtn.disabled = true;
            stopBtn.classList.add('locked');
        }
    } else {
        stopBtn.style.display = 'block';
        stopBtn.disabled = false;
        stopBtn.classList.remove('locked');
    }
}

// ==================== MODE-SPECIFIC SUBMISSIONS ====================

/**
 * Submit survival mode answer
 */
async function submitSurvivalAnswer(room) {
    const input = document.getElementById('survival-input');
    if (!input) return;

    const answer = input.value.trim();
    const modeContext = room.modeContext || {};
    const category = modeContext.currentCategory;

    // 🔴 AI as instant judge - true/false only
    const validator = window.GameEngine.AI_VALIDATORS['instant-judge'];
    const result = await validator(answer, room.letter, room);

    if (result.valid) {
        // Correct - increment streak, next category
        showToast('✅ صحيح!', 'success');
        await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`).update({
            streak: firebase.database.ServerValue.increment(1)
        });

        if (GameState.isHost) {
            // Move to next category
            const nextCategory = window.GameEngine.getRandomCategory();
            await getDatabase().ref(`rooms/${GameState.roomId}/modeContext/currentCategory`).set(nextCategory);
            await getDatabase().ref(`rooms/${GameState.roomId}/phaseStartAt`).set(firebase.database.ServerValue.TIMESTAMP);
        }
    } else {
        // Wrong - eliminate player
        showToast('❌ خطأ! خرجت من اللعبة', 'error');
        await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}/eliminated`).set(true);

        // Check if game should end
        checkSurvivalEnd(room);
    }

    input.value = '';
}

/**
 * Check if survival game should end
 */
async function checkSurvivalEnd(room) {
    const players = room.players || {};
    const alivePlayers = Object.entries(players).filter(([id, p]) => !p.eliminated);

    if (alivePlayers.length <= 1 && GameState.isHost) {
        await getDatabase().ref(`rooms/${GameState.roomId}`).update({
            status: 'calculating',
            stoppedBy: alivePlayers.length === 1 ? alivePlayers[0][1].name : 'لا يوجد فائز'
        });
    }
}

/**
 * Submit bluff vote
 */
async function submitBluffVote(room) {
    const selectedVote = document.querySelector('input[name="bluff-vote"]:checked');
    if (!selectedVote) {
        showToast('اختر إجابة للتصويت عليها', 'error');
        return;
    }

    await getDatabase().ref(`rooms/${GameState.roomId}/modeContext/votes/${GameState.playerId}`).set(parseInt(selectedVote.value));
    showToast('تم التصويت!');
}

/**
 * Live check objective constraints
 */
function liveCheckConstraints(room) {
    const input = document.getElementById('objective-input');
    if (!input) return;

    const answer = input.value.trim();
    const modeContext = room.modeContext || {};
    const constraints = modeContext.constraints || [];

    const validator = window.GameEngine.AI_VALIDATORS['constraint-validator'];
    const { results } = validator(answer, constraints);

    constraints.forEach(c => {
        const statusEl = document.getElementById('constraint-' + c.type);
        if (statusEl) {
            if (results[c.type] === true) {
                statusEl.textContent = '✅';
                statusEl.className = 'constraint-status pass';
            } else if (results[c.type] === false) {
                statusEl.textContent = '❌';
                statusEl.className = 'constraint-status fail';
            } else {
                statusEl.textContent = '❓';
                statusEl.className = 'constraint-status';
            }
        }
    });
}

/**
 * Check objective constraints on submit
 */
async function checkObjectiveConstraints(room) {
    const input = document.getElementById('objective-input');
    if (!input) return;

    const answer = input.value.trim();
    const modeContext = room.modeContext || {};
    const constraints = modeContext.constraints || [];

    const validator = window.GameEngine.AI_VALIDATORS['constraint-validator'];
    const { passed, results } = validator(answer, constraints);

    await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}/answers`).set({
        answer,
        passed,
        results
    });

    if (passed) {
        showToast('🎉 صحيح!', 'success');
        // End game - player solved it
        if (GameState.isHost) {
            await getDatabase().ref(`rooms/${GameState.roomId}`).update({
                status: 'finished',
                stoppedBy: GameState.playerName
            });
        }
    } else {
        showToast('❌ لم تستوفِ جميع الشروط', 'error');
    }
}

/**
 * Submit answers (generic)
 * 🔴 CRITICAL: No fallback to classic
 */
async function submitAnswers(room) {
    if (!GameState.roomId || !GameState.playerId) return;

    const mode = room.mode;
    if (!mode) {
        throw new Error('🔴 CRITICAL FAILURE: room.mode is undefined');
    }
    const uiBuilder = window.GameEngine.UI_BUILDERS[mode];
    if (!uiBuilder) {
        throw new Error(`🔴 CRITICAL FAILURE: No UI_BUILDER for mode "${mode}"`);
    }

    const answers = uiBuilder.getAnswers();
    await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}/answers`).set(answers);
}

/**
 * Press STOP button
 */
async function pressStop(room) {
    if (!GameState.roomId) return;

    // 🔴 CRITICAL: Check if STOP is allowed
    if (!window.GameEngine.isStopAllowed(room)) {
        const phaseConfig = window.GameEngine.getPhaseConfig(room.phase);
        showToast(`STOP غير متاح في مرحلة ${phaseConfig?.name || room.phase}`, 'error');
        return;
    }

    // Anti-cheat: minimum 5 seconds before STOP
    if (GameState.phaseStartAt > 0) {
        const elapsed = (Date.now() - GameState.phaseStartAt) / 1000;
        if (elapsed < 5) {
            showToast('انتظر ' + Math.ceil(5 - elapsed) + ' ثواني', 'error');
            return;
        }
    }

    await submitAnswers(room);

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);

    try {
        await roomRef.transaction((r) => {
            if (!r) return r;
            if (r.status !== 'playing' || r.stopLock) return;

            r.status = 'finished';
            r.stoppedBy = GameState.playerName;
            r.stopLock = true;
            return r;
        });
    } catch (e) {
        // Someone else pressed STOP first
    }
}

// ==================== TIMER ====================

function startTimer(roundStartAt, duration, room) {
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);

    const timerEl = document.getElementById('timer-value');
    if (!timerEl) return;

    function updateTimer() {
        const now = Date.now();
        const elapsed = Math.floor((now - roundStartAt) / 1000);
        const remaining = Math.max(0, duration - elapsed);

        timerEl.textContent = remaining;

        // Color coding
        if (remaining <= 10) timerEl.className = 'timer-value danger';
        else if (remaining <= 20) timerEl.className = 'timer-value warning';
        else timerEl.className = 'timer-value';

        // Time up
        if (remaining <= 0) {
            clearInterval(GameState.timerInterval);
            GameState.timerInterval = null;
            handleTimeUp(room);
        }
    }

    updateTimer();
    GameState.timerInterval = setInterval(updateTimer, 1000);
}

async function handleTimeUp(room) {
    await submitAnswers(room);

    if (GameState.isHost) {
        const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
        const roomSnap = await roomRef.once('value');
        const currentRoom = roomSnap.val();

        if (!currentRoom || currentRoom.stopLock) return;

        const phases = currentRoom.phases || ['accuracy'];
        const currentIdx = currentRoom.phaseIndex || 0;
        const isLastPhase = currentIdx >= phases.length - 1;

        if (isLastPhase) {
            await roomRef.transaction((r) => {
                if (!r || r.stopLock) return r;
                r.status = 'finished';
                r.stoppedBy = 'انتهى الوقت';
                r.stopLock = true;
                return r;
            });
        } else {
            await nextPhase(currentRoom);
        }
    }
}

async function nextPhase(room) {
    if (!GameState.roomId || !GameState.isHost) return;

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);

    try {
        await roomRef.transaction((r) => {
            if (!r) return r;

            const phases = r.phases || ['accuracy'];
            const currentIdx = r.phaseIndex || 0;
            const nextIdx = currentIdx + 1;

            if (nextIdx >= phases.length) return r;

            const nextPhaseName = phases[nextIdx];
            // 🔴 CRITICAL: No fallback to classic
            if (!r.mode) {
                console.error('🔴 CRITICAL FAILURE: r.mode is undefined in transaction');
                return r;
            }
            const modeConfig = window.GameEngine.MODES[r.mode];
            if (!modeConfig) {
                console.error(`🔴 CRITICAL FAILURE: No configuration for mode "${r.mode}"`);
                return r;
            }
            const duration = modeConfig.durations[nextPhaseName] || 60;

            r.phaseIndex = nextIdx;
            r.phase = nextPhaseName;
            r.phaseStartAt = firebase.database.ServerValue.TIMESTAMP;
            r.phaseDuration = duration;
            r.stopLock = false;

            return r;
        });
    } catch (e) {
        console.error('Error transitioning phase:', e);
    }
}

// ==================== RESULTS ====================

async function showResultsScreen(room) {
    if (GameState.timerInterval) {
        clearInterval(GameState.timerInterval);
        GameState.timerInterval = null;
    }

    // 🔴 CRITICAL: No fallback
    const mode = room.mode;
    if (!mode) {
        throw new Error('🔴 CRITICAL FAILURE: room.mode is undefined');
    }
    const uiBuilder = window.GameEngine.UI_BUILDERS[mode];
    if (!uiBuilder) {
        throw new Error(`🔴 CRITICAL FAILURE: No UI_BUILDER for mode "${mode}"`);
    }
    uiBuilder.disableInputs();

    showScreen('results');

    const container = document.getElementById('results-container');
    container.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><p>جاري التحقق من الإجابات...</p></div>';

    let roundResults = room.roundResults;

    // 🔴 Mode-specific result calculation
    if (!roundResults && GameState.isHost) {
        roundResults = await calculateResults(room);
        await getDatabase().ref(`rooms/${GameState.roomId}/roundResults`).set(roundResults);
        await getDatabase().ref(`rooms/${GameState.roomId}/status`).set('results');
    } else if (!roundResults) {
        // Wait for host's results
        return new Promise((resolve) => {
            const resultsListener = getDatabase().ref(`rooms/${GameState.roomId}/roundResults`).on('value', (snap) => {
                if (snap.val()) {
                    getDatabase().ref(`rooms/${GameState.roomId}/roundResults`).off('value', resultsListener);
                    displayResults(room, snap.val());
                    resolve();
                }
            });

            setTimeout(() => {
                getDatabase().ref(`rooms/${GameState.roomId}/roundResults`).off('value', resultsListener);
                container.innerHTML = '<p>حدث خطأ في التحقق</p>';
                resolve();
            }, 30000);
        });
    }

    displayResults(room, roundResults);
}

/**
 * Calculate results based on mode
 */
async function calculateResults(room) {
    // 🔴 CRITICAL: No fallback to classic
    const mode = room.mode;
    if (!mode) {
        throw new Error('🔴 CRITICAL FAILURE: room.mode is undefined');
    }
    const results = {};

    switch (mode) {
        case 'survival':
            // Survival: Show elimination order and streaks
            for (const [pid, pdata] of Object.entries(room.players || {})) {
                results[pid] = {
                    eliminated: pdata.eliminated,
                    streak: pdata.streak || 0,
                    score: pdata.eliminated ? 0 : (pdata.streak || 0) * 10
                };
            }
            break;

        case 'memory':
            // Memory: Compare remembered words
            const correctWords = room.modeContext?.words || [];
            for (const [pid, pdata] of Object.entries(room.players || {})) {
                const playerWords = pdata.answers?.words || [];
                const validator = window.GameEngine.AI_VALIDATORS['string-compare'];
                const memResult = validator(playerWords, correctWords);
                results[pid] = {
                    correct: memResult.correct,
                    total: memResult.total,
                    score: memResult.score
                };
            }
            break;

        case 'bluff':
            // Bluff: Check votes and reveal liar
            const liarId = room.modeContext?.liar;
            const votes = room.modeContext?.votes || {};
            for (const [pid, pdata] of Object.entries(room.players || {})) {
                const votedCorrectly = Object.entries(votes).some(([voterId, voteIdx]) => {
                    // Check if they voted for the liar
                    // This is simplified - would need anonymous answer mapping
                    return voterId === pid;
                });
                results[pid] = {
                    answer: pdata.answers?.answer || '',
                    wasLiar: pid === liarId,
                    score: pid === liarId ? 0 : 10 // Simplified scoring
                };
            }
            break;

        case 'objective':
            // Objective: Check constraint solutions
            for (const [pid, pdata] of Object.entries(room.players || {})) {
                results[pid] = {
                    answer: pdata.answers?.answer || '',
                    passed: pdata.answers?.passed || false,
                    score: pdata.answers?.passed ? 50 : 0
                };
            }
            break;

        case 'classic':
        case 'multiphase':
            // Classic/Multiphase: Full category validation
            const letter = room.letter;
            for (const [pid, pdata] of Object.entries(room.players || {})) {
                const { score, results: ansResults } = await window.GameEngine.AI_VALIDATORS.validator(pdata.answers || {}, letter, room);
                results[pid] = { score, answers: ansResults };
            }
            break;

        // 🔴 NO default - mode must be explicit
    }

    return results;
}

/**
 * Generic submit wrapper for modes that just need to save answers
 */
async function submitAnswers(room) {
    if (!room) return;
    const uiBuilder = window.GameEngine.UI_BUILDERS[room.mode];
    if (uiBuilder) {
        let answers = uiBuilder.getAnswers();

        // 🔴 ERROR 7 FIX: Clean data before sending to Firebase
        if (!answers || typeof answers !== 'object') answers = {};

        await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}/answers`).set(answers);
        showToast('تم الإرسال!');
    }
}

/**
 * Handle Time Up signal
 * 🔴 Centralized logic for phase transitions and timeouts
 */
async function handleTimeUp() {
    console.log('⏰ Time Up!');

    // 1. Submit current inputs
    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const roomSnap = await roomRef.once('value');
    if (!roomSnap.exists()) return;
    const room = roomSnap.val();

    // Submit answers before transition
    try {
        const uiBuilder = window.GameEngine.UI_BUILDERS[room.mode];
        if (uiBuilder) {
            let answers = uiBuilder.getAnswers();
            // Validate answers object
            if (!answers || typeof answers !== 'object') answers = {};

            // 🔴 Use set to overwrite instead of update to avoid merging old data from prev rounds
            await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}/answers`).set(answers);
        }
    } catch (err) {
        console.error('Error submitting answers in handleTimeUp:', err);
        // Continue execution - failing to submit shouldn't block game flow
    }

    // 2. Host handles transitions
    if (!GameState.isHost) return;

    try {
        await roomRef.transaction((r) => {
            if (!r || r.stopLock) return r;

            const mode = r.mode;
            const phases = r.phases || [];
            const currentIdx = r.phaseIndex || 0;
            const currentPhase = r.phase;

            // Mode-specific Phase End Logic
            if (mode === 'bluff') {
                if (currentPhase === 'answer') {
                    const anonymousAnswers = [];
                    Object.entries(r.players || {}).forEach(([pid, p]) => {
                        const ans = p.answers?.answer;
                        if (ans) anonymousAnswers.push({ text: ans, ownerId: pid });
                    });
                    // Shuffle
                    for (let i = anonymousAnswers.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [anonymousAnswers[i], anonymousAnswers[j]] = [anonymousAnswers[j], anonymousAnswers[i]];
                    }
                    if (!r.modeContext) r.modeContext = {};
                    r.modeContext.anonymousAnswers = anonymousAnswers;
                } else if (currentPhase === 'vote') {
                    // Prepare Reveal Data
                    const reveals = [];
                    const letter = r.letter; // Basic sync validation
                    const ann = r.modeContext.anonymousAnswers || [];

                    ann.forEach(a => {
                        const pName = r.players && r.players[a.ownerId] ? r.players[a.ownerId].name : '???';
                        const text = a.text || '';
                        // Simple sync validation: just check first letter match
                        // This is "Is it a lie?" metric locally
                        const valid = text.length >= 1 && text.charAt(0) === letter;
                        reveals.push({
                            playerName: pName,
                            answer: text,
                            wasLying: !valid
                        });
                    });
                    r.modeContext.reveals = reveals;
                }
            }

            const isLastPhase = currentIdx >= phases.length - 1;

            if (isLastPhase) {
                r.status = 'calculating';
                r.stoppedBy = 'انتهى الوقت';
                r.stopLock = true;
            } else {
                const nextIdx = currentIdx + 1;
                const nextPhaseName = phases[nextIdx];
                const modeConfig = window.GameEngine.getModeConfig(mode);
                const duration = modeConfig.durations[nextPhaseName] || 60;

                r.phaseIndex = nextIdx;
                r.phase = nextPhaseName;
                r.phaseStartAt = firebase.database.ServerValue.TIMESTAMP;
                r.phaseDuration = duration;
                r.stopLock = false;
            }

            return r;
        });
    } catch (e) {
        console.error('🔴 Transaction Failed in handleTimeUp:', e);
    }
}

/**
 * Display results based on mode
 */
function displayResults(room, roundResults) {
    const mode = room.mode;
    if (!mode) {
        throw new Error('🔴 CRITICAL FAILURE: room.mode is undefined');
    }
    const container = document.getElementById('results-container');

    switch (mode) {
        case 'classic':
            displayClassicResults(container, room, roundResults);
            break;
        case 'multiphase':
            displayMultiphaseResults(container, room, roundResults);
            break;
        case 'survival':
            displaySurvivalResults(container, room, roundResults);
            break;
        case 'memory':
            displayMemoryResults(container, room, roundResults);
            break;
        case 'bluff':
            displayBluffResults(container, room, roundResults);
            break;
        case 'objective':
            displayObjectiveResults(container, room, roundResults);
            break;
    }

    // Add Play Again button for Host
    if (GameState.isHost) {
        const actionDiv = document.createElement('div');
        actionDiv.className = 'results-actions';
        actionDiv.style.marginTop = '20px';
        actionDiv.innerHTML = `
            <button class="btn btn-primary" onclick="window.GameController.playAgain()">
                🔄 لعب مجدداً
            </button>
        `;
        container.appendChild(actionDiv);
    }
}

// Mode-specific result displays
function displaySurvivalResults(container, room, results) {
    const players = Object.entries(room.players || {}).map(([id, p]) => ({
        id, name: p.name, ...results[id], isMe: id === GameState.playerId
    })).sort((a, b) => b.streak - a.streak);

    const winner = players.find(p => !p.eliminated);

    document.getElementById('winner-banner').textContent = winner
        ? `🏆 الفائز: ${winner.name} (سلسلة ${winner.streak})`
        : '💀 الجميع خرجوا!';

    container.innerHTML = `
        <div class="survival-results">
            ${players.map(p => `
                <div class="elimination-card ${p.eliminated ? 'dead' : 'alive'}">
                    <span>${p.eliminated ? '💀' : '❤️'}</span>
                    <span class="player-name">${p.name}</span>
                    <span class="streak">🔥 ${p.streak}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function displayMemoryResults(container, room, results) {
    const players = Object.entries(room.players || {}).map(([id, p]) => ({
        id, name: p.name, ...results[id], isMe: id === GameState.playerId
    })).sort((a, b) => b.score - a.score);

    const maxScore = Math.max(...players.map(p => p.score));
    const winners = players.filter(p => p.score === maxScore);

    document.getElementById('winner-banner').textContent = winners.length === 1
        ? `🧠 الفائز: ${winners[0].name} (${winners[0].correct}/${winners[0].total})`
        : '🤝 تعادل!';

    container.innerHTML = `
        <div class="memory-results">
            ${players.map(p => `
                <div class="memory-result-card ${p.isMe ? 'me' : ''}">
                    <div class="player-name">${p.name}</div>
                    <div class="memory-score">${p.correct}/${p.total} كلمات</div>
                    <div class="points">${p.score} نقطة</div>
                </div>
            `).join('')}
        </div>
    `;
}

function displayBluffResults(container, room, results) {
    const players = Object.entries(room.players || {}).map(([id, p]) => ({
        id, name: p.name, ...results[id], isMe: id === GameState.playerId
    }));

    const liar = players.find(p => p.wasLiar);

    document.getElementById('winner-banner').textContent = `🎭 الكاذب كان: ${liar?.name || 'مجهول'}`;

    container.innerHTML = `
        <div class="bluff-results">
            ${players.map(p => `
                <div class="reveal-card ${p.wasLiar ? 'liar' : 'honest'}">
                    <div class="reveal-player">${p.name}</div>
                    <div class="reveal-answer">${p.answer}</div>
                    <div class="reveal-status">${p.wasLiar ? '🤥 كاذب' : '😇 صادق'}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function displayObjectiveResults(container, room, results) {
    const players = Object.entries(room.players || {}).map(([id, p]) => ({
        id, name: p.name, ...results[id], isMe: id === GameState.playerId
    }));

    const solver = players.find(p => p.passed);

    document.getElementById('winner-banner').textContent = solver
        ? `🧩 حلها: ${solver.name}`
        : 'لم يحلها أحد!';

    container.innerHTML = `
        <div class="objective-results">
            ${players.map(p => `
                <div class="objective-result-card ${p.passed ? 'solved' : 'failed'}">
                    <div class="player-name">${p.name}</div>
                    <div class="answer">${p.answer || '-'}</div>
                    <div class="status">${p.passed ? '✅ صحيح' : '❌ خطأ'}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function displayClassicResults(container, room, roundResults) {
    // ... existing classic results display logic
    const CATEGORIES = window.GameEngine.CATEGORIES;
    const results = [];

    for (const [pid, pdata] of Object.entries(room.players || {})) {
        const playerResults = roundResults?.[pid] || { score: 0, answers: {} };
        results.push({
            id: pid,
            name: pdata.name,
            score: playerResults.score,
            answers: playerResults.answers,
            isMe: pid === GameState.playerId
        });
    }

    results.sort((a, b) => b.score - a.score);

    const banner = document.getElementById('winner-banner');
    if (results.length >= 2) {
        if (results[0].score > results[1].score) {
            banner.textContent = `🎉 الفائز: ${results[0].name} بـ ${results[0].score} نقطة!`;
        } else if (results[0].score === results[1].score) {
            banner.textContent = '🤝 تعادل!';
        }
    }

    container.innerHTML = results.map(p => `
        <div class="player-results" style="${p.isMe ? 'border-color:var(--accent-blue);' : ''}">
            <div class="player-header">
                <span class="player-name">${p.isMe ? '👤 ' : ''}${p.name}</span>
                <span class="player-score">${p.score} نقطة</span>
            </div>
            <div class="answers-grid">
                ${CATEGORIES.map(cat => {
        const a = p.answers?.[cat.id] || { answer: '-', valid: false, points: 0 };
        return `<div class="answer-item">
                        <div class="answer-category">${cat.label}</div>
                        <div class="answer-value ${a.valid ? 'correct' : 'wrong'}">${a.answer || '-'}</div>
                        <div class="answer-points ${a.points > 0 ? 'positive' : ''}">${a.points > 0 ? '+10' : '0'}</div>
                    </div>`;
    }).join('')}
            </div>
        </div>
    `).join('');

    if (room.stoppedBy) showToast(`${room.stoppedBy} أنهى الجولة!`);
}

function displayMultiphaseResults(container, room, roundResults) {
    // Multiphase uses same category structure as classic
    // but with phase indicators
    const CATEGORIES = window.GameEngine.CATEGORIES;
    const results = [];

    for (const [pid, pdata] of Object.entries(room.players || {})) {
        const playerResults = roundResults?.[pid] || { score: 0, answers: {} };
        results.push({
            id: pid,
            name: pdata.name,
            score: playerResults.score,
            answers: playerResults.answers,
            isMe: pid === GameState.playerId
        });
    }

    results.sort((a, b) => b.score - a.score);

    const banner = document.getElementById('winner-banner');
    if (results.length >= 2) {
        if (results[0].score > results[1].score) {
            banner.textContent = `⚡ الفائز: ${results[0].name} بـ ${results[0].score} نقطة!`;
        } else if (results[0].score === results[1].score) {
            banner.textContent = '🤝 تعادل!';
        }
    }

    container.innerHTML = results.map(p => `
        <div class="player-results multiphase-results" style="${p.isMe ? 'border-color:var(--accent-blue);' : ''}">
            <div class="player-header">
                <span class="player-name">${p.isMe ? '👤 ' : ''}${p.name}</span>
                <span class="player-score">${p.score} نقطة</span>
            </div>
            <div class="answers-grid">
                ${CATEGORIES.map(cat => {
        const a = p.answers?.[cat.id] || { answer: '-', valid: false, points: 0 };
        return `<div class="answer-item">
                        <div class="answer-category">${cat.label}</div>
                        <div class="answer-value ${a.valid ? 'correct' : 'wrong'}">${a.answer || '-'}</div>
                        <div class="answer-points ${a.points > 0 ? 'positive' : ''}">${a.points > 0 ? '+10' : '0'}</div>
                    </div>`;
    }).join('')}
            </div>
        </div>
    `).join('');
}

// ==================== HELPERS ====================

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function generatePlayerId() {
    return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function setupPresence() {
    if (!GameState.roomId || !GameState.playerId) return;
    const playerRef = getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`);
    playerRef.onDisconnect().remove();
}

function cleanup() {
    if (GameState.timerInterval) {
        clearInterval(GameState.timerInterval);
        GameState.timerInterval = null;
    }
    if (GameState.roomListener && GameState.roomId) {
        getDatabase().ref('rooms/' + GameState.roomId).off('value', GameState.roomListener);
        GameState.roomListener = null;
    }
    GameState.roomId = null;
    GameState.playerId = null;
    GameState.isHost = false;
    GameState.roundId = 0;
    GameState.phase = null;
    GameState.phaseStartAt = 0;
    GameState.lastDisplayedRoundId = 0;
}

async function leaveRoom() {
    if (!GameState.roomId || !GameState.playerId) {
        cleanup();
        return;
    }

    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);

    try {
        if (GameState.isHost) {
            await roomRef.transaction((room) => {
                if (!room) return room;
                if (room.players?.[GameState.playerId]) {
                    delete room.players[GameState.playerId];
                }
                const remaining = Object.keys(room.players || {});
                if (remaining.length === 0) {
                    return null;
                } else {
                    room.players[remaining[0]].isHost = true;
                    room.status = 'waiting';
                    return room;
                }
            });
        } else {
            await getDatabase().ref(`rooms/${GameState.roomId}/players/${GameState.playerId}`).remove();
        }
    } catch (e) { }

    cleanup();
}

async function playAgain() {
    const roomRef = getDatabase().ref('rooms/' + GameState.roomId);
    const roomSnap = await roomRef.once('value');
    const room = roomSnap.val();

    if (!room) {
        showToast('الغرفة غير موجودة', 'error');
        return;
    }

    // 🔴 CRITICAL: No fallback to classic
    const mode = room.mode;
    if (!mode) {
        throw new Error('🔴 CRITICAL FAILURE: room.mode is undefined');
    }
    const modeConfig = window.GameEngine.MODES[mode];
    if (!modeConfig) {
        throw new Error(`🔴 CRITICAL FAILURE: No configuration for mode "${mode}"`);
    }
    const firstPhase = modeConfig.phases[0];
    const duration = modeConfig.durations[firstPhase] || 60;

    // Build fresh mode context
    const modeContext = buildModeContext(mode, modeConfig);

    try {
        await roomRef.transaction((r) => {
            if (!r) return r;

            r.status = 'playing';
            r.roundId = (r.roundId || 0) + 1;
            r.letter = window.GameEngine.getRandomLetter();
            r.phases = modeConfig.phases;
            r.phaseIndex = 0;
            r.totalPhases = modeConfig.phases.length;
            r.phase = firstPhase;
            r.phaseStartAt = firebase.database.ServerValue.TIMESTAMP;
            r.phaseDuration = duration;
            r.stoppedBy = '';
            r.stopLock = false;
            r.roundResults = null;
            r.modeContext = modeContext;

            for (const pid in r.players) {
                r.players[pid].answers = {};
                r.players[pid].eliminated = false;
                r.players[pid].streak = 0;
            }

            return r;
        });

        GameState.resultsShown = false;
    } catch (e) {
        showToast('حدث خطأ', 'error');
    }
}

// UI helpers
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(name + '-screen');
    if (screen) screen.classList.add('active');
}

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (t) {
        t.textContent = msg;
        t.className = `toast ${type} show`;
        setTimeout(() => t.classList.remove('show'), 3000);
    }
}

// ==================== HELPERS ====================

function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ==================== EXPORTS ====================

window.GameController = {
    state: GameState,
    getDatabase,
    createRoom,
    joinRoom,
    startGame,
    listenToRoom,
    leaveRoom,
    playAgain,
    showScreen,
    showToast,
    cleanup,
    handleTimeUp
};

console.log('🎮 Game Controller loaded');
