import { Game } from './Game.js';
import { InputManager } from './Input.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const uiStartScreen = document.getElementById('start-screen');
const uiWinScreen = document.getElementById('win-screen');
const scoreTeam1 = document.getElementById('score-team1');
const scoreTeam2 = document.getElementById('score-team2');
const scoreTeam3 = document.getElementById('score-team3');
const winText = document.getElementById('win-text');

const btn1Player = document.getElementById('btn-1player');
const btn2Player = document.getElementById('btn-2player');
const btn3Player = document.getElementById('btn-3player');
const btn4Player = document.getElementById('btn-4player');
const btnRestart = document.getElementById('btn-restart');

const uiDifficultyScreen = document.getElementById('difficulty-screen');
const btnEasy = document.getElementById('btn-easy');
const btnMedium = document.getElementById('btn-medium');
const btnHard = document.getElementById('btn-hard');

const uiPauseScreen = document.getElementById('pause-screen');
const btnResume = document.getElementById('btn-resume');
const btnMainMenu = document.getElementById('btn-main-menu');

let game;
let inputManager;
let lastTime = 0;
let isRunning = false;
let lastNumPlayers = 2;
let lastDifficulty = 'hard';

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (game) {
    game.onResize(canvas.width, canvas.height);
  }
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial setup

function requestMobileFullscreen() {
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!isMobile) return;
  const el = document.documentElement;
  const requestFS = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (!requestFS) return;
  requestFS.call(el).then(() => {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  }).catch(() => {});
}

function showDifficultyScreen() {
  uiStartScreen.classList.remove('active');
  uiDifficultyScreen.classList.add('active');
}

function startGame(numPlayers, difficulty = 'hard') {
  lastNumPlayers = numPlayers;
  lastDifficulty = difficulty;
  uiStartScreen.classList.remove('active');
  uiDifficultyScreen.classList.remove('active');
  uiWinScreen.classList.remove('active');

  if (numPlayers === 3) {
    scoreTeam3.style.display = 'block';
  } else {
    scoreTeam3.style.display = 'none';
  }

  inputManager = new InputManager(canvas, numPlayers);
  game = new Game(canvas.width, canvas.height, numPlayers, inputManager, onGameOver, difficulty);
  
  isRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function onGameOver(winningTeam) {
  isRunning = false;
  inputManager.cleanup();
  uiWinScreen.classList.add('active');
  winText.innerText = `Team ${winningTeam} Wins!`;
  let color = '#00ffff';
  if (winningTeam === 2) color = '#ff00ff';
  if (winningTeam === 3) color = '#ffff00';
  winText.style.color = color;
  winText.style.textShadow = `0 0 10px ${color}`;
}

function highlightScore(element) {
  element.classList.remove('score-highlight');
  void element.offsetWidth; // trigger reflow
  element.classList.add('score-highlight');
}

function updateUI() {
  if (!game) return;
  if (scoreTeam1.innerText !== game.score.team1.toString()) {
    scoreTeam1.innerText = game.score.team1;
    highlightScore(scoreTeam1);
  }
  if (scoreTeam2.innerText !== game.score.team2.toString()) {
    scoreTeam2.innerText = game.score.team2;
    highlightScore(scoreTeam2);
  }
  if (game.numPlayers === 3 && scoreTeam3.innerText !== game.score.team3.toString()) {
    scoreTeam3.innerText = game.score.team3;
    highlightScore(scoreTeam3);
  }
}

function gameLoop(timestamp) {
  if (!isRunning) return;

  const dt = (timestamp - lastTime) / 1000; // Delta time in seconds
  lastTime = timestamp;

  // Max dt to prevent physics explosions if tab is inactive
  const safeDt = Math.min(dt, 0.05);

  game.update(safeDt);
  game.draw(ctx);
  updateUI();

  requestAnimationFrame(gameLoop);
}

function pauseGame() {
  isRunning = false;
  uiPauseScreen.classList.add('active');
}

function resumeGame() {
  uiPauseScreen.classList.remove('active');
  requestMobileFullscreen();
  lastTime = performance.now();
  isRunning = true;
  requestAnimationFrame(gameLoop);
}

function returnToMainMenu() {
  isRunning = false;
  if (inputManager) {
    inputManager.cleanup();
    inputManager = null;
  }
  game = null;
  uiPauseScreen.classList.remove('active');
  uiWinScreen.classList.remove('active');
  uiDifficultyScreen.classList.remove('active');
  uiStartScreen.classList.add('active');
}

// Pause when the user swipes/taps out of fullscreen mid-game
function onFullscreenChange() {
  const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFullscreen && isRunning) {
    pauseGame();
  }
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// Event Listeners for UI
btn1Player.addEventListener('click', () => { requestMobileFullscreen(); showDifficultyScreen(); });
btn2Player.addEventListener('click', () => { requestMobileFullscreen(); startGame(2); });
btn3Player.addEventListener('click', () => { requestMobileFullscreen(); startGame(3); });
btn4Player.addEventListener('click', () => { requestMobileFullscreen(); startGame(4); });

btnEasy.addEventListener('click', () => startGame(1, 'easy'));
btnMedium.addEventListener('click', () => startGame(1, 'medium'));
btnHard.addEventListener('click', () => startGame(1, 'hard'));

btnRestart.addEventListener('click', () => startGame(lastNumPlayers, lastDifficulty));
btnResume.addEventListener('click', resumeGame);
btnMainMenu.addEventListener('click', returnToMainMenu);
