const DB_NAME = 'TicTacToeAI_DB';
const DB_VERSION = 4;
const STORE_Q = 'qtable';
const STORE_SCORES = 'scores';
let db = null;

let EPSILON = 0.10, LEARNING_RATE = 0.15, DISCOUNT = 0.94;
const PLAYER = 'X', AI = 'O';
let board = Array(9).fill('_');
let gameActive = true, playerTurn = true;
let playerScore = 0, aiScore = 0;
let qTable = new Map();
let moveHistory = [];
let trainingActive = false, stopTraining = false;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const dbInst = e.target.result;
      if (!dbInst.objectStoreNames.contains(STORE_Q)) dbInst.createObjectStore(STORE_Q);
      if (!dbInst.objectStoreNames.contains(STORE_SCORES)) dbInst.createObjectStore(STORE_SCORES);
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = (e) => reject(e);
  });
}

async function loadQFromDB() {
  if (!db) await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_Q, 'readonly');
    const store = tx.objectStore(STORE_Q);
    const getReq = store.get('qtable');
    getReq.onsuccess = () => {
      if (getReq.result) qTable = new Map(Object.entries(getReq.result));
      else qTable = new Map();
      resolve();
    };
    getReq.onerror = () => { qTable = new Map(); resolve(); };
  });
}

async function saveQToDB() {
  if (!db) await openDB();
  const obj = Object.fromEntries(qTable);
  const tx = db.transaction(STORE_Q, 'readwrite');
  tx.objectStore(STORE_Q).put(obj, 'qtable');
}

async function loadScoresFromDB() {
  if (!db) await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_SCORES, 'readonly');
    const store = tx.objectStore(STORE_SCORES);
    const getReq = store.get('scores');
    getReq.onsuccess = () => {
      if (getReq.result) {
        playerScore = getReq.result.player || 0;
        aiScore = getReq.result.ai || 0;
      }
      resolve();
    };
    getReq.onerror = () => resolve();
  });
}

async function saveScoresToDB() {
  if (!db) await openDB();
  const tx = db.transaction(STORE_SCORES, 'readwrite');
  tx.objectStore(STORE_SCORES).put({ player: playerScore, ai: aiScore }, 'scores');
}

function stateStr(b) { return b.join(''); }
function availableMoves(b) { let m = []; b.forEach((v, i) => { if (v === '_') m.push(i); }); return m; }

function checkWinner(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (let [a,bc,c] of lines) if (b[a] !== '_' && b[a] === b[bc] && b[bc] === b[c]) return { winner: b[a], indices: [a,bc,c] };
  if (b.every(cell => cell !== '_')) return { winner: 'draw', indices: [] };
  return { winner: null, indices: [] };
}

function findWinningMove(b, sym) {
  let avail = availableMoves(b);
  for (let idx of avail) { let copy = b.slice(); copy[idx] = sym; if (checkWinner(copy).winner === sym) return idx; }
  return -1;
}

function findForkMove(b, sym) {
  let forks = [];
  for (let idx of availableMoves(b)) {
    let copy = b.slice();
    copy[idx] = sym;
    let winPaths = 0;
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (let [a,bc,c] of lines) {
      if (copy[a] === sym && copy[bc] === sym && copy[c] === '_') winPaths++;
      if (copy[a] === sym && copy[c] === sym && copy[bc] === '_') winPaths++;
      if (copy[bc] === sym && copy[c] === sym && copy[a] === '_') winPaths++;
    }
    if (winPaths >= 2) forks.push(idx);
  }
  return forks.length ? forks[0] : -1;
}

function getHeuristicMove(b, sym, opp) {
  let win = findWinningMove(b, sym);
  if (win !== -1) return win;
  let block = findWinningMove(b, opp);
  if (block !== -1) return block;
  let fork = findForkMove(b, sym);
  if (fork !== -1) return fork;
  let blockFork = findForkMove(b, opp);
  if (blockFork !== -1) return blockFork;
  if (b[4] === '_') return 4;
  const corners = [0,2,6,8];
  for (let c of corners) if (b[c] === '_') return c;
  let avail = availableMoves(b);
  return avail.length ? avail[Math.floor(Math.random() * avail.length)] : -1;
}

function getQValue(state, action) {
  let map = qTable.get(state);
  if (!map) return 0;
  return map[action] || 0;
}

function setQValue(state, action, val) {
  let map = qTable.get(state);
  if (!map) { map = {}; qTable.set(state, map); }
  map[action] = val;
}

async function updateQValuesFromHistory(finalReward) {
  let reward = finalReward === 1 ? 1 : finalReward === -1 ? -1 : 0.12;
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    let { state, action, nextState } = moveHistory[i];
    let currentQ = getQValue(state, action);
    let maxNext = 0;
    let nextMap = qTable.get(nextState);
    if (nextMap) {
      let vals = Object.values(nextMap);
      if (vals.length) maxNext = Math.max(...vals);
    }
    let target = reward + DISCOUNT * maxNext;
    let newQ = currentQ + LEARNING_RATE * (target - currentQ);
    setQValue(state, action, newQ);
    reward = 0;
  }
  moveHistory = [];
  await saveQToDB();
}

function renderBoardUI() {
  const container = document.getElementById('board');
  container.innerHTML = '';
  board.forEach((val, idx) => {
    const cell = document.createElement('div');
    cell.className = `cell ${val === 'X' ? 'x' : val === 'O' ? 'o' : ''}`;
    cell.dataset.index = idx;
    if (val !== '_') cell.innerText = val;
    cell.addEventListener('click', () => onUserClick(idx));
    container.appendChild(cell);
  });
}

function highlightWin(indices) {
  const cells = document.querySelectorAll('.cell');
  indices.forEach(i => { if (cells[i]) cells[i].classList.add('win'); });
}
function clearHighlights() { document.querySelectorAll('.cell.win').forEach(c => c.classList.remove('win')); }

function showResultModal(title, msg, isWin) {
  document.getElementById('resultTitle').innerText = title;
  document.getElementById('resultMsg').innerText = msg;
  const crownDiv = document.getElementById('crownArea');
  crownDiv.innerHTML = isWin ? '<img src="https://img.icons8.com/ios-filled/90/FFD966/crown.png" width="52" style="filter: drop-shadow(0 0 6px gold);">' : '';
  document.getElementById('resultModal').classList.add('active');
}
function hideResultModal() { document.getElementById('resultModal').classList.remove('active'); }

async function handleGameOver(result, winIdx = []) {
  clearHighlights();
  if (result === PLAYER) {
    playerScore++; await saveScoresToDB(); highlightWin(winIdx);
    showResultModal('HUMAN VICTORY', 'AI receives -1 reward', false);
    await updateQValuesFromHistory(-1);
  } else if (result === AI) {
    aiScore++; await saveScoresToDB(); highlightWin(winIdx);
    showResultModal('AI DOMINATION', 'Engine gains +1 reward', true);
    await updateQValuesFromHistory(1);
    startParticleEffect();
  } else {
    showResultModal('STRATEGIC DRAW', 'Mutual +0.12 reward', false);
    await updateQValuesFromHistory(0);
  }
  updateUIStats();
}

async function makeMove(idx, symbol) {
  if (!gameActive) return;
  if (board[idx] !== '_') return;
  board[idx] = symbol;
  renderBoardUI();
  let res = checkWinner(board);
  if (res.winner) { gameActive = false; await handleGameOver(res.winner, res.indices); return; }
  if (res.winner === 'draw') { gameActive = false; await handleGameOver('draw'); return; }
  playerTurn = (symbol !== PLAYER);
  updateUIStats();
  if (!playerTurn && gameActive) setTimeout(() => makeAIMove(), 150);
}

async function recordAIMove(state, actionIdx) {
  board[actionIdx] = AI;
  let nextState = stateStr(board);
  moveHistory.push({ state, action: actionIdx, nextState });
  renderBoardUI();
  let res = checkWinner(board);
  if (res.winner) { gameActive = false; await handleGameOver(res.winner, res.indices); return; }
  if (res.winner === 'draw') { gameActive = false; await handleGameOver('draw'); return; }
  playerTurn = true;
  updateUIStats();
}

async function makeAIMove() {
  if (!gameActive) return;
  let state = stateStr(board);
  let avail = availableMoves(board);
  if (avail.length === 0) return;
  let win = findWinningMove(board, AI);
  if (win !== -1) { await recordAIMove(state, win); return; }
  let block = findWinningMove(board, PLAYER);
  if (block !== -1) { await recordAIMove(state, block); return; }
  let fork = findForkMove(board, AI);
  if (fork !== -1) { await recordAIMove(state, fork); return; }
  let blockFork = findForkMove(board, PLAYER);
  if (blockFork !== -1) { await recordAIMove(state, blockFork); return; }
  if (!qTable.has(state)) qTable.set(state, {});
  let safe = avail.filter(a => {
    let sim = board.slice(); sim[a] = AI;
    return findWinningMove(sim, PLAYER) === -1;
  });
  let candidates = safe.length ? safe : avail;
  let chosen;
  if (Math.random() < EPSILON) chosen = candidates[Math.floor(Math.random() * candidates.length)];
  else {
    let maxQ = -Infinity, best = [];
    for (let a of candidates) {
      let qv = getQValue(state, a);
      if (qv > maxQ) { maxQ = qv; best = [a]; }
      else if (Math.abs(qv - maxQ) < 1e-6) best.push(a);
    }
    chosen = best.length ? best[Math.floor(Math.random() * best.length)] : candidates[0];
  }
  await recordAIMove(state, chosen);
}

async function onUserClick(idx) {
  if (gameActive && playerTurn && board[idx] === '_') await makeMove(idx, PLAYER);
}

function newGameRound() {
  board = Array(9).fill('_');
  gameActive = true;
  playerTurn = true;
  moveHistory = [];
  clearHighlights();
  renderBoardUI();
  updateUIStats();
}

function updateUIStats() {
  document.getElementById('playerScore').innerText = playerScore;
  document.getElementById('aiScore').innerText = aiScore;
  document.getElementById('qStateCount').innerText = qTable.size;
  document.getElementById('turnLabel').innerHTML = playerTurn ? 'PLAYER (X)' : 'AI (O)';
  document.getElementById('epsilonValue').innerText = EPSILON.toFixed(2);
  document.getElementById('epsVal').innerText = EPSILON.toFixed(2);
  document.getElementById('lrVal').innerText = LEARNING_RATE.toFixed(2);
  document.getElementById('gammaVal').innerText = DISCOUNT.toFixed(2);
}

async function runTrainingSession(totalGames) {
  if (trainingActive) return;
  trainingActive = true;
  stopTraining = false;
  const progressDiv = document.getElementById('trainProgress');
  const progressFill = document.getElementById('progressFill');
  const stopBtn = document.getElementById('stopTrainBtn');
  progressDiv.style.display = 'block';
  stopBtn.style.display = 'inline-flex';
  let originalEps = EPSILON;
  let decay = document.getElementById('decayEpsCheck').checked;
  for (let i = 0; i < totalGames && !stopTraining; i++) {
    if (decay) EPSILON = Math.max(0.01, originalEps * (1 - (i / totalGames)));
    await simulateSelfGame();
    if (i % 300 === 0 || i === totalGames - 1) {
      progressFill.style.width = ((i + 1) / totalGames) * 100 + '%';
      updateUIStats();
      await new Promise(r => requestAnimationFrame(r));
    }
  }
  EPSILON = originalEps;
  trainingActive = false;
  stopBtn.style.display = 'none';
  progressDiv.style.display = 'none';
  await saveQToDB();
  updateUIStats();
  alert(stopTraining ? 'Training halted' : `Training completed: ${totalGames} episodes | Q-states: ${qTable.size}`);
  stopTraining = false;
}

async function simulateSelfGame() {
  let simBoard = Array(9).fill('_');
  let simTurn = true;
  let history = [];
  while (true) {
    if (simTurn) {
      let move = getHeuristicMove(simBoard, PLAYER, AI);
      if (move === -1) break;
      simBoard[move] = PLAYER;
      let res = checkWinner(simBoard);
      if (res.winner) { applySimReward(history, res.winner === AI ? 1 : (res.winner === PLAYER ? -1 : 0.12)); break; }
      simTurn = false;
    } else {
      let state = stateStr(simBoard);
      let avail = availableMoves(simBoard);
      if (avail.length === 0) { applySimReward(history, 0.12); break; }
      let win = findWinningMove(simBoard, AI);
      if (win !== -1) { simBoard[win] = AI; history.push({ state, action: win, nextState: stateStr(simBoard) }); }
      else {
        let block = findWinningMove(simBoard, PLAYER);
        if (block !== -1) { simBoard[block] = AI; history.push({ state, action: block, nextState: stateStr(simBoard) }); }
        else {
          if (!qTable.has(state)) qTable.set(state, {});
          let safe = avail.filter(a => { let sim = simBoard.slice(); sim[a] = AI; return findWinningMove(sim, PLAYER) === -1; });
          let candidates = safe.length ? safe : avail;
          let chosen;
          if (Math.random() < EPSILON) chosen = candidates[Math.floor(Math.random() * candidates.length)];
          else {
            let maxQ = -Infinity, best = [];
            for (let a of candidates) { let qv = getQValue(state, a); if (qv > maxQ) { maxQ = qv; best = [a]; } else if (qv === maxQ) best.push(a); }
            chosen = best.length ? best[Math.floor(Math.random() * best.length)] : candidates[0];
          }
          simBoard[chosen] = AI;
          history.push({ state, action: chosen, nextState: stateStr(simBoard) });
        }
      }
      let res = checkWinner(simBoard);
      if (res.winner) { applySimReward(history, res.winner === AI ? 1 : (res.winner === PLAYER ? -1 : 0.12)); break; }
      simTurn = true;
    }
  }
}

function applySimReward(hist, final) {
  let reward = final === 1 ? 1 : final === -1 ? -1 : 0.12;
  for (let i = hist.length - 1; i >= 0; i--) {
    let { state, action, nextState } = hist[i];
    let curQ = getQValue(state, action);
    let maxNext = 0;
    let nextMap = qTable.get(nextState);
    if (nextMap) { let vals = Object.values(nextMap); if (vals.length) maxNext = Math.max(...vals); }
    let target = reward + DISCOUNT * maxNext;
    setQValue(state, action, curQ + LEARNING_RATE * (target - curQ));
    reward = 0;
  }
}

function startParticleEffect() {
  const canvas = document.getElementById('particleCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  let particles = [];
  for (let i = 0; i < 100; i++) particles.push({
    x: innerWidth / 2 + (Math.random() - 0.5) * 400,
    y: innerHeight / 2 + (Math.random() - 0.5) * 300,
    vx: (Math.random() - 0.5) * 8,
    vy: -Math.random() * 8 - 2,
    life: 60,
    size: Math.random() * 5 + 2,
    color: `rgba(43,122,255,${Math.random() * 0.7 + 0.3})`
  });
  function anim() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life--; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); });
    particles = particles.filter(p => p.life > 0);
    if (particles.length) requestAnimationFrame(anim);
  }
  anim();
  setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 2200);
}

window.addEventListener('resize', () => { const c = document.getElementById('particleCanvas'); c.width = window.innerWidth; c.height = window.innerHeight; });

async function attachEvents() {
  document.getElementById('resetScoreBtn').onclick = async () => { playerScore = 0; aiScore = 0; await saveScoresToDB(); updateUIStats(); };
  document.getElementById('homeBtn').onclick = () => location.reload();
  document.getElementById('rematchBtn').onclick = () => { hideResultModal(); newGameRound(); };
  document.getElementById('homeModalBtn').onclick = () => location.reload();
  document.getElementById('clearMemoryBtn').onclick = async () => { if (confirm('Reset entire AI memory?')) { qTable.clear(); await saveQToDB(); updateUIStats(); alert('Memory purged'); } };
  document.getElementById('exportQBtn').onclick = () => { const data = JSON.stringify(Object.fromEntries(qTable)); const blob = new Blob([data], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'qtable_v7.json'; a.click(); };
  document.getElementById('importQBtn').onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.onchange = async e => { const f = e.target.files[0]; const text = await f.text(); try { const obj = JSON.parse(text); qTable = new Map(Object.entries(obj)); await saveQToDB(); updateUIStats(); alert('Imported'); } catch (err) { alert('Invalid file'); } }; inp.click(); };
  document.getElementById('train1k').onclick = () => runTrainingSession(1000);
  document.getElementById('train5k').onclick = () => runTrainingSession(5000);
  document.getElementById('train50k').onclick = () => runTrainingSession(50000);
  document.getElementById('stopTrainBtn').onclick = () => { if (trainingActive) stopTraining = true; };
  document.getElementById('epsilonSlider').oninput = (e) => { EPSILON = parseFloat(e.target.value); updateUIStats(); };
  document.getElementById('lrSlider').oninput = (e) => { LEARNING_RATE = parseFloat(e.target.value); updateUIStats(); };
  document.getElementById('gammaSlider').oninput = (e) => { DISCOUNT = parseFloat(e.target.value); updateUIStats(); };
  document.getElementById('licenseLink').onclick = (e) => { e.preventDefault(); document.getElementById('licenseModal').classList.add('active'); };
  document.getElementById('privacyLink').onclick = (e) => { e.preventDefault(); document.getElementById('privacyModal').classList.add('active'); };
  document.getElementById('closeLicenseBtn').onclick = () => document.getElementById('licenseModal').classList.remove('active');
  document.getElementById('closePrivacyBtn').onclick = () => document.getElementById('privacyModal').classList.remove('active');
  window.onclick = (e) => { if (e.target.classList.contains('modal')) document.querySelectorAll('.modal').forEach(m => m.classList.remove('active')); };
}

async function bootstrap() {
  await openDB();
  await loadQFromDB();
  await loadScoresFromDB();
  renderBoardUI();
  updateUIStats();
  await attachEvents();
}
bootstrap();