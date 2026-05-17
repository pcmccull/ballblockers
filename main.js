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

let game;
let inputManager;
let lastTime = 0;
let isRunning = false;

function resizeCanvas() {
  canvas.width = document.body.clientWidth;
  canvas.height = document.body.clientHeight;
  if (game) {
    game.onResize(canvas.width, canvas.height);
  }
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial setup

function startGame(numPlayers) {
  uiStartScreen.classList.remove('active');
  uiWinScreen.classList.remove('active');
  
  if (numPlayers === 3) {
    scoreTeam3.style.display = 'block';
  } else {
    scoreTeam3.style.display = 'none';
  }
  
  inputManager = new InputManager(canvas, numPlayers);
  game = new Game(canvas.width, canvas.height, numPlayers, inputManager, onGameOver);
  
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

  game.update(safeDt);
  game.draw(ctx);
  updateUI();

  requestAnimationFrame(gameLoop);
}

// Event Listeners for UI
btn1Player.addEventListener('click', () => startGame(1));
btn2Player.addEventListener('click', () => startGame(2));
btn3Player.addEventListener('click', () => startGame(3));
btn4Player.addEventListener('click', () => startGame(4));
btnRestart.addEventListener('click', () => startGame(game ? game.numPlayers : 2));
