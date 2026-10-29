import { Game } from './Game.js';
import { InputManager } from './Input.js';
import { initPixelDropTitles, initPixelScores, TeamIntro } from './PixelDropText.js';
import { initInstallPrompt, isInstalledApp, registerServiceWorker } from './pwa/install.js';

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
const btnWinMainMenu = document.getElementById('btn-win-main-menu');

let game;
let inputManager;
let lastTime = 0;
let isRunning = false;
let intro = null; // team-name animation that plays before the game starts
let lastNumPlayers = 2;
let lastDifficulty = 'hard';

const USEFUL_TIPS = [
  'Stop moving to refill your stamina',
  'Get those power-ups to win!',
  'A tired pusher is a slow pusher',
  'Yellow power-ups give you a burst of speed',
  'Green power-ups let you cross into enemy territory',
  'Watch out, the pucks keep splitting!',
  'Rest early, so you have stamina when it counts',
  'Block with your pusher, not just your goal',
];
const FUNNY_TIPS = [
  'The puck is not your friend',
  "Pucks split when they're nervous. They're always nervous.",
  'Seven pucks is not "a lot." Twelve pucks is "a lot."',
  "Your goal is the hole you're supposed to protect, not decorate",
  'Blame lag. There is no lag.',
  'Stop moving to refill your stamina. Works in real life too.',
  'Panic wiggling burns stamina and dignity at the same rate',
  'Resting is a strategy, not giving up',
  'Power-ups are free. Losing is also free.',
  'The green power-up lets you visit your enemy. Bring snacks.',
  'Yellow means go fast, not go away',
  "The AI on Hard doesn't sleep. Or blink. Or forgive.",
  'Easy mode is not a personal insult. Mostly.',
  "If you're losing to your little brother, that's a skill issue",
  'Elbowing your teammate is not an official move',
  'Friendship ends at 6-6',
  'Read the tips',
  'This tip intentionally left blank',
  'Tips do not improve your aim',
];
const ALL_TIPS = [...USEFUL_TIPS, ...FUNNY_TIPS];
const tipEls = document.querySelectorAll('.overlay .tip');
let lastTip = null;

// Pick a fresh tip (never the same twice in a row) for every menu screen.
// The very first one is always a useful tip; after that funny ones mix in.
function refreshTip() {
  const pool = lastTip === null ? USEFUL_TIPS : ALL_TIPS;
  let tip;
  do { tip = pool[Math.floor(Math.random() * pool.length)]; } while (tip === lastTip);
  lastTip = tip;
  tipEls.forEach(el => { el.textContent = `TIP: ${tip}`; });
}
refreshTip();

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (game) {
    // Always pass landscape (wider) dimensions to the game
    game.onResize(Math.max(canvas.width, canvas.height), Math.min(canvas.width, canvas.height));
    if (intro) {
      intro = null; // its block positions no longer match the screen
      game.pusherAppear = 0;
    }
  }
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial setup

function requestMobileFullscreen() {
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  // The installed app already launches full screen in landscape
  if (!isMobile || isInstalledApp()) return;
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
  refreshTip();
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
  // Always use landscape (wider × shorter) dimensions so goals are maximally separated
  const gameW = Math.max(canvas.width, canvas.height);
  const gameH = Math.min(canvas.width, canvas.height);
  game = new Game(gameW, gameH, numPlayers, inputManager, onGameOver, difficulty);
  intro = new TeamIntro(game.teamZonesOnScreen(canvas.width, canvas.height));
  game.pusherAppear = -1; // hidden until the team names have cleared
  
  isRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function onGameOver(winningTeam) {
  isRunning = false;
  inputManager.cleanup();
  uiWinScreen.classList.add('active');
  refreshTip();
  winText.innerText = `Team ${winningTeam} Wins!`;
  let color = '#00ffff';
  if (winningTeam === 2) color = '#ff00ff';
  if (winningTeam === 3) color = '#ffff00';
  winText.style.color = color;
  winText.style.textShadow = `0 0 10px ${color}`;
}

function updateUI() {
  if (!game) return;
  if (scoreTeam1.innerText !== game.score.team1.toString()) {
    scoreTeam1.innerText = game.score.team1;
  }
  if (scoreTeam2.innerText !== game.score.team2.toString()) {
    scoreTeam2.innerText = game.score.team2;
  }
  if (game.numPlayers === 3 && scoreTeam3.innerText !== game.score.team3.toString()) {
    scoreTeam3.innerText = game.score.team3;
  }
}

function gameLoop(timestamp) {
  if (!isRunning) return;

  const dt = (timestamp - lastTime) / 1000; // Delta time in seconds
  lastTime = timestamp;

  // Max dt to prevent physics explosions if tab is inactive
  const safeDt = Math.min(dt, 0.05);

  // Opening sequence: the board is frozen while the team names build and
  // blast away, then the pushers pop in, then play starts
  if (intro) {
    intro.update(safeDt);
    game.draw(ctx);
    intro.draw(ctx);
    if (intro.done) {
      intro = null;
      game.pusherAppear = 0;
    }
  } else if (game.pusherAppear !== null) {
    game.advancePusherAppear(safeDt);
    game.draw(ctx);
  } else {
    game.update(safeDt);
    game.draw(ctx);
  }
  updateUI();

  requestAnimationFrame(gameLoop);
}

function pauseGame() {
  isRunning = false;
  uiPauseScreen.classList.add('active');
  refreshTip();
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
  intro = null;
  uiPauseScreen.classList.remove('active');
  uiWinScreen.classList.remove('active');
  uiDifficultyScreen.classList.remove('active');
  uiStartScreen.classList.add('active');
  refreshTip();
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
btnWinMainMenu.addEventListener('click', returnToMainMenu);

initPixelDropTitles();
initPixelScores();
initInstallPrompt();
registerServiceWorker();
