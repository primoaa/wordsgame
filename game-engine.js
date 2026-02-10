/**
 * 🎮 تحدي الحروف - Multi-Mode Game Engine
 * 
 * 🔴 ABSOLUTE RULES:
 * - Each mode is a DIFFERENT GAME
 * - Classic logic is FORBIDDEN unless room.mode === "classic"
 * - UI must be rebuilt per mode
 * - AI NEVER controls: timers, phase transitions, round start/end
 * - AI is ONLY: validator, judge, verifier
 */

// ==================== MODE DEFINITIONS ====================
const GAME_MODES = {
    classic: {
        id: 'classic',
        name: 'كلاسيكي',
        icon: '🎯',
        phases: ['accuracy'],
        durations: { accuracy: 60 },
        description: '60 ثانية للإجابة',
        uiType: 'grid',
        stopEnabled: true,
        aiRole: 'validator' // validates all categories
    },
    multiphase: {
        id: 'multiphase',
        name: 'متعدد المراحل',
        icon: '⚡',
        phases: ['speed', 'accuracy', 'challenge'],
        durations: { speed: 20, accuracy: 30, challenge: 10 },
        description: 'سرعة + دقة + تحدي',
        uiType: 'phased-grid',
        stopEnabled: { speed: false, accuracy: true, challenge: false },
        aiRole: 'phased-validator'
    },
    survival: {
        id: 'survival',
        name: 'البقاء',
        icon: '💀',
        phases: ['survival'],
        durations: { survival: 7 },
        description: 'خطأ واحد = خروج',
        uiType: 'single-input',
        stopEnabled: false,
        aiRole: 'instant-judge', // true/false only
        eliminationMode: true
    },
    memory: {
        id: 'memory',
        name: 'الذاكرة',
        icon: '🧠',
        phases: ['show', 'recall'],
        durations: { show: 5, recall: 15 },
        description: 'احفظ ثم أجب',
        uiType: 'card-memory',
        stopEnabled: false,
        aiRole: 'string-compare' // no linguistic validation
    },
    bluff: {
        id: 'bluff',
        name: 'الخداع',
        icon: '🎭',
        phases: ['answer', 'vote', 'reveal'],
        durations: { answer: 30, vote: 15, reveal: 5 },
        description: 'من الكاذب؟',
        uiType: 'voting',
        stopEnabled: false,
        aiRole: 'word-exists-only' // NEVER identifies liar
    },
    objective: {
        id: 'objective',
        name: 'الهدف',
        icon: '🎯',
        phases: ['solve'],
        durations: { solve: 45 },
        description: 'حل اللغز',
        uiType: 'puzzle',
        stopEnabled: false,
        aiRole: 'constraint-validator' // logical constraints only
    }
};

// Phase configurations
const PHASE_CONFIG = {
    speed: {
        name: 'السرعة',
        icon: '⚡',
        color: '#4361ee',
        allowEditing: true,
        showValidation: false,
        stopEnabled: false
    },
    accuracy: {
        name: 'الدقة',
        icon: '🎯',
        color: '#06d6a0',
        allowEditing: true,
        showValidation: true,
        stopEnabled: true
    },
    challenge: {
        name: 'التحدي',
        icon: '🔥',
        color: '#f72585',
        allowEditing: false,
        showValidation: false,
        stopEnabled: false
    },
    survival: {
        name: 'البقاء',
        icon: '💀',
        color: '#ef233c',
        allowEditing: true,
        showValidation: false,
        stopEnabled: false
    },
    show: {
        name: 'المشاهدة',
        icon: '👁️',
        color: '#ffd60a',
        allowEditing: false,
        showValidation: false,
        stopEnabled: false
    },
    recall: {
        name: 'التذكر',
        icon: '🧠',
        color: '#7209b7',
        allowEditing: true,
        showValidation: false,
        stopEnabled: false
    },
    answer: {
        name: 'الإجابة',
        icon: '✍️',
        color: '#00b4d8',
        allowEditing: true,
        showValidation: false,
        stopEnabled: false
    },
    vote: {
        name: 'التصويت',
        icon: '🗳️',
        color: '#fb8500',
        allowEditing: false,
        showValidation: false,
        stopEnabled: false
    },
    reveal: {
        name: 'الكشف',
        icon: '🎭',
        color: '#f72585',
        allowEditing: false,
        showValidation: true,
        stopEnabled: false
    },
    solve: {
        name: 'الحل',
        icon: '🧩',
        color: '#84cc16',
        allowEditing: true,
        showValidation: false,
        stopEnabled: false
    }
};

// Categories for classic mode
const CATEGORIES = [
    { id: 'boyName', label: 'اسم ولد', class: 'cat-boy-name', prompt: 'اسم ولد (ذكر)', color: '#ef233c' },
    { id: 'girlName', label: 'اسم بنت', class: 'cat-girl-name', prompt: 'اسم بنت (أنثى)', color: '#f72585' },
    { id: 'vegetable', label: 'خضار', class: 'cat-vegetable', prompt: 'نوع خضار', color: '#06d6a0' },
    { id: 'fruit', label: 'فواكه', class: 'cat-fruit', prompt: 'نوع فاكهة', color: '#84cc16' },
    { id: 'object', label: 'جماد', class: 'cat-object', prompt: 'جماد (شيء غير حي)', color: '#6c757d' },
    { id: 'animal', label: 'حيوان', class: 'cat-animal', prompt: 'اسم حيوان', color: '#4361ee' },
    { id: 'country', label: 'بلاد', class: 'cat-country', prompt: 'اسم دولة/بلد', color: '#7209b7' },
    { id: 'city', label: 'مدينة', class: 'cat-city', prompt: 'اسم مدينة', color: '#00b4d8' },
    { id: 'job', label: 'مهنة', class: 'cat-job', prompt: 'اسم مهنة/وظيفة', color: '#fb8500' }
];

// Arabic letters
const ARABIC_LETTERS = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];

// ==================== VALIDATION GUARDS ====================

/**
 * 🔴 CRITICAL: Mode Validation Guard
 * Must be called before ANY game logic
 */
function validateRoomState(room) {
    const errors = [];

    if (!room) {
        errors.push('Room data is missing');
        return { valid: false, errors };
    }

    if (!room.mode) {
        errors.push('room.mode is missing - CANNOT proceed');
    }

    // 🔴 ERROR 2 FIX: Only require phase/round data if status is 'playing'
    if (room.status === 'playing') {
        if (!room.phases || !Array.isArray(room.phases)) {
            errors.push('room.phases is missing or invalid');
        }
        if (room.phase === undefined || room.phase === null) {
            errors.push('room.phase is missing');
        }
        if (room.phaseIndex === undefined) {
            errors.push('room.phaseIndex is missing');
        }
        if (room.roundId === undefined) {
            errors.push('room.roundId is missing');
        }
    }

    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * 🔴 CRITICAL: Check if classic logic is allowed
 */
function isClassicLogicAllowed(room) {
    return room && room.mode === 'classic';
}

/**
 * 🔴 CRITICAL: Check if STOP is allowed in current phase
 */
function isStopAllowed(room) {
    if (!room || !room.mode) return false;

    const modeConfig = GAME_MODES[room.mode];
    if (!modeConfig) return false;

    if (typeof modeConfig.stopEnabled === 'boolean') {
        return modeConfig.stopEnabled;
    }

    if (typeof modeConfig.stopEnabled === 'object') {
        return modeConfig.stopEnabled[room.phase] === true;
    }

    return false;
}

/**
 * Get the current phase configuration
 */
function getPhaseConfig(phaseName) {
    return PHASE_CONFIG[phaseName] || null;
}

/**
 * Get mode configuration
 * 🔴 CRITICAL: NO fallback to classic - throw error if mode not found
 */
function getModeConfig(modeName) {
    if (!modeName) {
        throw new Error('🔴 CRITICAL FAILURE: modeName is undefined');
    }
    const config = GAME_MODES[modeName];
    if (!config) {
        throw new Error(`🔴 CRITICAL FAILURE: No configuration for mode "${modeName}"`);
    }
    return config;
}

// ==================== UI BUILDERS ====================

/**
 * 🔴 CRITICAL: Each mode has its own UI builder - NO SHARING
 */
const UI_BUILDERS = {
    /**
     * Classic Mode UI - Grid of categories
     */
    classic: {
        buildGameUI(container, room, letter) {
            container.innerHTML = `
                <div class="classic-game">
                    <div class="game-header">
                        <div class="letter-display">
                            <div class="letter-label">الحرف</div>
                            <div class="current-letter">${letter}</div>
                        </div>
                        <div class="timer-display">
                            <div class="timer-label">الوقت المتبقي</div>
                            <div class="timer-value" id="timer-value">60</div>
                        </div>
                    </div>
                    <div class="categories-grid" id="categories-container">
                        ${CATEGORIES.map(cat => `
                            <div class="category-card ${cat.class}">
                                <div class="category-header" style="background:${cat.color}">${cat.label}</div>
                                <div class="category-body">
                                    <input type="text" class="category-input" id="input-${cat.id}" 
                                           placeholder="؟" autocomplete="off" data-category="${cat.id}">
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="game-actions">
                        <button class="btn btn-stop" id="stop-btn">🛑 STOP</button>
                    </div>
                </div>
            `;
        },

        getAnswers() {
            const answers = {};
            CATEGORIES.forEach(cat => {
                const input = document.getElementById('input-' + cat.id);
                answers[cat.id] = input ? input.value.trim() : '';
            });
            return answers;
        },

        disableInputs() {
            document.querySelectorAll('.category-input').forEach(inp => inp.disabled = true);
        },

        clearInputs() {
            document.querySelectorAll('.category-input').forEach(inp => inp.value = '');
        }
    },

    /**
     * Multiphase Mode UI - Reuse Classic Grid but with Phase Badge
     */
    multiphase: {
        buildGameUI(container, room, letter) {
            const phase = room.phase || 'speed';
            const phaseConfig = PHASE_CONFIG[phase] || { name: phase, color: '#333', icon: '❓' };
            const allowInput = phaseConfig.allowEditing !== false;

            container.innerHTML = `
                <div class="multiphase-game phase-${phase}">
                    <div class="game-header">
                        <div class="header-info" style="display:flex;align-items:center;gap:15px;">
                            <span class="phase-badge" style="background:${phaseConfig.color};padding:5px 12px;border-radius:20px;color:white;font-weight:bold;">
                                ${phaseConfig.icon} ${phaseConfig.name}
                            </span>
                            <div class="current-letter" style="font-size:1.5rem;font-weight:bold;">الحرف: ${letter}</div>
                        </div>
                        <div class="timer-display">
                            <span class="timer-value" id="timer-value">--</span>
                        </div>
                    </div>

                    <div class="categories-grid" id="categories-container" style="margin-top:15px;">
                        ${CATEGORIES.map(cat => `
                            <div class="category-card ${cat.class}">
                                <div class="category-header" style="background:${cat.color}">${cat.label}</div>
                                <div class="category-body">
                                    <input type="text" class="category-input" id="input-${cat.id}" 
                                           placeholder="؟" autocomplete="off" ${!allowInput ? 'disabled' : ''}>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div class="game-actions">
                         <button class="btn btn-stop" id="stop-btn" style="display:${phaseConfig.stopEnabled ? 'block' : 'none'}">🛑 STOP</button>
                    </div>
                </div>
            `;
        },
        getAnswers: () => {
            const answers = {};
            CATEGORIES.forEach(cat => {
                const input = document.getElementById('input-' + cat.id);
                answers[cat.id] = input ? input.value.trim() : '';
            });
            return answers;
        },
        disableInputs: () => document.querySelectorAll('.category-input').forEach(inp => inp.disabled = true),
        clearInputs: () => document.querySelectorAll('.category-input').forEach(inp => inp.value = '')
    },

    /**
     * Survival Mode UI - Single input, one category at a time
     * 🔴 "No-Elimination" Version: Turn counter, Strike Indicators
     */
    survival: {
        buildGameUI(container, room, letter) {
            const modeContext = room.modeContext || {};
            const currentCategory = modeContext.currentCategory || CATEGORIES[0];
            const lives = modeContext.lives !== undefined ? modeContext.lives : 1;
            const streak = modeContext.streak || 0;
            const currentTurn = room.currentRoundNumber || 1;
            const totalTurns = room.totalRounds || 10;
            const strikes = room.players?.[GameState.playerId]?.stats?.strikes || 0;

            container.innerHTML = `
                <div class="survival-game">
                    <div class="survival-header">
                        <div class="turn-counter">
                            <span class="turn-label">جولة</span>
                            <span class="turn-value">${currentTurn}/${totalTurns}</span>
                        </div>
                        <div class="survival-timer">
                            <span class="timer-icon">⏱️</span>
                            <span class="timer-value" id="timer-value">7</span>
                        </div>
                        <div class="survival-strikes">
                            <span class="strike-icon">⚠️</span>
                            <span class="strike-value">${strikes} أخطاء</span>
                        </div>
                    </div>
                    
                    <div class="survival-main">
                        <div class="survival-letter-badge">
                            <span class="letter-label">الحرف</span>
                            <span class="letter-value">${letter}</span>
                        </div>
                        
                        <div class="survival-category-card">
                            <div class="category-icon">${getCategoryIcon(currentCategory.id)}</div>
                            <div class="category-name">${currentCategory.label}</div>
                            <div class="category-prompt">${currentCategory.prompt}</div>
                        </div>
                        
                        <div class="survival-input-container">
                            <input type="text" class="survival-input" id="survival-input" 
                                   placeholder="اكتب إجابتك..." autocomplete="off" autofocus>
                            <button class="survival-submit-btn" id="survival-submit">✓</button>
                        </div>
                    </div>
                    
                    <div class="survival-status">
                        <span class="streak-indicator">🔥 سلسلة: ${streak}</span>
                    </div>
                </div>
            `;
        },

        getAnswers() {
            const input = document.getElementById('survival-input');
            return { answer: input ? input.value.trim() : '' };
        },

        disableInputs() {
            const input = document.getElementById('survival-input');
            if (input) input.disabled = true;
            const btn = document.getElementById('survival-submit');
            if (btn) btn.disabled = true;
        },

        clearInputs() {
            const input = document.getElementById('survival-input');
            if (input) input.value = '';
        }
    },

    /**
     * Memory Mode UI - Cards with blur effect
     * 🔴 Features: Risk Button (Round 3+)
     */
    memory: {
        buildGameUI(container, room, letter) {
            const modeContext = room.modeContext || {};
            const phase = room.phase;
            const wordsToRemember = modeContext.words || [];
            const roundNum = room.currentRoundNumber || 1;
            const showRisk = roundNum >= 3;

            if (phase === 'show') {
                container.innerHTML = `
                    <div class="memory-game memory-show-phase">
                        <div class="memory-header">
                            <div class="phase-indicator show-phase">
                                <span class="phase-icon">👁️</span>
                                <span class="phase-name">مرحلة المشاهدة</span>
                            </div>
                            <div class="timer-display">
                                <span class="timer-value" id="timer-value">5</span>
                            </div>
                        </div>
                        
                        <div class="memory-instruction">احفظ هذه الكلمات!</div>
                        
                        <div class="memory-cards-container">
                            ${wordsToRemember.map((word, i) => `
                                <div class="memory-card visible" style="animation-delay: ${i * 0.1}s">
                                    <span class="memory-word">${word}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="memory-game memory-recall-phase">
                        <div class="memory-header">
                            <div class="phase-indicator recall-phase">
                                <span class="phase-icon">🧠</span>
                                <span class="phase-name">مرحلة التذكر</span>
                            </div>
                            <div class="timer-display">
                                <span class="timer-value" id="timer-value">15</span>
                            </div>
                        </div>
                        
                        <div class="memory-instruction">اكتب الكلمات التي تتذكرها!</div>
                        
                        <div class="memory-input-container">
                            ${wordsToRemember.map((_, i) => `
                                <input type="text" class="memory-input" id="memory-input-${i}" 
                                       placeholder="كلمة ${i + 1}..." autocomplete="off">
                            `).join('')}
                        </div>
                        
                        <div class="memory-actions">
                            ${showRisk ? `
                                <button class="btn btn-risk" id="memory-risk-btn" onclick="toggleRisk()">
                                    ⚡ مجازفة (+2 نقاط / 0 إذا أخطأت)
                                </button>
                                <input type="hidden" id="risk-enabled" value="false">
                            ` : ''}
                            <button class="btn btn-primary memory-submit" id="memory-submit">تأكيد</button>
                        </div>
                    </div>
                `;

                // Risk toggle logic
                window.toggleRisk = function () {
                    const btn = document.getElementById('memory-risk-btn');
                    const input = document.getElementById('risk-enabled');
                    if (input.value === 'false') {
                        input.value = 'true';
                        btn.classList.add('active');
                        btn.innerHTML = '⚡ المجازفة مفعلة!';
                    } else {
                        input.value = 'false';
                        btn.classList.remove('active');
                        btn.innerHTML = '⚡ مجازفة (+2 نقاط / 0 إذا أخطأت)';
                    }
                };
            }
        },

        getAnswers() {
            const answers = [];
            let i = 0;
            while (document.getElementById('memory-input-' + i)) {
                const input = document.getElementById('memory-input-' + i);
                if (input && input.value.trim()) {
                    answers.push(input.value.trim());
                }
                i++;
            }
            const risk = document.getElementById('risk-enabled')?.value === 'true';
            return { words: answers, risk: risk };
        },

        disableInputs() {
            document.querySelectorAll('.memory-input').forEach(inp => inp.disabled = true);
            const riskBtn = document.getElementById('memory-risk-btn');
            if (riskBtn) riskBtn.disabled = true;
        },

        clearInputs() {
            document.querySelectorAll('.memory-input').forEach(inp => inp.value = '');
        }
    },

    /**
     * Bluff Mode UI - 5 distinct rounds
     * 🔴 Round Visuals & Context
     */
    bluff: {
        buildGameUI(container, room, letter) {
            const modeContext = room.modeContext || {};
            const phase = room.phase;
            const category = modeContext.category || CATEGORIES[0];
            const roundNum = room.currentRoundNumber || 1;

            // Round Titles
            const roundTitles = ['كلاسيكي', 'مزدوج', 'عكسي', 'صامت', 'الفخ الأخير'];
            const roundTitle = roundTitles[roundNum - 1] || 'كلاسيكي';
            const multiplier = roundNum === 1 ? '1x' : (roundNum === 2 ? '1.5x' : (roundNum >= 3 ? roundNum - 1 + 'x' : '1x'));

            const headerHTML = `
                <div class="bluff-round-badge">
                    <span class="round-name">${roundTitle}</span>
                    <span class="round-mult">${multiplier}</span>
                </div>
            `;

            if (phase === 'answer') {
                container.innerHTML = `
                    <div class="bluff-game bluff-answer-phase">
                        ${headerHTML}
                        <div class="bluff-header">
                            <div class="phase-indicator">
                                <span class="phase-icon">✍️</span>
                                <span class="phase-name">مرحلة الإجابة</span>
                            </div>
                            <div class="timer-display">
                                <span class="timer-value" id="timer-value">30</span>
                            </div>
                        </div>
                        
                        <div class="bluff-main">
                            <div class="bluff-letter">الحرف: <strong>${letter}</strong></div>
                            <div class="bluff-category">${category.label}</div>
                            
                            <div class="bluff-tip">💡 ${roundNum === 3 ? 'اكتب إجابة غريبة لكن صحيحة!' : 'يمكنك الكذب!'}</div>
                            
                            <input type="text" class="bluff-input" id="bluff-input" 
                                   placeholder="إجابتك..." autocomplete="off">
                        </div>
                    </div>
                `;
            } else if (phase === 'vote') {
                const answers = modeContext.anonymousAnswers || [];
                container.innerHTML = `
                    <div class="bluff-game bluff-vote-phase">
                        ${headerHTML}
                        <div class="bluff-header">
                            <div class="phase-indicator">
                                <span class="phase-icon">🗳️</span>
                                <span class="phase-name">من الكاذب؟</span>
                            </div>
                            <div class="timer-display">
                                <span class="timer-value" id="timer-value">15</span>
                            </div>
                        </div>
                        
                        <div class="bluff-answers-list">
                            ${answers.map((ans, i) => `
                                <div class="bluff-answer-option" data-index="${i}">
                                    <input type="radio" name="bluff-vote" id="vote-${i}" value="${i}">
                                    <label for="vote-${i}" class="bluff-answer-card">
                                        <span class="answer-text">${ans.text || ans}</span>
                                        <span class="answer-player">لاعب ؟</span>
                                    </label>
                                </div>
                            `).join('')}
                        </div>
                        
                        <button class="btn btn-primary bluff-vote-btn" id="bluff-vote-submit">تصويت</button>
                    </div>
                `;
            } else {
                const reveals = modeContext.reveals || [];
                container.innerHTML = `
                    <div class="bluff-game bluff-reveal-phase">
                        ${headerHTML}
                        <div class="bluff-header">
                            <div class="phase-indicator">
                                <span class="phase-icon">🎭</span>
                                <span class="phase-name">الكشف!</span>
                            </div>
                        </div>
                        
                        <div class="bluff-reveals">
                            ${reveals.map(r => `
                                <div class="reveal-card ${r.wasLying ? 'liar' : 'honest'}">
                                    <div class="reveal-player">${r.playerName}</div>
                                    <div class="reveal-answer">${r.answer}</div>
                                    <div class="reveal-status">${r.wasLying ? '🤥 كاذب' : '😇 صادق'}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        },

        getAnswers() {
            const input = document.getElementById('bluff-input');
            const vote = document.querySelector('input[name="bluff-vote"]:checked');
            return {
                answer: input ? input.value.trim() : '',
                vote: vote ? parseInt(vote.value) : null
            };
        },

        disableInputs() {
            const input = document.getElementById('bluff-input');
            if (input) input.disabled = true;
            document.querySelectorAll('input[name="bluff-vote"]').forEach(r => r.disabled = true);
        },

        clearInputs() {
            const input = document.getElementById('bluff-input');
            if (input) input.value = '';
        }
    },

    /**
     * Objective Mode UI - Puzzle constraints
     * ❌ NO Categories, NO STOP
     */
    objective: {
        buildGameUI(container, room, letter) {
            const modeContext = room.modeContext || {};
            const constraints = modeContext.constraints || [
                { type: 'startsWith', value: letter, label: `يبدأ بحرف ${letter}` },
                { type: 'contains', value: 'م', label: 'يحتوي على حرف م' },
                { type: 'length', value: 4, label: 'من 4 أحرف' }
            ];

            container.innerHTML = `
                <div class="objective-game">
                    <div class="objective-header">
                        <div class="phase-indicator">
                            <span class="phase-icon">🧩</span>
                            <span class="phase-name">حل اللغز</span>
                        </div>
                        <div class="timer-display">
                            <span class="timer-value" id="timer-value">45</span>
                        </div>
                    </div>
                    
                    <div class="objective-card">
                        <div class="objective-title">🎯 الهدف</div>
                        <div class="objective-constraints">
                            ${constraints.map(c => `
                                <div class="constraint-item" data-type="${c.type}" data-value="${c.value}">
                                    <span class="constraint-icon">📌</span>
                                    <span class="constraint-text">${c.label}</span>
                                    <span class="constraint-status" id="constraint-${c.type}">❓</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="objective-input-area">
                        <input type="text" class="objective-input" id="objective-input" 
                               placeholder="اكتب الكلمة..." autocomplete="off">
                        <button class="btn btn-primary objective-submit" id="objective-submit">تأكيد</button>
                    </div>
                </div>
            `;
        },

        getAnswers() {
            const input = document.getElementById('objective-input');
            return { answer: input ? input.value.trim() : '' };
        },

        disableInputs() {
            const input = document.getElementById('objective-input');
            if (input) input.disabled = true;
        },

        clearInputs() {
            const input = document.getElementById('objective-input');
            if (input) input.value = '';
        }
    },

    /**
     * Multiphase Mode UI - Changes by phase (LEGACY/UNUSED)
     * Replaced by simpler builder above
     */
    multiphase_legacy: {
        buildGameUI(container, room, letter) {
            const phase = room.phase;
            const phaseConfig = PHASE_CONFIG[phase] || PHASE_CONFIG.accuracy;
            const phaseIndex = room.phaseIndex || 0;
            const totalPhases = room.totalPhases || 3;

            let phaseSpecificUI = '';

            if (phase === 'speed') {
                // Speed phase: NO icons, NO STOP
                phaseSpecificUI = `
                    <div class="categories-grid speed-mode" id="categories-container">
                        ${CATEGORIES.map(cat => `
                            <div class="category-card ${cat.class}">
                                <div class="category-header" style="background:${cat.color}">${cat.label}</div>
                                <div class="category-body">
                                    <input type="text" class="category-input" id="input-${cat.id}" 
                                           placeholder="؟" autocomplete="off" data-category="${cat.id}">
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (phase === 'accuracy') {
                // Accuracy phase: With checkmarks, STOP visible
                phaseSpecificUI = `
                    <div class="categories-grid accuracy-mode" id="categories-container">
                        ${CATEGORIES.map(cat => `
                            <div class="category-card ${cat.class}">
                                <div class="category-header" style="background:${cat.color}">
                                    ${cat.label}
                                    <span class="validation-icon" id="icon-${cat.id}"></span>
                                </div>
                                <div class="category-body">
                                    <input type="text" class="category-input" id="input-${cat.id}" 
                                           placeholder="؟" autocomplete="off" data-category="${cat.id}">
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="game-actions">
                        <button class="btn btn-stop" id="stop-btn">🛑 STOP</button>
                    </div>
                `;
            } else if (phase === 'challenge') {
                // Challenge phase: category selection only
                phaseSpecificUI = `
                    <div class="challenge-container">
                        <div class="challenge-instruction">اختر فئة للتحدي:</div>
                        <div class="challenge-categories">
                            ${CATEGORIES.map(cat => `
                                <button class="challenge-category-btn" data-category="${cat.id}" 
                                        style="background:${cat.color}">
                                    ${cat.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="game-actions">
                        <button class="btn btn-stop locked" id="stop-btn" disabled>🔒 STOP</button>
                    </div>
                `;
            }

            container.innerHTML = `
                <div class="multiphase-game phase-${phase}">
                    <div class="game-header">
                        <div class="letter-display phase-accent-bg" style="background:${phaseConfig.color}">
                            <div class="letter-label">الحرف</div>
                            <div class="current-letter">${letter}</div>
                        </div>
                        <div class="phase-info" style="border-color:${phaseConfig.color}">
                            <span class="phase-name" style="color:${phaseConfig.color}">
                                ${phaseConfig.icon} ${phaseConfig.name}
                            </span>
                            <span class="phase-dots">${generatePhaseDots(phaseIndex, totalPhases)}</span>
                        </div>
                        <div class="timer-display">
                            <div class="timer-label">الوقت المتبقي</div>
                            <div class="timer-value" id="timer-value">30</div>
                        </div>
                    </div>
                    ${phaseSpecificUI}
                </div>
            `;
        },

        getAnswers() {
            const answers = {};
            CATEGORIES.forEach(cat => {
                const input = document.getElementById('input-' + cat.id);
                answers[cat.id] = input ? input.value.trim() : '';
            });
            // Check for challenge selection
            const selectedChallenge = document.querySelector('.challenge-category-btn.selected');
            if (selectedChallenge) {
                answers._challengeCategory = selectedChallenge.dataset.category;
            }
            return answers;
        },

        disableInputs() {
            document.querySelectorAll('.category-input').forEach(inp => inp.disabled = true);
            document.querySelectorAll('.challenge-category-btn').forEach(btn => btn.disabled = true);
        },

        clearInputs() {
            document.querySelectorAll('.category-input').forEach(inp => inp.value = '');
        }
    }
};

// ==================== AI VALIDATORS BY ROLE ====================

// ==================== AI HELPER ====================

/**
 * 🔴 Worker Validation Helper
 * Sends { word, letter, mode } to the Cloudflare Worker
 */
async function validateWordWithWorker(word, letter, mode) {
    if (!word || word.trim().length < 2) return { valid: false, source: 'local-short' };

    // 🔴 FORCE LOCAL VALIDATION for Survival and Memory (as per checklist)
    if (mode === 'survival' || mode === 'memory') {
        return {
            valid: validateLocal(word, letter),
            source: 'local-forced'
        };
    }

    // 1. Try Worker if configured
    if (window.WORKER_URL) {
        try {
            const response = await fetch(window.WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    word: word.trim(),
                    letter: letter,
                    mode: mode || 'classic'
                })
            });

            if (!response.ok) throw new Error(`Worker status: ${response.status}`);

            const data = await response.json();
            return { valid: !!data.valid, source: 'worker' };
        } catch (e) {
            console.error(`⚠️ Worker validation failed for "${word}":`, e);
        }
    }

    // 2. Fallback to Local Validation if Worker fails or missing
    return {
        valid: validateLocal(word, letter),
        source: 'local-fallback'
    };
}

const AI_VALIDATORS = {
    /**
     * Classic/Multiphase validator - Parallel validation via Worker
     */
    async validator(answers, letter, room) {
        const mode = room.mode || 'classic';
        console.log(`🕵️ [Validator] Validating ${Object.keys(answers).length} words for mode: ${mode}`);

        // Create parallel validation promises
        const entries = Object.entries(answers);
        const promises = entries.map(async ([catId, word]) => {
            const result = await validateWordWithWorker(word, letter, mode);
            return {
                catId,
                word,
                valid: result.valid
            };
        });

        // Wait for all to complete
        const resultsArray = await Promise.all(promises);

        // Assemble results
        const finalResults = {};
        let totalScore = 0;

        resultsArray.forEach(({ catId, word, valid }) => {
            finalResults[catId] = {
                answer: word,
                valid: valid,
                points: valid ? 10 : 0
            };
            if (valid) totalScore += 10;
        });

        return { score: totalScore, results: finalResults };
    },

    /**
     * Instant judge for Survival - Strict Start-Letter Check
     */
    async 'instant-judge'(answer, letter, room) {
        if (!answer) return { valid: false };
        const cleanAnswer = answer.trim();
        // Check if Arabic
        if (!/^[\u0600-\u06FF\s]+$/.test(cleanAnswer)) return { valid: false };

        const first = getFirstLetter(cleanAnswer);
        const target = normalizeArabic(letter);

        // 🔴 Strict Local Check
        if (first !== target) return { valid: false };

        return { valid: true };
    },

    /**
     * String compare for Memory - Exact Match (Normalized)
     */
    'string-compare'(playerWords, correctWords) {
        // Normalize for better matching
        const norm = w => w.trim().replace(/[إأآ]/g, 'ا').replace(/ة$/g, 'ه');
        const pNorm = playerWords.map(norm);
        const cNorm = correctWords.map(norm);

        const matches = pNorm.filter(pw => cNorm.includes(pw));

        return {
            correct: matches.length,
            total: correctWords.length,
            score: matches.length * 10
        };
    },

    /**
     * Word exists check for Bluff - "True/False" existence only
     */
    async 'word-exists-only'(answer, category) {
        const trimmed = answer.trim();
        // Check for Arabic chars length >= 2
        return {
            exists: trimmed.length >= 2 && /[\u0600-\u06FF]/.test(trimmed)
        };
    },

    /**
     * Constraint validator for Objective - Multi-rule check
     */
    'constraint-validator'(answer, constraints) {
        const results = {};
        const word = answer.trim();
        if (!word) return { passed: false, results: {} };
        const normWord = normalizeArabic(word);

        constraints.forEach(c => {
            switch (c.type) {
                case 'startsWith':
                    results[c.type] = getFirstLetter(word) === normalizeArabic(c.value);
                    break;
                case 'contains':
                    // Normalize value for comparison
                    results[c.type] = normWord.includes(normalizeArabic(c.value));
                    break;
                case 'length':
                    results[c.type] = word.length === c.value; // Exact length
                    break;
                case 'minLength':
                    results[c.type] = word.length >= c.value;
                    break;
                case 'endsWith':
                    results[c.type] = word.endsWith(c.value);
                    break;
                case 'notContains': // "No 'A'"
                    results[c.type] = !normWord.includes(normalizeArabic(c.value));
                    break;
            }
        });

        const allPassed = Object.values(results).every(v => v === true);
        return { passed: allPassed, results };
    }
};

// ==================== HELPER FUNCTIONS ====================

function normalizeArabic(letter) {
    if (!letter) return '';
    const map = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي' };
    return map[letter] || letter;
}

function getFirstLetter(word) {
    if (!word || !word.trim()) return '';
    let w = word.trim();
    // Regex to verify it is Arabic
    if (!/[\u0600-\u06FF]/.test(w)) return ''; // Return empty if not Arabic

    if (w.startsWith('ال') && w.length > 2) w = w.substring(2);
    return normalizeArabic(w.charAt(0));
}

function validateLocal(answer, targetLetter) {
    if (!answer || answer.length < 2) return false;
    // Enforce Arabic script
    if (!/[\u0600-\u06FF]/.test(answer)) return false;

    return getFirstLetter(answer) === normalizeArabic(targetLetter);
}

function generatePhaseDots(current, total) {
    let dots = '';
    for (let i = 0; i < total; i++) {
        dots += i <= current ? '●' : '○';
    }
    return dots;
}

function getCategoryIcon(catId) {
    const icons = {
        boyName: '👦', girlName: '👧', vegetable: '🥬', fruit: '🍎',
        object: '📦', animal: '🦁', country: '🌍', city: '🏙️', job: '👨‍⚕️'
    };
    return icons[catId] || '📝';
}

function getRandomLetter() {
    // 🔴 FORCE ARABIC ONLY
    const strictArabic = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];
    return strictArabic[Math.floor(Math.random() * strictArabic.length)];
}

function getRandomCategory() {
    return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
}

// Placeholder for full AI validation
async function validateAllCategories(answers, letter) {
    // 🔴 Use global AI verifier if available (from index.html)
    if (window.verifyWithAI) {
        return await window.verifyWithAI(answers, letter);
    }

    const results = {};
    let totalScore = 0;
    const arabicLetter = normalizeArabic(letter);

    CATEGORIES.forEach(cat => {
        const answer = answers[cat.id] || '';
        const isValid = validateLocal(answer, arabicLetter);
        results[cat.id] = { answer, valid: isValid, points: isValid ? 10 : 0 };
        totalScore += isValid ? 10 : 0;
    });

    return { score: totalScore, results };
}

// ==================== MODE HANDLERS ====================

/**
 * 🔴 Mode-specific event setup and logic
 * Each handle function sets up events for ONLY its mode
 */
const MODE_HANDLERS = {
    /**
     * Classic: 9 categories, STOP button
     */
    handleClassic(room, callbacks) {
        const stopBtn = document.getElementById('stop-btn');
        if (stopBtn && callbacks.onStop) {
            stopBtn.onclick = callbacks.onStop;
        }
    },

    /**
     * Multiphase: Speed → Accuracy → Challenge
     */
    handleMultiphase(room, callbacks) {
        const stopBtn = document.getElementById('stop-btn');
        if (stopBtn && callbacks.onStop) {
            stopBtn.onclick = callbacks.onStop;
        }
        // Challenge category selection
        document.querySelectorAll('.challenge-category-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.challenge-category-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            };
        });
    },

    /**
     * Survival: Single input, instant validation
     */
    handleSurvival(room, callbacks) {
        const submitBtn = document.getElementById('survival-submit');
        const input = document.getElementById('survival-input');

        if (submitBtn && callbacks.onSubmit) {
            submitBtn.onclick = callbacks.onSubmit;
        }
        if (input && callbacks.onSubmit) {
            input.onkeypress = (e) => {
                if (e.key === 'Enter') callbacks.onSubmit();
            };
        }
    },

    /**
     * Memory: Show → Recall phases
     */
    handleMemory(room, callbacks) {
        const submitBtn = document.getElementById('memory-submit');
        if (submitBtn && callbacks.onSubmit) {
            submitBtn.onclick = callbacks.onSubmit;
        }
    },

    /**
     * Bluff: Answer → Vote → Reveal
     */
    handleBluff(room, callbacks) {
        const submitBtn = document.getElementById('bluff-vote-submit');
        if (submitBtn && callbacks.onVote) {
            submitBtn.onclick = callbacks.onVote;
        }
    },

    /**
     * Objective: Constraint puzzle
     */
    handleObjective(room, callbacks) {
        const submitBtn = document.getElementById('objective-submit');
        const input = document.getElementById('objective-input');

        if (submitBtn && callbacks.onSubmit) {
            submitBtn.onclick = callbacks.onSubmit;
        }
        if (input && callbacks.onInput) {
            input.oninput = callbacks.onInput;
        }
    }
};

/**
 * 🔴 Setup event handlers for the current mode
 * Must be called after renderGameUI
 */
function setupModeHandler(room, callbacks) {
    if (!room || !room.mode) {
        throw new Error('🔴 CRITICAL: room.mode is undefined');
    }

    const handler = MODE_HANDLERS['handle' + room.mode.charAt(0).toUpperCase() + room.mode.slice(1)];
    if (!handler) {
        throw new Error(`🔴 CRITICAL: No handler for mode "${room.mode}"`);
    }

    handler(room, callbacks);
}

// ==================== SINGLE ENTRY POINT FOR UI ====================

/**
 * 🔴 CRITICAL: THE ONLY WAY TO RENDER GAME UI
 * - Clears container completely
 * - Selects UI_BUILDERS[room.mode]
 * - Throws error if builder missing
 * - NO fallback to classic
 */
/**
 * 🔴 CRITICAL: THE ONLY WAY TO RENDER GAME UI
 * - Clears container completely
 * - Selects UI_BUILDERS[room.mode]
 * - Throws error if builder missing
 * - NO fallback to classic
 */
function renderGameUI(room) {
    // 1. Validate room.mode exists
    if (!room) {
        throw new Error('🔴 CRITICAL: renderGameUI called with null room');
    }
    if (!room.mode) {
        throw new Error('🔴 CRITICAL: room.mode is undefined');
    }

    // 2. Get container and clear it completely
    const container = document.getElementById('game-container');
    if (!container) {
        console.warn('🔴 CRITICAL FAILURE: game-container element not found');
        return null;
    }
    container.innerHTML = '';

    // 3. Get builder - NO fallback
    const uiBuilder = UI_BUILDERS[room.mode];
    if (!uiBuilder) {
        container.innerHTML = `<div class="error-screen"><h3>⚠️ وضع غير معروف: ${room.mode}</h3></div>`;
        throw new Error(`🔴 CRITICAL: No UI_BUILDER for mode "${room.mode}"`);
    }

    try {
        // 4. Build the UI
        console.log(`🎮 renderGameUI: Building UI for mode "${room.mode}"`);
        uiBuilder.buildGameUI(container, room, room.letter);
    } catch (e) {
        console.error('🔴 Render Error in UI Builder:', e);
        container.innerHTML = `<div class="error-screen">
            <h3>⚠️ حدث خطأ في العرض</h3>
            <p>${e.message}</p>
        </div>`;
    }

    // 5. Return builder for caller to use getAnswers/disableInputs
    return uiBuilder;
}

// ==================== EXPORTS ====================

// Make available globally
window.GameEngine = {
    MODES: GAME_MODES,
    PHASES: PHASE_CONFIG,
    CATEGORIES,
    ARABIC_LETTERS,
    UI_BUILDERS,
    AI_VALIDATORS,
    MODE_HANDLERS,
    validateRoomState,
    isClassicLogicAllowed,
    isStopAllowed,
    getPhaseConfig,
    getModeConfig,
    getRandomLetter,
    getRandomCategory,
    normalizeArabic,
    getFirstLetter,
    validateWordWithWorker,
    setupDraggableTimer,
    // 🔴 ENTRY POINTS
    renderGameUI,
    setupModeHandler
};

// ==================== DRAGGABLE TIMER LOGIC ====================

// Global Drag State
const DragState = {
    isDragging: false,
    element: null,
    startX: 0,
    startY: 0,
    initialLeft: 0,
    initialTop: 0
};

// Global Move Handler
const handleDragMove = (e) => {
    if (!DragState.isDragging || !DragState.element) return;

    if (e.cancelable) e.preventDefault(); // Stop scrolling

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - DragState.startX;
    const deltaY = clientY - DragState.startY;

    let newLeft = DragState.initialLeft + deltaX;
    let newTop = DragState.initialTop + deltaY;

    // Constraints
    const timer = DragState.element;
    const maxX = window.innerWidth - timer.offsetWidth;
    const maxY = window.innerHeight - timer.offsetHeight;

    newLeft = Math.max(0, Math.min(newLeft, maxX));
    newTop = Math.max(0, Math.min(newTop, maxY));

    timer.style.left = `${newLeft}px`;
    timer.style.top = `${newTop}px`;
};

// Global End Handler
const handleDragEnd = () => {
    if (!DragState.isDragging || !DragState.element) return;

    const timer = DragState.element;
    DragState.isDragging = false;
    DragState.element = null;

    timer.style.cursor = 'grab';
    timer.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

    // Save position
    localStorage.setItem('timerPos', JSON.stringify({
        x: timer.style.left,
        y: timer.style.top
    }));
};

// Start Handler (Attached to element)
const handleDragStart = (e) => {
    if (e.target.tagName === 'BUTTON') return;

    const timer = e.currentTarget;
    DragState.isDragging = true;
    DragState.element = timer;

    timer.style.cursor = 'grabbing';
    timer.style.transition = 'none';

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    DragState.startX = clientX;
    DragState.startY = clientY;

    const rect = timer.getBoundingClientRect();
    DragState.initialLeft = rect.left;
    DragState.initialTop = rect.top;
};

// Attach Global Listeners (Once)
if (!window.timerDragInitialized) {
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchend', handleDragEnd);
    window.timerDragInitialized = true;
}

function setupDraggableTimer() {
    const timer = document.querySelector('.timer-display');
    if (!timer) return;

    // 1. Restore Position
    const savedPos = localStorage.getItem('timerPos');
    if (savedPos) {
        try {
            const { x, y } = JSON.parse(savedPos);
            timer.style.position = 'fixed'; // Ensure it's fixed
            timer.style.left = x;
            timer.style.top = y;
            timer.style.transform = 'none'; // Clear any centering transforms if present
            timer.style.margin = '0';       // Clear margins
        } catch (e) {
            console.error('Error parsing timer position', e);
        }
    }

    // 2. Style
    timer.style.cursor = 'grab';
    timer.style.touchAction = 'none';
    timer.style.userSelect = 'none';
    timer.style.zIndex = '9999'; // Ensure top z-index

    // 3. Clean & Attach Listeners
    timer.removeEventListener('mousedown', handleDragStart);
    timer.addEventListener('mousedown', handleDragStart);

    timer.removeEventListener('touchstart', handleDragStart);
    timer.addEventListener('touchstart', handleDragStart, { passive: false });
}

console.log('🎮 Game Engine loaded with modes:', Object.keys(GAME_MODES).join(', '));
