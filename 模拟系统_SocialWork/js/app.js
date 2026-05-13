// ─── 模拟组卷配置（社会工作者初级实务：60单选 + 20多选）────
const MOCK_CONFIG = [
    { type: '单选题', count: 60 },
    { type: '多选题', count: 20 }
];

document.addEventListener('DOMContentLoaded', () => {
    if (typeof questionsData === 'undefined' || !questionsData.length) {
        document.getElementById('q-title').innerText = "加载题库失败或无数据。";
        return;
    }

    const state = {
        currentIndex: parseInt(localStorage.getItem('ai_current_index')) || 0,
        wrongList:    JSON.parse(localStorage.getItem('ai_wrong_list'))   || [],
        favorites:    JSON.parse(localStorage.getItem('ai_favorites'))     || [],
        // answeredMap: { [qId]: { result: 'correct'|'wrong', given: 'AB' } }
        answeredMap:  JSON.parse(localStorage.getItem('ai_answered_map')) || {},
        orderMode:    localStorage.getItem('ai_order_mode')  || 'sequential',
        chapterFilter: localStorage.getItem('ai_chapter_filter') || 'all',
        typeFilter:   localStorage.getItem('ai_type_filter') || 'all',
        appMode:      localStorage.getItem('ai_app_mode')    || 'practice',
        practiceMode: 'all',
        hasAnsweredCurrent: false,
        activeIds: [],
        selectedMultiOptions: [],
        examAnswers: {},
        sessionAnsweredMap: {}, // 新增：用于存储重练模式下的临时作答记录
    };

    const normalizeQuestionId = (value) => {
        const normalized = parseInt(value, 10);
        return Number.isNaN(normalized) ? null : normalized;
    };

    const normalizeIdList = (idList) => {
        if (!Array.isArray(idList)) return [];
        return Array.from(new Set(
            idList.map(normalizeQuestionId).filter(id => id !== null)
        ));
    };

    const normalizeAnsweredMap = (answeredMap) => {
        if (!answeredMap || typeof answeredMap !== 'object') return {};
        const normalizedMap = {};
        Object.entries(answeredMap).forEach(([rawId, record]) => {
            const normalizedId = normalizeQuestionId(rawId);
            if (normalizedId === null || !record || typeof record !== 'object') return;
            if (!['correct', 'wrong'].includes(record.result)) return;
            normalizedMap[normalizedId] = {
                result: record.result,
                given: typeof record.given === 'string' ? record.given : ''
            };
        });
        return normalizedMap;
    };

    state.currentIndex = Number.isInteger(state.currentIndex) && state.currentIndex >= 0 ? state.currentIndex : 0;
    state.wrongList = normalizeIdList(state.wrongList);
    state.favorites = normalizeIdList(state.favorites);
    state.answeredMap = normalizeAnsweredMap(state.answeredMap);

    const views = {
        practice:  document.getElementById('view-practice'),
        wrong:     document.getElementById('view-wrong'),
        favorites: document.getElementById('view-favorites')
    };
    const navBtns = document.querySelectorAll('.nav-btn');
    const sysBtns = document.querySelectorAll('.sys-btn');

    // DOM elements
    const qTitle           = document.getElementById('q-title');
    const qType            = document.getElementById('q-type');
    const qOptions         = document.getElementById('q-options');
    const feedbackArea     = document.getElementById('feedback-area');
    const feedbackResult   = document.getElementById('feedback-result');
    const realAnswer       = document.getElementById('real-answer');
    const prevBtn          = document.getElementById('prev-btn');
    const nextBtn          = document.getElementById('next-btn');
    const favBtn           = document.getElementById('current-fav-btn');
    const submitMultiBtn   = document.getElementById('submit-multi-btn');
    const multiActions     = document.getElementById('multi-choice-actions');
    const feedbackPlaceholder = document.getElementById('feedback-placeholder');
    const modeBadge        = document.getElementById('mode-badge');
    const exitModeBtn      = document.getElementById('exit-mode-btn');
    const startWrongPracticeBtn = document.getElementById('start-wrong-practice');
    const startFavPracticeBtn   = document.getElementById('start-fav-practice');
    const orderModeSelect  = document.getElementById('order-mode');
    const chapterFilterSelect = document.getElementById('chapter-filter');
    const typeFilterSelect = document.getElementById('type-filter');
    const appModeSelect    = document.getElementById('app-mode');
    const wrongCount       = document.getElementById('wrong-count');
    const favCount         = document.getElementById('fav-count');
    const progressText     = document.getElementById('progress-text');
    const progressFill     = document.getElementById('progress-fill');
    const correctCountEl   = document.getElementById('correct-count');
    const wrongStatCountEl = document.getElementById('wrong-stat-count');
    const accuracyPercentEl = document.getElementById('accuracy-percent');
    const wrongListContainer = document.getElementById('wrong-list');
    const favListContainer   = document.getElementById('fav-list');
    const clearDataBtn     = document.getElementById('clear-data-btn');
    const submitExamBtn    = document.getElementById('submit-exam-btn');
    const examModal        = document.getElementById('exam-result-modal');
    const examScore        = document.getElementById('exam-score');
    const examTotal        = document.getElementById('exam-total');
    const examAnswered     = document.getElementById('exam-answered');
    const examCorrect      = document.getElementById('exam-correct');
    const examWrong        = document.getElementById('exam-wrong');
    const closeModalBtn    = document.getElementById('close-modal-btn');
    const questionGrid     = document.getElementById('question-grid');

    // ─── Theme ────────────────────────────────────────────────
    function initTheme() {
        const saved = localStorage.getItem('ai_theme') || 'auto';
        applyTheme(saved);

        document.getElementById('theme-switcher').addEventListener('click', (e) => {
            const btn = e.target.closest('.theme-btn');
            if (!btn) return;
            const theme = btn.dataset.theme;
            applyTheme(theme);
            localStorage.setItem('ai_theme', theme);
        });
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        // 清除手动设定，回归 auto
        if (theme === 'auto') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', theme);
        }
        // 更新按钮高亮
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    }

    // ─── Welcome Message ────────────────────────────────────────────
    function updateCountdown() {
        const countdownEl = document.getElementById('countdown-value');
        if (!countdownEl) return;
        
        const slogans = [
            "勤学苦练，必有所获",
            "持之以恒，金石为开",
            "书山有路，勤奋为径",
            "百尺竿头，更进一步",
            "学而不厌，诲人不倦",
            "博学笃志，切问近思",
            "功不唐捐，玉汝于成",
            "绳锯木断，水滴石穿",
            "今日寒窗，明日辉煌",
            "精诚所至，金石为开",
            "不积跬步，无以至千里",
            "锲而不舍，金石可镂",
            "宝剑锋从磨砺出",
            "梅花香自苦寒来"
        ];
        
        const randomSlogan = slogans[Math.floor(Math.random() * slogans.length)];
        countdownEl.textContent = randomSlogan;
    }


    // ─── Init ───────────────────────────────────────────────
    function init() {
        initTheme();
        updateCountdown(); 

        // Populate chapters
        if (chapterFilterSelect) {
            const chapters = [...new Set(questionsData.map(q => q.chapter))].filter(Boolean);
            chapters.sort((a, b) => {
                // Try to sort by "Chapter X"
                const getNum = s => parseInt(s.match(/\d+/)) || 0;
                return getNum(a) - getNum(b);
            });
            chapters.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch;
                opt.textContent = ch;
                chapterFilterSelect.appendChild(opt);
            });
            chapterFilterSelect.value = state.chapterFilter;
        }

        orderModeSelect.value  = state.orderMode;
        typeFilterSelect.value = state.typeFilter;
        appModeSelect.value    = state.appMode;
        enforceOrderModeRules();
        submitExamBtn.classList.toggle('submit-exam-hidden', state.appMode !== 'exam');
        updateActiveIds();
        updateBadges();
        renderQuestionPanel();
        renderQuestion();
        setupEventListeners();
        
        // 每天更新一次倒计时（在午夜时更新）
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const msUntilMidnight = tomorrow - now;
        setTimeout(() => {
            updateCountdown();
            setInterval(updateCountdown, 24 * 60 * 60 * 1000); // 每24小时更新一次
        }, msUntilMidnight);
    }

    // ─── Save ────────────────────────────────────────────────
    function saveState() {
        localStorage.setItem('ai_current_index', state.currentIndex);
        localStorage.setItem('ai_wrong_list',    JSON.stringify(state.wrongList));
        localStorage.setItem('ai_favorites',     JSON.stringify(state.favorites));
        localStorage.setItem('ai_answered_map',  JSON.stringify(state.answeredMap));
        localStorage.setItem('ai_order_mode',    state.orderMode);
        localStorage.setItem('ai_chapter_filter', state.chapterFilter);
        localStorage.setItem('ai_type_filter',   state.typeFilter);
        localStorage.setItem('ai_app_mode',      state.appMode);
        updateBadges();
    }

    // ─── Export / Import ─────────────────────────────────────
    function exportData() {
        const data = {
            schemaVersion: '1.21',
            exportedAt: new Date().toISOString(),
            wrongList:   state.wrongList,
            favorites:   state.favorites,
            answeredMap: state.answeredMap,
            handsonAnswers: state.handsonAnswers,
            handsonCurrentId: localStorage.getItem('ai_handson_current_id') || 'H1',
            handsonLastPosMap: JSON.parse(localStorage.getItem('ai_handson_last_pos_map') || '{}'),
            handsonLastScrollMap: JSON.parse(localStorage.getItem('ai_handson_last_scroll_map') || '{}'),
            scrollPositions: JSON.parse(localStorage.getItem('ai_scroll_positions') || '{}')
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = 'social_work_sim_backup.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    function importData() {
        const input  = document.createElement('input');
        input.type   = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (Array.isArray(data.wrongList))  state.wrongList   = normalizeIdList(data.wrongList);
                    if (Array.isArray(data.favorites))  state.favorites   = normalizeIdList(data.favorites);
                    if (data.answeredMap && typeof data.answeredMap === 'object')
                        state.answeredMap = normalizeAnsweredMap(data.answeredMap);
                    if (data.handsonAnswers && typeof data.handsonAnswers === 'object')
                        state.handsonAnswers = data.handsonAnswers;
                    if (typeof data.handsonCurrentId === 'string' && data.handsonCurrentId.trim())
                        localStorage.setItem('ai_handson_current_id', data.handsonCurrentId.trim());
                    if (data.handsonLastPosMap && typeof data.handsonLastPosMap === 'object')
                        localStorage.setItem('ai_handson_last_pos_map', JSON.stringify(data.handsonLastPosMap));
                    if (data.handsonLastScrollMap && typeof data.handsonLastScrollMap === 'object')
                        localStorage.setItem('ai_handson_last_scroll_map', JSON.stringify(data.handsonLastScrollMap));
                    if (data.scrollPositions && typeof data.scrollPositions === 'object')
                        localStorage.setItem('ai_scroll_positions', JSON.stringify(data.scrollPositions));
                    syncScrollPositionsFromStorage();
                    if (window.handsonApp?.reloadPersistedState) {
                        window.handsonApp.reloadPersistedState();
                    }
                    saveState();
                    updateActiveIds();
                    renderQuestionPanel();
                    renderQuestion();
                    alert('✅ 数据导入成功！错题、收藏与实操进度已恢复。');
                } catch(err) {
                    alert('❌ 文件格式错误，请选择正确的备份文件。');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // ─── Active IDs ──────────────────────────────────────────
    // Fisher-Yates 洗牌
    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function enforceOrderModeRules() {
        if (state.orderMode === 'mock') {
            state.practiceMode = 'all';
            state.typeFilter = 'all';
            state.appMode = 'exam';
            typeFilterSelect.value = 'all';
            appModeSelect.value = 'exam';
            typeFilterSelect.disabled = true;
            appModeSelect.disabled = true;
            submitExamBtn.classList.remove('submit-exam-hidden');
            return;
        }
        typeFilterSelect.disabled = false;
        appModeSelect.disabled = false;
    }

    function updateActiveIds() {
        const unansweredIds = new Set(
            questionsData
                .filter(q => !state.answeredMap[q.id])
                .map(q => q.id)
        );

        // 模拟组卷模式：优先抽取未答题，不足时再从旧题补齐，确保始终为 100 题
        if (state.orderMode === 'mock') {
            state.practiceMode = 'all';
            let mockIds = [];
            for (const { type, count } of MOCK_CONFIG) {
                const typedIds = questionsData.filter(q => q.type === type).map(q => q.id);
                const freshPool = typedIds.filter(id => unansweredIds.has(id));
                const usedIds = shuffle(freshPool).slice(0, Math.min(count, freshPool.length));
                if (usedIds.length < count) {
                    const fallbackPool = typedIds.filter(id => !usedIds.includes(id));
                    mockIds = mockIds.concat(usedIds, shuffle(fallbackPool).slice(0, count - usedIds.length));
                } else {
                    mockIds = mockIds.concat(usedIds);
                }
            }
            state.activeIds = mockIds;
        } else {
            // 常规模式
            let list = questionsData;
            if (state.chapterFilter !== 'all') {
                list = list.filter(q => q.chapter === state.chapterFilter);
            }
            if (state.practiceMode === 'wrong') {
                list = list.filter(q => state.wrongList.includes(q.id));
            } else if (state.practiceMode === 'fav') {
                list = list.filter(q => state.favorites.includes(q.id));
            }
            if (state.typeFilter !== 'all') {
                list = list.filter(q => q.type === state.typeFilter);
            }
            let ids = list.map(q => q.id);
            if (state.orderMode === 'random') {
                if (state.practiceMode === 'all') {
                    const freshIds = ids.filter(id => unansweredIds.has(id));
                    ids = shuffle(freshIds);
                } else {
                    ids = shuffle(ids);
                }
            }
            state.activeIds = ids;
        }

        if (state.currentIndex >= state.activeIds.length) {
            state.currentIndex = Math.max(0, state.activeIds.length - 1);
        }
    }

    // ─── Get Answered Count ──────────────────────────────────
    function getAnsweredCount() {
        if (state.appMode === 'exam') {
            let count = 0;
            for (const qId of state.activeIds) {
                const answer = state.examAnswers[qId];
                if (typeof answer === 'string' && answer.trim().length > 0) count++;
            }
            return count;
        }

        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        const map = isRePractice ? state.sessionAnsweredMap : state.answeredMap;

        const isGlobalProgressMode =
            state.practiceMode === 'all' &&
            state.orderMode === 'sequential' &&
            state.typeFilter === 'all';

        if (isGlobalProgressMode) {
            return Object.keys(state.answeredMap).length;
        }

        let count = 0;
        for (const qId of state.activeIds) {
            if (map[qId]) count++;
        }
        return count;
    }

    // ─── Get Correct/Wrong Counts ────────────────────────────
    function getCorrectWrongCounts() {
        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        const map = isRePractice ? state.sessionAnsweredMap : state.answeredMap;
        
        const isGlobalProgressMode =
            state.practiceMode === 'all' &&
            state.orderMode === 'sequential' &&
            state.typeFilter === 'all';

        let correctCount = 0;
        let wrongCount = 0;

        if (isGlobalProgressMode) {
            Object.values(state.answeredMap).forEach(record => {
                if (record) {
                    if (record.result === 'correct') correctCount++;
                    else if (record.result === 'wrong') wrongCount++;
                }
            });
        } else {
            state.activeIds.forEach(id => {
                const record = map[id];
                if (record) {
                    if (record.result === 'correct') correctCount++;
                    else if (record.result === 'wrong') wrongCount++;
                }
            });
        }
        
        return { correctCount, wrongCount };
    }

    // ─── Badges & Progress ───────────────────────────────────
    function updateBadges() {
        wrongCount.innerText = state.wrongList.length;
        favCount.innerText   = state.favorites.length;
        const isGlobalProgressMode =
            state.appMode !== 'exam' &&
            state.practiceMode === 'all' &&
            state.orderMode === 'sequential' &&
            state.typeFilter === 'all';

        const total = isGlobalProgressMode ? questionsData.length : state.activeIds.length;
        const current = total === 0 ? 0 : getAnsweredCount();
        progressText.innerText    = `${current} / ${total}`;
        progressFill.style.width  = total === 0 ? '0%' : `${(current / total) * 100}%`;
        
        // 更新正确/错误统计
        const { correctCount, wrongCount: wrongStatCount } = getCorrectWrongCounts();
        if (correctCountEl) correctCountEl.innerText = correctCount;
        if (wrongStatCountEl) wrongStatCountEl.innerText = wrongStatCount;
        
        // 更新正确率百分比 (答对总数 / 总题数)
        if (accuracyPercentEl) {
            if (total === 0) {
                accuracyPercentEl.innerText = '0%';
            } else {
                const accuracy = Math.round((correctCount / total) * 100);
                accuracyPercentEl.innerText = `${accuracy}%`;
            }
        }
        
        if (total > 0) {
            const currentQId = state.activeIds[state.currentIndex];
            favBtn.classList.toggle('active', state.favorites.includes(currentQId));
        }

        // 更新左侧导航按钮文字
        const navLabel = document.getElementById('nav-mode-label');
        if (navLabel) {
            if (state.orderMode === 'mock') {
                navLabel.textContent = '模拟组卷';
            } else if (state.appMode === 'exam') {
                navLabel.textContent = '考试模式';
            } else {
                navLabel.textContent = '练习模式';
            }
        }
    }

    // ─── Question Panel (题目导航面板) ───────────────────────
    function renderQuestionPanel() {
        if (!questionGrid) return;
        questionGrid.innerHTML = '';
        const currentQId = state.activeIds[state.currentIndex];

        // 仅获取当前活跃（过滤后）的题目
        const activeQuestions = questionsData.filter(q => state.activeIds.includes(q.id));

        // 按题型分组
        const typeOrder = ['单选题', '多选题'];
        const groups = {};
        activeQuestions.forEach(q => {
            if (!groups[q.type]) groups[q.type] = [];
            groups[q.type].push(q);
        });

        typeOrder.forEach(type => {
            const items = groups[type];
            if (!items || items.length === 0) return;

            const count = items.length;

            // 分组标题
            const header = document.createElement('div');
            header.className = 'qp-group-header';
            header.textContent = `${type}（当前筛选：${count} 题）`;
            questionGrid.appendChild(header);

            // 题号按钮网格容器
            const grid = document.createElement('div');
            grid.className = 'qp-group-grid';

            items.forEach(q => {
                const btn = document.createElement('button');
                btn.className   = 'qp-btn';
                btn.textContent = q.id;
                btn.title       = `第 ${q.id} 题 [${q.type}]`;
                btn.dataset.id  = q.id;

                const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
                const record    = isRePractice ? state.sessionAnsweredMap[q.id] : state.answeredMap[q.id];
                const isActive  = state.activeIds.includes(q.id);
                const isCurrent = q.id === currentQId;

                if (isCurrent)                    btn.classList.add('qp-current');
                if (!isActive)                    btn.classList.add('qp-inactive');
                if (record?.result === 'correct') btn.classList.add('qp-correct');
                if (record?.result === 'wrong')   btn.classList.add('qp-wrong');

                btn.addEventListener('click', () => {
                    const idx = state.activeIds.indexOf(q.id);
                    if (idx === -1) return;
                    state.currentIndex = idx;
                    saveState();
                    renderQuestionPanel();
                    renderQuestion();
                    btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                });

                grid.appendChild(btn);
            });

            questionGrid.appendChild(grid);
        });

        // 自动滚动到当前题目
        const currentBtn = questionGrid.querySelector('.qp-current');
        if (currentBtn) {
            setTimeout(() => currentBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
        }
    }

    // ─── Render Question ─────────────────────────────────────
    function renderQuestion() {
        state.hasAnsweredCurrent = false;
        state.selectedMultiOptions = [];

        // Mode badge
        if (state.practiceMode === 'wrong') {
            modeBadge.innerText = '正在复习错题';
            modeBadge.classList.remove('hidden');
            exitModeBtn.classList.remove('hidden');
        } else if (state.practiceMode === 'fav') {
            modeBadge.innerText = '正在练习收藏';
            modeBadge.classList.remove('hidden');
            exitModeBtn.classList.remove('hidden');
        } else {
            modeBadge.classList.add('hidden');
            exitModeBtn.classList.add('hidden');
        }

        if (state.activeIds.length === 0) {
            qType.innerText  = '暂无题目';
            qTitle.innerText = '当前过滤条件下没有可用的题目，请更改筛选或退出重练模式。';
            qOptions.innerHTML = '';
            feedbackArea.className = 'feedback-area hidden';
            multiActions.classList.add('hidden');
            prevBtn.style.visibility = 'hidden';
            nextBtn.style.visibility = 'hidden';
            favBtn.disabled = true;
            updateBadges();
            return;
        }

        favBtn.disabled = false;
        const qId = state.activeIds[state.currentIndex];
        const q   = questionsData.find(item => item.id === qId);
        if (!q) {
            qType.innerText = '题目异常';
            qTitle.innerText = `题目 #${qId} 未找到，请刷新页面或重新导入题库。`;
            qOptions.innerHTML = '';
            feedbackArea.className = 'feedback-area hidden';
            multiActions.classList.add('hidden');
            updateBadges();
            return;
        }

        qType.innerText  = q.type || '单选题';
        qTitle.innerHTML = `${q.id}. ${q.question}`;

        // 考试模式：恢复已选答案的视觉状态
        let currentGiven = state.appMode === 'exam' ? state.examAnswers[q.id] || '' : '';
        if (state.appMode === 'exam' && q.type === '多选题' && currentGiven) {
            state.selectedMultiOptions = currentGiven.split('');
        }

        // 渲染选项
        qOptions.innerHTML = '';
        q.options.forEach(opt => {
            const btn       = document.createElement('button');
            btn.className   = 'option-btn';
            btn.innerHTML   = `<span class="opt-key">${opt.key}</span> <span class="opt-text">${opt.text}</span>`;
            btn.dataset.key = opt.key;
            if (state.appMode === 'exam' && currentGiven.includes(opt.key)) {
                btn.style.borderColor = 'var(--primary-color)';
                btn.style.background  = 'rgba(59, 130, 246, 0.1)';
            }
            btn.addEventListener('click', () => handleOptionClick(opt.key, btn, q.type));
            qOptions.appendChild(btn);
        });

        // 检查是否已作答（练习模式锁定题目）
        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        const record = (state.appMode === 'practice') 
            ? (isRePractice ? state.sessionAnsweredMap[q.id] : state.answeredMap[q.id]) 
            : null;

        if (record) {
            state.hasAnsweredCurrent = true;
            // 还原选项颜色
            const allBtns = qOptions.querySelectorAll('.option-btn');
            allBtns.forEach(b => {
                b.disabled = true;
                if (q.answer.includes(b.dataset.key)) {
                    b.classList.add('correct');
                } else if (record.given && record.given.includes(b.dataset.key)) {
                    b.classList.add('wrong');
                }
            });
            // 显示反馈
            feedbackPlaceholder.style.display = 'none';
            feedbackArea.className = `feedback-area ${record.result === 'correct' ? 'success' : 'error'}`;
            feedbackResult.innerText = record.result === 'correct' ? '🎉 回答正确！' : '❌ 回答错误';
            realAnswer.innerText   = q.answer;
            const explanationEl = document.getElementById('explanation');
            if (explanationEl) {
                explanationEl.innerHTML = q.explanation || '暂无详细解析。';
            }
            multiActions.classList.add('hidden');
        } else {
            feedbackArea.className = 'feedback-area hidden';
            if (feedbackPlaceholder) feedbackPlaceholder.style.display = 'block';
            if (q.type === '多选题' && state.appMode === 'practice') {
                multiActions.classList.remove('hidden');
                submitMultiBtn.disabled = state.selectedMultiOptions.length === 0;
            } else {
                multiActions.classList.add('hidden');
            }
        }

        // 导航按钮
        const isFirst = state.currentIndex === 0;
        const isLast  = state.currentIndex === state.activeIds.length - 1;
        prevBtn.style.visibility = 'visible';
        nextBtn.style.visibility = 'visible';
        prevBtn.innerText = isFirst ? '最后一题' : '上一题';
        nextBtn.innerText = isLast  ? '第一题'   : '下一题';

        updateBadges();
        renderQuestionPanel();
    }

    // ─── Handle Option Click ─────────────────────────────────
    function handleOptionClick(selectedKey, btnElement, qType) {
        if (state.hasAnsweredCurrent && state.appMode === 'practice') return;
        const qId = state.activeIds[state.currentIndex];

        if (qType === '多选题') {
            const idx = state.selectedMultiOptions.indexOf(selectedKey);
            if (idx > -1) {
                state.selectedMultiOptions.splice(idx, 1);
                btnElement.style.borderColor = 'var(--border-color)';
                btnElement.style.background  = 'var(--bg-color)';
            } else {
                state.selectedMultiOptions.push(selectedKey);
                btnElement.style.borderColor = 'var(--primary-color)';
                btnElement.style.background  = 'rgba(59, 130, 246, 0.1)';
            }
            if (state.appMode === 'practice') {
                submitMultiBtn.disabled = state.selectedMultiOptions.length === 0;
            } else {
                const answer = state.selectedMultiOptions.join('');
                if (answer) state.examAnswers[qId] = answer;
                else delete state.examAnswers[qId];
            }
            return;
        }

        if (state.appMode === 'exam') {
            qOptions.querySelectorAll('.option-btn').forEach(b => {
                b.style.borderColor = 'var(--border-color)';
                b.style.background  = 'var(--bg-color)';
            });
            btnElement.style.borderColor = 'var(--primary-color)';
            btnElement.style.background  = 'rgba(59, 130, 246, 0.1)';
            state.examAnswers[qId] = selectedKey;
        } else {
            submitAnswer(selectedKey);
        }
    }

    // ─── Submit Answer ───────────────────────────────────────
    function submitAnswer(givenAnswerStr) {
        if (state.appMode === 'exam') return;
        state.hasAnsweredCurrent = true;
        const qId = state.activeIds[state.currentIndex];
        const q   = questionsData.find(item => item.id === qId);

        const finalAnswer   = givenAnswerStr.split('').sort().join('');
        const correctAnswer = q.answer.split('').sort().join('');
        const isCorrect     = finalAnswer === correctAnswer;

        // 更新 answeredMap 或 sessionAnsweredMap
        const resultRecord = { result: isCorrect ? 'correct' : 'wrong', given: finalAnswer };
        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        
        if (isRePractice) {
            state.sessionAnsweredMap[q.id] = resultRecord;
        } else {
            state.answeredMap[q.id] = resultRecord;
        }

        // 高亮选项
        qOptions.querySelectorAll('.option-btn').forEach(b => {
            b.disabled = true;
            b.style.background  = '';
            b.style.borderColor = '';
            if (q.answer.includes(b.dataset.key))  b.classList.add('correct');
            else if (finalAnswer.includes(b.dataset.key)) b.classList.add('wrong');
        });

        if (isCorrect) {
            if (feedbackPlaceholder) feedbackPlaceholder.style.display = 'none';
            feedbackArea.className   = 'feedback-area success';
            feedbackResult.innerText = '🎉 回答正确！';
            if (state.practiceMode === 'wrong') {
                state.wrongList = state.wrongList.filter(id => id !== q.id);
            }
        } else {
            if (feedbackPlaceholder) feedbackPlaceholder.style.display = 'none';
            feedbackArea.className   = 'feedback-area error';
            feedbackResult.innerText = '❌ 回答错误';
            if (!state.wrongList.includes(q.id)) state.wrongList.push(q.id);
        }

        realAnswer.innerText = q.answer;
        const explanationEl = document.getElementById('explanation');
        if (explanationEl) {
            explanationEl.innerHTML = q.explanation || '暂无详细解析。';
        }
        if (q.type === '多选题') multiActions.classList.add('hidden');
        saveState();
        renderQuestionPanel();
    }

    // ─── Exam Finish ─────────────────────────────────────────
    function finishExam() {
        let correctCount = 0, wrongCount = 0;
        let score = 0;
        const answeredIds = state.activeIds.filter(id => {
            const value = state.examAnswers[id];
            return typeof value === 'string' && value.trim().length > 0;
        });

        answeredIds.forEach(id => {
            const q  = questionsData.find(item => item.id === id);
            if (!q) return;
            const given   = state.examAnswers[id].split('').sort().join('');
            const correct = q.answer.split('').sort().join('');
            if (given === correct) {
                correctCount++;
                state.answeredMap[id] = { result: 'correct', given };
                state.wrongList = state.wrongList.filter(wid => wid !== id);
                if (q.type === '单选题') score += 1;
                else if (q.type === '多选题') score += 2;
            } else {
                wrongCount++;
                state.answeredMap[id] = { result: 'wrong', given };
                if (!state.wrongList.includes(id)) state.wrongList.push(id);
            }
        });

        const totalItems = state.activeIds.length;
        score = Math.round(score * 10) / 10; // 修复判断题(0.5分)累加的浮点精度
        examScore.innerText    = `${score}分`;
        examTotal.innerText    = totalItems;
        examAnswered.innerText = answeredIds.length;
        examCorrect.innerText  = correctCount;
        examWrong.innerText    = wrongCount;

        examModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        saveState();
    }

    // ─── Favorite ────────────────────────────────────────────
    function toggleFavorite() {
        if (state.activeIds.length === 0) return;
        const qId   = state.activeIds[state.currentIndex];
        const index = state.favorites.indexOf(qId);
        if (index > -1) {
            state.favorites.splice(index, 1);
            favBtn.classList.remove('active');
        } else {
            state.favorites.push(qId);
            favBtn.classList.add('active');
        }
        saveState();
    }

    const storedScrollPositions = JSON.parse(localStorage.getItem('ai_scroll_positions') || '{}');
    const scrollPositions = Object.entries(storedScrollPositions).reduce((acc, [key, value]) => {
        acc[key] = Number.isFinite(value) ? value : 0;
        return acc;
    }, {});
    let lastView = 'practice';

    function saveScrollPositions() {
        localStorage.setItem('ai_scroll_positions', JSON.stringify(scrollPositions));
    }

    function saveViewScroll(viewName = lastView, scrollY = window.scrollY) {
        if (!viewName) return;
        scrollPositions[viewName] = Math.max(0, Math.round(scrollY));
        saveScrollPositions();
    }

    function getSavedViewScroll(viewName) {
        const value = scrollPositions[viewName];
        return Number.isFinite(value) ? value : 0;
    }

    function syncScrollPositionsFromStorage() {
        const persisted = JSON.parse(localStorage.getItem('ai_scroll_positions') || '{}');
        Object.keys(scrollPositions).forEach(key => delete scrollPositions[key]);
        Object.entries(persisted).forEach(([key, value]) => {
            scrollPositions[key] = Number.isFinite(value) ? value : 0;
        });
    }

    // ─── View Switch ─────────────────────────────────────────
    function switchView(viewName) {
        if (!views[viewName]) return;
        saveViewScroll(lastView);

        Object.values(views).forEach(v => {
            if (v) v.classList.remove('active');
        });
        views[viewName].classList.add('active');
        navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));
        
        if (viewName === 'wrong')     renderList(state.wrongList, wrongListContainer, '错题本');
        if (viewName === 'favorites') renderList(state.favorites, favListContainer,   '收藏夹');

        // 恢复目标视图的滚动位置
        const targetScroll = getSavedViewScroll(viewName);
        lastView = viewName;

        requestAnimationFrame(() => {
            window.scrollTo(0, targetScroll);
        });
    }

    // ─── Render List (Wrong / Fav) ───────────────────────────
    function renderList(idArray, container, emptyMsg) {
        if (!container) return;
        container.innerHTML = '';
        if (!idArray || idArray.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-secondary);">暂无数据 (${emptyMsg})</div>`;
            return;
        }

        // 确保 ID 类型匹配且题目存在
        const items = questionsData.filter(q => idArray.includes(Number(q.id)));

        if (items.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-secondary);">未找到对应题目内容 (${emptyMsg})</div>`;
            return;
        }

        items.forEach(q => {
            const el = document.createElement('div');
            el.className = 'list-item';
            let optHtml = '<div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.25rem;">';
            if (q.options && Array.isArray(q.options)) {
                q.options.forEach(opt => {
                    const isAns = q.answer && q.answer.includes(opt.key);
                    optHtml += `<div style="font-size:0.9rem;${isAns ? 'color:var(--success-color);font-weight:600;' : 'color:var(--text-secondary);'}">${opt.key}. ${opt.text}</div>`;
                });
            }
            optHtml += '</div>';
            el.innerHTML = `
                <div class="list-item-header">
                    <div class="list-item-title">${q.id}. [${q.type}] ${q.question}</div>
                    <button class="icon-btn" onclick="app.removeFromList('${emptyMsg === '错题本' ? 'wrong' : 'fav'}', ${q.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                ${optHtml}
                <div class="list-item-answer">正确答案：<span>${q.answer || '未知'}</span></div>
                <div class="list-item-explanation">
                    <div class="list-item-explanation-title">💡 解析：</div>
                    ${q.explanation || '暂无详细解析。'}
                </div>`;
            container.appendChild(el);
        });
    }

    // ─── Event Listeners ─────────────────────────────────────
    function setupEventListeners() {
        prevBtn.addEventListener('click', () => {
            state.currentIndex = state.currentIndex > 0 ? state.currentIndex - 1 : state.activeIds.length - 1;
            saveState(); renderQuestionPanel(); renderQuestion();
        });
        nextBtn.addEventListener('click', () => {
            state.currentIndex = state.currentIndex < state.activeIds.length - 1 ? state.currentIndex + 1 : 0;
            saveState(); renderQuestionPanel(); renderQuestion();
        });

        favBtn.addEventListener('click', toggleFavorite);
        submitMultiBtn.addEventListener('click', () => submitAnswer(state.selectedMultiOptions.join('')));

        navBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
        sysBtns.forEach(btn => btn.addEventListener('click', () => {
            requestAnimationFrame(() => {
                const currentTheoryView = document.querySelector('.nav-btn.active')?.dataset.view || lastView || 'practice';
                lastView = currentTheoryView;
                window.scrollTo(0, getSavedViewScroll(currentTheoryView));
            });
        }));

        window.addEventListener('scroll', () => {
            if (document.body.classList.contains('handson-mode')) return;
            const activeTheoryView = document.querySelector('.nav-btn.active')?.dataset.view || lastView;
            saveViewScroll(activeTheoryView);
        }, { passive: true });

        startWrongPracticeBtn.addEventListener('click', () => {
            state.practiceMode = 'wrong'; state.currentIndex = 0;
            state.sessionAnsweredMap = {}; // 开始重练时清空临时进度
            switchView('practice'); updateActiveIds(); renderQuestionPanel(); renderQuestion();
        });
        startFavPracticeBtn.addEventListener('click', () => {
            state.practiceMode = 'fav'; state.currentIndex = 0;
            state.sessionAnsweredMap = {}; // 开始重练时清空临时进度
            switchView('practice'); updateActiveIds(); renderQuestionPanel(); renderQuestion();
        });
        exitModeBtn.addEventListener('click', () => {
            state.practiceMode = 'all'; updateActiveIds(); renderQuestionPanel(); renderQuestion();
        });

        orderModeSelect.addEventListener('change', (e) => {
            const prevOrderMode = state.orderMode;
            state.orderMode = e.target.value;
            state.currentIndex = 0;
            if (state.orderMode === 'mock' && prevOrderMode !== 'mock') {
                state.examAnswers = {};
            }
            enforceOrderModeRules();
            saveState(); updateActiveIds(); renderQuestionPanel(); renderQuestion();
        });
        if (chapterFilterSelect) {
            chapterFilterSelect.addEventListener('change', (e) => {
                state.chapterFilter = e.target.value;
                state.currentIndex = 0;
                saveState(); 
                updateActiveIds(); 
                renderQuestionPanel(); // 重新渲染左侧列表
                renderQuestion(); 
            });
        }
        typeFilterSelect.addEventListener('change', (e) => {
            state.typeFilter = e.target.value; state.currentIndex = 0;
            saveState(); 
            updateActiveIds(); 
            renderQuestionPanel(); // 重新渲染左侧列表
            renderQuestion();
        });
        appModeSelect.addEventListener('change', (e) => {
            state.appMode    = e.target.value;
            if (state.orderMode === 'mock') {
                state.appMode = 'exam';
                appModeSelect.value = 'exam';
            }
            state.examAnswers = {};
            submitExamBtn.classList.toggle('submit-exam-hidden', state.appMode !== 'exam');
            saveState(); renderQuestion();
        });

        submitExamBtn.addEventListener('click', () => {
            const answeredCount = state.activeIds.filter(id => {
                const value = state.examAnswers[id];
                return typeof value === 'string' && value.trim().length > 0;
            }).length;
            if (answeredCount < state.activeIds.length) {
                if (!confirm('还有未作答的题目，确定要提前交卷吗？')) return;
            }
            finishExam();
        });
        closeModalBtn.addEventListener('click', () => {
            examModal.classList.add('hidden');
            document.body.style.overflow = '';
            state.appMode = 'practice';
            appModeSelect.value = 'practice';
            submitExamBtn.classList.add('submit-exam-hidden');
            if (state.orderMode !== 'mock') {
                enforceOrderModeRules();
            }
            saveState(); renderQuestion();
        });

        clearDataBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有错题、收藏和答题进度吗？')) {
                state.wrongList    = [];
                state.favorites    = [];
                state.answeredMap  = {};
                state.handsonAnswers = {};
                state.practiceMode = 'all';
                state.currentIndex = 0;
                localStorage.removeItem('ai_handson_last_pos_map');
                localStorage.removeItem('ai_handson_last_scroll_map');
                localStorage.removeItem('ai_scroll_positions');
                localStorage.setItem('ai_handson_current_id', 'H1');
                syncScrollPositionsFromStorage();
                if (window.handsonApp?.reloadPersistedState) {
                    window.handsonApp.reloadPersistedState();
                }
                orderModeSelect.value  = 'sequential';
                state.orderMode    = 'sequential';
                appModeSelect.value = 'practice';
                state.appMode = 'practice';
                state.examAnswers = {};
                typeFilterSelect.value = 'all';
                state.typeFilter   = 'all';
                enforceOrderModeRules();
                submitExamBtn.classList.add('submit-exam-hidden');
                saveState(); updateActiveIds(); renderQuestionPanel();
                switchView('practice'); renderQuestion();
            }
        });

        document.getElementById('export-btn').addEventListener('click', exportData);
        document.getElementById('import-btn').addEventListener('click', importData);
    }

    // ─── Global API ──────────────────────────────────────────
    window.app = {
        getState: () => state,
        saveActiveState: () => saveState(),
        removeFromList: (type, id) => {
            if (type === 'wrong') {
                state.wrongList = state.wrongList.filter(item => item !== id);
                renderList(state.wrongList, wrongListContainer, '错题本');
            } else {
                state.favorites = state.favorites.filter(item => item !== id);
                renderList(state.favorites, favListContainer, '收藏夹');
                if (state.activeIds[state.currentIndex] === id) favBtn.classList.remove('active');
            }
            saveState();
        }
    };

    init();
});
