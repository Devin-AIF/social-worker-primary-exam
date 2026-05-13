/**
 * 社会工作者考试模拟系统 - 核心逻辑脚本 (v1.08)
 * 
 * 功能模块：
 * 1. 状态管理 (答题记录、错题、收藏、模式切换)
 * 2. 界面渲染 (题目卡片、题号面板、列表视图)
 * 3. 统计计算 (进度、正确率、得分统计)
 * 4. 数据交互 (导出/导入 JSON 备份)
 * 5. 交互增强 (主题切换、动态激励语、本地日志查阅)
 */

// ─── 模拟组卷配置（社会工作者初级实务标准：60单选 + 20多选）────
const MOCK_CONFIG = [
    { type: '单选题', count: 60 },
    { type: '多选题', count: 20 }
];

document.addEventListener('DOMContentLoaded', () => {
    // 检查数据源
    if (typeof questionsData === 'undefined' || !questionsData.length) {
        const titleEl = document.getElementById('q-title');
        if (titleEl) titleEl.innerText = "加载题库失败或无数据，请检查 js/questions.js。";
        return;
    }

    // ─── 全局状态对象 ───
    const state = {
        currentIndex: parseInt(localStorage.getItem('ai_current_index')) || 0, // 当前题目索引
        wrongList:    JSON.parse(localStorage.getItem('ai_wrong_list'))   || [], // 错题 ID 列表
        favorites:    JSON.parse(localStorage.getItem('ai_favorites'))     || [], // 收藏 ID 列表
        
        // answeredMap 结构: { [qId]: { result: 'correct'|'wrong', given: 'AB' } }
        answeredMap:  JSON.parse(localStorage.getItem('ai_answered_map')) || {}, // 全局持久化答题记录
        
        orderMode:    localStorage.getItem('ai_order_mode')     || 'sequential', // 出题顺序: sequential|random|mock
        chapterFilter: localStorage.getItem('ai_chapter_filter') || 'all',        // 章节筛选器
        typeFilter:   localStorage.getItem('ai_type_filter')    || 'all',        // 题型筛选器
        appMode:      localStorage.getItem('ai_app_mode')       || 'practice',   // 应用模式: practice(练习)|exam(考试)
        
        practiceMode: 'all',        // 子模式: all(正常)|wrong(重练错题)|fav(重练收藏)
        hasAnsweredCurrent: false,  // 当前题是否已在此 session 中回答
        activeIds: [],              // 当前筛选条件下的活跃题目 ID 数组
        selectedMultiOptions: [],   // 多选题当前选中的选项记录
        examAnswers: {},            // 考试/交卷模式下的临时选择记录
        sessionAnsweredMap: {},     // 重练模式下的临时作答记录（不干扰全局统计）
    };

    // ─── 数据规范化辅助函数 ───
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

    // 初始化规范化数据
    state.currentIndex = Number.isInteger(state.currentIndex) && state.currentIndex >= 0 ? state.currentIndex : 0;
    state.wrongList = normalizeIdList(state.wrongList);
    state.favorites = normalizeIdList(state.favorites);
    state.answeredMap = normalizeAnsweredMap(state.answeredMap);

    // ─── DOM 元素引用 ───
    const views = {
        practice:  document.getElementById('view-practice'),
        wrong:     document.getElementById('view-wrong'),
        favorites: document.getElementById('view-favorites')
    };
    const navBtns = document.querySelectorAll('.nav-btn');

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

    // ─── 主题管理 ───
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
        if (theme === 'auto') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', theme);
        }
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    }

    // ─── 动态激励语系统 ───
    function updateCountdown() {
        const countdownEl = document.getElementById('countdown-value');
        if (!countdownEl) return;
        
        const slogans = [
            "勤学苦练，必有所获", "持之以恒，金石为开", "书山有路，勤奋为径",
            "百尺竿头，更进一步", "学而不厌，诲人不倦", "博学笃志，切问近思",
            "功不唐捐，玉汝于成", "绳锯木断，水滴石穿", "今日寒窗，明日辉煌",
            "精诚所至，金石为开", "不积跬步，无以至千里", "锲而不舍，金石可镂",
            "宝剑锋从磨砺出", "梅花香自苦寒来"
        ];
        
        const randomSlogan = slogans[Math.floor(Math.random() * slogans.length)];
        countdownEl.textContent = randomSlogan;
    }

    // ─── 初始化逻辑 ───
    function init() {
        initTheme();
        updateCountdown(); 

        // 填充章节下拉框
        if (chapterFilterSelect) {
            const chapters = [...new Set(questionsData.map(q => q.chapter))].filter(Boolean);
            chapters.sort((a, b) => {
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
    }

    // ─── 状态持久化 ───
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

    // ─── 数据备份导出/导入 ───
    function exportData() {
        const data = {
            schemaVersion: '1.25', // 对应 v1.08 的内部版本
            exportedAt: new Date().toISOString(),
            wrongList:   state.wrongList,
            favorites:   state.favorites,
            answeredMap: state.answeredMap,
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
                    
                    if (data.scrollPositions && typeof data.scrollPositions === 'object')
                        localStorage.setItem('ai_scroll_positions', JSON.stringify(data.scrollPositions));
                    
                    saveState();
                    updateActiveIds();
                    renderQuestionPanel();
                    renderQuestion();
                    alert('✅ 数据导入成功！');
                } catch(err) {
                    alert('❌ 文件格式错误。');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // ─── 活跃题目过滤逻辑 ───
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
            questionsData.filter(q => !state.answeredMap[q.id]).map(q => q.id)
        );

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
            let list = questionsData;
            if (state.chapterFilter !== 'all') list = list.filter(q => q.chapter === state.chapterFilter);
            if (state.practiceMode === 'wrong') list = list.filter(q => state.wrongList.includes(Number(q.id)));
            else if (state.practiceMode === 'fav') list = list.filter(q => state.favorites.includes(Number(q.id)));
            
            if (state.typeFilter !== 'all') list = list.filter(q => q.type === state.typeFilter);
            
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

    // ─── 统计计算核心 ───
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
            state.practiceMode === 'all' && state.orderMode === 'sequential' && state.typeFilter === 'all';

        if (isGlobalProgressMode) return Object.keys(state.answeredMap).length;

        let count = 0;
        for (const qId of state.activeIds) {
            if (map[qId]) count++;
        }
        return count;
    }

    function getCorrectWrongCounts() {
        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        const map = isRePractice ? state.sessionAnsweredMap : state.answeredMap;
        
        const isGlobalProgressMode =
            state.practiceMode === 'all' && state.orderMode === 'sequential' && state.typeFilter === 'all';

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

    // ─── UI 状态同步 ───
    function updateBadges() {
        wrongCount.innerText = state.wrongList.length;
        favCount.innerText   = state.favorites.length;
        
        const isGlobalProgressMode =
            state.appMode !== 'exam' && state.practiceMode === 'all' && 
            state.orderMode === 'sequential' && state.typeFilter === 'all';

        const total = isGlobalProgressMode ? questionsData.length : state.activeIds.length;
        const current = total === 0 ? 0 : getAnsweredCount();
        
        progressText.innerText    = `${current} / ${total}`;
        progressFill.style.width  = total === 0 ? '0%' : `${(current / total) * 100}%`;
        
        const { correctCount, wrongCount: wrongStatCount } = getCorrectWrongCounts();
        if (correctCountEl) correctCountEl.innerText = correctCount;
        if (wrongStatCountEl) wrongStatCountEl.innerText = wrongStatCount;
        
        if (accuracyPercentEl) {
            if (total === 0) accuracyPercentEl.innerText = '0%';
            else {
                // 正确率 = (本题集答对总数 / 本题集总题数)
                const accuracy = Math.round((correctCount / total) * 100);
                accuracyPercentEl.innerText = `${accuracy}%`;
            }
        }
        
        if (total > 0) {
            const currentQId = state.activeIds[state.currentIndex];
            favBtn.classList.toggle('active', state.favorites.includes(Number(currentQId)));
        }
    }

    // ─── 题号导航面板渲染 ───
    function renderQuestionPanel() {
        if (!questionGrid) return;
        questionGrid.innerHTML = '';
        const currentQId = state.activeIds[state.currentIndex];
        const activeQuestions = questionsData.filter(q => state.activeIds.includes(q.id));

        const typeOrder = ['单选题', '多选题'];
        const groups = {};
        activeQuestions.forEach(q => {
            if (!groups[q.type]) groups[q.type] = [];
            groups[q.type].push(q);
        });

        typeOrder.forEach(type => {
            const items = groups[type];
            if (!items || items.length === 0) return;

            const header = document.createElement('div');
            header.className = 'qp-group-header';
            header.textContent = `${type}（当前：${items.length} 题）`;
            questionGrid.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'qp-group-grid';

            items.forEach(q => {
                const btn = document.createElement('button');
                btn.className   = 'qp-btn';
                btn.textContent = q.id;
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
                    renderQuestion();
                });
                grid.appendChild(btn);
            });
            questionGrid.appendChild(grid);
        });

        const currentBtn = questionGrid.querySelector('.qp-current');
        if (currentBtn) {
            setTimeout(() => currentBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
        }
    }

    // ─── 题目卡片渲染 ───
    function renderQuestion() {
        state.hasAnsweredCurrent = false;
        state.selectedMultiOptions = [];

        // 顶部的练习模式徽章
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
            qTitle.innerText = '当前筛选下无可用题目。';
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
        if (!q) return;

        qType.innerText  = q.type || '单选题';
        qTitle.innerHTML = `${q.id}. ${q.question}`;

        // 渲染选项逻辑
        let currentGiven = state.appMode === 'exam' ? state.examAnswers[q.id] || '' : '';
        if (state.appMode === 'exam' && q.type === '多选题' && currentGiven) {
            state.selectedMultiOptions = currentGiven.split('');
        }

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

        // 检查作答状态并展示反馈
        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        const record = (state.appMode === 'practice') 
            ? (isRePractice ? state.sessionAnsweredMap[q.id] : state.answeredMap[q.id]) 
            : null;

        if (record) {
            state.hasAnsweredCurrent = true;
            const allBtns = qOptions.querySelectorAll('.option-btn');
            allBtns.forEach(b => {
                b.disabled = true;
                if (q.answer.includes(b.dataset.key)) b.classList.add('correct');
                else if (record.given && record.given.includes(b.dataset.key)) b.classList.add('wrong');
            });
            feedbackPlaceholder.style.display = 'none';
            feedbackArea.className = `feedback-area ${record.result === 'correct' ? 'success' : 'error'}`;
            feedbackResult.innerText = record.result === 'correct' ? '🎉 回答正确！' : '❌ 回答错误';
            realAnswer.innerText   = q.answer;
            const explanationEl = document.getElementById('explanation');
            if (explanationEl) explanationEl.innerHTML = q.explanation || '暂无详细解析。';
            multiActions.classList.add('hidden');
        } else {
            feedbackArea.className = 'feedback-area hidden';
            feedbackPlaceholder.style.display = 'block';
            if (q.type === '多选题' && state.appMode === 'practice') {
                multiActions.classList.remove('hidden');
                submitMultiBtn.disabled = state.selectedMultiOptions.length === 0;
            } else {
                multiActions.classList.add('hidden');
            }
        }

        prevBtn.style.visibility = 'visible';
        nextBtn.style.visibility = 'visible';
        prevBtn.innerText = (state.currentIndex === 0) ? '最后一题' : '上一题';
        nextBtn.innerText = (state.currentIndex === state.activeIds.length - 1) ? '第一题' : '下一题';

        updateBadges();
        renderQuestionPanel();
    }

    // ─── 选项点击处理 ───
    function handleOptionClick(selectedKey, btnElement, qType) {
        if (state.hasAnsweredCurrent && state.appMode === 'practice') return;
        const qId = state.activeIds[state.currentIndex];

        if (qType === '多选题') {
            const idx = state.selectedMultiOptions.indexOf(selectedKey);
            if (idx > -1) {
                state.selectedMultiOptions.splice(idx, 1);
                btnElement.style.borderColor = 'var(--border-color)';
                btnElement.style.background  = 'var(--surface-color)';
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
                b.style.background  = 'var(--surface-color)';
            });
            btnElement.style.borderColor = 'var(--primary-color)';
            btnElement.style.background  = 'rgba(59, 130, 246, 0.1)';
            state.examAnswers[qId] = selectedKey;
        } else {
            submitAnswer(selectedKey);
        }
    }

    // ─── 作答提交 ───
    function submitAnswer(givenAnswerStr) {
        if (state.appMode === 'exam') return;
        state.hasAnsweredCurrent = true;
        const qId = state.activeIds[state.currentIndex];
        const q   = questionsData.find(item => item.id === qId);

        const finalAnswer   = givenAnswerStr.split('').sort().join('');
        const correctAnswer = q.answer.split('').sort().join('');
        const isCorrect     = finalAnswer === correctAnswer;

        const resultRecord = { result: isCorrect ? 'correct' : 'wrong', given: finalAnswer };
        const isRePractice = state.practiceMode === 'wrong' || state.practiceMode === 'fav';
        
        if (isRePractice) {
            state.sessionAnsweredMap[q.id] = resultRecord;
        } else {
            state.answeredMap[q.id] = resultRecord;
        }

        qOptions.querySelectorAll('.option-btn').forEach(b => {
            b.disabled = true;
            b.style.background  = ''; b.style.borderColor = '';
            if (q.answer.includes(b.dataset.key)) b.classList.add('correct');
            else if (finalAnswer.includes(b.dataset.key)) b.classList.add('wrong');
        });

        if (isCorrect) {
            feedbackArea.className = 'feedback-area success';
            feedbackResult.innerText = '🎉 回答正确！';
            if (state.practiceMode === 'wrong') {
                state.wrongList = state.wrongList.filter(id => id !== Number(q.id));
            }
        } else {
            feedbackArea.className = 'feedback-area error';
            feedbackResult.innerText = '❌ 回答错误';
            if (!state.wrongList.includes(Number(q.id))) state.wrongList.push(Number(q.id));
        }

        realAnswer.innerText = q.answer;
        const explanationEl = document.getElementById('explanation');
        if (explanationEl) explanationEl.innerHTML = q.explanation || '暂无详细解析。';
        if (q.type === '多选题') multiActions.classList.add('hidden');
        saveState();
        renderQuestionPanel();
    }

    // ─── 交卷统计 ───
    function finishExam() {
        let correctCount = 0, score = 0;
        const answeredIds = state.activeIds.filter(id => {
            const val = state.examAnswers[id];
            return typeof val === 'string' && val.trim().length > 0;
        });

        answeredIds.forEach(id => {
            const q = questionsData.find(item => item.id === id);
            if (!q) return;
            const given = state.examAnswers[id].split('').sort().join('');
            const correct = q.answer.split('').sort().join('');
            const isCorrect = (given === correct);
            
            state.answeredMap[id] = { result: isCorrect ? 'correct' : 'wrong', given };
            if (isCorrect) {
                correctCount++;
                state.wrongList = state.wrongList.filter(wid => wid !== id);
                score += (q.type === '单选题' ? 1 : 2);
            } else {
                if (!state.wrongList.includes(id)) state.wrongList.push(id);
            }
        });

        examScore.innerText = `${score}分`;
        examTotal.innerText = state.activeIds.length;
        examAnswered.innerText = answeredIds.length;
        examCorrect.innerText = correctCount;
        examWrong.innerText = answeredIds.length - correctCount;

        examModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        saveState();
    }

    // ─── 收藏逻辑 ───
    function toggleFavorite() {
        if (state.activeIds.length === 0) return;
        const qId   = Number(state.activeIds[state.currentIndex]);
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

    // ─── 滚动位置管理 ───
    let lastView = 'practice';
    const scrollPositions = JSON.parse(localStorage.getItem('ai_scroll_positions') || '{}');

    function saveViewScroll(viewName = lastView) {
        scrollPositions[viewName] = Math.max(0, Math.round(window.scrollY));
        localStorage.setItem('ai_scroll_positions', JSON.stringify(scrollPositions));
    }

    // ─── 视图切换逻辑 ───
    function switchView(viewName) {
        if (!views[viewName]) return;
        saveViewScroll(lastView);

        Object.values(views).forEach(v => { if (v) v.classList.remove('active'); });
        views[viewName].classList.add('active');
        navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));
        
        if (viewName === 'wrong')     renderList(state.wrongList, wrongListContainer, '错题本');
        if (viewName === 'favorites') renderList(state.favorites, favListContainer,   '收藏夹');

        const targetScroll = scrollPositions[viewName] || 0;
        lastView = viewName;
        requestAnimationFrame(() => window.scrollTo(0, targetScroll));
    }

    // ─── 列表渲染 (错题/收藏) ───
    function renderList(idArray, container, emptyMsg) {
        if (!container) return;
        container.innerHTML = '';
        if (!idArray || idArray.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-secondary);">暂无数据 (${emptyMsg})</div>`;
            return;
        }

        const items = questionsData.filter(q => idArray.includes(Number(q.id)));
        if (items.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-secondary);">数据同步异常。</div>`;
            return;
        }

        items.forEach(q => {
            const el = document.createElement('div');
            el.className = 'list-item';
            let optHtml = '<div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.25rem;">';
            q.options.forEach(opt => {
                const isAns = q.answer.includes(opt.key);
                optHtml += `<div style="font-size:0.9rem;${isAns ? 'color:var(--success-color);font-weight:600;' : 'color:var(--text-secondary);'}">${opt.key}. ${opt.text}</div>`;
            });
            optHtml += '</div>';
            el.innerHTML = `
                <div class="list-item-header">
                    <div class="list-item-title">${q.id}. [${q.type}] ${q.question}</div>
                    <button class="icon-btn" onclick="app.removeFromList('${emptyMsg === '错题本' ? 'wrong' : 'fav'}', ${q.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                ${optHtml}
                <div class="list-item-answer">正确答案：<span>${q.answer}</span></div>
                <div class="list-item-explanation">
                    <div class="list-item-explanation-title">💡 解析：</div>
                    ${q.explanation || '暂无解析。'}
                </div>`;
            container.appendChild(el);
        });
    }

    // ─── 事件绑定 ───
    function setupEventListeners() {
        prevBtn.addEventListener('click', () => {
            state.currentIndex = state.currentIndex > 0 ? state.currentIndex - 1 : state.activeIds.length - 1;
            saveState(); renderQuestion();
        });
        nextBtn.addEventListener('click', () => {
            state.currentIndex = state.currentIndex < state.activeIds.length - 1 ? state.currentIndex + 1 : 0;
            saveState(); renderQuestion();
        });

        favBtn.addEventListener('click', toggleFavorite);
        submitMultiBtn.addEventListener('click', () => submitAnswer(state.selectedMultiOptions.join('')));
        navBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

        startWrongPracticeBtn.addEventListener('click', () => {
            state.practiceMode = 'wrong'; state.currentIndex = 0; state.sessionAnsweredMap = {};
            switchView('practice'); updateActiveIds(); renderQuestion();
        });
        startFavPracticeBtn.addEventListener('click', () => {
            state.practiceMode = 'fav'; state.currentIndex = 0; state.sessionAnsweredMap = {};
            switchView('practice'); updateActiveIds(); renderQuestion();
        });
        exitModeBtn.addEventListener('click', () => {
            state.practiceMode = 'all'; updateActiveIds(); renderQuestion();
        });

        orderModeSelect.addEventListener('change', (e) => {
            state.orderMode = e.target.value; state.currentIndex = 0;
            if (state.orderMode === 'mock') state.examAnswers = {};
            enforceOrderModeRules(); saveState(); updateActiveIds(); renderQuestion();
        });
        if (chapterFilterSelect) {
            chapterFilterSelect.addEventListener('change', (e) => {
                state.chapterFilter = e.target.value; state.currentIndex = 0;
                saveState(); updateActiveIds(); renderQuestion();
            });
        }
        typeFilterSelect.addEventListener('change', (e) => {
            state.typeFilter = e.target.value; state.currentIndex = 0;
            saveState(); updateActiveIds(); renderQuestion();
        });
        appModeSelect.addEventListener('change', (e) => {
            state.appMode = e.target.value; state.examAnswers = {};
            submitExamBtn.classList.toggle('submit-exam-hidden', state.appMode !== 'exam');
            saveState(); renderQuestion();
        });

        submitExamBtn.addEventListener('click', () => {
            if (confirm('确定要提交当前所有作答吗？')) finishExam();
        });
        closeModalBtn.addEventListener('click', () => {
            examModal.classList.add('hidden'); document.body.style.overflow = '';
            state.appMode = 'practice'; appModeSelect.value = 'practice';
            submitExamBtn.classList.add('submit-exam-hidden');
            if (state.orderMode !== 'mock') enforceOrderModeRules();
            saveState(); renderQuestion();
        });

        clearDataBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有进度数据吗？')) {
                state.wrongList = []; state.favorites = []; state.answeredMap = {};
                state.practiceMode = 'all'; state.currentIndex = 0;
                localStorage.removeItem('ai_scroll_positions');
                saveState(); updateActiveIds(); switchView('practice'); renderQuestion();
            }
        });

        document.getElementById('export-btn').addEventListener('click', exportData);
        document.getElementById('import-btn').addEventListener('click', importData);
    }

    // ─── 全局 API 接口 ───
    window.app = {
        removeFromList: (type, id) => {
            const listKey = (type === 'wrong' ? 'wrongList' : 'favorites');
            state[listKey] = state[listKey].filter(item => item !== Number(id));
            renderList(state[listKey], (type === 'wrong' ? wrongListContainer : favListContainer), (type === 'wrong' ? '错题本' : '收藏夹'));
            saveState();
        }
    };

    init();
});
